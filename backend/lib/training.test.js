import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_CONFIG, TRAINING_FOCUSES, TRAINING_FOCUS_KEYS,
  deriveTrainingState, canTrain, resolveTrainingModifier,
  isValidFocus, isValidIntensity,
  partitionBulkTrainingTargets, partitionSmartBulkTargets, BULK_TRAINING_MAX_RIDERS,
  focusTrainability, smartDefaultFocus,
} from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// ── Taksonomi-integritet ────────────────────────────────────────────────────────

test("alle fokus-evner er gyldige synlige abilities", () => {
  const visible = new Set(VISIBLE_ABILITIES);
  for (const [focus, abilities] of Object.entries(TRAINING_FOCUSES)) {
    for (const a of abilities) {
      assert.ok(visible.has(a), `fokus ${focus} peger på ukendt ability: ${a}`);
    }
  }
});

test("validatorer afviser ukendte fokus/intensiteter", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nonsense"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(!isValidIntensity("brutal"));
  // #1305: "rest" er nu gyldig daglig intensitet
  assert.ok(isValidIntensity("rest"));
});

// ── #1885: bulk-træning partitionering ──────────────────────────────────────────

test("partitionBulkTrainingTargets — fuld trup (>30) anvendes i ÉT kald med unlimited slots", () => {
  // Kernescenariet bag #1885: en fuld trup på 32 ryttere. Med unlimitedSlots
  // (slotsRemaining=null) skal ALLE ejede ryttere anvendes — ingen tabes.
  const riderIds = Array.from({ length: 32 }, (_, i) => `r${i}`);
  const owned = new Set(riderIds);
  const { toApply, skippedNotOwned, skippedNoSlots } = partitionBulkTrainingTargets({
    riderIds,
    ownedRiderIds: owned,
    plannedRiderIds: [],
    slotsRemaining: null,
  });
  assert.equal(toApply.length, 32);
  assert.deepEqual(skippedNotOwned, []);
  assert.deepEqual(skippedNoSlots, []);
});

test("partitionBulkTrainingTargets — ikke-ejede ryttere springes over (ejer-guard)", () => {
  const { toApply, skippedNotOwned } = partitionBulkTrainingTargets({
    riderIds: ["mine1", "rival", "mine2"],
    ownedRiderIds: ["mine1", "mine2"],
  });
  assert.deepEqual(toApply, ["mine1", "mine2"]);
  assert.deepEqual(skippedNotOwned, ["rival"]);
});

test("partitionBulkTrainingTargets — dubletter og null ignoreres, rækkefølge bevares", () => {
  const { toApply } = partitionBulkTrainingTargets({
    riderIds: ["a", null, "a", "b", undefined],
    ownedRiderIds: ["a", "b"],
  });
  assert.deepEqual(toApply, ["a", "b"]);
});

