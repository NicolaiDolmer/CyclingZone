#!/usr/bin/env node
// backend/scripts/dev/wipeSeason3Calendar.mjs
// #3546 — wipe af den EKSISTERENDE S3-kalender (nødvendig fordi materializeTierCalendars
// er en no-op når der allerede ligger løb for sæsonen: 430 races, 1.138 stage-profiler,
// 1.138 schedule-rækker, målt i prod 20/8, sæson-status 'upcoming'). Uden en wipe kan den
// nye pakkes kode (GT-længde/Giro-spredning/dagsafgørelser/itt_hilly/uphill-finishes/
// cobbles-vinduer/D2-cap) aldrig nå den LIVE kalender.
//
// HVAD DEN GØR (i rækkefølge):
//   1. Finder sæson 3 (seasons.number = 3) og NÆGTER at fortsætte hvis status ikke er
//      PRÆCIS 'upcoming' — allermest hvis den er 'active' (en live sæsons kalender må
//      ALDRIG slettes af dette script).
//   2. Læser ALLE races for sæsonens season_id (benhårdt scoped — ingen andre sæsoner
//      røres, uanset hvad der ellers står i races-tabellen).
//   3. Tjekker HVER FK-afhængighed af races.id fundet i database/schema-snapshot.json
//      (foreignKeys-sektionen): 14 tabeller har en race_id/target_race_id-kolonne der
//      peger på races. To grupper:
//        KALENDER-FORM (altid en del af wipen): race_stage_profiles, race_stage_schedule.
//        GAMEPLAY-PORT (STOPPER hele scriptet hvis ikke-nul — også i dry-run, fordi en
//        "plan" der ignorerer eksisterende gameplay-data ville være vildledende at
//        printe, endsige skrive): race_entries, race_results, race_incidents,
//        race_withdrawals, race_entry_clears, race_simulation_runs, race_stage_moments,
//        race_stage_passages, race_stage_roles, pending_race_results,
//        board_satisfaction_events, finance_transactions, rider_career_events,
//        rider_peak_plans (target_race_id).
//      teams.my_result_seen_race_id er den 15. FK-kolonne, men er ren UI-seen-state uden
//      gameplay-betydning — den NULLES automatisk, den er ikke en del af porten.
//      team_race_points_mv er et materialized view (schema-snapshot: kind "matview"),
//      ikke en tabel man sletter fra — den retter sig selv ved næste refresh.
//   4. (kun --apply) Skriver et JSON-snapshot af ALT der slettes til
//      docs/snapshots/3546/ FØR nogen skrivning, nuller teams.my_result_seen_race_id for
//      de berørte hold, sletter derefter i børn-først-rækkefølge, og post-verificerer
//      0 tilbageværende races for sæsonens season_id.
//
// SIKKERHEDS-KÆDEN (samme form som lofterApply3591.mjs/cutoverBackup3645.mjs):
//   1. Ejer-gate i koden: dry-run er default; --apply kræver --jeg-har-set-dry-runnet.
//   2. Sæson-port: status SKAL være 'upcoming'. Alt andet (inkl. 'active') stopper.
//   3. Frisk læsning fra prod (kun SELECT) → plan bygges forfra hver kørsel.
//   4. Gameplay-port: ét ikke-nul fund i nogen af de 14 gate-tabeller stopper HELE
//      kørslen, dry-run såvel som apply — ingen delvis rapport, ingen delvis skrivning.
//   5. Snapshot FØR skrivning (JSON-dump, ikke en backup-tabel — se docstring §4).
//   6. Chunket skrivning ({data,error}-tjek på hvert kald, IN-lister ≤100 id'er, jf.
//      SUPABASE_IN_CHUNK_SIZE i lib/supabasePagination.js — #3030's gateway-grænse).
//   7. Post-verify: 0 races tilbage for season_id, 0 race_stage_profiles/schedule for de
//      slettede race-id'er.
//
// KØRSEL
//   dry-run (default, skriver ALDRIG):
//     cd backend && infisical run --env=prod -- node scripts/dev/wipeSeason3Calendar.mjs
//   skrivning (kræver BEGGE flag):
//     cd backend && infisical run --env=prod -- node scripts/dev/wipeSeason3Calendar.mjs --apply --jeg-har-set-dry-runnet
//
// Refs #3546.

import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn, SUPABASE_IN_CHUNK_SIZE } from "../../lib/supabasePagination.js";
import { withSupabaseRetry } from "../../lib/supabaseErrorNormalize.js";
import { fmtInt } from "../lib/cutover3645.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(BACKEND_ROOT, "..");

