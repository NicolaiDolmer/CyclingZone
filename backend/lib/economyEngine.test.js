import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  buildSeasonEndPreviewRows,
  payDivisionBonuses,
  processDivisionEnd,
  processSeasonEnd,
  rebalanceDivisions,
  repairSeasonEndFinanceAndBoard,
  updateRiderValues,
  updateStandings,
} = await import("./economyEngine.js");

const { DIVISION_CAPACITY } = await import("./economyConstants.js");

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
    // Slice 07c: balance + finance_transactions atomic via RPC.
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const team = getTeamById(params.p_team_id);
      team.balance = (team.balance ?? 0) + params.p_delta;
      state.updates.teams.push({ id: params.p_team_id, payload: { balance: team.balance } });
      state.inserts.finance_transactions.push({
        team_id: params.p_team_id,
        ...params.p_finance_payload,
      });
      return Promise.resolve({ data: team.balance, error: null });
    },
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
                  // loadHumanSeasonEndTeams chainer .eq("is_frozen") efter .eq("is_ai").
                  // rebalanceDivisions (#962) chainer .eq("is_test_account").eq("is_frozen").
                  // Mocken understøtter vilkårlig længde af is_test_account/is_frozen-led
                  // (samt legacy direkte-Promise single-eq callers).
                  const teamsResult = {
                    data: [clone(state.team)],
                    error: null,
                  };
                  const makeChain = () => Object.assign(Promise.resolve(teamsResult), {
                    eq(innerCol, innerVal) {
                      assert.equal(
                        ["is_test_account", "is_frozen"].includes(innerCol),
                        true,
                        `uventet eq-kolonne i teams-chain: ${innerCol}`
                      );
                      assert.equal(innerVal, false);
                      return makeChain();
                    },
                  });
                  return makeChain();
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
            if (columns === "team_id, board_id") {
              return {
                eq(column, value) {
                  assert.equal(column, "season_id");
                  assert.equal(value, state.season.id);
                  return Promise.resolve({
                    data: clone(state.inserts.board_plan_snapshots)
                      .filter(row => row.season_id === value)
                      .map(row => ({ team_id: row.team_id, board_id: row.board_id })),
                    error: null,
                  });
                },
              };
            }

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

            // S-02d · loadGoalContextForBoard select for plan-start U25-baseline
            if (columns === "season_id, u25_stat_sum, u25_count, season_within_plan") {
              return {
                eq(column, value) {
                  assert.equal(column, "board_id");
                  // #1236 · loadGoalContextForBoard tilføjer .gte("season_number",
                  // planStart) når boardet har plan_start_season_number sat —
                  // mock'en spejler cyklus-filteret server-side.
                  let minSeasonNumber = null;
                  const chain = {
                    gte(gteColumn, gteValue) {
                      assert.equal(gteColumn, "season_number");
                      minSeasonNumber = gteValue;
                      return chain;
                    },
                    order(orderColumn, orderOptions) {
                      assert.equal(orderColumn, "season_within_plan");
                      assert.deepEqual(orderOptions, { ascending: true });
                      return Promise.resolve({
                        data: clone(state.inserts.board_plan_snapshots)
                          .filter((row) => row.board_id === value)
                          .filter((row) => minSeasonNumber == null
                            || (row.season_number ?? 0) >= minSeasonNumber)
                          .map((row) => ({
                            season_id: row.season_id,
                            u25_stat_sum: row.u25_stat_sum ?? 0,
                            u25_count: row.u25_count ?? 0,
                            season_within_plan: row.season_within_plan,
                          })),
                        error: null,
                      });
                    },
                  };
                  return chain;
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
          // #30 · Spejler DB-constraint board_plan_snapshots_board_season_unique
          // ved at overskrive eksisterende row med samme (board_id, season_id)
          // i stedet for at tilfoeje en dublet.
          upsert(payload, options) {
            assert.deepEqual(options, { onConflict: "board_id,season_id" });
            const existingIdx = state.inserts.board_plan_snapshots.findIndex(
              (row) => row.board_id === payload.board_id && row.season_id === payload.season_id
            );
            if (existingIdx >= 0) {
              state.inserts.board_plan_snapshots[existingIdx] = payload;
            } else {
              state.inserts.board_plan_snapshots.push(payload);
            }
            return Promise.resolve({ error: null });
          },
        };
      }

      // S-02d · race_results-query for cumulative monument_podium + jersey_wins.
      // Chain-proxy pattern: alle eq/in/lte returnerer self, terminal er at chain
      // resolves som thenable. Returnerer altid tom data så context-felterne
      // bliver 0 (matcher "ingen race-results indleveret" i test-fixturen).
      if (table === "race_results") {
        const chain = {};
        const noopChain = () => chain;
        Object.assign(chain, {
          select: noopChain,
          eq: noopChain,
          in: noopChain,
          lte: noopChain,
          gte: noopChain,
          then(resolve) { return resolve({ data: [], error: null }); },
        });
        return chain;
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
            if (columns === "team_id") {
              const filters = {};
              return {
                eq(col, val) {
                  filters[col] = val;
                  return {
                    eq(col2, val2) {
                      filters[col2] = val2;
                      const data = state.inserts.finance_transactions
                        .filter(row => Object.entries(filters).every(([k, v]) => row[k] === v))
                        .map(row => ({ team_id: row.team_id }));
                      return Promise.resolve({ data, error: null });
                    },
                  };
                },
              };
            }

            if (columns === "team_id, type") {
              return {
                eq(column, value) {
                  assert.equal(column, "season_id");
                  assert.equal(value, state.season.id);
                  return {
                    in(secondColumn, values) {
                      assert.equal(secondColumn, "type");
                      return Promise.resolve({
                        data: clone(state.inserts.finance_transactions)
                          .filter(row => row.season_id === value && values.includes(row.type))
                          .map(row => ({ team_id: row.team_id, type: row.type })),
                        error: null,
                      });
                    },
                  };
                },
              };
            }

            // S-02d · loadGoalContextForBoard transfer-balance query
            if (columns === "amount, type") {
              return {
                eq(_col1, _val1) {
                  return {
                    in(col2, _values2) {
                      assert.equal(col2, "type");
                      return {
                        in() {
                          return Promise.resolve({ data: [], error: null });
                        },
                      };
                    },
                  };
                },
              };
            }

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
                // updateStandings paginerer nu (fetchAllRows → .order().range()).
                return {
                  order(orderCol, opts) {
                    assert.equal(orderCol, "id");
                    assert.deepEqual(opts, { ascending: true });
                    return {
                      range(from, to) {
                        return Promise.resolve({
                          data: clone(state.results).slice(from, to + 1),
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

      if (table === "season_standings") {
        return {
          select(_cols) {
            return {
              eq(_col1, _val1) {
                return {
                  in(_col2, _vals) {
                    // S-03: updateStandings henter penalty_points for at rank-justere.
                    // Test har ingen pre-existing penalty rows, så returnér tomt sæt.
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
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
          select() {
            return {
              eq(column, value) {
                assert.equal(column, "status");
                // Active-season query: .eq("status","active").maybeSingle()
                if (value === "active") {
                  return {
                    maybeSingle() {
                      const active = clone(state.seasons).find(s => s.status === "active") || null;
                      return Promise.resolve({ data: active, error: null });
                    },
                  };
                }
                // Completed-season window: .eq("status","completed")
                //   .gt("race_days_total",0).order().limit()
                assert.equal(value, "completed");
                return {
                  gt(gtColumn, gtValue) {
                    assert.equal(gtColumn, "race_days_total");
                    assert.equal(gtValue, 0);
                    return {
                      order(orderColumn, orderOptions) {
                        assert.equal(orderColumn, "number");
                        assert.deepEqual(orderOptions, { ascending: false });
                        return {
                          limit(limitValue) {
                            assert.equal(limitValue, 3);
                            const completed = clone(state.seasons)
                              .filter(s => s.status === "completed")
                              .filter(s => (Number(s.race_days_total) || 0) > gtValue)
                              .sort((a, b) => b.number - a.number)
                              .slice(0, limitValue);
                            return Promise.resolve({ data: completed, error: null });
                          },
                        };
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
            assert.equal(columns, "id");
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

// #30 · Re-run af processSeasonEnd for samme saeson maa ikke producere
// to snapshot-rows. Spejler DB-constraint board_plan_snapshots_board_season_unique.
test("processSeasonEnd is idempotent for board snapshots — re-run upserts instead of duplicating", async () => {
  const buildScenario = () => ({
    season: { id: "season-1", number: 5, status: "active" },
    team: {
      id: "team-1",
      name: "Idempotency Test",
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
        team: { id: "team-1", is_ai: false },
      },
    ],
  });

  const supabase = createSeasonEndSupabase(buildScenario());

  const deps = {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
  };

  await processSeasonEnd("season-1", deps);
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);

  // Reset season-status saa cron'en kan koeres igen (simulerer manuel re-run).
  supabase.state.season.status = "active";
  await processSeasonEnd("season-1", deps);

  assert.equal(
    supabase.state.inserts.board_plan_snapshots.length,
    1,
    "Anden processSeasonEnd-kald maa ikke skabe en dublet snapshot for (board-1, season-1)"
  );
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

test("processSeasonEnd writes board side effects and division bonus before completing the season (salary/loan-interest flyttet til sæson-start 2026-05-21)", async () => {
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
    updateRiderValues: async () => {},
  });

  // 2026-05-21: Sæson-slut skriver nu kun division-bonus + board-snapshots.
  // Salary, loan-interest, emergency-loan og negative-balance-interest sker
  // i processSeasonStart i stedet (ved næste sæson-start).
  const transactionTypes = supabase.state.inserts.finance_transactions.map(row => row.type);
  assert.deepEqual(transactionTypes, ["bonus"]);
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
  assert.equal(supabase.state.season.status, "completed");
  assert.equal(supabase.state.updates.seasons.length, 1);
});

test("processSeasonEnd skips baseline boards and triggers sequential negotiation after season 1", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-1",
      number: 1,
      status: "active",
    },
    team: {
      id: "team-1",
      name: "Baseline Tester",
      is_ai: false,
      user_id: "user-1",
      balance: 800000,
      sponsor_income: 240000,
      riders: [],
    },
    board: {
      id: "board-baseline",
      team_id: "team-1",
      plan_type: "baseline",
      focus: "balanced",
      satisfaction: 50,
      budget_modifier: 1.0,
      current_goals: [],
      is_baseline: true,
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      plan_start_sponsor_income: 240000,
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

  let sequentialCallArgs = null;
  await processSeasonEnd("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
    startSequentialNegotiation: async (args) => {
      sequentialCallArgs = args;
      return { baseline_rows_deleted: 1, window_state: "pending_5yr", completed_season_id: args.completedSeasonId };
    },
  });

  // Baseline board må aldrig evalueres — ingen snapshot, modifier uændret, satisfaction uændret.
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 0);
  assert.equal(supabase.state.board.budget_modifier, 1.0);
  assert.equal(supabase.state.board.satisfaction, 50);
  assert.equal(supabase.state.inserts.notifications.length, 0);

  // startSequentialNegotiation skal kaldes ved sæson 1-slut med completed seasonId.
  assert.ok(sequentialCallArgs, "startSequentialNegotiation must be called after season 1");
  assert.equal(sequentialCallArgs.completedSeasonId, "season-1");
  assert.equal(supabase.state.season.status, "completed");
});

test("processSeasonEnd does NOT trigger sequential negotiation after season 5 (only after season 1)", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-5",
      number: 5,
      status: "active",
    },
    team: {
      id: "team-1",
      name: "Late Season Team",
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
      is_baseline: false,
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      plan_start_sponsor_income: 200,
    },
    standings: [
      {
        season_id: "season-5",
        team_id: "team-1",
        division: 3,
        total_points: 50,
        rank_in_division: 5,
        stage_wins: 0,
        gc_wins: 0,
        team: { id: "team-1", is_ai: false },
      },
    ],
  });

  let sequentialCalled = false;
  await processSeasonEnd("season-5", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
    startSequentialNegotiation: async () => { sequentialCalled = true; return {}; },
  });

  assert.equal(sequentialCalled, false, "startSequentialNegotiation must only fire after season 1");
});

// ─── S-02c / S-02d / S-02e regression: processTeamSeasonEnd new paths ─────────

function makePlanCompleteSupabase({
  seasonNumber = 5,
  planType = "1yr",
  seasonsCompleted = 0,
  riders = [],
  planStartSeasonNumber = null,
  planEndSeasonNumber = null,
} = {}) {
  return createSeasonEndSupabase({
    season: { id: "season-5", number: seasonNumber, status: "active" },
    team: {
      id: "team-1",
      name: "Regression Team",
      is_ai: false,
      user_id: "user-1",
      balance: 500,
      sponsor_income: 200,
      season_1_identity_basis: { primary_specialization: "gc" },
      team_dna_key: "skandinavisk_udvikling",
      riders,
    },
    board: {
      id: "board-1",
      team_id: "team-1",
      plan_type: planType,
      focus: "balanced",
      satisfaction: 50,
      budget_modifier: 1.0,
      current_goals: [],
      seasons_completed: seasonsCompleted,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      plan_start_sponsor_income: 200,
      plan_start_season_number: planStartSeasonNumber,
      plan_end_season_number: planEndSeasonNumber,
    },
    standings: [
      {
        season_id: "season-5",
        team_id: "team-1",
        division: 3,
        total_points: 50,
        rank_in_division: 2,
        stage_wins: 0,
        gc_wins: 0,
        team: { id: "team-1", is_ai: false },
      },
    ],
  });
}

function baseDeps(overrides = {}) {
  return {
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
    processReplacementTrigger: async () => ({ counter: 0, replaced: false }),
    evaluateAndApplyConsequences: async () => {},
    ...overrides,
  };
}

test("processSeasonEnd calls processReplacementTrigger when 1yr plan completes", async () => {
  const supabase = makePlanCompleteSupabase();
  let callArgs = null;
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      processReplacementTrigger: async (args) => { callArgs = args; return { counter: 0, replaced: false }; },
    }),
  });

  assert.ok(callArgs, "processReplacementTrigger must be called when 1yr plan completes");
  assert.equal(callArgs.teamId, "team-1");
  assert.deepEqual(callArgs.identityBasis, { primary_specialization: "gc" });
  assert.equal(callArgs.dnaKey, "skandinavisk_udvikling");
  assert.equal(typeof callArgs.satisfaction, "number");
});

test("processSeasonEnd sends mid-review notification and skips processReplacementTrigger for 3yr plan at midpoint", async () => {
  // 3yr plan, seasons_completed=0 → seasonsCompleted=1 = Math.floor(3/2) → isMidReview=true, planIsComplete=false
  const supabase = makePlanCompleteSupabase({ planType: "3yr", seasonsCompleted: 0 });
  let replacementCalled = false;
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      processReplacementTrigger: async () => { replacementCalled = true; return { counter: 0, replaced: false }; },
    }),
  });

  assert.equal(replacementCalled, false, "processReplacementTrigger must not be called mid-cycle");
  const midReviewNotif = supabase.state.inserts.notifications.find(
    (n) => n.title === "Mid-plan review"
  );
  assert.ok(midReviewNotif, "mid-review notification must be sent for 3yr plan at season 1");
});

// #1236 · Plan-udløb skal rulle plan-vinduet frem til den nye cyklus. Uden
// roll-forward pegede plan_start_season_number stadig på den udløbne plans
// start-sæson efter sæsonskiftet, så /board/status' snapshot-filter
// (season_number >= plan_start_season_number) talte forrige cyklus' sæsoner
// med i den nye plan.
test("processSeasonEnd rolls plan_start_season_number forward when the plan expires (#1236)", async () => {
  // 1yr plan startet i sæson 5 udløber ved sæson 5's afslutning — den nye
  // cyklus kører tidligst fra sæson 6 (sæson-transition er altid number+1;
  // /board/sign og auto-accept overskriver med faktisk aktiv sæson ved signering).
  const supabase = makePlanCompleteSupabase({
    planType: "1yr",
    planStartSeasonNumber: 5,
    planEndSeasonNumber: 5,
  });
  await processSeasonEnd("season-5", { supabase, ...baseDeps() });

  assert.equal(supabase.state.board.negotiation_status, "pending");
  assert.equal(supabase.state.board.seasons_completed, 0);
  assert.equal(supabase.state.board.plan_start_season_number, 6);
  assert.equal(supabase.state.board.plan_end_season_number, 6);
});

// #1236 design-note: en plan der REELT startede i sæson N og stadig kører
// skal blive ved med at huske sæson N — kun udløb må rulle vinduet frem.
test("processSeasonEnd keeps plan_start_season_number for a still-running plan (#1236)", async () => {
  // 3yr plan i sæson 1-af-3 (seasons_completed=0 → planIsComplete=false).
  const supabase = makePlanCompleteSupabase({
    planType: "3yr",
    seasonsCompleted: 0,
    planStartSeasonNumber: 5,
    planEndSeasonNumber: 7,
  });
  await processSeasonEnd("season-5", { supabase, ...baseDeps() });

  assert.equal(supabase.state.board.seasons_completed, 1);
  assert.equal(supabase.state.board.plan_start_season_number, 5);
  assert.equal(supabase.state.board.plan_end_season_number, 7);
});

test("processSeasonEnd sends replacement notification when processReplacementTrigger returns replaced=true", async () => {
  const supabase = makePlanCompleteSupabase();
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      processReplacementTrigger: async () => ({
        counter: 0,
        replaced: true,
        new_chairman_label: "Resultatjægeren 🏆",
      }),
    }),
  });

  const replacementNotif = supabase.state.inserts.notifications.find(
    (n) => n.title === "The board has chosen a new chairman"
  );
  assert.ok(replacementNotif, "replacement notification must be sent when replaced=true");
  assert.ok(replacementNotif.message.includes("Resultatjægeren"), "notification must include new chairman label");
});

