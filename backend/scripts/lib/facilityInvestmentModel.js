// #1441 Fase 3 bølge A2 — facility-investerings-model (100% syntetisk, ingen I/O).
// Spec: 2026-07-05-economy-fase3-empire-design.md §2.3 (anti-optimal-path) + §2.4
// (tid-som-valuta) + §5 (gates). Alle funktioner tager et constants-bundle så
// kalibrerings-sweeps kan variere facility-tallene UDEN at røre prod-filen
// (backend/lib/facilityConstants.js) — samme princip som economyCalibrationOverrides.
import {
  FACILITY_TRACKS, MAX_FACILITY_TIER, FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP,
  STAFF_SALARY_BY_TIER, FACILITY_BASE_EFFECT, COMMERCIAL_MIN_PAYBACK_SEASONS,
} from "../../lib/facilityConstants.js";
import { staffUtilization } from "../../lib/facilityEngine.js";
import { SPONSOR_INCOME_BY_DIVISION } from "../../lib/economyConstants.js";

// ── ASSUMPTION: repræsentativ PRÆMIE-indkomst pr. division (ambitions-laget) ─────
// Samme proxy som moneySupplyScorecard.PRIZE_ESTIMATE_BY_DIVISION (ejer-reviewet for
// #1309): kompetent mid-table-hold. Facilitets-budgettet er OVERSKUDS-forbrug — driften
// (sponsor − løn − upkeep) er ~break-even by design, så det investérbare råderum ≈ præmien.
export const PRIZE_ESTIMATE_BY_DIVISION = Object.freeze({ 1: 160000, 2: 70000, 3: 25000 });

// ── Constants-bundle (default = prod-startkandidaterne) ──────────────────────────
export const DEFAULT_MODEL_CONSTANTS = Object.freeze({
  tracks: FACILITY_TRACKS,
  maxTier: MAX_FACILITY_TIER,
  price: FACILITY_TIER_PRICE,
  upkeep: FACILITY_TIER_UPKEEP,
  staffSalary: STAFF_SALARY_BY_TIER,
  effect: FACILITY_BASE_EFFECT,
  sponsorBase: SPONSOR_INCOME_BY_DIVISION,
  minPaybackSeasons: COMMERCIAL_MIN_PAYBACK_SEASONS,
});

// ── ASSUMPTION: leverage — hvor meget hvert spors bonus er "værd" (BLØDT input) ──
// Oversætter effekt-bonusser til en fælles CZ$-ækvivalent styrke-værdi pr. sæson, så
// spor kan sammenlignes i én proxy. Tallene er antagelser (effekt-hooks for scouting/
// medical/academy er ikke live endnu) — scorecardet udskriver sensitivitet ±50%, og
// anti-optimal-path-gaten skal holde over hele leverage-intervallet (robusthed).
//   training : bonus komposterer i rytterudvikling → resultater (høj leverage)
//   medical  : form-genopretning → flere point i tætte perioder (medium)
//   scouting : info-fordel → bedre køb/intake (indirekte — info konverterer IKKE
//              1:1 til resultater; justeret 0.8 → 0.3 i A2-kalibreringen: fuld
//              synlighed ≈ 80% af en sæsons præmie var urimelig højt for en ren
//              informations-fordel, se audit-rapporten §Antagelser)
//   academy  : forventet netto-værdi pr. ekstra slot pr. sæson (justeret 5000 →
//              900 i A2: 5k/slot/sæson antog at hvert intake-slot producerer
//              nær-startklar værdi hver sæson; et slot er en LOTTERISEDDEL på en
//              prospect med års modning — se audit-rapporten §Antagelser)
//   commercial: direkte CZ$ (bonus × sponsor-base) — ingen leverage-antagelse
export const DEFAULT_LEVERAGE = Object.freeze({
  training: 3.0,
  medical: 1.5,
  scouting: 0.3,
  academySlotValue: 900,
});

// Andel af sæson-budgettet der maksimalt må bindes i løbende facility-omkostninger
// (tier-upkeep + staff-løn). Guard mod at strategi-sim'en køber sig til insolvens.
export const RECURRING_CAP = 0.5;

// ── Investerings-strategier (rækkefølger) — spec §2.3 kræver ≥3 konkurrencedygtige ─
// null = "balanced": køb altid den billigste næste opgradering på tværs af spor.
export const STRATEGIES = Object.freeze({
  "training-first":   ["training", "academy", "medical", "scouting", "commercial"],
  "commercial-first": ["commercial", "training", "academy", "scouting", "medical"],
  "academy-first":    ["academy", "training", "scouting", "medical", "commercial"],
  "support-first":    ["medical", "scouting", "training", "academy", "commercial"],
  "balanced":         null,
});

