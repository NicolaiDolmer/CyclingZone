// Scouting-rapport (#1543 Fase 1) — RENE funktioner, ingen DB/Math.random.
//
// Loft-bånd pr. ryttertype beregnes fra ability_caps via værdimodellens blendede
// output (riderValuation.blendedOutput, alpha=0.5 — samme model som frontendens
// riderTypeRating i frontend/src/lib/riderRating.js) og maskeres som BÅND før de
// forlader serveren (#1162): seeded center-bias + halvbredde efter scout-level.
// Verdict er deterministisk (ingen AI) og bygget af i18n-nøgler så copy lever i
// locales (EN/DA).
import { blendedOutput } from "./riderValuation.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { seededUnit } from "./scouting.js";
import { DEFAULT_SCOUT, scoutHalfWidth } from "./scoutEngine.js";

// Rating-ankre — SKAL matche frontend/src/lib/riderRating.js (SSOT for de tal;
// fittet mod prod-populationen 2026-06-29, n=2.947). riderRating.test.js +
// scoutingReport.test.js guarder formen; ved re-fit opdateres begge steder.
export const RATING_ALPHA = 0.5;
export const RATING_O_ELITE = 67.38; // p99.5 af O_best → 99
export const RATING_O_MIN = 2.04;    // min af O_best → 1

// Halvbredde i rating-punkter pr. scout-level (index = level; egen rytter
// behandles som maxLevel). Parametriseret så Fase 3 (talentspejder-entiteten)
// kan gøre den spejder-rating-afhængig uden at røre formlen.
export const CEIL_HALF_WIDTH_BY_LEVEL = Object.freeze([12, 8, 5, 3]);
// Andel af halvbredden som det seedede center kan ligge skævt — båndets
// midtpunkt er dermed IKKE loft-sandheden (anti-inversion, #1162).
export const CEIL_BIAS_FACTOR = 0.5;

const clampInt = (n, lo, hi) => Math.round(Math.max(lo, Math.min(hi, n)));

// 1-99-rating for et sæt evner "som type" — spejler frontend riderTypeRating.
export function ratingFromAbilities(abilities, typeKey) {
  const o = blendedOutput(abilities, typeKey, RATING_ALPHA);
  const scaled = 1 + 98 * (o - RATING_O_MIN) / (RATING_O_ELITE - RATING_O_MIN);
  return clampInt(scaled, 1, 99);
}

// Bånd-maskerede loft-ratings for alle ryttertyper.
//   nowAbilities : synlige evner nu (rider_derived_abilities-rækkens felter)
//   caps         : ability_caps-objektet (SANDHED — forlader aldrig serveren rå)
//   level        : viewerens scout-niveau (egen rytter = maxLevel)
//   riderId/teamId: seed for per-manager center-bias
//   scout        : viewer-holdets spejder-objekt (#2244) — gulv-begrænser halvbredden
//                  (CEIL_HALF_WIDTH_BY_LEVEL-skalaen matcher scoutEngine's gulv 1:1,
//                  unitScale=1). Default DEFAULT_SCOUT (overall 40).
// Returnerer [{ key, now, ceilLo, ceilHi }] — heltal, clamp [1,99], ceilLo>=now.
export function buildTypeCeilingBands({ nowAbilities, caps, level, riderId, teamId, scout = DEFAULT_SCOUT }) {
  const half = scoutHalfWidth(level, scout, CEIL_HALF_WIDTH_BY_LEVEL);
  return RIDER_TYPE_KEYS.map((key) => {
    const now = ratingFromAbilities(nowAbilities, key);
    const ceilTruth = ratingFromAbilities(caps, key);
    const bias = (seededUnit(`scout-ceil:${riderId}:${teamId}:${key}`) * 2 - 1)
      * half * CEIL_BIAS_FACTOR;
    const center = ceilTruth + bias;
    // Loftet kan pr. definition ikke ligge under nuværende niveau — clamp mod now
    // FØR interval-clamp så båndet forbliver konsistent (lo<=hi).
    const ceilLo = clampInt(Math.min(Math.max(center - half, now), 99), 1, 99);
    const ceilHi = clampInt(Math.min(Math.max(center + half, now), 99), 1, 99);
    return { key, now, ceilLo, ceilHi };
  });
}

// Deterministisk verdict i i18n-nøgler (copy lever i locales, EN/DA).
//   age         : rytterens alder (år)
//   own         : er det viewerens egen rytter?
//   level       : scout-niveau; maxLevel: config-max
//   bestNow     : bedste type-rating nu (maks over buildTypeCeilingBands[].now)
//   bestCeilMid : midtpunkt af bedste types loft-bånd
//   valueGap    : forventet værdi minus markedsværdi (>0 = potentielt røverkøb);
//                 0/ukendt → faktoren udelades.
export function buildVerdict({ age, own, level, maxLevel, bestNow, bestCeilMid, valueGap = 0 }) {
  const gap = (Number(bestCeilMid) || 0) - (Number(bestNow) || 0);
  const a = Number(age) || 26;
  const headlineKey =
    a >= 31 && gap < 4 ? "past_peak"
    : gap >= 12 && a <= 23 ? (own ? "keep_and_develop" : "bid_worth_considering")
    : gap >= 6 ? "monitor"
    : "solid_contributor";
  const confidence = own || level >= maxLevel ? "high" : level >= 2 ? "medium" : "low";
  const pool = [];
  if (a <= 23) pool.push("age_upside");
  if (gap >= 12) pool.push("ceiling_gap");
  if (gap < 4) pool.push("near_ceiling");
  if (a >= 31) pool.push("decline_risk");
  if (valueGap > 0) pool.push("value_gap");
  pool.push("type_match", "form_unknown", "watch_races");
  return { headlineKey, confidence, factorKeys: pool.slice(0, 4) };
}
