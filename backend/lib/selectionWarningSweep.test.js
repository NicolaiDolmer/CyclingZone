import test from "node:test";
import assert from "node:assert/strict";

import {
  SELECTION_WARNING_TYPE,
  buildSelectionWarningNotification,
  racesNeedingSelectionWarning,
  teamsMissingSelection,
  runSelectionWarningSweep,
  selectionWarningDedupKey,
  selectionWarningReceiptKey,
  isMissingReceiptsTableError,
  defaultSelectionWarningReceipts,
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

test("teamsMissingSelection: hold under target-antal og uden afmelding mangler udtagelse", () => {
  const eligibleTeams = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  const missing = teamsMissingSelection({
    eligibleTeams,
    entryCountByTeam: new Map([["t2", 6]]), // t2 har fuld trup (6/6)
    targetSize: 6,
    withdrawnTeamIds: new Set(["t3"]), // t3 har meldt sig af
  });
  assert.deepEqual(missing.map((t) => t.id), ["t1"]);
});

test("teamsMissingSelection: #4038 — fuldt AUTO-udfyldt trup (target nået) er IKKE 'mangler'", () => {
  // Regression for #4038: en trup med 0 manuelle men size.max auto-udfyldte
  // entries skal IKKE tælle som "mangler udtagelse" — samme kontrakt som
  // getSelectionContext/isSquadSelectionMissing (#3042).
  const missing = teamsMissingSelection({
    eligibleTeams: [{ id: "t1" }],
    entryCountByTeam: new Map([["t1", 6]]), // 6 auto-udfyldte, 0 manuelle
    targetSize: 6,
    withdrawnTeamIds: new Set(),
  });
  assert.equal(missing.length, 0);
});

test("teamsMissingSelection: DELVIST udfyldt trup (under target) mangler stadig udtagelse", () => {
  const missing = teamsMissingSelection({
    eligibleTeams: [{ id: "t1" }],
    entryCountByTeam: new Map([["t1", 4]]), // 4 af 6
    targetSize: 6,
    withdrawnTeamIds: new Set(),
  });
  assert.equal(missing.length, 1);
});

test("teamsMissingSelection: hold uden nogen entries overhovedet mangler udtagelse", () => {
  const missing = teamsMissingSelection({
    eligibleTeams: [{ id: "t1" }],
    entryCountByTeam: new Map(),
    targetSize: 6,
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

test("runSelectionWarningSweep: hold under target varsles; hold MED fuld trup springes over", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  const stats = await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Classique du Japon", status: "scheduled", stages_completed: 0, league_division_id: 1, race_class: "Class1" }], // target 6
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]), // +24t
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1", league_division_id: 1 },
      { id: "t2", name: "Beta CC", user_id: "u2", league_division_id: 1 },
    ],
    fetchEntryCountsByRace: async () => new Map([["r1", new Map([["t2", 6]])]]), // t2 har fuld trup (6/6)
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

test("#5867 selection warning does not promise assistant rescue to a team with too few senior riders", async () => {
  const notified = [];
  await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now: new Date("2026-08-04T12:00:00Z"),
    suppressLowRoster: true,
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({ seasonId: "s1", races: [{ id: "r1", name: "Race", status: "scheduled", stages_completed: 0, league_division_id: 1, race_class: "Class1" }] }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]),
    fetchHumanTeams: async () => [
      { id: "short", user_id: "u1", league_division_id: 1 },
      { id: "enough", user_id: "u2", league_division_id: 1 },
    ],
    fetchEntryCountsByRace: async () => new Map(),
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
    fetchSeniorCounts: async () => new Map([["short", 5], ["enough", 6]]),
  });
  assert.deepEqual(notified.map((n) => n.teamId), ["enough"]);
});