// Delt bonus-formel med sweepbar effekt-tabel. staffUtilization importeres fra prod
// (facilityEngine) — drift-guard-testen sikrer paritet med effectiveBonus.
export function computeBonus(constants, track, facilityTier, staffTier) {
  const base = constants.effect[track]?.[facilityTier] ?? 0;
  return base * staffUtilization(staffTier);
}

export function strengthValuePerSeason(constants, leverage, track, facilityTier, staffTier, division) {
  const bonus = computeBonus(constants, track, facilityTier, staffTier);
  if (track === "commercial") return bonus * (constants.sponsorBase[division] || 0);
  if (track === "academy") return bonus * leverage.academySlotValue;
  return bonus * (leverage[track] ?? 1) * (PRIZE_ESTIMATE_BY_DIVISION[division] || 0);
}

function recurringCost(constants, tiers, staff) {
  let sum = 0;
  for (const t of constants.tracks) {
    sum += constants.upkeep[tiers[t]] || 0;
    if (staff[t] != null) sum += constants.staffSalary[staff[t]] || 0;
  }
  return sum;
}

// Vælg næste køb efter strategi: priorities = ordnet spor-liste (fyld ét spor ad
// gangen); null = balanced (billigste næste opgradering på tværs).
function nextPurchase(constants, priorities, tiers) {
  if (priorities) {
    for (const track of priorities) {
      if (tiers[track] < constants.maxTier) return { track, price: constants.price[tiers[track] + 1] };
    }
    return null;
  }
  let best = null;
  for (const track of constants.tracks) {
    if (tiers[track] >= constants.maxTier) continue;
    const price = constants.price[tiers[track] + 1];
    if (!best || price < best.price) best = { track, price };
  }
  return best;
}

// Simulér én strategi over N sæsoner. Budget = budgetShare × repræsentativ
// præmie-indkomst pr. division (overskuds-laget). budgetShare (default 1,0 = hele
// præmien) lader inflations-scorecardet modellere realistisk adoption (fx 0,6)
// UDEN duplikeret sim-logik — modellen er SSOT. Politik pr. sæson: (1) betal
// recurring, (2) køb næste opgradering i strategi-rækkefølgen mens der er råd,
// (3) opgradér staff (op til facilitets-tier) i prioritets-rækkefølge så længe
// recurring-cap'en holder, (4) akkumulér styrke-værdi. Deterministisk.
export function simulateStrategy({
  priorities, division, seasons = 10,
  constants = DEFAULT_MODEL_CONSTANTS, leverage = DEFAULT_LEVERAGE, budgetShare = 1.0,
}) {
  const budget = (PRIZE_ESTIMATE_BY_DIVISION[division] || 0) * budgetShare;
  const tiers = Object.fromEntries(constants.tracks.map((t) => [t, 0]));
  const staff = Object.fromEntries(constants.tracks.map((t) => [t, null]));
  let cash = 0, spent = 0, strength = 0;

  for (let s = 1; s <= seasons; s++) {
    // Indkomst: budget + kommerciel bonus-indkomst (den ENESTE effekt der er penge).
    cash += budget + strengthValuePerSeason(constants, leverage, "commercial", tiers.commercial, staff.commercial, division);
    cash -= recurringCost(constants, tiers, staff);

    // Køb opgraderinger mens der er råd og recurring-cap'en holder EFTER købet.
    for (;;) {
      const buy = nextPurchase(constants, priorities, tiers);
      if (!buy || buy.price > cash) break;
      const after = { ...tiers, [buy.track]: tiers[buy.track] + 1 };
      if (recurringCost(constants, after, staff) > RECURRING_CAP * budget) break;
      tiers[buy.track] += 1;
      cash -= buy.price;
      spent += buy.price;
    }

    // Staff: hæv mod facilitets-tier i prioritets-rækkefølge under recurring-cap'en.
    for (const track of priorities || constants.tracks) {
      while ((staff[track] ?? 0) < tiers[track]) {
        const cand = { ...staff, [track]: (staff[track] ?? 0) + 1 };
        if (recurringCost(constants, tiers, cand) > RECURRING_CAP * budget) break;
        staff[track] = cand[track];
      }
    }

    for (const track of constants.tracks) {
      strength += strengthValuePerSeason(constants, leverage, track, tiers[track], staff[track], division);
    }
  }
  return {
    strength: Math.round(strength), spent,
    recurring: recurringCost(constants, tiers, staff),
    endTiers: tiers, endStaff: staff,
  };
}

