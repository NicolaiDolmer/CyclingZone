import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  buildSeasonEndPreviewRows,
  loadHumanSeasonEndTeams,
  payDivisionBonuses,
  processDivisionEnd,
  processSeasonEnd,
  processSeasonStart,
  chargeFacilityCosts,
  defaultRunSeasonPayroll,
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
  PARACHUTE_FACTOR,
  SPONSOR_INCOME_BY_DIVISION,
} = await import("./economyConstants.js");
const { ACADEMY } = await import("./academyFlag.js");
const { getTotalDebt: realGetTotalDebt, repayLoansFromForcedSale: realRepayLoansFromForcedSale } =
  await import("./loanEngine.js");
const { SUPABASE_PAGE_SIZE } = await import("./supabasePagination.js");

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
            if (columns === "team_id, division, rank_in_division, total_points") {
              // #2951 · loadSponsorStandingsContextForSeason — pagineret via
              // fetchAllRows (.order("id").range()), ingen sekundær sortering.
              return {
                eq(column, value) {
                  assert.equal(column, "season_id");
                  return {
                    order(orderColumn, orderOptions) {
                      assert.equal(orderColumn, "id");
                      assert.deepEqual(orderOptions, { ascending: true });
                      return {
                        range(from, to) {
                          const data = clone(state.standings).filter(row => row.season_id === value);
                          return Promise.resolve({
                            data: data.slice(from, to + 1),
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            }

            assert.equal(columns, "*, team:team_id(*)");
            return {
              eq(column, value) {
                assert.equal(column, "season_id");
                assert.equal(value, state.season.id);
                return {
                  // #2951 · processSeasonEnd/repairSeasonEndFinanceAndBoard pagineres nu
                  // via fetchAllRows: total_points DESC + .order("id") som stabilt
                  // tiebreak, derefter .range() pr. side.
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "total_points");
                    assert.deepEqual(orderOptions, { ascending: false });
                    return {
                      order(secondOrderColumn, secondOrderOptions) {
                        assert.equal(secondOrderColumn, "id");
                        assert.deepEqual(secondOrderOptions, { ascending: true });
                        return {
                          range(from, to) {
                            return Promise.resolve({
                              data: clone(state.standings).slice(from, to + 1),
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
                    // #2951 · loadHumanSeasonEndTeams pagineres nu via fetchAllRows
                    // (.order("id").range()); andre kaldere (processSeasonStart,
                    // rebalanceDivisions) awaiter kæden direkte uden .order() og
                    // rammer derfor stadig teamsResult-thenable'en ovenfor uændret.
                    order(orderColumn, orderOptions) {
                      assert.equal(orderColumn, "id");
                      assert.deepEqual(orderOptions, { ascending: true });
                      return {
                        range(from, to) {
                          return Promise.resolve({
                            data: teamsResult.data.slice(from, to + 1),
                            error: teamsResult.error,
                          });
                        },
                      };
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
                // #2907: loadHumanSeasonEndTeams paginerer nu riders (fetchAllRows →
                // .order("id").range()), samme mønster som race_results i updateStandings.
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "id");
                    assert.deepEqual(orderOptions, { ascending: true });
                    return {
                      range(from, to) {
                        if (ridersError) {
                          return Promise.resolve({
                            data: null,
                            error: ridersError,
                          });
                        }
                        return Promise.resolve({
                          data: clone(state.riders).slice(from, to + 1),
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

      if (table === "board_plan_snapshots") {
        return {
          select(columns, options) {
            if (columns === "team_id, board_id") {
              return {
                eq(column, value) {
                  assert.equal(column, "season_id");
                  assert.equal(value, state.season.id);
                  const data = clone(state.inserts.board_plan_snapshots)
                    .filter(row => row.season_id === value)
                    .map(row => ({ team_id: row.team_id, board_id: row.board_id }));
                  // #2951 · repairSeasonEndFinanceAndBoard's dedup-tjek pagineres nu
                  // via fetchAllRows (.order("id").range()).
                  return {
                    order(orderColumn, orderOptions) {
                      assert.equal(orderColumn, "id");
                      assert.deepEqual(orderOptions, { ascending: true });
                      return {
                        range(from, to) {
                          return Promise.resolve({ data: data.slice(from, to + 1), error: null });
                        },
                      };
                    },
                  };
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
                // #2951 · loadHumanSeasonEndTeams pagineres nu via fetchAllRows
                // (.order("id").range()).
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "id");
                    assert.deepEqual(orderOptions, { ascending: true });
                    return {
                      range(from, to) {
                        return Promise.resolve({
                          data: [clone(state.board)].slice(from, to + 1),
                          error: null,
                        });
                      },
                    };
                  },
                };
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
            if (columns === "team_id" || columns === "team_id, reason_code") {
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
                      // #2951 · payDivisionBonuses' dedup-tjek pagineres nu via
                      // fetchAllRows (.order("id").range()).
                      return {
                        order(orderColumn, orderOptions) {
                          assert.equal(orderColumn, "id");
                          assert.deepEqual(orderOptions, { ascending: true });
                          return {
                            range(from, to) {
                              return Promise.resolve({ data: data.slice(from, to + 1), error: null });
                            },
                          };
                        },
                      };
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

            // #3494 · loadGoalContextForBoard sponsor_growth-query (kontrakt-base +
            // løbsdags-indtægt). Empty data er neutralt for disse tests — de
            // tester ikke sponsor_growth, og tom respons giver blot awaiting_data.
            if (columns === "amount, season_id") {
              return {
                eq(_col1, _val1) {
                  return {
                    in(col2, _values2) {
                      assert.equal(col2, "reason_code");
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

function createStandingsSupabase({ teams, races, results, liveTeams = null, penalties = [] }) {
  const state = {
    teams: clone(teams),
    races: clone(races),
    results: clone(results),
    // #2389: liveTeams simulerer et hold slettet UNDER recalc — live-re-tjekket
    // (select("id") før upsert) ser denne liste, mens den indledende teams-læsning
    // ser den fulde. Default = samme liste (intet slettet).
    liveTeams: clone(liveTeams ?? teams),
    penalties: clone(penalties),
    upserts: [],
  };

  return {
    state,
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            if (columns === "id") {
              // #2389: live-re-tjek før upsert (fetchAllRows → .order().range()).
              return {
                order() {
                  return {
                    range(from, to) {
                      const data = clone(state.liveTeams).map(team => ({ id: team.id })).slice(from, to + 1);
                      return Promise.resolve({ data, error: null });
                    },
                  };
                },
              };
            }
            assert.equal(columns, "id, division, league_division_id");
            // #2962 · updateStandings' initielle teams-load pagineres nu via
            // fetchAllRows (.order("id").range()) — samme klasse som
            // race_results/season_standings-penalty-selectet nedenfor.
            return {
              order(orderColumn, orderOptions) {
                assert.equal(orderColumn, "id");
                assert.deepEqual(orderOptions, { ascending: true });
                return {
                  range(from, to) {
                    return Promise.resolve({
                      data: clone(state.teams).slice(from, to + 1),
                      error: null,
                    });
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
                    // #2962: pagineres nu via fetchAllRows (.order("id").range()).
                    return {
                      order(orderColumn, orderOptions) {
                        assert.equal(orderColumn, "id");
                        assert.deepEqual(orderOptions, { ascending: true });
                        return {
                          range(from, to) {
                            return Promise.resolve({
                              data: clone(state.penalties).slice(from, to + 1),
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
                const builder = {
                  order() { return builder; },
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
                return builder;
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
                    const builder = {
                      order() { return builder; },
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
                    return builder;
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
            const builder = {
              order() { return builder; },
              range(from, to) {
                return Promise.resolve({
                  data: clone(state.riders).slice(from, to + 1),
                  error: null,
                });
              },
            };
            return builder;
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

test("#2907: loadHumanSeasonEndTeams paginerer riders forbi 1000-row-loftet", async () => {
  // Reproducerer prod-fundet 25/7: 2.652 ryttere på 156 menneskehold — et naivt
  // .select().in() uden .range() returnerer stille kun første side (SUPABASE_PAGE_SIZE
  // rækker), så et hold hvis ryttere falder uden for side 1 fremstår med riders=[] →
  // totalSalary=0 → ingen lønpostering, forkert bestyrelsesdom (ikke en fejl, ikke en
  // nulrække — ingenting). team-b herunder ligger UDELUKKENDE i side 2, for at
  // reproducere netop det scenarie.
  const pageSize = SUPABASE_PAGE_SIZE;
  const teamBRiderCount = 500;
  const allRiders = [];
  for (let i = 1; i <= pageSize; i += 1) {
    allRiders.push({ id: `r${i}`, team_id: "team-a", salary: 100 });
  }
  for (let i = pageSize + 1; i <= pageSize + teamBRiderCount; i += 1) {
    allRiders.push({ id: `r${i}`, team_id: "team-b", salary: 100 });
  }

  // #2951 · teams/board_profiles var deferred i #2907-PR-bodyen ("langt under
  // loftet i dag, samme langsommere driver") — nu også pagineret. rangeCallCounts
  // tæller .range()-kald pr. tabel, så testen kan bevise at ALLE tre queries
  // reelt går gennem fetchAllRows, ikke kun riders.
  const rangeCallCounts = { teams: 0, riders: 0, board_profiles: 0 };
  const supabase = {
    from(table) {
      if (table === "teams") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          order(orderColumn, orderOptions) {
                            assert.equal(orderColumn, "id");
                            assert.deepEqual(orderOptions, { ascending: true });
                            return {
                              range(from, to) {
                                rangeCallCounts.teams += 1;
                                const allTeams = [
                                  { id: "team-a", is_ai: false, is_bank: false, is_frozen: false },
                                  { id: "team-b", is_ai: false, is_bank: false, is_frozen: false },
                                ];
                                return Promise.resolve({
                                  data: allTeams.slice(from, to + 1),
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
              },
            };
          },
        };
      }
      if (table === "riders") {
        return {
          select() {
            return {
              in(column, values) {
                assert.equal(column, "team_id");
                assert.deepEqual(values, ["team-a", "team-b"]);
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "id");
                    assert.deepEqual(orderOptions, { ascending: true });
                    return {
                      range(from, to) {
                        rangeCallCounts.riders += 1;
                        return Promise.resolve({
                          data: allRiders.slice(from, to + 1),
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
      if (table === "board_profiles") {
        return {
          select() {
            return {
              in() {
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "id");
                    assert.deepEqual(orderOptions, { ascending: true });
                    return {
                      range(from, to) {
                        rangeCallCounts.board_profiles += 1;
                        return Promise.resolve({ data: [].slice(from, to + 1), error: null });
                      },
                    };
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

  const teams = await loadHumanSeasonEndTeams(supabase);

  assert.equal(rangeCallCounts.riders >= 2, true, "skal hente mindst 2 sider (1500 ryttere > page-size)");
  assert.ok(rangeCallCounts.teams >= 1, "teams skal hentes via fetchAllRows (range())");
  assert.ok(rangeCallCounts.board_profiles >= 1, "board_profiles skal hentes via fetchAllRows (range())");
  const teamA = teams.find(t => t.id === "team-a");
  const teamB = teams.find(t => t.id === "team-b");
  assert.equal(teamA.riders.length, pageSize, "team-a (side 1) skal have alle sine ryttere");
  assert.equal(
    teamB.riders.length,
    teamBRiderCount,
    "team-b (UDELUKKENDE side 2) må IKKE fremstå tom — dette var #2907-bugget (0 løn, forkert bestyrelsesdom)"
  );
  assert.equal(
    teams.reduce((sum, t) => sum + t.riders.length, 0),
    pageSize + teamBRiderCount,
    "alle ryttere på tværs af begge sider skal være med i det samlede resultat"
  );
});

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
  assert.equal(supabase.state.board.satisfaction, 78);
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

// ── #3514 fase 1-rest: skyggemodellens sæson-slut-sync ──────────────────────

test("#3514: processSeasonEnd kalder mandat-motorens sæson-slut-sync ÉN gang pr. hold, EFTER boards-loopet", async () => {
  const supabase = makePlanCompleteSupabase();
  let callArgs = null;
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      applyMandateSeasonEndSync: async (sb, args) => { callArgs = args; return { confidence: 70 }; },
    }),
  });

  assert.ok(callArgs, "applyMandateSeasonEndSync skal kaldes");
  assert.equal(callArgs.teamId, "team-1");
  assert.equal(callArgs.seasonId, "season-5");
  assert.equal(callArgs.seasonNumber, 5);
  assert.ok(callArgs.mandateEvaluation, "1yr-boardets FULDE evaluering skal genbruges (spec §3.1)");
  assert.equal(typeof callArgs.mandateEvaluation.feedback?.satisfaction_delta, "number");
  assert.deepEqual(callArgs.milestoneContexts, [], "intet 3yr/5yr-board i denne fixture → ingen milepæls-kontekster");
});

test("#3514: en fejlende sæson-slut-sync vælter ALDRIG den rigtige sæson-slut-evaluering", async () => {
  const supabase = makePlanCompleteSupabase();
  await processSeasonEnd("season-5", {
    supabase,
    ...baseDeps({
      applyMandateSeasonEndSync: async () => { throw new Error("boom"); },
    }),
  });

  // board_profiles-opdateringen (den spillervendte sti) er sket uændret,
  // selvom skygge-syncet fejlede.
  assert.equal(supabase.state.board.negotiation_status, "pending");
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
  assert.equal(preview.upkeep, 20000);
  // v3.78/A3 + #1441 A6: balance_after følger processSeasonStart-rækkefølgen inkl. upkeep
  // (D3 upkeep: 30000 → 40000 (A6) → 20000 (ejer 23/8, S3-halvering)).
  // balance + sponsor − renter − løn − upkeep = 500 + 220 − 10 − 100 − 20000 = −19390
  assert.equal(preview.balance_after, -19390);
  assert.equal(preview.needs_emergency_loan, true);
  assert.equal(preview.emergency_loan_amount, 19390);
  assert.equal(preview.current_board_satisfaction, 50);
  assert.equal(preview.board_satisfaction, 78);
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

  // Weekend-opdateringerne har konvergeret den løbende værdi til 78 (= 50 + 28,
  // #2309 mål-kalibrering: ekspektations-baseline sænket + resultats-gulv hævet).
  // Med gyldigt anker skal previewet stadig lande på 78 — IKKE 78 + 28 = 106(→100).
  const [anchored] = buildSeasonEndPreviewRows(makeArgs({
    satisfaction: 78,
    season_start_satisfaction: 50,
    season_start_anchor_season_id: "season-1",
  }));
  assert.equal(anchored.current_board_satisfaction, 78, "viser den løbende værdi som nuværende");
  assert.equal(anchored.board_satisfaction, 78, "projektion = anker + delta, intet ekstra spring");

  // Anker fra en ANDEN sæson ignoreres → dagens adfærd (current + delta).
  const [stale] = buildSeasonEndPreviewRows(makeArgs({
    satisfaction: 50,
    season_start_satisfaction: 10,
    season_start_anchor_season_id: "season-0",
  }));
  assert.equal(stale.board_satisfaction, 78, "stale anker ændrer intet ift. dagens adfærd");
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

test("#2962: updateStandings paginerer det INDLEDENDE teams-select forbi 1000-row-loftet (legacy-fallback-sti)", async () => {
  // 1500 hold — uden paginering ville kun de første 1000 optræde i upsert'et,
  // og standings for de sidste 500 hold ville aldrig blive skrevet (samme
  // klasse som race_results-testen ovenfor, blot på den INDLEDENDE teams-load).
  const teams = [];
  for (let i = 0; i < 1500; i += 1) teams.push({ id: `team-${i}`, division: 3 });

  const supabase = createStandingsSupabase({ teams, races: [], results: [] });
  const summary = await updateStandings("season-1", null, { supabase });

  assert.equal(summary.rowsUpdated, 1500, "alle 1500 hold, ikke kun de første 1000, skal skrives til standings");
  assert.equal(supabase.state.upserts[0].rows.length, 1500);
});

test("#2962: updateStandings paginerer season_standings-penalty-selectet forbi 1000-row-loftet", async () => {
  // 1500 hold, alle med 0 point — ét hold (team-1499, index 1499) har en
  // eksisterende penalty_points-række, der ligger PÅ SIDE 2 (>1000) af det
  // pagineret penalty-select. Uden paginering ville penaltyen aldrig blive
  // set, og team-1499 ville uretmæssigt beholde rank_in_division=1 (i stedet
  // for sidstepladsen, som penaltyen retmæssigt sender det til).
  const teams = [];
  const penalties = [];
  for (let i = 0; i < 1500; i += 1) {
    teams.push({ id: `team-${i}`, division: 3, league_division_id: 1 });
    penalties.push({ team_id: `team-${i}`, penalty_points: i === 1499 ? 500 : 0 });
  }

  const supabase = createStandingsSupabase({ teams, races: [], results: [], penalties });
  await updateStandings("season-1", null, { supabase });

  const rows = supabase.state.upserts[0].rows;
  const penalized = rows.find(r => r.team_id === "team-1499");
  assert.equal(penalized.rank_in_division, 1500, "penaltyen fra side 2 af det pagineret select skal sende holdet sidst");
});

test("updateStandings filtrerer hold slettet under recalc fra upsert (#2389, Sentry CYCLINGZONE-2F)", async () => {
  // team-b slettes (AI-trim) mellem den indledende teams-læsning og upsert'et —
  // uden filteret ville HELE upsert'et FK-fejle og abortere løbets finalization.
  const supabase = createStandingsSupabase({
    teams: [
      { id: "team-a", division: 1 },
      { id: "team-b", division: 1 },
    ],
    liveTeams: [{ id: "team-a", division: 1 }],
    races: [{ id: "race-1" }],
    results: [
      { race_id: "race-1", team_id: "team-a", result_type: "stage", rank: 1, points_earned: 20, rider: null },
      { race_id: "race-1", team_id: "team-b", result_type: "gc", rank: 1, points_earned: 40, rider: null },
    ],
  });

  const summary = await updateStandings("season-1", "race-1", { supabase });

  assert.equal(summary.rowsUpdated, 1, "kun det levende hold skrives");
  assert.equal(supabase.state.upserts.length, 1);
  assert.deepEqual(supabase.state.upserts[0].rows.map(row => row.team_id), ["team-a"]);
});

test("updateStandings bruger recompute_season_standings-RPC når den findes (#2391)", async () => {
  let rpcArgs = null;
  let fromCalled = false;
  const supabase = {
    rpc(name, params) {
      rpcArgs = { name, params };
      return Promise.resolve({ data: { rows_updated: 42, teams_with_points: 17 }, error: null });
    },
    from() {
      fromCalled = true;
      throw new Error("updateStandings må ikke læse tabeller når RPC'en lykkes");
    },
  };

  const summary = await updateStandings("season-9", "race-x", { supabase });

  assert.deepEqual(rpcArgs, {
    name: "recompute_season_standings",
    params: { p_season_id: "season-9" },
  });
  assert.deepEqual(summary, { rowsUpdated: 42, teamsWithPoints: 17 });
  assert.equal(fromCalled, false, "det set-baserede RPC-kald erstatter Node-aggregeringen helt");
});

test("updateStandings falder tilbage til Node-recompute når RPC'en mangler (PGRST202, #2391)", async () => {
  // Vinduet mellem code-deploy og migration-apply: recompute_season_standings
  // findes endnu ikke → PGRST202. updateStandings skal falde tavst tilbage til
  // den (langsomme men korrekte) Node-sti, IKKE kaste.
  const supabase = createStandingsSupabase({
    teams: [{ id: "team-a", division: 1 }],
    races: [{ id: "race-1" }],
    results: [
      { race_id: "race-1", team_id: "team-a", result_type: "stage", rank: 1, points_earned: 20, rider: null },
    ],
  });
  supabase.rpc = () => Promise.resolve({
    data: null,
    error: { code: "PGRST202", message: "Could not find the function public.recompute_season_standings(p_season_id) in the schema cache" },
  });

  const summary = await updateStandings("season-1", "race-1", { supabase });

  assert.equal(summary.rowsUpdated, 1, "Node-fallback kørte og skrev standings");
  assert.equal(supabase.state.upserts.length, 1);
  assert.equal(supabase.state.upserts[0].rows[0].total_points, 20);
});

test("updateStandings retry'er et statement timeout og lykkes (CYCLINGZONE-3D)", async () => {
  // 24/7: recompute'en sprængte de 8 s statement_timeout under samtidige etape-
  // afviklinger. Fejlen boblede op i simulateStageByIndex EFTER stages_completed var
  // bumpet → etapens runs/moments/incidents + træthed blev aldrig skrevet (verificeret:
  // Tour des Fjords etape 4 har 117 resultater men 0 runs). Recompute'en er en fuld
  // re-derivation og dermed idempotent, så et retry er sikkert.
  let calls = 0;
  const supabase = {
    rpc(_name, _params) {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          data: null,
          error: { code: "57014", message: "canceling statement due to statement timeout" },
        });
      }
      return Promise.resolve({ data: { rows_updated: 42, teams_with_points: 17 }, error: null });
    },
    from() {
      throw new Error("et transient timeout må ikke sende os ned i den langsomme Node-fallback");
    },
  };

  const summary = await updateStandings("season-9", "race-x", { supabase });

  assert.equal(calls, 2, "første kald timeout'ede, andet lykkedes");
  assert.deepEqual(summary, { rowsUpdated: 42, teamsWithPoints: 17 });
});

test("updateStandings kaster ved en ÆGTE RPC-fejl (ikke missing-function) (#2391)", async () => {
  // En brudt RPC (fx en constraint-violation) må ALDRIG maskeres tavst af den
  // langsomme fallback — kun missing-function (PGRST202) udløser fallback.
  const supabase = {
    rpc: () => Promise.resolve({ data: null, error: { code: "P0001", message: "boom" } }),
    from() {
      throw new Error("må ikke falde tilbage til Node-stien ved en ægte RPC-fejl");
    },
  };

  await assert.rejects(() => updateStandings("season-1", null, { supabase }), /boom/);
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
                    // #2951 · payDivisionBonuses' dedup-tjek pagineres nu via
                    // fetchAllRows (.order("id").range()).
                    return {
                      order(orderColumn, orderOptions) {
                        assert.equal(orderColumn, "id");
                        assert.deepEqual(orderOptions, { ascending: true });
                        return {
                          range(from, to) {
                            return Promise.resolve({ data: data.slice(from, to + 1), error: null });
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

// #1688(a) · regressions-dækning for sæson-gaten: seasonNumber < FIRST_PROMOTION_RELEGATION_SEASON
// skal stadig sprunges helt over — INGEN pulje-mutationer, uanset hvor mange puljer/tiers
// pyramiden har. Gaten er i dag sat til 1 (aktiveret fra sæson 1, #1152/2026-06-23), så denne
// test bruger seasonNumber=0 for at holde skip-branchen levende og verificeret, hvis gaten
// nogensinde hæves igen (fx en fremtidig owner-beslutning om at udskyde til en senere sæson).
test("#1688(a) · seasonNumber < FIRST_PROMOTION_RELEGATION_SEASON springer op/nedrykning helt over (ingen mutationer)", async () => {
  const supabase = createDivisionEndSupabase();
  await processDivisionEnd(
    buildPoolStandings({ division: 3, poolId: 4, count: 24, aiCount: 0 }),
    3,
    "s",
    0, // < FIRST_PROMOTION_RELEGATION_SEASON (=1)
    { supabase, now: new Date("2026-06-23T23:00:00Z") }
  );
  assert.equal(supabase.updates.length, 0, "ingen team-opdateringer når sæson-gaten ikke er nået");
  assert.equal(supabase.notifications.length, 0, "ingen op-/nedrykningsbeskeder når gaten ikke er nået");
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
 * runSeasonPayroll injiceres som no-op stub.
 */
function createSeasonStartSupabase({
  season,
  team,
  // #2962 · forward-guard: eksplicit teams-array (>1000 rækker) for at bevise
  // pagineringen behandler ALLE hold, ikke kun de første 1000. De fleste tests
  // bruger stadig singular `team` (bagudkompatibelt — teams-selectet returnerer
  // så bare det ene hold).
  teams: teamsOverride = null,
  prevSeasonId = null,
  prevStandings = [],
  activeContract = null,
  // #1980 · simulerer DB'ens uniq_finance_idempotency_key/uniq_*_per_team_season:
  // 2. forsøg med samme idempotency_key rammer 23505 og rulles tilbage (opt-in,
  // default false så eksisterende tests' adfærd ikke ændres).
  simulateIdempotency = false,
} = {}) {
  const state = {
    season: clone(season),
    // #2962 · team er valgfri når `teams`-array-overriden bruges (forward-guard).
    team: team ? clone(team) : null,
    activeContract: clone(activeContract),
    financeRows: [],
    usedIdempotencyKeys: new Set(),
    notifications: [],
    notificationInserts: [],
  };
  state.teams = teamsOverride
    ? clone(teamsOverride).map(t => ({ ...t, board_profiles: t.board_profiles || [] }))
    : (state.team ? [state.team] : []);

  // Embed board_profiles direkte på holdet (som processSeasonStart forventer)
  if (state.team) state.team.board_profiles = state.team.board_profiles || [];

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const key = params.p_finance_payload.idempotency_key;
      if (simulateIdempotency && key && state.usedIdempotencyKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      if (simulateIdempotency && key) state.usedIdempotencyKeys.add(key);
      state.financeRows.push({ ...params.p_finance_payload, team_id: params.p_team_id });
      // #2962 · multi-team forward-guard-scenarier har intet singular state.team —
      // slå balancen op i state.teams pr. team_id i stedet (fallback til state.team
      // for de mange eksisterende enkelt-hold-tests).
      const rpcTeam = state.team ?? state.teams.find(t => t.id === params.p_team_id);
      return Promise.resolve({ data: (rpcTeam?.balance ?? 0) + params.p_delta, error: null });
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
                // #2951 · loadSponsorStandingsContextForSeason pagineres nu via
                // fetchAllRows (.order("id").range()).
                return {
                  order(orderColumn, orderOptions) {
                    assert.equal(orderColumn, "id");
                    assert.deepEqual(orderOptions, { ascending: true });
                    return {
                      range(from, to) {
                        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
                      },
                    };
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
            // #3315: notifyTeamOwner's ejer-opslag — .select("user_id").eq("id", teamId).single()
            if (columns === "user_id") {
              let teamId = null;
              return {
                eq(col, val) {
                  assert.equal(col, "id");
                  teamId = val;
                  return this;
                },
                single: () => {
                  const found = state.teams.find(t => t.id === teamId) || state.team;
                  return Promise.resolve({
                    data: found ? { user_id: found.user_id ?? null } : null,
                    error: null,
                  });
                },
              };
            }
            assert.equal(columns, "*, board_profiles(*)");
            // Returnerer en thenable der svarer til .eq("is_ai", false).eq("is_frozen", false)
            const rows = clone(state.teams);
            const result = { data: rows, error: null };
            const chain = Object.assign(Promise.resolve(result), {
              eq(_col, _val) { return chain; },
              // #2962 · processSeasonStart's teams-select pagineres nu via
              // fetchAllRows (.order("id").range()).
              order(orderColumn, orderOptions) {
                assert.equal(orderColumn, "id");
                assert.deepEqual(orderOptions, { ascending: true });
                return {
                  range(from, to) {
                    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
                  },
                };
              },
            });
            return chain;
          },
        };
      }

      // #3315: sponsor_paid-notifikationen ved sæson-start (notifyUser's dedup-
      // opslag + insert).
      if (table === "notifications") {
        const filters = {};
        const q = {
          select(columns) {
            assert.equal(columns, "id");
            return q;
          },
          eq(column, value) { filters[column] = value; return q; },
          gte(column, value) { filters[column] = value; return q; },
          is(column, value) { filters[column] = value; return q; },
          order(column, options) {
            assert.equal(column, "created_at");
            assert.deepEqual(options, { ascending: false });
            return q;
          },
          limit(value) {
            assert.equal(value, 1);
            const data = state.notifications
              .filter(n => {
                if (filters.user_id && n.user_id !== filters.user_id) return false;
                if (filters.type && n.type !== filters.type) return false;
                if (filters.title && n.title !== filters.title) return false;
                if (filters.message && n.message !== filters.message) return false;
                if ("related_id" in filters && n.related_id !== filters.related_id) return false;
                return true;
              })
              .slice(0, 1)
              .map(n => ({ id: n.id }));
            return Promise.resolve({ data, error: null });
          },
          insert(row) {
            state.notificationInserts.push(row);
            state.notifications.unshift({ id: `notification-${state.notificationInserts.length}`, ...row });
            return Promise.resolve({ error: null });
          },
        };
        return q;
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

test("#2962: processSeasonStart paginerer sin egen teams-select forbi 1000-row-loftet", async () => {
  // 1200 hold — uden paginering ville kun de første 1000 hold få sponsor/parachute-
  // behandling, og de sidste 200 hold ville stille springe sæson-start-cashflowet
  // over (ingen fejl, bare fravær — samme klasse som #2907/#2932).
  const seasonId = "season-2962";
  const teamCount = 1200;
  const teams = [];
  for (let i = 0; i < teamCount; i += 1) {
    teams.push({
      id: `team-${i}`,
      name: `Team ${i}`,
      is_ai: false,
      is_frozen: false,
      division: 3,
      balance: 500_000,
      sponsor_income: 200_000,
      board_profiles: [],
    });
  }

  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    teams,
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  assert.equal(outcome.sponsor.length, teamCount, "alle 1200 hold, ikke kun de første 1000, skal have sponsor-resultat");
  const uniqueTeams = new Set(supabase.state.financeRows.map(r => r.team_id));
  assert.equal(uniqueTeams.size, teamCount, "alle 1200 hold skal have modtaget en finance-row (sponsor)");
});

// ─── #1980 Nedrykningsfaldskærm ───────────────────────────────────────────────
// gammel_div udledes af lastSeasonStanding (season_standings for den netop
// afsluttede sæson — samme kilde sponsor-beregningen allerede læser), ny_div =
// team.division (mock-holdets aktuelle division, som processDivisionEnd allerede
// har sat ved sæson-slut i den ægte prod-flow).

test("#1980: processSeasonStart betaler 100000 parachute ved D1→D2-nedrykning", async () => {
  const seasonId = "season-parachute-d1d2";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [
      { team_id: "team-d1d2", division: 1, rank_in_division: 18, total_points: 40 },
    ],
    team: {
      id: "team-d1d2",
      name: "Relegated D1 CF",
      is_ai: false,
      is_frozen: false,
      division: 2, // ny_div — allerede sat af processDivisionEnd i den ægte flow
      balance: 500_000,
      sponsor_income: 600_000,
      board_profiles: [],
    },
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const expected = Math.round(PARACHUTE_FACTOR * (SPONSOR_INCOME_BY_DIVISION[1] - SPONSOR_INCOME_BY_DIVISION[2]));
  assert.equal(expected, 100000, "sanity: låst kontrakt-beløb");

  const parachuteRow = supabase.state.financeRows.find((r) => r.type === "parachute");
  assert.ok(parachuteRow, "Ingen parachute finance-row fundet");
  assert.equal(parachuteRow.amount, expected);
  assert.equal(parachuteRow.metadata.code, "tx.parachute");
  assert.deepEqual(parachuteRow.metadata.params, { oldDivision: 1, newDivision: 2 });
  assert.equal(parachuteRow.reason_code, FINANCE_REASON.SEASON_START_PARACHUTE);
  assert.equal(parachuteRow.idempotency_key, `parachute:team-d1d2:${seasonId}`);

  assert.equal(outcome.parachute.count, 1);
  assert.equal(outcome.parachute.total, expected);
});

test("#1980: processSeasonStart betaler 30000 parachute ved D2→D3-nedrykning", async () => {
  const seasonId = "season-parachute-d2d3";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [
      { team_id: "team-d2d3", division: 2, rank_in_division: 19, total_points: 20 },
    ],
    team: {
      id: "team-d2d3",
      name: "Relegated D2 CF",
      is_ai: false,
      is_frozen: false,
      division: 3,
      balance: 400_000,
      sponsor_income: 400_000,
      board_profiles: [],
    },
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const expected = Math.round(PARACHUTE_FACTOR * (SPONSOR_INCOME_BY_DIVISION[2] - SPONSOR_INCOME_BY_DIVISION[3]));
  assert.equal(expected, 30000, "sanity: låst kontrakt-beløb");

  const parachuteRow = supabase.state.financeRows.find((r) => r.type === "parachute");
  assert.ok(parachuteRow, "Ingen parachute finance-row fundet");
  assert.equal(parachuteRow.amount, expected);
  assert.equal(outcome.parachute.count, 1);
  assert.equal(outcome.parachute.total, expected);
});

test("#1980: processSeasonStart betaler INGEN parachute ved D3→D4-nedrykning (bevidst ekskluderet — D4-upkeep=0)", async () => {
  const seasonId = "season-parachute-d3d4";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [
      { team_id: "team-d3d4", division: 3, rank_in_division: 22, total_points: 5 },
    ],
    team: {
      id: "team-d3d4",
      name: "Relegated D3 CF",
      is_ai: false,
      is_frozen: false,
      division: 4,
      balance: 300_000,
      sponsor_income: 340_000,
      board_profiles: [],
    },
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const parachuteRow = supabase.state.financeRows.find((r) => r.type === "parachute");
  assert.equal(parachuteRow, undefined, "D3→D4 skal IKKE udløse en parachute-row");
  assert.equal(outcome.parachute.count, 0);
  assert.equal(outcome.parachute.total, 0);
});

test("#1980: processSeasonStart betaler INGEN parachute ved oprykning (promotion)", async () => {
  const seasonId = "season-parachute-promotion";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [
      { team_id: "team-promoted", division: 2, rank_in_division: 1, total_points: 900 },
    ],
    team: {
      id: "team-promoted",
      name: "Promoted CF",
      is_ai: false,
      is_frozen: false,
      division: 1, // oprykket — ny_div < gammel_div
      balance: 600_000,
      sponsor_income: 600_000,
      board_profiles: [],
    },
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const parachuteRow = supabase.state.financeRows.find((r) => r.type === "parachute");
  assert.equal(parachuteRow, undefined, "Oprykning skal IKKE udløse en parachute-row");
  assert.equal(outcome.parachute.count, 0);
  assert.equal(outcome.parachute.total, 0);
});

test("#1980: processSeasonStart betaler INGEN parachute uden forrige-sæson-standing (sæson 1, intet at sammenligne med)", async () => {
  const seasonId = "season-parachute-s1";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 1 },
    prevSeasonId: null,
    prevStandings: [],
    team: {
      id: "team-s1",
      name: "Launch CF",
      is_ai: false,
      is_frozen: false,
      division: 3,
      balance: 500_000, // = INITIAL_BALANCE → sponsor skippes også (uafhængigt af parachute)
      sponsor_income: 340_000,
      board_profiles: [],
    },
  });

  const outcome = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const parachuteRow = supabase.state.financeRows.find((r) => r.type === "parachute");
  assert.equal(parachuteRow, undefined);
  assert.equal(outcome.parachute.count, 0);
  assert.equal(outcome.parachute.total, 0);
});

test("#1980: processSeasonStart kørt to gange giver præcis ÉN parachute-post (idempotent, cron-genkørsel)", async () => {
  const seasonId = "season-parachute-rerun";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [
      { team_id: "team-rerun", division: 1, rank_in_division: 18, total_points: 40 },
    ],
    team: {
      id: "team-rerun",
      name: "Rerun Relegated CF",
      is_ai: false,
      is_frozen: false,
      division: 2,
      balance: 500_000,
      sponsor_income: 600_000,
      board_profiles: [],
    },
    simulateIdempotency: true,
  });

  const outcome1 = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });
  const outcome2 = await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const parachuteRows = supabase.state.financeRows.filter((r) => r.type === "parachute");
  assert.equal(parachuteRows.length, 1, "kun 1. kørsel skal skrive en parachute-row — 2. kørsel skal skippe");

  assert.equal(outcome1.parachute.count, 1);
  assert.equal(outcome1.parachute.total, 100000);
  // 2. kørsel: incrementBalanceWithAudit returnerer skipped:true (23505) →
  // parachuteSummary tælles IKKE op igen for denne kørsel.
  assert.equal(outcome2.parachute.count, 0);
  assert.equal(outcome2.parachute.total, 0);
});

// ─── Løbende upkeep-debit (#1441) ────────────────────────────────────────────

test("processTeamSeasonPayroll debits 70000 as upkeep for a D2 team (#1441)", async () => {
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
  assert.equal(upkeep.amount, -70000, "Upkeep-beløb skal være -70000 for division 2 (ejer 23/8, S3-halvering)");
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
    // #2303: forced-sale repayment nu en separat dep (repayLoansFromForcedSale
    // kalder loans-tabellen + repay_loan_atomic-RPC'en, som denne testens
    // simple mock ikke modellerer) — stubbes ud, dedikerede tests dækker den.
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
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

// ─── #2303 · Tvangssalg afdrager gælden DIREKTE (ikke bare et estimat) ────────

function createForcedSaleDebtPaydownSupabase({ teamId, loans, initialLoanStatus = "active" }) {
  const financeRows = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const loansState = loans.map((l) => ({ ...l, status: initialLoanStatus }));
  const rpcCalls = [];

  const supabase = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "increment_balance_with_audit") {
        financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "repay_loan_atomic") {
        const loan = loansState.find((l) => l.id === params.p_loan_id && l.team_id === params.p_team_id);
        if (!loan) return Promise.resolve({ data: null, error: { message: "Lån ikke fundet" } });
        const actualAmount = Math.min(params.p_amount, loan.amount_remaining);
        const newRemaining = loan.amount_remaining - actualAmount;
        const isPaidOff = newRemaining <= 0;
        loan.amount_remaining = isPaidOff ? 0 : newRemaining;
        loan.status = isPaidOff ? "paid_off" : "active";
        return Promise.resolve({
          data: { paid: actualAmount, remaining: isPaidOff ? 0 : newRemaining, paid_off: isPaidOff },
          error: null,
        });
      }
      throw new Error(`Unexpected rpc in forced-sale debt-paydown test: ${name}`);
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(_col, _val) {
                return { single: () => Promise.resolve({ data: { balance: 999_999 }, error: null }) };
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
              return { eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) };
            }
            return { in: () => Promise.resolve({ data: [], error: null }) };
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
          update: () => ({ in: () => ({ in: () => Promise.resolve({ error: null }) }) }),
        };
      }
      if (table === "loans") {
        return {
          select(_cols) {
            return {
              eq(col1, val1) {
                assert.equal(col1, "team_id");
                assert.equal(val1, teamId);
                return {
                  eq(col2, val2) {
                    assert.equal(col2, "status");
                    assert.equal(val2, "active");
                    // Skal virke BÅDE som en direkte awaitable (getTotalDebt:
                    // `await ...eq().eq()`) OG som noget der kan chaine .order()
                    // (repayLoansFromForcedSale: `await ...eq().eq().order()`).
                    const activeLoans = loansState.filter((l) => l.status === "active");
                    const result = Promise.resolve({ data: activeLoans, error: null });
                    result.order = () => Promise.resolve({ data: activeLoans, error: null });
                    return result;
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in forced-sale debt-paydown test: ${table}`);
    },
  };

  return { supabase, financeRows, teamUpdates, riderUpdates, loansState };
}

test("processTeamSeasonPayroll: tvangssalg afdrager loans.amount_remaining DIREKTE (ældste lån først), ikke kun et estimat (#2303)", async () => {
  const seasonId = "season-forced-paydown-1";
  const teamId = "team-forced-paydown";

  // D3-ceiling er 600k (DEBT_CEILING_BY_DIVISION). To lån, ældste først (loan-old
  // oprettet før loan-new — order("created_at",{ascending:true}) simuleres via
  // rækkefølgen i loansState). Samlet gæld 800k > ceiling.
  const ctx = createForcedSaleDebtPaydownSupabase({
    teamId,
    loans: [
      { id: "loan-old", team_id: teamId, amount_remaining: 500_000 },
      { id: "loan-new", team_id: teamId, amount_remaining: 300_000 },
    ],
  });

  const team = {
    id: teamId,
    name: "Debt Spiral D3",
    division: 3,
    balance: 0,
    debt_breach_streak: 1, // allerede ét brud → dette bliver streak 2 → tvunget salg
    transfer_frozen: false,
    riders: [
      { id: "rider-a", firstname: "Big", lastname: "Value", market_value: 400_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
      { id: "rider-b", firstname: "Small", lastname: "Value", market_value: 300_000, salary: 0, ai_team_id: "ai-2", team_id: teamId },
    ],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    // #2303: REAL implementations (ikke stubs) — beviser at tvangssalget rent
    // faktisk skriver til loans.amount_remaining og at loopet stopper på ægte
    // gæld, ikke det gamle runningDebt-estimat.
    getTotalDebt: realGetTotalDebt,
    repayLoansFromForcedSale: realRepayLoansFromForcedSale,
  });

  // (1) Kun rider-a (400k, højeste market_value) blev tvangssolgt — provenuet
  //     (400k) betaler loan-old (500k) delvist ned til 100k, hvilket bringer
  //     den ÆGTE gæld til 100k+300k=400k, under 600k-loftet → loopet stopper.
  assert.equal(ctx.riderUpdates.length, 1, "kun ét salg skal være nødvendigt — loopet må ikke oversælge");
  assert.equal(ctx.riderUpdates[0].id, "rider-a");

  // (2) Ældste lån afdrages FØRST — loan-old falder med hele provenuet (400k
  //     < 500k rest), loan-new er URØRT.
  const loanOld = ctx.loansState.find((l) => l.id === "loan-old");
  const loanNew = ctx.loansState.find((l) => l.id === "loan-new");
  assert.equal(loanOld.amount_remaining, 100_000, "loan-old (ældste) skal falde med hele salgsprovenuet");
  assert.equal(loanNew.amount_remaining, 300_000, "loan-new (yngre) skal være urørt — loan-old absorberede alt provenuet");

  // (3) Loop-kriteriet er ÆGTE gæld, ikke et estimat: en frisk getTotalDebt-
  //     forespørgsel efter tvangssalget viser 400k, under loftet.
  const debtAfter = await realGetTotalDebt(teamId, ctx.supabase);
  assert.equal(debtAfter, 400_000);

  // (4) Breach ikke gentages ved næste season-start: samme deps, samme (nu
  //     opdaterede) DB-tilstand — currentDebt < ceiling, ingen ny tvangssalg.
  const secondSeasonTeam = {
    ...team,
    debt_breach_streak: 2,
    transfer_frozen: true,
    riders: [team.riders[1]], // rider-a er allerede solgt/væk fra holdet
  };
  const ctx2 = createForcedSaleDebtPaydownSupabase({
    teamId,
    loans: ctx.loansState.map((l) => ({ id: l.id, team_id: teamId, amount_remaining: l.amount_remaining })),
  });
  await processTeamSeasonPayroll(secondSeasonTeam, "season-forced-paydown-2", {
    supabase: ctx2.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: realGetTotalDebt,
    repayLoansFromForcedSale: realRepayLoansFromForcedSale,
  });
  assert.equal(ctx2.riderUpdates.length, 0, "ingen nyt tvangssalg — gælden er allerede under loftet efter afdraget");
  const resetUpdate = ctx2.teamUpdates.find((u) => u.id === teamId && "debt_breach_streak" in u.payload);
  assert.ok(resetUpdate, "breach-streak skal nulstilles på det andet kald");
  assert.equal(resetUpdate.payload.debt_breach_streak, 0);
  assert.equal(resetUpdate.payload.transfer_frozen, false);
});

test("processTeamSeasonPayroll: tvangssalgs-provenu > samlet gæld — afdrager alt, loopet stopper (ingen oversalg) (#2303)", async () => {
  const seasonId = "season-forced-paydown-overpay";
  const teamId = "team-forced-paydown-overpay";

  // Gæld (700k) > D3-ceiling (600k), så tvangssalget udløses.
  const ctx = createForcedSaleDebtPaydownSupabase({
    teamId,
    loans: [{ id: "loan-1", team_id: teamId, amount_remaining: 700_000 }],
  });

  const team = {
    id: teamId,
    name: "Overpay D3",
    division: 3,
    balance: 0,
    debt_breach_streak: 1,
    transfer_frozen: false,
    riders: [
      { id: "rider-a", firstname: "Huge", lastname: "Value", market_value: 900_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
      { id: "rider-b", firstname: "Second", lastname: "Rider", market_value: 100_000, salary: 0, ai_team_id: "ai-2", team_id: teamId },
    ],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: realGetTotalDebt,
    repayLoansFromForcedSale: realRepayLoansFromForcedSale,
  });

  // Kun rider-a sælges (900k proceeds >> 500k gæld) — loanet betales helt af,
  // og loopet stopper med det samme (0 gæld <= ceiling), rider-b beholdes.
  assert.equal(ctx.riderUpdates.length, 1);
  assert.equal(ctx.riderUpdates[0].id, "rider-a");
  const loan = ctx.loansState.find((l) => l.id === "loan-1");
  assert.equal(loan.amount_remaining, 0);
  assert.equal(loan.status, "paid_off");

  const debtAfter = await realGetTotalDebt(teamId, ctx.supabase);
  assert.equal(debtAfter, 0);
});

// ─── #2301 · Nødlån-idempotens + eskalering ───────────────────────────────────

test("#2301 · processTeamSeasonPayroll: nødlån-streak >= 2 fryser transfers via board-eskalering", async () => {
  const seasonId = "season-emergency-streak-2";
  const teamId = "team-chronic-shortfall";

  const financeRows = [];
  const teamUpdates = [];
  const notifications = [];

  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    if (columns === "user_id") return Promise.resolve({ data: { user_id: "user-1" }, error: null });
                    // Under ceiling så kun emergency_loan_streak-eskaleringen er i spil
                    // (isolerer testen fra den eksisterende debt-breach-mekanik).
                    return Promise.resolve({ data: { balance: 0 }, error: null });
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

      if (table === "notifications") {
        const q = {
          eq() { return q; }, gte() { return q; }, order() { return q; },
          is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return {
          select() { return q; },
          insert(row) { notifications.push(row); return Promise.resolve({ data: row, error: null }); },
        };
      }

      throw new Error(`Unexpected table in emergency-loan-escalation test: ${table}`);
    },
  };

  // Holdet havde allerede ét nødlån sidste sæson (streak=1) — denne sæson kræver
  // den IGEN (riders har løn, balance 0) → streak skal blive 2 → eskalering.
  const team = {
    id: teamId,
    name: "Chronic Shortfall FC",
    division: null, // ukendt division → debt-breach-blokken (2c) springes eksplicit over
    balance: 0,
    emergency_loan_streak: 1,
    transfer_frozen: false,
    riders: [{ id: "rider-1", salary: 500 }],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {}, // stub — kun streak-tælling under test her
  });

  const streakUpdate = teamUpdates.find(u => u.id === teamId && "emergency_loan_streak" in u.payload);
  assert.ok(streakUpdate, "teams.update med emergency_loan_streak skal være kaldt");
  assert.equal(streakUpdate.payload.emergency_loan_streak, 2, "streak skal incrementeres til 2");

  const freezeUpdate = teamUpdates.find(u => u.id === teamId && u.payload.transfer_frozen === true);
  assert.ok(freezeUpdate, "teams.update med transfer_frozen:true skal være kaldt ved streak >= 2");

  assert.equal(notifications.length, 1, "manageren skal advares om transfer-fryse");
  assert.equal(notifications[0].type, "board_critical");
});

test("#2301 · processTeamSeasonPayroll: nødlån-streak nulstilles når sæsonen IKKE kræver nødlån", async () => {
  const seasonId = "season-emergency-recovered";
  const teamId = "team-recovered-salary";

  const teamUpdates = [];
  const supabase = {
    rpc(_name, _params) {
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
              return { eq() { return { eq() { return Promise.resolve({ count: 0, error: null }); } }; } };
            }
            return { in() { return Promise.resolve({ data: [], error: null }); } };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const team = {
    id: teamId,
    name: "Recovered Salary FC",
    division: null,
    balance: 999_999,
    emergency_loan_streak: 1, // havde streak sidste sæson
    riders: [{ id: "rider-1", salary: 500 }], // rigelig balance dækker lønnen
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => { throw new Error("skal IKKE kaldes — ingen shortfall"); },
  });

  const streakUpdate = teamUpdates.find(u => u.id === teamId && "emergency_loan_streak" in u.payload);
  assert.ok(streakUpdate, "streak skal nulstilles eksplicit");
  assert.equal(streakUpdate.payload.emergency_loan_streak, 0);

  const freezeUpdate = teamUpdates.find(u => u.payload.transfer_frozen === true);
  assert.equal(freezeUpdate, undefined, "ingen freeze når streak er nulstillet");
});

test("#2301 · processTeamSeasonPayroll kørt to gange giver præcis ét nødlån og én løn-post (cron-genkørsel)", async () => {
  const seasonId = "season-rerun";
  const teamId = "team-rerun";

  const financeRows = [];
  const loansStore = [];
  const usedIdempotencyKeys = new Set();
  const notifications = [];
  let balance = 0; // starter uden dækning — første kørsel skal udløse nødlån
  let nextLoanId = 1;

  const loanConfig = {
    loan_type: "emergency",
    origination_fee_pct: 0.15,
    interest_rate_pct: 0.15,
    debt_ceiling: 600_000,
  };

  const supabase = {
    // Simulerer den ægte DB-adfærd: 2. forsøg på samme idempotency_key
    // rammer uniq_finance_idempotency_key (23505) og rulles tilbage.
    rpc(name, params) {
      if (name === "create_emergency_loan_atomic") {
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
      }
      assert.equal(name, "increment_balance_with_audit");
      const key = params.p_finance_payload.idempotency_key;
      if (key && usedIdempotencyKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      if (key) usedIdempotencyKeys.add(key);
      balance += params.p_delta;
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: balance, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    if (columns === "division") return Promise.resolve({ data: { division: 3 }, error: null });
                    if (columns === "user_id") return Promise.resolve({ data: { user_id: "user-1" }, error: null });
                    if (columns === "balance") return Promise.resolve({ data: { balance }, error: null });
                    throw new Error(`Unexpected teams.select columns: ${columns}`);
                  },
                };
              },
            };
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

      if (table === "loan_config") {
        return {
          select() { return { eq() { return Promise.resolve({ data: [loanConfig], error: null }); } }; },
        };
      }

      if (table === "loans") {
        return {
          // #2301 app-guard (select *, 3× eq, maybeSingle) vs. getTotalDebt (amount_remaining, 2× eq).
          select(columns) {
            if (columns === "*") {
              return {
                eq(_c1, _v1) {
                  return {
                    eq(_c2, _v2) {
                      return {
                        eq(_c3, seasonIdVal) {
                          return {
                            maybeSingle() {
                              const existing = loansStore.find(l => l.season_id === seasonIdVal && l.loan_type === "emergency");
                              return Promise.resolve({ data: existing || null, error: null });
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            }
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({
                      data: loansStore.map(l => ({ amount_remaining: l.amount_remaining })),
                      error: null,
                    });
                  },
                };
              },
            };
          },
          insert(row) {
            const inserted = { id: `loan-${nextLoanId++}`, ...row };
            loansStore.push(inserted);
            return { select() { return { single() { return Promise.resolve({ data: inserted, error: null }); } }; } };
          },
        };
      }

      if (table === "notifications") {
        const q = {
          eq() { return q; }, gte() { return q; }, order() { return q; },
          is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return {
          select() { return q; },
          insert(row) { notifications.push(row); return Promise.resolve({ data: row, error: null }); },
        };
      }

      throw new Error(`Unexpected table in rerun test: ${table}`);
    },
  };

  const team = {
    id: teamId,
    name: "Rerun FC",
    division: 3,
    riders: [{ id: "rider-1", salary: 1000 }],
  };

  // #2301: bruger IKKE createEmergencyLoan-stub — kalder den ægte loanEngine-funktion
  // (default via deps ?? import i economyEngine.js) for at teste hele idempotens-kæden.
  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
  });
  await processTeamSeasonPayroll(team, seasonId, {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
  });

  assert.equal(loansStore.length, 1, "præcis ét emergency-lån skal være oprettet på tværs af begge kørsler");

  const emergencyLoanCredits = financeRows.filter(r => r.type === "emergency_loan");
  assert.equal(emergencyLoanCredits.length, 1, "præcis én emergency_loan-kreditering");

  const salaryDebits = financeRows.filter(r => r.type === "salary");
  assert.equal(salaryDebits.length, 1, "præcis én løn-post — 2. kørsel skal skippe (idempotent)");
});

// ─── #2840: wage_deduction_mode-gate i processTeamSeasonPayroll ──────────────
// Config-gated dagsbaseret løntræk. Mode="season_upfront" (default) skal
// give BYTE-FOR-BYTE samme adfærd som før #2840 (verificeret af de 103
// øvrige tests i denne fil, som alle kører UDEN at mocke app_config og derfor
// rammer readWageDeductionMode's fail-safe → "season_upfront"). Disse to
// tests låser den eksplicitte kontrakt: mode styrer branchen, og "daily"
// springer det gamle engangstræk helt over.

function buildPayrollGateMock({ balance = 999_999 } = {}) {
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
          select() {
            return { eq() { return { single() { return Promise.resolve({ data: { balance }, error: null }); } }; } };
          },
          update() { return { eq() { return Promise.resolve({ error: null }); } }; },
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
      throw new Error(`Unexpected table in #2840 gate test: ${table}`);
    },
  };
  return { supabase, financeRows };
}

test("#2840 · mode=season_upfront (eksplicit) trækker fuld sæsonløn ved sæson-start, som i dag", async () => {
  const { supabase, financeRows } = buildPayrollGateMock();
  const team = { id: "team-gate-upfront", name: "Gate Upfront FC", division: 3, riders: [{ id: "r1", salary: 5000 }, { id: "r2", salary: 3000 }] };

  const result = await processTeamSeasonPayroll(team, "season-gate-1", {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0,
    readWageDeductionMode: async () => "season_upfront",
  });

  const salaryRows = financeRows.filter(r => r.type === "salary");
  assert.equal(salaryRows.length, 1, "season_upfront skal stadig trække ét samlet løn-beløb");
  assert.equal(salaryRows[0].amount, -8000, "beløbet skal være -sum(rider.salary), uændret formel");
  assert.equal(result.total_salary, 8000, "payroll-summary skal rapportere den fulde sæsonløn");
});

test("#2840 · mode=daily springer sæson-start-løntrækket helt over (dagssweepen overtager)", async () => {
  const { supabase, financeRows } = buildPayrollGateMock();
  const team = { id: "team-gate-daily", name: "Gate Daily FC", division: 3, riders: [{ id: "r1", salary: 5000 }, { id: "r2", salary: 3000 }] };

  const result = await processTeamSeasonPayroll(team, "season-gate-2", {
    supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => { throw new Error("emergency-lån må IKKE oprettes i daily-mode ved sæson-start"); },
    getTotalDebt: async () => 0,
    readWageDeductionMode: async () => "daily",
  });

  const salaryRows = financeRows.filter(r => r.type === "salary");
  assert.equal(salaryRows.length, 0, "daily-mode må IKKE skrive nogen løn-transaktion ved sæson-start");
  assert.equal(result.total_salary, 0, "payroll-summary skal vise 0 — hele beløbet håndteres af den daglige sweep");
  assert.equal(result.emergency_loan, 0, "intet nødlån skal udløses af det (fraværende) sæson-start-løntræk");
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
                    // #2951 · payDivisionBonuses' dedup-tjek pagineres nu via
                    // fetchAllRows (.order("id").range()).
                    return {
                      order(orderColumn, orderOptions) {
                        assert.equal(orderColumn, "id");
                        assert.deepEqual(orderOptions, { ascending: true });
                        return {
                          range(from, to) {
                            return Promise.resolve({ data: data.slice(from, to + 1), error: null });
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
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find((r) => r.type === "sponsor");
  assert.ok(sponsorRow, "Sæson 2 skal stadig udbetale sponsor uanset uberørt balance");
  assert.ok(sponsorRow.amount > 0, "Sæson-2-sponsor skal være positiv");
});

// ─── #3315 (DEL 2a): sponsor_paid-notifikation ved sæson-start ───────────────

test("#3315: processSeasonStart sender sponsor_paid-notifikation når sponsoren reelt udbetales", async () => {
  const seasonId = "season-2";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 2 },
    prevSeasonId: "season-1",
    prevStandings: [],
    team: makeSeason1Team({
      balance: INITIAL_BALANCE, division: 3, sponsor_income: 340_000, user_id: "user-1",
    }),
    activeContract: { sponsor_name: "Vesna Robotics", guaranteed_base: 340_000 },
  });

  await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  const sponsorRow = supabase.state.financeRows.find((r) => r.type === "sponsor");
  assert.ok(sponsorRow, "sponsor skal udbetales");

  assert.equal(supabase.state.notificationInserts.length, 1, "forventede ÉN sponsor_paid-notifikation");
  const notif = supabase.state.notificationInserts[0];
  assert.equal(notif.user_id, "user-1");
  assert.equal(notif.type, "sponsor_paid");
  assert.match(notif.message, /Vesna Robotics/);
  assert.match(notif.message, new RegExp(String(sponsorRow.amount)));
  assert.equal(notif.metadata.titleCode, "notif.sponsorPaid.seasonStart.title");
  assert.equal(notif.metadata.messageCode, "notif.sponsorPaid.seasonStart.message");
  assert.deepEqual(notif.metadata.messageParams, { sponsor: "Vesna Robotics", amount: sponsorRow.amount });
});

test("#3315: processSeasonStart sender INGEN sponsor_paid-notifikation når sponsoren springes over (sæson-1-gate)", async () => {
  const seasonId = "season-1";
  const supabase = createSeasonStartSupabase({
    season: { id: seasonId, number: 1 },
    team: makeSeason1Team({ balance: INITIAL_BALANCE, user_id: "user-1" }),
  });

  await processSeasonStart(seasonId, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
  });

  assert.equal(supabase.state.notificationInserts.length, 0, "intet sponsor-beløb blev krediteret — ingen notifikation");
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

// ─── #1441 Fase 3 A1 · Facilitets-upkeep + staff-sæsonløn (payroll-sinks) ─────
// FACILITIES_ENABLED er en compile-time const (false). Injektionspunkt:
// chargeFacilityCosts({ team, seasonId, supabaseClient, enabled }) — testes
// direkte med enabled:true; payroll-testen dækker default-disabled-stien.

function makeFacilitySupabase({ facilities = [], staff = [] } = {}) {
  const financeRows = [];
  const queriedTables = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      queriedTables.push(table);
      if (table === "team_facilities") {
        return {
          select() {
            return { eq() { return Promise.resolve({ data: facilities, error: null }); } };
          },
        };
      }
      if (table === "team_staff") {
        return {
          select() {
            return {
              eq() {
                return { eq() { return Promise.resolve({ data: staff, error: null }); } };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in facility-cost faken: ${table}`);
    },
  };
  return { supabase, financeRows, queriedTables };
}

test("#1441 A1: chargeFacilityCosts debiterer summeret tier-upkeep som facility_upkeep med idempotency-key", async () => {
  const { supabase, financeRows } = makeFacilitySupabase({
    facilities: [
      { track: "training", tier: 2 }, // 3_500
      { track: "medical", tier: 1 },  // 1_500
    ],
  });
  const team = { id: "team-fac-1", name: "Facility FC" };
  const seasonId = "season-fac-1";

  const result = await chargeFacilityCosts({ team, seasonId, supabaseClient: supabase, enabled: true });

  assert.equal(result.facilityUpkeepCharged, 5_000);
  const rows = financeRows.filter((r) => r.type === "facility_upkeep");
  assert.equal(rows.length, 1, "Præcis én facility_upkeep-transaktion");
  assert.equal(rows[0].amount, -5_000);
  assert.equal(rows[0].team_id, "team-fac-1");
  assert.equal(rows[0].idempotency_key, "facility_upkeep:team-fac-1:season-fac-1");
  assert.equal(rows[0].reason_code, "season_start_facility_upkeep");
});

test("#1441 A1: chargeFacilityCosts debiterer aktiv staff-løn som staff_salary (fyrede tælles ikke)", async () => {
  // Mocken returnerer kun aktive rows (query'en filtrerer .eq('status','active')) —
  // fyrede staff-rows kommer aldrig tilbage fra queryen og indgår derfor ikke.
  const { supabase, financeRows } = makeFacilitySupabase({
    staff: [{ salary: 40_000 }],
  });
  const team = { id: "team-staff-1", name: "Staff FC" };
  const seasonId = "season-staff-1";

  const result = await chargeFacilityCosts({ team, seasonId, supabaseClient: supabase, enabled: true });

  assert.equal(result.staffSalaryCharged, 40_000);
  const rows = financeRows.filter((r) => r.type === "staff_salary");
  assert.equal(rows.length, 1, "Præcis én staff_salary-transaktion");
  assert.equal(rows[0].amount, -40_000);
  assert.equal(rows[0].idempotency_key, "staff_salary:team-staff-1:season-staff-1");
  assert.equal(rows[0].reason_code, "season_start_staff_salary");
});

test("#1441 A1: chargeFacilityCosts med staff-query verificerer status=active-filteret", async () => {
  // Fang eq-kald: team_staff-queryen SKAL filtrere på status='active'.
  const eqCalls = [];
  const supabase = {
    rpc() { return Promise.resolve({ data: 0, error: null }); },
    from(table) {
      if (table === "team_facilities") {
        return { select() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; } };
      }
      if (table === "team_staff") {
        return {
          select() {
            return {
              eq(col, val) {
                eqCalls.push([col, val]);
                return { eq(col2, val2) { eqCalls.push([col2, val2]); return Promise.resolve({ data: [], error: null }); } };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  await chargeFacilityCosts({ team: { id: "t1", name: "T1" }, seasonId: "s1", supabaseClient: supabase, enabled: true });
  assert.deepEqual(eqCalls.find(([c]) => c === "status"), ["status", "active"], "team_staff-query skal filtrere status='active'");
});

test("#1441 A1: chargeFacilityCosts skriver INGEN debits ved 0 faciliteter/0 staff (flag enabled)", async () => {
  const { supabase, financeRows } = makeFacilitySupabase({ facilities: [], staff: [] });

  const result = await chargeFacilityCosts({
    team: { id: "team-empty", name: "Empty FC" },
    seasonId: "season-empty",
    supabaseClient: supabase,
    enabled: true,
  });

  assert.equal(result.facilityUpkeepCharged, 0);
  assert.equal(result.staffSalaryCharged, 0);
  assert.equal(financeRows.length, 0, "Ingen finance-rows ved 0 faciliteter og 0 staff");
});

test("#1441 A1: chargeFacilityCosts disabled → ingen queries, ingen debits", async () => {
  const { supabase, financeRows, queriedTables } = makeFacilitySupabase({
    facilities: [{ track: "training", tier: 5 }],
    staff: [{ salary: 120_000 }],
  });

  const result = await chargeFacilityCosts({
    team: { id: "team-off", name: "Off FC" },
    seasonId: "season-off",
    supabaseClient: supabase,
    enabled: false,
  });

  assert.equal(result.facilityUpkeepCharged, 0);
  assert.equal(result.staffSalaryCharged, 0);
  assert.equal(queriedTables.length, 0, "Ingen team_facilities/team_staff-queries når disabled");
  assert.equal(financeRows.length, 0);
});

test("#1441 A1: processTeamSeasonPayroll-summary indeholder facility_upkeep + staff_salary (0 ved default-disabled flag)", async () => {
  const financeRows = [];
  const supabase = makeUpkeepSupabase(financeRows);

  const team = {
    id: "team-fac-summary",
    name: "Summary FC",
    division: 2,
    balance: 999_999,
    riders: [],
  };

  const summary = await processTeamSeasonPayroll(team, "season-fac-summary", {
    supabase,
    seasonNumber: 2,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0,
  });

  assert.equal(summary.facility_upkeep, 0, "facility_upkeep-felt skal findes og være 0 med default-disabled flag");
  assert.equal(summary.staff_salary, 0, "staff_salary-felt skal findes og være 0 med default-disabled flag");
  // Default-flag (FACILITIES_ENABLED=false): makeUpkeepSupabase kender IKKE
  // team_facilities/team_staff — ingen throw beviser at der ikke queries.
  assert.equal(financeRows.filter((r) => r.type === "facility_upkeep").length, 0);
  assert.equal(financeRows.filter((r) => r.type === "staff_salary").length, 0);
});

test("#1441 A1: defaultRunSeasonPayroll aggregate-summary indeholder facility_upkeep_total + staff_salary_total (0 by default)", async () => {
  // Fake: ingen human-teams → loadHumanSeasonEndTeams returnerer [] og
  // aggregate-summary'en skal alligevel eksponere alle felter med 0.
  // #2357: orkestratoren læser nu også app_config (facilities_enabled) — faken
  // serverer null (flag mangler) så default-disabled-stien dækkes ærligt.
  const supabase = {
    from(table) {
      if (table === "app_config") {
        return {
          select() {
            return { eq() { return { maybeSingle() { return Promise.resolve({ data: null, error: null }); } }; } };
          },
        };
      }
      assert.equal(table, "teams");
      return {
        select() {
          return {
            // #2951 · loadHumanSeasonEndTeams's teams-query pagineres nu via
            // fetchAllRows (.order("id").range()).
            eq() { return { eq() { return { eq() { return { order() { return { range() { return Promise.resolve({ data: [], error: null }); } }; } }; } }; } }; },
          };
        },
      };
    },
  };

  const { summary } = await defaultRunSeasonPayroll(supabase, "season-agg-1", {});

  assert.equal(summary.teams_processed, 0);
  assert.equal(summary.upkeep_total, 0);
  assert.equal(summary.facility_upkeep_total, 0, "facility_upkeep_total skal findes i aggregate-summary");
  assert.equal(summary.staff_salary_total, 0, "staff_salary_total skal findes i aggregate-summary");
});

test("#2357: defaultRunSeasonPayroll læser facilities_enabled fra app_config (flip-wiring)", async () => {
  // Flag='on' i app_config + ingen teams: beviser at orkestratoren spørger
  // app_config (runtime-flag) og ikke kun compile-konstanten. Threading-adfærden
  // pr. hold dækkes af processTeamSeasonPayroll-testen nedenfor.
  const queriedTables = [];
  const supabase = {
    from(table) {
      queriedTables.push(table);
      if (table === "app_config") {
        return {
          select() {
            return { eq(col, key) {
              assert.equal(key, "facilities_enabled");
              return { maybeSingle() { return Promise.resolve({ data: { value: "on" }, error: null }); } };
            } };
          },
        };
      }
      return {
        select() {
          return {
            // #2951 · loadHumanSeasonEndTeams's teams-query pagineres nu via
            // fetchAllRows (.order("id").range()).
            eq() { return { eq() { return { eq() { return { order() { return { range() { return Promise.resolve({ data: [], error: null }); } }; } }; } }; } }; },
          };
        },
      };
    },
  };

  await defaultRunSeasonPayroll(supabase, "season-flag-1", {});
  assert.ok(queriedTables.includes("app_config"), "orkestratoren skal læse app_config.facilities_enabled");
});

test("#2357: processTeamSeasonPayroll threader facilitiesEnabled til chargeFacilityCosts (drift+staff-løn opkræves ved flip)", async () => {
  // Regression-guard for flip-bølgen: FØR wiringen faldt chargeFacilityCosts
  // tilbage på compile-konstanten (false) → faciliteter kunne købes (route-gate
  // læser app_config) men sæson-drift/staff-løn blev aldrig opkrævet.
  const { supabase, financeRows, queriedTables } = makeFacilitySupabase({
    facilities: [{ track: "training", tier: 2 }], // 3_500 upkeep
    staff: [{ salary: 40_000 }],
  });
  // Payroll-stien tæller også akademi-ryttere (trin 4) — servér riders med count 0
  // og delegér alt andet til facility-faken (som fortsat throw'er på ukendte tabeller).
  const baseFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === "riders") {
      queriedTables.push(table);
      return {
        select() {
          return { eq() { return { eq() { return Promise.resolve({ count: 0, error: null }); } }; } };
        },
      };
    }
    if (table === "teams") {
      queriedTables.push(table);
      return {
        // debt_breach_streak/transfer_frozen-opdatering + post-salary balance-genlæsning
        update() { return { eq() { return Promise.resolve({ error: null }); } }; },
        select() {
          return { eq() { return { single() { return Promise.resolve({ data: { balance: 999_999 }, error: null }); } }; } };
        },
      };
    }
    return baseFrom(table);
  };

  const team = { id: "team-flip-1", name: "Flip FC", division: 2, balance: 999_999, riders: [] };
  const summary = await processTeamSeasonPayroll(team, "season-flip-1", {
    supabase,
    seasonNumber: 1, // sæson-1-deferral på division-upkeep → kun facility-sinks rammer faken
    facilitiesEnabled: true,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0,
  });

  assert.ok(queriedTables.includes("team_facilities"), "flag=true skal åbne facility-gaten");
  assert.equal(summary.facility_upkeep, 3_500);
  assert.equal(summary.staff_salary, 40_000);
  assert.equal(financeRows.filter((r) => r.type === "facility_upkeep").length, 1);
  assert.equal(financeRows.filter((r) => r.type === "staff_salary").length, 1);
});

// ─── #2851 · Motor-gate: season_end_skip_division_movement ──────────────────
// Ejer-gate 25/7: processSeasonEnd skal kunne springe divisions-flytningen +
// AI-reconcile over for S1→S2-komprimeringen — fail-safe default = motorens
// normale adfærd. Vi måler på league_divisions-queries: buildPoolTree er det
// FØRSTE flytnings-skridt, så 0 queries = hele op/nedryknings-blokken sprunget
// over (processDivisionEnd + reconcileAiTeamsForPool afhænger begge af træet).

function makeSeasonEndGateFixture() {
  return {
    season: { id: "season-1", number: 5, status: "active" },
    team: {
      id: "team-1",
      name: "Gate Testers",
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
        stage_wins: 2,
        gc_wins: 1,
        team: { id: "team-1", is_ai: false },
      },
    ],
  };
}

function countLeagueDivisionQueries(supabase) {
  const counter = { count: 0 };
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === "league_divisions") counter.count += 1;
    return originalFrom(table);
  };
  return counter;
}

test("processSeasonEnd springer op/nedrykning + AI-reconcile over når #2851-flaget er på", async () => {
  const supabase = createSeasonEndSupabase(makeSeasonEndGateFixture());
  const counter = countLeagueDivisionQueries(supabase);

  await processSeasonEnd("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
    isSeasonEndDivisionMovementSkipped: async () => true,
  });

  assert.equal(counter.count, 0, "buildPoolTree/reconcile må ikke røre league_divisions når flaget er på");
  // Resten af sæson-slut kører stadig: sæsonen lukkes og board-flowet skrev.
  assert.equal(supabase.state.season.status, "completed");
  assert.equal(supabase.state.inserts.board_plan_snapshots.length, 1);
});

test("processSeasonEnd fail-safe: manglende/fejlende flag-opslag = motorens normale flytning", async () => {
  const supabase = createSeasonEndSupabase(makeSeasonEndGateFixture());
  const counter = countLeagueDivisionQueries(supabase);

  // INGEN deps-override: default-implementeringen læser app_config, som mocken
  // ikke kender (kaster "Unexpected table") — readFlagStage skal fange det og
  // svare false, så motoren kører sin normale op/nedryknings-sti.
  await processSeasonEnd("season-1", {
    supabase,
    now: FIXED_SEASON_END_NOW,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
  });

  assert.ok(counter.count >= 1, "fail-safe default skal bygge pulje-træet som før #2851");
  assert.equal(supabase.state.season.status, "completed");
});

// ─── #2912/#2919/#2920 · Gælds-/pengemotor-cluster ────────────────────────────
//
// Fælles mock: ét D3-hold (loft 600k), dækning af de tabeller
// processTeamSeasonPayroll rører, plus et notifications-spor og en DB-agtig
// håndhævelse af uniq_finance_idempotency_key (23505 på gentaget nøgle).
function createDebtClusterSupabase({ teamId, balance = 999_999, enforceIdempotency = false }) {
  const financeRows = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const notifications = [];
  const usedIdempotencyKeys = new Set();

  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const key = params.p_finance_payload?.idempotency_key;
      if (enforceIdempotency && key) {
        if (usedIdempotencyKeys.has(key)) {
          // Spejler uniq_finance_idempotency_key: hele transaktionen rulles
          // tilbage, hverken balance eller ledger-row ændres.
          return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
        }
        usedIdempotencyKeys.add(key);
      }
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            return {
              eq(_col, _val) {
                return {
                  single() {
                    if (columns === "user_id") return Promise.resolve({ data: { user_id: "user-1" }, error: null });
                    return Promise.resolve({ data: { balance }, error: null });
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
              return { eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) };
            }
            return { in: () => Promise.resolve({ data: [], error: null }) };
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
        return { update: () => ({ in: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
      }
      if (table === "notifications") {
        const q = {
          eq() { return q; }, gte() { return q; }, order() { return q; },
          is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return {
          select() { return q; },
          insert(row) { notifications.push(row); return Promise.resolve({ data: row, error: null }); },
        };
      }
      throw new Error(`Unexpected table in debt-cluster test (${teamId}): ${table}`);
    },
  };

  return { supabase, financeRows, teamUpdates, riderUpdates, notifications };
}

test("#2912 · rentekapitaliseringen alene må ikke skubbe et hold over gældsloftet (ingen frysning)", async () => {
  const teamId = "team-interest-pushed-over";
  const ctx = createDebtClusterSupabase({ teamId });

  // D3-loft = 600k. Gælden EFTER renten er 700k, men 150k af den er netop
  // kapitaliseret i denne kørsel, så gælden holdet selv byggede op er 550k og
  // altså UNDER loftet. Før #2912 blev holdet frosset her, tavst.
  const team = {
    id: teamId,
    name: "Interest Victim D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 0,
    transfer_frozen: false,
    riders: [],
  };

  await processTeamSeasonPayroll(team, "season-2912-grace", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({
      charged: [{ loan_id: "loan-1", interest: 150_000, skipped: false }],
    }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  const breachUpdate = ctx.teamUpdates.find(u => u.id === teamId && "debt_breach_streak" in u.payload);
  assert.ok(breachUpdate, "breach-opdateringen skal stadig skrives");
  assert.equal(breachUpdate.payload.debt_breach_streak, 0, "renten alene må ikke tælle som et brud");
  assert.equal(breachUpdate.payload.transfer_frozen, false, "holdet må ikke fryses af motorens egen rente");
  assert.equal(ctx.notifications.length, 0, "ingen frysning = ingen frysnings-besked");
});

test("#2912 · gæld over loftet UDEN renten fryser stadig og sender nu en besked til holdet", async () => {
  const teamId = "team-genuinely-over";
  const ctx = createDebtClusterSupabase({ teamId });

  // 700k gæld hvoraf 50k er denne sæsons rente: 650k basisgæld > 600k loft, så
  // bruddet er ægte og uafhængigt af renten.
  const team = {
    id: teamId,
    name: "Genuinely Broke D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 0,
    transfer_frozen: false,
    riders: [],
  };

  await processTeamSeasonPayroll(team, "season-2912-breach", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({
      charged: [{ loan_id: "loan-1", interest: 50_000, skipped: false }],
    }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  const breachUpdate = ctx.teamUpdates.find(u => u.id === teamId && "debt_breach_streak" in u.payload);
  assert.equal(breachUpdate.payload.debt_breach_streak, 1, "ægte brud skal tælle");
  assert.equal(breachUpdate.payload.transfer_frozen, true, "ægte brud fryser stadig transfers");

  assert.equal(ctx.notifications.length, 1, "frysningen må ikke længere være tavs (#2912)");
  assert.equal(ctx.notifications[0].type, "board_critical");
  assert.equal(ctx.notifications[0].metadata.titleCode, "notif.debtCeilingFreeze.title");
  assert.equal(ctx.notifications[0].metadata.messageCode, "notif.debtCeilingFreeze.message");
  // Beskeden citerer det mål frysningen faktisk blev truffet på (rente-eksklusivt).
  assert.equal(ctx.notifications[0].metadata.messageParams.debt, 650_000);
  assert.equal(ctx.notifications[0].metadata.messageParams.ceiling, 600_000);
});

test("#2912 · et hold der allerede er frosset får ikke samme frysnings-besked igen", async () => {
  const teamId = "team-still-frozen";
  const ctx = createDebtClusterSupabase({ teamId });

  const team = {
    id: teamId,
    name: "Still Frozen D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 1,
    transfer_frozen: true, // frosset sidste sæson, ved det godt
    riders: [],
  };

  await processTeamSeasonPayroll(team, "season-2912-repeat", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  assert.equal(ctx.notifications.length, 0, "kun overgangen til frosset notificeres, ikke hver sæson");
});

test("#2919 · gældsgrenen må ikke ophæve nødlåns-grenens frysning i samme kørsel", async () => {
  const teamId = "team-two-branches";
  // balance 0 + løn > 0 giver shortfall, nødlån og streak 1+1 = 2, altså freeze
  // i gren 2b.
  const ctx = createDebtClusterSupabase({ teamId, balance: 0 });

  const team = {
    id: teamId,
    name: "Two Branch FC",
    division: 3,
    balance: 0,
    emergency_loan_streak: 1,
    debt_breach_streak: 0,
    transfer_frozen: false, // stale in-memory-snapshot: gren 2b sætter true i DB
    riders: [{ id: "rider-1", salary: 50_000 }],
  };

  await processTeamSeasonPayroll(team, "season-2919", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    // UNDER D3-loftet, så gældsgrenen rammer sin else-gren (nulstil + optø).
    getTotalDebt: async () => 100_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  const freezeUpdate = ctx.teamUpdates.find(u => u.payload.transfer_frozen === true);
  assert.ok(freezeUpdate, "nødlåns-eskaleringen skal fryse holdet");

  const breachUpdate = ctx.teamUpdates.find(u => u.id === teamId && "debt_breach_streak" in u.payload);
  assert.ok(breachUpdate, "gældsgrenen skal stadig skrive sin opdatering");
  assert.equal(breachUpdate.payload.debt_breach_streak, 0, "gælden er under loftet, så streak nulstilles");
  assert.equal(
    breachUpdate.payload.transfer_frozen,
    true,
    "strengeste tilstand vinder: gældsgrenen må ikke optø nødlåns-frysningen (#2919)",
  );

  // Rækkefølgen betyder noget: den SIDSTE skrivning er den der lander i DB.
  const lastFrozenWrite = [...ctx.teamUpdates].reverse().find(u => "transfer_frozen" in u.payload);
  assert.equal(lastFrozenWrite.payload.transfer_frozen, true, "sidste skrivning må ikke være false");

  // Kun nødlåns-eskaleringens egen besked, ingen dublet fra gældsgrenen.
  assert.equal(ctx.notifications.length, 1);
  assert.equal(ctx.notifications[0].metadata.titleCode, "notif.emergencyLoanEscalation.title");
});

test("#2919 · et hold uden frysning i kørslen optøs stadig når gælden er under loftet", async () => {
  const teamId = "team-real-recovery";
  const ctx = createDebtClusterSupabase({ teamId });

  const team = {
    id: teamId,
    name: "Real Recovery FC",
    division: 3,
    balance: 999_999,
    emergency_loan_streak: 0,
    debt_breach_streak: 1,
    transfer_frozen: true, // frosset sidste sæson
    riders: [],
  };

  await processTeamSeasonPayroll(team, "season-2919-recovery", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 100_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  const breachUpdate = ctx.teamUpdates.find(u => u.id === teamId && "debt_breach_streak" in u.payload);
  assert.equal(breachUpdate.payload.debt_breach_streak, 0);
  assert.equal(
    breachUpdate.payload.transfer_frozen,
    false,
    "recovery-stien skal bevares: uden frysning i kørslen optøs holdet",
  );
});

test("#2920 · forced_debt_sale bærer en idempotency-nøgle (samme mønster som de øvrige penge-callsites)", async () => {
  const teamId = "team-forced-key";
  const seasonId = "season-2920";
  const ctx = createDebtClusterSupabase({ teamId });

  const team = {
    id: teamId,
    name: "Forced Key D3",
    division: 3,
    balance: 0,
    debt_breach_streak: 1, // bliver streak 2, altså tvangssalg
    transfer_frozen: false,
    riders: [
      { id: "rider-a", firstname: "Sold", lastname: "Rider", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  };

  await processTeamSeasonPayroll(team, seasonId, {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  const forcedSaleRows = ctx.financeRows.filter(r => r.type === "forced_debt_sale");
  assert.equal(forcedSaleRows.length, 1);
  assert.equal(
    forcedSaleRows[0].idempotency_key,
    `forced_debt_sale:${teamId}:${seasonId}:rider-a`,
    "nøglen skal være <type>:<team>:<season>:<rider> så flere salg i samme sæson kan skelnes",
  );
});

test("#2920 · dobbeltkørsel bogfører IKKE tvangssalget to gange", async () => {
  const teamId = "team-forced-double-run";
  const seasonId = "season-2920-rerun";
  // Delt idempotency-state mellem de to kørsler (som en rigtig DB).
  const ctx = createDebtClusterSupabase({ teamId, enforceIdempotency: true });

  // #2982: kørsel 1 gennemfører BÅDE kreditering og disposition (ingen crash),
  // så kørsel 2's roster-snapshot afspejler den ægte DB-tilstand bagefter —
  // rytteren er væk fra holdet, akkurat som en frisk loadHumanSeasonEndTeams-
  // forespørgsel ville vise det. Se testen nedenfor (#2982 resume) for det
  // andet tilfælde: kørsel 1 crasher FØR dispositionen når igennem, og
  // rytteren er derfor STADIG på holdet ved kørsel 2.
  const makeTeamStillOwned = () => ({
    id: teamId,
    name: "Double Run D3",
    division: 3,
    balance: 0,
    debt_breach_streak: 1,
    transfer_frozen: false,
    riders: [
      { id: "rider-a", firstname: "Sold", lastname: "Twice", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  });
  const makeTeamAlreadyDisposed = () => ({
    ...makeTeamStillOwned(),
    riders: [], // rytteren forlod holdet i kørsel 1 og hentes derfor ikke med igen
  });

  const deps = {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  };

  // Kørsel 1 (fuldt gennemført) + kørsel 2 (cron-genkørsel af samme sæson,
  // frisk roster-snapshot der afspejler kørsel 1's resultat).
  await processTeamSeasonPayroll(makeTeamStillOwned(), seasonId, deps);
  await processTeamSeasonPayroll(makeTeamAlreadyDisposed(), seasonId, deps);

  const forcedSaleRows = ctx.financeRows.filter(r => r.type === "forced_debt_sale");
  assert.equal(forcedSaleRows.length, 1, "præcis én forced_debt_sale-postering trods to kørsler");

  // Dispositionen køres heller ikke igen: rytteren flyttes kun i den kørsel der
  // faktisk bogførte pengene.
  assert.equal(ctx.riderUpdates.length, 1, "rytteren må ikke dispositioneres to gange");
});

test("#2982 · crash mellem kreditering og rytterflyt: næste kørsel fuldfører dispositionen (lån afdraget), uden at bogføre penge to gange", async () => {
  const teamId = "team-forced-crash-resume";
  const seasonId = "season-2982-resume";
  // Delt idempotency-state mellem de to kørsler (som en rigtig DB).
  const ctx = createDebtClusterSupabase({ teamId, enforceIdempotency: true });

  // #2982: simulér at rytterflytningen kaster i FØRSTE kald (netværks-
  // hikke/DB-fejl lige efter creditTeam er landet — den præcise crash issuet
  // beskriver), men opfører sig normalt derefter (kørsel 2's retry).
  let riderUpdateAttempts = 0;
  const baseFrom = ctx.supabase.from.bind(ctx.supabase);
  const originalRidersHandle = baseFrom("riders");
  ctx.supabase.from = (table) => {
    if (table !== "riders") return baseFrom(table);
    return {
      ...originalRidersHandle,
      update(payload) {
        riderUpdateAttempts += 1;
        if (riderUpdateAttempts === 1) {
          return { eq: () => Promise.resolve({ error: { message: "simulated crash mid-disposition" } }) };
        }
        return originalRidersHandle.update(payload);
      },
    };
  };

  // Rytteren er STADIG på holdet begge gange: kørsel 1's rytterflyt fejlede
  // reelt, så DB'en (og dermed roster-snapshot'et) aldrig blev opdateret.
  const makeTeam = () => ({
    id: teamId,
    name: "Crash Resume D3",
    division: 3,
    balance: 0,
    debt_breach_streak: 1,
    transfer_frozen: false,
    riders: [
      { id: "rider-a", firstname: "Crash", lastname: "Resume", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  });

  const repayLoansCalls = [];
  const deps = {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async (...args) => {
      repayLoansCalls.push(args);
      return { totalRepaid: 500_000, loans: [{ loan_id: "loan-1", paid: 500_000, remaining: 0, paid_off: true }] };
    },
  };

  // Kørsel 1: krediteringen lykkes, men rytterflyt kaster → fejlen propagerer,
  // akkurat som en ægte crash mellem de to trin ville gøre.
  await assert.rejects(() => processTeamSeasonPayroll(makeTeam(), seasonId, deps));

  // Pengene ER bogført, selvom kørsel 1 crashede lige bagefter.
  assert.equal(
    ctx.financeRows.filter(r => r.type === "forced_debt_sale").length,
    1,
    "krediteringen skal stå ved magt selvom kørsel 1 crashede i næste trin",
  );
  assert.equal(ctx.riderUpdates.length, 0, "det fejlede rytterflyt-forsøg i kørsel 1 må ikke tælle som gennemført");
  assert.equal(repayLoansCalls.length, 0, "lånafdraget nås aldrig i kørsel 1 — crashet sker FØR det trin");

  // Kørsel 2 (retry af samme sæson): samme roster, for rytteren er FAKTISK
  // stadig på holdet i DB — kørsel 1 nåede aldrig at flytte den.
  await processTeamSeasonPayroll(makeTeam(), seasonId, deps);

  // (1) Pengene bogføres IKKE igen — idempotency-nøglen fanger dubletten.
  assert.equal(
    ctx.financeRows.filter(r => r.type === "forced_debt_sale").length,
    1,
    "kørsel 2 må ikke kreditere holdet igen for samme salg",
  );

  // (2) ...MEN dispositionen fuldføres nu, hvor den fejlede i kørsel 1 (#2982
  // kerne-fix): rytteren flyttes, uden at pengene bogføres to gange.
  assert.equal(ctx.riderUpdates.length, 1, "kørsel 2 skal fuldføre den uafsluttede rytterflytning");
  assert.equal(ctx.riderUpdates[0].id, "rider-a");

  // (3) ...og lånet afdrages, som acceptkriteriet i #2982 kræver — resten af
  // dispositionen (oprydning + lånafdrag) er ikke betinget af en frisk
  // kreditering, kun af at rytteren stadig var uafklaret.
  assert.equal(repayLoansCalls.length, 1, "lånafdraget skal nu nås i den fuldførende kørsel");
  assert.equal(repayLoansCalls[0][0], teamId);
  assert.equal(repayLoansCalls[0][1], 500_000);
});

// ─── #2976 · Tvangssalg + varsel må ikke være tavse ───────────────────────────
//
// Tvangssalget (breach-streak >= 2) tog holdets dyreste rytter uden at sende
// noget som helst: manageren opdagede tabet ved selv at kigge på truppen.
// #2912 gav frysningen en besked, men KUN på overgangen til frosset — et hold
// der allerede var frosset (typisk af nødlåns-eskaleringen) løb derfor hele
// vejen fra første brud til tvangssalg i fuldstændig stilhed.
//
// Kontrakt der testes her:
//   1. tvangssalg  → salgs-besked der navngiver rytteren
//   2. første brud → varsel FØR straffen, også når holdet allerede er frosset
//   3. præcis ÉN besked pr. kørsel (salget erstatter frysnings-beskeden)
//   4. cron-genkørsel sender ikke salgs-beskeden igen

test("#2976 · tvangssalget navngiver rytteren i en besked til manageren", async () => {
  const teamId = "team-2976-sale";
  const ctx = createDebtClusterSupabase({ teamId });

  const team = {
    id: teamId,
    name: "Forced Sale D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 1, // → streak 2 → tvangssalg
    transfer_frozen: true, // allerede frosset af sidste sæsons brud
    riders: [
      { id: "rider-a", firstname: "Marco", lastname: "Pantani", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  };

  await processTeamSeasonPayroll(team, "season-2976-sale", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    // 700k > D3-loft 600k → brud; efter salget er gælden 200k.
    getTotalDebt: (() => {
      let calls = 0;
      return async () => (calls++ === 0 ? 700_000 : 200_000);
    })(),
    repayLoansFromForcedSale: async () => ({ totalRepaid: 500_000, loans: [] }),
  });

  assert.equal(ctx.riderUpdates.length, 1, "rytteren skal faktisk være solgt");

  assert.equal(ctx.notifications.length, 1, "tvangssalget må ikke længere være tavst (#2976)");
  const notif = ctx.notifications[0];
  assert.equal(notif.type, "board_critical");
  assert.equal(notif.metadata.titleCode, "notif.debtCeilingForcedSale.title");
  assert.equal(notif.metadata.messageCode, "notif.debtCeilingForcedSale.message");
  // Hvilken rytter, hvorfor, hvad koster det, hvor står holdet nu.
  assert.equal(notif.metadata.messageParams.riders, "Marco Pantani");
  assert.equal(notif.metadata.messageParams.proceeds, 500_000);
  assert.equal(notif.metadata.messageParams.debt, 700_000, "beskeden citerer det tal bruddet blev erklæret på");
  assert.equal(notif.metadata.messageParams.ceiling, 600_000);
  assert.equal(notif.metadata.messageParams.streak, 2);
  assert.equal(notif.metadata.messageParams.remainingDebt, 200_000);
  // EN-first fallback (frontend renderer locale-aware via metadata-koderne).
  assert.match(notif.message, /Marco Pantani/);
});

test("#2976 · flere salg i samme kørsel giver ÉN besked med alle ryttere", async () => {
  const teamId = "team-2976-multi";
  const ctx = createDebtClusterSupabase({ teamId });

  const team = {
    id: teamId,
    name: "Fire Sale D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 1,
    transfer_frozen: true,
    riders: [
      { id: "rider-a", firstname: "Top", lastname: "Earner", market_value: 300_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
      { id: "rider-b", firstname: "Second", lastname: "Best", market_value: 200_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  };

  // Første salg rækker ikke under loftet, andet gør.
  const debts = [900_000, 700_000, 500_000];
  let call = 0;

  await processTeamSeasonPayroll(team, "season-2976-multi", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => debts[Math.min(call++, debts.length - 1)],
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  assert.equal(ctx.riderUpdates.length, 2, "begge ryttere skal være solgt");
  assert.equal(ctx.notifications.length, 1, "to salg er én begivenhed for manageren, ikke to beskeder");
  assert.equal(
    ctx.notifications[0].metadata.messageParams.riders,
    "Top Earner, Second Best",
    "begge navne skal med, dyreste først",
  );
  assert.equal(ctx.notifications[0].metadata.messageParams.proceeds, 500_000);
});

test("#2976 · salgs-beskeden erstatter frysnings-beskeden (ingen dublet i samme kørsel)", async () => {
  const teamId = "team-2976-no-dupe";
  const ctx = createDebtClusterSupabase({ teamId });

  const team = {
    id: teamId,
    name: "Unfrozen Then Sold D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 1,
    transfer_frozen: false, // frysningen er en OVERGANG i denne kørsel
    riders: [
      { id: "rider-a", firstname: "Only", lastname: "Asset", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  };

  await processTeamSeasonPayroll(team, "season-2976-no-dupe", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  assert.equal(ctx.notifications.length, 1, "både frysning og salg i samme kørsel = én besked");
  assert.equal(
    ctx.notifications[0].metadata.titleCode,
    "notif.debtCeilingForcedSale.title",
    "salget er overskriften; frysningen nævnes inde i samme besked",
  );
});

test("#2976 · varsel FØR straffen: et allerede frosset hold får sidste varsel ved første brud", async () => {
  const teamId = "team-2976-warning";
  const ctx = createDebtClusterSupabase({ teamId });

  // Den tidligere tavse vej: holdet er frosset af nødlåns-eskaleringen (#2301),
  // så #2912's frysnings-besked fyrer ikke (ingen overgang). Uden #2976 fik
  // holdet derfor INTET at vide før dets dyreste rytter forsvandt sæsonen efter.
  const team = {
    id: teamId,
    name: "Already Frozen D3",
    division: 3,
    balance: 999_999,
    emergency_loan_streak: 0,
    debt_breach_streak: 0, // → streak 1, altså sæsonen FØR tvangssalget
    transfer_frozen: true,
    riders: [],
  };

  await processTeamSeasonPayroll(team, "season-2976-warning", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  const breachUpdate = ctx.teamUpdates.find(u => u.id === teamId && "debt_breach_streak" in u.payload);
  assert.equal(breachUpdate.payload.debt_breach_streak, 1, "dette er første brud, ikke tvangssalgs-sæsonen");
  assert.equal(ctx.riderUpdates.length, 0, "ingen rytter må sælges ved streak 1");

  assert.equal(ctx.notifications.length, 1, "varslet må ikke afhænge af om frysningen er en overgang (#2976)");
  const notif = ctx.notifications[0];
  assert.equal(notif.type, "board_critical");
  assert.equal(notif.metadata.titleCode, "notif.debtCeilingFinalWarning.title");
  assert.equal(notif.metadata.messageCode, "notif.debtCeilingFinalWarning.message");
  assert.equal(notif.metadata.messageParams.debt, 700_000);
  assert.equal(notif.metadata.messageParams.ceiling, 600_000);
});

test("#2976 · et hold der er dybt i brud får ikke varslet igen hver sæson", async () => {
  const teamId = "team-2976-no-nag";
  const ctx = createDebtClusterSupabase({ teamId });

  // streak 2 → 3 uden ryttere at sælge: intet nyt er sket, så ingen besked.
  const team = {
    id: teamId,
    name: "Chronic D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 2,
    transfer_frozen: true,
    riders: [],
  };

  await processTeamSeasonPayroll(team, "season-2976-no-nag", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  });

  assert.equal(ctx.notifications.length, 0, "ingen ny begivenhed = ingen ny besked");
});

test("#2976 · cron-genkørsel sender ikke salgs-beskeden to gange", async () => {
  const teamId = "team-2976-rerun";
  const seasonId = "season-2976-rerun";
  // Delt idempotency-state mellem kørslerne, som en rigtig DB.
  const ctx = createDebtClusterSupabase({ teamId, enforceIdempotency: true });

  const rider = { id: "rider-a", firstname: "Sold", lastname: "Once", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId };
  const deps = {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 0, loans: [] }),
  };

  // Kørsel 1: salget bogføres og manageren får beskeden.
  await processTeamSeasonPayroll(
    { id: teamId, name: "Rerun D3", division: 3, balance: 999_999, debt_breach_streak: 1, transfer_frozen: true, riders: [rider] },
    seasonId,
    deps,
  );
  assert.equal(ctx.notifications.length, 1, "kørsel 1 skal sende salgs-beskeden");
  assert.equal(ctx.notifications[0].metadata.titleCode, "notif.debtCeilingForcedSale.title");

  // Kørsel 2: en ægte cron-genkørsel af den SAMME (allerede fuldt gennemførte)
  // sæson henter et FRISK roster-snapshot — rytteren er væk fra holdet, for
  // kørsel 1 nåede både at kreditere OG dispositionere den. #2982: hvis
  // rytteren stadig LÅ i snapshottet her (fordi kørsel 1 crashede FØR
  // dispositionen nåede igennem), er det den anden, adskilte "resume"-sag —
  // se testen "#2982 · crash mellem kreditering og rytterflyt" — og der SKAL
  // beskeden (og dispositionen) fuldføres, ikke undertrykkes.
  await processTeamSeasonPayroll(
    { id: teamId, name: "Rerun D3", division: 3, balance: 999_999, debt_breach_streak: 2, transfer_frozen: true, riders: [] },
    seasonId,
    deps,
  );

  assert.equal(ctx.financeRows.filter(r => r.type === "forced_debt_sale").length, 1);
  assert.equal(ctx.notifications.length, 1, "genkørslen må ikke sende salgs-beskeden igen (#2976)");
});

test("#2976 · alle nye notifikations-koder findes i BÅDE en og da backendMessages", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const LOCALES = join(import.meta.dirname, "..", "..", "frontend", "public", "locales");
  const flatten = (lang) => {
    const out = new Set();
    (function walk(o, p) {
      for (const [k, v] of Object.entries(o)) {
        const key = p ? `${p}.${k}` : k;
        if (v && typeof v === "object") walk(v, key);
        else out.add(key);
      }
    })(JSON.parse(readFileSync(join(LOCALES, lang, "backendMessages.json"), "utf8")), "");
    return out;
  };

  const EN = flatten("en");
  const DA = flatten("da");
  const CODES = [
    "notif.debtCeilingForcedSale.title",
    "notif.debtCeilingForcedSale.message",
    "notif.debtCeilingFinalWarning.title",
    "notif.debtCeilingFinalWarning.message",
  ];

  assert.deepEqual(CODES.filter(c => !EN.has(c)), [], "manglende EN-nøgler");
  assert.deepEqual(CODES.filter(c => !DA.has(c)), [], "manglende DA-nøgler");

  // Tone-guard (#2948): ingen em-dash i player-facing copy.
  for (const lang of ["en", "da"]) {
    const raw = readFileSync(join(LOCALES, lang, "backendMessages.json"), "utf8");
    const notif = JSON.parse(raw).notif;
    for (const key of ["debtCeilingForcedSale", "debtCeilingFinalWarning"]) {
      assert.ok(!notif[key].title.includes("—"), `${lang}.${key}.title må ikke indeholde em-dash`);
      assert.ok(!notif[key].message.includes("—"), `${lang}.${key}.message må ikke indeholde em-dash`);
    }
  }
});

// ─── #2976 · En fejlet notifikation må aldrig koste de øvrige hold sæsonskiftet ─
//
// Kald-kæden har INGEN per-hold-grænse:
//   seasonTransition.transitionToNextSeason (fase 6)
//     → processSeasonStart → defaultRunSeasonPayroll
//       → `for (team of teams) await processTeamSeasonPayroll(...)`  ← intet try/catch
//
// Kastede notifyManager videre, ville ét holds DB-hikke afbryde payroll for de
// resterende hold OG resten af transitionen (fase 7+ kører aldrig) — efter at
// pengene var bogført. notifyManagerSafe fanger, logger, capturer til Sentry og
// fortsætter.

// Multi-hold-mock til defaultRunSeasonPayroll: dækker den pagineredede
// loadHumanSeasonEndTeams-kæde plus de tabeller payroll rører pr. hold.
// `failNotificationForUserIds` gør notifications.insert til en DB-fejl for
// udvalgte brugere, præcis som en rigtig insert-fejl ville se ud.
function createMultiTeamPayrollSupabase({ teams, failNotificationForUserIds = [], totalDebt = 700_000 }) {
  const notifications = [];
  const teamUpdates = [];
  const financeRows = [];
  const fail = new Set(failNotificationForUserIds);

  const page = (rows) => ({ range: () => Promise.resolve({ data: rows, error: null }) });

  const supabase = {
    rpc(_name, params) {
      financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            // loadHumanSeasonEndTeams: .select("*").eq×3.order().range()
            if (columns === "*") {
              return { eq: () => ({ eq: () => ({ eq: () => ({ order: () => page(teams) }) }) }) };
            }
            // Per-hold-reads: balance (løn/negativ rente) + user_id (notifikation).
            return {
              eq(_col, teamId) {
                return {
                  single() {
                    if (columns === "user_id") return Promise.resolve({ data: { user_id: `user-${teamId}` }, error: null });
                    return Promise.resolve({ data: { balance: 999_999 }, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_col, teamId) {
                teamUpdates.push({ id: teamId, payload: { ...payload } });
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
              return { eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) };
            }
            return { in: () => ({ order: () => page([]) }) };
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "board_profiles") {
        return { select: () => ({ in: () => ({ order: () => page([]) }) }) };
      }
      if (table === "loans") {
        // getTotalDebt (ægte loanEngine-funktion, ikke stubbet i loop-stien).
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ amount_remaining: totalDebt }], error: null }) }) }) };
      }
      if (table === "notifications") {
        const q = {
          eq() { return q; }, gte() { return q; }, order() { return q; },
          is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return {
          select() { return q; },
          insert(row) {
            if (fail.has(row.user_id)) {
              // Sådan ser en rigtig PostgREST-insert-fejl ud: notifyUser kaster
              // på `{ error }`, den kommer ikke som en JS-exception.
              return Promise.resolve({ data: null, error: { code: "23514", message: "notifications_type_check violation" } });
            }
            notifications.push(row);
            return Promise.resolve({ data: row, error: null });
          },
        };
      }
      throw new Error(`Unexpected table in multi-team payroll test: ${table}`);
    },
  };

  return { supabase, notifications, teamUpdates, financeRows };
}

test("#2976 · en fejlende notifikation afbryder ikke payroll for de øvrige hold", async () => {
  // Tre hold der alle rammer varsel-grenen (streak 0→1, allerede frosset).
  // Hold 2's notifikations-insert fejler. Uden notifyManagerSafe ville hold 3
  // aldrig blive behandlet, og fase 7+ af sæsonskiftet ville aldrig køre.
  const teams = ["team-1", "team-2", "team-3"].map(id => ({
    id,
    name: `Team ${id}`,
    division: 3,
    balance: 999_999,
    debt_breach_streak: 0,
    transfer_frozen: true,
    emergency_loan_streak: 0,
  }));

  const ctx = createMultiTeamPayrollSupabase({ teams, failNotificationForUserIds: ["user-team-2"] });
  const captured = [];

  const { summary, results } = await defaultRunSeasonPayroll(ctx.supabase, "season-2976-resilience", {
    facilitiesEnabled: false,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    captureException: (error, context) => captured.push({ error, context }),
  });

  // 1. Kørslen gennemføres — det er hele pointen.
  assert.equal(summary.teams_processed, 3, "alle tre hold skal behandles trods fejlen på hold 2");
  assert.equal(results.length, 3);

  // 2. Pengelogikken kørte for ALLE hold, også det hvis besked fejlede.
  for (const id of ["team-1", "team-2", "team-3"]) {
    const update = ctx.teamUpdates.find(u => u.id === id && "debt_breach_streak" in u.payload);
    assert.ok(update, `hold ${id} skal have fået sin breach-opdatering skrevet`);
    assert.equal(update.payload.debt_breach_streak, 1, `hold ${id}: streak skal være talt op`);
  }

  // 3. De hold hvis besked kunne leveres, fik den.
  assert.equal(ctx.notifications.length, 2, "hold 1 og 3 skal have fået deres varsel");
  assert.deepEqual(
    ctx.notifications.map(n => n.user_id).sort(),
    ["user-team-1", "user-team-3"],
  );

  // 4. Fejlen blev IKKE slugt: præcis én capture, med hold-id og besked-type.
  assert.equal(captured.length, 1, "den tabte besked skal være rapporteret til Sentry");
  assert.equal(captured[0].context.teamId, "team-2");
  assert.equal(captured[0].context.messageCode, "notif.debtCeilingFinalWarning.message");
  assert.equal(captured[0].context.sourcePath, "processTeamSeasonPayroll.debtCeilingFinalWarning");
  assert.equal(captured[0].context.seasonId, "season-2976-resilience");
  assert.equal(captured[0].context.tags.cron, "season-payroll");
  assert.equal(captured[0].context.tags.notification_type, "board_critical");
  assert.match(captured[0].error.message, /notifications_type_check/);
});

test("#2976 · tvangssalget står ved magt selv om salgs-beskeden fejler", async () => {
  // Værst tænkelige rækkefølge: pengene er bogført og rytteren flyttet, og SÅ
  // fejler beskeden. At kaste her ville hverken give rytteren tilbage eller
  // levere beskeden — det ville kun koste de resterende hold deres sæsonskifte.
  const teamId = "team-2976-notify-fails";
  const ctx = createDebtClusterSupabase({ teamId });
  const captured = [];

  // Gør notifications.insert til en fejl (mocken accepterer ellers alt).
  const baseFrom = ctx.supabase.from.bind(ctx.supabase);
  ctx.supabase.from = (table) => {
    if (table !== "notifications") return baseFrom(table);
    const q = {
      eq() { return q; }, gte() { return q; }, order() { return q; },
      is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
    };
    return {
      select() { return q; },
      insert() { return Promise.resolve({ data: null, error: { message: "connection reset" } }); },
    };
  };

  const team = {
    id: teamId,
    name: "Notify Fails D3",
    division: 3,
    balance: 999_999,
    debt_breach_streak: 1,
    transfer_frozen: true,
    riders: [
      { id: "rider-a", firstname: "Still", lastname: "Sold", market_value: 500_000, salary: 0, ai_team_id: "ai-1", team_id: teamId },
    ],
  };

  // Må ikke reject'e.
  await processTeamSeasonPayroll(team, "season-2976-notify-fails", {
    supabase: ctx.supabase,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 700_000,
    repayLoansFromForcedSale: async () => ({ totalRepaid: 500_000, loans: [] }),
    captureException: (error, context) => captured.push({ error, context }),
  });

  assert.equal(ctx.financeRows.filter(r => r.type === "forced_debt_sale").length, 1, "salget skal stadig være bogført");
  assert.equal(ctx.riderUpdates.length, 1, "rytteren skal stadig være flyttet");
  assert.equal(captured.length, 1, "den tabte salgs-besked skal være rapporteret");
  assert.equal(captured[0].context.messageCode, "notif.debtCeilingForcedSale.message");
  assert.equal(captured[0].context.teamId, teamId);
});

// ─── #2976 · Samme graense i SAESON-SLUT-vejen ────────────────────────────────
//
// Soendagens cutover har to kald-kaeder, og de deler defekten:
//
//   A) POST /api/admin/seasons/:id/end -> processSeasonEnd
//        -> for (team of teams) await processTeamSeasonEnd(...)    <- 0 try/catch
//        -> for (division of 1..MAX) await processDivisionEnd(...) <- 0 try/catch
//   B) transitionToNextSeason (fase 6) -> processSeasonStart -> payroll (daekket ovenfor)
//
// I (A) er indsatsen hoejere end en manglende besked: en throw midt i
// divisions-loopet efterlader op/nedrykningen HALVT anvendt.

// Multi-hold-mock for processSeasonEnd. Samme princip som
// createMultiTeamPayrollSupabase, men for de tabeller saeson-slut roerer.
function createMultiTeamSeasonEndSupabase({ teams, boards, standings, failNotificationForUserIds = [] }) {
  const notifications = [];
  const boardUpdates = [];
  const fail = new Set(failNotificationForUserIds);

  // Kaedebar query-stub. Saeson-slut rammer den samme tabel med flere forskellige
  // former (fetchAllRows-paginering via .range(), direkte await, .limit(),
  // .single()), saa stubben svarer paa dem alle:
  //   .range()  → `rangeRows`  (pagineret laesning)
  //   await     → `awaitRows`  (boardGoalContext's Promise.all-queries)
  const chain = (rangeRows = [], awaitRows = []) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, lte: () => q, gte: () => q,
      is: () => q, not: () => q, order: () => q,
      limit: () => Promise.resolve({ data: awaitRows, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      range: () => Promise.resolve({ data: rangeRows, error: null }),
      then: (res, rej) => Promise.resolve({ data: awaitRows, error: null }).then(res, rej),
    };
    return q;
  };

  const supabase = {
    rpc() { return Promise.resolve({ data: 0, error: null }); },
    from(table) {
      switch (table) {
        case "seasons":
          return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { number: 5 }, error: null }) }) }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        case "season_standings":
          // .range() → slutstillingen; direkte await → boardGoalContext's
          // pulje-optaelling (tom er fint, den paavirker kun maal-konteksten).
          return chain(standings, []);
        case "teams":
          return {
            select(columns) {
              if (columns === "user_id") {
                return { eq: (_c, teamId) => ({ single: () => Promise.resolve({ data: { user_id: `user-${teamId}` }, error: null }) }) };
              }
              return chain(teams, teams);
            },
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        case "riders":
          return chain([], []);
        case "board_profiles":
          return {
            select: () => chain(boards, boards),
            update(payload) {
              return {
                eq(_c, boardId) {
                  boardUpdates.push({ id: boardId, payload: { ...payload } });
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        case "board_plan_snapshots":
          return { select: () => chain([], []), upsert: () => Promise.resolve({ error: null }) };
        case "loans":
          // .select("id", { count: "exact", head: true }).eq().eq() → { count }
          return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }) };
        case "finance_transactions":
          // .range(): alle hold markeret som "bonus allerede udbetalt", saa
          // payDivisionBonuses ikke krediterer og testen holder fokus paa
          // notifikations-graensen. await: boardGoalContext's transfer-balance.
          return chain(teams.map(t => ({ team_id: t.id })), []);
        case "race_results":
          return chain([], []);
        case "notifications": {
          const q = {
            eq() { return q; }, gte() { return q; }, order() { return q; },
            is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
          };
          return {
            select() { return q; },
            insert(row) {
              if (fail.has(row.user_id)) {
                return Promise.resolve({ data: null, error: { code: "23514", message: "notifications_type_check violation" } });
              }
              notifications.push(row);
              return Promise.resolve({ data: row, error: null });
            },
          };
        }
        default:
          throw new Error(`Unexpected table in multi-team season-end test: ${table}`);
      }
    },
  };

  return { supabase, notifications, boardUpdates };
}

test("#2976 · en fejlende bestyrelses-besked afbryder ikke sæson-slut for de øvrige hold", async () => {
  // Tre hold med en 3-årsplan midtvejs → hver rammer boardMidReview-beskeden.
  // Hold 2's insert fejler. Uden notifyManagerSafe ville hold 3 aldrig få sin
  // bestyrelsesdom, og op/nedrykningen bagefter ville aldrig køre.
  const ids = ["team-1", "team-2", "team-3"];
  const teams = ids.map(id => ({
    id,
    name: `Season End ${id}`,
    is_ai: false,
    user_id: `user-${id}`,
    balance: 500,
    sponsor_income: 200,
    division: 3,
  }));
  const boards = ids.map(id => ({
    id: `board-${id}`,
    team_id: id,
    plan_type: "3yr",
    focus: "balanced",
    satisfaction: 50,
    budget_modifier: 1.0,
    current_goals: [],
    seasons_completed: 0, // → seasonsCompleted 1 = floor(3/2) → mid-review
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
    plan_start_sponsor_income: 200,
  }));
  const standings = ids.map((id, i) => ({
    season_id: "season-5",
    team_id: id,
    division: 3,
    league_division_id: null,
    total_points: 50 - i,
    rank_in_division: i + 2,
    stage_wins: 0,
    gc_wins: 0,
    team: { id, is_ai: false },
  }));

  const ctx = createMultiTeamSeasonEndSupabase({
    teams, boards, standings,
    failNotificationForUserIds: ["user-team-2"],
  });
  const captured = [];

  await processSeasonEnd("season-5", {
    supabase: ctx.supabase,
    ...baseDeps(),
    boardTestMode: false,
    // Divisions-flytningen dækkes af sin egen test nedenfor.
    isSeasonEndDivisionMovementSkipped: async () => true,
    captureException: (error, context) => captured.push({ error, context }),
  });

  // 1. Alle tre hold fik deres bestyrelsesdom skrevet — også hold 2.
  for (const id of ids) {
    assert.ok(
      ctx.boardUpdates.find(u => u.id === `board-${id}`),
      `hold ${id} skal have fået sin board_profiles-opdatering`,
    );
  }

  // 2. De hold hvis besked kunne leveres, fik den.
  assert.equal(ctx.notifications.length, 2, "hold 1 og 3 skal have fået deres halvvejsevaluering");
  assert.deepEqual(
    ctx.notifications.map(n => n.user_id).sort(),
    ["user-team-1", "user-team-3"],
  );

  // 3. Fejlen blev rapporteret, ikke slugt.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].context.teamId, "team-2");
  assert.equal(captured[0].context.messageCode, "notif.boardMidReview.message");
  assert.equal(captured[0].context.sourcePath, "processTeamSeasonEnd.boardMidReview");
  assert.equal(captured[0].context.tags.notification_type, "board_update");
});

test("#4157 · boardMidReview messageParams-nøgler matcher backendMessages-skabelonens placeholders", async () => {
  // #4157: messageParams-nøglen hed "midMessageKey" — frontend's formatBackendParams
  // strimler kun suffikset "Key" af (midMessageKey → midMessage), men skabelonens
  // placeholder hedder {midMsg}. Resultatet var en ubrugt "midMessage"-param og et
  // aldrig-udfyldt {midMsg} synligt for spilleren. Denne test kører den ægte
  // sæson-slut-kode og verificerer GENERISK — for enhver *Key-param — at
  // stripped-navnet rent faktisk optræder som {placeholder} i BÅDE en og da
  // skabelonen for den udsendte messageCode, så klassen af fejl ikke kan gentages.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const teamId = "team-mid";
  const teams = [{
    id: teamId, name: "Mid Review FC", is_ai: false, user_id: "user-mid",
    balance: 500, sponsor_income: 200, division: 3,
  }];
  const boards = [{
    id: "board-mid", team_id: teamId, plan_type: "3yr", focus: "balanced",
    satisfaction: 50, budget_modifier: 1.0, current_goals: [],
    seasons_completed: 0, // → seasonsCompleted 1 = floor(3/2) → mid-review
    cumulative_stage_wins: 0, cumulative_gc_wins: 0,
    plan_start_sponsor_income: 200,
  }];
  const standings = [{
    season_id: "season-5", team_id: teamId, division: 3, league_division_id: null,
    total_points: 50, rank_in_division: 2, stage_wins: 0, gc_wins: 0,
    team: { id: teamId, is_ai: false },
  }];

  const ctx = createMultiTeamSeasonEndSupabase({ teams, boards, standings, failNotificationForUserIds: [] });

  await processSeasonEnd("season-5", {
    supabase: ctx.supabase,
    ...baseDeps(),
    boardTestMode: false,
    isSeasonEndDivisionMovementSkipped: async () => true,
    captureException: () => {},
  });

  assert.equal(ctx.notifications.length, 1, "holdet skal have fået sin halvvejsevaluering");
  const notif = ctx.notifications[0];
  const messageCode = notif.metadata.messageCode;
  const messageParams = notif.metadata.messageParams;
  assert.equal(messageCode, "notif.boardMidReview.message");

  // Nøglen skal være "midMsgKey" (ikke det gamle "midMessageKey").
  assert.ok(
    Object.prototype.hasOwnProperty.call(messageParams, "midMsgKey"),
    "messageParams skal indeholde midMsgKey",
  );
  assert.ok(
    typeof messageParams.midMsgKey === "string" && messageParams.midMsgKey.startsWith("notif.boardMidMessage."),
    "midMsgKey skal pege på en gyldig notif.boardMidMessage.*-nøgle",
  );

  const LOCALES = join(import.meta.dirname, "..", "..", "frontend", "public", "locales");
  const getTemplate = (lang, code) => {
    const root = JSON.parse(readFileSync(join(LOCALES, lang, "backendMessages.json"), "utf8"));
    return code.split(".").reduce((o, k) => (o == null ? o : o[k]), root);
  };

  for (const lang of ["en", "da"]) {
    const template = getTemplate(lang, messageCode);
    assert.ok(typeof template === "string", `${lang}: ${messageCode} skal findes som en streng-skabelon`);

    // Generisk regressions-guard: for enhver "*Key"-param skal det strimlede
    // basenavn (fx midMsgKey → midMsg) rent faktisk optræde som {placeholder}
    // i skabelonen. Havde nøglen stadig heddet "midMessageKey", ville denne
    // assertion fejle (skabelonen har {midMsg}, ikke {midMessage}).
    for (const key of Object.keys(messageParams)) {
      if (key.endsWith("Key") && key.length > 3) {
        const base = key.slice(0, -3);
        assert.ok(
          template.includes(`{${base}}`),
          `${lang}.${messageCode}: skabelonen mangler {${base}} for param-nøglen "${key}" (fandt: ${template})`,
        );
      }
    }
  }
});

test("#2976 · en fejlende oprykkerbesked må ikke efterlade pyramiden halvt flyttet", async () => {
  // To puljer i div 2, hver med 3 hold → top 2 rykker op fra hver pulje (4 i alt).
  // Beskeden fejler for den første oprykker. Uden notifyManagerSafe ville de tre
  // resterende hold aldrig få deres division skrevet: nogle flyttet, andre ikke.
  const divisionUpdates = [];
  const notifications = [];

  const mkStanding = (teamId, poolId, rank) => ({
    season_id: "season-5",
    team_id: teamId,
    division: 2,
    league_division_id: poolId,
    rank_in_division: rank,
    team: { id: teamId, is_ai: false },
  });
  const standings = [
    mkStanding("a1", "pool-a", 1), mkStanding("a2", "pool-a", 2), mkStanding("a3", "pool-a", 3),
    mkStanding("b1", "pool-b", 1), mkStanding("b2", "pool-b", 2), mkStanding("b3", "pool-b", 3),
  ];

  const supabase = {
    from(table) {
      if (table === "teams") {
        return {
          select: () => ({ eq: (_c, teamId) => ({ single: () => Promise.resolve({ data: { user_id: `user-${teamId}` }, error: null }) }) }),
          update(payload) {
            return {
              eq(_c, teamId) {
                divisionUpdates.push({ teamId, payload: { ...payload } });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "notifications") {
        const q = {
          eq() { return q; }, gte() { return q; }, order() { return q; },
          is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return {
          select() { return q; },
          insert(row) {
            if (row.user_id === "user-a1") {
              return Promise.resolve({ data: null, error: { message: "connection reset" } });
            }
            notifications.push(row);
            return Promise.resolve({ data: row, error: null });
          },
        };
      }
      throw new Error(`Unexpected table in division-end test: ${table}`);
    },
  };

  const captured = [];
  // childrenOf → [] slår relegation fra; testen handler om oprykningsloopet.
  const poolTree = { parentOf: () => "pool-parent", childrenOf: () => [], byId: new Map() };

  await processDivisionEnd(standings, 2, "season-5", 5, {
    supabase,
    poolTree,
    captureException: (error, context) => captured.push({ error, context }),
  });

  // Alle fire oprykkere skal have fået deres division skrevet.
  assert.deepEqual(
    divisionUpdates.map(u => u.teamId).sort(),
    ["a1", "a2", "b1", "b2"],
    "oprykningen må ikke stoppe ved det hold hvis besked fejlede",
  );
  for (const u of divisionUpdates) {
    assert.equal(u.payload.division, 1, "alle fire skal flyttes til div 1");
  }

  assert.equal(notifications.length, 3, "de tre øvrige oprykkere skal have fået deres besked");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].context.teamId, "a1");
  assert.equal(captured[0].context.sourcePath, "processDivisionEnd.divisionPromoted");
  assert.equal(captured[0].context.messageCode, "notif.divisionPromoted.message");
});
