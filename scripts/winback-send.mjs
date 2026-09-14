#!/usr/bin/env node
// #2760 -- one-off win-back campaign for dormant, consenting managers.
// NOT a cron sweep: this script is meant to be run by hand a handful of
// times (owner window ca. 21-24/9), never on a schedule. All segment/dedupe
// logic lives in backend/lib/winbackSegment.js (pure, unit-tested against a
// fixture -- see winbackSegment.test.js); this file is I/O only: fetch prod,
// filter, print the report, and -- only with --execute AND the app_config
// gate below -- actually send via the existing #2725 Resend infrastructure
// (backend/lib/emailService.js's sendLoopEmail, same email_log bookkeeping,
// same unsubscribe flow, same Reply-To as welcome/day1/race_digest). --execute
// re-checks consent_preferences.email_marketing per recipient IMMEDIATELY
// before sending (CodeRabbit review, this PR) -- the candidate list is a
// snapshot from before the (rate-limited, potentially minutes-long) send
// loop started, and sendLoopEmail itself only re-checks the email_prefs
// opt-out, never the consent opt-in this whole campaign is gated on.
//
// BRUG:
//   # 1) maaling (default, INGEN mails, ingen email_log-skrivning):
//   infisical run --env=prod -- node scripts/winback-send.mjs --dry-run
//   infisical run --env=prod -- node scripts/winback-send.mjs --dry-run --verbose   (+ per-manager rows)
//
//   # 2) rigtig afsendelse -- KRAEVER app_config.winback_send_enabled = true
//   #    (database/2026-09-14-2760-winback-app-config.sql, default false).
//   #    Flip'es af ejeren i Supabase FOERST, efter godkendt mailtekst:
//   infisical run --env=prod -- node scripts/winback-send.mjs --execute
//
// Flag:
//   --dry-run    eksplicit maaling (default-adfaerd hvis intet flag gives)
//   --execute    send rigtige mails (kraever app_config-gaten, se ovenfor)
//   --verbose    (kun med --dry-run) print hver enkelt kandidat, ikke kun totaler
//
// ENV (Infisical, aldrig fra disk):
//   SUPABASE_URL          (paakraevet)
//   SUPABASE_SERVICE_KEY  (paakraevet) -- service_role, samme som andre ops-scripts
//   RESEND_API_KEY        (paakraevet KUN ved --execute, laest af sendLoopEmail)
//   EMAIL_UNSUB_SECRET    (paakraevet KUN ved --execute, laest af sendLoopEmail/unsubscribeUrlForStage)
//   WINBACK_RATE_LIMIT_MS (valgfri, default 600ms/mail -- se RATE-LIMIT nedenfor)
//
// RATE-LIMIT: ingen dokumenteret Resend-kvote fundet andetsteds i repoet, saa
// default (600ms mellem hvert send, ~1.6 mails/sekund) er en konservativ
// gaetteva/rdi valgt for at holde langt under enhver rimelig plan-kvote for et
// engangs-udsend paa ca. 100 mails -- ikke en maalt graense. Overstyr med
// WINBACK_RATE_LIMIT_MS hvis ejeren kender den faktiske Resend-plan-kvote.
//
// EXIT-CODES:
//   0 = koert (dry-run altid; execute naar mindst 0 forsoegt sendt uden fatal fejl)
//   1 = manglende env / ugyldige flag / winback_send_enabled != true ved --execute

import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../backend/lib/supabasePagination.js";
import {
  selectWinbackCandidates,
  distributionByLanguage,
  distributionByPool,
  winbackDedupeKey,
  WINBACK_EMAIL_TYPE,
} from "../backend/lib/winbackSegment.js";
import { buildWinbackEmail } from "../backend/lib/emailTemplates.js";
import { sendLoopEmail } from "../backend/lib/emailService.js";
import { unsubscribeUrlForStage } from "../backend/lib/emailUnsubUrl.js";

const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes("--execute");
const VERBOSE = ARGV.includes("--verbose");
const APP_CONFIG_KEY = "winback_send_enabled";
const RATE_LIMIT_MS = Number(process.env.WINBACK_RATE_LIMIT_MS) || 600;

function fail(msg) {
  console.error(`FEJL: ${msg}`);
  process.exit(1);
}

if (EXECUTE && ARGV.includes("--dry-run")) fail("--dry-run og --execute kan ikke kombineres.");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`mangler env-variabel ${name} (kør via infisical run --env=prod -- ...).`);
  return value;
}

const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_KEY"), {
  auth: { persistSession: false },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── DB reads (all read-only; mirrors emailRaceDigestSweep.js's shape) ──────

async function fetchHumanTeams() {
  return fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, user_id, is_ai, is_bank, is_test_account, is_frozen, league_division_id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_test_account", false)
      .eq("is_frozen", false)
      .not("user_id", "is", null)
      .order("id")
  );
}

async function fetchUsers(userIds) {
  if (!userIds.length) return [];
  return fetchAllRows(() =>
    supabase
      .from("users")
      .select("id, email, last_seen, language, consent_preferences, email_prefs")
      .in("id", userIds)
      .order("id")
  );
}

async function fetchWinbackLogRows() {
  return fetchAllRows(() =>
    supabase.from("email_log").select("user_id, email_type, status").eq("email_type", WINBACK_EMAIL_TYPE).order("id")
  );
}

async function fetchActiveSeasonStandings() {
  const { data: season, error: seasonErr } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
  if (seasonErr) fail(`kunne ikke hente aktiv saeson: ${seasonErr.message}`);
  if (!season?.id) return [];
  return fetchAllRows(() =>
    supabase.from("season_standings").select("team_id, rank_in_division, league_division_id").eq("season_id", season.id).order("id")
  );
}