test("processSeasonEnd passes consecutiveLowExpirations=2 when replacement triggers (triggerDoublePlanLapse)", async () => {
  const supabase = makePlanCompleteSupabase();
  let consequencesArgs = null;
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      processReplacementTrigger: async () => ({ counter: 0, replaced: true, new_chairman_label: "Test 🏆" }),
      evaluateAndApplyConsequences: async (args) => { consequencesArgs = args; },
    }),
  });

  assert.ok(consequencesArgs, "evaluateAndApplyConsequences must be called");
  assert.equal(consequencesArgs.consecutiveLowExpirations, 2,
    "triggerDoublePlanLapse=true when replaced → consecutiveLowExpirations must be 2");
});

test("processSeasonEnd passes consecutiveLowExpirations=0 when no replacement occurs", async () => {
  const supabase = makePlanCompleteSupabase();
  let consequencesArgs = null;
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      processReplacementTrigger: async () => ({ counter: 0, replaced: false }),
      evaluateAndApplyConsequences: async (args) => { consequencesArgs = args; },
    }),
  });

  assert.ok(consequencesArgs, "evaluateAndApplyConsequences must be called");
  assert.equal(consequencesArgs.consecutiveLowExpirations, 0,
    "triggerDoublePlanLapse=false when not replaced → consecutiveLowExpirations must be 0");
});

