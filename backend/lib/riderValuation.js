// Eget data-drevet rytter-værdisystem (#1101) — single source.
//
// Afløser (ved cutover) de tre uci-afledte formel-kopier i schema.sql,
// marketUtils.js og frontend/marketValues.js. I shadow-fasen bruges denne kun
// til at BEREGNE + VISE base_value; den styrer endnu ikke økonomien.
//
// MODEL v3 (anchor-kalibreret, 9/6-2026) — afløser v2 (ren speciale-output, lineær),
// som var blind for alsidighed og satte MvdP over Pogačar mod ejerens anchors:
//
//   ln(base_value) = a + b·O + c·O² + offset[primary_type]
//   O = alpha·speciale-output + (1−alpha)·snit af alle evner
//
//   speciale-output (0-99) = vægtet snit af de POSITIVE type-vægte (riderTypes.js)
//     på de rå abilities → "hvor god er rytteren til sit speciale".
//   alsidigheds-leddet (1−alpha) belønner brede elite-profiler; c>0 strækker toppen.
//   offset[type]  = type-fixed-effect (forventet præmie/omdømme pr. type), fittet
//     af ejer-kalibrerede anchors.
//   Bagudkompatibel: v2-model-JSON (uden alpha/c) → alpha=1, c=0 = v2-adfærd.
//   INGEN bund (ejer-direktiv): dårligste ryttere ≈ 1.000; spil-data forfiner på sigt.
//
// Modellen fittes manuelt (ejer-godkendt) af scripts/fitRiderValuationModel.js fra
// backend/lib/riderValuationAnchors.json og persisteres i riderValuationModel.json.
// Se docs/decisions/rider-valuation-model-v1.md.

import { RIDER_TYPES, ABILITY_KEYS } from "./riderTypes.js";
// #2594 cutover: v4-modellen (karriere-NPV) lever i riderCareerNpv.js. Cirkulær
// import (riderCareerNpv importerer blendedOutput m.fl. herfra) er sikker i ESM:
// begge moduler eksporterer kun hoistede function declarations og kører ingen af
// modpartens bindings ved module-eval.
import { predictBaseValueV4 } from "./riderCareerNpv.js";

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
  return meanAbilityScore(abilities);
}

// Uafrundet snit over alle abilities (0-99). riderOverall er display-versionen (afrundet).
export function meanAbilityScore(abilities = {}) {
  let sum = 0, n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : 0;
}

// v3-output: alsidigheds-blend mellem speciale-score og snit af alle evner.
// alpha=1 → ren speciale-score (v2-adfærd). Kalibreret alpha ligger i model-JSON.
export function blendedOutput(abilities = {}, primaryType = null, alpha = 1) {
  const a = Number.isFinite(Number(alpha)) ? Math.min(1, Math.max(0, Number(alpha))) : 1;
  const spec = outputScore(abilities, primaryType);
  if (a >= 1) return spec;
  return a * spec + (1 - a) * meanAbilityScore(abilities);
}

// Forudsig base_value (CZ$, heltal) for en rytter ud fra en fittet model.
// model: { a, b, offset: { type: number } }
// rider: riders-række (kræver primary_type). abilities: rider_derived_abilities-række.
// Returnerer null hvis abilities mangler helt (kan ikke værdisættes meningsfuldt).
// Fjerde argument (opts) accepteres for bagudkompatibilitet, men ignoreres
// (modellen bruger hverken alder eller asOf).
export function predictBaseValue(rider, abilities, model /*, opts */) {
  // #2594 CUTOVER-DISPATCH: et v4-model-objekt (version 4, koefficienter under
  // model.fit) sendes til karriere-NPV-motoren bag SAMME interface — call-sites
  // er uændrede, de skal blot (a) indlæse riderValuationModelV4.json og (b) give
  // rider.age + rider.potentiale med. Et v3-model-objekt (koefficienter i roden)
  // beregner som hidtil — offline-harnesses der stadig indlæser
  // riderValuationModel.json (v3) er dermed bevidst uberørte.
  if (Number(model?.version) >= 4 && model?.fit) {
    return predictBaseValueV4(rider, abilities, model);
  }
  if (!model || !Number.isFinite(Number(model.a)) || !Number.isFinite(Number(model.b))) return null;
  const haveAbilities = ABILITY_KEYS.some((k) => Number.isFinite(Number(abilities?.[k])));
  if (!haveAbilities) return null;

  const type = rider?.primary_type ?? null;
  let O = blendedOutput(abilities, type, model.alpha ?? 1);
  // Ekstrapolations-guard: kurven er kun kalibreret op til den højeste anchor
  // (output_max i model-JSON). Output derover klampes — ellers eksploderer den
  // konvekse top for urealistiske profiler (Harry Ward 1,13 mia., 10/6). KUN opad:
  // bunden må fortsat ekstrapolere frit (ingen bund, ejer-direktiv 7/6).
  const oMax = Number(model.output_max);
  if (Number.isFinite(oMax) && O > oMax) O = oMax;
  // #1231: en type UDEN kalibreret offset må ikke arve 0 — 0 er højere end de
  // fleste fittede offsets, så en anchor-løs type (fx baroudeur) bliver de facto
  // dyrest og kan skride over top-stjernen (~189M > Pogačar). Fald i stedet
  // tilbage til det LAVESTE fittede offset (billigste tier) som konservativt default.
  const offsets = model.offset
    ? Object.values(model.offset).map(Number).filter(Number.isFinite)
    : [];
  const offsetFloor = offsets.length ? Math.min(...offsets) : 0;
  const offset = model.offset?.[type] ?? offsetFloor;
  const c = Number.isFinite(Number(model.c)) ? Number(model.c) : 0;
  let value = Math.exp(model.a + model.b * O + c * O * O + offset);
  // #1231 hard-band: ingen rytter må overstige top-anchorens forudsagte værdi
  // (value_cap i model-JSON). Belt-and-suspenders mod enhver type/offset-kombination
  // der ekstrapolerer over toppen. Bagudkompatibel: intet value_cap = ingen klamp.
  const cap = Number(model.value_cap);
  if (Number.isFinite(cap) && cap > 0 && value > cap) value = cap;

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
