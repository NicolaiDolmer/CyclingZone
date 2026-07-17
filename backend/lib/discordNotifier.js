/**
 * Cycling Zone — Discord Notifier
 * Sends webhook messages to Discord channels
 * and optionally tags specific users via their Discord ID.
 */

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { resolveDmTargetFromInput } from "./discordDmTarget.js";
import { assertDiscordWebhookUrl } from "./urlSafety.js";
import { attemptDmDelivery } from "./discordDmDelivery.js";
import { enqueueDm, processDmOutboxDrain } from "./discordDmOutbox.js";
import { captureException as sentryCapture } from "./sentry.js";
import { getOpsWebhookUrl, makeSendOpsWebhook } from "./opsWebhook.js";
import { isDmTypeEnabled } from "./discordDmPrefs.js";
import { resolveDmRecipient } from "./discordDmRecipient.js";
import { computeResultWebhookUrls } from "./resultWebhookRouting.js";
import { recordDmAttempt } from "./discordDmRateGuard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env"), quiet: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Color codes for different event types
const COLORS = {
  auction_new:          0xe8c547, // gold
  auction_outbid:       0xe74c3c, // red
  auction_won:          0x2ecc71, // green
  transfer_offer:       0x3498db, // blue
  transfer_accepted:    0x2ecc71, // green
  transfer_rejected:    0xe74c3c, // red
  transfer_completed:   0x2ecc71, // green
  swap_completed:       0x1abc9c, // teal
  season_started:       0x9b59b6, // purple
  season_ended:         0x95a5a6, // grey
  watchlist_rider_auction: 0xe8c547, // gold
  board_update:         0x3498db, // blue
  board_critical:       0xe74c3c, // red
};

// #2520: spillervendte Discord-labels på engelsk (server er EN-first).
const TYPE_LABELS = {
  auction_new:        "🔨 New Auction",
  auction_outbid:     "⚠️ Outbid!",
  auction_won:        "🏆 Auction Won",
  transfer_offer:     "↔️ Transfer Offer",
  transfer_accepted:  "✅ Transfer Accepted",
  transfer_rejected:  "❌ Transfer Rejected",
  transfer_completed: "✅ Transfer Completed",
  swap_completed:     "🔄 Swap Completed",
  season_started:     "🚀 Season Started",
  season_ended:       "🏁 Season Ended",
  watchlist_rider_auction: "👀 Watchlisted Rider on Auction",
  board_update:       "📋 Board Update",
  board_critical:     "⚠️ The Board Is Unhappy",
};

/**
 * Get the default webhook URL from settings
 */
export async function getDefaultWebhook() {
  const { data } = await supabase
    .from("discord_settings")
    .select("webhook_url")
    .eq("is_default", true)
    .single();
  return data?.webhook_url || process.env.DISCORD_WEBHOOK_URL || null;
}

/**
 * Get webhook URL by type (e.g. 'transfer_history'), falls back to default
 */
async function getWebhookByType(type) {
  const { data } = await supabase
    .from("discord_settings")
    .select("webhook_url")
    .eq("webhook_type", type)
    .limit(1)
    .single();
  return data?.webhook_url || await getDefaultWebhook();
}

/**
 * Resultat-webhooks for et løb (#2153): gruppe-kanal (league_division_id-match)
 * + tier-samlekanal (tier-match + is_summary). Division 1 har kun én pool, så
 * gruppe og samle kan pege på samme kanal — computeResultWebhookUrls dedupliker.
 * Falder tilbage til default-webhooken hvis intet division-specifikt er
 * konfigureret endnu (fx før Fase 3-wiring), så resultater ikke tavst forsvinder.
 */
