/**
 * Cycling Zone Manager — Backend API Routes
 * ==========================================
 * Express router covering:
 *   /api/auctions   — create, bid, list, finalize
 *   /api/finance    — manager loans and balance flows
 *   /api/transfers  — list, offer, negotiate
 *   /api/teams      — team info, squad, finances
 *   /api/admin      — season, races, overrides
 */

import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  calculateAuctionEnd,
  checkBidExtension,
  isAuctionExpired,
} from "../lib/auctionEngine.js";
import {
  getAuctionBidIssue,
  getAuctionInitialBidderId,
} from "../lib/auctionRules.js";
import {
  finalizeAuctionById,
  finalizeExpiredAuctions as finalizeExpiredAuctionsShared,
} from "../lib/auctionFinalization.js";
import {
  createLoan,
  repayLoan,
  getLoanConfig,
  getTotalDebt,
} from "../lib/loanEngine.js";
import {
  notifyTeamOwner as notifyTeamOwnerShared,
  notifyUser as notifyUserShared,
} from "../lib/notificationService.js";
import {
  notifyNewAuction,
  notifyOutbid,
  notifyAuctionWon,
  notifyTransferOffer,
  notifyTransferResponse,
  notifyTransferCompleted,
  notifySwapCompleted,
  notifySeasonEvent,
  sendTestEmbed,
} from "../lib/discordNotifier.js";
import { handleDynCyclistSyncRequest } from "../lib/dynCyclistSync.js";
import { syncRaceResultsFromSheets } from "../lib/raceResultsSheetSync.js";
import {
  buildSeasonEndPreviewRows,
  loadHumanSeasonEndTeams,
  processSeasonEnd,
  processSeasonStart,
  repairSeasonEndFinanceAndBoard,
  updateStandings,
} from "../lib/economyEngine.js";
import {
  BOARD_IDENTITY_RIDER_SELECT,
  buildBoardRequestOptions,
  buildBoardOutlook,
  buildBoardProposal,
  deriveTeamIdentityProfile,
  finalizeBoardGoals,
  getBoardRequestDefinition,
  getPlanDuration,
  inferNegotiationIndexesFromGoals,
  isValidBoardFocus,
  isValidBoardPlanType,
  isValidBoardRequestType,
  resolveBoardRequest,
} from "../lib/boardEngine.js";
import {
  confirmSwapOffer,
  confirmTransferOffer,
  flushWindowPendingOffers,
  getSwapCancelIssue,
  getTransferCancelIssue,
} from "../lib/transferExecution.js";
import {
  getIncomingSquadViolation,
  getTeamMarketState,
  MIN_RIDERS_FOR_RACE,
} from "../lib/marketUtils.js";
import {
  applyRaceResults,
  buildRacePrizeLookup,
  buildRaceResultsFromPending,
} from "../lib/raceResultsEngine.js";
import { createAdminImportResultsHandler } from "../lib/adminImportResultsHandler.js";
import { checkAchievements } from "../lib/achievementEngine.js";
import { upsertOwnTeamProfile } from "../lib/teamProfileEngine.js";
import {
  cancelBetaMarket,
  resetBetaAchievements,
  resetBetaBalances,
  resetBetaBoardProfiles,
  resetBetaDivisions,
  resetBetaManagerProgress,
  resetBetaRaceCalendar,
  resetBetaRosters,
  resetBetaSeasons,
  runFullBetaReset,
} from "../lib/betaResetService.js";

// Load .env from backend root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const router = express.Router();
const adminImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = file.mimetype.includes("spreadsheet") || file.originalname.endsWith(".xlsx");
    cb(null, ok);
  },
});


// Log to public activity feed
async function logActivity(type, data = {}) {
  try {
    await supabase.from("activity_feed").insert({
      type,
      team_id: data.team_id || null,
      team_name: data.team_name || null,
      rider_id: data.rider_id || null,
      rider_name: data.rider_name || null,
      amount: data.amount || null,
      meta: data.meta || {},
    });
  } catch (e) { /* silent — never block main flow */ }
}

// XP amounts for different actions
const XP_REWARDS = {
  bid_placed: 2,
  auction_won: 15,
  auction_sold: 10,
  transfer_offer_sent: 3,
  transfer_accepted: 10,
};

async function awardXP(userId, action) {
  if (!userId || !XP_REWARDS[action]) return;
  const amount = XP_REWARDS[action];
  try {
    // Get current XP and level
    const { data: user } = await supabase.from("users").select("xp, level").eq("id", userId).single();
    if (!user) return;
    const newXp = (user.xp || 0) + amount;
    const newLevel = Math.min(50, Math.floor(newXp / 100) + 1);
    await supabase.from("users").update({ xp: newXp, level: newLevel }).eq("id", userId);
    await supabase.from("xp_log").insert({ user_id: userId, amount, reason: action });
  } catch (e) { /* silent fail */ }
}



// Supabase admin client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function ensureSeasonStandings(seasonId) {
  const [{ data: teams, error: teamsError }, { data: standings, error: standingsError }] = await Promise.all([
    supabase.from("teams").select("id, division"),
    supabase.from("season_standings").select("team_id").eq("season_id", seasonId),
  ]);

  if (teamsError) throw new Error(teamsError.message);
  if (standingsError) throw new Error(standingsError.message);

  const existingTeamIds = new Set((standings || []).map(row => row.team_id));
  const missingRows = (teams || [])
    .filter(team => !existingTeamIds.has(team.id))
    .map(team => ({
      season_id: seasonId,
      team_id: team.id,
      division: team.division,
    }));

  if (missingRows.length > 0) {
    const { error: insertError } = await supabase.from("season_standings").insert(missingRows);
    if (insertError) throw new Error(insertError.message);
  }

  return {
    created: missingRows.length,
    total_teams: (teams || []).length,
  };
}

async function createRaceRecord(payload) {
  const { data, error } = await supabase.from("races").insert(payload).select("*").single();

  if (!error) return { data, error: null };

  if (Object.prototype.hasOwnProperty.call(payload, "race_class") && error.message?.includes("race_class")) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.race_class;
    return await supabase.from("races").insert(fallbackPayload).select("*").single();
  }

  return { data: null, error };
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });

  // Fetch team for this user
  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("user_id", user.id)
    .single();

  req.user = user;
  req.team = team;
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: u } = await supabase
      .from("users")
      .select("role")
      .eq("id", req.user.id)
      .single();
    if (u?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    next();
  });
}

// ── Notification helper ───────────────────────────────────────────────────────

async function notify(userId, type, title, message, relatedId = null) {
  await notifyUserShared({
    supabase,
    userId,
    type,
    title,
    message,
    relatedId,
  });
}

async function notifyTeamOwner(teamId, type, title, message, relatedId = null) {
  await notifyTeamOwnerShared({
    supabase,
    teamId,
    type,
    title,
    message,
    relatedId,
  });
}

async function awardTeamOwnerXP(teamId, action) {
  if (!teamId) return;
  const { data: team } = await supabase
    .from("teams")
    .select("user_id")
    .eq("id", teamId)
    .single();
  if (team?.user_id) {
    await awardXP(team.user_id, action);
  }
}

// ── Transfer window helper ────────────────────────────────────────────────────

async function getTransferWindowStatus() {
  const { data: tw } = await supabase
    .from("transfer_windows").select("status, season_id")
    .order("created_at", { ascending: false }).limit(1).single();
  return { open: tw?.status === "open", window: tw || null };
}

