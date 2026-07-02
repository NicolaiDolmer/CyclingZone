import test from "node:test";
import assert from "node:assert/strict";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { packLaneCalendar } from "./raceCalendarLanePacker.js";
import { selectTierRaceSet } from "./tierRaceSelection.js";

const FROM = new Date("2026-06-28T00:00:00Z");
const SLOTS = ["12:00", "15:00", "18:00"];

// A: 3 etaper over 2 dage (dag0 bane0+1, dag1 bane0); B: 1 etape dag0 bane2; mon: bånd-game_day.
function sample() {
  return [
    { id: "A", race_class: "ProSeries", stagesPlaced: [
      { stage_number: 1, real_day: 0, game_day: 0, lane: 0 },
      { stage_number: 2, real_day: 0, game_day: 0, lane: 1 },
      { stage_number: 3, real_day: 1, game_day: 1, lane: 0 },
    ] },
    { id: "B", race_class: "ProSeries", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0, lane: 2 }] },
    { id: "mon", race_class: "Monuments", stagesPlaced: [{ stage_number: 1, real_day: 5, game_day: 100000, lane: 1 }] },
  ];
}
const cphTime = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

test("buildScheduleRows: hver etape kører i sin banes faste tids-slot", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS });
  assert.equal(cphTime(stageRows.find((r) => r.race_id === "A" && r.stage_number === 1).scheduled_at), "12:00"); // bane 0
  assert.equal(cphTime(stageRows.find((r) => r.race_id === "A" && r.stage_number === 2).scheduled_at), "15:00"); // bane 1
  assert.equal(cphTime(stageRows.find((r) => r.race_id === "A" && r.stage_number === 3).scheduled_at), "12:00"); // bane 0 (næste dag)
  assert.equal(cphTime(stageRows.find((r) => r.race_id === "B").scheduled_at), "18:00"); // bane 2
});

test("buildScheduleRows: løb aktive samme dag får forskellige tider (forskellige baner)", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS });
  const day0 = stageRows.filter((r) => r.scheduled_at.startsWith("2026-06-29"));
  const times = day0.map((r) => r.scheduled_at);
  assert.equal(new Set(times).size, times.length, "ingen kolliderende tider på dag 0");
});

test("buildScheduleRows: game_day bevares (også monument-båndet)", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS });
  assert.equal(stageRows.find((r) => r.race_id === "mon").game_day, 100000);
  assert.equal(stageRows.find((r) => r.race_id === "A" && r.stage_number === 3).game_day, 1);
});

test("buildScheduleRows: real_day 0 → 29/6 (sæsonstart mandag)", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS });
  const a1 = stageRows.find((r) => r.race_id === "A" && r.stage_number === 1);
  const ds = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(a1.scheduled_at));
  assert.equal(ds, "2026-06-29");
});

test("buildScheduleRows: et løbs etaper er tids-monotone", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS });
  const a = stageRows.filter((r) => r.race_id === "A").sort((x, y) => x.stage_number - y.stage_number);
  assert.ok(a[0].scheduled_at < a[1].scheduled_at && a[1].scheduled_at < a[2].scheduled_at);
});

test("buildScheduleRows: raceUpdates = hvert løbs tidligste scheduled_at", () => {
  const { raceUpdates, stageRows } = buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS });
  assert.equal(raceUpdates.length, 3);
  for (const u of raceUpdates) {
    const earliest = stageRows.filter((r) => r.race_id === u.id).map((r) => r.scheduled_at).sort()[0];
    assert.equal(u.scheduled_for, earliest);
  }
});

test("buildScheduleRows: deterministisk", () => {
  assert.deepEqual(buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS }), buildScheduleRows({ placements: sample(), from: FROM, slots: SLOTS }));
});

test("integration: selektion → lane-pakker → schedule dækker alle etaper med game_day", () => {
  const catalog = [];
  [5, 5, 5, 5, 4, 4].forEach((st, i) => catalog.push({ id: `ps-sr-${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 60; i++) catalog.push({ id: `ps-od-${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  const sel = selectTierRaceSet({ catalog, quota: 84, seed: 6, overlapPairCount: 3 });
  const packed = packLaneCalendar({ stageRaces: sel.stageRaces, oneDayRaces: sel.oneDayRaces, density: 3, days: 28 });
  const { stageRows } = buildScheduleRows({ placements: packed.placements, from: FROM, slots: SLOTS });
  const totalStages = packed.placements.reduce((s, p) => s + p.stagesPlaced.length, 0);
  assert.equal(stageRows.length, totalStages, "alle etaper får en schedule-række");
  assert.ok(stageRows.every((r) => Number.isInteger(r.game_day)));
});
