// #3645 — tests for den rene logik bag cutover-værktøjet.
//
// Værktøjets hele pointe er at et rollback man ikke har prøvet, ikke er et
// rollback. Testene her dækker de porte der skal holde når scriptet kører mod en
// levende database: at planen kun rummer rækker der faktisk afviger (idempotens),
// at ryttere der er kommet til EFTER snapshottet aldrig kan blive rørt, og at
// tillids-vægtene renormaliserer i stedet for at straffe et manglende delmål.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backupTableName,
  buildCapsRestorePlan,
  capSum,
  consequenceTier,
  countBy,
  jsonEqual,
  mandateConfidenceFromSatisfactions,
  percentile,
  percentileSummary,
  topNMean,
} from "./cutover3645.js";

const KEYS = ["climbing", "sprint", "time_trial", "endurance"];

test("percentile: nærmeste-rang, ikke interpolation", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 0.1), 1);
  assert.equal(percentile(xs, 0.5), 5);
  assert.equal(percentile(xs, 0.9), 9);
  assert.equal(percentile(xs, 1), 10);
  assert.equal(percentile(xs, 0), 1);
  // Hvert svar er et tal der faktisk står i rækken.
  for (const p of [0, 0.25, 0.5, 0.75, 1]) assert.ok(xs.includes(percentile(xs, p)));
});

test("percentile: tom og enkelt-element", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([42], 0.9), 42);
});

test("percentileSummary muterer ikke input og filtrerer ikke-tal fra", () => {
  const input = [5, 1, 3, Number.NaN, null, 2, 4];
  const before = input.slice();
  const s = percentileSummary(input);
  assert.deepEqual(input, before);
  assert.equal(s.n, 5);
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  assert.equal(s.p50, 3);
  assert.equal(s.mean, 3);
});

test("percentileSummary på tom række giver nuller uden at kaste", () => {
  assert.deepEqual(percentileSummary([]), { n: 0, min: null, p10: null, p50: null, p90: null, max: null, mean: null });
});

test("capSum og topNMean regner kun på de opgivne nøgler", () => {
  const caps = { climbing: 70, sprint: 40, time_trial: 60, endurance: 50, hemmelig: 999 };
  assert.equal(capSum(caps, KEYS), 220);
  assert.equal(topNMean(caps, KEYS, 2), 65); // 70 og 60
  assert.equal(topNMean(caps, KEYS, 8), 55); // alle fire
  assert.equal(capSum(null, KEYS), 0);
  assert.equal(topNMean(null, KEYS, 8), 0);
});

test("jsonEqual er ligeglad med nøgle-rækkefølge, men ikke med værdier", () => {
  assert.ok(jsonEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }));
  assert.ok(!jsonEqual({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!jsonEqual({ a: 1 }, { a: 2 }));
  assert.ok(jsonEqual(null, null));
  assert.ok(!jsonEqual(null, {}));
  assert.ok(jsonEqual([1, 2], [1, 2]));
  assert.ok(!jsonEqual([1, 2], [2, 1]));
});

function snapRow(id, caps, progress = { v: 1 }) {
  return { rider_id: id, ability_caps: caps, ability_progress: progress };
}

test("buildCapsRestorePlan: kun afvigende rækker i planen (idempotens)", () => {
  const snapshotRows = [
    snapRow("a", { climbing: 70, sprint: 40, time_trial: 60, endurance: 50 }),
    snapRow("b", { climbing: 55, sprint: 55, time_trial: 55, endurance: 55 }),
  ];
  const liveRows = [
    // a har tabt loft (det race-day-flippet gør)
    snapRow("a", { climbing: 60, sprint: 40, time_trial: 55, endurance: 50 }),
    // b er urørt
    snapRow("b", { climbing: 55, sprint: 55, time_trial: 55, endurance: 55 }),
  ];
  const res = buildCapsRestorePlan({ snapshotRows, liveRows, abilityKeys: KEYS });
  assert.equal(res.plan.length, 1);
  assert.equal(res.plan[0].rider_id, "a");
  assert.equal(res.unchanged, 1);
  assert.equal(res.capsChanged, 1);
  assert.equal(res.progressChanged, 0);
  // levende minus snapshot: 205 - 220 = -15
  assert.equal(res.plan[0].deltaCapSum, -15);
  assert.ok(res.plan[0].deltaTop8 < 0);

  // Anden kørsel, hvor gendannelsen er sket: planen er tom.
  const efter = buildCapsRestorePlan({ snapshotRows, liveRows: snapshotRows, abilityKeys: KEYS });
  assert.equal(efter.plan.length, 0);
  assert.equal(efter.unchanged, 2);
});