test("runSelectionWarningSweep: #4038 — fuldt auto-udfyldt trup (0 manuelle, target nået) varsles IKKE", async () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const notified = [];
  const stats = await runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Tour des Fjords", status: "scheduled", stages_completed: 0, league_division_id: 1, race_class: "ProSeries" }], // target 6
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1", league_division_id: 1 }],
    fetchEntryCountsByRace: async () => new Map([["r1", new Map([["t1", 6]])]]), // 6 auto-udfyldte, 0 manuelle
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
  });
  assert.equal(stats.racesDue, 1);
  assert.equal(stats.warned, 0);
  assert.equal(notified.length, 0);
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
    fetchEntryCountsByRace: async () => new Map(),
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
    fetchEntryCountsByRace: async () => new Map(),
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
    fetchEntryCountsByRace: async () => new Map(),
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

// #6184 · Forhånds-dedup: allerede varslede (manager, løb) koster ingen kald.
function dueSweepArgs(overrides = {}) {
  return {
    supabase: makeNoopSupabase(),
    now: new Date("2026-08-04T12:00:00Z"),
    fetchUpcomingScheduledRaces: async () => ({
      seasonId: "s1",
      races: [{ id: "r1", name: "Race One", status: "scheduled", stages_completed: 0, league_division_id: 1, race_class: "Class1" }],
    }),
    fetchScheduleByRace: async () => new Map([["r1", [{ scheduled_at: "2026-08-05T12:00:00Z" }]]]),
    fetchHumanTeams: async () => [
      { id: "t1", user_id: "u1", league_division_id: 1 },
      { id: "t2", user_id: "u2", league_division_id: 1 },
      { id: "t3", user_id: null, league_division_id: 1 },
    ],
    fetchEntryCountsByRace: async () => new Map(),
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
    ...overrides,
  };
}

test("#6184: forhånds-dedup springer allerede varslede managere over uden notify-kald", async () => {
  const payload = buildSelectionWarningNotification({ raceId: "r1", raceName: "Race One" });
  const notified = [];
  let fetchArgs = null;
  const stats = await runSelectionWarningSweep(dueSweepArgs({
    notify: async (p) => { notified.push(p.teamId); return { delivered: true }; },
    fetchRecentWarnings: async (args) => {
      fetchArgs = args;
      return new Set([selectionWarningDedupKey({ userId: "u1", relatedId: "r1", title: payload.title, message: payload.message })]);
    },
  }));
  assert.deepEqual(fetchArgs.raceIds, ["r1"]);
  assert.equal(fetchArgs.sinceIso, "2026-08-03T12:00:00.000Z", "samme 24t-vindue som notifyUser");
  assert.deepEqual(notified, ["t2", "t3"], "u1 er dedup'et; ukendt ejer (t3) går stadig til notify");
  assert.equal(stats.deduped, 1);
  assert.equal(stats.warned, 2);
});

test("#6184: en anden beskedtekst (fx omdøbt løb) dedup'es IKKE af forhånds-opslaget", async () => {
  const notified = [];
  await runSelectionWarningSweep(dueSweepArgs({
    notify: async (p) => { notified.push(p.teamId); return { delivered: true }; },
    fetchRecentWarnings: async () => new Set([
      selectionWarningDedupKey({ userId: "u1", relatedId: "r1", title: "Squad selection needed", message: "old text" }),
    ]),
  }));
  assert.deepEqual(notified, ["t1", "t2", "t3"]);
});

test("#6184: forhånds-dedup fejler → alle kandidater går stadig til notify", async () => {
  const notified = [];
  const stats = await runSelectionWarningSweep(dueSweepArgs({
    notify: async (p) => { notified.push(p.teamId); return { delivered: true }; },
    fetchRecentWarnings: async () => { throw new Error("timeout"); },
  }));
  assert.deepEqual(notified, ["t1", "t2", "t3"]);
  assert.equal(stats.warned, 3);
});

test("#6184: injiceret notify uden fetchRecentWarnings → ingen forhånds-opslag (bagudkompatibelt)", async () => {
  const notified = [];
  const stats = await runSelectionWarningSweep(dueSweepArgs({
    notify: async (p) => { notified.push(p.teamId); return { delivered: true }; },
  }));
  assert.equal(notified.length, 3);
  assert.equal(stats.warned, 3);
});

// ─── #5979 · Varige kvitteringer: slettet besked kommer ikke igen ──────────
//
// Harness: en in-memory indbakke (notifications, kan slettes som på
// NotificationsPage) + en in-memory kvitteringstabel med PRIMARY KEY-semantik.
// notify spejler notifyUser's 24t-dedup mod indbakken, og fetchRecentWarnings
// spejler #6184-forhåndsopslaget — så testen viser den rigtige fejlklasse.

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-08-04T12:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);

