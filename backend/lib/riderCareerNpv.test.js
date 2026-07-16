import test from "node:test";
import assert from "node:assert/strict";

import { predictBaseValueV4, careerTrajectory, hazard, applyElitePremium, currentProductionValue } from "./riderCareerNpv.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAbilities(overrides = {}) {
  const a = {};
  for (const k of VISIBLE_ABILITIES) a[k] = 50;
  return { ...a, ...overrides };
}

function fixtureModel(overrides = {}) {
  return {
    version: 4,
    method: "sim-production-npv",
    fitted_at: "2026-07-13T00:00:00.000Z",
    sim_run_id: "test-fixture",
    K: 30,
    season_id: 1,
    prize_per_point: 75,
    beta_pt: 0,
    discount: 0.8,
    horizon_model: "survival-weighted",
    fit: {
      alpha: 0.5,
      a: 5,
      b: 0.05,
      c: 0,
      offset: {
        sprinter: 0, tt: 0, climber: 0, puncheur: 0,
        brostensrytter: 0, baroudeur: 0, rouleur: 0, gc: 0,
      },
      r2_log: 0.9,
      n_samples: 500,
    },
    scale: 1,
    scale_ref: { median_current_base_value: 0, median_v4_raw_npv: 0 },
    notes: "test fixture",
    ...overrides,
  };
}

// ── hazard() ──────────────────────────────────────────────────────────────────

test("hazard: 0 under vinduet, lineær i vinduet, 1 fra guaranteedAge og opefter", () => {
  assert.equal(hazard(30), 0);
  assert.equal(hazard(36), 0);
  assert.equal(hazard(38), 0.5);
  assert.equal(hazard(40), 1);
  assert.equal(hazard(45), 1);
});

// ── (1) Ung høj-potentiale rytter: fremskrivning HÆVER abilities tidligt ───────

test("ung høj-potentiale rytter: forventede abilities + produktion stiger de første sæsoner", () => {
  const rider = { id: "r-young", primary_type: "climber", potentiale: 6, age: 20 };
  // climbing/tempo/punch/endurance er climber-signatur (positiv vægt) → vokser mod loft.
  const abilities = makeAbilities({ climbing: 50, tempo: 50, punch: 50, endurance: 50 });
  const model = fixtureModel();

  const traj = careerTrajectory(rider, abilities, model);
  assert.ok(traj.length >= 3, "skal have flere sæsoner i trajectory");
  assert.ok(traj[1].O > traj[0].O, `O skal stige: ${traj[0].O} → ${traj[1].O}`);
  assert.ok(traj[1].prod > traj[0].prod, `prod skal stige: ${traj[0].prod} → ${traj[1].prod}`);
  assert.ok(traj[2].O > traj[1].O, `O skal blive ved at stige: ${traj[1].O} → ${traj[2].O}`);
});

// ── (2) Veteran: survival falder, S→0 ved 40, NPV domineret af nære sæsoner ────

test("veteran (37 år): survival falder monotont og trajectory stopper før alder 40", () => {
  const rider = { id: "r-vet", primary_type: "gc", potentiale: 3, age: 37 };
  const abilities = makeAbilities();
  const model = fixtureModel();

  const traj = careerTrajectory(rider, abilities, model);
  assert.ok(traj.length > 0, "skal have mindst én sæson");
  assert.ok(traj[traj.length - 1].age < 40, "sidste sæson skal være under 40 (garanteret retirement)");
  for (let i = 1; i < traj.length; i++) {
    assert.ok(traj[i].survival < traj[i - 1].survival, "survival skal falde monotont");
  }
  // NPV domineret af nære sæsoner: første termin's bidrag > alle senere terminer tilsammen.
  const total = traj.reduce((s, r) => s + r.discounted, 0);
  assert.ok(traj[0].discounted > total - traj[0].discounted,
    "første sæsons diskonterede bidrag skal dominere NPV'en");
});

