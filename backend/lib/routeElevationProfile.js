// backend/lib/routeElevationProfile.js
// #6594: højdeprofil pr. etape — én højde pr. 0,5 km, der summerer PRÆCIST til etapens
// elevation_gain_m. Spec (ejer-go 14/10): docs/superpowers/specs/2026-10-14-6594-hoejdeprofil-design.md
//
// HVORFOR. elevation_gain_m og stigningerne var to kilder: en del af tallet (S5: vejens bølgen,
// #6366) havde ingen placering på ruten, så ingen flade kunne tegne den. Serien giver den en
// placering, og testen håndhæver ÉN kilde: Σ max(0, h[i+1] − h[i]) === elevation_gain_m.
//
// REN + DETERMINISTISK. buildElevationProfile(route, seedKey) læser kun etapens egne felter
// (distance_km, elevation_gain_m, climbs, sprints, segments, profile_type, finale_type) og
// bruger sin EGEN rng-strøm (":elevation:", samme mønster som ":segments:"/":weather:" i
// routeSegments.js). Den forbruger intet fra pass 1, ":route:" eller ":segments:", så alle
// eksisterende felter er bit-identiske med generatoren uden serien. Ingen DB, intet ur.
//
// MOTOREN LÆSER DEN IKKE. Serien gemmes i sin egen kolonne (race_stage_profiles.elevation_profile),
// ikke i `segments`, som motoren læser (engine/v4/adapters/routeAdapter.ts).
//
// Format: { v: 1, step_km, h: [heltal meter, ...] } med h.length === n + 1, h[0] = start,
// h[n] = mål, n = max(1, round(distance_km / 0,5)), step = distance_km / n (dækker [0, D] præcist).
//
// Algoritmen (spec §2), på et gitter af n skridt:
//   1. Stigninger: hver stignings gain (samme formel som elevationGainS5) fordeles på dens skridt
//      efter en udglattet random walk, heltal ved største-rest. Overlappende stigninger lægges
//      OVEN I hinanden (delta += ...), aldrig overskrevet.
//   2. Afslutnings-rampe (uphill_sprint/wall_finish/punch): samme fordeling på de sidste ramp_km.
//   3. Dal + nedkørsler: efter en top falder vejen mod dalen, aldrig under den. Nedkørsels-
//      finalen falder fra sidste top helt til mål (ikke-stigende), uden bølger.
//   4. Vejens bølgen: resten af budgettet lægges som glatte bakker på frie flad/bølget/brosten-
//      skridt, med et loft pr. skridt (en ukategoriseret bakke over loftet burde være kategoriseret).
//      Heltal fordeles inden for loftet, så INTET ukategoriseret skridt overstiger det.
//   Serien løftes til sidst så min ≥ MIN_ALTITUDE_M (en ren flytning ændrer ikke gain).

import { makeRng } from "./fictionalRiderGenerator.js";
import { seasonSeedSuffix } from "./raceSeedAxis.js";

export const ELEVATION_PROFILE_VERSION = 1;
export const ELEVATION_STEP_KM = 0.5;
// Ukategoriseret vej: maks stigning/fald pr. skridt i %. Op-loftet er hårdt (testet); ned-loftet
// er blødt (bølgernes nedside fordeles inden for det når der er plads).
export const UNCATEGORIZED_MAX_UP_PCT = 6;
export const UNCATEGORIZED_MAX_DOWN_PCT = 9;
export const MIN_ALTITUDE_M = 5;
// Serien bygges kun for generator v6+ (S5); gaten kræver den kun dér.
export const ELEVATION_PROFILE_MIN_GENERATOR_VERSION = 6;

