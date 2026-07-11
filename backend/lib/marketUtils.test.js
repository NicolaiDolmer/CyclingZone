import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRiderMarketValue,
  getActiveAuctionRiderIds,
  getIncomingSquadViolation,
  getOutgoingSquadViolation,
  getTeamMarketState,
  MARKET_SQUAD_LIMITS,
  RIDER_BASE_VALUE_FALLBACK,
  resolveRiderSalary,
  TRANSFER_WINDOW_SOFT_CAP_BUFFER,
  withdrawOpenTransferDealsForRiders,
} from "./marketUtils.js";

// #1748 (a): getActiveAuctionRiderIds — delmængden af riderIds der er på en aktiv
// auktion. Minimal mock for auctions.select().in("rider_id").in("status").
function makeAuctionLookupSupabase(activeRows) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "auctions");
      return {
        select(cols) {
          assert.equal(cols, "rider_id");
          return {
            in(col1, ids) {
              assert.equal(col1, "rider_id");
              return {
                in(col2, statuses) {
                  assert.equal(col2, "status");
                  calls.push({ ids, statuses });
                  const data = activeRows.filter(
                    (r) => ids.includes(r.rider_id) && statuses.includes(r.status),
                  );
                  return Promise.resolve({ data, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

test("getActiveAuctionRiderIds returns only riders on an active auction (#1748)", async () => {
  const supabase = makeAuctionLookupSupabase([
    { rider_id: "r1", status: "active" },
    { rider_id: "r2", status: "completed" }, // not active
    { rider_id: "r3", status: "extended" },
  ]);
  const result = await getActiveAuctionRiderIds(supabase, ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(result.sort(), ["r1", "r3"]);
  // status-filter er active/extended
  assert.deepEqual(supabase.calls[0].statuses, ["active", "extended"]);
});

test("getActiveAuctionRiderIds short-circuits on empty input (no query) (#1748)", async () => {
  let queried = false;
  const supabase = { from() { queried = true; throw new Error("should not query"); } };
  assert.deepEqual(await getActiveAuctionRiderIds(supabase, []), []);
  assert.deepEqual(await getActiveAuctionRiderIds(supabase, [null, undefined]), []);
  assert.equal(queried, false);
});

test("getActiveAuctionRiderIds dedupes rider_id (#1748)", async () => {
  const supabase = makeAuctionLookupSupabase([
    { rider_id: "r1", status: "active" },
    { rider_id: "r1", status: "extended" }, // same rider, two rows (defensive)
  ]);
  assert.deepEqual(await getActiveAuctionRiderIds(supabase, ["r1"]), ["r1"]);
});

test("withdrawOpenTransferDealsForRiders withdraws open transfer_offers + swap_offers (#1748)", async () => {
  const offerUpdates = [];
  const swapUpdates = [];
  const supabase = {
    from(table) {
      if (table === "transfer_offers") {
        return {
          update(payload) {
            return {
              in(col1, ids) {
                assert.equal(col1, "rider_id");
                return {
                  in(col2, statuses) {
                    assert.equal(col2, "status");
                    offerUpdates.push({ payload, ids, statuses });
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "swap_offers") {
        return {
          update(payload) {
            return {
              in(col, statuses) {
                assert.equal(col, "status");
                return {
                  or(filter) {
                    swapUpdates.push({ payload, statuses, filter });
                    return Promise.resolve({ error: null });
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
  await withdrawOpenTransferDealsForRiders(supabase, ["r1"]);
  assert.equal(offerUpdates.length, 1);
  assert.equal(offerUpdates[0].payload.status, "withdrawn");
  assert.deepEqual(offerUpdates[0].ids, ["r1"]);
  assert.deepEqual(offerUpdates[0].statuses, ["pending", "countered", "awaiting_confirmation"]);
  assert.equal(swapUpdates.length, 1);
  assert.equal(swapUpdates[0].payload.status, "withdrawn");
  assert.match(swapUpdates[0].filter, /offered_rider_id\.in\.\(r1\)/);
  assert.match(swapUpdates[0].filter, /requested_rider_id\.in\.\(r1\)/);
});

test("withdrawOpenTransferDealsForRiders is a no-op on empty input (#1748)", async () => {
  let queried = false;
  const supabase = { from() { queried = true; throw new Error("should not query"); } };
  await withdrawOpenTransferDealsForRiders(supabase, []);
  assert.equal(queried, false);
});

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

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("getTeamMarketState sums rider + pending counts in the total squad count", async () => {
  const teamState = await getTeamMarketState(
    createTeamMarketStateSupabase({
      riderCount: 14,
      pendingCount: 1,
    }),
    "team-1"
  );

  assert.equal(teamState.rider_count, 14);
  assert.equal(teamState.pending_count, 1);
  assert.equal(teamState.outgoing_count, 0);
  assert.equal(teamState.total_count, 15);
  assert.equal(teamState.future_count, 15);
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
    }),
    "team-1"
  );

  assert.equal(teamState.rider_count, 10);
  assert.equal(teamState.pending_count, 2);
  assert.equal(teamState.outgoing_count, 3);
  // total_count (legacy, includes outgoing): 10 + 2 = 12
  assert.equal(teamState.total_count, 12);
  // future_count (correct): 10 - 3 + 2 = 9
  assert.equal(teamState.future_count, 9);
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

test("resolveRiderSalary: NULL salary → 6.7% af market_value (E2 strict_fair_v1)", () => {
  // market_value vinder: 6.7% af 500_000 = 33_500
  assert.equal(resolveRiderSalary({ salary: null, market_value: 500_000 }), 33_500);
  // fallback til base_value + bonus: 6.7% af (50_000 + 5_000) = 3_685
  assert.equal(resolveRiderSalary({ salary: null, base_value: 50_000, prize_earnings_bonus: 5_000 }), 3_685);
});

test("resolveRiderSalary: salary 0 bevares (gratis kontrakt, ikke estimat)", () => {
  assert.equal(resolveRiderSalary({ salary: 0, base_value: 1_000_000 }), 0);
});

test("resolveRiderSalary: NULL salary + NULL base_value → fallback 1000 → 67", () => {
  assert.equal(resolveRiderSalary({ salary: null, base_value: null }), 67);
  // undefined salary behandles som free agent (== null loose)
  assert.equal(resolveRiderSalary({}), 67);
});

// #1308: akademiryttere tæller IKKE mod senior-cap i getTeamMarketState.
// Scenarie: 30 senior-ryttere + 5 akademiryttere → rider_count skal være 30,
// future_count 30 (ingen pending/outgoing), og cap-tjek triggeres ved +1 ny.
test("#1308: getTeamMarketState — akademiryttere udelades fra alle tre tælle-queries", async () => {
  const TEAM_ID = "team-academy";
  const SENIOR_COUNT = 30;
  const _ACADEMY_COUNT = 5; // skal aldrig bidrage til rider_count

  // Assertiv mock: verificerer at is_academy=false ER i eq-filtrene.
  function createAcademyAwareSupabase() {
    function ridersQuery() {
      const eqFilters = {};
      const notIsNullCols = new Set();
      const neqFilters = {};
      const builder = {
        eq(col, val) { eqFilters[col] = val; return promiseOrBuilder(); },
        not(col, op, val) {
          if (op === "is" && val === null) notIsNullCols.add(col);
          return promiseOrBuilder();
        },
        neq(col, val) { neqFilters[col] = val; return promiseOrBuilder(); },
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
        // #1308 guard: is_academy filter MÅ ALTID være sat til false på cap-queries
        assert.equal(eqFilters.is_academy, false,
          `is_academy=false mangler på riders-query (eqFilters=${JSON.stringify(eqFilters)})`);

        const isOutgoing = notIsNullCols.has("pending_team_id") && "pending_team_id" in neqFilters;
        if (isOutgoing && eqFilters.team_id === TEAM_ID) {
          return Promise.resolve({ count: 0, error: null }); // ingen outgoing
        }
        if (eqFilters.team_id === TEAM_ID) {
          return Promise.resolve({ count: SENIOR_COUNT, error: null }); // kun seniorer
        }
        if (eqFilters.pending_team_id === TEAM_ID) {
          return Promise.resolve({ count: 0, error: null }); // ingen pending-in
        }
        throw new Error(`Unexpected riders filter: ${JSON.stringify({ eqFilters, notIsNullCols: [...notIsNullCols], neqFilters })}`);
      }
      return builder;
    }

    return {
      from(table) {
        if (table === "teams") {
          return {
            select() {
              return {
                eq() {
                  return {
                    single: () => Promise.resolve({
                      data: { id: TEAM_ID, name: "T", balance: 1000000, division: 3, user_id: "u1" },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === "riders") {
          return {
            select(_cols, _opts) { return ridersQuery(); },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
  }

  const state = await getTeamMarketState(createAcademyAwareSupabase(), TEAM_ID);

  // rider_count = kun seniorer (ACADEMY_COUNT er udeladt af mock)
  assert.equal(state.rider_count, SENIOR_COUNT, "rider_count skal kun tælle senior-ryttere");
  assert.equal(state.future_count, SENIOR_COUNT, "future_count = 30 (ingen pending/outgoing)");

  // Med 30 senior-ryttere og ingen pending skal getIncomingSquadViolation trigge ved +1 ny rytter
  const violation = getIncomingSquadViolation({
    division: 3,
    future_count: state.future_count,
    squad_limits: state.squad_limits,
  }, { softCapBuffer: 0 });
  assert.ok(violation !== null, "cap-violation skal trigges ved future_count=30 og incomingCount=1");
  assert.equal(violation.totalAfter, 31, "totalAfter = 30 + 1 = 31 (akademiryttere tæller IKKE)");
});