test("garanteret retirement ved 40: en 39-årig rytter får højst 1 fremtidig sæson i trajectory", () => {
  const rider = { id: "r-old", primary_type: "sprinter", potentiale: 2, age: 39 };
  const abilities = makeAbilities();
  const traj = careerTrajectory(rider, abilities, fixtureModel());
  assert.ok(traj.length <= 2);
  assert.ok(traj.every((r) => r.age < 40));
});

// ── (3) Determinisme ────────────────────────────────────────────────────────

test("predictBaseValueV4 og careerTrajectory er deterministiske (samme input → samme output)", () => {
  const rider = { id: "r-det", primary_type: "puncheur", potentiale: 4, age: 25 };
  const abilities = makeAbilities({ punch: 65, tempo: 60 });
  const model = fixtureModel();

  const v1 = predictBaseValueV4(rider, abilities, model);
  const v2 = predictBaseValueV4(rider, abilities, model);
  assert.equal(v1, v2);
  assert.ok(Number.isFinite(v1) && v1 > 0);

  const t1 = careerTrajectory(rider, abilities, model);
  const t2 = careerTrajectory(rider, abilities, model);
  assert.deepEqual(t1, t2);
});

// ── (4) Monotoni: højere overall → højere base_value ───────────────────────────

test("højere overall abilities giver højere v4 base_value (monotoni)", () => {
  const model = fixtureModel();
  const weakRider = { id: "r-weak", primary_type: "rouleur", potentiale: 3, age: 26 };
  const strongRider = { id: "r-strong", primary_type: "rouleur", potentiale: 3, age: 26 };
  const weakAbilities = makeAbilities({ flat: 40, endurance: 40 });
  const strongAbilities = makeAbilities({ flat: 80, endurance: 80 });

  const weakValue = predictBaseValueV4(weakRider, weakAbilities, model);
  const strongValue = predictBaseValueV4(strongRider, strongAbilities, model);
  assert.ok(strongValue > weakValue, `stærk (${strongValue}) skal slå svag (${weakValue})`);
});

test("monotoni holder på tværs af et par forskellige arketyper (sprinter + gc)", () => {
  const model = fixtureModel();
  const weakSprinter = predictBaseValueV4(
    { id: "s-weak", primary_type: "sprinter", potentiale: 3, age: 24 },
    makeAbilities({ acceleration: 35, sprint: 35 }),
    model
  );
  const strongSprinter = predictBaseValueV4(
    { id: "s-strong", primary_type: "sprinter", potentiale: 3, age: 24 },
    makeAbilities({ acceleration: 85, sprint: 85 }),
    model
  );
  assert.ok(strongSprinter > weakSprinter);

  const weakGc = predictBaseValueV4(
    { id: "g-weak", primary_type: "gc", potentiale: 3, age: 24 },
    makeAbilities({ climbing: 35, time_trial: 35, recovery: 35, tempo: 35 }),
    model
  );
  const strongGc = predictBaseValueV4(
    { id: "g-strong", primary_type: "gc", potentiale: 3, age: 24 },
    makeAbilities({ climbing: 85, time_trial: 85, recovery: 85, tempo: 85 }),
    model
  );
  assert.ok(strongGc > weakGc);
});

// ── (5) Null-guards ─────────────────────────────────────────────────────────

test("predictBaseValueV4 returnerer null ved manglende/ugyldig model", () => {
  const rider = { id: "r1", primary_type: "gc", potentiale: 3, age: 25 };
  const abilities = makeAbilities();
  assert.equal(predictBaseValueV4(rider, abilities, null), null);
  assert.equal(predictBaseValueV4(rider, abilities, undefined), null);
  assert.equal(predictBaseValueV4(rider, abilities, {}), null); // ingen fit
  assert.equal(predictBaseValueV4(rider, abilities, { fit: {} }), null); // fit uden a/b
  assert.equal(predictBaseValueV4(rider, abilities, { fit: { a: 5 } }), null); // mangler b
  assert.equal(predictBaseValueV4(rider, abilities, { fit: { b: 0.05 } }), null); // mangler a
});