export async function getResultWebhooks(leagueDivisionId) {
  let groupUrl = null;
  let summaryUrl = null;
  if (leagueDivisionId) {
    const { data: group } = await supabase
      .from("discord_settings")
      .select("webhook_url")
      .eq("league_division_id", leagueDivisionId)
      .limit(1)
      .maybeSingle();
    groupUrl = group?.webhook_url || null;

    const { data: ld } = await supabase
      .from("league_divisions")
      .select("tier")
      .eq("id", leagueDivisionId)
      .maybeSingle();
    if (ld?.tier != null) {
      const { data: summary } = await supabase
        .from("discord_settings")
        .select("webhook_url")
        .eq("tier", ld.tier)
        .eq("is_summary", true)
        .limit(1)
        .maybeSingle();
      summaryUrl = summary?.webhook_url || null;
    }
  }
  return computeResultWebhookUrls({
    groupUrl,
    summaryUrl,
    defaultUrl: await getDefaultWebhook(),
  });
}

/**
 * Send a Discord webhook message
 */
export async function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    const safeWebhookUrl = assertDiscordWebhookUrl(webhookUrl);
    const res = await fetch(safeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
      // #2395: en 4xx (≠429) = webhooken er død/fejlkonfigureret (slettet kanal,
      // forkert id) — en PERSISTENT fejl der ellers tavst stopper alle resultat-
      // posteringer. 429 (rate limit) + 5xx = transient → kun log.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        sentryCapture(new Error(`Discord webhook ${res.status} (persistent config/routing error)`), {
          tags: { lib: "discordNotifier", status: String(res.status) },
        });
      }
    }
  } catch (err) {
    // best-effort: et transient netværks-/socket-hikke på én webhook-post må ikke
    // vælte kalderen, og er ikke capture-værdigt (#2395).
    console.error("Discord webhook error:", err.message);
  }
}

// ── Ops-alarm-kanal (#2077) ───────────────────────────────────────────────────
// Kritiske backend-alarmer (stall-watchdog, sæson-count-anomali, bot-token-drift,
// DM-outbox-død) routes til en privat #ops-kanal via DISCORD_OPS_WEBHOOK_URL med
// @mention (DISCORD_OPS_MENTION). getOpsWebhook falder gracefully tilbage til
// default-webhooken indtil ops-kanalen er provisioneret, så intet regesserer.

/** Ops-webhook-URL (DISCORD_OPS_WEBHOOK_URL → fallback default). */
export async function getOpsWebhook() {
  return getOpsWebhookUrl(getDefaultWebhook);
}

/** sendWebhook der auto-prepender ops-@mention (DISCORD_OPS_MENTION). */
export const sendOpsWebhook = makeSendOpsWebhook(sendWebhook);

// ── Discord DM (Bot REST) ─────────────────────────────────────────────────────
// Requires DISCORD_BOT_TOKEN in env. Bot must share a server with recipient
// and recipient must have "Allow DMs from server members" enabled.

const DISCORD_API = "https://discord.com/api/v10";

// Bot-token kan komme under to navne: production-Railway sætter historisk
// DISCORD_BOT_TOKEN, mens den kanoniske MCP/scripts-konvention (og
// docs/DISCORD_MCP_SETUP.md) bruger DISCORD_TOKEN. Accepter begge så ét token
// under ét navn virker overalt — uden navne-mismatch der tavst dræber DMs
// (2026-06-03: prod-DMs fejlede med 401 fordi token lå under forkert navn).
export function getBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

// Recipient + per-type prefs resolution moved to ./discordDmRecipient.js
// (client-injectable, unit-testable). notifyDiscordDM applies the per-type gate
// via isDmTypeEnabled from ./discordDmPrefs.js.

// #203: DM-routing kan styres via DISCORD_DM_TARGET env-var.
//   webhook       → ægte Discord DM via bot (default, bagudkompat)
//   stdout        → struktureret log-line, ingen netværksopkald (smoke-test grep'er logs)
//   test-channel  → embed til DISCORD_TEST_CHANNEL_WEBHOOK_URL (staging-aggregat)
// Test-konti (teams.is_test_account = true) tvinger ALTID stdout — så smoke-tests
// aldrig spammer ægte managers selv hvis env-var er sat forkert.
// Pure helper bor i ./discordDmTarget.js så unit-tests kan importere uden at trigge
// SupabaseClient-init (Node 20 + supabase-realtime-js websocket-factory issue).

