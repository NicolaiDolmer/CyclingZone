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

// ── Terrængrupper ─────────────────────────────────────────────────────────────
// profile_type → den gruppe kortet taler om. Tidskørsel og kuperet tidskørsel er
// ét "enkeltstart"; klassiker læses som kuperet (blandet terræn med korte stik,
// stageProfileConfig.js). Ukendt type → flat (samme fallback som silhuetterne).
const GROUP_BY_PROFILE = Object.freeze({
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

export const PEEK_GROUPS = Object.freeze([
  "high_mountain", "mountain", "medium_mountain", "itt", "ttt", "cobbles", "gravel", "hilly", "rolling", "flat",
]);

// De grupper der AFGØR et løb (samlet eller på dagen). Rækkefølgen er visnings-
// rækkefølgen: de hårdeste bjerge først, så tidskørsel, så underlag.
const DECIDING_GROUPS = Object.freeze(["high_mountain", "mountain", "medium_mountain", "itt", "ttt", "cobbles", "gravel"]);
// Uden nogen af dem afgøres løbet af det terræn der er mest af.
const FALLBACK_GROUPS = Object.freeze(["hilly", "rolling", "flat"]);

export function profileGroup(profileType) {
  return GROUP_BY_PROFILE[profileType] ?? "flat";
}

// Kalenderens wire-svar bærer kun terræn-bucketen pr. etape (raceCalendar.js).
// Bruges når profilerne ikke kan hentes, så kortet aldrig står tomt.
const GROUP_BY_BUCKET = Object.freeze({ sprint: "flat", cobbles: "cobbles", hilly: "hilly", mountain: "mountain", itt: "itt", ttt: "ttt" });
export function bucketGroup(bucket) {
  return GROUP_BY_BUCKET[bucket] ?? "flat";
}

// Farve pr. gruppe: appens kategoriske chart-tokens (index.css, --cz-chart-N),
// aldrig rå hex og aldrig guld (guld er rationeret, TASTE P3).
const GROUP_TOKEN = Object.freeze({
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
export function groupColor(group) {
  return `rgb(var(--cz-chart-${GROUP_TOKEN[group] ?? 9}))`;
}

/**
 * Etapestrimlen: én blok pr. etape, sorteret på etapenummer.
 * @param {Array<{stage_number:number, profile_type:string}>} profiles
 */
export function stripSegments(profiles = []) {
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
 * @param {string[]} groups  én gruppe pr. etape (profileGroup/bucketGroup)
 */
export function decidedIn(groups = [], { max = 2 } = {}) {
  const counts = new Map();
  for (const g of groups || []) counts.set(g, (counts.get(g) || 0) + 1);
  const deciding = DECIDING_GROUPS.filter((g) => counts.has(g)).map((g) => ({ group: g, count: counts.get(g) }));
  if (deciding.length) return deciding.slice(0, max);
  let best = null;
  for (const g of FALLBACK_GROUPS) {
    const c = counts.get(g) || 0;
    if (c > 0 && (!best || c > best.count)) best = { group: g, count: c };
  }
  return best ? [best] : [];
}

// ── Datoer ───────────────────────────────────────────────────────────────────

/** Løbets første og sidste etapedato ("YYYY-MM-DD"), eller null. */
export function raceDateRange(entry) {
  const dates = (entry?.stageSchedule || []).map((s) => s?.date).filter(Boolean).sort();
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  if (entry?.date) return { start: entry.date, end: entry.date };
  return null;
}

function rangesOverlap(a, b) {
  return Boolean(a && b) && a.start <= b.end && b.start <= a.end;
}

const GRAND_TOUR_CLASSES = new Set(["TourFrance", "GiroVuelta"]);
export function isGrandTour(raceClass) {
  return GRAND_TOUR_CLASSES.has(raceClass);
}

// ── Min status ────────────────────────────────────────────────────────────────

/**
 * Holdets status for ét løb i kalenderen. null = ingen status at vise (ikke
 * holdets løb, eller løbet er begyndt/kørt, hvor udtagelsen er låst).
 *   "selected" — holdet har en gemt udtagelse
 *   "gtBound"  — ingen udtagelse, men holdets Grand Tour kører samtidig
 *   "missing"  — ingen udtagelse endnu (status-prikken)
 * @param {object} entry     kalender-entry (isMine, entered, raceClass, stageSchedule|date)
 * @param {object[]} entries hele kalenderens entries (til GT-opslaget)
 * @param {string} todayIso  dansk dato "YYYY-MM-DD"
 */
export function myRaceStatus(entry, entries = [], todayIso = "") {
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
 *
 * @param {{demandVector: object|null, riders: object[], size?: number}} input
 * @returns {{score:number, best:{id:string,name:string,score:number}, counted:number}|null}
 */
export function teamFit({ demandVector, riders = [], size = 0 } = {}) {
  if (!demandVector || typeof demandVector !== "object") return null;
  const scored = (riders || [])
    .filter((r) => r && r.abilities && !r.injured && !r.outgoing)
    .map((r) => ({ id: r.id, name: r.name, score: riderSuitability(r.abilities, demandVector).score }))
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
 * @param {string} startIso  løbets første etapedato
 * @param {Array<{date:string}>} days  kalenderens days[] (alle puljer)
 */
export function selectionDayOrdinal(startIso, days = []) {
  const first = (days || []).map((d) => d?.date).filter(Boolean).sort()[0];
  if (!startIso || !first) return null;
  const toDay = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  const n = toDay(startIso) - toDay(first) + 1;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function selectionHref(startIso, days) {
  const day = selectionDayOrdinal(startIso, days);
  return day != null ? `/planning?tab=selection&day=${day}` : "/planning?tab=selection";
}
