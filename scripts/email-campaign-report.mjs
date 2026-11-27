#!/usr/bin/env node
// #8807 -- campaign report for a hand-run mail campaign (S6 first): delivery,
// bounces, complaints, unsubscribes, unique clicks and activity 1/3/7/14 days
// after the mail, per audience x language x subject variant, plus
// webhook health. All counting lives in backend/lib/emailCampaignReport.js
// (pure, unit-tested); this file only READS prod and writes one private file.
//
// KUN LAESNING. Scriptet skriver aldrig til databasen, sender intet og poster
// intet. Tallene er private (spillertal, #8807): de skrives til en fil i
// OneDrive, aldrig til GitHub, og filen afvises hvis den ligger i et Git-checkout.
//
// BRUG:
//   infisical run --env=prod -- node scripts/email-campaign-report.mjs --campaign s6_season
//   infisical run --env=prod -- node scripts/email-campaign-report.mjs --campaign s6_season --edition before-start
//
// Flag:
//   --campaign <type>   kun "s6_season" (default)
//   --edition <navn>    "before-start" (default) eller "started"
//   --out <fil>         default <OneDrive>/CyclingZone-context/private/email-kampagner/<kampagne>-<udgave>-<tid>.md
//   --json              skriv JSON i stedet for markdown
//   --grace-hours <t>   hvor gamle afsendelser skal vaere foer webhooken vurderes (default 2)
//
// ENV (Infisical, aldrig fra disk):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID (valgfri, query:read; POSTHOG_HOST default eu)
//
// EXIT-CODES: 0 = rapport skrevet, webhook ok/advarsel/afventer
//             1 = ugyldige flag / manglende env / laesefejl
//             2 = rapport skrevet, men WEBHOOKEN LEVERER IKKE (email_events tom for kampagnen)

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../backend/lib/supabasePagination.js";
import {
  PRO_PURCHASE_EVENT_NAME,
  REPORT_CAMPAIGNS,
  REPORT_WINDOWS_DAYS,
  WEBHOOK_GRACE_HOURS,
  buildCampaignReport,
  editionKeyPrefix,
  isVisitEvent,
  renderCampaignReport,
} from "../backend/lib/emailCampaignReport.js";
import { S6_EDITIONS } from "../backend/lib/emailTemplates.js";

const DAY_MS = 86_400_000;
// How far back visits are read to rebuild the audience at send time: past the
// longest audience limit, so "away" is still told apart from "dormant".
const VISIT_LOOKBACK_DAYS = 60;
const CAMPAIGN_SEASON = { s6_season: 6 };

export function fail(message, exitCode = 1) {
  const err = new Error(message);
  err.exitCode = exitCode;
  return err;
}

export function parseOptions(argv) {
  const options = { campaign: "s6_season", edition: "before-start", out: null, json: false, graceHours: WEBHOOK_GRACE_HOURS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw fail(`${flag} kraever en vaerdi.`);
      i += 1;
      return v;
    };
    if (flag === "--campaign") options.campaign = value();
    else if (flag === "--edition") options.edition = value();
    else if (flag === "--out") options.out = value();
    else if (flag === "--json") options.json = true;
    else if (flag === "--grace-hours") {
      const hours = Number(value());
      if (!Number.isFinite(hours) || hours < 0) throw fail("--grace-hours kraever et tal >= 0.");
      options.graceHours = hours;
    } else throw fail(`ukendt flag ${flag}.`);
  }
  if (!REPORT_CAMPAIGNS[options.campaign]) throw fail(`ukendt --campaign; kendte: ${Object.keys(REPORT_CAMPAIGNS).join(", ")}.`);
  if (!S6_EDITIONS.includes(options.edition)) throw fail(`ukendt --edition; kendte: ${S6_EDITIONS.join(", ")}.`);
  return options;
}

export function defaultOutPath({ env, campaign, edition, now }) {
  if (!env.OneDrive) throw fail("ingen OneDrive-mappe fundet; giv --out <fil> uden for Git.");
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return path.join(env.OneDrive, "CyclingZone-context", "private", "email-kampagner", `${campaign}-${edition}-${stamp}.md`);
}

