#!/usr/bin/env node
// #6185 (del 1) · Backfill af "sat af fra udbruddet" paa allerede koerte v4-etaper.
//
// Foer #6185 kendte historik-laget ikke tilstanden: en udbryder der blev sat af
// fra udbruddet (og kun regrupperede med andre afsatte) fik hverken "indhentet"
// eller "holdt hjem", og race_results.breakaway_caught blev tvunget til false =
// vist som "holdt hjem". Scriptet genlaeser hver etapes gemte tidslinje
// (race_stage_timelines, v2) med PRAECIS samme rene projektion som motoren nu
// bruger (backend/lib/raceParticipationHistory.ts) og retter udbryder-raekkerne:
//   breakaway_dropped = true      (ny kolonne, migration 2026-10-05-6185)
//   breakaway_caught  = true for en "holdt hjem" der havde en ikke-udbryder foran
//                       sig (sikkerhedsnettet ved maal)
// "Sat af" kraever at rytteren blev opslugt af ikke-udbrydere ELLER havde en
// ikke-udbryder foran sig i maal; en rytter der koerte fra udbruddet og kom i
// maal foran alle ikke-udbrydere, holdt hjem (settleBreakawayOutcome).
// Kun raekker med in_breakaway = true OG morgen-udbryder i tidslinjen roeres.
// in_breakaway, rank, tider og point roeres aldrig.
//
// Usage:
//   node backend/scripts/backfill-6185-dropped-breakaway.js                      # dry-run (default), READ-ONLY
//   node backend/scripts/backfill-6185-dropped-breakaway.js --dry-run --json
//   node backend/scripts/backfill-6185-dropped-breakaway.js --since=2026-10-02   # default-dato
//   node backend/scripts/backfill-6185-dropped-breakaway.js --race=<race-uuid>
//   node backend/scripts/backfill-6185-dropped-breakaway.js --log=<sti.json>     # rollback-log (se nedenfor)
//   node backend/scripts/backfill-6185-dropped-breakaway.js --apply --owner-go   # KRAEVER EJER-GO
//
// Rollback-log: hver koersel (ogsaa dry-run) skriver id + foer- og efter-vaerdier
// for hver raekke der ville blive/bliver aendret (og hver raekke vagten stoppede)
// til en JSON-fil. Default: backend/scripts/snapshots/6185/ (gitignoret, samme
// sted som de andre lokale rollback-artefakter). Ved --apply skrives loggen
// FOER skrivningen og opdateres bagefter med de id'er databasen bekraeftede.
//
// Kraever at migrationen database/2026-10-05-6185-race-results-breakaway-dropped.sql
// er koert (ellers stopper --apply; dry-run viser stadig tallene).
// Idempotent: kun raekker hvis vaerdier afviger skrives; en gentagen koersel
// finder 0 aendringer. Vagt mod nedgradering: et gemt true paa
// breakaway_caught eller breakaway_dropped saettes aldrig til false (raekken
// springes over og taelles i dry-run'en). Skrivning sker i batches.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = intet arbejde, 1 = dry-run fandt raekker at rette, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveParticipationHistory,
  settleBreakawayOutcome,
  nonEscapeeAheadByRider,
  breakawayFlagsForOutcome,
} from "../lib/raceParticipationHistory.ts";
import { fetchAllRows } from "../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

export const DEFAULT_SINCE = "2026-10-02";

export function parseArgs(argv = process.argv.slice(2)) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  return {
    apply: argv.includes("--apply"),
    ownerGo: argv.includes("--owner-go"),
    json: argv.includes("--json"),
    since: value("since") ?? DEFAULT_SINCE,
    raceId: value("race"),
    logPath: value("log"),
  };
}

export const DEFAULT_LOG_DIR = join(REPO_ROOT, "backend", "scripts", "snapshots", "6185");

/** Default-sti for rollback-loggen: gitignoret, dateret, adskilt for dry-run og apply. */
export function defaultLogPath({ apply, now = new Date() }) {
  return join(DEFAULT_LOG_DIR, `backfill-${apply ? "apply" : "dry-run"}-${now.toISOString().replace(/[:.]/g, "-")}.json`);
}

