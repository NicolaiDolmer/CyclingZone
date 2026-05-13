/**
 * URL allowlist helpers for outbound backend requests.
 *
 * These helpers make SSRF boundaries explicit: user/config-provided strings are
 * parsed with the platform URL parser, restricted to HTTPS, restricted to known
 * public hosts, and reduced to the exact endpoint shape the application needs.
 */

const GOOGLE_SHEETS_HOST = "docs.google.com";
const DISCORD_WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com"]);
const SHEET_ID_RE = /^[a-zA-Z0-9_-]+$/;
const GID_RE = /^\d+$/;

function parseHttpsUrl(input, label) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error(`${label} skal være en URL`);
  }

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error(`${label} er ikke en gyldig URL`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} skal bruge https`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} må ikke indeholde brugernavn eller password`);
  }

  if (parsed.port) {
    throw new Error(`${label} må ikke angive en port`);
  }

  return parsed;
}

export function parseGoogleSheetUrl(input) {
  const parsed = parseHttpsUrl(input, "Google Sheets URL");

  if (parsed.hostname !== GOOGLE_SHEETS_HOST) {
    throw new Error("Google Sheets URL skal være på docs.google.com");
  }

  const match = parsed.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (!match) {
    throw new Error("Kan ikke udtrække sheet ID fra Google Sheets URL");
  }

  const sheetId = match[1];
  if (!SHEET_ID_RE.test(sheetId)) {
    throw new Error("Google Sheets URL indeholder et ugyldigt sheet ID");
  }

  const hashGid = parsed.hash.match(/[?&#]?gid=(\d+)/)?.[1];
  const gid = parsed.searchParams.get("gid") || hashGid || "0";
  if (!GID_RE.test(gid)) {
    throw new Error("Google Sheets URL indeholder et ugyldigt gid");
  }

  return { sheetId, gid };
}

export function buildGoogleSheetCsvUrl(input, { includeGid = false } = {}) {
  const { sheetId, gid } = parseGoogleSheetUrl(input);
  const url = new URL(`https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${sheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  if (includeGid) url.searchParams.set("gid", gid);
  return url.toString();
}

export function assertDiscordWebhookUrl(input) {
  const parsed = parseHttpsUrl(input, "Discord webhook URL");

  if (!DISCORD_WEBHOOK_HOSTS.has(parsed.hostname)) {
    throw new Error("Discord webhook URL skal være på discord.com eller discordapp.com");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "webhooks") {
    throw new Error("Discord webhook URL skal matche /api/webhooks/{id}/{token}");
  }

  return parsed.toString();
}
