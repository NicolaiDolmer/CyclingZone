// #3448 · Markedsmodel v1.1 — rene funktioner der udgør blend-mekanismen brugt af
// marketValueSundaySweep.js. Koefficienterne + guard-parametre bor i
// marketValueModelV1.json (fittet af backend/scripts/fitMarketValueModelV1.js mod
// 1.027 ægte handler, 6/8-2026 — se issue #3448's to kommentarer for fuld
// metode/beslutningsgrundlag).
//
// Fire byggesten, hver testet isoleret (marketValueModel.test.js):
//   1. predictMarketPrice(features, model) — den eksponentierede hedoniske model.
//   2. computeSupport(rider, salesIndex, guard) — "hvor meget handelsevidens findes
//      der nær denne rytter" (0-1), guard'en der forhindrer nul-evidens-segmenter
//      (elite/youth, jf. #2799) i at springe direkte til markedsmodellens gæt.
//   3. blendTarget(currentValue, marketPred, globalWeight, support) — vægtet
//      blanding mellem nuværende værdi og markedsmål.
//   4. applyWeeklyCap(current, target, cap) — clamp af ÉN uges bevægelse.
//
// Alle fire er RENE (ingen I/O, ingen Date.now()) — sweepen selv (der henter data
// + skriver) lever i marketValueSundaySweep.js.

import { ABILITY_KEYS } from "./riderTypes.js";

// Samme O-definition som fit-scriptet (meanAbilityScore) — IKKE riderValuation.js's
// vægtede outputScore (den er v3/v4-modellens egen O; markedsmodellen bruger et
// simpelt snit, jf. marketValueModelV1.json's "O_definition").
export function meanAbilityScore(abilities) {
  let sum = 0;
  let n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : null;
}

function offsetFor(type, offsetDict = {}) {
  const v = offsetDict[type];
  if (Number.isFinite(v)) return v;
  const known = Object.values(offsetDict).filter((x) => Number.isFinite(x));
  return known.length ? Math.min(...known) : 0;
}

/**
 * Eksponentieret hedonisk model: ln(price) = a + b·O + c·O² + d_age·age +
 * e_age2·age² + f_potentiale·potentiale + g_popularity·popularity +
 * h_is_youth·is_youth + offset[primary_type], derefter exp().
 *
 * `a_floor_shift` er et NIVEAU-anker: et additivt led i ln-rummet, dvs. en ren
 * multiplikator på hver forudsagt pris (exp(shift)). Det flytter hele
 * prisstigen op eller ned UDEN at ændre nogen relativ prissætning — rangorden,
 * type-offsets og alders-/evne-kurver er identiske før og efter.
 *
 * Hvorfor det er en ejer-knap og ikke et fittet tal (#3448, dry-run 7/8):
 * modellens skæringspunkt er fittet på 1.058 faktiske handler med median
 * 15.001 og MAKSIMUM 837.923. Men de handler er selekterede: en rytter til
 * 22,8 mio. har aldrig kunnet sælges, fordi intet hold har haft råd (median
 * holdsaldo 780.518). Modellen har altså aldrig set eliten handle og kan ikke
 * udtale sig om dens niveau — kun om den relative prissætning, som den er
 * markant bedre til end v4 (holdout MAE 56.118 vs. 119.571). Ankeret adskiller
 * de to: modellen bestemmer FORHOLDET mellem ryttere, ejeren bestemmer
 * NIVEAUET. Uden det afgør et OLS-skæringspunkt fittet på et censureret
 * datasæt hele spillets prisniveau.
 *
 * `model` er marketValueModelV1.json's `coefficients`-blok (eller kompatibel
 * shape). popularity_mode "residualized" understøttes IKKE her (kræver
 * fit-scriptets side-regression af popularity — v1.1's beslutning var
 * "keep_raw", se popularity_analysis.decision i modellen) — kastes eksplicit
 * hvis en fremtidig model sætter den, i stedet for at give et stille forkert tal.
 *
 * @param {{O:number, age:number, potentiale:number, popularity:number, is_youth?:boolean, primary_type:string}} features
 * @param {object} coef — marketValueModelV1.json.coefficients
 * @returns {number} forudsagt markedspris (CZ$, > 0)
 */
