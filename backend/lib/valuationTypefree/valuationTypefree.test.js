// #5497 — vagter for det typefri værdiforslag (dev-only).
//
// Tre egenskaber ejeren har bestilt eksplicit:
//   1. Identiske ryttere med kun typebyte → identisk værdi (og prognose).
//   2. Rolle-tie-glathed: ét evnepoint må ikke give spring.
//   3. v4-paritet: prognosen ændrer KUN kilden til speciale-graden.
// Plus markedskomponentens misbrugsfilter og niveau-lås.
//
// Alle tal her er syntetiske test-parametre, ikke fittede balance-tal.

import test from "node:test";
import assert from "node:assert/strict";

import { VISIBLE_ABILITIES } from "../abilityDerivation.js";
import { expectedNextAbilities } from "../riderCareerNpv.js";
import { PROGRESSION_CONFIG, buildCaps, signatureFactor } from "../riderProgression.js";
import { DISPLAY_RECIPE_KEYS } from "../weights/displayRecipes.js";
import {
  TERRAIN_KEYS,
  effectiveOutput,
  productionFromOutput,
  softBest,
  terrainRatings,
} from "./abilityProduction.js";
import { buildCapsTypefree, capFactorFromSig, headroomBudget, profileSignature, stepTypefree } from "./careerTypefree.js";
import { fitTypefreeProduction } from "./fitProduction.js";
import { fitCommon, fitLocal, marketAdjustedValue, qualifyMarketEvidence } from "./marketComponent.js";
import {
  ELITE_PREMIUM_PHASE_STEPS,
  elitePremiumPhaseFactor,
  phasedElitePremium,
  predictBaseValueTypefree,
  simulateCareerTypefree,
} from "./typefreeValuation.js";

const TEST_PROD = {
  shares: { sprinter: 1, tt: 1, climber: 1, puncheur: 1, brostensrytter: 1, rouleur: 1, baroudeur: 1, gc: 1 },
  beta: 0.3,
  alpha: 0.8,
  a: 2,
  b: 0.08,
  c: -0.0002,
};
const TEST_MODEL = {
  production: TEST_PROD,
  discount: 0.8,
  scale: 1,
  level_correction: 1,
  profile: { ref_sd: 0.5, width_sd: 0.5, width_floor: 2 },
  elite_premium: { overall_threshold: 60, k: 0.1, floor: 1e9, floor_overall: 70 },
};

function abilitiesFrom(seed) {
  const ab = {};
  let x = seed;
  for (const k of VISIBLE_ABILITIES) {
    x = (x * 1103515245 + 12345) % 2147483648;
    ab[k] = 20 + (x % 60);
  }
  return ab;
}

test("typebyte: identisk værdi og prognose uanset primary_type/valuation_type/best_role", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const ab = abilitiesFrom(seed);
    const values = new Set();
    const trajectories = new Set();
    for (const t of [...DISPLAY_RECIPE_KEYS, null, "ukendt"]) {
      const rider = { age: 17 + (seed % 20), potentiale: 1 + (seed % 6), primary_type: t, valuation_type: t, best_role: t };
      values.add(predictBaseValueTypefree(rider, ab, TEST_MODEL));
      trajectories.add(JSON.stringify(simulateCareerTypefree(rider, ab, TEST_MODEL).trajectory));
    }
    assert.equal(values.size, 1, `seed ${seed}: værdi afhænger af type`);
    assert.equal(trajectories.size, 1, `seed ${seed}: prognose afhænger af type`);
  }
});

test("glathed: +1 på én evne flytter O_tf højst med den største opskriftsvægt-andel", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const ab = abilitiesFrom(seed);
    const o0 = effectiveOutput(ab, TEST_PROD);
    for (const k of VISIBLE_ABILITIES) {
      const up = { ...ab, [k]: ab[k] + 1 };
      const d = effectiveOutput(up, TEST_PROD) - o0;
      assert.ok(d >= -1e-12, `${k}: flere evner må ikke sænke output`);
      assert.ok(d <= 0.5, `${k}: spring ${d}`);
    }
  }
});

