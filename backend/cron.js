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
  emitRaceResultNotifications, // #1952
  emitStageResultNotifications, // #2523
} from "./lib/notificationService.js";
import {
  notifyAuctionWon,
  notifyBoardUpdateDM,
  getDefaultWebhook,
  getResultWebhooks,
  sendWebhook,
  getBotToken,
  drainDiscordDmOutbox,
  getOpsWebhook,
  sendOpsWebhook,
} from "./lib/discordNotifier.js";
import { flushDmRunGuard } from "./lib/discordDmRateGuard.js"; // #2571
import { makeBoardDmNotifier } from "./lib/boardDmMirror.js"; // #2619
import { syncAllDivisionRoles } from "./lib/discordRoleSync.js";
import { processDeadlineDayCron } from "./lib/deadlineDayReport.js";
import { processSquadEnforcementCron } from "./lib/squadEnforcement.js";
import { processSeasonAutoTransitionCron } from "./lib/seasonAutoTransition.js";
import { SEASON_AUTO_TRANSITION_ENABLED } from "./lib/economyConstants.js";
import { createEmergencyLoan } from "./lib/loanEngine.js";
import { processBoardAutoAcceptCron } from "./lib/boardAutoAccept.js";
import { processMidSeasonReviewCron } from "./lib/boardMidSeason.js";
import { processDailySeasonCountCheck } from "./lib/dailySeasonCountCheck.js";
import { processDiscordBotTokenCheck } from "./lib/discordBotTokenCheck.js";
import { runTrainingSweep } from "./lib/trainingSweep.js";
import { runScoutSweep } from "./lib/scoutSweep.js";
import { runAcademyGraduationSweep } from "./lib/academyGraduationSweep.js";
import { runAutoPrizeSweep } from "./lib/autoPrizeSweep.js";
import { isAutoPrizeEnabled } from "./lib/autoPrizeFlag.js";
import { runStageScheduler } from "./lib/stageScheduler.js";
import { refreshRankingMatviewsSafe } from "./lib/refreshRankingMatviews.js";
import { takeGlobalRankWeeklySnapshotSafe } from "./lib/globalRankWeeklySnapshot.js";
import { isStageSchedulerEnabled } from "./lib/stageSchedulerFlag.js";
import { isRaceEngineV2Enabled } from "./lib/raceEngineFlag.js";
import { processStallWatchdog } from "./lib/stallWatchdog.js";
import { runAdminSimulateStage, buildRaceSimEmbed } from "./lib/adminSimulateRace.js";
import { makeEnsureSeasonStandings } from "./lib/seasonStandingsBootstrap.js";
import { updateStandings } from "./lib/economyEngine.js";
import { runStarterSquadHealSweep } from "./lib/starterSquadHealSweep.js";
import { runAcademyHealSweep } from "./lib/academyHealSweep.js";
import { runRiderDeriveHealSweep } from "./lib/riderDeriveHealSweep.js";
import { runAiTeamTrimHealSweep } from "./lib/aiTeamTrimHealSweep.js";
import { runRaceEntryGeneratorSweep } from "./lib/raceEntryGeneratorSweep.js";
import { runIntakeOfferExpirySweep } from "./lib/academyIntakeExpirySweep.js";
import { runSundayIntakeTick } from "./lib/sundayIntakeTick.js";
import { runBalanceDriftWatch } from "./lib/balanceDriftWatch.js";
import { runOwnershipInvariantWatch } from "./lib/ownershipInvariantWatch.js";
import { runEmailWelcomeSweep } from "./lib/emailWelcomeSweep.js"; // #2725
import { runEmailDay1Sweep } from "./lib/emailDay1Sweep.js"; // #2725
import { runEmailRaceDigestSweep } from "./lib/emailRaceDigestSweep.js"; // #2725
import { captureException as sentryCapture, monitorCron, captureCheckIn } from "./lib/sentry.js";
const __envdir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__envdir, "../.env"), quiet: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// #2077 — Sentry cron-monitor-configs. Udebliver et tick (proces død/deploy-hang)
// fyrer Sentry en MISSED-alarm ud fra schedulen; hænger et tick over maxRuntime
// regnes det TIMEOUT. #2389/B5: udvidet fra kun auto-prize/stage-scheduler til ALLE
// periodiske jobs — en cron der tavst holder op med at ticke var ellers usynlig
// indtil en spiller opdagede symptomet. Margins er rundhåndede: en Railway-deploy
// genstarter processen og nulstiller alle setInterval-timere.
//
// #2395 — failureIssueThreshold=2 på sub-døgn-jobs: en Railway-deploy tager
// processen ned længe nok til at et 5-min-tick misser sit check-in, og med Sentrys
// default-tærskel (1) blev HVER deploy til en byge af "missed check-in"-outage-issues
// på tværs af alle korte crons (12/7: 2 deploys → 20 falske issues). En ægte død cron
// misser check-in FLERE gange i træk → 2 fanger den stadig (10-20 min forsinkelse),
// mens en enkelt deploy-afbrydelse ties. Påvirker KUN monitor-heartbeat-issuet;
// ægte exceptions fra cron-logikken captures uændret via trackedTick/captureException.
const CRON_MONITOR_1MIN = {
  schedule: { type: "interval", value: 1, unit: "minute" },
  checkinMargin: 3,
  maxRuntime: 10,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
// #2440: checkinMargin 5→10. #2395 (threshold=2) dæmpede ÉN redeploy, men en
// deploy-KLYNGE (6 genstarter på 30 min, 12/7+13/7) ramte ~12 forskellige jobs på
// denne cadence samtidigt — hver genstart alene nåede stadig at bekræfte 1 miss
// (slot ved +interval+margin=10min var for stramt relativt til gentagne
// genstarter tættere end det), og NÆSTE genstart nåede at bekræfte miss #2 FØR
// boot-primingen (se primeCronMonitorCheckIns nedenfor) nåede at nulstille
// streaken → alarm. Margin=10 (slot bekræftes først ved +15min) giver rigelig
// buffer til at boot-primingen altid når at resette streaken FØRST ved typiske
// Railway-genstarts-gaps (~5-10 min i en klynge), mens en ægte død cron stadig
// alarmerer inden for 2×5+10=20 min (dokumenteret+testet i cron.deployGrace.test.js).
const CRON_MONITOR_5MIN = {
  schedule: { type: "interval", value: 5, unit: "minute" },
  checkinMargin: 10,
  maxRuntime: 15, // min før et in_progress-tick regnes TIMEOUT
  failureIssueThreshold: 2, // #2395: én deploy-miss alarmerer ikke; 2 i træk = ægte fejl
  timezone: "Etc/UTC",
};
const CRON_MONITOR_10MIN = {
  schedule: { type: "interval", value: 10, unit: "minute" },
  checkinMargin: 10,
  maxRuntime: 20,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
const CRON_MONITOR_30MIN = {
  schedule: { type: "interval", value: 30, unit: "minute" },
  checkinMargin: 15,
  maxRuntime: 30,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
const CRON_MONITOR_60MIN = {
  schedule: { type: "interval", value: 60, unit: "minute" },
  checkinMargin: 30,
  maxRuntime: 60,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
// 24h-ticks: margin 3 timer — setInterval-baseret døgn-rytme drifter med deploys,
// og en deploy-genstart + immediate-run checker ind længe før marginen rammes.
const CRON_MONITOR_24H = {
  schedule: { type: "interval", value: 1, unit: "day" },
  checkinMargin: 180,
  maxRuntime: 60,
  timezone: "Etc/UTC",
};

const XP_REWARDS = {
  auction_won: 15,
  auction_sold: 10,
};

// ─── Auction Finalizer ────────────────────────────────────────────────────────

async function finalizeExpiredAuctions() {
  // #2571: flush ved tick-start (ikke -slut) — så forrige tick's fire-and-forget
  // discordNotify-kald (se nedenfor) har haft ~60s til at lande, uden at vi
  // rører selve leverings-logikken (ingen ny await tilføjet i finalize-stien).
  flushDmRunGuard(["auction_won"]);

  // Skip finalization while auctions are paused — otherwise frozen auctions whose
  // calculated_end is past would silently finalize before the admin resumes the market.
  // On resume, /api/admin/market/resume shifts calculated_end forward by the pause duration.
  const pauseState = await getMarketPauseState(supabase);
  if (isAuctionsBlocked(pauseState.level)) return;

  const results = await finalizeExpiredAuctionsShared({
    supabase,
    notifyTeamOwner,
    // cronRun:true — se notifyAuctionWon i discordNotifier.js: dette er den ene
    // af to kaldere (den anden er admin-request-scopet finalize i routes/api.js,
    // som bevidst IKKE sætter cronRun).
    discordNotify: (args) => notifyAuctionWon({ ...args, cronRun: true }).catch(() => {}),
    logActivity,
    awardXP: awardTeamOwnerXP,
    now: new Date(),
    onError: ({ auctionId, error }) => {
      console.error(`  ❌ Failed to finalize auction ${auctionId}:`, error.message);
      // #1872: en fastlåst auktion kørte ~25 min i en cron-retry-loop uden alarm,
      // fordi denne sti tidligere kun console.error'ede. Surfacér nu i Sentry, så
      // en gentaget finalize-fejl opdages med det samme i stedet for tavst.
      sentryCapture(error, { tags: { cron: "auctions" }, extra: { auctionId } });
    },
  });

  if (!results.length) return;

  console.log(
    `⚡ Finalized ${results.filter((result) => result.ok).length}/${results.length} expired auctions`
  );
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
  captureExceptionFn = sentryCapture,
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
        // title/message er DA fallback for legacy rows + dedup-signatur (#607).
        // #678 Track 3: metadata.{titleCode, messageCode} driver locale-rendering
        // via NotificationsPage → renderBackendMessage, så engelske spillere ser
        // engelsk i stedet for den hardcodede danske streng.
        title: "⚠️ Negativ saldo",
        message: "Dit hold har negativ saldo. Tjek Økonomi-siden for detaljer.",
        metadata: {
          titleCode: "notif.debtWarning.title",
          messageCode: "notif.debtWarning.message",
        },
        now,
      });
      if (result?.delivered) sent += 1;
    } catch (err) {
      errors += 1;
      console.error(`  ❌ debt warning failed for team ${team.id}:`, err.message);
      if (captureExceptionFn) {
        captureExceptionFn(err, {
          tags: { cron: "debt-warnings" },
          extra: { teamId: team.id, userId: team.user_id },
        });
      }
    }
  }

  if (sent) console.log(`  ⚠️  Debt warnings sent to ${sent} teams`);
  if (errors) console.error(`  ❌ Debt warnings: ${errors} fejl (per-team try/catch isolerede)`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function notifyTeamOwner(teamId, type, title, message, relatedId = null, metadata = null) {
  await notifyTeamOwnerShared({
    supabase,
    teamId,
    type,
    title,
    message,
    relatedId,
    metadata,
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
  } catch {
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
    captureExceptionFn: sentryCapture,
    now: new Date(),
  });
  if (result.warnings) {
    console.log(`📣 Deadline Day: ${result.warnings} advarsel(er) afsendt`);
  }
  if (result.errors) {
    console.error(
      `❌ Deadline Day: ${result.errors} advarsel(er) fejlede (per-team try/catch isolerede)`
    );
  }
  if (result.whistleSent) {
    console.log("🏁 Deadline Day: Final Whistle-rapport sendt til Discord");
  }
}

// ─── Board Auto-Accept (S-02b) ──────────────────────────────────────────────
// Tjek alle human teams for pending board-planer + send T-3/T-1 reminders +
// auto-accept ved race_days_completed >= 5. Notif-dedup (24h) gør cron idempotent.

// In-app board notifier that also mirrors board_update/board_critical to a
// Discord DM (gated by the board_update pref). Shared by the board crons so the
// toggle governs every board reminder, not just some. DM is fire-and-forget.
// #2619: spejler kun til DM når in-app-notifikationen blev NYOPRETTET (ikke
// 24h-dedup-ramt) — ellers re-fyrede DM'en hvert 30-min-tick så længe holdet
// havde en pending plan (DM-spam hvis leveret, falsk 100%-skip-streak i
// #2571-guarden når modtageren var ulinket). Logik + test i lib/boardDmMirror.js.
const notifyUserWithBoardDM = makeBoardDmNotifier({
  notifyUser: notifyUserShared,
  notifyBoardUpdateDM,
  supabase,
});

async function runBoardAutoAcceptCron() {
  // #2571: begge board-DM-typer deles med runMidSeasonReviewCron (samme
  // underliggende risiko: resolveDmRecipient-datafejl for board-strømmen) —
  // se flushDmRunGuard-note i discordDmRateGuard.js for hvorfor et fælles
  // per-type-streak på tværs af de to board-crons er tilsigtet.
  flushDmRunGuard(["board_update", "board_critical"]);
  try {
    const result = await processBoardAutoAcceptCron({
      supabase,
      notifyUser: notifyUserWithBoardDM,
      captureExceptionFn: sentryCapture,
      now: new Date(),
    });
    if (result.reminders_sent || result.auto_accepted || result.errors) {
      console.log(
        `🪑 Board auto-accept: ${result.teams_checked} hold tjekket — ${result.reminders_sent} reminders, ${result.auto_accepted} auto-accepted, ${result.errors} fejl`
      );
    }
  } catch (err) {
    // #2389 A2: den ydre catch sluger top-level-fejl (window/season/teams-queries)
    // som processBoardAutoAcceptCron's interne per-team-catch aldrig ser — capture,
    // ellers når fejlen hverken Sentry eller trackedTick.
    console.error("Cron error (board auto-accept):", err.message);
    sentryCapture(err, { tags: { cron: "board auto-accept" } });
  }
}

// ─── Board Mid-Season Review (S-02g) ────────────────────────────────────────
// Når race_days_completed krydser midpoint (= floor(race_days_total/2)) tjekker cron
// hver human team. Hvis satisfaction <50 ELLER ≥50% mål 'behind' → fyrer board_critical-banner.
// Idempotens: per-board-per-season notif-dedupe via title-match + related_id.

async function runMidSeasonReviewCron() {
  // #2571: se flushDmRunGuard-kaldet i runBoardAutoAcceptCron ovenfor.
  flushDmRunGuard(["board_update", "board_critical"]);
  try {
    const result = await processMidSeasonReviewCron({
      supabase,
      notifyUser: notifyUserWithBoardDM,
      captureExceptionFn: sentryCapture,
      now: new Date(),
    });
    if (result.banners_sent || result.errors) {
      console.log(
        `📣 Mid-season review: ${result.teams_checked} hold tjekket — ${result.banners_sent} banner(e) sendt, ${result.errors} fejl`
      );
    }
  } catch (err) {
    // #2389 A2: mirror board auto-accept — top-level-fejl skal captures her.
    console.error("Cron error (mid-season review):", err.message);
    sentryCapture(err, { tags: { cron: "board mid-season" } });
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
      console.log(
        `🌅 Sæson-transition: sæson ${result.fromSeason} → ${result.toSeason} udført automatisk`
      );
    }
  } catch (err) {
    // #2389 A2: sæson-transition er det mest forretningskritiske flow i denne fil
    // (jf. incident 2026-05-21) — en fejl her var 100% usynlig i Sentry før nu.
    console.error("Cron error (season auto-transition):", err.message);
    sentryCapture(err, { tags: { cron: "season auto-transition" } });
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
    // #2077: alarm → privat ops-kanal m. @mention (var "general").
    sendWebhookFn: sendOpsWebhook,
    getDefaultWebhookFn: getOpsWebhook,
    captureExceptionFn: sentryCapture,
  });
  if (result.alerted) {
    console.error(
      `🚨 Daily season-count check: ${result.transitionCount} transitions seneste 24h (>1 alert fyret)`
    );
  }
}

