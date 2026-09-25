// #5643 · comebackService.returnParkedTeam: placering, pro rata sponsor, idempotens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import {
  returnParkedTeam,
  payComebackSponsor,
  comebackSponsorKey,
  seasonSponsorKeys,
  ComebackError,
  assignYouthGroupsForComebackTeam,
} from "./comebackService.js";
import { YOUTH_GROUP_TIER } from "./youthPoolAssignment.js";

// createFakeSupabase kender ikke PostgREST's .or(); withSeniorSquadScope bruger den til
// senior-scopet (#5517). Her registreres kaldet og ignoreres, så puljefiltreringen testes
// i pickComebackPool (som også selv springer ungdomspuljer over).
function fakeDb(state) {
  const supabase = createFakeSupabase(state);
  const from = supabase.from.bind(supabase);
  supabase.orFilters = [];
  supabase.from = (table) => {
    const t = from(table);
    const select = t.select;
    t.select = (cols) => {
      const q = select(cols);
      q.or = (filter) => { supabase.orFilters.push({ table, filter }); return q; };
      return q;
    };
    return t;
  };
  return supabase;
}

const SEASON = "season-4";
const TEAM = "team-a";
const PARKED_AT = "2026-09-27T20:00:00+00:00";

function aiTeam(id, poolId) {
  return { id, league_division_id: poolId, is_ai: true, is_bank: false, retired_at: null, pending_removal_at: null };
}

function baseState({ rank = 30, points = 1000, parkedAt = PARKED_AT, contract = true, extraFinance = [], extraRank = [] } = {}) {
  return {
    seasons: [
      { id: SEASON, number: 4, status: "active", race_days_total: 140, race_days_completed: 35 },
      { id: "season-3", number: 3, status: "completed", race_days_total: 140, race_days_completed: 140 },
    ],
    teams: [
      {
        id: TEAM, user_id: "user-a", is_ai: false, is_bank: false, retired_at: null, pending_removal_at: null,
        parked_at: parkedAt, next_season_signup_at: "2026-09-26T10:00:00+00:00",
        league_division_id: null, division: 3, comeback_season_id: null,
      },
      aiTeam("ai-2a", 2),
      aiTeam("ai-3a-1", 3),
      aiTeam("ai-3a-2", 3),
      aiTeam("ai-4a", 4),
    ],
    league_divisions: [
      { id: 1, tier: 1, pool_index: 0, label: "1A" },
      { id: 2, tier: 2, pool_index: 0, label: "2A" },
      { id: 3, tier: 2, pool_index: 1, label: "2B" },
      { id: 4, tier: 3, pool_index: 0, label: "3A" },
    ],
    global_rank_mv: [
      { team_id: TEAM, global_rank: rank, global_points: points },
      ...extraRank,
    ],
    sponsor_contracts: contract
      ? [{ id: "contract-a", team_id: TEAM, status: "active", sponsor_name: "Sponsor A", guaranteed_base: 400000 }]
      : [],
    finance_transactions: [...extraFinance],
  };
}

// Fake credit: skriver en finance-række og afviser en gentaget idempotency_key, som
// DB'ens unikke indeks gør (allowDuplicate → skipped).
function makeDeps(supabase, overrides = {}) {
  const calls = { credit: [], ai: [], calendar: [], midSeason: [], errors: [] };
  const deps = {
    creditFn: async (client, { teamId, delta, payload }, opts) => {
      calls.credit.push({ teamId, delta, payload, opts });
      const rows = client.state.finance_transactions;
      if (rows.some((r) => r.idempotency_key === payload.idempotency_key)) return { skipped: true, balance: null };
      rows.push({ id: `ft-${rows.length}`, team_id: teamId, amount: delta, idempotency_key: payload.idempotency_key });
      return { skipped: false, balance: delta };
    },
    reconcileAiTeamsFn: async (args) => { calls.ai.push(args.poolId); return { removed: 0 }; },
    reconcilePoolCalendarFn: async (args) => { calls.calendar.push(args.poolId); return { skipped: "has-calendar" }; },
    ensureMidSeasonSponsorFn: async ({ team }) => { calls.midSeason.push(team.id); return { paid: true, amount: 123 }; },
    captureExceptionFn: (err) => { calls.errors.push(err); },
    ...overrides,
  };
  return { deps, calls };
}

