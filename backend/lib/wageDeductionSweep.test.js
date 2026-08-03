// Tests for wageDeductionSweep.js (#2840 — dagsbaseret løntræk, config-gated)
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldSweepNow,
  teamsNeedingWageSweep,
  computeTeamDailyWage,
  runWageDeductionSweep,
  DEFAULT_SEASON_LENGTH_DAYS,
} from "./wageDeductionSweep.js";

// ── shouldSweepNow (samme kl.22-CPH-gate som trainingSweep/scoutSweep) ────────

describe("shouldSweepNow", () => {
  it("sweep kun efter kl. 22 dansk tid", () => {
    assert.equal(shouldSweepNow(new Date("2026-06-20T19:59:00Z")), false); // 21:59 CEST
    assert.equal(shouldSweepNow(new Date("2026-06-20T20:01:00Z")), true); // 22:01 CEST
  });
});

// ── teamsNeedingWageSweep ──────────────────────────────────────────────────────

describe("teamsNeedingWageSweep", () => {
  it("filtrerer hold der allerede har fået trukket løn i dag", () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    const runs = [{ team_id: "t1", tick_date: "2026-08-03" }];
    assert.deepEqual(
      teamsNeedingWageSweep(teams, runs, "2026-08-03").map((t) => t.id),
      ["t2"]
    );
  });

  it("kørsler fra en anden dato tæller ikke", () => {
    const teams = [{ id: "t1" }];
    const runs = [{ team_id: "t1", tick_date: "2026-08-02" }];
    assert.deepEqual(
      teamsNeedingWageSweep(teams, runs, "2026-08-03").map((t) => t.id),
      ["t1"]
    );
  });
});

// ── computeTeamDailyWage (ren funktion — dagssats-formlen) ─────────────────────

describe("computeTeamDailyWage", () => {
  it("beregner round(salary/seasonLengthDays) pr. rytter og summerer", () => {
    const riders = [{ salary: 6000 }, { salary: 3000 }];
    const result = computeTeamDailyWage(riders, 60);
    assert.equal(result.amount, 100 + 50, "6000/60=100, 3000/60=50");
    assert.equal(result.ridersCharged, 2);
    assert.equal(result.seasonLengthDays, 60);
  });

  it("ignorerer ryttere med salary<=0 (fx usignede akademipladser)", () => {
    const riders = [{ salary: 6000 }, { salary: 0 }, { salary: null }];
    const result = computeTeamDailyWage(riders, 60);
    assert.equal(result.ridersCharged, 1);
    assert.equal(result.amount, 100);
  });

  it("falder tilbage til DEFAULT_SEASON_LENGTH_DAYS ved manglende/0 sæsonlængde", () => {
    const riders = [{ salary: 6000 }];
    const withZero = computeTeamDailyWage(riders, 0);
    const withUndefined = computeTeamDailyWage(riders, undefined);
    assert.equal(withZero.seasonLengthDays, DEFAULT_SEASON_LENGTH_DAYS);
    assert.equal(withUndefined.seasonLengthDays, DEFAULT_SEASON_LENGTH_DAYS);
    assert.equal(withZero.amount, Math.round(6000 / DEFAULT_SEASON_LENGTH_DAYS));
  });

  it("tomt roster giver 0/0", () => {
    assert.deepEqual(computeTeamDailyWage([], 60), { amount: 0, ridersCharged: 0, seasonLengthDays: 60 });
    assert.deepEqual(computeTeamDailyWage(null, 60), { amount: 0, ridersCharged: 0, seasonLengthDays: 60 });
  });
});

// ── runWageDeductionSweep — fuld mock, mirror af trainingSweep.test.js's mønster ──

// Statefuld mock: teams+season er faste pr. kørsel, men ridersByTeam og
// runsStore/financeRows deles på tværs af FLERE kald til runWageDeductionSweep
// på samme mock-instans, så tests kan simulere flere "dage" i træk (pro-rata,
// dobbelt-kørsel) ved blot at ændre `now` og mutere ridersByTeam mellem kald.
function makeSweepMock({
  mode = "daily",
  season = { id: "season-1", race_days_total: 60 },
  teams = [],
  ridersByTeam = {},
} = {}) {
  const financeRows = [];
  const runsStore = [];
  const usedIdempotencyKeys = new Set();

  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const key = params.p_finance_payload.idempotency_key;
      if (key && usedIdempotencyKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      if (key) usedIdempotencyKeys.add(key);
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "app_config") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: { value: mode }, error: null }); },
        };
      }
      if (table === "seasons") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: season, error: null }); },
        };
      }
      if (table === "teams") {
        const b = {
          select() { return b; },
          eq() { return b; },
          then(resolve, reject) { return Promise.resolve({ data: teams, error: null }).then(resolve, reject); },
        };
        return b;
      }
      if (table === "wage_daily_runs") {
        let tickDateFilter = null;
        const b = {
          select() { return b; },
          eq(_col, val) { tickDateFilter = val; return b; },
          then(resolve, reject) {
            const filtered = runsStore.filter((r) => r.tick_date === tickDateFilter);
            return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
          },
          insert(row) {
            runsStore.push(row);
            return Promise.resolve({ data: row, error: null });
          },
        };
        return b;
      }
      if (table === "riders") {
        let teamIdFilter = null;
        const b = {
          select() { return b; },
          eq(_col, val) { teamIdFilter = val; return b; },
          then(resolve, reject) {
            return Promise.resolve({ data: ridersByTeam[teamIdFilter] || [], error: null }).then(resolve, reject);
          },
        };
        return b;
      }
      throw new Error(`Unexpected table in wageDeductionSweep test: ${table}`);
    },
  };

  return { supabase, financeRows, runsStore, ridersByTeam };
}

