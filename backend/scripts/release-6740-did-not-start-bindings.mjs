#!/usr/bin/env node
// #6740 (Friis 17/10) — engangs-frigivelse af ryttere bundet i løb deres hold ikke kører.
//
// Før #6740-rettelsen beholdt et hold der blev fjernet ved start (under gulvet) sine
// race_entries, og de bandt rytterne løbet ud (binding_span + race_entry_days), så de
// ikke kunne køre overlappende løb. Fra nu af frigiver raceRunner selv holdet ved start
// (releaseTeamsThatDidNotStart). Dette script gør det samme for de løb der allerede
// kører: for hvert startet, ikke-afsluttet løb med et etape-1-snapshot findes de hold
// der har entries, men ingen rytter i startfeltet og ingen afmelding. De får en afmelding
// med withdrawn_reason = 'did_not_start' (samme mekanik, samme trigger-frigivelse).
//
// Løb uden snapshot (legacy) springes over: uden det frosne felt kan vi ikke vide sikkert
// hvem der startede. Ingen beskeder sendes herfra.
//
// IDEMPOTENS: upsert med ignoreDuplicates; et hold med en afmelding (frivillig eller
// tidligere kørsel) planlægges aldrig igen.
//
// Default = dry-run (ingen writes). Tilføj --execute for rigtig kørsel (ejer-go pr. kørsel).
//   railway run --service CyclingZone -- node scripts/release-6740-did-not-start-bindings.mjs [--execute]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { releaseTeamsThatDidNotStart, planDidNotStartReleases } from "../lib/raceWithdrawal.js";

// Planen bor i raceWithdrawal.js (delt med raceRunners afstemning ved senere etaper).
export { planDidNotStartReleases };

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__dirname, "..", ".env") });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler");
  const execute = process.argv.includes("--execute");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const races = await fetchAllRows(() => supabase.from("races").select("id, name")
    .gt("stages_completed", 0).neq("status", "completed").order("id"));
  const raceIds = races.map((r) => r.id);
  const runs = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_simulation_runs")
    .select("race_id, entrant_snapshot").eq("stage_number", 1).in("race_id", chunk).order("race_id"));
  const snapshots = new Map();
  for (const run of runs) {
    if (!Array.isArray(run.entrant_snapshot)) continue;
    snapshots.set(run.race_id, new Set(run.entrant_snapshot.map((x) => (typeof x === "string" ? x : x?.rider_id)).filter(Boolean)));
  }
  const entries = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_entries")
    .select("race_id, team_id, rider_id").in("race_id", chunk).order("race_id").order("rider_id"));
  const withdrawals = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_withdrawals")
    .select("race_id, team_id").in("race_id", chunk).order("race_id").order("team_id"));

  const plan = planDidNotStartReleases({ races, snapshots, entries, withdrawals });
  const nameById = new Map(races.map((r) => [r.id, r.name]));
  const pairs = plan.reduce((n, p) => n + p.teamIds.length, 0);
  const riders = entries.filter((e) => plan.some((p) => p.raceId === e.race_id && p.teamIds.includes(e.team_id))).length;
  console.log(`${execute ? "EXECUTE" : "DRY-RUN"}: ${races.length} startede løb (${snapshots.size} med snapshot) · ${pairs} (løb, hold) · ${riders} ryttere frigives`);
  for (const p of plan) console.log(`  ${nameById.get(p.raceId) ?? p.raceId} (${p.raceId}): ${p.teamIds.length} hold`);
  if (!execute) return;
  for (const p of plan) {
    await releaseTeamsThatDidNotStart({ supabase, raceId: p.raceId, teamIds: p.teamIds });
  }
  console.log(`Færdig: ${pairs} afmeldinger med withdrawn_reason='did_not_start' skrevet.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
