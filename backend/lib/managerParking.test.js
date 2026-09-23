// [epic #4592 del 2] Tests for managerParking.js — de rene udvælgelser
// (selectTeamsToPark/selectTeamsToUnpark/selectActiveSubscriptionTeamIds) og
// write-skridtene (parkTeam/unparkTeam/resetSeasonSignups/runParkingSweep) mod
// en lille in-memory Supabase-fake.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isSubscriptionProtectingTeam,
  loadParkingInputs,
  PARKING_SWEEP_MARKER_KEY,
  parkDormantTeams,
  parkTeam,
  resetSeasonSignups,
  runParkingSweep,
  selectActiveSubscriptionTeamIds,
  selectTeamsToPark,
  selectTeamsToUnpark,
  unparkSignedUpTeams,
  unparkTeam,
} from "./managerParking.js";
import { PRO_GRACE_AFTER_PERIOD_END_MS } from "./entitlement.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-09-28T09:00:00Z"); // S4 cutover-dato

function daysAgo(days) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function daysAhead(days) {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
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

function subscription(teamId, overrides = {}) {
  return {
    id: `sub-${teamId}`,
    team_id: teamId,
    status: "active",
    current_period_end: daysAhead(20),
    last_event_at: daysAgo(10),
    ...overrides,
  };
}

// -- In-memory Supabase-fake --------------------------------------------------
//
// Understøtter præcis de kæder managerParking bruger: select/eq/in/is/not/
// order/range (læsning via fetchAllRows) og update/eq/is/not/select (skrivning).

function makeFakeDb({ teams = [], users = [], subscriptions = [], appConfig = [] } = {}) {
  const tables = {
    teams: teams.map((t) => ({ ...t })),
    users: users.map((u) => ({ ...u })),
    subscriptions: subscriptions.map((s) => ({ ...s })),
    app_config: appConfig.map((c) => ({ ...c })),
  };
  const writes = [];

  function from(table) {
    if (!tables[table]) throw new Error(`Unexpected table: ${table}`);
    const filters = [];
    let updatePayload = null;

    const matching = () => tables[table].filter((row) => filters.every((f) => f(row)));
    const run = () => {
      if (updatePayload) {
        const hit = matching();
        for (const row of hit) Object.assign(row, updatePayload);
        writes.push({ table, payload: updatePayload, ids: hit.map((r) => r.id) });
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return { data: matching().map((r) => ({ ...r })), error: null };
    };

    const chain = {
      select() { return chain; },
      update(payload) { updatePayload = payload; return chain; },
      eq(col, val) { filters.push((row) => row[col] === val); return chain; },
      in(col, vals) { filters.push((row) => vals.includes(row[col])); return chain; },
      is(col, val) { filters.push((row) => (row[col] ?? null) === val); return chain; },
      not(col, op, val) {
        if (op === "is") filters.push((row) => (row[col] ?? null) !== val);
        else if (op === "in") {
          const ids = String(val).replace(/^\(|\)$/g, "").split(",").filter(Boolean);
          filters.push((row) => !ids.includes(String(row[col])));
        } else throw new Error(`fake: not(${op}) ikke understøttet`);
        return chain;
      },
      order() { return chain; },
      maybeSingle() {
        const result = run();
        return Promise.resolve({ data: result.data[0] ?? null, error: null });
      },
      upsert(row, { onConflict } = {}) {
        const existing = tables[table].find((r) => r[onConflict] === row[onConflict]);
        if (existing) Object.assign(existing, row);
        else tables[table].push({ ...row });
        writes.push({ table, payload: row, ids: [row[onConflict]] });
        return Promise.resolve({ error: null });
      },
      range(fromIdx, toIdx) {
        const result = run();
        return Promise.resolve({ ...result, data: result.data.slice(fromIdx, toIdx + 1) });
      },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return chain;
  }

  return { from, tables, writes, row: (id) => tables.teams.find((t) => t.id === id) };
}

// -- isSubscriptionProtectingTeam / selectActiveSubscriptionTeamIds -----------

test("isSubscriptionProtectingTeam: status 'active' beskytter altid", () => {
  assert.equal(isSubscriptionProtectingTeam(subscription("t1"), NOW), true);
  // også med en forældet periodeslut-cache: status 'active' er nok
  assert.equal(isSubscriptionProtectingTeam(subscription("t1", { current_period_end: daysAgo(40) }), NOW), true);
});

test("isSubscriptionProtectingTeam: opsagt men betalt til periodens slut beskytter", () => {
  assert.equal(isSubscriptionProtectingTeam(subscription("t1", { status: "cancelled", current_period_end: daysAhead(5) }), NOW), true);
  assert.equal(isSubscriptionProtectingTeam(subscription("t1", { status: "cancelled", current_period_end: daysAgo(1) }), NOW), false);
});

test("isSubscriptionProtectingTeam: rykker-status følger entitlement-respitten", () => {
  const withinGrace = new Date(NOW.getTime() - PRO_GRACE_AFTER_PERIOD_END_MS / 2).toISOString();
  const pastGrace = new Date(NOW.getTime() - PRO_GRACE_AFTER_PERIOD_END_MS * 2).toISOString();
  assert.equal(isSubscriptionProtectingTeam(subscription("t1", { status: "past_due", current_period_end: withinGrace }), NOW), true);
  assert.equal(isSubscriptionProtectingTeam(subscription("t1", { status: "past_due", current_period_end: pastGrace }), NOW), false);
});

test("isSubscriptionProtectingTeam: afsluttet abonnement eller manglende team_id beskytter ikke", () => {
  assert.equal(isSubscriptionProtectingTeam(subscription("t1", { status: "inactive" }), NOW), false);
  assert.equal(isSubscriptionProtectingTeam({ status: "active" }, NOW), false);
  assert.equal(isSubscriptionProtectingTeam(null, NOW), false);
});

test("selectActiveSubscriptionTeamIds: samler kun de beskyttende hold", () => {
  const ids = selectActiveSubscriptionTeamIds([
    subscription("paying"),
    subscription("ended", { status: "inactive" }),
  ], NOW);
  assert.deepEqual([...ids], ["paying"]);
});

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

test("selectTeamsToPark: hold med beskyttende abonnement parkeres ALDRIG, uanset inaktivitet", () => {
  const teams = [team({ id: "paying", user_id: "u1" }), team({ id: "free", user_id: "u2" })];
  const users = [user("u1", 90), user("u2", 90)];
  const picked = selectTeamsToPark({ teams, users, now: NOW, activeSubscriptionTeamIds: new Set(["paying"]) });
  assert.deepEqual(picked.map((t) => t.id), ["free"]);
  // array-form virker også
  const pickedFromArray = selectTeamsToPark({ teams, users, now: NOW, activeSubscriptionTeamIds: ["paying"] });
  assert.deepEqual(pickedFromArray.map((t) => t.id), ["free"]);
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

// -- selectTeamsToUnpark ------------------------------------------------------

test("selectTeamsToUnpark: kun parkerede hold med en tilmelding", () => {
  const teams = [
    team({ id: "parked-signed", parked_at: daysAgo(90), next_season_signup_at: daysAgo(2) }),
    team({ id: "parked-silent", parked_at: daysAgo(90) }),
    team({ id: "active-signed", next_season_signup_at: daysAgo(2) }),
    team({ id: "ai-parked-signed", is_ai: true, parked_at: daysAgo(90), next_season_signup_at: daysAgo(2) }),
  ];
  assert.deepEqual(selectTeamsToUnpark({ teams }).map((t) => t.id), ["parked-signed"]);
  assert.deepEqual(selectTeamsToUnpark({ teams: null }), []);
});

// -- parkTeam / parkDormantTeams ----------------------------------------------

test("parkTeam: markerer parked_at + rydder league_division_id, rører intet andet", async () => {
  const db = makeFakeDb({ teams: [team({ id: "t1", league_division_id: "pool-a" })] });
  const ok = await parkTeam({ supabase: db, teamId: "t1", now: NOW });
  assert.equal(ok, true);
  const row = db.row("t1");
  assert.equal(row.parked_at, NOW.toISOString());
  assert.equal(row.league_division_id, null);
  assert.equal(row.name, "Test CC"); // urørt
  assert.equal(row.division, 3); // urørt
});

test("parkTeam: idempotent — et allerede parkeret hold rammes ikke igen", async () => {
  const db = makeFakeDb({ teams: [team({ id: "t1", parked_at: daysAgo(3) })] });
  const ok = await parkTeam({ supabase: db, teamId: "t1", now: NOW });
  assert.equal(ok, false);
  assert.equal(db.row("t1").parked_at, daysAgo(3)); // uændret
});

test("parkDormantTeams: vælger og parkerer i ét kald, tæller korrekt", async () => {
  const teams = [
    team({ id: "dormant", user_id: "u1" }),
    team({ id: "active", user_id: "u2" }),
  ];
  const users = [user("u1", 45), user("u2", 2)];
  const db = makeFakeDb({ teams });
  const result = await parkDormantTeams({ supabase: db, teams, users, subscriptions: [], now: NOW });
  assert.equal(result.candidates, 1);
  assert.equal(result.parked, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.parkedTeamIds, ["dormant"]);
  assert.deepEqual(result.subscriptionProtectedTeamIds, []);
  assert.equal(db.row("dormant").parked_at, NOW.toISOString());
  assert.equal(db.row("active").parked_at, null);
});

test("parkDormantTeams: ingen kandidater → ingen writes", async () => {
  const teams = [team({ id: "active", user_id: "u1" })];
  const users = [user("u1", 1)];
  const db = makeFakeDb({ teams });
  const result = await parkDormantTeams({ supabase: db, teams, users, subscriptions: [], now: NOW });
  assert.equal(result.candidates, 0);
  assert.equal(result.parked, 0);
  assert.equal(db.writes.length, 0);
});

test("parkDormantTeams: henter selv abonnementer og springer et betalende hold over", async () => {
  const db = makeFakeDb({
    teams: [
      team({ id: "paying", user_id: "u1" }),
      team({ id: "free", user_id: "u2" }),
      team({ id: "ai", is_ai: true, user_id: null }),
    ],
    users: [user("u1", 60), user("u2", 60)],
    subscriptions: [subscription("paying")],
  });

  const result = await parkDormantTeams({ supabase: db, now: NOW });

  assert.deepEqual(result.parkedTeamIds, ["free"]);
  assert.deepEqual(result.subscriptionProtectedTeamIds, ["paying"]);
  assert.equal(db.row("paying").parked_at, null, "et betalende hold må aldrig parkeres");
  assert.equal(db.row("ai").parked_at, null);
});

test("loadParkingInputs: henter kun menneskehold, deres brugere og alle abonnementer", async () => {
  const db = makeFakeDb({
    teams: [team({ id: "h1", user_id: "u1" }), team({ id: "ai", is_ai: true, user_id: null }), team({ id: "bank", is_bank: true, user_id: "u9" })],
    users: [user("u1", 3), user("u9", 3), user("u-other", 3)],
    subscriptions: [subscription("h1")],
  });
  const inputs = await loadParkingInputs({ supabase: db });
  assert.deepEqual(inputs.teams.map((t) => t.id), ["h1"]);
  assert.deepEqual(inputs.users.map((u) => u.id), ["u1"]);
  assert.deepEqual(inputs.subscriptions.map((s) => s.team_id), ["h1"]);
});

// -- unparkTeam / unparkSignedUpTeams ----------------------------------------

test("unparkTeam: genindplacerer via placeringsreglen og reconciler AI i puljen", async () => {
  const db = makeFakeDb({ teams: [team({ id: "t1", parked_at: daysAgo(90), league_division_id: null, division: 2 })] });
  const reconciled = [];
  const result = await unparkTeam({
    supabase: db,
    teamId: "t1",
    pickDivision: async (client) => { assert.equal(client, db); return { division: 3, leagueDivisionId: "pool-d3a" }; },
    reconcileAiTeams: async ({ supabase, poolId }) => { assert.equal(supabase, db); reconciled.push(poolId); },
  });
  assert.deepEqual(result, { unparked: true, division: 3, leagueDivisionId: "pool-d3a" });
  const row = db.row("t1");
  assert.equal(row.parked_at, null);
  assert.equal(row.division, 3);
  assert.equal(row.league_division_id, "pool-d3a");
  assert.deepEqual(reconciled, ["pool-d3a"]);
});

test("unparkTeam: idempotent — et hold der ikke er parkeret, flyttes ikke og reconciler intet", async () => {
  const db = makeFakeDb({ teams: [team({ id: "t1", parked_at: null, league_division_id: "pool-x", division: 2 })] });
  let reconciled = false;
  const result = await unparkTeam({
    supabase: db,
    teamId: "t1",
    pickDivision: async () => ({ division: 3, leagueDivisionId: "pool-d3a" }),
    reconcileAiTeams: async () => { reconciled = true; },
  });
  assert.equal(result.unparked, false);
  assert.equal(db.row("t1").league_division_id, "pool-x");
  assert.equal(db.row("t1").division, 2);
  assert.equal(reconciled, false);
});

test("unparkTeam: en fejlende AI-reconcile vælter ikke genindplaceringen", async () => {
  const db = makeFakeDb({ teams: [team({ id: "t1", parked_at: daysAgo(90), league_division_id: null })] });
  const result = await unparkTeam({
    supabase: db,
    teamId: "t1",
    pickDivision: async () => ({ division: 4, leagueDivisionId: "pool-d4a" }),
    reconcileAiTeams: async () => { throw new Error("reconcile boom"); },
  });
  assert.equal(result.unparked, true);
  assert.equal(db.row("t1").league_division_id, "pool-d4a");
});

test("unparkSignedUpTeams: placerer ét hold ad gangen og samler fejl pr. hold", async () => {
  const teams = [
    team({ id: "a", parked_at: daysAgo(90), next_season_signup_at: daysAgo(2), league_division_id: null }),
    team({ id: "b", parked_at: daysAgo(90), next_season_signup_at: daysAgo(1), league_division_id: null }),
    team({ id: "c", parked_at: daysAgo(90), league_division_id: null }),
  ];
  const db = makeFakeDb({ teams });
  const picks = [];
  const result = await unparkSignedUpTeams({
    supabase: db,
    teams,
    pickDivision: async () => {
      picks.push(picks.length);
      if (picks.length === 2) throw new Error("placering fejlede");
      return { division: 3, leagueDivisionId: "pool-d3a" };
    },
    reconcileAiTeams: async () => {},
  });
  assert.equal(result.candidates, 2);
  assert.equal(result.unparked, 1);
  assert.deepEqual(result.failedTeamIds, ["b"]);
  assert.deepEqual(result.placements, [{ teamId: "a", division: 3, leagueDivisionId: "pool-d3a" }]);
  assert.equal(db.row("c").parked_at, daysAgo(90), "et parkeret hold uden tilmelding bliver parkeret");
});

// -- resetSeasonSignups -------------------------------------------------------

test("resetSeasonSignups: nulstiller alle tilmeldinger undtagen de fritagne", async () => {
  const db = makeFakeDb({
    teams: [
      team({ id: "a", next_season_signup_at: daysAgo(2) }),
      team({ id: "b", next_season_signup_at: daysAgo(1) }),
      team({ id: "c", next_season_signup_at: null }),
    ],
  });
  const count = await resetSeasonSignups({ supabase: db, keepTeamIds: ["b"] });
  assert.equal(count, 1);
  assert.equal(db.row("a").next_season_signup_at, null);
  assert.equal(db.row("b").next_season_signup_at, daysAgo(1), "fejlet genindplacering beholder tilmeldingen");
  assert.equal(db.row("c").next_season_signup_at, null);
});

// -- runParkingSweep ------------------------------------------------------------

test("runParkingSweep: parkerer, genindplacerer og nulstiller tilmeldinger i ét kald", async () => {
  const db = makeFakeDb({
    teams: [
      team({ id: "dormant", user_id: "u1" }),
      team({ id: "paying", user_id: "u2" }),
      team({ id: "active-signed", user_id: "u3", next_season_signup_at: daysAgo(3) }),
      team({ id: "dormant-signed", user_id: "u4", next_season_signup_at: daysAgo(3) }),
      team({ id: "parked-back", user_id: "u5", parked_at: daysAgo(90), league_division_id: null, next_season_signup_at: daysAgo(1) }),
      team({ id: "parked-silent", user_id: "u6", parked_at: daysAgo(90), league_division_id: null }),
    ],
    users: [user("u1", 60), user("u2", 60), user("u3", 1), user("u4", 60), user("u5", 1), user("u6", 120)],
    subscriptions: [subscription("paying")],
  });

  const sweep = await runParkingSweep({
    supabase: db,
    seasonId: "season-3",
    now: NOW,
    pickDivision: async () => ({ division: 3, leagueDivisionId: "pool-d3b" }),
    reconcileAiTeams: async () => {},
  });

  assert.equal(sweep.alreadySwept, false);
  assert.equal(db.tables.app_config.find((c) => c.key === PARKING_SWEEP_MARKER_KEY)?.value, "season-3", "markøren husker sæsonen");
  assert.deepEqual(sweep.park.parkedTeamIds, ["dormant"]);
  assert.deepEqual(sweep.park.subscriptionProtectedTeamIds, ["paying"]);
  assert.deepEqual(sweep.unpark.placements, [{ teamId: "parked-back", division: 3, leagueDivisionId: "pool-d3b" }]);
  assert.equal(sweep.signupsReset, 3);
  assert.equal(sweep.signupsResetError, null);

  assert.equal(db.row("dormant-signed").parked_at, null, "en tilmeldt manager parkeres aldrig");
  assert.equal(db.row("parked-back").parked_at, null);
  assert.equal(db.row("parked-back").league_division_id, "pool-d3b");
  assert.equal(db.row("parked-silent").parked_at, daysAgo(90));
  for (const id of ["active-signed", "dormant-signed", "parked-back"]) {
    assert.equal(db.row(id).next_season_signup_at, null, `${id}: tilmeldingen er brugt og nulstilles`);
  }
});

test("runParkingSweep: en fejlende nulstilling vælter ikke sweepen, men rapporteres", async () => {
  const db = makeFakeDb({ teams: [team({ id: "dormant", user_id: "u1" })], users: [user("u1", 60)] });
  const originalFrom = db.from;
  db.from = (table) => {
    const chain = originalFrom(table);
    const originalUpdate = chain.update;
    chain.update = (payload) => {
      if (payload && "next_season_signup_at" in payload) {
        return { not() { return this; }, select: async () => ({ data: null, error: { message: "reset boom" } }) };
      }
      return originalUpdate(payload);
    };
    return chain;
  };

  const sweep = await runParkingSweep({ supabase: db, seasonId: "season-3", now: NOW, pickDivision: async () => ({ division: 3, leagueDivisionId: null }) });

  assert.deepEqual(sweep.park.parkedTeamIds, ["dormant"]);
  assert.equal(sweep.signupsReset, null);
  assert.match(sweep.signupsResetError, /reset boom/);
});

// CodeRabbit-fund (#4592): processSeasonEnd kan genkøres. Uden idempotens pr.
// sæson ville anden kørsel se en tilmeldt, inaktiv manager som utilmeldt (første
// kørsel nulstillede tilmeldingen) og parkere holdet.
test("runParkingSweep: en genkørsel for SAMME sæson gør intet og parkerer ikke en brugt tilmelding", async () => {
  const db = makeFakeDb({
    teams: [
      team({ id: "dormant", user_id: "u1" }),
      team({ id: "dormant-signed", user_id: "u2", next_season_signup_at: daysAgo(3) }),
    ],
    users: [user("u1", 60), user("u2", 60)],
  });
  const deps = { pickDivision: async () => ({ division: 3, leagueDivisionId: "pool-d3a" }), reconcileAiTeams: async () => {} };

  const first = await runParkingSweep({ supabase: db, seasonId: "season-3", now: NOW, ...deps });
  assert.deepEqual(first.park.parkedTeamIds, ["dormant"]);
  assert.equal(db.row("dormant-signed").next_season_signup_at, null, "tilmeldingen er brugt");
  const writesAfterFirst = db.writes.length;

  const rerun = await runParkingSweep({ supabase: db, seasonId: "season-3", now: NOW, ...deps });

  assert.equal(rerun.alreadySwept, true);
  assert.equal(db.writes.length, writesAfterFirst, "genkørslen skriver intet");
  assert.equal(db.row("dormant-signed").parked_at, null, "en brugt tilmelding beskytter stadig i samme skifte");

  // Næste sæsons sweep er en ny sæson: uden ny tilmelding parkeres holdet dér.
  const nextSeason = await runParkingSweep({ supabase: db, seasonId: "season-4", now: NOW, ...deps });
  assert.equal(nextSeason.alreadySwept, false);
  assert.deepEqual(nextSeason.park.parkedTeamIds, ["dormant-signed"]);
});

test("runParkingSweep: kan markøren ikke skrives, nulstilles tilmeldingerne IKKE (genkørsel forbliver sikker)", async () => {
  const db = makeFakeDb({
    teams: [team({ id: "dormant-signed", user_id: "u1", next_season_signup_at: daysAgo(3) })],
    users: [user("u1", 60)],
  });
  const originalFrom = db.from;
  db.from = (table) => {
    const chain = originalFrom(table);
    if (table === "app_config") chain.upsert = async () => ({ error: { message: "marker boom" } });
    return chain;
  };

  const sweep = await runParkingSweep({ supabase: db, seasonId: "season-3", now: NOW, pickDivision: async () => ({ division: 3, leagueDivisionId: null }) });

  assert.match(sweep.signupsResetError, /marker boom/);
  assert.equal(sweep.signupsReset, null);
  assert.equal(db.row("dormant-signed").next_season_signup_at, daysAgo(3), "tilmeldingen står, så en genkørsel stadig beskytter holdet");
  assert.equal(db.row("dormant-signed").parked_at, null);
});

test("runParkingSweep: kræver seasonId (idempotens pr. sæson)", async () => {
  const db = makeFakeDb({ teams: [], users: [] });
  await assert.rejects(() => runParkingSweep({ supabase: db, now: NOW }), /seasonId required/);
});
