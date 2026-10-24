// #3564 trin 1 / #6110: kvantil-remap af potentiale 1-6 -> 1-99 som genbrugelig kerne.
//
// Trukket ud af remapDryRun3564.mjs (uændret logik), så remap-dry-runnet og
// potentiale-skøn-harnessen (#6110) regner på PRÆCIS samme omregning.
// Ren funktion: ingen DB, ingen fil-I/O. Input er levende ryttere med
// { id, potentiale, age }.

import { pathToFileURL } from "node:url";
import path from "node:path";

const BACKEND_LIB = path.join(import.meta.dirname, "../../../lib");
const { POTENTIALE_TIERS, POTENTIALE_DECAY } = await import(pathToFileURL(`${BACKEND_LIB}/academyGenerator.js`).href);
const { seededUnit } = await import(pathToFileURL(`${BACKEND_LIB}/riderProgression.js`).href);

export { POTENTIALE_TIERS, POTENTIALE_DECAY };

// ── 1) Målfordeling: træk-geometrien oversat til 1-99 ───────────────────────
// tier k (k=0..10) center v_k = round(1 + k*9.8), masse spredt uniformt over
// [v_k-4.9, v_k+4.9] klippet til [1,99]. Vægt pr. tier = POTENTIALE_DECAY^k
// (samme geometri som drawPotentiale — ikke gentunet her).
const K = POTENTIALE_TIERS.length; // 11
// EKSAKTE centre (1 + k·9,8) til intervaller/CDF — afrunding her forskød
// intervallerne op til ±0,4 point og fejl-flaggede ~4 % af midter-tiers som
// tier-skift (epsilon-artefakt fundet ved variant b-kørslen 9/8). Kun
// DISPLAY-tabellen (target_geometry) bruger afrundede centre.
export const centersExact = POTENTIALE_TIERS.map((_, k) => 1 + k * 9.8);
export const centers = centersExact.map((c) => Math.round(c));
const weightsRaw = POTENTIALE_TIERS.map((_, k) => POTENTIALE_DECAY ** k);
const weightSum = weightsRaw.reduce((a, b) => a + b, 0);
export const weights = weightsRaw.map((w) => w / weightSum);
export const intervals = centersExact.map((c) => [Math.max(1, c - 4.9), Math.min(99, c + 4.9)]);

// potentiale (1-6, continuous) -> "tier center på 1-99-skalaen" (ANKER, ikke
// spredt) — bruges til manager-diffens "hvad ville uændret placering have
// været" reference. Lineær inversion af v_k=1+9.8k, k=(pot-1)/0.5*... se §6.
export function potentialeToCenter99(pot) {
  const p = Math.max(1, Math.min(6, Number(pot)));
  const k = (p - 1) / 0.5; // 0..10 (kan være brøk for evt. off-grid værdier)
  return 1 + k * 9.8;
}

// 1-99 (evt. brøk) -> potentiale-ækvivalent på 1-6-skalaen (nøjagtig invers af
// centerformlen). Bruges til at fodre v4-modellen (buildCapsForRider /
// predictBaseValueV4), som er skrevet mod 1-6-skalaen og allerede lineært
// interpolerer kontinuert (youthLoftForPotential/youthRateForPotential).
export function pot99ToTierEquivalent(v) {
  const x = Math.max(1, Math.min(99, Number(v)));
  return Math.max(1, Math.min(6, 1 + (x - 1) / 19.6));
}

// Tæt numerisk tæthed/CDF af mål-mixturen (opløsning 0.02 point, 1..99).
const STEP = 0.02;
const N_STEPS = Math.round((99 - 1) / STEP) + 1;
const xs = new Array(N_STEPS);
const density = new Array(N_STEPS).fill(0);
for (let i = 0; i < N_STEPS; i++) xs[i] = 1 + i * STEP;
for (let k = 0; k < K; k++) {
  const [lo, hi] = intervals[k];
  const w = hi - lo;
  if (w <= 0) continue;
  const dens = weights[k] / w;
  const i0 = Math.max(0, Math.ceil((lo - 1) / STEP));
  const i1 = Math.min(N_STEPS - 1, Math.floor((hi - 1) / STEP));
  for (let i = i0; i <= i1; i++) density[i] += dens;
}
const cdf = new Array(N_STEPS);
{
  let acc = 0;
  for (let i = 0; i < N_STEPS; i++) {
    acc += density[i] * STEP;
    cdf[i] = acc;
  }
  const total = cdf[N_STEPS - 1];
  for (let i = 0; i < N_STEPS; i++) cdf[i] /= total; // normalisér til [0,1]
}

