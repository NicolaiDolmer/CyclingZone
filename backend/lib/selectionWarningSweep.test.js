import test from "node:test";
import assert from "node:assert/strict";

import {
  SELECTION_WARNING_TYPE,
  buildSelectionWarningNotification,
  racesNeedingSelectionWarning,
  teamsMissingSelection,
  runSelectionWarningSweep,
} from "./selectionWarningSweep.js";

// #2180 · 36t-varsel: pure udvælgelses-logik + effektfuld sweep med injicerede
// fetchere (samme mønster som squadBelowMinimumCheck.test.js).

function makeNoopSupabase() {
  return { from: () => ({}) };
}

test("racesNeedingSelectionWarning: løb der starter 20t fra nu er due (inden for 36t)", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "scheduled", stages_completed: 0 }];
  const scheduleByRace = new Map([["r1", [{ scheduled_at: "2026-08-05T08:00:00Z" }]]]); // +20t
  const due = racesNeedingSelectionWarning({ races, scheduleByRace, now });
  assert.equal(due.length, 1);
  assert.equal(due[0].id, "r1");
});

test("racesNeedingSelectionWarning: løb der starter 40t fra nu er IKKE due (over 36t)", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "scheduled", stages_completed: 0 }];
  const scheduleByRace = new Map([["r1", [{ scheduled_at: "2026-08-06T04:00:00Z" }]]]); // +40t
  assert.equal(racesNeedingSelectionWarning({ races, scheduleByRace, now }).length, 0);
});

test("racesNeedingSelectionWarning: løb der allerede er startet (fortiden) er IKKE due", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "scheduled", stages_completed: 0 }];
  const scheduleByRace = new Map([["r1", [{ scheduled_at: "2026-08-04T10:00:00Z" }]]]); // -2t
  assert.equal(racesNeedingSelectionWarning({ races, scheduleByRace, now }).length, 0);
});

test("racesNeedingSelectionWarning: status != scheduled udelukkes (fx completed)", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "completed", stages_completed: 1 }];
  const scheduleByRace = new Map([["r1", [{ scheduled_at: "2026-08-05T08:00:00Z" }]]]);
  assert.equal(racesNeedingSelectionWarning({ races, scheduleByRace, now }).length, 0);
});

test("racesNeedingSelectionWarning: igangværende etapeløb (stages_completed>0) udelukkes ('live', frosset felt)", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "scheduled", stages_completed: 2 }];
  const scheduleByRace = new Map([["r1", [
    { scheduled_at: "2026-08-03T08:00:00Z" },
    { scheduled_at: "2026-08-05T08:00:00Z" },
  ]]]);
  assert.equal(racesNeedingSelectionWarning({ races, scheduleByRace, now }).length, 0);
});

test("racesNeedingSelectionWarning: løb uden schedule (ukendt starttid) springes over", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "scheduled", stages_completed: 0 }];
  const scheduleByRace = new Map();
  assert.equal(racesNeedingSelectionWarning({ races, scheduleByRace, now }).length, 0);
});

test("racesNeedingSelectionWarning: multi-etape-løb bruger TIDLIGSTE etape som starttidspunkt", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const races = [{ id: "r1", status: "scheduled", stages_completed: 0 }];
  // Sidste etape er langt ude, men FØRSTE er om 10t → due.
  const scheduleByRace = new Map([["r1", [
    { scheduled_at: "2026-08-04T22:00:00Z" }, // +10t
    { scheduled_at: "2026-08-10T22:00:00Z" }, // +6 dage
  ]]]);
  const due = racesNeedingSelectionWarning({ races, scheduleByRace, now });
  assert.equal(due.length, 1);
});

test("teamsMissingSelection: hold uden manuel entry og uden afmelding mangler udtagelse", () => {
  const eligibleTeams = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  const missing = teamsMissingSelection({
    eligibleTeams,
    enteredTeamIds: new Set(["t2"]), // t2 har en MANUEL entry
    withdrawnTeamIds: new Set(["t3"]), // t3 har meldt sig af
  });
  assert.deepEqual(missing.map((t) => t.id), ["t1"]);
});

test("teamsMissingSelection: kun-auto-udfyldt tæller stadig som 'mangler' (empirisk grundlag i filhoved)", () => {
  // enteredTeamIds afspejler KUN is_auto_filled=false-rækker (kaldeansvaret), så et
  // hold med udelukkende auto-udfyldte rytter er IKKE i enteredTeamIds.
  const missing = teamsMissingSelection({
    eligibleTeams: [{ id: "t1" }],
    enteredTeamIds: new Set(),
    withdrawnTeamIds: new Set(),
  });
  assert.equal(missing.length, 1);
});