test("rolle-tie: to lige gode terræner — ét evnepoint giver ingen diskontinuitet", () => {
  // Byg en rytter hvor sprinter- og climber-egnethed er (næsten) ens.
  const ab = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 40]));
  ab.sprint = 70; ab.acceleration = 70; ab.climbing = 70;
  const R = terrainRatings(ab);
  const iS = TERRAIN_KEYS.indexOf("sprinter");
  const iC = TERRAIN_KEYS.indexOf("climber");
  assert.ok(Math.abs(R[iS] - R[iC]) < 10);
  const base = predictBaseValueTypefree({ age: 25, potentiale: 3 }, ab, TEST_MODEL);
  for (const k of ["sprint", "climbing", "acceleration"]) {
    const v = predictBaseValueTypefree({ age: 25, potentiale: 3 }, { ...ab, [k]: ab[k] + 1 }, TEST_MODEL);
    const rel = v / base - 1;
    assert.ok(rel >= 0 && rel < 0.25, `${k}: relativ ændring ${rel}`);
  }
});

test("softBest ligger mellem vægtet snit og maksimum", () => {
  const r = [30, 50, 70];
  const s = [1 / 3, 1 / 3, 1 / 3];
  const v = softBest(r, s, 0.3);
  assert.ok(v <= 70 && v >= 50);
  assert.equal(softBest(r, s, 0), 50);
});

test("produktion er monoton også når c < 0 (toppunkt-vagt)", () => {
  let prev = 0;
  for (let o = 0; o <= 400; o += 5) {
    const p = productionFromOutput(o, { a: 1, b: 0.1, c: -0.001 });
    assert.ok(p >= prev - 1e-9);
    prev = p;
  }
});

test("v4-paritet: med v4's type-faktorer regner stepTypefree bit-identisk med expectedNextAbilities", () => {
  for (const type of DISPLAY_RECIPE_KEYS) {
    for (let seed = 1; seed <= 6; seed++) {
      const ab = abilitiesFrom(seed * 7);
      const potentiale = 1 + (seed % 6);
      const capsV4 = buildCaps(ab, type, potentiale);
      const sig = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, signatureFactor(type, k) >= 1 ? 1 : 0]));
      const capsTf = buildCapsTypefree(ab, sig, potentiale, { factorFn: (_s, k) => signatureFactor(type, k) });
      assert.deepEqual(capsTf, capsV4);
      for (const age of [18, 24, 28, 31, 35]) {
        const v4 = expectedNextAbilities(ab, capsV4, { primary_type: type, potentiale, age });
        const tf = stepTypefree(ab, capsTf, sig, { potentiale, age });
        assert.deepEqual(tf, v4, `${type} alder ${age}`);
      }
    }
  }
});

test("profil-signatur er glat: +1 flytter sig for evnen med under 0,2", () => {
  const ab = abilitiesFrom(3);
  const s0 = profileSignature(ab);
  for (const k of VISIBLE_ABILITIES) {
    const s1 = profileSignature({ ...ab, [k]: ab[k] + 1 });
    assert.ok(Math.abs(s1[k] - s0[k]) < 0.2, k);
  }
  assert.ok(PROGRESSION_CONFIG.offTypeHeadroomFactor > 0);
});

test("v2 reference uden evnen selv: +1 flytter ikke evnens egen reference og hæver altid dens speciale-grad", () => {
  const prof = { ref_sd: 0.3, width_sd: 1.5, width_floor: 3 };
  for (let seed = 1; seed <= 30; seed++) {
    const ab = abilitiesFrom(seed);
    const s0 = profileSignature(ab, prof);
    for (const k of VISIBLE_ABILITIES) {
      const s1 = profileSignature({ ...ab, [k]: ab[k] + 1 }, prof);
      assert.ok(s1[k] > s0[k], `${k}: egen speciale-grad skal stige`);
      // Referencen for k er uændret, så z stiger med præcis 1/bredde.
      const z = (p) => Math.log(p / (1 - p));
      const others = VISIBLE_ABILITIES.filter((b) => b !== k).map((b) => ab[b]);
      const m = others.reduce((a, b) => a + b, 0) / others.length;
      const sd = Math.sqrt(others.reduce((a, b) => a + (b - m) ** 2, 0) / others.length);
      assert.ok(Math.abs(z(s1[k]) - z(s0[k]) - 1 / Math.max(sd * prof.width_sd, prof.width_floor)) < 1e-9, k);
    }
  }
  const ab = abilitiesFrom(5);
  assert.notDeepEqual(profileSignature(ab, { ...prof, reference: "including_self" }), profileSignature(ab, prof));
  assert.throws(() => profileSignature(ab, { reference: "type" }), RangeError);
});