function makeWorld({ teams, races, schedule, entryCounts = new Map() } = {}) {
  const world = {
    inbox: [], // { user_id, related_id, title, message, created_at }
    receipts: new Map(), // receiptKey -> { user_id, race_id, sent_at }
    notifyCalls: [],
    receiptCalls: { fetch: 0, claim: 0, release: 0 },
    teams: teams ?? [
      { id: "t1", user_id: "u1", league_division_id: 1 },
      { id: "t2", user_id: "u2", league_division_id: 1 },
    ],
    races: races ?? [{ id: "r1", name: "Race One", status: "scheduled", stages_completed: 0, league_division_id: 1, race_class: "Class1" }],
    schedule: schedule ?? new Map([["r1", [{ scheduled_at: at(30 * 3600 * 1000).toISOString() }]]]), // T0+30t
    entryCounts,
  };
  world.deleteInbox = (userId) => { world.inbox = world.inbox.filter((n) => n.user_id !== userId); };
  world.ownerOf = (teamId) => world.teams.find((t) => t.id === teamId)?.user_id ?? null;
  world.notify = async ({ teamId, type, title, message, relatedId, now }) => {
    world.notifyCalls.push({ teamId, relatedId, at: now.toISOString() });
    const userId = world.ownerOf(teamId);
    if (!userId) return { delivered: false, deduped: false, reason: "missing_user" };
    const since = now.getTime() - DAY_MS;
    const dup = world.inbox.some((n) => n.user_id === userId && n.title === title && n.message === message
      && n.related_id === relatedId && Date.parse(n.created_at) >= since);
    if (dup) return { delivered: false, deduped: true };
    world.inbox.push({ user_id: userId, type, related_id: relatedId, title, message, created_at: now.toISOString() });
    return { delivered: true, deduped: false };
  };
  world.fetchRecentWarnings = async ({ raceIds, sinceIso }) => new Set(world.inbox
    .filter((n) => raceIds.includes(n.related_id) && n.created_at >= sinceIso)
    .map((n) => selectionWarningDedupKey({ userId: n.user_id, relatedId: n.related_id, title: n.title, message: n.message })));
  world.receiptStore = {
    fetchKnown: async ({ raceIds }) => {
      world.receiptCalls.fetch += 1;
      return new Set([...world.receipts.values()].filter((r) => raceIds.includes(r.race_id))
        .map((r) => selectionWarningReceiptKey({ userId: r.user_id, raceId: r.race_id })));
    },
    claim: async ({ userId, raceId, sentAtIso }) => {
      world.receiptCalls.claim += 1;
      const key = selectionWarningReceiptKey({ userId, raceId });
      if (world.receipts.has(key)) return false; // ON CONFLICT DO NOTHING
      world.receipts.set(key, { user_id: userId, race_id: raceId, sent_at: sentAtIso });
      return true;
    },
    release: async ({ userId, raceId, sentAtIso }) => {
      world.receiptCalls.release += 1;
      const key = selectionWarningReceiptKey({ userId, raceId });
      if (world.receipts.get(key)?.sent_at === sentAtIso) world.receipts.delete(key);
    },
  };
  world.sweep = (now, overrides = {}) => runSelectionWarningSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: world.notify,
    fetchRecentWarnings: world.fetchRecentWarnings,
    receipts: world.receiptStore,
    fetchUpcomingScheduledRaces: async () => ({ seasonId: "s1", races: world.races }),
    fetchScheduleByRace: async () => world.schedule,
    fetchHumanTeams: async () => world.teams,
    fetchEntryCountsByRace: async () => world.entryCounts,
    fetchWithdrawnTeamIdsByRace: async () => new Map(),
    ...overrides,
  });
  world.sentTo = (userId, raceId = "r1") => world.inbox.filter((n) => n.user_id === userId && n.related_id === raceId).length;
  return world;
}