/**
 * REN: rollback-loggens indhold. En post pr. raekke der ville blive/bliver
 * aendret (status "planned", efter --apply "applied" eller "not_applied" hvis
 * databasens vagt sprang den over) og pr. raekke vagten stoppede ("blocked").
 * `before` er de gemte vaerdier, `after` de vaerdier scriptet skriver; en
 * rollback saetter `before` tilbage for id'erne med status "applied".
 */
export function buildRollbackLog(plan, { mode, appliedIds = null, now = new Date() } = {}) {
  const applied = appliedIds ? new Set(appliedIds) : null;
  const rows = [];
  for (const stage of plan.perStage) {
    for (const [list, kind] of [[stage.updates, "update"], [stage.blocked, "blocked"]]) {
      for (const u of list) {
        const status = kind === "blocked" ? "blocked" : applied ? (applied.has(u.id) ? "applied" : "not_applied") : "planned";
        rows.push({ id: u.id, race_id: stage.race_id, stage_number: stage.stage_number, rider_id: u.rider_id, result_type: u.result_type, rank: u.rank, outcome: u.outcome, before: u.from, after: u.to, status });
      }
    }
  }
  return { issue: 6185, mode, written_at: now.toISOString(), since: plan.since, race_id: plan.raceId, has_column: plan.hasColumn, totals: plan.totals, rows };
}

export function writeRollbackLog(path, log) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  return path;
}

const FLAG_FIELDS = ["breakaway_caught", "breakaway_dropped"];
export const APPLY_BATCH_SIZE = 200;

/**
 * REN: kun de felter der faktisk aendres, og om nogen af dem ville
 * NEDGRADERE (true -> false). En nedgradering skrives aldrig: scriptet
 * maa kun tilfoeje "sat af" eller "indhentet", aldrig fjerne et gemt true.
 */
export function diffFlags(from, to) {
  const patch = {};
  const downgrades = [];
  for (const field of FLAG_FIELDS) {
    if (to[field] === from[field] || (to[field] === null && from[field] === null)) continue;
    if (from[field] === true && to[field] !== true) downgrades.push(field);
    patch[field] = to[field];
  }
  return { patch, downgrades };
}

/** Kort, stabil etiket for en aendringstype, fx "breakaway_dropped:null->true". */
export function changeLabel(from, patch) {
  return Object.keys(patch).sort().map((field) => `${field}:${from[field]}->${patch[field]}`).join(", ");
}

/**
 * REN: hvilke raekker paa EN etape skal rettes? `rows` = etapens race_results
 * (result_type stage og gc; et endagslob har kun gc-raekker).
 * Returnerer { updates, blocked, skipped } uden IO. `updates[].patch` holder
 * kun de aendrede felter; en raekke hvor et gemt true ville blive false,
 * havner i `blocked` (vagt mod nedgradering) og skrives ikke.
 */
