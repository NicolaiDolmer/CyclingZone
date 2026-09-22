// #5497 — samlet typefri grundværdi (DEV-ONLY forslag, ingen live-kaldesti).
//
// Samme karriere-NPV-skelet som v4 (riderCareerNpv.js simulateCareer), med de
// tre type-led skiftet ud:
//
//   v4:  prod_s = exp(a + b·O_s + c·O_s² + offset[type]),  O_s = outputScore(evner_s, type)
//        evner_s fremskrevet med type-lofter og type-fald
//   tf:  prod_s = exp(a + b·O_s + c·O_s²),                 O_s = effectiveOutput(evner_s)
//        evner_s fremskrevet med profil-lofter og profil-fald (careerTypefree.js)
//
//   grundværdi = niveau · præmie( skala · Σ_s diskonto^s · S_s · prod_s , overall_nu )
//
// Uændret fra v4: diskonto, overlevelse/pensions-hazard, potentiale-raten,
// alders-grænser, skala og niveau-korrektion (simulationsforankret krone-niveau,
// ejer 30/8 #3448 + #4449). Elite-GULVET er fjernet (ejer-valg 6: intet fast
// elitegulv); den konvekse præmie udfases i trin (ejer-valg 22/9, se nedenfor).
//
// Modellen tager en rytter { age, potentiale } og evner — og intet andet.
// primary_type / valuation_type / best_role læses ALDRIG.

import { ABILITY_KEYS, riderOverall } from "../riderValuation.js";
import { hazard } from "../riderCareerNpv.js";
import { effectiveOutput, productionFromOutput } from "./abilityProduction.js";
import { buildCapsTypefree, profileSignature, stepTypefree } from "./careerTypefree.js";

export const TYPEFREE_MODEL_ID_PROPOSAL = "v6-typefree";

// Ejer-valg 22/9 (valg 3 + 4): elitepræmien udfases i fire lige store trin, ét
// trin pr. søndagskørsel, så eliten efter fire uger er prissat på præstation
// alene. Kun præmien glider; resten af værdiskiftet sker på kørselsdagen.
// Trinnene er ejerens offentlige formulering i #5497 (fuld → tre fjerdedele →
// halv → en fjerdedel → ingen).
export const ELITE_PREMIUM_PHASE_STEPS = Object.freeze([1, 0.75, 0.5, 0.25, 0]);

// Faktor på præmiens k efter `runsSinceSwitch` søndagskørsler (0 = kørselsdagen).
// Ren funktion: ugyldigt/negativt input → første trin; efter sidste trin står
// den på sidste trin (ny normal).
export function elitePremiumPhaseFactor(runsSinceSwitch, steps = ELITE_PREMIUM_PHASE_STEPS) {
  const list = Array.isArray(steps) && steps.length ? steps.map(Number) : ELITE_PREMIUM_PHASE_STEPS;
  if (!list.every((s) => Number.isFinite(s) && s >= 0 && s <= 1)) throw new RangeError("elitePremiumPhaseFactor: steps must lie in [0, 1]");
  const n = Math.floor(Number(runsSinceSwitch));
  if (!Number.isFinite(n) || n <= 0) return list[0];
  return list[Math.min(n, list.length - 1)];
}

// Præmie-objekt med k skaleret til trinnet. Tærsklen røres ikke.
export function phasedElitePremium(premium, runsSinceSwitch, steps = ELITE_PREMIUM_PHASE_STEPS) {
  if (!premium) return premium;
  const k = Number(premium.k);
  return { ...premium, k: (Number.isFinite(k) ? k : 0) * elitePremiumPhaseFactor(runsSinceSwitch, steps) };
}

// Konveks elitepræmie UDEN gulv (floor/floor_overall ignoreres bevidst).
export function convexPremiumOnly(value, overall, premium) {
  if (!premium) return value;
  const threshold = Number(premium.overall_threshold);
  const k = Number(premium.k);
  const o = Number(overall);
  if (!(k > 0) || !Number.isFinite(threshold) || !Number.isFinite(o) || o <= threshold) return value;
  return value * Math.exp(k * (o - threshold));
}