test("processSeasonEnd continues and completes season when processReplacementTrigger throws", async () => {
  const supabase = makePlanCompleteSupabase();
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      processReplacementTrigger: async () => { throw new Error("board members unavailable"); },
    }),
  });

  assert.equal(supabase.state.season.status, "completed",
    "season must complete even when processReplacementTrigger throws");
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1,
    "board snapshot must still be written when replacement trigger throws");
});

test("processSeasonEnd writes u25_stat_sum and u25_count to board_plan_snapshots", async () => {
  const u25Rider = {
    id: "rider-u25",
    team_id: "team-1",
    is_u25: true,
    salary: 0,
    stat_fl: 4,
    stat_bj: 3,
    stat_kb: 0, stat_bk: 0, stat_tt: 0, stat_bro: 0,
    stat_sp: 0, stat_acc: 0, stat_udh: 0, stat_mod: 0, stat_res: 0, stat_ftr: 0,
    uci_points: 0, nationality_code: "DEN", popularity: 30,
  };
  const supabase = makePlanCompleteSupabase({ riders: [u25Rider] });
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps(),
  });

  const snapshot = supabase.state.inserts.board_plan_snapshots[0];
  assert.ok(snapshot, "board_plan_snapshots must have one row");
  assert.equal(snapshot.u25_stat_sum, 7, "u25_stat_sum must equal sum of all stat_* for U25 riders (4+3=7)");
  assert.equal(snapshot.u25_count, 1, "u25_count must equal number of U25 riders");
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
  });

  // 2026-05-21: Repair-funktionen er nu kun board-snapshot-repair.
  // Salary/loan-interest/emergency-loan tilhører processSeasonStart (næste
  // sæson). Repair skriver derfor 0 finance-rows og 1 board-snapshot.
  assert.equal(result.teamsProcessed, 1);
  assert.equal(supabase.state.inserts.finance_transactions.length, 0);
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
  assert.equal(supabase.state.updates.seasons.length, 0);
  assert.equal(
    supabase.state.updates.teams.some(update => "division" in update.payload),
    false
  );
});

