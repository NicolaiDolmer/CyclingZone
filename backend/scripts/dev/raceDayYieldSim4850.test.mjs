import test from "node:test";
import assert from "node:assert/strict";
import {
  RACE_DAYS_PER_SEASON,
  SCENARIOS,
  isRaceDay,
  profileSequence,
  simulateRider,
  runSimulation,
} from "./raceDayYieldSim4850.mjs";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";

function rider(overrides = {}) {
  const abilities = {};
  for (const ability of VISIBLE_ABILITIES) abilities[ability] = 55;
  return {
    id: "sim-test",
    potentiale: 4,
    birthYear: 2006,
    primary_type: "climber",
    secondary_type: null,
    is_academy: false,
    form: 60,
    fatigue: 20,
    focus: "tempo",
    intensity: "normal",
    abilities,
    raceDays: 40,
    profiles: { mountain: 20, flat: 20 },
    ...overrides,
  };
}

test("#4850 sim: løbsdagene fordeles jævnt og tæller præcis raceDays", () => {
  for (const n of [0, 1, 37, 70, 140]) {
    let count = 0;
    for (let d = 0; d < RACE_DAYS_PER_SEASON; d += 1) if (isRaceDay(d, n)) count += 1;
    assert.equal(count, n);
  }
});

test("#4850 sim: profilerne flettes i S3-forholdet", () => {
  assert.deepEqual(profileSequence({ mountain: 2, flat: 1 }), ["mountain", "flat", "mountain"]);
  assert.deepEqual(profileSequence({}), ["rolling"]);
});

test("#4850 sim: S0 giver 0 point på løbsdagene, variant A giver point", () => {
  const s0 = simulateRider(rider(), "S0");
  const s1 = simulateRider(rider(), "S1");
  assert.equal(s0.raceDayGain, 0);
  assert.ok(s1.raceDayGain > 0);
  assert.ok(s1.gained > s0.gained);
});

test("#4850 sim: planen er ikke input i variant A (hvile-plan giver samme løbsdags-udbytte)", () => {
  // En rytter der KUN kører løb: alle dage er løbsdage, så planen bruges aldrig.
  const racer = { raceDays: RACE_DAYS_PER_SEASON };
  const withTempo = simulateRider(rider({ ...racer, focus: "tempo", intensity: "normal" }), "S1");
  const withRest = simulateRider(rider({ ...racer, focus: "tempo", intensity: "rest" }), "S1");
  assert.equal(withRest.raceDayGain, withTempo.raceDayGain);
  // Den gamle D2 (S4) bruger planen: en hvile-plan giver 0 på løbsdagene.
  assert.equal(simulateRider(rider({ ...racer, intensity: "rest" }), "S4").raceDayGain, 0);
});

test("#4850 sim: rapporten har alle scenarier og grupper", () => {
  const report = runSimulation([rider(), rider({ id: "b", raceDays: 0, birthYear: 1998 })]);
  for (const { key } of SCENARIOS) assert.ok(report.totals[key]);
  assert.equal(report.byAge.length, 4);
  assert.equal(report.byRaceDays.length, 4);
  assert.ok(report.s1RaceDayAbilitiesByProfile.mountain);
});
