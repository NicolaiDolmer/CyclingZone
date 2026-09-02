// [epic #4592 del 2] Tests for managerParking.js — selectTeamsToPark (ren
// udvælgelse) + parkTeam/parkDormantTeams (write-skridt mod en fake
// Supabase-klient, samme fixture-mønster som dormantTeamsReport.js'
// enriched-mapping).

import test from "node:test";
import assert from "node:assert/strict";

import { selectTeamsToPark, parkTeam, parkDormantTeams } from "./managerParking.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-09-28T09:00:00Z"); // S4 cutover-dato

function daysAgo(days) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function team(overrides = {}) {
  return {
    id: "team-1",
    name: "Test CC",
    is_ai: false,
    is_bank: false,
    is_test_account: false,
    is_frozen: false,
    user_id: "user-1",
    parked_at: null,
    next_season_signup_at: null,
    league_division_id: "pool-a",
    division: 3,
    ...overrides,
  };
}

function user(id, lastSeenDaysAgo) {
  return { id, last_seen: lastSeenDaysAgo == null ? null : daysAgo(lastSeenDaysAgo) };
}

// -- selectTeamsToPark ------------------------------------------------------

test("selectTeamsToPark: vælger et menneskehold hvis manager er 35 dage væk", () => {
  const teams = [team({ id: "t1", user_id: "u1" })];
  const users = [user("u1", 35)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked.map((t) => t.id), ["t1"]);
});

test("selectTeamsToPark: 29 dage væk (under grænsen) parkeres IKKE", () => {
  const teams = [team({ id: "t1", user_id: "u1" })];
  const users = [user("u1", 29)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked, []);
});

test("selectTeamsToPark: præcis 30 dage væk parkeres (inklusiv grænse, samme som isDormantManager)", () => {
  const teams = [team({ id: "t1", user_id: "u1" })];
  const users = [user("u1", 30)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked.map((t) => t.id), ["t1"]);
});

test("selectTeamsToPark: AI-hold parkeres aldrig, uanset last_seen", () => {
  const teams = [team({ id: "t1", is_ai: true, user_id: null })];
  const picked = selectTeamsToPark({ teams, users: [], now: NOW });
  assert.deepEqual(picked, []);
});

test("selectTeamsToPark: bank-hold og test-konti parkeres aldrig", () => {
  const teams = [
    team({ id: "bank", is_bank: true, user_id: "u1" }),
    team({ id: "test", is_test_account: true, user_id: "u2" }),
  ];
  const users = [user("u1", 60), user("u2", 60)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked, []);
});

test("selectTeamsToPark: frosne hold parkeres ikke (allerede en admin-beslutning, en ANDEN mekanisme)", () => {
  const teams = [team({ id: "t1", is_frozen: true, user_id: "u1" })];
  const users = [user("u1", 60)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked, []);
});

test("selectTeamsToPark: hold der har tilmeldt sig via knappen parkeres ALDRIG, uanset inaktivitet", () => {
  const teams = [team({ id: "t1", user_id: "u1", next_season_signup_at: daysAgo(5) })];
  const users = [user("u1", 90)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked, []);
});

test("selectTeamsToPark: allerede parkeret hold vælges ikke igen (idempotent sweep)", () => {
  const teams = [team({ id: "t1", user_id: "u1", parked_at: daysAgo(3) })];
  const users = [user("u1", 90)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked, []);
});

test("selectTeamsToPark: manglende bruger-række (user_id peger på intet) tæller som inaktiv", () => {
  const teams = [team({ id: "t1", user_id: "u-ghost" })];
  const picked = selectTeamsToPark({ teams, users: [], now: NOW });
  assert.deepEqual(picked.map((t) => t.id), ["t1"]);
});

test("selectTeamsToPark: manglende user_id (intet hold-ejerskab) tæller som inaktiv", () => {
  const teams = [team({ id: "t1", user_id: null })];
  const picked = selectTeamsToPark({ teams, users: [], now: NOW });
  assert.deepEqual(picked.map((t) => t.id), ["t1"]);
});

