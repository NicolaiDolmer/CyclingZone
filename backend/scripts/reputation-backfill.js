#!/usr/bin/env node
// #1099 · Backfill af omdømme-hændelsesbogen (spec §8, PR 1).
//
// Afspiller ALLE afsluttede løb i ALLE sæsoner gennem den samme motor som
// løbsafslutningen bruger (backend/lib/reputationEngine.js via
// reputationReplay.js), og skriver — kun med --apply --owner-go — hændelserne
// til `rider_reputation_events` plus de afledte tal på `riders`.
//
// Uden backfill starter hele spillet med et tomt omdømme: 7.500 ryttere,
// tre sæsoners resultater, og et tal der først begynder at bevæge sig ved
// næste løb. Med backfill er tallet sandt fra dag ét.
//
// Usage:
//   node backend/scripts/reputation-backfill.js --dry-run          # default, READ-ONLY
//   node backend/scripts/reputation-backfill.js --dry-run --json
//   node backend/scripts/reputation-backfill.js --apply --owner-go # KRÆVER EJER-GO
//
// --apply skriver mod prod og er bevidst gated bag BEGGE flag (samme mønster
// som backend/scripts/retire-stuck-ai-teams.js). Kør ALDRIG --apply uden et
// eksplicit go på præcis de tal dry-run'en har vist ejeren, og aldrig før
// kalibrerings-rapporten (reputation-calibration.js) er godkendt: en backfill
// med forkerte vægte skal ellers rulles tilbage rytter for rytter.
//
// Idempotent: hændelserne bærer dedupe_key, så en gentagen --apply tilføjer
// intet. Rytter-tallene genberegnes altid fra hele bogen, aldrig som delta.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = ok, 1 = dry-run fandt hændelser at skrive, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runReplay } from "../lib/reputationReplay.js";
import { persistReputationEvents, refreshRiderReputations } from "../lib/reputationPersist.js";
import { SEED_FLOOR_WEIGHT } from "../lib/reputationConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// Rytter-genberegningen laver ét update pr. rytter. Ved en fuld backfill er det
// nogle tusinde — kør dem i portioner, så en afbrydelse ikke efterlader
// scriptet uden nogen anelse om hvor langt det nåede (bogen er allerede skrevet
// på det tidspunkt, og genberegningen kan trygt køres igen).
const RIDER_REFRESH_CHUNK = 250;

export function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: argv.includes("--apply"),
    ownerGo: argv.includes("--owner-go"),
    json: argv.includes("--json"),
  };
}

/**
 * REN planlægning (DB injiceres): hvad VILLE backfill'en skrive?
 * Ingen writes. Testbar uden createClient.
 */
export async function planBackfill({ supabase }) {
  const replay = await runReplay(supabase);
  const { events, byRider, perSeasonClass, racesWithEvents, skippedResults, races, seasons, activeSeason } = replay;

  const perSeason = new Map();
  for (const row of perSeasonClass) {
    const key = row.season_number ?? "?";
    if (!perSeason.has(key)) perSeason.set(key, { season_number: row.season_number, events: 0, form_points: 0, floor_credit: 0 });
    const bucket = perSeason.get(key);
    bucket.events += row.events;
    bucket.form_points += row.form_points;
    bucket.floor_credit += row.floor_credit;
  }

  const perKind = new Map();
  for (const event of events) {
    perKind.set(event.event_kind, (perKind.get(event.event_kind) ?? 0) + 1);
  }

  return {
    generated_at: new Date().toISOString(),
    active_season_number: activeSeason?.number ?? null,
    completed_races: races.length,
    races_with_events: racesWithEvents,
    skipped_results_on_unknown_races: skippedResults,
    total_events: events.length,
    riders_touched: byRider.size,
    per_season: [...perSeason.values()].sort((a, b) => (a.season_number ?? 0) - (b.season_number ?? 0)),
    per_season_class: perSeasonClass,
    per_kind: [...perKind.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count })),
    events,
    seasons,
  };
}

