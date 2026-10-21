// #6514 · Kalenderens løbskort (klik/hold på et løb) og Løbshistorikkens
// terrænkolonne. Ren logik uden React, så `node --test` kan loade den.
//
// Ejer-beslutning 15/10 (#6514): kortet viser løbets terræn (TerrainTypeGlyph,
// én pr. type, ingen km), "passer til holdet" 0-100 + bedste bud, min status og
// én knap til udtagelsen. Status-prikken på kalenderfeltet bruger samme
// status-regel, så kort og prik aldrig er uenige.
//
// Intet her opfinder data: alt regnes fra race_stage_profiles, kalenderens
// eget svar og sæsonmatrixens trup/rute-match (GET /api/races/selection/season).

import { riderSuitability } from "./suitability.js";

export type TerrainKind = "mountain" | "itt" | "ttt" | "cobbles" | "hilly" | "sprint";

export type RaceStatus = "selected" | "gtBound" | "missing";

export interface StageScheduleItem { stage: number; date?: string | null; time?: string | null; terrain?: string | null }

export interface CalendarEntryLike {
  id: string;
  isMine?: boolean;
  entered?: boolean;
  /** Udtagelsen er låst (løbet er afviklet eller i gang). Sendes kun når true. */
  lineupFrozen?: boolean;
  withdrawn?: boolean;
  /** In-game-dagspan (game_day). Bindingen regnes i game_days, ikke kalenderdatoer. */
  gameDayStart?: number | null;
  gameDayEnd?: number | null;
  raceClass?: string | null;
  date?: string | null;
  stageSchedule?: StageScheduleItem[] | null;
}

export interface StageProfileLike { stage_number: number | string | null; profile_type?: string | null }
/** Én terræntype i et løb: kalender-kategorien, profile_type'en glyffen tegnes med, og antal etaper. */
export interface RaceTerrain { kind: TerrainKind; profileType: string; count: number }
export interface DateRange { start: string; end: string }

export interface FitRider {
  id: string;
  name: string;
  abilities?: Record<string, number | null> | null;
  injured?: boolean;
  outgoing?: boolean;
}
export interface TeamFit { score: number; best: { id: string; name: string; score: number }; counted: number }

// ── Terræn ───────────────────────────────────────────────────────────────────
// Ejer 15/10 (#6514, 14:06 + 14:43): ingen etapestrimmel og ingen "Afgøres i".
// Terræn vises med den nuværende TerrainTypeGlyph, hver type én gang pr. løb,
// højst 3, den hårdeste først (bjerg, enkeltstart, brosten, kuperet, sprint).
// Antallet står kun i tooltip. "Type" er kalenderens egne kategorier
// (calendar.json terrain.*), så kort, kalenderchip og legende taler samme sprog.
// #6683 skifter ikonerne ud i TerrainTypeGlyph, ét sted for alle.
export const TERRAIN_KINDS: readonly TerrainKind[] = ["mountain", "itt", "ttt", "cobbles", "hilly", "sprint"];

// profile_type → kalender-kategori. Ukendt type → sprint (samme fallback som
// lib/terrainBucket.ts's toTerrainBucket).
const KIND_BY_PROFILE: Readonly<Record<string, TerrainKind>> = {
  high_mountain: "mountain",
  mountain: "mountain",
  medium_mountain: "mountain",
  itt: "itt",
  itt_hilly: "itt",
  ttt: "ttt",
  cobbles: "cobbles",
  gravel: "cobbles",
  hilly: "hilly",
  classic: "hilly",
  rolling: "sprint",
  flat: "sprint",
};

// Kalenderens wire-svar bærer kun kategorien pr. etape (raceCalendar.js). Bruges
// når profilerne ikke kan hentes, så kortet aldrig står tomt.
const PROFILE_BY_BUCKET: Readonly<Record<TerrainKind, string>> = {
  mountain: "mountain", itt: "itt", ttt: "ttt", cobbles: "cobbles", hilly: "hilly", sprint: "flat",
};