test("predictBaseValueV4 returnerer null når abilities er helt fraværende", () => {
  const rider = { id: "r1", primary_type: "gc", potentiale: 3, age: 25 };
  const model = fixtureModel();
  assert.equal(predictBaseValueV4(rider, {}, model), null);
  assert.equal(predictBaseValueV4(rider, null, model), null);
  assert.equal(predictBaseValueV4(rider, undefined, model), null);
});

test("careerTrajectory returnerer tomt array ved ugyldig model/abilities (ikke throw)", () => {
  const rider = { id: "r1", primary_type: "gc", potentiale: 3, age: 25 };
  assert.deepEqual(careerTrajectory(rider, makeAbilities(), null), []);
  assert.deepEqual(careerTrajectory(rider, {}, fixtureModel()), []);
});

test("predictBaseValueV4 falder tilbage til laveste offset for en type uden kalibreret offset (#1231-mønster)", () => {
  const rider = { id: "r1", primary_type: "ukendt-type", potentiale: 3, age: 25 };
  const model = fixtureModel({
    fit: {
      alpha: 0.5, a: 5, b: 0.05, c: 0,
      offset: { gc: Math.log(2), sprinter: Math.log(0.5) },
      r2_log: 0.9, n_samples: 500,
    },
  });
  const value = predictBaseValueV4(rider, makeAbilities(), model);
  const gcValue = predictBaseValueV4(
    { ...rider, primary_type: "gc" }, makeAbilities(), model
  );
  // ukendt type skal IKKE arve gc's høje offset (skal være billigere, ikke dyrere).
  assert.ok(value < gcValue);
});

// ── Elite-præmie (#2428) ───────────────────────────────────────────────────────

test("applyElitePremium: overall ≤ threshold er urørt", () => {
  const ep = { overall_threshold: 45, k: 0.08 };
  assert.equal(applyElitePremium(1000, 30, ep), 1000);
  assert.equal(applyElitePremium(1000, 45, ep), 1000);
});

test("applyElitePremium: overall > threshold ganges op (eksponentiel)", () => {
  const ep = { overall_threshold: 45, k: 0.08 };
  // overall 70 → value · exp(0.08·25) = value · exp(2) ≈ value · 7,389.
  assert.ok(Math.abs(applyElitePremium(1000, 70, ep) - 1000 * Math.exp(2)) < 1e-6);
  // højere overall → større præmie.
  assert.ok(applyElitePremium(1000, 70, ep) > applyElitePremium(1000, 60, ep));
});

test("applyElitePremium: k≤0 eller manglende premium → ingen præmie", () => {
  assert.equal(applyElitePremium(9999, 70, { overall_threshold: 45, k: 0 }), 9999);
  assert.equal(applyElitePremium(9999, 70, null), 9999);
});

test("applyElitePremium: monoton i BÅDE value og overall", () => {
  const ep = { overall_threshold: 45, k: 0.08 };
  assert.ok(applyElitePremium(1000, 60, ep) < applyElitePremium(2000, 60, ep)); // value
  assert.ok(applyElitePremium(1000, 50, ep) < applyElitePremium(1000, 65, ep)); // overall
});

test("applyElitePremium: elite-gulv garanterer minimum for overall ≥ floor_overall", () => {
  const ep = { overall_threshold: 45, k: 0.08, floor_overall: 58, floor: 8_000_000 };
  // lav-produktions elite-rytter (lille value) → løftes til gulvet.
  assert.equal(applyElitePremium(100_000, 60, ep), 8_000_000);
  // høj-produktions elite over gulvet → præmien vinder (ikke klemt ned til gulvet).
  assert.ok(applyElitePremium(50_000_000, 70, ep) > 8_000_000);
  // under floor_overall → intet gulv (kun præmie).
  assert.ok(applyElitePremium(100_000, 55, ep) < 8_000_000);
});

