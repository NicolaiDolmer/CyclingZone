import test from "node:test";
import assert from "node:assert/strict";

import {
  SQUAD_BELOW_MINIMUM_TYPE,
  buildSquadBelowMinimumNotification,
  detectAndNotifySquadsBelowMinimum,
} from "./squadBelowMinimumCheck.js";

// #3043 · Sæsonskifte-detektion: hold under MIN_RIDERS_FOR_RACE (8) EFTER
// contract_expiry_release + retirement_release.
//
// fetchHumanTeams/fetchActiveRiderCounts injiceres i de fleste tests (samme
// mønster som contractExpiryRelease.test.js/retirementRelease.test.js) — så
// disse tests beviser DETEKTIONS-/VARSLINGS-LOGIKKEN. Den sidste test kører de
// ægte default-fetchere mod en mock der optager filtrene, så
// applyHumanTeamFilter-diskriminatoren + is_academy/is_retired-filteret er
// låst fast.

function makeNoopSupabase() {
  return { from: () => ({}) };
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
    fetchActiveRiderCounts: async () => new Map([["t1", 12], ["t2", 8]]),
  });

  assert.equal(stats.checked, 2);
  assert.equal(stats.belowMinimum, 0);
  assert.equal(stats.notified, 0);
  assert.deepEqual(stats.teams, []);
  assert.equal(notified.length, 0);
});

test("detectAndNotifySquadsBelowMinimum: hold under 8 bliver detekteret + varslet", async () => {
  const notified = [];
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchHumanTeams: async () => [
      { id: "t1", name: "Alpha CC", user_id: "u1" },
      { id: "t2", name: "Beta CC", user_id: "u2" },
      { id: "t3", name: "Gamma CC", user_id: "u3" },
    ],
    // t2: 5 (under 8). t3: intet i map → 0 (holdet har ingen egnede ryttere tilbage overhovedet).
    fetchActiveRiderCounts: async () => new Map([["t1", 12], ["t2", 5]]),
  });

  assert.equal(stats.checked, 3);
  assert.equal(stats.belowMinimum, 2);
  assert.equal(stats.notified, 2);
  assert.deepEqual(
    stats.teams.sort((a, b) => a.teamId.localeCompare(b.teamId)),
    [
      { teamId: "t2", name: "Beta CC", activeRiders: 5 },
      { teamId: "t3", name: "Gamma CC", activeRiders: 0 },
    ]
  );

  assert.equal(notified.length, 2);
  const byUser = new Map(notified.map((n) => [n.userId, n]));
  assert.equal(byUser.get("u2").type, SQUAD_BELOW_MINIMUM_TYPE);
  assert.match(byUser.get("u2").message, /5 race-eligible riders/);
  assert.equal(byUser.get("u3").message.includes("0 race-eligible riders"), true);
});

test("detectAndNotifySquadsBelowMinimum: nøjagtigt på grænsen (8) tæller IKKE som under minimum", async () => {
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    notify: async () => ({ delivered: true }),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1" }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });
  assert.equal(stats.belowMinimum, 0, "8 = MIN_RIDERS_FOR_RACE → OK, ingen violation ved selve grænsen");
});

test("detectAndNotifySquadsBelowMinimum: injicerbar minRiders (test-override)", async () => {
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase: makeNoopSupabase(),
    minRiders: 3,
    notify: async () => ({ delivered: true }),
    fetchHumanTeams: async () => [{ id: "t1", name: "Alpha CC", user_id: "u1" }],
    fetchActiveRiderCounts: async () => new Map([["t1", 5]]),
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
    fetchActiveRiderCounts: async () => new Map([["t1", 2], ["t2", 3]]),
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
      assert.deepEqual(err.partialStats, { checked: 0, belowMinimum: 0, notified: 0, notifyFailed: 0, teams: [] });
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
  assert.deepEqual(single.metadata.messageParams, { count: 1, min: 8 });

  const plural = buildSquadBelowMinimumNotification({ activeRiders: 3, minRiders: 8 });
  assert.match(plural.message, /3 race-eligible riders,/);
});

// ─── Låser den ÆGTE query-form (default-fetchere) mod en optagende mock ────────
test("default-fetchere: applyHumanTeamFilter + is_academy=false/is_retired=false er den faktiske query", async () => {
  const teamFilters = [];
  const riderFilters = [];

  function builder(table) {
    const b = {
      __table: table,
      __filters: {},
      __select: "",
      select(c) { b.__select = c || ""; return b; },
      eq(col, val) { b.__filters[col] = val; return b; },
      in(col, vals) { b.__filters[`in:${col}`] = vals; return b; },
      not(col, op, val) { b.__filters[`not:${col}`] = `${op}:${val}`; return b; },
      order() { return b; },
      range() { return { data: resolveRows(), error: null }; },
      then(resolve) { resolve({ data: resolveRows(), error: null }); },
    };
    function resolveRows() {
      if (table === "teams") {
        teamFilters.push({ select: b.__select, filters: { ...b.__filters } });
        return [{ id: "t1", name: "Alpha CC", user_id: "u1" }];
      }
      if (table === "riders") {
        riderFilters.push({ select: b.__select, filters: { ...b.__filters } });
        return [{ id: "r1", team_id: "t1" }, { id: "r2", team_id: "t1" }];
      }
      return [];
    }
    return b;
  }

  const supabase = { from: (table) => builder(table) };
  const stats = await detectAndNotifySquadsBelowMinimum({
    supabase,
    notify: async () => ({ delivered: true }),
  });

  assert.equal(stats.checked, 1);
  assert.equal(stats.belowMinimum, 1, "2 ryttere < MIN_RIDERS_FOR_RACE (8) → t1 er under minimum");
  assert.equal(stats.teams.length, 1);
  assert.equal(stats.teams[0].activeRiders, 2, "2 ryttere fundet for t1 (is_academy=false, is_retired=false)");

  const teamQuery = teamFilters[0];
  assert.equal(teamQuery.filters.is_ai, false);
  assert.equal(teamQuery.filters.is_bank, false);
  assert.equal(teamQuery.filters.is_frozen, false);
  assert.equal(teamQuery.filters.is_test_account, false);
  assert.equal(teamQuery.filters["not:user_id"], "is:null");

  const riderQuery = riderFilters[0];
  assert.equal(riderQuery.filters.is_academy, false);
  assert.equal(riderQuery.filters.is_retired, false);
  assert.deepEqual(riderQuery.filters["in:team_id"], ["t1"]);
});
