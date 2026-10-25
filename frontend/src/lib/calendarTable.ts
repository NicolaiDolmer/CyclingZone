// #6683 · "Kalender | Tabel": sæsontabellen i Planlægning -> Kalender (bag race_library_v2).
// Ren model uden React, så `node --test` kan loade den.
//
// Ejer 25/10 (#6683): mulighed A = én række pr. løb for HELE sæsonen (ingen
// månedspile). Fanerne (Mit hold/Alle hold/Divisioner) og sæsonvælgeren gælder
// begge visninger; søgning, løbstype og klasse kommer fra #6636's filterlinje,
// terræn er det nye filter. Ingen km (ejer 15/10, #6514).
//
// Intet her opfinder data: alt læses fra kalenderens eget svar
// (GET /api/races/calendar), og holdstatussen er racePeek.myRaceStatus, så
// tabellens pille, kalenderens status-prik og løbskortet aldrig er uenige.

import { bucketProfileType, myRaceStatus, raceDateRange, terrainKind, TERRAIN_KINDS } from "./racePeek.ts";
import type { CalendarEntryLike, RaceStatus, TerrainKind } from "./racePeek.ts";
import { RACE_CLASS_OPTIONS } from "./raceFilterOptions.js";

export interface CalendarTableStage {
  stage: number;
  date?: string | null;
  time?: string | null;
  terrain?: string | null;
  profileType?: string | null;
}

export interface CalendarTableEntry extends CalendarEntryLike {
  name: string;
  raceType?: string | null;
  stages?: number | null;
  terrain?: string | null;
  division?: number | null;
  poolId?: number | null;
  poolLabel?: string | null;
  stageSchedule?: CalendarTableStage[] | null;
}

export interface CalendarTableRow {
  id: string;
  name: string;
  /** "stage_race" eller endagsløb (alt andet). */
  stageRace: boolean;
  raceClass: string | null;
  stages: number;
  start: string | null;
  end: string | null;
  /** Første etapes starttid (HH:MM, København), eller null. */
  startTime: string | null;
  /** Én profile_type pr. etape i etape-rækkefølge (ét ikon pr. etape). */
  stageTypes: string[];
  /** Løbets terræn-kategorier (kalenderens egne), til terrænfilteret. */
  kinds: TerrainKind[];
  division: number | null;
  poolId: number | null;
  poolLabel: string | null;
  isMine: boolean;
  status: RaceStatus | null;
}

export type RaceTypeFilter = "all" | "single" | "stage_race";
export type SortKey = "date" | "name" | "stages";
export type SortDir = "asc" | "desc";

export interface CalendarTableQuery {
  search?: string;
  raceType?: RaceTypeFilter | string;
  raceClass?: string;
  terrain?: TerrainKind | "all" | string;
  division?: number | null;
  poolId?: number | null;
  mineOnly?: boolean;
}

// ── Rækker ───────────────────────────────────────────────────────────────────

function stageTypeOf(s: CalendarTableStage, fallback: string | null | undefined): string {
  return s.profileType || bucketProfileType(s.terrain || fallback);
}

/** Én række pr. løb. todayIso styrer holdstatussen (myRaceStatus: kun kommende løb). */
export function buildCalendarTableRows(
  entries: readonly CalendarTableEntry[] = [],
  todayIso = "",
): CalendarTableRow[] {
  const list = entries || [];
  return list.map((e) => {
    const schedule = [...(e.stageSchedule || [])].sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0));
    const stageTypes = schedule.length
      ? schedule.map((s) => stageTypeOf(s, e.terrain))
      : [bucketProfileType(e.terrain)];
    const range = raceDateRange(e);
    const first = schedule.find((s) => s.date) ?? null;
    const kinds = TERRAIN_KINDS.filter((k) => stageTypes.some((pt) => terrainKind(pt) === k));
    return {
      id: e.id,
      name: e.name,
      stageRace: e.raceType === "stage_race",
      raceClass: e.raceClass ?? null,
      stages: Number(e.stages) > 0 ? Number(e.stages) : Math.max(1, schedule.length),
      start: range?.start ?? null,
      end: range?.end ?? null,
      startTime: first?.time ?? null,
      stageTypes,
      kinds,
      division: e.division ?? null,
      poolId: e.poolId ?? null,
      poolLabel: e.poolLabel ?? null,
      isMine: Boolean(e.isMine),
      status: myRaceStatus(e, list, todayIso),
    };
  });
}

// ── Søgning (flyttet fra #6636's løbsbibliotek, lib/race-library/model.ts) ──
// Tilgivende: accenter, store/små bogstaver, tegn og småord ("de", "la", ...)
// ignoreres, så "tour emirats" finder "Tour des Émirats".
const ARTICLES = new Set(["de", "del", "della", "du", "des", "d", "l", "la", "le", "les"]);