// Dal-niveau (m) pr. terræn: [min, max], seedet. Kun et udgangspunkt for tegningen.
const VALLEY_BAND = Object.freeze({
  flat: [20, 250], rolling: [80, 350], hilly: [150, 500], medium_mountain: [250, 650],
  mountain: [400, 900], high_mountain: [500, 1100], cobbles: [20, 120], gravel: [150, 400],
  classic: [50, 300], itt: [20, 300], itt_hilly: [100, 450], ttt: [20, 200],
});
const DEFAULT_VALLEY_BAND = [100, 400];
const DESCENT_GRADIENT_PCT = [5.0, 8.5];
// Hvor meget bølge en fri strækning bærer pr. underlag.
const BUMP_WEIGHT = Object.freeze({ rolling: 3, flat: 1, cobbles: 0.5 });
const MIN_RUN_STEPS = 3;
// Løft af dalbunden mellem stigningerne når bølge-budgettet ikke har plads (se buildElevationProfile).
const PLATEAU_STEP_M = 50;
const PLATEAU_MAX_STEPS = 40;

// FNV-1a 32-bit (samme lokale mønster som routeSegments.js — ingen krydsimport af hash-funktionen).
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const presentKey = (v) => (typeof v === "string" ? (v.trim() === "" ? null : v) : v ?? null);
function seedIdentityFor(race) {
  return presentKey(race?.external_id) ?? presentKey(race?.pool_race_id) ?? race?.id ?? "adhoc";
}

/** Egen rng-strøm for serien — forstyrrer aldrig pass 1, ":route:" eller ":segments:". */
export function elevationSeedKey(race, stageNumber) {
  return `${String(seedIdentityFor(race))}${seasonSeedSuffix(race)}:elevation:${stageNumber}`;
}

/** Antal skridt for en distance: max(1, round(D / 0,5)). */
export function elevationStepCount(distanceKm) {
  return Math.max(1, Math.round(Number(distanceKm) / ELEVATION_STEP_KM));
}

/** Σ max(0, h[i+1] − h[i]) — seriens højdemeter. */
export function elevationProfileGain(h) {
  let s = 0;
  for (let i = 1; i < h.length; i++) s += Math.max(0, h[i] - h[i - 1]);
  return s;
}

// Samme formel som elevationGainS5 (raceRouteGenerator.js).
const climbGain = (lengthKm, gradientPct) => Math.round((Number(lengthKm) * 1000 * Number(gradientPct)) / 100);

// Heltals-fordeling af `total` efter vægte (største rest; stabil ved lighed).
function largestRemainder(total, weights) {
  const s = weights.reduce((a, b) => a + b, 0);
  if (!(s > 0) || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / s);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]] += 1;
  return out;
}

/**
 * Højdeserien for én etape. Ren funktion.
 * @param {{ distance_km: number, elevation_gain_m: number, profile_type?: string, finale_type?: string|null,
 *   climbs?: Array<{ crest_km: number, length_km: number, avg_gradient: number }>,
 *   sprints?: Array<{ kind: string, ramp_km?: number, ramp_gradient?: number }>,
 *   segments?: Array<{ kind: string, from_km: number, to_km: number }> }} route
 * @param {string} seedKey  elevationSeedKey(race, stageNumber)
 * @returns {{ v: number, step_km: number, h: number[] } | null}  null hvis distancen mangler
 */
export function buildElevationProfile(route, seedKey) {
  if (!(Number(route?.distance_km) > 0)) return null;
  // Er der ikke plads til hele bølge-budgettet inden for loftet (lange nedkørsler æder de frie
  // strækninger på højbjergetaper), bygges serien igen med dalbunden mellem stigningerne løftet
  // et trin: nedkørslerne bliver kortere og efterlader flere frie skridt. Hvert forsøg starter
  // forfra på samme rng-strøm, så resultatet er deterministisk.
  let built = buildAttempt(route, seedKey, 0);
  for (let k = 1; built.rest !== 0 && k <= PLATEAU_MAX_STEPS; k++) built = buildAttempt(route, seedKey, k * PLATEAU_STEP_M);
  return built.profile;
}