async function resolveDmTarget(teamId) {
  let isTestAccount = false;
  if (teamId) {
    const { data: team } = await supabase
      .from("teams")
      .select("is_test_account")
      .eq("id", teamId)
      .single();
    isTestAccount = !!team?.is_test_account;
  }
  return resolveDmTargetFromInput({
    envValue: process.env.DISCORD_DM_TARGET,
    isTestAccount,
  });
}

async function openDmChannel(discordId, botToken) {
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`openDm ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.id;
}

async function postDm(channelId, botToken, payload) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postDm ${res.status}: ${text}`);
  }
}

/**
 * Send a raw payload as DM to a Discord user (best-effort, never throws).
 *
 * #449: silent return-pattern fjernet — vi logger nu hvorfor vi springer over
 * (mangler bot-token, mangler discord_id) så Railway-logs kan vise om DMs
 * fejler pga. config (token mangler/roteret) eller data (user uden discord_id).
 *
 * #1115: ét-forsøg-og-drop erstattet med retry + outbox. Rod-årsag 9/6: Discord
 * 429'ede Railways delte egress-IP (token var gyldigt), og den gamle sendDM
 * droppede DM'en permanent efter ét forsøg med kun console.error som spor.
 * Nu: inline-retry (respekterer retry_after) → retryable fejl ender i
 * discord_dm_outbox (drain-cron hvert 5. min, backoff op til ~27h) → permanent
 * token-fejl alarmerer via Sentry i stedet for at fejle tavst.
 */
export async function sendDM(discordId, payload) {
  const botToken = getBotToken();
  if (!botToken) {
    console.warn("[discord-dm:skip] DISCORD_BOT_TOKEN/DISCORD_TOKEN ikke sat — DM ikke sendt", { discordId: discordId ? "set" : "missing" });
    return;
  }
  if (!discordId) {
    console.warn("[discord-dm:skip] discordId mangler — DM ikke sendt");
    return;
  }

  const result = await attemptDmDelivery({ discordId, payload, botToken });
  if (result.ok) return;

  if (result.failure?.kind === "retryable") {
    console.warn("[discord-dm:outbox] DM kunne ikke leveres nu — lagt i outbox", {
      discordId,
      status: result.status,
      reason: result.failure.reason,
      attempts: result.attempts,
    });
    await enqueueDm({
      supabase,
      discordId,
      payload,
      lastStatus: result.status,
      lastError: result.error,
      captureExceptionFn: sentryCapture,
    });
    return;
  }

  // Permanent fejl: 401 = infra (token roteret/ugyldigt) → error + Sentry-alarm.
  // 403/400/404 = data (modtager har lukket DMs / ugyldigt id / recipient-blocked) →
  // warn, IKKE error: det er en forventet, ikke-actionable tilstand pr. bruger.
  // error-severity druknede ægte fejl i loggen + Sentry (#2189, samme mønster som #2169).
  if (result.failure?.reason === "token-invalid") {
    console.error("[discord-dm:error] sendDM failed permanent (infra)", {
      discordId,
      status: result.status,
      reason: result.failure?.reason,
      error: result.error,
    });
    sentryCapture(new Error(`Discord DM fejlede permanent (token-invalid): ${result.error}`), {
      tags: { component: "discord-dm" },
      extra: { status: result.status },
    });
  } else {
    console.warn("[discord-dm:undeliverable] modtager kan ikke modtage DM — dropper", {
      discordId,
      status: result.status,
      reason: result.failure?.reason,
      error: result.error,
    });
  }
}