// GET /api/transfer-window — current window status (public, auth required)
router.get("/transfer-window", requireAuth, async (req, res) => {
  const { open, window: tw } = await getTransferWindowStatus();
  res.json({ open, status: tw?.status || "closed", season_id: tw?.season_id || null });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RIDERS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/riders — search and filter riders
router.get("/riders", requireAuth, async (req, res) => {
  const {
    q, team_id, free_agent, u25, min_uci, max_uci,
    sort = "uci_points", order = "desc",
    page = 1, limit = 50,
  } = req.query;

  let query = supabase
    .from("riders")
    .select(`
      id, pcm_id, firstname, lastname, birthdate, uci_points, price,
      salary, is_u25, nationality_code, popularity,
      stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
      stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
      stat_res, stat_ftr,
      team:team_id(id, name)
    `, { count: "exact" });

  if (q) {
    query = query.or(
      `firstname.ilike.%${q}%,lastname.ilike.%${q}%`
    );
  }
  if (team_id) query = query.eq("team_id", team_id);
  if (free_agent === "true") query = query.is("team_id", null);
  if (u25 === "true") query = query.eq("is_u25", true);
  if (min_uci) query = query.gte("uci_points", parseInt(min_uci));
  if (max_uci) query = query.lte("uci_points", parseInt(max_uci));

  const allowedSort = ["uci_points", "stat_bj", "stat_sp", "stat_tt",
                       "stat_fl", "lastname", "birthdate"];
  const safeSort = allowedSort.includes(sort) ? sort : "uci_points";
  query = query
    .order(safeSort, { ascending: order === "asc" })
    .range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ riders: data, total: count, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/riders/:id — single rider detail
router.get("/riders/:id", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("riders")
    .select(`*, team:team_id(id, name)`)
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Rider not found" });
  res.json(data);
});

// GET /api/riders/:id/history — ejerskab og handelshistorik
router.get("/riders/:id/history", requireAuth, async (req, res) => {
  const { id } = req.params;

  const [auctionsRes, offersRes, swapsRes, loansRes] = await Promise.all([
    supabase.from("auctions")
      .select("id, current_price, actual_end, created_at, is_guaranteed_sale, seller:seller_team_id(id, name, is_ai), winner:current_bidder_id(id, name)")
      .eq("rider_id", id)
      .eq("status", "completed")
      .order("actual_end", { ascending: false }),

    supabase.from("transfer_offers")
      .select("id, offer_amount, counter_amount, status, updated_at, buyer:buyer_team_id(id, name), seller:seller_team_id(id, name)")
      .eq("rider_id", id)
      .in("status", ["accepted", "window_pending"])
      .order("updated_at", { ascending: false }),

    supabase.from("swap_offers")
      .select("id, cash_adjustment, counter_cash, status, updated_at, offered_rider_id, requested_rider_id, proposing:proposing_team_id(id, name), receiving:receiving_team_id(id, name)")
      .or(`offered_rider_id.eq.${id},requested_rider_id.eq.${id}`)
      .in("status", ["accepted", "window_pending"])
      .order("updated_at", { ascending: false }),

    supabase.from("loan_agreements")
      .select("id, loan_fee, start_season, end_season, status, created_at, updated_at, from_team:from_team_id(id, name), to_team:to_team_id(id, name)")
      .eq("rider_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const events = [];

  for (const a of auctionsRes.data || []) {
    events.push({
      type: "auction",
      date: a.actual_end || a.created_at,
      price: a.current_price,
      seller: a.seller,
      buyer: a.winner,
      is_ai_sale: a.seller?.is_ai ?? false,
      is_guaranteed_sale: a.is_guaranteed_sale,
    });
  }

  for (const o of offersRes.data || []) {
    events.push({
      type: "transfer",
      date: o.updated_at,
      price: o.counter_amount ?? o.offer_amount,
      seller: o.seller,
      buyer: o.buyer,
    });
  }

  for (const s of swapsRes.data || []) {
    const cashAdj = s.counter_cash ?? s.cash_adjustment;
    events.push({
      type: "swap",
      date: s.updated_at,
      cash_adjustment: cashAdj,
      proposing_team: s.proposing,
      receiving_team: s.receiving,
      rider_role: s.offered_rider_id === id ? "offered" : "requested",
    });
  }

  for (const l of loansRes.data || []) {
    events.push({
      type: "loan",
      date: l.created_at,
      loan_fee: l.loan_fee,
      start_season: l.start_season,
      end_season: l.end_season,
      status: l.status,
      from_team: l.from_team,
      to_team: l.to_team,
    });
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json(events);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/auctions — list active auctions
router.get("/auctions", requireAuth, async (req, res) => {
  const { status = "active" } = req.query;

  const { data, error } = await supabase
    .from("auctions")
    .select(`
      id, starting_price, current_price, calculated_end, actual_end,
      status, extension_count, created_at, is_guaranteed_sale,
      rider:rider_id(id, firstname, lastname, uci_points, is_u25,
        stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
        stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
        stat_res, stat_ftr),
      seller:seller_team_id(id, name),
      current_bidder:current_bidder_id(id, name)
    `)
    .eq("status", status)
    .order("calculated_end", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/auctions — start new auction
router.post("/auctions", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });

  const { rider_id, starting_price, min_increment = 1, is_guaranteed_sale = false } = req.body;
  if (!rider_id) return res.status(400).json({ error: "rider_id required" });

  // Verify rider belongs to this team
  const { data: rider } = await supabase
    .from("riders")
    .select("id, firstname, lastname, team_id, uci_points")
    .eq("id", rider_id)
    .single();

  if (!rider) return res.status(404).json({ error: "Rider not found" });

  // Allow auction if:
  // 1. Rider is on manager's own team, OR
  // 2. Rider is a free agent (no team_id) — AI/unowned rider
  // Block if rider belongs to another manager's team
  if (rider.team_id && rider.team_id !== req.team.id) {
    // Check if the owning team is a human team
    const { data: owningTeam } = await supabase
      .from("teams")
      .select("is_ai, user_id")
      .eq("id", rider.team_id)
      .single();
    // If owned by a human manager (not AI), block the auction
    if (owningTeam && !owningTeam.is_ai && owningTeam.user_id) {
      return res.status(403).json({ error: "Denne rytter tilhører en anden manager" });
    }
  }

  // Check no active auction for this rider
  const { data: existing } = await supabase
    .from("auctions")
    .select("id")
    .eq("rider_id", rider_id)
    .in("status", ["active", "extended"])
    .single();

  if (existing) {
    return res.status(409).json({ error: "Rider already has an active auction" });
  }

  const riderValue = Math.max(rider.uci_points * 4000, 1);

  if (is_guaranteed_sale && rider.team_id !== req.team.id) {
    return res.status(403).json({ error: "Garanteret salg kan kun bruges på dine egne ryttere" });
  }

  if (!is_guaranteed_sale && starting_price && starting_price < riderValue) {
    return res.status(400).json({ error: `Startpris skal mindst matche rytterens Værdi (${riderValue.toLocaleString("da-DK")} CZ$)` });
  }

  const guaranteedPrice = is_guaranteed_sale ? Math.floor(riderValue * 0.5) : null;
  const price = is_guaranteed_sale
    ? guaranteedPrice
    : (starting_price || riderValue);
  const calculatedEnd = calculateAuctionEnd(new Date());
  const initialBidderId = getAuctionInitialBidderId({
    riderTeamId: rider.team_id,
    managerTeamId: req.team.id,
    isGuaranteedSale: is_guaranteed_sale,
  });

  if (initialBidderId) {
    const [leadingAuctions, teamState] = await Promise.all([
      supabase
        .from("auctions")
        .select("id, current_price")
        .in("status", ["active", "extended"])
        .eq("current_bidder_id", initialBidderId),
      getTeamMarketState(supabase, initialBidderId),
    ]);
    const activeLeading = leadingAuctions.data || [];
    const totalCommitment = activeLeading.reduce((sum, row) => sum + (Number(row.current_price) || 0), 0) + price;
    if ((Number(teamState.balance) || 0) < totalCommitment) {
      return res.status(400).json({ error: "Startbuddet overstiger din disponible balance inkl. aktive auktionsføringer" });
    }

    const maxRiders = teamState.squad_limits?.max;
    if (maxRiders && (teamState.total_count || 0) + activeLeading.length + 1 > maxRiders) {
      return res.status(400).json({
        error: `Dit hold kan max have ${maxRiders} ryttere inkl. aktive auktionsføringer`,
      });
    }
  }

  const { data: auction, error } = await supabase
    .from("auctions")
    .insert({
      rider_id,
      // Active auction UI/history still uses seller_team_id as the initiator.
      // The shared finalizer resolves the actual economic seller from rider.team_id.
      seller_team_id: req.team.id,
      starting_price: price,
      current_price: price,
      current_bidder_id: initialBidderId,
      min_increment,
      calculated_end: calculatedEnd.toISOString(),
      is_guaranteed_sale,
      guaranteed_price: guaranteedPrice,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (initialBidderId) {
    await supabase.from("auction_bids").insert({
      auction_id: auction.id,
      team_id: initialBidderId,
      amount: price,
      bid_time: new Date().toISOString(),
      triggered_extension: false,
    });
  }

  // Log to activity feed
  await logActivity("auction_started", {
    team_id: req.team.id,
    team_name: req.team.name,
    rider_id: rider.id,
    rider_name: `${rider.firstname} ${rider.lastname}`,
    amount: price,
  });

  notifyNewAuction({
    riderName: `${rider.firstname} ${rider.lastname}`,
    riderUci: rider.uci_points,
    sellerName: req.team.name,
    startPrice: price,
    endsAt: calculatedEnd.toISOString(),
  }).catch(() => {});

  // Notify watchlist users that this rider is up for auction
  const riderFullName = `${rider.firstname} ${rider.lastname}`;
  ;(async () => {
    const { data: watchers } = await supabase
      .from("rider_watchlist").select("user_id")
      .eq("rider_id", rider_id).neq("user_id", req.user.id);
    if (watchers?.length) {
      await Promise.all(watchers.map(w =>
        notify(w.user_id, "watchlist_rider_listed", "Ønskeliste-rytter til auktion",
          `${riderFullName} er sat til auktion (startpris ${price.toLocaleString("da-DK")} CZ$)`,
          auction.id).catch(() => {})
      ));
    }
  })().catch(() => {});

  res.status(201).json({
    auction,
    message: `Auktion startet — slutter ${calculatedEnd.toLocaleString("da-DK")}`,
  });
});

// POST /api/auctions/:id/bid — place a bid
router.post("/auctions/:id/bid", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });

  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: "amount required" });

  // Fetch auction
  const { data: auction } = await supabase
    .from("auctions")
    .select("*, rider:rider_id(firstname, lastname, team_id)")
    .eq("id", req.params.id)
    .single();

  if (!auction) return res.status(404).json({ error: "Auction not found" });
  if (!["active", "extended"].includes(auction.status)) {
    return res.status(400).json({ error: "Auction is not active" });
  }
  if (isAuctionExpired(auction.calculated_end)) {
    return res.status(400).json({ error: "Auction has ended" });
  }
  // Allow bidding on own auction ONLY for AI/free rider auctions
  // Block bidding on own auction if selling your own team's rider
  if (auction.seller_team_id === req.team.id) {
    const { data: auctionRider } = await supabase
      .from("riders").select("team_id").eq("id", auction.rider_id).single();
    if (auctionRider?.team_id === req.team.id) {
      return res.status(400).json({ error: "Du kan ikke byde på din egen rytter" });
    }
  }
  const [leadingAuctions, teamState] = await Promise.all([
    supabase
      .from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", req.team.id),
    getTeamMarketState(supabase, req.team.id),
  ]);
  const activeLeading = leadingAuctions.data || [];
  const activeLeadingExceptCurrent = activeLeading.filter(row => row.id !== auction.id);
  const bidIssue = getAuctionBidIssue({
    amount,
    currentPrice: auction.current_price,
    teamBalance: req.team.balance,
    reservedBalance: activeLeadingExceptCurrent.reduce((sum, row) => sum + (Number(row.current_price) || 0), 0),
    teamState,
    activeLeadingCount: activeLeadingExceptCurrent.length,
    alreadyLeadingThisAuction: auction.current_bidder_id === req.team.id,
  });

  if (bidIssue?.code === "bid_below_minimum") {
    return res.status(400).json({
      error: `Minimum bid: ${bidIssue.minimumBid.toLocaleString("da-DK")} CZ$`,
    });
  }

  if (bidIssue?.code === "insufficient_available_balance") {
    return res.status(400).json({ error: "Buddet overstiger din disponible balance inkl. aktive auktionsføringer" });
  }

  if (bidIssue?.code === "squad_capacity_reserved") {
    return res.status(400).json({
      error: `Dit hold kan max have ${bidIssue.maxRiders} ryttere inkl. aktive auktionsføringer`,
    });
  }

  const bidTime = new Date();
  const { shouldExtend, newEnd } = checkBidExtension(bidTime, auction.calculated_end);

  // Record bid
  await supabase.from("auction_bids").insert({
    auction_id: auction.id,
    team_id: req.team.id,
    amount,
    bid_time: bidTime.toISOString(),
    triggered_extension: shouldExtend,
  });

  // Update auction
  const updates = {
    current_price: amount,
    current_bidder_id: req.team.id,
  };
  if (shouldExtend) {
    updates.calculated_end = newEnd.toISOString();
    updates.status = "extended";
    updates.extension_count = (auction.extension_count || 0) + 1;
  }

  await supabase.from("auctions").update(updates).eq("id", auction.id);

  // Notify previous bidder (outbid)
  if (auction.current_bidder_id && auction.current_bidder_id !== req.team.id) {
    await notifyTeamOwner(
      auction.current_bidder_id,
      "auction_outbid",
      "Du er blevet overbudt!",
      `${req.team.name} bød ${amount} på ${auction.rider.firstname} ${auction.rider.lastname}`,
      auction.id
    );
    notifyOutbid({
      riderName: `${auction.rider.firstname} ${auction.rider.lastname}`,
      newBid: amount,
      bidderName: req.team.name,
      teamId: auction.current_bidder_id,
    }).catch(() => {});
  }

  // Only notify seller if they're a real human manager selling their own rider
  // Don't spam seller with every bid on AI/free rider auctions
  if (auction.rider?.team_id === auction.seller_team_id) {
    await notifyTeamOwner(
      auction.seller_team_id,
      "bid_received",
      "Nyt bud modtaget",
      `${req.team.name} bød ${amount.toLocaleString()} CZ$ på ${auction.rider.firstname} ${auction.rider.lastname}`,
      auction.id
    );
  }

  // Award XP for bidding
  const { data: bidUser } = await supabase.from("users").select("id").eq("id", (await supabase.from("teams").select("user_id").eq("id", req.team.id).single()).data?.user_id).single();
  if (bidUser) awardXP(bidUser.id, "bid_placed").catch(() => {});

  res.json({
    success: true,
    new_price: amount,
    extended: shouldExtend,
    new_end: shouldExtend ? newEnd?.toISOString() : undefined,
    new_end: shouldExtend ? newEnd : undefined,
  });
});

// POST /api/auctions/:id/finalize — complete one auction via shared finalizer
router.post("/auctions/:id/finalize", requireAdmin, async (req, res) => {
  const result = await finalizeAuctionById({
    supabase,
    auctionId: req.params.id,
    notifyTeamOwner,
    discordNotify: (args) => notifyAuctionWon(args).catch(() => {}),
    logActivity,
    awardXP: awardTeamOwnerXP,
  });

  if (!result.ok) {
    if (result.code === "not_found") {
      return res.status(404).json({ error: "Auction not found" });
    }
    if (result.code === "already_completed") {
      return res.status(400).json({ error: "Already completed" });
    }
    return res.status(400).json({ error: "Auction is not active" });
  }

  if (result.code === "squad_full") {
    return res.json({ success: false, reason: "squad_full" });
  }

  res.json({ success: true, result });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Transfer System V2 ────────────────────────────────────────────────────────
// Supports: direct offers on any rider (no listing required), unlimited
// negotiation rounds, private between buyer/seller only.

// GET /api/transfers — market listings + my offers
router.get("/transfers", requireAuth, async (req, res) => {
  const { status = "open" } = req.query;
  const { data, error } = await supabase
    .from("transfer_listings")
    .select(`id, asking_price, status, created_at,
      rider:rider_id(id, firstname, lastname, uci_points, is_u25, nationality_code,
        stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
        stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr),
      seller:seller_team_id(id, name)`)
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/transfers — list own rider for sale
router.post("/transfers", requireAuth, async (req, res) => {
  const { open } = await getTransferWindowStatus();
  if (!open) return res.status(403).json({ error: "Transfervinduet er lukket. Du kan ikke oprette salgslistinger i denne periode." });

  const { rider_id, asking_price } = req.body;
  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname").eq("id", rider_id).single();
  if (!rider || rider.team_id !== req.team.id)
    return res.status(403).json({ error: "Du ejer ikke denne rytter" });
  const { data, error } = await supabase
    .from("transfer_listings")
    .insert({ rider_id, seller_team_id: req.team.id, asking_price })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify watchlist users that this rider is listed for transfer
  const riderFullName = `${rider.firstname} ${rider.lastname}`;
  const listingId = data.id;
  ;(async () => {
    const { data: watchers } = await supabase
      .from("rider_watchlist").select("user_id")
      .eq("rider_id", rider_id).neq("user_id", req.user.id);
    if (watchers?.length) {
      await Promise.all(watchers.map(w =>
        notify(w.user_id, "watchlist_rider_listed", "Ønskeliste-rytter til salg",
          `${riderFullName} er sat til salg (${asking_price?.toLocaleString("da-DK")} CZ$)`,
          listingId).catch(() => {})
      ));
    }
  })().catch(() => {});

  res.status(201).json(data);
});

// DELETE /api/transfers/:id — remove own listing
router.delete("/transfers/:id", requireAuth, async (req, res) => {
  const { data: listing } = await supabase
    .from("transfer_listings").select("seller_team_id").eq("id", req.params.id).single();
  if (!listing || listing.seller_team_id !== req.team.id)
    return res.status(403).json({ error: "Ikke din liste" });
  await supabase.from("transfer_listings").update({ status: "closed" }).eq("id", req.params.id);
  res.json({ success: true });
});

// POST /api/transfers/offer — direct offer on any rider (no listing needed)
router.post("/transfers/offer", requireAuth, async (req, res) => {
  const { open } = await getTransferWindowStatus();
  if (!open) return res.status(403).json({ error: "Transfervinduet er lukket. Du kan ikke sende tilbud i denne periode." });

  const { rider_id, offer_amount, message } = req.body;
  if (!rider_id || !offer_amount) return res.status(400).json({ error: "rider_id og offer_amount kræves" });

  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname").eq("id", rider_id).single();
  if (!rider || !rider.team_id) return res.status(404).json({ error: "Rytter ikke fundet eller har intet hold" });
  if (rider.team_id === req.team.id) return res.status(400).json({ error: "Du kan ikke byde på din egen rytter" });

  const { data: sellerTeam } = await supabase
    .from("teams")
    .select("is_bank")
    .eq("id", rider.team_id)
    .single();
  if (sellerTeam?.is_bank) {
    return res.status(400).json({ error: "Bankryttere kan ikke modtage direkte tilbud. Start eller byd på en auktion i stedet." });
  }

  // Check buyer balance
  const buyerState = await getTeamMarketState(supabase, req.team.id);
  if (offer_amount > buyerState.balance)
    return res.status(400).json({ error: "Du har ikke råd til dette tilbud" });

  // Check squad size limits for buyer
  const squadViolation = getIncomingSquadViolation(buyerState);
  if (squadViolation)
    return res.status(400).json({ error: `Dit hold kan max have ${squadViolation.maxRiders} ryttere i Division ${buyerState.division || 3}` });

  const { data, error } = await supabase
    .from("transfer_offers")
    .insert({
      rider_id,
      seller_team_id: rider.team_id,
      buyer_team_id: req.team.id,
      offer_amount,
      message: message || null,
      status: "pending",
      round: 1,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  await notifyTeamOwner(rider.team_id, "transfer_offer_received",
    "Nyt transfertilbud modtaget",
    `${req.team.name} tilbyder ${offer_amount.toLocaleString()} CZ$ for ${rider.firstname} ${rider.lastname}`,
    data.id);

  notifyTransferOffer({
    riderName: `${rider.firstname} ${rider.lastname}`,
    offerAmount: offer_amount,
    buyerName: req.team.name,
    teamId: rider.team_id,
  }).catch(() => {});

  res.status(201).json(data);
});

// GET /api/transfers/my-offers — my sent and received offers
router.get("/transfers/my-offers", requireAuth, async (req, res) => {
  // Only return offers where this team is buyer OR seller
  // Other teams' offers on same rider are NOT visible
  const [sentRes, receivedRes] = await Promise.all([
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, buyer_confirmed, seller_confirmed, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, uci_points, nationality_code, stat_bj, stat_sp, stat_tt, stat_fl),
        seller:seller_team_id(id, name)`)
      .eq("buyer_team_id", req.team.id)
      .not("status", "eq", "withdrawn")
      .order("updated_at", { ascending: false }),
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, buyer_confirmed, seller_confirmed, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, uci_points, nationality_code, stat_bj, stat_sp, stat_tt, stat_fl),
        buyer:buyer_team_id(id, name)`)
      .eq("seller_team_id", req.team.id)
      .not("status", "eq", "withdrawn")
      .order("updated_at", { ascending: false }),
  ]);
  res.json({ sent: sentRes.data || [], received: receivedRes.data || [] });
});

// PATCH /api/transfers/offers/:id — accept, reject, counter, confirm, cancel, or withdraw
router.patch("/transfers/offers/:id", requireAuth, async (req, res) => {
  const { action, counter_amount, message } = req.body;

  const { data: offer } = await supabase
    .from("transfer_offers")
    .select(`*, rider:rider_id(id, firstname, lastname, team_id, uci_points)`)
    .eq("id", req.params.id).single();

  if (!offer) return res.status(404).json({ error: "Tilbud ikke fundet" });

  const isSeller = offer.seller_team_id === req.team.id;
  const isBuyer = offer.buyer_team_id === req.team.id;
  if (!isSeller && !isBuyer) return res.status(403).json({ error: "Ikke involveret i dette tilbud" });

  // ACCEPT — seller accepts buyer's offer → awaiting buyer confirmation
  if (action === "accept" && isSeller && offer.status === "pending") {
    const price = offer.counter_amount || offer.offer_amount;

    // Soft balance check — final check happens at confirmation
    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", offer.buyer_team_id).single();
    if (!buyer || buyer.balance < price)
      return res.status(400).json({ error: "Køber har ikke råd" });

    await supabase.from("transfer_offers").update({
      status: "awaiting_confirmation",
      seller_confirmed: true,
      buyer_confirmed: false,
    }).eq("id", offer.id);

    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_accepted",
      "Tilbud accepteret — bekræft handlen",
      `${req.team.name} har accepteret dit tilbud på ${offer.rider.firstname} ${offer.rider.lastname} for ${price.toLocaleString()} CZ$. Bekræft for at gennemføre handlen.`,
      offer.id);

    notifyTransferResponse({
      riderName: `${offer.rider.firstname} ${offer.rider.lastname}`,
      accepted: true,
      teamId: offer.buyer_team_id,
    }).catch(() => {});

    return res.json({ success: true, action: "awaiting_confirmation", price });
  }

  // REJECT — seller rejects
  if (action === "reject" && isSeller) {
    await supabase.from("transfer_offers").update({ status: "rejected" }).eq("id", offer.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected",
      "Transfertilbud afvist",
      `Dit tilbud på ${offer.rider.firstname} ${offer.rider.lastname} blev afvist`, offer.id);
    notifyTransferResponse({
      riderName: `${offer.rider.firstname} ${offer.rider.lastname}`,
      accepted: false,
      teamId: offer.buyer_team_id,
    }).catch(() => {});
    return res.json({ success: true, action: "rejected" });
  }

  // COUNTER — seller sends counteroffer
  if (action === "counter" && isSeller && counter_amount) {
    await supabase.from("transfer_offers").update({
      status: "countered",
      counter_amount,
      message: message || offer.message,
      round: (offer.round || 1) + 1,
    }).eq("id", offer.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_counter",
      "Modbud modtaget",
      `${req.team.name} sender modbud på ${offer.rider.firstname} ${offer.rider.lastname}: ${counter_amount.toLocaleString()} CZ$`,
      offer.id);
    notifyTransferResponse({
      riderName: `${offer.rider.firstname} ${offer.rider.lastname}`,
      accepted: false,
      teamId: offer.buyer_team_id,
      counterAmount: counter_amount,
    }).catch(() => {});
    return res.json({ success: true, action: "countered", counter_amount });
  }

  // ACCEPT COUNTER — buyer accepts seller's counteroffer → awaiting seller confirmation
  if (action === "accept_counter" && isBuyer && offer.status === "countered") {
    const price = offer.counter_amount;

    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    if (!buyer || buyer.balance < price)
      return res.status(400).json({ error: "Du har ikke råd" });

    await supabase.from("transfer_offers").update({
      status: "awaiting_confirmation",
      buyer_confirmed: true,
      seller_confirmed: false,
    }).eq("id", offer.id);

    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_accepted",
      "Modbud accepteret — bekræft handlen",
      `${req.team.name} har accepteret dit modbud på ${offer.rider.firstname} ${offer.rider.lastname} for ${price.toLocaleString()} CZ$. Bekræft for at gennemføre handlen.`,
      offer.id);

    return res.json({ success: true, action: "awaiting_confirmation", price });
  }

  // CONFIRM — the party that hasn't confirmed yet confirms the deal
  if (action === "confirm" && offer.status === "awaiting_confirmation") {
    const result = await confirmTransferOffer({
      supabase,
      offerId: offer.id,
      confirmingTeamId: req.team.id,
      notifyTeamOwner,
      logActivity,
      notifyDiscordHistory: notifyTransferCompleted,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({
      success: true,
      action: result.action,
      ...(result.price ? { price: result.price } : {}),
    });
  }

  // CANCEL — either party can cancel only before both parties have accepted.
  if (action === "cancel" && offer.status === "awaiting_confirmation") {
    if (getTransferCancelIssue(offer)) {
      return res.status(400).json({ error: "Handlen er accepteret af begge parter og kan ikke annulleres af manager" });
    }
    await supabase.from("transfer_offers").update({ status: "withdrawn" }).eq("id", offer.id);
    const otherTeamId = isSeller ? offer.buyer_team_id : offer.seller_team_id;
    await notifyTeamOwner(otherTeamId, "transfer_offer_rejected",
      "Transfer annulleret",
      `${req.team.name} har trukket sig fra handlen på ${offer.rider.firstname} ${offer.rider.lastname}.`,
      offer.id);
    return res.json({ success: true, action: "cancelled" });
  }
  if (action === "cancel" && getTransferCancelIssue(offer)) {
    return res.status(400).json({ error: "Handlen er accepteret af begge parter og kan ikke annulleres af manager" });
  }

  // NEW OFFER — buyer sends new amount (counter to counter)
  if (action === "new_offer" && isBuyer && counter_amount) {
    await supabase.from("transfer_offers").update({
      offer_amount: counter_amount,
      counter_amount: null,
      status: "pending",
      message: message || offer.message,
      round: (offer.round || 1) + 1,
    }).eq("id", offer.id);
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_received",
      "Nyt bud modtaget",
      `${req.team.name} byder nu ${counter_amount.toLocaleString()} CZ$ for ${offer.rider.firstname} ${offer.rider.lastname}`,
      offer.id);
    return res.json({ success: true, action: "new_offer", offer_amount: counter_amount });
  }

  // WITHDRAW — buyer withdraws a pending or countered offer
  if (action === "withdraw" && isBuyer && ["pending", "countered"].includes(offer.status)) {
    await supabase.from("transfer_offers").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", offer.id);
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_withdrawn",
      "Tilbud trukket tilbage",
      `${req.team.name} har trukket deres tilbud på ${offer.rider.firstname} ${offer.rider.lastname} tilbage`,
      offer.id);
    return res.json({ success: true, action: "withdrawn" });
  }

  return res.status(400).json({ error: "Ugyldig handling" });
});

// POST /api/transfers/:id/offer — legacy route (listing-based offer)
router.post("/transfers/:id/offer", requireAuth, async (req, res) => {
  const { open } = await getTransferWindowStatus();
  if (!open) return res.status(403).json({ error: "Transfervinduet er lukket. Du kan ikke sende tilbud i denne periode." });

  const { offer_amount, message } = req.body;
  const { data: listing } = await supabase
    .from("transfer_listings")
    .select("*, rider:rider_id(id, firstname, lastname, team_id)")
    .eq("id", req.params.id).single();
  if (!listing || listing.status !== "open")
    return res.status(404).json({ error: "Listing ikke fundet" });
  if (listing.seller_team_id === req.team.id)
    return res.status(400).json({ error: "Kan ikke byde på eget udbud" });
  const { data: listingSeller } = await supabase
    .from("teams")
    .select("is_bank")
    .eq("id", listing.seller_team_id)
    .single();
  if (listingSeller?.is_bank)
    return res.status(400).json({ error: "Bankryttere kan ikke modtage direkte tilbud. Start eller byd på en auktion i stedet." });
  const listingBuyerState = await getTeamMarketState(supabase, req.team.id);
  if (offer_amount > listingBuyerState.balance)
    return res.status(400).json({ error: "Du har ikke råd til dette tilbud" });
  const listingSquadViolation = getIncomingSquadViolation(listingBuyerState);
  if (listingSquadViolation)
    return res.status(400).json({ error: `Dit hold kan max have ${listingSquadViolation.maxRiders} ryttere i Division ${listingBuyerState.division || 3}` });
  const { data, error } = await supabase.from("transfer_offers")
    .insert({
      listing_id: listing.id,
      rider_id: listing.rider_id,
      seller_team_id: listing.seller_team_id,
      buyer_team_id: req.team.id,
      offer_amount, message: message || null, status: "pending", round: 1,
    }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await notifyTeamOwner(listing.seller_team_id, "transfer_offer_received",
    "Nyt transfertilbud",
    `${req.team.name} tilbyder ${offer_amount.toLocaleString()} CZ$ for ${listing.rider.firstname} ${listing.rider.lastname}`,
    data.id);
  res.status(201).json(data);
});




// ── Swap Offers ───────────────────────────────────────────────────────────────

// GET /api/transfers/swaps — my swap offers (sent + received)
router.get("/transfers/swaps", requireAuth, async (req, res) => {
  const fields = `id, cash_adjustment, counter_cash, status, message,
    proposing_confirmed, receiving_confirmed, created_at, updated_at,
    offered:offered_rider_id(id, firstname, lastname, uci_points, stat_bj, stat_sp, stat_tt, stat_fl),
    requested:requested_rider_id(id, firstname, lastname, uci_points, stat_bj, stat_sp, stat_tt, stat_fl),
    proposing:proposing_team_id(id, name),
    receiving:receiving_team_id(id, name)`;

  const [sentRes, receivedRes] = await Promise.all([
    supabase.from("swap_offers").select(fields)
      .eq("proposing_team_id", req.team.id)
      .not("status", "eq", "withdrawn")
      .order("updated_at", { ascending: false }),
    supabase.from("swap_offers").select(fields)
      .eq("receiving_team_id", req.team.id)
      .not("status", "eq", "withdrawn")
      .order("updated_at", { ascending: false }),
  ]);
  res.json({ sent: sentRes.data || [], received: receivedRes.data || [] });
});

// POST /api/transfers/swaps — propose a swap
router.post("/transfers/swaps", requireAuth, async (req, res) => {
  const { open } = await getTransferWindowStatus();
  if (!open) return res.status(403).json({ error: "Transfervinduet er lukket. Du kan ikke foreslå byttehandler i denne periode." });

  const { offered_rider_id, requested_rider_id, cash_adjustment = 0, message } = req.body;
  if (!offered_rider_id || !requested_rider_id)
    return res.status(400).json({ error: "offered_rider_id og requested_rider_id kræves" });

  const [offeredRes, requestedRes] = await Promise.all([
    supabase.from("riders").select("id, team_id, firstname, lastname").eq("id", offered_rider_id).single(),
    supabase.from("riders").select("id, team_id, firstname, lastname").eq("id", requested_rider_id).single(),
  ]);
  const offered = offeredRes.data;
  const requested = requestedRes.data;

  if (!offered || offered.team_id !== req.team.id)
    return res.status(400).json({ error: "Din tilbudte rytter tilhører ikke dit hold" });
  if (!requested || !requested.team_id)
    return res.status(404).json({ error: "Målrytter ikke fundet eller har intet hold" });
  if (requested.team_id === req.team.id)
    return res.status(400).json({ error: "Du kan ikke bytte med dig selv" });
  const { data: requestedTeam } = await supabase
    .from("teams")
    .select("is_bank")
    .eq("id", requested.team_id)
    .single();
  if (requestedTeam?.is_bank)
    return res.status(400).json({ error: "Bankryttere kan ikke indgå i direkte byttehandler. Brug auktioner i stedet." });

  if (cash_adjustment > 0) {
    const proposingState = await getTeamMarketState(supabase, req.team.id);
    if (proposingState.balance < cash_adjustment)
      return res.status(400).json({ error: "Du har ikke råd til den ønskede kontantbetaling" });
  }

  const { data, error } = await supabase.from("swap_offers").insert({
    offered_rider_id,
    requested_rider_id,
    proposing_team_id: req.team.id,
    receiving_team_id: requested.team_id,
    cash_adjustment,
    message: message || null,
    status: "pending",
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const cashStr = cash_adjustment !== 0
    ? ` (${cash_adjustment > 0 ? "+" : ""}${cash_adjustment.toLocaleString()} CZ$ fra os)`
    : "";
  await notifyTeamOwner(requested.team_id, "transfer_offer_received",
    "Byttehandel foreslået",
    `${req.team.name} tilbyder ${offered.firstname} ${offered.lastname} for ${requested.firstname} ${requested.lastname}${cashStr}`,
    data.id);

  res.status(201).json(data);
});

// PATCH /api/transfers/swaps/:id — accept, reject, counter, confirm, cancel, withdraw
router.patch("/transfers/swaps/:id", requireAuth, async (req, res) => {
  const { action, counter_cash, message } = req.body;

  const { data: swap } = await supabase
    .from("swap_offers")
    .select(`*, offered:offered_rider_id(id, firstname, lastname, team_id),
      requested:requested_rider_id(id, firstname, lastname, team_id)`)
    .eq("id", req.params.id).single();

  if (!swap) return res.status(404).json({ error: "Byttehandel ikke fundet" });

  const isProposing  = swap.proposing_team_id === req.team.id;
  const isReceiving  = swap.receiving_team_id === req.team.id;
  if (!isProposing && !isReceiving)
    return res.status(403).json({ error: "Ikke involveret i denne byttehandel" });

  // ACCEPT — receiving team accepts → awaiting proposing confirmation
  if (action === "accept" && isReceiving && swap.status === "pending") {
    await supabase.from("swap_offers").update({
      status: "awaiting_confirmation",
      receiving_confirmed: true,
      proposing_confirmed: false,
    }).eq("id", swap.id);

    const cashStr = swap.cash_adjustment !== 0
      ? ` · ${swap.cash_adjustment > 0 ? "+" : ""}${swap.cash_adjustment.toLocaleString()} CZ$`
      : "";
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_accepted",
      "Byttehandel accepteret — bekræft handlen",
      `${req.team.name} accepterede byttehandlen: ${swap.offered.firstname} ${swap.offered.lastname} ↔ ${swap.requested.firstname} ${swap.requested.lastname}${cashStr}. Bekræft for at gennemføre.`,
      swap.id);

    return res.json({ success: true, action: "awaiting_confirmation" });
  }

  // REJECT — receiving team rejects
  if (action === "reject" && isReceiving) {
    await supabase.from("swap_offers").update({ status: "rejected" }).eq("id", swap.id);
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_rejected",
      "Byttehandel afvist",
      `${req.team.name} afslog dit byttetilbud`, swap.id);
    return res.json({ success: true, action: "rejected" });
  }

  // COUNTER — receiving team counters with different cash adjustment
  if (action === "counter" && isReceiving && counter_cash !== undefined) {
    await supabase.from("swap_offers").update({
      status: "countered",
      counter_cash,
      message: message || swap.message,
      updated_at: new Date().toISOString(),
    }).eq("id", swap.id);
    await notifyTeamOwner(swap.proposing_team_id, "transfer_counter",
      "Modbud på byttehandel",
      `${req.team.name} sender modbud: ${swap.offered.firstname} ${swap.offered.lastname} ↔ ${swap.requested.firstname} ${swap.requested.lastname} (${counter_cash > 0 ? "+" : ""}${counter_cash.toLocaleString()} CZ$)`,
      swap.id);
    return res.json({ success: true, action: "countered", counter_cash });
  }

  // ACCEPT COUNTER — proposing team accepts receiver's counter → awaiting receiving confirmation
  if (action === "accept_counter" && isProposing && swap.status === "countered") {
    const effectiveCash = swap.counter_cash;
    if (effectiveCash > 0) {
      const { data: proposingTeam } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
      if (!proposingTeam || proposingTeam.balance < effectiveCash)
        return res.status(400).json({ error: "Du har ikke råd til det kontra-tilbud" });
    }
    await supabase.from("swap_offers").update({
      status: "awaiting_confirmation",
      proposing_confirmed: true,
      receiving_confirmed: false,
    }).eq("id", swap.id);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_accepted",
      "Modbud accepteret — bekræft handlen",
      `${req.team.name} accepterede dit modbud. Bekræft for at gennemføre byttehandlen.`,
      swap.id);
    return res.json({ success: true, action: "awaiting_confirmation" });
  }

  // CONFIRM — the party that hasn't confirmed yet
  if (action === "confirm" && swap.status === "awaiting_confirmation") {
    const result = await confirmSwapOffer({
      supabase,
      swapId: swap.id,
      confirmingTeamId: req.team.id,
      notifyTeamOwner,
      notifyDiscordHistory: notifySwapCompleted,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ success: true, action: result.action });
  }

  // CANCEL — either party can cancel only before both parties have accepted.
  if (action === "cancel" && swap.status === "awaiting_confirmation") {
    if (getSwapCancelIssue(swap)) {
      return res.status(400).json({ error: "Byttehandlen er accepteret af begge parter og kan ikke annulleres af manager" });
    }
    await supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swap.id);
    const otherTeamId = isProposing ? swap.receiving_team_id : swap.proposing_team_id;
    await notifyTeamOwner(otherTeamId, "transfer_offer_rejected",
      "Byttehandel annulleret",
      `${req.team.name} har trukket sig fra byttehandlen.`, swap.id);
    return res.json({ success: true, action: "cancelled" });
  }
  if (action === "cancel" && getSwapCancelIssue(swap)) {
    return res.status(400).json({ error: "Byttehandlen er accepteret af begge parter og kan ikke annulleres af manager" });
  }

  // WITHDRAW — proposing team withdraws pending offer
  if (action === "withdraw" && isProposing && swap.status === "pending") {
    await supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swap.id);
    return res.json({ success: true, action: "withdrawn" });
  }

  return res.status(400).json({ error: "Ugyldig handling" });
});

// ── Loan Agreements ───────────────────────────────────────────────────────────

const LOAN_FIELDS = `id, loan_fee, start_season, end_season, buy_option_price, status, created_at, updated_at,
  rider:rider_id(id, firstname, lastname, uci_points, stat_bj, stat_sp, stat_tt, stat_fl),
  from_team:from_team_id(id, name),
  to_team:to_team_id(id, name)`;

// GET /api/loans — active/pending loans for my team (lending + borrowing)
router.get("/loans", requireAuth, async (req, res) => {
  const [lendingRes, borrowingRes] = await Promise.all([
    supabase.from("loan_agreements").select(LOAN_FIELDS)
      .eq("from_team_id", req.team.id)
      .not("status", "in", '("rejected","cancelled","completed")')
      .order("updated_at", { ascending: false }),
    supabase.from("loan_agreements").select(LOAN_FIELDS)
      .eq("to_team_id", req.team.id)
      .not("status", "in", '("rejected","cancelled","completed")')
      .order("updated_at", { ascending: false }),
  ]);
  res.json({ lending: lendingRes.data || [], borrowing: borrowingRes.data || [] });
});

// POST /api/loans — propose a loan (borrowing team initiates)
router.post("/loans", requireAuth, async (req, res) => {
  const { open } = await getTransferWindowStatus();
  if (!open) return res.status(403).json({ error: "Transfervinduet er lukket. Du kan ikke foreslå lejeaftaler i denne periode." });

  const { rider_id, loan_fee = 0, start_season, end_season, buy_option_price, message } = req.body;
  if (!rider_id || !start_season || !end_season)
    return res.status(400).json({ error: "rider_id, start_season og end_season kræves" });
  if (end_season < start_season)
    return res.status(400).json({ error: "end_season skal være >= start_season" });

  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname").eq("id", rider_id).single();
  if (!rider || !rider.team_id)
    return res.status(404).json({ error: "Rytter ikke fundet eller har intet hold" });
  if (rider.team_id === req.team.id)
    return res.status(400).json({ error: "Du kan ikke leje din egen rytter" });

  // Check no active loan already exists for this rider
  const { data: existing } = await supabase.from("loan_agreements")
    .select("id").eq("rider_id", rider_id).in("status", ["pending","active"]).limit(1);
  if (existing && existing.length > 0)
    return res.status(400).json({ error: "Rytteren er allerede udlejet eller har et afventende lejeforslag" });

  const borrowerState = await getTeamMarketState(supabase, req.team.id);
  const proposalSquadViolation = getIncomingSquadViolation(borrowerState);
  if (proposalSquadViolation)
    return res.status(400).json({ error: `Dit hold kan max have ${proposalSquadViolation.maxRiders} ryttere i Division ${borrowerState.division || 3}. Lejeaftalen kan ikke oprettes.` });

  const { data, error } = await supabase.from("loan_agreements").insert({
    rider_id,
    from_team_id: rider.team_id,
    to_team_id: req.team.id,
    loan_fee,
    start_season,
    end_season,
    buy_option_price: buy_option_price || null,
    status: "pending",
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const seasons = start_season === end_season ? `sæson ${start_season}` : `sæson ${start_season}–${end_season}`;
  const buyStr = buy_option_price ? ` · købsoption ${buy_option_price.toLocaleString()} CZ$` : "";
  await notifyTeamOwner(rider.team_id, "transfer_offer_received",
    "Lejeforslag modtaget",
    `${req.team.name} ønsker at leje ${rider.firstname} ${rider.lastname} (${seasons}, ${loan_fee.toLocaleString()} CZ$/sæson${buyStr})`,
    data.id);

  res.status(201).json(data);
});

// PATCH /api/loans/:id — accept, reject, cancel, or buyout
router.patch("/loans/:id", requireAuth, async (req, res) => {
  const { action } = req.body;

  if (["accept", "buyout"].includes(action)) {
    const { open } = await getTransferWindowStatus();
    if (!open) return res.status(403).json({ error: "Transfervinduet er lukket. Lejeaftalen kan ikke accepteres eller udnyttes i denne periode." });
  }

  const { data: loan } = await supabase
    .from("loan_agreements")
    .select(`*, rider:rider_id(id, firstname, lastname, team_id)`)
    .eq("id", req.params.id).single();
  if (!loan) return res.status(404).json({ error: "Lejeaftale ikke fundet" });

  const isLender   = loan.from_team_id === req.team.id;
  const isBorrower = loan.to_team_id   === req.team.id;
  if (!isLender && !isBorrower)
    return res.status(403).json({ error: "Ikke involveret i denne lejeaftale" });

  // ACCEPT — lending team accepts
  if (action === "accept" && isLender && loan.status === "pending") {
    const borrowerState = await getTeamMarketState(supabase, loan.to_team_id);
    const activationSquadViolation = getIncomingSquadViolation(borrowerState);
    if (activationSquadViolation)
      return res.status(400).json({ error: `Lejerens hold kan max have ${activationSquadViolation.maxRiders} ryttere i Division ${borrowerState.division || 3}. Lejeaftalen kan ikke aktiveres.` });

    // Deduct first season's loan fee from borrower if > 0
    if (loan.loan_fee > 0) {
      const { data: borrower } = await supabase.from("teams").select("balance").eq("id", loan.to_team_id).single();
      const { data: lender }   = await supabase.from("teams").select("balance").eq("id", loan.from_team_id).single();
      if (!borrower || borrower.balance < loan.loan_fee)
        return res.status(400).json({ error: "Lejer har ikke råd til lejegebyret" });
      await supabase.from("teams").update({ balance: borrower.balance - loan.loan_fee }).eq("id", loan.to_team_id);
      await supabase.from("teams").update({ balance: lender.balance + loan.loan_fee }).eq("id", loan.from_team_id);
      await supabase.from("finance_transactions").insert([
        { team_id: loan.to_team_id,   type: "transfer_out", amount: -loan.loan_fee,
          description: `Lejegebyr: ${loan.rider.firstname} ${loan.rider.lastname} (sæson ${loan.start_season})` },
        { team_id: loan.from_team_id, type: "transfer_in",  amount: loan.loan_fee,
          description: `Lejegebyr modtaget: ${loan.rider.firstname} ${loan.rider.lastname} (sæson ${loan.start_season})` },
      ]);
    }
    await supabase.from("loan_agreements").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", loan.id);
    await notifyTeamOwner(loan.to_team_id, "transfer_offer_accepted",
      "Lejeaftale aktiveret",
      `${req.team.name} har accepteret din lejeforespørgsel på ${loan.rider.firstname} ${loan.rider.lastname}`, loan.id);
    return res.json({ success: true, action: "active" });
  }

  // REJECT — lending team rejects
  if (action === "reject" && isLender && loan.status === "pending") {
    await supabase.from("loan_agreements").update({ status: "rejected" }).eq("id", loan.id);
    await notifyTeamOwner(loan.to_team_id, "transfer_offer_rejected",
      "Lejeforespørgsel afvist",
      `${req.team.name} afslog dit lejeforslag på ${loan.rider.firstname} ${loan.rider.lastname}`, loan.id);
    return res.json({ success: true, action: "rejected" });
  }

  // CANCEL — either party cancels pending or active loan
  if (action === "cancel" && ["pending","active"].includes(loan.status)) {
    await supabase.from("loan_agreements").update({ status: "cancelled" }).eq("id", loan.id);
    const otherTeamId = isLender ? loan.to_team_id : loan.from_team_id;
    await notifyTeamOwner(otherTeamId, "transfer_offer_rejected",
      "Lejeaftale annulleret",
      `${req.team.name} har annulleret lejeaftalen på ${loan.rider.firstname} ${loan.rider.lastname}`, loan.id);
    return res.json({ success: true, action: "cancelled" });
  }

  // BUYOUT — borrowing team exercises buy option
  if (action === "buyout" && isBorrower && loan.status === "active" && loan.buy_option_price) {
    const price = loan.buy_option_price;
    const { data: borrower } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    const { data: lender }   = await supabase.from("teams").select("balance").eq("id", loan.from_team_id).single();
    if (!borrower || borrower.balance < price)
      return res.status(400).json({ error: "Du har ikke råd til at udnytte købsoptionen" });

    await supabase.from("riders").update({ team_id: req.team.id, salary: Math.ceil(price * 0.1) }).eq("id", loan.rider_id);
    await supabase.from("teams").update({ balance: borrower.balance - price }).eq("id", req.team.id);
    await supabase.from("teams").update({ balance: lender.balance + price }).eq("id", loan.from_team_id);
    await supabase.from("finance_transactions").insert([
      { team_id: req.team.id,       type: "transfer_out", amount: -price,
        description: `Købsoption udnyttet: ${loan.rider.firstname} ${loan.rider.lastname}` },
      { team_id: loan.from_team_id, type: "transfer_in",  amount: price,
        description: `Købsoption udnyttet: ${loan.rider.firstname} ${loan.rider.lastname}` },
    ]);
    await supabase.from("loan_agreements").update({ status: "buyout" }).eq("id", loan.id);
    await notifyTeamOwner(loan.from_team_id, "transfer_offer_accepted",
      "Købsoption udnyttet",
      `${req.team.name} har udnyttet købsoptionen på ${loan.rider.firstname} ${loan.rider.lastname} for ${price.toLocaleString()} CZ$`, loan.id);
    return res.json({ success: true, action: "buyout", price });
  }

  return res.status(400).json({ error: "Ugyldig handling" });
});

// POST /api/admin/override-rider — manually move a rider to a team
router.post("/admin/override-rider", requireAdmin, async (req, res) => {
  const { rider_id, team_id } = req.body;
  if (!rider_id) return res.status(400).json({ error: "rider_id required" });
  const { data: rider } = await supabase.from("riders").select("firstname, lastname").eq("id", rider_id).single();
  if (!rider) return res.status(404).json({ error: "Rytter ikke fundet" });
  const { error } = await supabase.from("riders")
    .update({ team_id: team_id || null, pending_team_id: null }).eq("id", rider_id);
  if (error) return res.status(500).json({ error: error.message });
  const teamRes = team_id ? await supabase.from("teams").select("name").eq("id", team_id).single() : null;
  const teamName = teamRes?.data?.name || "fri agent";
  res.json({ success: true, message: `${rider.firstname} ${rider.lastname} flyttet til ${teamName}` });
});

router.post(
  "/admin/import-results",
  requireAdmin,
  adminImportUpload.single("file"),
  createAdminImportResultsHandler({
    supabase,
    buildRacePrizeLookup,
    applyRaceResults,
    ensureSeasonStandings,
    updateStandings,
    logActivity,
  }),
);

// POST /api/admin/approve-results — approve pending race result submission
router.post("/admin/approve-results", requireAdmin, async (req, res) => {
  try {
    const { pending_id } = req.body;
    if (!pending_id) return res.status(400).json({ error: "pending_id required" });

    const { data: sub, error: subError } = await supabase
      .from("pending_race_results")
      .select("race_id, status")
      .eq("id", pending_id)
      .single();
    if (subError) return res.status(500).json({ error: subError.message });
    if (!sub) return res.status(404).json({ error: "Submission not found" });
    if (sub.status && sub.status !== "pending") {
      return res.status(400).json({ error: "Submission is already reviewed" });
    }

    const { data: race, error: raceError } = await supabase
      .from("races")
      .select("id, name, season_id, race_type")
      .eq("id", sub.race_id)
      .single();
    if (raceError) return res.status(500).json({ error: raceError.message });
    if (!race) return res.status(404).json({ error: "Løb ikke fundet" });

    const { data: rows, error: rowsError } = await supabase
      .from("pending_race_result_rows")
      .select("*, rider:rider_id(team_id, firstname, lastname)")
      .eq("pending_id", pending_id);
    if (rowsError) return res.status(500).json({ error: rowsError.message });
    if (!rows?.length) return res.status(400).json({ error: "No rows found" });

    const { data: prizes, error: prizesError } = await supabase
      .from("prize_tables")
      .select("result_type, rank, prize_amount")
      .eq("race_type", race.race_type);
    if (prizesError) return res.status(500).json({ error: prizesError.message });

    const prizeLookup = buildRacePrizeLookup({ prizes });
    const insertRows = buildRaceResultsFromPending({
      pendingRows: rows,
      prizeLookup,
      raceId: race.id,
    });

    const result = await applyRaceResults({
      supabase,
      race,
      resultRows: insertRows,
      ensureSeasonStandings,
      updateStandings,
    });

    const { error: pendingUpdateError } = await supabase
      .from("pending_race_results")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user.id,
      })
      .eq("id", pending_id);
    if (pendingUpdateError) return res.status(500).json({ error: pendingUpdateError.message });

    await logActivity("race_results_approved", {
      meta: {
        race_id: race.id,
        race_name: race.name,
        season_id: race.season_id,
        rows_imported: result.rowsImported,
      },
    });

    res.json({
      success: true,
      rows_imported: result.rowsImported,
      teams_paid: result.teamsPaid,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Notifications ─────────────────────────────────────────────────────────────

// GET /api/notifications
router.get("/notifications", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/notifications/:id/read
router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  await supabase.from("notifications")
    .update({ is_read: true })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

// PATCH /api/notifications/read-all
router.patch("/notifications/read-all", requireAuth, async (req, res) => {
  await supabase.from("notifications")
    .update({ is_read: true })
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

// ── Teams ─────────────────────────────────────────────────────────────────────

// GET /api/teams/:id — team details with squad
router.get("/teams/:id", requireAuth, async (req, res) => {
  const { data: team, error } = await supabase
    .from("teams")
    .select("id, name, division, sponsor_income, is_ai")
    .eq("id", req.params.id)
    .single();
  if (error || !team) return res.status(404).json({ error: "Hold ikke fundet" });

  const { data: riders } = await supabase
    .from("riders")
    .select("id, firstname, lastname, uci_points, salary, is_u25, stat_bj, stat_sp, stat_tt, stat_fl")
    .eq("team_id", req.params.id)
    .order("uci_points", { ascending: false });

  res.json({ ...team, riders: riders || [] });
});

// GET /api/teams/my — current user's team
router.get("/teams/my", requireAuth, async (req, res) => {
  res.json(req.team);
});

// PUT /api/teams/my — create or update the current user's team profile
router.put("/teams/my", requireAuth, async (req, res) => {
  try {
    const result = await upsertOwnTeamProfile({
      supabase,
      userId: req.user.id,
      existingTeam: req.team,
      name: req.body?.name,
      managerName: req.body?.manager_name,
    });

    req.team = result.team;

    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "Kunne ikke gemme holdprofil" });
  }
});

// ── Admin: Seasons & Races ────────────────────────────────────────────────────

// POST /api/admin/finalize-expired-auctions — admin bulk finalizer via shared logic
router.post("/admin/finalize-expired-auctions", requireAdmin, async (req, res) => {
  const results = await finalizeExpiredAuctionsShared({
    supabase,
    notifyTeamOwner,
    logActivity,
    awardXP: awardTeamOwnerXP,
    now: new Date(),
  });

  res.json({
    finalized: results.filter(result => result.ok).length,
    results,
  });
});

router.post("/admin/seasons", requireAdmin, async (req, res) => {
  try {
    const number = Number.parseInt(req.body.number, 10);
    const raceDaysTotal = Number.parseInt(req.body.race_days_total ?? 60, 10);

    if (!Number.isInteger(number) || number < 1) {
      return res.status(400).json({ error: "Ugyldigt sæsonnummer" });
    }

    if (!Number.isInteger(raceDaysTotal) || raceDaysTotal < 1) {
      return res.status(400).json({ error: "race_days_total skal være mindst 1" });
    }

    const { data: existingSeason, error: existingError } = await supabase
      .from("seasons")
      .select("id")
      .eq("number", number)
      .maybeSingle();
    if (existingError) return res.status(500).json({ error: existingError.message });
    if (existingSeason) return res.status(409).json({ error: "Sæsonnummer findes allerede" });

    const { data: createdSeason, error: createError } = await supabase
      .from("seasons")
      .insert({
        number,
        race_days_total: raceDaysTotal,
        status: "upcoming",
      })
      .select("*")
      .single();
    if (createError) return res.status(500).json({ error: createError.message });

    res.status(201).json(createdSeason);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/seasons/:id/start", requireAdmin, async (req, res) => {
  try {
    const seasonId = req.params.id;
    const today = new Date().toISOString().slice(0, 10);

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("*")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.status !== "upcoming") {
      return res.status(400).json({ error: "Kun kommende sæsoner kan startes" });
    }

    const { count: activeCount, error: activeError } = await supabase
      .from("seasons")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if (activeError) return res.status(500).json({ error: activeError.message });
    if ((activeCount || 0) > 0) {
      return res.status(400).json({ error: "Der findes allerede en aktiv sæson" });
    }

    const standings = await ensureSeasonStandings(seasonId);

    const { data: startedSeason, error: startError } = await supabase
      .from("seasons")
      .update({
        status: "active",
        start_date: season.start_date || today,
      })
      .eq("id", seasonId)
      .eq("status", "upcoming")
      .select("*")
      .single();
    if (startError) return res.status(500).json({ error: startError.message });

    const sponsorResults = await processSeasonStart(seasonId);

    await logActivity("season_started", {
      meta: {
        season_id: startedSeason.id,
        season_number: startedSeason.number,
        standings_initialized: standings.created,
        sponsor_payouts: sponsorResults.length,
      },
    });

    notifySeasonEvent({ type: "season_started", seasonNumber: startedSeason.number }).catch(() => {});

    res.json({
      success: true,
      season_id: startedSeason.id,
      number: startedSeason.number,
      standings_initialized: standings.created,
      sponsor_payouts: sponsorResults.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/seasons/:id/end", requireAdmin, async (req, res) => {
  try {
    const seasonId = req.params.id;
    const today = new Date().toISOString().slice(0, 10);

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("*")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.status !== "active") {
      return res.status(400).json({ error: "Kun aktive sæsoner kan afsluttes" });
    }

    const { data: seasonRaces, error: racesError } = await supabase
      .from("races")
      .select("id")
      .eq("season_id", seasonId);
    if (racesError) return res.status(500).json({ error: racesError.message });

    const raceIds = (seasonRaces || []).map(race => race.id);
    if (raceIds.length > 0) {
      const { count: pendingCount, error: pendingError } = await supabase
        .from("pending_race_results")
        .select("id", { count: "exact", head: true })
        .in("race_id", raceIds)
        .eq("status", "pending");
      if (pendingError) return res.status(500).json({ error: pendingError.message });
      if ((pendingCount || 0) > 0) {
        return res.status(400).json({ error: "Der er stadig afventende løbsresultater i sæsonen" });
      }
    }

    await ensureSeasonStandings(seasonId);
    await updateStandings(seasonId);
    await processSeasonEnd(seasonId);

    const { data: endedSeason, error: endError } = await supabase
      .from("seasons")
      .update({ end_date: season.end_date || today })
      .eq("id", seasonId)
      .select("*")
      .single();
    if (endError) return res.status(500).json({ error: endError.message });

    await logActivity("season_ended", {
      meta: {
        season_id: season.id,
        season_number: season.number,
      },
    });

    notifySeasonEvent({ type: "season_ended", seasonNumber: season.number }).catch(() => {});

    res.json({
      success: true,
      season_id: endedSeason.id,
      number: endedSeason.number,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/seasons/:id/repair-finance-board", requireAdmin, async (req, res) => {
  try {
    const seasonId = req.params.id;
    const force = req.body?.force === true;
    const result = await repairSeasonEndFinanceAndBoard(seasonId, { force });

    await logActivity("season_end_finance_board_repaired", {
      meta: {
        season_id: seasonId,
        teams_processed: result.teamsProcessed,
        force,
      },
    });

    res.json({ success: true, season_id: seasonId, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/seasons/:id/rebuild-standings", requireAdmin, async (req, res) => {
  try {
    const seasonId = req.params.id;

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, number, status, start_date")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.status === "upcoming") {
      return res.status(400).json({ error: "Kun aktive eller afsluttede sæsoner kan genberegnes" });
    }

    const result = await updateStandings(seasonId);

    await logActivity("season_standings_rebuilt", {
      meta: {
        season_id: season.id,
        season_number: season.number,
        rows_updated: result.rowsUpdated,
        teams_with_points: result.teamsWithPoints,
      },
    });

    res.json({
      success: true,
      season_id: season.id,
      number: season.number,
      rows_updated: result.rowsUpdated,
      teams_with_points: result.teamsWithPoints,
      start_date_missing: !season.start_date,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/races", requireAdmin, async (req, res) => {
  try {
    const {
      season_id,
      name,
      race_type = "single",
      stages = 1,
      start_date = null,
      prize_pool = 0,
      race_class,
    } = req.body;

    if (!season_id) return res.status(400).json({ error: "season_id kræves" });
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Navn kræves" });
    if (!["single", "stage_race"].includes(race_type)) {
      return res.status(400).json({ error: "Ugyldig race_type" });
    }

    const normalizedStages = race_type === "single"
      ? 1
      : Math.max(1, Number.parseInt(stages, 10) || 1);
    const normalizedPrizePool = Math.max(0, Number.parseInt(prize_pool, 10) || 0);

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, status")
      .eq("id", season_id)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.status === "completed") {
      return res.status(400).json({ error: "Kan ikke tilføje løb til en afsluttet sæson" });
    }

    const payload = {
      season_id,
      name: String(name).trim(),
      race_type,
      stages: normalizedStages,
      start_date: start_date || null,
      prize_pool: normalizedPrizePool,
      status: "scheduled",
      race_class: race_class || null,
    };

    const { data: createdRace, error: createError } = await createRaceRecord(payload);
    if (createError) return res.status(500).json({ error: createError.message });

    res.status(201).json(createdRace);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Finance Loan Routes ───────────────────────────────────────────────────────

// Separate finance loans from rider loan agreements to keep one canonical path per domain.

// GET /api/finance/loans — hent egne finanslån + konfiguration
router.get("/finance/loans", requireAuth, async (req, res) => {
  try {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const [loansRes, configs, debt] = await Promise.all([
      supabase.from("loans").select("*").eq("team_id", req.team.id).order("created_at", { ascending: false }),
      getLoanConfig(req.team.id),
      getTotalDebt(req.team.id),
    ]);
    res.json({
      loans: loansRes.data || [],
      configs,
      total_debt: debt,
      debt_ceiling: configs[0]?.debt_ceiling,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/finance/loans — optag nyt finanslån
router.post("/finance/loans", requireAuth, async (req, res) => {
  try {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { loan_type, amount } = req.body;
    if (!["short", "long"].includes(loan_type))
      return res.status(400).json({ error: "Ugyldig låntype — brug short eller long" });
    if (!amount || amount < 1)
      return res.status(400).json({ error: "Ugyldigt beløb" });
    const loan = await createLoan(req.team.id, loan_type, parseInt(amount));
    res.json({ success: true, loan });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/finance/loans/:id/repay — betal rate på finanslån
router.post("/finance/loans/:id/repay", requireAuth, async (req, res) => {
  try {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { amount } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: "Ugyldigt beløb" });
    const result = await repayLoan(req.params.id, req.team.id, parseInt(amount));
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /api/admin/loan-config — opdater lånekonfiguration
router.patch("/admin/loan-config", requireAdmin, async (req, res) => {
  try {
    const { division, loan_type, origination_fee_pct, interest_rate_pct, seasons, debt_ceiling } = req.body;
    const { data, error } = await supabase.from("loan_config")
      .update({ origination_fee_pct, interest_rate_pct, seasons, debt_ceiling, updated_at: new Date() })
      .eq("division", division)
      .eq("loan_type", loan_type)
      .select().single();
    if (error) throw error;
    res.json({ success: true, config: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/adjust-balance — juster holdbalance manuelt
router.post("/admin/adjust-balance", requireAdmin, async (req, res) => {
  try {
    const { team_id, amount, reason } = req.body;
    if (!team_id || amount === undefined) return res.status(400).json({ error: "team_id og amount kræves" });
    const { data: team } = await supabase.from("teams").select("balance").eq("id", team_id).single();
    if (!team) return res.status(404).json({ error: "Hold ikke fundet" });
    await supabase.from("teams").update({ balance: team.balance + parseInt(amount) }).eq("id", team_id);
    await supabase.from("finance_transactions").insert({
      team_id,
      type: "admin_adjustment",
      amount: parseInt(amount),
      description: reason || "Admin justering",
    });
    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: "balance_adjustment",
      description: `Balance justeret med ${amount} CZ$: ${reason || "—"}`,
      target_team_id: team_id,
      meta: { amount, reason },
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/transfer-window/open — åbn transfervinduet for aktiv sæson
router.post("/admin/transfer-window/open", requireAdmin, async (req, res) => {
  try {
    const { season_id } = req.body;
    if (!season_id) return res.status(400).json({ error: "season_id kræves" });

    // Insert new window record with status "open"
    const { error: insertErr } = await supabase.from("transfer_windows")
      .insert({ season_id, status: "open" });
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    // Flush auction winners (pending_team_id → team_id)
    const { data: pendingRiders } = await supabase.from("riders")
      .select("id, pending_team_id")
      .not("pending_team_id", "is", null);

    let ridersProcessed = 0;
    if (pendingRiders && pendingRiders.length > 0) {
      await Promise.all(pendingRiders.map(r =>
        supabase.from("riders").update({ team_id: r.pending_team_id, pending_team_id: null }).eq("id", r.id)
      ));
      ridersProcessed = pendingRiders.length;
    }

    // Flush window_pending direct transfers and swaps
    const { transfersProcessed, swapsProcessed } = await flushWindowPendingOffers(supabase, {
      logActivity,
      notifyTeamOwner,
      notifyTransferCompleted,
      notifySwapCompleted,
    });

    res.json({ success: true, riders_processed: ridersProcessed, transfers_processed: transfersProcessed, swaps_processed: swapsProcessed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/transfer-window/close — luk transfervinduet
router.post("/admin/transfer-window/close", requireAdmin, async (req, res) => {
  try {
    const { data: tw } = await supabase.from("transfer_windows")
      .select("id").order("created_at", { ascending: false }).limit(1).single();
    if (!tw) return res.status(404).json({ error: "Intet aktivt transfervindue fundet" });
    await supabase.from("transfer_windows").update({ status: "closed" }).eq("id", tw.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/season-end-preview/:seasonId — preview af sæsonafslutning
router.get("/admin/season-end-preview/:seasonId", requireAdmin, async (req, res) => {
  try {
    const { seasonId } = req.params;

    const [teams, standingsRes, loansRes] = await Promise.all([
      loadHumanSeasonEndTeams(supabase),
      supabase.from("season_standings").select("*").eq("season_id", seasonId),
      supabase.from("loans").select("team_id, amount_remaining, interest_rate").eq("status", "active"),
    ]);

    if (standingsRes.error) throw standingsRes.error;
    if (loansRes.error) throw loansRes.error;
    const standings = standingsRes.data || [];
    const loanData = loansRes.data || [];
    const preview = buildSeasonEndPreviewRows({ teams, standings, loanData });

    res.json({ preview });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/discord/test — send testbesked til en webhook-URL
router.post("/admin/discord/test", requireAdmin, async (req, res) => {
  const { webhook_url } = req.body;
  if (!webhook_url) return res.status(400).json({ error: "webhook_url påkrævet" });
  try {
    await sendTestEmbed(webhook_url);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/sync-dyn-cyclist — sync PCM stats fra Google Sheets
router.post("/admin/sync-dyn-cyclist", requireAdmin, handleDynCyclistSyncRequest);

// POST /api/admin/import-results-sheets — importer løbsresultater fra Google Sheets
router.post("/admin/import-results-sheets", requireAdmin, async (req, res) => {
  const { spreadsheet_url } = req.body;
  if (!spreadsheet_url) {
    return res.status(400).json({ error: "spreadsheet_url påkrævet" });
  }
  try {
    const result = await syncRaceResultsFromSheets({
      spreadsheetUrl: spreadsheet_url,
      supabase,
      ensureSeasonStandings,
      updateStandings,
      adminUserId: req.user.id,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users — list alle brugere med hold
router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, username, role, created_at, teams(id, name, division)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ users: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/users/:userId — slet bruger permanent
router.delete("/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === req.user.id) return res.status(400).json({ error: "Kan ikke slette dig selv" });

    const { data: target } = await supabase
      .from("users").select("email, username").eq("id", userId).single();
    if (!target) return res.status(404).json({ error: "Bruger ikke fundet" });

    // Nullify non-cascade FK references to prevent RESTRICT violations
    await Promise.allSettled([
      supabase.from("import_log").update({ imported_by: null }).eq("imported_by", userId),
    ]);

    // Delete profile row (cascades to notifications, sets NULL on teams.user_id)
    const { error: deleteErr } = await supabase.from("users").delete().eq("id", userId);
    if (deleteErr) throw deleteErr;

    // Remove Supabase Auth account
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: "user_deleted",
      description: `Bruger slettet: ${target.username} (${target.email})`,
      meta: { deleted_user_id: userId },
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/users/:userId/role — skift brugerrolle
router.patch("/admin/users/:userId/role", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    if (!["admin", "manager"].includes(role)) return res.status(400).json({ error: "Ugyldig rolle" });
    if (userId === req.user.id) return res.status(400).json({ error: "Kan ikke ændre din egen rolle" });

    const { data, error } = await supabase
      .from("users").update({ role }).eq("id", userId).select("username").single();
    if (error) throw error;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: "role_changed",
      description: `Rolle ændret for ${data.username} → ${role}`,
      meta: { user_id: userId, role },
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/races/:raceId — slet løb (cascader til race_results)
router.delete("/admin/races/:raceId", requireAdmin, async (req, res) => {
  try {
    const { raceId } = req.params;
    const { data: race } = await supabase
      .from("races").select("name").eq("id", raceId).single();
    if (!race) return res.status(404).json({ error: "Løb ikke fundet" });

    const { error } = await supabase.from("races").delete().eq("id", raceId);
    if (error) throw error;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: "race_deleted",
      description: `Løb slettet: ${race.name}`,
      meta: { race_id: raceId, name: race.name },
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRESENCE & ONLINE STATUS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/presence — heartbeat, opdater last_seen
router.post("/presence", requireAuth, async (req, res) => {
  const { error } = await supabase.from("users")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", req.user.id);
  if (error) console.error("[presence] update failed:", error.message);
  res.json({ ok: true, user_id: req.user.id, error: error?.message || null });
});

// POST /api/login-streak — beregn og opdater daglig login-streak
router.post("/login-streak", requireAuth, async (req, res) => {
  const { data: user, error: selectErr } = await supabase.from("users")
    .select("last_login_date, login_streak").eq("id", req.user.id).single();
  if (selectErr) console.error("[login-streak] select failed:", selectErr.message);
  const today = new Date().toISOString().slice(0, 10);
  const last = user?.last_login_date;
  let streak = user?.login_streak || 0;
  if (last !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    streak = last === yesterday ? streak + 1 : 1;
    const { error: updateErr } = await supabase.from("users")
      .update({ last_login_date: today, login_streak: streak })
      .eq("id", req.user.id);
    if (updateErr) console.error("[login-streak] update failed:", updateErr.message);
  }
  res.json({ streak, user_id: req.user.id });
});

// GET /api/online-count — brugere aktive inden for de seneste 5 minutter
router.get("/online-count", requireAuth, async (req, res) => {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await supabase.from("users")
    .select("id", { count: "exact", head: true }).gte("last_seen", cutoff);
  res.json({ count: count || 0 });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/achievements — alle achievements med unlocked-status for aktuel bruger
router.get("/achievements", requireAuth, async (req, res) => {
  const [{ data: all }, { data: unlocked }] = await Promise.all([
    supabase.from("achievements").select("*").order("category"),
    supabase.from("manager_achievements").select("achievement_id, unlocked_at").eq("user_id", req.user.id),
  ]);
  const unlockedMap = {};
  (unlocked || []).forEach(u => { unlockedMap[u.achievement_id] = u.unlocked_at; });
  res.json((all || []).map(a => ({
    ...a,
    unlocked: !!unlockedMap[a.id],
    unlocked_at: unlockedMap[a.id] || null,
  })));
});

// POST /api/achievements/check — synk achievements mod live runtime-data
router.post("/achievements/check", requireAuth, async (req, res) => {
  try {
    const newlyUnlocked = await checkAchievements({
      supabase,
      userId: req.user.id,
    });

    res.json({ unlocked: newlyUnlocked });
  } catch (error) {
    console.error("[achievements/check] sync failed:", error.message);
    res.status(500).json({ error: "Kunne ikke opdatere achievements" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGER PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/managers/:teamId — fuld manager-profil
router.get("/managers/:teamId", requireAuth, async (req, res) => {
  const { teamId } = req.params;
  const { data: team } = await supabase.from("teams")
    .select("id, name, division, balance, user_id").eq("id", teamId).single();
  if (!team) return res.status(404).json({ error: "Hold ikke fundet" });

  const [userRes, ridersRes, historyRes, allAchsRes, unlockedAchsRes, transfersRes] = await Promise.all([
    supabase.from("users")
      .select("id, username, last_seen, login_streak")
      .eq("id", team.user_id).single(),
    supabase.from("riders")
      .select("id, firstname, lastname, uci_points, is_u25, stat_bj, stat_sp, stat_tt")
      .eq("team_id", teamId).order("uci_points", { ascending: false }),
    supabase.from("season_standings")
      .select("*, season:season_id(number)")
      .eq("team_id", teamId).order("created_at", { ascending: false }),
    supabase.from("achievements").select("*").order("category"),
    supabase.from("manager_achievements")
      .select("achievement_id, unlocked_at").eq("user_id", team.user_id),
    supabase.from("transfer_offers")
      .select(`id, offer_amount, created_at,
        rider:rider_id(id, firstname, lastname),
        buyer_team:buyer_team_id(id, name),
        seller_team:seller_team_id(id, name)`)
      .or(`buyer_team_id.eq.${teamId},seller_team_id.eq.${teamId}`)
      .eq("status", "accepted")
      .order("created_at", { ascending: false }).limit(10),
  ]);

  const unlockedMap = {};
  (unlockedAchsRes.data || []).forEach(u => { unlockedMap[u.achievement_id] = u.unlocked_at; });
  const achievements = (allAchsRes.data || []).map(a => ({
    ...a, unlocked: !!unlockedMap[a.id], unlocked_at: unlockedMap[a.id] || null,
  }));

  const userData = userRes.data;
  if (userData?.last_seen) {
    userData.is_online = (Date.now() - new Date(userData.last_seen).getTime()) < 5 * 60 * 1000;
  } else {
    userData.is_online = false;
  }

  res.json({
    team: { id: team.id, name: team.name, division: team.division },
    user: userData,
    riders: ridersRes.data || [],
    season_history: historyRes.data || [],
    achievements,
    transfer_activity: transfersRes.data || [],
  });
});

// GET /api/riders/:id/watchlist-count — antal managers der følger en rytter
router.get("/riders/:id/watchlist-count", requireAuth, async (req, res) => {
  const { count } = await supabase.from("rider_watchlist")
    .select("id", { count: "exact", head: true }).eq("rider_id", req.params.id);
  res.json({ count: count || 0 });
});

// POST /api/riders/:id/view — vis rytter-profil, trigger evt. transferrygte
router.post("/riders/:id/view", requireAuth, async (req, res) => {
  const { data: rider } = await supabase.from("riders")
    .select("id, firstname, lastname, team_id").eq("id", req.params.id).single();
  if (rider?.team_id && rider.team_id !== req.team?.id && Math.random() < 0.3) {
    await notifyTeamOwner(rider.team_id, "transfer_interest",
      "Transferrygte 👀",
      `En manager kigger på ${rider.firstname} ${rider.lastname}`,
      rider.id);
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD
// ═══════════════════════════════════════════════════════════════════════════════

function isMissingRow(error) {
  return error?.code === "PGRST116";
}

function isMissingTable(error, tableName) {
  if (!error) return false;

  const haystacks = [
    error.code || "",
    error.message || "",
    error.details || "",
    error.hint || "",
  ].join(" ");

  return haystacks.includes("PGRST205")
    || haystacks.includes("42P01")
    || (tableName ? haystacks.includes(tableName) : false);
}

function isUniqueViolation(error, constraintName) {
  if (!error) return false;

  const haystacks = [
    error.code || "",
    error.message || "",
    error.details || "",
    error.hint || "",
  ].join(" ");

  return haystacks.includes("23505")
    || (constraintName ? haystacks.includes(constraintName) : false);
}

async function loadBoardPlanningContext(teamId) {
  const [seasonRes, teamRes, ridersRes, standingRes, boardsRes] = await Promise.all([
    supabase.from("seasons").select("id, number").eq("status", "active").single(),
    supabase.from("teams").select("id, balance, sponsor_income, division").eq("id", teamId).single(),
    supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", teamId),
    supabase.from("season_standings").select("*").eq("team_id", teamId)
      .order("updated_at", { ascending: false }).limit(1).single(),
    supabase.from("board_profiles").select("*").eq("team_id", teamId),
  ]);

  if (teamRes.error) throw new Error(teamRes.error.message);
  if (ridersRes.error) throw new Error(ridersRes.error.message);
  if (seasonRes.error && !isMissingRow(seasonRes.error)) throw new Error(seasonRes.error.message);
  if (standingRes.error && !isMissingRow(standingRes.error)) throw new Error(standingRes.error.message);
  if (boardsRes.error) throw new Error(boardsRes.error.message);

  const boards = boardsRes.data || [];

  return {
    activeSeason: seasonRes.data || null,
    team: teamRes.data || null,
    riders: ridersRes.data || [],
    standing: standingRes.data || null,
    boards,
  };
}

function serializeBoardRequest(requestRow) {
  if (!requestRow) return null;

  const definition = getBoardRequestDefinition(requestRow.request_type);

  return {
    ...requestRow,
    request_label: requestRow.request_payload?.request_label || definition?.label || requestRow.request_type,
  };
}

// GET /api/board/status — alle tre parallelle planer for det autentificerede hold
router.get("/board/status", requireAuth, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const [seasonRes, boardsRes, teamRes, ridersRes, standingRes, loansRes] = await Promise.all([
      supabase.from("seasons").select("id, number").eq("status", "active").single(),
      supabase.from("board_profiles").select("*").eq("team_id", teamId),
      supabase.from("teams").select("id, balance, sponsor_income, division").eq("id", teamId).single(),
      supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", teamId),
      supabase.from("season_standings").select("*").eq("team_id", teamId)
        .order("updated_at", { ascending: false }).limit(1).single(),
      supabase.from("loans").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("status", "active"),
    ]);

    if (seasonRes.error && !isMissingRow(seasonRes.error)) return res.status(500).json({ error: seasonRes.error.message });
    if (teamRes.error) return res.status(500).json({ error: teamRes.error.message });
    if (ridersRes.error) return res.status(500).json({ error: ridersRes.error.message });
    if (boardsRes.error) return res.status(500).json({ error: boardsRes.error.message });
    if (standingRes.error && !isMissingRow(standingRes.error)) return res.status(500).json({ error: standingRes.error.message });
    if (loansRes.error) return res.status(500).json({ error: loansRes.error.message });

    const allBoards = boardsRes.data || [];
    const activeSeason = seasonRes.data || null;
    const activeLoanCount = loansRes.count || 0;
    const currentStanding = standingRes.data || null;
    const currentTeam = { ...(teamRes.data || {}), riders: ridersRes.data || [] };

    const identityProfile = deriveTeamIdentityProfile({
      team: teamRes.data || null,
      riders: ridersRes.data || [],
      standing: currentStanding,
    });

    // Fetch snapshots and request logs for all board IDs in one query each
    const boardIds = allBoards.map(b => b.id);
    let allSnapshots = [];
    let allRequestLogs = [];
    let boardRequestsSupported = true;

    if (boardIds.length > 0) {
      const [snapshotsRes, requestsRes] = await Promise.all([
        supabase.from("board_plan_snapshots").select("*")
          .in("board_id", boardIds)
          .order("season_within_plan", { ascending: true }),
        supabase.from("board_request_log")
          .select("id, board_id, request_type, outcome, title, summary, tradeoff_summary, request_payload, board_changes, season_number, created_at")
          .in("board_id", boardIds)
          .order("created_at", { ascending: false }),
      ]);

      if (snapshotsRes.error) return res.status(500).json({ error: snapshotsRes.error.message });
      boardRequestsSupported = !isMissingTable(requestsRes.error, "board_request_log");
      if (requestsRes.error && boardRequestsSupported) return res.status(500).json({ error: requestsRes.error.message });

      allSnapshots = snapshotsRes.data || [];
      allRequestLogs = boardRequestsSupported ? (requestsRes.data || []) : [];
    }

    // Determine setup sequence: which plan type needs negotiation next (5yr → 3yr → 1yr)
    const PLAN_SEQUENCE = ["5yr", "3yr", "1yr"];
    const setupNextPlanType = PLAN_SEQUENCE.find(pt => !allBoards.find(b => b.plan_type === pt)) || null;

    // Build per-plan data
    const plans = {};
    for (const planType of PLAN_SEQUENCE) {
      const board = allBoards.find(b => b.plan_type === planType) || null;

      if (!board) {
        plans[planType] = null;
        continue;
      }

      const planDuration = getPlanDuration(board.plan_type);
      const seasonsCompleted = board.seasons_completed || 0;
      const seasonsRemaining = Math.max(0, planDuration - seasonsCompleted);
      const planProgressPct = planDuration > 0 ? Math.round((seasonsCompleted / planDuration) * 100) : 0;
      const isExpired = board.negotiation_status === "pending";

      const boardSnapshots = allSnapshots
        .filter(s => s.board_id === board.id && s.season_number >= (board.plan_start_season_number || 0));

      const boardRequests = allRequestLogs.filter(r => r.board_id === board.id);
      const latestRequest = boardRequests[0] || null;
      const requestUsedThisSeason = Boolean(
        boardRequestsSupported && activeSeason?.number != null && latestRequest?.season_number === activeSeason.number
      );

      const workingSeasonIndex = Math.min(planDuration, seasonsCompleted + 1);
      const outlook = buildBoardOutlook({
        board,
        standing: currentStanding,
        team: currentTeam,
        context: {
          activeLoanCount,
          planStartSponsorIncome: board.plan_start_sponsor_income,
          currentSponsorIncome: teamRes.data?.sponsor_income ?? 0,
          planDuration,
          seasonsCompleted: workingSeasonIndex,
          hasSeasonData: Boolean(currentStanding),
          isExpired,
          recentSnapshots: boardSnapshots.slice(-3).reverse(),
          cumulativeStats: {
            stageWins: (board.cumulative_stage_wins || 0) + (currentStanding?.stage_wins || 0),
            gcWins: (board.cumulative_gc_wins || 0) + (currentStanding?.gc_wins || 0),
          },
        },
      });

      const requestOptions = boardRequestsSupported
        ? buildBoardRequestOptions({
          board,
          context: {
            isExpired,
            identityProfile,
            overallScore: outlook?.overall_score ?? null,
            requestUsedThisSeason,
          },
        })
        : [];

      plans[planType] = {
        board,
        plan_duration: planDuration,
        seasons_remaining: seasonsRemaining,
        seasons_completed: seasonsCompleted,
        plan_progress_pct: planProgressPct,
        cumulative_stats: {
          stage_wins: board.cumulative_stage_wins || 0,
          gc_wins: board.cumulative_gc_wins || 0,
        },
        snapshots: boardSnapshots,
        is_expired: isExpired,
        outlook,
        request_status: {
          supported: boardRequestsSupported,
          used_this_season: requestUsedThisSeason,
          latest_request: boardRequestsSupported ? serializeBoardRequest(latestRequest) : null,
        },
        request_options: requestOptions,
      };
    }

    res.json({
      plans,
      setup_next_plan_type: setupNextPlanType,
      team: teamRes.data,
      riders: ridersRes.data || [],
      standing: currentStanding,
      identity_profile: identityProfile,
      active_loans_count: activeLoanCount,
      request_support: {
        supported: boardRequestsSupported,
        active_season_number: activeSeason?.number ?? null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/board/proposal", requireAuth, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const { focus, plan_type } = req.body || {};
    if (!isValidBoardPlanType(plan_type)) {
      return res.status(400).json({ error: "Invalid plan_type" });
    }
    if (!isValidBoardFocus(focus)) {
      return res.status(400).json({ error: "Invalid focus" });
    }

    const context = await loadBoardPlanningContext(teamId);
    const board = context.boards.find(b => b.plan_type === plan_type) || null;
    const proposal = buildBoardProposal({
      focus,
      planType: plan_type,
      team: context.team,
      riders: context.riders,
      standing: context.standing,
      board,
    });

    res.json({ ok: true, ...proposal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/board/sign — sign a new board plan contract
router.post("/board/sign", requireAuth, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const { focus, plan_type, goals, negotiations } = req.body || {};
    if (!focus || !plan_type) return res.status(400).json({ error: "Missing fields" });
    if (!isValidBoardPlanType(plan_type)) return res.status(400).json({ error: "Invalid plan_type" });
    if (!isValidBoardFocus(focus)) return res.status(400).json({ error: "Invalid focus" });

    const context = await loadBoardPlanningContext(teamId);
    const { activeSeason, boards, riders, standing, team } = context;
    const existingBoard = boards.find(b => b.plan_type === plan_type) || null;
    const planDuration = getPlanDuration(plan_type);
    const startSeasonNumber = activeSeason?.number ?? 1;
    const endSeasonNumber = startSeasonNumber + planDuration - 1;

    const proposal = buildBoardProposal({
      focus,
      planType: plan_type,
      team,
      riders,
      standing,
      board: existingBoard,
    });

    let negotiationIndexes = [];

    if (Array.isArray(negotiations) && negotiations.length > 0) {
      negotiationIndexes = [...new Set(
        negotiations
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0 && value < proposal.goals.length)
      )];
    } else if (Array.isArray(goals) && goals.length > 0) {
      try {
        negotiationIndexes = inferNegotiationIndexesFromGoals({
          goals: proposal.goals,
          negotiationOptions: proposal.negotiation_options,
          submittedGoals: goals,
        });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    const finalGoals = finalizeBoardGoals({
      goals: proposal.goals,
      negotiationIndexes,
    });

    const upsertData = {
      team_id: teamId,
      focus,
      plan_type,
      current_goals: finalGoals,
      satisfaction: existingBoard?.satisfaction ?? 50,
      budget_modifier: existingBoard?.budget_modifier ?? 1.0,
      negotiation_status: "completed",
      plan_start_season_number: startSeasonNumber,
      plan_end_season_number: endSeasonNumber,
      plan_start_balance: team?.balance ?? 0,
      plan_start_sponsor_income: team?.sponsor_income ?? 100,
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      season_id: activeSeason?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data: board, error } = await supabase.from("board_profiles")
      .upsert(upsertData, { onConflict: "team_id,plan_type" }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      ok: true,
      board,
      goals: finalGoals,
      negotiation_indexes: negotiationIndexes,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/board/request", requireAuth, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const { plan_type, request_type } = req.body || {};
    if (!isValidBoardPlanType(plan_type)) {
      return res.status(400).json({ error: "Invalid plan_type" });
    }
    if (!isValidBoardRequestType(request_type)) {
      return res.status(400).json({ error: "Invalid request_type" });
    }

    const context = await loadBoardPlanningContext(teamId);
    const { activeSeason, boards, riders, standing, team } = context;
    const board = boards.find(b => b.plan_type === plan_type) || null;

    if (!board) return res.status(404).json({ error: "No active board plan for this plan type" });
    if (!activeSeason) return res.status(409).json({ error: "No active season" });
    if (board.negotiation_status !== "completed") {
      return res.status(409).json({ error: "Board plan must be active before requests" });
    }

    const [loansRes, snapshotsRes, requestLogRes] = await Promise.all([
      supabase.from("loans").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("status", "active"),
      supabase.from("board_plan_snapshots")
        .select("goals_met, goals_total, satisfaction_delta")
        .eq("board_id", board.id)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase.from("board_request_log")
        .select("id")
        .eq("board_id", board.id)
        .eq("season_number", activeSeason.number)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    if (loansRes.error) return res.status(500).json({ error: loansRes.error.message });
    if (snapshotsRes.error) return res.status(500).json({ error: snapshotsRes.error.message });
    if (isMissingTable(requestLogRes.error, "board_request_log")) {
      return res.status(503).json({
        error: "Board requests er ikke aktiveret endnu. Kør SQL-migrationen for board_request_log først.",
      });
    }
    if (requestLogRes.error) return res.status(500).json({ error: requestLogRes.error.message });

    const planDuration = getPlanDuration(board.plan_type);
    const workingSeasonIndex = Math.min(planDuration, (board.seasons_completed || 0) + 1);
    const requestUsedThisSeason = Boolean(requestLogRes.data?.length);

    if (requestUsedThisSeason) {
      return res.status(409).json({ error: "Board request already used this season" });
    }

    const requestResult = resolveBoardRequest({
      board,
      requestType: request_type,
      team: {
        ...(team || {}),
        riders,
      },
      standing,
      context: {
        activeLoanCount: loansRes.count || 0,
        currentSponsorIncome: team?.sponsor_income ?? 0,
        hasSeasonData: Boolean(standing),
        isExpired: board.negotiation_status === "pending",
        planDuration,
        planStartSponsorIncome: board.plan_start_sponsor_income,
        recentSnapshots: snapshotsRes.data || [],
        requestUsedThisSeason,
        seasonsCompleted: workingSeasonIndex,
        cumulativeStats: {
          stageWins: (board.cumulative_stage_wins || 0) + (standing?.stage_wins || 0),
          gcWins: (board.cumulative_gc_wins || 0) + (standing?.gc_wins || 0),
        },
      },
    });

    let updatedBoard = board;

    if (requestResult.updated_board) {
      const { data: boardUpdate, error: boardUpdateError } = await supabase.from("board_profiles")
        .update({
          focus: requestResult.updated_board.focus ?? board.focus,
          current_goals: requestResult.updated_board.current_goals ?? board.current_goals,
          updated_at: new Date().toISOString(),
        })
        .eq("id", board.id)
        .select("*")
        .single();

      if (boardUpdateError) return res.status(500).json({ error: boardUpdateError.message });
      updatedBoard = boardUpdate;
    }

    const notificationMessage = [requestResult.summary, requestResult.tradeoff_summary]
      .filter(Boolean)
      .join(" ");

    const { data: requestLog, error: requestInsertError } = await supabase.from("board_request_log")
      .insert({
        team_id: teamId,
        board_id: board.id,
        season_id: activeSeason.id,
        season_number: activeSeason.number,
        request_type,
        outcome: requestResult.outcome,
        title: requestResult.title,
        summary: requestResult.summary,
        tradeoff_summary: requestResult.tradeoff_summary,
        request_payload: {
          request_label: requestResult.request_label,
        },
        board_changes: {
          focus_before: board.focus,
          focus_after: requestResult.updated_board?.focus ?? board.focus,
          goal_changes: requestResult.goal_changes || [],
        },
      })
      .select("*")
      .single();

    if (requestInsertError) {
      if (isUniqueViolation(requestInsertError, "idx_board_request_log_board_season_unique")) {
        return res.status(409).json({ error: "Board request already used this season" });
      }
      return res.status(500).json({ error: requestInsertError.message });
    }

    await notifyTeamOwner(
      teamId,
      "board_update",
      requestResult.title,
      notificationMessage,
      board.id
    );

    const latestRequest = serializeBoardRequest(requestLog);
    const requestOptions = buildBoardRequestOptions({
      board: updatedBoard,
      context: {
        isExpired: updatedBoard.negotiation_status === "pending",
        requestUsedThisSeason: true,
      },
    });

    res.json({
      ok: true,
      board: updatedBoard,
      request_result: requestResult,
      request_status: {
        active_season_number: activeSeason.number,
        used_this_season: true,
        latest_request: latestRequest,
      },
      request_options: requestOptions,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/board/renew", requireAuth, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const { plan_type } = req.body || {};
    if (!isValidBoardPlanType(plan_type)) {
      return res.status(400).json({ error: "Invalid plan_type" });
    }

    const { data: board, error } = await supabase.from("board_profiles")
      .update({
        negotiation_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("team_id", teamId)
      .eq("plan_type", plan_type)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, board });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Beta-testværktøjer ────────────────────────────────────────────────────────

// POST /api/admin/beta/cancel-market — annuller alle åbne markedsaktiviteter
router.post("/admin/beta/cancel-market", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, cancelled: await cancelBetaMarket(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-rosters — returner manager-ryttere til AI-hold
router.post("/admin/beta/reset-rosters", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await resetBetaRosters(supabase)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-balances — sæt balance = 800.000 på manager-holds
router.post("/admin/beta/reset-balances", requireAdmin, async (req, res) => {
  try {
    const { clear_transactions = false } = req.body || {};
    res.json({ ok: true, ...(await resetBetaBalances(supabase, { clearTransactions: clear_transactions })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-divisions — sæt alle aktive managerhold tilbage til 3. division
router.post("/admin/beta/reset-divisions", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await resetBetaDivisions(supabase)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-board — nulstil bestyrelsesprofiler til baseline
router.post("/admin/beta/reset-board", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, board_profiles: await resetBetaBoardProfiles(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-calendar — ryd løbskalender, resultater og standings
router.post("/admin/beta/reset-calendar", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, race_calendar: await resetBetaRaceCalendar(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-seasons — ryd sæsoner
router.post("/admin/beta/reset-seasons", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, seasons: await resetBetaSeasons(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-manager-progress — nulstil XP og level
router.post("/admin/beta/reset-manager-progress", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, manager_progress: await resetBetaManagerProgress(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-achievements — ryd manager-achievement unlocks
router.post("/admin/beta/reset-achievements", requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, achievements: await resetBetaAchievements(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/full-reset — komplet beta-reset-suite
router.post("/admin/beta/full-reset", requireAdmin, async (req, res) => {
  try {
    const { clear_transactions = false, reset_mode = "test" } = req.body || {};
    res.json({
      ok: true,
      ...(await runFullBetaReset(supabase, {
        clearTransactions: clear_transactions,
        resetMode: reset_mode,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
