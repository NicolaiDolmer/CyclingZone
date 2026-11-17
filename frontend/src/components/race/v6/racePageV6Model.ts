// #7778 · Løbssiden v6, trin 1: rene regler for fanerne og hovedets handlingsrække.
//
// Beslutningslisten på #7778 (ejer 12/11):
//   valg 5: en kørt etape åbner på Resultater.
//   valg 8: ingen bannere; låse-fristen og den ene guld-knap står i hovedets handlingsrække.
// #7865: hovedet er løbets og står stille, når man klikker i etapestriben; tal-rækken,
// statuschippen, låse-fristen og guld-knappen står sammen (tacticsCta nedenfor).
import { activeRiders, lineupFor, scheduleFor, tacticsProgress, type RoleOverride, type RoleRider, type ScheduleRow } from "../stagePageV2/stagePageV2Model.ts";
import { classificationRowsForStage } from "../../../lib/raceStageClassifications.js";
// Udgave E (#7778 valg 20-22, ejer 15/11): hoved og etapestribe er ét kort; striben
// er kortets bund og står over fanerne (v6Strip, v6StripCells, v6Overall nedenfor).

/**
 * Fanerne i ?tab= (valg 5: Resultater først). #7861 (ejervalg 16/11, wireframe v6c): Etape-fanen
 * har to tilstande, "results" (Resultater) og "stage" (Historie efter etapen, forhåndsvisningen før);
 * Stillinger er ikke længere en fane (klassementerne står under Resultater). Startlisten er en fane,
 * når siden har den (#7862).
 */
export const RACE_PAGE_V6_TABS = ["results", "stage", "startlist", "tactics", "team"] as const;
export type RacePageV6Tab = (typeof RACE_PAGE_V6_TABS)[number];

/** Faner der handler om én etape og derfor viser etapestriben. */
export const STAGE_SCOPED_TABS: readonly RacePageV6Tab[] = ["results", "stage"];

/**
 * ?tab= → fane. Uden (gyldig) fane åbner en kørt etape på Resultater og en
 * kommende etape på Etape. Et gammelt ?tab=standings lander samme sted (#7861).
 */
export function resolveV6Tab(param: string | null, { ridden, hasStartList = false }: { ridden: boolean; isStageRace?: boolean; hasStartList?: boolean }): RacePageV6Tab {
  const tabs = v6Tabs(hasStartList);
  if (param && (tabs as readonly string[]).includes(param)) return param as RacePageV6Tab;
  return ridden ? "results" : "stage";
}

/** De gyldige ?tab=-værdier; Startliste kun når siden har den (#7862). */
export function v6Tabs(hasStartList = false): readonly RacePageV6Tab[] {
  return hasStartList ? RACE_PAGE_V6_TABS : RACE_PAGE_V6_TABS.filter((t) => t !== "startlist");
}

/** #7861: fanerækken som wireframet: Etape, Startliste, Taktik, Hold ("results" er Etape-fanens Resultater). */
export function v6TabButtons(hasStartList = false): readonly RacePageV6Tab[] {
  return v6Tabs(hasStartList).filter((t) => t !== "results");
}

/** #7861: fanen der står valgt for en ?tab= (Resultater og Historie er begge Etape). */
export function v6TabButtonFor(tab: RacePageV6Tab): RacePageV6Tab {
  return tab === "results" ? "stage" : tab;
}

export interface TacticsCta {
  /** Etapen knappen åbner Taktik på. */
  stage: number;
  /** Etapens start (= låsetid); null når skemaet ikke kender den. */
  locksAt: Date | null;
  done: number;
  total: number;
}

/**
 * Hovedets handling: taktik for løbets næste åbne etape, eller null.
 * #7865: hovedet er løbets, ikke den valgte etapes, så det står stille, når man
 * klikker i etapestriben. Den åbne etape er den første ukørte etape, der ikke er
 * startet (en etape på vejen er låst; så er den næste åben). Kun mens løbet ikke
 * er slut og holdet har ryttere i løbet.
 */
export function tacticsCta({
  stagesCompleted, totalStages, raceFinished, schedule, riders, overrides, nowMs,
}: {
  stagesCompleted: number; totalStages: number; raceFinished: boolean;
  schedule: ScheduleRow[]; riders: RoleRider[]; overrides: RoleOverride[]; nowMs: number;
}): TacticsCta | null {
  if (raceFinished || activeRiders(riders).length === 0) return null;
  for (let stage = stagesCompleted + 1; stage <= totalStages; stage++) {
    const locksAt = scheduleFor(schedule, stage);
    if (locksAt !== null && locksAt.getTime() <= nowMs) continue;
    const progress = tacticsProgress(riders, overrides, stage);
    return { stage, locksAt, done: progress.done, total: progress.total };
  }
  return null;
}

