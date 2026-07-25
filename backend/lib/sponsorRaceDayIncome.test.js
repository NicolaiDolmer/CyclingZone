import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRaceDayCredits,
  computeResultBonusCredits,
  payRaceDaySponsorsToDate,
} from "./sponsorRaceDayIncome.js";
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

// ─── computeResultBonusCredits (#2948, 'results'-arketypen) ───────────────────

test("computeResultBonusCredits: tæller etapesejre (rank=1) og podier (rank 2-3) separat", () => {
  const credits = computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [
      { team_id: "t1", rank: 1 },
      { team_id: "t1", rank: 2 },
      { team_id: "t1", rank: 3 },
      { team_id: "t2", rank: 1 },
    ],
    contractsByTeam: {
      t1: { bonus_clauses: [{ type: "stage_win", amount: 6000 }, { type: "podium", amount: 2000 }] },
      t2: { bonus_clauses: [{ type: "stage_win", amount: 5000 }, { type: "podium", amount: 1000 }] },
    },
    remainingCapByTeam: {},
  });

  const t1 = credits.find((c) => c.teamId === "t1");
  assert.equal(t1.wins, 1);
  assert.equal(t1.podiums, 2);
  assert.equal(t1.amount, 6000 + 2 * 2000); // 10000
  assert.equal(t1.idempotencyKey, "sponsor_results:r1:t1");

  const t2 = credits.find((c) => c.teamId === "t2");
  assert.equal(t2.wins, 1);
  assert.equal(t2.podiums, 0);
  assert.equal(t2.amount, 5000);
});

test("computeResultBonusCredits: hold uden bonus-klausuler (fx safe/racing-kontrakter) ignoreres helt", () => {
  const credits = computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [{ team_id: "t1", rank: 1 }],
    contractsByTeam: { t1: { bonus_clauses: [] } }, // ingen stage_win/podium-klausul
    remainingCapByTeam: {},
  });
  assert.deepEqual(credits, []);
});

test("computeResultBonusCredits: hold uden kontrakt overhovedet ignoreres", () => {
  const credits = computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [{ team_id: "t-unknown", rank: 1 }],
    contractsByTeam: {},
    remainingCapByTeam: {},
  });
  assert.deepEqual(credits, []);
});

test("computeResultBonusCredits: kun rank 1-3 tæller (rank 4+ ignoreres)", () => {
  const credits = computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [{ team_id: "t1", rank: 4 }, { team_id: "t1", rank: 15 }],
    contractsByTeam: { t1: { bonus_clauses: [{ type: "stage_win", amount: 6000 }, { type: "podium", amount: 2000 }] } },
    remainingCapByTeam: {},
  });
  assert.deepEqual(credits, []);
});

test("computeResultBonusCredits: fælles results_cap klipper det udbetalte beløb (remainingCapByTeam)", () => {
  // 2 sejre × 6000 = 12000 rå, men kun 5000 tilbage af loftet → klippes til 5000.
  const credits = computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [{ team_id: "t1", rank: 1 }, { team_id: "t1", rank: 1 }],
    contractsByTeam: { t1: { bonus_clauses: [{ type: "stage_win", amount: 6000 }] } },
    remainingCapByTeam: { t1: 5000 },
  });
  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount, 5000);
});

test("computeResultBonusCredits: remainingCapByTeam <= 0 giver ingen kredit (loft opbrugt)", () => {
  const credits = computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [{ team_id: "t1", rank: 1 }],
    contractsByTeam: { t1: { bonus_clauses: [{ type: "stage_win", amount: 6000 }] } },
    remainingCapByTeam: { t1: 0 },
  });
  assert.deepEqual(credits, []);
});

test("computeResultBonusCredits: remainingCapByTeam muterer IKKE (caller-ansvar)", () => {
  const remainingCapByTeam = { t1: 5000 };
  computeResultBonusCredits({
    race: { id: "r1" },
    stageResults: [{ team_id: "t1", rank: 1 }, { team_id: "t1", rank: 1 }],
    contractsByTeam: { t1: { bonus_clauses: [{ type: "stage_win", amount: 6000 }] } },
    remainingCapByTeam,
  });
  assert.equal(remainingCapByTeam.t1, 5000, "pure funktion — caller decrementer selv");
});