test("repairSeasonEndFinanceAndBoard resumes without duplicating existing salary or board rows", async () => {
  const supabase = createSeasonEndSupabase({
    season: {
      id: "season-1",
      number: 5,
      status: "completed",
    },
    team: {
      id: "team-1",
      name: "Partial Repair",
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

  supabase.state.inserts.finance_transactions.push({
    team_id: "team-1",
    type: "salary",
    amount: -80,
    season_id: "season-1",
  });
  supabase.state.inserts.board_plan_snapshots.push({
    team_id: "team-1",
    board_id: "board-1",
    season_id: "season-1",
  });

  const result = await repairSeasonEndFinanceAndBoard("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
  });

  // 2026-05-21: Repair håndterer kun board-snapshots. Eksisterende
  // board_snapshot for board-1 → skippes → 1 row total (det eksisterende).
  // Salary-row prepended som setup forbliver urørt (existingSalaryTransactions
  // er ikke længere returneret af repair-funktionen).
  assert.equal(result.existingBoardSnapshotBoards, 1);
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
  assert.equal(supabase.state.updates.seasons.length, 0);
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
  // v3.78: balance_after følger processSeasonStart-rækkefølgen
  // balance + sponsor − renter − løn = 500 + 220 − 10 − 100 = 610
  assert.equal(preview.balance_after, 610);
  assert.equal(preview.needs_emergency_loan, false);
  assert.equal(preview.emergency_loan_amount, 0);
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

test("updateStandings paginerer race_results forbi 1000-row-loftet", async () => {
  // 2500 scorende rækker for ét hold (1 point hver). Uden paginering ville kun
  // de første 1000 tælle → total_points=1000 i stedet for 2500 (rod-årsag til
  // 38% manglende standings-point i sæson 1, 2026-05-30).
  const results = [];
  for (let i = 0; i < 2500; i += 1) {
    results.push({ race_id: "race-1", team_id: "team-a", result_type: "stage", rank: 50, points_earned: 1, rider: null });
  }
  const supabase = createStandingsSupabase({
    teams: [{ id: "team-a", division: 1 }],
    races: [{ id: "race-1" }],
    results,
  });

  const summary = await updateStandings("season-1", null, { supabase });

  assert.equal(summary.rowsUpdated, 1);
  assert.equal(supabase.state.upserts[0].rows[0].total_points, 2500); // alle sider talt
});

test("updateRiderValues recomputes prize_earnings_bonus from the last 3 completed seasons (no active → legacy mean)", async () => {
  // Backward-compat: with no active season the divisor = completed-season count,
  // so the formula reduces bit-for-bit to the old equal-weight mean.
  const supabase = createRiderValuesSupabase({
    seasons: [
      { id: "season-3", number: 3, status: "completed", race_days_total: 60 },
      { id: "season-2", number: 2, status: "completed", race_days_total: 60 },
      { id: "season-1", number: 1, status: "completed", race_days_total: 60 },
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
      { id: "rider-1" },
      { id: "rider-2" },
    ],
  });

  const summary = await updateRiderValues(supabase);

  assert.deepEqual(summary, { ridersUpdated: 2 });
  assert.deepEqual(supabase.state.riderUpdates, [
    { id: "rider-1", payload: { prize_earnings_bonus: 667 } }, // (1200+800)/3
    { id: "rider-2", payload: { prize_earnings_bonus: 167 } }, // 500/3
  ]);
});

test("updateRiderValues: completed anchor + active season both divide by the fixed window", async () => {
  // Completed S1 = 100k; active S2 at 10% (6/60), rider earned 8k so far. The
  // active season's progress no longer affects the divisor — it is always 3.
  // (100000 + 8000) / 3 = 36000.
  const supabase = createRiderValuesSupabase({
    seasons: [
      { id: "season-2", number: 2, status: "active", race_days_completed: 6, race_days_total: 60 },
      { id: "season-1", number: 1, status: "completed", race_days_total: 60 },
    ],
    races: [
      { id: "race-s1", season_id: "season-1" },
      { id: "race-s2", season_id: "season-2" },
    ],
    results: [
      { rider_id: "rider-1", race_id: "race-s1", prize_money: 100000 },
      { rider_id: "rider-1", race_id: "race-s2", prize_money: 8000 },
    ],
    riders: [{ id: "rider-1" }],
  });

  await updateRiderValues(supabase);

  assert.deepEqual(supabase.state.riderUpdates, [
    { id: "rider-1", payload: { prize_earnings_bonus: 36000 } },
  ]);
});

test("updateRiderValues: season 2 start dampens a completed season 1 to one third", async () => {
  // Completed S1 = 100k; active S2 just started (0 race days, no prizes yet).
  // Season 2 value = (s1 + s2 + s3) / 3 = (100000 + 0 + 0) / 3 = 33333.
  const supabase = createRiderValuesSupabase({
    seasons: [
      { id: "season-2", number: 2, status: "active", race_days_completed: 0, race_days_total: 60 },
      { id: "season-1", number: 1, status: "completed", race_days_total: 60 },
    ],
    races: [{ id: "race-s1", season_id: "season-1" }],
    results: [
      { rider_id: "rider-1", race_id: "race-s1", prize_money: 100000 },
    ],
    riders: [{ id: "rider-1" }],
  });

  await updateRiderValues(supabase);

  assert.deepEqual(supabase.state.riderUpdates, [
    { id: "rider-1", payload: { prize_earnings_bonus: 33333 } },
  ]);
});

test("updateRiderValues: lone active season 1 divides by the full 3-window (dampened)", async () => {
  // Open-beta season 1: only an active season, no completed anchor. At 10%
  // progress a rider earned 8k. The fixed window divides by 3 regardless:
  // 8000 / 3 = 2667 (future seasons 2 and 3 count as 0).
  const supabase = createRiderValuesSupabase({
    seasons: [
      { id: "season-1", number: 1, status: "active", race_days_completed: 6, race_days_total: 60 },
    ],
    races: [{ id: "race-s1", season_id: "season-1" }],
    results: [
      { rider_id: "rider-1", race_id: "race-s1", prize_money: 8000 },
    ],
    riders: [{ id: "rider-1" }],
  });

  await updateRiderValues(supabase);

  assert.deepEqual(supabase.state.riderUpdates, [
    { id: "rider-1", payload: { prize_earnings_bonus: 2667 } },
  ]);
});

test("payDivisionBonuses credits correct amounts per division rank and is idempotent", async () => {
  const balances = {
    "team-d1-r1": 500_000,
    "team-d2-r3": 300_000,
    "team-ai": 0,
    "team-d3-r5": 100_000,
  };
  const financeRows = [];

  const supabase = {
    // Slice 07c: balance + finance_transactions atomic via RPC.
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      balances[params.p_team_id] = (balances[params.p_team_id] ?? 0) + params.p_delta;
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: balances[params.p_team_id], error: null });
    },
    from(table) {
      if (table === "finance_transactions") {
        return {
          select() {
            const filters = {};
            return {
              eq(col, val) {
                filters[col] = val;
                return {
                  eq(col2, val2) {
                    filters[col2] = val2;
                    const data = financeRows
                      .filter(r => Object.entries(filters).every(([k, v]) => r[k] === v))
                      .map(r => ({ team_id: r.team_id }));
                    return Promise.resolve({ data, error: null });
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

  const standings = [
    { team_id: "team-d1-r1", division: 1, rank_in_division: 1, team: { is_ai: false } },
    { team_id: "team-d2-r3", division: 2, rank_in_division: 3, team: { is_ai: false } },
    { team_id: "team-ai",    division: 1, rank_in_division: 2, team: { is_ai: true } },
    { team_id: "team-d3-r5", division: 3, rank_in_division: 5, team: { is_ai: false } },
  ];

  await payDivisionBonuses(standings, "season-1", supabase);

  assert.equal(balances["team-d1-r1"], 800_000);  // 500K + 300K (D1 rank 1)
  assert.equal(balances["team-d2-r3"], 350_000);  // 300K + 50K (D2 rank 3)
  assert.equal(balances["team-ai"], 0);           // AI teams skipped
  assert.equal(balances["team-d3-r5"], 100_000);  // D3 only pays top 3 — rank 5 skipped

  const bonusTypes = financeRows.map(r => r.type);
  assert.deepEqual(bonusTypes, ["bonus", "bonus"]);

  // Idempotency: second call does not credit again
  await payDivisionBonuses(standings, "season-1", supabase);
  assert.equal(balances["team-d1-r1"], 800_000);
  assert.equal(balances["team-d2-r3"], 350_000);
  assert.equal(financeRows.length, 2);
});

// ─── processDivisionEnd gating (FIRST_PROMOTION_RELEGATION_SEASON) ────────────

function createDivisionEndSupabase() {
  const updates = [];
  const notifications = [];
  return {
    updates,
    notifications,
    rpc(name) {
      assert.equal(name, "increment_balance_with_audit");
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select() {
            // notifyTeamOwner kalder .select("user_id").eq("id", teamId).single() —
            // returnér user_id=null så notifyUser early-exiter på missing_user uden
            // at vi behøver mocke notifications-dedup-pathen i sin helhed.
            return {
              eq() {
                return {
                  single() { return Promise.resolve({ data: { user_id: null }, error: null }); },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                updates.push({ id: value, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "notifications") {
        return {
          insert(rows) {
            notifications.push(...(Array.isArray(rows) ? rows : [rows]));
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table in division-end mock: ${table}`);
    },
  };
}

function buildDivStandings(division) {
  return [
    { team_id: `${division}-a`, division, rank_in_division: 1, total_points: 400, team: { id: `${division}-a`, is_ai: false } },
    { team_id: `${division}-b`, division, rank_in_division: 2, total_points: 300, team: { id: `${division}-b`, is_ai: false } },
    { team_id: `${division}-c`, division, rank_in_division: 3, total_points: 200, team: { id: `${division}-c`, is_ai: false } },
    { team_id: `${division}-d`, division, rank_in_division: 4, total_points: 100, team: { id: `${division}-d`, is_ai: false } },
  ];
}

test("processDivisionEnd skips promotion/relegation for season 1 (gated by FIRST_PROMOTION_RELEGATION_SEASON)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildDivStandings(2), 2, "season-1", 1, { supabase, now: new Date("2026-05-21T23:00:00Z") });
  assert.equal(supabase.updates.length, 0, "no team.division writes expected for season 1");
});

test("processDivisionEnd skips promotion/relegation for season 2 (gated by FIRST_PROMOTION_RELEGATION_SEASON)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildDivStandings(2), 2, "season-2", 2, { supabase, now: new Date("2026-06-21T23:00:00Z") });
  assert.equal(supabase.updates.length, 0, "no team.division writes expected for season 2");
});

test("processDivisionEnd performs promotion + relegation for season 3 (gate cleared)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildDivStandings(2), 2, "season-3", 3, { supabase, now: new Date("2026-07-21T23:00:00Z") });
  // Div 2: top 2 promoted to div 1, bottom 2 relegated to div 3
  const promotions = supabase.updates.filter(u => u.payload.division === 1).map(u => u.id).sort();
  const relegations = supabase.updates.filter(u => u.payload.division === 3).map(u => u.id).sort();
  assert.deepEqual(promotions, ["2-a", "2-b"]);
  assert.deepEqual(relegations, ["2-c", "2-d"]);
});

// ─── rebalanceDivisions (#962 fyld-fra-toppen) ────────────────────────────────

function createRebalanceSupabase(teams) {
  const updates = [];
  return {
    updates,
    from(table) {
      assert.equal(table, "teams", `Unexpected table in rebalance mock: ${table}`);
      return {
        select(cols) {
          if (cols === "user_id") {
            // notifyManager → notifyTeamOwner path. user_id=null early-exiter.
            return {
              eq() {
                return { single() { return Promise.resolve({ data: { user_id: null }, error: null }); } };
              },
            };
          }
          // Load-path: .eq("is_ai", false).eq("is_frozen", false) derefter await.
          const query = {
            eq() { return query; },
            then(resolve, reject) {
              const rows = teams.map(t => ({ id: t.id, division: t.division }));
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
        update(payload) {
          return {
            eq(column, value) {
              assert.equal(column, "id");
              updates.push({ id: value, division: payload.division });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

function buildRebalanceTeams({ div1 = 0, div2 = 0, div3 = 0 } = {}) {
  const teams = [];
  for (let i = 0; i < div1; i++) teams.push({ id: `d1-${i}`, division: 1 });
  for (let i = 0; i < div2; i++) teams.push({ id: `d2-${i}`, division: 2 });
  for (let i = 0; i < div3; i++) teams.push({ id: `d3-${i}`, division: 3 });
  return teams;
}

test("rebalanceDivisions is gated by FIRST_PROMOTION_RELEGATION_SEASON (no moves before season 3)", async () => {
  const supabase = createRebalanceSupabase(buildRebalanceTeams({ div1: 5, div2: 5, div3: 5 }));
  const result = await rebalanceDivisions(2, [], { supabase, now: new Date("2026-06-21T23:00:00Z") });
  assert.equal(supabase.updates.length, 0);
  assert.deepEqual(result.moved, []);
});

test("rebalanceDivisions pulls the best-ranked team up to fill an empty top slot", async () => {
  const teams = buildRebalanceTeams({ div1: DIVISION_CAPACITY - 1, div2: 2 });
  const supabase = createRebalanceSupabase(teams);
  // Standings: d2-1 placeret bedre end d2-0 → d2-1 skal trækkes op først.
  const standings = [
    { team_id: "d2-1" },
    { team_id: "d2-0" },
  ];

  const result = await rebalanceDivisions(3, standings, { supabase, now: new Date("2026-07-21T23:00:00Z") });

  // Kun 1 ledig plads i div 1 → den bedst placerede (d2-1) rykkes op.
  assert.deepEqual(supabase.updates, [{ id: "d2-1", division: 1 }]);
  assert.deepEqual(result.moved, [{ team_id: "d2-1", from: 2, to: 1 }]);
});

test("rebalanceDivisions cascades: fills div 1 from div 2, then div 2 from div 3", async () => {
  const teams = buildRebalanceTeams({ div1: DIVISION_CAPACITY - 2, div2: 3, div3: 4 });
  const supabase = createRebalanceSupabase(teams);

  const result = await rebalanceDivisions(3, [], { supabase, now: new Date("2026-07-21T23:00:00Z") });

  const toDiv1 = supabase.updates.filter(u => u.division === 1).length;
  const toDiv2 = supabase.updates.filter(u => u.division === 2).length;
  // 2 ledige i div 1 → 2 fra div 2 op. Div 2 har nu plads → de 4 i div 3 rykker op.
  assert.equal(toDiv1, 2);
  assert.equal(toDiv2, 4);
  assert.equal(result.moved.length, 6);
});

test("rebalanceDivisions makes no moves when top divisions are already full (soft cap respected)", async () => {
  const teams = buildRebalanceTeams({ div1: DIVISION_CAPACITY, div2: DIVISION_CAPACITY + 5, div3: 3 });
  const supabase = createRebalanceSupabase(teams);

  const result = await rebalanceDivisions(3, [], { supabase, now: new Date("2026-07-21T23:00:00Z") });

  assert.equal(supabase.updates.length, 0);
  assert.deepEqual(result.moved, []);
});