/** Refuse any target inside a Git checkout, also through a junction (same rule as gsc-report.mjs). */
export async function writePrivateReport(file, content) {
  const target = path.resolve(file);
  let ancestor = path.dirname(target);
  for (;;) {
    try {
      ancestor = await fs.realpath(ancestor);
      break;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw err;
      ancestor = parent;
    }
  }
  for (let dir = ancestor; ; dir = path.dirname(dir)) {
    let isGit = false;
    try {
      await fs.lstat(path.join(dir, ".git"));
      isGit = true;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (isGit) throw fail("--out skal ligge privat uden for Git-checkouts (tallene maa aldrig naa GitHub).");
    if (path.dirname(dir) === dir) break;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return target;
}

function requireEnv(env, name) {
  if (!env[name]) throw fail(`mangler env-variabel ${name} (koer via infisical run --env=prod -- ...).`);
  return env[name];
}

const iso = (ms) => new Date(ms).toISOString();
const unique = (values) => [...new Set(values.filter(Boolean))];

// ── reads (all read-only) ────────────────────────────────────────────────

async function loadInputs({ db, campaign, edition, now }) {
  const teams = await fetchAllRows(() =>
    db
      .from("teams")
      .select("id, name, user_id, is_ai, is_bank, is_test_account, is_frozen")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_test_account", false)
      .not("user_id", "is", null)
      .order("id")
  );
  const userIds = unique(teams.map((t) => t.user_id));
  const users = await fetchAllRowsChunkedIn(userIds, (chunk) =>
    db.from("users").select("id, email, last_seen, language, consent_preferences, email_prefs").in("id", chunk).order("id")
  );
  const [campaignRows, suppressionRows] = await Promise.all([
    fetchAllRows(() =>
      db
        .from("email_log")
        .select("id, user_id, email_type, dedupe_key, status, provider_id, created_at")
        .eq("email_type", campaign)
        .like("dedupe_key", `${editionKeyPrefix(campaign, edition)}%`)
        .order("id")
    ),
    fetchAllRows(() =>
      db.from("email_log").select("id, user_id, email_type, dedupe_key, status").in("status", ["bounced", "complained"]).order("id")
    ),
  ]);
  const emailLogRows = [...campaignRows, ...suppressionRows];

  const providerIds = unique(campaignRows.map((r) => r.provider_id));
  const emailEvents = await fetchAllRowsChunkedIn(providerIds, (chunk) =>
    db.from("email_events").select("id, provider_id, type, payload, created_at").in("provider_id", chunk).order("id")
  );

  const sendTimes = campaignRows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  if (sendTimes.length === 0) {
    return { teams, users, emailLogRows, emailEvents, activityRows: [], trafficRows: [], firstSendMs: null };
  }
  const firstSendMs = Math.min(...sendTimes);
  const lastWindowEnd = Math.min(now.getTime(), Math.max(...sendTimes) + (Math.max(...REPORT_WINDOWS_DAYS) + 1) * DAY_MS);
  const teamIds = unique(teams.map((t) => t.id));
  const from = iso(firstSendMs);
  const to = iso(lastWindowEnd);

  const activityRows = [];
  const visits = await fetchAllRowsChunkedIn(userIds, (chunk) =>
    db
      .from("player_events")
      .select("id, user_id, event_name, created_at")
      .in("user_id", chunk)
      .gte("created_at", iso(firstSendMs - VISIT_LOOKBACK_DAYS * DAY_MS))
      .lte("created_at", to)
      .order("id")
  );
  // Payment webhooks write player_events rows without a visit; only the rest is login evidence.
  for (const r of visits) {
    if (isVisitEvent(r.event_name)) activityRows.push({ signal: "login", user_id: r.user_id, at: r.created_at });
  }

  for (const table of ["training_week_plans", "training_plans", "training_groups", "team_training_rules"]) {
    const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
      db.from(table).select("id, team_id, created_at, updated_at").in("team_id", chunk).gte("updated_at", from).order("id")
    );
    for (const r of rows) activityRows.push({ signal: "training", team_id: r.team_id, at: r.updated_at ?? r.created_at });
  }

  const seasonNumber = CAMPAIGN_SEASON[campaign];
  const { data: season, error: seasonErr } = await db.from("seasons").select("id").eq("number", seasonNumber).maybeSingle();
  if (seasonErr) throw fail(`kunne ikke laese seasons: ${seasonErr.message}`);
  const races = season
    ? await fetchAllRows(() =>
        db.from("races").select("id, status, stages_completed, scheduled_for").eq("season_id", season.id).order("id")
      )
    : [];
  const raceById = new Map(races.map((r) => [r.id, r]));
  const entries = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    db
      .from("race_entries")
      .select("race_id, rider_id, team_id, is_auto_filled, created_at")
      .in("team_id", chunk)
      .order("race_id")
      .order("rider_id")
  );
  const racedKeys = new Set();
  for (const e of entries) {
    if (e.is_auto_filled === false && e.created_at && Date.parse(e.created_at) >= firstSendMs) {
      activityRows.push({ signal: "lineup", team_id: e.team_id, at: e.created_at });
    }
    const race = raceById.get(e.race_id);
    const ran = race && (race.status === "completed" || Number(race.stages_completed) > 0) && race.scheduled_for;
    const key = `${e.team_id}:${e.race_id}`;
    if (ran && !racedKeys.has(key)) {
      racedKeys.add(key);
      activityRows.push({ signal: "season_race", team_id: e.team_id, at: race.scheduled_for });
    }
  }

  // A completed payment, not the subscription row: that row is also written
  // when checkout starts, and an existing row can be updated by a later buy.
  const purchases = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    db
      .from("player_events")
      .select("id, team_id, created_at")
      .eq("event_name", PRO_PURCHASE_EVENT_NAME)
      .in("team_id", chunk)
      .gte("created_at", from)
      .order("id")
  );
  for (const r of purchases) activityRows.push({ signal: "pro_purchase", team_id: r.team_id, at: r.created_at });

  const utmCampaign = `${REPORT_CAMPAIGNS[campaign].utmCampaignPrefix}${edition}`;
  const trafficRows = await fetchAllRows(() =>
    db
      .from("traffic_events")
      .select("id, visit_hash, is_bot, utm_campaign")
      .eq("utm_campaign", utmCampaign)
      .gte("occurred_at", from)
      .order("id")
  );

  return { teams, users, emailLogRows, emailEvents, activityRows, trafficRows, firstSendMs };
}

