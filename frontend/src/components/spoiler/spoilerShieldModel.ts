// #7859 · Spoiler-skjoldets regler, uden React og uden netværk (testes i node).
//
// Ejer 16/11: billede 1-4 (løbssiden), 6 og 7 bag den slukkede kontakt
// spoiler_shield_7859. Slukket = alt som i dag. Serveren (GET /api/me/spoiler-shield)
// er sandheden for kontakten, valgene og de åbnede etaper; en etape åbnes med ét
// tryk ("Show results") eller når filmen er i mål, og det gælder på alle enheder.

export type OpenFinishedIn = "results" | "story";

export interface SpoilerSettings {
  shieldAll: boolean;
  openFinishedIn: OpenFinishedIn;
}

export interface RaceSpoilerState {
  /** Kontakten i løbets hoved; null = følg valget for alle løb. */
  shield: boolean | null;
  shielded: boolean;
  openedStages: number[];
}

/** Hvad siden ved om skjoldet lige nu. */
export interface SpoilerShieldView {
  /** Kontakten er tændt for spilleren (serverens svar). */
  enabled: boolean;
  /** Serverens svar er landet. Før det: `pending` afgør, om resultater må vises. */
  loaded: boolean;
  /**
   * Svaret er ikke landet, og browseren husker, at skjoldet var tændt for denne
   * spiller sidst. Så vises en kørt etapes resultat ikke, før svaret er der.
   * Uden husket værdi tegnes siden straks som i dag (kontakten er slukket for de fleste).
   */
  pending: boolean;
  settings: SpoilerSettings;
  race: RaceSpoilerState | null;
}

export const DEFAULT_SETTINGS: SpoilerSettings = Object.freeze({ shieldAll: false, openFinishedIn: "results" }) as SpoilerSettings;

export const OFF_VIEW: SpoilerShieldView = Object.freeze({
  enabled: false, loaded: true, pending: false, settings: DEFAULT_SETTINGS, race: null,
}) as SpoilerShieldView;

export const MAX_STAGE = 64;

function cleanStages(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ok = value.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_STAGE);
  return [...new Set(ok)].sort((a, b) => a - b);
}

export function parseSettings(raw: unknown): SpoilerSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { shieldAll: r.shieldAll === true, openFinishedIn: r.openFinishedIn === "story" ? "story" : "results" };
}

export function parseRace(raw: unknown, settings: SpoilerSettings): RaceSpoilerState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const shield = typeof r.shield === "boolean" ? r.shield : null;
  return { shield, shielded: shield ?? settings.shieldAll, openedStages: cleanStages(r.openedStages) };
}

/** Serverens svar → visningen. Alt andet end et udtrykkeligt `enabled: true` er slukket. */
export function parseShieldResponse(body: unknown): SpoilerShieldView {
  if (!body || typeof body !== "object" || (body as { enabled?: unknown }).enabled !== true) return OFF_VIEW;
  const b = body as { settings?: unknown; race?: unknown };
  const settings = parseSettings(b.settings);
  return { enabled: true, loaded: true, pending: false, settings, race: parseRace(b.race, settings) };
}

/** Skjoldet gælder for løbet (kontakten tændt for spilleren og løbet skjult). */
export function raceShielded(view: SpoilerShieldView): boolean {
  return view.enabled && view.race?.shielded === true;
}

/**
 * Er etapens resultat skjult? Kun en kørt etape kan være skjult, og kun til den
 * er åbnet. Mens svaret hentes for en spiller, der havde skjoldet tændt sidst,
 * er en kørt etape også skjult (ingen glimt af vinderen).
 */
export function stageHidden(view: SpoilerShieldView, stage: number, stagesCompleted: number): boolean {
  if (stage < 1 || stage > stagesCompleted) return false;
  if (view.pending) return true;
  if (!raceShielded(view)) return false;
  return !(view.race?.openedStages ?? []).includes(stage);
}

/** Åbn en etape lokalt (serveren får det samme kald; svaret vinder bagefter). */
export function withOpenedStage(view: SpoilerShieldView, stage: number): SpoilerShieldView {
  if (!view.race || view.race.openedStages.includes(stage)) return view;
  return { ...view, race: { ...view.race, openedStages: [...view.race.openedStages, stage].sort((a, b) => a - b) } };
}

/** Kontakten i løbets hoved slået til eller fra (lokalt; serveren får samme valg). */
export function withRaceShield(view: SpoilerShieldView, shield: boolean): SpoilerShieldView {
  const race = view.race ?? { shield: null, shielded: false, openedStages: [] };
  return { ...view, race: { ...race, shield, shielded: shield } };
}

/** Pr.-etape-data (vinder, egen placering) uden de skjulte etaper. */
export function withoutHiddenStages<T>(byStage: Record<number, T>, hidden: (stage: number) => boolean): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [key, value] of Object.entries(byStage)) {
    const n = Number(key);
    if (!hidden(n)) out[n] = value;
  }
  return out;
}

/**
 * Hvilken fane en kørt etape åbner på (klik i striben, eller siden åbnet uden ?tab=).
 * Skjult etape: Story (filmen), aldrig Resultater. Ellers spillerens valg, hvor
 * "results" er som i dag.
 */
export function finishedStageTab(view: SpoilerShieldView, { hidden }: { hidden: boolean }): "stage" | "results" {
  if (hidden) return "stage";
  if (view.enabled && view.settings.openFinishedIn === "story") return "stage";
  return "results";
}

/** Filmen er i mål: positionen har nået etapens længde. */
export function filmAtFinish(km: number, distanceKm: number): boolean {
  return distanceKm > 0 && km >= distanceKm - 1e-6;
}

/** Referatet med skjoldet: kun linjerne op til filmens position. */
export function linesUpTo<T extends { km: number }>(lines: readonly T[], km: number): T[] {
  return lines.filter((l) => l.km <= km + 1e-6);
}

/** Talrækkens tal, der afslører et resultat, er mærket `spoiler` af siden. */
export function withoutSpoilerStats<T extends { spoiler?: boolean }>(stats: readonly T[], hide: boolean): T[] {
  return hide ? stats.filter((s) => s.spoiler !== true) : [...stats];
}

// ── Den huskede værdi (kun første billede) ────────────────────────────────

export const SPOILER_LAST_KEY = "cz_spoiler_shield_7859_last";

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

function defaultStorage(): StorageLike | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

/** true = skjoldet var tændt for et løb sidst, denne browser hørte fra serveren. */
export function readRememberedShield(storage: StorageLike | null = defaultStorage()): boolean {
  try { return storage?.getItem(SPOILER_LAST_KEY) === "1"; } catch { return false; }
}

export function rememberShield(on: boolean, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(SPOILER_LAST_KEY, on ? "1" : "0"); } catch { /* catch-ok: uden lager gælder serverens svar stadig */ }
}

/** Visningen før serverens svar. */
export function initialView(remembered: boolean): SpoilerShieldView {
  return remembered ? { ...OFF_VIEW, loaded: false, pending: true } : { ...OFF_VIEW, loaded: false };
}