/**
 * @param {any} route @param {string} seedKey
 * @param {number} plateau  m over dalen hvor nedkørsler mellem stigningerne stopper
 * @returns {{ profile: { v: number, step_km: number, h: number[] }, rest: number }}  rest = gain der ikke fik plads
 */
function buildAttempt(route, seedKey, plateau) {
  const D = Number(route.distance_km);
  const rng = makeRng(stableSeed(String(seedKey)));
  const n = elevationStepCount(D);
  const step = D / n;
  const target = Math.max(0, Math.round(Number(route.elevation_gain_m) || 0));
  const capUp = Math.floor(UNCATEGORIZED_MAX_UP_PCT * step * 10 + 1e-9); // m pr. skridt
  const capDn = Math.floor(UNCATEGORIZED_MAX_DOWN_PCT * step * 10 + 1e-9);
  const segs = Array.isArray(route.segments) ? route.segments : [];
  const climbs = Array.isArray(route.climbs) ? route.climbs : [];
  const mid = (i) => (i + 0.5) * step;
  const kindAt = (km) => {
    const s = segs.find((x) => km >= Number(x.from_km) && km < Number(x.to_km)) ?? segs[segs.length - 1];
    return s?.kind ?? "flat";
  };
  const [vlo, vhi] = VALLEY_BAND[route.profile_type] ?? DEFAULT_VALLEY_BAND;
  let valley = vlo + rng() * (vhi - vlo);

  /** @type {string[]} */
  const role = new Array(n);
  const delta = new Array(n).fill(0);
  for (let i = 0; i < n; i++) role[i] = kindAt(mid(i));

  // 1) Stigninger. Lagdelt: delta += (overlappende stigninger summeres, intet overskrives).
  let fixedGain = 0;
  for (const c of climbs) {
    const crest = Number(c.crest_km);
    const foot = crest - Number(c.length_km);
    const idx = [];
    for (let i = 0; i < n; i++) if (mid(i) > foot && mid(i) <= crest + 1e-9) idx.push(i);
    if (!idx.length) idx.push(Math.min(n - 1, Math.max(0, Math.ceil(crest / step) - 1)));
    const g = Math.max(0, climbGain(c.length_km, c.avg_gradient));
    const sd = 0.18 + 0.12 * rng();
    let walk = 0;
    const w = idx.map(() => {
      walk = 0.6 * walk + (rng() - 0.5) * 2 * sd;
      return Math.max(0.15, 1 + walk);
    });
    const parts = largestRemainder(g, w);
    idx.forEach((i, k) => { role[i] = "climb"; delta[i] += parts[k]; });
    fixedGain += g;
  }

  // 2) Afslutnings-rampe.
  const fin = (Array.isArray(route.sprints) ? route.sprints : []).find((s) => s?.kind === "finish" && Number(s.ramp_km) > 0);
  if (fin) {
    const k = Math.min(n, Math.max(1, Math.round(Number(fin.ramp_km) / step)));
    const g = Math.max(0, climbGain(fin.ramp_km, fin.ramp_gradient));
    const idx = [];
    for (let i = n - k; i < n; i++) idx.push(i);
    const parts = largestRemainder(g, idx.map(() => 1));
    idx.forEach((i, j) => { role[i] = "ramp"; delta[i] += parts[j]; });
    fixedGain += g;
  }

  // 3) Dal + nedkørsler. Nedkørsels-finalen: fra sidste top falder vejen mod et lavere gulv
  //    og bølger ikke (sidste top → mål er ikke-stigende).
  const lastCrest = climbs.length ? Math.max(...climbs.map((c) => Number(c.crest_km))) : null;
  const descentFinale = route.finale_type === "descent" && lastCrest != null;
  const finaleFloor = Math.max(MIN_ALTITUDE_M, vlo * 0.5);
  const start = Math.round(valley);
  let alt = start;
  // Vejen falder kun efter en top (en stigning eller rampe), ikke fordi dalen driver.
  let descending = false;
  for (let i = 0; i < n; i++) {
    if (role[i] === "climb" || role[i] === "ramp") { alt += delta[i]; descending = true; continue; }
    const inFinale = descentFinale && mid(i) > lastCrest;
    if (inFinale) role[i] = "descent_finale";
    const floor = inFinale ? Math.min(valley, finaleFloor) : valley + plateau;
    if (descending && alt <= floor + 1) descending = false;
    // Et nedkørsels-segment der allerede har nået dalbunden er dalvej, og bølger som flad vej.
    if (!descending && role[i] === "descent") role[i] = "flat";
    if (descending) {
      const grad = DESCENT_GRADIENT_PCT[0] + rng() * (DESCENT_GRADIENT_PCT[1] - DESCENT_GRADIENT_PCT[0]);
      const drop = Math.min(Math.round(grad * 10 * step), Math.round(alt - floor));
      if (drop > 0) {
        delta[i] = -drop;
        alt -= drop;
        if (!inFinale) role[i] = "down";
      }
    }
    valley = Math.max(vlo * 0.5, valley + (rng() - 0.5) * 6);
  }

  // 4) Vejens bølgen på frie strækninger.
  const budget = target - fixedGain;
  // Negativt budget (kun tænkeligt på håndredigerede rækker) kan ingen omplacering rette.
  let rest = Math.max(0, budget);
  const free = [];
  for (let i = 0; i < n; i++) if (BUMP_WEIGHT[role[i]] && delta[i] === 0) free.push(i);
  const runs = [];
  if (free.length) {
    let cur = [free[0]];
    for (let k = 1; k < free.length; k++) {
      if (free[k] === free[k - 1] + 1) cur.push(free[k]);
      else { runs.push(cur); cur = [free[k]]; }
    }
    runs.push(cur);
  }
  const waves = [0, 1, 2].map(() => ({ lam: 4 + rng() * 10, ph: rng() * 2 * Math.PI, a: 0.5 + rng() }));
  const useRuns = runs.filter((r) => r.length >= MIN_RUN_STEPS);
  if (budget > 0 && useRuns.length) {
    // Glat bølge pr. strækning: 3 sinusser, vinduet til 0 i begge ender, så strækningen starter
    // og slutter i samme højde som naboerne. D0 = bølgens deltaer pr. skridt (summerer til 0).
    const D0 = useRuns.map((r) => {
      const m = r.length;
      const scale = Math.min(1, (m * step) / 25);
      const u = [0];
      for (let j = 1; j < m; j++) {
        const km = (r[0] + j) * step;
        const wnd = Math.sin((Math.PI * j) / m);
        const w = BUMP_WEIGHT[role[r[j]]] ?? 1;
        u.push(scale * wnd * w * waves.reduce((s, q) => s + q.a * (0.35 + Math.sin((2 * Math.PI * km) / q.lam + q.ph)), 0));
      }
      u.push(0);
      return u.slice(1).map((v, j) => v - u[j]);
    });
    // En strækning kan højst stige det den kan falde igen inden for ned-loftet.
    const runCap = D0.map((d) => d.filter((x) => x < 0).length * capDn);
    const runPos = (d, k, f) => Math.min(runCap[k], d.reduce((a, x) => a + (x > 0 ? Math.min(f * x, capUp) : 0), 0));
    const posAt = (f) => D0.reduce((s, d, k) => s + runPos(d, k, f), 0);
    // Skalering med loft (vandfyldning): f findes ved bisektion så Σ op = budget.
    let lo = 0;
    let hi = 1;
    while (posAt(hi) < budget && hi < 1e12) hi *= 2;
    for (let it = 0; it < 80; it++) {
      const f = (lo + hi) / 2;
      if (posAt(f) < budget) lo = f; else hi = f;
    }
    // Heltal inden for begge lofter: gulv, og resten til største brøkdele der har plads.
    const cells = [];
    D0.forEach((d, k) => {
      const raw = d.reduce((a, x) => a + (x > 0 ? Math.min(hi * x, capUp) : 0), 0);
      const s = raw > 0 ? runPos(d, k, hi) / raw : 0;
      d.forEach((x, j) => { if (x > 0) cells.push({ k, j, v: s * Math.min(hi * x, capUp) }); });
    });
    const ints = cells.map((c) => Math.min(capUp, Math.floor(c.v)));
    const runSum = runCap.map(() => 0);
    cells.forEach((c, q) => { runSum[c.k] += ints[q]; });
    const room = (q) => ints[q] < capUp && runSum[cells[q].k] < runCap[cells[q].k];
    const bump = (q, by) => { ints[q] += by; runSum[cells[q].k] += by; rest -= by; };
    rest = budget - ints.reduce((a, b) => a + b, 0);
    const byFrac = cells.map((c, q) => [c.v - Math.floor(c.v), q]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, q] of byFrac) { if (rest <= 0) break; if (room(q)) bump(q, 1); }
    for (let q = 0; rest > 0 && q < ints.length; q++) {
      if (room(q)) bump(q, Math.min(rest, capUp - ints[q], runCap[cells[q].k] - runSum[cells[q].k]));
    }
    for (let q = ints.length - 1; rest < 0 && q >= 0; q--) bump(q, -Math.min(-rest, ints[q]));
    const pos = D0.map((d) => d.map(() => 0));
    cells.forEach((c, q) => { pos[c.k][c.j] = ints[q]; });
    // Nedsiden pr. strækning: samme meter ned som op (strækningen slutter hvor den startede),
    // fordelt efter bølgens fald inden for ned-loftet når der er plads.
    D0.forEach((d, k) => {
      const up = pos[k].reduce((a, b) => a + b, 0);
      const negIdx = [];
      d.forEach((x, j) => { if (x < 0) negIdx.push(j); });
      if (!up || !negIdx.length) return;
      const dn = largestRemainder(up, negIdx.map((j) => -d[j]));
      for (let guard = 0; guard < 10000; guard++) {
        const over = dn.findIndex((v) => v > capDn);
        if (over === -1) break;
        let room = -1;
        for (let q = 0; q < dn.length; q++) if (dn[q] < capDn && (room === -1 || dn[q] < dn[room])) room = q;
        if (room === -1) break;
        dn[over] -= 1;
        dn[room] += 1;
      }
      negIdx.forEach((j, q) => { pos[k][j] = -dn[q]; });
    });
    useRuns.forEach((run, k) => run.forEach((i, j) => { delta[i] += pos[k][j]; }));
  }

  const h = [start];
  for (let i = 0; i < n; i++) h.push(h[i] + delta[i]);
  const lift = Math.max(0, MIN_ALTITUDE_M - Math.min(...h));
  if (lift) for (let i = 0; i < h.length; i++) h[i] += lift;
  return { profile: { v: ELEVATION_PROFILE_VERSION, step_km: Math.round(step * 1000) / 1000, h }, rest };
}

/**
 * Validering af en gemt/genereret serie mod etapens felter (benchmark-gaten bruger den).
 * @param {{ distance_km: number, elevation_gain_m: number, elevation_profile?: any }} stage
 * @returns {string|null}  null = i orden, ellers en kort beskrivelse af bruddet
 */
export function checkElevationProfile(stage) {
  const p = stage?.elevation_profile;
  if (!p || !Array.isArray(p.h)) return "højdeprofil mangler";
  const n = elevationStepCount(stage.distance_km);
  if (p.h.length !== n + 1) return `højdeprofil har ${p.h.length} punkter, forventet ${n + 1}`;
  if (!p.h.every((v) => Number.isInteger(v))) return "højdeprofil har ikke-heltal";
  if (p.h.some((v) => v < 0)) return "højdeprofil har negativ højde";
  const gain = elevationProfileGain(p.h);
  if (gain !== Number(stage.elevation_gain_m)) return `højdeprofilens sum ${gain} m ≠ elevation_gain_m ${stage.elevation_gain_m} m`;
  return null;
}
