import test from "node:test";
import assert from "node:assert/strict";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { packDivisionCalendar } from "./raceCalendarPacker.js";
import { selectTierRaceSet, DEFAULT_TIER_CALENDAR } from "./tierRaceSelection.js";

const FROM = new Date("2026-07-01T00:00:00Z");

function sample() {
  return [
    { id: "A", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0 }, { stage_number: 2, real_day: 0, game_day: 0 }, { stage_number: 3, real_day: 1, game_day: 1 }] },
    { id: "B", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0 }] }, // overlapper A på dag 0
    { id: "C", stagesPlaced: [{ stage_number: 1, real_day: 2, game_day: 2 }] },
  ];
}

test("buildScheduleRows: hver etape får scheduled_at + bevaret game_day", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM });
  assert.equal(stageRows.length, 5);
  for (const r of stageRows) {
    assert.ok(typeof r.scheduled_at === "string" && !Number.isNaN(Date.parse(r.scheduled_at)), "gyldig ISO scheduled_at");
    assert.ok(Number.isInteger(r.game_day), "game_day heltal");
  }
  // game_day matcher kilden
  const a3 = stageRows.find((r) => r.race_id === "A" && r.stage_number === 3);
  assert.equal(a3.game_day, 1);
});

test("buildScheduleRows: et løbs etaper er tids-monotone (etape 1 før 2 før 3)", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM });
  const a = stageRows.filter((r) => r.race_id === "A").sort((x, y) => x.stage_number - y.stage_number);
  assert.ok(a[0].scheduled_at < a[1].scheduled_at && a[1].scheduled_at < a[2].scheduled_at, "monotone tider pr. løb");
});

test("buildScheduleRows: samme real-dag → adskilte tidspunkter (ingen kollision)", () => {
  const { stageRows } = buildScheduleRows({ placements: sample(), from: FROM });
  // dag 0 = A.1, A.2, B.1 (game_day 0)
  const day0 = stageRows.filter((r) => r.game_day === 0).map((r) => r.scheduled_at);
  assert.equal(day0.length, 3);
  assert.equal(new Set(day0).size, 3, "tre adskilte tidspunkter på dag 0");
});

test("buildScheduleRows: raceUpdates = hvert løbs tidligste scheduled_at", () => {
  const { raceUpdates, stageRows } = buildScheduleRows({ placements: sample(), from: FROM });
  assert.equal(raceUpdates.length, 3);
  for (const u of raceUpdates) {
    const earliest = stageRows.filter((r) => r.race_id === u.id).map((r) => r.scheduled_at).sort()[0];
    assert.equal(u.scheduled_for, earliest);
  }
});

test("buildScheduleRows: deterministisk", () => {
  assert.deepEqual(buildScheduleRows({ placements: sample(), from: FROM }), buildScheduleRows({ placements: sample(), from: FROM }));
});

test("integration: selektion → pakker → schedule-rækker dækker alle etaper med game_day", () => {
  const catalog = [];
  [8, 8, 8, 6, 5, 5, 5, 5, 5, 4, 4].forEach((st, i) => catalog.push({ id: `ps-sr-${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 35; i++) catalog.push({ id: `ps-od-${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  const sel = selectTierRaceSet({ catalog, raceClasses: ["ProSeries"], seed: 6, ...DEFAULT_TIER_CALENDAR[3] });
  const packed = packDivisionCalendar({ stageRaces: sel.stageRaces, oneDayRaces: sel.oneDayRaces, forcedOverlaps: sel.forcedOverlaps, realDays: 28 });
  const { stageRows } = buildScheduleRows({ placements: packed.placements, from: FROM });

  const totalStages = packed.placements.reduce((s, p) => s + p.stagesPlaced.length, 0);
  assert.equal(stageRows.length, totalStages, "alle etaper får en schedule-række");
  assert.ok(stageRows.every((r) => Number.isInteger(r.game_day) && r.game_day >= 0 && r.game_day < 28));
});
