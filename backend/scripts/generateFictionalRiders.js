#!/usr/bin/env node
// CLI til fiktiv-rytter-generatoren (#669).
//
// Fase 3-brug (ingen DB):   node scripts/generateFictionalRiders.js --count 100 --seed 669 --out sample.json
// Fase 4-brug (preview-DB): node scripts/generateFictionalRiders.js --apply --supabase-url <PREVIEW_URL> --supabase-key <KEY> --count 100 --seed 669
//
// Sikkerhedsgarantier (matcher docs/slices/669-fictional-riders.md):
//   • Default er DRY-RUN — rører aldrig en DB uden eksplicit --apply.
//   • NÆGTER at skrive til prod-projektet (hardcoded ref-deny).
//   • Kun INSERT. Pre-flight assert: hver payload har pcm_id === null.
//   • Eksisterende navne hentes (pagineret) og fødes til generatoren, så et
//     fiktivt navn aldrig kolliderer med en ægte rytter (point-tab-fælden).

import { writeFileSync } from "node:fs";
import { generateFictionalRiders, toInsertPayload } from "../lib/fictionalRiderGenerator.js";
import { foldNameNordic } from "../lib/pcmRiderMatcher.js";

// Prod Supabase-projekt — dette script må ALDRIG skrive hertil.
const PROD_PROJECT_REF = "ghwvkxzhsbbltzfnuhhz";
const INSERT_BATCH = 500;

function parseArgs(argv) {
  const args = { count: 100, seed: 669, referenceYear: new Date().getFullYear(), apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--count") args.count = parseInt(argv[++i], 10);
    else if (a === "--seed") args.seed = parseInt(argv[++i], 10);
    else if (a === "--reference-year") args.referenceYear = parseInt(argv[++i], 10);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--supabase-url") args.url = argv[++i];
    else if (a === "--supabase-key") args.key = argv[++i];
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

async function fetchAllRows(supabase, label, select, filter) {
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  for (;;) {
    let q = supabase.from("riders").select(select).range(offset, offset + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`Kunne ikke hente ${label}: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function printSummary({ riders, coverage }) {
  console.log(`\n📊 Genereret ${riders.length} fiktive ryttere`);
  console.log("  Cluster-fordeling:", JSON.stringify(coverage.byCluster));
  const fb = Object.keys(coverage.fallbackNationalities);
  if (fb.length) {
    console.log(`  ⚠️  Faldt til generisk navne-pool (mangler dedikeret cluster):`,
      JSON.stringify(coverage.fallbackNationalities));
  } else {
    console.log("  ✅ Alle nationaliteter ramte en dedikeret navne-pool.");
  }

  console.log("\n  Udsnit (første 12):");
  console.log("  " + "navn".padEnd(26) + "nat  rolle        tier        alder uci   nøglestats");
  for (const r of riders.slice(0, 12)) {
    const name = `${r.firstname} ${r.lastname}`.slice(0, 25).padEnd(26);
    const m = r._meta;
    const keystats = `bj${r.stat_bj} sp${r.stat_sp} tt${r.stat_tt}`;
    console.log(`  ${name}${r.nationality_code.padEnd(5)}${m.role.padEnd(13)}${m.tier.padEnd(12)}${String(m.age).padEnd(6)}${String(r.uci_points).padEnd(6)}${keystats}`);
  }
}

async function applyToDb(args, riders) {
  if (!args.url || !args.key) {
    throw new Error("--apply kræver --supabase-url og --supabase-key");
  }
  if (args.url.includes(PROD_PROJECT_REF)) {
    throw new Error(`NÆGTER at skrive til prod-projektet (${PROD_PROJECT_REF}). Brug en preview/branch-DB.`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(args.url, args.key);

  const payload = toInsertPayload(riders);
  // Pre-flight: absolut garanti for at vi kun rører egne ryttere.
  for (const r of payload) {
    if (r.pcm_id !== null) throw new Error("Pre-flight fejl: payload med pcm_id !== null — afbryder.");
  }

  const before = await fetchAllRows(supabase, "riders(count)", "id", (q) => q.is("pcm_id", null));
  console.log(`\n⬆️  Indsætter ${payload.length} ryttere i preview-DB (eksisterende egne ryttere: ${before.length})...`);

  let inserted = 0;
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    const batch = payload.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from("riders").insert(batch);
    if (error) throw new Error(`Insert-batch fejlede ved ${i}: ${error.message}`);
    inserted += batch.length;
    console.log(`  ✅ Batch ${Math.floor(i / INSERT_BATCH) + 1}: ${batch.length}`);
  }

  const after = await fetchAllRows(supabase, "riders(count)", "id", (q) => q.is("pcm_id", null));
  console.log(`\n✅ Færdig: +${inserted} indsat. Egne ryttere nu: ${after.length} (delta ${after.length - before.length}).`);
  return { inserted, before: before.length, after: after.length };
}

async function main() {
  const args = parseArgs(process.argv);

  // Hent eksisterende navne til unikheds-håndhævelse (kun ved --apply, hvor vi
  // har en DB). I dry-run genereres uden eksisterende-sæt (kun intern unikhed).
  let existingFoldedNames = new Set();
  if (args.apply) {
    if (args.url?.includes(PROD_PROJECT_REF)) {
      throw new Error(`NÆGTER at læse/skrive prod-projektet (${PROD_PROJECT_REF}).`);
    }
    if (args.url && args.key) {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(args.url, args.key);
      const rows = await fetchAllRows(supabase, "riders", "firstname, lastname");
      existingFoldedNames = new Set(rows.map((r) => foldNameNordic(`${r.firstname || ""} ${r.lastname || ""}`)));
      console.log(`🔎 Hentede ${existingFoldedNames.size} eksisterende navne til unikheds-check.`);
    }
  }

  const result = generateFictionalRiders({
    seed: args.seed,
    count: args.count,
    referenceYear: args.referenceYear,
    existingFoldedNames,
  });

  printSummary(result);

  if (args.out) {
    const audit = {
      seed: result.seed,
      count: args.count,
      referenceYear: args.referenceYear,
      generatedAt: new Date().toISOString(),
      coverage: result.coverage,
      riders: result.riders,
    };
    writeFileSync(args.out, JSON.stringify(audit, null, 2));
    console.log(`\n💾 Audit-fil skrevet: ${args.out}`);
  }

  if (args.apply) {
    await applyToDb(args, result.riders);
  } else {
    console.log("\n🔍 DRY-RUN — ingen DB rørt. Tilføj --apply + preview-credentials for at indsætte.");
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