/**
 * Drain af discord_dm_outbox — kaldes fra cron hvert 5. minut (#1115).
 * Leverer forfaldne pending-DMs igen; markerer opgivne rækker 'dead' og
 * alarmerer aggregeret via webhook + Sentry (forward-guard mod tavs DM-død).
 */
export async function drainDiscordDmOutbox({ now = new Date() } = {}) {
  const botToken = getBotToken();
  if (!botToken) {
    // Token-mangel fanges allerede af runDiscordBotTokenCheck — skip stille her.
    return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };
  }
  return processDmOutboxDrain({
    supabase,
    deliverFn: ({ discordId, payload }) => attemptDmDelivery({ discordId, payload, botToken }),
    // #2077: DM-død-alarm → ops-kanal m. @mention (var "general" via getDefaultWebhook).
    sendWebhookFn: sendOpsWebhook,
    getDefaultWebhookFn: getOpsWebhook,
    captureExceptionFn: sentryCapture,
    now,
  });
}

/**
 * High-level wrapper: send a typed embed as DM to a team owner.
 * Honors users.discord_dm_enabled opt-out and never blocks the caller.
 *
 * #203: Routes via resolveDmTarget(teamId) — test-konti og staging-modes
 * skriver til stdout/test-channel i stedet for ægte DM, så smoke-tests
 * kan asserter DM uden at spamme rigtige managers.
 */
export async function notifyDiscordDM({ teamId = null, userId = null, type, title, description, fields = [], cronRun = false }) {
  const payload = buildEmbed(type, title, description, fields);

  // #203: test-account / staging routing (teamId-scoped smoke-tests only).
  if (teamId) {
    const target = await resolveDmTarget(teamId);
    if (target === "stdout") {
      console.log("[discord-dm:stdout]", JSON.stringify({ teamId, type, title, description, fields }));
      return;
    }
    if (target === "test-channel") {
      const url = process.env.DISCORD_TEST_CHANNEL_WEBHOOK_URL;
      if (!url) {
        console.warn("[discord-dm:test-channel] DISCORD_TEST_CHANNEL_WEBHOOK_URL ikke sat — falder tilbage til stdout");
        console.log("[discord-dm:stdout]", JSON.stringify({ teamId, type, title, description, fields }));
        return;
      }
      await sendWebhook(url, payload);
      return;
    }
  }

  const recipient = await resolveDmRecipient({ teamId, userId, client: supabase });
  if (!recipient) {
    // #449: ikke en fejl (user kan have valgt opt-out eller mangler discord_id),
    // men log som info så vi kan se hvis ALLE DMs skippes pga. data-issue.
    console.info("[discord-dm:no-recipient]", { teamId, userId, type });
    // #2571: aggregeret rate-guard — no-op medmindre kalderen er en cron-tick
    // (cronRun:true). Se discordDmRateGuard.js for hvorfor/hvordan.
    recordDmAttempt({ type, skipped: true, cronRun });
    return;
  }
  recordDmAttempt({ type, skipped: false, cronRun });
  // Per-type opt-out (default on when the pref is absent).
  if (!isDmTypeEnabled(recipient.prefs, type)) {
    console.info("[discord-dm:muted]", { teamId, userId, type });
    return;
  }
  await sendDM(recipient.discordId, payload);
}

/**
 * Verify DM delivery to a specific Discord ID. Throws with a Danish message
 * suitable for displaying to the manager in ProfilePage.
 */
export async function sendTestDM(discordId) {
  const botToken = getBotToken();
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN/DISCORD_TOKEN er ikke sat på serveren");
  if (!discordId) throw new Error("Intet Discord-ID");
  let channelId;
  try {
    channelId = await openDmChannel(discordId, botToken);
  } catch (err) {
    throw new Error(`Kunne ikke åbne DM-kanal — del server med botten og slå "Allow DMs from server members" til (${err.message})`, { cause: err });
  }
  // #2520: DM-teksten er spillervendt (går til managerens Discord-inbox) → EN.
  await postDm(channelId, botToken, {
    embeds: [{
      title: "✅ Discord DM works",
      description: "You'll now receive DMs from Cycling Zone for auctions, transfers, and board updates.",
      color: 0x2ecc71,
      footer: { text: "Cycling Zone" },
      timestamp: new Date().toISOString(),
    }],
  });
}