// ─── Daily Discord bot-token safety-net ──────────────────────────────────────
// Person-rettede DMs sendes via bot-token, der kan rotere/komme ud af sync uden
// at nogen opdager det (2026-06-03: alle DMs fejlede tavst med openDm 401).
// Validerer token mod Discord + alerter via Sentry/webhook hvis ugyldigt.

async function runDiscordBotTokenCheck() {
  const result = await processDiscordBotTokenCheck({
    botToken: getBotToken(),
    // #2077: alarm → privat ops-kanal m. @mention (var "general").
    sendWebhookFn: sendOpsWebhook,
    getDefaultWebhookFn: getOpsWebhook,
    captureExceptionFn: sentryCapture,
    now: new Date(),
  });
  if (result.alerted) {
    console.error(`🚨 Discord bot-token check: ugyldigt/manglende token (status=${result.status ?? "n/a"})`);
  }
}

// ─── Discord DM-outbox drain (#1115) ─────────────────────────────────────────
// Retryable DM-fejl (429 fra Railways delte egress-IP, Discord 5xx, netværk)
// lander i discord_dm_outbox i stedet for at blive droppet. Denne cron prøver
// forfaldne rækker igen med eksponentiel backoff; opgivne rækker markeres dead
// + alarmeres via webhook/Sentry — så DM-død opdages i stedet for at fejle tavst.

