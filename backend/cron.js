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
import { finalizeExpiredAuctions as finalizeExpiredAuctionsShared } from "./lib/auctionFinalization.js";
import {
  notifyTeamOwner as notifyTeamOwnerShared,
  notifyUser as notifyUserShared,
} from "./lib/notificationService.js";
import { notifyAuctionWon } from "./lib/discordNotifier.js";
const __envdir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__envdir, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const XP_REWARDS = {
  auction_won: 15,
  auction_sold: 10,
};

// ─── Auction Finalizer ────────────────────────────────────────────────────────

async function finalizeExpiredAuctions() {
  const results = await finalizeExpiredAuctionsShared({
    supabase,
    notifyTeamOwner,
    discordNotify: (args) => notifyAuctionWon(args).catch(() => {}),
    logActivity,
    awardXP: awardTeamOwnerXP,
    now: new Date(),
    onError: ({ auctionId, error }) => {
      console.error(`  ❌ Failed to finalize auction ${auctionId}:`, error.message);
    },
  });

  if (!results.length) return;

  console.log(`⚡ Finalized ${results.filter(result => result.ok).length}/${results.length} expired auctions`);
}

// ─── Debt Warnings ────────────────────────────────────────────────────────────

export async function checkDebtWarnings({
  supabaseClient = supabase,
  now = new Date(),
} = {}) {
  const { data: teams } = await supabaseClient
    .from("teams")
    .select("id, name, balance, user_id")
    .eq("is_ai", false)
    .lt("balance", 0);

  for (const team of teams || []) {
    const interest = Math.round(Math.abs(team.balance) * 0.10);
    await notifyUserShared({
      supabase: supabaseClient,
      userId: team.user_id,
      type: "board_update",
      title: "⚠️ Negativ saldo",
      message: `Dit hold skylder ${Math.abs(team.balance).toLocaleString()} pts. Renter ved sæsonafslutning: ${interest.toLocaleString()} pts`,
      now,
    });
  }

  if (teams?.length) {
    console.log(`  ⚠️  Debt warnings sent to ${teams.length} teams`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function awardUserXP(userId, action) {
  if (!userId || !XP_REWARDS[action]) return;
  const amount = XP_REWARDS[action];
  const { data: user, error } = await supabase
    .from("users")
    .select("xp, level")
    .eq("id", userId)
    .single();

  if (error || !user) return;

  const newXp = (user.xp || 0) + amount;
  const newLevel = Math.min(50, Math.floor(newXp / 100) + 1);

  await supabase.from("users").update({ xp: newXp, level: newLevel }).eq("id", userId);
  await supabase.from("xp_log").insert({ user_id: userId, amount, reason: action });
}

async function awardTeamOwnerXP(teamId, action) {
  if (!teamId) return;
  const { data: team, error } = await supabase
    .from("teams")
    .select("user_id")
    .eq("id", teamId)
    .single();

  if (error || !team?.user_id) return;
  await awardUserXP(team.user_id, action);
}

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
  } catch (error) {
    // Activity feed must never block auction finalization.
  }
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
