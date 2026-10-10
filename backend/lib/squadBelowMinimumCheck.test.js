import test from "node:test";
import assert from "node:assert/strict";

import {
  SQUAD_BELOW_MINIMUM_TYPE,
  buildSquadBelowMinimumNotification,
  checkedSquadOf,
  countRidersBySquad,
  defaultFetchActiveRiderCounts,
  detectAndNotifySquadsBelowMinimum,
  planSquadsBelowMinimum,
  squadBelowMinimumDedupeKey,
} from "./squadBelowMinimumCheck.js";

// #3043/#5867 · Sæsonskifte-detektion: hold under faktisk startgulv EFTER
// contract_expiry_release + retirement_release.
//
// fetchHumanTeams/fetchSquadRiderCounts injiceres i de fleste tests (samme
// mønster som contractExpiryRelease.test.js/retirementRelease.test.js) — så
// disse tests beviser DETEKTIONS-/VARSLINGS-LOGIKKEN. De sidste tests kører de
// ægte default-fetchere mod en mock der optager filtrene, så
// applyHumanTeamFilter-diskriminatoren + is_retired-filteret + trup-tællingen er
// låst fast.

function makeNoopSupabase() {
  return { from: () => ({}) };
}

const noDedupe = async () => false;

/** Kun seniortal (de gamle #3043-tests): ungdom = 0, og holdene har ingen ungdomspulje. */
function seniorCounts(entries) {
  return new Map(entries.map(([id, n]) => [id, { senior: n, u23: 0, junior: 0 }]));
}

test("detectAndNotifySquadsBelowMinimum: ingen hold under minimum → ingen notifikationer", async () => {
  const notified = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1" },
      { id: "t2", name: "Beta CC", user_id: "u2" },
    ],
    fetchSquadRiderCounts: async () => seniorCounts([["t1", 12], ["t2", 8]]),
    hasNotificationForKey: noDedupe,
  });

  assert.equal(stats.checked, 2);
  assert.equal(stats.belowMinimum, 0);
  assert.equal(stats.notified, 0);
  assert.deepEqual(stats.teams, []);
  assert.equal(notified.length, 0);
});

test("detectAndNotifySquadsBelowMinimum: hold under 6 bliver detekteret + varslet", async () => {
  const notified = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1" },
      { id: "t2", name: "Beta CC", user_id: "u2" },
      { id: "t3", name: "Gamma CC", user_id: "u3" },
    ],
    // t2: 5 (under 6). t3: intet i map → 0 (holdet har ingen egnede ryttere tilbage overhovedet).
    fetchSquadRiderCounts: async () => seniorCounts([["t1", 12], ["t2", 5]]),
    hasNotificationForKey: noDedupe,
  });

  assert.equal(stats.checked, 3);
  assert.equal(stats.belowMinimum, 2);
  assert.equal(stats.notified, 2);
  assert.deepEqual(
    stats.teams.sort((a, b) => a.teamId.localeCompare(b.teamId)),
    [
      { teamId: "t2", name: "Beta CC", squad: "senior", activeRiders: 5 },
      { teamId: "t3", name: "Gamma CC", squad: "senior", activeRiders: 0 },
    ]
  );

  assert.equal(notified.length, 2);
  const byUser = new Map(notified.map((n) => [n.userId, n]));
  assert.equal(byUser.get("u2").type, SQUAD_BELOW_MINIMUM_TYPE);
  assert.match(byUser.get("u2").message, /5 race-eligible riders/);
  assert.equal(byUser.get("u3").message.includes("0 race-eligible riders"), true);
});

test("detectAndNotifySquadsBelowMinimum: nøjagtigt på grænsen (6) tæller IKKE som under minimum", async () => {
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async () => ({ delivered: true }),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1" }],
    fetchSquadRiderCounts: async () => seniorCounts([["t1", 6]]),
    hasNotificationForKey: noDedupe,
  });
  assert.equal(stats.belowMinimum, 0, "6 = MIN_RACE_ENTRIES → OK, ingen violation ved selve grænsen");
});