// ─── payRaceDaySponsorsToDate (I/O-sti) ────────────────────────────────────────
// Faithful mock modelleret efter prizePayoutEngine.test.js / sponsorContractsService.test.js.
// Dækker præcis de queries servicen laver:
//   races:            .select(...).eq("season_id").eq("status","completed")  (thenable)
//   sponsor_contracts:.select("id, team_id, per_race_day_rate, bonus_clauses, results_bonus_paid").eq("status","active") (thenable)
//   race_results:     .select("team_id, result_type, rank").eq("race_id", id) (thenable)
//   sponsor_contracts.update({results_bonus_paid}).eq("id", id)              (registreres i state.updates)
//   rpc:              increment_balance_with_audit (via incrementBalanceWithAudit)
// rpc-mocken kører den ÆGTE incrementBalanceWithAudit-wrapper igennem, så vi tester
// hele I/O-stien — ikke en stubbet kredit-funktion.
function makeSupabase({
  races = [],
  contracts = [],
  resultsByRaceId = {},     // { [raceId]: [{ team_id, result_type, rank }] }
  skipKeys = new Set(),     // idempotency_keys der skal returnere 23505 (skip)
} = {}) {
  const state = { rpcCalls: [], updates: [] };

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
      if (table === "sponsor_contracts") {
        const ctx = {};
        const b = {
          select: () => b,
          eq: (col, val) => {
            ctx[col] = val;
            return b;
          },
          update: (payload) => {
            const u = {
              eq: (col, val) => {
                const row = contracts.find((c) => c[col] === val);
                if (row) Object.assign(row, payload);
                state.updates.push({ payload, eq: { col, val } });
                return Promise.resolve({ error: null });
              },
            };
            return u;
          },
          then: (resolve) => resolve({ data: contracts, error: null }),
        };
        return b;
      }
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
      { id: "c1", team_id: "t1", per_race_day_rate: 2000 },
      { id: "c2", team_id: "t2", per_race_day_rate: 1000 },
    ],
    resultsByRaceId: {
      r1: [{ team_id: "t1", result_type: "stage" }, { team_id: "t2", result_type: "stage" }, { team_id: "t1", result_type: "stage" }], // t1 duplet → dedupes
    },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 2, result_bonuses: 0 });
  // Kun race-day-kreditter (ingen bonus_clauses) — 2 rpc-kald.
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
      { id: "c1", team_id: "t1", per_race_day_rate: 0 },     // ingen per-dag → ingen kredit
      { id: "c2", team_id: "t2", per_race_day_rate: 1500 },
    ],
    resultsByRaceId: { r1: [{ team_id: "t1" }, { team_id: "t2" }] },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 1, result_bonuses: 0 });
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].teamId, "t2");
  assert.equal(supabase.state.rpcCalls[0].delta, 3000); // 1500 × 2 stages
});

test("payRaceDaySponsorsToDate hold uden aktiv kontrakt får ingen kredit", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 1, status: "completed" }],
    contracts: [{ id: "c1", team_id: "t1", per_race_day_rate: 1000 }],
    resultsByRaceId: { r1: [{ team_id: "t1" }, { team_id: "t-no-contract" }] },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 1, result_bonuses: 0 });
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].teamId, "t1");
});

test("payRaceDaySponsorsToDate er idempotent: skipped credit (23505) tæller ikke i credited", async () => {
  // Begge hold forsøges kreditteret, men t1's idempotency_key er allerede brugt
  // (replay) → balanceRpc returnerer skipped → credited må IKKE inkrementere for t1.
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 2, status: "completed" }],
    contracts: [
      { id: "c1", team_id: "t1", per_race_day_rate: 2000 },
      { id: "c2", team_id: "t2", per_race_day_rate: 1000 },
    ],
    resultsByRaceId: { r1: [{ team_id: "t1" }, { team_id: "t2" }] },
    skipKeys: new Set(["sponsor_race_day:r1:t1"]),
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  // Begge fik et rpc-forsøg, men kun t2 talte (t1 var en dublet).
  assert.equal(supabase.state.rpcCalls.length, 2);
  assert.deepEqual(result, { credited: 1, result_bonuses: 0 });
});