// Tidspunkt EFTER kl. 22 dansk tid (CEST, UTC+2): 20:30 UTC = 22:30 CEST
const afterWindow = (dateStr) => new Date(`${dateStr}T20:30:00Z`);
const beforeWindow = new Date("2026-08-03T19:00:00Z"); // 21:00 CEST

test("#2840 · before_window når det er for tidligt", async () => {
  const { supabase } = makeSweepMock();
  const result = await runWageDeductionSweep({ supabase, now: beforeWindow });
  assert.deepEqual(result, { swept: 0, skipped: "before_window" });
});

test("#2840 · mode_off når wage_deduction_mode=season_upfront (default)", async () => {
  const { supabase, financeRows } = makeSweepMock({ mode: "season_upfront" });
  const result = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });
  assert.deepEqual(result, { swept: 0, skipped: "mode_off" });
  assert.equal(financeRows.length, 0, "intet skal debiteres når mode er off");
});

test("#2840 · no_active_season når der ikke er en aktiv sæson", async () => {
  const { supabase } = makeSweepMock({ season: null });
  const result = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });
  assert.deepEqual(result, { swept: 0, skipped: "no_active_season" });
});

test("#2840 · trækker daglig løn for et hold og markerer dagen", async () => {
  const teams = [{ id: "team-a" }];
  const ridersByTeam = { "team-a": [{ id: "r1", salary: 6000 }, { id: "r2", salary: 3000 }] };
  const { supabase, financeRows, runsStore } = makeSweepMock({ teams, ridersByTeam });

  const result = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });

  assert.deepEqual(result, { swept: 1 });
  const salaryRows = financeRows.filter((r) => r.type === "salary");
  assert.equal(salaryRows.length, 1);
  assert.equal(salaryRows[0].amount, -150, "-(6000/60 + 3000/60) = -150");
  assert.ok(
    salaryRows[0].idempotency_key.includes("team-a") && salaryRows[0].idempotency_key.includes("2026-08-03"),
    "idempotency-nøgle skal indeholde hold + tick-dato"
  );
  assert.equal(runsStore.length, 1, "wage_daily_runs skal have én marker-række");
  assert.equal(runsStore[0].riders_charged, 2);
});

test("#2840 · dobbelt-kørsel samme dag trækker IKKE løn to gange", async () => {
  const teams = [{ id: "team-a" }];
  const ridersByTeam = { "team-a": [{ id: "r1", salary: 6000 }] };
  const { supabase, financeRows } = makeSweepMock({ teams, ridersByTeam });

  const first = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });
  const second = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });

  assert.deepEqual(first, { swept: 1 });
  // Anden kørsel: marker-tabellen filtrerer holdet fra FØR debit-forsøget
  // overhovedet sker (pending-listen er tom) — swept=0, ingen ekstra finance-række.
  assert.deepEqual(second, { swept: 0 });
  const salaryRows = financeRows.filter((r) => r.type === "salary");
  assert.equal(salaryRows.length, 1, "præcis én løn-transaktion på tværs af begge kørsler");
});

