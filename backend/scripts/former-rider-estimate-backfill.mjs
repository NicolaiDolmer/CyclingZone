// #7455 (ejerens valg A 12/11): engangs-backfill af skøn om tidligere ryttere.
//
// HVORFOR: holdet skal beholde sin viden om en rytter, der har forladt holdet
// (formerRiderKnowledge.js lægger sæsonfaldet på ved visning). Men de gemte skøn
// (#6110) blev først skrevet ved tændingen 22/11, og kun for ryttere, der stod på
// holdet dengang. En rytter solgt før det har ingen række for sit tidligere hold,
// så holdet ser "Ikke scoutet" om ham. Dette script skriver den række.
//
// HVAD DET SKRIVER: præcis det, søndagskørslen ville have skrevet for rytteren,
// mens han stod på holdet: egen viden ud fra holdets afregnede træninger med ham
// (også en tidligere periode, potentialEstimateWriter.loadTrainingDates), holdets
// stab, eventuelle kig, og samme sande tal. Trigger "backfill": en række oprettes
// kun, hvor intet er gemt, og en gemt række overskrives aldrig. Derfor:
//   - IDEMPOTENT: anden kørsel skriver 0 rækker.
//   - Ingen backup nødvendig: intet eksisterende ændres. Rul tilbage ved at slette
//     rækker med write_reason = 'backfill' og computed_at = kørslens tidsstempel,
//     som scriptet skriver ud.
// Ordet falder derefter ved visning efter reglen (scouting.js), så en rytter solgt
// for to sæsoner siden vises to trin under det, holdet vidste.
//
// SIKKERHED
//   - DRY-RUN er default og skriver intet. Output er kun tællinger.
//   - --apply kræver --owner-go og samme tilstand som søndagskørslen
//     (potential_estimate_writes tændt, potential_estimate_params gyldig).
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/former-rider-estimate-backfill.mjs
//   infisical run --env=prod -- node scripts/former-rider-estimate-backfill.mjs --apply --owner-go   # KUN efter ejerens "kør"

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import {
  ESTIMATE_RIDER_COLUMNS, loadEstimateTeamIds, loadEstimateWriteConfig, planTeamEstimatesFromDb, writeTeamEstimates,
} from "../lib/potentialEstimateWriter.js";
import { formerRidersByTeam } from "../lib/formerRiderKnowledge.js";

export const BACKFILL_TRIGGER = "backfill";

// Planlægningen skal se rytteren, som han stod på det tidligere hold: writeren
// regner egen viden for ryttere, hvis team_id er holdet. Kun i hukommelsen; intet
// om rytteren skrives.
export function asFormerTeamRiders(riders, teamId) {
  return (riders ?? []).map((rider) => ({ ...rider, team_id: teamId }));
}

/**
 * Kørslen. { ran: false, reason } eller { ran: true, mode, teams, riders, written, ... }.
 * `writer` kan erstattes i tests.
 */
export async function runFormerRiderEstimateBackfill({
  supabase, apply = false, now = new Date(),
  writer = { loadEstimateWriteConfig, loadEstimateTeamIds, planTeamEstimatesFromDb, writeTeamEstimates },
} = {}) {
  const mode = apply ? "apply" : "dry-run";
  const config = await writer.loadEstimateWriteConfig(supabase, { now });
  if (!config.enabled) return { ran: false, mode, reason: config.reason };
  config.truthCache = new Map();

  const [teamIds, events] = await Promise.all([
    writer.loadEstimateTeamIds(supabase),
    fetchAllRows(() => supabase.from("rider_ownership_events")
      .select("id, rider_id, from_team_id, to_team_id, occurred_at").order("id")),
  ]);
  const riderIds = [...new Set(events.map((event) => event.rider_id).filter(Boolean))];
  // schema-columns-ok: talent_ceiling kommer fra 2026-11-04-6110-potential-estimates.sql, snapshottet er ældre
  const riders = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("riders").select(ESTIMATE_RIDER_COLUMNS).in("id", chunk).order("id"));
  const riderById = new Map(riders.map((rider) => [rider.id, rider]));
  const currentTeam = new Map(riders.map((rider) => [rider.id, rider.team_id]));
  const former = formerRidersByTeam(events, teamIds, currentTeam);

  const computedAt = now.toISOString();
  const totals = { teams: 0, riders: 0, written: 0, kept: 0, noKnowledge: 0, noCeiling: 0 };
  let failedTeams = 0;
  let firstError = null;
  for (const [teamId, ids] of former) {
    const teamRiders = asFormerTeamRiders(ids.map((id) => riderById.get(id)).filter(Boolean), teamId);
    if (!teamRiders.length) continue;
    totals.teams += 1;
    totals.riders += teamRiders.length;
    try {
      const counts = apply
        ? await writer.writeTeamEstimates({ supabase, teamId, riders: teamRiders, trigger: BACKFILL_TRIGGER, config, now })
        : (await writer.planTeamEstimatesFromDb({ supabase, teamId, riders: teamRiders, trigger: BACKFILL_TRIGGER, config, now })).counts;
      for (const key of ["written", "kept", "noKnowledge", "noCeiling"]) totals[key] += counts[key] ?? 0;
    } catch (err) {
      // best-effort pr. hold: kørslen er idempotent, så et fejlet hold tages ved næste kørsel.
      failedTeams += 1;
      firstError ??= err.message;
    }
  }
  return { ran: true, mode, computedAt, ...totals, failedTeams, ...(firstError ? { firstError } : {}) };
}

export function parseArgs(argv) {
  const has = (flag) => argv.includes(`--${flag}`);
  return { apply: has("apply"), ownerGo: has("owner-go") };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(here, "..", ".env"), quiet: true });
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.ownerGo) {
    console.error("--apply kræver --owner-go (ejerens ordrette \"kør\" efter at have set dry-run'et).");
    process.exit(2);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const report = await runFormerRiderEstimateBackfill({ supabase, apply: args.apply });
  if (!report.ran) {
    console.error(`#7455 backfill (${report.mode}) kørte ikke: ${report.reason}`);
    process.exit(1);
  }
  console.log(`#7455 backfill af skøn om tidligere ryttere (${report.mode.toUpperCase()})`);
  console.log(JSON.stringify(report, null, 2));
  if (args.apply) console.log(`Rul tilbage: slet rækker med write_reason = '${BACKFILL_TRIGGER}' og computed_at = '${report.computedAt}'.`);
  if (report.failedTeams > 0) {
    console.error(`${report.failedTeams} hold fejlede (${report.firstError}). Kør igen; kørslen er idempotent.`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.message || err); process.exit(1); });
}
