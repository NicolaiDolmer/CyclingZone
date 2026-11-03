import test from "node:test";
import assert from "node:assert/strict";
import {
  groupTeamRaceDays, planRaceDayCoverageReminders, buildRaceDayCoverageNotification, sendRaceDayCoverageReminders,
  defaultFetchSeniorRoster, RACE_DAY_COVERAGE_TYPE,
} from "./raceDayCoverageReminder.js";
import { runSeniorStartReminderSweep } from "./seniorStartReminder.js";
import { isKnownNotificationType } from "./notificationTypes.js";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const team = (id, extra = {}) => ({ id, user_id: `u-${id}`, league_division_id: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra });
const race = (id, extra = {}) => ({ id, status: "scheduled", stages_completed: 0, league_division_id: 3, squad: "senior", ...extra });
const sched = (raceId, at, gameDay) => [raceId, [{ race_id: raceId, scheduled_at: at, game_day: gameDay }]];
const roster = (n, injuredUntil = []) => [...injuredUntil, ...Array(Math.max(0, n - injuredUntil.length)).fill(null)];
const threeSameDay = () => ({
  races: [race("a"), race("b"), race("c")],
  scheduleByRace: new Map([
    sched("a", "2026-11-02T08:00:00.000Z", 12), sched("b", "2026-11-02T09:00:00.000Z", 12), sched("c", "2026-11-02T10:00:00.000Z", 12),
  ]),
});

test("#7339 groupTeamRaceDays: én gruppe pr. hold og løbsdag, også dage med ét løb (A, 3/11)", () => {
  const { races, scheduleByRace } = threeSameDay();
  races.push(race("solo"));
  scheduleByRace.set("solo", [{ race_id: "solo", scheduled_at: "2026-11-01T20:00:00.000Z", game_day: 11 }]);
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  assert.deepEqual(groups.map((g) => [g.teamId, g.gameDay, g.raceIds]), [["t1", 11, ["solo"]], ["t1", 12, ["a", "b", "c"]]]);
});

// #7339 A (3/11): live-formen. 16 seniorer; et igangværende etapeløb (løbsdag 22-49) binder
// 8 og et andet (30-36) binder 7, så der er 1 ledig senior på løbsdag 33.
const bound = (raceId, start, end) => ({ race_id: raceId, window: { start, end } });
const liveRoster = () => [
  ...Array.from({ length: 8 }, () => ({ injuredUntil: null, bindings: [bound("gt", 22, 49)] })),
  ...Array.from({ length: 7 }, () => ({ injuredUntil: null, bindings: [bound("tour", 30, 36)] })),
  { injuredUntil: null, bindings: [] },
];
const day33 = (ids) => ({
  races: ids.map((id) => race(id)),
  scheduleByRace: new Map(ids.map((id, i) => sched(id, `2026-11-02T0${8 + i}:00:00.000Z`, 33))),
});

test("#7339 A: ryttere bundet i igangværende etapeløb trækkes fra; ét løb under gulvet giver besked", () => {
  const { races, scheduleByRace } = day33(["oostende"]);
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  const planned = planRaceDayCoverageReminders({
    groups, rosterByTeam: new Map([["t1", liveRoster()]]), seniorCountsByTeam: new Map([["t1", 16]]),
  });
  assert.deepEqual(planned.map((p) => [p.teamId, p.gameDay, p.fieldable, p.total]), [["t1", 33, 0, 1]]);
});

test("#7339 A: bindinger i dagens egne løb og på andre løbsdage gør ikke rytteren optaget", () => {
  const { races, scheduleByRace } = day33(["a", "b"]);
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  const roster = [
    ...Array.from({ length: 6 }, () => ({ injuredUntil: null, bindings: [bound("a", 33, 33)] })), // auto-fyldt i dagens løb
    ...Array.from({ length: 6 }, () => ({ injuredUntil: null, bindings: [bound("gt", 20, 32)] })), // etapeløb slutter dagen før
  ];
  const planned = planRaceDayCoverageReminders({ groups, rosterByTeam: new Map([["t1", roster]]) });
  assert.deepEqual(planned, [], "12 ledige dækker begge løb");
});

