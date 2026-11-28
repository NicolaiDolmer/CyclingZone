// #8781 · Saeson-visningens fire linser (ejerbeslutning 26/11 punkt 11-12 paa #8419): Udtagelser,
// Rutematch, Form og Belastning. Ren logik, saa linse-skift og Rutematch-gitteret kan testes uden React.
//
// Udtagelser og Belastning er den gamle udtagelsesmatrix (racehub/SeasonMatrix.jsx), uaendret.
// Rutematch er et rytter x loeb-gitter (ét tal pr. loeb, ikke pr. loebsdag), saa hele saesonen kan
// sammenlignes side om side. Form er formplanen (planner/), samme data og kald som Formplan-fanen.
import { riderSuitability as riderSuitabilityBase } from "../../lib/suitability.js";

export const SEASON_LENSES = ["entries", "routeMatch", "form", "load"] as const;
export type SeasonLens = (typeof SEASON_LENSES)[number];

/** Spillerens linsevalg huskes i browseren (en bekvemmelighed, ingen spilstate). */
export const SEASON_LENS_STORAGE_KEY = "cz.planning.seasonLens";

export function isSeasonLens(value: unknown): value is SeasonLens {
  return typeof value === "string" && (SEASON_LENSES as readonly string[]).includes(value);
}

/** Udtagelser og Belastning tegnes af udtagelsesmatrixen selv. */
export function lensShowsMatrix(lens: SeasonLens): boolean {
  return lens === "entries" || lens === "load";
}

/** "Kun problemer" handler om udtagelserne, saa knappen hoerer til de to matrix-linser. */
export function lensUsesProblemsFilter(lens: SeasonLens): boolean {
  return lensShowsMatrix(lens);
}

/** Matrixens egen linse for en matrix-linse ("entries" er standard for de andre). */
export function matrixLensFor(lens: SeasonLens): "entries" | "load" {
  return lens === "load" ? "load" : "entries";
}

export function readStoredLens(storage: Pick<Storage, "getItem"> | null | undefined): SeasonLens {
  try {
    const value = storage?.getItem(SEASON_LENS_STORAGE_KEY);
    return isSeasonLens(value) ? value : "entries";
  } catch {
    return "entries";
  }
}

export function storeLens(storage: Pick<Storage, "setItem"> | null | undefined, lens: SeasonLens): void {
  try {
    storage?.setItem(SEASON_LENS_STORAGE_KEY, lens);
  } catch {
    // Privat vindue eller blokeret lager: valget huskes bare ikke.
  }
}

export interface RouteGridRace {
  id: string;
  name: string;
  gameDayStart?: number | null;
  demandVector?: Record<string, number> | null;
  withdrawn?: boolean;
  didNotStart?: boolean;
}

export interface RouteGridRider {
  id: string;
  name: string;
  abilities?: Record<string, number | null> | null;
}

export interface RouteGridCell {
  raceId: string;
  /** null = rytteren har ingen evner at regne paa, eller loebet ingen rute endnu. */
  score: number | null;
  best: boolean;
}

export interface RouteGridRow {
  rider: RouteGridRider;
  cells: RouteGridCell[];
}

export interface RouteGrid {
  races: RouteGridRace[];
  rows: RouteGridRow[];
  bestByRace: Map<string, number>;
}

type ScoreFn = (abilities: Record<string, number | null>, demand: Record<string, number>) => number;

const defaultScore: ScoreFn = (abilities, demand) =>
  (riderSuitabilityBase as (a: unknown, d: unknown) => { score: number })(abilities, demand).score;

/**
 * Rytter x loeb med rutematch. Loebene i kalenderorden, rytterne i samme orden som matrixen (navn).
 * Bedste tal pr. loeb markeres (ved lige tal alle med det tal). Et loeb uden rute (ingen demandVector)
 * eller en rytter uden evner faar intet tal: matrixen opdigter ikke et 0.
 */