test("buildCapsRestorePlan: ability_progress alene udløser en plan-række", () => {
  const caps = { climbing: 70, sprint: 40, time_trial: 60, endurance: 50 };
  const res = buildCapsRestorePlan({
    snapshotRows: [snapRow("a", caps, { v: 1 })],
    liveRows: [snapRow("a", caps, { v: 2 })],
    abilityKeys: KEYS,
  });
  assert.equal(res.plan.length, 1);
  assert.equal(res.capsChanged, 0);
  assert.equal(res.progressChanged, 1);
  // Ingen loft-ændring → deltaet må ikke forurene percentilerne.
  assert.equal(res.deltaCapSum.n, 0);
});

test("buildCapsRestorePlan: ryttere født efter snapshottet røres aldrig", () => {
  const res = buildCapsRestorePlan({
    snapshotRows: [snapRow("a", { climbing: 70 })],
    liveRows: [snapRow("a", { climbing: 60 }), snapRow("ny", { climbing: 30 })],
    abilityKeys: KEYS,
  });
  assert.deepEqual(res.extraInLive, ["ny"]);
  assert.deepEqual(res.plan.map((p) => p.rider_id), ["a"]);
});

test("buildCapsRestorePlan: rytter væk fra live rapporteres, ikke skrevet", () => {
  const res = buildCapsRestorePlan({
    snapshotRows: [snapRow("a", { climbing: 70 }), snapRow("vaek", { climbing: 50 })],
    liveRows: [snapRow("a", { climbing: 70 })],
    abilityKeys: KEYS,
  });
  assert.deepEqual(res.missingInLive, ["vaek"]);
  assert.equal(res.plan.length, 0);
});

test("mandateConfidence: 50/30/20 når alle tre planer findes", () => {
  const r = mandateConfidenceFromSatisfactions({ "1yr": 80, "3yr": 50, "5yr": 30 });
  // 0.5*80 + 0.3*50 + 0.2*30 = 40 + 15 + 6 = 61
  assert.equal(r.confidence, 61);
  assert.equal(r.weightCoverage, 1);
  assert.deepEqual(r.usedPlanTypes, ["1yr", "3yr", "5yr"]);
});

test("mandateConfidence: vægtene renormaliserer ved manglende plan", () => {
  // Kun 1yr og 3yr: (0.5*80 + 0.3*50) / 0.8 = 55/0.8 = 68.75 → 69
  const r = mandateConfidenceFromSatisfactions({ "1yr": 80, "3yr": 50 });
  assert.equal(r.confidence, 69);
  assert.equal(Math.round(r.weightCoverage * 100) / 100, 0.8);
  // Et manglende 5-årsmål må ALDRIG trække tilliden mod 0.
  assert.ok(r.confidence > 50);
});

test("mandateConfidence: intet grundlag giver null, ikke 0", () => {
  assert.equal(mandateConfidenceFromSatisfactions({}).confidence, null);
  assert.equal(mandateConfidenceFromSatisfactions({ "1yr": null }).confidence, null);
});

test("mandateConfidence: klamper til 0-100", () => {
  assert.equal(mandateConfidenceFromSatisfactions({ "1yr": 250 }).confidence, 100);
  assert.equal(mandateConfidenceFromSatisfactions({ "1yr": -50 }).confidence, 0);
});

test("consequenceTier rammer de uændrede tærskler", () => {
  const t = { SALARY_CAP: 40, SIGNING_RESTRICTION: 30, FORCED_LISTING: 15, SPONSOR_PULLOUT: 10, BONUS_OFFER: 75 };
  assert.equal(consequenceTier(9, t), "sponsor_pullout");
  assert.equal(consequenceTier(10, t), "forced_listing");
  assert.equal(consequenceTier(14, t), "forced_listing");
  assert.equal(consequenceTier(15, t), "signing_restriction");
  assert.equal(consequenceTier(29, t), "signing_restriction");
  assert.equal(consequenceTier(30, t), "salary_cap");
  assert.equal(consequenceTier(39, t), "salary_cap");
  assert.equal(consequenceTier(40, t), "none");
  assert.equal(consequenceTier(75, t), "none");
  assert.equal(consequenceTier(76, t), "bonus_offer");
  assert.equal(consequenceTier(null, t), null);
});

test("backupTableName følger repoets konvention", () => {
  assert.equal(backupTableName("rider_caps", 3591, "2026-08-13"), "rider_caps_3591_backup_20260813");
  assert.equal(backupTableName("cutover", 3645, "2026-08-23T10:00:00Z"), "cutover_3645_backup_20260823");
  assert.throws(() => backupTableName("x", 1, "ikke-en-dato"), /ugyldig dato/);
});

test("countBy sorterer faldende", () => {
  const rows = [{ k: "a" }, { k: "b" }, { k: "a" }, { k: "a" }, { k: "b" }, { k: "c" }];
  assert.deepEqual(countBy(rows, (r) => r.k), { a: 3, b: 2, c: 1 });
});
