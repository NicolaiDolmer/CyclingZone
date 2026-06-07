// Eget data-drevet rytter-værdisystem (#1101) — single source.
//
// Afløser (ved cutover) de tre uci-afledte formel-kopier i schema.sql,
// marketUtils.js og frontend/marketValues.js. I shadow-fasen bruges denne kun
// til at BEREGNE + VISE base_value; den styrer endnu ikke økonomien.
//
// MODEL v2 (anchor-kalibreret, 7/6-2026) — afløser v1 (ridge på 141 uci-ankrede
// auktionssalg → uci-cirkularitet, virkede ikke for fiktiv launch-population):
//
//   ln(base_value) = a + b·output + offset[primary_type]
//
//   output (0-99) = vægtet snit af de POSITIVE type-vægte (riderTypes.js) på de
//     rå abilities → "hvor god er rytteren til sit speciale".
//   offset[type]  = type-fixed-effect (forventet præmie/omdømme pr. type), fittet
//     af ejer-kalibrerede anchors.
//   INGEN bund (ejer-direktiv): dårligste ryttere ≈ 1.000; spil-data forfiner på sigt.
//
// Modellen fittes manuelt (ejer-godkendt) af scripts/fitRiderValuationModel.js fra
// backend/lib/riderValuationAnchors.json og persisteres i riderValuationModel.json.
// Se docs/decisions/rider-valuation-model-v1.md.

import { RIDER_TYPES, ABILITY_KEYS } from "./riderTypes.js";

export { ABILITY_KEYS };

const WEIGHTS_BY_TYPE = Object.freeze(
  Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights]))
);

// Type-output (0-99): vægtet snit af de POSITIVE vægte for rytterens primær-type.
// Manglende type/abilities → snit af alle tilgængelige abilities (neutral fallback).
export function outputScore(abilities = {}, primaryType = null) {
  const weights = WEIGHTS_BY_TYPE[primaryType];
  if (weights) {
    let sum = 0, wsum = 0;
    for (const [k, w] of Object.entries(weights)) {
      if (w <= 0) continue;
      const v = Number(abilities?.[k]);
      if (Number.isFinite(v)) { sum += v * w; wsum += w; }
    }
    if (wsum > 0) return sum / wsum;
  }
  // Fallback: snit af alle abilities.
  let sum = 0, n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : 0;
}

// Forudsig base_value (CZ$, heltal) for en rytter ud fra en fittet model.
// model: { a, b, offset: { type: number } }
// rider: riders-række (kræver primary_type). abilities: rider_derived_abilities-række.
// Returnerer null hvis abilities mangler helt (kan ikke værdisættes meningsfuldt).
// Fjerde argument (opts) accepteres for bagudkompatibilitet, men ignoreres
// (modellen bruger hverken alder eller asOf).
export function predictBaseValue(rider, abilities, model /*, opts */) {
  if (!model || !Number.isFinite(Number(model.a)) || !Number.isFinite(Number(model.b))) return null;
  const haveAbilities = ABILITY_KEYS.some((k) => Number.isFinite(Number(abilities?.[k])));
  if (!haveAbilities) return null;

  const type = rider?.primary_type ?? null;
  const O = outputScore(abilities, type);
  const offset = model.offset?.[type] ?? 0;
  const value = Math.exp(model.a + model.b * O + offset);

  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value));
}

// Display-overall 0-99: simpelt snit af rytterens abilities. Bruges kun til
// admin-preview-visning/sortering (ikke til værdiberegningen).
export function riderOverall(abilities = {} /*, model */) {
  let sum = 0, n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? Math.round(Math.max(0, Math.min(99, sum / n))) : 0;
}

// Rytterens primære speciale = den højeste ability (til label/visning).
export function riderSpecialty(abilities = {}) {
  let best = null;
  let bestVal = -1;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v) && v > bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}
