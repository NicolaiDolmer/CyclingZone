import test from "node:test";
import assert from "node:assert/strict";
import { planSeniorStartReminders, buildSeniorStartNotification, runSeniorStartReminderSweep } from "./seniorStartReminder.js";

const NOW = new Date("2026-09-28T17:00:00.000Z");
const team = (id, extra = {}) => ({ id, user_id: `user-${id}`, league_division_id: "pool-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, parked_at: null, retired_at: null, ...extra });
const race = (id, extra = {}) => ({ id, name: id, status: "scheduled", stages_completed: 0, league_division_id: "pool-1", squad: "senior", ...extra });
const schedule = (id, scheduledAt, gameDay) => [id, [{ scheduled_at: scheduledAt, game_day: gameDay }]];

test("#5867 warns only an active manager below the senior start floor", () => {
  const planned = planSeniorStartReminders({
    teams: [team("short"), team("enough"), team("parked", { parked_at: "2026-09-27" }), team("frozen", { is_frozen: true }), team("other-pool", { league_division_id: "pool-2" })],
    seniorCountsByTeam: new Map([["short", 5], ["enough", 6], ["parked", 0], ["frozen", 0], ["other-pool", 0]]),
    races: [race("r1")],
    scheduleByRace: new Map([schedule("r1", "2026-09-29T16:00:00.000Z", 1)]),
    now: NOW,
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].teamId, "short");
  assert.equal(planned[0].missing, 1);
  assert.equal(planned[0].slot, "24h");
  assert.equal(planned[0].gameDay, 1);
});

test("#5867 groups overlapping races by true game_day and chooses the nearest start", () => {
  const planned = planSeniorStartReminders({
    teams: [team("short")],
    seniorCountsByTeam: new Map([["short", 0]]),
    races: [race("late"), race("early"), race("withdrawn")],
    scheduleByRace: new Map([
      schedule("late", "2026-09-28T19:30:00.000Z", 9),
      schedule("early", "2026-09-28T19:00:00.000Z", 9),
      schedule("withdrawn", "2026-09-28T18:00:00.000Z", 9),
    ]),
    withdrawnByRace: new Map([["withdrawn", new Set(["short"])]]),
    now: NOW,
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].firstRaceId, "early");
  assert.equal(planned[0].slot, "3h");
  assert.equal(planned[0].missing, 6);
});

test("#5867 sends no late 24h reminder once the 3h window has opened", () => {
  const planned = planSeniorStartReminders({
    teams: [team("short")],
    seniorCountsByTeam: new Map([["short", 5]]),
    races: [race("r1")],
    scheduleByRace: new Map([schedule("r1", "2026-09-28T18:00:00.000Z", 1)]),
    now: NOW,
  });
  assert.deepEqual(planned.map((p) => p.slot), ["3h"]);
});

test("#5867 notification key stays stable when the shortfall changes within a slot", () => {
  const base = { teamId: "short", gameDay: 9, slot: "24h", missing: 1, seniorCount: 5 };
  const first = buildSeniorStartNotification({ candidate: base, seasonNumber: 4 });
  const later = buildSeniorStartNotification({ candidate: { ...base, missing: 2, seniorCount: 4 }, seasonNumber: 4 });
  assert.equal(first.type, "squad_below_minimum");
  assert.deepEqual([first.type, first.title, first.message, first.relatedId], [later.type, later.title, later.message, later.relatedId]);
  assert.equal(later.metadata.messageParams.missing, 2);
  assert.equal(first.metadata.action, "market");
  const urgent = buildSeniorStartNotification({ candidate: { ...base, slot: "3h" }, seasonNumber: 4 });
  assert.notEqual(first.message, urgent.message, "the second approved reminder is a distinct slot");
});

test("#5867 sweep sends only planned messages and reports per-team failures", async () => {
  const delivered = [];
  const result = await runSeniorStartReminderSweep({
    supabase: { from() {} },
    now: NOW,
    fetchActiveSeason: async () => ({ id: "s4", number: 4 }),
    fetchTeams: async () => [team("short"), team("enough")],
    fetchRaces: async () => [race("r1")],
    fetchScheduleByRace: async () => new Map([schedule("r1", "2026-09-29T16:00:00.000Z", 1)]),
    fetchSeniorCounts: async () => new Map([["short", 5], ["enough", 6]]),
    fetchWithdrawals: async () => new Map(),
    notify: async (args) => { delivered.push(args); return { delivered: true }; },
  });
  assert.equal(result.planned, 1);
  assert.equal(result.sent, 1);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].teamId, "short");
  assert.equal(delivered[0].metadata.messageParams.missing, 1);
});

test("#5867 sweep skips roster and race queries when no first stage is inside the reminder window", async () => {
  const result = await runSeniorStartReminderSweep({
    supabase: { from() {} },
    now: NOW,
    fetchActiveSeason: async () => ({ id: "s4", number: 4 }),
    fetchScheduleByRace: async () => new Map(),
    fetchTeams: async () => { throw new Error("teams should not be fetched"); },
    fetchRaces: async () => { throw new Error("races should not be fetched"); },
  });
  assert.equal(result.planned, 0);
});