const SEASON_NUMBER = 3;
const WRITE_BATCH = SUPABASE_IN_CHUNK_SIZE; // 100 — #3030 gateway-grænsen

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--jeg-har-set-dry-runnet");
const SNAPSHOT_DIR = resolve(arg("--snapshot-dir", join(REPO_ROOT, "docs/snapshots/3546")));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også --jeg-har-set-dry-runnet. Kør dry-runnet først.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

// ── Tabel-kataloget (fra database/schema-snapshot.json's foreignKeys, verificeret 20/8) ──
// KALENDER-FORM: altid en del af wipen, forventet ikke-nul (det ER kalenderen).
const CALENDAR_TABLES = [
  { table: "race_stage_schedule", column: "race_id" },
  { table: "race_stage_profiles", column: "race_id" },
];
// GAMEPLAY-PORT: sletning stopper HELE scriptet hvis noget her er ikke-nul. Rækkefølgen
// er også slette-rækkefølgen ved --apply (børn før forældre, mest følsomme tabeller sidst).
const GAMEPLAY_GATE_TABLES = [
  { table: "race_stage_roles", column: "race_id" },
  { table: "race_stage_passages", column: "race_id" },
  { table: "race_stage_moments", column: "race_id" },
  { table: "race_simulation_runs", column: "race_id" },
  { table: "race_incidents", column: "race_id" },
  { table: "race_withdrawals", column: "race_id" },
  { table: "race_entry_clears", column: "race_id" },
  { table: "race_entries", column: "race_id" },
  { table: "pending_race_results", column: "race_id" },
  { table: "race_results", column: "race_id" },
  { table: "board_satisfaction_events", column: "race_id" },
  { table: "rider_career_events", column: "race_id" },
  { table: "rider_peak_plans", column: "target_race_id" },
  { table: "finance_transactions", column: "race_id" }, // mest følsom (penge) — sidst
];

// Selecter FK-kolonnen selv (ikke "id") — flere af disse tabeller har ingen id-kolonne
// (fx race_stage_schedule/race_entries har komposit-nøgler: race_id+stage_number).
async function countByRaceIds(table, column, raceIds) {
  if (!raceIds.length) return { count: 0, sample: [] };
  const rows = await fetchAllRowsChunkedIn(
    raceIds,
    (chunk) => supabase.from(table).select(column).in(column, chunk).order(column),
  );
  return { count: rows.length, sample: rows.slice(0, 5) };
}

async function deleteByRaceIds(table, column, raceIds) {
  let deleted = 0;
  for (let i = 0; i < raceIds.length; i += WRITE_BATCH) {
    const chunk = raceIds.slice(i, i + WRITE_BATCH);
    const { error } = await withSupabaseRetry(async () => supabase.from(table).delete().in(column, chunk));
    if (error) throw new Error(`${table}.delete(${column} in chunk): ${error.message}`);
    deleted += chunk.length; // øvre grænse (chunken kan indeholde id'er uden match) — post-verify er den ægte sandhed
  }
  return deleted;
}

console.log("=== #3546 wipe af S3-kalenderen ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver til prod)" : "TILSTAND: DRY-RUN (skriver intet)");
console.log(`Database: ${projectRef}`);

// ── 1. Sæson-port ────────────────────────────────────────────────────────────
const { data: seasons, error: sErr } = await supabase.from("seasons").select("id, number, status, race_days_total, race_days_completed").eq("number", SEASON_NUMBER);
if (sErr) throw new Error(`seasons: ${sErr.message}`);
if (!seasons || seasons.length === 0) {
  console.error(`STOP — fandt ingen sæson med number = ${SEASON_NUMBER}.`);
  process.exit(1);
}
if (seasons.length > 1) {
  console.error(`STOP — fandt ${seasons.length} sæsoner med number = ${SEASON_NUMBER} (forventede præcis 1). Undersøg manuelt.`);
  process.exit(1);
}
const season = seasons[0];
console.log(`\nSæson ${season.number}: id=${season.id} · status=${season.status} · race_days_total=${season.race_days_total} · race_days_completed=${season.race_days_completed}`);

