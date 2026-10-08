#!/usr/bin/env node
// #6294 · Backfill af udbruds-maerkerne paa allerede koerte v4-etaper.
//
// Fejlen: en `breakaway_caught` hvis lukkende gruppe KUN havde udbrydere i sig
// (typisk en udbryder der styrtede og koerte op til udbruddet igen; uheldet
// navngiver ingen gruppe, saa projektionen kendte ikke hans solo-gruppe) blev
// talt som en indhentning. Udbruddet stod som "indhentet" paa resultatlisten,
// selv om det holdt hjem, og den afsatte rytter stod som eneste "holdt hjem".
//
// Rettelsen (backend/lib/raceParticipationHistory.ts) laeser gruppens
// medlemmer fra motorens group_merged paa samme km. Scriptet genlaeser hver
// etapes gemte tidslinje med PRAECIS den projektion og retter
// race_results.breakaway_caught / breakaway_dropped for udbryder-raekkerne paa
// etaper hvor tidslinjen har mindst en saadan samling (regroupCatches > 0).
// Andre etaper roeres ikke. in_breakaway, rank, tider og point roeres aldrig.
//
// Usage:
//   node backend/scripts/backfill6294BreakawayMarks.mjs                       # dry-run (default), READ-ONLY
//   node backend/scripts/backfill6294BreakawayMarks.mjs --json
//   node backend/scripts/backfill6294BreakawayMarks.mjs --since=2026-09-25    # default-dato
//   node backend/scripts/backfill6294BreakawayMarks.mjs --race=<race-uuid>
//   node backend/scripts/backfill6294BreakawayMarks.mjs --log=<sti.json>      # rollback-log
//   node backend/scripts/backfill6294BreakawayMarks.mjs --apply --owner-go    # KRAEVER EJER-GO
//
// Rollback-log: hver koersel (ogsaa dry-run) skriver id + foer/efter pr.
// raekke til backend/scripts/snapshots/6294/ (gitignoret). Ved --apply skrives
// loggen FOER skrivningen og opdateres med de id'er databasen bekraeftede.
// Idempotent: kun afvigende raekker skrives; en gentagen koersel finder 0.
// Vagt i databasen: hver batch rammer kun raekker hvis gemte flag stadig er
// dem dry-run'en saa (en raekke aendret siden roeres ikke).
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
import { fetchStageList, batchUpdates, APPLY_BATCH_SIZE } from "./backfill-6185-dropped-breakaway.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

/** Fejlklassen er set siden denne dato (ejer 8/10: omfang siden 25/9). */
export const DEFAULT_SINCE = "2026-09-25";
export const DEFAULT_LOG_DIR = join(REPO_ROOT, "backend", "scripts", "snapshots", "6294");
const FLAG_FIELDS = ["breakaway_caught", "breakaway_dropped"];

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

export function defaultLogPath({ apply, now = new Date() }) {
  return join(DEFAULT_LOG_DIR, `backfill-${apply ? "apply" : "dry-run"}-${now.toISOString().replace(/[:.]/g, "-")}.json`);
}

/**
 * REN: hvilke udbryder-raekker paa EN etape skal rettes? Kun etaper hvor
 * tidslinjen har en samling forklaedt som indhentning. `rows` = etapens
 * race_results (stage og gc; et endagslob har kun gc-raekker).
 */