test("#7339 A (Codex): et etapeløb der må starte kort efter regel A (#6739) giver ingen besked", () => {
  const { races, scheduleByRace } = day33(["stage"]);
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  const roster = (free) => [
    ...Array.from({ length: free }, () => ({ injuredUntil: null, bindings: [] })),
    ...Array.from({ length: 2 }, () => ({ injuredUntil: null, bindings: [bound("other", 33, 33)] })),
  ];
  const plan = (free, stageRaceIds) => planRaceDayCoverageReminders({
    groups, rosterByTeam: new Map([["t1", roster(free)]]), seniorCountsByTeam: new Map([["t1", 10]]), stageRaceIds,
  }).length;
  assert.equal(plan(4, new Set(["stage"])), 0, "4 ledige + 2 i et andet løb på startdagen: etapeløbet starter");
  assert.equal(plan(4, new Set()), 1, "et endagsløb følger gulvet");
  assert.equal(plan(3, new Set(["stage"])), 1, "under regel A's minimum: besked");
});

test("#7339 A (Codex): sweepen slår løbsformen op for dagens eneste løb", async () => {
  const { races, scheduleByRace } = day33(["stage"]);
  const roster = [
    ...Array.from({ length: 4 }, () => ({ injuredUntil: null, bindings: [] })),
    ...Array.from({ length: 2 }, () => ({ injuredUntil: null, bindings: [bound("other", 33, 33)] })),
  ];
  let asked = null;
  const result = await sendRaceDayCoverageReminders({
    supabase: {}, now: NOW, season: { id: "s5", number: 5 }, teams: [team("t1")], races, scheduleByRace,
    seniorCountsByTeam: new Map([["t1", 6]]), notify: async () => { throw new Error("no notify"); },
    fetchRoster: async () => new Map([["t1", roster]]),
    fetchStageRaceIds: async ({ raceIds }) => { asked = raceIds; return new Set(["stage"]); },
  });
  assert.deepEqual(asked, ["stage"]);
  assert.equal(result.planned, 0);
});

test("#7339 A: et hold med nok ledige til sit ene løb får ingen besked", () => {
  const { races, scheduleByRace } = day33(["solo"]);
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  const planned = planRaceDayCoverageReminders({ groups, rosterByTeam: new Map([["t1", roster(6)]]) });
  assert.deepEqual(planned, []);
});

test("#7339 A: sweepen sender beskeden med sæson og løbsdage til trup-opslaget", async () => {
  const { races, scheduleByRace } = day33(["oostende"]);
  const { sent, notify } = dedupingNotify();
  let asked = null;
  const result = await sendRaceDayCoverageReminders({
    supabase: {}, now: NOW, season: { id: "s5", number: 5 }, teams: [team("t1")], races, scheduleByRace, notify,
    seniorCountsByTeam: new Map([["t1", 16]]),
    fetchRoster: async (args) => { asked = args; return new Map([["t1", liveRoster()]]); },
    fetchStageRaceIds: async () => new Set(), // endagsløb
  });
  assert.deepEqual([asked.seasonId, asked.gameDays, asked.teamIds], ["s5", [33], ["t1"]]);
  assert.equal(result.sent, 1);
  assert.deepEqual(sent[0].args.metadata.messageParams, { gameDay: 33, fieldable: 0, total: 1, min: 6 });
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
  const planned = planRaceDayCoverageReminders({ groups, rosterByTeam: new Map([["t16", roster(16)], ["t18", roster(18)], ["t5", roster(5)]]) });
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
    fetchRoster: async ({ teamIds }) => new Map(teamIds.map((id) => [id, roster(fit)])),
  });
  const r1 = await run();
  fit = 13; // en rytter skadet mellem to ticks: stadig 2 af 3, stadig samme besked
  const r2 = await run();
  assert.equal(sent.length, 1);
  assert.deepEqual([r1.sent, r2.sent, r2.deduped], [1, 0, 1]);
  assert.equal(sent[0].args.metadata.messageParams.fieldable, 2);
});

// Minimal PostgREST-fake: hver tabel giver sine rækker; filtrene logges så forespørgslen kan tjekkes.
function fakeSupabase(tables) {
  const log = [];
  const from = (table) => {
    const calls = [];
    log.push({ table, calls });
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") return (resolve) => resolve({ data: tables[table] ?? [], error: null });
        return (...args) => { calls.push([prop, ...args]); return q; };
      },
    });
    return q;
  };
  return { supabase: { from }, log };
}