test("selectTeamsToPark: blandet pulje — kun de reelt inaktive kandidater vælges", () => {
  const teams = [
    team({ id: "active", user_id: "u1" }),
    team({ id: "away", user_id: "u2" }),
    team({ id: "dormant", user_id: "u3" }),
    team({ id: "signed-up", user_id: "u4", next_season_signup_at: daysAgo(1) }),
  ];
  const users = [user("u1", 2), user("u2", 15), user("u3", 45), user("u4", 45)];
  const picked = selectTeamsToPark({ teams, users, now: NOW });
  assert.deepEqual(picked.map((t) => t.id).sort(), ["dormant"]);
});

test("selectTeamsToPark: respekterer custom days-tærskel", () => {
  const teams = [team({ id: "t1", user_id: "u1" })];
  const users = [user("u1", 10)];
  assert.deepEqual(selectTeamsToPark({ teams, users, now: NOW, days: 14 }), []);
  const picked = selectTeamsToPark({ teams, users, now: NOW, days: 7 });
  assert.deepEqual(picked.map((t) => t.id), ["t1"]);
});

// -- parkTeam / parkDormantTeams (fake Supabase) -----------------------------

function makeFakeSupabase(initialTeams) {
  const rows = new Map(initialTeams.map((t) => [t.id, { ...t }]));
  const calls = [];
  return {
    calls,
    rows,
    from(table) {
      assert.equal(table, "teams");
      let updatePayload = null;
      let eqId = null;
      let requireParkedNull = false;
      const chain = {
        update(payload) {
          updatePayload = payload;
          return chain;
        },
        eq(col, val) {
          if (col === "id") eqId = val;
          return chain;
        },
        is(col, val) {
          if (col === "parked_at" && val === null) requireParkedNull = true;
          return chain;
        },
        select() {
          const row = rows.get(eqId);
          calls.push({ eqId, updatePayload, requireParkedNull });
          if (!row) return { data: [], error: null };
          if (requireParkedNull && row.parked_at != null) return { data: [], error: null };
          Object.assign(row, updatePayload);
          return { data: [{ id: eqId }], error: null };
        },
      };
      return chain;
    },
  };
}

test("parkTeam: markerer parked_at + rydder league_division_id, rører intet andet", async () => {
  const supabase = makeFakeSupabase([team({ id: "t1", league_division_id: "pool-a" })]);
  const ok = await parkTeam({ supabase, teamId: "t1", now: NOW });
  assert.equal(ok, true);
  const row = supabase.rows.get("t1");
  assert.equal(row.parked_at, NOW.toISOString());
  assert.equal(row.league_division_id, null);
  assert.equal(row.name, "Test CC"); // urørt
});

test("parkTeam: idempotent — et allerede parkeret hold rammes ikke igen", async () => {
  const supabase = makeFakeSupabase([team({ id: "t1", parked_at: daysAgo(3) })]);
  const ok = await parkTeam({ supabase, teamId: "t1", now: NOW });
  assert.equal(ok, false);
  assert.equal(supabase.rows.get("t1").parked_at, daysAgo(3)); // uændret
});

test("parkDormantTeams: vælger og parkerer i ét kald, tæller korrekt", async () => {
  const teams = [
    team({ id: "dormant", user_id: "u1" }),
    team({ id: "active", user_id: "u2" }),
  ];
  const users = [user("u1", 45), user("u2", 2)];
  const supabase = makeFakeSupabase(teams);
  const result = await parkDormantTeams({ supabase, teams, users, now: NOW });
  assert.equal(result.candidates, 1);
  assert.equal(result.parked, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.parkedTeamIds, ["dormant"]);
  assert.equal(supabase.rows.get("dormant").parked_at, NOW.toISOString());
  assert.equal(supabase.rows.get("active").parked_at, null);
});

test("parkDormantTeams: ingen kandidater → ingen writes", async () => {
  const teams = [team({ id: "active", user_id: "u1" })];
  const users = [user("u1", 1)];
  const supabase = makeFakeSupabase(teams);
  const result = await parkDormantTeams({ supabase, teams, users, now: NOW });
  assert.equal(result.candidates, 0);
  assert.equal(result.parked, 0);
  assert.equal(supabase.calls.length, 0);
});
