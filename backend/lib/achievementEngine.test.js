import test from "node:test";
import assert from "node:assert/strict";

import { checkAchievements, getAchievementUnlocks } from "./achievementEngine.js";

function createAchievementSupabase(initialState) {
  const state = {
    achievements: (initialState.achievements || []).map(row => ({ ...row })),
    manager_achievements: (initialState.manager_achievements || []).map(row => ({ ...row })),
    teams: (initialState.teams || []).map(row => ({ ...row })),
    rider_watchlist: (initialState.rider_watchlist || []).map(row => ({ ...row })),
    users: (initialState.users || []).map(row => ({ ...row })),
    riders: (initialState.riders || []).map(row => ({ ...row })),
    auction_bids: (initialState.auction_bids || []).map(row => ({ ...row })),
    auctions: (initialState.auctions || []).map(row => ({ ...row })),
    transfer_offers: (initialState.transfer_offers || []).map(row => ({ ...row })),
    board_profiles: (initialState.board_profiles || []).map(row => ({ ...row })),
    inserts: [],
  };

  function createSelectQuery(table, rows) {
    let filtered = rows.map(row => ({ ...row }));

    const query = {
      eq(column, value) {
        filtered = filtered.filter(row => row[column] === value);
        return query;
      },
      in(column, values) {
        const allowed = new Set(values);
        filtered = filtered.filter(row => allowed.has(row[column]));
        return query;
      },
      maybeSingle() {
        if (filtered.length > 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned" },
          });
        }
        return Promise.resolve({ data: filtered[0] || null, error: null });
      },
      single() {
        if (filtered.length !== 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned" },
          });
        }
        return Promise.resolve({ data: filtered[0] || null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
      },
    };

    return query;
  }

  return {
    state,
    from(table) {
      if (!(table in state)) {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select() {
          return createSelectQuery(table, state[table]);
        },
        insert(payload) {
          const row = { ...payload };
          state.manager_achievements.push(row);
          state.inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

test("checkAchievements derives auction and transfer unlocks from live-history tables", async () => {
  const supabase = createAchievementSupabase({
    achievements: [
      { id: "auction_first_bid" },
      { id: "auction_high_roller" },
      { id: "transfer_first" },
      { id: "transfer_buyer_10" },
      { id: "transfer_seller_10" },
      { id: "transfer_negotiator" },
      { id: "transfer_bargain" },
      { id: "secret_watchlist_50" },
    ],
    teams: [{ id: "team-1", user_id: "user-1" }],
    users: [{ id: "user-1", login_streak: 2 }],
    rider_watchlist: Array.from({ length: 50 }, (_, index) => ({ id: `watch-${index}`, user_id: "user-1" })),
    // #1205: bargain måles mod market_value — offer 40 < 100/2.
    riders: [{ id: "rider-bargain", market_value: 100, team_id: "other-team" }],
    auction_bids: [{ id: "bid-1", team_id: "team-1", amount: 2000000001 }],
    auctions: [],
    transfer_offers: [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `buy-${index}`,
        buyer_team_id: "team-1",
        seller_team_id: `seller-${index}`,
        status: "accepted",
        offer_amount: index === 0 ? 40 : 90,
        round: index === 0 ? 3 : 1,
        rider_id: index === 0 ? "rider-bargain" : `rider-buy-${index}`,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `sell-${index}`,
        buyer_team_id: `buyer-${index}`,
        seller_team_id: "team-1",
        status: "accepted",
        offer_amount: 120,
        round: 1,
        rider_id: `rider-sell-${index}`,
      })),
    ],
    board_profiles: [],
  });

  const unlocked = await checkAchievements({
    supabase,
    userId: "user-1",
  });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id).sort(),
    [
      "auction_first_bid",
      "auction_high_roller",
      "secret_watchlist_50",
      "transfer_bargain",
      "transfer_buyer_10",
      "transfer_first",
      "transfer_negotiator",
      "transfer_seller_10",
    ]
  );
  assert.equal(supabase.state.inserts.length, 8);
});