export function terrainKind(profileType: string | null | undefined): TerrainKind {
  return (profileType && KIND_BY_PROFILE[profileType]) || "sprint";
}

/** Kalender-bucket (sprint/cobbles/hilly/mountain/itt/ttt) → profile_type til glyffen. */
export function bucketProfileType(bucket: string | null | undefined): string {
  return (bucket && PROFILE_BY_BUCKET[bucket as TerrainKind]) || "flat";
}

/**
 * Løbets terræn: hver kategori én gang, hårdeste først, højst `max`.
 * profileType = kategoriens hyppigste profile_type (glyffen); count = etaper.
 * Fx 4 højbjerg + 2 enkeltstart + 3 flade → mountain ×4, itt ×2, sprint ×3.
 */
export function raceTerrain(profileTypes: ReadonlyArray<string | null | undefined> = [], { max = 3 }: { max?: number } = {}): RaceTerrain[] {
  const byKind = new Map<TerrainKind, Map<string, number>>();
  for (const raw of profileTypes || []) {
    const pt = raw && KIND_BY_PROFILE[raw] ? raw : "flat";
    const kind = terrainKind(pt);
    const types = byKind.get(kind) ?? new Map<string, number>();
    types.set(pt, (types.get(pt) || 0) + 1);
    byKind.set(kind, types);
  }
  const out: RaceTerrain[] = [];
  for (const kind of TERRAIN_KINDS) {
    const types = byKind.get(kind);
    if (!types) continue;
    let profileType = "";
    let top = 0;
    let count = 0;
    for (const [pt, n] of types) {
      count += n;
      if (n > top) { top = n; profileType = pt; }
    }
    out.push({ kind, profileType, count });
  }
  return out.slice(0, max);
}

// ── Datoer ───────────────────────────────────────────────────────────────────

/** Løbets første og sidste etapedato ("YYYY-MM-DD"), eller null. */
export function raceDateRange(entry: CalendarEntryLike | null | undefined): DateRange | null {
  const dates = (entry?.stageSchedule || []).map((s) => s?.date).filter((x): x is string => Boolean(x)).sort();
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  if (entry?.date) return { start: entry.date, end: entry.date };
  return null;
}

function rangesOverlap(a: DateRange | null, b: DateRange | null): boolean {
  return Boolean(a && b) && (a as DateRange).start <= (b as DateRange).end && (b as DateRange).start <= (a as DateRange).end;
}

/**
 * Binding regnes i in-game-dage (game_day), som backendens raceBindingWindow. Flere game_days kan
 * ligge paa samme kalenderdato, saa datoer alene giver falske konflikter. Mangler game_day-spanet
 * paa et af loebene, falder vi tilbage til datoerne.
 */
function bindsOverlap(a: CalendarEntryLike, b: CalendarEntryLike): boolean {
  const ok = [a.gameDayStart, a.gameDayEnd, b.gameDayStart, b.gameDayEnd].every((x) => Number.isFinite(x));
  if (ok) return (a.gameDayStart as number) <= (b.gameDayEnd as number) && (b.gameDayStart as number) <= (a.gameDayEnd as number);
  return rangesOverlap(raceDateRange(a), raceDateRange(b));
}

const GRAND_TOUR_CLASSES = new Set(["TourFrance", "GiroVuelta"]);
export function isGrandTour(raceClass: string | null | undefined): boolean {
  return Boolean(raceClass) && GRAND_TOUR_CLASSES.has(raceClass as string);
}

// ── Min status ────────────────────────────────────────────────────────────────

/**
 * Holdets status for ét løb i kalenderen. null = ingen status at vise (ikke
 * holdets løb, eller løbet er begyndt/kørt, hvor udtagelsen er låst).
 *   "selected" — holdet har en gemt udtagelse
 *   "gtBound"  — ingen udtagelse, men holdets Grand Tour kører samtidig
 *   "missing"  — ingen udtagelse endnu (status-prikken)
 */