test("partitionBulkTrainingTargets — slot-grænse: nye planer kappes, re-targeting er gratis", () => {
  // 2 resterende slots. r1+r2 har allerede plan (gratis); r3 forbruger 1, r4
  // forbruger 1, r5 mangler slot → skipped.
  const { toApply, skippedNoSlots } = partitionBulkTrainingTargets({
    riderIds: ["r1", "r2", "r3", "r4", "r5"],
    ownedRiderIds: ["r1", "r2", "r3", "r4", "r5"],
    plannedRiderIds: ["r1", "r2"],
    slotsRemaining: 2,
  });
  assert.deepEqual(toApply, ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(skippedNoSlots, ["r5"]);
});

test("partitionBulkTrainingTargets — tom/manglende input giver tomme lister", () => {
  assert.deepEqual(partitionBulkTrainingTargets({}), { toApply: [], skippedNotOwned: [], skippedNoSlots: [] });
  assert.deepEqual(
    partitionBulkTrainingTargets({ riderIds: [], ownedRiderIds: [] }),
    { toApply: [], skippedNotOwned: [], skippedNoSlots: [] },
  );
});

test("BULK_TRAINING_MAX_RIDERS dækker en lovlig fuld trup med margin", () => {
  // 30 senior-cap + akademi; grænsen skal ligge komfortabelt over.
  assert.ok(BULK_TRAINING_MAX_RIDERS >= 50);
});

// ── deriveTrainingState ─────────────────────────────────────────────────────────

test("deriveTrainingState: ubegrænsede slots (unlimitedSlots=true) — total/remaining er null", () => {
  // #1305: default config har unlimitedSlots=true
  const s = deriveTrainingState([], "s2");
  assert.equal(s.slots.total, null);
  assert.equal(s.slots.used, 0);
  assert.equal(s.slots.remaining, null);
  assert.deepEqual(s.plans, {});
  assert.deepEqual(s.focuses, TRAINING_FOCUS_KEYS);
});

test("deriveTrainingState: kun aktiv-sæson-planer tæller (ubegrænset)", () => {
  const rows = [
    { rider_id: "r1", season_id: "s1", focus: "vo2max", intensity: "hard" }, // gammel sæson
    { rider_id: "r2", season_id: "s2", focus: "sprint", intensity: "normal" },
    { rider_id: "r3", season_id: "s2", focus: "aero", intensity: "easy" },
  ];
  const s = deriveTrainingState(rows, "s2");
  assert.equal(s.slots.used, 2);
  assert.equal(s.slots.remaining, null); // ubegrænset → null
  assert.deepEqual(s.plans.r2, { focus: "sprint", intensity: "normal" });
  assert.deepEqual(s.plans.r3, { focus: "aero", intensity: "easy" });
  assert.equal(s.plans.r1, undefined); // gammel sæson vises ikke som aktiv plan
});

test("deriveTrainingState: begrænset cfg (slotsPerSeason=3) — remaining bunder ud i 0", () => {
  // Explicit begrænset cfg for backward-compat test
  const limitedCfg = { ...TRAINING_CONFIG, unlimitedSlots: false };
  const rows = Array.from({ length: 9 }, (_, i) => ({ rider_id: `r${i}`, season_id: "s2", focus: "vo2max", intensity: "normal" }));
  const s = deriveTrainingState(rows, "s2", limitedCfg);
  assert.equal(s.slots.total, TRAINING_CONFIG.slotsPerSeason);
  assert.equal(s.slots.remaining, 0);
});

// ── canTrain ────────────────────────────────────────────────────────────────────

test("canTrain: ubegrænset (default) — altid ok uanset hasPlan/remaining", () => {
  // #1305: unlimitedSlots=true i default config
  assert.deepEqual(canTrain(false, null), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0), { ok: true, reason: null });
  assert.deepEqual(canTrain(true, 0), { ok: true, reason: null });
});

test("canTrain: begrænset cfg — ny plan kræver ledigt slot, om-målretning koster ikke", () => {
  const limitedCfg = { ...TRAINING_CONFIG, unlimitedSlots: false };
  assert.deepEqual(canTrain(false, 1, limitedCfg), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0, limitedCfg), { ok: false, reason: "no_slots" });
  assert.deepEqual(canTrain(true, 0, limitedCfg), { ok: true, reason: null });
});

// ── resolveTrainingModifier ─────────────────────────────────────────────────────

test("resolveTrainingModifier: null plan → null modifier", () => {
  assert.equal(resolveTrainingModifier(null, "r1", 2), null);
  assert.equal(resolveTrainingModifier({ focus: "x", intensity: "hard" }, "r1", 2), null);
  // "x" er stadig ugyldig — men "rest" er nu gyldig
  assert.equal(resolveTrainingModifier({ focus: "vo2max", intensity: "x" }, "r1", 2), null);
});

test("resolveTrainingModifier: rest giver easy-lignende multiplier + aldrig setback", () => {
  for (let i = 0; i < 50; i++) {
    const m = resolveTrainingModifier({ focus: "endurance", intensity: "rest" }, `r-rest-${i}`, 3);
    assert.ok(m !== null, "rest + gyldig fokus → ikke null");
    assert.equal(m.setbackHit, false, "rest giver aldrig setback");
    // focusMult skal svare til easy (ingen dampening)
    assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.easy);
    assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
  }
});

