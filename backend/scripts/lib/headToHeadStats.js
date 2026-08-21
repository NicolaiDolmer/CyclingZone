// backend/scripts/lib/headToHeadStats.js
// Race Engine v4 F2 (#4030): rene statistik-/sampling-helpers til
// headToHeadV4.js's fulde scorecard (mor-spec §5-ankre, docs/superpowers/specs/
// 2026-08-20-race-engine-v4-intra-stage-design.md). Udskilt fra headToHeadV4.js
// for testbarhed i isolation (ingen simulator-/DB-afhaengighed her overhovedet).
//
// 100% REN: ingen IO, ingen Date.now/Math.random (kaldere sender altid en rng-
// funktion ind hvor stoej kraeves — samme determinisme-krav som motor-kernen,
// selvom denne fil IKKE er en del af backend/lib/engine/v4/ og derfor ikke er
// underlagt dens tsconfig/erasable-syntax-regler).

/**
 * Simpelt gennemsnit. Tom liste -> null (aldrig 0 — 0 er en gyldig maaling,
 * "ingen data" er noget andet og skal ikke camoufleres som "0").
 * @param {number[]} values
 * @returns {number|null}
 */
export function mean(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Median (sorteret kopi, paavirker ikke input). Tom liste -> null.
 * @param {number[]} values
 * @returns {number|null}
 */
export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Percentil (naermeste-rang-metode, samme afrundingsstil som
 * exportPopulationSnapshot.js's percentile()). Tom liste -> null.
 * @param {number[]} values
 * @param {number} p  0-100
 * @returns {number|null}
 */
export function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Rangordner en vaerdi-liste (1 = laveste vaerdi), med gennemsnitlig rang ved
 * lighed (standard Spearman-tie-haandtering).
 * @param {number[]} values
 * @returns {number[]} ranks, samme raekkefoelge som input
 */
function rankValues(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j + 1) / 2; // 1-indekseret, gennemsnit over det lige-blok
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rangkorrelation mellem to lige lange numeriske lister.
 * Returnerer null hvis < 2 par, eller hvis én af siderne er konstant (ingen
 * varians -> korrelation udefineret, IKKE 0 — 0 ville paastaa "maalt ingen
 * sammenhaeng" hvor det korrekte svar er "kan ikke maales her").
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {number|null}
 */
export function spearmanCorrelation(xs, ys) {
  if (!xs || !ys || xs.length !== ys.length || xs.length < 2) return null;
  const rx = rankValues(xs);
  const ry = rankValues(ys);
  const n = rx.length;
  const meanRx = mean(rx);
  const meanRy = mean(ry);
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - meanRx;
    const dy = ry[i] - meanRy;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/**
 * Deterministisk delvis Fisher-Yates-sampling (samme moenster som
 * raceCompetitionScorecard.js's sampleField/simulateSeasonDryRun.js's
 * sampleField): traekker min(n, pool.length) elementer fra pool UDEN at
 * mutere pool, rekkefoelgen afgoeres udelukkende af den injicerede rng.
 * @template T
 * @param {() => number} rng  uniform [0,1)
 * @param {T[]} pool
 * @param {number} n
 * @returns {T[]}
 */
export function sampleField(rng, pool, n) {
  const arr = [...pool];
  const count = Math.min(Math.max(0, n), arr.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

/**
 * Formaterer en vaerdi til scorecard-visning: null -> "n/a" (aldrig "0" eller
 * tomstreng — "n/a" er utvetydigt "ikke maalt her", adskilt fra en maalt
 * nulvaerdi).
 * @param {number|null} value
 * @param {number} [decimals=2]
 * @returns {string}
 */
export function fmt(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toFixed(decimals);
}

/**
 * Formaterer en andel (0-1) som procent-streng, "n/a" ved null.
 * @param {number|null} fraction
 * @returns {string}
 */
export function fmtPct(fraction) {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "n/a";
  return `${(fraction * 100).toFixed(1)}%`;
}