export function simulateCareerTypefree(rider, abilities, model) {
  const prod = model?.production;
  if (!prod || !Number.isFinite(Number(prod.a)) || !Number.isFinite(Number(prod.b))) return null;
  if (!ABILITY_KEYS.some((k) => Number.isFinite(Number(abilities?.[k])))) return null;
  const age0 = Number(rider?.age);
  if (!Number.isFinite(age0)) return null;
  const potentiale = rider?.potentiale;
  const discount = Number.isFinite(Number(model.discount)) ? Number(model.discount) : 0.8;

  const sig = profileSignature(abilities, model.profile);
  const caps = buildCapsTypefree(abilities, sig, potentiale, { headroom: model.profile?.headroom ?? "strengths_only" });

  let ab = { ...abilities };
  let S = 1;
  let npv = 0;
  const trajectory = [];
  for (let s = 0; ; s++) {
    const age_s = age0 + s;
    // Samme løkke-grænser som v4 (#4876 totalitet: sæson 0 tæller altid).
    if (s > 25 || (s > 0 && age_s > 40) || !(S >= 1e-4)) break;
    const O_s = effectiveOutput(ab, prod);
    const prod_s = productionFromOutput(O_s, prod);
    if (prod_s == null) return null;
    const discounted = discount ** s * S * prod_s;
    npv += discounted;
    trajectory.push({ s, age: age_s, O: O_s, prod: prod_s, survival: S, discounted });
    ab = stepTypefree(ab, caps, sig, { potentiale, age: age_s });
    S *= 1 - hazard(age_s + 1);
  }
  return { npv, trajectory };
}

// Grundværdi (CZ$, heltal) uden markedskomponent.
export function predictBaseValueTypefree(rider, abilities, model, { premium = true } = {}) {
  const r = simulateCareerTypefree(rider, abilities, model);
  if (!r || !Number.isFinite(r.npv) || r.npv <= 0) return null;
  const scale = Number.isFinite(Number(model.scale)) ? Number(model.scale) : 1;
  const level = Number(model.level_correction) > 0 ? Number(model.level_correction) : 1;
  const raw = scale * r.npv;
  const v = premium ? convexPremiumOnly(raw, riderOverall(abilities), model.elite_premium) : raw;
  const out = Math.round(level * v);
  return Number.isFinite(out) ? Math.max(1, out) : null;
}

// Grundværdi på hvert trin af præmie-udfasningen i ÉN karriere-simulering.
// Identisk med predictBaseValueTypefree(…, { ...model, elite_premium:
// phasedElitePremium(model.elite_premium, i, steps) }) for hvert trin i.
export function predictBaseValueTypefreeByStep(rider, abilities, model, steps = ELITE_PREMIUM_PHASE_STEPS) {
  const r = simulateCareerTypefree(rider, abilities, model);
  if (!r || !Number.isFinite(r.npv) || r.npv <= 0) return steps.map(() => null);
  const scale = Number.isFinite(Number(model.scale)) ? Number(model.scale) : 1;
  const level = Number(model.level_correction) > 0 ? Number(model.level_correction) : 1;
  const raw = scale * r.npv;
  const overall = riderOverall(abilities);
  return steps.map((_, i) => {
    const out = Math.round(level * convexPremiumOnly(raw, overall, phasedElitePremium(model.elite_premium, i, steps)));
    return Number.isFinite(out) ? Math.max(1, out) : null;
  });
}

// Løn-grundlag (sæson-0-produktion, skaleret, uden præmie) — samme kontrakt som
// v4's currentProductionValue. Måles separat (rider_production_value_model).
export function currentProductionValueTypefree(rider, abilities, model) {
  const r = simulateCareerTypefree(rider, abilities, model);
  if (!r || !r.trajectory.length) return null;
  const scale = Number.isFinite(Number(model.scale)) ? Number(model.scale) : 1;
  const v = Math.round(scale * r.trajectory[0].prod);
  return Number.isFinite(v) && v > 0 ? v : null;
}
