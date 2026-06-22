import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_SLOTS_CET,
  STAGES_PER_DAY,
  planRaceSchedules,
} from "./backfillRaceScheduledFor.js";

// Tæt-pakket cadence (#cadence-launch-fix): STAGES_PER_DAY etaper pr. dag på tværs af
// HELE pulje-kalenderen, så en 60-etape-sæson afvikles i ~30 dage (~4 uger) i stedet
// for dødt langsomt. Hvert løbs etaper er konsekutive; løb pakkes tæt (intet dag-spild).
// Faste danske slots (12:30/15:00/...); slot = etape-position på dagen.

const RACES = [
  { id: "rB", name: "Beta GP", stages: 1 },
  { id: "rA", name: "Alfa Tour", stages: 3 },
  { id: "rC", name: "Charlie Klassiker", stages: 2 },
];

// 2026-06-20 → "i morgen" = 21/6.
const FROM = new Date("2026-06-20T10:00:00Z");

test("STAGE_SLOTS_CET: faste, stigende dagslots", () => {
  assert.ok(Array.isArray(STAGE_SLOTS_CET) && STAGE_SLOTS_CET.length >= STAGES_PER_DAY);
  for (const s of STAGE_SLOTS_CET) assert.match(s, /^\d{2}:\d{2}$/);
});

test("STAGES_PER_DAY = 2 (launch-cadence: ~4-ugers sæson for 60-etape-kalender)", () => {
  assert.equal(STAGES_PER_DAY, 2);
});

test("planRaceSchedules: pakker etaper tæt — STAGES_PER_DAY etaper pr. dag", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  // 6 etaper / 2 pr. dag = 3 dage, 2 etaper pr. dag.
  const byDay = {};
  for (const r of stageRows) {
    const d = new Date(r.scheduled_at).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  assert.equal(Object.keys(byDay).length, 3, "6 etaper / 2 = 3 dage");
  assert.deepEqual(Object.values(byDay), [2, 2, 2], "2 etaper pr. dag (tæt pakket)");
});

test("planRaceSchedules: scheduled_for sorteret på name (Alfa, Beta, Charlie)", () => {
  const { raceUpdates } = planRaceSchedules({ races: RACES, from: FROM });
  assert.deepEqual(raceUpdates.map((r) => r.id), ["rA", "rB", "rC"]);
});

test("planRaceSchedules: et løbs etaper er konsekutive (sammenhængende blok)", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  const alfa = stageRows.filter((r) => r.race_id === "rA").sort((a, b) => a.stage_number - b.stage_number);
  assert.deepEqual(alfa.map((r) => r.stage_number), [1, 2, 3]);
  // Alfa (3 etaper, tæt pakket fra cursor 0 @ 2/dag): dag1, dag1, dag2.
  const alfaDays = alfa.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10));
  assert.deepEqual(alfaDays, ["2026-06-21", "2026-06-21", "2026-06-22"]);
});

test("planRaceSchedules: sæson-længde = ceil(total etaper / STAGES_PER_DAY) dage", () => {
  // 30 single-løb = 30 etaper → 15 dage ved 2/dag. (60-etape-kalender → ~30 dage ≈ 4 uger.)
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Race ${String(i).padStart(2, "0")}`, stages: 1 }));
  const { stageRows } = planRaceSchedules({ races: many, from: FROM });
  const days = new Set(stageRows.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10)));
  assert.equal(days.size, 15, "30 etaper / 2 per dag = 15 dage");
});

test("planRaceSchedules: én stage-row pr. etape med fast CET-slot", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  assert.equal(stageRows.length, 6); // 1 + 3 + 2
  for (const r of stageRows) assert.match(new Date(r.scheduled_at).toISOString(), /T\d{2}:\d{2}/);
});

test("planRaceSchedules: scheduled_at er gyldige fremtidige tidsstempler i UTC", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  for (const r of stageRows) {
    const t = new Date(r.scheduled_at);
    assert.ok(!Number.isNaN(t.getTime()), `ugyldig dato: ${r.scheduled_at}`);
    assert.ok(t.getTime() > FROM.getTime(), "etape-tid skal ligge efter from");
  }
});

test("planRaceSchedules: deterministisk — samme input → identisk output", () => {
  const a = planRaceSchedules({ races: RACES, from: FROM });
  const b = planRaceSchedules({ races: RACES, from: FROM });
  assert.deepEqual(a, b);
});

test("planRaceSchedules: stage 1's scheduled_at matcher løbets scheduled_for", () => {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  for (const ru of raceUpdates) {
    const stage1 = stageRows.find((r) => r.race_id === ru.id && r.stage_number === 1);
    assert.equal(stage1.scheduled_at, ru.scheduled_for, `stage 1 != scheduled_for for ${ru.id}`);
  }
});

test("planRaceSchedules: tomt løb-input → tomme planer", () => {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: [], from: FROM });
  assert.deepEqual(raceUpdates, []);
  assert.deepEqual(stageRows, []);
});
