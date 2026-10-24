// #6110 S25: tests for 10-saesoners-harnessens rene dele (ingen DB, ingen prod).
import { test } from "node:test";
import assert from "node:assert/strict";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { applyDailyTick, resolveProgram } from "../../lib/dailyTraining.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import {
  SIM_DEFAULTS, applyTickB, bNormalizer, birthdateForAge, capGainsPerDate, limitSnapshotTeams,
  milestoneStats, orderResults, quantile, raceSlot, runVariant, variantList,
} from "./tenSeasonSim6110.mjs";

const flatAbilities = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));

test("capGainsPerDate: klipper til +1 pr. evne pr. dato og baerer resten videre", () => {
  const abilities = { climbing: 40, sprint: 30 };
  const tickResult = {
    abilities: { climbing: 41, sprint: 31 }, progress: { climbing: 0.2, sprint: 0.5 }, gains: { climbing: 1, sprint: 1 },
  };
  const out = capGainsPerDate({ tickResult, abilities, usedGains: { climbing: 1 }, cap: 1 });
  assert.equal(out.abilities.climbing, 40, "climbing har allerede brugt datoens point");
  assert.equal(out.gains.climbing, undefined);
  assert.equal(out.progress.climbing, 1.2, "det klippede point ligger paa baren");
  assert.equal(out.abilities.sprint, 31, "sprint er urørt");
  assert.equal(tickResult.abilities.climbing, 41, "input muteres ikke");
  const same = capGainsPerDate({ tickResult, abilities, usedGains: {}, cap: 1 });
  assert.equal(same, tickResult, "uden klip returneres samme objekt");
});

test("raceSlot: deterministisk, andel 0 giver aldrig loeb, andel 1 altid", () => {
  assert.equal(raceSlot("r1", 5, 3, 0), null);
  const p = raceSlot("r1", 5, 3, 1);
  assert.equal(typeof p, "string");
  assert.equal(raceSlot("r1", 5, 3, 1), p);
  let hits = 0;
  for (let d = 1; d <= 2000; d++) if (raceSlot("r2", 6, d, 0.25)) hits++;
  assert.ok(hits > 400 && hits < 600, `ca. 25 % loebsdage (fik ${hits})`);
});

test("birthdateForAge: rammer sæson-alderen", () => {
  for (const age of [17, 18, 19, 30]) assert.equal(ageForSeason(birthdateForAge(age, 7), 7), age);
});

test("applyTickB: +1-loftet holder, hviledag giver intet, deterministisk", () => {
  const abilities = flatAbilities(20);
  const caps = flatAbilities(80);
  const args = {
    riderId: "r1", seedKey: "s#gd1", abilities, caps, progress: flatAbilities(0.9), program: resolveProgram(null, "climber"),
    potentiale: 6, staff: null, facilityTier: 0, riderLevel: "senior", primaryType: "climber", secondaryType: null,
    budgetDivisor: 1, hardDailyCap: 1, scale: 50, noiseSpan: 0.2, referenceAge: 23,
  };
  const out = applyTickB(args);
  for (const k of VISIBLE_ABILITIES) assert.ok((out.gains[k] ?? 0) <= 1, `${k} stiger hoejst 1`);
  assert.ok(Object.keys(out.gains).length > 0, "en stor skala giver gevinst");
  assert.deepEqual(applyTickB(args), out, "samme seed, samme udfald");
  const rest = applyTickB({ ...args, program: { focus: "endurance", intensity: "rest" } });
  assert.deepEqual(rest.gains, {});
});

test("bNormalizer: 1 for en bestand paa referencealderen, stoerre for unge", () => {
  assert.equal(bNormalizer([23, 23], 23), 1);
  assert.ok(bNormalizer([17, 18], 23) > 1);
  assert.equal(bNormalizer([], 23), 1);
});

test("milestoneStats: procent af top ved 22 og 25, kun baner der daekker 22-27", () => {
  const traj = (ratings, startAge) => ratings.map((rating, i) => ({ season: i, age: startAge + i, rating }));
  const riders = [
    { potentiale: 5, trajectory: traj([30, 40, 50, 60, 70, 80, 100, 90], 20) }, // 22 -> 50, 25 -> 80, top ved 26
    { potentiale: 2, trajectory: traj([10, 20], 22) }, // naar ikke 27: udelades
  ];
  const m = milestoneStats(riders);
  assert.equal(m.alle.n, 1);
  assert.equal(m.alle.pct22, 50);
  assert.equal(m.alle.pct25, 80);
  assert.equal(m.alle.peakAgeMedian, 26);
  assert.equal(m["pot5+"].n, 1);
});