if (season.status === "active") {
  console.error(`\nSTOP — sæson ${SEASON_NUMBER} er 'active'. Dette script rører ALDRIG en live sæsons kalender. Afbrudt.`);
  process.exit(1);
}
if (season.status !== "upcoming") {
  console.error(`\nSTOP — sæson ${SEASON_NUMBER} har status '${season.status}', ikke 'upcoming'. Scriptet er benhårdt scoped til 'upcoming' og kører ikke på andre statusser. Afbrudt.`);
  process.exit(1);
}
console.log(`Sæson-port: OK — status er 'upcoming'.`);

// ── 2. Races for denne sæson (og KUN denne sæson) ───────────────────────────
const races = await fetchAllRows(() =>
  supabase.from("races").select("id, name, race_type, stages, status, league_division_id, edition_year").eq("season_id", season.id).order("id"),
);
const raceIds = races.map((r) => r.id);
console.log(`\nRaces for season_id=${season.id}: ${fmtInt(races.length)}`);

if (raceIds.length === 0) {
  console.log("\nIntet at wipe — 0 races for denne sæson. Idempotent no-op.");
  process.exit(0);
}

const raceStatusCounts = {};
for (const r of races) raceStatusCounts[r.status] = (raceStatusCounts[r.status] || 0) + 1;
console.log(`   status-fordeling: ${Object.entries(raceStatusCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
const nonScheduled = races.filter((r) => r.status !== "scheduled");
if (nonScheduled.length) {
  console.log(`   ⚠ ${nonScheduled.length} races har IKKE status 'scheduled' (fx 'active'/'completed') — indgår stadig i tælling nedenfor, gameplay-porten afgør om wipe er sikker.`);
}

// ── 3. Kalender-form (altid en del af wipen) ────────────────────────────────
console.log(`\n── Kalender-form (slettes altid sammen med races) ──`);
const calendarCounts = [];
for (const { table, column } of CALENDAR_TABLES) {
  const { count } = await countByRaceIds(table, column, raceIds);
  calendarCounts.push({ table, column, count });
  console.log(`   ${table.padEnd(22)} ${fmtInt(count)}`);
}

// ── 3b. Gameplay-porten ──────────────────────────────────────────────────────
console.log(`\n── Gameplay-port (0 forventet for en 'upcoming'-sæson — ikke-nul stopper HELE kørslen) ──`);
const gateCounts = [];
for (const { table, column } of GAMEPLAY_GATE_TABLES) {
  const { count, sample } = await countByRaceIds(table, column, raceIds);
  gateCounts.push({ table, column, count, sample });
  console.log(`   ${(count > 0 ? "IKKE-NUL" : "ok      ")} ${table.padEnd(22)} ${fmtInt(count)}`);
}
const gateViolations = gateCounts.filter((g) => g.count > 0);

// ── 3c. Benign UI-seen-state (nulles, ikke gated) ───────────────────────────
const affectedTeams = await fetchAllRowsChunkedIn(
  raceIds,
  (chunk) => supabase.from("teams").select("id, name, my_result_seen_race_id").in("my_result_seen_race_id", chunk).order("id"),
);
console.log(`\nteams.my_result_seen_race_id peger på et S3-løb: ${fmtInt(affectedTeams.length)} hold (nulles ved apply, ikke gated — ren UI-seen-state).`);

if (gateViolations.length) {
  console.error(`\nSTOP — gameplay-porten fandt data på ${gateViolations.length} tabel(ler). En 'upcoming'-sæsons kalender bør have 0 her; wipen er IKKE sikker uden manuel undersøgelse.`);
  for (const v of gateViolations) {
    console.error(`   ${v.table}.${v.column}: ${fmtInt(v.count)} rækker. Eksempler: ${JSON.stringify(v.sample.slice(0, 3))}`);
  }
  console.error(`\nAfbrudt — hverken dry-run-planen ovenfor eller nogen skrivning kan stoles på før dette er forklaret.`);
  process.exit(1);
}
console.log(`\nGameplay-port: OK — 0 rækker i alle ${GAMEPLAY_GATE_TABLES.length} gate-tabeller.`);

// ── Dry-run-opsummering ──────────────────────────────────────────────────────
console.log(`\n=== PLAN ===`);
console.log(`Races der slettes:              ${fmtInt(races.length)}`);
for (const c of calendarCounts) console.log(`${c.table.padEnd(30)} der slettes: ${fmtInt(c.count)}`);
console.log(`teams.my_result_seen_race_id der nulles: ${fmtInt(affectedTeams.length)}`);
console.log(`\nBemærk: season.race_days_total (nu ${season.race_days_total}) bliver IKKE genberegnet af dette script.`);
console.log(`Det sker automatisk (recomputeSeasonRaceDays) når kalenderen re-materialiseres — orkestratorens næste skridt.`);

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. Kør med --apply --jeg-har-set-dry-runnet for at skrive.`);
  process.exit(0);
}