test("#5979: send → manager sletter beskeden → næste sweep sender IKKE igen", async () => {
  const world = makeWorld();
  const first = await world.sweep(T0);
  assert.equal(first.warned, 2);
  assert.equal(world.receipts.size, 2, "én kvittering pr. (manager, løb)");

  world.deleteInbox("u1"); // NotificationsPage sletter rækken fysisk
  const second = await world.sweep(at(5 * 60 * 1000)); // næste 5-min-tick
  assert.equal(world.sentTo("u1"), 0, "slettet besked genopstår ikke");
  assert.equal(second.warned, 0);
  assert.equal(second.deduped, 2);
  assert.equal(world.notifyCalls.length, 2, "ingen notify-kald for kendte kvitteringer");
  assert.equal(world.receiptCalls.fetch, 2, "ét batch-opslag pr. tick");
  assert.equal(world.receipts.size, 2, "kvitteringen slettes ikke sammen med beskeden");
});

test("#5979: regression-vidne — uden kvitteringer genopstår den slettede besked (fejlen i issuet)", async () => {
  const world = makeWorld();
  await world.sweep(T0, { receipts: null });
  world.deleteInbox("u1");
  await world.sweep(at(5 * 60 * 1000), { receipts: null });
  assert.equal(world.sentTo("u1"), 1, "gammel adfærd: sendt igen efter sletning");
});

test("#5979: mere end 24 t senere (stadig i 36t-vinduet) sendes der ikke igen", async () => {
  const world = makeWorld();
  await world.sweep(T0); // løbet starter T0+30t
  const later = await world.sweep(at(25 * 3600 * 1000)); // T0+25t: 24t-dedup'en er udløbet, løbet er 5t væk
  assert.equal(later.racesDue, 1);
  assert.equal(later.warned, 0);
  assert.equal(world.sentTo("u1"), 1);
  assert.equal(world.sentTo("u2"), 1);
});

test("#5979: to managere — kun den uden kvittering får påmindelsen", async () => {
  const world = makeWorld();
  world.receipts.set(selectionWarningReceiptKey({ userId: "u1", raceId: "r1" }), { user_id: "u1", race_id: "r1", sent_at: at(-DAY_MS).toISOString() });
  const stats = await world.sweep(T0);
  assert.equal(world.sentTo("u1"), 0);
  assert.equal(world.sentTo("u2"), 1);
  assert.deepEqual(world.notifyCalls.map((c) => c.teamId), ["t2"]);
  assert.equal(stats.warned, 1);
  assert.equal(stats.deduped, 1);
});

test("#5979: antagelse — et NYT løb giver en ny påmindelse; ændret udtagelse for samme løb gør ikke", async () => {
  const world = makeWorld({ teams: [{ id: "t1", user_id: "u1", league_division_id: 1 }] });
  await world.sweep(T0);
  assert.equal(world.sentTo("u1", "r1"), 1);

  // Manageren fylder truppen, og den falder igen under target (fx en rytter fjernes).
  world.entryCounts = new Map([["r1", new Map([["t1", 6]])]]);
  await world.sweep(at(10 * 60 * 1000));
  world.entryCounts = new Map([["r1", new Map([["t1", 3]])]]);
  world.deleteInbox("u1");
  await world.sweep(at(20 * 60 * 1000));
  assert.equal(world.sentTo("u1", "r1"), 0, "ingen ny påmindelse for samme løb");

  // Et nyt løb kommer ind i vinduet.
  world.races = [...world.races, { id: "r2", name: "Race Two", status: "scheduled", stages_completed: 0, league_division_id: 1, race_class: "Class1" }];
  world.schedule = new Map([...world.schedule, ["r2", [{ scheduled_at: at(32 * 3600 * 1000).toISOString() }]]]);
  const stats = await world.sweep(at(30 * 60 * 1000));
  assert.equal(world.sentTo("u1", "r2"), 1, "nyt løb → ny påmindelse");
  assert.equal(stats.warned, 1);
});