test("detectAndNotifySquadsBelowMinimum: injicerbar minRiders (test-override)", async () => {
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    minRiders: 3,
    notify: async () => ({ delivered: true }),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1" }],
    fetchSquadRiderCounts: async () => seniorCounts([["t1", 5]]),
    hasNotificationForKey: noDedupe,
  });
  assert.equal(stats.belowMinimum, 0, "5 >= injiceret minRiders=3 → ingen violation");
});

test("detectAndNotifySquadsBelowMinimum: ét holds notif-fejl stopper ikke resten (isoleret try/catch)", async () => {
  const notified = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async (payload) => {
      if (payload.userId === "u1") throw new Error("simuleret notif-fejl");
      notified.push(payload);
      return { delivered: true };
    },
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1" },
      { id: "t2", name: "Beta CC", user_id: "u2" },
    ],
    fetchSquadRiderCounts: async () => seniorCounts([["t1", 2], ["t2", 3]]),
    hasNotificationForKey: noDedupe,
  });

  assert.equal(stats.belowMinimum, 2);
  assert.equal(stats.notified, 1);
  assert.equal(stats.notifyFailed, 1);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].userId, "u2");
});

test("detectAndNotifySquadsBelowMinimum: fetch-fejl FØR loopet hænger partialStats på error", async () => {
  await assert.rejects(
    () => detectAndNotifySquadsBelowMinimum({
      supabase: makeNoopSupabase(),
      fetchHumanTeams: async () => { throw new Error("simuleret DB-fejl"); },
    }),
    (err) => {
      assert.match(err.message, /simuleret DB-fejl/);
      assert.deepEqual(err.partialStats, { checked: 0, belowMinimum: 0, notified: 0, deduped: 0, notifyFailed: 0, bySquad: {}, teams: [] });
      return true;
    }
  );
});

test("detectAndNotifySquadsBelowMinimum: kaster hvis supabase mangler", async () => {
  await assert.rejects(
    () => detectAndNotifySquadsBelowMinimum({ supabase: null }),
    /Supabase client required/
  );
});

test("buildSquadBelowMinimumNotification: entals-/flertals-korrekt besked + metadata-koder", () => {
  const single = buildSquadBelowMinimumNotification({ activeRiders: 1 });
  assert.match(single.message, /1 race-eligible rider,/);
  assert.equal(single.metadata.titleCode, "notif.squadBelowMinimum.title");
  assert.equal(single.metadata.messageCode, "notif.squadBelowMinimum.message");
  assert.deepEqual(single.metadata.messageParams, { count: 1, min: 6 });

  const plural = buildSquadBelowMinimumNotification({ activeRiders: 3, minRiders: 8 });
  assert.match(plural.message, /3 race-eligible riders,/);
});

test("#5867 season-change warning names the actual six-rider start floor", () => {
  const payload = buildSquadBelowMinimumNotification({ activeRiders: 5 });
  assert.equal(payload.metadata.messageParams.min, 6);
  assert.match(payload.message, /6-rider minimum/);
});


// ─── #5864 · pr. trup (senior/u23/junior) ───────────────────────────────────

const youthTeam = (id, extra = {}) => ({
  id, name: `Team ${id}`, user_id: `u-${id}`,
  u23_league_division_id: "pool-u23", junior_league_division_id: "pool-jr", ...extra,
});

test("#5864 checkedSquadOf: senior via isSeniorSquadRider, youth via explicit squad, academy without youth squad counts nowhere", () => {
  assert.equal(checkedSquadOf({ squad: "senior", is_academy: false }), "senior");
  assert.equal(checkedSquadOf({ squad: null, is_academy: false }), "senior", "NULL squad = senior (#5330)");
  assert.equal(checkedSquadOf({ squad: "u23", is_academy: true }), "u23");
  assert.equal(checkedSquadOf({ squad: "junior", is_academy: false }), "junior", "free youth shape after release");
  assert.equal(checkedSquadOf({ squad: "senior", is_academy: true }), null);
});