export function planStage({ events, rows }) {
  const stageOnly = rows.filter((row) => row.result_type === "stage" && row.rider_id);
  const stageRows = stageOnly.length ? stageOnly : rows.filter((row) => row.result_type === "gc" && row.rider_id);
  const history = deriveParticipationHistory(events ?? [], stageRows.map((row) => row.rider_id));
  if (!history.complete) return { updates: [], skipped: "incomplete_timeline", regroups: 0 };
  if (history.morningRiderIds.size === 0) return { updates: [], skipped: "no_breakaway", regroups: 0 };
  if (history.regroupCatches.size === 0) return { updates: [], skipped: "no_regroup_catch", regroups: 0 };
  const aheadByRider = nonEscapeeAheadByRider(history, stageRows);
  const updates = [];
  for (const row of rows) {
    if (!row.in_breakaway || !row.rider_id || !history.morningRiderIds.has(row.rider_id)) continue;
    const outcome = settleBreakawayOutcome(history.riders.get(row.rider_id), aheadByRider.get(row.rider_id) ?? null);
    const target = breakawayFlagsForOutcome(true, outcome);
    const from = { breakaway_caught: row.breakaway_caught === true, breakaway_dropped: row.breakaway_dropped ?? null };
    const to = { breakaway_caught: target.breakaway_caught, breakaway_dropped: target.breakaway_dropped };
    const patch = {};
    for (const field of FLAG_FIELDS) if (to[field] !== from[field]) patch[field] = to[field];
    // Et ukendt udfald (null) skriver aldrig over et gemt svar.
    if (patch.breakaway_dropped === null) delete patch.breakaway_dropped;
    if (!Object.keys(patch).length) continue;
    updates.push({
      id: row.id, rider_id: row.rider_id, result_type: row.result_type, rank: row.rank,
      outcome: outcome ?? "unknown", from, to: { ...from, ...patch }, patch,
      change: Object.keys(patch).sort().map((field) => `${field}:${from[field]}->${patch[field]}`).join(", "),
    });
  }
  return { updates, skipped: null, regroups: history.regroupCatches.size };
}

/** REN: rollback-loggens indhold (samme form som #6185's). */
export function buildRollbackLog(plan, { mode, appliedIds = null, now = new Date() } = {}) {
  const applied = appliedIds ? new Set(appliedIds) : null;
  const rows = plan.perStage.flatMap((stage) => stage.updates.map((u) => ({
    id: u.id, race_id: stage.race_id, stage_number: stage.stage_number, rider_id: u.rider_id, result_type: u.result_type, rank: u.rank,
    outcome: u.outcome, before: u.from, after: u.to,
    status: applied ? (applied.has(u.id) ? "applied" : "not_applied") : "planned",
  })));
  return { issue: 6294, mode, written_at: now.toISOString(), since: plan.since, race_id: plan.raceId, totals: plan.totals, rows };
}

function writeRollbackLog(path, log) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  return path;
}

const RESULT_COLUMNS = "id, race_id, stage_number, result_type, rank, rider_id, in_breakaway, breakaway_caught, breakaway_dropped";

/** Plan over alle v4-etaper siden `since` (READ-ONLY). */
export async function planBackfill({ supabase, since = DEFAULT_SINCE, raceId = null }) {
  const stages = await fetchStageList(supabase, { since, raceId });
  const raceNames = new Map();
  const perStage = [];
  const totals = { stages: 0, stages_with_regroup: 0, stages_with_updates: 0, rows_to_update: 0, winners_corrected: 0, skipped: {}, by_change: {} };
  for (const stage of stages) {
    const { data: timeline, error } = await supabase
      .from("race_stage_timelines").select("events")
      .eq("race_id", stage.race_id).eq("stage_number", stage.stage_number).eq("timeline_version", 2)
      .maybeSingle();
    if (error) throw error;
    const rows = await fetchAllRows(() => supabase
      .from("race_results").select(RESULT_COLUMNS)
      .eq("race_id", stage.race_id).eq("stage_number", stage.stage_number)
      .in("result_type", ["stage", "gc"]).order("id", { ascending: true }));
    const plan = planStage({ events: timeline?.events ?? [], rows });
    totals.stages += 1;
    if (plan.skipped) { totals.skipped[plan.skipped] = (totals.skipped[plan.skipped] ?? 0) + 1; continue; }
    totals.stages_with_regroup += 1;
    if (!plan.updates.length) continue;
    if (!raceNames.has(stage.race_id)) {
      const { data: race } = await supabase.from("races").select("name").eq("id", stage.race_id).maybeSingle();
      raceNames.set(stage.race_id, race?.name ?? stage.race_id);
    }
    totals.stages_with_updates += 1;
    totals.rows_to_update += plan.updates.length;
    for (const u of plan.updates) totals.by_change[u.change] = (totals.by_change[u.change] ?? 0) + 1;
    totals.winners_corrected += plan.updates.filter((u) => u.result_type === "stage" && u.rank === 1).length;
    perStage.push({ race_id: stage.race_id, race_name: raceNames.get(stage.race_id), stage_number: stage.stage_number, regroups: plan.regroups, updates: plan.updates });
  }
  return { since, raceId, totals, perStage };
}