test("buildSelectionWarningNotification: type + metadata-koder + relatedId=raceId", () => {
  const payload = buildSelectionWarningNotification({ raceId: "race-1", raceName: "Ronde van Vlaanderen" });
  assert.equal(payload.type, SELECTION_WARNING_TYPE);
  assert.equal(payload.relatedId, "race-1");
  assert.match(payload.message, /Ronde van Vlaanderen/);
  assert.match(payload.message, /36 hours/);
  assert.equal(payload.metadata.raceId, "race-1");
  assert.equal(payload.metadata.titleCode, "notif.selectionWarning.title");
  assert.equal(payload.metadata.messageCode, "notif.selectionWarning.message");
  assert.deepEqual(payload.metadata.messageParams, { race: "Ronde van Vlaanderen" });
});

test("buildSelectionWarningNotification: manglende raceName falder tilbage til 'Your race'", () => {
  const payload = buildSelectionWarningNotification({ raceId: "race-1" });
  assert.match(payload.message, /^Your race starts/);
});

// ─── Effektfuld sweep (injicerede fetchere) ────────────────────────────────

test("runSelectionWarningSweep: ingen aktiv sæson → no-op", async () => {
  const stats = await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    fetchUpcomingScheduledRaces: async () => ({ seasonId: null, races: [] }),
  });
  assert.deepEqual(stats, { racesChecked: 0, racesDue: 0, teamsChecked: 0, warned: 0, deduped: 0, failed: 0 });
});

test("runSelectionWarningSweep: ingen løb inden for 36t → ingen notifikationer", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  const stats = await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Race far away", status: "scheduled", stages_completed: 0, league_division_id: 1 }],
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-10T12:00:00Z" }]]]), // +6 dage
  });
  assert.equal(stats.racesChecked, 1);
  assert.equal(stats.racesDue, 0);
  assert.equal(notified.length, 0);
});

test("runSelectionWarningSweep: hold uden manuel udtagelse varsles; hold MED manuel udtagelse springes over", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  const stats = await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Classique du Japon", status: "scheduled", stages_completed: 0, league_division_id: 1 }],
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]), // +24t
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1", league_division_id: 1 },
      { id: "t2", name: "Beta CC", user_id: "u2", league_division_id: 1 },
    ],
    fetchManualEntryTeamIdsByRace: async () => new Map([["r1", new Set(["t2"])]]), // t2 har selv valgt
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
  });
  assert.equal(stats.racesDue, 1);
  assert.equal(stats.teamsChecked, 2);
  assert.equal(stats.warned, 1);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].teamId, "t1");
  assert.equal(notified[0].type, SELECTION_WARNING_TYPE);
  assert.equal(notified[0].relatedId, "r1");
});

test("runSelectionWarningSweep: hold i en ANDEN pulje end løbet varsles ikke", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Race", status: "scheduled", stages_completed: 0, league_division_id: 2 }],
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1", league_division_id: 1 }], // pulje 1 ≠ løbets pulje 2
    fetchManualEntryTeamIdsByRace: async () => new Map(),
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
  });
  assert.equal(notified.length, 0);
});

test("runSelectionWarningSweep: afmeldt hold varsles ikke (bevidst fravalg ≠ mangler udtagelse)", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Race", status: "scheduled", stages_completed: 0, league_division_id: null }],
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1", league_division_id: 1 }],
    fetchManualEntryTeamIdsByRace: async () => new Map(),
    fetchWithdrawnTeamIdsByRace: async () => new Map([["r1", new Set(["t1"])]]),
  });
  assert.equal(notified.length, 0);
});

test("runSelectionWarningSweep: ét holds notif-fejl stopper ikke resten (isoleret try/catch)", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  const stats = await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => {
      if (p.teamId === "t1") throw new Error("simuleret notif-fejl");
      notified.push(p);
      return { delivered: true };
    },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Race", status: "scheduled", stages_completed: 0, league_division_id: null }],
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]),
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1", league_division_id: 1 },
      { id: "t2", name: "Beta CC", user_id: "u2", league_division_id: 1 },
    ],
    fetchManualEntryTeamIdsByRace: async () => new Map(),
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
  });
  assert.equal(stats.warned, 1);
  assert.equal(stats.failed, 1);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].teamId, "t2");
});

test("runSelectionWarningSweep: kaster hvis supabase mangler", async () => {
  await assert.rejects(
    () => runSelectionWarningSweep({ supabase: null }),
    /Supabase client required/
  );
});
