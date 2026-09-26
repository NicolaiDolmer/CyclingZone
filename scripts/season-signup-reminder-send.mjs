#!/usr/bin/env node
// #5814 -- one-off "sign up for next season before you are parked" reminder,
// follow-up to the #2760 win-back (scripts/winback-send.mjs, same pattern).
// NOT a cron sweep: run by hand on the last day of the season, after the
// owner has approved the copy (docs/drafts/2026-09-27-season-signup-reminder-mail.md).
// Segment, dedupe and the run loop live in backend/lib/seasonSignupReminder.js
// (pure + injected side effects, unit-tested); this file is I/O only.
//
// BRUG:
//   # 1) maaling (default, INGEN mails, ingen skrivning af nogen art):
//   infisical run --env=prod -- node scripts/season-signup-reminder-send.mjs --dry-run
//   infisical run --env=prod -- node scripts/season-signup-reminder-send.mjs --dry-run --as-of 2026-09-27T17:00:00Z
//
//   # 2) rigtig afsendelse -- KRAEVER app_config.winback_send_enabled = true
//   #    (samme gate som win-back; flip'es KUN af ejeren):
//   infisical run --env=prod -- node scripts/season-signup-reminder-send.mjs --execute
//
// Flag:
//   --dry-run        eksplicit maaling (default hvis intet flag gives)
//   --execute        send rigtige mails (kraever app_config-gaten)
//   --as-of <ISO>    maal "ville blive parkeret" paa et andet tidspunkt end nu,
//                    fx sæsonskiftet, saa en manager der runder 30 dage mellem
//                    afsendelse og skifte kommer med. Default: nu.
//
// ENV (Infisical, aldrig fra disk):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (paakraevet)
//   RESEND_API_KEY, EMAIL_UNSUB_SECRET  (kun ved --execute)
//   WINBACK_RATE_LIMIT_MS               (valgfri, default 600 ms mellem mails)
//
// EXIT-CODES: 0 = koert, 1 = manglende env / ugyldige flag / gate ikke true ved --execute

import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../backend/lib/supabasePagination.js";
import { loadParkingInputs, PARKING_TEAM_COLUMNS } from "../backend/lib/managerParking.js";
import {
  runSeasonSignupReminder,
  SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY,
  SEASON_SIGNUP_REMINDER_EMAIL_KIND,
} from "../backend/lib/seasonSignupReminder.js";
import { buildSeasonSignupReminderEmail } from "../backend/lib/emailTemplates.js";
import { sendLoopEmail } from "../backend/lib/emailService.js";
import { unsubscribeUrlForStage } from "../backend/lib/emailUnsubUrl.js";

const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes("--execute");
const RATE_LIMIT_MS = Number(process.env.WINBACK_RATE_LIMIT_MS) || 600;

function fail(msg) {
  console.error(`FEJL: ${msg}`);
  process.exit(1);
}

if (EXECUTE && ARGV.includes("--dry-run")) fail("--dry-run og --execute kan ikke kombineres.");

function parseAsOf() {
  const index = ARGV.indexOf("--as-of");
  if (index === -1) return new Date();
  const value = ARGV[index + 1];
  const date = new Date(value ?? "");
  if (!value || Number.isNaN(date.getTime())) fail("--as-of kraever et ISO-tidspunkt, fx 2026-09-27T17:00:00Z.");
  return date;
}
const AS_OF = parseAsOf();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`mangler env-variabel ${name} (koer via infisical run --env=prod -- ...).`);
  return value;
}

const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_KEY"), {
  auth: { persistSession: false },
});

// ── DB reads (all read-only) ─────────────────────────────────────────────

async function loadInputs() {
  const { data: season, error: seasonErr } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
  if (seasonErr) fail(`kunne ikke hente aktiv saeson: ${seasonErr.message}`);
  if (!season?.id) fail("ingen aktiv saeson -- dedupe-noeglen er pr. saeson, saa der sendes ikke uden.");

  // Samme grundlag som parkerings-sweepen og parkingDryRun.js.
  const { teams, users: lastSeenRows, subscriptions } = await loadParkingInputs({ supabase });
  const userIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))];
  const detailRows = await fetchAllRowsChunkedIn(userIds, (chunk) =>
    supabase.from("users").select("id, email, language, consent_preferences, email_prefs").in("id", chunk).order("id")
  );
  const detailById = new Map(detailRows.map((u) => [u.id, u]));
  const users = lastSeenRows.map((u) => ({ ...detailById.get(u.id), ...u }));

  const [standings, divisions, reminderRows, suppressionRows] = await Promise.all([
    fetchAllRows(() =>
      supabase.from("season_standings").select("team_id, rank_in_division, league_division_id").eq("season_id", season.id).order("id")
    ),
    fetchAllRows(() => supabase.from("league_divisions").select("id, label").order("id")),
    fetchAllRows(() =>
      supabase.from("email_log").select("user_id, email_type, dedupe_key, status").eq("email_type", SEASON_SIGNUP_REMINDER_EMAIL_KIND).order("id")
    ),
    fetchAllRows(() =>
      supabase.from("email_log").select("user_id, email_type, dedupe_key, status").in("status", ["bounced", "complained"]).order("id")
    ),
  ]);

  return { seasonId: season.id, teams, users, subscriptions, standings, divisions, emailLogRows: [...reminderRows, ...suppressionRows] };
}

