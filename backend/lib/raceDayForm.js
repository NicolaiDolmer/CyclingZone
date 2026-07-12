// Race Engine v3 (#2224), slice S2 (#2353) — varians med navn: dagsform +
// jour sans (spec §7).
//
// To NAVNGIVNE varians-kilder (why-rapporten kan forklare dem: "stærk dag" /
// "tung dag" / "kollapsdag") — bevidst IKKE en skrue på den anonyme
// NOISE_SD_SCALE (gate-kalibreret, røres ikke; spec §3's designprincip).
//
// Determinisme-regler (spec §5, ufravigelige):
//   - PER-RYTTER-HASHET: hver rytters dagsform/jour-sans-udfald afledes af
//     (stageSeed, rider_id) alene — én tilmelding mere i feltet kan ALDRIG
//     flytte en anden rytters dagsform. stageSeed er allerede race+etape-
//     specifik (og #2351-saltet) via raceRunner → simulateStage.
//   - DEDIKEREDE rng-streams (domæne-præfiksede FNV-hashes) — konsumerer
//     INTET fra simulateStage's main rng, så noise/breakaway-sekvenserne er
//     bit-identiske med og uden S2 (og flag-off er uberørt: raceSimulator
//     kalder kun herind når v3=true).
//   - Ren lib: ingen DB/fs/Math.random/Date.
//
// Alle balance-konstanter bor i RACE_V3_TUNING (raceRoles.js) — én tunings-flade.

import { makeRng, gaussian } from "./fictionalRiderGenerator.js";
import { RACE_V3_TUNING } from "./raceRoles.js";

// Lokal FNV-1a 32-bit (samme algoritme/kontrakt som raceSimulator.stableSeed —
// duplikeret bevidst for at undgå cyklisk import raceSimulator ⇄ raceDayForm).
function fnv1a32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * Dagsform: seeded normal-komponent pr. (etape-seed, rytter), sd =
 * RACE_V3_TUNING.DAYFORM_SD. Symmetrisk om 0 — en stærk dag er lige så
 * sandsynlig som en tung dag.
 *
 * @param {{riderId:string, stageSeed:number, sd?:number}} args
 *   sd: test-/sweep-override; default tunings-fladen.
 * @returns {number}
 */
export function dayFormComponent({ riderId, stageSeed, sd = RACE_V3_TUNING.DAYFORM_SD } = {}) {
  if (!sd) return 0;
  const rng = makeRng(fnv1a32(`dayform:${stageSeed >>> 0}:${riderId}`));
  return gaussian(rng, 0, sd);
}

/**
 * p(jour sans) for en given form-værdi: base-raten skaleret lineært mellem
 * MULT_LOWFORM (form ≤ FORM_LOW) og MULT_HIGHFORM (form ≥ FORM_HIGH).
 * Manglende/ugyldig form → base (neutral). Eksporteret for testbarhed +
 * why-rapportens "god form købte forsikring"-forklaring (S6).
 *
 * @param {number|null|undefined} form  rider_condition.form (0-100) eller mangler
 * @param {object} [t=RACE_V3_TUNING]
 * @returns {number} sandsynlighed ∈ [0, 1]
 */
export function jourSansProbability(form, t = RACE_V3_TUNING) {
  const base = t.JOUR_SANS_P_BASE;
  if (!base) return 0;
  const f = Number(form);
  if (form == null || !Number.isFinite(f)) return base;
  const lo = t.JOUR_SANS_FORM_LOW, hi = t.JOUR_SANS_FORM_HIGH;
  const fc = clamp(f, lo, hi);
  const frac = (fc - lo) / (hi - lo); // 0 ved lav form, 1 ved høj form
  const mult = t.JOUR_SANS_P_MULT_LOWFORM + frac * (t.JOUR_SANS_P_MULT_HIGHFORM - t.JOUR_SANS_P_MULT_LOWFORM);
  return clamp(base * mult, 0, 1);
}

/**
 * Jour sans: Bernoulli pr. (etape-seed, rytter) med form-koblet p; udfald
 * uniform i [MAGNITUDE_MIN, MAGNITUDE_MAX], returneret NEGATIVT (adderes til
 * finalScore som work_cost — samme fortegns-konvention). 0 = ingen kollaps.
 *
 * Rng-orden i den dedikerede stream: u1 = Bernoulli-trækket; u2 (kun ved hit)
 * = magnituden. p-ændringer (grid/form) kan derfor aldrig flytte ANDRE
 * rytteres udfald — streamen er per-rytter.
 *
 * @param {{riderId:string, stageSeed:number, form?:number|null, tuning?:object}} args
 * @returns {number} ≤ 0
 */
export function jourSansComponent({ riderId, stageSeed, form = null, tuning = RACE_V3_TUNING } = {}) {
  const p = jourSansProbability(form, tuning);
  if (!p) return 0;
  const rng = makeRng(fnv1a32(`joursans:${stageSeed >>> 0}:${riderId}`));
  if (rng() >= p) return 0;
  const u = rng();
  return -(tuning.JOUR_SANS_MAGNITUDE_MIN + u * (tuning.JOUR_SANS_MAGNITUDE_MAX - tuning.JOUR_SANS_MAGNITUDE_MIN));
}
