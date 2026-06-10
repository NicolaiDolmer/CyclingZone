// Ren kerne for værdimodel-scorecardet (#1196) — bruges af
// scripts/valuationScorecard.js. Ingen I/O her: kun aggregering/formattering,
// så logikken er testbar med node --test (samme princip som riderValuationFit.js).

// Interim pyramide-bånd fra #1194 (ejer-godkendt 7/6, re-bekræftet 10/6).
// Dækker hele værdiaksen uden hul/overlap: [min, max).
export const PYRAMID_BANDS = Object.freeze([
  { key: "superstjerne", label: "Superstjerne (≥8M)", min: 8_000_000, max: Infinity },
  { key: "stjerne", label: "Stjerne (1–8M)", min: 1_000_000, max: 8_000_000 },
  { key: "solid", label: "Solid (200k–1M)", min: 200_000, max: 1_000_000 },
  { key: "domestik", label: "Domestik (<200k)", min: 0, max: 200_000 },
]);

// Design-pyramiden for det fiktive launch-felt (800 ryttere, seed 2026) — #1194.
export const DESIGN_PYRAMID = Object.freeze({ superstjerne: 12, stjerne: 60, solid: 230, domestik: 500 });

// Percentil via indeks-opslag på et SORTERET (stigende) array — samme
// konvention som auditValuationCutover.js (ingen interpolation, YAGNI).
export function percentile(sortedVals, p) {
  if (!Array.isArray(sortedVals) || sortedVals.length === 0) return null;
  const i = Math.min(sortedVals.length - 1, Math.floor(p * sortedVals.length));
  return sortedVals[i];
}

// Tæl værdier pr. pyramide-bånd.
export function bandCounts(values) {
  const counts = Object.fromEntries(PYRAMID_BANDS.map((b) => [b.key, 0]));
  for (const v of values) {
    const band = PYRAMID_BANDS.find((b) => v >= b.min && v < b.max);
    if (band) counts[band.key] += 1;
  }
  return counts;
}

// Helår-alder fra birthdate (DATE-streng) — null hvis ukendt/ugyldig.
export function riderAge(birthdate, asOf = new Date()) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < b.getUTCMonth() ||
    (asOf.getUTCMonth() === b.getUTCMonth() && asOf.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// Afstand fra blended output O til det anchor-kalibrerede interval [min, max].
// 0 = modellen interpolerer (anchor-støttet); >0 = ekstrapoleret (under) eller
// klampet (over output_max) — det er dér modellen gætter.
export function anchorSupportDistance(O, { min, max }) {
  if (O < min) return min - O;
  if (O > max) return O - max;
  return 0;
}

// Top-N outliers: ryttere længst UDEN FOR anchor-støtten, med retning.
// riders: [{ name, output, ... }] — alle felter bevares på rækkerne.
export function buildOutlierRows(riders, range, n = 10) {
  return riders
    .map((r) => ({
      ...r,
      distance: anchorSupportDistance(r.output, range),
      direction: r.output < range.min ? "under" : r.output > range.max ? "over" : "inde",
    }))
    .filter((r) => r.distance > 0)
    .sort((a, b) => b.distance - a.distance)
    .slice(0, n);
}

export const fmtCZ = (n) => Math.round(n).toLocaleString("da-DK");