test("v2 loft kun for styrker: en tydelig svaghed får næsten intet loft, v1 gav den mellemniveauet", () => {
  const ab = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50]));
  ab.climbing = 80; ab.tempo = 75; ab.sprint = 15;
  const prof = { ref_sd: 0.3, width_sd: 1.5, width_floor: 3 };
  const sig = profileSignature(ab, prof);
  const v2 = buildCapsTypefree(ab, sig, 6);
  const v1 = buildCapsTypefree(ab, sig, 6, { headroom: "off_floor" });
  assert.ok(v2.sprint - ab.sprint <= Math.ceil(0.15 * 38), `svaghed: ${v2.sprint - ab.sprint}`);
  assert.ok(v2.sprint - ab.sprint < v1.sprint - ab.sprint, "v2 giver svagheden mindre loft end v1");
  assert.ok(v1.sprint - ab.sprint >= Math.floor(38 * PROGRESSION_CONFIG.offTypeHeadroomFactor), "v1: mindst mellemniveau");
  assert.ok(v2.climbing - ab.climbing > v2.flat - ab.flat, "styrken får mest loft");
  assert.throws(() => capFactorFromSig(0.5, PROGRESSION_CONFIG, "alle"), RangeError);
  const b2 = headroomBudget(ab, prof);
  const b1 = headroomBudget(ab, { ...prof, headroom: "off_floor" });
  assert.ok(b2 > 0 && b2 < b1 && b1 <= 1, `budget v2 ${b2} < v1 ${b1}`);
});

test("typefri fremskrivning giver endelige evner i hele karrieren (regressionsvagt)", () => {
  const ab = abilitiesFrom(11);
  const sig = profileSignature(ab);
  const caps = buildCapsTypefree(ab, sig, 4);
  for (const v of Object.values(caps)) assert.ok(Number.isFinite(v), "loft skal være endeligt");
  const r = simulateCareerTypefree({ age: 18, potentiale: 4 }, ab, TEST_MODEL);
  for (const row of r.trajectory) assert.ok(Number.isFinite(row.O) && row.O > 0, `O i sæson ${row.s}`);
  assert.ok(r.trajectory[4].O > r.trajectory[0].O, "en ung rytter med potentiale skal udvikle sig");
});

test("elitegulvet er væk: kun den konvekse præmie virker", () => {
  const ab = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 75]));
  const v = predictBaseValueTypefree({ age: 27, potentiale: 3 }, ab, TEST_MODEL);
  assert.ok(v < TEST_MODEL.elite_premium.floor, "gulvet må ikke løfte værdien");
});

test("elitepræmien udfases i fire lige trin, ét pr. søndagskørsel, og bliver på nul", () => {
  assert.deepEqual([...ELITE_PREMIUM_PHASE_STEPS], [1, 0.75, 0.5, 0.25, 0]);
  const seen = [0, 1, 2, 3, 4, 5, 12].map((n) => elitePremiumPhaseFactor(n));
  assert.deepEqual(seen, [1, 0.75, 0.5, 0.25, 0, 0, 0]);
  for (const bad of [-3, Number.NaN, null, undefined, "x"]) assert.equal(elitePremiumPhaseFactor(bad), 1, `input ${bad}`);
  assert.equal(elitePremiumPhaseFactor(1.9), 0.75, "delvise uger runder ned");
  assert.throws(() => elitePremiumPhaseFactor(1, [1, 2]), RangeError);
  const prem = { overall_threshold: 60, k: 0.1, floor: 1e9 };
  assert.equal(phasedElitePremium(prem, 2).k, 0.05);
  assert.equal(phasedElitePremium(prem, 2).overall_threshold, 60, "tærsklen røres ikke");
  assert.equal(prem.k, 0.1, "input muteres ikke");
});

test("elitepræmie-trin: værdien falder monotont trin for trin og ender på præstationsværdien", () => {
  const ab = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 75]));
  const rider = { age: 27, potentiale: 3 };
  const values = [0, 1, 2, 3, 4].map((n) =>
    predictBaseValueTypefree(rider, ab, { ...TEST_MODEL, elite_premium: phasedElitePremium(TEST_MODEL.elite_premium, n) }));
  for (let i = 1; i < values.length; i++) assert.ok(values[i] < values[i - 1], `trin ${i}`);
  assert.equal(values[4], predictBaseValueTypefree(rider, ab, TEST_MODEL, { premium: false }));
  // Under tærsklen gør trinnene ingenting.
  const low = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 40]));
  const lows = new Set([0, 4].map((n) =>
    predictBaseValueTypefree(rider, low, { ...TEST_MODEL, elite_premium: phasedElitePremium(TEST_MODEL.elite_premium, n) })));
  assert.equal(lows.size, 1);
});

