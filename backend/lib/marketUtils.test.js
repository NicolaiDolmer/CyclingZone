import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRiderMarketValue,
  getIncomingSquadViolation,
  getOutgoingSquadViolation,
  getTeamMarketState,
  MARKET_SQUAD_LIMITS,
  RIDER_BASE_VALUE_FALLBACK,
  resolveRiderSalary,
  TRANSFER_WINDOW_SOFT_CAP_BUFFER,
} from "./marketUtils.js";

test("getIncomingSquadViolation includes pending riders in the max check", () => {
  const issue = getIncomingSquadViolation({
    division: 3,
    total_count: 30,
    squad_limits: { min: 8, max: 30 },
  });

  assert.equal(issue?.maxRiders, 30);
  assert.equal(issue?.totalAfter, 31);
  assert.equal(issue?.effectiveCap, 30);
  assert.equal(issue?.softCapBuffer, 0);
});

// #267: under åbent transfervindue må køber gå +TRANSFER_WINDOW_SOFT_CAP_BUFFER
// over hard-cap. Hard-cap'en bliver håndhævet af squadEnforcement-cron ved
// vindue-luk (auto-salg + bøde + penalty).
test("getIncomingSquadViolation tillader soft-cap buffer i åbent vindue", () => {
  const issue = getIncomingSquadViolation(
    {
      division: 3,
      total_count: 30,
      squad_limits: { min: 8, max: 30 },
    },
    { softCapBuffer: TRANSFER_WINDOW_SOFT_CAP_BUFFER }
  );

  assert.equal(issue, null);
});

test("getIncomingSquadViolation blokerer over soft-cap selv i åbent vindue", () => {
  const issue = getIncomingSquadViolation(
    {
      division: 3,
      total_count: 32,
      squad_limits: { min: 8, max: 30 },
    },
    { softCapBuffer: TRANSFER_WINDOW_SOFT_CAP_BUFFER }
  );

  assert.equal(issue?.maxRiders, 30);
  assert.equal(issue?.totalAfter, 33);
  assert.equal(issue?.effectiveCap, 32);
  assert.equal(issue?.softCapBuffer, 2);
});

test("getIncomingSquadViolation hard-cap'er når softCapBuffer er 0 (closed window)", () => {
  const issue = getIncomingSquadViolation(
    {
      division: 1,
      total_count: 30,
      squad_limits: { min: 20, max: 30 },
    },
    { softCapBuffer: 0 }
  );

  assert.equal(issue?.maxRiders, 30);
  assert.equal(issue?.totalAfter, 31);
  assert.equal(issue?.effectiveCap, 30);
});

test("getIncomingSquadViolation skalerer soft-cap til alle divisioner", () => {
  // #838: alle divisioner deler max 30 → soft-cap 30 + 2 = 32 overalt.
  // D1: max 30 + 2 = 32
  assert.equal(
    getIncomingSquadViolation(
      { division: 1, total_count: 31, squad_limits: { min: 20, max: 30 } },
      { softCapBuffer: 2 }
    ),
    null
  );
  // D2: max 30 + 2 = 32
  assert.equal(
    getIncomingSquadViolation(
      { division: 2, total_count: 31, squad_limits: { min: 14, max: 30 } },
      { softCapBuffer: 2 }
    ),
    null
  );
  // D3: max 30 + 2 = 32
  assert.equal(
    getIncomingSquadViolation(
      { division: 3, total_count: 31, squad_limits: { min: 8, max: 30 } },
      { softCapBuffer: 2 }
    ),
    null
  );
});

// Generisk mekanik-test: funktionen blokerer FORTSAT hvis den får en eksplicit
// min>0 (bevares for fremtidig config / board-injektion). I prod er den reelle
// floor 0 (se MARKET_SQUAD_LIMITS-testen nedenfor), så den fyrer aldrig.
test("getOutgoingSquadViolation blocks when given an explicit positive minimum", () => {
  const issue = getOutgoingSquadViolation({
    division: 1,
    total_count: 20,
    squad_limits: { min: 20, max: 30 },
  });

  assert.equal(issue?.minRiders, 20);
  assert.equal(issue?.totalAfter, 19);
});