export function predictMarketPrice(features, coef) {
  const { O, age, potentiale, popularity = 0, is_youth = false, primary_type } = features || {};
  if (!Number.isFinite(O) || !Number.isFinite(age) || !Number.isFinite(potentiale)) {
    throw new Error("predictMarketPrice: O/age/potentiale skal være tal");
  }
  if (coef.popularity_mode === "residualized") {
    throw new Error("predictMarketPrice: popularity_mode 'residualized' er ikke understøttet i produktion (kræver fit-scriptets side-regression)");
  }
  const off = offsetFor(primary_type, coef.offset);
  // a_floor_shift lægges til i ln-rummet — se doc-kommentaren ovenfor. Fravær
  // eller et ugyldigt tal betyder "intet anker" (0), ALDRIG et gæt: en model
  // uden feltet skal opføre sig præcis som før feltet fandtes.
  const anchor = Number.isFinite(coef.a_floor_shift) ? coef.a_floor_shift : 0;
  let lnPrice = coef.a
    + anchor
    + coef.b * O
    + coef.c * O * O
    + coef.d_age * age
    + coef.e_age2 * age * age
    + coef.f_potentiale * potentiale
    + coef.h_is_youth * (is_youth ? 1 : 0)
    + off;
  if (coef.popularity_mode === "raw") {
    lnPrice += coef.g_popularity * (Number(popularity) || 0);
  }
  return Math.exp(lnPrice);
}

/**
 * Handelsevidens-tæthed nær rytteren (0-1). support = min(1, count_nearby / K),
 * count_nearby = antal salg i salesIndex med SAMME primary_type inden for
 * ±oWindow O-point OG ±ageWindow år.
 *
 * @param {{O:number, age:number, primary_type:string}} rider
 * @param {Array<{O:number, age:number, primary_type:string}>} salesIndex
 * @param {{oWindow?:number, ageWindow?:number, K:number}} guard
 * @returns {number} 0-1
 */
export function computeSupport(rider, salesIndex, { oWindow = 5, ageWindow = 3, K }) {
  if (!Number.isFinite(K) || K <= 0) throw new Error("computeSupport: K skal være et positivt tal");
  if (!rider || !Number.isFinite(rider.O) || !Number.isFinite(rider.age) || !rider.primary_type) return 0;
  let count = 0;
  for (const s of salesIndex || []) {
    if (s.primary_type !== rider.primary_type) continue;
    if (Math.abs(s.O - rider.O) > oWindow) continue;
    if (Math.abs(s.age - rider.age) > ageWindow) continue;
    count += 1;
  }
  return Math.min(1, count / K);
}

/**
 * Blandet mål: w = globalWeight × support; target = (1−w)·current + w·marketPred.
 * support=0 ⇒ target=current (ingen bevægelse, uanset globalWeight — guard'en
 * fastfryser uhandlede segmenter, jf. modellens guard.note).
 *
 * @returns {number}
 */
export function blendTarget(currentValue, marketPred, globalWeight, support) {
  const w = clamp01(globalWeight) * clamp01(support);
  return (1 - w) * Number(currentValue) + w * Number(marketPred);
}

/**
 * Clamp af ugentlig bevægelse: newVal ∈ [current×(1−cap), current×(1+cap)].
 * cap<=0 ⇒ ingen bevægelse (frosset). current<=0 ⇒ intet gyldigt udgangspunkt at
 * clampe fra — target returneres urørt (samme "intet at sammenligne imod"-logik
 * som transferPriceBand.getPriceBandViolation).
 */
export function applyWeeklyCap(current, target, cap) {
  const c = Number(current);
  if (!Number.isFinite(c) || c <= 0) return target;
  if (!Number.isFinite(cap) || cap <= 0) return c;
  const lo = c * (1 - cap);
  const hi = c * (1 + cap);
  return Math.min(hi, Math.max(lo, target));
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