test("#2840 · idempotency_key stopper dobbelttræk selv hvis marker-tabellen springes over", async () => {
  // Simulerer at wage_daily_runs-markeringen (effektivitets-lag) af en eller
  // anden grund IKKE forhindrede et 2. forsøg (fx race mellem to sweep-ticks) —
  // finance_transactions' unique idempotency_key SKAL stadig forhindre
  // dobbelttræk som sidste sikkerhedsnet.
  const teamId = "team-a";
  const tickDate = "2026-08-03";
  const financeRows = [];
  const usedIdempotencyKeys = new Set();
  const supabase = {
    rpc(name, params) {
      const key = params.p_finance_payload.idempotency_key;
      if (key && usedIdempotencyKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      if (key) usedIdempotencyKeys.add(key);
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
  };

  // Kalder debitTeam-stien direkte to gange med samme idempotency_key (mimer
  // to sweep-forsøg for samme hold+dag).
  const { debitTeam } = await import("./economyEngine.js");
  const { FINANCE_REASON } = await import("./economyConstants.js");
  const audit = {
    sourcePath: "test",
    reasonCode: FINANCE_REASON.SEASON_END_SALARY,
    idempotencyKey: `wage_daily:${teamId}:${tickDate}`,
  };
  await debitTeam(teamId, 100, "salary", null, "season-1", supabase, { idempotent: true, audit });
  await debitTeam(teamId, 100, "salary", null, "season-1", supabase, { idempotent: true, audit });

  assert.equal(financeRows.length, 1, "kun ÉN finance-række skal skrives — anden debitTeam-kald skal skippe via 23505");
});

test("#2840 · pro-rata: rytter købt midt i sæsonen betaler kun fra sin egen dag", async () => {
  const teams = [{ id: "team-a" }];
  // Dag 1: kun rytter A på truppen.
  const ridersByTeam = { "team-a": [{ id: "riderA", salary: 6000 }] };
  const { supabase, financeRows } = makeSweepMock({ teams, ridersByTeam });

  const day1 = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });
  assert.deepEqual(day1, { swept: 1 });

  // Dag 2: rytter B er nu købt og på truppen (aktuel roster afgør, ikke historik).
  ridersByTeam["team-a"] = [{ id: "riderA", salary: 6000 }, { id: "riderB", salary: 6000 }];
  const day2 = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-04") });
  assert.deepEqual(day2, { swept: 1 });

  const salaryRows = financeRows.filter((r) => r.type === "salary");
  assert.equal(salaryRows.length, 2, "én løn-transaktion pr. dag");
  assert.equal(salaryRows[0].amount, -100, "dag 1: kun rytter A (6000/60=100)");
  assert.equal(salaryRows[0].params_count ?? salaryRows[0].metadata?.params?.count, 1, "dag 1: 1 rytter betalt");
  assert.equal(salaryRows[1].amount, -200, "dag 2: rytter A + B (100+100=200) — B betaler KUN fra sin egen dag, ikke retroaktivt for dag 1");
  assert.equal(salaryRows[1].metadata?.params?.count, 2, "dag 2: 2 ryttere betalt");
});

test("#2840 · frigivet rytter stopper løntræk fra samme dag team_id nulstilles", async () => {
  const teams = [{ id: "team-a" }];
  const ridersByTeam = { "team-a": [{ id: "riderA", salary: 6000 }, { id: "riderB", salary: 6000 }] };
  const { supabase, financeRows } = makeSweepMock({ teams, ridersByTeam });

  const day1 = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });
  assert.deepEqual(day1, { swept: 1 });

  // riderB frigives (team_id nulstilles på riders-tabellen — her simuleret ved
  // at fjerne ham fra den forespørgsel wageDeductionSweep laver for holdet).
  ridersByTeam["team-a"] = [{ id: "riderA", salary: 6000 }];
  const day2 = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-04") });
  assert.deepEqual(day2, { swept: 1 });

  const salaryRows = financeRows.filter((r) => r.type === "salary");
  assert.equal(salaryRows[0].amount, -200, "dag 1: A+B (100+100)");
  assert.equal(salaryRows[1].amount, -100, "dag 2: kun A tilbage — B koster intet fra frigivelsesdagen");
});

test("#2840 · ét holds fejl stopper ikke det næste hold", async () => {
  const teams = [{ id: "team-ok" }, { id: "team-broken" }];
  const ridersByTeam = { "team-ok": [{ id: "r1", salary: 6000 }] }; // team-broken har bevidst ingen entry
  const { supabase, financeRows } = makeSweepMock({ teams, ridersByTeam });

  // Overskriv riders-mock så team-broken kaster en fejl (simulerer DB-fejl for netop dette hold).
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === "riders") {
      const b = {
        select() { return b; },
        eq(_col, val) {
          if (val === "team-broken") throw new Error("riders-load fejlede for team-broken");
          return originalFrom("riders").eq(_col, val);
        },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
      };
      return b;
    }
    return originalFrom(table);
  };

  const result = await runWageDeductionSweep({ supabase, now: afterWindow("2026-08-03") });
  assert.equal(result.swept, 1, "team-ok skal stadig gennemføres");
  assert.equal(result.failed, 1, "team-broken skal tælles som fejlet, ikke vælte hele sweepen");
  assert.equal(financeRows.filter((r) => r.type === "salary").length, 1);
});