export function buildRouteMatchGrid(
  races: RouteGridRace[],
  riders: RouteGridRider[],
  score: ScoreFn = defaultScore,
): RouteGrid {
  const orderedRaces = [...(races || [])].sort(
    (a, b) => (a.gameDayStart ?? Number.MAX_SAFE_INTEGER) - (b.gameDayStart ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
  );
  const orderedRiders = [...(riders || [])].sort((a, b) => a.name.localeCompare(b.name));
  const scoreOf = (rider: RouteGridRider, race: RouteGridRace): number | null => {
    if (!rider.abilities || !race.demandVector || !Object.keys(race.demandVector).length) return null;
    const value = score(rider.abilities, race.demandVector);
    return Number.isFinite(value) ? value : null;
  };
  const raw = orderedRiders.map((rider) => orderedRaces.map((race) => scoreOf(rider, race)));
  const bestByRace = new Map<string, number>();
  orderedRaces.forEach((race, col) => {
    let best: number | null = null;
    for (const row of raw) {
      const value = row[col];
      if (value != null && (best == null || value > best)) best = value;
    }
    if (best != null) bestByRace.set(race.id, best);
  });
  const rows = orderedRiders.map((rider, i) => ({
    rider,
    cells: orderedRaces.map((race, col) => {
      const value = raw[i][col];
      return { raceId: race.id, score: value, best: value != null && bestByRace.get(race.id) === value };
    }),
  }));
  return { races: orderedRaces, rows, bestByRace };
}

interface PlannerPeakLike {
  isSuggestion?: boolean;
  targetRaceId?: string | null;
}

/** Assistentens udkast der kan accepteres (et "ingen peak"-raad uden maal taeller ikke med). */
export function pendingSuggestionCount(riders: Array<{ peaks?: PlannerPeakLike[] }> | null | undefined): number {
  return (riders || []).reduce((n, r) => n + (r.peaks || []).filter((p) => p.isSuggestion && p.targetRaceId).length, 0);
}

export interface SeasonOption {
  number: number;
  status?: string;
}

/** Den aktive saesons nummer, eller null. */
export function activeSeasonNumber(seasons: SeasonOption[] | null | undefined): number | null {
  return (seasons || []).find((s) => s.status === "active")?.number ?? null;
}

/** Saesonen der vises: et eksplicit valg, ellers den aktive. */
export function viewedSeason(choice: number | null, seasons: SeasonOption[] | null | undefined): number | null {
  return choice ?? activeSeasonNumber(seasons);
}

interface MatrixColumnLike {
  raceId: string;
  gameDay: number;
}

/**
 * #8848: matrixen aabner ved i dag, ikke ved saesonstart. Den foerste loebsdags-kolonne med en dato
 * fra i dag og frem (kolonnerne staar i loebenes startraekkefoelge, saa et loeb der koerer i dag
 * kommer foerst). Null, naar hele saesonen er koert eller ingen kolonne har en dato.
 */
export function firstColumnFromToday(
  columns: readonly MatrixColumnLike[],
  dateByDay: ReadonlyMap<number, string>,
  today: string,
): number | null {
  const index = columns.findIndex((col) => {
    const date = dateByDay.get(col.gameDay);
    return date != null && date >= today;
  });
  return index >= 0 ? index : null;
}

/** #8848: mobilens loebsvaelger starter paa det foerste loeb, der ikke er slut i dag. */
export function firstRaceFromToday(
  races: ReadonlyArray<{ id: string; gameDayEnd: number }>,
  dateByDay: ReadonlyMap<number, string>,
  today: string,
): string | null {
  return races.find((race) => {
    const end = dateByDay.get(race.gameDayEnd);
    return end != null && end >= today;
  })?.id ?? null;
}

/**
 * #8848 (TASTE P11, én sandhed): linjen under matrixen maa ikke sige "Ingen problemer", mens
 * sidehovedet melder loeb uden fuld trup. Siden giver sit eget tal (samme regel som sidehovedet),
 * og linjen naevner begge dele. `needSquad` undefined = den gamle side, uaendret.
 */
export function matrixFooterParts(conflicts: number, needSquad: number | undefined): Array<"needSquad" | "problems"> | "none" {
  const parts: Array<"needSquad" | "problems"> = [];
  if ((needSquad ?? 0) > 0) parts.push("needSquad");
  if (conflicts > 0) parts.push("problems");
  return parts.length ? parts : "none";
}

/** #8848: rollebogstaverne der faktisk staar i matrixen, i fast raekkefoelge, til forklaringen paa fladen. */
export function rolesInMatrix(roles: Iterable<string | null | undefined>, order: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const role of roles) if (role) seen.add(role);
  return order.filter((role) => seen.has(role));
}
