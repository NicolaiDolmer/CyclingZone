import test from "node:test";
import assert from "node:assert/strict";
import { computeRaceDayCredits, payRaceDaySponsorsToDate } from "./sponsorRaceDayIncome.js";
import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "./economyConstants.js";

test("kreditér per_race_day_rate × stages for hvert deltagende hold", () => {
  const credits = computeRaceDayCredits({
    race: { id: "r1", stages: 3 },
    participatingTeamIds: ["t1", "t2"],
    contractsByTeam: { t1: { per_race_day_rate: 2000 }, t2: { per_race_day_rate: 0 } },
  });
  assert.deepEqual(credits, [
    { teamId: "t1", amount: 6000, idempotencyKey: "sponsor_race_day:r1:t1" },
  ]);
});

test("endagsløb (stages udefineret) tæller som 1 dag", () => {
  const credits = computeRaceDayCredits({
    race: { id: "r2" },
    participatingTeamIds: ["t1"],
    contractsByTeam: { t1: { per_race_day_rate: 1500 } },
  });
  assert.equal(credits[0].amount, 1500);
});

// ─── payRaceDaySponsorsToDate (I/O-sti) ────────────────────────────────────────
// Faithful mock modelleret efter prizePayoutEngine.test.js / sponsorContractsService.test.js.
// Dækker præcis de queries servicen laver:
//   races:            .select(...).eq("season_id").eq("status","completed")  (thenable)
//   sponsor_contracts:.select(...).eq("status","active")                     (thenable)
//   race_results:     .select("team_id").eq("race_id", id)                   (thenable)
//   rpc:              increment_balance_with_audit (via incrementBalanceWithAudit)
// rpc-mocken kører den ÆGTE incrementBalanceWithAudit-wrapper igennem, så vi tester
// hele I/O-stien — ikke en stubbet kredit-funktion.
function makeSupabase({
  races = [],
  contracts = [],
  resultsByRaceId = {},     // { [raceId]: [{ team_id }] }
  skipKeys = new Set(),     // idempotency_keys der skal returnere 23505 (skip)
} = {}) {
  const state = { rpcCalls: [] };

  function thenable(rows) {
    const b = {
      _ctx: {},
      select: () => b,
      eq(col, val) {
        b._ctx[col] = val;
        return b;
      },
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return b;
  }

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      state.rpcCalls.push({
        teamId: params.p_team_id,
        delta: params.p_delta,
        payload: params.p_finance_payload,
      });
      const key = params?.p_finance_payload?.idempotency_key;
      if (key && skipKeys.has(key)) {
        // Simulér uniq_finance_idempotency_key-konflikt → balanceRpc returnerer skipped.
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      return Promise.resolve({ data: 100000, error: null });
    },
    from(table) {
      if (table === "races") return thenable(races);
      if (table === "sponsor_contracts") return thenable(contracts);
      if (table === "race_results") {
        const b = {
          _raceId: null,
          select: () => b,
          eq(col, val) {
            if (col === "race_id") b._raceId = val;
            return b;
          },
          then: (resolve) =>
            resolve({ data: resultsByRaceId[b._raceId] ?? [], error: null }),
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("payRaceDaySponsorsToDate krediterer per_race_day_rate × stages til deltagende hold med aktiv kontrakt", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 3, status: "completed" }],
    contracts: [
      { team_id: "t1", per_race_day_rate: 2000 },
      { team_id: "t2", per_race_day_rate: 1000 },
    ],
    resultsByRaceId: {
      r1: [{ team_id: "t1" }, { team_id: "t2" }, { team_id: "t1" }], // t1 duplet → dedupes
    },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 2 });
  assert.equal(supabase.state.rpcCalls.length, 2);

  // t1: 2000 × 3 stages = 6000, korrekt idempotency_key + audit-felter.
  const t1 = supabase.state.rpcCalls.find((c) => c.teamId === "t1");
  assert.ok(t1, "forventede en kredit for t1");
  assert.equal(t1.delta, 6000);
  assert.equal(t1.payload.amount, 6000);
  assert.equal(t1.payload.idempotency_key, "sponsor_race_day:r1:t1");
  assert.equal(t1.payload.type, "sponsor_race_day");
  assert.equal(t1.payload.reason_code, FINANCE_REASON.SPONSOR_RACE_DAY);
  assert.equal(t1.payload.related_entity_type, FINANCE_RELATED_ENTITY.RACE);
  assert.equal(t1.payload.related_entity_id, "r1");
  assert.equal(t1.payload.actor_type, FINANCE_ACTOR_TYPE.SYSTEM); // default
  assert.equal(t1.payload.season_id, "season-1");
  assert.equal(t1.payload.race_id, "r1");

  // t2: 1000 × 3 = 3000.
  const t2 = supabase.state.rpcCalls.find((c) => c.teamId === "t2");
  assert.ok(t2, "forventede en kredit for t2");
  assert.equal(t2.delta, 3000);
  assert.equal(t2.payload.idempotency_key, "sponsor_race_day:r1:t2");
});

test("payRaceDaySponsorsToDate springer hold med per_race_day_rate = 0 over", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 2, status: "completed" }],
    contracts: [
      { team_id: "t1", per_race_day_rate: 0 },     // ingen per-dag → ingen kredit
      { team_id: "t2", per_race_day_rate: 1500 },
    ],
    resultsByRaceId: { r1: [{ team_id: "t1" }, { team_id: "t2" }] },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 1 });
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].teamId, "t2");
  assert.equal(supabase.state.rpcCalls[0].delta, 3000); // 1500 × 2 stages
});

test("payRaceDaySponsorsToDate hold uden aktiv kontrakt får ingen kredit", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 1, status: "completed" }],
    contracts: [{ team_id: "t1", per_race_day_rate: 1000 }],
    resultsByRaceId: { r1: [{ team_id: "t1" }, { team_id: "t-no-contract" }] },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 1 });
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].teamId, "t1");
});

test("payRaceDaySponsorsToDate er idempotent: skipped credit (23505) tæller ikke i credited", async () => {
  // Begge hold forsøges kreditteret, men t1's idempotency_key er allerede brugt
  // (replay) → balanceRpc returnerer skipped → credited må IKKE inkrementere for t1.
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 2, status: "completed" }],
    contracts: [
      { team_id: "t1", per_race_day_rate: 2000 },
      { team_id: "t2", per_race_day_rate: 1000 },
    ],
    resultsByRaceId: { r1: [{ team_id: "t1" }, { team_id: "t2" }] },
    skipKeys: new Set(["sponsor_race_day:r1:t1"]),
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  // Begge fik et rpc-forsøg, men kun t2 talte (t1 var en dublet).
  assert.equal(supabase.state.rpcCalls.length, 2);
  assert.deepEqual(result, { credited: 1 });
});

test("payRaceDaySponsorsToDate: ingen completede løb → { credited: 0 } uden at kaste", async () => {
  const supabase = makeSupabase({ races: [] });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 0 });
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test("payRaceDaySponsorsToDate: opts.actorType overstyrer default SYSTEM", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 1, status: "completed" }],
    contracts: [{ team_id: "t1", per_race_day_rate: 1000 }],
    resultsByRaceId: { r1: [{ team_id: "t1" }] },
  });

  await payRaceDaySponsorsToDate("season-1", supabase, { actorType: FINANCE_ACTOR_TYPE.CRON });

  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].payload.actor_type, FINANCE_ACTOR_TYPE.CRON);
});