/**
 * #7865: Resultater for den valgte etape. "on_road" = etapen er startet, men ikke
 * afgjort (den næste etape efter de kørte, og dens start er passeret).
 */
export type V6ResultsPhase = "ridden" | "on_road" | "not_ridden";

export function v6ResultsPhase({ selectedStage, stagesCompleted, raceFinished, schedule, nowMs }: {
  selectedStage: number; stagesCompleted: number; raceFinished: boolean; schedule: ScheduleRow[]; nowMs: number;
}): V6ResultsPhase {
  if (selectedStage <= stagesCompleted) return "ridden";
  if (raceFinished || selectedStage !== stagesCompleted + 1) return "not_ridden";
  const startsAt = scheduleFor(schedule, selectedStage);
  return startsAt !== null && startsAt.getTime() <= nowMs ? "on_road" : "not_ridden";
}

/**
 * #7865: den ene etapestribe. Resultater og Etape følger sidens valgte etape;
 * Taktik følger Taktik-fanens etape (og styrer editoren, der ikke har sin egen
 * vælger under v6). Et endagsløb har ingen stribe.
 * Udgave E (#7778 valg 20/21): striben er hovedkortets bund og står derfor på alle
 * faner, så hovedet ikke skifter højde. På Stillinger og Hold åbner et klik etapen
 * på dens egen fane ("open": Resultater for en kørt etape, ellers Etape).
 */
export function v6Strip({ activeTab, isStageRace, selectedStage, tacticsStage }: {
  activeTab: RacePageV6Tab; isStageRace: boolean; selectedStage: number; tacticsStage: number;
}): { selected: number; target: "page" | "tactics" | "open" } | null {
  if (!isStageRace) return null;
  if (activeTab === "tactics") return { selected: tacticsStage, target: "tactics" };
  if (STAGE_SCOPED_TABS.includes(activeTab)) return { selected: selectedStage, target: "page" };
  return { selected: selectedStage, target: "open" };
}

/** Udgave E: fanen et klik i striben åbner fra Startliste og Hold (valg 5); også Etape-fanens klik. */
export function v6StageTabFor(stage: number, stagesCompleted: number): RacePageV6Tab {
  return stage <= stagesCompleted ? "results" : "stage";
}

// ── Udgave E: talrækkens "Samlet" og etapestribens celler (#7778 valg 20-22) ──

export interface V6GcRow {
  rank?: number | null; rider_id?: string | null; team_id?: string | null; finish_time?: string | null;
  rider?: { team?: { id?: string } | null } | null;
}

/**
 * "Samlet": holdets bedste plads i klassementet og tidsafstanden til føreren.
 * null, når holdet ikke står i klassementet (eller det ikke findes endnu); så
 * udelades tallet helt. Afstanden er GC-rækkens "+M:SS" (som "Din dag" viser den);
 * føreren selv har ingen afstand. Opfinder intet.
 */
export function v6Overall(gcRows: V6GcRow[] | null | undefined, myTeamId: string | number | null | undefined): { rank: number; gap: string | null } | null {
  if (myTeamId == null) return null;
  let best: V6GcRow | null = null;
  for (const r of gcRows || []) {
    const team = r.team_id ?? r.rider?.team?.id ?? null;
    if (team == null || String(team) !== String(myTeamId) || !Number.isFinite(Number(r.rank))) continue;
    if (!best || Number(r.rank) < Number(best.rank)) best = r;
  }
  if (!best) return null;
  const rank = Number(best.rank);
  const gap = rank === 1 ? null : (/^\+\d+:\d{2}(:\d{2})?$/.test(best.finish_time ?? "") ? best.finish_time ?? null : null);
  return { rank, gap };
}

/** Dato-delene i løbets tidszone (Europe/Copenhagen). */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Cellens tidspunkt: kun klokkeslæt i dag, ellers ugedag og klokkeslæt
 * (løbets tidszone, brugerens sprog).
 */