test("MARKET_SQUAD_LIMITS har min=0 i alle divisioner (roster-floor fjernet 2026-06-05)", () => {
  assert.equal(MARKET_SQUAD_LIMITS[1].min, 0);
  assert.equal(MARKET_SQUAD_LIMITS[2].min, 0);
  assert.equal(MARKET_SQUAD_LIMITS[3].min, 0);
});

test("getOutgoingSquadViolation tillader salg helt ned til 0 med division-default limits", () => {
  // Uden eksplicit squad_limits falder funktionen tilbage til getSquadLimits(division).min = 0,
  // så en manager kan sælge sin sidste rytter (future_count 1 → 0) uden violation.
  assert.equal(getOutgoingSquadViolation({ division: 3, future_count: 1 }), null);
  assert.equal(getOutgoingSquadViolation({ division: 1, future_count: 1 }), null);
});

// #268: outgoingCount-query bruger chained .eq + .not + .neq for at finde
// "pending-out"-ryttere (ejet nu, men på vej til andet hold). Mocken er en
// chainable builder der collecter alle filtre og dispatcher tæller efter
// hvilken kombination der matches.
function createTeamMarketStateSupabase({
  team = {
    id: "team-1",
    name: "Team 1",
    balance: 200,
    division: 2,
    user_id: "user-1",
  },
  riderCount = 0,
  pendingCount = 0,
  outgoingCount = 0,
  activeLoanCount = 0,
} = {}) {
  function ridersQuery() {
    const filters = { eq: {}, notIsNull: new Set(), neq: {} };
    const builder = {
      eq(col, val) { filters.eq[col] = val; return promiseOrBuilder(); },
      not(col, op, val) {
        if (op === "is" && val === null) filters.notIsNull.add(col);
        return promiseOrBuilder();
      },
      neq(col, val) { filters.neq[col] = val; return promiseOrBuilder(); },
      then(resolve, reject) { return resolveCount().then(resolve, reject); },
    };
    function promiseOrBuilder() {
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === "then") return (res, rej) => resolveCount().then(res, rej);
          return target[prop];
        },
      });
    }
    function resolveCount() {
      const hasOutgoingFilters = filters.notIsNull.has("pending_team_id") && "pending_team_id" in filters.neq;
      if (hasOutgoingFilters && filters.eq.team_id === team.id) {
        return Promise.resolve({ count: outgoingCount, error: null });
      }
      if (filters.eq.team_id === team.id) {
        return Promise.resolve({ count: riderCount, error: null });
      }
      if (filters.eq.pending_team_id === team.id) {
        return Promise.resolve({ count: pendingCount, error: null });
      }
      throw new Error(`Unexpected riders filter combo: ${JSON.stringify({ eq: filters.eq, notIsNull: [...filters.notIsNull], neq: filters.neq })}`);
    }
    return builder;
  }

  return {
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "id, name, balance, division, user_id");

            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, team.id);

                return {
                  single() {
                    return Promise.resolve({ data: team, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(columns, options) {
            assert.equal(columns, "id");
            assert.deepEqual(options, { count: "exact", head: true });
            return ridersQuery();
          },
        };
      }

      if (table === "loan_agreements") {
        return {
          select(columns, options) {
            assert.equal(columns, "id");
            assert.deepEqual(options, { count: "exact", head: true });

            return {
              eq(firstColumn, firstValue) {
                assert.equal(firstColumn, "to_team_id");
                assert.equal(firstValue, team.id);

                return {
                  in(secondColumn, secondValue) {
                    assert.equal(secondColumn, "status");
                    // #19 audit guard: 'buyout_pending' must NEVER be in this
                    // filter — a parked buyout is already counted via
                    // rider.pending_team_id, so counting its loan here too would
                    // double-count the rider against the borrower's squad cap.
                    assert.deepEqual(secondValue, ["active", "window_pending"]);
                    return Promise.resolve({ count: activeLoanCount, error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("getTeamMarketState includes active loan agreements in the total squad count", async () => {
  const teamState = await getTeamMarketState(
    createTeamMarketStateSupabase({
      riderCount: 14,
      pendingCount: 1,
      activeLoanCount: 2,
    }),
    "team-1"
  );

  assert.equal(teamState.rider_count, 14);
  assert.equal(teamState.pending_count, 1);
  assert.equal(teamState.outgoing_count, 0);
  assert.equal(teamState.active_loan_count, 2);
  assert.equal(teamState.total_count, 17);
  assert.equal(teamState.future_count, 17);
  assert.deepEqual(teamState.squad_limits, { min: 0, max: 30 });
});

// #268: future_count skal trække outgoing-pending ryttere (team_id=mit,
// pending_team_id=andet) fra rider_count, så squad-cap checks ikke ser dem
// som "stadig ejede". total_count beholdes som legacy felt og indeholder
// stadig den gamle (buggy) sum.
test("getTeamMarketState subtracts outgoing-pending riders from future_count (#268)", async () => {
  const teamState = await getTeamMarketState(
    createTeamMarketStateSupabase({
      riderCount: 10,
      pendingCount: 2,
      outgoingCount: 3,
      activeLoanCount: 1,
    }),
    "team-1"
  );

  assert.equal(teamState.rider_count, 10);
  assert.equal(teamState.pending_count, 2);
  assert.equal(teamState.outgoing_count, 3);
  assert.equal(teamState.active_loan_count, 1);
  // total_count (legacy, includes outgoing): 10 + 2 + 1 = 13
  assert.equal(teamState.total_count, 13);
  // future_count (correct): 10 - 3 + 2 + 1 = 10
  assert.equal(teamState.future_count, 10);
});

test("getIncomingSquadViolation prefers future_count over total_count (#268)", () => {
  // total_count viser 11 (over D3-cap=10) men future_count = 9 efter outgoing.
  // Manageren skal IKKE blokeres — der er reelt plads til 1 mere.
  const issue = getIncomingSquadViolation(
    {
      division: 3,
      total_count: 11,
      future_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    { softCapBuffer: 0 }
  );

  assert.equal(issue, null);
});

test("getOutgoingSquadViolation prefers future_count over total_count (#268)", () => {
  // future_count = 8 (matches min). En outgoing til ville bryde min-cap.
  const issue = getOutgoingSquadViolation({
    division: 3,
    total_count: 12,
    future_count: 8,
    squad_limits: { min: 8, max: 10 },
  });

  assert.equal(issue?.minRiders, 8);
  assert.equal(issue?.totalAfter, 7);
});

// #1101 cutover: værdi er DB-først (market_value) — uci_points indgår aldrig.
test("calculateRiderMarketValue er DB-først: market_value vinder", () => {
  assert.equal(calculateRiderMarketValue({ market_value: 900000, base_value: 100, prize_earnings_bonus: 5 }), 900000);
});

test("calculateRiderMarketValue falder tilbage til base_value + bonus", () => {
  assert.equal(calculateRiderMarketValue({ base_value: 50000, prize_earnings_bonus: 1500 }), 51500);
});

test("calculateRiderMarketValue uden base_value bruger fallback (aldrig uci_points)", () => {
  assert.equal(calculateRiderMarketValue({ uci_points: 500, prize_earnings_bonus: 0 }), RIDER_BASE_VALUE_FALLBACK);
});

// #1309: frossen kontrakt-løn vinder; ellers estimat (10% af market_value) til
// VISNING af free agents.
test("resolveRiderSalary: frossen salary vinder over estimat", () => {
  assert.equal(resolveRiderSalary({ salary: 12345, base_value: 1_000_000 }), 12345);
});

test("resolveRiderSalary: NULL salary → 10% af market_value", () => {
  // market_value vinder: 10% af 500_000 = 50_000
  assert.equal(resolveRiderSalary({ salary: null, market_value: 500_000 }), 50_000);
  // fallback til base_value + bonus: 10% af (50_000 + 5_000) = 5_500
  assert.equal(resolveRiderSalary({ salary: null, base_value: 50_000, prize_earnings_bonus: 5_000 }), 5_500);
});

test("resolveRiderSalary: salary 0 bevares (gratis kontrakt, ikke estimat)", () => {
  assert.equal(resolveRiderSalary({ salary: 0, base_value: 1_000_000 }), 0);
});

test("resolveRiderSalary: NULL salary + NULL base_value → fallback 1000 → 100", () => {
  assert.equal(resolveRiderSalary({ salary: null, base_value: null }), 100);
  // undefined salary behandles som free agent (== null loose)
  assert.equal(resolveRiderSalary({}), 100);
});