export function planStage({ events, rows }) {
  // Etape-raekkerne er maalrækkefoelgen. Et endagslob gemmer kun gc-raekker
  // (ingen stage-raekker), og der ER gc-placeringen maalrækkefoelgen; samme
  // fallback som loebssiden (RaceDetailPage oneDayParticipation). Startfeltet
  // skal med, ellers kan projektionen ikke se en sammenkobling med feltet.
  const stageOnly = rows.filter((row) => row.result_type === "stage" && row.rider_id);
  const stageRows = stageOnly.length ? stageOnly : rows.filter((row) => row.result_type === "gc" && row.rider_id);
  const history = deriveParticipationHistory(events ?? [], stageRows.map((row) => row.rider_id));
  if (!history.complete || history.morningRiderIds.size === 0) {
    return { updates: [], blocked: [], skipped: history.complete ? "no_breakaway" : "incomplete_timeline", outcomes: {} };
  }
  // Samme definition af "ikke-udbryder foran" som loebssiden (historyForStage)
  // og motor-koerslen: tidslinjens morgen-saet, etape-placeringen. gc-raekker
  // paa et endagslob foelger rytterens etape-placering.
  const aheadByRider = nonEscapeeAheadByRider(history, stageRows);
  const updates = [];
  const blocked = [];
  const outcomes = { caught: 0, dropped: 0, survived: 0, unknown: 0 };
  for (const row of rows) {
    if (!row.in_breakaway || !row.rider_id || !history.morningRiderIds.has(row.rider_id)) continue;
    const outcome = settleBreakawayOutcome(history.riders.get(row.rider_id), aheadByRider.get(row.rider_id) ?? null);
    if (row.result_type === "stage" || !stageOnly.length) outcomes[outcome ?? "unknown"] += 1;
    const target = breakawayFlagsForOutcome(true, outcome);
    const current = { breakaway_caught: row.breakaway_caught === true, breakaway_dropped: row.breakaway_dropped ?? null };
    // Kun raekker hvis VISTE tilstand aendres: sat af (ny) eller indhentet
    // (sikkerhedsnettet). En korrekt "indhentet"/"holdt hjem" beholder NULL
    // (= ikke vurderet), som laeses praecis som foer.
    const changesState = target.breakaway_dropped === true
      ? current.breakaway_dropped !== true || current.breakaway_caught
      : target.breakaway_caught !== current.breakaway_caught;
    if (!changesState) continue;
    const to = { breakaway_caught: target.breakaway_caught, breakaway_dropped: target.breakaway_dropped };
    const { patch, downgrades } = diffFlags(current, to);
    if (Object.keys(patch).length === 0) continue;
    const update = {
      id: row.id,
      rider_id: row.rider_id,
      result_type: row.result_type,
      rank: row.rank,
      outcome: outcome ?? "unknown",
      from: current,
      to,
      patch,
      change: changeLabel(current, patch),
    };
    if (downgrades.length) blocked.push({ ...update, downgrades });
    else updates.push(update);
  }
  return { updates, blocked, skipped: null, outcomes };
}

/** REN: antal raekker pr. aendringstype (til dry-run-oversigten). */
export function countByChange(list) {
  const counts = {};
  for (const item of list) counts[item.change] = (counts[item.change] ?? 0) + 1;
  return counts;
}

/**
 * REN: samler opdateringer med IDENTISK patch i batches (ét UPDATE ... WHERE
 * id IN (...) pr. batch i stedet for én raekke ad gangen).
 */
export function batchUpdates(updates, size = APPLY_BATCH_SIZE) {
  const byPatch = new Map();
  for (const update of updates) {
    const key = JSON.stringify(Object.keys(update.patch).sort().map((field) => [field, update.patch[field]]));
    if (!byPatch.has(key)) byPatch.set(key, { patch: update.patch, ids: [] });
    byPatch.get(key).ids.push(update.id);
  }
  const batches = [];
  for (const { patch, ids } of byPatch.values()) {
    for (let i = 0; i < ids.length; i += size) batches.push({ patch, ids: ids.slice(i, i + size) });
  }
  return batches;
}

const RESULT_COLUMNS = "id, race_id, stage_number, result_type, rank, rider_id, in_breakaway, breakaway_caught";

async function fetchStageRows(supabase, raceId, stageNumber, { withDropped }) {
  return fetchAllRows(() => supabase
    .from("race_results")
    .select(withDropped ? `${RESULT_COLUMNS}, breakaway_dropped` : RESULT_COLUMNS)
    .eq("race_id", raceId)
    .eq("stage_number", stageNumber)
    .in("result_type", ["stage", "gc"])
    .order("id", { ascending: true }));
}

async function columnExists(supabase) {
  const { error } = await supabase.from("race_results").select("breakaway_dropped").limit(1);
  return !error;
}

/**
 * Alle v4-etaper siden `since`, pagineret (PostgREST giver maks 1000 raekker
 * pr. select). Stabil, unik sortering (created_at, race_id, stage_number), saa
 * ingen etape tabes eller dubleres over en sidegraense.
 */
