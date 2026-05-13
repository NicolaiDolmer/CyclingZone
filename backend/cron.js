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
import { getMarketPauseState, isAuctionsBlocked } from "./lib/marketPause.js";
import {
  notifyTeamOwner as notifyTeamOwnerShared,
  notifyUser as notifyUserShared,
} from "./lib/notificationService.js";
import { notifyAuctionWon, getDefaultWebhook, sendWebhook } from "./lib/discordNotifier.js";
import { processDeadlineDayCron } from "./lib/deadlineDayReport.js";
import { processSquadEnforcementCron } from "./lib/squadEnforcement.js";
import { createEmergencyLoan } from "./lib/loanEngine.js";
import { processBoardAutoAcceptCron } from "./lib/boardAutoAccept.js";
import { processMidSeasonReviewCron } from "./lib/boardMidSeason.js";
const __envdir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__envdir, '../.env'), quiet: true });

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
  // Skip finalization while auctions are paused — otherwise frozen auctions whose
  // calculated_end is past would silently finalize before the admin resumes the market.
  // On resume, /api/admin/market/resume shifts calculated_end forward by the pause duration.
  const pauseState = await getMarketPauseState(supabase);
  if (isAuctionsBlocked(pauseState.level)) return;

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

// ─── Deadline Day ─────────────────────────────────────────────────────────────

async function runDeadlineDayCron() {
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: (args) => notifyTeamOwnerShared({ supabase, ...args }),
    sendDiscordWebhookFn: sendWebhook,
    getDefaultWebhookFn: getDefaultWebhook,
    now: new Date(),
  });
  if (result.warnings) {
    console.log(`📣 Deadline Day: ${result.warnings} advarsel(er) afsendt`);
  }
  if (result.whistleSent) {
    console.log("🏁 Deadline Day: Final Whistle-rapport sendt til Discord");
  }
}

// ─── Board Auto-Accept (S-02b) ──────────────────────────────────────────────
// Tjek alle human teams for pending board-planer + send T-3/T-1 reminders +
// auto-accept ved race_days_completed >= 5. Notif-dedup (24h) gør cron idempotent.

async function runBoardAutoAcceptCron() {
  try {
    const result = await processBoardAutoAcceptCron({
      supabase,
      notifyUser: (args) => notifyUserShared({ supabase, ...args }),
      now: new Date(),
    });
    if (result.reminders_sent || result.auto_accepted || result.errors) {
      console.log(
        `🪑 Board auto-accept: ${result.teams_checked} hold tjekket — ${result.reminders_sent} reminders, ${result.auto_accepted} auto-accepted, ${result.errors} fejl`
      );
    }
  } catch (err) {
    console.error("Cron error (board auto-accept):", err.message);
  }
}

// ─── Board Mid-Season Review (S-02g) ────────────────────────────────────────
// Når race_days_completed krydser midpoint (= floor(race_days_total/2)) tjekker cron
// hver human team. Hvis satisfaction <50 ELLER ≥50% mål 'behind' → fyrer board_critical-banner.
// Idempotens: per-board-per-season notif-dedupe via title-match + related_id.

async function runMidSeasonReviewCron() {
  try {
    const result = await processMidSeasonReviewCron({
      supabase,
      notifyUser: (args) => notifyUserShared({ supabase, ...args }),
      now: new Date(),
    });
    if (result.banners_sent || result.errors) {
      console.log(
        `📣 Mid-season review: ${result.teams_checked} hold tjekket — ${result.banners_sent} banner(e) sendt, ${result.errors} fejl`
      );
    }
  } catch (err) {
    console.error("Cron error (mid-season review):", err.message);
  }
}

// ─── Squad Enforcement ───────────────────────────────────────────────────────

async function runSquadEnforcementCron() {
  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner,
    createEmergencyLoanFn: createEmergencyLoan,
    now: new Date(),
    onError: ({ teamId, error }) => {
      console.error(`  ❌ Squad enforcement failed for team ${teamId}:`, error.message);
    },
  });
  if (result.claimed) {
    console.log(`🛂 Squad enforcement: window ${result.windowId} — ${result.enforced} hold håndhævet`);
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

  // Every 5 minutes: deadline day warnings + final whistle
  setInterval(async () => {
    try {
      await runDeadlineDayCron();
    } catch (err) {
      console.error("Cron error (deadline day):", err.message);
    }
  }, 5 * 60 * 1000);

  // Every 5 minutes: squad enforcement (kun aktiv på lukkede vinduer der ikke er enforced)
  setInterval(async () => {
    try {
      await runSquadEnforcementCron();
    } catch (err) {
      console.error("Cron error (squad enforcement):", err.message);
    }
  }, 5 * 60 * 1000);

  // Every 6 hours: check debt
  setInterval(async () => {
    try {
      await checkDebtWarnings();
    } catch (err) {
      console.error("Cron error (debt):", err.message);
    }
  }, 6 * 60 * 60 * 1000);

  // Every 30 minutes: board auto-accept reminders + auto-accept (S-02b).
  // Notif-dedup (24h) sikrer ingen spam selv ved hyppig polling.
  setInterval(runBoardAutoAcceptCron, 30 * 60 * 1000);

  // Every 30 minutes: board mid-season review (S-02g).
  // Per-board-per-season dedupe (eksplicit notification-tabel-tjek) gør cron idempotent.
  setInterval(runMidSeasonReviewCron, 30 * 60 * 1000);

  // Run immediately on start
  finalizeExpiredAuctions();
  runBoardAutoAcceptCron();
  runMidSeasonReviewCron();
}

// ── Standalone mode ──────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("cron.js")) {
  startCron();
  console.log("Running in standalone cron mode. Ctrl+C to stop.");
}