async function readSendEnabled() {
  const { data, error } = await supabase.from("app_config").select("value").eq("key", SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY).maybeSingle();
  if (error) fail(`kunne ikke laese app_config.${SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY}: ${error.message}`);
  return data?.value === true;
}

async function readFreshState(userId, teamId) {
  const [{ data: user, error: userErr }, { data: team, error: teamErr }] = await Promise.all([
    supabase.from("users").select("id, last_seen, consent_preferences, email_prefs").eq("id", userId).maybeSingle(),
    supabase.from("teams").select(PARKING_TEAM_COLUMNS).eq("id", teamId).maybeSingle(),
  ]);
  if (userErr) throw new Error(`consent re-check failed: ${userErr.message}`);
  if (teamErr) throw new Error(`parking re-check failed: ${teamErr.message}`);
  return { user: user ?? null, team: team ?? null };
}

async function sendEmail(candidate, dedupeKey) {
  const unsubscribeUrl = unsubscribeUrlForStage({ userId: candidate.userId, secret: process.env.EMAIL_UNSUB_SECRET, stage: "on" });
  const { subject, html, text } = buildSeasonSignupReminderEmail({
    teamName: candidate.teamName,
    rankInDivision: candidate.rankInDivision,
    poolLabel: candidate.poolLabel,
    unsubscribeUrl,
    language: candidate.language,
  });
  return sendLoopEmail({
    supabase,
    userId: candidate.userId,
    teamId: candidate.teamId,
    type: SEASON_SIGNUP_REMINDER_EMAIL_KIND,
    dedupeKey,
    to: candidate.email,
    subject,
    html,
    text,
    unsubscribeUrl,
    stage: "on",
  });
}

// ── report ───────────────────────────────────────────────────────────────

function printReport(result) {
  console.log(`Saeson (dedupe-scope): ${result.seasonId}`);
  console.log(`Maalt pr.: ${AS_OF.toISOString()}`);
  console.log(`Modtagere (ville blive parkeret, email_marketing=true, ikke afmeldt/bounced, ikke allerede mindet): ${result.candidates.length}`);
  console.log(`  EN ${result.byLanguage.en}`);
  console.log(`  DA ${result.byLanguage.da}`);
  if (result.examples?.length) {
    console.log("\nEksempler (op til 3):");
    for (const c of result.examples) {
      const { subject } = buildSeasonSignupReminderEmail({
        teamName: c.teamName, rankInDivision: c.rankInDivision, poolLabel: c.poolLabel, unsubscribeUrl: "(dry-run)", language: c.language,
      });
      const days = c.daysSinceLastSeen == null ? "aldrig set" : `${c.daysSinceLastSeen}d`;
      const pool = c.poolLabel ? `${c.poolLabel} (#${c.rankInDivision ?? "?"})` : "ingen standing";
      console.log(`  ${c.teamName ?? "(uden navn)"} | ${days} | ${pool} | ${c.language === "da" ? "DA" : "EN"} | "${subject}"`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  if (EXECUTE) {
    requireEnv("RESEND_API_KEY");
    requireEnv("EMAIL_UNSUB_SECRET");
  }
  const result = await runSeasonSignupReminder({
    loadInputs,
    execute: EXECUTE,
    readSendEnabled,
    readFreshState,
    sendEmail,
    rateLimitMs: RATE_LIMIT_MS,
    now: AS_OF,
    log: (line) => console.error(line),
  });

  if (result.mode === "dry_run") {
    console.log("Mode: DRY-RUN (ingen mails, ingen skrivning)\n");
    printReport(result);
    process.exit(0);
  }

  console.log("Mode: EXECUTE\n");
  if (result.refused) {
    fail(
      `app_config.${SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY} er ikke true -- afsendelse er slukket. ` +
        "Ejeren flipper noeglen i Supabase efter at have godkendt teksten, foer denne kommando koeres igen."
    );
  }
  console.log(`Faerdig. sendt=${result.sent} skipped=${result.skipped} failed=${result.failed} (total ${result.candidates.length})`);
  process.exit(0);
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
