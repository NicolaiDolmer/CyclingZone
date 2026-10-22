// #6959: taktik og trup laases af EN regel ved loebets start.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasScheduledStartPassed,
  isStageLocked,
  isRaceLineupLocked,
  firstStageStartsFromSchedule,
  loadFirstStageStarts,
  withLineupLocked,
  isRaceLineupLockedNow,
} from "./raceStartLock.js";
import { isStageLocked as isStageLockedViaOrdersApi } from "./raceTeamOrdersApi.js";
import { partitionRegenTargets, partitionClearTargets } from "./raceDistribution.js";

const START = "2026-10-02T12:00:00Z";
const BEFORE = new Date("2026-10-02T11:59:59Z");
const AFTER = new Date("2026-10-02T12:00:01Z");

// Fake supabase: kun race_stage_schedule-opslaget loaderen laver. Tæller kald.
function fakeSupabase(rows) {
  const calls = [];
  const supabase = {
    calls,
    from(table) {
      calls.push(table);
      let ids = null;
      const q = {
        select() { return q; },
        eq() { return q; },
        in(_col, chunk) { ids = chunk; return q; },
        order() { return q; },
        range() {
          return Promise.resolve({ data: rows.filter((r) => !ids || ids.includes(r.race_id)), error: null });
        },
      };
      return q;
    },
  };
  return supabase;
}

test("hasScheduledStartPassed: manglende/ugyldigt tidspunkt er AABENT, ellers >= nu", () => {
  assert.equal(hasScheduledStartPassed(null, AFTER), false);
  assert.equal(hasScheduledStartPassed(undefined, AFTER), false);
  assert.equal(hasScheduledStartPassed("ikke-en-dato", AFTER), false);
  assert.equal(hasScheduledStartPassed(START, BEFORE), false);
  assert.equal(hasScheduledStartPassed(START, AFTER), true);
  assert.equal(hasScheduledStartPassed(START, new Date(START)), true);
});

test("raceTeamOrdersApi.isStageLocked er den DELTE regel (samme funktion)", () => {
  assert.equal(isStageLockedViaOrdersApi, isStageLocked);
});

test("kerne: etape-1-taktikken og truppen laaser i SAMME oejeblik (hele tilstandsrummet)", () => {
  const cases = [
    { name: "foer start", stagesCompleted: 0, scheduledAt: START, now: BEFORE },
    { name: "pause: start passeret, ingen etape koert", stagesCompleted: 0, scheduledAt: START, now: AFTER },
    { name: "etape 1 koert", stagesCompleted: 1, scheduledAt: START, now: AFTER },
    { name: "schedule-hul foer koert etape", stagesCompleted: 0, scheduledAt: null, now: AFTER },
    { name: "schedule-hul efter koert etape", stagesCompleted: 2, scheduledAt: null, now: AFTER },
    { name: "planlagt pause: starten flyttet frem i tiden", stagesCompleted: 0, scheduledAt: "2026-10-03T12:00:00Z", now: AFTER },
  ];
  for (const c of cases) {
    const tactics = isStageLocked({ stageNumber: 1, stagesCompleted: c.stagesCompleted, scheduledAt: c.scheduledAt, now: c.now });
    const lineup = isRaceLineupLocked({ status: "scheduled", stagesCompleted: c.stagesCompleted, firstStageScheduledAt: c.scheduledAt, now: c.now });
    assert.equal(lineup, tactics, `taktik og trup uenige: ${c.name}`);
  }
});

test("pause (BUG #6959): start passeret uden koert etape => baade taktik og trup er laast", () => {
  assert.equal(isStageLocked({ stageNumber: 1, stagesCompleted: 0, scheduledAt: START, now: AFTER }), true);
  assert.equal(isRaceLineupLocked({ status: "scheduled", stagesCompleted: 0, firstStageScheduledAt: START, now: AFTER }), true);
});

test("foer start er begge aabne; naar starten flyttes (planlagt pause) aabner begge igen", () => {
  assert.equal(isRaceLineupLocked({ status: "scheduled", stagesCompleted: 0, firstStageScheduledAt: START, now: BEFORE }), false);
  const moved = "2026-10-09T12:00:00Z";
  assert.equal(isRaceLineupLocked({ status: "scheduled", stagesCompleted: 0, firstStageScheduledAt: moved, now: AFTER }), false);
  assert.equal(isStageLocked({ stageNumber: 1, stagesCompleted: 0, scheduledAt: moved, now: AFTER }), false);
});

test("schedule-hul: loebet er aabent indtil en etape er koert eller loebet er afsluttet", () => {
  assert.equal(isRaceLineupLocked({ status: "scheduled", stagesCompleted: 0, firstStageScheduledAt: null, now: AFTER }), false);
  assert.equal(isRaceLineupLocked({ status: "scheduled", stagesCompleted: 1, firstStageScheduledAt: null, now: AFTER }), true);
  assert.equal(isRaceLineupLocked({ status: "completed", stagesCompleted: 0, firstStageScheduledAt: null, now: AFTER }), true);
});

