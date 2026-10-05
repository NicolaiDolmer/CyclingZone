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
// Kun raekker med in_breakaway = true OG morgen-udbryder i tidslinjen roeres.
// in_breakaway, rank, tider og point roeres aldrig.
//
// Usage:
//   node backend/scripts/backfill-6185-dropped-breakaway.js                      # dry-run (default), READ-ONLY
//   node backend/scripts/backfill-6185-dropped-breakaway.js --dry-run --json
//   node backend/scripts/backfill-6185-dropped-breakaway.js --since=2026-10-02   # default-dato
//   node backend/scripts/backfill-6185-dropped-breakaway.js --race=<race-uuid>
//   node backend/scripts/backfill-6185-dropped-breakaway.js --apply --owner-go   # KRAEVER EJER-GO
//
// Kraever at migrationen database/2026-10-05-6185-race-results-breakaway-dropped.sql
// er koert (ellers stopper --apply; dry-run viser stadig tallene).
// Idempotent: kun raekker hvis vaerdier afviger skrives; en gentagen koersel
// finder 0 aendringer.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = intet arbejde, 1 = dry-run fandt raekker at rette, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveParticipationHistory,
  settleBreakawayOutcome,
  bestNonEscapeeRank,
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
  };
}

/**
 * REN: hvilke raekker paa EN etape skal rettes? `rows` = etapens race_results
 * (result_type stage, plus endagslobs gc-raekker der baerer samme flag).
 * Returnerer { updates, skipped } uden IO.
 */
export function planStage({ events, rows }) {
  const stageRows = rows.filter((row) => row.result_type === "stage" && row.rider_id);
  const history = deriveParticipationHistory(events ?? [], stageRows.map((row) => row.rider_id));
  if (!history.complete || history.morningRiderIds.size === 0) {
    return { updates: [], skipped: history.complete ? "no_breakaway" : "incomplete_timeline", outcomes: {} };
  }
  const best = bestNonEscapeeRank(stageRows.map((row) => ({ rank: row.rank, escapee: history.morningRiderIds.has(row.rider_id) })));
  const rankByRider = new Map(stageRows.map((row) => [row.rider_id, row.rank]));
  const updates = [];
  const outcomes = { caught: 0, dropped: 0, survived: 0, unknown: 0 };
  for (const row of rows) {
    if (!row.in_breakaway || !row.rider_id || !history.morningRiderIds.has(row.rider_id)) continue;
    const rank = rankByRider.get(row.rider_id);
    const outcome = settleBreakawayOutcome(history.riders.get(row.rider_id), typeof rank === "number" ? rank > best : null);
    if (row.result_type === "stage") outcomes[outcome ?? "unknown"] += 1;
    const target = breakawayFlagsForOutcome(true, outcome);
    const current = { breakaway_caught: row.breakaway_caught === true, breakaway_dropped: row.breakaway_dropped ?? null };
    // Kun raekker hvis VISTE tilstand aendres: sat af (ny) eller indhentet
    // (sikkerhedsnettet). En korrekt "indhentet"/"holdt hjem" beholder NULL
    // (= ikke vurderet), som laeses praecis som foer.
    const changesState = target.breakaway_dropped === true
      ? current.breakaway_dropped !== true || current.breakaway_caught
      : target.breakaway_caught !== current.breakaway_caught;
    if (!changesState) continue;
    updates.push({
      id: row.id,
      rider_id: row.rider_id,
      result_type: row.result_type,
      rank: row.rank,
      outcome: outcome ?? "unknown",
      from: current,
      to: { breakaway_caught: target.breakaway_caught, breakaway_dropped: target.breakaway_dropped },
    });
  }
  return { updates, skipped: null, outcomes };
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

/** Plan over alle v4-etaper siden `since` (READ-ONLY). */
export async function planBackfill({ supabase, since = DEFAULT_SINCE, raceId = null }) {
  const hasColumn = await columnExists(supabase);
  let listQuery = supabase
    .from("race_stage_timelines")
    .select("race_id, stage_number, created_at")
    .eq("timeline_version", 2)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (raceId) listQuery = listQuery.eq("race_id", raceId);
  const { data: stages, error } = await listQuery;
  if (error) throw error;

  const perStage = [];
  const totals = { stages: 0, stages_with_updates: 0, rows_to_update: 0, dropped: 0, caught: 0, survived: 0, unknown: 0, skipped: {} };
  for (const stage of stages ?? []) {
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
    if (plan.updates.length) {
      totals.stages_with_updates += 1;
      totals.rows_to_update += plan.updates.length;
      perStage.push({ race_id: stage.race_id, stage_number: stage.stage_number, updates: plan.updates });
    }
  }
  return { since, raceId, hasColumn, totals, perStage };
}

export async function applyBackfill({ supabase, plan }) {
  if (!plan.hasColumn) throw new Error("race_results.breakaway_dropped findes ikke: koer migrationen 2026-10-05-6185 foerst.");
  let updated = 0;
  for (const stage of plan.perStage) {
    for (const update of stage.updates) {
      const { error } = await supabase
        .from("race_results")
        .update(update.to)
        .eq("id", update.id)
        .eq("in_breakaway", true);
      if (error) throw error;
      updated += 1;
    }
  }
  return { updated };
}

function printPlan(plan) {
  const t = plan.totals;
  console.log(`#6185 backfill — v4-etaper siden ${plan.since}${plan.raceId ? ` (løb ${plan.raceId})` : ""}`);
  if (!plan.hasColumn) console.log("ADVARSEL: kolonnen breakaway_dropped findes ikke endnu (migrationen er ikke koert). --apply er blokeret.");
  console.log(`Etaper laest: ${t.stages} · sprunget over: ${JSON.stringify(t.skipped)}`);
  console.log(`Udbryder-udfald (stage-raekker): sat af ${t.dropped} · indhentet ${t.caught} · holdt hjem ${t.survived} · ukendt ${t.unknown}`);
  console.log(`Raekker der rettes: ${t.rows_to_update} paa ${t.stages_with_updates} etaper`);
  for (const stage of plan.perStage) {
    const byOutcome = {};
    for (const update of stage.updates) byOutcome[update.outcome] = (byOutcome[update.outcome] ?? 0) + 1;
    console.log(`  ${stage.race_id} etape ${stage.stage_number}: ${stage.updates.length} raekker ${JSON.stringify(byOutcome)} · placeringer ${stage.updates.filter((u) => u.result_type === "stage").map((u) => u.rank).join(", ")}`);
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

  if (!args.apply) {
    console.log("DRY-RUN — intet er skrevet. Koer med --apply --owner-go efter ejer-go.");
    process.exit(plan.totals.rows_to_update > 0 ? 1 : 0);
  }
  const result = await applyBackfill({ supabase, plan });
  console.log(`Faerdig: ${result.updated} raekker opdateret. Koer dry-run igen: forventet 0.`);
  process.exit(0);
}

// Kun naar scriptet koeres direkte — importeres det af tests, maa intet ske.
if (process.argv[1]?.endsWith("backfill-6185-dropped-breakaway.js")) {
  main().catch((err) => {
    console.error(`backfill-6185 fejlede: ${err.message}`);
    process.exit(2);
  });
}
