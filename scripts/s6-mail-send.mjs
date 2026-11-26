#!/usr/bin/env node
// #8396 -- Season 6 mail 1 ("before-start", buildS6SeasonEmail) to every
// consenting human manager. Same pattern as scripts/winback-send.mjs and
// scripts/season-signup-reminder-send.mjs. NOT a cron sweep: run by hand,
// after the owner has approved the copy and flipped the gate. Segment,
// consent, dedupe, audience, language and the run loop live in
// backend/lib/s6MailCampaign.js (pure + injected side effects, unit-tested);
// this file is I/O only.
//
// BRUG:
//   # 1) maaling (default, INGEN mails, ingen skrivning af nogen art; kun tal):
//   infisical run --env=prod -- node scripts/s6-mail-send.mjs --dry-run
//
//   # 2) testmail: EN mail pr. gruppe og sprog (6 i alt) til EN adresse,
//   #    ingen modtagere laeses, ingen email_log-raekker:
//   infisical run --env=prod -- node scripts/s6-mail-send.mjs --test-to <adresse>
//
//   # 3) rigtig afsendelse -- KRAEVER app_config.winback_send_enabled = true
//   #    (samme gate som win-back og tilmeldingspaamindelsen; flip'es KUN af ejeren):
//   infisical run --env=prod -- node scripts/s6-mail-send.mjs --execute
//
// Flag:
//   --dry-run          eksplicit maaling (default hvis intet flag gives)
//   --test-to <adr.>   send de 6 testmails til en adresse (udelukker --execute)
//   --execute          send rigtige mails (kraever app_config-gaten)
//   --edition <navn>   kun "before-start" (default); mail 2 faar sit eget go
//   --holdout <andel>  kontrolgruppe 0-0.5 (default 0 = slukket, #8807). Samme
//                      andel skal gives til scripts/email-campaign-report.mjs
//
// ENV (Infisical, aldrig fra disk):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (dry-run og execute)
//   RESEND_API_KEY                      (test og execute)
//   EMAIL_UNSUB_SECRET                  (kun execute)
//   WINBACK_RATE_LIMIT_MS               (valgfri, default 600 ms mellem mails)
//
// Afsendelse: hver mail gaar gennem emailService.js (sendLoopEmail ved execute,
// sendViaResend ved test), saa From, Reply-To og de one-click-headere
// List-Unsubscribe + List-Unsubscribe-Post er de samme som i alle andre mails.
// Execute skriver email_log med dedupe-noeglen s6_season:<edition>:<userId>,
// og Resend faar samme noegle som idempotencyKey, saa en genkoersel aldrig
// sender to gange. Testmails bruger dry-run-afmeldingslinket, som ikke kan
// verificeres og derfor aldrig afmelder en rigtig spiller.
//
// EXIT-CODES: 0 = koert, 1 = manglende env / ugyldige flag / gate ikke true ved --execute

import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../backend/lib/supabasePagination.js";
import {
  S6_MAIL_APP_CONFIG_KEY,
  S6_MAIL_DEFAULT_EDITION,
  S6_MAIL_EDITIONS,
  S6_MAIL_EMAIL_KIND,
  S6_MAIL_SUBJECT_VARIANT,
  isKnownS6MailEdition,
  runS6Mail,
} from "../backend/lib/s6MailCampaign.js";
import { S6_AUDIENCES, buildS6SeasonEmail } from "../backend/lib/emailTemplates.js";
import { getResendClient, sendLoopEmail, sendViaResend } from "../backend/lib/emailService.js";
import { unsubscribeUrlForStage } from "../backend/lib/emailUnsubUrl.js";
import { normalizeHoldoutFraction } from "../backend/lib/emailHoldout.js";

const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes("--execute");
const RATE_LIMIT_MS = Number(process.env.WINBACK_RATE_LIMIT_MS) || 600;

function fail(msg) {
  console.error(`FEJL: ${msg}`);
  process.exit(1);
}