// ── 4. APPLY: snapshot → nul UI-state → slet børn → slet races → post-verify ─
console.log(`\n--- APPLY ---`);

if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
const takenAt = new Date().toISOString();
const dateSlug = takenAt.slice(0, 10);

const raceStageProfiles = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_profiles").select("*").in("race_id", chunk).order("id"));
const raceStageSchedule = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_schedule").select("*").in("race_id", chunk).order("race_id"));

const snapshotPath = join(SNAPSHOT_DIR, `wipe-snapshot-season${SEASON_NUMBER}-${dateSlug}.json`);
writeFileSync(snapshotPath, JSON.stringify({
  takenAt,
  season,
  raceIds,
  races,
  race_stage_profiles: raceStageProfiles,
  race_stage_schedule: raceStageSchedule,
  teams_my_result_seen_race_id_before: affectedTeams,
}, null, 1), "utf8");
console.log(`Snapshot skrevet → ${snapshotPath}`);
console.log(`   races=${races.length} · race_stage_profiles=${raceStageProfiles.length} · race_stage_schedule=${raceStageSchedule.length} · teams=${affectedTeams.length}`);

// Nul UI-seen-state FØR races slettes (harmløst, men ryddeligt at gøre det først).
for (let i = 0; i < affectedTeams.length; i += WRITE_BATCH) {
  const chunk = affectedTeams.slice(i, i + WRITE_BATCH).map((t) => t.id);
  const { error } = await withSupabaseRetry(async () => supabase.from("teams").update({ my_result_seen_race_id: null }).in("id", chunk));
  if (error) throw new Error(`teams.my_result_seen_race_id nulstilling: ${error.message}`);
}
console.log(`teams.my_result_seen_race_id nulstillet: ${affectedTeams.length}`);

// Slet kalender-form (børn før races).
for (const { table, column } of CALENDAR_TABLES) {
  await deleteByRaceIds(table, column, raceIds);
  console.log(`Slettet fra ${table}`);
}

// Slet races — benhårdt scoped til season_id (ikke en id-liste: undgår enhver risiko for
// at en id fra en anden sæson snige sig med).
{
  const { error } = await withSupabaseRetry(async () => supabase.from("races").delete().eq("season_id", season.id));
  if (error) throw new Error(`races.delete(season_id=${season.id}): ${error.message}`);
}
console.log(`Slettet ${races.length} races (season_id=${season.id}).`);

// ── Post-verify ───────────────────────────────────────────────────────────────
console.log(`\nPost-verify:`);
const { count: racesLeft, error: rvErr } = await supabase.from("races").select("id", { count: "exact", head: true }).eq("season_id", season.id);
if (rvErr) throw new Error(`post-verify races: ${rvErr.message}`);
const profilesLeft = (await countByRaceIds("race_stage_profiles", "race_id", raceIds)).count;
const scheduleLeft = (await countByRaceIds("race_stage_schedule", "race_id", raceIds)).count;
console.log(`   races tilbage for season_id=${season.id}:        ${fmtInt(racesLeft)}`);
console.log(`   race_stage_profiles tilbage for disse race-id'er: ${fmtInt(profilesLeft)}`);
console.log(`   race_stage_schedule tilbage for disse race-id'er: ${fmtInt(scheduleLeft)}`);

if (racesLeft !== 0 || profilesLeft !== 0 || scheduleLeft !== 0) {
  console.error(`\nPOST-VERIFY FEJLEDE — ikke alt blev slettet. Undersøg manuelt FØR re-materialisering.`);
  process.exit(1);
}
console.log(`\nPost-verify OK: 0 races, 0 stage-profiler, 0 schedule-rækker tilbage for sæson ${SEASON_NUMBER}.`);
console.log(`\nNæste skridt (orkestratorens, ikke dette script): re-materialisér kalenderen (den bliver IKKE`);
console.log(`længere en no-op), som også genberegner season.race_days_total via recomputeSeasonRaceDays.`);
console.log(`\nRollback: genindsæt rækkerne fra ${snapshotPath} (races → race_stage_profiles/schedule → teams.my_result_seen_race_id).`);
console.log(`team_race_points_mv (materialized view) retter sig selv ved næste refresh — ingen manuel handling.`);