export async function fetchStageList(supabase, { since = DEFAULT_SINCE, raceId = null } = {}, pageSize = undefined) {
  return fetchAllRows(() => {
    let query = supabase
      .from("race_stage_timelines")
      .select("race_id, stage_number, created_at")
      .eq("timeline_version", 2)
      .gte("created_at", since);
    if (raceId) query = query.eq("race_id", raceId);
    return query
      .order("created_at", { ascending: true })
      .order("race_id", { ascending: true })
      .order("stage_number", { ascending: true });
  }, pageSize);
}

/** Plan over alle v4-etaper siden `since` (READ-ONLY). */
export async function planBackfill({ supabase, since = DEFAULT_SINCE, raceId = null }) {
  const hasColumn = await columnExists(supabase);
  const stages = await fetchStageList(supabase, { since, raceId });

  const perStage = [];
  const totals = {
    stages: 0, stages_with_updates: 0, rows_to_update: 0, dropped: 0, caught: 0, survived: 0, unknown: 0, skipped: {},
    // Raekker pr. aendringstype, og hvor mange nedgraderinger vagten stoppede.
    by_change: {}, blocked_downgrades: 0, blocked_by_change: {},
  };
  for (const stage of stages) {
    const { data: timeline, error: timelineError } = await supabase
      .from("race_stage_timelines")
      .select("events")
      .eq("race_id", stage.race_id)
      .eq("stage_number", stage.stage_number)
      .eq("timeline_version", 2)
      .maybeSingle();
    if (timelineError) throw timelineError;
    const rows = await fetchStageRows(supabase, stage.race_id, stage.stage_number, { withDropped: hasColumn });
    const plan = planStage({ events: timeline?.events ?? [], rows });
    totals.stages += 1;
    if (plan.skipped) { totals.skipped[plan.skipped] = (totals.skipped[plan.skipped] ?? 0) + 1; continue; }
    for (const key of ["dropped", "caught", "survived", "unknown"]) totals[key] += plan.outcomes[key];
    for (const [change, count] of Object.entries(countByChange(plan.updates))) totals.by_change[change] = (totals.by_change[change] ?? 0) + count;
    for (const [change, count] of Object.entries(countByChange(plan.blocked))) totals.blocked_by_change[change] = (totals.blocked_by_change[change] ?? 0) + count;
    totals.blocked_downgrades += plan.blocked.length;
    if (plan.updates.length || plan.blocked.length) {
      if (plan.updates.length) totals.stages_with_updates += 1;
      totals.rows_to_update += plan.updates.length;
      perStage.push({ race_id: stage.race_id, stage_number: stage.stage_number, updates: plan.updates, blocked: plan.blocked });
    }
  }
  return { since, raceId, hasColumn, totals, perStage };
}

/**
 * Skriver planen i batches (samme patch -> ét UPDATE ... WHERE id IN (...)).
 * Vagten mod nedgradering gaelder OGSAA i databasen: en patch der saetter et
 * flag til false, rammer kun raekker hvor flaget ikke er true (`breakaway_dropped
 * IS NULL`), saa en raekke der er aendret siden dry-run'en aldrig nedgraderes.
 * En patch der saetter breakaway_dropped=true rammer kun raekker hvor
 * breakaway_caught stadig er false: en raekke der er blevet "indhentet" siden
 * dry-run'en, laves aldrig om til "sat af".
 * Patches fra planStage saetter kun breakaway_caught til true og
 * breakaway_dropped til true eller (fra NULL) false.
 * Returnerer de id'er databasen bekraeftede (til rollback-loggen).
 */
export async function applyBackfill({ supabase, plan, batchSize = APPLY_BATCH_SIZE }) {
  if (!plan.hasColumn) throw new Error("race_results.breakaway_dropped findes ikke: koer migrationen 2026-10-05-6185 foerst.");
  const updates = plan.perStage.flatMap((stage) => stage.updates);
  const appliedIds = [];
  for (const batch of batchUpdates(updates, batchSize)) {
    let query = supabase
      .from("race_results")
      .update(batch.patch)
      .in("id", batch.ids)
      .eq("in_breakaway", true);
    for (const field of FLAG_FIELDS) {
      if (batch.patch[field] === false) query = field === "breakaway_dropped" ? query.is(field, null) : query.eq(field, false);
    }
    if (batch.patch.breakaway_dropped === true && batch.patch.breakaway_caught === undefined) query = query.eq("breakaway_caught", false);
    const { data, error } = await query.select("id");
    if (error) throw error;
    for (const row of data ?? []) appliedIds.push(row.id);
  }
  return { updated: appliedIds.length, planned: updates.length, appliedIds };
}

