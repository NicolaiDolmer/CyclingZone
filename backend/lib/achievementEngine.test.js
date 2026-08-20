import test from "node:test";
import assert from "node:assert/strict";

import {
  checkAchievements,
  getAchievementUnlocks,
  computeAchievementProgress,
} from "./achievementEngine.js";
import { STAR_RIDER_MARKET_VALUE } from "./economyConstants.js";

// #3953: `flaky` lader en enkelt tabel fejle et fast antal gange, før den
// lykkes (eller aldrig lykkes, hvis failCount er højere end antal forsøg) —
// bruges til at teste at readMany/readMaybeSingle retry'er via withSupabaseRetry.
// attemptCounts tælles i `state`, IKKE i createSelectQuery-closuren: hver
// forsøg genopbygger query'en fra bunden (samme grund til at call-sites nu
// sender en factory-funktion i stedet for et allerede-awaited query-objekt).
function createAchievementSupabase(initialState, { flaky = {} } = {}) {
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
    race_results: (initialState.race_results || []).map(row => ({ ...row })),
    // #2917 · sæson-achievements
    season_standings: (initialState.season_standings || []).map(row => ({ ...row })),
    seasons: (initialState.seasons || []).map(row => ({ ...row })),
    races: (initialState.races || []).map(row => ({ ...row })),
    race_entries: (initialState.race_entries || []).map(row => ({ ...row })),
    inserts: [],
    attemptCounts: {},
  };

  function resolveOutcome(table, successData) {
    const flakyConfig = flaky[table];
    if (!flakyConfig) return { data: successData, error: null };
    state.attemptCounts[table] = (state.attemptCounts[table] || 0) + 1;
    if (state.attemptCounts[table] <= flakyConfig.failCount) {
      return { data: null, error: flakyConfig.error };
    }
    return { data: successData, error: null };
  }

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
      // #2917: Grand Tour-opslaget filtrerer på `stages >= GRAND_TOUR_MIN_STAGES`.
      gte(column, value) {
        filtered = filtered.filter(row => Number(row[column]) >= Number(value));
        return query;
      },
      limit(count) {
        filtered = filtered.slice(0, count);
        return query;
      },
      maybeSingle() {
        if (filtered.length > 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned" },
          });
        }
        return Promise.resolve(resolveOutcome(table, filtered[0] || null));
      },
      single() {
        if (filtered.length !== 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned" },
          });
        }
        return Promise.resolve(resolveOutcome(table, filtered[0] || null));
      },
      then(resolve, reject) {
        return Promise.resolve(resolveOutcome(table, filtered)).then(resolve, reject);
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
      // #1205/#1210: stjernerytter = market_value >= STAR_RIDER_MARKET_VALUE.
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `team-rider-${index}`,
        team_id: "team-1",
        is_u25: index < 8,
        market_value: index === 0 ? STAR_RIDER_MARKET_VALUE : 100_000,
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

// #817: definitionen fandtes i prod-DB, men engine'en manglede unlock-logik.
test("checkAchievements unlocks season_first_result when the team has a race result", async () => {
  const supabase = createAchievementSupabase({
    achievements: [
      { id: "season_first_result" },
    ],
    teams: [{ id: "team-1", user_id: "user-1" }],
    users: [{ id: "user-1", login_streak: 0 }],
    rider_watchlist: [],
    riders: [],
    auction_bids: [],
    auctions: [],
    transfer_offers: [],
    board_profiles: [],
    race_results: [
      { id: "result-1", team_id: "team-1", rank: 57 },
      { id: "result-2", team_id: "team-1", rank: 12 },
      { id: "result-other", team_id: "team-2", rank: 1 },
    ],
  });

  const unlocked = await checkAchievements({
    supabase,
    userId: "user-1",
  });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id),
    ["season_first_result"]
  );
});