async function fetchDivisions() {
  return fetchAllRows(() => supabase.from("league_divisions").select("id, label").order("id"));
}

async function readWinbackSendEnabled() {
  const { data, error } = await supabase.from("app_config").select("value").eq("key", APP_CONFIG_KEY).maybeSingle();
  if (error) fail(`kunne ikke laese app_config.${APP_CONFIG_KEY}: ${error.message}`);
  return data?.value === true;
}

// ── report ───────────────────────────────────────────────────────────────

function printReport(candidates) {
  console.log(`Kandidater (sovende 30+ dage, email_marketing=true, ikke tidligere kontaktet): ${candidates.length}`);
  console.log("");
  console.log("Fordeling pr. sprog:");
  for (const [lang, count] of Object.entries(distributionByLanguage(candidates))) {
    console.log(`  ${lang.padEnd(10)} ${count}`);
  }
  console.log("");
  console.log("Fordeling pr. pulje/division:");
  for (const [pool, count] of Object.entries(distributionByPool(candidates))) {
    console.log(`  ${pool.padEnd(20)} ${count}`);
  }
  if (VERBOSE) {
    console.log("");
    console.log("Kandidatliste:");
    for (const c of candidates) {
      const days = c.daysSinceLastSeen == null ? "aldrig set" : `${c.daysSinceLastSeen}d`;
      const pool = c.poolLabel ? `${c.poolLabel} (#${c.rankInDivision ?? "?"})` : "ingen standing";
      console.log(`  ${c.email.padEnd(32)} ${c.teamName?.padEnd(24) ?? ""} ${days.padEnd(12)} ${pool} [${c.language ?? "?"}]`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const teams = await fetchHumanTeams();
  const userIds = [...new Set(teams.map((t) => t.user_id))];
  const [users, emailLogRows, standings, divisions] = await Promise.all([
    fetchUsers(userIds),
    fetchWinbackLogRows(),
    fetchActiveSeasonStandings(),
    fetchDivisions(),
  ]);

  const candidates = selectWinbackCandidates({ teams, users, standings, divisions, emailLogRows });

  if (!EXECUTE) {
    console.log("Mode: DRY-RUN (ingen mails, ingen email_log-skrivning)\n");
    printReport(candidates);
    process.exit(0);
  }

  console.log("Mode: EXECUTE\n");
  const enabled = await readWinbackSendEnabled();
  if (!enabled) {
    fail(
      `app_config.${APP_CONFIG_KEY} er ikke sat til true -- afsendelse er slukket. ` +
        `Se database/2026-09-14-2760-winback-app-config.sql. Ejeren skal flippe noeglen ` +
        `i Supabase efter at have godkendt mailteksten i backend/lib/emailTemplates.js (buildWinbackEmail), ` +
        `foer denne kommando koeres igen.`
    );
  }
  requireEnv("RESEND_API_KEY");
  requireEnv("EMAIL_UNSUB_SECRET");

  console.log(`${candidates.length} kandidater klar til afsendelse (rate-limit ${RATE_LIMIT_MS}ms mellem hver).\n`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      // CodeRabbit review (this PR, #2760): selectWinbackCandidates ran
      // against a SNAPSHOT fetched before this loop started. sendLoopEmail
      // only re-checks email_prefs (opt-out) at send time, never
      // consent_preferences (the opt-in gate this campaign is built on) --
      // a manager who revokes email_marketing consent WHILE this one-off
      // (potentially long-running, rate-limited) script is mid-run must not
      // still receive the mail. Re-read the current value immediately
      // before sending, per recipient, and skip on anything but an explicit
      // true (NULL/false/revoked all read the same as "no consent", same
      // rule as winbackSegment.js's hasWinbackConsent).
      const { data: freshUser, error: consentErr } = await supabase
        .from("users").select("consent_preferences").eq("id", candidate.userId).maybeSingle();
      if (consentErr) throw new Error(`consent re-check failed: ${consentErr.message}`);
      if (freshUser?.consent_preferences?.email_marketing !== true) {
        skipped += 1;
        continue;
      }

      const unsubscribeUrl = unsubscribeUrlForStage({ userId: candidate.userId, secret: process.env.EMAIL_UNSUB_SECRET, stage: "on" });
      const { subject, html, text } = buildWinbackEmail({
        teamName: candidate.teamName,
        daysSinceLastSeen: candidate.daysSinceLastSeen,
        rankInDivision: candidate.rankInDivision,
        poolLabel: candidate.poolLabel,
        unsubscribeUrl,
        language: candidate.language,
      });
      const result = await sendLoopEmail({
        supabase,
        userId: candidate.userId,
        teamId: candidate.teamId,
        type: WINBACK_EMAIL_TYPE,
        dedupeKey: winbackDedupeKey(candidate.userId),
        to: candidate.email,
        subject,
        html,
        text,
        unsubscribeUrl,
        stage: "on",
      });
      // CodeRabbit review (this PR, #2760): sendLoopEmail returns
      // {status:"failed"} for a Resend provider failure (permanent or
      // exhausted-retry) -- that must count as `failed`, not `skipped`, or
      // the final report can print failed=0 while emails silently did not
      // go out.
      if (result?.status === "sent") sent += 1;
      else if (result?.status === "failed") failed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`  fejl for bruger ${candidate.userId}:`, err?.message || err);
    }
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\nFærdig. sendt=${sent} skipped=${skipped} failed=${failed} (total ${candidates.length})`);
  process.exit(0);
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
