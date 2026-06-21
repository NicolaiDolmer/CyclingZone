import { STAR_RIDER_MARKET_VALUE } from "./economyConstants.js";

const AUCTION_WIN_THRESHOLDS = [
  ["auction_first_win", 1],
  ["auction_5_wins", 5],
  ["auction_10_wins", 10],
  ["auction_25_wins", 25],
  ["auction_50_wins", 50],
];

const TRANSFER_THRESHOLDS = [
  ["transfer_first", 1],
  ["transfer_5", 5],
  ["transfer_15", 15],
  ["transfer_30", 30],
];

const TEAM_SIZE_THRESHOLDS = [
  ["team_15_riders", 15],
  ["team_20_riders", 20],
  ["team_25_riders", 25],
  ["team_30_riders", 30],
];

const LOGIN_STREAK_THRESHOLDS = [
  ["secret_streak_7", 7],
  ["secret_streak_30", 30],
];

// #1008: tæller-baserede achievements har en meningsfuld "X/Y mod næste mål"-progress.
// Tiered grupper (auktion/transfer/holdstørrelse/streak) viser KUN den næste ikke-nåede
// tier — ellers ville fx 7 auktionssejre vise 7/10, 7/25 og 7/50 på én gang (støj).
// Bool-achievements (sniper, high_roller, bargain, star ...) har ingen progress.
const PROGRESS_GROUPS = [
  { thresholds: AUCTION_WIN_THRESHOLDS, statKey: "auctionWinCount" },
  { thresholds: TRANSFER_THRESHOLDS, statKey: "transferCount" },
  { thresholds: TEAM_SIZE_THRESHOLDS, statKey: "riderCount" },
  { thresholds: LOGIN_STREAK_THRESHOLDS, statKey: "loginStreak" },
];