test("quantile + orderResults + variantList", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
  const names = orderResults([{ variant: "B@1.25" }, { variant: "nu_maks1" }, { variant: "B@0.75" }, { variant: "nu" }]).map((r) => r.variant);
  assert.deepEqual(names, ["nu", "nu_maks1", "B@0.75", "B@1.25"]);
  const v = variantList({ ...SIM_DEFAULTS, variants: ["nu", "B"], bScales: [1, 2] }).map((x) => x.name);
  assert.deepEqual(v, ["nu", "B@1", "B@2"]);
});

// Lille syntetisk verden: hele kaeden (traening, aldring, pension, nye unge) koerer.
function syntheticSnapshot() {
  const teams = [
    { id: "t1", is_ai: false, is_bank: false, is_test_account: false, division: 1 },
    { id: "t2", is_ai: true, is_bank: false, is_test_account: false, division: 4 },
    { id: "bank", is_ai: true, is_bank: true, is_test_account: false, division: null },
  ];
  const types = ["climber", "sprinter", "puncheur", "rouleur"];
  const riders = [];
  const abilities = [];
  for (let i = 0; i < 24; i++) {
    const age = i === 23 ? 41 : 17 + (i % 20); // én over pensionsgarantien
    const id = `r${i}`;
    riders.push({
      id, birthdate: birthdateForAge(age, 4), potentiale: 1 + (i % 6), primary_type: types[i % 4], secondary_type: null,
      team_id: i < 10 ? "t1" : i < 20 ? "t2" : null, is_academy: false,
    });
    abilities.push({ rider_id: id, ...flatAbilities(15 + (i % 30)), ability_progress: {} });
  }
  return {
    takenAt: "test", season: { id: "s4", number: 4, race_days_total: 28, race_days_completed: 28 },
    riders, abilities, teams, staffByTeam: {}, load: { r0: { raceDays: 70, hardDays: 0 } },
  };
}

test("runVariant: kortet fyldes for en lille verden (nu og B)", () => {
  const opts = { ...SIM_DEFAULTS, seasons: 3, raceDaysPerSeason: 20 };
  for (const variant of variantList({ ...opts, variants: ["nu_maks1", "B"], bScales: [1] })) {
    const res = runVariant(syntheticSnapshot(), variant, opts);
    assert.equal(res.seasons.length, 3);
    assert.equal(res.transitions.length, 4, "første skifte + ét pr. simuleret sæson");
    assert.ok(res.start.rating.n > 0);
    assert.ok(res.seasons.at(-1).rating.n > 0);
    const retired = res.transitions.reduce((s, t) => s + t.retired, 0);
    assert.ok(retired > 0, "de ældste pensioneres");
  }
});

test("runVariant: et hold udvikler sig med dagens motor (samme tick som produktionen)", () => {
  const snap = syntheticSnapshot();
  const res = runVariant(snap, { name: "nu", kind: "nu", capPerDate: false }, { ...SIM_DEFAULTS, seasons: 1, raceDaysPerSeason: 40 });
  assert.ok(res.seasons[0].rating.mean >= res.start.rating.mean - 5, "ingen kollaps i første sæson");
  // Sanity: produktionens tick giver gevinst for en ung rytter langt under loftet.
  const ab = flatAbilities(10);
  const caps = buildCapsForRider(ab, { potentiale: 6, age: 18 }, "climber", null);
  let state = { abilities: ab, progress: {} };
  let gained = 0;
  for (let d = 0; d < 60; d++) {
    const r = applyDailyTick({
      riderId: "x", dateStr: null, tickSeedKey: `t#${d}`, age: 18, abilities: state.abilities, caps, progress: state.progress,
      program: resolveProgram(null, "climber"), conditionMult: 1, potentiale: 6, hardDailyCap: 1,
    });
    gained += Object.values(r.gains).reduce((s, n) => s + n, 0);
    state = r;
  }
  assert.ok(gained > 0);
});

test("limitSnapshotTeams: beholder kun de første aktive hold og deres ryttere", () => {
  const lim = limitSnapshotTeams(syntheticSnapshot(), 1);
  assert.deepEqual(lim.teams.map((t) => t.id), ["t1"]);
  assert.equal(lim.riders.length, 10);
  assert.equal(lim.abilities.length, 10);
});