test("predictBaseValueV4: elite-præmie løfter høj-overall-rytter men ikke lav-overall", () => {
  const ep = { overall_threshold: 45, k: 0.1 };
  const rider = { primary_type: "climber", potentiale: 3, age: 26 };
  // høj overall (alle abilities ~90) → stor præmie.
  const eliteAb = makeAbilities(Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 90])));
  const base = predictBaseValueV4(rider, eliteAb, fixtureModel());
  const boosted = predictBaseValueV4(rider, eliteAb, fixtureModel({ elite_premium: ep }));
  assert.ok(boosted > base * 5, `boosted ${boosted} skal være >> base ${base}`);
  // lav overall (alle ~15, under tærsklen) → urørt.
  const weakAb = makeAbilities(Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 15])));
  const weakBase = predictBaseValueV4(rider, weakAb, fixtureModel());
  const weakBoosted = predictBaseValueV4(rider, weakAb, fixtureModel({ elite_premium: ep }));
  assert.equal(weakBoosted, weakBase);
});

// ── currentProductionValue (løn-base, #2428 løn-decoupling) ─────────────────────

test("currentProductionValue: er sæson-0-leddet — mindre end den fulde NPV (base_value)", () => {
  const rider = { id: "r", primary_type: "climber", potentiale: 4, age: 24 };
  const abilities = makeAbilities({ climbing: 60, tempo: 60, punch: 60, endurance: 60 });
  const model = fixtureModel();
  const cpv = currentProductionValue(rider, abilities, model);
  const base = predictBaseValueV4(rider, abilities, model);
  assert.ok(cpv > 0 && base > 0);
  assert.ok(cpv < base, `sæson-0 (${cpv}) skal være mindre end hele karrieren (${base})`);
});

test("currentProductionValue: talent har lavere løn/værdi-forhold end etableret rytter (decoupling)", () => {
  const model = fixtureModel();
  const ab = makeAbilities({ climbing: 60, tempo: 60, punch: 60, endurance: 60 });
  const young = { id: "y", primary_type: "climber", potentiale: 5, age: 20 };
  const established = { id: "e", primary_type: "climber", potentiale: 3, age: 31 };
  const ratioYoung = currentProductionValue(young, ab, model) / predictBaseValueV4(young, ab, model);
  const ratioOld = currentProductionValue(established, ab, model) / predictBaseValueV4(established, ab, model);
  assert.ok(ratioYoung < ratioOld,
    `talent-forhold (${ratioYoung.toFixed(3)}) skal være lavere end etableret (${ratioOld.toFixed(3)})`);
});

test("currentProductionValue: elite-præmie påvirker IKKE løn-basen (men påvirker værdien)", () => {
  const ep = { overall_threshold: 45, k: 0.1 };
  const rider = { id: "elite", primary_type: "climber", potentiale: 3, age: 26 };
  const eliteAb = makeAbilities(Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 90])));
  const cpvNoEp = currentProductionValue(rider, eliteAb, fixtureModel());
  const cpvEp = currentProductionValue(rider, eliteAb, fixtureModel({ elite_premium: ep }));
  assert.equal(cpvEp, cpvNoEp, "løn-base må ikke få elite-præmie");
  const baseNoEp = predictBaseValueV4(rider, eliteAb, fixtureModel());
  const baseEp = predictBaseValueV4(rider, eliteAb, fixtureModel({ elite_premium: ep }));
  assert.ok(baseEp > baseNoEp, "værdien SKAL få elite-præmie");
});

test("currentProductionValue: monoton i overall (stærk > svag)", () => {
  const model = fixtureModel();
  const weak = currentProductionValue(
    { primary_type: "rouleur", potentiale: 3, age: 26 }, makeAbilities({ flat: 40, endurance: 40 }), model);
  const strong = currentProductionValue(
    { primary_type: "rouleur", potentiale: 3, age: 26 }, makeAbilities({ flat: 80, endurance: 80 }), model);
  assert.ok(strong > weak, `stærk (${strong}) > svag (${weak})`);
});

test("currentProductionValue: deterministisk + null-guards", () => {
  const rider = { primary_type: "gc", potentiale: 3, age: 25 };
  const abilities = makeAbilities();
  const model = fixtureModel();
  assert.equal(currentProductionValue(rider, abilities, model), currentProductionValue(rider, abilities, model));
  assert.equal(currentProductionValue(rider, abilities, null), null);
  assert.equal(currentProductionValue(rider, {}, model), null);
  assert.equal(currentProductionValue(rider, abilities, { fit: {} }), null);
});