test("#5979: samtidige sweeps sender præcis én besked pr. (manager, løb)", async () => {
  const world = makeWorld();
  // Notify uden egen dedup: kun kvitteringens claim kan forhindre dobbelt-sending.
  const rawSends = [];
  const rawNotify = async ({ teamId }) => {
    await new Promise((r) => setImmediate(r));
    rawSends.push(teamId);
    return { delivered: true };
  };
  const [a, b] = await Promise.all([
    world.sweep(T0, { notify: rawNotify, fetchRecentWarnings: null }),
    world.sweep(T0, { notify: rawNotify, fetchRecentWarnings: null }),
  ]);
  assert.equal(world.receiptCalls.fetch, 2);
  assert.deepEqual([...rawSends].sort(), ["t1", "t2"], "hver manager præcis én gang");
  assert.equal(a.warned + b.warned, 2);
  assert.equal(a.deduped + b.deduped, 2, "taberen af claim'en tæller som dedup");
});

test("#5979: kvitteringstabellen mangler (PGRST205) → gammel adfærd, kaster ikke", async () => {
  const world = makeWorld();
  let claims = 0;
  const missing = {
    fetchKnown: async () => { throw Object.assign(new Error("Could not find the table 'public.selection_warning_receipts' in the schema cache"), { code: "PGRST205" }); },
    claim: async () => { claims += 1; return true; },
    release: async () => {},
  };
  const stats = await world.sweep(T0, { receipts: missing });
  assert.equal(stats.warned, 2, "påmindelserne sendes stadig");
  assert.equal(stats.failed, 0);
  assert.equal(claims, 0, "ingen claims når opslaget ikke kunne køre");
  // 24t-dedup'en virker stadig som før.
  const again = await world.sweep(at(5 * 60 * 1000), { receipts: missing });
  assert.equal(again.warned, 0);
  assert.equal(again.deduped, 2);
});

test("#5979: tabellen forsvinder mellem opslag og claim (42P01) → sender stadig, kaster ikke", async () => {
  const world = makeWorld();
  const stats = await world.sweep(T0, {
    receipts: {
      fetchKnown: async () => new Set(),
      claim: async () => { throw Object.assign(new Error('relation "selection_warning_receipts" does not exist'), { code: "42P01" }); },
      release: async () => { throw new Error("must not release an unclaimed receipt"); },
    },
  });
  assert.equal(stats.warned, 2);
  assert.equal(stats.failed, 0);
});

test("#5979: notify kaster → kvitteringen fjernes igen, næste tick sender", async () => {
  const world = makeWorld({ teams: [{ id: "t1", user_id: "u1", league_division_id: 1 }] });
  const failing = async () => { throw new Error("insert timeout"); };
  const first = await world.sweep(T0, { notify: failing });
  assert.equal(first.failed, 1);
  assert.equal(world.receipts.size, 0, "kvittering rullet tilbage");
  assert.equal(world.receiptCalls.release, 1);

  const second = await world.sweep(at(5 * 60 * 1000));
  assert.equal(second.warned, 1, "manageren mister ikke påmindelsen pga. en forbigående fejl");
  assert.equal(world.sentTo("u1"), 1);
  assert.equal(world.receipts.size, 1);
});

test("#5979: notify dedup'er (besked findes allerede) → kvitteringen bliver stående", async () => {
  const world = makeWorld({ teams: [{ id: "t1", user_id: "u1", league_division_id: 1 }] });
  const stats = await world.sweep(T0, { notify: async () => ({ delivered: false, deduped: true }) });
  assert.equal(stats.deduped, 1);
  assert.equal(world.receipts.size, 1);
  assert.equal(world.receiptCalls.release, 0);
});

test("#5979: notify sendte intet (fx ejer forsvandt) → kvitteringen fjernes", async () => {
  const world = makeWorld({ teams: [{ id: "t1", user_id: "u1", league_division_id: 1 }] });
  const stats = await world.sweep(T0, { notify: async () => ({ delivered: false, deduped: false, reason: "missing_user" }) });
  assert.equal(stats.warned, 0);
  assert.equal(world.receipts.size, 0);
  assert.equal(world.receiptCalls.release, 1);
});