export function v6WhenLabel(date: Date | null, nowMs: number, locale: string, timeZone = "Europe/Copenhagen"): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const sameDay = dayKey(date, timeZone) === dayKey(new Date(nowMs), timeZone);
  try {
    return new Intl.DateTimeFormat(locale || "en", sameDay
      ? { timeZone, hour: "2-digit", minute: "2-digit" }
      : { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return null;
  }
}

export interface V6ResultRow {
  stage_number?: number | null; result_type: string; rank?: number | null; rider_id?: string | null; rider_name?: string | null;
  rider?: { firstname?: string | null; lastname?: string | null } | null;
}

/**
 * Etapevinderens navn pr. kørt etape, kun hvor siden allerede har etapens liste
 * med navne (en hentet etape). Ukendt = ingen nøgle; cellen udelader navnet.
 */
export function v6WinnersByStage(rows: V6ResultRow[] | null | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of rows || []) {
    if (r.result_type !== "stage" || Number(r.rank) !== 1) continue;
    const name = r.rider ? `${r.rider.firstname ?? ""} ${r.rider.lastname ?? ""}`.trim() : (r.rider_name ?? "").trim();
    if (name) out[r.stage_number ?? 1] = name;
  }
  return out;
}

/** Navne pr. rytter fra de hentede etapers lister (rytter-embeds). */
export function v6NamesFromResults(rows: V6ResultRow[] | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows || []) {
    if (!r.rider_id || out.has(String(r.rider_id))) continue;
    const name = r.rider ? `${r.rider.firstname ?? ""} ${r.rider.lastname ?? ""}`.trim() : (r.rider_name ?? "").trim();
    if (name) out.set(String(r.rider_id), name);
  }
  return out;
}

/**
 * #7865: etapevinderen (rytter-id) pr. kørt etape fra hele løbets etaperækker
 * (siden henter dem for alle etaper, uden navne). Ved delt førsteplads vinder den
 * første række (rækkerne kommer sorteret på id).
 */
export function v6WinnerIdsByStage(rows: Array<{ stage_number?: number | null; result_type: string; rank?: number | null; rider_id?: string | null }> | null | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of rows || []) {
    if (r.result_type !== "stage" || Number(r.rank) !== 1 || !r.rider_id) continue;
    const n = r.stage_number ?? 1;
    if (out[n] == null) out[n] = String(r.rider_id);
  }
  return out;
}

/**
 * #7865: vindernavnet pr. kørt etape. Navnet slås op på vinderens id (de hentede
 * lister og navneopslaget); en hentet etape uden id-række beholder navnet fra sin
 * egen liste. Ukendt navn = ingen nøgle (opfindes ikke).
 */
export function v6StripWinners({ winnerIds, nameById, fromResults }: {
  winnerIds: Record<number, string>; nameById: (id: string) => string | null | undefined; fromResults: Record<number, string>;
}): Record<number, string> {
  const out: Record<number, string> = { ...fromResults };
  for (const [n, id] of Object.entries(winnerIds)) {
    const name = (nameById(id) ?? "").trim();
    if (name) out[Number(n)] = name;
  }
  return out;
}

/**
 * #7865 (valg 21, ordet "Gemt" valg 7): planens tilstand for en kommende etape.
 * "saved" = holdet har gemt en plan for netop den etape. Ellers kører motoren
 * rollernes standardordrer: "default", når etapens opstilling har en kaptajn at
 * køre for, og "not_saved", når der hverken er en gemt plan eller en kaptajn.
 */
export type V6PlanState = "saved" | "default" | "not_saved";

/**
 * Etaper med en gemt plan: samme kilder som Taktik (RaceTacticsTab) bruger:
 * team-orders' gemte etaper og ordrerækker samt etapens rolle-undtagelser.
 * null = team-orders er ikke hentet (eller fejlede); så kendes kun undtagelserne.
 */
export function v6SavedStages(teamOrders: { savedStageNumbers?: number[] | null; orders?: Array<{ stage_number?: number | null }> | null } | null | undefined): Set<number> | null {
  if (!teamOrders) return null;
  const out = new Set<number>();
  for (const n of teamOrders.savedStageNumbers ?? []) if (Number.isInteger(n) && n > 0) out.add(n);
  for (const row of teamOrders.orders ?? []) if (Number.isInteger(row?.stage_number) && Number(row.stage_number) > 0) out.add(Number(row.stage_number));
  return out;
}