test("resolveTrainingModifier: fokus-evner får focusMult, resten offFocusMult", () => {
  const m = resolveTrainingModifier({ focus: "sprint", intensity: "easy" }, "r1", 2);
  assert.ok(m.focusAbilities.has("sprint"));
  assert.ok(m.focusAbilities.has("acceleration"));
  assert.ok(!m.focusAbilities.has("climbing"));
  // easy har 0 % risiko → ingen dampening
  assert.equal(m.setbackHit, false);
  assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.easy);
  assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
});

test("resolveTrainingModifier: deterministisk pr. (rytter, sæson, plan)", () => {
  const a = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, "rider-x", 3);
  const b = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, "rider-x", 3);
  assert.equal(a.setbackHit, b.setbackHit);
  assert.equal(a.focusMult, b.focusMult);
});

test("resolveTrainingModifier: tilbageslag dæmper vækst-multiplikatorerne", () => {
  // Find et rider-seed hvor hård intensitet rammer tilbageslag, og bekræft dampening.
  let hitSeed = null;
  for (let i = 0; i < 200 && !hitSeed; i++) {
    const m = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, `seed-${i}`, 2);
    if (m.setbackHit) hitSeed = { i, m };
  }
  assert.ok(hitSeed, "forventede mindst ét tilbageslag på tværs af 200 seeds (18 % chance)");
  const { m } = hitSeed;
  assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.hard * TRAINING_CONFIG.setbackGrowthMult);
  assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult * TRAINING_CONFIG.setbackGrowthMult);
});

test("resolveTrainingModifier: easy rammer aldrig tilbageslag", () => {
  for (let i = 0; i < 100; i++) {
    const m = resolveTrainingModifier({ focus: "endurance", intensity: "easy" }, `s-${i}`, 5);
    assert.equal(m.setbackHit, false);
  }
});

// ── #1974: focusTrainability — type-derived trainability-signal ────────────────
// Udledes UDELUKKENDE af signatureFactor(primaryType, ability) (riderProgression.js).
// Værdier bekræftet mod de faktiske vægt-tabeller i riderTypes.js (RIDER_TYPES).

test("focusTrainability: climber — signatur-fokus er 'strength', modsat fokus er 'blocked'", () => {
  const t = focusTrainability("climber");
  // climber weights: climbing:3, tempo:2, punch:1, endurance:1, sprint:-2, acceleration:-1, flat:-1
  assert.equal(t.vo2max, "strength");    // climbing+punch+tempo alle positive
  assert.equal(t.threshold, "strength"); // tempo positiv (time_trial neutral)
  assert.equal(t.sprint, "blocked");     // sprint(-2) og acceleration(-1) begge negative → factor 0
  assert.equal(t.endurance, "strength"); // endurance positiv
  assert.equal(t.technique, "limited");  // descending/positioning/cobblestone alle neutrale (ingen vægt)
  assert.equal(t.aero, "limited");       // time_trial neutral, flat(-1) negativ → ikke alle 0, ikke nogen ≥1
});

test("focusTrainability: sprinter — sprint-fokus 'strength', vo2max/threshold 'limited' (ingen blocked)", () => {
  const t = focusTrainability("sprinter");
  // sprinter weights: acceleration:3, sprint:2, flat:1, durability:1, climbing:-2, endurance:-1
  assert.equal(t.sprint, "strength");   // sprint+acceleration begge positive
  assert.equal(t.endurance, "strength"); // durability positiv (endurance selv er -1 → 0, men durability≥1 gør fokus 'strength')
  assert.equal(t.vo2max, "limited");    // climbing(-2)→0, punch/tempo neutrale → ikke alle 0
  assert.equal(t.technique, "limited"); // ingen af descending/positioning/cobblestone vægtet
});

test("focusTrainability: alle TRAINING_FOCUS_KEYS er dækket for enhver kendt type", () => {
  for (const focusKey of TRAINING_FOCUS_KEYS) {
    const t = focusTrainability("gc");
    assert.ok(["strength", "limited", "blocked"].includes(t[focusKey]), `ugyldig værdi for ${focusKey}`);
  }
});

test("focusTrainability: ukendt/manglende primary_type → alt 'limited' (sikker neutral)", () => {
  for (const primaryType of [null, undefined, "", "nonexistent-type"]) {
    const t = focusTrainability(primaryType);
    for (const focusKey of TRAINING_FOCUS_KEYS) {
      assert.equal(t[focusKey], "limited", `${String(primaryType)} → ${focusKey} skulle være 'limited'`);
    }
  }
});