test("#5864 countRidersBySquad tallies per team and squad", () => {
  const counts = countRidersBySquad([
    { team_id: "A", squad: "senior", is_academy: false },
    { team_id: "A", squad: "u23", is_academy: true },
    { team_id: "A", squad: "u23", is_academy: true },
    { team_id: "B", squad: "junior", is_academy: true },
  ]);
  assert.deepEqual(counts.get("A"), { senior: 1, u23: 2, junior: 0 });
  assert.deepEqual(counts.get("B"), { senior: 0, u23: 0, junior: 1 });
});

test("#5864 planSquadsBelowMinimum: youth squads are only checked when the team has a pool for them", () => {
  const teams = [
    youthTeam("A"),
    youthTeam("B", { u23_league_division_id: null, junior_league_division_id: null }),
  ];
  const counts = new Map([
    ["A", { senior: 10, u23: 4, junior: 6 }],
    ["B", { senior: 10, u23: 0, junior: 0 }],
  ]);
  const plan = planSquadsBelowMinimum({ teams, counts });
  assert.deepEqual(plan, [{ teamId: "A", name: "Team A", userId: "u-A", squad: "u23", activeRiders: 4 }],
    "A's U23 is under 6; A's junior sits exactly on the floor; B has no youth pools so nothing is flagged");
});

test("#5864 detect: one notification per team+squad, youth variant names the squad and explains expiry", async () => {
  const notified = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    seasonNumber: 5,
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchHumanTeams: async () => [youthTeam("A")],
    fetchSquadRiderCounts: async () => new Map([["A", { senior: 3, u23: 2, junior: 0 }]]),
    hasNotificationForKey: noDedupe,
  });

  assert.equal(stats.belowMinimum, 3, "senior, u23 and junior are all below the floor");
  assert.equal(stats.notified, 3);
  assert.deepEqual(stats.bySquad, { senior: 1, u23: 1, junior: 1 });
  assert.deepEqual(notified.map((n) => n.metadata.squad), ["senior", "u23", "junior"]);

  const u23 = notified.find((n) => n.metadata.squad === "u23");
  assert.equal(u23.type, SQUAD_BELOW_MINIMUM_TYPE);
  assert.equal(u23.userId, "u-A");
  assert.equal(u23.metadata.titleCode, "notif.squadBelowMinimum.titleU23");
  assert.equal(u23.metadata.messageCode, "notif.squadBelowMinimum.messageU23");
  assert.deepEqual(u23.metadata.messageParams, { count: 2, min: 6 });
  assert.equal(u23.metadata.dedupeKey, "squad_below_minimum:A:u23:5");
  assert.match(u23.title, /U23 team/);
  assert.match(u23.message, /2 riders/);
  assert.match(u23.message, /contract expires/);
  assert.match(u23.message, /cannot start a race until you fill it up/);

  const junior = notified.find((n) => n.metadata.squad === "junior");
  assert.match(junior.title, /Junior team/);
  assert.match(junior.message, /0 riders/);
  assert.equal(junior.metadata.messageCode, "notif.squadBelowMinimum.messageJunior");

  const senior = notified.find((n) => n.metadata.squad === "senior");
  assert.equal(senior.metadata.titleCode, "notif.squadBelowMinimum.title", "senior keeps its original copy");
  assert.equal(senior.metadata.dedupeKey, "squad_below_minimum:A:senior:5");
});