/**
 * #7778 (Codex P2 fra #8211): nøglen der henter Taktiks gemte etaper igen. Den skifter,
 * når Taktik åbnes, når Taktiks etape skifter, når et gem i Taktik lykkes (saves tæller
 * op), og når fanen forlades, så striben viser den nye tilstand uden et fane- eller etapeskift.
 */
export function v6SavedStagesRefreshKey({ activeTab, tacticsStage, saves }: {
  activeTab: string; tacticsStage: number; saves: number;
}): string {
  return activeTab === "tactics" ? `tactics-${tacticsStage}-${saves}` : "away";
}

/** Planens tilstand for etape n; null = ukendt (team-orders ikke hentet og ingen undtagelse). */
export function v6PlanState({ stage, savedStages, riders, overrides }: {
  stage: number; savedStages: ReadonlySet<number> | null; riders: RoleRider[]; overrides: RoleOverride[];
}): V6PlanState | null {
  if ((overrides || []).some((o) => o.stage_number === stage) || savedStages?.has(stage)) return "saved";
  if (savedStages == null) return null;
  return lineupFor(riders, overrides, stage).some((r) => r.role === "captain") ? "default" : "not_saved";
}

/** Cellens fodlinje: kørt (vinder og egen plads), på vejen, eller planens tilstand. */
export type V6CellFoot =
  | { kind: "ridden"; winner: string | null; myRank: number | null }
  | { kind: "on_road" }
  | { kind: "plan"; state: V6PlanState }
  | { kind: "none" };

export interface V6StripCell {
  number: number;
  profileType: string | null;
  when: string | null;
  foot: V6CellFoot;
}

/**
 * Udgave E: én celle pr. etape. Kun data siden har: vinderen (v6StripWinners),
 * egen bedste plads (alle kørte etaper), "på vejen" (startet, ikke afgjort) og,
 * for en åben etape med egne ryttere, planens tilstand (v6PlanState, valg 21).
 * Ukendt tilstand (team-orders ikke hentet) = intet ord, aldrig et gæt.
 */
export function v6StripCells({
  totalStages, stagesCompleted, raceFinished, schedule, nowMs, profileTypeByStage, winners, myBest, riders, overrides, savedStages = null, whenFor,
}: {
  totalStages: number; stagesCompleted: number; raceFinished: boolean; schedule: ScheduleRow[]; nowMs: number;
  profileTypeByStage: Record<number, string | null | undefined>; winners: Record<number, string>;
  myBest: Record<number, { rank: number } | undefined>; riders: RoleRider[]; overrides: RoleOverride[];
  savedStages?: ReadonlySet<number> | null;
  whenFor: (d: Date) => string | null;
}): V6StripCell[] {
  const hasRiders = activeRiders(riders).length > 0;
  const out: V6StripCell[] = [];
  for (let n = 1; n <= totalStages; n++) {
    const at = scheduleFor(schedule, n);
    const started = at !== null && at.getTime() <= nowMs;
    let foot: V6CellFoot;
    if (n <= stagesCompleted) foot = { kind: "ridden", winner: winners[n] ?? null, myRank: myBest[n]?.rank ?? null };
    else if (!raceFinished && n === stagesCompleted + 1 && started) foot = { kind: "on_road" };
    else if (!raceFinished && !started && hasRiders) {
      const state = v6PlanState({ stage: n, savedStages, riders, overrides });
      foot = state ? { kind: "plan", state } : { kind: "none" };
    } else foot = { kind: "none" };
    out.push({ number: n, profileType: profileTypeByStage[n] ?? null, when: at ? whenFor(at) : null, foot });
  }
  return out;
}

/**
 * #8253: rutekortets profil for den valgte etape. Kun en profil hvis etapenummer er
 * præcis den valgte etape (en række uden nummer er etape 1, som siden selv nøgler
 * den); ellers null, så kortet hellere udelades end viser en anden etapes rute.
 * Taktik bruger samme opslag, så rute og plan altid handler om samme etape.
 */
export function v6RouteProfile<P extends { stage_number?: number | null }>(
  profileByStage: Record<number, P | null | undefined>, stageNumber: number,
): P | null {
  const p = profileByStage[stageNumber] ?? null;
  if (!p) return null;
  return (p.stage_number ?? 1) === stageNumber ? p : null;
}