/**
 * Build a Discord embed message (kanal-broadcast — uden @mention)
 */
function buildEmbed(type, title, description, fields = []) {
  return {
    embeds: [{
      title: `${TYPE_LABELS[type] || type}: ${title}`,
      description,
      color: COLORS[type] || 0xe8c547,
      fields: fields.map(f => ({ name: f.name, value: String(f.value), inline: f.inline ?? true })),
      footer: { text: "Cycling Zone" },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ── Public notification functions ─────────────────────────────────────────────

export async function notifyNewAuction({ riderName, riderValue, sellerName, startPrice, endsAt, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const payload = buildEmbed(
    "auction_new",
    riderName,
    `**${sellerName}** put **${riderName}** up for auction!`,
    [
      { name: "Value", value: `${riderValue?.toLocaleString("en-US")} CZ$` },
      { name: "Starting bid", value: `${startPrice?.toLocaleString("en-US")} CZ$` },
      { name: "Ends", value: new Date(endsAt).toLocaleString("en-US") },
    ]
  );
  await sendWebhook(url, payload);
}

// Person-rettede notifications — DM-only (må ikke broadcastes til kanal)
export async function notifyOutbid({ riderName, newBid, bidderName, teamId, isAuto = false, exhausted = false }) {
  const fields = [
    { name: "New bid", value: `${newBid?.toLocaleString("en-US")} CZ$` },
    { name: isAuto ? "Auto-bid from" : "Bid by", value: bidderName },
  ];
  const description = exhausted
    ? `Your auto-bid on **${riderName}** hit its max cap and was outbid.`
    : isAuto
      ? `You've been outbid on **${riderName}** by an auto-bid!`
      : `You've been outbid on **${riderName}**!`;
  await notifyDiscordDM({
    teamId,
    type: "auction_outbid",
    title: riderName,
    description,
    fields,
  });
}

// #2571: notifyAuctionWon har TO kaldere — cron.js' 60s-finalizer-tick (cron-drevet)
// og POST /api/auctions/:id/finalize (admin-request-scopet). cronRun default false
// (ikke sat), så kun cron.js' eksplicitte cronRun:true fodrer rate-guarden — den
// manuelle admin-finalize skal ikke kunne forurene et cron-run-streak.
export async function notifyAuctionWon({ riderName, finalPrice, teamId, cronRun = false }) {
  const fields = [{ name: "Final price", value: `${finalPrice?.toLocaleString("en-US")} CZ$` }];
  await notifyDiscordDM({
    teamId,
    type: "auction_won",
    title: riderName,
    description: `You've won the auction for **${riderName}**! 🎉`,
    fields,
    cronRun,
  });
}

export async function notifyTransferOffer({ riderName, offerAmount, buyerName, teamId }) {
  const fields = [{ name: "Offer", value: `${offerAmount?.toLocaleString("en-US")} CZ$` }];
  const description = `**${buyerName}** has sent an offer for **${riderName}**`;
  await notifyDiscordDM({
    teamId,
    type: "transfer_offer",
    title: riderName,
    description,
    fields,
  });
}

export async function notifyTransferResponse({ riderName, accepted, teamId, counterAmount }) {
  const type = accepted ? "transfer_accepted" : "transfer_rejected";
  const fields = [];
  if (counterAmount) fields.push({ name: "Counter-offer", value: `${counterAmount?.toLocaleString("en-US")} CZ$` });
  const description = accepted
    ? `Your offer on **${riderName}** was accepted!`
    : counterAmount
      ? `Your offer on **${riderName}** got a counter-offer`
      : `Your offer on **${riderName}** was rejected`;
  await notifyDiscordDM({ teamId, type, title: riderName, description, fields });
}

// Watchlist: en rytter på din ønskeliste er sat på auktion. DM'es på userId
// (watcherens user_id er i hånden, ikke et teamId). Ny DM-strøm — styret af
// `watchlist_rider_auction`-toggle i profilindstillingerne.
export async function notifyWatchlistRiderAuction({ userId, riderName, endsAt }) {
  const fields = [];
  if (endsAt) fields.push({ name: "Ends", value: new Date(endsAt).toLocaleString("en-US") });
  await notifyDiscordDM({
    userId,
    type: "watchlist_rider_auction",
    title: riderName,
    description: `A rider on your watchlist is up for auction: **${riderName}**`,
    fields,
  });
}

// Bestyrelses-reaktion, DM til hold-ejeren. type = board_update | board_critical
// — begge styret af `board_update`-toggle. Ny DM-strøm.
//
// #2569: board-cronsene har userId i hånden (ikke teamId), præcis som
// notifyWatchlistRiderAuction. Signaturen tog KUN teamId, så cron.js'
// `notifyBoardUpdateDM({ userId })` blev droppet tavst → teamId=undefined og
// userId=null nåede resolveDmRecipient, som intet havde at slå op på. Resultat:
// hver eneste bestyrelses-DM siden #2157 (4/7) endte i [discord-dm:no-recipient]
// uden Sentry-capture. Begge nøgler føres nu igennem — resolveDmRecipient
// foretrækker userId og falder tilbage til teamId-opslaget.
export async function notifyBoardUpdateDM({
  teamId = null,
  userId = null,
  type = "board_update",
  title,
  description,
  fields = [],
  notifyFn = notifyDiscordDM,
  // #2571: eneste kalder i produktion er cron.js (board auto-accept + mid-season
  // review) — default cronRun:true afspejler det, så rate-guarden ser strømmen
  // uden at hvert call-site skal huske at sætte flaget.
  cronRun = true,
}) {
  await notifyFn({ teamId, userId, type, title, description, fields, cronRun });
}

export async function notifyTransferCompleted({ riderName, sellerName, buyerName, price }) {
  const url = await getWebhookByType("transfer_history");
  if (!url) return;
  const payload = buildEmbed(
    "transfer_completed",
    riderName,
    `**${riderName}** has moved from **${sellerName}** to **${buyerName}**`,
    [{ name: "Price", value: `${price?.toLocaleString("en-US")} CZ$` }]
  );
  await sendWebhook(url, payload);
}

export async function notifySwapCompleted({ offeredName, requestedName, proposingName, receivingName, cash }) {
  const url = await getWebhookByType("transfer_history");
  if (!url) return;
  const fields = [];
  if (cash) fields.push({ name: "Cash adjustment", value: `${cash?.toLocaleString("en-US")} CZ$` });
  const payload = buildEmbed(
    "swap_completed",
    `${offeredName} ↔ ${requestedName}`,
    `**${proposingName}** and **${receivingName}** have completed a swap`,
    fields
  );
  await sendWebhook(url, payload);
}

export async function sendTestEmbed(webhookUrl) {
  const payload = buildEmbed(
    "season_started",
    "Test webhook",
    "Cycling Zone webhook is working correctly!",
    [{ name: "Time", value: new Date().toLocaleString("en-US") }]
  );
  try {
    const safeWebhookUrl = assertDiscordWebhookUrl(webhookUrl);
    const res = await fetch(safeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, error: text.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

export async function notifySeasonEvent({ type, seasonNumber, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const payload = buildEmbed(
    type,
    `Season ${seasonNumber}`,
    type === "season_started"
      ? `Season ${seasonNumber} has now started! Good luck to all managers. 🚴`
      : `Season ${seasonNumber} has ended! Results and promotion/relegation have been processed.`
  );
  await sendWebhook(url, payload);
}
