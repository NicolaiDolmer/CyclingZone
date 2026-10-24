// backend/lib/stageOrderVariationGate.js
//
// #2757 (ejer-beslutning 24/10, "Ja, test + varier i dag"): gaten for variation i etape-
// rækkefølgen på tværs af en sæsons etapeløb. Ingen gate målte den før: generatoren byggede
// kuperede etapeløb med fast stigende rækkefølge (crescendo), så mange ruter fik samme skabelon.
//
// Gaten måler tre ting på sæsonens ruter (én pr. division og katalog-løb, Grand Tours udeladt):
//   1. andelen af ruter med fast stigende rækkefølge (crescendo, se isAscendingOrder),
//   2. andelen af ruter med præcis samme etapetype-rækkefølge, pr. etapeantal, og hvor mange
//      forskellige rækkefølger sæsonen har i alt,
//   3. etapetypernes fordeling pr. placering (første, tidlig, midt, sen, sidste) sammenlignet med
//      rigtige en-uges-etapeløb (afstand = gennemsnitlig total variation over placeringerne).
// Båndene er balance og står privat (balance-internals/2757-a2/, hard rule 17); de gives altid
// som parameter. Referencen er den offentlige optælling i docs/research/2026-08-04-stage-race-structure/.

/**
 * Etapetypen i referencens grove klasser (Wikipedia-typerne i researchen): flad (flat, rolling),
 * kuperet (hilly, brosten, grus, klassiker og mellembjerg, som researchen også lægger under
 * kuperet), bjerg og tidskørsel.
 */
export const COARSE_STAGE_CLASS = Object.freeze({
  flat: "flat", rolling: "flat",
  hilly: "hilly", cobbles: "hilly", gravel: "hilly", classic: "hilly", medium_mountain: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  itt: "tt", itt_hilly: "tt", ttt: "tt", prologue: "tt",
});
const COARSE_HARDNESS = Object.freeze({ flat: 1, hilly: 2, mountain: 3 });

/** @param {string} type */
export const coarseClassOf = (type) => /** @type {Record<string, string>} */ (COARSE_STAGE_CLASS)[type] ?? "hilly";

/**
 * Placerings-kassen for etape `index` (0-baseret) i et løb med `n` etaper (samme kasser som
 * A2's placering af flade etaper).
 * @param {number} index @param {number} n
 * @returns {"first"|"early"|"middle"|"late"|"last"}
 */
export function positionBucket(index, n) {
  if (index <= 0) return "first";
  if (index >= n - 1) return "last";
  const r = index / (n - 1);
  return r < 1 / 3 ? "early" : r < 2 / 3 ? "middle" : "late";
}
export const POSITION_BUCKETS = Object.freeze(["first", "early", "middle", "late", "last"]);

/**
 * Rigtige en-uges WorldTour-etapeløb 2024-2026 (n=32, Grand Tours udeladt): antal etaper af
 * hver grov klasse pr. placering, og hvor mange løb der har fast stigende rækkefølge. Talt med
 * isAscendingOrder og positionBucket på docs/research/2026-08-04-stage-race-structure/ (offentlig
 * kilde, samme datasæt som A2's placeringsvægte).
 */
export const REAL_STAGE_RACES = Object.freeze({
  races: 32,
  ascending: 12,
  positions: Object.freeze({
    first: Object.freeze({ flat: 9, hilly: 15, mountain: 1, tt: 7 }),
    early: Object.freeze({ flat: 7, hilly: 20, mountain: 4, tt: 9 }),
    middle: Object.freeze({ flat: 9, hilly: 28, mountain: 17, tt: 3 }),
    late: Object.freeze({ flat: 8, hilly: 17, mountain: 26, tt: 1 }),
    last: Object.freeze({ flat: 6, hilly: 12, mountain: 9, tt: 5 }),
  }),
});

/**
 * Fast stigende rækkefølge (crescendo-skabelonen): vejetaperne før sidste etape (tidskørsler
 * tæller ikke) bliver aldrig lettere i de grove klasser, og der er mindst to klasser. Sidste
 * etape er finalen (fri). Kræver mindst tre vejetaper før finalen, ellers er en rækkefølge ikke
 * en skabelon.
 * @param {string[]} types  etapetyperne i rækkefølge
 */
export function isAscendingOrder(types) {
  const road = types.slice(0, -1).map(coarseClassOf).filter((c) => c !== "tt")
    .map((c) => /** @type {Record<string, number>} */ (COARSE_HARDNESS)[c]);
  if (road.length < 3 || new Set(road).size < 2) return false;
  for (let i = 1; i < road.length; i++) if (road[i] < road[i - 1]) return false;
  return true;
}

/**
 * Gatens mål for et sæt ruter.
 * @param {Array<{ key: string, types: string[] }>} routes  én pr. rute (division + katalog-løb)
 * @param {{ minRoutesPerStageCount?: number }} [opts]
 */
