// Display-rating 0-99 for en rytter: simpelt, uvægtet snit af de 15 synlige
// CZ-evner (#1529). Frontend-pendant til backend `riderOverall`
// (backend/lib/riderValuation.js), som også arbejder på derived abilities.
//
// STAT_KEYS = de 15 evne-keys (delt config i ./abilities.js). Migreret 2026-06-19
// (#1529) fra de 14 PCM stat_*-kolonner — visningen viser nu evner. components/
// RiderFilters.jsx re-eksporterer den. ./abilities.js er ren .js uden JSX-imports,
// så `node --test` kan stadig loade denne fil. Rytter-objektet skal have evnerne
// fladet op (rider.climbing osv.) via flattenAbilities() før rating beregnes.
import { ABILITY_KEYS } from "./abilities.js";

export const STAT_KEYS = ABILITY_KEYS;

// Snit af de stats der findes på rækken (manglende/ikke-numeriske ignoreres).
// Ingen stats overhovedet → 0 (sorterer nederst, viser tomt-agtig værdi).
export function riderStatRating(rider = {}) {
  let sum = 0;
  let n = 0;
  for (const k of STAT_KEYS) {
    const raw = rider?.[k];
    if (raw == null) continue; // null/undefined = manglende stat, ikke 0 (Number(null) er 0)
    const v = Number(raw);
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return 0;
  return Math.round(Math.max(0, Math.min(99, sum / n)));
}

// ============================================================================
// Overall 1-99-rating (EPIC #2000 Slice 2 / #2006) — V1 ABSOLUT.
// ============================================================================
//
// Type-bevidst rating der spejler PRÆCIS den type-blendede output O som
// værdimodellen bruger (backend/lib/riderValuation.js → blendedOutput med
// alpha=0.5, samme tal som riderValuationModel.json). Den absolutte O
// normaliseres lineært til 1-99 mod to faste, dokumenterede populations-ankre.
//
//   O_best = alpha·speciale_output(rider, primary_type) + (1-alpha)·snit(evner)
//   alpha  = 0.5 (ejer-bekræftet — matcher værdimodellen)
//
// speciale_output = vægtet snit af de POSITIVE type-vægte (riderTypes.js) for
// rytterens STORED primary_type. Ejer-direktiv: ratingen bruger SAMME model som
// den viste primær/sekundær-type, så de altid er konsistente. Evne-grundlaget er
// de 13 type-klassifikator-evner (samme som backend riderValuation, der importerer
// ABILITY_KEYS fra riderTypes.js) — IKKE de 15 display-evner.
//
// ----------------------------------------------------------------------------
// ANKRE (tunable knobs — gen-fit hvis populationen flytter sig markant):
//   O_ELITE = 67.38  → rating 99. Sat til p99.5 af O_best over alle aktive,
//     ikke-pensionerede ryttere (read-only fra prod 2026-06-29, n=2.947).
//     BEVIDST p99.5 og IKKE populations-max (81.31, en enkelt outlier) — max er
//     skrøbeligt sæson-til-sæson; et percentil-anker er robust og lader de
//     allerbedste ryttere klampe pænt til 99.
//   O_MIN   = 2.04   → rating 1. p0/min af samme population (gulvet).
// Distribution under disse ankre (prod 2026-06-29): min 1 / median 22 / p90 61 /
// p99 ~95 / max 99. Scorecard: docs/decisions/ (PR #2006-tråden).
// ----------------------------------------------------------------------------

export const RATING_ALPHA = 0.5;
export const RATING_O_ELITE = 67.38; // p99.5 af O_best → 99
export const RATING_O_MIN = 2.04;    // min af O_best → 1

// De 13 evne-keys som type-formlerne + værdimodellen arbejder på (spejl af
// ABILITY_KEYS i backend/lib/riderTypes.js — IKKE de 15 display-evner). Bruges
// til snit-leddet, så O_best matcher backend blendedOutput 1:1.
const RATING_ABILITY_KEYS = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "aggression",
];