test("#5979: besked sendt FØR kvitteringerne fandtes → forhånds-dedup skriver kvitteringen, sletning giver ingen gensending", async () => {
  const world = makeWorld({ teams: [{ id: "t1", user_id: "u1", league_division_id: 1 }] });
  await world.sweep(at(-60 * 60 * 1000), { receipts: null }); // gammel kode, 1t før deploy
  assert.equal(world.receipts.size, 0);

  const afterDeploy = await world.sweep(T0);
  assert.equal(afterDeploy.deduped, 1);
  assert.equal(world.receipts.size, 1, "kvittering skrevet for den eksisterende besked");
  assert.equal(world.notifyCalls.length, 1, "intet nyt notify-kald");

  world.deleteInbox("u1");
  await world.sweep(at(5 * 60 * 1000));
  assert.equal(world.sentTo("u1"), 0);
});

test("#5979: claim-fejl (ikke manglende tabel) → påmindelsen sendes alligevel", async () => {
  const world = makeWorld({ teams: [{ id: "t1", user_id: "u1", league_division_id: 1 }] });
  const stats = await world.sweep(T0, {
    receipts: { ...world.receiptStore, claim: async () => { throw new Error("connection reset"); } },
  });
  assert.equal(stats.warned, 1);
  assert.equal(stats.failed, 0);
});

test("#5979: hold uden kendt ejer bruger ikke kvitteringer (nøglen er user_id)", async () => {
  const world = makeWorld({ teams: [{ id: "t3", user_id: null, league_division_id: 1 }] });
  await world.sweep(T0);
  assert.equal(world.receiptCalls.claim, 0);
  assert.equal(world.notifyCalls.length, 1);
});

test("#5979: isMissingReceiptsTableError genkender 42P01/PGRST205, ikke andre fejl", () => {
  assert.equal(isMissingReceiptsTableError({ code: "42P01" }), true);
  assert.equal(isMissingReceiptsTableError({ code: "PGRST205" }), true);
  assert.equal(isMissingReceiptsTableError({ message: "Could not find the table 'public.selection_warning_receipts'" }), true);
  assert.equal(isMissingReceiptsTableError({ code: "57014", message: "statement timeout" }), false);
  assert.equal(isMissingReceiptsTableError(null), false);
});

// Default-store mod en optagende supabase-mock: kontrakten mod PostgREST.
function makeRecordingSupabase(result) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve) => resolve(result);
      return (...args) => { calls.push([prop, ...args]); return builder; };
    },
  });
  return { calls, supabase: { from: (table) => { calls.push(["from", table]); return builder; } } };
}

test("#5979: default claim = upsert ON CONFLICT (user_id,race_id) DO NOTHING; tom data → 'findes'", async () => {
  const won = makeRecordingSupabase({ data: [{ user_id: "u1" }], error: null });
  assert.equal(await defaultSelectionWarningReceipts.claim({ supabase: won.supabase, userId: "u1", raceId: "r1", sentAtIso: T0.toISOString() }), true);
  assert.deepEqual(won.calls[0], ["from", "selection_warning_receipts"]);
  assert.deepEqual(won.calls[1], ["upsert", { user_id: "u1", race_id: "r1", sent_at: T0.toISOString() }, { onConflict: "user_id,race_id", ignoreDuplicates: true }]);

  const lost = makeRecordingSupabase({ data: [], error: null });
  assert.equal(await defaultSelectionWarningReceipts.claim({ supabase: lost.supabase, userId: "u1", raceId: "r1", sentAtIso: T0.toISOString() }), false);

  const broken = makeRecordingSupabase({ data: null, error: { code: "PGRST205" } });
  await assert.rejects(() => defaultSelectionWarningReceipts.claim({ supabase: broken.supabase, userId: "u1", raceId: "r1", sentAtIso: T0.toISOString() }));
});

test("#5979: default release sletter kun denne kørsels egen claim (matcher sent_at)", async () => {
  const rec = makeRecordingSupabase({ data: null, error: null });
  await defaultSelectionWarningReceipts.release({ supabase: rec.supabase, userId: "u1", raceId: "r1", sentAtIso: T0.toISOString() });
  assert.deepEqual(rec.calls.slice(1), [
    ["delete"],
    ["eq", "user_id", "u1"],
    ["eq", "race_id", "r1"],
    ["eq", "sent_at", T0.toISOString()],
  ]);
});