/** Optional: PostHog persons/sessions per utm_content. null when no key. */
export async function readPosthogUtm({ env, utmCampaign, firstSendMs, fetchImpl = globalThis.fetch }) {
  const apiKey = env.POSTHOG_PERSONAL_API_KEY;
  const projectId = env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId || firstSendMs === null) return null;
  if (!/^[a-z0-9-]+$/.test(utmCampaign)) throw fail("ugyldig utm_campaign");
  const since = new Date(firstSendMs).toISOString().slice(0, 19).replace("T", " ");
  const query =
    "SELECT properties.utm_content AS content, count(DISTINCT person_id), count(DISTINCT properties.$session_id) " +
    `FROM events WHERE event = '$pageview' AND properties.utm_campaign = '${utmCampaign}' ` +
    `AND timestamp >= toDateTime('${since}') GROUP BY content ORDER BY content`;
  const host = (env.POSTHOG_HOST || "https://eu.posthog.com").replace(/\/+$/, "");
  const res = await fetchImpl(`${host}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "cz-email-campaign-report-8807" }),
  });
  if (!res.ok) throw fail(`PostHog svarede ${res.status}`);
  const payload = await res.json();
  return (Array.isArray(payload?.results) ? payload.results : []).map(([content, persons, sessions]) => ({
    utmContent: typeof content === "string" ? content : "",
    persons: Number(persons) || 0,
    sessions: Number(sessions) || 0,
  }));
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseOptions(argv);
  const now = new Date();
  const db = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_KEY"), {
    auth: { persistSession: false },
  });
  const inputs = await loadInputs({ db, campaign: options.campaign, edition: options.edition, now });
  let posthogRows = null;
  try {
    posthogRows = await readPosthogUtm({
      env,
      utmCampaign: `${REPORT_CAMPAIGNS[options.campaign].utmCampaignPrefix}${options.edition}`,
      firstSendMs: inputs.firstSendMs,
    });
  } catch (err) {
    // best-effort: PostHog is an extra source; without it the report still
    // holds every database count. The skip is written into the report.
    console.error(`PostHog sprunget over: ${err.message}`);
  }
  const report = buildCampaignReport({
    campaign: options.campaign,
    edition: options.edition,
    ...inputs,
    posthogRows,
    graceHours: options.graceHours,
    now,
  });
  const content = options.json ? `${JSON.stringify(report, null, 2)}\n` : renderCampaignReport(report);
  const out = options.out ?? defaultOutPath({ env, campaign: options.campaign, edition: options.edition, now });
  const written = await writePrivateReport(out, content);
  console.log(`Privat kampagnerapport gemt: ${written}`);
  console.log(`Webhook-sundhed: ${report.webhook.status}`);
  if (report.webhook.status === "fail") {
    console.error("");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!! WEBHOOKEN LEVERER IKKE: email_events har ingen haendelser for kampagnen.");
    for (const message of report.webhook.messages) console.error(`!! ${message}`);
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exitCode = 2;
  } else {
    for (const message of report.webhook.messages) console.log(`  ${message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`FEJL: ${err.exitCode ? err.message : err?.message || String(err)}`);
    process.exitCode = err.exitCode || 1;
  });
}
