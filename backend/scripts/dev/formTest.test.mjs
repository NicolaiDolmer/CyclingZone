// #6818/#6156: formtestens vaerktoej (formTestData + formTestCaches + splitEntrants).
import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs as parseDataArgs, peakPlanDiagnostics } from "./formTestData.mjs";
import { parseArgs as parseCacheArgs, withForm } from "./formTestCaches.mjs";
import { splitEntrants } from "./lib/tourScorecard.mjs";

const cache = {
  race: { id: "r1" },
  entries: [{ rider_id: "a", team_id: "t1", race_role: "captain" }, { rider_id: "b", team_id: "t1", race_role: "helper" }],
  profiles: [{ stage_number: 1, profile_type: "flat" }, { stage_number: 2, profile_type: "mountain" }],
  teams: [{ id: "t1", is_ai: false }],
  abilities: [{ rider_id: "a", climbing: 70 }, { rider_id: "b", climbing: 50 }],
};
const formData = {
  format: "cz-form-test-data/v1",
  generatedAt: "2026-10-21T12:00:00Z",
  raceSeason: { r1: "s5" },
  conditions: { a: { form: 80 }, b: { form: 40 } },
  stageDays: { r1: { 1: 100, 2: 101 } },
  peaksBySeason: { s5: { a: [{ start: 99, end: 102, trainingQuality: 0.4 }] }, s4: { b: [{ start: 99, end: 102, trainingQuality: 1 }] } },
};

test("#6818 withForm: form, formtoppe fra loebets egen saeson og etapedage", () => {
  const out = withForm(cache, formData);
  assert.deepEqual(out.entries[0], { rider_id: "a", team_id: "t1", race_role: "captain", form: 80, peakWindows: [{ start: 99, end: 102, trainingQuality: 0.4 }] });
  // b har kun en S4-top: den naar aldrig et S5-loeb (#6158), men formen kommer med.
  assert.deepEqual(out.entries[1], { rider_id: "b", team_id: "t1", race_role: "helper", form: 40 });
  assert.deepEqual(out.profiles.map((p) => p.peakDay), [100, 101]);
  assert.equal(cache.entries[0].form, undefined, "input aendres ikke");
});

test("#6818 withForm: --peaks=off giver kun formen, --peaks=tq1 fuld traeningskvalitet", () => {
  assert.equal(withForm(cache, formData, "off").entries[0].peakWindows, undefined);
  assert.equal(withForm(cache, formData, "off").entries[0].form, 80);
  assert.equal(withForm(cache, formData, "tq1").entries[0].peakWindows[0].trainingQuality, 1);
});

test("#6818 withForm: en tidligere formtest-cache som input beholder ikke gamle felter (review #7021)", () => {
  const already = withForm(cache, formData, "on");
  const off = withForm(already, formData, "off");
  assert.equal(off.entries[0].peakWindows, undefined, "--peaks=off fjerner gamle toppe");
  const noDays = withForm(already, { ...formData, stageDays: {}, conditions: {} }, "on");
  assert.deepEqual(noDays.profiles.map((p) => p.peakDay), [undefined, undefined], "gamle etapedage fjernes");
  assert.equal(noDays.entries[1].form, undefined, "gammel form fjernes");
});

test("#6818 splitEntrants: form og formtoppe foelger med; uden dem er entrant'en som foer", () => {
  const plain = splitEntrants(cache).entrants;
  assert.deepEqual(Object.keys(plain[0]).sort(), ["abilities", "effort", "race_role", "rider_id", "team_id", "team_is_ai"]);
  const formed = splitEntrants(withForm(cache, formData)).entrants;
  assert.equal(formed[0].form, 80);
  assert.equal(formed[0].peakWindows.length, 1);
  assert.equal(formed[1].peakWindows, undefined);
});

test("#6818 peakPlanDiagnostics: S5-planer foer S5-start, maal i anden saeson, S4-vinduer der rager ind i S5", () => {
  const seasons = [{ id: "s4", number: 4, start_date: "2026-09-28", end_date: "2026-10-24" }, { id: "s5", number: 5, start_date: "2026-10-25", end_date: null }];
  const plans = [
    { season_id: "s5", target_race_id: "x5", window_start: "2026-10-26", window_end: "2026-10-28", created_at: "2026-10-20T10:00:00Z" },
    { season_id: "s5", target_race_id: "x5", window_start: "2026-10-26", window_end: "2026-10-28", created_at: "2026-10-26T10:00:00Z" },
    { season_id: "s4", target_race_id: "x5", window_start: "2026-10-22", window_end: "2026-10-26", created_at: "2026-10-01T10:00:00Z" },
    { season_id: "s4", target_race_id: null, window_start: "2026-10-01", window_end: "2026-10-02", created_at: "2026-09-30T10:00:00Z" },
  ];
  const d = peakPlanDiagnostics({ plans, seasons, raceSeason: new Map([["x5", "s5"]]) });
  assert.deepEqual(d, { perSeason: { 5: 2, 4: 2 }, s5PlansCreatedBeforeS5Start: 1, targetInOtherSeason: 1, targetMissing: 1, s4WindowsEndingAfterS4End: 1, s4WindowsEndingAfterS5Start: 1 });
});

test("#6818 begge scripts skriver kun under balance-internals (hard rule 17)", () => {
  assert.throws(() => parseDataArgs(["--from-dir=x", "--out=C:/tmp/f.json"]), /balance-internals/);
  assert.equal(parseDataArgs(["--from-dir=x", "--out=C:/Dev/CyclingZone/balance-internals/f.json"]).out.endsWith("f.json"), true);
  assert.throws(() => parseCacheArgs(["--from-dir=x", "--form-data=y", "--out-dir=C:/tmp/z"]), /balance-internals/);
  // Review #7021: et navn der blot INDEHOLDER ordet er ikke gitignoreret og afvises.
  assert.throws(() => parseDataArgs(["--from-dir=x", "--out=balance-internals.json"]), /balance-internals/);
  assert.throws(() => parseCacheArgs(["--from-dir=x", "--form-data=y", "--out-dir=tmp/balance-internals-copy/races"]), /balance-internals/);
  assert.throws(() => parseCacheArgs(["--from-dir=x", "--form-data=y", "--out-dir=balance-internals/z", "--peaks=maybe"]), /--peaks/);
});
