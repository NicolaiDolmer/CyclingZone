#!/usr/bin/env node
// backend/scripts/dev/notifyTransition3746.mjs
// ============================================================================
// #3746 trin 7 / #3980 — ENGANGS-INDBAKKEBESKED TIL ALLE MANAGERS VED UDRULNING.
//
// HVORFOR. Tre uafhængige testere læste det nye prognose-bånd som det gamle
// floor-ceiling-bånd og oplevede trin 7 som en NEDGRADERING, indtil de så
// engangspanelet (#3980). Panelet fanger kun dashboard-besøg; denne besked
// lander i indbakken hos alle managere, også dem der går direkte til en
// rytterside eller sidder på mobil.
//
// HVAD DEN GØR. Én `admin_notice`-notifikation pr. menneskelig manager
// (teams.user_id, is_ai=false, is_test_account=false, is_bank=false).
// i18n via metadata.titleCode/messageCode (#666-mønstret); title/message er
// EN-fallback for legacy-renderere. Ingen link — beskeden ER indholdet, og
// dashboardets engangspanel viser før/efter-tallene (samme valg som
// feedbackInbox.js' admin_notice).
//
// IDEMPOTENS. Kørsler er sikre at gentage: modtagere der allerede HAR en
// notifikation med denne titleCode springes over (egen forespørgsel — vi kan
// ikke læne os op ad notifyUser's dedupe, hvis vindue er kort). Dry-run er
// default; --apply kræves for at skrive.
//
// KØRSEL (post-merge, som led i udrulningskæden i #3803/#3980):
//   node backend/scripts/dev/notifyTransition3746.mjs           # dry-run
//   node backend/scripts/dev/notifyTransition3746.mjs --apply   # send
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { notifyUser } from "../../lib/notificationService.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

const TITLE_CODE = "notif.admin.devTransition.title";
const MESSAGE_CODE = "notif.admin.devTransition.message";
const TITLE_EN = "The development view has changed";
const MESSAGE_EN =
  "Your riders have not changed. Abilities, ratings and results are exactly as yesterday. " +
  "The old range was floor to ceiling. The new range is your rider's projected level: where he realistically lands with your training. " +
  "Ceilings were raised for most riders at the same time, so a lower-looking range does not mean a weaker rider. " +
  "Potential now decides how fast a rider develops, not where he stops. Your dashboard shows your own riders before and after.";

const APPLY = process.argv.includes("--apply");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler i env.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const teams = await fetchAllRows(
  () => sb.from("teams")
    .select("user_id")
    .eq("is_ai", false)
    .eq("is_test_account", false)
    .eq("is_bank", false)
    .not("user_id", "is", null)
    .order("id", { ascending: true }),
);
const recipients = [...new Set(teams.map((t) => t.user_id))];

// Idempotens: alle der allerede har fået beskeden (matcher på titleCode i
// metadata — title-strengen kan ændre sig, koden er kontrakten).
const already = await fetchAllRows(
  () => sb.from("notifications")
    .select("user_id")
    .eq("type", "admin_notice")
    .eq("metadata->>titleCode", TITLE_CODE)
    .order("id", { ascending: true }),
);
const alreadySet = new Set(already.map((n) => n.user_id));
const pending = recipients.filter((u) => !alreadySet.has(u));

console.log(`Managere med hold: ${recipients.length} · har allerede beskeden: ${alreadySet.size} · vil modtage: ${pending.length}`);
if (!APPLY) {
  console.log("DRY-RUN — ingen skrivning. Kør igen med --apply for at sende.");
  process.exit(0);
}

let delivered = 0, deduped = 0, failed = 0;
for (const userId of pending) {
  const res = await notifyUser({
    supabase: sb,
    userId,
    type: "admin_notice",
    title: TITLE_EN,
    message: MESSAGE_EN,
    relatedId: null,
    metadata: {
      titleCode: TITLE_CODE,
      titleParams: {},
      messageCode: MESSAGE_CODE,
      messageParams: {},
    },
  });
  if (res.delivered) delivered += 1;
  else if (res.deduped) deduped += 1;
  else { failed += 1; console.error(`  ✖ ${userId}: ${res.reason || "ukendt fejl"}`); }
}

// Post-verify: læs tilbage og bekræft at alle modtagere nu har beskeden.
const after = await fetchAllRows(
  () => sb.from("notifications")
    .select("user_id")
    .eq("type", "admin_notice")
    .eq("metadata->>titleCode", TITLE_CODE)
    .order("id", { ascending: true }),
);
const afterSet = new Set(after.map((n) => n.user_id));
const missing = recipients.filter((u) => !afterSet.has(u));
console.log(`Sendt: ${delivered} · dedupet: ${deduped} · fejlet: ${failed} · post-verify mangler: ${missing.length}`);
process.exit(missing.length || failed ? 1 : 0);