test("parkeret hold med rang 30 lander i D2-puljen med flest AI-pladser", async () => {
  const supabase = fakeDb(baseState({ rank: 30 }));
  const { deps, calls } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(result.returned, true);
  assert.equal(result.alreadyReturned, false);
  assert.equal(result.division, 2);
  assert.equal(result.leagueDivisionId, 3, "2B har to AI-hold, 2A har ét");
  const team = supabase.state.teams.find((t) => t.id === TEAM);
  assert.equal(team.league_division_id, 3);
  assert.equal(team.division, 2);
  assert.equal(team.parked_at, null);
  assert.equal(team.next_season_signup_at, null);
  assert.equal(team.comeback_season_id, SEASON);
  assert.deepEqual(calls.ai, [3]);
  assert.deepEqual(calls.calendar, [3]);
  assert.ok(supabase.orFilters.some((f) => f.table === "league_divisions"), "puljerne læses senior-scopet (#5517)");
});

test("pro rata sponsor: garanteret base × resterende andel af løbsdagene", async () => {
  const supabase = fakeDb(baseState());
  const { deps, calls } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  // 105 af 140 løbsdage tilbage → 75 % af den garanterede base.
  assert.equal(calls.credit.length, 1);
  assert.equal(calls.credit[0].delta, 300000);
  assert.equal(calls.credit[0].payload.idempotency_key, comebackSponsorKey(SEASON, TEAM));
  assert.equal(calls.credit[0].opts.allowDuplicate, true);
  assert.deepEqual(result.sponsor.paid, true);
  assert.equal(result.sponsor.amount, 300000);
});

test("idempotens: to kald giver én betaling og én placering", async () => {
  const supabase = fakeDb(baseState());
  const { deps, calls } = makeDeps(supabase);

  await returnParkedTeam({ supabase, teamId: TEAM, deps });
  const second = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(second.alreadyReturned, true);
  assert.equal(second.division, 2);
  const paid = supabase.state.finance_transactions.filter((r) => r.team_id === TEAM);
  assert.equal(paid.length, 1, "gentaget kald må ikke betale igen");
  assert.equal(second.sponsor.paid, false);
  assert.deepEqual(calls.ai, [3], "puljen reconciles kun ved selve placeringen");
});

test("ingen dobbelt sponsor: holdet fik allerede sæsonstartens sponsor", async () => {
  const [seasonStartKey] = seasonSponsorKeys(SEASON, TEAM);
  const supabase = fakeDb(baseState({
    extraFinance: [{ id: "ft-start", team_id: TEAM, amount: 400000, idempotency_key: seasonStartKey }],
  }));
  const { deps, calls } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(result.returned, true);
  assert.equal(calls.credit.length, 0);
  assert.equal(result.sponsor.skipped, "already_paid_this_season");
});

test("ingen dobbelt sponsor: holdet fik allerede midt-sæson-sponsoren", async () => {
  const [, midSeasonKey] = seasonSponsorKeys(SEASON, TEAM);
  const supabase = fakeDb(baseState({
    extraFinance: [{ id: "ft-mid", team_id: TEAM, amount: 1, idempotency_key: midSeasonKey }],
  }));
  const { deps, calls } = makeDeps(supabase);

  await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(calls.credit.length, 0);
});

test("uden aktiv kontrakt: kontrakt og betaling som for et nyt hold", async () => {
  const supabase = fakeDb(baseState({ contract: false }));
  const { deps, calls } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.deepEqual(calls.midSeason, [TEAM]);
  assert.equal(calls.credit.length, 0);
  assert.equal(result.sponsor.amount, 123);
});

test("sæsonen er slut: ingen sponsor, men holdet kommer tilbage", async () => {
  const state = baseState();
  state.seasons[0].race_days_completed = 140;
  const supabase = fakeDb(state);
  const { deps, calls } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(result.returned, true);
  assert.equal(result.sponsor.skipped, "season_over");
  assert.equal(calls.credit.length, 0);
});

test("NULL-rang: rangeres på point blandt menneskehold", async () => {
  const above = Array.from({ length: 80 }, (_, i) => ({ team_id: `h-${i}`, global_rank: i + 1, global_points: 5000 }));
  const supabase = fakeDb(baseState({ rank: null, points: 900, extraRank: above }));
  const { deps } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(result.rank, 81);
  assert.equal(result.tier, 3);
  assert.equal(result.leagueDivisionId, 4);
});

test("NULL-rang uden point går til bunden (D4)", async () => {
  const state = baseState({ rank: null, points: 0 });
  state.league_divisions.push({ id: 5, tier: 4, pool_index: 0, label: "4A" });
  state.teams.push(aiTeam("ai-4b", 5));
  const supabase = fakeDb(state);
  const { deps } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(result.division, 4);
  assert.equal(result.leagueDivisionId, 5);
});

test("ikke parkeret → ComebackError not_parked (409), intet ændres", async () => {
  const supabase = fakeDb(baseState({ parkedAt: null }));
  const { deps, calls } = makeDeps(supabase);

  await assert.rejects(
    () => returnParkedTeam({ supabase, teamId: TEAM, deps }),
    (err) => err instanceof ComebackError && err.code === "not_parked" && err.status === 409,
  );
  assert.equal(calls.credit.length, 0);
});

