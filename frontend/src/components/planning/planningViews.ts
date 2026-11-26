// #8419 · Den samlede planlaegningsside (ejerens beslutninger 26/11): sidens visninger og de smaa regler
// bag dem, som ren logik uden DOM, saa de kan testes med `node --test`.
//   - Sidehovedets ene vaelger: Uge · Saeson · Maaned (punkt 1). Uge er standard.
//   - Loebets faner: Trup · Taktik · Formtop · Startlister (punkt 6).
//   - Match pr. etape i et etapeloeb (punkt 7): "Hele loebet" eller én etape.
//   - "Fordel ryttere" kun paa dage med mere end ét loeb (punkt 4), og dagens nummer i den gamle dags-tavle.
//   - #8811: et skift vaek fra Saeson eller dags-tavlen med en ugemt kladde spoerger foerst.
import { WORKBENCH_VIEWS, isRacePast, type WorkbenchView, type SeasonRace } from "../../lib/planningWorkbench.ts";

export const PLANNING_MODES = ["week", "season", "month"] as const;
export type PlanningMode = (typeof PLANNING_MODES)[number];

export function isPlanningMode(value: unknown): value is PlanningMode {
  return typeof value === "string" && (PLANNING_MODES as readonly string[]).includes(value);
}

/** Visningen i adressen (?mode=); alt ukendt er Uge. */
export function planningModeFrom(value: string | null | undefined): PlanningMode {
  return isPlanningMode(value) ? value : "week";
}

export const PLANNING_VIEWS = [...WORKBENCH_VIEWS, "startlists"] as const;
export type PlanningView = WorkbenchView | "startlists";

export function isPlanningView(value: unknown): value is PlanningView {
  return typeof value === "string" && (PLANNING_VIEWS as readonly string[]).includes(value);
}

// ── Ugemte kladder ved skift af visning (#8811, Codex P1 paa #8790) ─────────

/**
 * Den flade der staar fremme, naar Uge ikke vises, og som kan have sin egen ugemte kladde: Saeson
 * (udtagelsesmatrixen) eller dags-tavlen ("Fordel ryttere"). Maaned har ingen kladde. Uge er altid
 * monteret (skjult), saa et ugemt loeb overlever ethvert skift og aldrig spoerges om her.
 */
export type EmbeddedSurface = "season" | "distribute" | null;

export function embeddedSurface(mode: PlanningMode, distributing: boolean): EmbeddedSurface {
  if (distributing) return "distribute";
  return mode === "season" ? "season" : null;
}

/**
 * Et skift fra Saeson eller dags-tavlen til en anden visning afmonterer fladen, og dens ugemte kladde
 * forsvinder med den. Svaret er noeglen (races-navnerummet) til det spoergsmaal spilleren skal bekraefte
 * foerst, eller null, naar skiftet kan ske straks. Samme spoergsmaal som fladerne selv stiller.
 */
export function leaveConfirmKey(
  from: EmbeddedSurface,
  to: EmbeddedSurface,
  dirty: { season: boolean; board: boolean },
): "matrix.leaveUnsaved" | "racehub.leaveUnsaved" | null {
  if (from === to) return null;
  if (from === "season" && dirty.season) return "matrix.leaveUnsaved";
  if (from === "distribute" && dirty.board) return "racehub.leaveUnsaved";
  return null;
}

/** Adressen for en visning: ?mode= (Uge er standard) uden dags-tavlens og den gamle saesonvisnings parametre. */
export function paramsForMode(prev: URLSearchParams, next: PlanningMode): URLSearchParams {
  const p = new URLSearchParams(prev);
  if (next === "week") p.delete("mode");
  else p.set("mode", next);
  for (const key of ["day", "returnView", "scope", "pool", "season", "view"]) p.delete(key);
  return p;
}

/** Match-vaelgeren: hele loebet eller en etape (0-baseret indeks i etape-profilerne). */
export type MatchScope = "race" | number;

/**
 * Raekkernes Match for det valgte omfang. Hele loebet er serverens tal; en etape er rytterens
 * etape-match fra samme svar (stageSuitability). Mangler etapens tal, staar Match tom (aldrig gaettet).
 */
export function matchForScope(
  raceMatch: number | null,
  stageSuitability: Array<number | null> | null | undefined,
  scope: MatchScope,
): number | null {
  if (scope === "race") return raceMatch;
  const value = stageSuitability?.[scope];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/**
 * Dagens nummer i den gamle dags-tavle (GET /api/races/distribution?day=N): kalenderdage fra saesonens
 * foerste dag, 1-baseret. Saesonens foerste dag er den tidligste dato i loebsdag-til-dato-tabellen, som
 * daekker alle puljers etaper (samme akse som serverens seasonDayAxis).
 */
export function boardDayFor(date: string, dates: Map<number, string>): number | null {
  const all = [...dates.values()].filter(Boolean).sort();
  if (!all.length || !date) return null;
  const n = dayNumber(date) - dayNumber(all[0]) + 1;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Loeb holdet koerer paa en kalenderdato (afmeldte og afsluttede tael ikke). */
export function racesOnDate(
  date: string,
  races: SeasonRace[],
  dates: Map<number, string>,
  withdrawn: Set<string>,
): SeasonRace[] {
  return races.filter((race) => {
    if (withdrawn.has(race.id) || isRacePast(race)) return false;
    const start = dates.get(race.gameDayStart);
    const end = dates.get(race.gameDayEnd) ?? start;
    return !!start && !!end && start <= date && date <= end;
  });
}

/** "Fordel ryttere" staar kun paa en dag med mere end ét loeb (ejer 26/11, punkt 4). */
export function canDistributeOn(date: string, races: SeasonRace[], dates: Map<number, string>, withdrawn: Set<string>): boolean {
  return racesOnDate(date, races, dates, withdrawn).length > 1;
}

// ── Startlister (punkt 6) ──────────────────────────────────────────────────

export interface StartRider {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  nationality_code?: string | null;
}
export interface StartTeam {
  team: { id: string; name?: string | null };
  riders: StartRider[];
}
export interface StartColumn {
  id: string;
  visible?: boolean;
  opensInDays?: number | null;
  teamCount?: number;
  teams?: StartTeam[];
}

/** Loebets egen kolonne i dags-tavlens svar (null = loebet staar ikke paa dagen i holdets pulje). */
export function startColumnFor(body: { columns?: StartColumn[] } | null | undefined, raceId: string): StartColumn | null {
  return (body?.columns ?? []).find((c) => String(c.id) === String(raceId)) ?? null;
}

