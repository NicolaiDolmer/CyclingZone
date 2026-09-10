#!/usr/bin/env node
// backend/scripts/dev/notifyRetirement2748.mjs
// ============================================================================
// #2748 pension-minimum — INDBAKKEBESKED VED SÆSONSTART TIL RAMTE HOLD.
//
// HVORFOR. Rytterprofilens nye "finalSeason"-banner (StatusBanner,
// RiderProfileHero.jsx) fanger kun managere der besøger den specifikke
// rytters side. Denne besked lander i indbakken hos ethvert menneske-hold der
// har mindst én rytter, hvis pension nu er ANNONCERET for den aktive sæson —
// også dem der ikke tjekker enkelt-rytterne.
//
// HVAD DEN GØR. Én `admin_notice`-notifikation PR. RAMT HOLD (ikke pr.
// rytter), aggregeret: "N of your riders announced this is their final
// season: [navne]. They retire when season S ends." i18n via
// metadata.titleCode/messageCode (#666-mønstret, notif.admin.
// retirementAnnounced, backendMessages.json). Ingen link — beskeden ER
// indholdet, ligesom notifyTransition3746.mjs's admin_notice.
//
// DETERMINISME. Bruger den SAMME selektor som rytterprofilens banner
// (resolveNoticeFromRow, backend/lib/retirementNotice.js) — ingen ny
// beslutningslogik her, kun aggregering + levering pr. hold.
//
// #5073: varslet er en GEMT kendsgerning (riders.retirement_notice_*), ikke et
// rul der køres forfra. Denne fil læste tidligere announcedRetirementAfterSeason
// direkte og var dermed en TREDJE kanal med sit eget svar: efter
// reparations-kørslen (scripts/ops/retirement-notice-freeze-5073.mjs, kilde
// legacy) ville indbakkebeskeden sige det modsatte af både banneret og cutover
// for de 58 ryttere hvor #4990 flyttede rullet 7/9. Nu læses kolonnen med SAMME
// sæson-nøgle som banneret (den aktive sæson). Findes der ingen frysning for en
// rytter, falder resolveNoticeFromRow tilbage på den gældende beregning —
// præcis som før — men scriptet SKRIVER aldrig selv: en frysning hører til på
// visnings-stien og i ops-kørslen, ikke i en notifikations-sweep.
//
// IDEMPOTENS. Kørsler er sikre at gentage: idempotens er PR. (bruger, sæson)
// — en manager der allerede har fået beskeden FOR DENNE SÆSON springes over
// (egen forespørgsel på metadata->>season, samme princip som
// notifyTransition3746.mjs — vi kan ikke læne os op ad notifyUser's dedupe,
// hvis vindue er kort OG kun matcher på identisk title/message). Dry-run er
// default; --apply kræves for at skrive.
//
// KØRSEL (post-merge, ved/efter søndagens S3-cutover — se
// docs/NIGHT_WAVE_RUNBOOK.md / cutover-drejebogen for rækkefølgen):
//   node backend/scripts/dev/notifyRetirement2748.mjs           # dry-run
//   node backend/scripts/dev/notifyRetirement2748.mjs --apply   # send
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { notifyUser } from "../../lib/notificationService.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { RETIREMENT_NOTICE_COLUMNS, resolveNoticeFromRow } from "../../lib/retirementNotice.js";

const TITLE_CODE = "notif.admin.retirementAnnounced.title";
const MESSAGE_CODE = "notif.admin.retirementAnnounced.message";

const APPLY = process.argv.includes("--apply");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler i env.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { data: season, error: seasonError } = await sb
  .from("seasons").select("number").eq("status", "active").maybeSingle();
if (seasonError || !season?.number) {
  console.error("Kunne ikke hente den aktive sæson.", seasonError?.message ?? "");
  process.exit(1);
}
const seasonNumber = season.number;

const teams = await fetchAllRows(
  () => sb.from("teams")
    .select("id, user_id")
    .eq("is_ai", false)
    .eq("is_test_account", false)
    .eq("is_bank", false)
    .not("user_id", "is", null)
    .order("id", { ascending: true }),
);
const humanTeamIds = new Set(teams.map((t) => t.id));
const userIdByTeamId = new Map(teams.map((t) => [t.id, t.user_id]));