export function measureOrderVariation(routes, { minRoutesPerStageCount = 1 } = {}) {
  const list = routes.filter((r) => Array.isArray(r.types) && r.types.length >= 2);
  const ascending = list.filter((r) => isAscendingOrder(r.types));
  const seqs = new Map();
  for (const r of list) {
    const k = r.types.join(",");
    if (!seqs.has(k)) seqs.set(k, []);
    seqs.get(k).push(r.key);
  }
  /** @type {Array<{ stages: number, routes: number, maxIdentical: number, share: number, sequence: string }>} */
  const byStageCount = [];
  const counts = new Map();
  for (const r of list) counts.set(r.types.length, (counts.get(r.types.length) ?? 0) + 1);
  for (const [stages, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (n < minRoutesPerStageCount) continue;
    let max = 0;
    let sequence = "";
    for (const [k, keys] of seqs) {
      if (k.split(",").length !== stages) continue;
      if (keys.length > max) { max = keys.length; sequence = k; }
    }
    byStageCount.push({ stages, routes: n, maxIdentical: max, share: max / n, sequence });
  }
  const positions = Object.fromEntries(POSITION_BUCKETS.map((b) => [b, { flat: 0, hilly: 0, mountain: 0, tt: 0 }]));
  for (const r of list) {
    r.types.forEach((t, i) => { /** @type {any} */ (positions)[positionBucket(i, r.types.length)][coarseClassOf(t)] += 1; });
  }
  return {
    routes: list.length,
    ascending: ascending.length,
    ascendingShare: list.length ? ascending.length / list.length : 0,
    ascendingKeys: ascending.map((r) => r.key),
    distinct: seqs.size,
    distinctShare: list.length ? seqs.size / list.length : 1,
    byStageCount,
    positions,
    positionDistance: positionDistance(positions, REAL_STAGE_RACES.positions),
  };
}

/**
 * Gennemsnitlig total variation (0 = samme fordeling, 1 = ingen overlap) mellem to fordelinger
 * af grove klasser pr. placering.
 * @param {Record<string, Record<string, number>>} a @param {Record<string, Record<string, number>>} b
 */
export function positionDistance(a, b) {
  let sum = 0;
  for (const bucket of POSITION_BUCKETS) {
    const pa = a[bucket] ?? {};
    const pb = b[bucket] ?? {};
    const ta = Object.values(pa).reduce((s, x) => s + x, 0) || 1;
    const tb = Object.values(pb).reduce((s, x) => s + x, 0) || 1;
    const classes = new Set([...Object.keys(pa), ...Object.keys(pb)]);
    let tv = 0;
    for (const c of classes) tv += Math.abs((pa[c] ?? 0) / ta - (pb[c] ?? 0) / tb);
    sum += tv / 2;
  }
  return sum / POSITION_BUCKETS.length;
}

/**
 * Båndene (private) skal være til stede og være tal; ellers kastes der (fail-closed).
 * @param {any} bands
 */
export function assertOrderVariationBands(bands) {
  for (const k of ["ascendingShareMax", "identicalShareMax", "identicalCountFloor", "distinctShareMin", "positionDistanceMax", "minRoutesPerStageCount"]) {
    if (typeof bands?.[k] !== "number" || !Number.isFinite(bands[k])) throw new Error(`order-variation band "${k}" is missing or not a number (#2757)`);
  }
  return bands;
}

/**
 * Gaten: brud som tekst (tom liste = grøn).
 * @param {ReturnType<typeof measureOrderVariation>} m
 * @param {{ ascendingShareMax: number, identicalShareMax: number, identicalCountFloor: number, distinctShareMin: number, positionDistanceMax: number, minRoutesPerStageCount: number }} bands
 *   identicalCountFloor: så mange ruter med samme rækkefølge er altid tilladt (rigtige løb har også par).
 */
export function detectOrderVariationViolations(m, bands) {
  assertOrderVariationBands(bands);
  const out = [];
  const pct = (x) => `${(100 * x).toFixed(0)} %`;
  if (m.ascendingShare > bands.ascendingShareMax) out.push(`ascending template order: ${m.ascending} of ${m.routes} routes (${pct(m.ascendingShare)})`);
  for (const s of m.byStageCount) {
    if (s.routes < bands.minRoutesPerStageCount || s.maxIdentical <= bands.identicalCountFloor) continue;
    if (s.share > bands.identicalShareMax) out.push(`${s.stages} stages: ${s.maxIdentical} of ${s.routes} routes share the order ${s.sequence}`);
  }
  if (m.distinctShare < bands.distinctShareMin) out.push(`only ${m.distinct} distinct orders across ${m.routes} routes`);
  if (m.positionDistance > bands.positionDistanceMax) out.push(`stage types per position differ from real stage races (distance ${m.positionDistance.toFixed(3)})`);
  return out;
}
