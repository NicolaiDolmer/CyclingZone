#!/usr/bin/env node
// backend/scripts/sendDiscordInviteBackfill.mjs
// ============================================================================
// #2761 — DISCORD-INVITATION I INDBAKKEN, BACKFILL TIL EKSISTERENDE MANAGERE.
//
// Ejer-direktiv 20/7: "Kan vi lave det til en del af onboardingen at alle
// managers får en besked i indbakken, om at tilmelde sig discord kanalen? +
// Et link dertil". Onboarding-hooket for NYE hold findes allerede
// (discordWelcomeSweep.js, #5130, ejer-direktiv 10/9) — det sweeper ALLE hold
// hvor teams.discord_welcome_sent_at er NULL, uanset alder, så et hold der
// findes i dag og aldrig har fået beskeden allerede er kandidat der.
//
// DETTE script dækker et andet hul: den sweep er hold-baseret
// (teams.discord_welcome_sent_at). Dette script er BRUGER-baseret — det
// fanger managere hvor kontoen (users.discord_id) aldrig blev linket, uanset
// hvorfor holdets egen markering ser sendt ud (fx et tidligere holdskifte,
// eller en fremtidig OAuth-tilknytning der reelt beviser at beskeden er
// unødvendig). To uafhængige signaler, to uafhængige stier — se #2161 for
// Discord OAuth-connect, som denne besked er broen indtil.
//
// UDSENDELSE ER EJER-GATED. Scriptet skriver INTET uden --execute, og
// orkestratoren kører det først når ejeren har sagt "kør".
//
// TYPE = discord_welcome (GENBRUGT — importeret fra
// backend/lib/discordWelcomeNotification.js, IKKE dupliceret). Samme type
// som sweepen bruger; NotificationsPage.jsx' TYPE_CONFIG kender den allerede
// (ikon + CTA-link til DISCORD_INVITE_URL), og notifications_type_check
// kræver ingen ny værdi. Dette script ÆNDRER hverken
// discordWelcomeSweep.js eller teams.discord_welcome_sent_at.
//
// DEDUPE. To lag:
//   1. Segment: kun menneskehold (applyHumanTeamFilter — ikke ai/bank/frozen/
//      test) hvor brugeren MANGLER discord_id.
//   2. Idempotens: en bruger med EN HVILKEN SOM HELST eksisterende
//      notifications-række af type discord_welcome (uanset om den stammer fra
//      sweepen eller en tidligere kørsel af DETTE script) er allerede dækket
//      og springes over. Nye rækker dette script skriver tagges desuden med
//      metadata.backfill = BACKFILL_TAG ("2026-09"), så en genkørsel/audit kan
//      skelne backfill-afsendte rækker fra sweep-afsendte — men selve
//      dedupe-tjekket er bevidst BREDERE end tagget (type alene), for en
//      bruger der allerede har fået sweepens organiske velkomst skal ALDRIG
//      få den igen, tag eller ej.
//
// SPROG. Notifikationens fallback-tekst (title/message i selve rækken) er
// altid engelsk (samme kontrakt som resten af notifyUser-økosystemet,
// #4734/buildKeyedNotification: DEFAULT_LANGUAGE) — frontend gen-rendrer på
// modtagerens users.language ud fra metadata.{titleCode,messageCode}
// (backendMessage.js). users.language bruges HER kun til rapportering (EN
// vs. DA-fordeling i dry-run-output og PR-body), ikke til at vælge hvilken
// tekst der skrives i rækken.
//
// KOERSEL:
//   node backend/scripts/sendDiscordInviteBackfill.mjs --dry-run
//   node backend/scripts/sendDiscordInviteBackfill.mjs --execute
//
// --dry-run er default OG kan skrives eksplicit; kun --execute skriver.
// ============================================================================

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { applyHumanTeamFilter } from "../lib/humanTeamFilter.js";
import { buildDiscordWelcomeNotification, DISCORD_WELCOME_TYPE } from "../lib/discordWelcomeNotification.js";
import { notifyUser } from "../lib/notificationService.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";

export const BACKFILL_TAG = "2026-09";

/**
 * Parser argv. Dry-run er default; kun --execute skriver. `--execute` OG
 * `--dry-run` sammen er en modsigelse (CodeRabbit-fund) — flages i stedet for
 * stiltiende at lade --execute vinde, saa en operatoer-fejl aldrig utilsigtet
 * skriver til prod.
 */
export function parseArgs(argv) {
  const args = argv ?? [];
  const execute = args.includes("--execute");
  const dryRun = args.includes("--dry-run");
  return { execute, conflicting: execute && dryRun };
}