const riders = await fetchAllRows(
  // #5073: varsel-kolonnerne SKAL med — uden dem falder resolveNoticeFromRow
  // tilbage på et nyt rul, og beskeden ville kunne modsige rytterkortet.
  // schema-columns-ok: retirement_notice_season/-after_season/-given_at
  // tilfoejes af database/2026-09-10-5073-retirement-notice-column.sql i SAMME
  // PR; snapshottet opdateres foerst efter merge.
  () => sb.from("riders")
    .select(`id, firstname, lastname, birthdate, team_id, ${RETIREMENT_NOTICE_COLUMNS}`)
    .eq("is_retired", false)
    .not("team_id", "is", null)
    .order("id", { ascending: true }),
);

const byTeam = new Map(); // team_id -> [navne]
let readFrozen = 0;
for (const r of riders) {
  if (!humanTeamIds.has(r.team_id)) continue;
  const notice = resolveNoticeFromRow(r, seasonNumber);
  if (notice.frozen) readFrozen += 1;
  if (!notice.announced) continue;
  const name = [r.firstname, r.lastname].filter(Boolean).join(" ") || r.id;
  if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
  byTeam.get(r.team_id).push(name);
}

console.log(`Aktiv sæson: ${seasonNumber} · ramte hold: ${byTeam.size}`);
console.log(`Varsel læst fra kolonnen (frosset): ${readFrozen} af ${riders.length} ryttere (#5073).`);
if (byTeam.size === 0) {
  console.log("Ingen hold har ryttere der pensioneres ved denne sæsons afslutning — intet at sende.");
  process.exit(0);
}

// Idempotens: hold der allerede har fået beskeden FOR DENNE SÆSON (matcher på
// titleCode + season i metadata — title-strengen kan ændre sig, koden+sæson
// er kontrakten).
const already = await fetchAllRows(
  () => sb.from("notifications")
    .select("user_id")
    .eq("type", "admin_notice")
    .eq("metadata->>titleCode", TITLE_CODE)
    .eq("metadata->>season", String(seasonNumber))
    .order("id", { ascending: true }),
);
const alreadySet = new Set(already.map((n) => n.user_id));

const pending = [...byTeam.entries()]
  .map(([teamId, names]) => ({ teamId, userId: userIdByTeamId.get(teamId), names }))
  .filter((row) => row.userId && !alreadySet.has(row.userId));

console.log(`Har allerede beskeden for sæson ${seasonNumber}: ${alreadySet.size} · vil modtage: ${pending.length}`);
if (!APPLY) {
  console.log("DRY-RUN — ingen skrivning. Kør igen med --apply for at sende.");
  for (const row of pending.slice(0, 20)) {
    console.log(`  · hold ${row.teamId}: ${row.names.length} rytter(e) — ${row.names.join(", ")}`);
  }
  if (pending.length > 20) console.log(`  … og ${pending.length - 20} flere hold.`);
  process.exit(0);
}

let delivered = 0, deduped = 0, failed = 0;
for (const row of pending) {
  const names = row.names.join(", ");
  const count = row.names.length;
  const titleEn = `Final season for ${count} of your riders`;
  const messageEn = `${count} of your riders announced this is their final season: ${names}. They retire when season ${seasonNumber} ends.`;
  const res = await notifyUser({
    supabase: sb,
    userId: row.userId,
    type: "admin_notice",
    title: titleEn,
    message: messageEn,
    relatedId: null,
    metadata: {
      titleCode: TITLE_CODE,
      titleParams: { count },
      messageCode: MESSAGE_CODE,
      messageParams: { count, names, season: seasonNumber },
      season: seasonNumber,
    },
  });
  if (res.delivered) delivered += 1;
  else if (res.deduped) deduped += 1;
  else { failed += 1; console.error(`  ✖ hold ${row.teamId} (${row.userId}): ${res.reason || "ukendt fejl"}`); }
}

// Post-verify: læs tilbage og bekræft at alle pending-modtagere nu har beskeden.
const after = await fetchAllRows(
  () => sb.from("notifications")
    .select("user_id")
    .eq("type", "admin_notice")
    .eq("metadata->>titleCode", TITLE_CODE)
    .eq("metadata->>season", String(seasonNumber))
    .order("id", { ascending: true }),
);
const afterSet = new Set(after.map((n) => n.user_id));
const missing = pending.filter((row) => !afterSet.has(row.userId));
console.log(`Sendt: ${delivered} · dedupet: ${deduped} · fejlet: ${failed} · post-verify mangler: ${missing.length}`);
process.exit(missing.length || failed ? 1 : 0);
