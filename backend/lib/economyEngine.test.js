import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const { processSeasonEnd, updateStandings } = await import("./economyEngine.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSeasonEndSupabase({
  season,
  team,
  board,
  standings,
  activeLoanCount = 0,
  existingNotifications = [],
} = {}) {
  const state = {
    season: clone(season),
    team: clone(team),
    board: clone(board),
    standings: clone(standings),
    notifications: clone(existingNotifications),
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
          select(columns) {
            assert.equal(columns, "id");
            const filters = {};
            return {
              eq(column, value) {
                filters[column] = value;
                return this;
              },
              gte(column, value) {
                filters[column] = value;
                return this;
              },
              is(column, value) {
                filters[column] = value;
                return this;
              },
              order(column, options) {
                assert.equal(column, "created_at");
                assert.deepEqual(options, { ascending: false });
                return this;
              },
              limit(value) {
                assert.equal(value, 1);
                const data = state.notifications
                  .filter(notification => {
                    if (filters.user_id && notification.user_id !== filters.user_id) return false;
                    if (filters.type && notification.type !== filters.type) return false;
                    if (filters.title && notification.title !== filters.title) return false;
                    if (filters.message && notification.message !== filters.message) return false;
                    if ("related_id" in filters && notification.related_id !== filters.related_id) return false;
                    if (filters.created_at && notification.created_at < filters.created_at) return false;
                    return true;
                  })
                  .slice(0, 1)
                  .map(notification => ({ id: notification.id }));
                return Promise.resolve({ data });
              },
            };
          },
          insert(payload) {
            state.inserts.notifications.push(payload);
            state.notifications.unshift({
              id: `notification-${state.inserts.notifications.length}`,
              created_at: "2026-04-22T10:00:00.000Z",
              ...payload,
            });
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function createStandingsSupabase({ teams, races, results }) {
  const state = {
    teams: clone(teams),
    races: clone(races),
    results: clone(results),
    upserts: [],
  };

  return {
    state,
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "id, division");
            return Promise.resolve({
              data: clone(state.teams),
              error: null,
            });
          },
        };
      }

      if (table === "races") {
        return {
          select(columns) {
            assert.equal(columns, "id");
            return {
              eq(column, value) {
                assert.equal(column, "season_id");
                assert.equal(value, "season-1");
                return Promise.resolve({
                  data: clone(state.races),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "race_results") {
        return {
          select(columns) {
            assert.equal(columns, "race_id, team_id, result_type, rank, points_earned, rider:rider_id(team_id)");
            return {
              in(column, value) {
                assert.equal(column, "race_id");
                assert.deepEqual(value, state.races.map(race => race.id));
                return Promise.resolve({
                  data: clone(state.results),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "season_standings") {
        return {
          upsert(rows, options) {
            state.upserts.push({
              rows: clone(rows),
              options: clone(options),
            });
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const FIXED_SEASON_END_NOW = new Date("2026-04-23T08:00:00.000Z");

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
    now: FIXED_SEASON_END_NOW,
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

test("processSeasonEnd skips writing a duplicate board notification when the same recent update already exists", async () => {
  const scenario = {
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
  };

  const firstSupabase = createSeasonEndSupabase(scenario);

  await processSeasonEnd("season-1", {
    supabase: firstSupabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
  });

  const [existingNotification] = firstSupabase.state.inserts.notifications;
  const supabase = createSeasonEndSupabase({
    ...scenario,
    existingNotifications: [
      {
        id: "notification-existing",
        created_at: "2026-04-22T09:30:00.000Z",
        ...existingNotification,
      },
    ],
  });

  await processSeasonEnd("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
  });

  assert.equal(supabase.state.inserts.notifications.length, 0);
});

test("updateStandings stores division ranks and keeps zero-point teams in the canonical table", async () => {
  const supabase = createStandingsSupabase({
    teams: [
      { id: "team-a", division: 1 },
      { id: "team-b", division: 1 },
      { id: "team-c", division: 2 },
    ],
    races: [
      { id: "race-1" },
      { id: "race-2" },
    ],
    results: [
      { race_id: "race-1", team_id: "team-b", result_type: "gc", rank: 1, points_earned: 40, rider: null },
      { race_id: "race-1", team_id: "team-a", result_type: "stage", rank: 1, points_earned: 20, rider: null },
      { race_id: "race-2", team_id: null, result_type: "stage", rank: 1, points_earned: 30, rider: { team_id: "team-a" } },
    ],
  });

  const summary = await updateStandings("season-1", "race-2", { supabase });

  assert.deepEqual(summary, {
    rowsUpdated: 3,
    teamsWithPoints: 2,
  });

  assert.equal(supabase.state.upserts.length, 1);
  assert.deepEqual(supabase.state.upserts[0].options, { onConflict: "season_id,team_id" });
  assert.deepEqual(supabase.state.upserts[0].rows, [
    {
      season_id: "season-1",
      team_id: "team-a",
      division: 1,
      rank_in_division: 1,
      total_points: 50,
      stage_wins: 2,
      gc_wins: 0,
      races_completed: 2,
      updated_at: supabase.state.upserts[0].rows[0].updated_at,
    },
    {
      season_id: "season-1",
      team_id: "team-b",
      division: 1,
      rank_in_division: 2,
      total_points: 40,
      stage_wins: 0,
      gc_wins: 1,
      races_completed: 1,
      updated_at: supabase.state.upserts[0].rows[1].updated_at,
    },
    {
      season_id: "season-1",
      team_id: "team-c",
      division: 2,
      rank_in_division: 1,
      total_points: 0,
      stage_wins: 0,
      gc_wins: 0,
      races_completed: 0,
      updated_at: supabase.state.upserts[0].rows[2].updated_at,
    },
  ]);
});