async function runDiscordDmOutboxDrain() {
  const result = await drainDiscordDmOutbox({ now: new Date() });
  if (result.processed) {
    console.log(
      `📬 Discord DM-outbox: ${result.processed} behandlet — ${result.sent} sendt, ${result.rescheduled} replanlagt, ${result.dead} opgivet`
    );
  }
}

// ─── Discord division-role sync (#2153) ──────────────────────────────────────
// Spillet ejer sandheden om hvilken division/gruppe en spiller er i. Denne
// daglige reconcile holder Discord-gruppe-rollen i sync (op-/nedrykning, sæson-
// skift, nye links) uden manuelle reaction-roller. Idempotent + selv-helende.

async function runDiscordRoleSyncCron() {
  const botToken = getBotToken();
  if (!botToken) return; // token-mangel fanges af runDiscordBotTokenCheck
  const result = await syncAllDivisionRoles({ supabase, botToken });
  if (result.changed) {
    console.log(`🎭 Discord division-roller: ${result.changed} ændret (${result.synced} synket, ${result.skipped} sprunget over)`);
  }
}

// ─── Stall-watchdog (#2077) ──────────────────────────────────────────────────
// Fanger TAVSE stalls som exception-capture ikke ser: løb der er kørt men ikke
// finalized, forfaldne etaper uden resultater (m. reelt startfelt), completede løb
// med ubetalte præmier, og standings der hænger bag results. Alarm → ops-kanal +
// Sentry. Dedup pr. (check, løb, dag) via delt Set → ingen 30-min-spam.
const stallWatchdogSeenKeys = new Set();

async function runStallWatchdogCron() {
  const autoPrizeEnabled = await isAutoPrizeEnabled(supabase);
  const result = await processStallWatchdog({
    supabase,
    now: new Date(),
    sendWebhookFn: sendOpsWebhook,
    getOpsWebhookFn: getOpsWebhook,
    captureExceptionFn: sentryCapture,
    autoPrizeEnabled,
    seenKeys: stallWatchdogSeenKeys,
  });
  if (result.alerted) {
    console.error(`🚨 Stall-watchdog: ${result.newFindings.length} ny(e) tavs(e) stall(s) alarmeret`);
  }
}

// ─── Squad Enforcement ───────────────────────────────────────────────────────

async function runSquadEnforcementCron() {
  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner,
    createEmergencyLoanFn: createEmergencyLoan,
    captureExceptionFn: sentryCapture,
    now: new Date(),
    onError: ({ teamId, error }) => {
      console.error(`  ❌ Squad enforcement failed for team ${teamId}:`, error.message);
    },
  });
  if (result.claimed) {
    console.log(
      `🛂 Squad enforcement: window ${result.windowId} — ${result.enforced} hold håndhævet`
    );
  }
}

// ─── Daglig træning: assistent-sweep (#1305) ─────────────────────────────────

async function runTrainingSweepCron() {
  const result = await runTrainingSweep({ supabase, now: new Date() });
  if (result.swept) {
    console.log(`🚴 Trænings-sweep: ${result.swept} hold trænet af assistenten`);
  }
  if (result.failed) {
    console.error(`❌ Trænings-sweep: ${result.failed} hold fejlede (per-team try/catch isolerede)`);
    // #2389 A2: én aggregeret capture pr. tick (mirror entry-generator-mønstret) —
    // daglig træning er kerne-gameplay; systemiske fejl var usynlige i Sentry.
    sentryCapture(new Error(`training sweep: ${result.failed} hold fejlede`), {
      tags: { cron: "training sweep" },
      extra: { swept: result.swept, failed: result.failed },
    });
  }
}

// ─── Talentspejder: modner scout_assignments (missioner + målrettede opgaver) (#2244) ──
// Mirror af trænings-sweepen: kl. 22 dansk tid + team-niveau mutex (scout_sweep_runs).

async function runScoutSweepCron() {
  const result = await runScoutSweep({ supabase, now: new Date() });
  if (result.swept) {
    console.log(`🔭 Scout-sweep: ${result.swept} opgave(r) modnet`);
  }
  if (result.failed) {
    console.error(`❌ Scout-sweep: ${result.failed} opgave(r) fejlede (per-hold try/catch isolerede)`);
    // #2389 A2: aggregeret capture pr. tick (mirror entry-generator-mønstret).
    sentryCapture(new Error(`scout sweep: ${result.failed} opgaver fejlede`), {
      tags: { cron: "scout sweep" },
      extra: { swept: result.swept, failed: result.failed },
    });
  }
}

// ─── Akademi-graduering: auto-resolver udløbne pending graduates (#932) ───────

async function runGraduationSweepCron() {
  const result = await runAcademyGraduationSweep({ supabase, now: new Date() });
  if (result.resolved) {
    console.log(`🎓 Graduerings-sweep: ${result.resolved} akademiryttere auto-resolveret`);
  }
  if (result.failed) {
    console.error(`❌ Graduerings-sweep: ${result.failed} fejlede (per-rytter try/catch isolerede)`);
    // #2389 A2: aggregeret capture pr. tick (mirror entry-generator-mønstret).
    sentryCapture(new Error(`graduation sweep: ${result.failed} ryttere fejlede`), {
      tags: { cron: "graduation sweep" },
      extra: { resolved: result.resolved, failed: result.failed },
    });
  }
}

