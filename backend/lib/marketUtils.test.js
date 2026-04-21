import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateMarketSalary,
  getIncomingSquadViolation,
  getOutgoingSquadViolation,
  getTeamMarketState,
} from "./marketUtils.js";

test("calculateMarketSalary keeps the 10 percent rule with a minimum of 1", () => {
  assert.equal(calculateMarketSalary(1), 1);
  assert.equal(calculateMarketSalary(9), 1);
  assert.equal(calculateMarketSalary(10), 1);
  assert.equal(calculateMarketSalary(11), 2);
});

test("getIncomingSquadViolation includes pending riders in the max check", () => {
  const issue = getIncomingSquadViolation({
    division: 3,
    total_count: 10,
    squad_limits: { min: 8, max: 10 },
  });

  assert.equal(issue?.maxRiders, 10);
  assert.equal(issue?.totalAfter, 11);
});

test("getOutgoingSquadViolation blocks teams from dropping below the division minimum", () => {
  const issue = getOutgoingSquadViolation({
    division: 1,
    total_count: 20,
    squad_limits: { min: 20, max: 30 },
  });

  assert.equal(issue?.minRiders, 20);
  assert.equal(issue?.totalAfter, 19);
});

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
  activeLoanCount = 0,
} = {}) {
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

            return {
              eq(column, value) {
                assert.equal(value, team.id);

                if (column === "team_id") {
                  return Promise.resolve({ count: riderCount, error: null });
                }

                if (column === "pending_team_id") {
                  return Promise.resolve({ count: pendingCount, error: null });
                }

                throw new Error(`Unexpected riders column: ${column}`);
              },
            };
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
                  eq(secondColumn, secondValue) {
                    assert.equal(secondColumn, "status");
                    assert.equal(secondValue, "active");
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
  assert.equal(teamState.active_loan_count, 2);
  assert.equal(teamState.total_count, 17);
  assert.deepEqual(teamState.squad_limits, { min: 14, max: 20 });
});
