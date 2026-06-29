// Engangs-backfill (#2001): populér rider_derived_abilities.ability_caps +
// ability_progress for ryttere hvor de er NULL.
//
// ROD-ÅRSAG: ability_caps + ability_progress blev KUN populeret lazily ved første
// sæson-progression (riderProgressionEngine) eller daglig trænings-tick
// (dailyTrainingEngine). Derive-stien skrev kun ungdoms-caps for akademi-alder-ryttere
// (#1791) og aldrig progress. Ryttere der aldrig blev udviklet/trænet — frie agenter,
// ikke-tickede hold — endte permanent med begge NULL. Den nye rytter-side kan så ikke
// vise progress-bar (XP til næste +1) eller caps-loft ægte. (Verificeret på Ayoub Cherif
// b896912d… — begge NULL, evne-kolonner udfyldt.)
//
// FIX: derive-stien (backfillCores.deriveForRiderIds) wirer nu begge felter for ALLE
// nye ryttere (going-forward). Dette script healer de EKSISTERENDE NULL-ryttere med
// ÉN delt, ren init (buildCapsForRider + buildProgressInit) der matcher præcis det loft
// motoren ellers lazy-initerede:
//   • akademi-alder (16-21): afkoblet ungdoms-loft (buildYouthCaps)
//   • voksen: baseline-abilities + headroom×signatur (buildCaps)
//   • progress: nul-initialiseret (ægte nul akkumuleret træning, ikke placeholder)
//
// Idempotent: rører kun rækker hvor ability_caps ELLER ability_progress er NULL; en
// allerede-populeret rytter springes over (bevarer ægte akkumuleret progress/caps).
// Deterministisk: samme input → samme caps.
//
//   node scripts/backfillAbilityProgressCaps.js          # DRY-RUN (default — ingen writes)
//   node scripts/backfillAbilityProgressCaps.js --live    # APPLY
//
// KØR ALDRIG --live mod prod uden ejer-godkendelse. Ejeren kører --live selv.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { VISIBLE_ABILITIES, CALIBRATION } from "../lib/abilityDerivation.js";
import { buildCapsForRider, buildProgressInit } from "../lib/riderProgression.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITE_CONCURRENCY = 25;

// Rytter-alder fra birthdate (asOfYear − fødselsår). Spejler abilityDerivation.ageFrom-
// modellen (kun året tæller til akademi-gaten). null hvis birthdate mangler/ugyldig.
function ageFromBirthdate(birthdate, asOfYear = CALIBRATION.asOfYear) {
  const year = birthdate ? new Date(birthdate).getFullYear() : null;
  if (!Number.isFinite(year)) return null;
  return asOfYear - year;
}

// REN orkestrering (DB injiceres) — testbar uden createClient.
export async function runAbilityProgressCapsBackfill({ supabase, dryRun = true, log = console.log, asOfYear = CALIBRATION.asOfYear }) {
  // 1) Hent alle abilities-rækker hvor enten caps eller progress er NULL, joinet med
  //    rytterens type/potentiale/birthdate (kilden til caps). !inner holder orphan-
  //    abilities ude (ingen rytter → kan ikke beregne caps).
  const abilityCols = ["rider_id", "ability_caps", "ability_progress", ...VISIBLE_ABILITIES].join(", ");
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`${abilityCols}, riders!inner(id, primary_type, secondary_type, potentiale, birthdate, is_retired)`)
      .or("ability_caps.is.null,ability_progress.is.null")
      .order("rider_id", { ascending: true }));

  log(`Rækker med NULL caps eller progress (joinet med rytter): ${rows.length}`);
  if (rows.length === 0) {
    log("Intet at gøre — alle abilities-rækker har caps + progress.");
    return { dryRun, candidates: 0, capsSet: 0, progressSet: 0, skippedNoType: 0, written: 0 };
  }

  const progressInit = buildProgressInit();
  const updates = [];
  let capsSet = 0, progressSet = 0, skippedNoType = 0;

  for (const row of rows) {
    const rider = Array.isArray(row.riders) ? row.riders[0] : row.riders;
    if (!rider) { skippedNoType++; continue; }

    const patch = {};

    // ability_caps: kun hvis NULL (bevar ægte/eksisterende loft).
    if (row.ability_caps == null) {
      if (!rider.primary_type || rider.potentiale == null) {
        // Uden type/potentiale kan caps ikke beregnes korrekt — spring over (heal-sweep
        // / type-backfill skal køre først). Progress sættes stadig nedenfor.
        skippedNoType++;
      } else {
        const baseline = {};
        for (const k of VISIBLE_ABILITIES) if (row[k] != null) baseline[k] = Number(row[k]);
        patch.ability_caps = buildCapsForRider(
          baseline,
          { potentiale: rider.potentiale, age: ageFromBirthdate(rider.birthdate, asOfYear) },
          rider.primary_type,
          rider.secondary_type,
        );
        capsSet++;
      }
    }

    // ability_progress: kun hvis NULL (bevar ægte akkumuleret progress).
    if (row.ability_progress == null) {
      patch.ability_progress = progressInit;
      progressSet++;
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ rider_id: row.rider_id, patch });
    }
  }

  log(`Plan: opdatér ${updates.length} rækker · sætter caps på ${capsSet} · progress på ${progressSet}` +
      (skippedNoType ? ` · ${skippedNoType} sprunget over (mangler type/potentiale)` : ""));

  if (dryRun) {
    log("DRY-RUN — ingen writes. Kør med --live for at anvende.");
    return { dryRun: true, candidates: rows.length, capsSet, progressSet, skippedNoType, written: 0 };
  }

  // 2) Skriv batched (samme concurrency-mønster som dailyTrainingEngine/backfillCores).
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ rider_id, patch }) =>
      supabase.from("rider_derived_abilities").update(patch).eq("rider_id", rider_id)
        .then(({ error }) => { if (error) throw new Error(`update ${rider_id}: ${error.message}`); })));
    written += batch.length;
  }
  log(`LIVE — opdaterede ${written} rækker.`);
  return { dryRun: false, candidates: rows.length, capsSet, progressSet, skippedNoType, written };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("backfillAbilityProgressCaps.js")) {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(`=== ability_caps + ability_progress backfill ${dryRun ? "(DRY-RUN)" : "(LIVE)"} (#2001) ===`);
  runAbilityProgressCapsBackfill({ supabase, dryRun })
    .then((r) => { console.log("OK:", JSON.stringify(r)); process.exit(0); })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