test("checkAchievements does not unlock season_first_result without a race result", async () => {
  const supabase = createAchievementSupabase({
    achievements: [
      { id: "season_first_result" },
    ],
    teams: [{ id: "team-1", user_id: "user-1" }],
    users: [{ id: "user-1", login_streak: 0 }],
    rider_watchlist: [],
    riders: [],
    auction_bids: [],
    auctions: [],
    transfer_offers: [],
    board_profiles: [],
    race_results: [
      { id: "result-other", team_id: "team-2", rank: 1 },
    ],
  });

  const unlocked = await checkAchievements({
    supabase,
    userId: "user-1",
  });

  assert.deepEqual(unlocked, []);
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

// #2917: 13 sæson-achievements var defineret + synlige, men uden unlock-logik.
const SEASON_ACHIEVEMENT_DEFS = [
  { id: "season_top10" }, { id: "season_top5" }, { id: "season_top3" },
  { id: "season_winner" }, { id: "season_div1_winner" }, { id: "season_div3_winner" },
  { id: "season_3_top3" }, { id: "season_2_seasons" }, { id: "season_5_seasons" },
  { id: "team_promotion" }, { id: "team_relegation" }, { id: "team_survived" },
  { id: "season_grand_tour_rider" },
];

function seasonPool({ seasonId, poolId, division, size, ownTeamId, ownRank }) {
  return Array.from({ length: size }, (_, index) => ({
    season_id: seasonId,
    league_division_id: poolId,
    division,
    rank_in_division: index + 1,
    team_id: index + 1 === ownRank ? ownTeamId : `filler-${seasonId}-${poolId}-${index}`,
  }));
}

function seasonAchievementSupabase({ ownRank, currentDivision, seasonStatus = "completed", extra = {} }) {
  return createAchievementSupabase({
    achievements: SEASON_ACHIEVEMENT_DEFS,
    teams: [{ id: "team-1", user_id: "user-1", division: currentDivision }],
    users: [{ id: "user-1", login_streak: 0 }],
    rider_watchlist: [],
    riders: [],
    auction_bids: [],
    auctions: [],
    transfer_offers: [],
    board_profiles: [],
    seasons: [{ id: "season-1", number: 1, status: seasonStatus }],
    season_standings: seasonPool({
      seasonId: "season-1", poolId: 4, division: 3, size: 24, ownTeamId: "team-1", ownRank,
    }),
    ...extra,
  });
}

test("checkAchievements unlocks placering + oprykning for en puljevinder", async () => {
  const supabase = seasonAchievementSupabase({ ownRank: 1, currentDivision: 2 });

  const unlocked = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(
    unlocked.map(achievement => achievement.id).sort(),
    ["season_div3_winner", "season_top10", "season_top3", "season_top5", "season_winner", "team_promotion"]
  );
});

test("checkAchievements unlocks team_relegation men ikke team_survived ved nedrykning", async () => {
  const supabase = seasonAchievementSupabase({ ownRank: 22, currentDivision: 4 });

  const unlocked = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(unlocked.map(achievement => achievement.id).sort(), ["team_relegation"]);
});

test("checkAchievements unlocks team_survived i farezonen uden nedrykning", async () => {
  const supabase = seasonAchievementSupabase({ ownRank: 19, currentDivision: 3 });

  const unlocked = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(unlocked.map(achievement => achievement.id).sort(), ["team_survived"]);
});

test("checkAchievements tildeler ingen sæson-achievements mens sæsonen kører", async () => {
  const supabase = seasonAchievementSupabase({ ownRank: 1, currentDivision: 3, seasonStatus: "active" });

  const unlocked = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(unlocked, []);
});

test("checkAchievements unlocks season_grand_tour_rider ved en entry i et ≥15-etapers løb", async () => {
  const supabase = seasonAchievementSupabase({
    ownRank: 12,
    currentDivision: 3,
    extra: {
      races: [
        { id: "race-gt", stages: 21 },
        { id: "race-classic", stages: 1 },
      ],
      race_entries: [
        { id: "entry-1", team_id: "team-1", race_id: "race-gt" },
        { id: "entry-2", team_id: "team-2", race_id: "race-gt" },
      ],
    },
  });

  const unlocked = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(unlocked.map(a => a.id).sort(), ["season_grand_tour_rider"]);
});

test("checkAchievements unlocks ikke season_grand_tour_rider for et kort etapeløb", async () => {
  const supabase = seasonAchievementSupabase({
    ownRank: 12,
    currentDivision: 3,
    extra: {
      races: [{ id: "race-short", stages: 5 }],
      race_entries: [{ id: "entry-1", team_id: "team-1", race_id: "race-short" }],
    },
  });

  const unlocked = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(unlocked, []);
});

// #1008: progress mod næste mål.
test("computeAchievementProgress reports only the next tier for tiered groups", () => {
  const progress = computeAchievementProgress({
    stats: { auctionWinCount: 40 },
  });
  // 40 har nået 1/5/10/25, så næste (eneste) mål er 50.
  assert.deepEqual(progress.auction_50_wins, { current: 40, target: 50 });
  assert.equal(progress.auction_25_wins, undefined);
  assert.equal(progress.auction_10_wins, undefined);
});

test("computeAchievementProgress picks the lowest unreached tier", () => {
  const progress = computeAchievementProgress({
    stats: { transferCount: 7 },
  });
  assert.deepEqual(progress.transfer_15, { current: 7, target: 15 });
  assert.equal(progress.transfer_5, undefined);
});

test("computeAchievementProgress omits groups where all tiers are reached", () => {
  const progress = computeAchievementProgress({
    stats: { riderCount: 30 },
  });
  assert.equal(progress.team_30_riders, undefined);
});

test("computeAchievementProgress reports single-threshold and meta progress", () => {
  const progress = computeAchievementProgress({
    stats: { transferBuyerCount: 4, watchlistCount: 12, boardSatisfaction: 80 },
    unlockedCount: 3,
  });
  assert.deepEqual(progress.transfer_buyer_10, { current: 4, target: 10 });
  assert.deepEqual(progress.secret_watchlist_50, { current: 12, target: 50 });
  assert.deepEqual(progress.season_board_100, { current: 80, target: 100 });
  assert.deepEqual(progress.team_5_achievements, { current: 3, target: 5 });
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

// ── #3953: readMany/readMaybeSingle går gennem withSupabaseRetry ────────────
//
// Fixturen er lavet efter samme opskrift som supabaseErrorNormalize.test.js
// (CF_525): en forkortet, men realistisk Cloudflare-fejlside som den lander i
// error.message når PostgREST/supabase-js får et non-JSON-svar fra gatewayen.
const CF_525 = `<!DOCTYPE html>
<html class="no-js" lang="en-US"><head>
<title>supabase.co | 525: SSL handshake failed</title>
</head><body><div id="cf-error-details">
<span class="inline-block">SSL handshake failed</span>
<span class="code-label">Error code 525</span>
</div></body></html>`;

// checkAchievements henter "teams" (readMaybeSingle via loadTeamId) og
// "achievements"/"manager_achievements" (readMany) FØR resten af stats-loaderne
// kører — med tom season_standings-state rammes "teams" kun denne ene gang, så
// den er et rent mål for retry-adfærden uden at bygge en fuld stats-fixture.
test("#3953 transient 525 fejler paa forsoeg 1, lykkes paa forsoeg 2 (readMaybeSingle)", async () => {
  const supabase = createAchievementSupabase(
    {
      achievements: [],
      manager_achievements: [],
      teams: [{ id: "team-1", user_id: "user-1" }],
    },
    { flaky: { teams: { failCount: 1, error: { message: CF_525 } } } }
  );

  const insertedAchievements = await checkAchievements({ supabase, userId: "user-1" });

  assert.deepEqual(insertedAchievements, []);
  assert.equal(supabase.state.attemptCounts.teams, 2, "skal lykkes på forsøg 2, ikke flere");
});

test("#3953 ikke-transient fejl kastes straks uden retry (readMany)", async () => {
  const supabase = createAchievementSupabase(
    {
      achievements: [{ id: "auction_first_bid" }],
      manager_achievements: [],
      teams: [{ id: "team-1", user_id: "user-1" }],
    },
    {
      flaky: {
        manager_achievements: {
          failCount: 999,
          error: { message: 'permission denied for table "manager_achievements"' },
        },
      },
    }
  );

  await assert.rejects(
    () => checkAchievements({ supabase, userId: "user-1" }),
    /permission denied for table "manager_achievements"/
  );
  assert.equal(supabase.state.attemptCounts.manager_achievements, 1, "ikke-transient fejl må IKKE retry'es");
});

test("#3953 beskedstreng ved endelig fejl er uændret ift. før PR'en (samme normaliserede format)", async () => {
  const supabase = createAchievementSupabase(
    {
      achievements: [],
      manager_achievements: [],
      teams: [{ id: "team-1", user_id: "user-1" }],
    },
    { flaky: { teams: { failCount: 999, error: { message: CF_525 } } } }
  );

  // Før PR'en (ingen retry) ville readMaybeSingle kaste
  // `new Error(normalizeSupabaseErrorMessage(error.message))` med det samme —
  // dvs. netop denne normaliserede besked. Testen verificerer at formatet er
  // uændret, selvom der nu sker 2 retries først (attemptCounts.teams === 3).
  await assert.rejects(
    () => checkAchievements({ supabase, userId: "user-1" }),
    (error) => {
      assert.equal(error.message, "Supabase unavailable (525 SSL handshake failed)");
      return true;
    }
  );
  assert.equal(supabase.state.attemptCounts.teams, 3, "1 forsøg + 2 retries, alle mislykkede");
});
