#!/usr/bin/env node
// endSeasonS2.mjs — generalprøve/cutover-script til S2→S3-skiftet 23/8 2026 (#4131 generalprøve, refs #3645 #4129).
//
// Spejler POST /api/admin/seasons/:id/end (backend/routes/api.js:9937) 1:1 for en
// vilkårlig sæson-id, fordi cutover-sessionen kører season-end server-side i
// stedet for over HTTP (samme begrundelse som forgængeren, se
// .claude/learnings/2026-05-26-manual-season-flow-engine-divergence.md).
// Ændres endpointet, DIFF dette script mod det igen før næste cutover — kopiér
// IKKE blindt.
//
// Bygget ved at kopiere backend/scripts/endSeason-2026-07-26-s1.mjs og
// diffe linje for linje mod den nuværende /admin/seasons/:id/end (23/8):
//
//   1. #2847-claimet (season_end_claims, claimSeasonEndOrReject) er nyt siden
//      26/7-scriptet — TILFØJET her. Uden det kan scriptet ikke skelnes fra
//      en samtidig UI-klik, og en dobbelt-POST-beskyttelse mangler.
//   2. Sæson 0-specialcasen ("skip processSeasonEnd") er bevaret fra endpointet
//      for parameter-fidelitet, men er ikke relevant for S2 (season.number=2).
//   3. Pending-race-results-tjekket bruger her (som i 26/7-scriptet) et
//      SQL-join i stedet for `.in()` over race-UUID'er — samme PostgREST-
//      gateway-URL-grænse (#3030/#3031) rammes ved S2's ~455 løb. Semantikken
//      er identisk med endpointets `.in(raceIds)`.
//   4. Alt andet (ensureSeasonStandings → updateStandings → processSeasonEnd →
//      status='completed' → logActivity → Discord → emitSeasonEndedNotifications)
//      er linje-for-linje samme rækkefølge og samme fejlhåndtering som endpointet.
//
// Default = dry-run (ingen writes). Tilføj --execute for rigtig kørsel.
//   pwsh -File scripts/with-staging.ps1 -Command @("node","scripts/endSeasonS2.mjs","--season-id","00000000-0000-0000-0000-000000000002")
//   pwsh -File scripts/with-staging.ps1 -Command @("node","scripts/endSeasonS2.mjs","--season-id","00000000-0000-0000-0000-000000000002","--execute")
//
// Prod (i aften, ejer-gated): brug UI-knappen "⏹ Afslut" på /admin/season, ikke
// dette script — scriptet er bygget til generalprøven mod staging, hvor UI'et
// ikke er forbundet. Se docs/2026-08-23-cutover-drejebog.md.

import { createClient } from "@supabase/supabase-js";
import { processSeasonEnd, updateStandings } from "../lib/economyEngine.js";
import { ensureSeasonStandings } from "../lib/seasonStandingsBootstrap.js";
import { assessSeasonEndBlockers } from "../lib/seasonTransitionReadiness.js";
import { emitSeasonEndedNotifications } from "../lib/seasonTransition.js";
import { notifySeasonEvent } from "../lib/discordNotifier.js";
// NB: claimSeasonEndOrReject bor i routes/api.js, som er hele Express-routeren
// (tung top-level import, Express-`res`-bundet API). I stedet for at importere
// hele filen for én funktion, spejler dette script kun selve claim-INSERTet
// (samme tabel, samme unique-constraint-håndtering, se Gate 4 nedenfor).

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const seasonIdFlagIdx = argv.indexOf("--season-id");
const SEASON_ID = seasonIdFlagIdx >= 0 ? argv[seasonIdFlagIdx + 1] : "00000000-0000-0000-0000-000000000002";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via with-staging.ps1 eller infisical run --env=prod.");
  process.exit(1);
}
const supabase = createClient(url, key);

console.log(`\n${"═".repeat(72)}`);
console.log(`AFSLUT SÆSON (${SEASON_ID}) ${EXECUTE ? "🔴 EXECUTE (skriver)" : "🟢 DRY-RUN (kun gates, ingen writes)"}`);
console.log(`${"═".repeat(72)}`);

const today = new Date().toISOString().slice(0, 10);

// ── Gate 1: sæsonen skal være aktiv (spejler endpoint) ──
const { data: season, error: seasonError } = await supabase
  .from("seasons").select("*").eq("id", SEASON_ID).single();
if (seasonError || !season) {
  console.error(`❌ Sæson ikke fundet: ${seasonError?.message}`);
  process.exit(1);
}
if (season.status !== "active") {
  console.error(`❌ Kun aktive sæsoner kan afsluttes (status='${season.status}')`);
  process.exit(1);
}
console.log(`Sæson #${season.number} (${SEASON_ID}) status='${season.status}'`);

