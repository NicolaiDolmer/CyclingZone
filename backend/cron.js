/**
 * Cycling Zone Manager — Scheduled Tasks (Cron)
 * ===============================================
 * Runs background jobs:
 *   - Every 60s: finalize expired auctions
 *   - Daily at 02:00: check debt interest warnings
 *
 * To run standalone:
 *   node cron.js
 *
 * Or integrate into server.js for single-process deployment.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __envdir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__envdir, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Auction Finalizer ────────────────────────────────────────────────────────

async function finalizeExpiredAuctions() {
  const now = new Date().toISOString();

  const { data: expired } = await supabase
    .from("auctions")
    .select(`id, current_price, seller_team_id, current_bidder_id,
      rider:rider_id(id, firstname, lastname)`)
    .in("status", ["active", "extended"])
    .lte("calculated_end", now);

  if (!expired?.length) return;

  console.log(`⚡ Finalizing ${expired.length} expired auctions...`);

  for (const auction of expired) {
    try {
      await finalizeAuction(auction);
    } catch (err) {
      console.error(`  ❌ Failed to finalize auction ${auction.id}:`, err.message);
    }
  }
}

async function finalizeAuction(auction) {
  const rider = auction.rider;

  if (auction.current_bidder_id) {
    // ── Winner found ──────────────────────────────────────────────────────────
    const price = auction.current_price;

    // Check buyer still has enough balance
    const { data: buyer } = await supabase
      .from("teams")
      .select("id, name, balance, user_id")
      .eq("id", auction.current_bidder_id)
      .single();

    if (!buyer || buyer.balance < price) {
      // Buyer can't afford — cancel auction
      await supabase.from("auctions")
        .update({ status: "cancelled", actual_end: new Date().toISOString() })
        .eq("id", auction.id);

      await notifyUser(buyer?.user_id, "auction_lost",
        "Auktion annulleret",
        `Du havde ikke råd til ${rider.firstname} ${rider.lastname}. Saldo: ${buyer?.balance || 0} pts`);

      await notifyTeamOwner(auction.seller_team_id, "auction_lost",
        "Auktion annulleret",
        `Køber manglede balance. ${rider.firstname} ${rider.lastname} returneret.`);
      return;
    }

    // Transfer rider
    await supabase.from("riders").update({
      team_id: auction.current_bidder_id,
      salary: Math.max(1, Math.ceil(price * 0.10)),
    }).eq("id", rider.id);

    // Deduct from buyer
    await supabase.from("teams")
      .update({ balance: buyer.balance - price })
      .eq("id", auction.current_bidder_id);

    // Credit seller
    const { data: seller } = await supabase
      .from("teams").select("balance").eq("id", auction.seller_team_id).single();
    await supabase.from("teams")
      .update({ balance: seller.balance + price })
      .eq("id", auction.seller_team_id);

    // Finance logs
    await supabase.from("finance_transactions").insert([
      {
        team_id: auction.current_bidder_id,
        type: "transfer_out",
        amount: -price,
        description: `Købt ${rider.firstname} ${rider.lastname} på auktion`,
      },
      {
        team_id: auction.seller_team_id,
        type: "transfer_in",
        amount: price,
        description: `Solgt ${rider.firstname} ${rider.lastname} på auktion`,
      },
    ]);

    // Notifications
    await notifyTeamOwner(auction.current_bidder_id, "auction_won",
      `${rider.firstname} ${rider.lastname} er din! 🎉`,
      `Du vandt auktionen for ${price.toLocaleString()} pts`);

    await notifyTeamOwner(auction.seller_team_id, "auction_won",
      "Auktion afsluttet",
      `${rider.firstname} ${rider.lastname} solgt for ${price.toLocaleString()} pts`);

    console.log(`  ✅ ${rider.firstname} ${rider.lastname} → team ${buyer.name} for ${price} pts`);

  } else {
    // ── No bids ───────────────────────────────────────────────────────────────
    await notifyTeamOwner(auction.seller_team_id, "auction_lost",
      "Auktion udløb",
      `Ingen bød på ${rider.firstname} ${rider.lastname}`);

    console.log(`  ➖ No bids for ${rider.firstname} ${rider.lastname}`);
  }

  // Mark completed
  await supabase.from("auctions").update({
    status: "completed",
    actual_end: new Date().toISOString(),
  }).eq("id", auction.id);
}

// ─── Debt Warnings ────────────────────────────────────────────────────────────

async function checkDebtWarnings() {
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, balance, user_id")
    .eq("is_ai", false)
    .lt("balance", 0);

  for (const team of teams || []) {
    const interest = Math.round(Math.abs(team.balance) * 0.10);
    await notifyUser(team.user_id, "board_update",
      "⚠️ Negativ saldo",
      `Dit hold skylder ${Math.abs(team.balance).toLocaleString()} pts. Renter ved sæsonafslutning: ${interest.toLocaleString()} pts`);
  }

  if (teams?.length) {
    console.log(`  ⚠️  Debt warnings sent to ${teams.length} teams`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function notifyTeamOwner(teamId, type, title, message) {
  const { data: team } = await supabase
    .from("teams").select("user_id").eq("id", teamId).single();
  if (team?.user_id) await notifyUser(team.user_id, type, title, message);
}

async function notifyUser(userId, type, title, message) {
  if (!userId) return;
  await supabase.from("notifications").insert({ user_id: userId, type, title, message });
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startCron() {
  console.log("⏱  Cron jobs started");

  // Every 60 seconds: finalize auctions
  setInterval(async () => {
    try {
      await finalizeExpiredAuctions();
    } catch (err) {
      console.error("Cron error (auctions):", err.message);
    }
  }, 60 * 1000);

  // Every 6 hours: check debt
  setInterval(async () => {
    try {
      await checkDebtWarnings();
    } catch (err) {
      console.error("Cron error (debt):", err.message);
    }
  }, 6 * 60 * 60 * 1000);

  // Run immediately on start
  finalizeExpiredAuctions();
}

// ── Standalone mode ──────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("cron.js")) {
  startCron();
  console.log("Running in standalone cron mode. Ctrl+C to stop.");
}