/** Piletaster i striben: næste/forrige etape, Home/End til første/sidste. null = ingen flytning. */
export function v6StripKeyTarget(key: string, current: number, total: number): number | null {
  if (total < 1) return null;
  if (key === "ArrowRight") return Math.min(total, current + 1);
  if (key === "ArrowLeft") return Math.max(1, current - 1);
  if (key === "Home") return 1;
  if (key === "End") return total;
  return null;
}

/**
 * #7865 (review-punkt c): ægte roving tabindex. Striben har ét tab-stop: den etape,
 * fokus sidst stod på i striben, ellers den valgte, ellers den første. Tab ind i
 * striben lander dér; piletaster, Home og End flytter både fokus og tab-stoppet.
 */
export function v6StripTabStop(numbers: readonly number[], focused: number | null, selected: number): number | null {
  if (numbers.length === 0) return null;
  if (focused != null && numbers.includes(focused)) return focused;
  if (numbers.includes(selected)) return selected;
  return numbers[0];
}

/**
 * #7865 (punkt 3): hvad planen mod det der skete viser på en kørt etape. Den låste
 * oversigt over roller, indsats og holdplan står altid under den; "hidden" = intet
 * at sammenligne (enkeltstart og holdtidskørsel, ingen optegnelse, ingen egne
 * ryttere i optegnelsen), så oversigten står alene i stedet for en tom besked.
 */
export type TacticsAfterView = "hidden" | "loading" | "error" | "no_orders" | "compare";

export function tacticsAfterView({ timeTrial, resultsState, timelineLoading, timelineMissing, ordersPending, ordersMissing, riderCount }: {
  timeTrial: boolean; resultsState: StageResultsState; timelineLoading: boolean; timelineMissing: boolean;
  ordersPending: boolean; ordersMissing: boolean; riderCount: number;
}): TacticsAfterView {
  if (timeTrial) return "hidden";
  if (resultsState === "failed") return "error";
  if (resultsState === "loading" || timelineLoading) return "loading";
  if (timelineMissing) return "hidden";
  if (ordersPending) return "loading";
  if (ordersMissing) return "no_orders";
  return riderCount > 0 ? "compare" : "hidden";
}

/**
 * #7865: Taktik-fanens etape. `requested` er den seneste eksplicitte navigation
 * (Taktiks egen stribe eller hovedets guld-knap; siden ejer den og nulstiller den,
 * når fanen forlades). Uden den åbner fanen på etapen guld-knappen nævner, ellers
 * på den valgte etape. Den sidste handling vinder altid, så guld-knappen åbner
 * editoren, også når en kørt etape står valgt i striben.
 */
export function v6TacticsStage({ requested, ctaStage, selectedStage }: { requested: number | null | undefined; ctaStage: number | null | undefined; selectedStage: number }): number {
  return requested ?? ctaStage ?? selectedStage;
}

/** En etapes resultater, som siden henter dem pr. etape (stageFetchState). */
export type StageResultsState = "loaded" | "loading" | "failed";

/**
 * #7865: planen mod det der skete bygger på etapens resultater (placeringer og egne
 * ryttere). null = ingen sammenligning (fanen er ikke Taktik, eller etapen er ikke kørt);
 * ellers etapens hentetilstand. Uden kendt tilstand (ældre kald) regnes den for hentet.
 */
export function v6TacticsResults({ activeTab, stage, stagesCompleted, stateFor }: {
  activeTab: RacePageV6Tab; stage: number; stagesCompleted: number; stateFor?: ((n: number) => StageResultsState) | null;
}): StageResultsState | null {
  if (activeTab !== "tactics" || stage > stagesCompleted) return null;
  return stateFor ? stateFor(stage) : "loaded";
}

/**
 * #7861 (Codex P2): "Din dag" på et kørt endagsløb. Et endagsløb kan have resultatet som
 * klassement-rækker alene (ingen etape-rækker); samme regel som den nuværende side
 * (YourDayCard): mangler etape-rækkerne, læses klassementets rækker som etapens, så
 * egne ryttere og deres Hvorfor? står der. Med etape-rækker er listen uændret.
 */
export function v6OneDayDayResults<T extends { result_type: string; stage_number?: number | null }>(results: readonly T[], stageNumber: number): T[] {
  if ((classificationRowsForStage(results, stageNumber, "stage") as T[]).length) return [...results];
  const overall = classificationRowsForStage(results, stageNumber, "gc") as T[];
  if (!overall.length) return [...results];
  return [...results, ...overall.map((r) => ({ ...r, result_type: "stage", stage_number: stageNumber }))];
}