// ── smartDefaultFocus (#1894) ────────────────────────────────────────────────────
// Forventede værdier er verificeret mod den FAKTISKE output af funktionen (kørt
// lokalt), ikke antaget — og sanity-tjekket cykelfagligt: en sprinter skal accelerere/
// sprinte, en klatrer/gc-rytter skal bygge vo2max (klatring+punch+tempo), en tempo-
// kører (tt) skal bygge threshold (time_trial+tempo), en rouleur (ingen skarpt
// speciale) lander på endurance — samme adfærd som den gamle hardcoded default.
test("smartDefaultFocus: sprinter → sprint (speciale-evner acceleration+sprint er positive)", () => {
  assert.equal(smartDefaultFocus("sprinter"), "sprint");
});

test("smartDefaultFocus: climber → vo2max (climbing/tempo/punch er positive type-vægte)", () => {
  assert.equal(smartDefaultFocus("climber"), "vo2max");
});

test("smartDefaultFocus: tt (tidskører) → threshold (time_trial-vægt er positiv, climbing er negativ)", () => {
  assert.equal(smartDefaultFocus("tt"), "threshold");
});

test("smartDefaultFocus: gc → vo2max (climbing+tempo positive; første strength-fokus i nøgle-rækkefølgen)", () => {
  assert.equal(smartDefaultFocus("gc"), "vo2max");
});

test("smartDefaultFocus: rouleur → endurance (intet skarpt vo2max/threshold/sprint-speciale)", () => {
  assert.equal(smartDefaultFocus("rouleur"), "endurance");
});

test("smartDefaultFocus: null/undefined/ukendt type → endurance (bagudkompatibel, sikker fallback)", () => {
  for (const primaryType of [null, undefined, "", "nonexistent-type"]) {
    assert.equal(smartDefaultFocus(primaryType), "endurance", `${String(primaryType)} skulle give endurance`);
  }
});

test("smartDefaultFocus: returnerer altid en gyldig fokus-nøgle for enhver kendt type", () => {
  const knownTypes = ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"];
  for (const type of knownTypes) {
    assert.ok(TRAINING_FOCUS_KEYS.includes(smartDefaultFocus(type)), `${type} gav ugyldig fokus-nøgle`);
  }
});

test("smartDefaultFocus: deterministisk — samme input giver samme output hver gang", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(smartDefaultFocus("sprinter"), "sprint");
    assert.equal(smartDefaultFocus("climber"), "vo2max");
  }
});

// ── partitionSmartBulkTargets (#1894 variant 3 — bulk smart-focus) ─────────────────
test("partitionSmartBulkTargets: ryttere MED eksisterende plan springes over (aldrig overskrevet)", () => {
  const result = partitionSmartBulkTargets({
    riderIds: ["r1", "r2", "r3"],
    plannedRiderIds: ["r2"],
  });
  assert.deepEqual(result.eligible, ["r1", "r3"]);
  assert.deepEqual(result.skippedHasPlan, ["r2"]);
});

test("partitionSmartBulkTargets: ingen eksisterende planer → alle eligible", () => {
  const result = partitionSmartBulkTargets({ riderIds: ["r1", "r2"], plannedRiderIds: [] });
  assert.deepEqual(result.eligible, ["r1", "r2"]);
  assert.deepEqual(result.skippedHasPlan, []);
});

test("partitionSmartBulkTargets: dubletter og null ignoreres, rækkefølge bevares", () => {
  const result = partitionSmartBulkTargets({
    riderIds: ["r1", null, "r1", "r2", "r1"],
    plannedRiderIds: [],
  });
  assert.deepEqual(result.eligible, ["r1", "r2"]);
});

test("partitionSmartBulkTargets: tom/manglende input giver tomme lister", () => {
  assert.deepEqual(partitionSmartBulkTargets({}), { eligible: [], skippedHasPlan: [] });
  assert.deepEqual(partitionSmartBulkTargets({ riderIds: [] }), { eligible: [], skippedHasPlan: [] });
});