export function normalizeRaceSearch(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => !ARTICLES.has(word))
    .join("");
}

export function matchesRaceSearch(name: string, query: string): boolean {
  const literal = (value: string) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  return normalizeRaceSearch(name).includes(normalizeRaceSearch(query)) || literal(name).includes(literal(query));
}

// ── Filtre ───────────────────────────────────────────────────────────────────

/** Fanerne (division/pulje/mit hold) + filterlinjen (søg, type, klasse, terræn). */
export function filterCalendarTableRows(rows: readonly CalendarTableRow[], q: CalendarTableQuery = {}): CalendarTableRow[] {
  const search = (q.search ?? "").trim();
  const raceType = q.raceType ?? "all";
  const raceClass = q.raceClass ?? "all";
  const terrain = q.terrain ?? "all";
  return (rows || []).filter((r) => {
    if (q.division != null && r.division !== q.division) return false;
    if (q.poolId != null && r.poolId !== q.poolId) return false;
    if (q.mineOnly && !r.isMine) return false;
    if (raceType === "stage_race" && !r.stageRace) return false;
    if (raceType === "single" && r.stageRace) return false;
    if (raceClass !== "all" && r.raceClass !== raceClass) return false;
    if (terrain !== "all" && !r.kinds.includes(terrain as TerrainKind)) return false;
    if (search && !matchesRaceSearch(r.name, search)) return false;
    return true;
  });
}

// ── Sortering ────────────────────────────────────────────────────────────────

function byDate(a: CalendarTableRow, b: CalendarTableRow): number {
  // Løb uden datoer sidst, uanset retning.
  if (Boolean(a.start) !== Boolean(b.start)) return a.start ? -1 : 1;
  return (a.start ?? "").localeCompare(b.start ?? "") || (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

function tieBreak(a: CalendarTableRow, b: CalendarTableRow): number {
  return a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));
}

/** Standard: datoer stigende (sæsonens rækkefølge). Stabil på navn + id. */
export function sortCalendarTableRows(
  rows: readonly CalendarTableRow[],
  { key = "date", dir = "asc" }: { key?: SortKey | string; dir?: SortDir | string } = {},
): CalendarTableRow[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...(rows || [])].sort((a, b) => {
    if (key === "date") {
      if (Boolean(a.start) !== Boolean(b.start)) return a.start ? -1 : 1;
      return sign * byDate(a, b) || tieBreak(a, b);
    }
    if (key === "stages") return sign * (a.stages - b.stages) || byDate(a, b) || tieBreak(a, b);
    if (key === "name") return sign * a.name.localeCompare(b.name) || byDate(a, b) || String(a.id).localeCompare(String(b.id));
    return byDate(a, b) || tieBreak(a, b);
  });
}

/** Klik på en kolonneoverskrift: samme kolonne vender retningen, en ny starter stigende. */
export function nextSort(current: { key: string; dir: string }, key: string): { key: string; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

// ── Filter-muligheder ────────────────────────────────────────────────────────

const CLASS_ORDER: readonly string[] = RACE_CLASS_OPTIONS.map((o: { value: string }) => o.value);

/** Klasserne der findes i rækkerne, i prestige-rækkefølge (samme liste som Resultater); ukendte sidst. */
export function classOptions(rows: readonly CalendarTableRow[], selected = "all"): string[] {
  const present = new Set((rows || []).map((r) => r.raceClass).filter((c): c is string => Boolean(c)));
  if (selected && selected !== "all") present.add(selected);
  const rank = (c: string) => {
    const i = CLASS_ORDER.indexOf(c);
    return i === -1 ? CLASS_ORDER.length : i;
  };
  return [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Terræn-kategorierne der findes i rækkerne, hårdeste først (kalenderens rækkefølge). */
export function terrainOptions(rows: readonly CalendarTableRow[], selected = "all"): TerrainKind[] {
  const present = new Set<string>((rows || []).flatMap((r) => r.kinds));
  if (selected && selected !== "all") present.add(selected);
  return TERRAIN_KINDS.filter((k) => present.has(k));
}

// ── Visningsvalg ─────────────────────────────────────────────────────────────

export type CalendarView = "calendar" | "table";

/**
 * Visningen der faktisk tegnes. Flag off (eller endnu ukendt) = altid kalenderen,
 * uanset hvad der er valgt, så siden er præcis som før for alle uden flaget.
 */
export function effectiveCalendarView(view: string | null | undefined, libraryV2: boolean): CalendarView {
  return libraryV2 && view === "table" ? "table" : "calendar";
}
