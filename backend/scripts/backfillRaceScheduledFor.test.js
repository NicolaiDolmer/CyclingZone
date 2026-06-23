import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_SLOTS_CET,
  STAGES_PER_DAY,
  planRaceSchedules,
} from "./backfillRaceScheduledFor.js";
import { raceTimeWindow, windowsOverlap } from "../lib/raceBinding.js";

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

test("planRaceSchedules: et løbs etaper er konsekutive, 1 etape/dag i sit spor", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  const alfa = stageRows.filter((r) => r.race_id === "rA").sort((a, b) => a.stage_number - b.stage_number);
  assert.deepEqual(alfa.map((r) => r.stage_number), [1, 2, 3]);
  // Spor-model: Alfa (3 etaper) ligger i ÉT spor → 1 etape/dag over 3 på hinanden følgende dage.
  const alfaDays = alfa.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10));
  assert.deepEqual(alfaDays, ["2026-06-21", "2026-06-22", "2026-06-23"]);
});

test("planRaceSchedules: to løb i forskellige spor kører samme dag, forskellige slots", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  // Dag 21/6: Alfa etape 1 (spor 0 → 12:30) + Beta etape 1 (spor 1 → 15:00).
  const day1 = stageRows.filter((r) => new Date(r.scheduled_at).toISOString().slice(0, 10) === "2026-06-21");
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
  const slots = day1.map((r) => hhmm(r.scheduled_at)).sort();
  assert.deepEqual(slots, ["12:30", "15:00"], "to forskellige slots samme dag");
  const races = new Set(day1.map((r) => r.race_id));
  assert.equal(races.size, 2, "to FORSKELLIGE løb samme dag (overlap)");
});

test("planRaceSchedules: stage race binder hen over et nabospor-løb (ægte overlap)", () => {
  // Et langt stage race (spor 0) + flere korte løb (spor 1) → vinduerne overlapper.
  const races = [
    { id: "tour", name: "AAA Grand Tour", stages: 7 },
    { id: "k1", name: "BBB Klassiker 1", stages: 1 },
    { id: "k2", name: "CCC Klassiker 2", stages: 1 },
    { id: "k3", name: "DDD Klassiker 3", stages: 1 },
  ];
  const { stageRows } = planRaceSchedules({ races, from: FROM });
  const winFor = (raceId) => raceTimeWindow(stageRows.filter((r) => r.race_id === raceId));
  const tourWin = winFor("tour");
  // Mindst ét kort løb skal have sit vindue inde i grand tour'ets span → binding aktiv.
  const overlaps = ["k1", "k2", "k3"].filter((id) => windowsOverlap(tourWin, winFor(id)));
  assert.ok(overlaps.length >= 1, `grand tour skal overlappe mindst ét nabospor-løb (fik ${overlaps.length})`);
});

test("planRaceSchedules: spor balanceres — spor-længderne afviger højst ét løbs etaper", () => {
  // 10 single-løb + 1 stage race → greedy skal holde sporene nogenlunde lige lange.
  const races = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Race ${String(i).padStart(2, "0")}`, stages: 1 })),
    { id: "sr", name: "ZZZ Stage Race", stages: 5 },
  ];
  const { stageRows } = planRaceSchedules({ races, from: FROM });
  // Sidste etape-dag pr. spor (slot) → spor-længder.
  const lastDayBySlot = {};
  for (const r of stageRows) {
    const t = new Date(r.scheduled_at);
    const slot = t.toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
    const day = t.toISOString().slice(0, 10);
    if (!lastDayBySlot[slot] || day > lastDayBySlot[slot]) lastDayBySlot[slot] = day;
  }
  const days = Object.values(lastDayBySlot).map((d) => Date.parse(d));
  const spreadDays = (Math.max(...days) - Math.min(...days)) / 86400000;
  assert.ok(spreadDays <= 5, `spor-længde-spredning ${spreadDays} dage skal være ≤ største løbs etape-antal (5)`);
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