// §2.3-gaten: ≥3 strategier inden for ±10% af bedste langsigtede styrke-proxy.
export function runAntiOptimalPath({ division, seasons = 10, constants = DEFAULT_MODEL_CONSTANTS, leverage = DEFAULT_LEVERAGE }) {
  const results = Object.entries(STRATEGIES).map(([name, priorities]) => ({
    name, ...simulateStrategy({ priorities, division, seasons, constants, leverage }),
  }));
  const max = Math.max(...results.map((r) => r.strength));
  for (const r of results) r.competitive = r.strength >= 0.9 * max;
  return { results, max, competitiveCount: results.filter((r) => r.competitive).length };
}

// §2.1-anti-runaway-gaten: kommerciel payback pr. tier (marginal) + fuldt udbygget
// (kumulativ), med og uden staff. Payback = pris / netto-marginal-indkomst pr. sæson;
// Infinity når netto ≤ 0 (aldrig selvfinansierende = gate-PASS per definition).
export function computeCommercialPayback({ division, constants = DEFAULT_MODEL_CONSTANTS }) {
  const sponsor = constants.sponsorBase[division] || 0;
  const rows = [];
  for (const staffMode of ["none", "matched"]) {
    for (let tier = 1; tier <= constants.maxTier; tier++) {
      const staffAt = (t) => (staffMode === "matched" ? (t >= 1 ? t : null) : null);
      const grossDelta = (computeBonus(constants, "commercial", tier, staffAt(tier))
        - computeBonus(constants, "commercial", tier - 1, staffAt(tier - 1))) * sponsor;
      const upkeepDelta = (constants.upkeep[tier] || 0) - (constants.upkeep[tier - 1] || 0);
      const salaryDelta = staffMode === "matched"
        ? (constants.staffSalary[tier] || 0) - (tier >= 2 ? constants.staffSalary[tier - 1] || 0 : 0)
        : 0;
      const netDelta = grossDelta - upkeepDelta - salaryDelta;
      rows.push({
        tier, staffMode, grossDelta, netDelta,
        paybackSeasons: netDelta > 0 ? constants.price[tier] / netDelta : Infinity,
      });
    }
    // Fuldt udbygget (kumulativ): total capex / netto-indkomst ved tier 5.
    const cumPrice = [1, 2, 3, 4, 5].reduce((s, t) => s + constants.price[t], 0);
    const netAtFull = computeBonus(constants, "commercial", 5, staffMode === "matched" ? 5 : null) * sponsor
      - (constants.upkeep[5] || 0)
      - (staffMode === "matched" ? constants.staffSalary[5] || 0 : 0);
    rows.push({
      tier: "full", staffMode, grossDelta: null, netDelta: netAtFull,
      paybackSeasons: netAtFull > 0 ? cumPrice / netAtFull : Infinity,
    });
  }
  const finite = rows.map((r) => r.paybackSeasons).filter((p) => Number.isFinite(p));
  const minPayback = finite.length ? Math.min(...finite) : Infinity;
  return { rows, minPayback, pass: minPayback >= constants.minPaybackSeasons };
}

// §2.4-gaten: tier-priser i "sæsoner af repræsentativ præmie-indkomst" pr. division.
// Bånd forankret i spec-målene (T1 ≈ 0,5 · T3 ≈ 1 · T5 ≈ 2+), med kalibrerings-rum:
//   tier1/D3 ∈ [0.25, 1.0] · tier3-kumulativ/D2 ∈ [0.5, 2.0] · tier5-kumulativ/D1 ∈ [2.0, 6.0]
// (øvre T5-grænse = opnåelighed: skal kunne nås af et vedholdende D1-hold).
export const TIME_AS_CURRENCY_BANDS = Object.freeze({
  tier1_d3: { lo: 0.25, hi: 1.0 },
  tier3cum_d2: { lo: 0.5, hi: 2.0 },
  tier5cum_d1: { lo: 2.0, hi: 6.0 },
});

// ── Form-gates (§2.1-intent) — håndhæver kurve-FORMEN maskinelt ─────────────────
// Review-fund efter første A2-kalibrering (8235bc46): rene niveau-gates lod
// konstanterne degenerere (dublet-tiers, ×15-prishop, upkeep > pris, staff-løn
// uden relation til staff-værdi). Disse gates låser spec §2.1's intent:
//   1. Pris-trappe: monotone steps, price[t+1]/price[t] ∈ [1.5, 4] (ingen dubletter,
//      ingen anomalier).
//   2. Upkeep-andel: 5 sæsoners upkeep ved stop-tier T < kumulativ pris til T
//      ("engangs-pris + MINDRE løbende upkeep" — upkeep er det mindre sink).
//   3. Effekt-monotoni: strengt stigende pr. tier i alle tracks; hvert step ≥ 20%
//      af track'ets gennemsnitsstep (ingen de-facto-dublet-tiers).
//   4. Staff-relevans: staff-løn[t] ∈ [5%, 40%] af den styrke-værdi staffen tilfører
//      i D2 ved matched facilitets-tier (gennemsnit over tracks — én løn-tabel deler
//      alle roller). Hverken gratis eller prohibitiv. Beregnet via
//      strengthValuePerSeason med/uden staff (delta = marginal værdi af ansættelsen).
export const FORM_GATE_BANDS = Object.freeze({
  priceStep: { lo: 1.5, hi: 4 },
  upkeepHorizonSeasons: 5,
  effectStepMinShare: 0.2,
  staffSalaryShare: { lo: 0.05, hi: 0.40 },
  staffReferenceDivision: 2,
});