function printPlan(plan) {
  const t = plan.totals;
  console.log(`#6185 backfill — v4-etaper siden ${plan.since}${plan.raceId ? ` (løb ${plan.raceId})` : ""}`);
  if (!plan.hasColumn) console.log("ADVARSEL: kolonnen breakaway_dropped findes ikke endnu (migrationen er ikke koert). --apply er blokeret.");
  console.log(`Etaper laest: ${t.stages} · sprunget over: ${JSON.stringify(t.skipped)}`);
  console.log(`Udbryder-udfald (stage-raekker): sat af ${t.dropped} · indhentet ${t.caught} · holdt hjem ${t.survived} · ukendt ${t.unknown}`);
  console.log(`Raekker der rettes: ${t.rows_to_update} paa ${t.stages_with_updates} etaper`);
  console.log("Pr. aendringstype:");
  for (const [change, count] of Object.entries(t.by_change)) console.log(`  ${count} × ${change}`);
  console.log(`Nedgraderinger stoppet af vagten (true -> false skrives aldrig): ${t.blocked_downgrades}`);
  for (const [change, count] of Object.entries(t.blocked_by_change)) console.log(`  ${count} × ${change}`);
  for (const stage of plan.perStage) {
    const byOutcome = {};
    for (const update of stage.updates) byOutcome[update.outcome] = (byOutcome[update.outcome] ?? 0) + 1;
    const blockedNote = stage.blocked.length ? ` · stoppet ${stage.blocked.length} (placeringer ${stage.blocked.map((u) => u.rank).join(", ")})` : "";
    console.log(`  ${stage.race_id} etape ${stage.stage_number}: ${stage.updates.length} raekker ${JSON.stringify(byOutcome)} · placeringer ${stage.updates.filter((u) => u.result_type === "stage").map((u) => u.rank).join(", ")}${blockedNote}`);
  }
}

async function main() {
  const args = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(2);
  }
  if (args.apply && !args.ownerGo) {
    console.error("--apply kraever --owner-go. Koer dry-run'en, vis tallene til ejeren, og faa et eksplicit go foerst.");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const plan = await planBackfill({ supabase, since: args.since, raceId: args.raceId });
  if (args.json) console.log(JSON.stringify({ since: plan.since, raceId: plan.raceId, hasColumn: plan.hasColumn, totals: plan.totals }, null, 2));
  else printPlan(plan);

  const mode = args.apply ? "apply" : "dry-run";
  const logPath = args.logPath ? resolve(args.logPath) : defaultLogPath({ apply: args.apply });
  writeRollbackLog(logPath, buildRollbackLog(plan, { mode }));
  console.log(`Rollback-log (id + foer/efter pr. raekke): ${logPath}`);

  if (!args.apply) {
    console.log("DRY-RUN — intet er skrevet. Koer med --apply --owner-go efter ejer-go.");
    process.exit(plan.totals.rows_to_update > 0 ? 1 : 0);
  }
  const result = await applyBackfill({ supabase, plan });
  writeRollbackLog(logPath, buildRollbackLog(plan, { mode, appliedIds: result.appliedIds }));
  console.log(`Faerdig: ${result.updated} raekker opdateret (af ${result.planned} planlagte). Rollback-log opdateret: ${logPath}. Koer dry-run igen: forventet 0.`);
  process.exit(0);
}

// Kun naar scriptet koeres direkte — importeres det af tests, maa intet ske.
if (process.argv[1]?.endsWith("backfill-6185-dropped-breakaway.js")) {
  main().catch((err) => {
    console.error(`backfill-6185 fejlede: ${err.message}`);
    process.exit(2);
  });
}
