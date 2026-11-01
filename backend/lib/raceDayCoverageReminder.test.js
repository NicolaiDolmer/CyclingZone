import test from "node:test";
import assert from "node:assert/strict";
import {
  groupTeamRaceDays, planRaceDayCoverageReminders, buildRaceDayCoverageNotification, sendRaceDayCoverageReminders,
  RACE_DAY_COVERAGE_TYPE,
} from "./raceDayCoverageReminder.js";
import { runSeniorStartReminderSweep } from "./seniorStartReminder.js";
import { isKnownNotificationType } from "./notificationTypes.js";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const team = (id, extra = {}) => ({ id, user_id: `u-${id}`, league_division_id: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra });
const race = (id, extra = {}) => ({ id, status: "scheduled", stages_completed: 0, league_division_id: 3, squad: "senior", ...extra });
const sched = (raceId, at, gameDay) => [raceId, [{ race_id: raceId, scheduled_at: at, game_day: gameDay }]];
const threeSameDay = () => ({
  races: [race("a"), race("b"), race("c")],
  scheduleByRace: new Map([
    sched("a", "2026-11-02T08:00:00.000Z", 12), sched("b", "2026-11-02T09:00:00.000Z", 12), sched("c", "2026-11-02T10:00:00.000Z", 12),
  ]),
});

test("#7339 groupTeamRaceDays: én gruppe pr. hold og løbsdag, kun dage med 2+ løb", () => {
  const { races, scheduleByRace } = threeSameDay();
  races.push(race("solo"));
  scheduleByRace.set("solo", [{ race_id: "solo", scheduled_at: "2026-11-01T20:00:00.000Z", game_day: 11 }]);
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  assert.equal(groups.length, 1);
  assert.deepEqual([groups[0].teamId, groups[0].gameDay, groups[0].raceIds], ["t1", 12, ["a", "b", "c"]]);
});

test("#7339 groupTeamRaceDays: afmeldte løb, anden pulje, ungdom, AI-hold og løb uden for 24t tæller ikke", () => {
  const { races, scheduleByRace } = threeSameDay();
  races.push(race("u23", { squad: "u23" }), race("far"), race("other", { league_division_id: 9 }));
  scheduleByRace.set("u23", [{ race_id: "u23", scheduled_at: "2026-11-02T08:00:00.000Z", game_day: 12 }]);
  scheduleByRace.set("far", [{ race_id: "far", scheduled_at: "2026-11-03T13:00:00.000Z", game_day: 13 }]);
  scheduleByRace.set("other", [{ race_id: "other", scheduled_at: "2026-11-02T08:00:00.000Z", game_day: 12 }]);
  const groups = groupTeamRaceDays({
    teams: [team("t1"), team("ai", { is_ai: true, user_id: null })], races, scheduleByRace,
    withdrawnByRace: new Map([["c", new Set(["t1"])]]), now: NOW,
  });
  assert.deepEqual(groups.map((g) => [g.teamId, g.raceIds]), [["t1", ["a", "b"]]]);
});

test("#7339 plan: 16 raske over 3 løb → 2 af 3; 18 → ingen besked; under gulvet → senior-påmindelsen ejer det", () => {
  const { races, scheduleByRace } = threeSameDay();
  const groups = groupTeamRaceDays({ teams: [team("t16"), team("t18"), team("t5")], races, scheduleByRace, now: NOW });
  const planned = planRaceDayCoverageReminders({ groups, fitCountsByTeam: new Map([["t16", 16], ["t18", 18], ["t5", 5]]) });
  assert.deepEqual(planned.map((p) => [p.teamId, p.fieldable, p.total]), [["t16", 2, 3]]);
});

test("#7339 besked: kort, EN-først, eksisterende type, tal kun i metadata", () => {
  const payload = buildRaceDayCoverageNotification({ candidate: { gameDay: 12, fieldable: 2, total: 3 }, seasonNumber: 5 });
  assert.equal(payload.type, RACE_DAY_COVERAGE_TYPE);
  assert.ok(isKnownNotificationType(payload.type), "ingen ny type, ingen migration");
  assert.equal(payload.relatedId, null);
  assert.deepEqual(payload.metadata.messageParams, { gameDay: 12, fieldable: 2, total: 3, min: 6 });
  assert.equal(payload.metadata.messageCode, "notif.raceDayCoverage.message");
  assert.ok(!/[—–]/.test(payload.title + payload.message), "intet em-dash");
  assert.ok(!/\b2 of 3\b/.test(payload.message), "skiftende tal står ikke i dedup-teksten");
});

