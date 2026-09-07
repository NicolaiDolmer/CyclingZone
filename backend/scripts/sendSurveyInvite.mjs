#!/usr/bin/env node
// backend/scripts/sendSurveyInvite.mjs
// ============================================================================
// #4943 — INDBAKKE-INVITATION TIL ET IN-APP SPOERGESKEMA.
//
// Ejer-beslutning 7/9: spoergeskemaet bygges i spillet i stedet for Google
// Forms. Denne besked er den ene udsendelse der faktisk faar folk derhen;
// dashboard-kortet fanger dem der alligevel logger ind.
//
// UDSENDELSE ER EJER-GATED. Scriptet skriver INTET uden --apply, og
// orkestratoren koerer det foerst naar ejeren har sagt "koer" ordret.
//
// TYPE = admin_notice, ikke en ny notifikationstype. Constrainten paa
// notifications.type, NOTIFICATION_TYPES og NotificationsPage' TYPE_CONFIG
// er tre steder der skal aendres i takt (og tre parity-tests der fejler hvis
// de ikke goer). Linket til skemaet baeres i stedet af metadata.surveySlug,
// som resolveNotificationLink oversaetter til /survey/<slug> (#4943) — samme
// moenster som #4557's aarsmoede-regel.
//
// IDEMPOTENS. Koersler er sikre at gentage: en modtager der allerede har en
// admin_notice med metadata.surveySlug = <slug> springes over. Vi laener os
// IKKE paa notifyUser's dedupe-vindue (24 timer), som ville sende igen paa
// dag to.
//
// MODTAGERE. Menneskelige managers med en konto: teams hvor is_ai = false,
// is_test_account = false, is_bank = false og user_id ikke er null. Samme
// afgraensning som backend/scripts/dev/notifyTransition3746.mjs.
//
// KOERSEL:
//   node backend/scripts/sendSurveyInvite.mjs --survey 2026-09-features --dry-run
//   node backend/scripts/sendSurveyInvite.mjs --survey 2026-09-features --apply
//
// --dry-run er default OG kan skrives eksplicit; kun --apply skriver.
//
// `.limit(1)` + `[0]` frem for `.maybeSingle()`: scope'et ER unikt (surveys.slug er UNIQUE),
// men check-maybesingle-unique-scope.mjs kan ikke opløse en tabel der ikke
// findes i database/schema-snapshot.json endnu, og den fejler loudly frem for
// at springe over (#4496). Tabellerne oprettes af denne PRs egen migration;
// snapshottet får dem først ved næste refresh efter merge.
// ============================================================================

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { buildKeyedNotification, notifyUser } from "../lib/notificationService.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

export const NOTIFICATION_TYPE = "admin_notice";
export const TITLE_CODE = "notif.admin.survey.title";
export const MESSAGE_CODE = "notif.admin.survey.message";

/** Parser argv. Dry-run er default; kun --apply skriver. */
export function parseArgs(argv) {
  const args = argv ?? [];
  const surveyIndex = args.indexOf("--survey");
  const slugFromFlag = surveyIndex >= 0 ? args[surveyIndex + 1] : null;
  const slug = slugFromFlag && !slugFromFlag.startsWith("--") ? slugFromFlag : null;
  return { slug, apply: args.includes("--apply") };
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

/**
 * Hvem mangler beskeden. `existing` er notifications-raekker med metadata;
 * en raekke taeller kun hvis dens surveySlug matcher det skema vi sender for,
 * saa en invitation til ET skema ikke undertrykker invitationen til det naeste.
 */
export function pendingRecipients(recipientIds, existing, slug) {
  const already = new Set(
    (existing ?? [])
      .filter((row) => row?.metadata?.surveySlug === slug && row?.user_id)
      .map((row) => row.user_id)
  );
  return (recipientIds ?? []).filter((id) => !already.has(id));
}

/** Notifikationens indhold: EN-fallback i raekken, i18n-koder i metadata. */
export function buildInvite(slug) {
  const { title, message, metadata } = buildKeyedNotification({
    titleCode: TITLE_CODE,
    messageCode: MESSAGE_CODE,
    metadata: { surveySlug: slug },
  });
  return { type: NOTIFICATION_TYPE, title, message, metadata };
}

// ── Koerslen ────────────────────────────────────────────────────────────────

async function main() {
  const { slug, apply } = parseArgs(process.argv.slice(2));
  if (!slug) {
    console.error("Brug: node backend/scripts/sendSurveyInvite.mjs --survey <slug> [--dry-run|--apply]");
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler i env.");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: surveyRows, error: surveyError } = await sb
    .from("surveys")
    .select("id, slug, status")
    .eq("slug", slug)
    .limit(1);
  const survey = surveyRows?.[0] ?? null;
  if (surveyError) {
    console.error("Kunne ikke laese skemaet:", surveyError.message);
    process.exit(1);
  }
  if (!survey) {
    console.error(`Intet skema med slug "${slug}".`);
    process.exit(1);
  }
  // Et lukket eller ikke-aabnet skema maa ikke inviteres til: modtagerne ville
  // lande paa tak-fladen uden at kunne svare.
  if (survey.status !== "open") {
    console.error(`Skemaet "${slug}" har status "${survey.status}". Saet det til "open" foer du inviterer.`);
    process.exit(1);
  }

  const teams = await fetchAllRows(() =>
    sb
      .from("teams")
      .select("user_id")
      .eq("is_ai", false)
      .eq("is_test_account", false)
      .eq("is_bank", false)
      .not("user_id", "is", null)
      .order("id", { ascending: true })
  );
  const recipients = recipientIdsFromTeams(teams);

  const existing = await fetchAllRows(() =>
    sb
      .from("notifications")
      .select("user_id, metadata")
      .eq("type", NOTIFICATION_TYPE)
      .eq("metadata->>surveySlug", slug)
      .order("id", { ascending: true })
  );
  const pending = pendingRecipients(recipients, existing, slug);

  console.log(`Skema:      ${survey.slug} (${survey.status})`);
  console.log(`Modtagere:  ${recipients.length}`);
  console.log(`Har den:    ${recipients.length - pending.length}`);
  console.log(`Sendes til: ${pending.length}`);

  if (!apply) {
    console.log("DRY-RUN — intet er sendt. Koer med --apply naar ejeren har sagt til.");
    process.exit(0);
  }

  const invite = buildInvite(slug);
  let delivered = 0;
  let deduped = 0;
  let failed = 0;
  for (const userId of pending) {
    const result = await notifyUser({ supabase: sb, userId, ...invite });
    if (result?.delivered) delivered += 1;
    else if (result?.deduped) deduped += 1;
    else failed += 1;
  }
  console.log(`Sendt: ${delivered} · dedupet: ${deduped} · fejlet: ${failed}`);

  // Post-verify: laes igen og tjek at ingen mangler.
  const after = await fetchAllRows(() =>
    sb
      .from("notifications")
      .select("user_id, metadata")
      .eq("type", NOTIFICATION_TYPE)
      .eq("metadata->>surveySlug", slug)
      .order("id", { ascending: true })
  );
  const stillMissing = pendingRecipients(recipients, after, slug);
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