/** Menneskelige managers med konto → unikke user_id, stabil raekkefoelge. */
export function recipientIdsFromTeams(teams) {
  const seen = new Set();
  const ids = [];
  for (const team of teams ?? []) {
    const id = team?.user_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Brugere der mangler et linket Discord-id (segment-betingelsen fra #2761). */
export function usersMissingDiscordId(users) {
  return (users ?? []).filter((user) => user && !user.discord_id);
}

/**
 * Hvem mangler beskeden. `existing` er notifications-rækker af type
 * discord_welcome (fra sweepen ELLER en tidligere backfill-kørsel) — en
 * bruger med bare ÉN sådan række er allerede dækket, uanset metadata.
 */
export function pendingRecipients(recipientIds, existing) {
  const already = new Set((existing ?? []).filter((row) => row?.user_id).map((row) => row.user_id));
  return (recipientIds ?? []).filter((id) => !already.has(id));
}

/** EN/DA-fordeling blandt de endelige modtagere, til rapportering (ikke til at vælge tekst). */
export function splitByLanguage(users) {
  let en = 0;
  let da = 0;
  for (const user of users ?? []) {
    if (user?.language === "da") da += 1;
    else en += 1;
  }
  return { en, da };
}

/** Notifikationens indhold: samme payload som sweepen, mærket med backfill-tag. */
export function buildBackfillInvite() {
  const base = buildDiscordWelcomeNotification();
  return { ...base, metadata: { ...base.metadata, backfill: BACKFILL_TAG } };
}

// ── Koerslen ────────────────────────────────────────────────────────────────

async function main() {
  const { execute, conflicting } = parseArgs(process.argv.slice(2));
  if (conflicting) {
    console.error("--execute og --dry-run kan ikke bruges sammen. Vaelg én.");
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler i env.");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const teams = await fetchAllRows(() =>
    applyHumanTeamFilter(sb.from("teams").select("user_id"))
      .not("user_id", "is", null)
      .order("id", { ascending: true })
  );
  const teamUserIds = recipientIdsFromTeams(teams);

  const users = await fetchAllRowsChunkedIn(teamUserIds, (chunk) =>
    sb.from("users").select("id, discord_id, language").in("id", chunk).order("id", { ascending: true })
  );
  const missing = usersMissingDiscordId(users);
  const missingIds = missing.map((user) => user.id);

  const existing = await fetchAllRows(() =>
    sb
      .from("notifications")
      .select("user_id, metadata")
      .eq("type", DISCORD_WELCOME_TYPE)
      .order("id", { ascending: true })
  );
  const pendingIds = pendingRecipients(missingIds, existing);
  const pendingUsers = missing.filter((user) => pendingIds.includes(user.id));
  const { en, da } = splitByLanguage(pendingUsers);

  console.log(`Menneskehold (ikke ai/bank/frozen/test): ${teamUserIds.length}`);
  console.log(`Mangler discord_id:                      ${missingIds.length}`);
  console.log(`Har allerede discord_welcome/backfill:    ${missingIds.length - pendingIds.length}`);
  console.log(`Sendes til:                               ${pendingIds.length}  (EN ${en} · DA ${da})`);

  if (!execute) {
    console.log("DRY-RUN — intet er sendt. Koer med --execute naar ejeren har sagt til.");
    process.exit(0);
  }

  const invite = buildBackfillInvite();
  let delivered = 0;
  let deduped = 0;
  let failed = 0;
  for (const userId of pendingIds) {
    // Per-modtager try/catch (CodeRabbit-fund): notifyUser KAN kaste (fx et
    // lookup- eller insert-fejl fra Supabase) — uden dette stopper hele loopet
    // ved foerste fejl, og hverken leverings-opsummeringen eller post-verify
    // naas for de resterende modtagere. Samme moenster som
    // discordWelcomeSweep.js' per-hold try/catch.
    try {
      const result = await notifyUser({ supabase: sb, userId, ...invite });
      if (result?.delivered) delivered += 1;
      else if (result?.deduped) deduped += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`  notifyUser fejlede for ${userId}:`, err?.message || err);
    }
  }
  console.log(`Sendt: ${delivered} · dedupet: ${deduped} · fejlet: ${failed}`);

  // Post-verify: laes igen og tjek at ingen mangler.
  const after = await fetchAllRows(() =>
    sb
      .from("notifications")
      .select("user_id, metadata")
      .eq("type", DISCORD_WELCOME_TYPE)
      .order("id", { ascending: true })
  );
  const stillMissing = pendingRecipients(pendingIds, after);
  if (stillMissing.length || failed) {
    console.error(`Mangler stadig: ${stillMissing.length}. Koer scriptet igen.`);
    process.exit(1);
  }
  console.log("Alle modtagere har invitationen.");
}

// Kun main() naar filen KOERES, ikke naar en test importerer de rene
// funktioner ovenfor. realpathSync udligner symlinks/worktree-junctions.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  await main();
}