test("#7339 A: defaultFetchSeniorRoster henter bindinger fra generatorens kilde og knytter dem til rytteren", async () => {
  const { supabase, log } = fakeSupabase({
    riders: [{ id: "r1", team_id: "t1" }, { id: "r2", team_id: "t1" }],
    rider_condition: [{ rider_id: "r2", injured_until: "2026-11-05" }],
    race_entries: [{ race_id: "gt", rider_id: "r1", team_id: "t1", binding_span: "[22,50)" }],
    race_day_participation: [{ race_id: "x", rider_id: "r2", game_day: 33 }],
  });
  const roster = await defaultFetchSeniorRoster({ supabase, teamIds: ["t1"], today: "2026-11-01", seasonId: "s5", gameDays: [33, 34] });
  assert.deepEqual(roster.get("t1"), [
    { injuredUntil: null, bindings: [{ race_id: "gt", window: { start: 22, end: 49 } }] },
    { injuredUntil: "2026-11-05", bindings: [{ race_id: "x", window: { start: 33, end: 33 } }] },
  ]);
  const entries = log.find((l) => l.table === "race_entries").calls;
  assert.ok(entries.some(([op, col, v]) => op === "eq" && col === "races.season_id" && v === "s5"), "sæson-scopet");
  assert.ok(entries.some(([op, col, v]) => op === "overlaps" && col === "binding_span" && v === "[33,34]"), "kun løbsdagene");
  const part = log.find((l) => l.table === "race_day_participation").calls;
  assert.ok(part.some(([op, col, v]) => op === "eq" && col === "season_id" && v === "s5"));
});

test("#7339 A: uden sæson-id hentes ingen bindinger (ingen sæson-blanding)", async () => {
  const { supabase, log } = fakeSupabase({ riders: [{ id: "r1", team_id: "t1" }] });
  const roster = await defaultFetchSeniorRoster({ supabase, teamIds: ["t1"], today: "2026-11-01", gameDays: [33] });
  assert.deepEqual(roster.get("t1"), [{ injuredUntil: null, bindings: [] }]);
  assert.ok(!log.some((l) => l.table === "race_entries"));
});

test("#7339 sweep: henter ikke trup-tal når intet løb starter inden for vinduet", async () => {
  const result = await sendRaceDayCoverageReminders({
    supabase: {}, now: NOW, season: { number: 5 }, teams: [team("t1")], races: [race("a")],
    scheduleByRace: new Map([sched("a", "2026-11-03T13:00:00.000Z", 13)]), notify: async () => { throw new Error("no notify"); },
    fetchRoster: async () => { throw new Error("should not fetch"); },
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
    sendCoverage: (args) => sendRaceDayCoverageReminders({ ...args, fetchRoster: async () => new Map([["t1", roster(16)], ["short", roster(5)]]) }),
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

test("#7339 (Codex): skader vurderes mod løbsdagen, ikke mod i dag", () => {
  const { races, scheduleByRace } = threeSameDay(); // løbsdag 2/11 (dansk dato)
  const groups = groupTeamRaceDays({ teams: [team("t1")], races, scheduleByRace, now: NOW });
  const plan = (injured) => planRaceDayCoverageReminders({ groups, rosterByTeam: new Map([["t1", roster(18, injured)]]) });
  assert.equal(plan(["2026-11-01"]).length, 0, "skadet til og med i dag: rask på løbsdagen, 18 dækker 3 løb");
  assert.deepEqual(plan(["2026-11-02"]).map((p) => p.fieldable), [2], "skadet på løbsdagen: 17 raske dækker 2 af 3");
});

test("#7339 (Codex): nok aktive seniorer men for få raske får beskeden (ingen falder mellem to påmindelser)", () => {
  const { races, scheduleByRace } = threeSameDay();
  const groups = groupTeamRaceDays({ teams: [team("t6"), team("t5")], races, scheduleByRace, now: NOW });
  const planned = planRaceDayCoverageReminders({
    groups,
    rosterByTeam: new Map([["t6", roster(6, ["2026-11-05"])], ["t5", roster(5)]]),
    seniorCountsByTeam: new Map([["t6", 6], ["t5", 5]]),
  });
  assert.deepEqual(planned.map((p) => [p.teamId, p.fieldable, p.total]), [["t6", 0, 3]], "t5 ejes af senior-påmindelsen");
});
