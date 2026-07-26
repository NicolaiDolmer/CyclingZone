#!/usr/bin/env node
// endSeason-2026-07-26-s1.mjs — ENGANGS-script til S1→S2-cutoveren 26/7 2026.
//
// Spejler POST /api/admin/seasons/:id/end (routes/api.js:7508) 1:1 for sæson 1,
// fordi cutover-sessionen kører season-end server-side via `railway run` i stedet
// for HTTP. Ændres endpointet, skal dette script IKKE genbruges — se
// .claude/learnings/2026-05-26-manual-season-flow-engine-divergence.md.
//
// Bevidst afvigelse fra endpointet: pending_race_results-tjekket bruger et
// SQL-join (to trin via PostgREST-filter på season_id) i stedet for .in() over
// 423 race-UUID'er — .in()-lister i den størrelse dør på gateway-URL-grænsen
// (#3030/#3031). Semantikken er identisk.
//
// Default = dry-run (ingen writes). Tilføj --execute for rigtig kørsel.
//   railway run --service CyclingZone -- node scripts/endSeason-2026-07-26-s1.mjs --execute

import { createClient } from "@supabase/supabase-js";
import { processSeasonEnd, updateStandings } from "../lib/economyEngine.js";
import { ensureSeasonStandings } from "../lib/seasonStandingsBootstrap.js";
import { assessSeasonEndBlockers } from "../lib/seasonTransitionReadiness.js";
import { emitSeasonEndedNotifications } from "../lib/seasonTransition.js";
import { notifySeasonEvent } from "../lib/discordNotifier.js";

const SEASON_ID = "00000000-0000-0000-0000-000000000001";
const EXECUTE = process.argv.includes("--execute");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via `railway run`.");
  process.exit(1);
}
const supabase = createClient(url, key);

console.log(`\n${"═".repeat(72)}`);
console.log(`AFSLUT SÆSON 1 ${EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (kun gates, ingen writes)"}`);
console.log(`${"═".repeat(72)}`);

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

// ── Gate 2: ingen afventende løbsresultater (join-variant, se topkommentar) ──
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
  process.exit(1);
}
console.log(`#2805-spærre: grøn ✅`);

if (!EXECUTE) {
  console.log(`\n🟢 Dry-run færdig — alle gates grønne. Kør med --execute.`);
  process.exit(0);
}

// ── Kørsel (samme rækkefølge som endpointet, sæson ≥ 1-grenen) ──
const today = new Date().toISOString().slice(0, 10);

console.log(`\n→ ensureSeasonStandings ...`);
await ensureSeasonStandings(supabase, SEASON_ID);
console.log(`→ updateStandings ...`);
await updateStandings(SEASON_ID);
console.log(`→ processSeasonEnd (board-eval + divisionsbonusser + movement-gate #2851) ...`);
await processSeasonEnd(SEASON_ID);

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

console.log(`→ Discord-broadcast ...`);
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
