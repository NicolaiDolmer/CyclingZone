/**
 * Cycling Zone Manager — Scheduled Tasks (Cron)
 * ===============================================
 * Runs background jobs:
 *   - Every 60s: finalize expired auctions
 *   - Every 24h: check debt interest warnings (statisk message → dedup-safe, #607)
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
import { processSeasonAutoTransitionCron } from "./lib/seasonAutoTransition.js";
import { createEmergencyLoan } from "./lib/loanEngine.js";
import { processBoardAutoAcceptCron } from "./lib/boardAutoAccept.js";
import { processMidSeasonReviewCron } from "./lib/boardMidSeason.js";
import { processDailySeasonCountCheck } from "./lib/dailySeasonCountCheck.js";
import { captureException as sentryCapture } from "./lib/sentry.js";
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
// Cadence: 24h (#607). Tidligere 6h cadence + dynamisk balance i message bypassede
// notifyUser-dedup, så et team kunne få op til 4 warnings/døgn ved svingende saldo.
// Nu: statisk message + 24h cadence → garanteret én warning/døgn per team.
// UI viser den faktiske balance på Økonomi-siden.

export async function checkDebtWarnings({
  supabaseClient = supabase,
  now = new Date(),
  notifyUserFn = notifyUserShared,
} = {}) {
  const { data: teams } = await supabaseClient
    .from("teams")
    .select("id, name, balance, user_id")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .lt("balance", 0);

  let sent = 0;
  let errors = 0;
  for (const team of teams || []) {
    try {
      const result = await notifyUserFn({
        supabase: supabaseClient,
        userId: team.user_id,
        type: "board_update",
        title: "⚠️ Negativ saldo",
        message: "Dit hold har negativ saldo. Tjek Økonomi-siden for detaljer.",
        now,
      });
      if (result?.delivered) sent += 1;
    } catch (err) {
      errors += 1;
      console.error(`  ❌ debt warning failed for team ${team.id}:`, err.message);
    }
  }

  if (sent) console.log(`  ⚠️  Debt warnings sent to ${sent} teams`);
  if (errors) console.error(`  ❌ Debt warnings: ${errors} fejl (per-team try/catch isolerede)`);
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
  if (result.errors) {
    console.error(`❌ Deadline Day: ${result.errors} advarsel(er) fejlede (per-team try/catch isolerede)`);
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

// ─── Season Auto-Transition ──────────────────────────────────────────────────
// Når et vindue er fuldt-wrapped (status=closed, final whistle sendt, squad
// enforcement done), fyrer transitionToNextSeason automatisk. Sponsor lander
// ~5-15 min efter window-close.

async function runSeasonAutoTransitionCron() {
  try {
    const result = await processSeasonAutoTransitionCron({
      supabase,
      now: new Date(),
    });
    if (result.transitioned) {
      console.log(`🌅 Sæson-transition: sæson ${result.fromSeason} → ${result.toSeason} udført automatisk`);
    }
  } catch (err) {
    console.error("Cron error (season auto-transition):", err.message);
  }
}

// ─── Daily Season-Count Safety-Net ───────────────────────────────────────────
// Forward-guard mod gentagelse af incident 2026-05-21 (cron-loop fyrede 4
// transitions på 30 min). Hvis admin_log viser >1 sæson-transition per døgn
// → alert til Discord + Sentry. Pure read + notify, ingen DB-writes.

async function runDailySeasonCountCheck() {
  const result = await processDailySeasonCountCheck({
    supabase,
    now: new Date(),
    sendWebhookFn: sendWebhook,
    getDefaultWebhookFn: getDefaultWebhook,
    captureExceptionFn: sentryCapture,
  });
  if (result.alerted) {
    console.error(`🚨 Daily season-count check: ${result.transitionCount} transitions seneste 24h (>1 alert fyret)`);
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

// ─── In-flight tracking for graceful shutdown ────────────────────────────────
// SIGTERM (Railway-deploy) skal ikke afbryde en transition mid-tick. server.js
// kalder awaitCronsIdle() i sin SIGTERM-handler så processen venter til ticks
// er afsluttet før process.exit(0).

let cronInFlight = 0;

export function getCronInFlight() {
  return cronInFlight;
}

export async function awaitCronsIdle(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (cronInFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return cronInFlight === 0;
}

export function trackedTick(label, fn, deps = {}) {
  const capture = deps.captureException ?? sentryCapture;
  return async () => {
    cronInFlight++;
    try {
      await fn();
    } catch (err) {
      console.error(`Cron error (${label}):`, err.message);
      capture(err, { tags: { cron: label } });
    } finally {
      cronInFlight--;
    }
  };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startCron() {
  console.log("⏱  Cron jobs started");

  // Every 60 seconds: finalize auctions
  setInterval(trackedTick("auctions", finalizeExpiredAuctions), 60 * 1000);

  // Every 5 minutes: deadline day warnings + final whistle
  setInterval(trackedTick("deadline day", runDeadlineDayCron), 5 * 60 * 1000);

  // Every 5 minutes: squad enforcement (kun aktiv på lukkede vinduer der ikke er enforced)
  setInterval(trackedTick("squad enforcement", runSquadEnforcementCron), 5 * 60 * 1000);

  // Every 5 minutes: season auto-transition (kun fyrer når window er fuldt-wrapped).
  setInterval(trackedTick("season auto-transition", runSeasonAutoTransitionCron), 5 * 60 * 1000);

  // Every 24 hours: check debt (#607 — 6h → 24h. notifyUser-dedup virker nu da
  // message er statisk; matcher cadence-pattern fra processDailySeasonCountCheck).
  setInterval(trackedTick("debt", checkDebtWarnings), 24 * 60 * 60 * 1000);

  // Every 30 minutes: board auto-accept reminders + auto-accept (S-02b).
  // Notif-dedup (24h) sikrer ingen spam selv ved hyppig polling.
  setInterval(trackedTick("board auto-accept", runBoardAutoAcceptCron), 30 * 60 * 1000);

  // Every 30 minutes: board mid-season review (S-02g).
  // Per-board-per-season dedupe (eksplicit notification-tabel-tjek) gør cron idempotent.
  setInterval(trackedTick("board mid-season", runMidSeasonReviewCron), 30 * 60 * 1000);

  // Every 24 hours: daily season-count safety-net (forward-guard mod cron-loop).
  setInterval(trackedTick("daily season-count check", runDailySeasonCountCheck), 24 * 60 * 60 * 1000);

  // Run immediately on start
  trackedTick("auctions", finalizeExpiredAuctions)();
  trackedTick("board auto-accept", runBoardAutoAcceptCron)();
  trackedTick("board mid-season", runMidSeasonReviewCron)();
  trackedTick("daily season-count check", runDailySeasonCountCheck)();
}

// ── Standalone mode ──────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("cron.js")) {
  startCron();
  console.log("Running in standalone cron mode. Ctrl+C to stop.");
}
