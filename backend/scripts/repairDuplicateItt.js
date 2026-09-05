#!/usr/bin/env node
// #4539 · Reparation: erstat den SENESTE af et par "ligner hinanden"-tidskørsler
// (samme profile_type OG distance inden for TT_LOOKALIKE_DISTANCE_BAND_KM, se
// docs/CALENDAR_RULES.md §4) i et allerede-genereret etapeløb.
//
// BAGGRUND: La Course au Soleil fik etape 1 OG 3 som en 20 km flad `itt` —
// strukturelt samme etape to gange (#4539, ejer-bekræftet 31/8). Generatoren er
// rettet (raceStageProfileGenerator.js: SHORT_RACE_TT_CAP), men rettelsen gælder
// kun FREMTIDIGE genereringer. Dette script finder + foreslår en reparation for
// EKSISTERENDE rækker i race_stage_profiles.
//
// Bruger SAMME predikat som generatoren og verify-invariants.js's
// no_duplicate_time_trial_stages (findDuplicateTimeTrialPairs,
// raceStageProfileGenerator.js) — audit og reparation kan derfor aldrig være
// uenige om hvad "ligner hinanden" betyder.
//
// Erstatning: kun profile_type + demand_vector ændres (SAMME distance, anden
// TYPE — "følger CALENDAR_RULES' terræn-mix" ved at genbruge den ETABLEREDE
// itt↔itt_hilly-familie-skelnen, samme konvention som #3546 D's
// markSecondIttAsHilly for Grand Tours). finale_type er uændret ("solo_tt" for
// begge). climbs/elevation_gain_m/sectors/segments (pass 2-ruten) rettes IKKE —
// scope her er profil-DISTINKTHED, ikke en fuld rute-regenerering.
//
// NÆGTER at røre en etape der allerede er kørt: `races.stages_completed` er
// antallet af etaper der ER kørt (0-indekseret næste-etape-markør, se
// adminSimulateRace.js) — en etape med stage_number <= stages_completed er
// historisk facitliste og røres aldrig, uanset --apply.
//
// Usage:
//   node backend/scripts/repairDuplicateItt.js                  # DRY-RUN (default), read-only
//   node backend/scripts/repairDuplicateItt.js --json
//   node backend/scripts/repairDuplicateItt.js --apply --owner-go   # KRÆVER EJER-GO
//
// --apply skriver mod prod og er bevidst gated bag BEGGE flag. Uden --owner-go
// afviser scriptet at køre, uanset hvad (feedback_explicit_go_per_prod_step).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = ok (0 fixable fund, eller apply lykkedes), 1 = fixable fund i dry-run,
//       2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { findDuplicateTimeTrialPairs, DEMAND_VECTORS } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// Erstatningsmapping: skift TIL en anden TT-familie-profil, så predikatet
// (samme profile_type OG distance-bånd) automatisk bliver falsk UANSET distance —
// samme konvention som #3546 D's markSecondIttAsHilly ("GT'ens anden ITT bliver
// itt_hilly"). `ttt` er pauset for ny generering (#2411) men kan optræde i
// historiske par; den mappes også til itt_hilly (samme TT-familie, anden karakter).
export const REPLACEMENT_PROFILE = Object.freeze({
  itt: "itt_hilly",
  itt_hilly: "itt",
  ttt: "itt_hilly",
});

/**
 * REN planlægning (DB injiceres) — hvilke duplikat-par findes, og hvad foreslås?
 * Ingen writes. Testbar uden createClient.
 *
 * @param {{ supabase: object }} args
 * @returns {Promise<{generated_at:string, races_scanned:number, duplicate_pairs:number,
 *   fixable:number, blocked:number, items:object[]}>}
 */
