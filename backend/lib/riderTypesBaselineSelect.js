// Alders-gate for hvilken ryttertype-baseline der bruges til den ENDELIGE
// klassifikation (#3570, fast-track under #3564-kæden).
//
// ROD-ÅRSAG (se riderTypesBaselineYouth.json + scripts/fitRiderTypesBaselineYouth.js
// for den fulde udredning): unge ryttere klassificeres i produktion mod
// riderTypesBaseline.json — fittet over VOKSEN-caps. Unges caps-profil er
// strukturelt anderledes (tempo/time_trial lavere, aggression har et alders-gulv),
// så z-scores mod voksen-populationen er systematisk skæve for unge — en type der
// straffer en evne unge strukturelt ligger lavt i (fx baroudeur straffer ikke
// time_trial ret hårdt, men de fleste ANDRE typer gør) vinder derfor kunstigt ofte.
//
// Denne fil rører INTET ved RIDER_TYPES-vægtene (riderTypes.js, read-only) eller
// selve computeRiderTypes()-formlen — den vælger blot HVILKEN baseline (mean/std
// pr. evne) en given rytters caps z-scores imod, baseret på alder.
//
// Grænsen (< 22) matcher den eksisterende U22-konvention i kodebasen (#2798,
// se fx scripts/seasonStartScorecard.js's `age < 22`-filter).
export const YOUTH_BASELINE_AGE_THRESHOLD = 22;

/**
 * Vælg hvilken ryttertype-baseline en rytters ENDELIGE klassifikation skal
 * z-scores imod.
 *
 * @param {number|null|undefined} age  Rytterens alder (sæson-alder, ageForSeason).
 *   null/undefined/ikke-numerisk → VOKSEN-baselinen (konservativt: intet kendt
 *   alders-signal ⇒ ingen reklassificering af den hidtidige sti).
 * @param {object} adultBaseline  Den eksisterende, uændrede voksen-fittede baseline
 *   (riderTypesBaseline.json's { mean, std }).
 * @param {object|null|undefined} youthBaseline  Den ungdoms-fittede baseline
 *   (riderTypesBaselineYouth.json's { mean, std }). Mangler den (null/undefined),
 *   falder funktionen tilbage til adultBaseline for ALLE aldre — bagudkompatibelt
 *   nul-ændrings-fallback for callers der (endnu) ikke sender den med.
 * @param {number} [threshold]  Alders-grænsen (eksklusiv øvre — "< threshold" er ungdom).
 * @returns {object}  Den baseline computeRiderTypes() skal kaldes med.
 */
export function selectTypesBaseline(age, adultBaseline, youthBaseline, threshold = YOUTH_BASELINE_AGE_THRESHOLD) {
  if (!youthBaseline) return adultBaseline;
  // NB: Number(null) === 0 (finite!) — eksplicit null/undefined-tjek FØR
  // Number()-coercion, ellers klassificeres en ukendt alder som "0 år" (ungdom).
  if (age == null) return adultBaseline;
  const a = Number(age);
  if (!Number.isFinite(a)) return adultBaseline;
  return a < threshold ? youthBaseline : adultBaseline;
}