// ─── Start-trup heal: reparér nye hold hvis signup-allokeringen fejlede (#1563) ─
// Markør-gatet (starter_squad_allocated_at NULL) + alders-guard → rører kun hold
// hvis bootstrap fejlede, aldrig et hold der selv har solgt ned (ingen exploit).

async function runStarterSquadHealSweepCron() {
  const result = await runStarterSquadHealSweep({ supabase, now: new Date() });
  if (result.healed) {
    console.log(`🛟 Start-trup heal-sweep: ${result.healed} hold repareret (manglende start-trup)`);
  }
  if (result.failed) {
    console.error(`❌ Start-trup heal-sweep: ${result.failed} hold fejlede (per-team try/catch isolerede)`);
    // #2389 A2: fejler heal'en, står holdet med tom trup UDEN alarm — capture.
    sentryCapture(new Error(`starter-squad heal sweep: ${result.failed} hold fejlede`), {
      tags: { cron: "starter-squad heal sweep" },
      extra: { healed: result.healed, failed: result.failed, errors: result.errors },
    });
  }
}

// ─── Akademi-kuld heal: reparér nye hold hvis signup-seedingen fejlede (#1584) ──
// Markør-gatet (academy_intake_seeded_at NULL) + alders-guard → rører kun hold hvis
// deres første akademi-kuld-seeding fejlede (bevidst ikke-fatal ved signup), aldrig
// et hold der selv har brugt/afvist sine pladser (ingen gratis-kuld-exploit).

async function runAcademyHealSweepCron() {
  const result = await runAcademyHealSweep({ supabase, now: new Date() });
  if (result.healed) {
    console.log(`🎓 Akademi-kuld heal-sweep: ${result.healed} hold repareret (manglende første kuld)`);
  }
  if (result.failed) {
    console.error(`❌ Akademi-kuld heal-sweep: ${result.failed} hold fejlede (per-team try/catch isolerede)`);
    // #2389 A2: mirror starter-squad heal — en fejlende heal må ikke være tavs.
    sentryCapture(new Error(`academy heal sweep: ${result.failed} hold fejlede`), {
      tags: { cron: "academy heal sweep" },
      extra: { healed: result.healed, failed: result.failed, errors: result.errors },
    });
  }
}

// ─── Rytter-derive heal: re-deriver "strandede" ryttere (#1673) ──────────────
// RYTTER-data-gatet (ikke team-markør): finder aktive ryttere uden rider_derived_
// abilities-række ELLER med base_value NULL og re-deriver dem. Fanger strandede
// free agents OG ryttere på hold (hvor markør er sat) som starterSquad/academy-
// heal-sweepene strukturelt ikke kan se. Idempotent + deterministisk, ingen flag.

async function runRiderDeriveHealSweepCron() {
  const result = await runRiderDeriveHealSweep({ supabase });
  if (result.healed) {
    console.log(`🩺 Rytter-derive heal-sweep: ${result.healed} strandede ryttere re-derived (${result.remaining ?? 0} tilbage)`);
  }
}

// ─── AI-trim heal: fuldfør udskudte AI-hold-trims (#2187/#2377) ───────────────
// Markør-gatet (teams.pending_removal_at NOT NULL, kun is_ai=true) — rører kun
// AI-hold som removeAiTeams selv har udskudt pga. inflight-entries i et igangværende
// løb (#2269); ægte hold rammes aldrig. Uden denne sweep sad en pulje fast over
// 24-holds-target indtil et helt NYT signup i SAMME pulje tilfældigvis gav trimmet
// endnu en chance (sjældent — rod-årsagen til at Division 4 B/C blev hængende på 26).
// Persistente udskydelser (>48t, STALE_PENDING_HOURS) Sentry-alarmeres pr. hold —
// det er længere end noget realistisk etapeløb varer, så det signalerer et
// strukturelt problem, ikke bare "løbet er ikke færdigt endnu".

async function runAiTeamTrimHealSweepCron() {
  const result = await runAiTeamTrimHealSweep({ supabase, now: new Date() });
  if (result.healed) {
    console.log(`🧹 AI-trim heal-sweep: ${result.healed} udskudt(e) AI-hold trimmet (løb kørt færdigt siden sidst)`);
  }
  if (result.guard?.length) {
    // #2407: invariant-guarden greb ind — enten blev forældede markører ryddet
    // (pulje på/under target: en sletning ville have brudt 24-holds-invarianten,
    // #2377) eller en kandidat manglede pulje-kontekst (fail-closed). Begge dele
    // betyder at NOGET upstream har over-markeret (#2407 Fejl 1-regression) eller
    // at puljens tilstand har ændret sig — skal ses, ikke ties. Fast fingerprint:
    // ét Sentry-issue, ikke ét pr. hold pr. tick (CYCLINGZONE-31-lektien).
    console.warn(
      `🛡️ AI-trim heal-sweep: invariant-guard greb ind — ${result.cleared} forældet(e) markering(er) ryddet, ` +
      `${result.guard.length} guard-event(s) i alt (#2407)`
    );
    sentryCapture(new Error("AI-trim invariant-guard: sletning stoppet ved pulje-target (#2407)"), {
      tags: { cron: "ai-team-trim-heal" },
      fingerprint: ["ai-trim-invariant-guard"],
      extra: { cleared: result.cleared, guard: result.guard },
    });
  }
  if (result.failed) {
    console.error(`❌ AI-trim heal-sweep: ${result.failed} hold fejlede (per-hold try/catch isolerede)`);
    // #2389 A2: akutte per-hold-fejl (den stale-gren nedenfor dækker kun >48t).
    sentryCapture(new Error(`ai-trim heal sweep: ${result.failed} hold fejlede`), {
      tags: { cron: "ai-trim heal sweep" },
      extra: { healed: result.healed, failed: result.failed, errors: result.errors },
    });
  }
  if (result.stale?.length) {
    // #2434: ÉN aggregeret capture pr. tick med FAST fingerprint (før: én Error pr.
    // hold pr. tick → CYCLINGZONE-31 spammede 200+ events, 65 hold × 5-min-kadence).
    // stale[] er nu løbs-bevidst (blokerende løb selv stallet el. > backstop), ikke
    // ren alder >48t — så et lovligt kørende multi-dag etapeløb alarmerer ikke længere.
    const n = result.stale.length;
    console.error(
      `🚨 AI-trim heal-sweep: ${n} AI-hold reelt fastlåst (blokerende løb stallet el. > backstop) — se Sentry (#2187/#2434)`
    );
    sentryCapture(new Error("AI-trim persistent stall: AI-hold reelt fastlåst"), {
      tags: { cron: "ai-team-trim-heal" },
      fingerprint: ["ai-trim-persistent-stall"],
      extra: { count: n, teams: result.stale },
    });
  }
}

// ─── Entry-generator sweep (#2375) ───────────────────────────────────────────
// Rod-årsag: den proaktive entry-generator (raceEntryGenerator.js, #1810) kørte hidtil
// KUN ved sæson-transition. Løb oprettet/genskabt MIDT i en aktiv sæson (fx admin
// regenererer en pulje) fik derfor aldrig deltagere automatisk — Division 4-grupperne
// C-G stod med 0-entry-løb 10/7. Denne sweep kører generatoren periodisk for den
// aktive sæson, så et deploy/tick straks fylder ethvert hul. Idempotent (kun
// is_auto_filled=true rykkes, manuelle entries røres aldrig) + gated bag
// auto_entry_generator_enabled (fail-safe OFF, mirror auto-prize-sweepen nedenfor).

