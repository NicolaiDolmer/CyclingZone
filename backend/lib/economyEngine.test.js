import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const { processSeasonEnd } = await import("./economyEngine.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSeasonEndSupabase({
  season,
  team,
  board,
  standings,
  activeLoanCount = 0,
} = {}) {
  const state = {
    season: clone(season),
    team: clone(team),
    board: clone(board),
    standings: clone(standings),
    inserts: {
      board_plan_snapshots: [],
      finance_transactions: [],
      notifications: [],
    },
    updates: {
      board_profiles: [],
      seasons: [],
      teams: [],
    },
  };

  state.team.board_profiles = [state.board];
  state.team.riders = state.team.riders || [];

  function getTeamById(teamId) {
    assert.equal(teamId, state.team.id);
    return state.team;
  }

  return {
    state,
    from(table) {
      if (table === "seasons") {
        return {
          select(columns) {
            assert.equal(columns, "number");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.season.id);
                return {
                  single() {
                    return Promise.resolve({
                      data: { number: state.season.number },
                      error: null,
                    });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.season.id);
                Object.assign(state.season, payload);
                state.updates.seasons.push({ id: value, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "season_standings") {
        return {
          select(columns) {
            assert.equal(columns, "*, team:team_id(*)");
            return {
              eq(column, value) {
                assert.equal(column, "season_id");
                assert.equal(value, state.season.id);
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "total_points");
                    assert.deepEqual(orderOptions, { ascending: false });
                    return Promise.resolve({
                      data: clone(state.standings),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "teams") {
        return {
          select(columns) {
            return {
              eq(column, value) {
                if (column === "is_ai") {
                  assert.equal(value, false);
                  return Promise.resolve({
                    data: [clone(state.team)],
                    error: null,
                  });
                }

                assert.equal(column, "id");
                const selectedTeam = getTeamById(value);

                return {
                  single() {
                    if (columns === "balance") {
                      return Promise.resolve({
                        data: { balance: selectedTeam.balance },
                        error: null,
                      });
                    }

                    if (columns === "sponsor_income") {
                      return Promise.resolve({
                        data: { sponsor_income: selectedTeam.sponsor_income },
                        error: null,
                      });
                    }

                    if (columns === "user_id") {
                      return Promise.resolve({
                        data: { user_id: selectedTeam.user_id },
                        error: null,
                      });
                    }

                    return Promise.resolve({
                      data: clone(selectedTeam),
                      error: null,
                    });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                const selectedTeam = getTeamById(value);
                Object.assign(selectedTeam, payload);
                state.updates.teams.push({ id: value, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "loans") {
        return {
          select(columns, options) {
            assert.equal(columns, "id");
            assert.deepEqual(options, { count: "exact", head: true });
            return {
              eq(column, value) {
                assert.equal(column, "team_id");
                assert.equal(value, state.team.id);
                return {
                  eq(secondColumn, secondValue) {
                    assert.equal(secondColumn, "status");
                    assert.equal(secondValue, "active");
                    return Promise.resolve({
                      count: activeLoanCount,
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "board_plan_snapshots") {
        return {
          select(columns) {
            assert.equal(columns, "goals_met, goals_total, satisfaction_delta");
            return {
              eq(column, value) {
                assert.equal(column, "team_id");
                assert.equal(value, state.team.id);
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "created_at");
                    assert.deepEqual(orderOptions, { ascending: false });
                    return {
                      limit(limitValue) {
                        assert.equal(limitValue, 3);
                        return Promise.resolve({
                          data: [],
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload) {
            state.inserts.board_plan_snapshots.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "board_profiles") {
        return {
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.board.id);
                Object.assign(state.board, payload);
                state.team.board_profiles = [clone(state.board)];
                state.updates.board_profiles.push({ id: value, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "finance_transactions") {
        return {
          insert(payload) {
            state.inserts.finance_transactions.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "notifications") {
        return {
          insert(payload) {
            state.inserts.notifications.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("processSeasonEnd keeps the board flow on the shared runtime path", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-1",
      number: 5,
      status: "active",
    },
    team: {
      id: "team-1",
      name: "Board Testers",
      is_ai: false,
      user_id: "user-1",
      balance: 500,
      sponsor_income: 200,
      riders: [],
    },
    board: {
      id: "board-1",
      team_id: "team-1",
      plan_type: "1yr",
      focus: "balanced",
      satisfaction: 50,
      budget_modifier: 1.0,
      current_goals: [
        {
          type: "top_n_finish",
          target: 2,
          label: "Top 2 i divisionen",
          satisfaction_bonus: 10,
          satisfaction_penalty: 5,
        },
      ],
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      plan_start_sponsor_income: 200,
    },
    standings: [
      {
        season_id: "season-1",
        team_id: "team-1",
        division: 3,
        total_points: 150,
        rank_in_division: 1,
        stage_wins: 2,
        gc_wins: 1,
        team: {
          id: "team-1",
          is_ai: false,
        },
      },
    ],
  });

  await processSeasonEnd("season-1", {
    supabase,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
  });

  assert.equal(supabase.state.season.status, "completed");
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
  assert.equal(supabase.state.updates.board_profiles.length, 1);
  assert.equal(supabase.state.board.negotiation_status, "pending");
  assert.equal(supabase.state.board.satisfaction, 74);
  assert.equal(supabase.state.board.budget_modifier, 1.1);
  assert.equal(supabase.state.inserts.notifications.length, 1);
  assert.equal(supabase.state.inserts.board_plan_snapshots[0].goals_met, 1);
  assert.equal(supabase.state.inserts.board_plan_snapshots[0].goals_total, 1);
});
