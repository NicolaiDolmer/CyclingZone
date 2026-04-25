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

  // This meta-achievement should consider any achievements unlocked earlier in the same sync.
  unlock("team_5_achievements", unlockedIds.size >= 5);

  return newlyUnlocked;
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
    supabase.from("users").select("login_streak").eq("id", userId).single()
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

  const [riders, boardProfile] = await Promise.all([
    readMany(
      supabase.from("riders").select("id, is_u25, uci_points").eq("team_id", teamId)
    ),
    readMaybeSingle(
      supabase.from("board_profiles").select("satisfaction").eq("team_id", teamId).maybeSingle()
    ),
  ]);

  return {
    riderCount: riders.length,
    u25RiderCount: riders.filter(rider => rider.is_u25).length,
    hasStarRider: riders.some(rider => toNumber(rider.uci_points) > 50000),
    boardSatisfaction: toNumber(boardProfile?.satisfaction),
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
        supabase.from("riders").select("id, uci_points").in("id", riderIds)
      )
    : [];
  const riderPointsById = new Map(riders.map(rider => [rider.id, toNumber(rider.uci_points)]));

  return {
    transferCount: transferIds.size,
    transferBuyerCount: buyerTransfers.length,
    transferSellerCount: sellerTransfers.length,
    hasNegotiatorTransfer: [...buyerTransfers, ...sellerTransfers].some(transfer => toNumber(transfer.round) >= 3),
    hasBargainTransfer: buyerTransfers.some(transfer => {
      const riderPoints = riderPointsById.get(transfer.rider_id);
      return riderPoints > 0 && toNumber(transfer.offer_amount) < riderPoints / 2;
    }),
  };
}

async function loadAchievementStats({ supabase, userId, teamId }) {
  const [watchlistCount, loginStreak, teamStats, auctionStats, transferStats] = await Promise.all([
    loadWatchlistCount({ supabase, userId }),
    loadLoginStreak({ supabase, userId }),
    loadTeamStats({ supabase, teamId }),
    loadAuctionStats({ supabase, teamId }),
    loadTransferStats({ supabase, teamId }),
  ]);

  return {
    watchlistCount,
    loginStreak,
    ...teamStats,
    ...auctionStats,
    ...transferStats,
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