test("#5864 detect: an existing notification with the same (team, squad, season) key is not sent again", async () => {
  const notified = [];
  const asked = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    seasonNumber: 5,
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchHumanTeams: async () => [youthTeam("A")],
    fetchSquadRiderCounts: async () => new Map([["A", { senior: 10, u23: 2, junior: 1 }]]),
    hasNotificationForKey: async ({ userId, dedupeKey }) => {
      asked.push({ userId, dedupeKey });
      return dedupeKey === "squad_below_minimum:A:u23:5";
    },
  });
  assert.equal(stats.belowMinimum, 2);
  assert.equal(stats.deduped, 1);
  assert.equal(stats.notified, 1);
  assert.deepEqual(notified.map((n) => n.metadata.squad), ["junior"]);
  assert.deepEqual(asked, [
    { userId: "u-A", dedupeKey: "squad_below_minimum:A:u23:5" },
    { userId: "u-A", dedupeKey: "squad_below_minimum:A:junior:5" },
  ]);
});

test("#5864 detect: without a season number there is no dedupe key, so no lookup (falls back to notifyUser's own dedupe)", async () => {
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async () => ({ delivered: false, deduped: true }),
    fetchHumanTeams: async () => [youthTeam("A")],
    fetchSquadRiderCounts: async () => new Map([["A", { senior: 10, u23: 2, junior: 10 }]]),
    hasNotificationForKey: async () => { throw new Error("must not run without a season"); },
  });
  assert.equal(stats.notifyFailed, 0);
  assert.equal(stats.deduped, 1);
  assert.equal(squadBelowMinimumDedupeKey({ teamId: "A", squad: "u23", seasonNumber: null }), null);
});

test("#5864 detect: no auto-fill, the phase never writes riders", async () => {
  const touched = [];
  const supabase = { from: (t) => { touched.push(t); return {}; } };
  await detectAndNotifySquadsBelowMinimum({
    supabase,
    seasonNumber: 5,
    notify: async () => ({ delivered: true }),
    fetchHumanTeams: async () => [youthTeam("A")],
    fetchSquadRiderCounts: async () => new Map([["A", { senior: 0, u23: 0, junior: 0 }]]),
    hasNotificationForKey: noDedupe,
  });
  assert.deepEqual(touched, [], "all I/O is injected here; nothing reaches riders/teams");
});

test("#5864 youth variants render in Danish with the squad name and no em dash", async () => {
  const { translate } = await import("./i18nServer.js");
  const da = translate("notif.squadBelowMinimum.messageU23", { count: 1, min: 6 }, { language: "da" });
  assert.match(da, /Dit U23-hold har 1 rytter/);
  assert.match(da, /kontrakt udløber/);
  assert.match(da, /kan ikke stille til start, før du har fyldt det op/);
  const daJr = translate("notif.squadBelowMinimum.titleJunior", {}, { language: "da" });
  assert.match(daJr, /Juniorholdet/);
  for (const key of ["titleU23", "messageU23", "titleJunior", "messageJunior"]) {
    for (const language of ["en", "da"]) {
      const text = translate(`notif.squadBelowMinimum.${key}`, { count: 3, min: 6 }, { language });
      assert.ok(text && !text.includes("notif."), `${language}.${key} resolves`);
      assert.equal(text.includes(String.fromCharCode(0x2014)), false, `${language}.${key} has no em dash`);
    }
  }
});

// ─── Låser den ÆGTE query-form (default-fetchere) mod en optagende mock ────────
function recordingSupabase({ teams, riders, existingNotifications = [] }) {
  const queries = [];
  function builder(table) {
    const b = {
      __table: table,
      __filters: {},
      __select: "",
      select(c) { b.__select = c || ""; return b; },
      eq(col, val) { b.__filters[col] = val; return b; },
      in(col, vals) { b.__filters[`in:${col}`] = vals; return b; },
      not(col, op, val) { b.__filters[`not:${col}`] = `${op}:${val}`; return b; },
      or(expr) { b.__filters["or"] = expr; return b; },
      is(col, val) { b.__filters[`is:${col}`] = val; return b; },
      order() { return b; },
      limit() { return b; },
      range() { return { data: resolveRows(), error: null }; },
      then(resolve) { resolve({ data: resolveRows(), error: null }); },
    };
    function resolveRows() {
      queries.push({ table, select: b.__select, filters: { ...b.__filters } });
      if (table === "teams") return teams;
      if (table === "riders") return riders;
      if (table === "notifications") {
        return existingNotifications.filter((n) => n.dedupeKey === b.__filters["metadata->>dedupeKey"]);
      }
      return [];
    }
    return b;
  }
  return { queries, from: (table) => builder(table) };
}