async function runRaceEntryGeneratorSweepCron() {
  const result = await runRaceEntryGeneratorSweep({ supabase });
  if (result.ran) {
    console.log(
      `🏁 Entry-generator sweep: sæson ${result.seasonId} — ${result.races} løb, ${result.teams} hold, ${result.generated} ønskede entries (${result.inserted ?? 0} indsat, ${result.removed ?? 0} fjernet, ${result.role_updated ?? 0} rolle-opdateret), ${result.skipped} sprunget over`
    );
  }
  // #2375-hotfix: generatoren isolerer nu fejl pr. (race,team)-enhed i stedet for at
  // kaste — én ødelagt enhed vælter ikke tick'et, men skal stadig ALARMERES, ellers
  // fejler den tavst hver time. Én samlet Sentry-capture pr. tick (ikke pr. enhed).
  if (result.ran && result.failed_units > 0) {
    console.error(
      `❌ Entry-generator sweep: ${result.failed_units} (løb,hold)-enhed(er) fejlede — ${(result.errors || []).join("; ")}`
    );
    sentryCapture(new Error(`entry-generator sweep: ${result.failed_units} failed units`), {
      tags: { cron: "entry-generator sweep" },
      extra: { errors: result.errors, seasonId: result.seasonId },
    });
  }
}

// ─── Akademi-intake-udløb (#2627) ─────────────────────────────────────────────
// Rod-årsag: 'offered'-tilbud har ingen udløbstid, så inaktive holds åbne tilbud
// akkumulerer og skjuler ryttere for HELE spillerbasen via is_offered_intake_rider
// (RLS). Sætter 'offered'-rækker ældre end INTAKE_OFFER_EXPIRY_DAYS (7) til
// 'expired' + resolved_at. Gated bag intake_offer_expiry_enabled (fail-safe OFF).
// Idempotent (WHERE status='offered' i UPDATE'en) → daglig cadence er nok.

async function runIntakeOfferExpirySweepCron() {
  const r = await runIntakeOfferExpirySweep({ supabase });
  if (r.ran && r.expired > 0) {
    console.log(`🎓 Intake-udløb: ${r.expired} 'offered'-tilbud sat til 'expired' (cutoff ${r.cutoff})`);
  }
}

// ─── Sunday Intake Drip (#2064 S0) ───────────────────────────────────────────
// Søndags-drip af akademi-kandidater. Modulet er selv søndags-gated + claim-
// idempotent, så timelig polling + boot-run er sikre.
async function runSundayIntakeTickCron() {
  try {
    const r = await runSundayIntakeTick({ supabase, now: new Date() });
    if (r.ran && r.candidates > 0) {
      console.log(`🎓 Søndags-drip: ${r.candidates} akademi-kandidater til ${r.teams} hold (${r.tickDate})`);
    }
    if (r.errors?.length) {
      console.error(`Søndags-drip delfejl (${r.errors.length}):`, r.errors.join("; "));
      sentryCapture(new Error(`sunday-intake-drip partial failures: ${r.errors.join("; ")}`), {
        tags: { cron: "sunday intake drip" },
      });
    }
  } catch (err) {
    console.error("Cron error (sunday intake drip):", err.message);
    sentryCapture(err, { tags: { cron: "sunday intake drip" } });
  }
}

// ─── Auto-prize: udbetal udestående præmier for completede løb (#WS1) ─────────
// Gated bag runtime-flag auto_prize_enabled (fail-safe OFF) — er flaget ikke tændt,
// returnerer sweep'en straks { skipped: "flag_off" } uden side-effekter.

async function runAutoPrizeSweepCron() {
  const r = await runAutoPrizeSweep({ supabase });
  if (r.paid > 0) {
    console.log(`💰 Auto-prize: ${r.paid} løb udbetalt (${r.total} CZ$)`);
  }
}

// ─── Stage-scheduler: afvikl forfaldne etaper én ad gangen (#WS1 Fase 3) ──────
// Gated bag stage_scheduler_enabled + race_engine_v2 (fail-safe OFF) + daglig cap
// (maks 5 etaper/dag). runStageFn = runAdminSimulateStage, så samme flag-/profil-/
// completed-guards som den manuelle admin-route gælder. Discord-embed (final-etape) =
// hele løbets race_results, hentet inde i simulateStageByIndex.

const ensureSeasonStandingsCron = makeEnsureSeasonStandings(supabase);

// #2090: overlap-guard. Under post-incident-catch-up 2/7 tog et tick >5 min →
// setInterval startede næste tick OVENI; hvert tick udvalgte løb ud fra sit eget
// forældede races-snapshot, og fordi runAdminSimulateStage kører "næste etape" ud
// fra frisk stages_completed, blev 10 etaper afviklet FØR deres scheduled_at
// (Volta Algarvia st2-3, Hauts Plateaux st8). Ét tick ad gangen — altid.
let stageSchedulerTickRunning = false;

// #2251: delt dedup på tværs af ticks (mirror stallWatchdogSeenKeys nedenfor) —
// et fastlåst løb ("No start list" — tyndt/tomt felt i lav-division) logges/captures
// kun ÉN gang pr. løb pr. dag i stedet for hvert 5-min-tick. #2389: Map (var Set) —
// {firstFailedAt, escalated} pr. nøgle driver eskalerings-capturen efter 3 timer.
const stageSchedulerSeenKeys = new Map();

async function runStageSchedulerCron() {
  if (stageSchedulerTickRunning) {
    console.log("⏭️ Stage-scheduler: forrige tick kører stadig — springer over (overlap-guard #2090)");
    return;
  }
  stageSchedulerTickRunning = true;
  try {
    const result = await runStageScheduler({
      supabase,
      now: new Date(),
      isStageSchedulerEnabled,
      isRaceEngineV2Enabled,
      seenKeys: stageSchedulerSeenKeys,
      runStageFn: async ({ raceId, stageIndex }) => {
        const notifyDiscord = async ({ race, resultRows, incidents }) => {
          const urls = await getResultWebhooks(race.league_division_id);
          if (!urls.length) return;
          const embed = buildRaceSimEmbed({ race, resultRows, incidents });
          for (const url of urls) {
            await sendWebhook(url, { embeds: [{ ...embed, footer: { text: "Cycling Zone" } }] });
          }
        };
        // #1952 · In-app resultat-notifikation til deltagende menneske-managers.
        const notifyInApp = async ({ race }) => {
          await emitRaceResultNotifications({ supabase, race });
        };
        // #2523 · Per-etape "din etape er kørt"-notifikation (mellem-etaper KUN —
        // se raceRunner.simulateStageByIndex's mellem-etape-gren for finalization-guarden).
        const notifyStageInApp = async ({ race, stageNumber, totalStages }) => {
          await emitStageResultNotifications({ supabase, race, stageNumber, totalStages });
        };
        return runAdminSimulateStage({
          supabase,
          raceId,
          dryRun: false,
          runSource: "scheduler", // FIX 4: kun scheduler-runs tæller i den daglige cap
          // #2090 defense-in-depth: løbet må KUN afvikle præcis den etape scheduleren
          // udvalgte som forfalden — er løbet imens bumpet af et andet run, 409'es der.
          expectedStageIndex: stageIndex,
          ensureSeasonStandings: ensureSeasonStandingsCron,
          updateStandings,
          notifyDiscord,
          notifyInApp,
          notifyStageInApp,
        });
      },
    });
    if (result.ran || result.errors || result.recovered) {
      console.log(`🚵 Stage-scheduler: ${result.ran} etape(r) afviklet, ${result.recovered || 0} finalization-recovery, ${result.errors} fejl`);
    }
  } finally {
    stageSchedulerTickRunning = false;
  }
}

