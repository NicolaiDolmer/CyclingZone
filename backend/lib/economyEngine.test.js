import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  buildSeasonEndPreviewRows,
  payDivisionBonuses,
  processDivisionEnd,
  processSeasonEnd,
  processSeasonStart,
  processTeamSeasonPayroll,
  repairSeasonEndFinanceAndBoard,
  updateRiderValues,
  updateStandings,
} = await import("./economyEngine.js");

const {
  MAX_BOARD_MODIFIER,
  INITIAL_BALANCE,
  UPKEEP_BY_DIVISION,
  FINANCE_REASON,
} = await import("./economyConstants.js");
const { ACADEMY } = await import("./academyFlag.js");

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
                  // loadHumanSeasonEndTeams + processSeasonStart chainer
                  // .eq("is_bank").eq("is_frozen") efter .eq("is_ai") (#1077).
                  // rebalanceDivisions (#962) chainer .eq("is_test_account").eq("is_frozen").
                  // Mocken understøtter vilkårlig længde af is_test_account/is_bank/is_frozen-led
                  // (samt legacy direkte-Promise single-eq callers).
                  const teamsResult = {
                    data: [clone(state.team)],
                    error: null,
                  };
                  const makeChain = () => Object.assign(Promise.resolve(teamsResult), {
                    eq(innerCol, innerVal) {
                      assert.equal(
                        ["is_test_account", "is_bank", "is_frozen"].includes(innerCol),
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

      // #1152: processSeasonEnd bygger nu et pulje-træ + AI-fyld-sweep. Disse board/
      // finance-tests er ikke promotion-tests; tom league_divisions → tomt træ + tomt
      // sweep (no-op), så promotion-stien ikke forstyrrer deres assertions.
      if (table === "league_divisions") {
        return {
          select() {
            return Promise.resolve({ data: [], error: null });
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
            assert.equal(columns, "id, division, league_division_id");
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
  assert.equal(preview.upkeep, 40000);
  // v3.78/A3 + #1441 A6: balance_after følger processSeasonStart-rækkefølgen inkl. upkeep
  // (D3 upkeep kalibreret 30000 → 40000).
  // balance + sponsor − renter − løn − upkeep = 500 + 220 − 10 − 100 − 40000 = −39390
  assert.equal(preview.balance_after, -39390);
  assert.equal(preview.needs_emergency_loan, true);
  assert.equal(preview.emergency_loan_amount, 39390);
  assert.equal(preview.current_board_satisfaction, 50);
  assert.equal(preview.board_satisfaction, 74);
  assert.equal(preview.sponsor_modifier, 1.1);
  assert.equal(preview.next_season_sponsor, 220);
  assert.equal(preview.board_goals_met, 1);
  assert.equal(preview.board_goals_total, 1);
});

// #1187 · Weekend-target-tracking flytter satisfaction løbende. Sæson-slut-
// previewet (og processTeamSeasonEnd, samme guard) skal anke på sæson-START-
// værdien — ellers dobbelt-anvendes deltaet oven i den konvergerede værdi.
test("buildSeasonEndPreviewRows anker på sæson-start-satisfaction når weekend-anker er sat (#1187)", () => {
  const makeArgs = (boardOverrides) => ({
    teams: [
      {
        id: "team-1",
        name: "Anchor Testers",
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
              { type: "top_n_finish", target: 2, label: "Top 2 i divisionen", satisfaction_bonus: 10, satisfaction_penalty: 5 },
            ],
            seasons_completed: 0,
            cumulative_stage_wins: 0,
            cumulative_gc_wins: 0,
            plan_start_sponsor_income: 200,
            ...boardOverrides,
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
    loanData: [],
  });

  // Weekend-opdateringerne har konvergeret den løbende værdi til 74 (= 50 + 24).
  // Med gyldigt anker skal previewet stadig lande på 74 — IKKE 74 + 24 = 98.
  const [anchored] = buildSeasonEndPreviewRows(makeArgs({
    satisfaction: 74,
    season_start_satisfaction: 50,
    season_start_anchor_season_id: "season-1",
  }));
  assert.equal(anchored.current_board_satisfaction, 74, "viser den løbende værdi som nuværende");
  assert.equal(anchored.board_satisfaction, 74, "projektion = anker + delta, intet ekstra spring");

  // Anker fra en ANDEN sæson ignoreres → dagens adfærd (current + delta).
  const [stale] = buildSeasonEndPreviewRows(makeArgs({
    satisfaction: 50,
    season_start_satisfaction: 10,
    season_start_anchor_season_id: "season-0",
  }));
  assert.equal(stale.board_satisfaction, 74, "stale anker ændrer intet ift. dagens adfærd");
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
      league_division_id: null,
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
      league_division_id: null,
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
      league_division_id: null,
      rank_in_division: 1,
      total_points: 0,
      stage_wins: 0,
      gc_wins: 0,
      races_completed: 0,
      updated_at: supabase.state.upserts[0].rows[2].updated_at,
    },
  ]);
});

test("updateStandings ranger inden for puljen (league_division_id), ikke på tværs af tier'en", async () => {
  // To puljer i SAMME tier (division 4): pulje 11 og pulje 12.
  // Hold i hver pulje har samme point → begge pulje-vindere skal få rank_in_division=1.
  // Hvis rangen fejlagtigt beregnes på tier-niveau (division), ville kun ét hold få rank 1.
  const supabase = createStandingsSupabase({
    teams: [
      { id: "pool-a-leader", division: 4, league_division_id: 11 },
      { id: "pool-a-runner", division: 4, league_division_id: 11 },
      { id: "pool-b-leader", division: 4, league_division_id: 12 },
      { id: "pool-b-runner", division: 4, league_division_id: 12 },
    ],
    races: [{ id: "race-1" }],
    results: [
      { race_id: "race-1", team_id: "pool-a-leader", result_type: "gc", rank: 1, points_earned: 100, rider: null },
      { race_id: "race-1", team_id: "pool-a-runner", result_type: "gc", rank: 2, points_earned: 50, rider: null },
      { race_id: "race-1", team_id: "pool-b-leader", result_type: "gc", rank: 1, points_earned: 80, rider: null },
      { race_id: "race-1", team_id: "pool-b-runner", result_type: "gc", rank: 2, points_earned: 40, rider: null },
    ],
  });

  await updateStandings("season-1", "race-1", { supabase });

  const rows = supabase.state.upserts[0].rows;
  const byTeam = Object.fromEntries(rows.map(row => [row.team_id, row]));

  // Begge pulje-ledere er nr. 1 i deres egen pulje.
  assert.equal(byTeam["pool-a-leader"].rank_in_division, 1, "pulje-A-leder = rang 1 i puljen");
  assert.equal(byTeam["pool-b-leader"].rank_in_division, 1, "pulje-B-leder = rang 1 i puljen (ikke tier-bred)");
  assert.equal(byTeam["pool-a-runner"].rank_in_division, 2);
  assert.equal(byTeam["pool-b-runner"].rank_in_division, 2);

  // division (tier) bevares til økonomi/visning; league_division_id sættes på hver række.
  for (const row of rows) {
    assert.equal(row.division, 4, "tier bevares = 4");
  }
  assert.equal(byTeam["pool-a-leader"].league_division_id, 11);
  assert.equal(byTeam["pool-b-leader"].league_division_id, 12);
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

// ─── processDivisionEnd: per-pulje binær-træ-model (#1152) ────────────────────

// Pulje-træ til tests: tier 1×1 (id1), tier 2×2 (id2,3), tier 3×4 (id4-7),
// tier 4×8 (id8-15). forælder(T,i)=(T-1,⌊i/2⌋); børn=(T+1,2i),(T+1,2i+1).
const TEST_POOL_ROWS = [
  { id: 1, tier: 1, pool_index: 0 },
  { id: 2, tier: 2, pool_index: 0 }, { id: 3, tier: 2, pool_index: 1 },
  { id: 4, tier: 3, pool_index: 0 }, { id: 5, tier: 3, pool_index: 1 },
  { id: 6, tier: 3, pool_index: 2 }, { id: 7, tier: 3, pool_index: 3 },
  { id: 8, tier: 4, pool_index: 0 }, { id: 9, tier: 4, pool_index: 1 },
  { id: 10, tier: 4, pool_index: 2 }, { id: 11, tier: 4, pool_index: 3 },
  { id: 12, tier: 4, pool_index: 4 }, { id: 13, tier: 4, pool_index: 5 },
  { id: 14, tier: 4, pool_index: 6 }, { id: 15, tier: 4, pool_index: 7 },
];
const FIRST_POOL_OF_TIER = { 1: 1, 2: 2, 3: 4, 4: 8 };

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
      if (table === "league_divisions") {
        return { select() { return Promise.resolve({ data: TEST_POOL_ROWS.map(r => ({ ...r })), error: null }); } };
      }
      if (table === "teams") {
        return {
          select() {
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

// Byg pulje-standings: `count` hold i pulje `poolId`, hvor de `aiCount` dårligste er AI.
function buildPoolStandings({ division, poolId = FIRST_POOL_OF_TIER[division], count = 8, aiCount = 0 }) {
  const rows = [];
  for (let r = 1; r <= count; r++) {
    const isAi = r > count - aiCount; // AI på de dårligste ranks
    const id = `t${division}-p${poolId}-r${r}`;
    rows.push({ team_id: id, division, league_division_id: poolId, rank_in_division: r, total_points: 1000 - r, team: { id, is_ai: isAi } });
  }
  return rows;
}

test("#1152 · op/nedrykning er aktiv fra sæson 1 (gate fjernet)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildPoolStandings({ division: 2 }), 2, "season-1", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  assert.ok(supabase.updates.length > 0, "promotion/relegation skal ske allerede i sæson 1");
});

test("#1152 · promotion router top 2 op til FORÆLDER-puljen (Div2 pulje0 → Div1 pulje1)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildPoolStandings({ division: 2, poolId: 2 }), 2, "s", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  const promoted = supabase.updates.filter(u => u.payload.division === 1);
  assert.equal(promoted.length, 2, "top 2 oprykket");
  assert.ok(promoted.every(u => u.payload.league_division_id === 1), "forælder-pulje = Div1 pulje (id 1)");
});

test("#1152 · relegation deler bund 4 ligeligt ud i de to BØRNE-puljer (Div2 pulje0 → Div3 pulje4+5)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildPoolStandings({ division: 2, poolId: 2 }), 2, "s", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  const relegated = supabase.updates.filter(u => u.payload.division === 3);
  assert.equal(relegated.length, 4, "bund 4 relegeret");
  const dests = relegated.map(u => u.payload.league_division_id).sort();
  assert.deepEqual(dests, [4, 4, 5, 5], "delt 2+2 til de to børne-puljer (id 4 og 5)");
});

test("#1152 · tier 1 (top) relegerer men rykker IKKE op", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildPoolStandings({ division: 1, poolId: 1 }), 1, "s", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  assert.equal(supabase.updates.filter(u => u.payload.division === 0).length, 0, "ingen oprykning fra tier 1");
  const relegated = supabase.updates.filter(u => u.payload.division === 2);
  assert.equal(relegated.length, 4, "bund 4 relegeret til Div2");
  assert.deepEqual(relegated.map(u => u.payload.league_division_id).sort(), [2, 2, 3, 3], "børn = Div2 pulje 2+3");
});

test("#1152 · tier 4 (bund) rykker op men relegerer IKKE", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildPoolStandings({ division: 4, poolId: 8 }), 4, "s", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  const promoted = supabase.updates.filter(u => u.payload.division === 3);
  assert.equal(promoted.length, 2, "top 2 oprykket til Div3");
  assert.ok(promoted.every(u => u.payload.league_division_id === 4), "forælder = Div3 pulje (id 4)");
  assert.equal(supabase.updates.filter(u => u.payload.division === 5).length, 0, "ingen relegering fra tier 4");
});

test("#1152 · Div3-pulje MED AI relegerer IKKE til Div4 (udskydelse) men rykker stadig op", async () => {
  const supabase = createDivisionEndSupabase();
  // 24 hold, 4 AI i bunden → ikke all-real → Div4-relegering udskydes.
  await processDivisionEnd(buildPoolStandings({ division: 3, poolId: 4, count: 24, aiCount: 4 }), 3, "s", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  assert.equal(supabase.updates.filter(u => u.payload.division === 4).length, 0, "ingen relegering til Div4 (pulje har AI)");
  assert.equal(supabase.updates.filter(u => u.payload.division === 2).length, 2, "top 2 rykker stadig op til Div2");
});

test("#1152 · Div3-pulje ALL-REAL relegerer til Div4 (aktivering)", async () => {
  const supabase = createDivisionEndSupabase();
  // 24 hold, 0 AI → all-real → Div4-børn aktiveres.
  await processDivisionEnd(buildPoolStandings({ division: 3, poolId: 4, count: 24, aiCount: 0 }), 3, "s", 1, { supabase, now: new Date("2026-06-23T23:00:00Z") });
  const relegated = supabase.updates.filter(u => u.payload.division === 4);
  assert.equal(relegated.length, 4, "bund 4 relegeret til Div4");
  assert.deepEqual(relegated.map(u => u.payload.league_division_id).sort(), [8, 8, 9, 9], "Div4-børn = pulje 8+9");
});

// ─── Akademi-drift (#1308) ────────────────────────────────────────────────────

function _createPayrollWithAcademySupabase({ teamId, balance, academyRiderCount, seasonId: _seasonId }) {
  const academyRiders = [];
  for (let i = 0; i < academyRiderCount; i++) {
    academyRiders.push({ id: `academy-rider-${i}`, team_id: teamId, salary: 0, is_academy: true });
  }

  const state = {
    balance,
    financeRows: [],
    academyRiderCount,
  };

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      state.balance += params.p_delta;
      state.financeRows.push({
        team_id: params.p_team_id,
        ...params.p_finance_payload,
      });
      return Promise.resolve({ data: state.balance, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_columns) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, teamId);
                return {
                  single() {
                    return Promise.resolve({ data: { balance: state.balance }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(_columns) {
            return {
              eq(col, val) {
                assert.equal(col, "team_id");
                assert.equal(val, teamId);
                return {
                  eq(col2, val2) {
                    assert.equal(col2, "is_academy");
                    assert.equal(val2, true);
                    return {
                      select(_cols2, opts) {
                        assert.deepEqual(opts, { count: "exact", head: true });
                        return Promise.resolve({ count: state.academyRiderCount, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in academy-drift mock: ${table}`);
    },
  };
}

test("processTeamSeasonPayroll debits N * DRIFT_PER_SEASON as academy_drift for a team with N academy riders", async () => {
  const ACADEMY_COUNT = 3;
  const seasonId = "season-drift-1";
  const teamId = "team-academy";

  const financeRows = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    return Promise.resolve({ data: { balance: 999_999 }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        // is_academy count-query: .select("id", {count:"exact",head:true}).eq("team_id",X).eq("is_academy",true)
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return {
                    eq(_col2, _val2) {
                      return Promise.resolve({ count: ACADEMY_COUNT, error: null });
                    },
                  };
                },
              };
            }
            // rider-select for salary (team_id + salary columns) — no academy riders have salary
            return {
              in(_col, _vals) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const team = {
    id: teamId,
    name: "Academy FC",
    balance: 999_999,
    riders: [], // salary-riders (academyRiders have salary=0, not included here)
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
  });

  const driftRows = financeRows.filter(r => r.type === "academy_drift");
  assert.equal(driftRows.length, 1, "Præcis én academy_drift-transaktion skal skrives");

  const drift = driftRows[0];
  const expectedAmount = -(ACADEMY_COUNT * ACADEMY.DRIFT_PER_SEASON);
  assert.equal(drift.amount, expectedAmount, `Beløb skal være ${expectedAmount} (negativt)`);
  assert.equal(drift.team_id, teamId);
  assert.equal(drift.reason_code, FINANCE_REASON.SEASON_START_ACADEMY_DRIFT);

  // Idempotency-nøgle skal indeholde sæson + hold
  assert.ok(
    drift.idempotency_key && drift.idempotency_key.includes(seasonId) && drift.idempotency_key.includes(teamId),
    `Idempotency-nøgle skal indeholde sæson og hold: ${drift.idempotency_key}`
  );
});

test("processTeamSeasonPayroll skips academy_drift entirely for a team with 0 academy riders", async () => {
  const seasonId = "season-no-drift";
  const teamId = "team-no-academy";

  const financeRows = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    return Promise.resolve({ data: { balance: 500_000 }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return {
                    eq(_col2, _val2) {
                      return Promise.resolve({ count: 0, error: null });
                    },
                  };
                },
              };
            }
            return {
              in(_col, _vals) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const team = {
    id: teamId,
    name: "No Academy FC",
    balance: 500_000,
    riders: [],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
  });

  const driftRows = financeRows.filter(r => r.type === "academy_drift");
  assert.equal(driftRows.length, 0, "Hold uden akademi-ryttere: ingen academy_drift-transaktion");
});

// ─── processSeasonStart — FINAL sponsor-payout-clamp (#1441) ─────────────────

/**
 * Minimal fake supabase til processSeasonStart.
 *
 * Dækker tabellerne som processSeasonStart + loadSponsorStandingsContextForSeason
 * kalder:
 *   seasons           — sæson-nummer + forrige sæsons id
 *   season_standings  — forrige sæsons standings (tom → ingen lastSeasonStanding)
 *   teams             — hold med board_profiles embedded
 *   board_consequences — aktive sponsor-pullouts (ingen her)
 *   transfer_windows  — board_test_mode (returnerer false)
 *   rpc               — increment_balance_with_audit (fanger finance-payload)
 *   board_profiles    — insert af manglende plantyper
 *
 * processLoanAgreementSeasonFees + runSeasonPayroll injiceres som no-op stubs.
 */
function createSeasonStartSupabase({ season, team, prevSeasonId = null, prevStandings = [], activeContract = null } = {}) {
  const state = {
    season: clone(season),
    team: clone(team),
    activeContract: clone(activeContract),
    financeRows: [],
  };

  // Embed board_profiles direkte på holdet (som processSeasonStart forventer)
  state.team.board_profiles = state.team.board_profiles || [];

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      state.financeRows.push({ ...params.p_finance_payload, team_id: params.p_team_id });
      return Promise.resolve({ data: (state.team.balance ?? 0) + params.p_delta, error: null });
    },
    from(table) {
      if (table === "seasons") {
        return {
          select(columns) {
            // processSeasonStart: .select("number").eq("id", seasonId).single()
            if (columns === "number") {
              return {
                eq(col, val) {
                  assert.equal(col, "id");
                  assert.equal(val, state.season.id);
                  return {
                    single() {
                      return Promise.resolve({ data: { number: state.season.number }, error: null });
                    },
                  };
                },
              };
            }
            // loadSponsorStandingsContextForSeason: .select("id").eq("number", N-1).maybeSingle()
            if (columns === "id") {
              return {
                eq(col, val) {
                  assert.equal(col, "number");
                  return {
                    maybeSingle() {
                      const id = prevSeasonId && val === state.season.number - 1 ? prevSeasonId : null;
                      return Promise.resolve({ data: id ? { id } : null, error: null });
                    },
                  };
                },
              };
            }
            throw new Error(`seasons.select("${columns}") ikke mocket`);
          },
        };
      }

      if (table === "season_standings") {
        return {
          select() {
            return {
              eq(col, val) {
                assert.equal(col, "season_id");
                const rows = val === prevSeasonId ? clone(prevStandings) : [];
                return Promise.resolve({ data: rows, error: null });
              },
            };
          },
        };
      }

      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "*, board_profiles(*)");
            // Returnerer en thenable der svarer til .eq("is_ai", false).eq("is_frozen", false)
            const result = { data: [clone(state.team)], error: null };
            const chain = Object.assign(Promise.resolve(result), {
              eq(_col, _val) { return chain; },
            });
            return chain;
          },
        };
      }

      if (table === "board_consequences") {
        return {
          select(columns) {
            assert.equal(columns, "team_id, severity, id");
            return {
              eq(_col, _val) {
                return {
                  eq(_col2, _val2) {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
          update(_payload) {
            return {
              eq(_col, _val) {
                return {
                  eq(_col2, _val2) {
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "transfer_windows") {
        // isBoardTestModeActive: .select("board_test_mode").order(...).limit(1).maybeSingle()
        return {
          select(_cols) {
            return {
              order(_col, _opts) {
                return {
                  limit(_n) {
                    return {
                      maybeSingle() {
                        return Promise.resolve({ data: { board_test_mode: false }, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "board_profiles") {
        // createInitialBoardProfile-insert for manglende plantyper
        return {
          insert(_payload) {
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "sponsor_contracts") {
        // #1663: getActiveContract — ingen aktiv kontrakt i dette scenarie
        // (no-contract-stien: ceiling = gross_sponsor × MAX_BOARD_MODIFIER).
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle() {
                        return Promise.resolve({ data: state.activeContract ?? null, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`createSeasonStartSupabase: uventet tabel "${table}"`);
    },
  };
}

test("processSeasonStart clamper FINAL sponsor-payout til gross_sponsor × MAX_BOARD_MODIFIER (no-contract-sti)", async () => {
  // #1663: i no-contract-stien er loftet IKKE den flade FINAL_SPONSOR_PAYOUT_CEILING.
  // Det afledes dynamisk: ceiling = round(gross_sponsor × MAX_BOARD_MODIFIER), så
  // legitim renown-skalering ikke cappes — kun board-modifier-bypass.
  // Scenarie: D1-hold i sæson 2, board budget_modifier = 1.5 > MAX_BOARD_MODIFIER (1.2)
  // → payouten clampes til gross_sponsor × 1.20. Vi asserter mod selve formlen (afledt
  // af det faktiske sponsor_breakdown.gross_sponsor), så et regression i ceiling-formlen
  // fanges — ikke et tilfældigt 750k×1.2 = 900k-sammenfald med den flade S2_PLUS-konstant.

  const seasonId = "season-2";

  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [
      // forrige sæson: holdet lå i division 1, rank 3 — giver gross_sponsor > ceiling
      {
        team_id: "team-clamp",
        division: 1,
        rank_in_division: 3,
        total_points: 200,
      },
    ],
    team: {
      id: "team-clamp",
      name: "Clamp Test CF",
      is_ai: false,
      is_frozen: false,
      division: 1,
      balance: 500_000,
      sponsor_income: 600_000,  // D1 intro-base — bruges som fallback i sponsorEngine
      board_profiles: [
        {
          id: "board-clamp",
          team_id: "team-clamp",
          plan_type: "1yr",
          negotiation_status: "completed",
          budget_modifier: 1.5,  // modifier = 1.5 → 750k × 1.5 = 1.125M uden clamp
        },
      ],
    },
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find(r => r.type === "sponsor");
  assert.ok(sponsorRow, "Ingen sponsor finance-row fundet");

  // Afled det faktiske gross_sponsor fra resultatet (ikke et hardcoded tal), så
  // testen følger sponsor-motorens output og ikke et tilfældigt sammenfald.
  const sponsorResult = outcome.sponsor.find(r => r.team === "Clamp Test CF");
  assert.ok(sponsorResult, "Ingen sponsor-resultat for holdet");
  const gross = sponsorResult.sponsor_breakdown.gross_sponsor;
  const expectedCeiling = Math.round(gross * MAX_BOARD_MODIFIER);

  // Board-modifier 1.5 > MAX_BOARD_MODIFIER → uncapped = round(gross × 1.5) >
  // ceiling, så payouten SKAL lande præcis på det dynamiske loft.
  assert.ok(
    Math.round(gross * 1.5) > expectedCeiling,
    "Forudsætning: board-modifier 1.5 skal overstige loftet (ellers tester vi ikke clampen)"
  );
  assert.equal(
    sponsorRow.amount,
    expectedCeiling,
    `Sponsor payout skal clampes til round(gross_sponsor ${gross} × MAX_BOARD_MODIFIER ${MAX_BOARD_MODIFIER}) = ${expectedCeiling} — fik ${sponsorRow.amount}`
  );
});

// ─── Løbende upkeep-debit (#1441) ────────────────────────────────────────────

test("processTeamSeasonPayroll debits 140000 as upkeep for a D2 team (#1441)", async () => {
  const seasonId = "season-upkeep-1";
  const teamId = "team-upkeep-d2";

  const financeRows = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    return Promise.resolve({ data: { balance: 999_999 }, error: null });
                  },
                };
              },
            };
          },
          update(_payload) {
            return {
              eq(_col, _val) {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return {
                    eq(_col2, _val2) {
                      return Promise.resolve({ count: 0, error: null });
                    },
                  };
                },
              };
            }
            return {
              in(_col, _vals) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in upkeep test: ${table}`);
    },
  };

  const team = {
    id: teamId,
    name: "D2 Upkeep FC",
    division: 2,
    balance: 999_999,
    riders: [],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0, // B3: stub — under ceiling, ingen breach
  });

  const upkeepRows = financeRows.filter(r => r.type === "upkeep");
  assert.equal(upkeepRows.length, 1, "Præcis én upkeep-transaktion skal skrives for D2-hold");

  const upkeep = upkeepRows[0];
  assert.equal(upkeep.amount, -140000, "Upkeep-beløb skal være -140000 for division 2 (#1441 A6-kalibreret)");
  assert.equal(upkeep.team_id, teamId);

  // Idempotency-nøgle skal indeholde sæson + hold
  assert.ok(
    upkeep.idempotency_key &&
    upkeep.idempotency_key.includes(seasonId) &&
    upkeep.idempotency_key.includes(teamId),
    `Idempotency-nøgle skal indeholde sæson og hold: ${upkeep.idempotency_key}`
  );
});

test("processTeamSeasonPayroll skips upkeep entirely for a team with unknown division (#1441)", async () => {
  const seasonId = "season-upkeep-skip";
  const teamId = "team-upkeep-unknown";

  const financeRows = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    return Promise.resolve({ data: { balance: 500_000 }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return {
                    eq(_col2, _val2) {
                      return Promise.resolve({ count: 0, error: null });
                    },
                  };
                },
              };
            }
            return {
              in(_col, _vals) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in upkeep-skip test: ${table}`);
    },
  };

  const team = {
    id: teamId,
    name: "Unknown Division FC",
    division: 9, // ikke i UPKEEP_BY_DIVISION
    balance: 500_000,
    riders: [],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
  });

  const upkeepRows = financeRows.filter(r => r.type === "upkeep");
  assert.equal(upkeepRows.length, 0, "Hold med ukendt division: ingen upkeep-transaktion");
});

// ─── B3: Eskalerende transfer-fryse + tvunget salg (#1441/#97) ────────────────

test("processTeamSeasonPayroll: breach-streak >= 2 fryser transfer + tvinger salg (D3, debt over ceiling) (#1441/#97)", async () => {
  const seasonId = "season-breach-1";
  const teamId = "team-breach-d3";
  const riderId = "rider-expensive-1";

  const financeRows = [];
  const teamUpdates = [];
  const riderUpdates = [];

  // Fake supabase der tracker teams.update + riders.update + finance via rpc
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    return Promise.resolve({ data: { balance: 999_999 }, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(col, val) {
                assert.equal(col, "id");
                teamUpdates.push({ id: val, payload: { ...payload } });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return {
                    eq(_col2, _val2) {
                      return Promise.resolve({ count: 0, error: null });
                    },
                  };
                },
              };
            }
            return {
              in(_col, _vals) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          update(payload) {
            return {
              eq(col, val) {
                assert.equal(col, "id");
                riderUpdates.push({ id: val, payload: { ...payload } });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "transfer_listings") {
        return {
          update(_payload) {
            return {
              in(_col, _vals) {
                return {
                  in(_col2, _vals2) {
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in breach test: ${table}`);
    },
  };

  // D3 team: debt_breach_streak = 1 (allerede ét brud), over ceiling (600k)
  const team = {
    id: teamId,
    name: "Broke Riders D3",
    division: 3,
    balance: 0,
    debt_breach_streak: 1,   // B1-kolonner
    transfer_frozen: false,
    riders: [
      {
        id: riderId,
        firstname: "Rico",
        lastname: "Vendido",
        market_value: 500_000,
        salary: 0,
        ai_team_id: "ai-team-99",
        team_id: teamId,
      },
    ],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async (_teamId, _client) => 700_000, // over D3 ceiling (600k)
  });

  // (a) teams.update skal kalde med transfer_frozen:true + debt_breach_streak:2
  const breachUpdate = teamUpdates.find(u =>
    u.id === teamId &&
    "debt_breach_streak" in u.payload
  );
  assert.ok(breachUpdate, "teams.update med breach-payload skal være kaldt");
  assert.equal(breachUpdate.payload.debt_breach_streak, 2, "breach-streak skal incremente til 2");
  assert.equal(breachUpdate.payload.transfer_frozen, true, "transfer_frozen skal sættes til true");

  // (b) tvunget salg: finance-row af typen "forced_debt_sale" skal eksistere
  const forcedSaleRows = financeRows.filter(r => r.type === "forced_debt_sale");
  assert.equal(forcedSaleRows.length, 1, "Præcis én forced_debt_sale finance-row skal oprettes");
  assert.equal(forcedSaleRows[0].amount, 500_000, "Kredit = market_value (500k)");
  assert.equal(forcedSaleRows[0].team_id, teamId);

  // (c) rider-disposition: riders.update til ai_team_id || null
  const riderDisposed = riderUpdates.find(u => u.id === riderId);
  assert.ok(riderDisposed, "riders.update skal kalde for den solgte rytter");
  assert.equal(riderDisposed.payload.team_id, "ai-team-99", "Rytter skal sættes til ai_team_id");
  assert.equal(riderDisposed.payload.pending_team_id, null);
});

test("processTeamSeasonPayroll: team under ceiling nulstiller breach-streak + fjerner freeze (#1441/#97)", async () => {
  const seasonId = "season-breach-2";
  const teamId = "team-recovered";

  const financeRows = [];
  const teamUpdates = [];

  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    return Promise.resolve({ data: { balance: 999_999 }, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(col, val) {
                assert.equal(col, "id");
                teamUpdates.push({ id: val, payload: { ...payload } });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return {
                    eq(_col2, _val2) {
                      return Promise.resolve({ count: 0, error: null });
                    },
                  };
                },
              };
            }
            return {
              in(_col, _vals) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in recovery test: ${table}`);
    },
  };

  // D3 team med breach_streak = 1 men NU under ceiling (100k < 600k)
  const team = {
    id: teamId,
    name: "Recovered Team D3",
    division: 3,
    balance: 500_000,
    debt_breach_streak: 1,
    transfer_frozen: true,
    riders: [],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async (_teamId, _client) => 100_000, // UNDER D3 ceiling (600k)
  });

  // teams.update med debt_breach_streak: 0 + transfer_frozen: false
  const resetUpdate = teamUpdates.find(u =>
    u.id === teamId &&
    "debt_breach_streak" in u.payload
  );
  assert.ok(resetUpdate, "teams.update med reset-payload skal være kaldt");
  assert.equal(resetUpdate.payload.debt_breach_streak, 0, "breach-streak skal nulstilles til 0");
  assert.equal(resetUpdate.payload.transfer_frozen, false, "transfer_frozen skal sættes til false");

  // Ingen forced_debt_sale
  const forcedSaleRows = financeRows.filter(r => r.type === "forced_debt_sale");
  assert.equal(forcedSaleRows.length, 0, "Ingen forced_debt_sale ved recovery");
});

// ─── #1608 form-frys: tier 4 (DIVISION_BONUSES[4] + [1,2,3]→MIN..MAX-loop) ────────

test("#1608 · payDivisionBonuses krediterer tier-4-hold (DIVISION_BONUSES[4] findes)", async () => {
  // Uden DIVISION_BONUSES[4] ville div-4-standings tavst falde igennem
  // (undefined → continue) — samme tavse hul som det hardcodede [1,2,3]-loop.
  const balances = { "team-d4-r1": 0, "team-d4-r4": 0 };
  const financeRows = [];
  const supabase = {
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
    { team_id: "team-d4-r1", division: 4, rank_in_division: 1, team: { is_ai: false } },
    { team_id: "team-d4-r4", division: 4, rank_in_division: 4, team: { is_ai: false } }, // kun top 3 betales
  ];

  await payDivisionBonuses(standings, "season-1", supabase);

  assert.equal(balances["team-d4-r1"], 50_000, "D4 rank 1 → 50k (DIVISION_BONUSES[4][0])");
  assert.equal(balances["team-d4-r4"], 0, "D4 betaler kun top 3 — rank 4 springes over");
});

test("#1608 · processDivisionEnd promoverer tier-4-hold (MAX_DIVISION=4 → div 4 er promotable, ikke bunden ved 3)", async () => {
  // Beviser at MAX_DIVISION=4-skiftet gør tier 4 til den behandlede bund: et
  // div-4-hold i top-2 ved en gate-cleared sæson rykker OP til div 3, og INGEN
  // div-4-hold relegeres (division < MAX_DIVISION er falsk for 4). Før form-frysen
  // (MAX_DIVISION=3 + hardcodet [1,2,3]-loop) ville div 4 aldrig blive behandlet.
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(buildPoolStandings({ division: 4, poolId: 8 }), 4, "s", 1, {
    supabase, now: new Date("2026-06-23T23:00:00Z"),
  });

  // Top 2 promoveres til div 3 (forælder-pulje); ingen relegering (4 = behandlet bund).
  const promotions = supabase.updates.filter(u => u.payload.division === 3);
  const relegations = supabase.updates.filter(u => u.payload.division === 5);
  assert.equal(promotions.length, 2, "div-4 top 2 rykker op til div 3");
  assert.ok(promotions.every(u => u.payload.league_division_id === 4), "forælder = Div3 pulje (id 4)");
  assert.equal(relegations.length, 0, "ingen relegering fra bund-tier (division 5 findes ikke)");
});

// ─── #1678: Sæson-1-opstarts-gates (sponsor-skip + upkeep-deferral) ──────────────

function makeSeason1Team(overrides = {}) {
  return {
    id: "team-s1",
    name: "Season 1 CF",
    is_ai: false,
    is_frozen: false,
    division: 4, // relaunch-population starter i bunden (MAX_DIVISION)
    balance: INITIAL_BALANCE,
    sponsor_income: 315_000,
    board_profiles: [
      {
        id: "board-s1",
        team_id: "team-s1",
        plan_type: "baseline",
        negotiation_status: "completed",
        budget_modifier: 1.0,
        is_baseline: true,
      },
    ],
    ...overrides,
  };
}

test("#1678: processSeasonStart SPRINGER sæson-1-sponsor over for hold med uberørt startkapital", async () => {
  const seasonId = "season-1";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 1 },
    team: makeSeason1Team({ balance: INITIAL_BALANCE }),
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find((r) => r.type === "sponsor");
  assert.equal(
    sponsorRow,
    undefined,
    "Ingen sponsor-finance-row må skrives når holdet har uberørt startkapital i sæson 1"
  );
  const result = outcome.sponsor.find((r) => r.team === "Season 1 CF");
  assert.ok(result, "Holdet skal stadig optræde i sponsor-resultatet");
  assert.equal(result.sponsor, 0, "Rapporteret sponsor skal være 0 (sprunget over)");
  assert.equal(result.sponsor_skipped, true, "Resultatet skal markere skip eksplicit");
});

test("#1678: processSeasonStart BETALER sæson-1-sponsor hvis holdet allerede har rørt sin startkapital", async () => {
  const seasonId = "season-1";
  // Holdet har brugt/tjent penge → balance != INITIAL_BALANCE → ikke længere
  // "lige fået startkapital" → sponsor udbetales som normalt.
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 1 },
    team: makeSeason1Team({ balance: INITIAL_BALANCE - 50_000 }),
  });

  await processSeasonStart(seasonId, {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find((r) => r.type === "sponsor");
  assert.ok(sponsorRow, "Sponsor skal udbetales når startkapitalen er rørt");
  assert.ok(sponsorRow.amount > 0, "Sponsor-beløb skal være positivt");
});

test("#1678: processSeasonStart udbetaler sponsor normalt i sæson 2 (skip gælder kun sæson 1)", async () => {
  const seasonId = "season-2";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [],
    team: makeSeason1Team({ balance: INITIAL_BALANCE, division: 3, sponsor_income: 340_000 }),
  });

  await processSeasonStart(seasonId, {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find((r) => r.type === "sponsor");
  assert.ok(sponsorRow, "Sæson 2 skal stadig udbetale sponsor uanset uberørt balance");
  assert.ok(sponsorRow.amount > 0, "Sæson-2-sponsor skal være positiv");
});

test("#1678: processTeamSeasonPayroll SPRINGER upkeep over i sæson 1 (før første løb)", async () => {
  const seasonId = "season-1";
  const teamId = "team-upkeep-s1";

  const financeRows = [];
  const supabase = makeUpkeepSupabase(financeRows);

  const team = {
    id: teamId,
    name: "S1 Upkeep FC",
    division: 2, // tving D2 (upkeep 140k) for at bevise at det skippes i sæson 1
    balance: 999_999,
    riders: [],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    seasonNumber: 1,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0,
  });

  const upkeepRows = financeRows.filter((r) => r.type === "upkeep");
  assert.equal(upkeepRows.length, 0, "Ingen upkeep-transaktion i sæson 1 (deferred til racing)");
});

test("#1678: processTeamSeasonPayroll BEHOLDER upkeep i sæson 2 (steady-state gold sink)", async () => {
  const seasonId = "season-2";
  const teamId = "team-upkeep-s2";

  const financeRows = [];
  const supabase = makeUpkeepSupabase(financeRows);

  const team = {
    id: teamId,
    name: "S2 Upkeep FC",
    division: 2,
    balance: 999_999,
    riders: [],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    seasonNumber: 2,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0,
  });

  const upkeepRows = financeRows.filter((r) => r.type === "upkeep");
  assert.equal(upkeepRows.length, 1, "Sæson 2 skal stadig debitere upkeep (scorecard-steady-state)");
  assert.equal(upkeepRows[0].amount, -UPKEEP_BY_DIVISION[2], "Upkeep-beløb skal matche D2-konstanten");
});

// Genbruger upkeep-test-fakens form (teams.balance-single + riders count/in).
function makeUpkeepSupabase(financeRows) {
  return {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select() {
            return { eq() { return { single() { return Promise.resolve({ data: { balance: 999_999 }, error: null }); } }; } };
          },
          update() {
            return { eq() { return Promise.resolve({ error: null }); } };
          },
        };
      }
      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return { eq() { return { eq() { return Promise.resolve({ count: 0, error: null }); } }; } };
            }
            return { in() { return Promise.resolve({ data: [], error: null }); } };
          },
        };
      }
      throw new Error(`Unexpected table in #1678 upkeep faken: ${table}`);
    },
  };
}

// ─── #1721 · Bestyrelsen er ÅBEN + FULDT FUNKTIONSDYGTIG i sæson 1 ────────────
// Ejer-beslutning 2026-06-22: sæson 1 er IKKE en observations-sæson. En forhandlet
// (ikke-baseline) plan i sæson 1 skal evalueres efter løb, satisfaction skal bevæge
// sig, og den afledte budget_modifier skal IKKE være låst til 1.0 — den får fuld
// økonomisk effekt på næste sæsons sponsor. Baselines (observations-rester der lever
// transient før relaunch-oplåsningen) skal stadig springes over, så sæson-0/pre-unlock
// adfærd ikke brydes.

// Fyld en realistisk division op med manager-standings (is_ai=false), så
// loadGoalContextForBoard.divisionManagerCount > 1 og
// computeResultsCompetitivenessFloor afspejler ægte forhold — ikke en kunstig
// 1-holds-pulje hvor rank-floor er deaktiveret. Ranks starter ved 4 (over div-3-
// bonus-grænsen på 3 pladser), så payDivisionBonuses ikke prøver at kreditere dem
// (kun rank 1-3 får bonus → kun testholdet rammer getTeamById i single-team-mocken).
function fillDivisionStandings({ division = 3, count = 19 } = {}) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const teamId = `fill-${division}-${i}`;
    rows.push({
      season_id: "season-1",
      team_id: teamId,
      division,
      total_points: 80 - i,
      rank_in_division: i + 4, // rank 1-3 reserveret (bonus-pladser), testhold tager rank 1
      stage_wins: 0,
      gc_wins: 0,
      team: { id: teamId, is_ai: false },
    });
  }
  return rows;
}

// Hjælper: sæson-1-supabase med en RIGTIG plan (ikke baseline).
function makeSeason1RealPlanSupabase({ standing, satisfaction = 50, planType = "5yr" } = {}) {
  return createSeasonEndSupabase({
    season: { id: "season-1", number: 1, status: "active" },
    team: {
      id: "team-s1",
      name: "Season1 Active CF",
      is_ai: false,
      user_id: "user-s1",
      balance: 800000,
      sponsor_income: 340000,
      season_1_identity_basis: { primary_specialization: "gc" },
      team_dna_key: "skandinavisk_udvikling",
      riders: [],
    },
    board: {
      id: "board-s1",
      team_id: "team-s1",
      plan_type: planType,
      focus: "balanced",
      satisfaction,
      budget_modifier: 1.0,
      // Resultat- + ranking-mål så performance afgør satisfaction-bevægelsen.
      current_goals: [
        { category: "results", type: "min_stage_wins", target: 1, weight: 1 },
        { category: "ranking", type: "min_division_rank", target: 5, weight: 1 },
      ],
      is_baseline: false,
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      plan_start_sponsor_income: 340000,
      plan_start_season_number: 1,
      plan_end_season_number: getPlanDurationSafe(planType),
    },
    standings: [
      standing,
      ...fillDivisionStandings({ division: standing.division })
        // Undgå rang-kollision med testholdet (samme rank_in_division).
        .filter((row) => row.rank_in_division !== standing.rank_in_division),
    ],
  });
}

function getPlanDurationSafe(planType) {
  return { "1yr": 1, "3yr": 3, "5yr": 5 }[planType] || 1;
}

test("#1721: sæson-1 RIGTIG plan evalueres efter løb — satisfaction stiger + modifier > 1.0 ved stærk præstation", async () => {
  const supabase = makeSeason1RealPlanSupabase({
    standing: {
      season_id: "season-1",
      team_id: "team-s1",
      division: 3,
      total_points: 300,
      rank_in_division: 1,
      stage_wins: 3,
      gc_wins: 1,
      team: { id: "team-s1", is_ai: false },
    },
  });

  await processSeasonEnd("season-1", {
    supabase,
    ...baseDeps({
      // Sæson-1-slut trigger sekventiel onboarding; stub så den ikke rører rigtige planer.
      startSequentialNegotiation: async () => ({ baseline_rows_deleted: 0, window_state: "pending_5yr" }),
    }),
  });

  // Bestyrelsen MÅ ikke være i observations-tilstand: et snapshot skal skrives.
  assert.equal(
    supabase.state.inserts.board_plan_snapshots.length,
    1,
    "Sæson-1-evaluering skal skrive et board_plan_snapshot (ikke springes over som observation)"
  );
  // Satisfaction skal have bevæget sig OP fra 50 (stærk præstation).
  assert.ok(
    supabase.state.board.satisfaction > 50,
    `Stærk sæson-1-præstation skal hæve satisfaction over 50 (fik ${supabase.state.board.satisfaction})`
  );
  // FULD økonomisk effekt: modifier må IKKE være låst til 1.0.
  assert.ok(
    supabase.state.board.budget_modifier > 1.0,
    `Sæson-1-tilfredshed skal give modifier > 1.0 ved stærk præstation (fik ${supabase.state.board.budget_modifier})`
  );
});

test("#1721: sæson-1 RIGTIG plan — svag præstation sænker satisfaction + modifier < 1.0 (fuld økonomisk effekt begge veje)", async () => {
  const supabase = makeSeason1RealPlanSupabase({
    satisfaction: 30,
    standing: {
      season_id: "season-1",
      team_id: "team-s1",
      division: 3,
      total_points: 5,
      rank_in_division: 19,
      stage_wins: 0,
      gc_wins: 0,
      team: { id: "team-s1", is_ai: false },
    },
  });

  await processSeasonEnd("season-1", {
    supabase,
    ...baseDeps({
      startSequentialNegotiation: async () => ({ baseline_rows_deleted: 0, window_state: "pending_5yr" }),
    }),
  });

  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1, "Svag sæson-1-plan skal stadig evalueres");
  assert.ok(
    supabase.state.board.satisfaction < 30,
    `Svag sæson-1-præstation skal sænke satisfaction under 30 (fik ${supabase.state.board.satisfaction})`
  );
  assert.ok(
    supabase.state.board.budget_modifier < 1.0,
    `Lav sæson-1-tilfredshed skal give modifier < 1.0 — ikke låst (fik ${supabase.state.board.budget_modifier})`
  );
});

test("#1721: sæson-1 BASELINE springes stadig over (pre-unlock observations-rest brydes ikke)", async () => {
  const supabase = createSeasonEndSupabase({
    season: { id: "season-1", number: 1, status: "active" },
    team: {
      id: "team-bl",
      name: "Baseline Holdover",
      is_ai: false,
      user_id: "user-bl",
      balance: 800000,
      sponsor_income: 340000,
      riders: [],
    },
    board: {
      id: "board-bl",
      team_id: "team-bl",
      plan_type: "baseline",
      focus: "balanced",
      satisfaction: 50,
      budget_modifier: 1.0,
      current_goals: [],
      is_baseline: true,
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      plan_start_sponsor_income: 340000,
    },
    standings: [
      {
        season_id: "season-1",
        team_id: "team-bl",
        division: 3,
        total_points: 300,
        rank_in_division: 1,
        stage_wins: 3,
        gc_wins: 1,
        team: { id: "team-bl", is_ai: false },
      },
    ],
  });

  await processSeasonEnd("season-1", {
    supabase,
    ...baseDeps({
      startSequentialNegotiation: async () => ({ baseline_rows_deleted: 1, window_state: "pending_5yr" }),
    }),
  });

  // Baseline = observation: intet snapshot, modifier + satisfaction uændret.
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 0, "Baseline må ikke evalueres");
  assert.equal(supabase.state.board.budget_modifier, 1.0, "Baseline-modifier skal forblive 1.0");
  assert.equal(supabase.state.board.satisfaction, 50, "Baseline-satisfaction skal forblive uændret");
});

test("#1721: sæson-1-afledt modifier får FULD effekt på sæson-2-sponsor (ikke clampet til 1.0)", async () => {
  // En plan forhandlet i sæson 1 endte sæson 1 med høj tilfredshed → modifier 1.20
  // (completed). Ved sæson-2-start skal sponsoren skaleres med 1.20, ikke 1.0.
  const seasonId = "season-2";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [],
    team: {
      id: "team-mod",
      name: "Modifier Carryover CF",
      is_ai: false,
      is_frozen: false,
      division: 3,
      // balance != INITIAL_BALANCE → #1678-skip gælder ikke, sponsor udbetales.
      balance: 500000,
      sponsor_income: 340000,
      board_profiles: [
        {
          id: "board-mod",
          team_id: "team-mod",
          plan_type: "5yr",
          negotiation_status: "completed",
          budget_modifier: 1.20,
          is_baseline: false,
        },
      ],
    },
  });

  await processSeasonStart(seasonId, {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find((r) => r.type === "sponsor");
  assert.ok(sponsorRow, "Sponsor skal udbetales i sæson 2");
  // Modifier 1.20 vs 1.0: beviset er at payouten ligger klart over den umodificerede
  // gross (intro-sponsor for D3 er division-skaleret). Vi asserter at modifieren reelt
  // hævede payouten — at den IKKE blev låst til 1.0.
  const modifierApplied = sponsorRow.amount;
  assert.ok(
    modifierApplied > 340000,
    `Sæson-2-sponsor skal afspejle modifier > 1.0 fra sæson-1-plan (fik ${modifierApplied}, base sponsor_income 340000)`
  );
});
