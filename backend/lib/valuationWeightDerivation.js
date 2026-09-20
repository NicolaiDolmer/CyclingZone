// #3353 — udled en værdi-vægttabel pr. ryttertype FRA MOTORENS EGET OUTPUT.
// Ren, testbar, ingen DB/fs. Bruges af scripts/dev/deriveValuationWeights5443.mjs.
//
// Baggrund: `weights/valuationWeights.js` er en håndtabel. Den bestemmer hvilke
// evner der overhovedet tæller når en rytter prissættes, og for tre af de otte
// typer er den så smal (1-2 evner) at formlen er blind for det meste af rytteren.
// Alternativet her er at lade motoren bestemme: hvilke evner hænger faktisk
// sammen med hvor mange præmiepenge en rytter af DEN type henter i en simuleret
// sæson? Så følger vægtene spillet i stedet for en tabel nogen skrev én gang.
//
// Metode pr. type:
//   1. y = ln(max(e_prize, 1)) — samme floor/log-skala som selve v4-fittet.
//   2. Centrér X og y (så skæringen er implicit og ikke stjæler vægt).
//   3. Ikke-negativ mindste-kvadraters-løsning (NNLS) via koordinat-descent:
//      en negativ vægt ville betyde "denne evne gør rytteren mindre værd", og
//      det bryder doktrinen om at styrke aldrig straffes. Evner der ikke
//      hjælper får vægt 0 i stedet.
//   4. Normalisér så den tungeste evne vejer `topWeight` (default 5, samme
//      skala som de eksisterende tabeller), rund, og smid støj-vægte væk.
//
// Hvorfor koordinat-descent og ikke en lukket løsning: abilities er stærkt
// korrelerede (en god rytter er god til det meste), så en almindelig OLS giver
// store positive og negative vægte der udligner hinanden. NNLS med et gulv på 0
// er både stabilere og den eneste form der giver mening som en "opskrift".

/**
 * Ikke-negativ mindste-kvadraters-løsning via koordinat-descent.
 * Minimerer ||y − X·w||² under w ≥ 0. Rent numerisk, ingen afhængigheder.
 *
 * @param {number[][]} X  n×p designmatrix (allerede centreret)
 * @param {number[]} y    n-vektor (allerede centreret)
 * @param {{ iterations?: number, tolerance?: number }} [opts]
 * @returns {number[]} p ikke-negative vægte
 */
export function nnlsCoordinateDescent(X, y, { iterations = 500, tolerance = 1e-10 } = {}) {
  const n = X.length;
  if (!n) return [];
  const p = X[0].length;
  const w = new Array(p).fill(0);
  // Kolonne-normer beregnes én gang; en helt konstant kolonne (norm 0) kan ikke
  // forklare noget og holdes på 0 i stedet for at give en division med nul.
  const colNorm = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j] * X[i][j];
    colNorm[j] = s;
  }
  // Residual holdes opdateret i stedet for at blive genberegnet pr. koordinat.
  const r = y.slice();
  for (let it = 0; it < iterations; it++) {
    let maxDelta = 0;
    for (let j = 0; j < p; j++) {
      if (colNorm[j] <= 0) continue;
      let dot = 0;
      for (let i = 0; i < n; i++) dot += X[i][j] * r[i];
      const next = Math.max(0, w[j] + dot / colNorm[j]);
      const delta = next - w[j];
      if (delta !== 0) {
        for (let i = 0; i < n; i++) r[i] -= delta * X[i][j];
        w[j] = next;
        if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
      }
    }
    if (maxDelta < tolerance) break;
  }
  return w;
}

/** Gennemsnit af et array (tomt ⇒ 0). */
function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

/**
 * Rå (unormaliserede) ikke-negative vægte for ÉT sæt samples.
 *
 * @param {Array<{abilities: object, e_prize: number}>} samples
 * @param {string[]} abilityKeys
 * @param {{ floor?: number, iterations?: number }} [opts]
 * @returns {{ raw: Record<string, number>, n: number }}
 */
