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
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "node:fs";
import {
  calculateAuctionEnd,
  isAuctionExpired,
  isLateBidTriggerError,
  applyLeaderShiftExtension,
  DEFAULT_AUCTION_CONFIG,
} from "../lib/auctionEngine.js";
import {
  computeAvailableBalance,
  computeReservedBalance,
  computeWorstCaseCommitment,
  getAuctionBidIssue,
  getAuctionBidWarnings,
  getAuctionInitialBidderId,
  getAuctionStartIssue,
  getAuctionStartPriceIssue,
  getMinimumAuctionBid,
  getProxyMaxIssue,
  getProxyOpeningBidAmount,
  getSpendIssue,
  isExpectedPriceStale,
} from "../lib/auctionRules.js";
import {
  finalizeAuctionById,
  finalizeExpiredAuctions as finalizeExpiredAuctionsShared,
} from "../lib/auctionFinalization.js";
import {
  buildTransitionPlan,
  closePrevTransferWindow,
  computeSeasonUuid,
  computeTransferWindowUuid,
  insertTransferWindowIfMissing,
  transitionToNextSeason,
} from "../lib/seasonTransition.js";
import { cancelAuctionByAdmin } from "../lib/auctionCancellation.js";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { aggregateRiderViews } from "../lib/riderProfileViews.js";
import {
  PAUSE_LEVELS,
  buildPauseErrorBody,
  getMarketPauseState,
  isActionBlockedDuringMarketPause,
  isAuctionsBlocked,
  isMarketBlocked,
  shiftCalculatedEnd,
} from "../lib/marketPause.js";
import { resolveProxyBids } from "../lib/proxyBidding.js";
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
  sendTestDM,
  getBotToken,
} from "../lib/discordNotifier.js";
import { getPendingInboxItems } from "../lib/inboxPending.js";
import {
  getLoanAgreementAcceptedStatus,
  getLoanBuyoutRiderUpdate,
  getLoanBuyoutStatus,
  getWindowPendingLoanFlushStatus,
  PARKED_LOAN_STATUSES,
} from "../lib/loanAgreementWindowing.js";
import { buildRiderHistory } from "../lib/riderHistory.js";
import { buildTeamTransferHistory } from "../lib/teamTransferHistory.js";
import { buildRiderBidTimeline } from "../lib/riderBidTimeline.js";
import { deriveScoutState, canScout } from "../lib/scouting.js";
import { deriveTrainingState, canTrain, isValidFocus, isValidIntensity } from "../lib/training.js";
import { handleDynCyclistSyncRequest } from "../lib/dynCyclistSync.js";
import {
  computeDebtRatio,
  computeSustainabilityTier,
} from "../lib/economyAdminDashboard.js";
import { computeMultiSeasonForecast } from "../lib/financeForecast.js";
import { buildSeasonFinanceReport } from "../lib/seasonFinanceReport.js";
import { groupCronRuns } from "../lib/cronRunCorrelation.js";
import { syncRaceResultsFromSheets } from "../lib/raceResultsSheetSync.js";
import { getSeasonPrizePreview, paySeasonPrizesToDate } from "../lib/prizePayoutEngine.js";
import {
  buildSeasonEndPreviewRows,
  DEFAULT_SPONSOR_INCOME,
  loadHumanSeasonEndTeams,
  processSeasonEnd,
  processSeasonStart,
  repairSeasonEndFinanceAndBoard,
  updateRiderValues,
  updateStandings,
} from "../lib/economyEngine.js";
import {
  SPONSOR_INCOME_BASE,
  ADMIN_ACTION_TYPE,
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "../lib/economyConstants.js";
import { incrementBalanceWithAudit } from "../lib/balanceRpc.js";
import { calculateRiderMarketValue } from "../lib/marketUtils.js";
import {
  predictBaseValue,
  riderOverall,
  riderSpecialty,
  ABILITY_KEYS,
} from "../lib/riderValuation.js";
import {
  BOARD_IDENTITY_RIDER_SELECT,
  annotateGoalWithIdentityBasis,
  buildBoardRequestOptions,
  buildBoardOutlook,
  buildBoardProposal,
  computeDnaSuggestions,
  deriveTeamIdentityProfile,
  finalizeBoardGoals,
  getArchetypeByKey,
  getBoardRenegotiationLock,
  getBoardRequestDefinition,
  getDnaByKey,
  getPlanDuration,
  inferNegotiationIndexesFromGoals,
  isValidBoardFocus,
  isValidBoardPlanType,
  isValidBoardRequestType,
  isValidDnaKey,
  loadGoalContextForBoard,
  chooseDnaForTeam,
  resolveBoardRequest,
} from "../lib/boardEngine.js";
import {
  confirmSwapOffer,
  confirmTransferOffer,
  flushWindowPendingOffers,
  getListingCancelIssue,
  getLoanCancelIssue,
  getSwapCancelIssue,
  getTransferCancelIssue,
} from "../lib/transferExecution.js";
import {
  acceptBonusOffer,
  assertSigningAllowed,
  declineBonusOffer,
  getActiveConsequencesForTeam,
} from "../lib/boardConsequences.js";
import { isBoardTestModeActive } from "../lib/boardTestMode.js";
import { openBoardTestMode, openBoardLive, closeBoardTestMode } from "../lib/boardTestModeService.js";
import {
  getIncomingSquadViolation,
  getTeamMarketState,
  MIN_RIDERS_FOR_RACE,
  TRANSFER_WINDOW_SOFT_CAP_BUFFER,
} from "../lib/marketUtils.js";
import {
  applyRaceResults,
  buildRacePointsLookup,
  buildRaceResultsFromPending,
  rederiveSeasonRacePoints,
} from "../lib/raceResultsEngine.js";
import { createAdminImportResultsHandler } from "../lib/adminImportResultsHandler.js";
import { adminImportUploadSingleFile, adminImportUploadMultipleFiles } from "../lib/adminImportUpload.js";
import { getDefaultWebhook, sendWebhook } from "../lib/discordNotifier.js";
import { importPcmResults, buildPcmImportEmbed } from "../lib/pcmResultsImport.js";
import { checkAchievements } from "../lib/achievementEngine.js";
import { captureException, setSentryUser } from "../lib/sentry.js";
import { upsertOwnTeamProfile } from "../lib/teamProfileEngine.js";
import { parseRacePoolCsv, summarizePool, WORLD_TOUR_CLASSES } from "../lib/racePoolImport.js";
import {
  UCI_MEN_RACE_CLASSES,
  UCI_MEN_RESULT_TYPES,
  buildUciMenRacePointRows,
} from "../lib/uciRacePointDefaults.js";
import {
  selectFirstSeasonRaces,
  selectSeasonRaces,
  DEFAULT_RACE_DAYS_TARGET,
} from "../lib/seasonRaceSelection.js";
import {
  cancelBetaMarket,
  resetBetaAchievements,
  resetBetaBalances,
  resetBetaBoardProfiles,
  resetBetaDivisions,
  resetBetaLoans,
  resetBetaManagerProgress,
  resetBetaNotifications,
  resetBetaRaceCalendar,
  resetBetaRiderHistory,
  resetBetaRosters,
  resetBetaSeasons,
  resetBetaTransferArchive,
  runFullBetaReset,
} from "../lib/betaResetService.js";
import {
  adminWriteLimiter,
  bidLimiter,
  boardWriteLimiter,
  marketWriteLimiter,
  presencePulseLimiter,
} from "../lib/rateLimiters.js";
import {
  cached,
  invalidateNamespace,
  getCacheStats,
} from "../lib/responseCache.js";

// Cache TTLs (ms). Tunable per ADR docs/decisions/cache-adr.md Phase 1.
// Riders: 60s — ownership changes propagate within one polling cycle; explicit
// invalidation on auction-finalize and transfer execution covers the high-
// visibility cases. Races / race-pool / race-points: 10 min — admin-only writes.
const CACHE_TTL = {
  riders: 60_000,
  races: 600_000,
  racePool: 600_000,
  racePoints: 600_000,
  dashboardRecentResults: 60_000,
  dashboardRiderRanking: 60_000,
};

// Load .env from backend root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env"), quiet: true });

const router = express.Router();

// #1101 rider-valuation model (committet JSON). Indlæses én gang ved opstart;
// mangler den (fx før første fit), degraderer valuation-fladerne pænt (null).
let VALUATION_MODEL = null;
try {
  VALUATION_MODEL = JSON.parse(
    readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8")
  );
} catch {
  VALUATION_MODEL = null;
}

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

async function fetchOwnProxiesByAuctionId(supabaseClient, teamId, auctionIds) {
  if (!auctionIds?.length || !teamId) return {};
  const { data } = await supabaseClient
    .from("auction_proxy_bids")
    .select("auction_id, max_amount")
    .eq("team_id", teamId)
    .in("auction_id", auctionIds);
  const byId = {};
  for (const row of data || []) {
    byId[row.auction_id] = row;
  }
  return byId;
}

// #44: hent ALLE mine aktive proxies på tværs af auktioner. Bruges af gates der
// skal kende worst-case commitment (fx PATCH /proxy, repayLoan, transfer-accept).
// Filtrerer på auction.status active/extended så vi ikke tæller proxies på lukkede
// auktioner.
async function fetchAllMyActiveProxies(supabaseClient, teamId) {
  if (!teamId) return [];
  const { data } = await supabaseClient
    .from("auction_proxy_bids")
    .select("auction_id, max_amount, auction:auction_id(status)")
    .eq("team_id", teamId);
  return (data || [])
    .filter((row) => ["active", "extended"].includes(row.auction?.status))
    .map((row) => ({ auction_id: row.auction_id, max_amount: row.max_amount }));
}

// #44: fetch leading auctions + all proxies + compute worst-case commitment.
// Canonical "hvad skylder denne manager potentielt?"-svar. Bruges af alle
// balance-reducerende endpoints (auction-bid, proxy-set, loan-repay, transfer-accept).
async function fetchTeamCommitment(supabaseClient, teamId) {
  if (!teamId) return { leadingAuctions: [], allMyProxies: [], commitment: 0 };

  const [leadingRes, allProxies] = await Promise.all([
    supabaseClient
      .from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", teamId),
    fetchAllMyActiveProxies(supabaseClient, teamId),
  ]);

  const leadingAuctions = leadingRes.data || [];
  const commitment = computeWorstCaseCommitment({ leadingAuctions, allMyProxies: allProxies });

  return { leadingAuctions, allMyProxies: allProxies, commitment };
}



// Supabase admin client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function ensureSeasonStandings(seasonId) {
  // #203: Test-konti udelukkes fra standings — ellers påvirker de leaderboards
  // for ægte managers (rank_in_division-måling, balanced-plans, etc.).
  const [{ data: teams, error: teamsError }, { data: standings, error: standingsError }] = await Promise.all([
    supabase.from("teams").select("id, division").eq("is_test_account", false),
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
  // #621 item 2 — tag eventuelle Sentry-events i resten af request-livscyklen
  // med user.id (UUID, ingen PII). Sentry v8+ Node-SDK scope'r per
  // OpenTelemetry-context, så dette lækker ikke til parallelle requests.
  setSentryUser(user.id);
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

// Lightweight admin-check til endpoints der betjener BÅDE admin og ikke-admin
// (modsat requireAdmin, som blokerer ikke-admin helt). Bruges til at gate fiktive
// ryttere (#669, pcm_id IS NULL): kun synlige/auktionerbare for admin under
// test/gradvis udrulning, så testere ikke ser eller kan handle dem.
async function isViewerAdmin(req) {
  if (!req.user?.id) return false;
  const { data: u } = await supabase
    .from("users")
    .select("role")
    .eq("id", req.user.id)
    .single();
  return u?.role === "admin";
}

// ── Auction config helper ─────────────────────────────────────────────────────

async function getAuctionConfig() {
  const { data } = await supabase.from("auction_timing_config").select("*").eq("id", 1).single();
  return data || DEFAULT_AUCTION_CONFIG;
}

// ── Market pause kill switch ──────────────────────────────────────────────────
// scope = 'auction' (auction-only routes) | 'market' (transfer/swap/loan routes)
// Returns true if the request is allowed; if false the response has already been
// sent with 503. Callers should `if (!await assertMarketOpen(...)) return;`.
async function assertMarketOpen(req, res, scope) {
  const state = await getMarketPauseState(supabase);
  if (scope === "auction" && isAuctionsBlocked(state.level)) {
    res.status(503).json(buildPauseErrorBody({ scope: "auctions", reason: state.reason }));
    return false;
  }
  if (scope === "market" && isMarketBlocked(state.level)) {
    res.status(503).json(buildPauseErrorBody({ scope: "market", reason: state.reason }));
    return false;
  }
  return true;
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

async function flushWindowPendingLoans() {
  const { data: pendingLoans, error } = await supabase
    .from("loan_agreements")
    .select(`id, rider_id, from_team_id, to_team_id, loan_fee, buy_option_price,
      rider:rider_id(id, firstname, lastname, team_id),
      from_team:from_team_id(name),
      to_team:to_team_id(name)`)
    .in("status", PARKED_LOAN_STATUSES);
  if (error) throw error;

  let loansProcessed = 0;
  let loanBuyoutsProcessed = 0;
  for (const loan of pendingLoans || []) {
    const riderName = `${loan.rider?.firstname ?? ""} ${loan.rider?.lastname ?? ""}`.trim();
    const nextStatus = getWindowPendingLoanFlushStatus(loan);

    if (nextStatus === "buyout") {
      await supabase.from("loan_agreements").update({ status: "buyout", updated_at: new Date().toISOString() }).eq("id", loan.id);
      await notifyTeamOwner(loan.from_team_id, "transfer_offer_accepted", "Købsoption gennemført",
        `${riderName} er nu skiftet permanent til ${loan.to_team?.name || "lejerholdet"}.`, loan.id);
      await notifyTeamOwner(loan.to_team_id, "transfer_offer_accepted", "Købsoption gennemført",
        `${riderName} er nu registreret permanent hos dit hold.`, loan.id);
      loanBuyoutsProcessed++;
    } else {
      await supabase.from("loan_agreements").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", loan.id);
      await notifyTeamOwner(loan.from_team_id, "transfer_offer_accepted", "Lejeaftale aktiveret",
        `${riderName} er nu registreret som udlejet til ${loan.to_team?.name || "lejerholdet"}.`, loan.id);
      await notifyTeamOwner(loan.to_team_id, "transfer_offer_accepted", "Lejeaftale aktiveret",
        `${riderName} er nu registreret som lejet af dit hold.`, loan.id);
      loansProcessed++;
    }
  }

  return { loansProcessed, loanBuyoutsProcessed };
}

// GET /api/transfer-window — current window status (public, auth required)
router.get("/transfer-window", requireAuth, async (req, res) => {
  const { open, window: tw } = await getTransferWindowStatus();
  res.json({ open, status: tw?.status || "closed", season_id: tw?.season_id || null });
});

// ── Deadline Day ──────────────────────────────────────────────────────────────

function computeDeadlineDayPhase(closesAt) {
  const secs = (new Date(closesAt) - Date.now()) / 1000;
  if (secs <= 0) return null;
  if (secs <= 1800) return "chaos";
  if (secs <= 7200) return "pressure";
  if (secs <= 86400) return "anticipation";
  return null;
}

// GET /api/deadline-day/status
router.get("/deadline-day/status", requireAuth, async (req, res) => {
  try {
    const [{ data: tw }, { data: cfg }] = await Promise.all([
      supabase.from("transfer_windows").select("status, closes_at").order("created_at", { ascending: false }).limit(1).single(),
      supabase.from("auction_timing_config").select("deadline_day_override").eq("id", 1).single(),
    ]);

    const override = cfg?.deadline_day_override || "auto";
    const closesAt = tw?.closes_at || null;

    if (override === "off") {
      return res.json({ active: false, phase: null, closes_at: closesAt, seconds_remaining: null, override });
    }

    if (override === "on") {
      const phase = closesAt ? (computeDeadlineDayPhase(closesAt) || "pressure") : "pressure";
      const seconds_remaining = closesAt ? Math.max(0, (new Date(closesAt) - Date.now()) / 1000) : null;
      return res.json({ active: true, phase, closes_at: closesAt, seconds_remaining, override });
    }

    // auto: kræver åbent vindue + closes_at sat + indenfor 24 timer
    if (!tw || tw.status !== "open" || !closesAt) {
      return res.json({ active: false, phase: null, closes_at: closesAt, seconds_remaining: null, override });
    }
    const seconds_remaining = (new Date(closesAt) - Date.now()) / 1000;
    if (seconds_remaining <= 0) {
      return res.json({ active: false, phase: null, closes_at: closesAt, seconds_remaining: 0, override });
    }
    const phase = computeDeadlineDayPhase(closesAt);
    if (!phase) {
      return res.json({ active: false, phase: null, closes_at: closesAt, seconds_remaining, override });
    }
    res.json({ active: true, phase, closes_at: closesAt, seconds_remaining, override });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/deadline-day/ticker
router.get("/deadline-day/ticker", requireAuth, async (req, res) => {
  try {
    const { data: tw } = await supabase
      .from("transfer_windows")
      .select("closes_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    // Use the actual DD window start (closes_at - 24h) so the ticker only shows
    // events from the current Deadline Day period, not random prior activity.
    const since = tw?.closes_at
      ? new Date(new Date(tw.closes_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: bids }, { data: sold }, { data: transfers }] = await Promise.all([
      supabase
        .from("auction_bids")
        .select("id, amount, bid_time, team:team_id(name), auction:auction_id(rider:rider_id(firstname, lastname))")
        .gte("bid_time", since)
        .order("bid_time", { ascending: false })
        .limit(15),
      supabase
        .from("auctions")
        .select("id, current_price, actual_end, winner:current_bidder_id(name), rider:rider_id(firstname, lastname)")
        .eq("status", "completed")
        .gte("actual_end", since)
        .order("actual_end", { ascending: false })
        .limit(10),
      supabase
        .from("transfer_offers")
        .select("id, offer_amount, updated_at, buyer:buyer_team_id(name), rider:rider_id(firstname, lastname), seller:seller_team_id(name)")
        .eq("status", "accepted")
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);

    const events = [];
    const fmt = n => Math.round(n / 1000) + "K";

    for (const b of (bids || [])) {
      const rider = b.auction?.rider;
      if (!rider) continue;
      events.push({ type: "bid", text: `${b.team?.name ?? "–"} bød ${fmt(b.amount)} på ${rider.firstname} ${rider.lastname}`, timestamp: b.bid_time });
    }
    for (const a of (sold || [])) {
      if (!a.winner || !a.rider) continue;
      events.push({ type: "sold", text: `${a.rider.firstname} ${a.rider.lastname} solgt til ${a.winner.name} for ${fmt(a.current_price)}`, timestamp: a.actual_end });
    }
    for (const t of (transfers || [])) {
      if (!t.rider || !t.buyer) continue;
      const sellerPart = t.seller ? ` fra ${t.seller.name}` : "";
      events.push({ type: "transfer", text: `${t.buyer.name} køber ${t.rider.firstname} ${t.rider.lastname}${sellerPart} for ${fmt(t.offer_amount)}`, timestamp: t.updated_at });
    }

    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    res.json(events.slice(0, 20));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/deadline-day/squads
router.get("/deadline-day/squads", requireAuth, async (req, res) => {
  try {
    // Roster-floor fjernet 2026-06-05: min=0 → Panic Board flagger aldrig "critical"/"warning" for under-min.
    const LIMITS = { 1: { min: 0, max: 30 }, 2: { min: 0, max: 20 }, 3: { min: 0, max: 10 } };
    const [{ data: teams }, { data: riders }] = await Promise.all([
      // Filter matcher v3.83 cron-fix (a57b8d9): kun aktive manager-hold tæller mod
      // squad-minimum. Frosne hold (is_frozen=true) + AI-hold + bank + eierløse rows
      // ekskluderes så Panic Board ikke flagger hold som ikke deltager i sæsonen.
      supabase.from("teams")
        .select("id, name, division")
        .eq("is_bank", false)
        .eq("is_ai", false)
        .eq("is_frozen", false)
        .not("user_id", "is", null)
        .order("division").order("name"),
      supabase.from("riders").select("team_id").not("team_id", "is", null),
    ]);
    if (!teams || !riders) throw new Error("data missing");

    const countByTeam = {};
    for (const r of riders) countByTeam[r.team_id] = (countByTeam[r.team_id] || 0) + 1;

    const squads = teams.map(t => {
      const count = countByTeam[t.id] || 0;
      const { min, max } = LIMITS[t.division] || { min: 0, max: 30 };
      // min=0 (roster-floor fjernet) → aldrig critical/warning; kun et reelt min>0 flagger.
      const status = min > 0 && count < min ? "critical" : min > 0 && count <= min + 1 ? "warning" : "ok";
      return { id: t.id, name: t.name, division: t.division, riders: count, min, max, status };
    });
    res.json(squads);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RIDERS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/riders — search and filter riders
// Cached per (sorted-query). 60s TTL; auction-finalize, transfer/swap execute,
// loan, retirement, and admin override-rider invalidate the namespace.
router.get("/riders", requireAuth, cached({ namespace: "riders", ttlMs: CACHE_TTL.riders }, async (req, res) => {
  const {
    q, team_id, free_agent, u25, min_uci, max_uci,
    sort = "market_value", order = "desc",
    page = 1, limit = 50,
  } = req.query;

  let query = supabase
    .from("riders")
    .select(`
      id, pcm_id, firstname, lastname, birthdate, market_value,
      salary, is_u25, nationality_code, popularity,
      stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
      stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
      stat_res, stat_ftr,
      team:team_id(id, name)
    `, { count: "exact" })
    .eq("is_retired", false);

  // #669: fiktive ryttere (pcm_id NULL) er admin-only under test — skjult fra den
  // brugervendte database. Admin inspicerer dem via GET /admin/riders.
  query = query.not("pcm_id", "is", null);

  if (q) {
    query = query.or(
      `firstname.ilike.%${q}%,lastname.ilike.%${q}%`
    );
  }
  if (team_id) query = query.eq("team_id", team_id);
  if (free_agent === "true") query = query.is("team_id", null);
  if (u25 === "true") query = query.eq("is_u25", true);
  // #1101 cutover: min_uci/max_uci-params beholdes for API-kompat, men filtrerer
  // nu på market_value (samme mapping som frontend useRiderFilters).
  if (min_uci) query = query.gte("market_value", parseInt(min_uci));
  if (max_uci) query = query.lte("market_value", parseInt(max_uci));

  const allowedSort = ["market_value", "stat_bj", "stat_sp", "stat_tt",
                       "stat_fl", "lastname", "birthdate"];
  const requestedSort = sort === "uci_points" ? "market_value" : sort;
  const safeSort = allowedSort.includes(requestedSort) ? requestedSort : "market_value";
  query = query
    .order(safeSort, { ascending: order === "asc" })
    .range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ riders: data, total: count, page: parseInt(page), limit: parseInt(limit) });
}));

// GET /api/riders/:id — single rider detail
router.get("/riders/:id", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("riders")
    .select(`*, team:team_id(id, name)`)
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Rider not found" });
  // #669: en fiktiv rytter (pcm_id NULL) findes kun for admin under test.
  if (data.pcm_id === null && !(await isViewerAdmin(req))) {
    return res.status(404).json({ error: "Rider not found" });
  }

  // #1101 SHADOW: vedhæft den data-drevne base_value som PREVIEW (beta-chip).
  // Beregnes live fra modellen — styrer endnu intet i økonomien. null hvis model
  // mangler eller rytter ingen abilities har.
  if (VALUATION_MODEL) {
    const { data: ab } = await supabase
      .from("rider_derived_abilities")
      .select("*")
      .eq("rider_id", data.id)
      .maybeSingle();
    data.base_value_preview = predictBaseValue(data, ab, VALUATION_MODEL, {
      asOf: VALUATION_MODEL.fitted_at,
    });
  }

  res.json(data);
});

// GET /api/riders/:id/history — ejerskab og handelshistorik
router.get("/riders/:id/history", requireAuth, async (req, res) => {
  try {
    const events = await buildRiderHistory(supabase, req.params.id);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teams/:id/transfer-history — komplet handelshistorik for ét hold (#25)
router.get("/teams/:id/transfer-history", requireAuth, async (req, res) => {
  try {
    const events = await buildTeamTransferHistory(supabase, req.params.id);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/riders/:id/bid-timeline — live bud-historik for seneste auktion (#195)
// Privacy-låst: proxy_max eksponeres ALDRIG. Aktiv auktion returnerer timeline,
// completed auktion returnerer kun final-bud + vinder/sælger.
router.get("/riders/:id/bid-timeline", requireAuth, async (req, res) => {
  try {
    const payload = await buildRiderBidTimeline(supabase, req.params.id);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCOUTING (#1138 — progression L1: skjult potentiale, begrænset kapacitet)
// ═══════════════════════════════════════════════════════════════════════════════

// Hjælper: hent aktiv sæson-id + holdets scout-state (ledger → slots + niveauer).
async function loadScoutState(teamId) {
  const { data: season } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  const activeSeasonId = season?.id ?? null;
  const { data: rows, error } = await supabase
    .from("scout_actions").select("rider_id, season_id").eq("team_id", teamId);
  if (error) throw new Error(error.message);
  return { activeSeasonId, state: deriveScoutState(rows, activeSeasonId) };
}

// GET /api/scouting/me — holdets scout-state: slots (total/used/remaining),
// maxLevel og per-rytter niveau. Frontend bruger niveauet til at beregne
// estimat-bredden (display-lag v1).
router.get("/scouting/me", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const { state } = await loadScoutState(req.team.id);
    res.json({ ...state, teamId: req.team.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scouting/:riderId — brug ét scout-slot på en rytter (indsnævrer
// estimatet ét niveau). Håndhæver slot-kapacitet + maxLevel. Idempotens er
// bevidst FRA: hver handling forbruger et slot (det er ressource-mekanikken).
router.post("/scouting/:riderId", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  const riderId = req.params.riderId;
  try {
    const { activeSeasonId, state } = await loadScoutState(req.team.id);
    if (!activeSeasonId) return res.status(409).json({ error: "No active season" });

    // Rytteren skal findes (og ikke være ens egen — egne ryttere vises eksakt).
    const { data: rider } = await supabase
      .from("riders").select("id, team_id").eq("id", riderId).maybeSingle();
    if (!rider) return res.status(404).json({ error: "Rider not found" });
    if (rider.team_id && rider.team_id === req.team.id) {
      return res.status(400).json({ error: "own_rider", message: "Own riders are already fully known." });
    }

    const currentLevel = state.levels[riderId] ?? 0;
    const guard = canScout(currentLevel, state.slots.remaining);
    if (!guard.ok) return res.status(409).json({ error: guard.reason });

    const { error: insErr } = await supabase
      .from("scout_actions")
      .insert({ team_id: req.team.id, rider_id: riderId, season_id: activeSeasonId });
    if (insErr) throw new Error(insErr.message);

    // Returnér frisk state så UI'et kan opdatere slots + niveau uden ekstra round-trip.
    const { state: next } = await loadScoutState(req.team.id);
    res.json({ ok: true, riderId, level: next.levels[riderId] ?? 0, slots: next.slots, maxLevel: next.maxLevel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRÆNING (#1163 — progression L2 teaser: sæson-granulær træningsfokus)
// ═══════════════════════════════════════════════════════════════════════════════

// Hjælper: hent aktiv sæson-id + holdets træningsstate (ledger → slots + planer).
async function loadTrainingState(teamId) {
  const { data: season } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  const activeSeasonId = season?.id ?? null;
  const { data: rows, error } = await supabase
    .from("training_plans").select("rider_id, season_id, focus, intensity").eq("team_id", teamId);
  if (error) throw new Error(error.message);
  return { activeSeasonId, state: deriveTrainingState(rows, activeSeasonId) };
}

// GET /api/training/me — holdets træningsstate: slots (total/used/remaining),
// gyldige fokus/intensiteter og per-rytter aktiv plan (kun den aktive sæson).
router.get("/training/me", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const { state } = await loadTrainingState(req.team.id);
    res.json({ ...state, teamId: req.team.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/:riderId — sæt/ændr en træningsfokus på en EGEN rytter.
// Body: { focus, intensity }. Ny plan forbruger ét slot; om-målretning af en
// eksisterende plan koster ikke et nyt slot (upsert på (team,rider,season)).
router.post("/training/:riderId", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  const riderId = req.params.riderId;
  const { focus, intensity } = req.body ?? {};
  if (!isValidFocus(focus)) return res.status(400).json({ error: "invalid_focus" });
  if (!isValidIntensity(intensity)) return res.status(400).json({ error: "invalid_intensity" });
  try {
    const { activeSeasonId, state } = await loadTrainingState(req.team.id);
    if (!activeSeasonId) return res.status(409).json({ error: "No active season" });

    // Træning er KUN for egne ryttere (du former din egen trup).
    const { data: rider } = await supabase
      .from("riders").select("id, team_id").eq("id", riderId).maybeSingle();
    if (!rider) return res.status(404).json({ error: "Rider not found" });
    if (rider.team_id !== req.team.id) {
      return res.status(403).json({ error: "not_own_rider", message: "You can only train your own riders." });
    }

    const hasPlan = Boolean(state.plans[riderId]);
    const guard = canTrain(hasPlan, state.slots.remaining);
    if (!guard.ok) return res.status(409).json({ error: guard.reason });

    const { error: upErr } = await supabase
      .from("training_plans")
      .upsert(
        { team_id: req.team.id, rider_id: riderId, season_id: activeSeasonId, focus, intensity, updated_at: new Date().toISOString() },
        { onConflict: "team_id,rider_id,season_id" }
      );
    if (upErr) throw new Error(upErr.message);

    const { state: next } = await loadTrainingState(req.team.id);
    res.json({ ok: true, riderId, plan: next.plans[riderId] ?? null, slots: next.slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/training/:riderId — fjern en træningsfokus (frigør slottet).
router.delete("/training/:riderId", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  const riderId = req.params.riderId;
  try {
    const { activeSeasonId } = await loadTrainingState(req.team.id);
    if (!activeSeasonId) return res.status(409).json({ error: "No active season" });
    const { error: delErr } = await supabase
      .from("training_plans")
      .delete()
      .eq("team_id", req.team.id).eq("rider_id", riderId).eq("season_id", activeSeasonId);
    if (delErr) throw new Error(delErr.message);
    const { state: next } = await loadTrainingState(req.team.id);
    res.json({ ok: true, riderId, plan: null, slots: next.slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      rider:rider_id(id, firstname, lastname, market_value, prize_earnings_bonus, is_u25,
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
router.post("/auctions", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  if (!(await assertMarketOpen(req, res, "auction"))) return;

  const { rider_id, starting_price, min_increment = 1, flash_auction = false } = req.body;
  if (!rider_id) return res.status(400).json({ error: "rider_id required" });

  // Flash auction guard: only allowed during Deadline Day
  if (flash_auction) {
    const [{ data: tw }, { data: ddCfg }] = await Promise.all([
      supabase.from("transfer_windows").select("status, closes_at").order("created_at", { ascending: false }).limit(1).single(),
      supabase.from("auction_timing_config").select("deadline_day_override").eq("id", 1).single(),
    ]);
    const override = ddCfg?.deadline_day_override || "auto";
    let ddActive = false;
    if (override === "on") {
      ddActive = true;
    } else if (override !== "off" && tw?.status === "open" && tw?.closes_at) {
      const secs = (new Date(tw.closes_at) - Date.now()) / 1000;
      ddActive = secs > 0 && secs <= 86400;
    }
    if (!ddActive) return res.status(403).json({ error: "Flash Auktioner er kun tilgængelige under Deadline Day", errorCode: "flash_deadline_day_only" });
  }

  // Verify rider belongs to this team
  const { data: rider } = await supabase
    .from("riders")
    .select("id, firstname, lastname, team_id, pending_team_id, is_retired, market_value, pcm_id")
    .eq("id", rider_id)
    .single();

  if (!rider) return res.status(404).json({ error: "Rider not found" });

  // #669: fiktive ryttere (pcm_id NULL) kan kun auktioneres af admin under test —
  // forhindrer at en tester trækker en endnu-ukalibreret rytter i spil økonomisk.
  if (rider.pcm_id === null && !(await isViewerAdmin(req))) {
    return res.status(403).json({ error: "Rytteren er ikke tilgængelig", errorCode: "rider_unavailable" });
  }

  // Block: rider awaits transfer to a previous auction winner.
  const auctionStartIssue = getAuctionStartIssue({ rider });
  if (auctionStartIssue) {
    if (auctionStartIssue.code === "rider_retired") {
      return res.status(409).json({ error: "Rytteren er pensioneret og kan ikke sættes på auktion", errorCode: "rider_retired_auction" });
    }
    return res.status(409).json({ error: "Rytteren er vundet på en auktion og afventer overførsel til det nye hold", errorCode: "rider_pending_transfer_auction" });
  }

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
      return res.status(403).json({ error: "Denne rytter tilhører en anden manager", errorCode: "rider_other_manager" });
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

  const riderValue = Math.max(calculateRiderMarketValue(rider), 1);
  const isOwnRider = Boolean(rider.team_id) && rider.team_id === req.team.id;

  const priceIssue = getAuctionStartPriceIssue({ startingPrice: starting_price, riderValue, isOwnRider });
  if (priceIssue) {
    if (priceIssue.code === "invalid_start_price") {
      return res.status(400).json({ error: "Ugyldig startpris", errorCode: "invalid_start_price" });
    }
    const formatted = riderValue.toLocaleString("da-DK");
    if (priceIssue.code === "own_price_out_of_range") {
      return res.status(400).json({ error: `Startpris skal være mellem 0 og rytterens Værdi (${formatted} CZ$)`, errorCode: "start_price_own_range", errorParams: { value: riderValue } });
    }
    return res.status(400).json({ error: `Startpris skal mindst matche rytterens Værdi (${formatted} CZ$)`, errorCode: "start_price_min_value", errorParams: { value: riderValue } });
  }

  const price = (starting_price === null || starting_price === undefined || starting_price === "")
    ? riderValue
    : Number(starting_price);
  const auctionCfg = await getAuctionConfig();
  const calculatedEnd = flash_auction
    ? new Date(Date.now() + 30 * 60 * 1000)
    : calculateAuctionEnd(new Date(), auctionCfg);
  const initialBidderId = getAuctionInitialBidderId({
    riderTeamId: rider.team_id,
    managerTeamId: req.team.id,
  });

  let creationWarnings = [];
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
    const proxiesByAuctionId = await fetchOwnProxiesByAuctionId(
      supabase,
      initialBidderId,
      activeLeading.map(row => row.id),
    );
    const totalCommitment = computeReservedBalance({
      leadingAuctions: activeLeading,
      proxiesByAuctionId,
    }) + price;
    if ((Number(teamState.balance) || 0) < totalCommitment) {
      return res.status(400).json({ error: "Startbuddet overstiger din disponible balance inkl. aktive auktionsføringer", errorCode: "start_bid_exceeds_balance" });
    }

    // Squad-cap er ikke længere en hard block (#29) — håndhæves ved vindue-luk via squadEnforcement.
    creationWarnings = getAuctionBidWarnings({
      teamState,
      activeLeadingCount: activeLeading.length,
    });
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
      is_flash: flash_auction,
    })
    .select()
    .single();

  if (error) {
    // Unique-violation på uniq_auctions_one_active_per_rider betyder en parallel
    // request (typisk dobbeltklik) lige nåede at oprette auktion på samme rytter
    // mellem vores SELECT-tjek ovenfor og denne INSERT. Returner samme 409 som
    // SELECT-tjekket, så frontend ser én konsistent fejl.
    if (error.code === "23505") {
      return res.status(409).json({ error: "Rider already has an active auction" });
    }
    return res.status(500).json({ error: error.message });
  }

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
    riderValue: rider.market_value,
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
        notify(w.user_id, "watchlist_rider_auction", "Ønskeliste-rytter til auktion",
          `${riderFullName} er sat til auktion (startpris ${price.toLocaleString("da-DK")} CZ$)`,
          auction.id).catch(() => {})
      ));
    }
  })().catch(() => {});

  res.status(201).json({
    auction,
    message: `Auktion startet — slutter ${calculatedEnd.toLocaleString("da-DK")}`,
    warnings: creationWarnings,
  });
});

// POST /api/auctions/:id/bid — place a bid
router.post("/auctions/:id/bid", requireAuth, bidLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  if (!(await assertMarketOpen(req, res, "auction"))) return;

  const { amount, proxy_max } = req.body;
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

  // #194 race-confirm: hvis client sendte expected_current_price og det er stale,
  // returnér 409 så frontend kan vise confirm-modal med ny pris/min-bud.
  if (isExpectedPriceStale(req.body.expected_current_price, auction.current_price)) {
    return res.status(409).json({
      error: "price_changed",
      currentPrice: auction.current_price,
      minimumBid: getMinimumAuctionBid(auction.current_price, {
        hasActiveBid: Boolean(auction.current_bidder_id),
      }),
    });
  }

  // Allow bidding on own auction ONLY for AI/free rider auctions
  // Block bidding on own auction if selling your own team's rider
  if (auction.seller_team_id === req.team.id) {
    const { data: auctionRider } = await supabase
      .from("riders").select("team_id").eq("id", auction.rider_id).single();
    if (auctionRider?.team_id === req.team.id) {
      return res.status(400).json({ error: "Du kan ikke byde på din egen rytter", errorCode: "cannot_bid_own_rider" });
    }
  }
  // #44: worst-case commitment EXKL. denne auktion. Hvis manageren allerede leder
  // denne auktion eller har en proxy på den, ekskluderer vi det bidrag — det
  // tæller med via proxyMax-parameteren til getAuctionBidIssue.
  const [{ leadingAuctions: allLeading, allMyProxies }, teamState] = await Promise.all([
    fetchTeamCommitment(supabase, req.team.id),
    getTeamMarketState(supabase, req.team.id),
  ]);
  const leadingExceptThis = allLeading.filter((row) => row.id !== auction.id);
  const proxiesExceptThis = allMyProxies.filter((p) => p.auction_id !== auction.id);
  const reservedBalance = computeWorstCaseCommitment({
    leadingAuctions: leadingExceptThis,
    allMyProxies: proxiesExceptThis,
  });
  const bidIssue = getAuctionBidIssue({
    amount,
    proxyMax: proxy_max,
    currentPrice: auction.current_price,
    currentBidderId: auction.current_bidder_id,
    teamBalance: req.team.balance,
    reservedBalance,
  });

  if (bidIssue?.code === "bid_below_minimum") {
    return res.status(400).json({
      error: `Bud skal være mindst ${bidIssue.minimumBid.toLocaleString("da-DK")} CZ$`,
      errorCode: "bid_below_minimum",
      errorParams: { min: bidIssue.minimumBid },
    });
  }

  if (bidIssue?.code === "insufficient_available_balance") {
    const availableBalance = computeAvailableBalance({
      teamBalance: req.team.balance,
      commitment: reservedBalance,
    });
    return res.status(400).json({
      error: `Du har ${availableBalance.toLocaleString("da-DK")} CZ$ tilbage efter eksisterende bud`,
      errorCode: "insufficient_balance_after_bids",
      errorParams: { available: availableBalance },
    });
  }

  // Bagudkompat: aktivLedingExceptCurrent bruges af getAuctionBidWarnings nedenfor.
  const activeLeadingExceptCurrent = leadingExceptThis;

  // Squad-cap er ikke længere en hard block (#29). Konverteret til warning som UI viser
  // efter bud er placeret. Manager må gerne lede 11+ auktioner under vinduet — squadEnforcement
  // auto-sælger og bøder kun hvis trupstørrelsen stadig er over max ved vindue-luk.
  const bidWarnings = getAuctionBidWarnings({
    teamState,
    activeLeadingCount: activeLeadingExceptCurrent.length,
    alreadyLeadingThisAuction: auction.current_bidder_id === req.team.id,
  });

  // S-02e · Hard-block ved aktivt lag 2 (salary cap) eller lag 3 (signing-restriktion).
  const signingBlock = await assertSigningAllowed({
    supabase,
    buyerTeamId: req.team.id,
    riderId: auction.rider_id,
    purchasePrice: amount,
  });
  if (signingBlock) {
    return res.status(403).json({ error: signingBlock.reason, code: signingBlock.code, layer: signingBlock.layer });
  }

  // #257: capture leader BEFORE the bid so we can later check whether the
  // bid+cascade actually changed who's leading. Extension is applied once
  // after cascade settles, only if leader changed.
  const previousLeader = auction.current_bidder_id;
  const bidTime = new Date();
  const bidCfg = await getAuctionConfig();

  // Record bid (triggered_extension flag may be set later by
  // applyLeaderShiftExtension if this bid ends up causing the extension).
  // #269: BEFORE INSERT trigger reject_late_auction_bid afviser bids hvor
  // bid_time >= auctions.calculated_end (race-vinduet mellem fetch-expiry-check
  // og INSERT). Oversæt P0001-fejlen til 400 "Auktionen er udløbet".
  const { error: bidInsertError } = await supabase.from("auction_bids").insert({
    auction_id: auction.id,
    team_id: req.team.id,
    amount,
    bid_time: bidTime.toISOString(),
    triggered_extension: false,
  });
  if (bidInsertError) {
    if (isLateBidTriggerError(bidInsertError)) {
      return res.status(400).json({ error: "Auktionen er udløbet", errorCode: "auction_expired" });
    }
    return res.status(500).json({ error: "Bud kunne ikke gemmes", errorCode: "bid_save_failed" });
  }

  // Update auction (price + leader only — no extension yet).
  await supabase.from("auctions").update({
    current_price: amount,
    current_bidder_id: req.team.id,
  }).eq("id", auction.id);

  // Store proxy max-loft if provided with the bid
  const numericProxyMax = Number(proxy_max);
  if (Number.isFinite(numericProxyMax) && numericProxyMax > amount) {
    await supabase.from("auction_proxy_bids").upsert(
      { auction_id: auction.id, team_id: req.team.id, max_amount: numericProxyMax },
      { onConflict: "auction_id,team_id" }
    );
  }

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
    }).catch((e) => console.error("[notifyOutbid] failed", { auctionId: auction.id, error: e.message }));
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

  // Resolve proxy counter-bids — auto-bid on behalf of managers with max-loft
  try {
    await resolveProxyBids({
      supabase,
      auctionId: auction.id,
      bidTime,
      bidCfg,
      notifyTeamOwner,
      notifyOutbidDM: notifyOutbid,
    });
  } catch (e) {
    console.error("[resolveProxyBids] failed for auction", auction.id, e);
  }

  // #257: extend only if the cascade left someone OTHER than previousLeader
  // in the lead. If A had a proxy that counter-beats B's manual bid,
  // current_bidder_id is back to A == previousLeader → no extension.
  let extensionApplied = false;
  let extensionEnd = null;
  try {
    const result = await applyLeaderShiftExtension({
      supabase,
      auctionId: auction.id,
      previousLeader,
      bidTime,
      bidCfg,
    });
    extensionApplied = result.extensionApplied;
    extensionEnd = result.newEnd;
  } catch (e) {
    console.error("[applyLeaderShiftExtension] failed for auction", auction.id, e);
  }

  // Re-fetch final price so response reflects post-cascade state (relevant
  // when cascade pushed price above the manual bid).
  const { data: finalAuction } = await supabase
    .from("auctions")
    .select("current_price")
    .eq("id", auction.id)
    .single();

  res.json({
    success: true,
    new_price: finalAuction?.current_price ?? amount,
    extended: extensionApplied,
    new_end: extensionApplied && extensionEnd ? extensionEnd.toISOString() : undefined,
    warnings: bidWarnings,
  });
});

// GET /api/auctions/:id/proxy — fetch my proxy bid for this auction
router.get("/auctions/:id/proxy", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  const { data } = await supabase
    .from("auction_proxy_bids")
    .select("max_amount, created_at")
    .eq("auction_id", req.params.id)
    .eq("team_id", req.team.id)
    .single();
  res.json({ proxy: data || null });
});

// PATCH /api/auctions/:id/proxy — set or update my proxy max-loft
router.patch("/auctions/:id/proxy", requireAuth, bidLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  if (!(await assertMarketOpen(req, res, "auction"))) return;

  const numericMax = Number(req.body.max_amount);
  if (!Number.isFinite(numericMax) || numericMax <= 0) {
    return res.status(400).json({ error: "Ugyldigt max-loft", errorCode: "invalid_proxy_max" });
  }

  const { data: auction } = await supabase
    .from("auctions")
    .select("id, current_price, current_bidder_id, status, calculated_end, seller_team_id, rider_id, extension_count, rider:rider_id(firstname, lastname, team_id)")
    .eq("id", req.params.id)
    .single();

  if (!auction) return res.status(404).json({ error: "Auction not found" });
  if (!["active", "extended"].includes(auction.status)) {
    return res.status(400).json({ error: "Auction is not active" });
  }
  if (isAuctionExpired(auction.calculated_end)) {
    return res.status(400).json({ error: "Auction has ended" });
  }
  // Block setting proxy on own rider auction (mirror bid-endpoint guard)
  if (auction.seller_team_id === req.team.id) {
    const { data: auctionRider } = await supabase
      .from("riders").select("team_id").eq("id", auction.rider_id).single();
    if (auctionRider?.team_id === req.team.id) {
      return res.status(400).json({ error: "Du kan ikke sætte autobud på din egen rytter", errorCode: "cannot_proxy_own_rider" });
    }
  }

  const minRequired = getMinimumAuctionBid(auction.current_price, {
    hasActiveBid: Boolean(auction.current_bidder_id),
  });
  if (numericMax < minRequired) {
    return res.status(400).json({
      error: `Max-loft skal være mindst ${minRequired.toLocaleString("da-DK")} CZ$`,
      errorCode: "proxy_below_minimum",
      errorParams: { min: minRequired },
    });
  }
  const openingBidAmount = getProxyOpeningBidAmount({
    proxyMax: numericMax,
    currentPrice: auction.current_price,
    currentBidderId: auction.current_bidder_id,
    isLeading: auction.current_bidder_id === req.team.id,
  });

  // #44: gate proxy_max mod available balance. Worst case = MAX(current_price, proxy_max)
  // hvis manageren leder denne auktion, ellers proxy_max. otherCommitment ekskluderer
  // alle andre auktioner manageren er involveret i (leading + ikke-leading proxies).
  const [{ leadingAuctions, allMyProxies }, teamState] = await Promise.all([
    fetchTeamCommitment(supabase, req.team.id),
    openingBidAmount !== null ? getTeamMarketState(supabase, req.team.id) : Promise.resolve(null),
  ]);
  const otherCommitment = computeWorstCaseCommitment({
    leadingAuctions: leadingAuctions.filter((row) => row.id !== req.params.id),
    allMyProxies: allMyProxies.filter((p) => p.auction_id !== req.params.id),
  });
  const proxyIssue = getProxyMaxIssue({
    proxyMax: numericMax,
    currentPrice: auction.current_price,
    isLeading: auction.current_bidder_id === req.team.id,
    teamBalance: req.team.balance,
    otherCommitment,
  });
  if (proxyIssue?.code === "insufficient_available_balance") {
    return res.status(400).json({
      error: `Du har ${proxyIssue.availableBalance.toLocaleString("da-DK")} CZ$ tilbage efter eksisterende bud og autobud`,
      errorCode: "insufficient_balance_after_proxy",
      errorParams: { available: proxyIssue.availableBalance },
    });
  }

  if (openingBidAmount !== null) {
    const signingBlock = await assertSigningAllowed({
      supabase,
      buyerTeamId: req.team.id,
      riderId: auction.rider_id,
      purchasePrice: openingBidAmount,
    });
    if (signingBlock) {
      return res.status(403).json({ error: signingBlock.reason, code: signingBlock.code, layer: signingBlock.layer });
    }
  }

  const { error: proxyUpsertError } = await supabase.from("auction_proxy_bids").upsert(
    { auction_id: req.params.id, team_id: req.team.id, max_amount: numericMax },
    { onConflict: "auction_id,team_id" }
  );
  if (proxyUpsertError) {
    return res.status(500).json({ error: "Autobud kunne ikke gemmes", errorCode: "proxy_save_failed" });
  }

  const proxyBidTime = new Date();
  const proxyBidCfg = await getAuctionConfig();
  // #257: capture leader before opening bid so post-cascade extension check
  // can detect whether this proxy actually disrupted the standing leader.
  const previousLeader = auction.current_bidder_id;
  let bidWarnings = [];
  if (openingBidAmount !== null) {
    bidWarnings = getAuctionBidWarnings({
      teamState,
      activeLeadingCount: leadingAuctions.filter((row) => row.id !== req.params.id).length,
      alreadyLeadingThisAuction: false,
    });

    // #269: oversæt reject_late_auction_bid trigger-fejl til 400 i stedet for 500.
    const { error: bidInsertError } = await supabase.from("auction_bids").insert({
      auction_id: auction.id,
      team_id: req.team.id,
      amount: openingBidAmount,
      bid_time: proxyBidTime.toISOString(),
      triggered_extension: false,
      is_proxy: true,
    });
    if (bidInsertError) {
      if (isLateBidTriggerError(bidInsertError)) {
        return res.status(400).json({ error: "Auktionen er udløbet", errorCode: "auction_expired" });
      }
      return res.status(500).json({ error: "Autobud kunne ikke placeres", errorCode: "proxy_place_failed" });
    }

    const { error: auctionUpdateError } = await supabase
      .from("auctions")
      .update({
        current_price: openingBidAmount,
        current_bidder_id: req.team.id,
      })
      .eq("id", auction.id);
    if (auctionUpdateError) {
      return res.status(500).json({ error: "Autobud kunne ikke opdatere auktionen", errorCode: "proxy_update_failed" });
    }

    const riderName = `${auction.rider?.firstname || "Ukendt"} ${auction.rider?.lastname || "rytter"}`.trim();
    if (auction.current_bidder_id && auction.current_bidder_id !== req.team.id) {
      await notifyTeamOwner(
        auction.current_bidder_id,
        "auction_outbid",
        "Du er blevet overbudt!",
        `${req.team.name}'s autobud bød ${openingBidAmount.toLocaleString("da-DK")} CZ$ på ${riderName}`,
        auction.id,
      );
    }
    if (auction.rider?.team_id === auction.seller_team_id && auction.seller_team_id !== req.team.id) {
      await notifyTeamOwner(
        auction.seller_team_id,
        "bid_received",
        "Nyt bud modtaget",
        `${req.team.name}'s autobud bød ${openingBidAmount.toLocaleString("da-DK")} CZ$ på ${riderName}`,
        auction.id,
      );
    }
    awardXP(req.user.id, "bid_placed").catch(() => {});
  }
  try {
    await resolveProxyBids({
      supabase,
      auctionId: req.params.id,
      bidTime: proxyBidTime,
      bidCfg: proxyBidCfg,
      notifyTeamOwner,
      notifyOutbidDM: notifyOutbid,
    });
  } catch (e) {
    console.error("[resolveProxyBids] failed for auction", req.params.id, e);
  }

  // #257: only extend if cascade left a different leader than before.
  if (openingBidAmount !== null) {
    try {
      await applyLeaderShiftExtension({
        supabase,
        auctionId: req.params.id,
        previousLeader,
        bidTime: proxyBidTime,
        bidCfg: proxyBidCfg,
      });
    } catch (e) {
      console.error("[applyLeaderShiftExtension] failed for auction", req.params.id, e);
    }
  }

  res.json({
    success: true,
    max_amount: numericMax,
    placed_bid: openingBidAmount !== null,
    bid_amount: openingBidAmount ?? undefined,
    warnings: bidWarnings,
  });
});

// DELETE /api/auctions/:id/proxy — remove my proxy bid
router.delete("/auctions/:id/proxy", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  await supabase
    .from("auction_proxy_bids")
    .delete()
    .eq("auction_id", req.params.id)
    .eq("team_id", req.team.id);
  res.json({ success: true });
});

// POST /api/auctions/:id/finalize — complete one auction via shared finalizer
router.post("/auctions/:id/finalize", requireAdmin, adminWriteLimiter, async (req, res) => {
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

  // Rider ownership changed; drop cached /api/riders responses immediately.
  invalidateNamespace("riders");
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
      rider:rider_id(id, firstname, lastname, market_value, prize_earnings_bonus, is_u25, nationality_code,
        stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
        stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr),
      seller:seller_team_id(id, name)`)
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/transfers — list own rider for sale
// #19: salgs-listinger kan oprettes uanset transfervindue. Selve handlen
// (køb/accept) flyttes pengemæssigt ved aftale, men rytter-registreringen sker
// først ved vindue-åbning (se transferExecution.js deferRegistration).
router.post("/transfers", requireAuth, marketWriteLimiter, async (req, res) => {
  const { rider_id, asking_price } = req.body;
  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname, is_retired").eq("id", rider_id).single();
  if (!rider || rider.team_id !== req.team.id)
    return res.status(403).json({ error: "Du ejer ikke denne rytter", errorCode: "rider_not_owned" });
  if (rider.is_retired)
    return res.status(409).json({ error: "Rytteren er pensioneret og kan ikke sættes til salg", errorCode: "rider_retired_listing" });

  // #247: maks én aktiv listing pr. rytter. Tjekkes først her, og DB-niveau
  // partial unique index (uniq_transfer_listings_one_active_per_rider) fanger
  // race-vinduer.
  const { data: existingListing } = await supabase
    .from("transfer_listings")
    .select("id")
    .eq("rider_id", rider_id)
    .in("status", ["open", "negotiating"])
    .maybeSingle();
  if (existingListing) {
    return res.status(409).json({ error: "Rytteren er allerede til salg på transfermarkedet", errorCode: "rider_already_listed" });
  }

  const { data, error } = await supabase
    .from("transfer_listings")
    .insert({ rider_id, seller_team_id: req.team.id, asking_price })
    .select().single();
  if (error) {
    // 23505 = unique_violation fra uniq_transfer_listings_one_active_per_rider
    // ved race mellem SELECT-tjek og INSERT (typisk dobbeltklik).
    if (error.code === "23505") {
      return res.status(409).json({ error: "Rytteren er allerede til salg på transfermarkedet", errorCode: "rider_already_listed" });
    }
    return res.status(500).json({ error: error.message });
  }

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
router.delete("/transfers/:id", requireAuth, marketWriteLimiter, async (req, res) => {
  const { data: listing } = await supabase
    .from("transfer_listings")
    .select("seller_team_id, status")
    .eq("id", req.params.id)
    .maybeSingle();
  const issue = getListingCancelIssue(listing, { teamId: req.team.id });
  if (issue) {
    const message = {
      not_found: "Listing findes ikke",
      not_owner: "Ikke din liste",
      already_closed: "Listingen er allerede lukket",
    }[issue.code];
    const errorCode = {
      not_found: "listing_not_found",
      not_owner: "listing_not_owner",
      already_closed: "listing_already_closed",
    }[issue.code];
    const status = issue.code === "already_closed" ? 400 : 403;
    return res.status(status).json({ error: message, errorCode });
  }
  // 'withdrawn' matcher status-enum'en (open|negotiating|sold|withdrawn) og parallelt
  // mønster i transfer_offers/swap_offers withdraw-flows. 'closed' er ikke i CHECK-
  // enum'en og fejlede silently i prod (#270 follow-up: silent CHECK violation).
  const { error: updateErr } = await supabase
    .from("transfer_listings")
    .update({ status: "withdrawn" })
    .eq("id", req.params.id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });
  res.json({ success: true });
});

// POST /api/transfers/offer — direct offer on any rider (no listing needed)
// #19: tilbud kan sendes uanset transfervindue. Ved bekræftelse betales der med
// det samme, men rytter-registreringen udskydes til vinduet åbner (lukket vindue).
router.post("/transfers/offer", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!(await assertMarketOpen(req, res, "market"))) return;
  const { open } = await getTransferWindowStatus();

  const { rider_id, offer_amount, message } = req.body;
  if (!rider_id || !offer_amount) return res.status(400).json({ error: "rider_id og offer_amount kræves" });

  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname, is_retired").eq("id", rider_id).single();
  if (!rider || !rider.team_id) return res.status(404).json({ error: "Rytter ikke fundet eller har intet hold", errorCode: "rider_not_found_or_no_team" });
  if (rider.is_retired) return res.status(409).json({ error: "Rytteren er pensioneret og kan ikke handles", errorCode: "rider_retired_trade" });
  if (rider.team_id === req.team.id) return res.status(400).json({ error: "Du kan ikke byde på din egen rytter", errorCode: "cannot_bid_own_rider" });

  const { data: sellerTeam } = await supabase
    .from("teams")
    .select("is_bank")
    .eq("id", rider.team_id)
    .single();
  if (sellerTeam?.is_bank) {
    return res.status(400).json({ error: "AI-ryttere kan ikke modtage direkte tilbud. Start eller byd på en auktion i stedet.", errorCode: "ai_rider_no_direct_offer" });
  }

  // Check buyer balance
  const buyerState = await getTeamMarketState(supabase, req.team.id);
  if (offer_amount > buyerState.balance)
    return res.status(400).json({ error: "Du har ikke råd til dette tilbud", errorCode: "cannot_afford_offer" });

  // Check squad size limits for buyer.
  // #19/#267: +2 soft-cap buffer gælder kun i åbent vindue; lukket → hard-cap.
  const squadViolation = getIncomingSquadViolation(buyerState, {
    softCapBuffer: open ? TRANSFER_WINDOW_SOFT_CAP_BUFFER : 0,
  });
  if (squadViolation)
    return res.status(400).json({
      error: `Dit hold er fyldt (${squadViolation.effectiveCap} ryttere — Div ${buyerState.division || 3} cap ${squadViolation.maxRiders}${squadViolation.softCapBuffer ? ` + ${squadViolation.softCapBuffer} buffer i transfervinduet` : ""})`,
      errorCode: squadViolation.softCapBuffer ? "squad_full_buffer" : "squad_full",
      errorParams: { effectiveCap: squadViolation.effectiveCap, division: buyerState.division || 3, maxRiders: squadViolation.maxRiders, buffer: squadViolation.softCapBuffer },
    });

  // S-02e · Hard-block ved aktivt lag 2 (salary cap) eller lag 3 (signing-restriktion).
  const signingBlock = await assertSigningAllowed({
    supabase,
    buyerTeamId: req.team.id,
    riderId: rider_id,
    purchasePrice: offer_amount,
  });
  if (signingBlock) {
    return res.status(403).json({ error: signingBlock.reason, code: signingBlock.code, layer: signingBlock.layer });
  }

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
  }).catch((e) => console.error("[notifyTransferOffer] failed", { offerId: data.id, error: e.message }));

  res.status(201).json(data);
});

// GET /api/transfers/my-offers — my sent and received offers
router.get("/transfers/my-offers", requireAuth, async (req, res) => {
  // Only return offers where this team is buyer OR seller
  // Other teams' offers on same rider are NOT visible
  const [sentRes, receivedRes] = await Promise.all([
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, buyer_confirmed, seller_confirmed, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, market_value, prize_earnings_bonus, nationality_code, stat_bj, stat_sp, stat_tt, stat_fl),
        seller:seller_team_id(id, name)`)
      .eq("buyer_team_id", req.team.id)
      .is("buyer_archived_at", null)
      .order("updated_at", { ascending: false }),
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, buyer_confirmed, seller_confirmed, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, market_value, prize_earnings_bonus, nationality_code, stat_bj, stat_sp, stat_tt, stat_fl),
        buyer:buyer_team_id(id, name)`)
      .eq("seller_team_id", req.team.id)
      .is("seller_archived_at", null)
      .order("updated_at", { ascending: false }),
  ]);
  const [archivedSentRes, archivedReceivedRes] = await Promise.all([
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, buyer_confirmed, seller_confirmed, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, market_value, prize_earnings_bonus, nationality_code, stat_bj, stat_sp, stat_tt, stat_fl),
        seller:seller_team_id(id, name)`)
      .eq("buyer_team_id", req.team.id)
      .not("buyer_archived_at", "is", null)
      .order("buyer_archived_at", { ascending: false }),
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, buyer_confirmed, seller_confirmed, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, market_value, prize_earnings_bonus, nationality_code, stat_bj, stat_sp, stat_tt, stat_fl),
        buyer:buyer_team_id(id, name)`)
      .eq("seller_team_id", req.team.id)
      .not("seller_archived_at", "is", null)
      .order("seller_archived_at", { ascending: false }),
  ]);
  // Compute seller_squad_critical for each offer
  const allSent = [...(sentRes.data || []), ...(archivedSentRes.data || [])];
  const sentSellerIds = allSent.map(o => o.seller?.id).filter(Boolean);
  const uniqueTeamIds = [...new Set([req.team.id, ...sentSellerIds])];

  const [{ data: squadRiders }, { data: squadTeams }] = await Promise.all([
    supabase.from("riders").select("team_id").in("team_id", uniqueTeamIds),
    supabase.from("teams").select("id, division").in("id", uniqueTeamIds),
  ]);
  // Roster-floor fjernet 2026-06-05: min=0 → seller_squad_critical-flaget fyrer aldrig.
  const SQUAD_MINS = { 1: 0, 2: 0, 3: 0 };
  const teamDiv = Object.fromEntries((squadTeams || []).map(t => [t.id, t.division]));
  const riderCounts = {};
  for (const r of (squadRiders || [])) riderCounts[r.team_id] = (riderCounts[r.team_id] || 0) + 1;
  const squadCritical = (teamId) => {
    const min = SQUAD_MINS[teamDiv[teamId]];
    // min=0 (roster-floor fjernet) → hastebudsignalet fyrer aldrig.
    return min > 0 && (riderCounts[teamId] || 0) <= min;
  };

  res.json({
    sent: (sentRes.data || []).map(o => ({ ...o, seller_squad_critical: squadCritical(o.seller?.id) })),
    received: (receivedRes.data || []).map(o => ({ ...o, seller_squad_critical: squadCritical(req.team.id) })),
    archivedSent: (archivedSentRes.data || []).map(o => ({ ...o, seller_squad_critical: squadCritical(o.seller?.id) })),
    archivedReceived: (archivedReceivedRes.data || []).map(o => ({ ...o, seller_squad_critical: squadCritical(req.team.id) })),
  });
});

// PATCH /api/transfers/offers/:id — accept, reject, counter, confirm, cancel, or withdraw
router.patch("/transfers/offers/:id", requireAuth, marketWriteLimiter, async (req, res) => {
  const { action, counter_amount, message } = req.body;

  // Market pause: allow only cleanup actions (withdraw/reject/cancel/archive) when paused.
  if (isActionBlockedDuringMarketPause(action)) {
    if (!(await assertMarketOpen(req, res, "market"))) return;
  }

  const { data: offer } = await supabase
    .from("transfer_offers")
    .select(`*, rider:rider_id(id, firstname, lastname, team_id, market_value)`)
    .eq("id", req.params.id).single();

  if (!offer) return res.status(404).json({ error: "Tilbud ikke fundet", errorCode: "offer_not_found" });

  const isSeller = offer.seller_team_id === req.team.id;
  const isBuyer = offer.buyer_team_id === req.team.id;
  if (!isSeller && !isBuyer) return res.status(403).json({ error: "Ikke involveret i dette tilbud", errorCode: "not_involved_offer" });

  if (action === "archive") {
    if (!["accepted", "rejected", "withdrawn"].includes(offer.status)) {
      return res.status(400).json({ error: "Kun afsluttede tilbud kan arkiveres", errorCode: "only_closed_offers_archivable" });
    }

    const archiveField = isSeller ? "seller_archived_at" : "buyer_archived_at";
    await supabase.from("transfer_offers")
      .update({ [archiveField]: new Date().toISOString() })
      .eq("id", offer.id);

    return res.json({ success: true, action: "archived" });
  }

  // ACCEPT — seller accepts buyer's offer → awaiting buyer confirmation
  if (action === "accept" && isSeller && offer.status === "pending") {
    const price = offer.counter_amount || offer.offer_amount;

    // Soft balance check — final check happens at confirmation
    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", offer.buyer_team_id).single();
    if (!buyer || buyer.balance < price)
      return res.status(400).json({ error: "Køber har ikke råd", errorCode: "buyer_cannot_afford" });

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
    }).catch((e) => console.error("[notifyTransferResponse:accepted] failed", { offerId: offer.id, error: e.message }));

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
    }).catch((e) => console.error("[notifyTransferResponse:rejected] failed", { offerId: offer.id, error: e.message }));
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
    }).catch((e) => console.error("[notifyTransferResponse:countered] failed", { offerId: offer.id, error: e.message }));
    return res.json({ success: true, action: "countered", counter_amount });
  }

  // ACCEPT COUNTER — buyer accepts seller's counteroffer → awaiting seller confirmation
  if (action === "accept_counter" && isBuyer && offer.status === "countered") {
    const price = offer.counter_amount;

    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    if (!buyer || buyer.balance < price)
      return res.status(400).json({ error: "Du har ikke råd", errorCode: "cannot_afford" });

    // S-02e · Hard-block ved aktivt lag 2/3 (genkontrol — sat kan have ændret sig siden offer).
    const signingBlock = await assertSigningAllowed({
      supabase,
      buyerTeamId: req.team.id,
      riderId: offer.rider_id,
      purchasePrice: price,
    });
    if (signingBlock) {
      return res.status(403).json({ error: signingBlock.reason, code: signingBlock.code, layer: signingBlock.layer });
    }

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
      auditCtx: { actorType: FINANCE_ACTOR_TYPE.API, actorId: req.user.id },
    });

    if (!result.ok) {
      // Forward the structured { code, params } from transferExecution so EN
      // players get a localized message instead of the raw DA `error` (#678).
      return res.status(result.status).json({
        error: result.error,
        errorCode: result.code,
        ...(result.errorParams ? { errorParams: result.errorParams } : {}),
      });
    }

    // Executed transfer changes rider ownership; drop /api/riders cache.
    // "accepted" is returned by executeTransferOffer when both sides confirmed
    // AND the transfer window was open. "confirmed_partial" / "window_pending"
    // do not yet move the rider, so cache stays.
    if (result.action === "accepted") {
      invalidateNamespace("riders");
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
      return res.status(400).json({ error: "Handlen er accepteret af begge parter og kan ikke annulleres af manager", errorCode: "deal_locked_both_confirmed" });
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
    return res.status(400).json({ error: "Handlen er accepteret af begge parter og kan ikke annulleres af manager", errorCode: "deal_locked_both_confirmed" });
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

  return res.status(400).json({ error: "Ugyldig handling", errorCode: "invalid_action" });
});

// POST /api/transfers/:id/offer — legacy route (listing-based offer)
// #19: tilbud kan sendes uanset transfervindue (betal ved aftale, registrér ved åbning).
router.post("/transfers/:id/offer", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!(await assertMarketOpen(req, res, "market"))) return;
  const { open } = await getTransferWindowStatus();

  const { offer_amount, message } = req.body;
  const { data: listing } = await supabase
    .from("transfer_listings")
    .select("*, rider:rider_id(id, firstname, lastname, team_id)")
    .eq("id", req.params.id).single();
  if (!listing || listing.status !== "open")
    return res.status(404).json({ error: "Listing ikke fundet", errorCode: "listing_unavailable" });
  if (listing.seller_team_id === req.team.id)
    return res.status(400).json({ error: "Kan ikke byde på eget udbud", errorCode: "cannot_bid_own_listing" });
  const { data: listingSeller } = await supabase
    .from("teams")
    .select("is_bank")
    .eq("id", listing.seller_team_id)
    .single();
  if (listingSeller?.is_bank)
    return res.status(400).json({ error: "AI-ryttere kan ikke modtage direkte tilbud. Start eller byd på en auktion i stedet.", errorCode: "ai_rider_no_direct_offer" });
  const listingBuyerState = await getTeamMarketState(supabase, req.team.id);
  if (offer_amount > listingBuyerState.balance)
    return res.status(400).json({ error: "Du har ikke råd til dette tilbud", errorCode: "cannot_afford_offer" });
  // #19/#267: +2 soft-cap buffer kun i åbent vindue; lukket → hard-cap.
  const listingSquadViolation = getIncomingSquadViolation(listingBuyerState, {
    softCapBuffer: open ? TRANSFER_WINDOW_SOFT_CAP_BUFFER : 0,
  });
  if (listingSquadViolation)
    return res.status(400).json({
      error: `Dit hold er fyldt (${listingSquadViolation.effectiveCap} ryttere — Div ${listingBuyerState.division || 3} cap ${listingSquadViolation.maxRiders}${listingSquadViolation.softCapBuffer ? ` + ${listingSquadViolation.softCapBuffer} buffer i transfervinduet` : ""})`,
      errorCode: listingSquadViolation.softCapBuffer ? "squad_full_buffer" : "squad_full",
      errorParams: { effectiveCap: listingSquadViolation.effectiveCap, division: listingBuyerState.division || 3, maxRiders: listingSquadViolation.maxRiders, buffer: listingSquadViolation.softCapBuffer },
    });
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
    offered:offered_rider_id(id, firstname, lastname, market_value, stat_bj, stat_sp, stat_tt, stat_fl),
    requested:requested_rider_id(id, firstname, lastname, market_value, stat_bj, stat_sp, stat_tt, stat_fl),
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
// #19: byttehandler kan foreslås uanset transfervindue (betal kontant-delta ved
// aftale, registrér rytterskiftet ved vindue-åbning).
router.post("/transfers/swaps", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!(await assertMarketOpen(req, res, "market"))) return;

  const { offered_rider_id, requested_rider_id, cash_adjustment = 0, message } = req.body;
  if (!offered_rider_id || !requested_rider_id)
    return res.status(400).json({ error: "offered_rider_id og requested_rider_id kræves" });

  const [offeredRes, requestedRes] = await Promise.all([
    supabase.from("riders").select("id, team_id, firstname, lastname, is_retired").eq("id", offered_rider_id).single(),
    supabase.from("riders").select("id, team_id, firstname, lastname, is_retired").eq("id", requested_rider_id).single(),
  ]);
  const offered = offeredRes.data;
  const requested = requestedRes.data;

  if (!offered || offered.team_id !== req.team.id)
    return res.status(400).json({ error: "Din tilbudte rytter tilhører ikke dit hold", errorCode: "offered_rider_not_owned" });
  if (offered.is_retired)
    return res.status(409).json({ error: "Din tilbudte rytter er pensioneret og kan ikke handles", errorCode: "offered_rider_retired" });
  if (!requested || !requested.team_id)
    return res.status(404).json({ error: "Målrytter ikke fundet eller har intet hold", errorCode: "target_rider_not_found" });
  if (requested.is_retired)
    return res.status(409).json({ error: "Målrytteren er pensioneret og kan ikke handles", errorCode: "target_rider_retired" });
  if (requested.team_id === req.team.id)
    return res.status(400).json({ error: "Du kan ikke bytte med dig selv", errorCode: "cannot_swap_self" });
  const { data: requestedTeam } = await supabase
    .from("teams")
    .select("is_bank")
    .eq("id", requested.team_id)
    .single();
  if (requestedTeam?.is_bank)
    return res.status(400).json({ error: "AI-ryttere kan ikke indgå i direkte byttehandler. Brug auktioner i stedet.", errorCode: "ai_rider_no_swap" });

  if (cash_adjustment > 0) {
    const proposingState = await getTeamMarketState(supabase, req.team.id);
    if (proposingState.balance < cash_adjustment)
      return res.status(400).json({ error: "Du har ikke råd til den ønskede kontantbetaling", errorCode: "cannot_afford_cash_adjustment" });
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
router.patch("/transfers/swaps/:id", requireAuth, marketWriteLimiter, async (req, res) => {
  const { action, counter_cash, message } = req.body;

  // Market pause: allow only cleanup actions (withdraw/reject/cancel/archive) when paused.
  if (isActionBlockedDuringMarketPause(action)) {
    if (!(await assertMarketOpen(req, res, "market"))) return;
  }

  const { data: swap } = await supabase
    .from("swap_offers")
    .select(`*, offered:offered_rider_id(id, firstname, lastname, team_id),
      requested:requested_rider_id(id, firstname, lastname, team_id)`)
    .eq("id", req.params.id).single();

  if (!swap) return res.status(404).json({ error: "Byttehandel ikke fundet", errorCode: "swap_not_found" });

  const isProposing  = swap.proposing_team_id === req.team.id;
  const isReceiving  = swap.receiving_team_id === req.team.id;
  if (!isProposing && !isReceiving)
    return res.status(403).json({ error: "Ikke involveret i denne byttehandel", errorCode: "not_involved_swap" });

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

  // COUNTER — receiving team counters a pending offer
  if (action === "counter" && isReceiving && swap.status === "pending" && counter_cash !== undefined) {
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

  // COUNTER-COUNTER — proposing team counters back after receiving a counter
  if (action === "counter" && isProposing && swap.status === "countered" && counter_cash !== undefined) {
    await supabase.from("swap_offers").update({
      status: "pending",
      cash_adjustment: counter_cash,
      counter_cash: null,
      message: message || swap.message,
      updated_at: new Date().toISOString(),
    }).eq("id", swap.id);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_counter",
      "Modbud på byttehandel",
      `${req.team.name} sender modbud: ${swap.offered.firstname} ${swap.offered.lastname} ↔ ${swap.requested.firstname} ${swap.requested.lastname} (${counter_cash > 0 ? "+" : ""}${counter_cash.toLocaleString()} CZ$)`,
      swap.id);
    return res.json({ success: true, action: "re_countered", counter_cash });
  }

  // ACCEPT COUNTER — proposing team accepts receiver's counter → awaiting receiving confirmation
  if (action === "accept_counter" && isProposing && swap.status === "countered") {
    const effectiveCash = swap.counter_cash;
    if (effectiveCash > 0) {
      const { data: proposingTeam } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
      if (!proposingTeam || proposingTeam.balance < effectiveCash)
        return res.status(400).json({ error: "Du har ikke råd til det kontra-tilbud", errorCode: "cannot_afford_counter" });
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
      auditCtx: { actorType: FINANCE_ACTOR_TYPE.API, actorId: req.user.id },
    });

    if (!result.ok) {
      // Forward the structured { code, params } from transferExecution so EN
      // players get a localized message instead of the raw DA `error` (#678).
      return res.status(result.status).json({
        error: result.error,
        errorCode: result.code,
        ...(result.errorParams ? { errorParams: result.errorParams } : {}),
      });
    }

    // Executed swap moves two riders between teams; drop /api/riders cache.
    if (result.action === "accepted") {
      invalidateNamespace("riders");
    }

    return res.json({ success: true, action: result.action });
  }

  // CANCEL — either party can cancel only before both parties have accepted.
  if (action === "cancel" && swap.status === "awaiting_confirmation") {
    if (getSwapCancelIssue(swap)) {
      return res.status(400).json({ error: "Byttehandlen er accepteret af begge parter og kan ikke annulleres af manager", errorCode: "swap_locked_both_confirmed" });
    }
    await supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swap.id);
    const otherTeamId = isProposing ? swap.receiving_team_id : swap.proposing_team_id;
    await notifyTeamOwner(otherTeamId, "transfer_offer_rejected",
      "Byttehandel annulleret",
      `${req.team.name} har trukket sig fra byttehandlen.`, swap.id);
    return res.json({ success: true, action: "cancelled" });
  }
  if (action === "cancel" && getSwapCancelIssue(swap)) {
    return res.status(400).json({ error: "Byttehandlen er accepteret af begge parter og kan ikke annulleres af manager", errorCode: "swap_locked_both_confirmed" });
  }

  // WITHDRAW — proposing team withdraws pending offer
  if (action === "withdraw" && isProposing && swap.status === "pending") {
    await supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swap.id);
    return res.json({ success: true, action: "withdrawn" });
  }

  return res.status(400).json({ error: "Ugyldig handling", errorCode: "invalid_action" });
});

// ── Loan Agreements ───────────────────────────────────────────────────────────

const LOAN_FIELDS = `id, loan_fee, start_season, end_season, buy_option_price, status, created_at, updated_at,
  rider:rider_id(id, firstname, lastname, market_value, stat_bj, stat_sp, stat_tt, stat_fl),
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
router.post("/loans", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!(await assertMarketOpen(req, res, "market"))) return;
  const { open } = await getTransferWindowStatus();

  const { rider_id, loan_fee = 0, start_season, end_season, buy_option_price } = req.body;
  if (!rider_id || !start_season || !end_season)
    return res.status(400).json({ error: "rider_id, start_season og end_season kræves" });
  if (end_season < start_season)
    return res.status(400).json({ error: "end_season skal være >= start_season" });
  if (end_season > start_season)
    return res.status(400).json({ error: "Lejeaftale kan max dække 1 sæson — sæt start og slut til samme sæsonnummer", errorCode: "loan_max_one_season" });

  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname, is_retired").eq("id", rider_id).single();
  if (!rider || !rider.team_id)
    return res.status(404).json({ error: "Rytter ikke fundet eller har intet hold", errorCode: "rider_not_found_or_no_team" });
  if (rider.is_retired)
    return res.status(409).json({ error: "Rytteren er pensioneret og kan ikke lejes", errorCode: "rider_retired_loan" });
  if (rider.team_id === req.team.id)
    return res.status(400).json({ error: "Du kan ikke leje din egen rytter", errorCode: "cannot_loan_own_rider" });

  // Check no active loan already exists for this rider
  const { data: existing } = await supabase.from("loan_agreements")
    .select("id").eq("rider_id", rider_id).in("status", ["pending","active"]).limit(1);
  if (existing && existing.length > 0)
    return res.status(400).json({ error: "Rytteren er allerede udlejet eller har et afventende lejeforslag", errorCode: "rider_already_loaned" });

  const borrowerState = await getTeamMarketState(supabase, req.team.id);
  // #19/#267: soft-cap buffer kun i åbent vindue; lukket vindue bruger hard-cap.
  const proposalSquadViolation = getIncomingSquadViolation(borrowerState, {
    softCapBuffer: open ? TRANSFER_WINDOW_SOFT_CAP_BUFFER : 0,
  });
  if (proposalSquadViolation)
    return res.status(400).json({
      error: `Dit hold er fyldt (${proposalSquadViolation.effectiveCap} ryttere — Div ${borrowerState.division || 3} cap ${proposalSquadViolation.maxRiders}${proposalSquadViolation.softCapBuffer ? ` + ${proposalSquadViolation.softCapBuffer} buffer i transfervinduet` : ""}). Lejeaftalen kan ikke oprettes.`,
      errorCode: proposalSquadViolation.softCapBuffer ? "squad_full_loan_propose_buffer" : "squad_full_loan_propose",
      errorParams: { effectiveCap: proposalSquadViolation.effectiveCap, division: borrowerState.division || 3, maxRiders: proposalSquadViolation.maxRiders, buffer: proposalSquadViolation.softCapBuffer },
    });

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
router.patch("/loans/:id", requireAuth, marketWriteLimiter, async (req, res) => {
  const { action } = req.body;

  // Market pause: allow only cleanup actions (reject/cancel) when paused.
  if (isActionBlockedDuringMarketPause(action)) {
    if (!(await assertMarketOpen(req, res, "market"))) return;
  }

  const { data: loan } = await supabase
    .from("loan_agreements")
    .select(`*, rider:rider_id(id, firstname, lastname, team_id)`)
    .eq("id", req.params.id).single();
  if (!loan) return res.status(404).json({ error: "Lejeaftale ikke fundet", errorCode: "loan_not_found" });

  const isLender   = loan.from_team_id === req.team.id;
  const isBorrower = loan.to_team_id   === req.team.id;
  if (!isLender && !isBorrower)
    return res.status(403).json({ error: "Ikke involveret i denne lejeaftale", errorCode: "not_involved_loan" });

  // ACCEPT — lending team accepts
  if (action === "accept" && isLender && loan.status === "pending") {
    const { open } = await getTransferWindowStatus();
    const borrowerState = await getTeamMarketState(supabase, loan.to_team_id);
    // #19/#267: lukket vindue parkerer aktivering, så brug hard-cap her.
    const activationSquadViolation = getIncomingSquadViolation(borrowerState, {
      softCapBuffer: open ? TRANSFER_WINDOW_SOFT_CAP_BUFFER : 0,
    });
    if (activationSquadViolation)
      return res.status(400).json({
        error: `Lejerens hold er fyldt (${activationSquadViolation.effectiveCap} ryttere — Div ${borrowerState.division || 3} cap ${activationSquadViolation.maxRiders}${activationSquadViolation.softCapBuffer ? ` + ${activationSquadViolation.softCapBuffer} buffer i transfervinduet` : ""}). Lejeaftalen kan ikke aktiveres.`,
        errorCode: activationSquadViolation.softCapBuffer ? "squad_full_loan_accept_buffer" : "squad_full_loan_accept",
        errorParams: { effectiveCap: activationSquadViolation.effectiveCap, division: borrowerState.division || 3, maxRiders: activationSquadViolation.maxRiders, buffer: activationSquadViolation.softCapBuffer },
      });

    // Deduct first season's loan fee from borrower if > 0
    if (loan.loan_fee > 0) {
      const { data: borrower } = await supabase.from("teams").select("balance").eq("id", loan.to_team_id).single();
      if (!borrower)
        return res.status(400).json({ error: "Lejer-hold ikke fundet", errorCode: "borrower_team_not_found" });
      // #44: lejegebyret må ikke pushe lejer i underbalance ift. eksisterende auktioner.
      const { commitment: borrowerCommitment } = await fetchTeamCommitment(supabase, loan.to_team_id);
      const spendIssue = getSpendIssue({
        teamBalance: borrower.balance,
        commitment: borrowerCommitment,
        attemptedSpend: loan.loan_fee,
      });
      if (spendIssue?.code === "insufficient_available_balance") {
        return res.status(400).json({
          error: `Lejer har kun ${spendIssue.availableBalance.toLocaleString("da-DK")} CZ$ tilgængelig efter aktive bud — kan ikke betale lejegebyr på ${loan.loan_fee.toLocaleString("da-DK")} CZ$`,
          errorCode: "loan_fee_insufficient",
          errorParams: { available: spendIssue.availableBalance, fee: loan.loan_fee },
        });
      }
      // Slice 07c: balance + finance_transactions atomic via RPC.
      // 07d Fase B / #240: api-actor; lender bekræfter aktivering så req.user.id = lender.
      // season_id sættes eksplicit fra activeSeason — triggeren er en safety-net, ikke en undskyldning.
      const { data: loanAcceptSeason } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
      const loanAcceptSeasonId = loanAcceptSeason?.id ?? null;
      await incrementBalanceWithAudit(supabase, {
        teamId: loan.to_team_id,
        delta: -loan.loan_fee,
        payload: {
          type: "transfer_out",
          amount: -loan.loan_fee,
          description: `Lejegebyr: ${loan.rider.firstname} ${loan.rider.lastname} (sæson ${loan.start_season})`,
          season_id: loanAcceptSeasonId,
          actor_type: FINANCE_ACTOR_TYPE.API,
          actor_id: req.user.id,
          source_path: "api.loans.accept.borrower",
          reason_code: FINANCE_REASON.LOAN_FEE_PAID,
          related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
          related_entity_id: loan.id,
        },
      });
      await incrementBalanceWithAudit(supabase, {
        teamId: loan.from_team_id,
        delta: loan.loan_fee,
        payload: {
          type: "transfer_in",
          amount: loan.loan_fee,
          description: `Lejegebyr modtaget: ${loan.rider.firstname} ${loan.rider.lastname} (sæson ${loan.start_season})`,
          season_id: loanAcceptSeasonId,
          actor_type: FINANCE_ACTOR_TYPE.API,
          actor_id: req.user.id,
          source_path: "api.loans.accept.lender",
          reason_code: FINANCE_REASON.LOAN_FEE_RECEIVED,
          related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
          related_entity_id: loan.id,
        },
      });
    }
    const nextStatus = getLoanAgreementAcceptedStatus({ windowOpen: open });
    await supabase.from("loan_agreements").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", loan.id);
    const title = open ? "Lejeaftale aktiveret" : "Lejeaftale parkeret";
    const message = open
      ? `${req.team.name} har accepteret din lejeforespørgsel på ${loan.rider.firstname} ${loan.rider.lastname}`
      : `${req.team.name} har accepteret og betalt din lejeforespørgsel på ${loan.rider.firstname} ${loan.rider.lastname}. Rytteren bliver registreret som lejet, når transfervinduet åbner.`;
    await notifyTeamOwner(loan.to_team_id, "transfer_offer_accepted",
      title,
      message, loan.id);
    return res.json({ success: true, action: nextStatus });
  }

  // REJECT — lending team rejects
  if (action === "reject" && isLender && loan.status === "pending") {
    await supabase.from("loan_agreements").update({ status: "rejected" }).eq("id", loan.id);
    await notifyTeamOwner(loan.to_team_id, "transfer_offer_rejected",
      "Lejeforespørgsel afvist",
      `${req.team.name} afslog dit lejeforslag på ${loan.rider.firstname} ${loan.rider.lastname}`, loan.id);
    return res.json({ success: true, action: "rejected" });
  }

  // CANCEL — kun pending kan trækkes tilbage ensidigt (ingen kontrakt endnu).
  // #156: aktive lejeaftaler er bindende — kun admin kan annullere via
  // POST /api/admin/loans/:id/cancel.
  if (action === "cancel" && loan.status === "pending") {
    await supabase.from("loan_agreements").update({ status: "cancelled" }).eq("id", loan.id);
    const otherTeamId = isLender ? loan.to_team_id : loan.from_team_id;
    await notifyTeamOwner(otherTeamId, "transfer_offer_rejected",
      "Lejeaftale annulleret",
      `${req.team.name} har annulleret lejeaftalen på ${loan.rider.firstname} ${loan.rider.lastname}`, loan.id);
    return res.json({ success: true, action: "cancelled" });
  }
  if (action === "cancel" && getLoanCancelIssue(loan)) {
    return res.status(400).json({
      error: "Lejeaftalen er aktiv og kan ikke annulleres ensidigt — kontakt en admin.",
      errorCode: "loan_active_no_unilateral_cancel",
    });
  }

  // BUYOUT — borrowing team exercises buy option
  if (action === "buyout" && isBorrower && loan.status === "active" && loan.buy_option_price) {
    const { open } = await getTransferWindowStatus();
    const price = loan.buy_option_price;
    const { data: borrower } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    if (!borrower)
      return res.status(400).json({ error: "Hold ikke fundet", errorCode: "team_not_found" });
    // #44: købsoption må ikke pushe i underbalance ift. eksisterende auktioner.
    const { commitment: buyerCommitment } = await fetchTeamCommitment(supabase, req.team.id);
    const buyoutIssue = getSpendIssue({
      teamBalance: borrower.balance,
      commitment: buyerCommitment,
      attemptedSpend: price,
    });
    if (buyoutIssue?.code === "insufficient_available_balance") {
      return res.status(400).json({
        error: `Du har kun ${buyoutIssue.availableBalance.toLocaleString("da-DK")} CZ$ tilgængelig efter aktive bud — kan ikke udnytte købsoption på ${price.toLocaleString("da-DK")} CZ$`,
        errorCode: "buyout_insufficient",
        errorParams: { available: buyoutIssue.availableBalance, price },
      });
    }

    // #19 audit (finding #3): claim the rider with the SAME atomicity guard the
    // transfer/swap parking paths use, BEFORE moving any money. The rider must
    // still be owned by the lender and not already parked for another deal; a
    // 0-row result means a competing deal claimed the rider, so we abort before
    // debiting. Open window → ownership moves now; closed → pending_team_id parks
    // (status "buyout_pending", flushed at window-open).
    const boughtAt = new Date().toISOString();
    const { data: claimedRider, error: claimErr } = await supabase.from("riders")
      .update(getLoanBuyoutRiderUpdate({ windowOpen: open, borrowerTeamId: req.team.id, timestamp: boughtAt }))
      .eq("id", loan.rider_id)
      .eq("team_id", loan.from_team_id)
      .is("pending_team_id", null)
      .select("id");
    if (claimErr) return res.status(500).json({ error: claimErr.message });
    if (!claimedRider || claimedRider.length === 0)
      return res.status(409).json({ error: "Rytteren er ikke længere tilgængelig for købsoption — den er allerede involveret i en anden handel.", errorCode: "buyout_rider_unavailable" });

    // Slice 07c: balance + finance_transactions atomic via RPC.
    // 07d Fase B / #240: borrower aktiverer købsoption → req.user.id = køber.
    // season_id sættes eksplicit fra activeSeason.
    const { data: buyoutSeason } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
    const buyoutSeasonId = buyoutSeason?.id ?? null;
    await incrementBalanceWithAudit(supabase, {
      teamId: req.team.id,
      delta: -price,
      payload: {
        type: "transfer_out",
        amount: -price,
        description: `Købsoption udnyttet: ${loan.rider.firstname} ${loan.rider.lastname}`,
        season_id: buyoutSeasonId,
        actor_type: FINANCE_ACTOR_TYPE.API,
        actor_id: req.user.id,
        source_path: "api.loans.buyout.buyer",
        reason_code: FINANCE_REASON.LOAN_BUYOUT,
        related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
        related_entity_id: loan.id,
      },
    });
    await incrementBalanceWithAudit(supabase, {
      teamId: loan.from_team_id,
      delta: price,
      payload: {
        type: "transfer_in",
        amount: price,
        description: `Købsoption udnyttet: ${loan.rider.firstname} ${loan.rider.lastname}`,
        season_id: buyoutSeasonId,
        actor_type: FINANCE_ACTOR_TYPE.API,
        actor_id: req.user.id,
        source_path: "api.loans.buyout.seller",
        reason_code: FINANCE_REASON.LOAN_BUYOUT,
        related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
        related_entity_id: loan.id,
      },
    });
    const nextStatus = getLoanBuyoutStatus({ windowOpen: open });
    await supabase.from("loan_agreements").update({ status: nextStatus, updated_at: boughtAt }).eq("id", loan.id);
    const title = open ? "Købsoption udnyttet" : "Købsoption parkeret";
    const message = open
      ? `${req.team.name} har udnyttet købsoptionen på ${loan.rider.firstname} ${loan.rider.lastname} for ${price.toLocaleString()} CZ$`
      : `${req.team.name} har udnyttet og betalt købsoptionen på ${loan.rider.firstname} ${loan.rider.lastname} for ${price.toLocaleString()} CZ$. Rytteren skifter hold, når transfervinduet åbner.`;
    await notifyTeamOwner(loan.from_team_id, "transfer_offer_accepted",
      title,
      message, loan.id);
    // Buyout moves rider permanently or parks a pending owner-change; drop /api/riders cache.
    invalidateNamespace("riders");
    return res.json({ success: true, action: nextStatus, price });
  }

  return res.status(400).json({ error: "Ugyldig handling" });
});

// POST /api/admin/override-rider — manually move a rider to a team
router.post("/admin/override-rider", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { rider_id, team_id } = req.body;
  if (!rider_id) return res.status(400).json({ error: "rider_id required" });
  const { data: rider } = await supabase.from("riders").select("firstname, lastname").eq("id", rider_id).single();
  if (!rider) return res.status(404).json({ error: "Rytter ikke fundet" });
  const { error } = await supabase.from("riders")
    .update({ team_id: team_id || null, pending_team_id: null, acquired_at: team_id ? new Date().toISOString() : null }).eq("id", rider_id);
  if (error) return res.status(500).json({ error: error.message });
  const teamRes = team_id ? await supabase.from("teams").select("name").eq("id", team_id).single() : null;
  const teamName = teamRes?.data?.name || "fri agent";
  invalidateNamespace("riders");
  res.json({ success: true, message: `${rider.firstname} ${rider.lastname} flyttet til ${teamName}` });
});

// POST /api/admin/riders/:id/retirement — mark rider retired/active
router.post("/admin/riders/:id/retirement", requireAdmin, adminWriteLimiter, async (req, res) => {
  const isRetired = req.body?.is_retired === true;
  const { data: rider } = await supabase
    .from("riders")
    .select("id, firstname, lastname")
    .eq("id", req.params.id)
    .single();
  if (!rider) return res.status(404).json({ error: "Rytter ikke fundet" });

  const updatePayload = { is_retired: isRetired };
  if (isRetired) {
    updatePayload.pending_team_id = null;
  }
  const { error } = await supabase
    .from("riders")
    .update(updatePayload)
    .eq("id", rider.id);
  if (error) return res.status(500).json({ error: error.message });

  // /api/riders filters on is_retired=false; retirement flips visibility.
  invalidateNamespace("riders");
  res.json({
    success: true,
    message: `${rider.firstname} ${rider.lastname} er ${isRetired ? "pensioneret" : "aktiveret igen"}`,
  });
});

router.post(
  "/admin/import-results",
  requireAdmin,
  adminWriteLimiter,
  adminImportUploadSingleFile,
  createAdminImportResultsHandler({
    supabase,
    buildRacePointsLookup,
    applyRaceResults,
    ensureSeasonStandings,
    updateStandings,
    logActivity,
  }),
);

// POST /api/admin/approve-results — approve pending race result submission
router.post("/admin/approve-results", requireAdmin, adminWriteLimiter, async (req, res) => {
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
      .select("id, name, season_id, race_type, race_class")
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

    let racePoints = [];
    if (race.race_class) {
      const { data: pts, error: racePointsError } = await supabase
        .from("race_points")
        .select("result_type, rank, points")
        .eq("race_class", race.race_class);
      if (racePointsError) return res.status(500).json({ error: racePointsError.message });
      racePoints = pts || [];
    }

    const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });
    const insertRows = buildRaceResultsFromPending({
      pendingRows: rows,
      pointsLookup,
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

    // Race approval updates UCI points on riders + race status; drop both caches.
    invalidateNamespace("riders");
    invalidateNamespace("races");
    res.json({
      success: true,
      rows_imported: result.rowsImported,
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
router.patch("/notifications/:id/read", requireAuth, presencePulseLimiter, async (req, res) => {
  await supabase.from("notifications")
    .update({ is_read: true })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

// PATCH /api/notifications/read-all
router.patch("/notifications/read-all", requireAuth, presencePulseLimiter, async (req, res) => {
  await supabase.from("notifications")
    .update({ is_read: true })
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

// GET /api/inbox/pending — pending decisions ("Skal handles")
router.get("/inbox/pending", requireAuth, async (req, res) => {
  if (!req.team) {
    return res.json({
      transfer_offers: [],
      swap_offers: [],
      loan_offers: [],
      counts: { transfer_offers: 0, swap_offers: 0, loan_offers: 0, total: 0 },
    });
  }

  try {
    const result = await getPendingInboxItems({ supabase, teamId: req.team.id });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    .select("id, firstname, lastname, market_value, salary, is_u25, stat_bj, stat_sp, stat_tt, stat_fl")
    .eq("team_id", req.params.id)
    .order("market_value", { ascending: false });

  res.json({ ...team, riders: riders || [] });
});

// GET /api/teams/my — current user's team
router.get("/teams/my", requireAuth, async (req, res) => {
  res.json(req.team);
});

// PUT /api/teams/my — create or update the current user's team profile
router.put("/teams/my", requireAuth, marketWriteLimiter, async (req, res) => {
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

// ── /api/me — current user's Discord DM preferences ───────────────────────────

router.get("/me/discord-status", requireAuth, async (req, res) => {
  const { data: user } = await supabase
    .from("users")
    .select("discord_id, discord_dm_enabled")
    .eq("id", req.user.id)
    .single();
  res.json({
    discord_id: user?.discord_id || null,
    dm_enabled: user?.discord_dm_enabled !== false,
    bot_configured: Boolean(getBotToken()),
  });
});

router.post("/me/discord-dm-test", requireAuth, marketWriteLimiter, async (req, res) => {
  const { data: user } = await supabase
    .from("users")
    .select("discord_id")
    .eq("id", req.user.id)
    .single();
  if (!user?.discord_id) return res.status(400).json({ error: "Tilføj først dit Discord-ID" });
  try {
    await sendTestDM(user.discord_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/me/discord-dm-enabled", requireAuth, marketWriteLimiter, async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled skal være boolean" });
  const { error } = await supabase
    .from("users")
    .update({ discord_dm_enabled: enabled })
    .eq("id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, dm_enabled: enabled });
});

// GET /api/me/onboarding-progress — Onboarding v2 step-status for current manager
router.get("/me/onboarding-progress", requireAuth, async (req, res) => {
  const teamId = req.team?.id;
  const emptySteps = [
    { key: "team_named", done: false },
    { key: "first_rider_owned", done: false },
    { key: "first_bid_placed", done: false },
    { key: "board_plan_set", done: false },
  ];
  if (!teamId) {
    return res.json({ steps: emptySteps, completed_count: 0, total_count: emptySteps.length });
  }

  const [teamRes, ridersRes, bidsRes, boardsRes] = await Promise.all([
    supabase.from("teams").select("manager_name").eq("id", teamId).single(),
    supabase.from("riders").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    supabase.from("auction_bids").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    supabase.from("board_profiles").select("id", { count: "exact", head: true }).eq("team_id", teamId),
  ]);

  const steps = [
    { key: "team_named", done: Boolean(teamRes.data?.manager_name?.trim()) },
    { key: "first_rider_owned", done: (ridersRes.count || 0) > 0 },
    { key: "first_bid_placed", done: (bidsRes.count || 0) > 0 },
    { key: "board_plan_set", done: (boardsRes.count || 0) > 0 },
  ];
  const completed_count = steps.filter(s => s.done).length;

  res.json({ steps, completed_count, total_count: steps.length });
});

// GET /api/me/finance-forecast — slice 07g manager finance-forecast + risk-tier
//
// Aggregerer alle inputs til pure-function computeFinanceForecast og returnerer
// projected sponsor/prize/salary/loan_interest/loan_fees + 🟢/🟡/🔴 risk-tier +
// warnings. Kaldes fra Dashboard og FinancePage.
router.get("/me/finance-forecast", requireAuth, async (req, res) => {
  try {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const teamId = req.team.id;

    const [
      teamRes,
      ridersRes,
      activeLoansRes,
      inboundAgreementsRes,
      outboundAgreementsRes,
      boardsRes,
      pulloutRes,
      activeSeasonRes,
      configsRes,
    ] = await Promise.all([
      supabase
        .from("teams")
        .select("id, division, balance, sponsor_income")
        .eq("id", teamId)
        .single(),
      supabase
        .from("riders")
        .select("id, salary, prize_earnings_bonus")
        .eq("team_id", teamId),
      supabase
        .from("loans")
        .select("amount_remaining, interest_rate")
        .eq("team_id", teamId)
        .eq("status", "active"),
      supabase
        .from("loan_agreements")
        .select("loan_fee, start_season, end_season, status")
        .eq("to_team_id", teamId)
        .eq("status", "active"),
      supabase
        .from("loan_agreements")
        .select("loan_fee, start_season, end_season, status")
        .eq("from_team_id", teamId)
        .eq("status", "active"),
      supabase
        .from("board_profiles")
        .select("budget_modifier, negotiation_status")
        .eq("team_id", teamId),
      supabase
        .from("board_consequences")
        .select("severity")
        .eq("team_id", teamId)
        .eq("layer", 5)
        .eq("status", "active"),
      supabase
        .from("seasons")
        .select("id, number")
        .eq("status", "active")
        .maybeSingle(),
      supabase.from("loan_config").select("debt_ceiling").eq("division", req.team.division),
    ]);

    if (teamRes.error) throw teamRes.error;
    const team = teamRes.data;
    if (!team) return res.status(404).json({ error: "Team not found" });

    const riders = ridersRes.data || [];
    const activeLoans = activeLoansRes.data || [];
    const inboundLoanAgreements = inboundAgreementsRes.data || [];
    const outboundLoanAgreements = outboundAgreementsRes.data || [];

    // Board-modifier = avg af completed plans (matcher economyEngine.processSeasonStart).
    const completedBoards = (boardsRes.data || []).filter(
      (b) => b.negotiation_status === "completed"
    );
    const boardModifier =
      completedBoards.length > 0
        ? completedBoards.reduce((sum, b) => sum + (b.budget_modifier ?? 1.0), 0) /
          completedBoards.length
        : 1.0;

    // Sponsor-pullout (lag 5) reducerer sponsor multiplikativt — én aktiv pullout
    // reducerer typisk med 10%. Tager den dybeste severity hvis flere er aktive.
    const pulloutFactor =
      (pulloutRes.data || []).length > 0
        ? Math.min(
            ...pulloutRes.data.map((row) => (row.severity || 1000) / 1000)
          )
        : 1.0;

    const totalDebt = activeLoans.reduce(
      (sum, l) => sum + (l.amount_remaining || 0),
      0
    );
    const debtCeiling = configsRes.data?.[0]?.debt_ceiling ?? null;
    const currentSeasonNumber = activeSeasonRes.data?.number ?? null;
    let lastSeasonStandings = [];
    if (activeSeasonRes.data?.id) {
      const { data: standingsData, error: standingsError } = await supabase
        .from("season_standings")
        .select("team_id, division, rank_in_division, total_points")
        .eq("season_id", activeSeasonRes.data.id);
      if (standingsError) throw standingsError;
      lastSeasonStandings = standingsData || [];
    }

    // 2026-05-21: seasonsAhead query-param (1-5, default 1). Returnerer multi-
    // sæson forecast med rolling-status-quo-estimat for sæson 2+. Backwards-
    // compat: når seasonsAhead=1, eksponerer vi forecasts[0]-felterne på root
    // så eksisterende FinanceForecastCard fortsat virker uden ændring.
    const seasonsAhead = Math.max(
      1,
      Math.min(5, Number.parseInt(req.query?.seasonsAhead ?? "1", 10) || 1)
    );
    const multi = computeMultiSeasonForecast({
      team,
      boardModifier,
      pulloutFactor,
      riders,
      activeLoans,
      inboundLoanAgreements,
      outboundLoanAgreements,
      totalDebt,
      debtCeiling,
      currentSeasonNumber,
      lastSeasonStandings,
      seasonsAhead,
    });

    // Backward-compat: spred det første (præcise) forecast på root.
    const first = multi.forecasts[0] || {};
    res.json({ ...first, ...multi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/teams/:teamId/finance-report — slice 07h sæson-finansrapport
//
// Auth-gate: team-owner ELLER admin. Læs-kun reproduktion af given sæson.
// Privatliv: hver requester ser KUN ét hold (sit eget eller — for admin —
// det specifikke teamId i URL'en). Ingen cross-team aggregering.
router.get("/teams/:teamId/finance-report", requireAuth, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { seasonId } = req.query;
    if (!seasonId) return res.status(400).json({ error: "seasonId is required" });

    // Auth-gate: er requester team-owner eller admin?
    const isOwner = req.team?.id === teamId;
    let isAdmin = false;
    if (!isOwner) {
      const { data: u } = await supabase
        .from("users")
        .select("role")
        .eq("id", req.user.id)
        .single();
      isAdmin = u?.role === "admin";
    }
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const [teamRes, seasonRes, txRes, loansRes] = await Promise.all([
      supabase
        .from("teams")
        .select("id, name, division, balance, sponsor_income")
        .eq("id", teamId)
        .single(),
      supabase
        .from("seasons")
        .select("id, number, status, start_date, end_date")
        .eq("id", seasonId)
        .single(),
      supabase
        .from("finance_transactions")
        .select("id, type, amount, description, reason_code, created_at")
        .eq("team_id", teamId)
        .eq("season_id", seasonId)
        .order("created_at", { ascending: false }),
      supabase
        .from("loans")
        .select("id, loan_type, principal, amount_remaining, interest_rate, seasons_remaining, status")
        .eq("team_id", teamId)
        .eq("status", "active"),
    ]);

    if (teamRes.error || !teamRes.data) {
      return res.status(404).json({ error: "Team not found" });
    }
    if (seasonRes.error || !seasonRes.data) {
      return res.status(404).json({ error: "Season not found" });
    }

    const report = buildSeasonFinanceReport({
      transactions: txRes.data || [],
      loans: loansRes.data || [],
    });

    res.json({
      team: { id: teamRes.data.id, name: teamRes.data.name, division: teamRes.data.division },
      season: seasonRes.data,
      ...report,
      // Sponsor-modifier-kurve: tilgængelig fra sæson 2 når board_plan_snapshots
      // er populeret. Vi returnerer eksplicit null så frontend kan vise
      // "Tilgængelig fra sæson 2" frem for at tro vi glemte den.
      sponsor_modifier_curve: null,
      viewer: { is_admin: isAdmin, is_owner: isOwner },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: Seasons & Races ────────────────────────────────────────────────────

// POST /api/admin/finalize-expired-auctions — admin bulk finalizer via shared logic
router.post("/admin/finalize-expired-auctions", requireAdmin, adminWriteLimiter, async (req, res) => {
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

// GET /api/admin/auctions/active — list active+extended auktioner med rytter+sælger
router.get("/admin/auctions/active", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("auctions")
    .select(
      "id, current_price, current_bidder_id, calculated_end, status, seller_team_id, is_flash, is_guaranteed_sale, " +
      "rider:rider_id(id, firstname, lastname, market_value), " +
      "seller:seller_team_id(id, name)"
    )
    .in("status", ["active", "extended"])
    .order("calculated_end", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Tæl unikke bidders pr. auktion via separat query (Supabase nested aggregation er begrænset).
  const auctionIds = (data || []).map(a => a.id);
  let bidCounts = {};
  if (auctionIds.length > 0) {
    const { data: bids } = await supabase
      .from("auction_bids")
      .select("auction_id, team_id")
      .in("auction_id", auctionIds);
    bidCounts = (bids || []).reduce((acc, b) => {
      acc[b.auction_id] = acc[b.auction_id] || new Set();
      acc[b.auction_id].add(b.team_id);
      return acc;
    }, {});
  }

  const enriched = (data || []).map(a => ({
    ...a,
    unique_bidder_count: bidCounts[a.id] ? bidCounts[a.id].size : 0,
  }));

  res.json({ auctions: enriched });
});

// GET /api/admin/rider-valuation-preview — #1101 SHADOW: sammenlign gammel
// (uci-afledt market_value) med ny data-drevet base_value for hele populationen,
// så ejer kan godkende fordelingen FØR cutover. Beregner live fra modellen, så
// fladen virker uafhængigt af om backfill er kørt. Påvirker intet i økonomien.
router.get("/admin/rider-valuation-preview", requireAdmin, async (req, res) => {
  if (!VALUATION_MODEL) {
    return res.status(503).json({ error: "Valuation model not fitted yet" });
  }
  const asOf = VALUATION_MODEL.fitted_at;

  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, firstname, lastname, primary_type, base_value, market_value, prize_earnings_bonus, nationality_code, pcm_id, is_retired")
      .order("id")),
    fetchAllRows(() => supabase
      .from("rider_derived_abilities")
      .select("*")
      .order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  const rows = [];
  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abilityByRider.get(r.id);
    const newValue = predictBaseValue(r, ab, VALUATION_MODEL, { asOf });
    if (newValue == null) continue;
    const oldValue = calculateRiderMarketValue(r);
    rows.push({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      nationality_code: r.nationality_code,
      is_fictional: r.pcm_id == null,
      specialty: riderSpecialty(ab),
      overall: riderOverall(ab, VALUATION_MODEL),
      old_value: oldValue,
      new_value: newValue,
      delta: newValue - oldValue,
      pct: oldValue > 0 ? Math.round(((newValue - oldValue) / oldValue) * 100) : null,
    });
  }

  const pctile = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const olds = rows.map((r) => r.old_value);
  const news = rows.map((r) => r.new_value);
  const distribution = {
    count: rows.length,
    old: { p10: pctile(olds, 0.1), median: pctile(olds, 0.5), p90: pctile(olds, 0.9), max: olds.length ? Math.max(...olds) : null },
    new: { p10: pctile(news, 0.1), median: pctile(news, 0.5), p90: pctile(news, 0.9), max: news.length ? Math.max(...news) : null },
  };

  // Koefficient-aflæsning (standardiseret) sorteret efter styrke — "hvad
  // betaler managers for". Kun ability-features har en label-nøgle frontend-side.
  const coefficients = (VALUATION_MODEL.feature_keys || [])
    .map((k) => ({ key: k, weight: VALUATION_MODEL.coef?.[k] ?? 0, is_ability: ABILITY_KEYS.includes(k) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  res.json({
    model: {
      fitted_at: VALUATION_MODEL.fitted_at,
      n_train: VALUATION_MODEL.n_train,
      lambda: VALUATION_MODEL.lambda,
      cv_r2: VALUATION_MODEL.cv_r2,
      train_r2: VALUATION_MODEL.train_r2,
      convexity_exponent: VALUATION_MODEL.convexity_exponent,
      floor: VALUATION_MODEL.floor,
    },
    coefficients,
    distribution,
    riders: rows,
  });
});

// POST /api/admin/auctions/:id/cancel — annuller aktiv auktion
router.post("/admin/auctions/:id/cancel", requireAdmin, adminWriteLimiter, async (req, res) => {
  const result = await cancelAuctionByAdmin({
    supabase,
    auctionId: req.params.id,
    adminUserId: req.user.id,
    notifyTeamOwner,
    logActivity,
    now: new Date(),
  });

  if (!result.ok) {
    if (result.code === "not_found") return res.status(404).json({ error: "Auktion ikke fundet" });
    if (result.code === "not_cancellable") {
      return res.status(409).json({ error: `Auktionen kan ikke annulleres (status: ${result.status})` });
    }
    if (result.code === "race_lost") {
      return res.status(409).json({ error: "Auktionen blev afsluttet samtidig — prøv at genindlæse" });
    }
    return res.status(500).json({ error: "Cancel fejlede" });
  }

  res.json({
    success: true,
    bidder_count: result.bidder_count,
    rider_name: result.rider_name,
    message: `Auktion annulleret. ${result.bidder_count} budgivere notificeret.`,
  });
});

// POST /api/admin/transfers/offers/:id/cancel — admin annullerer en indgået transfer-handel (window_pending)
router.post("/admin/transfers/offers/:id/cancel", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: offer, error: fetchErr } = await supabase
      .from("transfer_offers")
      .select("id, rider_id, seller_team_id, buyer_team_id, offer_amount, counter_amount, status, buyer_confirmed, seller_confirmed, rider:rider_id(id, firstname, lastname)")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!offer) return res.status(404).json({ error: "Handel ikke fundet" });

    const isBothConfirmed = offer.buyer_confirmed && offer.seller_confirmed;
    if (offer.status !== "window_pending" && !isBothConfirmed) {
      return res.status(409).json({ error: `Handlen kan ikke annulleres fra status: ${offer.status}` });
    }

    await supabase.from("transfer_offers").update({ status: "withdrawn" }).eq("id", offer.id);

    const riderName = offer.rider ? `${offer.rider.firstname} ${offer.rider.lastname}` : "ukendt rytter";
    const price = offer.counter_amount || offer.offer_amount;
    const msg = `Handlen på ${riderName} er annulleret af en admin${reason ? `: ${reason}` : "."}`;

    await Promise.allSettled([
      notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected", "Handel annulleret af admin", msg, offer.id),
      notifyTeamOwner(offer.seller_team_id, "transfer_offer_rejected", "Handel annulleret af admin", msg, offer.id),
    ]);

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.TRANSFER_OFFER_ADMIN_CANCEL,
      description: `Transfer-handel annulleret: ${riderName}, ${price?.toLocaleString()} CZ$ (status: ${offer.status})${reason ? ` — ${reason}` : ""}`,
      target_rider_id: offer.rider_id,
      meta: { offer_id: offer.id, seller_team_id: offer.seller_team_id, buyer_team_id: offer.buyer_team_id, price, reason: reason || null },
    });

    res.json({ success: true, rider_name: riderName, message: `Handel annulleret: ${riderName}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/transfers/swaps/:id/cancel — admin annullerer en indgået byttehandel (window_pending)
router.post("/admin/transfers/swaps/:id/cancel", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: swap, error: fetchErr } = await supabase
      .from("swap_offers")
      .select("id, offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, status, proposing_confirmed, receiving_confirmed, offered:offered_rider_id(id, firstname, lastname), requested:requested_rider_id(id, firstname, lastname)")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!swap) return res.status(404).json({ error: "Byttehandel ikke fundet" });

    const isBothConfirmed = swap.proposing_confirmed && swap.receiving_confirmed;
    if (swap.status !== "window_pending" && !isBothConfirmed) {
      return res.status(409).json({ error: `Byttehandlen kan ikke annulleres fra status: ${swap.status}` });
    }

    await supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swap.id);

    const offeredName = swap.offered ? `${swap.offered.firstname} ${swap.offered.lastname}` : "ukendt rytter";
    const requestedName = swap.requested ? `${swap.requested.firstname} ${swap.requested.lastname}` : "ukendt rytter";
    const msg = `Byttehandlen ${offeredName} ↔ ${requestedName} er annulleret af en admin${reason ? `: ${reason}` : "."}`;

    await Promise.allSettled([
      notifyTeamOwner(swap.proposing_team_id, "transfer_offer_rejected", "Byttehandel annulleret af admin", msg, swap.id),
      notifyTeamOwner(swap.receiving_team_id, "transfer_offer_rejected", "Byttehandel annulleret af admin", msg, swap.id),
    ]);

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.SWAP_OFFER_ADMIN_CANCEL,
      description: `Byttehandel annulleret: ${offeredName} ↔ ${requestedName} (status: ${swap.status})${reason ? ` — ${reason}` : ""}`,
      target_rider_id: swap.offered_rider_id,
      meta: { swap_id: swap.id, proposing_team_id: swap.proposing_team_id, receiving_team_id: swap.receiving_team_id, reason: reason || null },
    });

    res.json({ success: true, offered_name: offeredName, requested_name: requestedName, message: `Byttehandel annulleret: ${offeredName} ↔ ${requestedName}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/loans/:id/cancel — admin annullerer en aktiv lejeaftale (#156)
// Refunderer betalt loan_fee til lejer og trækker fra udlejer (2A).
router.post("/admin/loans/:id/cancel", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: loan, error: fetchErr } = await supabase
      .from("loan_agreements")
      .select(`id, rider_id, from_team_id, to_team_id, loan_fee, start_season, status,
        rider:rider_id(id, firstname, lastname)`)
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!loan) return res.status(404).json({ error: "Lejeaftale ikke fundet" });

    if (!["pending", "active"].includes(loan.status)) {
      return res.status(409).json({ error: `Lejeaftalen kan ikke annulleres fra status: ${loan.status}` });
    }

    const riderName = loan.rider ? `${loan.rider.firstname} ${loan.rider.lastname}` : "ukendt rytter";
    let refundedFee = 0;

    // Refund loan_fee hvis den allerede er udvekslet (status=active + fee > 0).
    if (loan.status === "active" && loan.loan_fee > 0) {
      const [{ data: borrower }, { data: lender }] = await Promise.all([
        supabase.from("teams").select("balance").eq("id", loan.to_team_id).single(),
        supabase.from("teams").select("balance").eq("id", loan.from_team_id).single(),
      ]);
      if (!borrower || !lender) {
        return res.status(500).json({ error: "Kunne ikke hente hold-balancer for refusion" });
      }
      // Slice 07c: balance + finance_transactions atomic via RPC.
      // 07d Fase B / #240: admin-trigger → actor_type=admin, actor_id=req.user.id,
      // season_id eksplicit fra activeSeason.
      const { data: refundSeason } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
      const refundSeasonId = refundSeason?.id ?? null;
      await incrementBalanceWithAudit(supabase, {
        teamId: loan.to_team_id,
        delta: loan.loan_fee,
        payload: {
          type: "transfer_in",
          amount: loan.loan_fee,
          description: `Lejegebyr refunderet (admin-annullering): ${riderName}`,
          season_id: refundSeasonId,
          actor_type: FINANCE_ACTOR_TYPE.ADMIN,
          actor_id: req.user.id,
          source_path: "api.admin.loans.cancel.refundBorrower",
          reason_code: FINANCE_REASON.LOAN_FEE_REFUNDED,
          related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
          related_entity_id: loan.id,
        },
      });
      await incrementBalanceWithAudit(supabase, {
        teamId: loan.from_team_id,
        delta: -loan.loan_fee,
        payload: {
          type: "transfer_out",
          amount: -loan.loan_fee,
          description: `Lejegebyr tilbageført (admin-annullering): ${riderName}`,
          season_id: refundSeasonId,
          actor_type: FINANCE_ACTOR_TYPE.ADMIN,
          actor_id: req.user.id,
          source_path: "api.admin.loans.cancel.clawbackLender",
          reason_code: FINANCE_REASON.LOAN_FEE_REFUNDED,
          related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
          related_entity_id: loan.id,
        },
      });
      refundedFee = loan.loan_fee;
    }

    await supabase.from("loan_agreements").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", loan.id);

    const refundStr = refundedFee > 0 ? ` Lejegebyr (${refundedFee.toLocaleString("da-DK")} CZ$) er refunderet.` : "";
    const msg = `Lejeaftalen på ${riderName} er annulleret af en admin${reason ? `: ${reason}` : "."}${refundStr}`;

    await Promise.allSettled([
      notifyTeamOwner(loan.from_team_id, "transfer_offer_rejected", "Lejeaftale annulleret af admin", msg, loan.id),
      notifyTeamOwner(loan.to_team_id,   "transfer_offer_rejected", "Lejeaftale annulleret af admin", msg, loan.id),
    ]);

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.LOAN_AGREEMENT_ADMIN_CANCEL,
      description: `Lejeaftale annulleret: ${riderName} (status: ${loan.status}, refund: ${refundedFee.toLocaleString("da-DK")} CZ$)${reason ? ` — ${reason}` : ""}`,
      target_rider_id: loan.rider_id,
      meta: {
        loan_id: loan.id,
        from_team_id: loan.from_team_id,
        to_team_id: loan.to_team_id,
        prior_status: loan.status,
        refunded_fee: refundedFee,
        reason: reason || null,
      },
    });

    res.json({ success: true, rider_name: riderName, refunded_fee: refundedFee, message: `Lejeaftale annulleret: ${riderName}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/seasons", requireAdmin, adminWriteLimiter, async (req, res) => {
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
        id: computeSeasonUuid(number),
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

router.post("/admin/seasons/:id/start", requireAdmin, adminWriteLimiter, async (req, res) => {
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

    // #535: processSeasonStart returnerer nu { sponsor: [...], payroll: {...} }
    // i stedet for sponsor-array. Bagudkompatibilitet for ældre callere
    // håndteres på callsite-niveau (tests må eksplicit migreres).
    const seasonStartResult = await processSeasonStart(seasonId);
    const sponsorPayouts = (seasonStartResult?.sponsor || []).length;

    // #532 — konvergér manual flow med seasonTransition-engine:
    // Eksisterende manual flow oprettede ikke transfer_windows-rows; det betød
    // forrige sæsons window forblev "open" efter manuel sæsonstart, og den nye
    // sæson havde 0 windows. Engine bruger deterministisk UUID-mønster (`...XXXXaaaa`).
    const transitionAtIso = startedSeason.start_date
      ? `${startedSeason.start_date}T00:00:00.000Z`
      : new Date().toISOString();

    let prevWindowResult = { skipped: true, reason: "no previous season (sæson 0)" };
    if (startedSeason.number > 0) {
      const prevSeasonId = computeSeasonUuid(startedSeason.number - 1);
      prevWindowResult = await closePrevTransferWindow(supabase, prevSeasonId, transitionAtIso);
    }
    const newWindowResult = await insertTransferWindowIfMissing(
      supabase,
      computeTransferWindowUuid(startedSeason.number),
      startedSeason.id,
      transitionAtIso,
    );

    await logActivity("season_started", {
      meta: {
        season_id: startedSeason.id,
        season_number: startedSeason.number,
        standings_initialized: standings.created,
        sponsor_payouts: sponsorPayouts,
        transfer_window_inserted: !!newWindowResult.inserted,
        prev_transfer_window_closed: !!prevWindowResult.updated,
      },
    });

    notifySeasonEvent({ type: "season_started", seasonNumber: startedSeason.number }).catch(() => {});

    res.json({
      success: true,
      season_id: startedSeason.id,
      number: startedSeason.number,
      standings_initialized: standings.created,
      sponsor_payouts: sponsorPayouts,
      transfer_window: newWindowResult,
      prev_transfer_window: prevWindowResult,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/seasons/:id/end", requireAdmin, adminWriteLimiter, async (req, res) => {
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

    // #532 — skip processSeasonEnd for sæson 0 (open-beta-fase uden løb/standings/lønninger).
    // seasonTransition-engine har samme special-case (se backend/lib/seasonTransition.js linje 17-21).
    // Hvis vi kører processSeasonEnd på sæson 0 ville ensureSeasonStandings oprette 24 tomme
    // 0-point standings-rows, processSeasonEnd ville loope dem gennem processTeamSeasonEnd
    // (salary, division-logic, payDivisionBonuses, processDivisionEnd) — formentlig harmløst
    // men IKKE verificeret. Lige som engine sætter vi blot status='completed' direkte.
    if (season.number === 0) {
      // Sæson 0: ingen processSeasonEnd, ingen standings-init.
    } else {
      await ensureSeasonStandings(seasonId);
      await updateStandings(seasonId);
      await processSeasonEnd(seasonId);
    }

    // #532 — eksplicit status='completed' i seasons.update():
    // For sæson ≥ 1 sætter processSeasonEnd det allerede; vores re-set er idempotent.
    // For sæson 0 er denne update den eneste source af completed-flagget — uden den
    // ville sæson 0 forblive i status='active' efter manuel ⏹ Afslut (pre-#532-bug).
    const { data: endedSeason, error: endError } = await supabase
      .from("seasons")
      .update({
        status: "completed",
        end_date: season.end_date || today,
      })
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

router.post("/admin/seasons/:id/repair-finance-board", requireAdmin, adminWriteLimiter, async (req, res) => {
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

router.post("/admin/seasons/:id/rebuild-standings", requireAdmin, adminWriteLimiter, async (req, res) => {
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

// #993-followup — re-derivér points_earned + prize_money på eksisterende
// race_results ud fra den AKTUELLE race_points-config, og genberegn standings.
// Lukker afkoblingen hvor admin-redigerede point ikke slog igennem på ranglisten.
// Udbetalte løb (prize_paid_at != null) springes over så bogførte præmier står urørt.
router.post("/admin/seasons/:id/rederive-points", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const seasonId = req.params.id;

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, number, status")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.status === "upcoming") {
      return res.status(400).json({ error: "Kun aktive eller afsluttede sæsoner kan genberegnes" });
    }

    const result = await rederiveSeasonRacePoints({ supabase, seasonId, updateStandings, updateRiderValues });

    await logActivity("season_points_rederived", {
      meta: {
        season_id: season.id,
        season_number: season.number,
        races_processed: result.racesProcessed,
        races_skipped_paid: result.racesSkippedPaid,
        races_skipped_no_class: result.racesSkippedNoClass,
        rows_updated: result.rowsUpdated,
        riders_updated: result.ridersUpdated,
      },
    });

    res.json({
      success: true,
      season_id: season.id,
      number: season.number,
      ...result,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/races", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const {
      season_id,
      name,
      race_type = "single",
      stages = 1,
      edition_year = null,
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

    let normalizedEditionYear = null;
    if (edition_year !== null && edition_year !== undefined && edition_year !== "") {
      const parsed = Number.parseInt(edition_year, 10);
      if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2099) {
        return res.status(400).json({ error: "edition_year skal være mellem 2000 og 2099" });
      }
      normalizedEditionYear = parsed;
    }

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, status, number")
      .eq("id", season_id)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.number === 0) {
      return res.status(400).json({ error: "Sæson 0 må ikke have løb" });
    }
    if (season.status === "completed") {
      return res.status(400).json({ error: "Kan ikke tilføje løb til en afsluttet sæson" });
    }

    const payload = {
      season_id,
      name: String(name).trim(),
      race_type,
      stages: normalizedStages,
      edition_year: normalizedEditionYear,
      status: "scheduled",
      race_class: race_class || null,
    };

    const { data: createdRace, error: createError } = await createRaceRecord(payload);
    if (createError) return res.status(500).json({ error: createError.message });

    invalidateNamespace("races");
    res.status(201).json(createdRace);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/races/:raceId — opdatér løb-metadata (#515)
// Body: { name?, race_type?, race_class?, stages?, edition_year? }
// Erstatter den gamle inline supabase.from("races").update() i AdminPage.jsx,
// som blev blokeret af RLS (kun SELECT-policy findes på races-tabellen → silent failure).
router.put("/admin/races/:raceId", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { raceId } = req.params;
    const body = req.body || {};

    // Hent eksisterende race for audit-log before-værdier + validering
    const { data: existing, error: fetchError } = await supabase
      .from("races")
      .select("id, season_id, name, race_type, race_class, stages, edition_year, status")
      .eq("id", raceId)
      .single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Løb ikke fundet" });

    // Bygg update-payload — kun felter der eksplicit er sendt
    const updates = {};

    if (body.name !== undefined) {
      const trimmed = String(body.name).trim();
      if (!trimmed) return res.status(400).json({ error: "Navn må ikke være tomt" });
      updates.name = trimmed;
    }

    if (body.race_type !== undefined) {
      if (!["single", "stage_race"].includes(body.race_type)) {
        return res.status(400).json({ error: "Ugyldig race_type" });
      }
      updates.race_type = body.race_type;
    }

    if (body.race_class !== undefined) {
      updates.race_class = body.race_class || null;
    }

    if (body.stages !== undefined) {
      const effectiveType = updates.race_type || existing.race_type;
      updates.stages = effectiveType === "single"
        ? 1
        : Math.max(1, Number.parseInt(body.stages, 10) || 1);
    }

    if (body.edition_year !== undefined) {
      if (body.edition_year === null || body.edition_year === "") {
        updates.edition_year = null;
      } else {
        const parsed = Number.parseInt(body.edition_year, 10);
        if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2099) {
          return res.status(400).json({ error: "edition_year skal være mellem 2000 og 2099" });
        }
        updates.edition_year = parsed;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ race: existing, unchanged: true });
    }

    const { data: updated, error: updateError } = await supabase
      .from("races")
      .update(updates)
      .eq("id", raceId)
      .select("id, season_id, name, race_type, race_class, stages, edition_year, status")
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    // Audit-log: før/efter pr. ændret felt
    const before = {};
    const after = {};
    for (const key of Object.keys(updates)) {
      before[key] = existing[key];
      after[key] = updated[key];
    }

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.RACE_EDITED,
      description: `Løb redigeret: ${existing.name}`,
      meta: {
        race_id: raceId,
        season_id: existing.season_id,
        before,
        after,
      },
    });

    invalidateNamespace("races");
    res.json({ race: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/race-pool — public katalog af alle tilgængelige løb (Slice 09)
// Cached 10 min; admin race-pool import-csv invalidates the namespace.
router.get("/race-pool", cached({ namespace: "race-pool", ttlMs: CACHE_TTL.racePool }, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("race_pool")
      .select("id, name, race_class, race_type, stages, date_text, country")
      .order("race_class")
      .order("name");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ pool: data || [], summary: summarizePool(data || []) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// GET /api/admin/race-pool — admin overblik (samme data, men som admin)
router.get("/admin/race-pool", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("race_pool")
      .select("id, external_id, name, race_class, race_type, stages, date_text, country, created_at")
      .order("race_class")
      .order("name");
    if (error) return res.status(500).json({ error: error.message });
    const pool = data || [];
    res.json({
      pool,
      summary: summarizePool(pool),
      total_count: pool.length,
      total_race_days: pool.reduce((sum, r) => sum + (Number(r.stages) || 0), 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/race-pool/import-csv — upsert pool fra CSV-tekst (idempotent via external_id)
router.post("/admin/race-pool/import-csv", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { csv_text } = req.body || {};
    if (!csv_text || typeof csv_text !== "string") {
      return res.status(400).json({ error: "csv_text (string) kræves" });
    }
    const { rows, errors } = parseRacePoolCsv(csv_text);
    if (rows.length === 0) {
      return res.status(400).json({ error: "Ingen gyldige rækker i CSV", parse_errors: errors });
    }
    const { data, error } = await supabase
      .from("race_pool")
      .upsert(
        rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "external_id" },
      )
      .select("id, external_id, name");
    if (error) return res.status(500).json({ error: error.message });
    invalidateNamespace("race-pool");
    res.json({
      success: true,
      processed: rows.length,
      upserted: (data || []).length,
      parse_errors: errors,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/seasons/:seasonId/race-selection/preview — generér forslag (ingen writes)
// Body kan eksplicit override stage_race_priority/single_race_boost; hvis udeladt
// hentes de fra seasons-tabellen (single source of truth). Det lader admin se
// preview af unsaved whitelist-ændringer FØR de gemmer.
router.post("/admin/seasons/:seasonId/race-selection/preview", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { seasonId } = req.params;
    const {
      include_classes = null,
      exclude_classes = null,
      race_days_target = DEFAULT_RACE_DAYS_TARGET,
      use_first_season_default = false,
      stage_race_quota,
      stage_race_priority,
      single_race_boost,
    } = req.body || {};

    const { data: pool, error: poolError } = await supabase
      .from("race_pool")
      .select("id, name, race_class, race_type, stages, date_text, country");
    if (poolError) return res.status(500).json({ error: poolError.message });

    // Hent gemt whitelist fra seasons-tabellen som fallback hvis body ikke override'er
    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("stage_race_priority, single_race_boost")
      .eq("id", seasonId)
      .maybeSingle();
    if (seasonError) return res.status(500).json({ error: seasonError.message });

    const prioritizedStageRaceIds = Array.isArray(stage_race_priority)
      ? stage_race_priority
      : season?.stage_race_priority || [];
    const boostSingleRaceIds = Array.isArray(single_race_boost)
      ? single_race_boost
      : season?.single_race_boost || [];

    // stage_race_quota: undefined → brug default (8 for first-season, 0 ellers).
    // Eksplicit 0 fra UI'et bevares som override.
    const quotaOverride =
      stage_race_quota === undefined || stage_race_quota === null
        ? undefined
        : { stageRaceQuota: Number(stage_race_quota) };

    // #1124: tilfældigt seed pr. generering → admin får et nyt varieret forslag
    // hver gang "generér" trykkes (re-roll), og gemmer det han kan lide. Eksplicit
    // body.seed gør det reproducerbart (bruges ikke af UI'et i dag).
    const selectionSeed = Number.isInteger(req.body?.seed)
      ? req.body.seed
      : Math.floor(Math.random() * 2_147_483_647);

    const result = use_first_season_default
      ? selectFirstSeasonRaces(pool || [], {
          raceDaysTarget: Number(race_days_target),
          prioritizedStageRaceIds,
          boostSingleRaceIds,
          seed: selectionSeed,
          ...quotaOverride,
        })
      : selectSeasonRaces({
          pool: pool || [],
          includeClasses: include_classes,
          excludeClasses: exclude_classes ?? [],
          raceDaysTarget: Number(race_days_target),
          prioritizedStageRaceIds,
          boostSingleRaceIds,
          seed: selectionSeed,
          ...quotaOverride,
        });

    res.json({
      ...result,
      world_tour_classes: WORLD_TOUR_CLASSES,
      whitelist_source: Array.isArray(stage_race_priority) ? "request" : "season",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/seasons/:seasonId/race-priority — opdatér gemte whitelists
// Body: { stage_race_priority?: uuid[], single_race_boost?: uuid[] }
// Validerer at IDs eksisterer i race_pool + race_type-konsistens.
router.put("/admin/seasons/:seasonId/race-priority", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { seasonId } = req.params;
    const { stage_race_priority, single_race_boost } = req.body || {};

    if (stage_race_priority !== undefined && !Array.isArray(stage_race_priority)) {
      return res.status(400).json({ error: "stage_race_priority skal være array eller null" });
    }
    if (single_race_boost !== undefined && !Array.isArray(single_race_boost)) {
      return res.status(400).json({ error: "single_race_boost skal være array eller null" });
    }

    // Verificér sæson eksisterer
    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, status")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });

    // Validér race-type-konsistens hvis arrays er sat (ignorér tomme arrays)
    const allIds = [
      ...(Array.isArray(stage_race_priority) ? stage_race_priority : []),
      ...(Array.isArray(single_race_boost) ? single_race_boost : []),
    ];
    if (allIds.length > 0) {
      const { data: poolRows, error: poolError } = await supabase
        .from("race_pool")
        .select("id, race_type")
        .in("id", allIds);
      if (poolError) return res.status(500).json({ error: poolError.message });
      const poolMap = new Map((poolRows || []).map((r) => [r.id, r.race_type]));

      const invalidStage = Array.isArray(stage_race_priority)
        ? stage_race_priority.filter((id) => poolMap.get(id) && poolMap.get(id) !== "stage_race")
        : [];
      const invalidSingle = Array.isArray(single_race_boost)
        ? single_race_boost.filter((id) => poolMap.get(id) && poolMap.get(id) !== "single")
        : [];
      if (invalidStage.length > 0) {
        return res
          .status(400)
          .json({ error: `stage_race_priority indeholder ikke-stage_race ids: ${invalidStage.join(", ")}` });
      }
      if (invalidSingle.length > 0) {
        return res
          .status(400)
          .json({ error: `single_race_boost indeholder ikke-single ids: ${invalidSingle.join(", ")}` });
      }
    }

    const update = {};
    if (stage_race_priority !== undefined) update.stage_race_priority = stage_race_priority;
    if (single_race_boost !== undefined) update.single_race_boost = single_race_boost;

    const { data: updated, error: updateError } = await supabase
      .from("seasons")
      .update(update)
      .eq("id", seasonId)
      .select("id, stage_race_priority, single_race_boost")
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    res.json({ season: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/seasons/:seasonId/race-priority — hent gemt whitelist + race-pool-data
// Returns: { stage_race_priority: uuid[], single_race_boost: uuid[], pool: [...] }
router.get("/admin/seasons/:seasonId/race-priority", requireAdmin, async (req, res) => {
  try {
    const { seasonId } = req.params;

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, stage_race_priority, single_race_boost")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });

    res.json({
      stage_race_priority: season.stage_race_priority || [],
      single_race_boost: season.single_race_boost || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// #505 — race_points editor: GET all, GET baseline, PUT one
// ============================================================

// GET /api/admin/race-points — alle race_points-rows + meta (race_class + result_type lists)
router.get("/admin/race-points", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("race_points")
      .select("id, race_class, result_type, rank, points, updated_at")
      .order("race_class")
      .order("result_type")
      .order("rank");
    if (error) return res.status(500).json({ error: error.message });

    res.json({
      rows: data || [],
      race_classes: UCI_MEN_RACE_CLASSES,
      result_types: UCI_MEN_RESULT_TYPES,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/race-points/baseline — UCI baseline-værdier fra buildUciMenRacePointRows
// Bruges af "Reset to baseline"-knap i frontend.
router.get("/admin/race-points/baseline", requireAdmin, async (req, res) => {
  try {
    const rows = buildUciMenRacePointRows();
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/race-points/:id — opdatér points for én row + audit-log
// Body: { points: number }
router.put("/admin/race-points/:id", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { points } = req.body || {};

    if (!Number.isInteger(points) || points < 0) {
      return res.status(400).json({ error: "points skal være et ikke-negativt heltal" });
    }

    // Hent eksisterende row for audit-log (before-værdi)
    const { data: existing, error: fetchError } = await supabase
      .from("race_points")
      .select("id, race_class, result_type, rank, points")
      .eq("id", id)
      .single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "race_points row ikke fundet" });

    if (existing.points === points) {
      return res.json({ row: existing, unchanged: true });
    }

    const { data: updated, error: updateError } = await supabase
      .from("race_points")
      .update({ points, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, race_class, result_type, rank, points, updated_at")
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.RACE_POINTS_EDITED,
      description: `race_points ${existing.race_class}/${existing.result_type}/#${existing.rank}: ${existing.points} → ${points}`,
      meta: {
        race_points_id: existing.id,
        race_class: existing.race_class,
        result_type: existing.result_type,
        rank: existing.rank,
        before: existing.points,
        after: points,
      },
    });

    res.json({ row: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// #894 (epic #893) — race-point-model: master-anker + kaskade-faktorer + generate.
// Design: docs/slices/prize-money-audit-r2-design.md
// race_points forbliver materialiseret output; model-tabellerne styrer kaskaden.
// ============================================================

// GET /api/admin/race-point-model — master-ankre + faktorer + templates (kurveformer)
// Frontend beregner live preview = round(factor × anchor × weight) uden round-trip.
router.get("/admin/race-point-model", requireAdmin, async (req, res) => {
  try {
    const [mastersRes, cascadesRes, templatesRes] = await Promise.all([
      supabase.from("race_point_master").select("result_type, master_class, anchor, ratio_ref, ratio").order("result_type"),
      supabase.from("race_point_cascade").select("race_class, result_type, factor").order("race_class").order("result_type"),
      supabase.from("race_point_template").select("race_class, result_type, rank, weight").order("race_class").order("result_type").order("rank"),
    ]);
    if (mastersRes.error) return res.status(500).json({ error: mastersRes.error.message });
    if (cascadesRes.error) return res.status(500).json({ error: cascadesRes.error.message });
    if (templatesRes.error) return res.status(500).json({ error: templatesRes.error.message });

    res.json({
      masters: mastersRes.data || [],
      cascades: cascadesRes.data || [],
      templates: templatesRes.data || [],
      race_classes: UCI_MEN_RACE_CLASSES,
      result_types: UCI_MEN_RESULT_TYPES,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/race-point-model/master/:result_type — sæt master-anker (eksplicit tal, v1)
// Body: { anchor: number }
router.put("/admin/race-point-model/master/:result_type", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { result_type } = req.params;
    const { anchor } = req.body || {};
    if (typeof anchor !== "number" || !Number.isFinite(anchor) || anchor < 0) {
      return res.status(400).json({ error: "anchor skal være et ikke-negativt tal" });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("race_point_master").select("result_type, master_class, anchor").eq("result_type", result_type).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "master-række ikke fundet" });

    const { data: updated, error: updateError } = await supabase
      .from("race_point_master")
      .update({ anchor, updated_at: new Date().toISOString() })
      .eq("result_type", result_type)
      .select("result_type, master_class, anchor, ratio_ref, ratio")
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.RACE_POINT_MODEL_EDITED,
      description: `master-anker ${existing.master_class}/${result_type}: ${existing.anchor} → ${anchor}`,
      meta: { kind: "master_anchor", result_type, before: existing.anchor, after: anchor },
    });

    res.json({ row: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/race-point-model/factor/:race_class/:result_type — sæt kaskade-faktor
// Body: { factor: number }
router.put("/admin/race-point-model/factor/:race_class/:result_type", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { race_class, result_type } = req.params;
    const { factor } = req.body || {};
    if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 0) {
      return res.status(400).json({ error: "factor skal være et ikke-negativt tal" });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("race_point_cascade").select("race_class, result_type, factor")
      .eq("race_class", race_class).eq("result_type", result_type).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "kaskade-række ikke fundet" });

    const { data: updated, error: updateError } = await supabase
      .from("race_point_cascade")
      .update({ factor, updated_at: new Date().toISOString() })
      .eq("race_class", race_class).eq("result_type", result_type)
      .select("race_class, result_type, factor")
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.RACE_POINT_MODEL_EDITED,
      description: `kaskade-faktor ${race_class}/${result_type}: ${existing.factor} → ${factor}`,
      meta: { kind: "cascade_factor", race_class, result_type, before: existing.factor, after: factor },
    });

    res.json({ row: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/race-point-model/generate — kaskadér model → race_points (atomisk RPC)
// Returnerer antal ændrede rækker. race-points public-cache refresher via TTL (som per-celle-editor).
router.post("/admin/race-point-model/generate", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("regenerate_race_points");
    if (error) return res.status(500).json({ error: error.message });
    const changed = typeof data === "number" ? data : Number(data) || 0;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.RACE_POINTS_REGENERATED,
      description: `race_points regenereret fra model: ${changed} rækker ændret`,
      meta: { changed },
    });

    res.json({ changed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/seasons/:seasonId/race-selection — gem udvalg som races-rows
// Body: { pool_race_ids: string[], replace?: boolean }
// replace=true: sletter eksisterende pool-bound races for sæsonen FØR insert
// (kun races der ikke har race_results, ellers fejler vi for at undgå data-tab).
router.post("/admin/seasons/:seasonId/race-selection", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { seasonId } = req.params;
    const { pool_race_ids, replace = false } = req.body || {};
    if (!Array.isArray(pool_race_ids) || pool_race_ids.length === 0) {
      return res.status(400).json({ error: "pool_race_ids (array) kræves" });
    }

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, status")
      .eq("id", seasonId)
      .single();
    if (seasonError) return res.status(500).json({ error: seasonError.message });
    if (!season) return res.status(404).json({ error: "Sæson ikke fundet" });
    if (season.status === "completed") {
      return res.status(400).json({ error: "Kan ikke ændre kalender på en afsluttet sæson" });
    }

    const { data: poolRaces, error: poolError } = await supabase
      .from("race_pool")
      .select("id, name, race_class, race_type, stages")
      .in("id", pool_race_ids);
    if (poolError) return res.status(500).json({ error: poolError.message });

    let replacedCount = 0;
    if (replace) {
      // Hent alle eksisterende pool-bound races for sæsonen + deres race_results-status.
      const { data: existingRaces, error: existingRacesError } = await supabase
        .from("races")
        .select("id, name")
        .eq("season_id", seasonId)
        .not("pool_race_id", "is", null);
      if (existingRacesError) return res.status(500).json({ error: existingRacesError.message });

      const existingRaceIds = (existingRaces || []).map((r) => r.id);
      if (existingRaceIds.length > 0) {
        // Sikkerhedstjek: nægter at slette løb der allerede har resultater (data-tab).
        const { count: resultsCount, error: resultsError } = await supabase
          .from("race_results")
          .select("id", { count: "exact", head: true })
          .in("race_id", existingRaceIds);
        if (resultsError) return res.status(500).json({ error: resultsError.message });
        if ((resultsCount || 0) > 0) {
          return res.status(409).json({
            error: `Kan ikke erstatte: ${resultsCount} race_results findes på ${existingRaceIds.length} eksisterende løb. Slet resultaterne først eller brug 'tilføj' i stedet for 'erstat'.`,
          });
        }

        const { error: deleteError } = await supabase
          .from("races")
          .delete()
          .in("id", existingRaceIds);
        if (deleteError) return res.status(500).json({ error: deleteError.message });
        replacedCount = existingRaceIds.length;
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from("races")
      .select("pool_race_id")
      .eq("season_id", seasonId)
      .not("pool_race_id", "is", null);
    if (existingError) return res.status(500).json({ error: existingError.message });
    const existingPoolIds = new Set((existing || []).map((r) => r.pool_race_id));

    const toInsert = (poolRaces || [])
      .filter((p) => !existingPoolIds.has(p.id))
      .map((p) => ({
        season_id: seasonId,
        pool_race_id: p.id,
        name: p.name,
        race_class: p.race_class,
        race_type: p.race_type,
        stages: p.stages,
        status: "scheduled",
      }));

    if (toInsert.length === 0) {
      return res.json({
        success: true,
        inserted: 0,
        replaced: replacedCount,
        skipped_already_present: poolRaces?.length || 0,
      });
    }

    const { data: created, error: createError } = await supabase
      .from("races")
      .insert(toInsert)
      .select("id, pool_race_id, name");
    if (createError) return res.status(500).json({ error: createError.message });

    invalidateNamespace("races");
    res.json({
      success: true,
      inserted: created?.length || 0,
      replaced: replacedCount,
      skipped_already_present: (poolRaces?.length || 0) - (created?.length || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET /api/race-points — UCI-pointtabel for alle løbsklasser
// Cached 10 min; race_points seeds change only via migration/seed scripts so a
// long TTL is safe. Manually invalidate via RESPONSE_CACHE_DISABLED=1 if needed.
router.get("/race-points", requireAuth, cached({ namespace: "race-points", ttlMs: CACHE_TTL.racePoints }, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("race_points")
      .select("race_class, result_type, rank, points")
      .order("rank");
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// GET /api/races — søgbar liste over alle løb på tværs af sæsoner
// Query: season (id eller number), class (race_class), status, q (substring i navn)
// Cached 10 min; admin race creation, season race-selection, and race-pool
// import invalidate the namespace.
router.get("/races", requireAuth, cached({ namespace: "races", ttlMs: CACHE_TTL.races }, async (req, res) => {
  try {
    const { season, class: raceClass, q, status } = req.query;

    let seasonId = null;
    if (season) {
      if (/^\d+$/.test(String(season))) {
        const { data: s } = await supabase
          .from("seasons")
          .select("id")
          .eq("number", parseInt(season, 10))
          .maybeSingle();
        if (!s) return res.json([]);
        seasonId = s.id;
      } else {
        seasonId = season;
      }
    }

    let query = supabase
      .from("races")
      .select(
        "id, name, race_type, race_class, stages, status, edition_year, pool_race:pool_race_id(date_text), season:season_id(id, number, status)"
      )
      .order("name", { ascending: true });

    if (seasonId) query = query.eq("season_id", seasonId);
    if (raceClass) query = query.eq("race_class", raceClass);
    if (status) query = query.eq("status", status);
    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// ── Dashboard-moduler (#1005) ─────────────────────────────────────────────────
// Aggregat-endpoints til de to nye dashboard-moduler. Aggregeringen sker server-
// side (service_role + fetchAllRows) og caches 60s delt på tværs af alle brugere,
// så browseren kun modtager top-5 i stedet for hele sæsonens race_results (8.500+
// rækker og voksende mod TdF). Samme logik som ResultaterPage's topRiders, men
// flyttet væk fra klienten.

// GET /api/dashboard/recent-results — seneste 5 afsluttede løb + vinder
router.get("/dashboard/recent-results", requireAuth, cached({ namespace: "dashboard-recent-results", ttlMs: CACHE_TTL.dashboardRecentResults }, async (req, res) => {
  try {
    const { data: season } = await supabase
      .from("seasons").select("id").eq("status", "active").maybeSingle();
    if (!season) return res.json({ races: [] });

    const { data: races } = await supabase
      .from("races")
      .select("id, name, race_type, stages")
      .eq("season_id", season.id)
      .eq("status", "completed");
    if (!races?.length) return res.json({ races: [] });

    const raceIds = races.map(r => r.id);
    // Kun vinder-rækker (rank=1, gc/stage) — lille datasæt. imported_at på disse
    // rækker afspejler import-batchen og bruges til recency-ordering (date_text er
    // en in-game-streng, ikke kronologisk sorterbar).
    const winnerRows = await fetchAllRows(() => supabase
      .from("race_results")
      .select("race_id, rider_id, result_type, stage_number, rank, imported_at, rider:rider_id(firstname, lastname, nationality_code, team:team_id(name, is_ai))")
      .in("race_id", raceIds)
      .eq("rank", 1)
      .in("result_type", ["gc", "stage"])
      .not("rider_id", "is", null)
      .order("id", { ascending: true }));

    const byRace = new Map();
    for (const row of winnerRows) {
      let e = byRace.get(row.race_id);
      if (!e) { e = { gc: null, latestStage: null, lastImport: null }; byRace.set(row.race_id, e); }
      if (row.imported_at && (!e.lastImport || row.imported_at > e.lastImport)) e.lastImport = row.imported_at;
      if (row.result_type === "gc") {
        e.gc = row;
      } else if (row.result_type === "stage") {
        if (!e.latestStage || (row.stage_number ?? 0) > (e.latestStage.stage_number ?? 0)) e.latestStage = row;
      }
    }

    const raceMeta = new Map(races.map(r => [r.id, r]));
    const out = [];
    for (const [raceId, e] of byRace) {
      const meta = raceMeta.get(raceId);
      if (!meta) continue;
      // Headline = samlet vinder (gc); fallback til seneste etapevinder for
      // afsluttede stage-races der mangler en gc-række.
      const winner = e.gc || e.latestStage;
      if (!winner || !winner.rider) continue;
      out.push({
        race_id: raceId,
        name: meta.name,
        race_type: meta.race_type,
        stages: meta.stages,
        last_import: e.lastImport,
        winner: {
          rider_id: winner.rider_id,
          firstname: winner.rider.firstname,
          lastname: winner.rider.lastname,
          nationality_code: winner.rider.nationality_code,
          team_name: winner.rider.team?.name || null,
          is_ai: winner.rider.team?.is_ai || false,
          result_type: winner.result_type,
          stage_number: winner.stage_number,
        },
      });
    }
    out.sort((a, b) => String(b.last_import || "").localeCompare(String(a.last_import || "")));
    res.json({ races: out.slice(0, 5) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// GET /api/dashboard/rider-ranking — sæsonens top-5 ryttere efter point
router.get("/dashboard/rider-ranking", requireAuth, cached({ namespace: "dashboard-rider-ranking", ttlMs: CACHE_TTL.dashboardRiderRanking }, async (req, res) => {
  try {
    const { data: season } = await supabase
      .from("seasons").select("id").eq("status", "active").maybeSingle();
    if (!season) return res.json({ riders: [] });

    const { data: races } = await supabase
      .from("races").select("id").eq("season_id", season.id);
    if (!races?.length) return res.json({ riders: [] });

    const raceIds = races.map(r => r.id);
    const rows = await fetchAllRows(() => supabase
      .from("race_results")
      .select("rider_id, result_type, rank, points_earned, rider:rider_id(id, firstname, lastname, nationality_code, is_retired, team:team_id(name, is_ai))")
      .in("race_id", raceIds)
      .not("rider_id", "is", null)
      .order("id", { ascending: true }));

    const agg = {};
    for (const r of rows) {
      if (!r.rider_id || !r.rider || r.rider.is_retired) continue;
      if (!agg[r.rider_id]) {
        agg[r.rider_id] = {
          rider_id: r.rider_id,
          firstname: r.rider.firstname,
          lastname: r.rider.lastname,
          nationality_code: r.rider.nationality_code,
          team_name: r.rider.team?.name || null,
          is_ai: r.rider.team?.is_ai || false,
          points: 0, stage_wins: 0, gc_wins: 0,
        };
      }
      const a = agg[r.rider_id];
      a.points += r.points_earned || 0;
      if (r.rank === 1 && r.result_type === "stage") a.stage_wins++;
      if (r.rank === 1 && r.result_type === "gc") a.gc_wins++;
    }

    const top = Object.values(agg).sort((x, y) => y.points - x.points).slice(0, 5);
    res.json({ riders: top });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// GET /api/cache-stats — operational hit/miss counters per namespace
// Admin-only; used during baseline measurement and incident triage.
router.get("/admin/cache-stats", requireAdmin, async (req, res) => {
  res.json(getCacheStats());
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
router.post("/finance/loans", requireAuth, marketWriteLimiter, async (req, res) => {
  try {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    if (!(await assertMarketOpen(req, res, "market"))) return;
    const { loan_type, amount } = req.body;
    if (!["short", "long"].includes(loan_type))
      return res.status(400).json({ error: "Ugyldig låntype — brug short eller long" });
    if (!amount || amount < 1)
      return res.status(400).json({ error: "Ugyldigt beløb" });
    const loan = await createLoan(req.team.id, loan_type, parseInt(amount), null, {
      actorType: FINANCE_ACTOR_TYPE.API,
      actorId: req.user.id,
    });
    res.json({ success: true, loan });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/finance/loans/:id/repay — betal rate på finanslån
router.post("/finance/loans/:id/repay", requireAuth, marketWriteLimiter, async (req, res) => {
  try {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { amount } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: "Ugyldigt beløb" });
    const result = await repayLoan(req.params.id, req.team.id, parseInt(amount), null, {
      actorType: FINANCE_ACTOR_TYPE.API,
      actorId: req.user.id,
    });
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /api/admin/loan-config — opdater lånekonfiguration
router.patch("/admin/loan-config", requireAdmin, adminWriteLimiter, async (req, res) => {
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

// GET /api/admin/auction-config — hent auktionskonfiguration
router.get("/admin/auction-config", requireAdmin, async (req, res) => {
  try {
    const cfg = await getAuctionConfig();
    res.json({ config: cfg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/auction-config — opdater auktionskonfiguration
router.put("/admin/auction-config", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { duration_hours, weekday_open_hour, weekday_close_hour, weekend_open_hour, weekend_close_hour, extension_minutes } = req.body;
    const { data, error } = await supabase.from("auction_timing_config")
      .upsert({
        id: 1,
        duration_hours: parseInt(duration_hours),
        weekday_open_hour: parseInt(weekday_open_hour),
        weekday_close_hour: parseInt(weekday_close_hour),
        weekend_open_hour: parseInt(weekend_open_hour),
        weekend_close_hour: parseInt(weekend_close_hour),
        extension_minutes: parseInt(extension_minutes),
        updated_at: new Date(),
      })
      .select().single();
    if (error) throw error;
    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.AUCTION_CONFIG_UPDATE,
      description: `Auktionsstider opdateret: ${duration_hours}t aktiv, hverdage ${weekday_open_hour}-${weekday_close_hour}, weekend ${weekend_open_hour}-${weekend_close_hour}`,
      meta: { duration_hours, weekday_open_hour, weekday_close_hour, weekend_open_hour, weekend_close_hour, extension_minutes },
    });
    res.json({ success: true, config: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/market/pause — hent pause-state (level + paused_at + reason)
router.get("/admin/market/pause", requireAdmin, async (req, res) => {
  try {
    const state = await getMarketPauseState(supabase);
    res.json(state);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/market/pause — pause auktioner eller hele markedet
// body: { level: 'auctions' | 'all', reason?: string }
router.post("/admin/market/pause", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { level, reason } = req.body || {};
    if (!PAUSE_LEVELS.includes(level) || level === "none") {
      return res.status(400).json({ error: "level skal være 'auctions' eller 'all'" });
    }
    const trimmedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : null;
    const pausedAt = new Date().toISOString();
    const { error } = await supabase.from("auction_timing_config")
      .update({
        market_pause_level: level,
        market_paused_at: pausedAt,
        market_paused_reason: trimmedReason || null,
        updated_at: pausedAt,
      })
      .eq("id", 1);
    if (error) throw error;
    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.MARKET_PAUSE,
      description: level === "all"
        ? `Hele markedet pauset${trimmedReason ? ` — ${trimmedReason}` : ""}`
        : `Auktioner pauset${trimmedReason ? ` — ${trimmedReason}` : ""}`,
      meta: { level, reason: trimmedReason || null, paused_at: pausedAt },
    });
    res.json({ success: true, level, paused_at: pausedAt, reason: trimmedReason || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/market/resume — genoptag marked og skub auktioners calculated_end frem
router.post("/admin/market/resume", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const state = await getMarketPauseState(supabase);
    if (state.level === "none") {
      return res.status(400).json({ error: "Markedet er ikke pauset" });
    }

    const resumedAt = new Date().toISOString();

    // Skub calculated_end frem på alle aktive/extended auktioner med pause-varigheden,
    // så bydere får samme resterende tid som de havde da pausen blev slået til.
    let auctionsShifted = 0;
    if (state.pausedAt) {
      const { data: activeAuctions } = await supabase
        .from("auctions")
        .select("id, calculated_end")
        .in("status", ["active", "extended"]);
      const updates = (activeAuctions || []).map(a => ({
        id: a.id,
        calculated_end: shiftCalculatedEnd(a.calculated_end, state.pausedAt, resumedAt),
      })).filter(u => u.calculated_end !== null);
      if (updates.length > 0) {
        await Promise.all(updates.map(u =>
          supabase.from("auctions").update({ calculated_end: u.calculated_end }).eq("id", u.id)
        ));
        auctionsShifted = updates.length;
      }
    }

    const { error } = await supabase.from("auction_timing_config")
      .update({
        market_pause_level: "none",
        market_paused_at: null,
        market_paused_reason: null,
        updated_at: resumedAt,
      })
      .eq("id", 1);
    if (error) throw error;

    const elapsedMs = state.pausedAt
      ? new Date(resumedAt).getTime() - new Date(state.pausedAt).getTime()
      : 0;
    const elapsedMinutes = Math.round(elapsedMs / 60000);

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.MARKET_RESUME,
      description: `Marked genoptaget efter ${elapsedMinutes} min pause (${auctionsShifted} auktioner forlænget)`,
      meta: {
        prior_level: state.level,
        prior_reason: state.reason,
        paused_at: state.pausedAt,
        resumed_at: resumedAt,
        elapsed_ms: elapsedMs,
        auctions_shifted: auctionsShifted,
      },
    });

    res.json({
      success: true,
      auctions_shifted: auctionsShifted,
      elapsed_minutes: elapsedMinutes,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Slice 08 — sæson-cyklus
// =======================
// GET /api/admin/season-transition/preview — dry-run plan for næste transition
router.get("/admin/season-transition/preview", requireAdmin, async (req, res) => {
  try {
    const { data: activeSeason, error: seasonError } = await supabase
      .from("seasons")
      .select("id, number, status, start_date")
      .eq("status", "active")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (seasonError) throw seasonError;
    if (!activeSeason) {
      return res.status(404).json({ error: "Ingen aktiv sæson fundet" });
    }
    const plan = await buildTransitionPlan({ supabase, fromSeasonId: activeSeason.id });
    res.json({ ok: true, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/season-transition — udfør sæson-skifte
// Body: { fromSeasonId? (default = aktiv sæson), transitionAt? (default = nu), dryRun? }
// dryRun=true: returnerer kun planen, ingen writes til DB.
router.post("/admin/season-transition", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { fromSeasonId: bodyFromSeasonId, transitionAt, dryRun = false } = req.body || {};
    let fromSeasonId = bodyFromSeasonId;
    if (!fromSeasonId) {
      const { data: activeSeason, error: seasonError } = await supabase
        .from("seasons")
        .select("id")
        .eq("status", "active")
        .order("number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (seasonError) throw seasonError;
      if (!activeSeason) {
        return res.status(404).json({ error: "Ingen aktiv sæson fundet" });
      }
      fromSeasonId = activeSeason.id;
    }

    const result = await transitionToNextSeason({
      supabase,
      fromSeasonId,
      transitionAt: transitionAt ? new Date(transitionAt) : new Date(),
      dryRun: Boolean(dryRun),
      adminUserId: req.user?.id ?? null,
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/adjust-balance — juster holdbalance manuelt
router.post("/admin/adjust-balance", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { team_id, amount, reason } = req.body;
    if (!team_id || amount === undefined) return res.status(400).json({ error: "team_id og amount kræves" });
    const { data: team } = await supabase.from("teams").select("balance").eq("id", team_id).single();
    if (!team) return res.status(404).json({ error: "Hold ikke fundet" });
    // Slice 07c: balance + finance_transactions atomic via RPC.
    // 07d Fase B / #240: admin-trigger → actor_type=admin, actor_id=req.user.id,
    // season_id eksplicit fra activeSeason.
    const { data: adjustSeason } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
    await incrementBalanceWithAudit(supabase, {
      teamId: team_id,
      delta: parseInt(amount),
      payload: {
        type: "admin_adjustment",
        amount: parseInt(amount),
        description: reason || "Admin justering",
        season_id: adjustSeason?.id ?? null,
        actor_type: FINANCE_ACTOR_TYPE.ADMIN,
        actor_id: req.user.id,
        source_path: "api.admin.adjustBalance",
        reason_code: FINANCE_REASON.ADMIN_BALANCE_ADJUSTMENT,
        related_entity_type: FINANCE_RELATED_ENTITY.MANUAL,
        related_entity_id: null,
      },
    });
    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.BALANCE_ADJUSTMENT,
      description: `Balance justeret med ${amount} CZ$: ${reason || "—"}`,
      target_team_id: team_id,
      meta: { amount, reason },
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/transfer-window/open — åbn transfervinduet for aktiv sæson
router.post("/admin/transfer-window/open", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { season_id } = req.body;
    if (!season_id) return res.status(400).json({ error: "season_id kræves" });

    const { closes_at } = req.body;

    // S-02a: arv board_negotiation_state fra forrige window så onboarding-fasen
    // ikke resettes til 'locked' bare fordi et nyt sæson-window oprettes.
    const { data: priorWindow } = await supabase.from("transfer_windows")
      .select("board_negotiation_state")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const inheritedState = priorWindow?.board_negotiation_state ?? "locked";

    // Insert new window record with status "open"
    const { error: insertErr } = await supabase.from("transfer_windows")
      .insert({
        season_id,
        status: "open",
        board_negotiation_state: inheritedState,
        ...(closes_at ? { closes_at } : {}),
      });
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    // Flush auction winners (pending_team_id → team_id).
    // Pagineret: et naivt .select() rammer PostgREST's 1000-row-loft og taber
    // stille parkerede ryttere (samme klasse som #772/#774). .order("id") gør
    // siderne stabile. Refs #879.
    const pendingRiders = await fetchAllRows(() => supabase.from("riders")
      .select("id, pending_team_id")
      .not("pending_team_id", "is", null)
      .order("id"));

    let ridersProcessed = 0;
    if (pendingRiders && pendingRiders.length > 0) {
      const flushedAt = new Date().toISOString();
      await Promise.all(pendingRiders.map(r =>
        supabase.from("riders").update({ team_id: r.pending_team_id, pending_team_id: null, acquired_at: flushedAt }).eq("id", r.id)
      ));
      ridersProcessed = pendingRiders.length;
    }

    // Flush window_pending direct transfers, swaps, and rider-loans.
    const { transfersProcessed, swapsProcessed } = await flushWindowPendingOffers(supabase, {
      logActivity,
      notifyTeamOwner,
      notifyTransferCompleted,
      notifySwapCompleted,
    });
    const { loansProcessed, loanBuyoutsProcessed } = await flushWindowPendingLoans();

    res.json({
      success: true,
      riders_processed: ridersProcessed,
      transfers_processed: transfersProcessed,
      swaps_processed: swapsProcessed,
      loans_processed: loansProcessed,
      loan_buyouts_processed: loanBuyoutsProcessed,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/transfer-window/close — luk transfervinduet
router.post("/admin/transfer-window/close", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { data: tw } = await supabase.from("transfer_windows")
      .select("id").order("created_at", { ascending: false }).limit(1).single();
    if (!tw) return res.status(404).json({ error: "Intet aktivt transfervindue fundet" });
    await supabase.from("transfer_windows").update({ status: "closed" }).eq("id", tw.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/deadline-day/override — skift override-tilstand (auto/on/off)
router.put("/admin/deadline-day/override", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { override } = req.body;
    if (!["auto", "on", "off"].includes(override)) {
      return res.status(400).json({ error: "override skal være 'auto', 'on' eller 'off'" });
    }
    const { error } = await supabase.from("auction_timing_config")
      .update({ deadline_day_override: override, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, override });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/deadline-readiness — "Klar til deadline?"-overblik
// Returnerer alt admin har brug for at vurdere om systemet er klart til at
// transfervinduet lukker: window-state, aktive auktioner, pending offers,
// squad-violations, kalender-status.
router.get("/admin/deadline-readiness", requireAdmin, async (req, res) => {
  try {
    // Roster-floor fjernet 2026-06-05: min=0 → squad-violations rapporterer kun "over_max".
    const LIMITS = { 1: { min: 0, max: 30 }, 2: { min: 0, max: 20 }, 3: { min: 0, max: 10 } };

    const [
      { data: window },
      { data: activeSeason },
      { count: activeAuctionsCount },
      { count: pendingTransfersCount },
      { count: windowPendingTransfersCount },
      { count: pendingSwapsCount },
      { count: activeLoansCount },
      { data: teams },
      { data: riders },
      { data: nextSeason },
    ] = await Promise.all([
      supabase.from("transfer_windows")
        .select("id, season_id, status, closes_at, opened_at, final_whistle_sent_at, squad_enforcement_completed_at")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("seasons")
        .select("id, number, status").eq("status", "active")
        .order("number", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("auctions")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "extended"]),
      supabase.from("transfer_offers")
        .select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("transfer_offers")
        .select("id", { count: "exact", head: true }).eq("status", "window_pending"),
      supabase.from("swap_offers")
        .select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("loan_agreements")
        .select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("teams")
        .select("id, name, division").eq("is_bank", false).eq("is_ai", false).not("user_id", "is", null),
      supabase.from("riders").select("team_id").not("team_id", "is", null),
      supabase.from("seasons")
        .select("id, number, status").order("number", { ascending: false }).limit(2),
    ]);

    // Squad violations
    const ridersByTeam = {};
    for (const r of riders || []) {
      ridersByTeam[r.team_id] = (ridersByTeam[r.team_id] || 0) + 1;
    }
    const squadViolations = (teams || [])
      .map((t) => {
        const count = ridersByTeam[t.id] || 0;
        const limits = LIMITS[t.division] || { min: 8, max: 30 };
        let status = "ok";
        if (count < limits.min) status = "under_min";
        else if (count > limits.max) status = "over_max";
        return { team_id: t.id, team_name: t.name, division: t.division, count, ...limits, status };
      })
      .filter((s) => s.status !== "ok");

    // Faktisk kalender-tjek mod aktiv sæson
    let activeSeasonRacesCount = 0;
    if (activeSeason?.id) {
      const { count } = await supabase
        .from("races").select("id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id);
      activeSeasonRacesCount = count || 0;
    }

    // Næste sæsons kalender (hvis fundet)
    const upcomingSeason = (nextSeason || []).find((s) => s.status !== "active" && s.status !== "completed");
    let upcomingSeasonRacesCount = 0;
    if (upcomingSeason?.id) {
      const { count } = await supabase
        .from("races").select("id", { count: "exact", head: true })
        .eq("season_id", upcomingSeason.id);
      upcomingSeasonRacesCount = count || 0;
    }

    const nowMs = Date.now();
    const closesAtMs = window?.closes_at ? new Date(window.closes_at).getTime() : null;
    const secondsRemaining = closesAtMs ? Math.max(0, Math.floor((closesAtMs - nowMs) / 1000)) : null;

    res.json({
      window: window ? {
        id: window.id,
        status: window.status,
        closes_at: window.closes_at,
        opened_at: window.opened_at,
        final_whistle_sent_at: window.final_whistle_sent_at,
        squad_enforcement_completed_at: window.squad_enforcement_completed_at,
        seconds_remaining: secondsRemaining,
        closes_at_set: Boolean(window.closes_at),
      } : null,
      active_season: activeSeason || null,
      upcoming_season: upcomingSeason || null,
      counts: {
        active_auctions: activeAuctionsCount || 0,
        pending_transfers: pendingTransfersCount || 0,
        window_pending_transfers: windowPendingTransfersCount || 0,
        pending_swaps: pendingSwapsCount || 0,
        active_loans: activeLoansCount || 0,
        active_season_races: activeSeasonRacesCount,
        upcoming_season_races: upcomingSeasonRacesCount,
      },
      squad_violations: squadViolations,
      checks: {
        closes_at_set: { ok: Boolean(window?.closes_at), critical: true },
        window_open: { ok: window?.status === "open", critical: true },
        active_season_calendar_ready: { ok: activeSeasonRacesCount > 0, critical: false },
        upcoming_season_calendar_ready: { ok: upcomingSeasonRacesCount > 0, critical: false },
        no_squad_violations: { ok: squadViolations.length === 0, critical: false },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/transfer-window/closes-at — opdater lukketidspunkt på seneste vindue
router.put("/admin/transfer-window/closes-at", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { closes_at } = req.body;
    if (!closes_at) return res.status(400).json({ error: "closes_at kræves" });
    const { data: tw } = await supabase.from("transfer_windows")
      .select("id").order("created_at", { ascending: false }).limit(1).single();
    if (!tw) return res.status(404).json({ error: "Intet transfervindue fundet" });
    const { error } = await supabase.from("transfer_windows")
      .update({ closes_at }).eq("id", tw.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, closes_at });
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
// Returnerer struktureret status så frontend kan vise konkret diagnose pr. webhook.
router.post("/admin/discord/test", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { webhook_url } = req.body;
  if (!webhook_url) return res.status(400).json({ error: "webhook_url påkrævet" });
  const result = await sendTestEmbed(webhook_url);
  res.json({ ...result, timestamp: new Date().toISOString() });
});

// #517: discord_settings ejes nu af backend (service_role bypasser RLS, public-read
// policy droppet 2026-05-22). Webhook URLs er secrets — masking sker server-side
// så frontend kun ser sidste 8 tegn til UI-genkendelse, fuld URL aldrig sendes.
function maskWebhookUrl(url) {
  if (!url || typeof url !== "string") return null;
  const tail = url.slice(-8);
  return `https://discord.com/api/webhooks/…${tail}`;
}

// GET /api/admin/discord-settings — list alle webhooks (maskerede URLs)
router.get("/admin/discord-settings", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("discord_settings")
    .select("id, webhook_name, webhook_type, is_default, created_at, webhook_url")
    .order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  const webhooks = (data || []).map((row) => ({
    id: row.id,
    webhook_name: row.webhook_name,
    webhook_type: row.webhook_type,
    is_default: row.is_default,
    created_at: row.created_at,
    webhook_url_masked: maskWebhookUrl(row.webhook_url),
  }));
  res.json({ webhooks });
});

// POST /api/admin/discord-settings — opret ny webhook
router.post("/admin/discord-settings", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { webhook_name, webhook_url, webhook_type, is_default } = req.body || {};
  if (!webhook_name || !webhook_url) {
    return res.status(400).json({ error: "webhook_name og webhook_url påkrævet" });
  }
  if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(webhook_url)) {
    return res.status(400).json({ error: "webhook_url skal være en Discord webhook URL" });
  }
  const { count } = await supabase
    .from("discord_settings")
    .select("id", { count: "exact", head: true });
  const shouldBeDefault = is_default === true || (count || 0) === 0;
  if (shouldBeDefault) {
    await supabase.from("discord_settings").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data, error } = await supabase
    .from("discord_settings")
    .insert({
      webhook_name,
      webhook_url,
      webhook_type: webhook_type || "general",
      is_default: shouldBeDefault,
    })
    .select("id")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id, is_default: shouldBeDefault });
});

// PATCH /api/admin/discord-settings/:id/default — sæt som standard-webhook
router.patch("/admin/discord-settings/:id/default", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { id } = req.params;
  const { error: clearErr } = await supabase
    .from("discord_settings")
    .update({ is_default: false })
    .neq("id", id);
  if (clearErr) return res.status(500).json({ error: clearErr.message });
  const { error } = await supabase
    .from("discord_settings")
    .update({ is_default: true })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// DELETE /api/admin/discord-settings/:id
router.delete("/admin/discord-settings/:id", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { error } = await supabase
    .from("discord_settings")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/admin/discord-settings/:id/test — test gemte webhook via stored URL
// Frontend kan kalde denne i stedet for selv at indsende URL (som vi ikke længere returnerer).
router.post("/admin/discord-settings/:id/test", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { data, error } = await supabase
    .from("discord_settings")
    .select("webhook_url")
    .eq("id", req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: "Webhook ikke fundet" });
  const result = await sendTestEmbed(data.webhook_url);
  res.json({ ...result, timestamp: new Date().toISOString() });
});

// POST /api/admin/sync-dyn-cyclist — sync PCM stats fra Google Sheets
router.post("/admin/sync-dyn-cyclist", requireAdmin, adminWriteLimiter, handleDynCyclistSyncRequest);

// POST /api/admin/import-results-sheets — importer løbsresultater fra Google Sheets (dry_run for preview)
router.post("/admin/import-results-sheets", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { spreadsheet_url, dry_run } = req.body;
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
      dryRun: Boolean(dry_run),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/import-results-pcm — importer PCM-resultatfiler (SpreadsheetML 2003).
// Multi-fil pr. løb; body.dry_run="true" giver preview uden DB-writes. Felt-navn: "files".
// GC-timing + hold-alias + eksakt navne-match håndteres i pcmResultsImport-pipelinen.
router.post(
  "/admin/import-results-pcm",
  requireAdmin,
  adminWriteLimiter,
  adminImportUploadMultipleFiles,
  async (req, res) => {
    const files = (req.files || []).map((f) => ({
      filename: f.originalname,
      buffer: f.buffer,
    }));
    if (!files.length) {
      return res.status(400).json({ error: "Ingen filer uploadet" });
    }
    const dryRun = req.body?.dry_run === "true" || req.body?.dry_run === true;

    // Detaljeret Discord-notifikation pr. importeret løb (kun ved rigtig import).
    const notifyDiscord = dryRun
      ? null
      : async ({ race, preview, resultRows }) => {
          const url = await getDefaultWebhook();
          if (!url) return;
          const embed = buildPcmImportEmbed({ race, preview, resultRows });
          await sendWebhook(url, { embeds: [{ ...embed, footer: { text: "Cycling Zone" } }] });
        };

    try {
      const result = await importPcmResults({
        supabase,
        files,
        dryRun,
        ensureSeasonStandings,
        updateStandings,
        notifyDiscord,
        adminUserId: req.user.id,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/admin/prize-payout-preview — vis betalte og udestående præmier for en sæson
router.get("/admin/prize-payout-preview", requireAdmin, async (req, res) => {
  const { season_id } = req.query;
  if (!season_id) return res.status(400).json({ error: "season_id påkrævet" });
  try {
    const preview = await getSeasonPrizePreview(season_id, supabase);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/pay-prizes-to-date — udbetal alle udestående præmier for en sæson
router.post("/admin/pay-prizes-to-date", requireAdmin, adminWriteLimiter, async (req, res) => {
  const { season_id } = req.body;
  if (!season_id) return res.status(400).json({ error: "season_id påkrævet" });
  try {
    const result = await paySeasonPrizesToDate(season_id, req.user.id, supabase);
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
router.delete("/admin/users/:userId", requireAdmin, adminWriteLimiter, async (req, res) => {
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
      action_type: ADMIN_ACTION_TYPE.USER_DELETED,
      description: `Bruger slettet: ${target.username} (${target.email})`,
      meta: { deleted_user_id: userId },
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/users/:userId/role — skift brugerrolle
router.patch("/admin/users/:userId/role", requireAdmin, adminWriteLimiter, async (req, res) => {
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
      action_type: ADMIN_ACTION_TYPE.ROLE_CHANGED,
      description: `Rolle ændret for ${data.username} → ${role}`,
      meta: { user_id: userId, role },
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Slice 07e · Admin økonomi-dashboard ──────────────────────────────────────

// Fase B blev udrullet 2026-05-09 17:00 UTC; rows skrevet før den tid mangler
// audit-kolonner og er forventede legacy-NULL'er — health-endpointet skelner.
const PHASE_B_DEPLOY_CUTOFF = "2026-05-09T17:00:00Z";
const STARTING_BALANCE = 800000; // matcher DEFAULT_BETA_BALANCE i economyConstants
const FINANCE_TX_MAX_LIMIT = 200;
const FINANCE_TX_DEFAULT_LIMIT = 50;

// GET /api/admin/economy-overview — per-hold økonomi-overblik
router.get("/admin/economy-overview", requireAdmin, async (req, res) => {
  try {
    const { division, q, include_ai, include_frozen } = req.query;
    const includeAi = include_ai === "true" || include_ai === "1";
    const includeFrozen = include_frozen === "true" || include_frozen === "1";

    let teamsQuery = supabase
      .from("teams")
      .select("id, name, division, balance, sponsor_income, is_ai, is_bank, is_frozen, user_id")
      .eq("is_bank", false);
    if (division) teamsQuery = teamsQuery.eq("division", parseInt(division, 10));
    if (q) teamsQuery = teamsQuery.ilike("name", `%${q}%`);
    if (!includeAi) teamsQuery = teamsQuery.eq("is_ai", false);
    if (!includeFrozen) teamsQuery = teamsQuery.eq("is_frozen", false);

    const { data: teams, error: teamsErr } = await teamsQuery.order("division").order("name");
    if (teamsErr) throw teamsErr;

    if (!teams || teams.length === 0) return res.json({ teams: [] });

    const divisions = [...new Set(teams.map((t) => t.division))];
    const teamIds = teams.map((t) => t.id);

    const [{ data: loanConfigs }, { data: activeLoans }] = await Promise.all([
      supabase.from("loan_config").select("division, debt_ceiling").in("division", divisions),
      supabase.from("loans").select("team_id, amount_remaining").in("team_id", teamIds).eq("status", "active"),
    ]);

    const ceilingByDivision = new Map();
    for (const cfg of loanConfigs || []) ceilingByDivision.set(cfg.division, cfg.debt_ceiling);

    const debtByTeam = new Map();
    for (const loan of activeLoans || []) {
      debtByTeam.set(loan.team_id, (debtByTeam.get(loan.team_id) || 0) + (loan.amount_remaining || 0));
    }

    const enriched = teams.map((t) => {
      const totalDebt = debtByTeam.get(t.id) || 0;
      const debtCeiling = ceilingByDivision.get(t.division) || 0;
      return {
        id: t.id,
        name: t.name,
        division: t.division,
        balance: t.balance,
        sponsor_income: t.sponsor_income,
        total_debt: totalDebt,
        debt_ceiling: debtCeiling,
        debt_ratio: computeDebtRatio(totalDebt, debtCeiling),
        sustainability: computeSustainabilityTier(totalDebt, debtCeiling),
        is_ai: t.is_ai,
        is_frozen: t.is_frozen,
      };
    });

    res.json({ teams: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/teams/:teamId/freeze — frys et hold (skjul fra standings, sponsor, board, beta-reset).
// Bevarer user_id + balance + rytter-historik så holdet kan optøs igen senere.
// Refs #452 — manager der ikke kan stille hold ved sæsonstart skal kunne sættes på pause.
router.post("/admin/teams/:teamId/freeze", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { reason } = req.body || {};

    const { data: team, error: loadErr } = await supabase
      .from("teams")
      .select("id, name, is_ai, is_bank, is_frozen, division")
      .eq("id", teamId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!team) return res.status(404).json({ error: "Hold ikke fundet" });
    if (team.is_ai) return res.status(400).json({ error: "AI-hold kan ikke fryses" });
    if (team.is_bank) return res.status(400).json({ error: "Bank-hold kan ikke fryses" });
    if (team.is_frozen) return res.status(409).json({ error: "Hold er allerede frosset" });

    const { error: updateErr } = await supabase
      .from("teams").update({ is_frozen: true }).eq("id", teamId);
    if (updateErr) throw updateErr;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.TEAM_FROZEN,
      description: `Hold frosset: ${team.name} (D${team.division})${reason ? ` — ${reason}` : ""}`,
      meta: { team_id: teamId, team_name: team.name, division: team.division, reason: reason || null },
    });

    res.json({ success: true, team_id: teamId, is_frozen: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/teams/:teamId/unfreeze — optø et tidligere frosset hold.
// Holdet returnerer til standings, sponsor-payouts og board-flow ved næste sæson-start / cron-tick.
router.post("/admin/teams/:teamId/unfreeze", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { reason } = req.body || {};

    const { data: team, error: loadErr } = await supabase
      .from("teams")
      .select("id, name, is_frozen, division")
      .eq("id", teamId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!team) return res.status(404).json({ error: "Hold ikke fundet" });
    if (!team.is_frozen) return res.status(409).json({ error: "Hold er ikke frosset" });

    const { error: updateErr } = await supabase
      .from("teams").update({ is_frozen: false }).eq("id", teamId);
    if (updateErr) throw updateErr;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.TEAM_UNFROZEN,
      description: `Hold optøet: ${team.name} (D${team.division})${reason ? ` — ${reason}` : ""}`,
      meta: { team_id: teamId, team_name: team.name, division: team.division, reason: reason || null },
    });

    res.json({ success: true, team_id: teamId, is_frozen: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/finance-transactions — paginated + filtreret tx-historik
router.get("/admin/finance-transactions", requireAdmin, async (req, res) => {
  try {
    const {
      type, team_id, season_id, actor_type, reason_code, source_path,
      related_entity_type, related_entity_id,
      date_from, date_to, amount_min, amount_max,
    } = req.query;

    let limit = parseInt(req.query.limit ?? FINANCE_TX_DEFAULT_LIMIT, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = FINANCE_TX_DEFAULT_LIMIT;
    if (limit > FINANCE_TX_MAX_LIMIT) limit = FINANCE_TX_MAX_LIMIT;
    let offset = parseInt(req.query.offset ?? 0, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    let query = supabase
      .from("finance_transactions")
      .select(
        "id, team_id, type, amount, description, season_id, race_id, created_at, related_loan_id, " +
        "actor_type, actor_id, source_path, reason_code, before_balance, after_balance, " +
        "related_entity_type, related_entity_id, idempotency_key, " +
        "team:team_id(id, name, division), season:season_id(id, number)",
        { count: "exact" }
      );

    if (type) query = query.eq("type", type);
    if (team_id) query = query.eq("team_id", team_id);
    if (season_id) query = query.eq("season_id", season_id);
    if (actor_type) query = query.eq("actor_type", actor_type);
    if (reason_code) query = query.eq("reason_code", reason_code);
    if (related_entity_type) query = query.eq("related_entity_type", related_entity_type);
    if (related_entity_id) query = query.eq("related_entity_id", related_entity_id);
    if (source_path) query = query.ilike("source_path", `%${source_path}%`);
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);
    if (amount_min) query = query.gte("amount", parseInt(amount_min, 10));
    if (amount_max) query = query.lte("amount", parseInt(amount_max, 10));

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      transactions: data || [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/economy-health — health-widgets (NULL-counter + balance-drift)
router.get("/admin/economy-health", requireAdmin, async (req, res) => {
  try {
    const [
      { count: preNull },
      { count: postNull },
      { count: postPopulated },
      { count: totalTx },
      { data: humanTeams },
    ] = await Promise.all([
      supabase
        .from("finance_transactions")
        .select("id", { count: "exact", head: true })
        .lt("created_at", PHASE_B_DEPLOY_CUTOFF)
        .is("actor_type", null),
      supabase
        .from("finance_transactions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", PHASE_B_DEPLOY_CUTOFF)
        .is("actor_type", null),
      supabase
        .from("finance_transactions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", PHASE_B_DEPLOY_CUTOFF)
        .not("actor_type", "is", null),
      supabase.from("finance_transactions").select("id", { count: "exact", head: true }),
      supabase
        .from("teams")
        .select("id, balance")
        .not("user_id", "is", null)
        .eq("is_ai", false)
        .eq("is_bank", false),
    ]);

    const teamIds = (humanTeams || []).map((t) => t.id);
    let driftTeams = 0;
    let maxDrift = 0;
    if (teamIds.length > 0) {
      const { data: txRows, error: txErr } = await supabase
        .from("finance_transactions")
        .select("team_id, amount")
        .in("team_id", teamIds);
      if (txErr) throw txErr;
      const sumByTeam = new Map();
      for (const row of txRows || []) {
        sumByTeam.set(row.team_id, (sumByTeam.get(row.team_id) || 0) + (row.amount || 0));
      }
      for (const t of humanTeams) {
        const expected = STARTING_BALANCE + (sumByTeam.get(t.id) || 0);
        const drift = Math.abs(t.balance - expected);
        if (drift > 0) driftTeams += 1;
        if (drift > maxDrift) maxDrift = drift;
      }
    }

    res.json({
      finance_null_actor_type: {
        pre_phase_b: preNull ?? 0,
        post_phase_b: postNull ?? 0,
        post_phase_b_populated: postPopulated ?? 0,
        total: totalTx ?? 0,
      },
      balance_drift: {
        teams_with_drift: driftTeams,
        max_drift: maxDrift,
        teams_checked: teamIds.length,
        starting_balance: STARTING_BALANCE,
      },
      deploy_cutoff: PHASE_B_DEPLOY_CUTOFF,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/admin-log — paginated + filtreret feed af admin-handlinger
router.get("/admin/admin-log", requireAdmin, async (req, res) => {
  try {
    const { action_type, admin_user_id, target_team_id, target_rider_id, date_from, date_to } = req.query;

    let limit = parseInt(req.query.limit ?? FINANCE_TX_DEFAULT_LIMIT, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = FINANCE_TX_DEFAULT_LIMIT;
    if (limit > FINANCE_TX_MAX_LIMIT) limit = FINANCE_TX_MAX_LIMIT;
    let offset = parseInt(req.query.offset ?? 0, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    let query = supabase
      .from("admin_log")
      .select(
        "id, admin_user_id, action_type, description, target_team_id, target_rider_id, meta, created_at",
        { count: "exact" }
      );

    if (action_type) query = query.eq("action_type", action_type);
    if (admin_user_id) query = query.eq("admin_user_id", admin_user_id);
    if (target_team_id) query = query.eq("target_team_id", target_team_id);
    if (target_rider_id) query = query.eq("target_rider_id", target_rider_id);
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ entries: data || [], total: count ?? 0, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cron-runs — finance_transactions grupperet per cron-tick / request-burst
router.get("/admin/cron-runs", requireAdmin, async (req, res) => {
  try {
    const { actor_type, source_path, date_from, date_to } = req.query;
    const windowSeconds = parseInt(req.query.window_seconds ?? 5, 10);

    // Default: sidste 7 dage. Grouping kræver hele tx-vinduet i memory, så
    // begræns altid til en max-batch (matcher FINANCE_TX_MAX_LIMIT × ~100).
    const fromDefault = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from("finance_transactions")
      .select("id, team_id, amount, created_at, actor_type, actor_id, source_path, reason_code")
      .not("actor_id", "is", null)
      .not("source_path", "is", null)
      .gte("created_at", date_from || fromDefault);
    if (date_to) query = query.lte("created_at", date_to);
    if (actor_type) query = query.eq("actor_type", actor_type);
    if (source_path) query = query.ilike("source_path", `%${source_path}%`);

    // Hard cap så vi aldrig trækker hele tabellen ind ved et fejl-filter.
    query = query.order("created_at", { ascending: false }).limit(20000);

    const { data, error } = await query;
    if (error) throw error;

    const runs = groupCronRuns(data || [], { windowSeconds });
    res.json({
      runs,
      total_tx: (data || []).length,
      window_seconds: windowSeconds,
      date_from: date_from || fromDefault,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/races/:raceId — slet løb (cascader til race_results)
router.delete("/admin/races/:raceId", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { raceId } = req.params;
    const { data: race } = await supabase
      .from("races").select("name").eq("id", raceId).single();
    if (!race) return res.status(404).json({ error: "Løb ikke fundet" });

    const { error } = await supabase.from("races").delete().eq("id", raceId);
    if (error) throw error;

    await supabase.from("admin_log").insert({
      admin_user_id: req.user.id,
      action_type: ADMIN_ACTION_TYPE.RACE_DELETED,
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
router.post("/presence", requireAuth, presencePulseLimiter, async (req, res) => {
  const { error } = await supabase.from("users")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", req.user.id);
  if (error) console.error("[presence] update failed:", error.message);
  res.json({ ok: true, user_id: req.user.id, error: error?.message || null });
});

// POST /api/login-streak — beregn og opdater daglig login-streak
router.post("/login-streak", requireAuth, presencePulseLimiter, async (req, res) => {
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
router.post("/achievements/check", requireAuth, presencePulseLimiter, async (req, res) => {
  try {
    const newlyUnlocked = await checkAchievements({
      supabase,
      userId: req.user.id,
    });

    res.json({ unlocked: newlyUnlocked });
  } catch (error) {
    captureException(error, {
      route: "POST /api/achievements/check",
      user_id: req.user.id,
    });
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
      .select("id, firstname, lastname, market_value, is_u25, stat_bj, stat_sp, stat_tt")
      .eq("team_id", teamId).order("market_value", { ascending: false }),
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

// GET /api/riders/:id/view-count — popularitet (#957): unikke besøgende seneste
// 24t + 7d + trend, aggregeret fra rider_profile_views (#963) via service_role.
// Læsning sker server-side fordi tabellen bevidst ingen authenticated SELECT-policy
// har (aggregeret-only, samme mønster som watchlist-count). Vi henter de seneste
// 14 dages rows (dækker både aktuel 7d + forrige 7d til trenden) og aggregerer i JS.
router.get("/riders/:id/view-count", requireAuth, async (req, res) => {
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [viewsRes, oldestRes] = await Promise.all([
    supabase.from("rider_profile_views")
      .select("user_id, viewed_at")
      .eq("rider_id", req.params.id)
      .gte("viewed_at", sinceIso),
    // Systemets logging-alder afgør cold-start (#957): er der nok historik til at
    // en hel forrige 7d-periode kan have data? Ældste viewed_at globalt svarer.
    supabase.from("rider_profile_views")
      .select("viewed_at").order("viewed_at", { ascending: true }).limit(1),
  ]);

  const oldestIso = oldestRes.data?.[0]?.viewed_at ?? null;
  const agg = aggregateRiderViews(viewsRes.data || [], {
    nowMs,
    oldestViewedAtMs: oldestIso ? new Date(oldestIso).getTime() : null,
  });
  res.json(agg);
});

// POST /api/riders/:id/view — vis rytter-profil, log besøg (#963) + trigger evt. transferrygte
router.post("/riders/:id/view", requireAuth, presencePulseLimiter, async (req, res) => {
  const { data: rider } = await supabase.from("riders")
    .select("id, firstname, lastname, team_id").eq("id", req.params.id).single();

  // Besøgs-logging (#963) — datafundament for popularitet (#957). Fire-and-forget:
  // må aldrig fejle endpointet. Daily-dedup pr. (bruger, rytter, dag) håndhæves af
  // rider_profile_views_daily_uniq; ignoreDuplicates → ON CONFLICT DO NOTHING.
  if (rider?.id && req.user?.id) {
    supabase.from("rider_profile_views").upsert(
      { rider_id: rider.id, user_id: req.user.id },
      { onConflict: "user_id,rider_id,view_date", ignoreDuplicates: true },
    ).then(({ error }) => {
      if (error) console.error("[rider-view-log] insert failed:", error.message);
    });
  }

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
    supabase.from("seasons").select("id, number, race_days_completed, race_days_total").eq("status", "active").single(),
    supabase.from("teams").select("id, balance, sponsor_income, division, season_1_identity_basis, team_dna_key").eq("id", teamId).single(),
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

function decorateTeamBoardMembers(teamBoardMembers = []) {
  return (teamBoardMembers || [])
    .map((member) => {
      const archetype = getArchetypeByKey(member.archetype_key);
      if (!archetype) return null;
      return {
        archetype_key: member.archetype_key,
        selection_kind: member.selection_kind,
        alignment_score: member.alignment_score,
        is_chairman: member.is_chairman,
        assigned_at: member.assigned_at,
        label: archetype.label,
        // #917/#694 · i18n-koder (frontend resolver via board.json; DA = fallback).
        label_key: `archetypes.${member.archetype_key}.label`,
        emoji: archetype.emoji,
        short_description: archetype.short_description,
        short_description_key: `archetypes.${member.archetype_key}.shortDescription`,
        long_description: archetype.long_description,
        long_description_key: `archetypes.${member.archetype_key}.longDescription`,
      };
    })
    .filter(Boolean);
}

function requiresBoardDnaChoice(team = null) {
  return Boolean(team?.season_1_identity_basis && !team?.team_dna_key);
}

// GET /api/board/status — alle tre parallelle planer for det autentificerede hold
router.get("/board/status", requireAuth, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const [seasonRes, boardsRes, teamRes, ridersRes, standingRes, loansRes, windowRes, membersRes] = await Promise.all([
      supabase.from("seasons").select("id, number, race_days_completed, race_days_total").eq("status", "active").single(),
      supabase.from("board_profiles").select("*").eq("team_id", teamId),
      supabase.from("teams").select("id, balance, sponsor_income, division, season_1_identity_basis, consecutive_low_satisfaction_expirations, team_dna_key, team_dna_chosen_at").eq("id", teamId).single(),
      supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", teamId),
      supabase.from("season_standings").select("*").eq("team_id", teamId)
        .order("updated_at", { ascending: false }).limit(1).single(),
      supabase.from("loans").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("status", "active"),
      supabase.from("transfer_windows")
        .select("board_negotiation_state")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      // S-02c · Hent 5 board-medlemmer for teamet (kan være tom hvis baseline-fasen)
      supabase.from("team_board_members")
        .select("archetype_key, selection_kind, alignment_score, is_chairman, assigned_at")
        .eq("team_id", teamId)
        .order("alignment_score", { ascending: false }),
    ]);

    if (seasonRes.error && !isMissingRow(seasonRes.error)) return res.status(500).json({ error: seasonRes.error.message });
    if (teamRes.error) return res.status(500).json({ error: teamRes.error.message });
    if (ridersRes.error) return res.status(500).json({ error: ridersRes.error.message });
    if (boardsRes.error) return res.status(500).json({ error: boardsRes.error.message });
    if (standingRes.error && !isMissingRow(standingRes.error)) return res.status(500).json({ error: standingRes.error.message });
    if (loansRes.error) return res.status(500).json({ error: loansRes.error.message });
    if (windowRes.error && !isMissingRow(windowRes.error)) return res.status(500).json({ error: windowRes.error.message });
    // S-02c · membersRes må ikke fejle, men tabellen kan være null indtil migration kører
    const teamBoardMembers = !membersRes?.error && Array.isArray(membersRes?.data)
      ? membersRes.data : [];

    const allBoards = boardsRes.data || [];
    const activeSeason = seasonRes.data || null;
    const boardNegotiationState = windowRes.data?.board_negotiation_state ?? "locked";
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

    // S-02a: Sæson 1 baseline = window 'locked' og kun baseline-rows i board_profiles.
    // Når window er locked, har manager ingen plans at signe (bestyrelsen observerer).
    // Per-team-fremdrift udledes stadig af row-eksistens — window-state er global lås.
    const PLAN_SEQUENCE = ["5yr", "3yr", "1yr"];
    const realPlanBoards = allBoards.filter(b => b.plan_type !== "baseline");
    const baselineBoard = allBoards.find(b => b.plan_type === "baseline" || b.is_baseline) || null;
    const isBaselinePhase = boardNegotiationState === "locked" && Boolean(baselineBoard);

    const setupNextPlanType = isBaselinePhase
      ? null
      : (PLAN_SEQUENCE.find(pt => !realPlanBoards.find(b => b.plan_type === pt)) || null);

    // Build per-plan data — kun for rigtige plan-typer (1yr/3yr/5yr), ikke baseline.
    const plans = {};
    for (const planType of PLAN_SEQUENCE) {
      const board = realPlanBoards.find(b => b.plan_type === planType) || null;

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

      // S-02d · Hent cumulative kontekst-felter for de 7 nye mål-typer.
      // Best-effort — hvis loaderen fejler, returneres outlook uden de nye
      // metrics (graceful degradation, eksisterende mål påvirkes ikke).
      let goalContext = {};
      if (activeSeason?.id) {
        try {
          goalContext = await loadGoalContextForBoard({
            supabase,
            teamId,
            boardId: board.id,
            currentSeasonId: activeSeason.id,
            division: currentStanding?.division ?? null,
            // #54 · Afgræns cumulative + u25-baseline til den aktuelle plan-cyklus.
            planStartSeasonNumber: board.plan_start_season_number,
          });
        } catch (e) {
          console.warn(`[board/status] loadGoalContextForBoard failed for board ${board.id}:`, e?.message);
        }
      }

      // #979 · Cumulative wins = afsluttede sæsoner (board.cumulative_*) + indeværende
      // sæsons in-progress wins (currentStanding.*). board.cumulative_* persisteres FØRST
      // ved season-end (economyEngine.processTeamSeasonEnd), så uden currentStanding ville
      // 3yr/5yr-delmålene vise 0 midt i sæsonen. Beregnes én gang og genbruges til både
      // outlook-evaluering og det returnerede cumulative_stats-display, så de ikke kan drifte
      // fra hinanden (præcis den inkonsistens der var root cause for #979).
      const cumulativeStageWins = (board.cumulative_stage_wins || 0) + (currentStanding?.stage_wins || 0);
      const cumulativeGcWins = (board.cumulative_gc_wins || 0) + (currentStanding?.gc_wins || 0);

      const outlook = buildBoardOutlook({
        board,
        standing: currentStanding,
        team: currentTeam,
        context: {
          activeLoanCount,
          planStartSponsorIncome: board.plan_start_sponsor_income,
          currentSponsorIncome: teamRes.data?.sponsor_income ?? SPONSOR_INCOME_BASE,
          planDuration,
          seasonsCompleted: workingSeasonIndex,
          hasSeasonData: Boolean(currentStanding),
          isExpired,
          recentSnapshots: boardSnapshots.slice(-3).reverse(),
          cumulativeStats: {
            stageWins: cumulativeStageWins,
            gcWins: cumulativeGcWins,
          },
          ...goalContext,
          // S-02c · Lad outlook vælge dominant_member + pr-mål reactions
          assignedMembers: teamBoardMembers,
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
            // S-02g · Window-blokering + mid-cycle-låsning context.
            // raceDaysLeft = absolute, planDuration/seasonsCompleted bruges
            // af 5yr/3yr-mid-cycle-guard, satisfactionDeltaPct = abs(current-50)
            // som proxy for "hvor langt er vi fra plan-start-baseline 50".
            raceDaysLeft: activeSeason
              ? Math.max(0, (activeSeason.race_days_total ?? 0) - (activeSeason.race_days_completed ?? 0))
              : null,
            planDuration,
            seasonsCompleted,
            satisfactionDeltaPct: Math.abs((board.satisfaction ?? 50) - 50),
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
          stage_wins: cumulativeStageWins,
          gc_wins: cumulativeGcWins,
        },
        snapshots: boardSnapshots,
        is_expired: isExpired,
        // #915 · Gen-forhandling låst når sæsonen er for langt fremme — frontend
        // skjuler "Forny"-knappen så låsen ikke kun håndhæves server-side.
        renew_locked: getBoardRenegotiationLock({ board, activeSeason }).locked,
        outlook,
        request_status: {
          supported: boardRequestsSupported,
          used_this_season: requestUsedThisSeason,
          latest_request: boardRequestsSupported ? serializeBoardRequest(latestRequest) : null,
        },
        request_options: requestOptions,
      };
    }

    // S-02b · Annotér eksisterende 5yr-mål med identity-feeding-rationale så BoardPage
    // kan rendere "Bygger paa din franske kerne"-badge på allerede signede planer.
    const identityBasis = teamRes.data?.season_1_identity_basis || null;
    if (identityBasis && plans["5yr"]?.board?.current_goals) {
      const fiveYrGoals = typeof plans["5yr"].board.current_goals === "string"
        ? JSON.parse(plans["5yr"].board.current_goals)
        : plans["5yr"].board.current_goals;
      plans["5yr"].board.current_goals = (fiveYrGoals || []).map((goal) =>
        annotateGoalWithIdentityBasis(goal, identityBasis)
      );
    }

    // S-02c · Decorér team_board_members med arketype-data så frontend kan rendere
    // avatar-grid uden at importere boardArchetypes på frontend-side.
    const teamMembersDecorated = decorateTeamBoardMembers(teamBoardMembers);

    // S-02e · Aktive konsekvenser (lag 2-6) — frontend renderer
    // BoardConsequencesPanel og BonusOfferCard på baggrund af denne liste.
    let activeConsequences = [];
    try {
      activeConsequences = await getActiveConsequencesForTeam(supabase, req.team.id);
    } catch (e) {
      console.warn(`[board/status] getActiveConsequencesForTeam failed:`, e?.message);
    }
    const bonusOffer = activeConsequences.find((c) => c.layer === 6) || null;

    // S-02f · Klub-DNA: returnér current valgt DNA + suggestions hvis ikke valgt.
    // Suggestions kun relevante når identity_basis findes (sæson 2+) og DNA endnu
    // ikke valgt. AI/bank/frozen får ikke vist DNA-card (men api.js returnerer
    // allerede 404 før vi når hertil for non-manager teams).
    const teamDnaKey = teamRes.data?.team_dna_key || null;
    const dnaArchetype = teamDnaKey ? getDnaByKey(teamDnaKey) : null;
    const dnaSuggestions = !teamDnaKey && identityBasis && !isBaselinePhase
      ? computeDnaSuggestions(identityBasis)
      : [];

    res.json({
      plans,
      setup_next_plan_type: setupNextPlanType,
      board_negotiation_state: boardNegotiationState,
      is_baseline_phase: isBaselinePhase,
      team: teamRes.data,
      team_members: teamMembersDecorated,
      riders: ridersRes.data || [],
      standing: currentStanding,
      identity_profile: identityProfile,
      identity_basis: identityBasis,
      team_dna: dnaArchetype ? {
        key: dnaArchetype.key,
        label: dnaArchetype.label,
        label_key: `dna.${dnaArchetype.key}.label`,
        emoji: dnaArchetype.emoji,
        short_description: dnaArchetype.short_description,
        short_description_key: `dna.${dnaArchetype.key}.shortDescription`,
        long_description: dnaArchetype.long_description,
        long_description_key: `dna.${dnaArchetype.key}.longDescription`,
        chosen_at: teamRes.data?.team_dna_chosen_at || null,
        // #102 · "Hvad vægter dette board?"-panel: eksponér DNA'ets mål-vægtning
        // (referencedata, ikke følsomt) så frontenden kan vise de højest-vægtede
        // måltyper. Multiplikator > 1.0 = boostet, < 1.0 = nedtonet.
        goal_weighting: dnaArchetype.goal_weighting || {},
      } : null,
      dna_suggestions: dnaSuggestions,
      active_loans_count: activeLoanCount,
      season: activeSeason ? {
        id: activeSeason.id,
        number: activeSeason.number,
        race_days_completed: activeSeason.race_days_completed ?? 0,
        race_days_total: activeSeason.race_days_total ?? null,
      } : null,
      auto_accept: {
        threshold_race_days: 5,
        race_days_completed: activeSeason?.race_days_completed ?? 0,
        race_days_left: Math.max(0, 5 - (activeSeason?.race_days_completed ?? 0)),
      },
      request_support: {
        supported: boardRequestsSupported,
        active_season_number: activeSeason?.number ?? null,
      },
      active_consequences: activeConsequences,
      bonus_offer: bonusOffer,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// S-02e · Bonus-offer accept/decline (lag 6).
// Accept: krediterer 200K + tilføjer ekstra-mål til 1yr-board's current_goals.
// Decline: markerer row 'declined' uden side-effects.
router.post("/board/bonus-offer/accept", requireAuth, boardWriteLimiter, async (req, res) => {
  try {
    if (!req.team?.id) return res.status(404).json({ error: "No team" });
    const { offer_id } = req.body || {};
    if (!offer_id) return res.status(400).json({ error: "offer_id kræves" });

    const result = await acceptBonusOffer({ supabase, teamId: req.team.id, offerId: offer_id });
    if (!result.ok) {
      return res.status(404).json({ error: "Tilbud ikke fundet eller allerede behandlet" });
    }

    // #805 · Board test-mode: tilbuddet markeres accepteret + ekstra-mål tilføjes
    // (UI-flowet bevares), men ingen rigtige penge krediteres → ingen
    // BOARD_BONUS_ACCEPTED finance_transactions-row i test-perioden.
    const boardTestMode = await isBoardTestModeActive(supabase);

    // Krediter holdets balance via samme finance-kontrakt som sponsor (type='bonus').
    const { data: team } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    if (team && !boardTestMode) {
      const { data: activeSeason } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
      // Slice 07c: balance + finance_transactions atomic via RPC.
      // 07d Fase B: api-actor — manager accepterer bonus-tilbud.
      await incrementBalanceWithAudit(supabase, {
        teamId: req.team.id,
        delta: result.bonus_amount,
        payload: {
          type: "bonus",
          amount: result.bonus_amount,
          description: `Bestyrelsens bonus-tilbud accepteret (mod ekstra-mål: ${result.extra_goal.label})`,
          season_id: activeSeason?.id ?? null,
          actor_type: FINANCE_ACTOR_TYPE.API,
          actor_id: req.user.id,
          source_path: "api.board.bonusOffer.accept",
          reason_code: FINANCE_REASON.BOARD_BONUS_ACCEPTED,
          related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
          related_entity_id: activeSeason?.id ?? null,
        },
      });
    }

    // Tilføj ekstra-mål til 1yr-board's current_goals.
    if (result.source_board_id) {
      const { data: oneYrBoard } = await supabase
        .from("board_profiles")
        .select("id, current_goals, plan_type")
        .eq("team_id", req.team.id)
        .eq("plan_type", "1yr")
        .eq("negotiation_status", "completed")
        .maybeSingle();

      if (oneYrBoard) {
        const existingGoals = typeof oneYrBoard.current_goals === "string"
          ? JSON.parse(oneYrBoard.current_goals)
          : (oneYrBoard.current_goals || []);
        const extraGoal = {
          type: result.extra_goal.type,
          target: result.extra_goal.target,
          cumulative: false,
          source: "bonus_offer",
          label: result.extra_goal.label,
        };
        const updatedGoals = [...existingGoals, extraGoal];
        await supabase.from("board_profiles")
          .update({ current_goals: JSON.stringify(updatedGoals), updated_at: new Date().toISOString() })
          .eq("id", oneYrBoard.id);
      }
    }

    res.json({
      success: true,
      bonus_amount: boardTestMode ? 0 : result.bonus_amount,
      extra_goal: result.extra_goal,
      test_mode: boardTestMode,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/board/bonus-offer/decline", requireAuth, boardWriteLimiter, async (req, res) => {
  try {
    if (!req.team?.id) return res.status(404).json({ error: "No team" });
    const { offer_id } = req.body || {};
    if (!offer_id) return res.status(400).json({ error: "offer_id kræves" });

    const result = await declineBonusOffer({ supabase, teamId: req.team.id, offerId: offer_id });
    if (!result.ok) {
      return res.status(404).json({ error: "Tilbud ikke fundet eller allerede behandlet" });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// S-02f · Klub-DNA endpoints (master-roadmap line 183-190).
// Suggestions hentes når manageren skal vælge i sæson 2; choose persisterer valget.
// AI/bank/frozen får aldrig DNA — checkes via req.team meta her.
router.get("/board/dna-suggestions", requireAuth, async (req, res) => {
  try {
    if (!req.team?.id) return res.status(404).json({ error: "No team" });
    if (req.team?.is_ai || req.team?.is_bank || req.team?.is_frozen) {
      return res.status(403).json({ error: "DNA er kun for manager-hold" });
    }

    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id, season_1_identity_basis, team_dna_key")
      .eq("id", req.team.id)
      .single();
    if (teamError) return res.status(500).json({ error: teamError.message });

    if (team.team_dna_key) {
      const dna = getDnaByKey(team.team_dna_key);
      return res.json({
        already_chosen: true,
        team_dna: dna ? {
          key: dna.key,
          label: dna.label,
          label_key: `dna.${dna.key}.label`,
          emoji: dna.emoji,
          short_description: dna.short_description,
          short_description_key: `dna.${dna.key}.shortDescription`,
        } : null,
        suggestions: [],
      });
    }

    if (!team.season_1_identity_basis) {
      return res.json({
        already_chosen: false,
        identity_basis_missing: true,
        suggestions: [],
      });
    }

    const suggestions = computeDnaSuggestions(team.season_1_identity_basis);
    res.json({
      already_chosen: false,
      identity_basis_missing: false,
      suggestions,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/board/dna-choose", requireAuth, boardWriteLimiter, async (req, res) => {
  try {
    if (!req.team?.id) return res.status(404).json({ error: "No team" });
    if (req.team?.is_ai || req.team?.is_bank || req.team?.is_frozen) {
      return res.status(403).json({ error: "DNA er kun for manager-hold" });
    }

    const { dna_key } = req.body || {};
    if (!isValidDnaKey(dna_key)) {
      return res.status(400).json({ error: "Ukendt DNA-nøgle" });
    }

    let result;
    try {
      result = await chooseDnaForTeam({ supabase, teamId: req.team.id, dnaKey: dna_key });
    } catch (e) {
      // #678 Track 3: chooseDnaForTeam kaster player-facing danske beskeder
      // (sæson-1-gate, allerede-valgt). Propagér errorCode/errorParams så
      // frontend resolveApiError kan vise EN-tekst for engelske spillere.
      const body = { error: e.message };
      if (e.code) body.code = e.code;
      if (e.errorCode) body.errorCode = e.errorCode;
      if (e.errorParams) body.errorParams = e.errorParams;
      return res.status(e.status || 500).json(body);
    }

    const dna = getDnaByKey(result.dnaKey);
    res.json({
      ok: true,
      team_dna: dna ? {
        key: dna.key,
        label: dna.label,
        label_key: `dna.${dna.key}.label`,
        emoji: dna.emoji,
        short_description: dna.short_description,
        short_description_key: `dna.${dna.key}.shortDescription`,
        long_description: dna.long_description,
        long_description_key: `dna.${dna.key}.longDescription`,
      } : null,
      team_members: decorateTeamBoardMembers(result.members || []),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/board/proposal", requireAuth, boardWriteLimiter, async (req, res) => {
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
    if (requiresBoardDnaChoice(context.team)) {
      return res.status(409).json({
        error: "Klub-DNA skal vælges før bestyrelsesplanen kan forhandles",
        code: "BOARD_DNA_REQUIRED",
        errorCode: "board_dna_required_plan",
      });
    }
    const board = context.boards.find(b => b.plan_type === plan_type) || null;
    const proposal = buildBoardProposal({
      focus,
      planType: plan_type,
      team: context.team,
      riders: context.riders,
      standing: context.standing,
      board,
      identityBasis: context.team?.season_1_identity_basis ?? null,
      dnaKey: context.team?.team_dna_key ?? null,
      // S-02g · Anvend deferred tradeoff-stramning fra forrige sæsons approved request.
      // Påvirker target+label på min_u25_riders/min_national_riders eller sponsor_growth.
      tradeoffPayload: board?.tradeoff_payload ?? null,
    });

    res.json({ ok: true, ...proposal, tradeoff_applied: Boolean(board?.tradeoff_payload) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/board/sign — sign a new board plan contract
router.post("/board/sign", requireAuth, boardWriteLimiter, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const { focus, plan_type, goals, negotiations } = req.body || {};
    if (!focus || !plan_type) return res.status(400).json({ error: "Missing fields" });
    if (!isValidBoardPlanType(plan_type)) return res.status(400).json({ error: "Invalid plan_type" });
    if (!isValidBoardFocus(focus)) return res.status(400).json({ error: "Invalid focus" });

    const context = await loadBoardPlanningContext(teamId);
    const { activeSeason, boards, riders, standing, team } = context;
    if (requiresBoardDnaChoice(team)) {
      return res.status(409).json({
        error: "Klub-DNA skal vælges før bestyrelsesplanen kan signeres",
        code: "BOARD_DNA_REQUIRED",
        errorCode: "board_dna_required_sign",
      });
    }
    const existingBoard = boards.find(b => b.plan_type === plan_type) || null;

    // #915 · Bloker gen-forhandling af en allerede-signeret plan når sæsonen er
    // for langt fremme (≥50% kørt eller i slutfasen) — ellers kunne en manager
    // skifte til lettere mål lige før plan-evaluering. Første signering + fornyelse
    // af en udløbet/pending plan passerer (getBoardRenegotiationLock returnerer da
    // locked:false). Samme guard rammer /board/renew nedenfor.
    const signLock = getBoardRenegotiationLock({ board: existingBoard, activeSeason });
    if (signLock.locked) {
      return res.status(409).json({
        error: signLock.reason,
        code: signLock.code,
        errorCode: signLock.errorCode,
        errorParams: signLock.errorParams,
      });
    }

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
      identityBasis: team?.season_1_identity_basis ?? null,
      dnaKey: team?.team_dna_key ?? null,
      // S-02g · Tradeoff fra forrige sæsons approved request anvendes nu på den nye plan.
      tradeoffPayload: existingBoard?.tradeoff_payload ?? null,
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
      plan_start_sponsor_income: team?.sponsor_income ?? DEFAULT_SPONSOR_INCOME,
      seasons_completed: 0,
      cumulative_stage_wins: 0,
      cumulative_gc_wins: 0,
      season_id: activeSeason?.id ?? null,
      // S-02g · Plan-renewal nulstiller tradeoff (allerede anvendt) + MAJOR-pivot cool-down.
      // tradeoff_payload + tradeoff_active_until_season_id clears fordi stramningen
      // er bagt ind i finalGoals via buildBoardProposal. major_pivot_used_at clears
      // fordi en frisk plan = frisk cool-down (master-doc Q3).
      tradeoff_active_until_season_id: null,
      tradeoff_payload: null,
      major_pivot_used_at: null,
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

router.post("/board/request", requireAuth, boardWriteLimiter, async (req, res) => {
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
      // #678 Track 3: intern SQL/migration-instruktion må ALDRIG eksponeres til
      // spilleren. Log til ops og returnér en generisk, lokaliserbar besked.
      console.warn("[board/request] board_request_log-tabellen mangler — kør SQL-migrationen for board_request_log");
      return res.status(503).json({
        error: "Bestyrelsesfunktioner er ikke tilgængelige endnu",
        errorCode: "board_unavailable",
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
        currentSponsorIncome: team?.sponsor_income ?? SPONSOR_INCOME_BASE,
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
        // S-02g · Window-blokering + mid-cycle-låsning + tradeoff/pivot-tracking
        raceDaysLeft: activeSeason
          ? Math.max(0, (activeSeason.race_days_total ?? 0) - (activeSeason.race_days_completed ?? 0))
          : null,
        satisfactionDeltaPct: Math.abs((board.satisfaction ?? 50) - 50),
        activeSeasonId: activeSeason?.id ?? null,
      },
    });

    let updatedBoard = board;

    if (requestResult.updated_board) {
      // S-02g · Persist tradeoff_active_until_season_id + tradeoff_payload + major_pivot_used_at
      // sammen med focus + goals. Auto-accept + buildBoardProposal læser disse felter
      // ved næste plan-renewal og anvender stramning via applyTradeoffTighteningToGoals.
      const updatePayload = {
        focus: requestResult.updated_board.focus ?? board.focus,
        current_goals: requestResult.updated_board.current_goals ?? board.current_goals,
        updated_at: new Date().toISOString(),
      };
      if (requestResult.updated_board.tradeoff_active_until_season_id !== undefined
          || requestResult.updated_board.tradeoff_payload !== undefined) {
        updatePayload.tradeoff_active_until_season_id =
          requestResult.updated_board.tradeoff_active_until_season_id ?? null;
        updatePayload.tradeoff_payload =
          requestResult.updated_board.tradeoff_payload ?? null;
      }
      if (requestResult.updated_board.major_pivot_used_at !== undefined
          && requestResult.updated_board.major_pivot_used_at !== null) {
        updatePayload.major_pivot_used_at = requestResult.updated_board.major_pivot_used_at;
      }
      const { data: boardUpdate, error: boardUpdateError } = await supabase.from("board_profiles")
        .update(updatePayload)
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

router.post("/board/renew", requireAuth, boardWriteLimiter, async (req, res) => {
  try {
    const teamId = req.team?.id;
    if (!teamId) return res.status(404).json({ error: "No team" });

    const { plan_type } = req.body || {};
    if (!isValidBoardPlanType(plan_type)) {
      return res.status(400).json({ error: "Invalid plan_type" });
    }

    // #915 · Samme gen-forhandlings-lås som /board/sign: en aktiv, signeret plan
    // kan ikke sættes i renewal-tilstand midt i en igangværende sæson (≥50% kørt
    // eller slutfase) — ellers er /board/renew → /board/sign en omvej uden om
    // sign-guarden. Udløbne/pending planer + sæsonstart passerer.
    const { activeSeason, boards } = await loadBoardPlanningContext(teamId);
    const existingBoard = boards.find(b => b.plan_type === plan_type) || null;
    const renewLock = getBoardRenegotiationLock({ board: existingBoard, activeSeason });
    if (renewLock.locked) {
      return res.status(409).json({ error: renewLock.reason, code: renewLock.code });
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
router.post("/admin/beta/cancel-market", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, cancelled: await cancelBetaMarket(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-rosters — returner manager-ryttere til AI-hold
router.post("/admin/beta/reset-rosters", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, ...(await resetBetaRosters(supabase)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-balances — sæt balance = 800.000 på manager-holds
router.post("/admin/beta/reset-balances", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { clear_transactions = false } = req.body || {};
    res.json({ ok: true, ...(await resetBetaBalances(supabase, { clearTransactions: clear_transactions })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-divisions — sæt alle aktive managerhold tilbage til 3. division
router.post("/admin/beta/reset-divisions", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, divisions: await resetBetaDivisions(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-board — nulstil bestyrelsesprofiler til baseline
router.post("/admin/beta/reset-board", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, board_profiles: await resetBetaBoardProfiles(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/board/open-test — #805: åbn bestyrelsen for test med frosset
// økonomi. Atomisk: reset til baseline → onboarding (pending_5yr) → board_test_mode=true.
router.post("/admin/board/open-test", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json(await openBoardTestMode(supabase));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/board/open-live — #1062: åbn bestyrelsen LIVE med ægte økonomi.
// Samme onboarding-sti som open-test, men board_test_mode=false → konsekvenser virker.
router.post("/admin/board/open-live", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json(await openBoardLive(supabase));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/board/close-test — #805: idempotent rollback af test-tilstanden.
router.post("/admin/board/close-test", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json(await closeBoardTestMode(supabase));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/board/test-status — #805: nuværende test-tilstand til admin-UI.
router.get("/admin/board/test-status", requireAdmin, async (req, res) => {
  try {
    res.json({ board_test_mode: await isBoardTestModeActive(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-calendar — ryd løbskalender, resultater og standings
router.post("/admin/beta/reset-calendar", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, race_calendar: await resetBetaRaceCalendar(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-rider-history — slet rytter-handelshistorik (#104)
// Wipe'er auctions/transfers/swaps/leje-aftaler så ryttere starter fra ren tavle.
// Bevarer rider_watchlist, riders, teams, balancer m.m.
router.post("/admin/beta/reset-rider-history", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, rider_history: await resetBetaRiderHistory(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-transfer-archive — slet alt transfer-historik
router.post("/admin/beta/reset-transfer-archive", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, transfer_archive: await resetBetaTransferArchive(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-loans — slet aktive finanslån
router.post("/admin/beta/reset-loans", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, loans: await resetBetaLoans(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-notifications — ryd indbakke for alle managers
router.post("/admin/beta/reset-notifications", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, notifications: await resetBetaNotifications(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-seasons — ryd sæsoner
router.post("/admin/beta/reset-seasons", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, seasons: await resetBetaSeasons(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-manager-progress — nulstil XP og level
router.post("/admin/beta/reset-manager-progress", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, manager_progress: await resetBetaManagerProgress(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/reset-achievements — ryd manager-achievement unlocks
router.post("/admin/beta/reset-achievements", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    res.json({ ok: true, achievements: await resetBetaAchievements(supabase) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/beta/full-reset — komplet beta-reset-suite
router.post("/admin/beta/full-reset", requireAdmin, adminWriteLimiter, async (req, res) => {
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