// ─── Rangliste-matview refresh: fallback for race-finalization-hooken (#2175) ─
// rider_rankings_mv/team_standings_ext_mv/team_race_points_mv aggregerer fra
// race_results og refreshes primært ved race-finalization (raceRunner.js). Denne
// periodiske fallback fanger enhver misset refresh (fx en fejlet finalization-sti)
// + holder ranglisten fersk under et igangværende etapeløb (mellem-etaper). Best-
// effort i sig selv (refreshRankingMatviewsSafe sluger + logger fejl).
async function runRankingMatviewRefreshCron() {
  await refreshRankingMatviewsSafe(supabase);
}

// ─── Global Rank ugentligt bevægelses-snapshot (#2453) ────────────────────────
// Kaldes dagligt (samme tick-cadence som andre 24h-jobs), men RPC'en no-op'er
// selv medmindre >= 7 dage er gået siden seneste snapshot — effektivt ugentlig
// kadence uden en ny interval-bucket. Til "▲/▼ siden sidste uge"-pilene på
// /global-rank.
async function runGlobalRankWeeklySnapshotCron() {
  await takeGlobalRankWeeklySnapshotSafe(supabase);
}

// ─── Traffic-events retention: hold rå anonyme web-events ≤180 dage (#2040) ───
// traffic_events er bevidst PII-fri, men rå events skal ikke leve for evigt.
// Idempotent delete; service_role bypasser RLS.

async function runTrafficRetentionCron() {
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("traffic_events").delete().lt("occurred_at", cutoff);
  if (error) {
    // #2389 A2: vedvarende fejl her = GDPR-relevant rå-data ryddes aldrig op — alarm.
    console.error("  ❌ traffic_events retention fejlede:", error.message);
    sentryCapture(error, { tags: { cron: "traffic retention" } });
  }
}

// ─── Balance-drift-vagt (#2414) ───────────────────────────────────────────────
// Natlig: beregn gårsdagens dominans/varians-metrikker mod ÆGTE prod-resultater,
// persistér i race_balance_drift_daily, alarmér Discord ved 3+ dages bånd-brud.
// Read-only mod race_results/race_simulation_*/race_incidents (kun SELECT).

async function runBalanceDriftWatchCron() {
  await runBalanceDriftWatch({
    supabase,
    sendWebhookFn: sendOpsWebhook,
    getOpsWebhookFn: getOpsWebhook,
    captureExceptionFn: sentryCapture,
  });
}

// ─── Ownership-invariant-vagt (#2647) ─────────────────────────────────────────
// Daglig READ-ONLY safety-net mod gentagelse af incidenten 2026-07-18 (16
// hold-ejede ryttere endte på ungdomsauktioner). Tre invarianter der aldrig må
// være sande: (A) hold-ejet rytter på aktiv/extended ungdomsauktion, (B) hold-
// ejet rytter på en aktiv/extended sælgerløs ikke-ungdomsauktion, (C) stale
// 'offered' academy_intake-række for en allerede-ejet rytter. Pure read +
// Sentry-notify, ingen writes.

async function runOwnershipInvariantWatchCron() {
  const result = await runOwnershipInvariantWatch({
    supabase,
    captureExceptionFn: sentryCapture,
    now: new Date(),
  });
  if (result.alerted) {
    console.error(
      `🚨 Ownership-invariant-vagt: brud fundet — youthOwned=${result.findings.youthOwned}, ` +
      `sellerlessOwned=${result.findings.sellerlessOwned}, staleIntake=${result.findings.staleIntake} (#2647)`
    );
  }
}

// ─── Email retention-loop (#2725) ─────────────────────────────────────────────
// Ships DORMANT: alle tre sweeps no-op'er internt (isEmailLoopActive/
// isEmailLoopEnabled fail-safe OFF) indtil ejeren har godkendt e-mail-teksterne
// og flipper app_config.email_loop_enabled off → dry_run → on. Ingen af
// nedenstående funktioner sender en rigtig e-mail før flaget er "on".

async function runEmailWelcomeSweepCron() {
  const r = await runEmailWelcomeSweep({ supabase, now: new Date() });
  if (r.sent) console.log(`✉️  Email-welcome: ${r.sent} sendt/dry-run (${r.candidates} kandidater)`);
}

async function runEmailDay1SweepCron() {
  const r = await runEmailDay1Sweep({ supabase, now: new Date() });
  if (r.sent) console.log(`✉️  Email-day1: ${r.sent} sendt/dry-run (${r.candidates} kandidater)`);
}

