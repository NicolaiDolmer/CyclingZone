import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  buildSeasonEndPreviewRows,
  processSeasonEnd,
  repairSeasonEndFinanceAndBoard,
  updateRiderValues,
  updateStandings,
} = await import("./economyEngine.js");

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
  ridersError = null,
} = {}) {
  const state = {
    season: clone(season),
    team: clone(team),
    board: clone(board),
    riders: clone(team?.riders || []),
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
  state.team.riders = state.riders;

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
            assert.equal(["number", "id, number, status"].includes(columns), true);
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.season.id);
                return {
                  single() {
                    return Promise.resolve({
                      data: columns === "number"
                        ? { number: state.season.number }
                        : {
                            id: state.season.id,
                            number: state.season.number,
                            status: state.season.status,
                          },
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
                  assert.equal(columns.includes("riders("), false);
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

      if (table === "riders") {
        return {
          select(columns) {
            assert.equal(columns.includes("team_id"), true);
            assert.equal(columns.includes("salary"), true);
            return {
              in(column, values) {
                assert.equal(column, "team_id");
                assert.deepEqual(values, [state.team.id]);
                if (ridersError) {
                  return Promise.resolve({
                    data: null,
                    error: ridersError,
                  });
                }
                return Promise.resolve({
                  data: clone(state.riders),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "board_plan_snapshots") {
        return {
          select(columns, options) {
            if (columns === "id") {
              assert.deepEqual(options, { count: "exact", head: true });
              return {
                eq(column, value) {
                  assert.equal(column, "season_id");
                  assert.equal(value, state.season.id);
                  return Promise.resolve({
                    count: state.inserts.board_plan_snapshots.filter(row => row.season_id === value).length,
                    error: null,
                  });
                },
              };
            }

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
          select(columns) {
            assert.equal(columns, "*");
            return {
              in(column, values) {
                assert.equal(column, "team_id");
                assert.deepEqual(values, [state.team.id]);
                return Promise.resolve({
                  data: [clone(state.board)],
                  error: null,
                });
              },
            };
          },
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
          select(columns, options) {
            assert.equal(columns, "id");
            assert.deepEqual(options, { count: "exact", head: true });
            const filters = {};
            return {
              eq(column, value) {
                filters[column] = value;
                if (filters.season_id && filters.type) {
                  return Promise.resolve({
                    count: state.inserts.finance_transactions.filter(row => (
                      row.season_id === filters.season_id && row.type === filters.type
                    )).length,
                    error: null,
                  });
                }
                return this;
              },
            };
          },
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

function createRiderValuesSupabase({ seasons, races, results, riders }) {
  const state = {
    seasons: clone(seasons),
    races: clone(races),
    results: clone(results),
    riders: clone(riders),
    riderUpdates: [],
  };

  return {
    state,
    from(table) {
      if (table === "seasons") {
        return {
          select(columns) {
            assert.equal(columns, "id");
            return {
              eq(column, value) {
                assert.equal(column, "status");
                assert.equal(value, "completed");
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "number");
                    assert.deepEqual(orderOptions, { ascending: false });
                    return {
                      limit(limitValue) {
                        assert.equal(limitValue, 3);
                        return Promise.resolve({
                          data: clone(state.seasons).slice(0, limitValue),
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "races") {
        return {
          select(columns) {
            assert.equal(columns, "id, season_id");
            return {
              in(column, value) {
                assert.equal(column, "season_id");
                return {
                  range(from, to) {
                    const rows = clone(state.races)
                      .filter(race => value.includes(race.season_id))
                      .slice(from, to + 1);
                    return Promise.resolve({
                      data: rows,
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "race_results") {
        return {
          select(columns) {
            assert.equal(columns, "rider_id, race_id, prize_money");
            return {
              in(column, value) {
                assert.equal(column, "race_id");
                return {
                  gt(gtColumn, gtValue) {
                    assert.equal(gtColumn, "prize_money");
                    assert.equal(gtValue, 0);
                    return {
                      range(from, to) {
                        const rows = clone(state.results)
                          .filter(result => value.includes(result.race_id))
                          .filter(result => result.prize_money > gtValue)
                          .slice(from, to + 1);
                        return Promise.resolve({
                          data: rows,
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(columns) {
            assert.equal(columns, "id, uci_points");
            return {
              range(from, to) {
                return Promise.resolve({
                  data: clone(state.riders).slice(from, to + 1),
                  error: null,
                });
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                state.riderUpdates.push({ id: value, payload });
                const rider = state.riders.find(row => row.id === value);
                Object.assign(rider, payload);
                return Promise.resolve({ error: null });
              },
            };
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
    updateRiderValues: async () => {},
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
    updateRiderValues: async () => {},
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
    updateRiderValues: async () => {},
  });

  assert.equal(supabase.state.inserts.notifications.length, 0);
});

test("processSeasonEnd fails before writes when live-like rider loading fails", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-1",
      number: 5,
      status: "active",
    },
    team: {
      id: "team-1",
      name: "Relationship Drift",
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
      current_goals: [],
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
        stage_wins: 0,
        gc_wins: 0,
        team: {
          id: "team-1",
          is_ai: false,
        },
      },
    ],
    ridersError: {
      code: "PGRST201",
      message: "Could not embed because more than one relationship was found",
    },
  });

  await assert.rejects(
    processSeasonEnd("season-1", {
      supabase,
      now: FIXED_SEASON_END_NOW,
      processLoanInterest: async () => {},
      createEmergencyLoan: async () => {},
      updateRiderValues: async () => {},
    }),
    /Could not load riders for season end/
  );

  assert.equal(supabase.state.updates.seasons.length, 0);
  assert.equal(supabase.state.updates.teams.length, 0);
  assert.equal(supabase.state.inserts.finance_transactions.length, 0);
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 0);
});

test("processSeasonEnd writes finance and board side effects before completing the season", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-1",
      number: 5,
      status: "active",
    },
    team: {
      id: "team-1",
      name: "Finance Testers",
      is_ai: false,
      user_id: "user-1",
      balance: 70,
      sponsor_income: 200,
      riders: [
        { id: "rider-1", team_id: "team-1", salary: 100 },
      ],
    },
    board: {
      id: "board-1",
      team_id: "team-1",
      plan_type: "1yr",
      focus: "balanced",
      satisfaction: 50,
      budget_modifier: 1.0,
      current_goals: [],
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
        stage_wins: 0,
        gc_wins: 0,
        team: {
          id: "team-1",
          is_ai: false,
        },
      },
    ],
    activeLoanCount: 1,
  });

  await processSeasonEnd("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async (teamId, seasonId, client) => {
      await client.from("finance_transactions").insert({
        team_id: teamId,
        type: "loan_interest",
        amount: -25,
        description: "Lånerenter tilskrevet (test)",
        season_id: seasonId,
      });
    },
    createEmergencyLoan: async (teamId, amountNeeded, client) => {
      await client.from("finance_transactions").insert({
        team_id: teamId,
        type: "emergency_loan",
        amount: amountNeeded,
        description: "Nødlån oprettet automatisk (test)",
      });
      const teamRow = supabase.state.team;
      teamRow.balance += amountNeeded;
    },
    updateRiderValues: async () => {},
  });

  const transactionTypes = supabase.state.inserts.finance_transactions.map(row => row.type);
  assert.deepEqual(transactionTypes, ["loan_interest", "emergency_loan", "salary"]);
  assert.equal(supabase.state.inserts.finance_transactions.find(row => row.type === "salary").amount, -100);
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
  assert.equal(supabase.state.season.status, "completed");
  assert.equal(supabase.state.updates.seasons.length, 1);
});

test("repairSeasonEndFinanceAndBoard runs finance and board only without season or division writes", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-1",
      number: 5,
      status: "completed",
    },
    team: {
      id: "team-1",
      name: "Repair Testers",
      is_ai: false,
      user_id: "user-1",
      balance: 200,
      sponsor_income: 200,
      riders: [
        { id: "rider-1", team_id: "team-1", salary: 80 },
      ],
    },
    board: {
      id: "board-1",
      team_id: "team-1",
      plan_type: "1yr",
      focus: "balanced",
      satisfaction: 50,
      budget_modifier: 1.0,
      current_goals: [],
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
        stage_wins: 0,
        gc_wins: 0,
        team: {
          id: "team-1",
          is_ai: false,
        },
      },
    ],
  });

  const result = await repairSeasonEndFinanceAndBoard("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
  });

  assert.equal(result.teamsProcessed, 1);
  assert.equal(supabase.state.inserts.finance_transactions.length, 1);
  assert.equal(supabase.state.inserts.finance_transactions[0].type, "salary");
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
  assert.equal(supabase.state.updates.seasons.length, 0);
  assert.equal(
    supabase.state.updates.teams.some(update => "division" in update.payload),
    false
  );
});

test("buildSeasonEndPreviewRows projects board modifier on the same path as season end", () => {
  const [preview] = buildSeasonEndPreviewRows({
    teams: [
      {
        id: "team-1",
        name: "Preview Testers",
        division: 3,
        balance: 500,
        sponsor_income: 200,
        riders: [
          { id: "rider-1", salary: 80, stat_bj: 80, stat_sp: 60, stat_tt: 65, stat_fl: 70, is_u25: false },
          { id: "rider-2", salary: 20, stat_bj: 72, stat_sp: 68, stat_tt: 62, stat_fl: 71, is_u25: true },
        ],
        board_profiles: [
          {
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
        ],
      },
    ],
    standings: [
      {
        season_id: "season-1",
        team_id: "team-1",
        division: 3,
        total_points: 150,
        rank_in_division: 1,
        stage_wins: 2,
        gc_wins: 1,
      },
    ],
    loanData: [
      { team_id: "team-1", amount_remaining: 100, interest_rate: 0.1 },
    ],
  });

  assert.equal(preview.salary_deduction, 100);
  assert.equal(preview.loan_interest, 10);
  assert.equal(preview.balance_after, 400);
  assert.equal(preview.current_board_satisfaction, 50);
  assert.equal(preview.board_satisfaction, 74);
  assert.equal(preview.sponsor_modifier, 1.1);
  assert.equal(preview.next_season_sponsor, 220);
  assert.equal(preview.board_goals_met, 1);
  assert.equal(preview.board_goals_total, 1);
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

test("updateRiderValues recalculates salaries after UCI values change", async () => {
  const supabase = createRiderValuesSupabase({
    seasons: [
      { id: "season-3" },
      { id: "season-2" },
      { id: "season-1" },
    ],
    races: [
      { id: "race-1", season_id: "season-3" },
      { id: "race-2", season_id: "season-2" },
    ],
    results: [
      { rider_id: "rider-1", race_id: "race-1", prize_money: 1200 },
      { rider_id: "rider-1", race_id: "race-2", prize_money: 800 },
      { rider_id: "rider-2", race_id: "race-2", prize_money: 500 },
    ],
    riders: [
      { id: "rider-1", uci_points: 100 },
      { id: "rider-2", uci_points: 0 },
    ],
  });

  const summary = await updateRiderValues(supabase);

  assert.deepEqual(summary, { ridersUpdated: 2 });
  assert.deepEqual(supabase.state.riderUpdates, [
    {
      id: "rider-1",
      payload: {
        prize_earnings_bonus: 1000,
        salary: 60150,
      },
    },
    {
      id: "rider-2",
      payload: {
        prize_earnings_bonus: 500,
        salary: 3075,
      },
    },
  ]);
});