export function computeFormGates({ constants = DEFAULT_MODEL_CONSTANTS, leverage = DEFAULT_LEVERAGE }) {
  const B = FORM_GATE_BANDS;
  const gates = [];

  // 1. Pris-trappe
  for (let t = 1; t < constants.maxTier; t++) {
    const ratio = constants.price[t + 1] / constants.price[t];
    gates.push({
      group: "pris-trappe", key: `price t${t}→t${t + 1}`, value: ratio,
      lo: B.priceStep.lo, hi: B.priceStep.hi,
      pass: ratio >= B.priceStep.lo && ratio <= B.priceStep.hi,
    });
  }

  // 2. Upkeep-andel (upkeep = det mindre sink)
  let cum = 0;
  for (let t = 1; t <= constants.maxTier; t++) {
    cum += constants.price[t];
    const upkeep5 = B.upkeepHorizonSeasons * (constants.upkeep[t] || 0);
    gates.push({
      group: "upkeep-andel", key: `${B.upkeepHorizonSeasons}×upkeep[t${t}]/cumPris[t${t}]`,
      value: upkeep5 / cum, lo: 0, hi: 1, pass: upkeep5 < cum,
    });
  }

  // 3. Effekt-monotoni (ingen de-facto-dublet-tiers)
  for (const track of constants.tracks) {
    const eff = constants.effect[track];
    const steps = [];
    for (let t = 1; t <= constants.maxTier; t++) steps.push((eff[t] ?? 0) - (eff[t - 1] ?? 0));
    const meanStep = steps.reduce((a, b) => a + b, 0) / steps.length;
    const minStep = Math.min(...steps);
    gates.push({
      group: "effekt-monotoni", key: `${track} min-step/mean-step`,
      value: meanStep > 0 ? minStep / meanStep : -1,
      lo: B.effectStepMinShare, hi: Infinity,
      pass: minStep > 0 && meanStep > 0 && minStep >= B.effectStepMinShare * meanStep,
    });
  }

  // 4. Staff-relevans (D2, matched tier, delta-værdi af staffen, gennemsnit over tracks)
  const d = B.staffReferenceDivision;
  for (let t = 1; t <= constants.maxTier; t++) {
    const added = constants.tracks.map((track) =>
      strengthValuePerSeason(constants, leverage, track, t, t, d)
      - strengthValuePerSeason(constants, leverage, track, t, null, d));
    const meanAdded = added.reduce((a, b) => a + b, 0) / added.length;
    const share = meanAdded > 0 ? (constants.staffSalary[t] || 0) / meanAdded : Infinity;
    gates.push({
      group: "staff-relevans", key: `løn[t${t}]/staff-værdi (D${d})`, value: share,
      lo: B.staffSalaryShare.lo, hi: B.staffSalaryShare.hi, meanAdded,
      pass: share >= B.staffSalaryShare.lo && share <= B.staffSalaryShare.hi,
    });
  }

  return { gates, allPass: gates.every((g) => g.pass) };
}

export function computePriceInSeasons({ constants = DEFAULT_MODEL_CONSTANTS }) {
  let cum = 0;
  const table = [];
  for (let tier = 1; tier <= constants.maxTier; tier++) {
    cum += constants.price[tier];
    const seasons = {};
    for (const d of [1, 2, 3]) seasons[d] = cum / PRIZE_ESTIMATE_BY_DIVISION[d];
    table.push({ tier, price: constants.price[tier], cumPrice: cum, seasons });
  }
  const val = (tier, d) => table.find((x) => x.tier === tier).seasons[d];
  const gates = [
    { key: "tier1_d3", value: val(1, 3), ...TIME_AS_CURRENCY_BANDS.tier1_d3 },
    { key: "tier3cum_d2", value: val(3, 2), ...TIME_AS_CURRENCY_BANDS.tier3cum_d2 },
    { key: "tier5cum_d1", value: val(5, 1), ...TIME_AS_CURRENCY_BANDS.tier5cum_d1 },
  ].map((g) => ({ ...g, pass: g.value >= g.lo && g.value <= g.hi }));
  return { table, gates, allPass: gates.every((g) => g.pass) };
}