test("ingen aktiv sæson → no_active_season (409)", async () => {
  const state = baseState();
  state.seasons[0].status = "completed";
  const supabase = fakeDb(state);
  const { deps } = makeDeps(supabase);

  await assert.rejects(
    () => returnParkedTeam({ supabase, teamId: TEAM, deps }),
    (err) => err instanceof ComebackError && err.code === "no_active_season",
  );
  assert.notEqual(supabase.state.teams.find((t) => t.id === TEAM).parked_at, null);
});

test("ukendt hold → team_not_found (404)", async () => {
  const supabase = fakeDb(baseState());
  const { deps } = makeDeps(supabase);
  await assert.rejects(
    () => returnParkedTeam({ supabase, teamId: "ghost", deps }),
    (err) => err instanceof ComebackError && err.status === 404,
  );
});

test("en fejlet sponsor-udbetaling vælter ikke comebacket, og et nyt kald betaler", async () => {
  const supabase = fakeDb(baseState());
  let fail = true;
  const { deps, calls } = makeDeps(supabase);
  const realCredit = deps.creditFn;
  deps.creditFn = async (...args) => {
    if (fail) throw new Error("rpc down");
    return realCredit(...args);
  };

  const first = await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(first.returned, true);
  assert.equal(first.sponsor.paid, false);
  assert.equal(calls.errors.length, 1);

  fail = false;
  const retry = await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(retry.alreadyReturned, true);
  assert.equal(retry.sponsor.paid, true);
  assert.equal(supabase.state.finance_transactions.length, 1);
});

test("fejl i AI- eller kalender-opfølgning er ikke-fatal", async () => {
  const supabase = fakeDb(baseState());
  const { deps, calls } = makeDeps(supabase, {
    reconcileAiTeamsFn: async () => { throw new Error("ai boom"); },
    reconcilePoolCalendarFn: async () => { throw new Error("cal boom"); },
  });
  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });
  assert.equal(result.returned, true);
  assert.equal(result.followUp.aiReconcile.error, "ai boom");
  assert.equal(result.followUp.calendar.error, "cal boom");
  assert.equal(calls.errors.length, 2);
});

test("payComebackSponsor: base 0 betaler intet", async () => {
  const state = baseState();
  state.sponsor_contracts[0].guaranteed_base = 0;
  const supabase = fakeDb(state);
  const { deps, calls } = makeDeps(supabase);
  const result = await payComebackSponsor({
    supabase,
    team: { id: TEAM },
    season: state.seasons[0],
    creditFn: deps.creditFn,
  });
  assert.equal(result.paid, false);
  assert.equal(calls.credit.length, 0);
});

// ── #5676 (Y3 opfølgning, Refs #5646 #5661): comeback overtager en AI-plads' ────
// eksisterende ungdomsgrupper ─────────────────────────────────────────────────

function withYouthGroups(state) {
  const u23Pool = { id: "u23-a", squad: "u23", tier: YOUTH_GROUP_TIER, pool_index: 0, label: "U23 Group A" };
  const juniorPool = { id: "junior-a", squad: "junior", tier: YOUTH_GROUP_TIER, pool_index: 0, label: "Junior Group A" };
  state.league_divisions.push(u23Pool, juniorPool);
  // Den AI-plads comebacket overtager har allerede begge ungdomsgrupper.
  state.teams.push(
    { id: "ai-youth-1", is_ai: true, u23_league_division_id: u23Pool.id, junior_league_division_id: juniorPool.id },
  );
  return { state, u23Pool, juniorPool };
}

test("#5676 comeback: holdet overtager AI-holdets eksisterende u23- og junior-gruppe", async () => {
  const { state, u23Pool, juniorPool } = withYouthGroups(baseState({ rank: 30 }));
  const supabase = fakeDb(state);
  const { deps } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(result.returned, true);
  const team = supabase.state.teams.find((t) => t.id === TEAM);
  assert.equal(team.u23_league_division_id, u23Pool.id);
  assert.equal(team.junior_league_division_id, juniorPool.id);
});

test("#5676 comeback: rører ALDRIG et hold der allerede har en ungdomsgruppe (idempotent)", async () => {
  const { state, juniorPool } = withYouthGroups(baseState({ rank: 30 }));
  const otherU23Pool = { id: "u23-b", squad: "u23", tier: YOUTH_GROUP_TIER, pool_index: 1, label: "U23 Group B" };
  state.league_divisions.push(otherU23Pool);
  state.teams.find((t) => t.id === TEAM).u23_league_division_id = otherU23Pool.id;
  const supabase = fakeDb(state);
  const { deps } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(result.returned, true);
  const team = supabase.state.teams.find((t) => t.id === TEAM);
  assert.equal(team.u23_league_division_id, otherU23Pool.id, "u23-gruppen var allerede sat og røres ikke");
  assert.equal(team.junior_league_division_id, juniorPool.id, "junior-gruppen mangler stadig og bliver sat");
});