async function runEmailRaceDigestSweepCron() {
  const r = await runEmailRaceDigestSweep({ supabase, now: new Date() });
  if (r.sent) console.log(`✉️  Email-race-digest: ${r.sent} sendt/dry-run (${r.candidates} kandidater)`);
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

// ─── Deploy-grace: boot-priming af cron-monitors (#2440) ────────────────────
// Rod-årsag: hver Railway-redeploy genstarter processen midt i en cron-cyklus.
// Ved en deploy-KLYNGE (flere redeploys på kort tid — 6 på 30 min 12/7,
// gentaget 13/7) ramte hver genstart ALLE periodiske monitors samtidig, og
// #2395's failureIssueThreshold=2 dæmpede kun ÉN isoleret redeploy — to
// redeploys tæt nok på hinanden nåede stadig at bekræfte 2 misses i træk for
// de ~12 jobs på CRON_MONITOR_5MIN, før den næste genstart nåede at gøre noget.
//
// Fix: send et eksplicit "ok" check-in til Sentry for ALLE monitor-configs
// med det samme processen booter — FØR nogen setInterval er sat op. Det
// nulstiller Sentrys consecutive-miss-streak for hver monitor til 0 ved HVER
// genstart, så en deploy-klynge aldrig ophober nok sammenhængende misses til
// at nå threshold, uanset hvor mange genstarter der sker (kombineret med
// checkinMargin-bufferen ovenfor). En REELT død cron (processen kører videre,
// men jobbet holder op med at ticke) rammes ikke af dette — der sker ingen ny
// boot/priming, så det normale schedule (interval + checkinMargin × threshold)
// gælder uændret. Matematisk verificeret i cron.deployGrace.test.js.
const ALL_CRON_MONITORS = [
  ["auctions", CRON_MONITOR_1MIN],
  ["deadline-day", CRON_MONITOR_5MIN],
  ["squad-enforcement", CRON_MONITOR_5MIN],
  ["debt-warnings", CRON_MONITOR_24H],
  ["board-auto-accept", CRON_MONITOR_30MIN],
  ["board-mid-season", CRON_MONITOR_30MIN],
  ["daily-season-count-check", CRON_MONITOR_24H],
  ["discord-bot-token-check", CRON_MONITOR_24H],
  ["discord-role-sync", CRON_MONITOR_24H],
  ["discord-dm-outbox-drain", CRON_MONITOR_5MIN],
  ["training-sweep", CRON_MONITOR_5MIN],
  ["graduation-sweep", CRON_MONITOR_5MIN],
  ["scout-sweep", CRON_MONITOR_5MIN],
  ["starter-squad-heal", CRON_MONITOR_5MIN],
  ["academy-heal", CRON_MONITOR_5MIN],
  ["rider-derive-heal", CRON_MONITOR_5MIN],
  ["ai-trim-heal", CRON_MONITOR_5MIN],
  ["auto-prize", CRON_MONITOR_5MIN],
  ["stage-scheduler", CRON_MONITOR_5MIN],
  ["ranking-matview-refresh", CRON_MONITOR_10MIN],
  ["stall-watchdog", CRON_MONITOR_30MIN],
  ["traffic-retention", CRON_MONITOR_24H],
  ["entry-generator", CRON_MONITOR_60MIN],
  ["ownership-invariant-watch", CRON_MONITOR_24H],
  ["email-welcome", CRON_MONITOR_5MIN],
  ["email-day1", CRON_MONITOR_60MIN],
  ["email-race-digest", CRON_MONITOR_60MIN],
];

export function primeCronMonitorCheckIns(captureCheckInFn = captureCheckIn) {
  for (const [monitorSlug, config] of ALL_CRON_MONITORS) {
    try {
      captureCheckInFn({ monitorSlug, status: "ok" }, config);
    } catch (err) {
      // Priming må ALDRIG blokere boot — best-effort, log og fortsæt.
      console.error(`  ⚠️ Cron-monitor priming fejlede for ${monitorSlug}:`, err.message);
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startCron() {
  console.log("⏱  Cron jobs started");

  // #2440: prime ALLE monitor-check-ins FØRST, før noget interval sættes op —
  // se boot-priming-kommentaren ovenfor.
  primeCronMonitorCheckIns();

  // Every 60 seconds: finalize auctions
  setInterval(
    trackedTick("auctions", monitorCron("auctions", finalizeExpiredAuctions, CRON_MONITOR_1MIN)),
    60 * 1000
  );

  // Every 5 minutes: deadline day warnings + final whistle
  setInterval(
    trackedTick("deadline day", monitorCron("deadline-day", runDeadlineDayCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Every 5 minutes: squad enforcement (kun aktiv på lukkede vinduer der ikke er enforced)
  setInterval(
    trackedTick("squad enforcement", monitorCron("squad-enforcement", runSquadEnforcementCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Season auto-transition (#1155): DEAKTIVERET — sæson-skift er nu en bevidst
  // manuel admin-handling (ejer-beslutning 2026-06-08). Den automatiske cron
  // fyrede 2026-05-21 fire skift i træk (0→1→2→3→4). Vindue-luk, final whistle
  // og squad-tjek forbliver automatiske ovenfor; kun selve sæson-skiftet er manuelt.
  // Tændes igen ved SEASON_AUTO_TRANSITION_ENABLED=true i economyConstants.js.
  if (SEASON_AUTO_TRANSITION_ENABLED) {
    setInterval(trackedTick("season auto-transition", runSeasonAutoTransitionCron), 5 * 60 * 1000);
  } else {
    console.log("  ⏸  Season auto-transition cron DEAKTIVERET (manuelt sæson-skift, #1155)");
  }

  // Every 24 hours: check debt (#607 — 6h → 24h. notifyUser-dedup virker nu da
  // message er statisk; matcher cadence-pattern fra processDailySeasonCountCheck).
  setInterval(
    trackedTick("debt", monitorCron("debt-warnings", checkDebtWarnings, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 30 minutes: board auto-accept reminders + auto-accept (S-02b).
  // Notif-dedup (24h) sikrer ingen spam selv ved hyppig polling.
  setInterval(
    trackedTick("board auto-accept", monitorCron("board-auto-accept", runBoardAutoAcceptCron, CRON_MONITOR_30MIN)),
    30 * 60 * 1000
  );

  // Every 30 minutes: board mid-season review (S-02g).
  // Per-board-per-season dedupe (eksplicit notification-tabel-tjek) gør cron idempotent.
  setInterval(
    trackedTick("board mid-season", monitorCron("board-mid-season", runMidSeasonReviewCron, CRON_MONITOR_30MIN)),
    30 * 60 * 1000
  );

  // Every 24 hours: daily season-count safety-net (forward-guard mod cron-loop).
  setInterval(
    trackedTick("daily season-count check", monitorCron("daily-season-count-check", runDailySeasonCountCheck, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 24 hours: Discord bot-token safety-net (forward-guard mod tavs token-drift).
  setInterval(
    trackedTick("discord bot-token check", monitorCron("discord-bot-token-check", runDiscordBotTokenCheck, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 24 hours: reconcile Discord division-roller mod spillets tilstand (#2153).
  setInterval(
    trackedTick("discord division-role sync", monitorCron("discord-role-sync", runDiscordRoleSyncCron, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 5 minutes: Discord DM-outbox drain (#1115 — retry af fejlede DMs).
  setInterval(
    trackedTick("discord dm-outbox drain", monitorCron("discord-dm-outbox-drain", runDiscordDmOutboxDrain, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Daglig træning: assistent-sweep efter kl. 22 dansk tid (#1305)
  setInterval(
    trackedTick("training sweep", monitorCron("training-sweep", runTrainingSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Akademi-graduering: auto-resolver udløbne pending graduates efter kl. 22 (#932)
  setInterval(
    trackedTick("graduation sweep", monitorCron("graduation-sweep", runGraduationSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Talentspejder: modner scout_assignments (missioner + målrettede opgaver) efter kl. 22 (#2244)
  setInterval(
    trackedTick("scout sweep", monitorCron("scout-sweep", runScoutSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Start-trup heal: reparér nye hold hvis signup-allokeringen fejlede (#1563).
  // Markør-gatet + alders-guard → idempotent, exploit-sikker, ingen flag nødvendig.
  setInterval(
    trackedTick("starter-squad heal sweep", monitorCron("starter-squad-heal", runStarterSquadHealSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Akademi-kuld heal: reparér nye hold hvis signup-akademi-seedingen fejlede (#1584).
  // Markør-gatet + alders-guard → idempotent, exploit-sikker, ingen flag nødvendig.
  setInterval(
    trackedTick("academy heal sweep", monitorCron("academy-heal", runAcademyHealSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Rytter-derive heal: re-deriver strandede ryttere uden derive-lag (#1673).
  // RYTTER-data-gatet (ikke team-markør) → fanger free agents OG ryttere på hold.
  // Idempotent + deterministisk, ingen flag. Cadence matcher de andre heal-sweeps.
  setInterval(
    trackedTick("rider-derive heal sweep", monitorCron("rider-derive-heal", runRiderDeriveHealSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // AI-trim heal: fuldfør udskudte AI-hold-trims når blokerende løb er kørt færdigt
  // (#2187/#2377). Markør-gatet (pending_removal_at) → idempotent, rører aldrig ægte
  // hold. Cadence matcher de andre heal-sweeps.
  setInterval(
    trackedTick("ai-trim heal sweep", monitorCron("ai-trim-heal", runAiTeamTrimHealSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Auto-prize: udbetal udestående præmier for completede løb (#WS1).
  // trackedTick giver Sentry-capture + graceful-shutdown gratis. Idempotent via
  // prize_paid_at. Gated bag auto_prize_enabled (fail-safe OFF) — sweep'en er en
  // no-op indtil flaget eksplicit tændes runtime. Bevidst INGEN immediate-run:
  // det periodiske tick er nok, og en udbetaling skal ikke fyre ved hver genstart.
  // #2077: Sentry-heartbeat (monitorCron) → MISSED-alarm hvis tick'et udebliver.
  setInterval(
    trackedTick("auto-prize sweep", monitorCron("auto-prize", runAutoPrizeSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Every 5 minutes: stage-scheduler — afvikl forfaldne etaper én ad gangen (#WS1 Fase 3).
  // trackedTick giver Sentry-capture + graceful-shutdown gratis. Gated bag
  // stage_scheduler_enabled + race_engine_v2 (fail-safe OFF) + daglig cap (maks 5/dag).
  // Bevidst INGEN immediate-run: det periodiske tick er nok, og en etape skal ikke
  // fyre ved hver genstart (mirror auto-prize-mønstret).
  // #2077: Sentry-heartbeat (monitorCron) → MISSED-alarm hvis tick'et udebliver.
  setInterval(
    trackedTick("stage scheduler", monitorCron("stage-scheduler", runStageSchedulerCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );

  // Every 10 minutes: rangliste-matview refresh (#2175) — fallback for race-
  // finalization-hooken + fersk-holder under igangværende etapeløb. Best-effort;
  // bevidst INGEN immediate-run (finalization-hooken dækker friske resultater, og
  // en refresh skal ikke fyre ved hver genstart — mirror stage-scheduler-mønstret).
  setInterval(
    trackedTick("ranking matview refresh", monitorCron("ranking-matview-refresh", runRankingMatviewRefreshCron, CRON_MONITOR_10MIN)),
    10 * 60 * 1000
  );

  // Every 24h: Global Rank ugentligt bevægelses-snapshot (#2453) — dagligt tjek,
  // RPC'en no-op'er selv medmindre 7 dage er gået (se runGlobalRankWeeklySnapshotCron).
  setInterval(
    trackedTick("global rank weekly snapshot", monitorCron("global-rank-weekly-snapshot", runGlobalRankWeeklySnapshotCron, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 30 minutes: stall-watchdog (#2077) — fanger tavse stalls uden exception.
  // Bevidst INGEN immediate-run: cadencen er nok, og en alarm skal ikke fyre ved
  // hver genstart (mirror auto-prize/stage-scheduler-mønstret).
  setInterval(
    trackedTick("stall-watchdog", monitorCron("stall-watchdog", runStallWatchdogCron, CRON_MONITOR_30MIN)),
    30 * 60 * 1000
  );

  // Every 24 hours: traffic_events retention (#2040 — slet rå anonyme events >180 dage).
  setInterval(
    trackedTick("traffic retention", monitorCron("traffic-retention", runTrafficRetentionCron, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 24 hours: balance-drift-vagt (#2414) — natlig kredibilitets-scorecard
  // for race v3's kalibrerede bånd mod ÆGTE prod-resultater (i går, UTC).
  setInterval(
    trackedTick("balance-drift-watch", monitorCron("balance-drift-watch", runBalanceDriftWatchCron, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 24 hours: ownership-invariant-vagt (#2647) — daglig READ-ONLY safety-net
  // mod gentagelse af 18/7-incidenten (hold-ejede ryttere på ungdomsauktioner).
  setInterval(
    trackedTick("ownership-invariant-watch", monitorCron("ownership-invariant-watch", runOwnershipInvariantWatchCron, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 24 hours: akademi-intake-udløb (#2627) — 'offered'-tilbud ældre end 7
  // dage sættes til 'expired', så rytteren frigives fra is_offered_intake_rider-
  // skjulet. Gated bag intake_offer_expiry_enabled (fail-safe OFF). Idempotent
  // (WHERE status='offered') → immediate-run nedenfor er sikkert.
  setInterval(
    trackedTick("intake-offer-expiry", monitorCron("intake-offer-expiry", runIntakeOfferExpirySweepCron, CRON_MONITOR_24H)),
    24 * 60 * 60 * 1000
  );

  // Every 60 minutes: sunday-intake-drip (#2064 S0) — modulet er selv søndags-
  // gated + claim-idempotent pr. (hold, dato), så en times cadence bare fylder
  // søndagens vindue op uden risiko for dobbelt-kuld. IKKE wrappet i monitorCron
  // (den forventer succes hvert vindue; denne tick er bevidst søndags-only).
  setInterval(trackedTick("sunday-intake-drip", runSundayIntakeTickCron), 60 * 60 * 1000);

  // Every 60 minutes: entry-generator sweep (#2375) — fylder proaktivt løb for den
  // aktive sæson løbende, ikke kun ved sæson-transition. Generatoren er idempotent
  // (dry-safe re-runs), så en times cadence er rigelig — mirror auto-prize/stage-
  // scheduler-idempotens, men uden 5-min race-kritisk kadence da nye/genskabte løb
  // ikke opstår ofte. Kombineret med immediate-run nedenfor fylder et deploy huller
  // med det samme i stedet for at vente op til en time.
  setInterval(
    trackedTick("entry-generator sweep", monitorCron("entry-generator", runRaceEntryGeneratorSweepCron, CRON_MONITOR_60MIN)),
    60 * 60 * 1000
  );

  // #2725 — email retention-loop. Dormant (flag off) until the owner
  // approves the copy; all three sweeps are cheap no-ops while off.
  setInterval(
    trackedTick("email-welcome sweep", monitorCron("email-welcome", runEmailWelcomeSweepCron, CRON_MONITOR_5MIN)),
    5 * 60 * 1000
  );
  setInterval(
    trackedTick("email-day1 sweep", monitorCron("email-day1", runEmailDay1SweepCron, CRON_MONITOR_60MIN)),
    60 * 60 * 1000
  );
  setInterval(
    trackedTick("email-race-digest sweep", monitorCron("email-race-digest", runEmailRaceDigestSweepCron, CRON_MONITOR_60MIN)),
    60 * 60 * 1000
  );

  // Run immediately on start
  trackedTick("auctions", finalizeExpiredAuctions)();
  trackedTick("board auto-accept", runBoardAutoAcceptCron)();
  trackedTick("board mid-season", runMidSeasonReviewCron)();
  trackedTick("daily season-count check", runDailySeasonCountCheck)();
  trackedTick("discord bot-token check", runDiscordBotTokenCheck)();
  trackedTick("discord dm-outbox drain", runDiscordDmOutboxDrain)();
  // #2375: kør entry-generatoren straks ved boot, så et deploy fylder mid-sæson-
  // genskabte 0-entry-løb med det samme frem for at vente op til en time.
  trackedTick("entry-generator sweep", runRaceEntryGeneratorSweepCron)();
  // #2389/B5: de tre 24h-crons UDEN immediate-run kørte reelt sjældent/aldrig —
  // setInterval(24h) nulstilles ved hvert deploy, og der deployes tit oftere end
  // dagligt. Alle tre er idempotente/dedup-beskyttede (debt: statisk besked +
  // 24h notif-dedup pr. hold; role-sync: ren reconcile; retention: idempotent
  // delete), så boot-run er sikkert og gør 24h-monitorerne ovenfor ærlige.
  trackedTick("debt", checkDebtWarnings)();
  trackedTick("discord division-role sync", runDiscordRoleSyncCron)();
  trackedTick("traffic retention", runTrafficRetentionCron)();
  // #2414: samme idempotens-begrundelse — upsert på metric_date, boot-run gør
  // vagten ærlig uden at risikere dubletter/dobbelt-alarmer.
  trackedTick("balance-drift-watch", runBalanceDriftWatchCron)();
  // #2647: read-only invariant-vagt — boot-run gør den 24h-monitoren ærlig og er
  // sikkert (ingen writes, alarmerer blot hvis en invariant allerede er brudt).
  trackedTick("ownership-invariant-watch", runOwnershipInvariantWatchCron)();
  // #2627: samme idempotens-begrundelse (WHERE status='offered') — boot-run gør
  // 24h-monitoren ærlig og fylder ikke ventende tilbud unødigt hvis en deploy
  // rammer lige efter det normale tick.
  trackedTick("intake-offer-expiry", runIntakeOfferExpirySweepCron)();
  trackedTick("sunday-intake-drip", runSundayIntakeTickCron)(); // boot-run: claim-idempotent, søndags-gated
}

// ── Standalone mode ──────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("cron.js")) {
  startCron();
  console.log("Running in standalone cron mode. Ctrl+C to stop.");
}
