/**
 * Cycling Zone — Discord Notifier
 * Sends webhook messages to Discord channels
 * and optionally tags specific users via their Discord ID.
 */

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

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
};

const TYPE_LABELS = {
  auction_new:        "🔨 Ny Auktion",
  auction_outbid:     "⚠️ Overbudt!",
  auction_won:        "🏆 Auktion Vundet",
  transfer_offer:     "↔️ Transfertilbud",
  transfer_accepted:  "✅ Transfer Accepteret",
  transfer_rejected:  "❌ Transfer Afvist",
  transfer_completed: "✅ Transfer Gennemført",
  swap_completed:     "🔄 Byttehandel Gennemført",
  season_started:     "🚀 Sæson Startet",
  season_ended:       "🏁 Sæson Afsluttet",
};

/**
 * Get the default webhook URL from settings
 */
async function getDefaultWebhook() {
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
 * Get Discord ID for a team owner
 */
async function getDiscordId(teamId) {
  if (!teamId) return null;
  const { data } = await supabase
    .from("teams")
    .select("user_id")
    .eq("id", teamId)
    .single();
  if (!data?.user_id) return null;
  const { data: user } = await supabase
    .from("users")
    .select("discord_id")
    .eq("id", data.user_id)
    .single();
  return user?.discord_id || null;
}

/**
 * Send a Discord webhook message
 */
async function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("Discord webhook error:", err.message);
  }
}

/**
 * Build a Discord embed message
 */
function buildEmbed(type, title, description, fields = [], discordId = null) {
  const mention = discordId ? `<@${discordId}> ` : "";
  return {
    content: mention || undefined,
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

export async function notifyNewAuction({ riderName, riderUci, sellerName, startPrice, endsAt, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const payload = buildEmbed(
    "auction_new",
    riderName,
    `**${sellerName}** har sat **${riderName}** på auktion!`,
    [
      { name: "UCI Points", value: `${riderUci?.toLocaleString("da-DK")} CZ$` },
      { name: "Startbud", value: `${startPrice?.toLocaleString("da-DK")} CZ$` },
      { name: "Slutter", value: new Date(endsAt).toLocaleString("da-DK") },
    ]
  );
  await sendWebhook(url, payload);
}

export async function notifyOutbid({ riderName, newBid, bidderName, teamId, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const discordId = await getDiscordId(teamId);
  const payload = buildEmbed(
    "auction_outbid",
    riderName,
    `Du er blevet overbudt på **${riderName}**!`,
    [
      { name: "Nyt bud", value: `${newBid?.toLocaleString("da-DK")} CZ$` },
      { name: "Budt af", value: bidderName },
    ],
    discordId
  );
  await sendWebhook(url, payload);
}

export async function notifyAuctionWon({ riderName, finalPrice, teamId, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const discordId = await getDiscordId(teamId);
  const payload = buildEmbed(
    "auction_won",
    riderName,
    `Du har vundet auktionen på **${riderName}**! 🎉`,
    [
      { name: "Slutpris", value: `${finalPrice?.toLocaleString("da-DK")} CZ$` },
    ],
    discordId
  );
  await sendWebhook(url, payload);
}

export async function notifyTransferOffer({ riderName, offerAmount, buyerName, teamId, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const discordId = await getDiscordId(teamId);
  const payload = buildEmbed(
    "transfer_offer",
    riderName,
    `**${buyerName}** har sendt et tilbud på **${riderName}**`,
    [
      { name: "Tilbud", value: `${offerAmount?.toLocaleString("da-DK")} CZ$` },
    ],
    discordId
  );
  await sendWebhook(url, payload);
}

export async function notifyTransferResponse({ riderName, accepted, teamId, counterAmount, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const discordId = await getDiscordId(teamId);
  const type = accepted ? "transfer_accepted" : "transfer_rejected";
  const fields = [];
  if (counterAmount) fields.push({ name: "Modbud", value: `${counterAmount?.toLocaleString("da-DK")} CZ$` });
  const payload = buildEmbed(
    type,
    riderName,
    accepted
      ? `Dit tilbud på **${riderName}** blev accepteret!`
      : counterAmount
        ? `Dit tilbud på **${riderName}** fik et modbud`
        : `Dit tilbud på **${riderName}** blev afvist`,
    fields,
    discordId
  );
  await sendWebhook(url, payload);
}

export async function notifyTransferCompleted({ riderName, sellerName, buyerName, price }) {
  const url = await getWebhookByType("transfer_history");
  if (!url) return;
  const payload = buildEmbed(
    "transfer_completed",
    riderName,
    `**${riderName}** er skiftet fra **${sellerName}** til **${buyerName}**`,
    [{ name: "Pris", value: `${price?.toLocaleString("da-DK")} CZ$` }]
  );
  await sendWebhook(url, payload);
}

export async function notifySwapCompleted({ offeredName, requestedName, proposingName, receivingName, cash }) {
  const url = await getWebhookByType("transfer_history");
  if (!url) return;
  const fields = [];
  if (cash) fields.push({ name: "Kontantjustering", value: `${cash?.toLocaleString("da-DK")} CZ$` });
  const payload = buildEmbed(
    "swap_completed",
    `${offeredName} ↔ ${requestedName}`,
    `**${proposingName}** og **${receivingName}** har gennemført en byttehandel`,
    fields
  );
  await sendWebhook(url, payload);
}

export async function sendTestEmbed(webhookUrl) {
  const payload = buildEmbed(
    "season_started",
    "Test webhook",
    "Cycling Zone webhook virker korrekt!",
    [{ name: "Tidspunkt", value: new Date().toLocaleString("da-DK") }]
  );
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord svarer ${res.status}: ${await res.text()}`);
}

export async function notifySeasonEvent({ type, seasonNumber, webhookUrl }) {
  const url = webhookUrl || await getDefaultWebhook();
  if (!url) return;
  const payload = buildEmbed(
    type,
    `Sæson ${seasonNumber}`,
    type === "season_started"
      ? `Sæson ${seasonNumber} er nu startet! Held og lykke til alle managers. 🚴`
      : `Sæson ${seasonNumber} er afsluttet! Resultater og op/nedrykning er behandlet.`
  );
  await sendWebhook(url, payload);
}
