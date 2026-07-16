import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeRiderValue } from "./riderValueRefresh.js";
import { computeRiderValueTrend, groupSnapshotsByRider } from "./riderValueTrend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));

const WEAK = { climbing: 40, time_trial: 38, prolog: 35, flat: 39, tempo: 38, sprint: 30, acceleration: 32, punch: 33, endurance: 41, recovery: 38, durability: 37, descending: 35, cobblestone: 28, positioning: 33, aggression: 33, tactics: 33 };
const STRONG = { climbing: 70, time_trial: 66, prolog: 60, flat: 68, tempo: 67, sprint: 50, acceleration: 55, punch: 58, endurance: 72, recovery: 68, durability: 65, descending: 62, cobblestone: 48, positioning: 60, aggression: 58, tactics: 58 };

// Midnat UTC (ikke middag) — snapshot_date-strenge parses som UTC-midnat, så
// dette holder actualDaysAgo som eksakte heltal i testene (ingen halv-dags-drift).
const NOW = new Date("2026-07-16T00:00:00Z");

function isoDaysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
}

test("computeRiderValueTrend: positiv delta når rytteren er blevet bedre siden snapshot", () => {
  const currentBaseValue = recomputeRiderValue({}, STRONG, baseline, model).base_value;
  const snapshotsAsc = [
    { snapshot_date: isoDaysAgo(20), abilities: WEAK },
    { snapshot_date: isoDaysAgo(14), abilities: WEAK },
    { snapshot_date: isoDaysAgo(7), abilities: STRONG },
    { snapshot_date: isoDaysAgo(1), abilities: STRONG },
  ];
  const windows = computeRiderValueTrend({ currentBaseValue, snapshotsAsc, baseline, model, now: NOW });
  assert.ok(windows[14].delta > 0, "14-dages-vindue skal vise positiv bevægelse (WEAK → STRONG)");
  assert.equal(windows[14].actualDaysAgo, 14);
  assert.ok(windows[7].delta >= 0, "7-dages-vindue: current==snapshot (begge STRONG) → ~0");
});

test("computeRiderValueTrend: null når historikken ikke rækker langt nok tilbage", () => {
  const currentBaseValue = recomputeRiderValue({}, STRONG, baseline, model).base_value;
  const snapshotsAsc = [{ snapshot_date: isoDaysAgo(3), abilities: STRONG }]; // kun 3 dages historik
  const windows = computeRiderValueTrend({ currentBaseValue, snapshotsAsc, baseline, model, now: NOW });
  assert.equal(windows[7], null, "intet snapshot 7 dage tilbage → ingen fabrikeret delta");
  assert.equal(windows[14], null, "intet snapshot 14 dage tilbage → ingen fabrikeret delta");
});

test("computeRiderValueTrend: null uden abilities/model/baseline (degraderer pænt)", () => {
  const windows = computeRiderValueTrend({ currentBaseValue: 100000, snapshotsAsc: [{ snapshot_date: isoDaysAgo(14), abilities: STRONG }], baseline: null, model, now: NOW });
  assert.equal(windows[14], null);
  const windows2 = computeRiderValueTrend({ currentBaseValue: null, snapshotsAsc: [{ snapshot_date: isoDaysAgo(14), abilities: STRONG }], baseline, model, now: NOW });
  assert.equal(windows2[14], null, "manglende current base_value → ingen delta");
});

test("computeRiderValueTrend: vælger nærmeste snapshot PÅ ELLER FØR target (aldrig fremtid)", () => {
  const currentBaseValue = recomputeRiderValue({}, STRONG, baseline, model).base_value;
  // Snapshot 10 dage tilbage (før 14-dages target) + et 2 dage tilbage (efter target).
  const snapshotsAsc = [
    { snapshot_date: isoDaysAgo(20), abilities: WEAK },
    { snapshot_date: isoDaysAgo(2), abilities: STRONG },
  ];
  const windows = computeRiderValueTrend({ currentBaseValue, snapshotsAsc, baseline, model, now: NOW });
  assert.equal(windows[14].snapshotDate, isoDaysAgo(20), "skal bruge det ÆLDSTE snapshot før target, ikke det nyeste efter");
  assert.equal(windows[14].actualDaysAgo, 20);
});

test("groupSnapshotsByRider: grupperer + sorterer ASC pr. rytter, ignorerer rækker uden rider_id", () => {
  const rows = [
    { rider_id: "r2", snapshot_date: isoDaysAgo(1), abilities: STRONG },
    { rider_id: "r1", snapshot_date: isoDaysAgo(5), abilities: WEAK },
    { rider_id: "r1", snapshot_date: isoDaysAgo(10), abilities: WEAK },
    { rider_id: null, snapshot_date: isoDaysAgo(1), abilities: WEAK },
  ];
  const map = groupSnapshotsByRider(rows);
  assert.equal(map.size, 2);
  const r1 = map.get("r1");
  assert.equal(r1.length, 2);
  assert.ok(new Date(r1[0].snapshot_date) < new Date(r1[1].snapshot_date), "ASC-sorteret");
});