export async function planRepairs({ supabase }) {
  const races = await fetchAllRows(() => supabase
    .from("races")
    .select("id, name, race_type, stages, stages_completed, status")
    .eq("race_type", "stage_race")
    .order("id", { ascending: true }));
  const raceById = new Map(races.map((r) => [r.id, r]));
  const raceIds = races.map((r) => r.id);

  const profileRows = raceIds.length
    ? await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase
        .from("race_stage_profiles")
        .select("id, race_id, stage_number, profile_type, finale_type, distance_km, demand_vector")
        .in("race_id", chunk)
        .order("race_id", { ascending: true }))
    : [];

  const byRace = new Map();
  for (const row of profileRows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(row);
  }

  const items = [];
  for (const [raceId, stages] of byRace.entries()) {
    const race = raceById.get(raceId);
    const pairs = findDuplicateTimeTrialPairs(stages);
    for (const [a, b] of pairs) {
      // b (senere stage_number) er den vi retter — a (den tidligste) er den
      // "originale" og røres aldrig (#4539's opgave: "kun det SENESTE af et par").
      const target = stages.find((s) => s.id === b.id) ?? b;
      const stagesCompleted = Number.isFinite(race?.stages_completed) ? race.stages_completed : 0;
      const alreadyRun = target.stage_number <= stagesCompleted;
      const replacementType = REPLACEMENT_PROFILE[target.profile_type] ?? null;
      const blockReason = alreadyRun
        ? `etape ${target.stage_number} er allerede kørt (stages_completed=${stagesCompleted}) — historisk facitliste røres aldrig`
        : !replacementType
          ? `ingen kendt erstatning for profile_type "${target.profile_type}"`
          : null;

      items.push({
        race_id: raceId,
        race_name: race?.name ?? null,
        race_status: race?.status ?? null,
        stage_a: { stage_number: a.stage_number, profile_type: a.profile_type, distance_km: a.distance_km },
        stage_b: {
          id: target.id,
          stage_number: target.stage_number,
          profile_type: target.profile_type,
          distance_km: target.distance_km,
        },
        blocked: !!blockReason,
        block_reason: blockReason,
        proposed_profile_type: blockReason ? null : replacementType,
        proposed_demand_vector: blockReason ? null : { ...DEMAND_VECTORS[replacementType] },
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    races_scanned: races.length,
    duplicate_pairs: items.length,
    fixable: items.filter((i) => !i.blocked).length,
    blocked: items.filter((i) => i.blocked).length,
    items,
  };
}

function printHuman(plan, { apply }) {
  console.log(`#4539 duplikat-tidskørsel-reparation — ${apply ? "APPLY" : "DRY-RUN (read-only)"} — ${plan.generated_at}\n`);
  console.log(`  ${plan.races_scanned} etapeløb scannet, ${plan.duplicate_pairs} duplikat-par fundet (${plan.fixable} fixable, ${plan.blocked} blokeret).\n`);
  for (const item of plan.items) {
    console.log(`  ${item.race_name ?? item.race_id} (${item.race_id}, ${item.race_status ?? "?"})`);
    console.log(`    etape ${item.stage_a.stage_number} (${item.stage_a.profile_type}, ${item.stage_a.distance_km} km) ≈ etape ${item.stage_b.stage_number} (${item.stage_b.profile_type}, ${item.stage_b.distance_km} km)`);
    if (item.blocked) {
      console.log(`    ⏳ blokeret: ${item.block_reason}`);
    } else {
      console.log(`    → foreslår: etape ${item.stage_b.stage_number} bliver "${item.proposed_profile_type}" (samme distance, ny demand_vector)`);
    }
    console.log();
  }
  if (!apply) {
    console.log("Ingen skrivning foretaget. Kør med --apply --owner-go EFTER eksplicit ejer-go, kun for de FIXABLE fund.");
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const JSON_OUT = args.includes("--json");
  const APPLY = args.includes("--apply");
  const OWNER_GO = args.includes("--owner-go");

  if (APPLY && !OWNER_GO) {
    console.error("--apply kræver også --owner-go. Kør dry-run, vis ejeren listen, og få et eksplicit go først.");
    process.exit(2);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const plan = await planRepairs({ supabase });

    if (APPLY) {
      let fixed = 0;
      for (const item of plan.items) {
        if (item.blocked) continue;
        const { error } = await supabase
          .from("race_stage_profiles")
          .update({ profile_type: item.proposed_profile_type, demand_vector: item.proposed_demand_vector })
          .eq("id", item.stage_b.id);
        if (error) throw new Error(`update ${item.stage_b.id}: ${error.message}`);
        fixed += 1;
        console.log(`  ✔ rettet: ${item.race_name} etape ${item.stage_b.stage_number} → ${item.proposed_profile_type}`);
      }
      console.log(`\n${fixed} etape(r) rettet, ${plan.blocked} blokeret (uændrede). Kør backend/scripts/verify-invariants.js for post-verify.`);
      process.exit(0);
    }

    if (JSON_OUT) console.log(JSON.stringify(plan, null, 2));
    else printHuman(plan, { apply: false });
    process.exit(plan.fixable > 0 ? 1 : 0);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(2);
  }
}