test("payRaceDaySponsorsToDate: ingen completede løb → { credited: 0, result_bonuses: 0 } uden at kaste", async () => {
  const supabase = makeSupabase({ races: [] });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 0, result_bonuses: 0 });
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test("payRaceDaySponsorsToDate: opts.actorType overstyrer default SYSTEM", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 1, status: "completed" }],
    contracts: [{ id: "c1", team_id: "t1", per_race_day_rate: 1000 }],
    resultsByRaceId: { r1: [{ team_id: "t1" }] },
  });

  await payRaceDaySponsorsToDate("season-1", supabase, { actorType: FINANCE_ACTOR_TYPE.CRON });

  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].payload.actor_type, FINANCE_ACTOR_TYPE.CRON);
});

// ─── Resultat-bonus-kreditering (#2948, 'results'-arketypen) — I/O-sti ────────

test("payRaceDaySponsorsToDate krediterer stage_win/podium-bonusser for etape-resultater og opdaterer results_bonus_paid", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 1, status: "completed" }],
    contracts: [
      {
        id: "c1",
        team_id: "t1",
        per_race_day_rate: 500,
        bonus_clauses: [
          { type: "stage_win", amount: 6120 },
          { type: "podium", amount: 2380 },
          { type: "results_cap", amount: 170000 },
        ],
        results_bonus_paid: 0,
      },
    ],
    resultsByRaceId: {
      r1: [
        { team_id: "t1", result_type: "stage", rank: 1 },
        { team_id: "t1", result_type: "stage", rank: 3 },
        { team_id: "t1", result_type: "gc", rank: 1 }, // ikke 'stage' → ignoreres
      ],
    },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  // 1 race-day-kredit + 1 resultat-bonus-kredit.
  assert.deepEqual(result, { credited: 1, result_bonuses: 1 });

  const bonusCall = supabase.state.rpcCalls.find((c) => c.payload.type === "sponsor_result_bonus");
  assert.ok(bonusCall, "forventede en resultat-bonus-kreditering");
  assert.equal(bonusCall.teamId, "t1");
  assert.equal(bonusCall.delta, 6120 + 2380); // 1 sejr + 1 podie
  assert.equal(bonusCall.payload.idempotency_key, "sponsor_results:r1:t1");
  assert.equal(bonusCall.payload.reason_code, FINANCE_REASON.SPONSOR_RESULT_BONUS);
  assert.equal(bonusCall.payload.related_entity_type, FINANCE_RELATED_ENTITY.RACE);

  // results_bonus_paid opdateret på kontrakten (persisteret loft-forbrug).
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.results_bonus_paid, 6120 + 2380);
});

test("payRaceDaySponsorsToDate: results_cap begrænser den samlede resultat-bonus på tværs af løb", async () => {
  const contract = {
    id: "c1",
    team_id: "t1",
    per_race_day_rate: 0,
    bonus_clauses: [
      { type: "stage_win", amount: 6000 },
      { type: "results_cap", amount: 8000 },
    ],
    results_bonus_paid: 0,
  };
  const supabase = makeSupabase({
    races: [
      { id: "r1", stages: 1, status: "completed" },
      { id: "r2", stages: 1, status: "completed" },
    ],
    contracts: [contract],
    resultsByRaceId: {
      // 2 sejre i r1 (12000 rå) — klippes til loftet 8000.
      r1: [{ team_id: "t1", result_type: "stage", rank: 1 }, { team_id: "t1", result_type: "stage", rank: 1 }],
      // Endnu en sejr i r2 — loftet er allerede opbrugt (0 tilbage) → ingen kredit.
      r2: [{ team_id: "t1", result_type: "stage", rank: 1 }],
    },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.equal(result.result_bonuses, 1, "kun r1's (klippede) bonus krediteres — r2 rammer et opbrugt loft");
  const bonusCalls = supabase.state.rpcCalls.filter((c) => c.payload.type === "sponsor_result_bonus");
  assert.equal(bonusCalls.length, 1);
  assert.equal(bonusCalls[0].delta, 8000, "klippet til results_cap");
});

test("payRaceDaySponsorsToDate: hold uden klausuler (safe/racing) ignoreres i resultat-bonus, men får stadig race-day-indkomst", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", stages: 1, status: "completed" }],
    contracts: [{ id: "c1", team_id: "t1", per_race_day_rate: 1000, bonus_clauses: [] }],
    resultsByRaceId: { r1: [{ team_id: "t1", result_type: "stage", rank: 1 }] },
  });

  const result = await payRaceDaySponsorsToDate("season-1", supabase);

  assert.deepEqual(result, { credited: 1, result_bonuses: 0 });
  assert.equal(supabase.state.updates.length, 0, "ingen results_bonus_paid-opdatering uden klausuler");
});