function argValue(flag) {
  const index = ARGV.indexOf(flag);
  if (index === -1) return undefined;
  const value = ARGV[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} kraever en vaerdi.`);
  return value;
}

const TEST_TO = argValue("--test-to");
const EDITION = argValue("--edition") ?? S6_MAIL_DEFAULT_EDITION;
let HOLDOUT = 0;
try {
  HOLDOUT = normalizeHoldoutFraction(argValue("--holdout"));
} catch (err) {
  fail(`--holdout: ${err.message}.`);
}

if (EXECUTE && ARGV.includes("--dry-run")) fail("--dry-run og --execute kan ikke kombineres.");
if (TEST_TO !== undefined && (EXECUTE || ARGV.includes("--dry-run"))) {
  fail("--test-to kan ikke kombineres med --execute eller --dry-run.");
}
if (TEST_TO !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TEST_TO)) fail("--test-to kraever en gyldig e-mailadresse.");
if (!isKnownS6MailEdition(EDITION)) fail(`ukendt --edition; kendte: ${S6_MAIL_EDITIONS.join(", ")}.`);

const MODE = EXECUTE ? "execute" : TEST_TO !== undefined ? "test" : "dry_run";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`mangler env-variabel ${name} (koer via infisical run --env=prod -- ...).`);
  return value;
}

let supabaseClient = null;
function supabase() {
  supabaseClient ??= createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_KEY"), {
    auth: { persistSession: false },
  });
  return supabaseClient;
}

// ── DB reads (all read-only) ─────────────────────────────────────────────

async function loadInputs() {
  const db = supabase();
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
  const userIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))];
  const users = await fetchAllRowsChunkedIn(userIds, (chunk) =>
    db.from("users").select("id, email, last_seen, language, consent_preferences, email_prefs").in("id", chunk).order("id")
  );
  const [campaignRows, suppressionRows] = await Promise.all([
    fetchAllRows(() =>
      db.from("email_log").select("user_id, email_type, dedupe_key, status").eq("email_type", S6_MAIL_EMAIL_KIND).order("id")
    ),
    fetchAllRows(() =>
      db.from("email_log").select("user_id, email_type, dedupe_key, status").in("status", ["bounced", "complained"]).order("id")
    ),
  ]);
  return { teams, users, emailLogRows: [...campaignRows, ...suppressionRows] };
}

async function readSendEnabled() {
  const { data, error } = await supabase().from("app_config").select("value").eq("key", S6_MAIL_APP_CONFIG_KEY).maybeSingle();
  if (error) fail(`kunne ikke laese app_config.${S6_MAIL_APP_CONFIG_KEY}: ${error.message}`);
  return data?.value === true;
}

async function readFreshUser(userId) {
  const { data, error } = await supabase()
    .from("users")
    .select("id, last_seen, consent_preferences, email_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`consent re-check failed: ${error.message}`);
  return data ?? null;
}

// ── sends ────────────────────────────────────────────────────────────────

async function sendEmail(candidate, dedupeKey) {
  const unsubscribeUrl = unsubscribeUrlForStage({ userId: candidate.userId, secret: process.env.EMAIL_UNSUB_SECRET, stage: "on" });
  const { subject, html, text } = buildS6SeasonEmail({
    edition: EDITION,
    audience: candidate.audience,
    language: candidate.language,
    teamName: candidate.teamName,
    unsubscribeUrl,
    subjectVariant: S6_MAIL_SUBJECT_VARIANT,
  });
  return sendLoopEmail({
    supabase: supabase(),
    userId: candidate.userId,
    teamId: candidate.teamId,
    type: S6_MAIL_EMAIL_KIND,
    dedupeKey,
    to: candidate.email,
    subject,
    html,
    text,
    unsubscribeUrl,
    stage: "on",
  });
}

const TEST_RUN_ID = Date.now().toString(36);

async function sendTestEmail({ to, audience, language, edition, subjectVariant }) {
  // No secret on purpose: the dry-run token can never be verified, so a
  // click in a test mail unsubscribes nobody.
  const unsubscribeUrl = unsubscribeUrlForStage({ userId: "test", secret: undefined, stage: "dry_run" });
  const { subject, html, text } = buildS6SeasonEmail({ edition, audience, language, unsubscribeUrl, subjectVariant });
  const { error } = await sendViaResend({
    resend: getResendClient(),
    to,
    subject: `[TEST ${audience}/${language}] ${subject}`,
    html,
    text,
    unsubscribeUrl,
    // A fresh key per run: Resend's idempotency window would otherwise drop
    // a second test run within 24 hours.
    dedupeKey: `s6-test:${edition}:${audience}-${language}:${TEST_RUN_ID}`,
  });
  if (error) throw new Error(error.message ?? String(error));
  return { status: "sent" };
}

// ── report ───────────────────────────────────────────────────────────────

function printDistribution(result) {
  console.log(`Udgave: ${result.edition} · emne ${S6_MAIL_SUBJECT_VARIANT.toUpperCase()}`);
  console.log(`Modtagere (menneskehold, email_marketing=true, ikke afmeldt/bounced, ikke allerede sendt): ${result.total}`);
  console.log("");
  console.log(`  ${"gruppe".padEnd(10)} ${"EN".padStart(6)} ${"DA".padStart(6)}`);
  for (const audience of S6_AUDIENCES) {
    const row = result.distribution[audience];
    console.log(`  ${audience.padEnd(10)} ${String(row.en).padStart(6)} ${String(row.da).padStart(6)}`);
  }
  if (result.holdoutTotal !== undefined) {
    console.log(`\nKontrolgruppe (andel ${result.holdoutFraction}, faar IKKE mailen): ${result.holdoutTotal}`);
    for (const audience of S6_AUDIENCES) {
      const row = result.holdoutDistribution[audience];
      console.log(`  ${audience.padEnd(10)} ${String(row.en).padStart(6)} ${String(row.da).padStart(6)}`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  if (MODE === "test") requireEnv("RESEND_API_KEY");
  if (MODE === "execute") {
    requireEnv("RESEND_API_KEY");
    requireEnv("EMAIL_UNSUB_SECRET");
  }

  const result = await runS6Mail({
    mode: MODE,
    edition: EDITION,
    holdoutFraction: HOLDOUT,
    loadInputs,
    testTo: TEST_TO,
    sendTestEmail,
    readSendEnabled,
    readFreshUser,
    sendEmail,
    rateLimitMs: RATE_LIMIT_MS,
    log: (line) => console.error(line),
  });

  if (result.mode === "dry_run") {
    console.log("Mode: DRY-RUN (ingen mails, ingen skrivning)\n");
    printDistribution(result);
    process.exit(0);
  }

  if (result.mode === "test") {
    console.log("Mode: TEST (en mail pr. gruppe og sprog til den angivne adresse, ingen email_log)\n");
    console.log(`Faerdig. sendt=${result.sent} failed=${result.failed} (total ${result.total})`);
    process.exit(result.failed > 0 ? 1 : 0);
  }

  console.log("Mode: EXECUTE\n");
  if (result.refused) {
    printDistribution(result);
    fail(
      `app_config.${S6_MAIL_APP_CONFIG_KEY} er ikke true -- afsendelse er slukket. ` +
        "Ejeren flipper noeglen i Supabase efter at have godkendt teksten, foer denne kommando koeres igen."
    );
  }
  printDistribution(result);
  console.log(`\nFaerdig. sendt=${result.sent} skipped=${result.skipped} failed=${result.failed} (total ${result.total})`);
  process.exit(0);
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