function printPlan(plan) {
  console.log("");
  console.log("=== Omdømme-backfill (#1099) — afspilning af alle afsluttede løb ===");
  console.log(`  Afsluttede løb:            ${plan.completed_races}`);
  console.log(`  Løb der gav hændelser:     ${plan.races_with_events}`);
  console.log(`  Hændelser i alt:           ${plan.total_events}`);
  console.log(`  Ryttere berørt:            ${plan.riders_touched}`);
  console.log(`  Aktiv sæson (nummer):      ${plan.active_season_number ?? "ukendt"}`);
  if (plan.skipped_results_on_unknown_races) {
    console.log(`  Resultatrækker sprunget over (løb ikke 'completed'): ${plan.skipped_results_on_unknown_races}`);
  }

  console.log("");
  console.log("  Pr. sæson:");
  for (const row of plan.per_season) {
    console.log(`    S${row.season_number ?? "?"}  hændelser ${String(row.events).padStart(6)}  form ${row.form_points.toFixed(1).padStart(9)}  gulv-kredit ${row.floor_credit.toFixed(1).padStart(8)}`);
  }

  console.log("");
  console.log("  Pr. sæson og løbsklasse:");
  for (const row of plan.per_season_class) {
    console.log(`    S${row.season_number ?? "?"}  ${String(row.race_class ?? "?").padEnd(16)} hændelser ${String(row.events).padStart(6)}  form ${row.form_points.toFixed(1).padStart(9)}  gulv-kredit ${row.floor_credit.toFixed(1).padStart(8)}`);
  }

  console.log("");
  console.log("  Pr. hændelsestype:");
  for (const row of plan.per_kind) {
    console.log(`    ${row.kind.padEnd(24)} ${String(row.count).padStart(7)}`);
  }
  console.log("");
}

export async function applyBackfill({ supabase, plan }) {
  const seasonNumberById = new Map(plan.seasons.map((s) => [s.id, Number(s.number)]));
  const { inserted, deduped } = await persistReputationEvents({ supabase, events: plan.events });

  const riderIds = [...new Set(plan.events.map((e) => e.rider_id))];
  let updated = 0;
  for (let i = 0; i < riderIds.length; i += RIDER_REFRESH_CHUNK) {
    const chunk = riderIds.slice(i, i + RIDER_REFRESH_CHUNK);
    const stats = await refreshRiderReputations({
      supabase,
      riderIds: chunk,
      currentSeasonIndex: plan.active_season_number,
      seasonNumberById,
      options: { seedFloorWeight: SEED_FLOOR_WEIGHT },
    });
    updated += stats.updated;
    console.log(`  … ryttere genberegnet: ${updated}/${riderIds.length}`);
  }
  return { inserted, deduped, ridersUpdated: updated };
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
    console.error("--apply kræver --owner-go. Kør dry-run'en, vis tallene til ejeren, og få et eksplicit go først.");
    process.exit(2);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const plan = await planBackfill({ supabase });

  if (args.json) {
    // Hændelseslisten selv er titusinder af rækker — den hører ikke i et
    // rapport-JSON. Tallene gør.
    const { events: _events, seasons: _seasons, ...summary } = plan;
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printPlan(plan);
  }

  if (!args.apply) {
    console.log("DRY-RUN — intet er skrevet. Kør med --apply --owner-go efter ejer-go.");
    process.exit(plan.total_events > 0 ? 1 : 0);
  }

  console.log("APPLY — skriver hændelsesbog + rytter-omdømme …");
  const result = await applyBackfill({ supabase, plan });
  console.log(`Færdig: ${result.inserted} hændelser skrevet, ${result.deduped} allerede registreret, ${result.ridersUpdated} ryttere opdateret.`);
  process.exit(0);
}

// Kun når scriptet køres direkte — importeres det af tests, må intet ske.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("reputation-backfill.js")) {
  main().catch((err) => {
    console.error(`reputation-backfill fejlede: ${err.message}`);
    process.exit(2);
  });
}