test("checkAchievements unlocks team and board achievements and cascades team_5_achievements", async () => {
  const supabase = createAchievementSupabase({
    achievements: [
      { id: "team_15_riders" },
      { id: "team_youth" },
      { id: "team_star" },
      { id: "secret_streak_7" },
      { id: "auction_first_win" },
      { id: "auction_sniper" },
      { id: "auction_last_second" },
      { id: "season_board_100" },
      { id: "team_5_achievements" },
    ],
    manager_achievements: [
      { user_id: "user-1", achievement_id: "legacy-1" },
      { user_id: "user-1", achievement_id: "legacy-2" },
      { user_id: "user-1", achievement_id: "legacy-3" },
      { user_id: "user-1", achievement_id: "legacy-4" },
    ],
    teams: [{ id: "team-1", user_id: "user-1" }],
    users: [{ id: "user-1", login_streak: 7 }],
    rider_watchlist: [],
    riders: [
      // #1205: stjernerytter = market_value >= 5M (STAR_RIDER_MARKET_VALUE).
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `team-rider-${index}`,
        team_id: "team-1",
        is_u25: index < 8,
        market_value: index === 0 ? 5_000_000 : 100_000,
      })),
    ],
    auction_bids: [],
    auctions: [
      {
        id: "auction-win-1",
        current_bidder_id: "team-1",
        status: "completed",
        starting_price: 80,
        current_price: 80,
        extension_count: 1,
      },
    ],
    transfer_offers: [],
    board_profiles: [{ team_id: "team-1", plan_type: "1yr", negotiation_status: "completed", satisfaction: 100 }],
  });

  const unlocked = await checkAchievements({
    supabase,
    userId: "user-1",
  });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id).sort(),
    [
      "auction_first_win",
      "auction_last_second",
      "auction_sniper",
      "season_board_100",
      "secret_streak_7",
      "team_15_riders",
      "team_5_achievements",
      "team_star",
      "team_youth",
    ]
  );
});

test("checkAchievements tolerates parallel board plans and uses completed non-baseline max satisfaction", async () => {
  const supabase = createAchievementSupabase({
    achievements: [
      { id: "season_board_100" },
    ],
    teams: [{ id: "team-1", user_id: "user-1" }],
    users: [{ id: "user-1", login_streak: 0 }],
    rider_watchlist: [],
    riders: [],
    auction_bids: [],
    auctions: [],
    transfer_offers: [],
    board_profiles: [
      { team_id: "team-1", plan_type: "baseline", is_baseline: true, negotiation_status: "completed", satisfaction: 100 },
      { team_id: "team-1", plan_type: "5yr", is_baseline: false, negotiation_status: "completed", satisfaction: 78 },
      { team_id: "team-1", plan_type: "3yr", is_baseline: false, negotiation_status: "completed", satisfaction: 100 },
      { team_id: "team-1", plan_type: "1yr", is_baseline: false, negotiation_status: "pending", satisfaction: 100 },
    ],
  });

  const unlocked = await checkAchievements({
    supabase,
    userId: "user-1",
  });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id),
    ["season_board_100"]
  );
});

test("checkAchievements tolerates missing public user row for login streak", async () => {
  const supabase = createAchievementSupabase({
    achievements: [
      { id: "auction_first_bid" },
      { id: "secret_streak_7" },
    ],
    teams: [{ id: "team-1", user_id: "auth-user-without-public-row" }],
    users: [],
    rider_watchlist: [],
    riders: [],
    auction_bids: [{ id: "bid-1", team_id: "team-1", amount: 100 }],
    auctions: [],
    transfer_offers: [],
    board_profiles: [],
  });

  const unlocked = await checkAchievements({
    supabase,
    userId: "auth-user-without-public-row",
  });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id),
    ["auction_first_bid"]
  );
});

test("getAchievementUnlocks does not re-unlock achievements that are already recorded", () => {
  const unlocked = getAchievementUnlocks({
    achievements: [
      { id: "transfer_first" },
      { id: "transfer_5" },
      { id: "team_5_achievements" },
    ],
    unlockedAchievementIds: ["transfer_first"],
    stats: {
      transferCount: 5,
    },
  });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id),
    ["transfer_5"]
  );
});