test("#7339 dedup: dedup-nøglen er stabil pr. sæson og løbsdag, også når truppen ændrer sig", () => {
  const first = buildRaceDayCoverageNotification({ candidate: { gameDay: 12, fieldable: 2, total: 3 }, seasonNumber: 5 });
  const later = buildRaceDayCoverageNotification({ candidate: { gameDay: 12, fieldable: 1, total: 3 }, seasonNumber: 5 });
  const nextDay = buildRaceDayCoverageNotification({ candidate: { gameDay: 13, fieldable: 2, total: 3 }, seasonNumber: 5 });
  const key = (p) => [p.type, p.title, p.message, p.relatedId].join("|");
  assert.equal(key(first), key(later));
  assert.notEqual(key(first), key(nextDay));
});

// Fake notify med notifyUser's dedup: (type, title, message, related_id) inden for 24t.
function dedupingNotify() {
  const sent = [];
  const notify = async (args) => {
    const k = [args.teamId, args.type, args.title, args.message, args.relatedId].join("|");
    if (sent.some((s) => s.key === k)) return { delivered: false, deduped: true };
    sent.push({ key: k, args });
    return { delivered: true };
  };
  return { sent, notify };
}

test("#7339 dedup: én besked pr. hold pr. løbsdag på tværs af gentagne ticks", async () => {
  const { races, scheduleByRace } = threeSameDay();
  const { sent, notify } = dedupingNotify();
  let fit = 16;
  const run = () => sendRaceDayCoverageReminders({
    supabase: {}, now: NOW, season: { id: "s5", number: 5 }, teams: [team("t1")], races, scheduleByRace, notify,
    fetchFitCounts: async ({ teamIds }) => new Map(teamIds.map((id) => [id, fit])),
  });
  const r1 = await run();
  fit = 13; // en rytter skadet mellem to ticks: stadig 2 af 3, stadig samme besked
  const r2 = await run();
  assert.equal(sent.length, 1);
  assert.deepEqual([r1.sent, r2.sent, r2.deduped], [1, 0, 1]);
  assert.equal(sent[0].args.metadata.messageParams.fieldable, 2);
});

test("#7339 sweep: henter ikke trup-tal når ingen hold har flere løb samme dag", async () => {
  const result = await sendRaceDayCoverageReminders({
    supabase: {}, now: NOW, season: { number: 5 }, teams: [team("t1")], races: [race("a")],
    scheduleByRace: new Map([sched("a", "2026-11-02T08:00:00.000Z", 12)]), notify: async () => { throw new Error("no notify"); },
    fetchFitCounts: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(result.planned, 0);
});

test("#7339 senior-sweepen sender løbsdags-beskeden, og en fejl i den vælter ikke senior-påmindelsen", async () => {
  const { races, scheduleByRace } = threeSameDay();
  const common = {
    supabase: { from() {} }, now: NOW,
    fetchActiveSeason: async () => ({ id: "s5", number: 5 }),
    fetchTeams: async () => [team("t1"), team("short")],
    fetchRaces: async () => races,
    fetchScheduleByRace: async () => scheduleByRace,
    fetchSeniorCounts: async () => new Map([["t1", 16], ["short", 5]]),
    fetchWithdrawals: async () => new Map(),
  };
  const delivered = [];
  const ok = await runSeniorStartReminderSweep({
    ...common,
    notify: async (args) => { delivered.push(args); return { delivered: true }; },
    sendCoverage: (args) => sendRaceDayCoverageReminders({ ...args, fetchFitCounts: async () => new Map([["t1", 16], ["short", 5]]) }),
  });
  assert.equal(ok.sent, 1, "senior-påmindelsen til holdet under gulvet");
  assert.equal(ok.coverage.sent, 1, "løbsdags-beskeden til holdet med 16");
  assert.deepEqual(delivered.map((d) => [d.teamId, d.type]), [["short", "squad_below_minimum"], ["t1", "selection_warning"]]);

  const failing = await runSeniorStartReminderSweep({
    ...common,
    notify: async () => ({ delivered: true }),
    sendCoverage: async () => { throw new Error("coverage down"); },
  });
  assert.equal(failing.sent, 1);
  assert.equal(failing.coverage, undefined);
});
