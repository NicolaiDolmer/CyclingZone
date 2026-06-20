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
import {
  notifyAuctionWon,
  getDefaultWebhook,
  sendWebhook,
  getBotToken,
  drainDiscordDmOutbox,
} from "./lib/discordNotifier.js";
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
import { runAcademyGraduationSweep } from "./lib/academyGraduationSweep.js";
import { runAutoPrizeSweep } from "./lib/autoPrizeSweep.js";
import { runStageScheduler } from "./lib/stageScheduler.js";
import { isStageSchedulerEnabled } from "./lib/stageSchedulerFlag.js";
import { isRaceEngineV2Enabled } from "./lib/raceEngineFlag.js";
import { runAdminSimulateStage, buildRaceSimEmbed } from "./lib/adminSimulateRace.js";
import { makeEnsureSeasonStandings } from "./lib/seasonStandingsBootstrap.js";
import { updateStandings } from "./lib/economyEngine.js";
import { runStarterSquadHealSweep } from "./lib/starterSquadHealSweep.js";
import { captureException as sentryCapture } from "./lib/sentry.js";
const __envdir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__envdir, "../.env"), quiet: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

async function runBoardAutoAcceptCron() {
  try {
    const result = await processBoardAutoAcceptCron({
      supabase,
      notifyUser: (args) => notifyUserShared({ supabase, ...args }),
      captureExceptionFn: sentryCapture,
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
      captureExceptionFn: sentryCapture,
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
      console.log(
        `🌅 Sæson-transition: sæson ${result.fromSeason} → ${result.toSeason} udført automatisk`
      );
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
    sendWebhookFn: sendWebhook,
    getDefaultWebhookFn: getDefaultWebhook,
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

async function runStageSchedulerCron() {
  const result = await runStageScheduler({
    supabase,
    now: new Date(),
    isStageSchedulerEnabled,
    isRaceEngineV2Enabled,
    runStageFn: async ({ raceId }) => {
      const notifyDiscord = async ({ race, resultRows }) => {
        const url = await getDefaultWebhook();
        if (!url) return;
        const embed = buildRaceSimEmbed({ race, resultRows });
        await sendWebhook(url, { embeds: [{ ...embed, footer: { text: "Cycling Zone" } }] });
      };
      return runAdminSimulateStage({
        supabase,
        raceId,
        dryRun: false,
        runSource: "scheduler", // FIX 4: kun scheduler-runs tæller i den daglige cap
        ensureSeasonStandings: ensureSeasonStandingsCron,
        updateStandings,
        notifyDiscord,
      });
    },
  });
  if (result.ran || result.errors) {
    console.log(`🚵 Stage-scheduler: ${result.ran} etape(r) afviklet, ${result.errors} fejl`);
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
  setInterval(trackedTick("debt", checkDebtWarnings), 24 * 60 * 60 * 1000);

  // Every 30 minutes: board auto-accept reminders + auto-accept (S-02b).
  // Notif-dedup (24h) sikrer ingen spam selv ved hyppig polling.
  setInterval(trackedTick("board auto-accept", runBoardAutoAcceptCron), 30 * 60 * 1000);

  // Every 30 minutes: board mid-season review (S-02g).
  // Per-board-per-season dedupe (eksplicit notification-tabel-tjek) gør cron idempotent.
  setInterval(trackedTick("board mid-season", runMidSeasonReviewCron), 30 * 60 * 1000);

  // Every 24 hours: daily season-count safety-net (forward-guard mod cron-loop).
  setInterval(
    trackedTick("daily season-count check", runDailySeasonCountCheck),
    24 * 60 * 60 * 1000
  );

  // Every 24 hours: Discord bot-token safety-net (forward-guard mod tavs token-drift).
  setInterval(trackedTick("discord bot-token check", runDiscordBotTokenCheck), 24 * 60 * 60 * 1000);

  // Every 5 minutes: Discord DM-outbox drain (#1115 — retry af fejlede DMs).
  setInterval(trackedTick("discord dm-outbox drain", runDiscordDmOutboxDrain), 5 * 60 * 1000);

  // Daglig træning: assistent-sweep efter kl. 22 dansk tid (#1305)
  setInterval(trackedTick("training sweep", runTrainingSweepCron), 5 * 60 * 1000);

  // Akademi-graduering: auto-resolver udløbne pending graduates efter kl. 22 (#932)
  setInterval(trackedTick("graduation sweep", runGraduationSweepCron), 5 * 60 * 1000);

  // Start-trup heal: reparér nye hold hvis signup-allokeringen fejlede (#1563).
  // Markør-gatet + alders-guard → idempotent, exploit-sikker, ingen flag nødvendig.
  setInterval(trackedTick("starter-squad heal sweep", runStarterSquadHealSweepCron), 5 * 60 * 1000);

  // Auto-prize: udbetal udestående præmier for completede løb (#WS1).
  // trackedTick giver Sentry-capture + graceful-shutdown gratis. Idempotent via
  // prize_paid_at. Gated bag auto_prize_enabled (fail-safe OFF) — sweep'en er en
  // no-op indtil flaget eksplicit tændes runtime. Bevidst INGEN immediate-run:
  // det periodiske tick er nok, og en udbetaling skal ikke fyre ved hver genstart.
  setInterval(trackedTick("auto-prize sweep", runAutoPrizeSweepCron), 5 * 60 * 1000);

  // Every 5 minutes: stage-scheduler — afvikl forfaldne etaper én ad gangen (#WS1 Fase 3).
  // trackedTick giver Sentry-capture + graceful-shutdown gratis. Gated bag
  // stage_scheduler_enabled + race_engine_v2 (fail-safe OFF) + daglig cap (maks 5/dag).
  // Bevidst INGEN immediate-run: det periodiske tick er nok, og en etape skal ikke
  // fyre ved hver genstart (mirror auto-prize-mønstret).
  setInterval(trackedTick("stage scheduler", runStageSchedulerCron), 5 * 60 * 1000);

  // Run immediately on start
  trackedTick("auctions", finalizeExpiredAuctions)();
  trackedTick("board auto-accept", runBoardAutoAcceptCron)();
  trackedTick("board mid-season", runMidSeasonReviewCron)();
  trackedTick("daily season-count check", runDailySeasonCountCheck)();
  trackedTick("discord bot-token check", runDiscordBotTokenCheck)();
  trackedTick("discord dm-outbox drain", runDiscordDmOutboxDrain)();
}

// ── Standalone mode ──────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("cron.js")) {
  startCron();
  console.log("Running in standalone cron mode. Ctrl+C to stop.");
}