const SINGLE_PROGRESS = [
  ["transfer_buyer_10", 10, "transferBuyerCount"],
  ["transfer_seller_10", 10, "transferSellerCount"],
  ["secret_watchlist_50", 50, "watchlistCount"],
  ["season_board_100", 100, "boardSatisfaction"],
  ["team_5_achievements", 5, "__achievementCount"],
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readMany(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function readMaybeSingle(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || null;
}

function addThresholdUnlocks({ unlock, thresholds, value }) {
  for (const [achievementId, minimum] of thresholds) {
    unlock(achievementId, value >= minimum);
  }
}

export function getAchievementUnlocks({
  achievements,
  unlockedAchievementIds = [],
  stats = {},
}) {
  const achievementsById = new Map((achievements || []).map(achievement => [achievement.id, achievement]));
  const unlockedIds = new Set(unlockedAchievementIds);
  const newlyUnlocked = [];

  const unlock = (achievementId, shouldUnlock) => {
    if (!shouldUnlock || unlockedIds.has(achievementId)) return;
    const achievement = achievementsById.get(achievementId);
    if (!achievement) return;
    unlockedIds.add(achievementId);
    newlyUnlocked.push(achievement);
  };

  addThresholdUnlocks({
    unlock,
    thresholds: AUCTION_WIN_THRESHOLDS,
    value: stats.auctionWinCount || 0,
  });
  unlock("auction_first_bid", (stats.auctionBidCount || 0) >= 1);
  unlock("auction_high_roller", Boolean(stats.hasHighRollerBid));
  unlock("auction_sniper", Boolean(stats.hasAuctionSniper));
  unlock("auction_last_second", Boolean(stats.hasAuctionLastSecond));

  addThresholdUnlocks({
    unlock,
    thresholds: TRANSFER_THRESHOLDS,
    value: stats.transferCount || 0,
  });
  unlock("transfer_buyer_10", (stats.transferBuyerCount || 0) >= 10);
  unlock("transfer_seller_10", (stats.transferSellerCount || 0) >= 10);
  unlock("transfer_negotiator", Boolean(stats.hasNegotiatorTransfer));
  unlock("transfer_bargain", Boolean(stats.hasBargainTransfer));

  addThresholdUnlocks({
    unlock,
    thresholds: TEAM_SIZE_THRESHOLDS,
    value: stats.riderCount || 0,
  });
  unlock("team_youth", (stats.riderCount || 0) > 0 && (stats.u25RiderCount || 0) / stats.riderCount >= 0.5);
  unlock("team_star", Boolean(stats.hasStarRider));

  addThresholdUnlocks({
    unlock,
    thresholds: LOGIN_STREAK_THRESHOLDS,
    value: stats.loginStreak || 0,
  });
  unlock("secret_watchlist_50", (stats.watchlistCount || 0) >= 50);
  unlock("season_board_100", (stats.boardSatisfaction || 0) >= 100);
  // #817: definitionen fandtes i achievements-tabellen, men engine'en havde
  // ingen unlock-logik — kunne aldrig tildeles.
  unlock("season_first_result", Boolean(stats.hasRaceResult));

  // This meta-achievement should consider any achievements unlocked earlier in the same sync.
  unlock("team_5_achievements", unlockedIds.size >= 5);

  return newlyUnlocked;
}

// #1008: ren progress-beregning — returnerer { [achievementId]: { current, target } }
// for hver låst, tæller-baseret achievement der har en meningsfuld næste-mål-progress.
// Allerede nåede tiers udelades (de er låst op via getAchievementUnlocks).
export function computeAchievementProgress({ stats = {}, unlockedCount = 0 }) {
  const valueFor = (statKey) =>
    statKey === "__achievementCount" ? unlockedCount : toNumber(stats[statKey]);
  const progress = {};

  for (const { thresholds, statKey } of PROGRESS_GROUPS) {
    const value = valueFor(statKey);
    // thresholds er sorteret stigende — første ikke-nåede tier er næste mål.
    const next = thresholds.find(([, minimum]) => value < minimum);
    if (next) {
      progress[next[0]] = { current: value, target: next[1] };
    }
  }

  for (const [achievementId, target, statKey] of SINGLE_PROGRESS) {
    const value = valueFor(statKey);
    if (value < target) {
      progress[achievementId] = { current: value, target };
    }
  }

  return progress;
}

// #1008: async-wrapper der henter live-stats og udregner progress-mappet. Genbruger
// loadAchievementStats (samme kilder som checkAchievements), så progress matcher unlocks.
export async function getAchievementProgressMap({ supabase, userId, teamId, unlockedCount = 0 }) {
  const stats = await loadAchievementStats({ supabase, userId, teamId });
  return computeAchievementProgress({ stats, unlockedCount });
}

async function loadTeamId({ supabase, userId }) {
  const team = await readMaybeSingle(
    supabase.from("teams").select("id").eq("user_id", userId).maybeSingle()
  );
  return team?.id || null;
}

async function loadWatchlistCount({ supabase, userId }) {
  const rows = await readMany(
    supabase.from("rider_watchlist").select("id").eq("user_id", userId)
  );
  return rows.length;
}

async function loadLoginStreak({ supabase, userId }) {
  const user = await readMaybeSingle(
    supabase.from("users").select("login_streak").eq("id", userId).maybeSingle()
  );
  return toNumber(user?.login_streak);
}

async function loadTeamStats({ supabase, teamId }) {
  if (!teamId) {
    return {
      riderCount: 0,
      u25RiderCount: 0,
      hasStarRider: false,
      boardSatisfaction: 0,
    };
  }

  const [riders, boardProfiles] = await Promise.all([
    readMany(
      supabase.from("riders").select("id, is_u25, market_value").eq("team_id", teamId)
    ),
    readMany(
      supabase
        .from("board_profiles")
        .select("satisfaction, plan_type, negotiation_status, is_baseline")
        .eq("team_id", teamId)
    ),
  ]);
  const eligibleBoardProfiles = boardProfiles.filter(board =>
    !board.is_baseline
    && board.plan_type !== "baseline"
    && board.negotiation_status === "completed"
  );
  const boardSatisfaction = eligibleBoardProfiles.reduce(
    (max, board) => Math.max(max, toNumber(board.satisfaction)),
    0
  );

  return {
    riderCount: riders.length,
    u25RiderCount: riders.filter(rider => rider.is_u25).length,
    // #1205: stjernerytter = market_value >= delt konstant (før: dødt uci_points-tjek).
    hasStarRider: riders.some(rider => toNumber(rider.market_value) >= STAR_RIDER_MARKET_VALUE),
    boardSatisfaction,
  };
}

async function loadAuctionStats({ supabase, teamId }) {
  if (!teamId) {
    return {
      auctionBidCount: 0,
      hasHighRollerBid: false,
      auctionWinCount: 0,
      hasAuctionSniper: false,
      hasAuctionLastSecond: false,
    };
  }

  const [bids, wins] = await Promise.all([
    readMany(
      supabase.from("auction_bids").select("id, amount").eq("team_id", teamId)
    ),
    readMany(
      supabase
        .from("auctions")
        .select("id, starting_price, current_price, extension_count")
        .eq("current_bidder_id", teamId)
        .eq("status", "completed")
    ),
  ]);

  return {
    auctionBidCount: bids.length,
    hasHighRollerBid: bids.some(bid => toNumber(bid.amount) > 2000000000),
    auctionWinCount: wins.length,
    hasAuctionSniper: wins.some(auction => toNumber(auction.current_price) === toNumber(auction.starting_price)),
    hasAuctionLastSecond: wins.some(auction => toNumber(auction.extension_count) > 0),
  };
}

async function loadTransferStats({ supabase, teamId }) {
  if (!teamId) {
    return {
      transferCount: 0,
      transferBuyerCount: 0,
      transferSellerCount: 0,
      hasNegotiatorTransfer: false,
      hasBargainTransfer: false,
    };
  }

  const [buyerTransfers, sellerTransfers] = await Promise.all([
    readMany(
      supabase
        .from("transfer_offers")
        .select("id, rider_id, offer_amount, round")
        .eq("buyer_team_id", teamId)
        .eq("status", "accepted")
    ),
    readMany(
      supabase
        .from("transfer_offers")
        .select("id, rider_id, offer_amount, round")
        .eq("seller_team_id", teamId)
        .eq("status", "accepted")
    ),
  ]);

  const transferIds = new Set([
    ...buyerTransfers.map(transfer => transfer.id),
    ...sellerTransfers.map(transfer => transfer.id),
  ]);

  const riderIds = [...new Set(buyerTransfers.map(transfer => transfer.rider_id).filter(Boolean))];
  const riders = riderIds.length
    ? await readMany(
        supabase.from("riders").select("id, market_value").in("id", riderIds)
      )
    : [];
  const riderValueById = new Map(riders.map(rider => [rider.id, toNumber(rider.market_value)]));

  return {
    transferCount: transferIds.size,
    transferBuyerCount: buyerTransfers.length,
    transferSellerCount: sellerTransfers.length,
    hasNegotiatorTransfer: [...buyerTransfers, ...sellerTransfers].some(transfer => toNumber(transfer.round) >= 3),
    // #1205: kup = købt for under halvdelen af rytterens nuværende market_value
    // (før: CZ$ mod rå uci_points — reelt dødt efter 4000x-skaleringen).
    hasBargainTransfer: buyerTransfers.some(transfer => {
      const riderValue = riderValueById.get(transfer.rider_id);
      return riderValue > 0 && toNumber(transfer.offer_amount) < riderValue / 2;
    }),
  };
}

async function loadRaceResultStats({ supabase, teamId }) {
  if (!teamId) {
    return { hasRaceResult: false };
  }

  // Eksistens-tjek, ikke optælling — hold kan have mange hundrede resultater.
  const rows = await readMany(
    supabase.from("race_results").select("id").eq("team_id", teamId).limit(1)
  );
  return { hasRaceResult: rows.length > 0 };
}

async function loadAchievementStats({ supabase, userId, teamId }) {
  const [watchlistCount, loginStreak, teamStats, auctionStats, transferStats, raceResultStats] = await Promise.all([
    loadWatchlistCount({ supabase, userId }),
    loadLoginStreak({ supabase, userId }),
    loadTeamStats({ supabase, teamId }),
    loadAuctionStats({ supabase, teamId }),
    loadTransferStats({ supabase, teamId }),
    loadRaceResultStats({ supabase, teamId }),
  ]);

  return {
    watchlistCount,
    loginStreak,
    ...teamStats,
    ...auctionStats,
    ...transferStats,
    ...raceResultStats,
  };
}

export async function checkAchievements({
  supabase,
  userId,
}) {
  const [achievements, unlockedRows, teamId] = await Promise.all([
    readMany(supabase.from("achievements").select("*")),
    readMany(
      supabase.from("manager_achievements").select("achievement_id").eq("user_id", userId)
    ),
    loadTeamId({ supabase, userId }),
  ]);

  const unlockedAchievementIds = unlockedRows.map(row => row.achievement_id);
  const stats = await loadAchievementStats({ supabase, userId, teamId });
  const newlyUnlocked = getAchievementUnlocks({
    achievements,
    unlockedAchievementIds,
    stats,
  });

  const insertedAchievements = [];
  for (const achievement of newlyUnlocked) {
    const { error } = await supabase.from("manager_achievements").insert({
      user_id: userId,
      achievement_id: achievement.id,
      unlocked_at: new Date().toISOString(),
    });

    if (!error) {
      insertedAchievements.push(achievement);
    }
  }

  return insertedAchievements;
}