test("#5676 comeback: en genoptagelse (allerede vendt tilbage i sæsonen) forsøger også ungdomsgruppe-placering", async () => {
  const { state, u23Pool, juniorPool } = withYouthGroups(baseState({ rank: 30 }));
  const supabase = fakeDb(state);
  const { deps } = makeDeps(supabase);

  await returnParkedTeam({ supabase, teamId: TEAM, deps });
  // Andet kald rammer alreadyReturned-grenen (holdet er ikke længere parkeret).
  const second = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(second.alreadyReturned, true);
  const team = supabase.state.teams.find((t) => t.id === TEAM);
  assert.equal(team.u23_league_division_id, u23Pool.id);
  assert.equal(team.junior_league_division_id, juniorPool.id);
});

test("#5676 comeback: ingen ungdomsgrupper seedet endnu → ikke-fatal, comebacket lykkes stadig", async () => {
  const supabase = fakeDb(baseState({ rank: 30 }));
  const { deps } = makeDeps(supabase);

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(result.returned, true);
  const team = supabase.state.teams.find((t) => t.id === TEAM);
  assert.equal(team.u23_league_division_id, undefined);
  assert.equal(team.junior_league_division_id, undefined);
});

test("#5676 assignYouthGroupsForComebackTeam: fejl er ikke-fatal for selve comebacket", async () => {
  const { state } = withYouthGroups(baseState({ rank: 30 }));
  const supabase = fakeDb(state);
  const { deps, calls } = makeDeps(supabase, {
    assignYouthGroupsFn: async () => { throw new Error("youth boom"); },
  });

  const result = await returnParkedTeam({ supabase, teamId: TEAM, deps });

  assert.equal(result.returned, true);
  assert.ok(calls.errors.some((e) => e.message === "youth boom"));
});

test("#5676 assignYouthGroupsForComebackTeam (CodeRabbit-fund): fuld gruppe MED en AI-plads → AI-holdet viger, gruppen forbliver 24", async () => {
  const fullGroup = { id: "u23-full", squad: "u23", tier: YOUTH_GROUP_TIER, pool_index: 0 };
  const managers = Array.from({ length: 23 }, (_, i) => ({ id: `m${i}`, is_ai: false, u23_league_division_id: fullGroup.id }));
  const supabase = fakeDb({
    league_divisions: [fullGroup],
    teams: [
      { id: "comeback-evict", is_ai: false },
      { id: "ai-to-evict", is_ai: true, u23_league_division_id: fullGroup.id },
      ...managers,
    ],
  });

  const result = await assignYouthGroupsForComebackTeam({ supabase, team: { id: "comeback-evict" } });

  assert.equal(result.assigned.u23.leagueDivisionId, fullGroup.id);
  assert.equal(result.assigned.u23.evictedAiTeamId, "ai-to-evict");
  const evictedAi = supabase.state.teams.find((t) => t.id === "ai-to-evict");
  assert.equal(evictedAi.u23_league_division_id, null);
  const inGroup = supabase.state.teams.filter((t) => t.u23_league_division_id === fullGroup.id);
  assert.equal(inGroup.length, 24, "gruppen forbliver 24, ikke 25");
});

test("#5676 assignYouthGroupsForComebackTeam (ren enhedstest): vælger gruppen med flest AI-hold", async () => {
  const u23Groups = [
    { id: "u23-x", squad: "u23", tier: YOUTH_GROUP_TIER, pool_index: 0 },
    { id: "u23-y", squad: "u23", tier: YOUTH_GROUP_TIER, pool_index: 1 },
  ];
  const supabase = fakeDb({
    league_divisions: u23Groups,
    teams: [
      { id: "comeback-team", is_ai: false },
      { id: "ai-1", is_ai: true, u23_league_division_id: "u23-y" },
      { id: "ai-2", is_ai: true, u23_league_division_id: "u23-y" },
      { id: "ai-3", is_ai: true, u23_league_division_id: "u23-x" },
    ],
  });

  const result = await assignYouthGroupsForComebackTeam({ supabase, team: { id: "comeback-team" } });

  assert.equal(result.assigned.u23.leagueDivisionId, "u23-y", "gruppen med to AI-hold vinder over gruppen med ét");
  const team = supabase.state.teams.find((t) => t.id === "comeback-team");
  assert.equal(team.u23_league_division_id, "u23-y");
});