export function rawWeightsFromSamples(samples, abilityKeys, { floor = 1, iterations = 500 } = {}) {
  const rows = (samples || []).filter((s) =>
    abilityKeys.every((k) => Number.isFinite(Number(s?.abilities?.[k]))));
  if (rows.length < abilityKeys.length + 1) {
    return { raw: Object.fromEntries(abilityKeys.map((k) => [k, 0])), n: rows.length };
  }
  const y = rows.map((s) => Math.log(Math.max(Number(s.e_prize) || 0, floor)));
  const X = rows.map((s) => abilityKeys.map((k) => Number(s.abilities[k])));
  const yMean = mean(y);
  const colMeans = abilityKeys.map((_, j) => mean(X.map((row) => row[j])));
  const Xc = X.map((row) => row.map((v, j) => v - colMeans[j]));
  const yc = y.map((v) => v - yMean);
  const w = nnlsCoordinateDescent(Xc, yc, { iterations });
  return { raw: Object.fromEntries(abilityKeys.map((k, j) => [k, w[j]])), n: rows.length };
}

/**
 * Normalisér rå vægte til en læsbar opskrift: tungeste evne = `topWeight`,
 * afrundet til `decimals`, og evner under `minShare` af toppen smidt væk (støj).
 * Alle vægte 0 ⇒ null (kalderen skal så falde tilbage på noget andet frem for
 * at skrive en tabel hvor ingen evne tæller).
 *
 * @param {Record<string, number>} raw
 * @param {{ topWeight?: number, decimals?: number, minShare?: number }} [opts]
 * @returns {Record<string, number>|null}
 */
export function normalizeWeights(raw, { topWeight = 5, decimals = 1, minShare = 0.05 } = {}) {
  const entries = Object.entries(raw || {}).filter(([, v]) => Number.isFinite(v) && v > 0);
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  if (!(max > 0)) return null;
  const f = 10 ** decimals;
  const out = {};
  for (const [k, v] of entries) {
    if (v / max < minShare) continue;
    const scaled = Math.round((v / max) * topWeight * f) / f;
    if (scaled > 0) out[k] = scaled;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Andel af en tabels samlede POSITIVE vægt der ligger på den tungeste evne.
 * Det er målet for "hvor meget af rytteren er formlen blind for": 100 % betyder
 * at én evne afgør alt. Tom/ugyldig tabel ⇒ null.
 */
export function weightConcentration(weights) {
  const vals = Object.values(weights || {}).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  return total > 0 ? Math.max(...vals) / total : null;
}

/**
 * Bootstrap-stabilitet: gentag udledningen på `reps` genudtrukne stikprøver og
 * returnér middel og spredning pr. evne (på den NORMALISEREDE skala, så tallene
 * kan sammenlignes direkte med den tabel der foreslås).
 *
 * rng: funktion der giver et tal i [0,1). Påkrævet — ingen Math.random herinde,
 * så kaldet er deterministisk og testbart.
 */
export function bootstrapWeights(samples, abilityKeys, rng, { reps = 50, ...opts } = {}) {
  const n = samples.length;
  const acc = Object.fromEntries(abilityKeys.map((k) => [k, []]));
  for (let r = 0; r < reps; r++) {
    const draw = new Array(n);
    for (let i = 0; i < n; i++) draw[i] = samples[Math.floor(rng() * n) % n];
    const { raw } = rawWeightsFromSamples(draw, abilityKeys, opts);
    const norm = normalizeWeights(raw, opts) || {};
    for (const k of abilityKeys) acc[k].push(norm[k] ?? 0);
  }
  const out = {};
  for (const k of abilityKeys) {
    const m = mean(acc[k]);
    const variance = mean(acc[k].map((v) => (v - m) ** 2));
    out[k] = { mean: m, sd: Math.sqrt(variance) };
  }
  return out;
}

/** Deterministisk RNG (mulberry32) — så bootstrap-tallene kan genskabes. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