test("default fetchers: applyHumanTeamFilter + pool columns, is_retired=false, counts per squad, dedupe lookup on metadata key", async () => {
  const supabase = recordingSupabase({
    teams: [youthTeam("t1"), youthTeam("t2", { u23_league_division_id: null, junior_league_division_id: null })],
    riders: [
      { id: "r1", team_id: "t1", squad: "senior", is_academy: false },
      { id: "r2", team_id: "t1", squad: "senior", is_academy: false },
      { id: "r3", team_id: "t1", squad: "u23", is_academy: true },
      { id: "r4", team_id: "t2", squad: "u23", is_academy: false },
    ],
    existingNotifications: [{ dedupeKey: "squad_below_minimum:t1:junior:5" }],
  });
  const notified = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase,
    seasonNumber: 5,
    notify: async (p) => { notified.push(p); return { delivered: true }; },
  });

  const teamQuery = supabase.queries.find((q) => q.table === "teams");
  assert.equal(teamQuery.filters.is_ai, false);
  assert.equal(teamQuery.filters.is_bank, false);
  assert.equal(teamQuery.filters.is_frozen, false);
  assert.equal(teamQuery.filters.is_test_account, false);
  assert.equal(teamQuery.filters["not:user_id"], "is:null");
  assert.match(teamQuery.select, /u23_league_division_id/);
  assert.match(teamQuery.select, /junior_league_division_id/);

  const riderQuery = supabase.queries.find((q) => q.table === "riders");
  assert.equal(riderQuery.filters.is_retired, false);
  assert.deepEqual(riderQuery.filters["in:team_id"], ["t1", "t2"]);
  assert.match(riderQuery.select, /squad/);
  assert.match(riderQuery.select, /is_academy/);

  // t1: senior 2, u23 1, junior 0 (junior already notified this season) · t2: senior 0, no youth pools.
  assert.deepEqual(
    stats.teams.map((t) => `${t.teamId}:${t.squad}:${t.activeRiders}`),
    ["t1:senior:2", "t1:u23:1", "t1:junior:0", "t2:senior:0"],
  );
  assert.equal(stats.deduped, 1);
  assert.deepEqual(notified.map((n) => `${n.userId}:${n.metadata.squad}`), ["u-t1:senior", "u-t1:u23", "u-t2:senior"]);

  const notifQueries = supabase.queries.filter((q) => q.table === "notifications");
  assert.equal(notifQueries.length, 4);
  assert.equal(notifQueries[0].filters.type, SQUAD_BELOW_MINIMUM_TYPE);
  assert.equal(notifQueries[0].filters.user_id, "u-t1");
  assert.equal(notifQueries[0].filters["metadata->>dedupeKey"], "squad_below_minimum:t1:senior:5");
});

test("defaultFetchActiveRiderCounts stays SENIOR-only for its other callers (selectionWarningSweep, seniorStartReminder)", async () => {
  const supabase = recordingSupabase({ teams: [], riders: [{ id: "r1", team_id: "t1" }, { id: "r2", team_id: "t1" }] });
  const counts = await defaultFetchActiveRiderCounts({ supabase, teamIds: ["t1"] });
  assert.equal(counts.get("t1"), 2);
  const q = supabase.queries[0];
  assert.equal(q.filters.is_academy, false);
  assert.equal(q.filters.is_retired, false);
});
