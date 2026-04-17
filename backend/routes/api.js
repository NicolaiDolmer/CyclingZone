/**
 * Cycling Zone Manager — Backend API Routes
 * ==========================================
 * Express router covering:
 *   /api/auctions   — create, bid, list, finalize
 *   /api/transfers  — list, offer, negotiate
 *   /api/teams      — team info, squad, finances
 *   /api/admin      — season, races, overrides
 */

import express from "express";
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
  createLoan,
  repayLoan,
  getLoanConfig,
  getTotalDebt,
} from "../lib/loanEngine.js";

// Load .env from backend root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const router = express.Router();


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

// Squad size limits per division
const SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
  3: { min: 8,  max: 10 },
};
const MIN_RIDERS_FOR_RACE = 8;

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
  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    message,
    related_id: relatedId,
  });
}

async function notifyTeamOwner(teamId, type, title, message, relatedId = null) {
  const { data: team } = await supabase
    .from("teams")
    .select("user_id")
    .eq("id", teamId)
    .single();
  if (team?.user_id) {
    await notify(team.user_id, type, title, message, relatedId);
  }
}

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
      status, extension_count, created_at,
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

  const { rider_id, starting_price, min_increment = 1 } = req.body;
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

  const price = starting_price || Math.max(rider.uci_points, 1);
  const calculatedEnd = calculateAuctionEnd(new Date());

  const { data: auction, error } = await supabase
    .from("auctions")
    .insert({
      rider_id,
      seller_team_id: req.team.id,
      starting_price: price,
      current_price: price,
      min_increment,
      calculated_end: calculatedEnd.toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Log to activity feed
  await logActivity("auction_started", {
    team_id: req.team.id,
    team_name: req.team.name,
    rider_id: rider.id,
    rider_name: `${rider.firstname} ${rider.lastname}`,
    amount: price,
  });

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
    .select("*, rider:rider_id(firstname, lastname)")
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
  if (amount < auction.current_price + auction.min_increment) {
    return res.status(400).json({
      error: `Minimum bid: ${auction.current_price + auction.min_increment}`,
    });
  }

  // Check team has enough balance
  if (req.team.balance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
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

// POST /api/auctions/:id/finalize — complete auction (called by cron)
router.post("/auctions/:id/finalize", requireAdmin, async (req, res) => {
  const { data: auction } = await supabase
    .from("auctions")
    .select("*, rider:rider_id(*)")
    .eq("id", req.params.id)
    .single();

  if (!auction) return res.status(404).json({ error: "Auction not found" });
  if (auction.status === "completed") {
    return res.status(400).json({ error: "Already completed" });
  }

  if (auction.current_bidder_id) {
    // Check squad size limit for buyer
    const { data: buyerTeam } = await supabase
      .from("teams").select("division").eq("id", auction.current_bidder_id).single();
    const buyerDiv = buyerTeam?.division || 3;
    const maxRiders = SQUAD_LIMITS[buyerDiv]?.max || 10;
    const { count: currentCount } = await supabase
      .from("riders").select("id", { count: "exact", head: true })
      .eq("team_id", auction.current_bidder_id);
    const { count: pendingCount } = await supabase
      .from("riders").select("id", { count: "exact", head: true })
      .eq("pending_team_id", auction.current_bidder_id);
    const totalAfter = (currentCount || 0) + (pendingCount || 0) + 1;

    if (totalAfter > maxRiders) {
      await supabase.from("auctions")
        .update({ status: "completed", actual_end: new Date().toISOString() })
        .eq("id", auction.id);
      await notifyTeamOwner(auction.current_bidder_id, "auction_lost",
        "Auktion annulleret — hold fuldt",
        `Dit hold (Div ${buyerDiv}) kan max have ${maxRiders} ryttere. ${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages.`,
        auction.id);
      return res.json({ success: false, reason: "squad_full" });
    }

    // Check transfer window
    const { data: tw } = await supabase
      .from("transfer_windows").select("status")
      .order("created_at", { ascending: false }).limit(1).single();
    const windowOpen = tw?.status === "open";

    // Transfer rider — immediately if window open, else set pending
    if (windowOpen) {
      await supabase.from("riders").update({
        team_id: auction.current_bidder_id,
        pending_team_id: null,
        salary: Math.ceil(auction.current_price * 0.1),
      }).eq("id", auction.rider.id);
    } else {
      await supabase.from("riders").update({
        pending_team_id: auction.current_bidder_id,
        salary: Math.ceil(auction.current_price * 0.1),
      }).eq("id", auction.rider.id);
    }

    // Deduct from buyer
    const { data: buyer } = await supabase
      .from("teams")
      .select("balance")
      .eq("id", auction.current_bidder_id)
      .single();

    await supabase.from("teams")
      .update({ balance: buyer.balance - auction.current_price })
      .eq("id", auction.current_bidder_id);

    // Credit seller — only if seller actually owned the rider (not AI/free agent)
    const sellerOwned = auction.rider?.team_id === auction.seller_team_id ||
                        (auction.rider && !auction.rider.team_id && auction.seller_team_id);
    const { data: seller } = await supabase
      .from("teams")
      .select("balance")
      .eq("id", auction.seller_team_id)
      .single();

    await supabase.from("teams")
      .update({ balance: seller.balance + auction.current_price })
      .eq("id", auction.seller_team_id);

    // Finance logs
    await supabase.from("finance_transactions").insert([
      {
        team_id: auction.current_bidder_id,
        type: "transfer_out",
        amount: -auction.current_price,
        description: `Købt ${auction.rider.firstname} ${auction.rider.lastname} på auktion`,
      },
      {
        team_id: auction.seller_team_id,
        type: "transfer_in",
        amount: auction.current_price,
        description: `Solgt ${auction.rider.firstname} ${auction.rider.lastname} på auktion`,
      },
    ]);

    // Notify winner and seller
    // Award XP
    const { data: winnerUser } = await supabase.from("teams").select("user_id").eq("id", auction.current_bidder_id).single();
    if (winnerUser) awardXP(winnerUser.user_id, "auction_won").catch(() => {});
    const { data: sellerUser } = await supabase.from("teams").select("user_id").eq("id", auction.seller_team_id).single();
    if (sellerUser) awardXP(sellerUser.user_id, "auction_sold").catch(() => {});

    await notifyTeamOwner(auction.current_bidder_id, "auction_won",
      "Du vandt auktionen! 🎉",
      `${auction.rider.firstname} ${auction.rider.lastname} er nu på dit hold for ${auction.current_price} pts`,
      auction.id);

    // Log to activity feed
    const { data: winnerTeam } = await supabase.from("teams").select("name").eq("id", auction.current_bidder_id).single();
    await logActivity("auction_won", {
      team_id: auction.current_bidder_id,
      team_name: winnerTeam?.name,
      rider_id: auction.rider.id,
      rider_name: `${auction.rider.firstname} ${auction.rider.lastname}`,
      amount: auction.current_price,
    });

    await notifyTeamOwner(auction.seller_team_id, "auction_won",
      "Auktion afsluttet",
      `${auction.rider.firstname} ${auction.rider.lastname} solgt for ${auction.current_price} pts`,
      auction.id);
  } else {
    // No bids — notify seller
    await notifyTeamOwner(auction.seller_team_id, "auction_lost",
      "Auktion udløb uden bud",
      `Ingen bød på ${auction.rider.firstname} ${auction.rider.lastname}`,
      auction.id);
  }

  await supabase.from("auctions").update({
    status: "completed",
    actual_end: new Date().toISOString(),
  }).eq("id", auction.id);

  res.json({ success: true });
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
      rider:rider_id(id, firstname, lastname, uci_points, is_u25,
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
  const { rider_id, offer_amount, message } = req.body;
  if (!rider_id || !offer_amount) return res.status(400).json({ error: "rider_id og offer_amount kræves" });

  const { data: rider } = await supabase
    .from("riders").select("id, team_id, firstname, lastname").eq("id", rider_id).single();
  if (!rider || !rider.team_id) return res.status(404).json({ error: "Rytter ikke fundet eller har intet hold" });
  if (rider.team_id === req.team.id) return res.status(400).json({ error: "Du kan ikke byde på din egen rytter" });

  // Check buyer balance
  if (offer_amount > req.team.balance)
    return res.status(400).json({ error: "Du har ikke råd til dette tilbud" });

  // Check squad size limits for buyer
  const buyerDiv = req.team.division || 3;
  const maxRiders = SQUAD_LIMITS[buyerDiv]?.max || 10;
  const { count } = await supabase.from("riders")
    .select("id", { count: "exact", head: true }).eq("team_id", req.team.id);
  if ((count || 0) + 1 > maxRiders)
    return res.status(400).json({ error: `Dit hold kan max have ${maxRiders} ryttere i Division ${buyerDiv}` });

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

  res.status(201).json(data);
});

// GET /api/transfers/my-offers — my sent and received offers
router.get("/transfers/my-offers", requireAuth, async (req, res) => {
  // Only return offers where this team is buyer OR seller
  // Other teams' offers on same rider are NOT visible
  const [sentRes, receivedRes] = await Promise.all([
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, uci_points, stat_bj, stat_sp, stat_tt, stat_fl),
        seller:seller_team_id(id, name)`)
      .eq("buyer_team_id", req.team.id)
      .not("status", "eq", "withdrawn")
      .order("updated_at", { ascending: false }),
    supabase.from("transfer_offers")
      .select(`id, offer_amount, counter_amount, status, round, message, created_at, updated_at,
        rider:rider_id(id, firstname, lastname, uci_points, stat_bj, stat_sp, stat_tt, stat_fl),
        buyer:buyer_team_id(id, name)`)
      .eq("seller_team_id", req.team.id)
      .not("status", "eq", "withdrawn")
      .order("updated_at", { ascending: false }),
  ]);
  res.json({ sent: sentRes.data || [], received: receivedRes.data || [] });
});

// PATCH /api/transfers/offers/:id — accept, reject, counter, or withdraw
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

  // ACCEPT — seller accepts buyer's offer
  if (action === "accept" && isSeller) {
    const price = offer.counter_amount || offer.offer_amount;
    const rider = offer.rider;

    // Verify buyer still has funds
    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", offer.buyer_team_id).single();
    if (!buyer || buyer.balance < price)
      return res.status(400).json({ error: "Køber har ikke råd" });

    // Transfer rider
    await supabase.from("riders").update({
      team_id: offer.buyer_team_id,
      salary: Math.ceil(price * 0.1),
    }).eq("id", rider.id);

    // Financial transactions
    const { data: seller } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    await supabase.from("teams").update({ balance: buyer.balance - price }).eq("id", offer.buyer_team_id);
    await supabase.from("teams").update({ balance: seller.balance + price }).eq("id", req.team.id);
    await supabase.from("finance_transactions").insert([
      { team_id: offer.buyer_team_id, type: "transfer_out", amount: -price,
        description: `Købt ${rider.firstname} ${rider.lastname} via transfer` },
      { team_id: req.team.id, type: "transfer_in", amount: price,
        description: `Solgt ${rider.firstname} ${rider.lastname} via transfer` },
    ]);

    // Close other pending offers on same rider
    await supabase.from("transfer_offers")
      .update({ status: "withdrawn" })
      .eq("rider_id", rider.id)
      .neq("id", offer.id)
      .eq("status", "pending");

    await supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", offer.id);

    // Log to activity feed
    const { data: sellerTeamData } = await supabase.from("teams").select("name").eq("id", req.team.id).single();
    await logActivity("transfer_accepted", {
      team_id: req.team.id,
      team_name: sellerTeamData?.name,
      rider_id: rider.id,
      rider_name: `${rider.firstname} ${rider.lastname}`,
      amount: price,
    });

    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_accepted",
      "Transfer accepteret! 🎉",
      `${rider.firstname} ${rider.lastname} er nu på dit hold for ${price.toLocaleString()} CZ$`, offer.id);

    return res.json({ success: true, action: "accepted", price });
  }

  // REJECT — seller rejects
  if (action === "reject" && isSeller) {
    await supabase.from("transfer_offers").update({ status: "rejected" }).eq("id", offer.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected",
      "Transfertilbud afvist",
      `Dit tilbud på ${offer.rider.firstname} ${offer.rider.lastname} blev afvist`, offer.id);
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
    return res.json({ success: true, action: "countered", counter_amount });
  }

  // ACCEPT COUNTER — buyer accepts seller's counteroffer
  if (action === "accept_counter" && isBuyer && offer.status === "countered") {
    const price = offer.counter_amount;
    const rider = offer.rider;
    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();
    if (!buyer || buyer.balance < price)
      return res.status(400).json({ error: "Du har ikke råd" });
    const { data: seller } = await supabase.from("teams").select("balance").eq("id", offer.seller_team_id).single();
    await supabase.from("riders").update({
      team_id: req.team.id, salary: Math.ceil(price * 0.1),
    }).eq("id", rider.id);
    await supabase.from("teams").update({ balance: buyer.balance - price }).eq("id", req.team.id);
    await supabase.from("teams").update({ balance: seller.balance + price }).eq("id", offer.seller_team_id);
    await supabase.from("finance_transactions").insert([
      { team_id: req.team.id, type: "transfer_out", amount: -price,
        description: `Købt ${rider.firstname} ${rider.lastname} via transfer` },
      { team_id: offer.seller_team_id, type: "transfer_in", amount: price,
        description: `Solgt ${rider.firstname} ${rider.lastname} via transfer` },
    ]);
    await supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", offer.id);
    await supabase.from("transfer_offers")
      .update({ status: "withdrawn" }).eq("rider_id", rider.id).neq("id", offer.id).eq("status", "pending");
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_accepted",
      "Transfer gennemført",
      `${req.team.name} accepterede dit modbud på ${rider.firstname} ${rider.lastname}`, offer.id);
    return res.json({ success: true, action: "accepted", price });
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

  // WITHDRAW — buyer withdraws offer
  if (action === "withdraw" && isBuyer) {
    await supabase.from("transfer_offers").update({ status: "withdrawn" }).eq("id", offer.id);
    return res.json({ success: true, action: "withdrawn" });
  }

  return res.status(400).json({ error: "Ugyldig handling" });
});

// POST /api/transfers/:id/offer — legacy route (listing-based offer)
router.post("/transfers/:id/offer", requireAuth, async (req, res) => {
  const { offer_amount, message } = req.body;
  const { data: listing } = await supabase
    .from("transfer_listings")
    .select("*, rider:rider_id(id, firstname, lastname, team_id)")
    .eq("id", req.params.id).single();
  if (!listing || listing.status !== "open")
    return res.status(404).json({ error: "Listing ikke fundet" });
  if (listing.seller_team_id === req.team.id)
    return res.status(400).json({ error: "Kan ikke byde på eget udbud" });
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

// POST /api/admin/approve-results — approve pending race result submission
router.post("/admin/approve-results", requireAdmin, async (req, res) => {
  const { pending_id } = req.body;
  if (!pending_id) return res.status(400).json({ error: "pending_id required" });
  const { data: sub } = await supabase.from("pending_race_results").select("race_id").eq("id", pending_id).single();
  if (!sub) return res.status(404).json({ error: "Submission not found" });
  const { data: rows } = await supabase.from("pending_race_result_rows")
    .select("*, rider:rider_id(team_id)").eq("pending_id", pending_id);
  if (!rows?.length) return res.status(400).json({ error: "No rows found" });
  const { data: prizes } = await supabase.from("prize_tables").select("*");
  const prizeMap = {};
  (prizes || []).forEach(p => { prizeMap[`${p.race_type}__${p.result_type}__${p.rank}`] = p.prize_amount; });
  const { data: race } = await supabase.from("races").select("race_type").eq("id", sub.race_id).single();
  const insertRows = [];
  const teamPrizes = {};
  for (const row of rows) {
    const prize = prizeMap[`${race?.race_type}__${row.result_type}__${row.rank}`] || 0;
    insertRows.push({ race_id: sub.race_id, rider_id: row.rider_id, result_type: row.result_type,
      rank: row.rank, stage_number: row.stage_number || 1, prize_money: prize, points_earned: prize });
    if (row.rider?.team_id && prize > 0)
      teamPrizes[row.rider.team_id] = (teamPrizes[row.rider.team_id] || 0) + prize;
  }
  await supabase.from("race_results").insert(insertRows);
  for (const [teamId, amount] of Object.entries(teamPrizes)) {
    const { data: t } = await supabase.from("teams").select("balance").eq("id", teamId).single();
    if (t) {
      await supabase.from("teams").update({ balance: t.balance + amount }).eq("id", teamId);
      await supabase.from("finance_transactions").insert({
        team_id: teamId, type: "prize_money", amount, description: "Præmiepenge fra løb",
      });
    }
  }
  res.json({ success: true, rows_imported: insertRows.length, teams_paid: Object.keys(teamPrizes).length });
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

// ── Admin: Seasons & Races ────────────────────────────────────────────────────

// GET /api/admin/finalize-expired-auctions — called by cron
router.post("/admin/finalize-expired-auctions", requireAdmin, async (req, res) => {
  const { data: expired } = await supabase
    .from("auctions")
    .select("id")
    .in("status", ["active", "extended"])
    .lt("calculated_end", new Date().toISOString());

  const results = [];
  for (const auction of (expired || [])) {
    try {
      const fakeReq = { params: { id: auction.id }, team: req.team, user: req.user };
      // Reuse finalize logic inline
      results.push(auction.id);
    } catch (e) { /* continue */ }
  }
  res.json({ finalized: results.length, results });
});


// ── Loan Routes ───────────────────────────────────────────────────────────────

// GET /api/loans/my — hent egne lån + konfiguration
router.get("/loans/my", requireAuth, async (req, res) => {
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

// POST /api/loans — optag nyt lån
router.post("/loans", requireAuth, async (req, res) => {
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

// POST /api/loans/:id/repay — betal rate på lån
router.post("/loans/:id/repay", requireAuth, async (req, res) => {
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

// GET /api/admin/season-end-preview/:seasonId — preview af sæsonafslutning
router.get("/admin/season-end-preview/:seasonId", requireAdmin, async (req, res) => {
  try {
    const { seasonId } = req.params;

    const [teamsRes, standingsRes, loansRes] = await Promise.all([
      supabase.from("teams")
        .select("id, name, balance, division, sponsor_income, board_profiles(satisfaction)")
        .eq("is_ai", false),
      supabase.from("season_standings").select("*").eq("season_id", seasonId),
      supabase.from("loans").select("team_id, amount_remaining, interest_rate").eq("status", "active"),
    ]);

    const teams = teamsRes.data || [];
    const standings = standingsRes.data || [];
    const loanData = loansRes.data || [];

    const preview = await Promise.all(teams.map(async team => {
      const standing = standings.find(s => s.team_id === team.id);
      const { data: riders } = await supabase.from("riders").select("salary").eq("team_id", team.id);
      const totalSalary = (riders || []).reduce((s, r) => s + (r.salary || 0), 0);
      const teamLoans = loanData.filter(l => l.team_id === team.id);
      const totalInterest = teamLoans.reduce((s, l) => s + Math.round(l.amount_remaining * l.interest_rate), 0);
      const board = team.board_profiles?.[0];
      const satisfaction = board?.satisfaction ?? 50;
      const sponsorModifier = satisfaction >= 80 ? 1.20 : satisfaction >= 50 ? 1.00 : 0.80;
      const nextSponsor = Math.round((team.sponsor_income || 0) * sponsorModifier);
      const balanceAfter = team.balance - totalSalary - totalInterest;
      const needsEmergencyLoan = balanceAfter < 0;

      const divStandings = standings
        .filter(s => s.division === team.division)
        .sort((a, b) => b.total_points - a.total_points);
      const rank = divStandings.findIndex(s => s.team_id === team.id) + 1;

      return {
        team_id: team.id,
        team_name: team.name,
        division: team.division,
        current_balance: team.balance,
        salary_deduction: totalSalary,
        loan_interest: totalInterest,
        balance_after: balanceAfter,
        needs_emergency_loan: needsEmergencyLoan,
        emergency_loan_amount: needsEmergencyLoan ? Math.abs(balanceAfter) : 0,
        board_satisfaction: satisfaction,
        next_season_sponsor: nextSponsor,
        total_points: standing?.total_points || 0,
        current_rank: rank || null,
      };
    }));

    res.json({ preview });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

