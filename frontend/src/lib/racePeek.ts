// #6514 · Kalenderens løbskort (klik/hold på et løb) og Løbshistorikkens
// "typisk afgørelse". Ren logik uden React, så `node --test` kan loade den.
//
// Ejer-beslutning 15/10 (#6514): kortet viser en etapestrimmel (farve pr.
// profile_type) i stedet for km, hvad løbet afgøres i, "passer til holdet"
// 0-100 + bedste bud, min status og én knap til udtagelsen. Status-prikken på
// kalenderfeltet bruger samme status-regel, så kort og prik aldrig er uenige.
//
// Intet her opfinder data: alt regnes fra race_stage_profiles, kalenderens
// eget svar og sæsonmatrixens trup/rute-match (GET /api/races/selection/season).

import { riderSuitability } from "./suitability.js";

export type PeekGroup =
  | "high_mountain" | "mountain" | "medium_mountain" | "itt" | "ttt"
  | "cobbles" | "gravel" | "hilly" | "rolling" | "flat";

export type RaceStatus = "selected" | "gtBound" | "missing";

export interface StageScheduleItem { stage: number; date?: string | null; time?: string | null; terrain?: string | null }

export interface CalendarEntryLike {
  id: string;
  isMine?: boolean;
  entered?: boolean;
  raceClass?: string | null;
  date?: string | null;
  stageSchedule?: StageScheduleItem[] | null;
}

export interface StageProfileLike { stage_number: number | string | null; profile_type?: string | null }
export interface StripSegment { stage: number; profileType: string | null; group: PeekGroup }
export interface DecidedGroup { group: PeekGroup; count: number }
export interface DateRange { start: string; end: string }

export interface FitRider {
  id: string;
  name: string;
  abilities?: Record<string, number | null> | null;
  injured?: boolean;
  outgoing?: boolean;
}
export interface TeamFit { score: number; best: { id: string; name: string; score: number }; counted: number }

// ── Terrængrupper ─────────────────────────────────────────────────────────────
// profile_type → den gruppe kortet taler om. Tidskørsel og kuperet tidskørsel er
// ét "enkeltstart"; klassiker læses som kuperet (blandet terræn med korte stik,
// stageProfileConfig.js). Ukendt type → flat (samme fallback som silhuetterne).
const GROUP_BY_PROFILE: Readonly<Record<string, PeekGroup>> = Object.freeze({
  flat: "flat",
  rolling: "rolling",
  hilly: "hilly",
  classic: "hilly",
  medium_mountain: "medium_mountain",
  mountain: "mountain",
  high_mountain: "high_mountain",
  itt: "itt",
  itt_hilly: "itt",
  ttt: "ttt",
  cobbles: "cobbles",
  gravel: "gravel",
});

export const PEEK_GROUPS: readonly PeekGroup[] = Object.freeze([
  "high_mountain", "mountain", "medium_mountain", "itt", "ttt", "cobbles", "gravel", "hilly", "rolling", "flat",
]);

// De grupper der AFGØR et løb (samlet eller på dagen). Rækkefølgen er visnings-
// rækkefølgen: de hårdeste bjerge først, så tidskørsel, så underlag.
const DECIDING_GROUPS: readonly PeekGroup[] = Object.freeze(["high_mountain", "mountain", "medium_mountain", "itt", "ttt", "cobbles", "gravel"]);
// Uden nogen af dem afgøres løbet af det terræn der er mest af.
const FALLBACK_GROUPS: readonly PeekGroup[] = Object.freeze(["hilly", "rolling", "flat"]);

export function profileGroup(profileType: string | null | undefined): PeekGroup {
  return (profileType && GROUP_BY_PROFILE[profileType]) || "flat";
}

// Kalenderens wire-svar bærer kun terræn-bucketen pr. etape (raceCalendar.js).
// Bruges når profilerne ikke kan hentes, så kortet aldrig står tomt.
const GROUP_BY_BUCKET: Readonly<Record<string, PeekGroup>> = Object.freeze({ sprint: "flat", cobbles: "cobbles", hilly: "hilly", mountain: "mountain", itt: "itt", ttt: "ttt" });
export function bucketGroup(bucket: string | null | undefined): PeekGroup {
  return (bucket && GROUP_BY_BUCKET[bucket]) || "flat";
}

// Farve pr. gruppe: appens kategoriske chart-tokens (index.css, --cz-chart-N),
// aldrig rå hex og aldrig guld (guld er rationeret, TASTE P3).
const GROUP_TOKEN: Readonly<Record<PeekGroup, number>> = Object.freeze({
  flat: 3, // grøn
  rolling: 6, // cyan
  hilly: 4, // rav
  medium_mountain: 7, // pink
  mountain: 5, // rød
  high_mountain: 2, // violet
  itt: 1, // blå
  ttt: 1,
  cobbles: 9, // skifer
  gravel: 9,
});
export function groupColor(group: PeekGroup): string {
  return `rgb(var(--cz-chart-${GROUP_TOKEN[group] ?? 9}))`;
}

/** Etapestrimlen: én blok pr. etape, sorteret på etapenummer. */
export function stripSegments(profiles: readonly StageProfileLike[] | null | undefined = []): StripSegment[] {
  return (profiles || [])
    .filter((p) => p && Number.isFinite(Number(p.stage_number)))
    .slice()
    .sort((a, b) => Number(a.stage_number) - Number(b.stage_number))
    .map((p) => ({ stage: Number(p.stage_number), profileType: p.profile_type ?? null, group: profileGroup(p.profile_type) }));
}

/**
 * "Afgøres i": de afgørende grupper med antal etaper, hårdeste først.
 * Fx [{group:"high_mountain",count:4},{group:"itt",count:2}].
 * Uden bjerg/tidskørsel/underlag: den mest udbredte af kuperet/bølget/fladt.
 */
export function decidedIn(groups: readonly PeekGroup[] = [], { max = 2 }: { max?: number } = {}): DecidedGroup[] {
  const counts = new Map<PeekGroup, number>();
  for (const g of groups || []) counts.set(g, (counts.get(g) || 0) + 1);
  const deciding = DECIDING_GROUPS.filter((g) => counts.has(g)).map((g) => ({ group: g, count: counts.get(g) ?? 0 }));
  if (deciding.length) return deciding.slice(0, max);
  let best: DecidedGroup | null = null;
  for (const g of FALLBACK_GROUPS) {
    const c = counts.get(g) || 0;
    if (c > 0 && (!best || c > best.count)) best = { group: g, count: c };
  }
  return best ? [best] : [];
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
  if (!entry?.isMine) return null;
  const range = raceDateRange(entry);
  if (!range || (todayIso && range.start < todayIso)) return null;
  if (entry.entered) return "selected";
  const gt = (entries || []).find((e) => e && e.id !== entry.id && e.isMine && e.entered
    && isGrandTour(e.raceClass) && rangesOverlap(range, raceDateRange(e)));
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