// F(x): andel af målmassen <= x (bruges til bånd-fordeling af MÅLET).
export function targetCdfAt(x) {
  const xc = Math.max(1, Math.min(99, x));
  const idx = Math.min(N_STEPS - 1, Math.max(0, Math.round((xc - 1) / STEP)));
  return cdf[idx];
}

// F_inv(q): binær søgning i den monotont voksende cdf-array.
export function inverseCdf(q) {
  const qc = Math.max(0, Math.min(1, q));
  let lo = 0, hi = N_STEPS - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < qc) lo = mid + 1; else hi = mid;
  }
  return xs[lo];
}

// ── 2) Aldersbånd ────────────────────────────────────────────────────────────
export const AGE_BANDS = [
  { key: "16-17", lo: 16, hi: 17 },
  { key: "18-19", lo: 18, hi: 19 },
  { key: "20-21", lo: 20, hi: 21 },
  { key: "22-25", lo: 22, hi: 25 },
  { key: "26-30", lo: 26, hi: 30 },
  { key: "31+", lo: 31, hi: 999 },
];
export function bandOf(age) {
  return AGE_BANDS.find((b) => age >= b.lo && age <= b.hi)?.key ?? "31+";
}

// ── 3) Stratificeret rang-bevarende kvantil-remap ──────────────────────────
// variant "a" = bogstavelig (afvist 9/8), "b" = hale-korrigeret m. fredningsgulve (valgt).
// Returnerer { remapById: Map<id, {newPot99, oldPot, band}>, rankViolations: [] }.
export function remapPotentiale(riders, variant = "b") {
  const VARIANT = String(variant).toLowerCase();
  if (!["a", "b"].includes(VARIANT)) throw new Error(`Ukendt remap-variant '${variant}' - brug a eller b`);
  // Rang-ordnet uniform spredning over (lo, hi]: (i+0,5)/n-kvantiler, afrundet.
  const byPotThenHash = (a, b) => (a.potentiale - b.potentiale) || (seededUnit(a.id) - seededUnit(b.id));
  // Rang-ordnet uniform spredning over (lo, hi]: (i+0,5)/n-kvantiler, afrundet.
  const spreadInto = (sorted, lo, hi, assign) => {
    const n = sorted.length;
    sorted.forEach((r, i) => {
      const x = lo + ((i + 0.5) / n) * (hi - lo);
      assign(r, Math.max(1, Math.min(99, Math.round(x))));
    });
  };
  
  const remapById = new Map(); // id -> { newPot99, oldPot, band }
  for (const band of AGE_BANDS) {
    const group = riders.filter((r) => bandOf(r.age) === band.key);
    const nBand = group.length;
    const set = (r, newPot99) => remapById.set(r.id, { newPot99, oldPot: r.potentiale, band: band.key });
  
    if (VARIANT === "a") {
      const sorted = [...group].sort(byPotThenHash);
      sorted.forEach((r, rank) => {
        const q = (rank + 0.5) / nBand;
        set(r, Math.max(1, Math.min(99, Math.round(inverseCdf(q)))));
      });
      continue;
    }
  
    // VARIANT B — hale-korrigeret (ejer-valgt 9/8 aften):
    // 1) tiers 1,0-4,0 (k=0..6): form-bevarende — spred hver tiers ryttere
    //    rang-ordnet over tierens EGET 1-99-interval [v_k-4,9, v_k+4,9].
    for (let k = 0; k <= 6; k++) {
      const tierPot = POTENTIALE_TIERS[k];
      const inTier = group.filter((r) => r.potentiale === tierPot).sort(byPotThenHash);
      if (!inTier.length) continue;
      const [lo, hi] = intervals[k];
      spreadInto(inTier, lo, hi, set);
    }
    // 2) ≥4,5-klassen: planens hale-ankre pr. aldersbånd (masser fra SAMME mål-CDF).
    const high = group.filter((r) => r.potentiale >= 4.5).sort(byPotThenHash);
    const nHigh = high.length;
    if (nHigh) {
      const pGe = (x) => 1 - targetCdfAt(x - 1e-9);
      let c74 = Math.min(nHigh, Math.round(nBand * pGe(74.5))); // planens "5,0+"-masse
      let c84 = Math.min(c74, Math.round(nBand * pGe(84.3)));   // "5,5+"
      let c94 = Math.min(c84, Math.round(nBand * pGe(94.1)));   // "6,0"
      const seg = [
        { n: nHigh - c74, lo: intervals[7][0], hi: 74.5 }, // blob: "4,5-ækvivalent" (64,7-74,5)
        { n: c74 - c84, lo: 74.5, hi: 84.3 },
        { n: c84 - c94, lo: 84.3, hi: 94.1 },
        { n: c94, lo: 94.1, hi: 99 },
      ];
      let cursor = 0;
      for (const s of seg) {
        if (s.n <= 0) continue;
        spreadInto(high.slice(cursor, cursor + s.n), s.lo, s.hi, set);
        cursor += s.n;
      }
      // 3) FREDNINGSGULVE (ejer-justeringer 9/8 aften, efter variant B-diffen):
      //    - gammel 6,0'er må ALDRIG lande under 80 ("5,0-ækvivalent", loft ~80)
      //    - gammel 5,5'er må ALDRIG lande under 74,5 ("5,0-grænsen") — valgt af
      //      ejeren som opfølgning (lukker hullet 75-79; blødere overgang).
      //    Anvendes i FALDENDE pot-orden. Løfte-loftet pr. gulv er rang-sikkert:
      //    under (a) hard-cap (næste gulv/segment-grænse), (b) laveste IKKE-
      //    løftede same-pot-værdi ≥ gulvet (ellers kunne en løftet lav-ranket
      //    overhale en seat-holder — gav 3 rang-brud i første 6,0-kørsel), og
      //    (c) laveste værdi hos ENHVER højere pot i båndet. Konsekvens
      //    (accepteret, dokumenteret): hale-ankret ≥74,5 overskrides af
      //    fredningsklasserne (stock-legacy der eroderer ved aldring);
      //    FLOW/generator følger planen. ≥84,3/≥94,1 forbliver på plan.
      const GRANDFATHER_FLOORS = [
        { pot: 6, floor: 80, hardCap: 84.3 },
        { pot: 5.5, floor: 74.5, hardCap: 80 },
      ];
      for (const { pot, floor, hardCap } of GRANDFATHER_FLOORS) {
        const liftees = high.filter((r) => r.potentiale === pot && remapById.get(r.id).newPot99 < floor)
          .sort((a, b) => remapById.get(a.id).newPot99 - remapById.get(b.id).newPot99 || (seededUnit(a.id) - seededUnit(b.id)));
        if (!liftees.length) continue;
        const bounds = high
          .filter((r) => (r.potentiale === pot && remapById.get(r.id).newPot99 >= floor) || r.potentiale > pot)
          .map((r) => remapById.get(r.id).newPot99);
        const liftHi = bounds.length ? Math.min(hardCap, Math.min(...bounds)) : hardCap;
        spreadInto(liftees, floor, liftHi, set);
      }
    }
  }
  
  // Rang-bevarelse-egenskab (kontrol, ikke kun antagelse): for hvert aldersbånd,
  // gå gennem sorted rækkefølge og verificér newPot er ikke-faldende.
  const rankViolations = [];
  for (const band of AGE_BANDS) {
    const group = riders.filter((r) => bandOf(r.age) === band.key)
      .sort((a, b) => (a.potentiale - b.potentiale) || (seededUnit(a.id) - seededUnit(b.id)));
    for (let i = 1; i < group.length; i++) {
      const prev = remapById.get(group[i - 1].id).newPot99;
      const cur = remapById.get(group[i].id).newPot99;
      if (cur < prev) rankViolations.push({ band: band.key, prevId: group[i - 1].id, curId: group[i].id, prev, cur });
    }
  }
  return { remapById, rankViolations };
}
