import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_SLOTS_CET,
  planRaceSchedules,
} from "./backfillRaceScheduledFor.js";

// Deterministisk basis: ét løb pr. dag fra "i morgen", sorteret på name. Hver etape
// får et fast dansk klokkeslæt (12:30/15:00/18:00/21:00 CET); flere etaper end slots
// ruller over på næste dag.

const RACES = [
  { id: "rB", name: "Beta GP", stages: 1 },
  { id: "rA", name: "Alfa Tour", stages: 3 },
  { id: "rC", name: "Charlie Klassiker", stages: 2 },
];

// 2026-06-21 er en søndag — irrelevant for logikken, men giver stabile asserts.
const FROM = new Date("2026-06-20T10:00:00Z");

test("STAGE_SLOTS_CET: faste, stigende dagslots", () => {
  assert.ok(Array.isArray(STAGE_SLOTS_CET) && STAGE_SLOTS_CET.length >= 4);
  for (const s of STAGE_SLOTS_CET) assert.match(s, /^\d{2}:\d{2}$/);
});

test("planRaceSchedules: ét løb pr. dag fra i morgen, sorteret på name", () => {
  const { raceUpdates } = planRaceSchedules({ races: RACES, from: FROM });
  // Sortering: Alfa, Beta, Charlie.
  assert.deepEqual(raceUpdates.map((r) => r.id), ["rA", "rB", "rC"]);
  // Startdage: i morgen (21.), 22., 23. (én dag mellem hvert løb).
  const days = raceUpdates.map((r) => new Date(r.scheduled_for).toISOString().slice(0, 10));
  assert.equal(days[0], "2026-06-21");
  assert.equal(days[1], "2026-06-22");
  assert.equal(days[2], "2026-06-23");
});

test("planRaceSchedules: én stage-row pr. etape med fast CET-slot", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  // Total etaper = 1 + 3 + 2 = 6.
  assert.equal(stageRows.length, 6);
  // Alfa Tour (3 etaper) starter 21/6 → etape 1,2,3 numre korrekte.
  const alfa = stageRows.filter((r) => r.race_id === "rA").sort((a, b) => a.stage_number - b.stage_number);
  assert.deepEqual(alfa.map((r) => r.stage_number), [1, 2, 3]);
  // Etaperne fordeles over på hinanden følgende dage (én etape/dag), første dag = startdag.
  const alfaDays = alfa.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10));
  assert.deepEqual(alfaDays, ["2026-06-21", "2026-06-22", "2026-06-23"]);
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

test("planRaceSchedules: stage 1's scheduled_at matcher løbets scheduled_for-dag", () => {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  for (const ru of raceUpdates) {
    const stage1 = stageRows.find((r) => r.race_id === ru.id && r.stage_number === 1);
    assert.equal(
      new Date(stage1.scheduled_at).toISOString().slice(0, 10),
      new Date(ru.scheduled_for).toISOString().slice(0, 10),
      `stage 1 dag != scheduled_for for ${ru.id}`,
    );
  }
});

test("planRaceSchedules: tomt løb-input → tomme planer", () => {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: [], from: FROM });
  assert.deepEqual(raceUpdates, []);
  assert.deepEqual(stageRows, []);
});