/**
 * Skriver planen i batches. Hver batch rammer kun raekker hvis gemte flag
 * stadig er dry-run'ens `from`, saa en raekke aendret siden aldrig roeres.
 */
export async function applyBackfill({ supabase, plan, batchSize = APPLY_BATCH_SIZE }) {
  const updates = plan.perStage.flatMap((stage) => stage.updates);
  const appliedIds = [];
  const byFrom = new Map();
  for (const u of updates) {
    const key = JSON.stringify(u.from);
    if (!byFrom.has(key)) byFrom.set(key, { from: u.from, updates: [] });
    byFrom.get(key).updates.push(u);
  }
  for (const { from, updates: group } of byFrom.values()) {
    for (const batch of batchUpdates(group, batchSize)) {
      let query = supabase.from("race_results").update(batch.patch).in("id", batch.ids).eq("in_breakaway", true).eq("breakaway_caught", from.breakaway_caught);
      query = from.breakaway_dropped === null ? query.is("breakaway_dropped", null) : query.eq("breakaway_dropped", from.breakaway_dropped);
      const { data, error } = await query.select("id");
      if (error) throw error;
      for (const row of data ?? []) appliedIds.push(row.id);
    }
  }
  return { updated: appliedIds.length, planned: updates.length, appliedIds };
}

function printPlan(plan) {
  const t = plan.totals;
  console.log(`#6294 backfill — v4-etaper siden ${plan.since}${plan.raceId ? ` (løb ${plan.raceId})` : ""}`);
  console.log(`Etaper laest: ${t.stages} · med en samling forklaedt som indhentning: ${t.stages_with_regroup} · sprunget over: ${JSON.stringify(t.skipped)}`);
  console.log(`Raekker der rettes: ${t.rows_to_update} paa ${t.stages_with_updates} etaper · etapevindere rettet: ${t.winners_corrected}`);
  for (const [change, count] of Object.entries(t.by_change)) console.log(`  ${count} × ${change}`);
  for (const stage of plan.perStage) {
    const stageRows = stage.updates.filter((u) => u.result_type === "stage");
    console.log(`  ${stage.race_name} etape ${stage.stage_number}: ${stage.updates.length} raekker (${stageRows.length} etape) · placeringer ${stageRows.map((u) => `${u.rank}:${u.outcome}`).join(", ")}`);
  }
}

async function main() {
  const args = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env"); process.exit(2); }
  if (args.apply && !args.ownerGo) {
    console.error("--apply kraever --owner-go. Koer dry-run'en, vis tallene til ejeren, og faa et eksplicit go foerst.");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const plan = await planBackfill({ supabase, since: args.since, raceId: args.raceId });
  if (args.json) console.log(JSON.stringify({ since: plan.since, raceId: plan.raceId, totals: plan.totals, perStage: plan.perStage.map((s) => ({ race_id: s.race_id, race_name: s.race_name, stage_number: s.stage_number, rows: s.updates.length })) }, null, 2));
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
  console.log(`Faerdig: ${result.updated} raekker opdateret (af ${result.planned} planlagte). Koer dry-run igen: forventet 0.`);
  process.exit(0);
}

if (process.argv[1]?.endsWith("backfill6294BreakawayMarks.mjs")) {
  main().catch((err) => { console.error(`backfill-6294 fejlede: ${err.message}`); process.exit(2); });
}