// POSITIVE type-vægte pr. primary_type — spejl af de positive vægte i
// RIDER_TYPES (backend/lib/riderTypes.js). speciale_output bruger KUN de positive
// vægte (negative vægte straffer i type-KLASSIFIKATIONEN, ikke i output-scoren).
// Holdes manuelt i sync med backend; riderRating.test.js verificerer formen.
const RATING_TYPE_WEIGHTS = {
  sprinter:       { acceleration: 3, sprint: 2, flat: 1, durability: 1 },
  tt:             { time_trial: 3 },
  climber:        { climbing: 3, tempo: 2, punch: 1, endurance: 1 },
  puncheur:       { punch: 3, tempo: 2, climbing: 1, endurance: 1 },
  brostensrytter: { cobblestone: 5, flat: 2, endurance: 1, punch: 1 },
  baroudeur:      { aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1 },
  rouleur:        { flat: 2, endurance: 1 },
  gc:             { climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1 },
};

// Snit over de 13 type-evner der findes på rækken (manglende ignoreres).
// Spejler backend meanAbilityScore. 0 hvis ingen findes.
function meanAbility(rider) {
  let sum = 0, n = 0;
  for (const k of RATING_ABILITY_KEYS) {
    const v = Number(rider?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : 0;
}

// speciale_output (0-99): vægtet snit af de positive type-vægte for primaryType.
// Spejler backend outputScore. Ukendt/manglende type → snit af alle evner
// (neutral fallback, som backend).
function specialeOutput(rider, primaryType) {
  const weights = RATING_TYPE_WEIGHTS[primaryType];
  if (weights) {
    let sum = 0, wsum = 0;
    for (const [k, w] of Object.entries(weights)) {
      const v = Number(rider?.[k]);
      if (Number.isFinite(v)) { sum += v * w; wsum += w; }
    }
    if (wsum > 0) return sum / wsum;
  }
  return meanAbility(rider);
}

// Type-blendet output O_best (0-99, uafrundet) — spejler backend blendedOutput
// med alpha=0.5. Eksporteret så scorecard/tests kan inspicere det rå O.
export function riderBlendedOutput(rider = {}, primaryType = rider?.primary_type ?? null) {
  return RATING_ALPHA * specialeOutput(rider, primaryType)
    + (1 - RATING_ALPHA) * meanAbility(rider);
}

// Per-type 1-99-rating (#2000 Part 2 / #918): "hvor højt ville rytteren rates SOM
// `typeKey`". SAMME model + ankre som overall-ratingen, men for en VILKÅRLIG type
// i stedet for rytterens stored primary_type — så Udvikling-fanen kan tegne én
// linje pr. ryttertype. Forbruger riderBlendedOutput + RATING_O_MIN/ELITE → ingen
// ny rating-formel (ÉN overall-vurdering i appen, ejer-krav). Lineær map O_MIN→1,
// O_ELITE→99, klampet [1,99] og afrundet. Ingen brugbare evner → 0.
export function riderTypeRating(rider = {}, typeKey = null) {
  const hasAny = RATING_ABILITY_KEYS.some((k) => Number.isFinite(Number(rider?.[k])));
  if (!hasAny) return 0;
  const o = riderBlendedOutput(rider, typeKey);
  const scaled = 1 + 98 * (o - RATING_O_MIN) / (RATING_O_ELITE - RATING_O_MIN);
  return Math.round(Math.max(1, Math.min(99, scaled)));
}

// Overall 1-99-rating = rating for rytterens STORED primary_type (ejer-direktiv:
// samme model som den viste type). Rytter-objektet skal have evnerne fladet op
// (rider.climbing osv.) via flattenAbilities(). Ingen brugbare evner → 0
// (sorterer nederst som riderStatRating).
export function riderOverallRating(rider = {}) {
  return riderTypeRating(rider, rider?.primary_type ?? null);
}
