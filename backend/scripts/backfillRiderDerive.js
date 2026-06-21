// Engangs-backfill (#1673): re-deriver ALLE "strandede" aktive ryttere.
//
// En strandet rytter er aktiv (is_retired=false) og mangler enten sin
// rider_derived_abilities-række ELLER har base_value IS NULL — derive-trinet
// fuldførte aldrig for ham. De rå stat_*-felter er intakte; kun derive-laget
// mangler. Serve-laget (api.js embed) har ingen fallback → blank stats i UI.
//
// Rod-årsag: deriveForRiderIds (backfillCores.js) kunne efterlade et partielt batch
// strandet UDEN at fejle. 75 fiktive ryttere blev ramt af et batch 2026-06-18 hvor
// derive ikke fuldførte (5 på ægte menneske-hold, resten free agents). De team-
// markør-gatede heal-sweeps (#1563/#1584) fanger dem strukturelt ikke. Se postmortem
// .claude/learnings/2026-06-21-1673-riders-missing-derive.md.
//
// Genbruger findStrandedRiderIds + deriveForRiderIds (samme rene derive-kæde som
// runtime). Idempotent + deterministisk: re-derive af en allerede-derived rytter
// giver samme værdier.
//
//   node scripts/backfillRiderDerive.js          # DRY-RUN (default — ingen writes)
//   node scripts/backfillRiderDerive.js --live    # APPLY (skriv derive for de strandede)
//
// KØR ALDRIG --live mod prod uden ejer-godkendelse. Ejeren kører --live selv.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findStrandedRiderIds } from "../lib/riderDeriveHealSweep.js";
import { deriveForRiderIds } from "../lib/backfillCores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// REN orkestrering (DB injiceres) — testbar uden createClient.
export async function runRiderDeriveBackfill({ supabase, dryRun = true, log = console.log }) {
  const { strandedIds, activeCount } = await findStrandedRiderIds(supabase);
  log(`Aktive ryttere: ${activeCount} · strandede (uden derive ELLER base_value=NULL): ${strandedIds.length}`);

  if (strandedIds.length === 0) {
    log("Intet at gøre — alle aktive ryttere har derive + base_value.");
    return { dryRun, stranded: 0, healed: 0, activeCount };
  }

  log(`Plan: re-deriver ${strandedIds.length} ryttere (physiology → abilities → type → base_value).`);
  log(`  Første id'er: ${strandedIds.slice(0, 10).join(", ")}${strandedIds.length > 10 ? ", …" : ""}`);

  if (dryRun) {
    // Dry-run af derive: beregn uden writes for at bevise pipelinen kan værdisætte dem.
    const preview = await deriveForRiderIds(supabase, strandedIds, { dryRun: true, log });
    log(`DRY-RUN — ingen writes. Pipeline ville: ${JSON.stringify(preview)}`);
    log("Kør med --live for at anvende.");
    return { dryRun: true, stranded: strandedIds.length, healed: 0, activeCount, preview };
  }

  // LIVE: deriveForRiderIds kaster (kilde-guard, #1673) hvis et batch ikke dækker alle id'er.
  const res = await deriveForRiderIds(supabase, strandedIds, { dryRun: false, log });
  log(`LIVE — derive skrevet: ${JSON.stringify(res)}`);
  return { dryRun: false, stranded: strandedIds.length, healed: res?.riders ?? 0, activeCount, res };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("backfillRiderDerive.js")) {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(`=== Rytter-derive backfill ${dryRun ? "(DRY-RUN)" : "(LIVE)"} (#1673) ===`);
  runRiderDeriveBackfill({ supabase, dryRun })
    .then((r) => { console.log("OK:", JSON.stringify({ dryRun: r.dryRun, stranded: r.stranded, healed: r.healed })); process.exit(0); })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