test("fit er deterministisk og genfinder en kendt typefri sammenhæng", () => {
  const samples = [];
  for (let seed = 1; seed <= 300; seed++) {
    const ab = abilitiesFrom(seed);
    const O = effectiveOutput(ab, TEST_PROD);
    samples.push({ abilities: ab, e_prize: Math.exp(1 + 0.1 * O) });
  }
  const f1 = fitTypefreeProduction(samples, { maxIter: 400 });
  const f2 = fitTypefreeProduction(samples, { maxIter: 400 });
  assert.deepEqual(f1, f2);
  assert.ok(f1.r2_log > 0.95, `r2 ${f1.r2_log}`);
});

// ── Markedskomponent ─────────────────────────────────────────────────────────
const H = new Set(["A", "B", "C", "D", "E", "F"]);
const day = (d) => new Date(Date.UTC(2026, 7, d)).toISOString();

test("misbrugsfilter: gentagne par, ensrettet par og prisafvigelse udelukkes", () => {
  const obs = [];
  // Ensrettet kanal A→B: 4 handler på 4 dage, altid til B.
  for (let d = 1; d <= 4; d++) obs.push({ id: `ab${d}`, kind: "transfer", at: day(d), price: 100, base: 100, seller: "A", buyer: "B" });
  // Normale handler.
  obs.push({ id: "c1", kind: "transfer", at: day(5), price: 110, base: 100, seller: "C", buyer: "D" });
  obs.push({ id: "e1", kind: "auction", at: day(6), price: 90, base: 100, seller: null, buyer: "E", distinctEligibleBidders: 3 });
  // Prisafvigelse (langt over båndet).
  obs.push({ id: "x1", kind: "transfer", at: day(7), price: 5000, base: 100, seller: "E", buyer: "F" });
  // Ingen konkurrence.
  obs.push({ id: "n1", kind: "auction", at: day(8), price: 100, base: 100, seller: null, buyer: "F", distinctEligibleBidders: 1 });
  // AI-sælger i forhandlet handel.
  obs.push({ id: "ai", kind: "transfer", at: day(9), price: 100, base: 100, seller: "AI1", buyer: "F" });
  const { qualified, funnel } = qualifyMarketEvidence(obs, { humanTeams: H });
  assert.deepEqual(qualified.map((o) => o.id).sort(), ["c1", "e1"]);
  assert.equal(funnel.dropped_repeat_pair, 4);
  assert.equal(funnel.dropped_price_outlier, 1);
  assert.equal(funnel.dropped_auction_no_competition, 1);
  assert.equal(funnel.dropped_transfer_not_human_to_human, 1);
});

test("fælles komponent: niveauet (skæringen) anvendes ikke", () => {
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push({ O: 30 + i, age: 20 + (i % 15), r: 0.7 });
  const common = fitCommon(rows, { lambda: 1 });
  assert.ok(Math.abs(common.gamma0 - 0.7) < 1e-6, "niveau-skel rapporteres");
  assert.ok(Math.abs(common.predict({ O: 50, age: 25 })) < 1e-6, "men flytter ikke priser");
});

test("lokal komponent krymper mod 0 uden evidens og er glat", () => {
  const keys = ["a", "b"];
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ abilities: { a: 50 + (i % 5), b: 50 }, age: 25, r: 0.5, O: 50 });
  const local = fitLocal(rows, { abilityKeys: keys, bandwidth: 0.5, k0: 3 });
  const near = local.predict({ abilities: { a: 52, b: 50 }, age: 25 });
  const far = local.predict({ abilities: { a: 5, b: 99 }, age: 38 });
  assert.ok(near > 0.3 && near < 0.5);
  assert.ok(Math.abs(far) < 1e-3);
  const step = Math.abs(local.predict({ abilities: { a: 53, b: 50 }, age: 25 }) - near);
  assert.ok(step < 0.05);
  assert.ok(local.evidence({ abilities: { a: 52, b: 50 }, age: 25 }) > 0.6);
});

test("markedsjustering respekterer loftet og vægt 0 = ingen effekt", () => {
  const common = { predict: () => 2 };
  const local = { predict: () => 1 };
  assert.equal(marketAdjustedValue(1000, {}, { common, local, weight: 0 }), 1000);
  const capped = marketAdjustedValue(1000, {}, { common, local, weight: 1, cap: Math.log(1.5) });
  assert.ok(Math.abs(capped - 1500) < 1e-6);
});