// ── Gate 2: ingen afventende løbsresultater (join-variant, se topkommentar pkt. 3) ──
const { count: pendingCount, error: pendingError } = await supabase
  .from("pending_race_results")
  .select("id, races!inner(season_id)", { count: "exact", head: true })
  .eq("status", "pending")
  .eq("races.season_id", SEASON_ID);
if (pendingError) {
  console.error(`❌ pending-tjek fejlede: ${pendingError.message}`);
  process.exit(1);
}
if ((pendingCount || 0) > 0) {
  console.error(`❌ ${pendingCount} afventende løbsresultater i sæsonen — STOP`);
  process.exit(1);
}
console.log(`Pending race results: 0 ✅`);

// ── Gate 3: #2805-spærren (uafviklede løb) — samme kald som endpointet ──
const seasonEndBlockers = await assessSeasonEndBlockers({ supabase, seasonId: SEASON_ID });
if (seasonEndBlockers.blocked) {
  console.error(`❌ #2805-spærre: ${seasonEndBlockers.detail}`);
  console.error(`   unfinished_races: ${JSON.stringify(seasonEndBlockers.unfinished_races)}`);
  process.exit(1);
}
console.log(`#2805-spærre: grøn ✅`);

if (!EXECUTE) {
  console.log(`\n🟢 Dry-run færdig — alle gates grønne. Kør med --execute.`);
  process.exit(0);
}

// ── Gate 4 (#2847): atomisk claim mod concurrent dobbelt-kørsel — spejler
//    claimSeasonEndOrReject, men uden et Express `res`-objekt at skrive til.
const { error: claimError } = await supabase
  .from("season_end_claims")
  .insert({ season_id: SEASON_ID });
if (claimError) {
  if (claimError.code === "23505") {
    console.error(`❌ #2847: season end already claimed for ${SEASON_ID} (season_end_already_claimed)`);
    process.exit(1);
  }
  console.error(`❌ season_end_claims insert fejlede: ${claimError.message}`);
  process.exit(1);
}
console.log(`#2847-claim: taget ✅`);

// ── Kørsel (samme rækkefølge som endpointet) ──
if (season.number === 0) {
  console.log(`→ Sæson 0: springer processSeasonEnd over (spejler endpointets specialcase) ...`);
} else {
  console.log(`→ ensureSeasonStandings ...`);
  await ensureSeasonStandings(supabase, SEASON_ID);
  console.log(`→ updateStandings ...`);
  await updateStandings(SEASON_ID);
  console.log(`→ processSeasonEnd (board-eval + divisionsbonusser + op/nedrykning) ...`);
  await processSeasonEnd(SEASON_ID);
}

console.log(`→ seasons.status='completed' ...`);
const { data: endedSeason, error: endError } = await supabase
  .from("seasons")
  .update({ status: "completed", end_date: season.end_date || today })
  .eq("id", SEASON_ID)
  .select("*")
  .single();
if (endError) {
  console.error(`❌ status-update fejlede: ${endError.message}`);
  process.exit(1);
}

// logActivity("season_ended", ...) — samme insert som api.js' logActivity-helper.
try {
  await supabase.from("activity_feed").insert({
    type: "season_ended",
    team_id: null, team_name: null, rider_id: null, rider_name: null, amount: null,
    meta: { season_id: season.id, season_number: season.number },
  });
} catch { /* silent — never block main flow (spejler endpointet) */ }

console.log(`→ Discord-broadcast (staging: blankes af with-staging.ps1's live-guard) ...`);
try {
  await notifySeasonEvent({ type: "season_ended", seasonNumber: season.number });
} catch (e) {
  console.error(`   (Discord-broadcast fejlede blødt: ${e?.message})`);
}

console.log(`→ season_ended in-app-notifikationer (#2745/#2924) ...`);
let seasonEndedNotifications = { skipped: true, reason: "failed" };
try {
  seasonEndedNotifications = await emitSeasonEndedNotifications({
    supabase,
    endedSeason: { id: endedSeason.id, number: endedSeason.number },
  });
} catch (notifErr) {
  console.error(`   season_ended notifications fejlede: ${notifErr?.message || notifErr}`);
}

console.log(`\n✅ Sæson ${endedSeason.number} afsluttet (end_date=${endedSeason.end_date})`);
console.log(JSON.stringify({ success: true, season_id: endedSeason.id, number: endedSeason.number, season_ended_notifications: seasonEndedNotifications }, null, 2));