test("senere etapers taktik laaser paa deres EGEN start; truppen er allerede laast fra loebets start", () => {
  const stage2Start = "2026-10-03T12:00:00Z";
  // Etape 1 koert, etape 2 ikke startet: taktik for 2 er aaben, truppen er laast.
  assert.equal(isStageLocked({ stageNumber: 2, stagesCompleted: 1, scheduledAt: stage2Start, now: AFTER }), false);
  assert.equal(isRaceLineupLocked({ status: "scheduled", stagesCompleted: 1, firstStageScheduledAt: START, now: AFTER }), true);
});

test("firstStageStartsFromSchedule: kun etape 1, resten ignoreres", () => {
  const map = firstStageStartsFromSchedule([
    { race_id: "a", stage_number: 2, scheduled_at: "2026-10-03T12:00:00Z" },
    { race_id: "a", stage_number: 1, scheduled_at: START },
    { race_id: "b", stage_number: 3, scheduled_at: START },
    { race_id: "c", stage_number: 1, scheduled_at: null },
  ]);
  assert.equal(map.get("a"), START);
  assert.equal(map.has("b"), false);
  assert.equal(map.get("c"), null);
});

test("loadFirstStageStarts: springer afsluttede og allerede koerte loeb over (ingen query uden kandidater)", async () => {
  const supabase = fakeSupabase([{ race_id: "open", stage_number: 1, scheduled_at: START }]);
  const none = await loadFirstStageStarts({
    supabase,
    races: [{ id: "done", status: "completed", stages_completed: 3 }, { id: "live", status: "scheduled", stages_completed: 1 }],
  });
  assert.equal(none.size, 0);
  assert.equal(supabase.calls.length, 0);
  const some = await loadFirstStageStarts({
    supabase,
    races: [{ id: "open", status: "scheduled", stages_completed: 0 }, { id: "live", status: "scheduled", stages_completed: 1 }],
  });
  assert.equal(some.get("open"), START);
  assert.equal(supabase.calls.length, 1);
});

test("withLineupLocked stempler lineup_locked pr. loeb efter den delte regel", async () => {
  const supabase = fakeSupabase([
    { race_id: "paused", stage_number: 1, scheduled_at: START },
    { race_id: "future", stage_number: 1, scheduled_at: "2026-10-09T12:00:00Z" },
  ]);
  const races = [
    { id: "paused", status: "scheduled", stages_completed: 0 },
    { id: "future", status: "scheduled", stages_completed: 0 },
    { id: "hole", status: "scheduled", stages_completed: 0 },
    { id: "live", status: "scheduled", stages_completed: 2 },
  ];
  const out = await withLineupLocked({ supabase, races, now: AFTER });
  assert.deepEqual(out.map((r) => [r.id, r.lineup_locked]), [
    ["paused", true], ["future", false], ["hole", false], ["live", true],
  ]);
  assert.equal(races[0].lineup_locked, undefined, "inputtet roeres ikke");
});

test("isRaceLineupLockedNow: koerte/afsluttede loeb afgoeres uden schedule-opslag", async () => {
  const supabase = fakeSupabase([{ race_id: "x", stage_number: 1, scheduled_at: START }]);
  assert.equal(await isRaceLineupLockedNow({ supabase, race: { id: "x", status: "scheduled", stages_completed: 1 } }), true);
  assert.equal(await isRaceLineupLockedNow({ supabase, race: { id: "x", status: "completed", stages_completed: 0 } }), true);
  assert.equal(supabase.calls.length, 0);
  assert.equal(await isRaceLineupLockedNow({ supabase, race: { id: "x", status: "scheduled", stages_completed: 0 }, now: AFTER }), true);
  assert.equal(await isRaceLineupLockedNow({ supabase, race: { id: "x", status: "scheduled", stages_completed: 0 }, now: BEFORE }), false);
  assert.equal(await isRaceLineupLockedNow({ supabase, race: null }), false);
});

test("regenerer/ryd springer et tids-laast loeb over (samme som et koert loeb)", () => {
  const cols = [
    { id: "open", stages_completed: 0, lineup_locked: false },
    { id: "paused", stages_completed: 0, lineup_locked: true },
    { id: "live", stages_completed: 1 },
  ];
  const regen = partitionRegenTargets({ cols, withdrawnIds: new Set(), manualRaceIds: new Set(), mode: "all" });
  assert.deepEqual(regen.target.map((r) => r.id), ["open"]);
  assert.equal(regen.skipped, 2);
  const clear = partitionClearTargets({ cols });
  assert.deepEqual(clear.target.map((r) => r.id), ["open"]);
  assert.equal(clear.skipped, 2);
});
