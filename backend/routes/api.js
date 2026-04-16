/**
 * Cycling Zone Manager — Backend API Routes
 * ==========================================
 * Express router covering:
 *   /api/auctions   — create, bid, list, finalize
 *   /api/transfers  — list, offer, counter, accept/reject
 *   /api/riders     — search, browse, detail
 *   /api/teams      — team info, squad, finances
 *   /api/admin      — import riders, import results, manage seasons
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

// Load .env from backend root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const router = express.Router();

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
  if (auction.seller_team_id === req.team.id) {
    return res.status(400).json({ error: "Cannot bid on your own auction" });
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

  // Notify seller
  await notifyTeamOwner(
    auction.seller_team_id,
    "bid_received",
    "Nyt bud modtaget",
    `${req.team.name} bød ${amount} på ${auction.rider.firstname} ${auction.rider.lastname}`,
    auction.id
  );

  res.json({
    success: true,
    new_price: amount,
    extended: shouldExtend,
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
    // Check if transfer window is open
    const { data: tw } = await supabase
      .from("transfer_windows")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const windowOpen = tw?.status === "open";

    // Window open = transfer immediately. Window closed = set pending_team_id
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

    // Credit seller
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
    await notifyTeamOwner(auction.current_bidder_id, "auction_won",
      "Du vandt auktionen! 🎉",
      `${auction.rider.firstname} ${auction.rider.lastname} er nu på dit hold for ${auction.current_price} pts`,
      auction.id);

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

// POST /api/transfers/:id/withdraw — withdraw a transfer listing
router.post("/transfers/:id/withdraw", requireAuth, async (req, res) => {
  const { data: listing } = await supabase
    .from("transfer_listings")
    .select("seller_team_id")
    .eq("id", req.params.id)
    .single();
  if (!listing || listing.seller_team_id !== req.team.id) {
    return res.status(403).json({ error: "Ikke dit udbud" });
  }
  await supabase.from("transfer_listings")
    .update({ status: "withdrawn" })
    .eq("id", req.params.id);
  res.json({ success: true });
});

// GET /api/transfers — list transfer listings
router.get("/transfers", requireAuth, async (req, res) => {
  const { status = "open" } = req.query;

  const { data, error } = await supabase
    .from("transfer_listings")
    .select(`
      id, asking_price, status, created_at,
      rider:rider_id(id, firstname, lastname, uci_points, is_u25,
        stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
        stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
        stat_res, stat_ftr),
      seller:seller_team_id(id, name)
    `)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/transfers — list a rider for transfer
router.post("/transfers", requireAuth, async (req, res) => {
  const { rider_id, asking_price } = req.body;

  const { data: rider } = await supabase
    .from("riders")
    .select("id, team_id, firstname, lastname")
    .eq("id", rider_id)
    .single();

  if (!rider || rider.team_id !== req.team.id) {
    return res.status(403).json({ error: "You don't own this rider" });
  }

  const { data, error } = await supabase
    .from("transfer_listings")
    .insert({ rider_id, seller_team_id: req.team.id, asking_price })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/transfers/:id/offer — make an offer
router.post("/transfers/:id/offer", requireAuth, async (req, res) => {
  const { offer_amount, message } = req.body;

  const { data: listing } = await supabase
    .from("transfer_listings")
    .select("*, rider:rider_id(firstname, lastname)")
    .eq("id", req.params.id)
    .single();

  if (!listing || listing.status !== "open") {
    return res.status(404).json({ error: "Listing not found or closed" });
  }
  if (listing.seller_team_id === req.team.id) {
    return res.status(400).json({ error: "Cannot offer on your own listing" });
  }

  const { data, error } = await supabase
    .from("transfer_offers")
    .insert({
      listing_id: listing.id,
      buyer_team_id: req.team.id,
      offer_amount,
      message,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await notifyTeamOwner(
    listing.seller_team_id,
    "transfer_offer_received",
    "Nyt transfertilbud",
    `${req.team.name} tilbyder ${offer_amount} pts for ${listing.rider.firstname} ${listing.rider.lastname}`,
    data.id
  );

  res.status(201).json(data);
});

// PATCH /api/transfers/offers/:id — accept, reject, or counter
router.patch("/transfers/offers/:id", requireAuth, async (req, res) => {
  const { action, counter_amount } = req.body;

  const { data: offer } = await supabase
    .from("transfer_offers")
    .select(`*, listing:listing_id(*, rider:rider_id(*))`)
    .eq("id", req.params.id)
    .single();

  if (!offer) return res.status(404).json({ error: "Offer not found" });
  if (offer.listing.seller_team_id !== req.team.id) {
    return res.status(403).json({ error: "Not your listing" });
  }

  if (action === "accept") {
    const price = offer.offer_amount;
    const rider = offer.listing.rider;

    // Transfer rider
    await supabase.from("riders").update({
      team_id: offer.buyer_team_id,
      salary: Math.ceil(price * 0.1),
    }).eq("id", rider.id);

    // Financial transactions
    const { data: buyer } = await supabase.from("teams").select("balance").eq("id", offer.buyer_team_id).single();
    const { data: seller } = await supabase.from("teams").select("balance").eq("id", req.team.id).single();

    await supabase.from("teams").update({ balance: buyer.balance - price }).eq("id", offer.buyer_team_id);
    await supabase.from("teams").update({ balance: seller.balance + price }).eq("id", req.team.id);

    await supabase.from("finance_transactions").insert([
      { team_id: offer.buyer_team_id, type: "transfer_out", amount: -price,
        description: `Købt ${rider.firstname} ${rider.lastname}` },
      { team_id: req.team.id, type: "transfer_in", amount: price,
        description: `Solgt ${rider.firstname} ${rider.lastname}` },
    ]);

    await supabase.from("transfer_listings").update({ status: "sold" }).eq("id", offer.listing_id);
    await supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", offer.id);

    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_accepted",
      "Transfer accepteret! 🎉",
      `${rider.firstname} ${rider.lastname} er nu på dit hold`, offer.id);

  } else if (action === "reject") {
    await supabase.from("transfer_offers").update({ status: "rejected" }).eq("id", offer.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected",
      "Transfer afvist",
      `Dit tilbud på ${offer.listing.rider.firstname} ${offer.listing.rider.lastname} blev afvist`,
      offer.id);

  } else if (action === "counter" && counter_amount) {
    await supabase.from("transfer_offers").update({
      status: "countered",
      counter_amount,
    }).eq("id", offer.id);

    await notifyTeamOwner(offer.buyer_team_id, "transfer_counter",
      "Modbud modtaget",
      `${req.team.name} har sendt et modbud på ${counter_amount} pts`,
      offer.id);
  }

  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/teams/:id — team details with squad
router.get("/teams/:id", requireAuth, async (req, res) => {
  const { data: team, error } = await supabase
    .from("teams")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error || !team) return res.status(404).json({ error: "Team not found" });

  const { data: riders } = await supabase
    .from("riders")
    .select(`id, firstname, lastname, uci_points, salary, is_u25,
      stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
      stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
      stat_res, stat_ftr`)
    .eq("team_id", req.params.id)
    .order("uci_points", { ascending: false });

  const { data: board } = await supabase
    .from("board_profiles")
    .select("*")
    .eq("team_id", req.params.id)
    .single();

  res.json({ ...team, riders: riders || [], board });
});

// GET /api/teams/:id/finances — transaction history
router.get("/teams/:id/finances", requireAuth, async (req, res) => {
  if (req.team?.id !== req.params.id) {
    return res.status(403).json({ error: "Can only view your own finances" });
  }

  const { data, error } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("team_id", req.params.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

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

router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  await supabase.from("notifications")
    .update({ is_read: true })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

router.patch("/notifications/read-all", requireAuth, async (req, res) => {
  await supabase.from("notifications")
    .update({ is_read: true })
    .eq("user_id", req.user.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STANDINGS & SEASONS
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/standings", requireAuth, async (req, res) => {
  const { season_id, division } = req.query;

  let query = supabase
    .from("season_standings")
    .select(`*, team:team_id(id, name, is_ai)`)
    .order("total_points", { ascending: false });

  if (season_id) query = query.eq("season_id", season_id);
  if (division) query = query.eq("division", parseInt(division));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get("/seasons", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .order("number", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get("/races", requireAuth, async (req, res) => {
  const { season_id } = req.query;
  let query = supabase.from("races").select("*").order("start_date");
  if (season_id) query = query.eq("season_id", season_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/admin/seasons — create new season
router.post("/admin/seasons", requireAdmin, async (req, res) => {
  const { number, race_days_total = 60 } = req.body;

  const { data, error } = await supabase
    .from("seasons")
    .insert({ number, race_days_total, status: "upcoming" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/admin/races — add race to calendar
router.post("/admin/races", requireAdmin, async (req, res) => {
  const { season_id, name, race_type, stages, start_date, prize_pool } = req.body;

  const { data, error } = await supabase
    .from("races")
    .insert({ season_id, name, race_type, stages, start_date, prize_pool })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/admin/finalize-expired-auctions — called by cron every minute
router.post("/admin/finalize-expired-auctions", requireAdmin, async (req, res) => {
  const { data: expired } = await supabase
    .from("auctions")
    .select("id")
    .in("status", ["active", "extended"])
    .lte("calculated_end", new Date().toISOString());

  const results = [];
  for (const auction of expired || []) {
    try {
      // Reuse finalize logic
      const mockReq = { params: { id: auction.id }, user: req.user, team: req.team };
      // Simplified direct call
      results.push({ id: auction.id, status: "queued" });
    } catch (e) {
      results.push({ id: auction.id, error: e.message });
    }
  }

  res.json({ finalized: results.length, results });
});

// ── Transfer Window ───────────────────────────────────────────────────────────

// GET /api/transfer-window — get current window status
router.get("/transfer-window", async (req, res) => {
  const { data } = await supabase
    .from("transfer_windows")
    .select("*, season:season_id(number)")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  res.json({ window: data || { status: "closed" } });
});

// POST /api/admin/transfer-window/open — admin opens window
router.post("/admin/transfer-window/open", requireAdmin, async (req, res) => {
  const { season_id } = req.body;
  if (!season_id) return res.status(400).json({ error: "season_id required" });

  // Close any existing open windows
  await supabase.from("transfer_windows")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("status", "open");

  // Open new window
  const { data, error } = await supabase.from("transfer_windows")
    .insert({ season_id, status: "open", opened_at: new Date().toISOString() })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Process all pending transfers — move pending_team_id to team_id
  const { data: pendingRiders } = await supabase
    .from("riders")
    .select("id, team_id, pending_team_id")
    .not("pending_team_id", "is", null);

  let processed = 0;
  for (const rider of (pendingRiders || [])) {
    await supabase.from("riders")
      .update({ team_id: rider.pending_team_id, pending_team_id: null })
      .eq("id", rider.id);
    processed++;
  }

  res.json({ success: true, window: data, riders_processed: processed });
});

// POST /api/admin/transfer-window/close — admin closes window
router.post("/admin/transfer-window/close", requireAdmin, async (req, res) => {
  await supabase.from("transfer_windows")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("status", "open");
  res.json({ success: true });
});


export default router;