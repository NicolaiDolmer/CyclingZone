#!/usr/bin/env node
// #5236/#5237/#4874 — balance-baseline FØR de tre nye hårde sessioner.
//
// #4874's accept-krav: "Mål den faktiske sæson-progression pr. evne på ægte
// population: hvor langt bagud ligger brosten/aggression/flat i forhold til
// VO2max?" Dette script svarer på det med ægte tal, ikke et gæt: én række pr.
// rytter pr. evne, min/maks-snapshot inden for et vindue (default 14 dage) fra
// rider_derived_ability_history (skrevet dagligt af dailyTrainingEngine.js —
// se kilde-kommentaren der), og den gennemsnitlige/mediane delta i den periode.
//
// TARGET_ABILITIES er de tre evner #5236/#5237 gør hårdt-trænbare første gang
// (cobblestone, flat, aggression). REFERENCE_ABILITIES er evner der allerede
// KAN trænes hårdt i dag (climbing/punch/tempo via vo2max-familien), til
// direkte sammenligning — det er selve "bagud i forhold til VO2max"-målingen
// #4874 bad om.
//
// READ-ONLY. Ingen writes, ingen migrationer. Kør samme kommando EFTER merge
// (samme vindue-længde, forskudt til efter sessionerne har kørt et par uger)
// for at se om gabet lukker.
//
// Usage:
//   infisical run --env=dev -- node backend/scripts/audit-5236-training-balance-baseline.js
//   infisical run --env=dev -- node backend/scripts/audit-5236-training-balance-baseline.js --days=14 --json
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, kun SELECT)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSupabaseAuditError } from "./audit-error-classifier.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const daysArg = [...args].find((a) => a.startsWith("--days="));
const WINDOW_DAYS = daysArg ? parseInt(daysArg.split("=")[1], 10) : 14;

const TARGET_ABILITIES = ["cobblestone", "flat", "aggression"];
const REFERENCE_ABILITIES = ["climbing", "punch", "tempo"];
const ALL_ABILITIES = [...TARGET_ABILITIES, ...REFERENCE_ABILITIES];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function mean(nums) {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY — kør via `infisical run --env=dev -- node ...`.");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  let rows;
  try {
    rows = await fetchAllRows(() =>
      supabase
        .from("rider_derived_ability_history")
        .select("rider_id, snapshot_date, abilities")
        .gte("snapshot_date", cutoff)
        .order("rider_id", { ascending: true })
        .order("snapshot_date", { ascending: true }),
    );
  } catch (err) {
    console.error(formatSupabaseAuditError("rider_derived_ability_history select", err));
    process.exit(1);
  }

  // Første og sidste snapshot pr. rytter inden for vinduet (rows er allerede
  // sorteret stigende pr. rider_id, snapshot_date — så første/sidste-mødt er nok).
  const firstByRider = new Map();
  const lastByRider = new Map();
  for (const row of rows) {
    if (!firstByRider.has(row.rider_id)) firstByRider.set(row.rider_id, row);
    lastByRider.set(row.rider_id, row);
  }

  const deltasByAbility = Object.fromEntries(ALL_ABILITIES.map((a) => [a, []]));
  let ridersWithSpan = 0;
  for (const [riderId, first] of firstByRider) {
    const last = lastByRider.get(riderId);
    if (!last || last.snapshot_date === first.snapshot_date) continue; // kun ét punkt — ingen delta at måle
    ridersWithSpan++;
    for (const ability of ALL_ABILITIES) {
      const a = Number(first.abilities?.[ability]);
      const b = Number(last.abilities?.[ability]);
      if (Number.isFinite(a) && Number.isFinite(b)) deltasByAbility[ability].push(b - a);
    }
  }

  const summary = {};
  for (const ability of ALL_ABILITIES) {
    const d = deltasByAbility[ability];
    summary[ability] = {
      riders: d.length,
      meanDelta: round2(mean(d)),
      medianDelta: round2(median(d)),
      pctGainedAny: d.length ? round2((d.filter((x) => x > 0).length / d.length) * 100) : null,
    };
  }

  const result = {
    measuredAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    cutoffDate: cutoff,
    totalRiders: firstByRider.size,
    ridersWithSpan,
    targetAbilities: TARGET_ABILITIES,
    referenceAbilities: REFERENCE_ABILITIES,
    summary,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`⚖️  #5236/#5237/#4874 — trænings-balance-baseline (${WINDOW_DAYS} dage, cutoff ${cutoff})`);
  console.log(`   ${firstByRider.size} ryttere med mindst ét snapshot i vinduet, ${ridersWithSpan} med spænd (≥2 snapshot-dage) at måle delta på.\n`);
  console.log("| Evne | Trænbar hårdt i dag? | Ryttere | Snit-delta | Median-delta | % med fremgang |");
  console.log("|---|---|---:|---:|---:|---:|");
  for (const ability of [...TARGET_ABILITIES, ...REFERENCE_ABILITIES]) {
    const s = summary[ability];
    const hard = REFERENCE_ABILITIES.includes(ability) ? "ja (vo2max-familien)" : "nej → #5236/#5237";
    console.log(`| ${ability} | ${hard} | ${s.riders} | ${s.meanDelta ?? "–"} | ${s.medianDelta ?? "–"} | ${s.pctGainedAny ?? "–"}% |`);
  }
  console.log("\nGem dette output i PR-body som FØR-baseline. Kør samme kommando igen et par uger efter merge for EFTER-tallene.");
}

main().catch((err) => {
  console.error(formatSupabaseAuditError("audit-5236-training-balance-baseline", err));
  process.exit(1);
});