export function myRaceStatus(
  entry: CalendarEntryLike | null | undefined,
  entries: readonly CalendarEntryLike[] = [],
  todayIso = "",
): RaceStatus | null {
  if (!entry?.isMine || entry.lineupFrozen || entry.withdrawn) return null;
  const range = raceDateRange(entry);
  if (!range || (todayIso && range.start < todayIso)) return null;
  if (entry.entered) return "selected";
  const gt = (entries || []).find((e) => e && e.id !== entry.id && e.isMine && e.entered && !e.withdrawn
    && isGrandTour(e.raceClass) && bindsOverlap(entry, e));
  return gt ? "gtBound" : "missing";
}

// ── Passer til holdet ─────────────────────────────────────────────────────────

/**
 * "Passer til holdet" 0-100 + bedste bud.
 *
 * Beregningen (ejer 15/10: "holdets bedste ryttere mod løbets terrænvægt"):
 * hver rask, ikke-solgt rytter får sin rute-match mod løbets demand-vektor med
 * samme funktion som sæsonmatrixens Route match-linse (suitability.js), så de
 * to flader aldrig giver to tal for det samme. Holdets tal er gennemsnittet af
 * de N bedste, hvor N er løbets trupstørrelse. Bedste bud er den bedste af dem.
 */
export function teamFit(
  { demandVector, riders = [], size = 0 }: { demandVector?: Record<string, number> | null; riders?: readonly FitRider[]; size?: number | null } = {},
): TeamFit | null {
  if (!demandVector || typeof demandVector !== "object") return null;
  const scored = (riders || [])
    .filter((r) => r && r.abilities && !r.injured && !r.outgoing)
    .map((r) => ({ id: r.id, name: r.name, score: (riderSuitability(r.abilities as Record<string, number>, demandVector) as { score: number }).score }))
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  if (!scored.length) return null;
  const n = Math.max(1, Math.min(Number(size) || scored.length, scored.length));
  const top = scored.slice(0, n);
  const score = Math.round(top.reduce((s, r) => s + r.score, 0) / top.length);
  return { score, best: top[0], counted: top.length };
}

// ── Vej til udtagelsen ────────────────────────────────────────────────────────

/**
 * Holdudtagelsens dag-parameter (?day=N) for et løb: sæsonens kalenderdag,
 * dag 1 = sæsonens tidligste etapedato (seasonTimeline.seasonDayOrdinal).
 */
export function selectionDayOrdinal(startIso: string | null | undefined, days: ReadonlyArray<{ date?: string | null }> = []): number | null {
  const first = (days || []).map((d) => d?.date).filter((x): x is string => Boolean(x)).sort()[0];
  if (!startIso || !first) return null;
  const toDay = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  const n = toDay(startIso) - toDay(first) + 1;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function selectionHref(startIso: string | null | undefined, days: ReadonlyArray<{ date?: string | null }> = []): string {
  const day = selectionDayOrdinal(startIso, days);
  return day != null ? `/planning?tab=selection&day=${day}` : "/planning?tab=selection";
}

// Loebsside fra kalender-previewet; en klikket etape (2+) bevares som ?stage=N.
export function raceDetailHref(raceId: string | number, stage?: number | null): string {
  const base = `/races/${raceId}`;
  return stage != null && Number.isFinite(stage) && stage >= 1 ? `${base}?stage=${stage}` : base;
}

// Loebshistorik-link: loebstype adskiller endagsloeb/etapeloeb, pulje holder historikken i valgt pulje.
export function raceArchiveHref(name: string, raceType?: string | null, poolId?: number | null): string {
  const params: string[] = [];
  if (raceType) params.push(`type=${encodeURIComponent(raceType)}`);
  if (poolId != null && Number.isFinite(poolId)) params.push(`pool=${encodeURIComponent(String(poolId))}`);
  const base = `/race-archive/${encodeURIComponent(name)}`;
  return params.length ? `${base}?${params.join("&")}` : base;
}
