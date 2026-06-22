#!/usr/bin/env node
// CLI til AI-fyld-generatoren (#1688, forever-relaunch AI-fill + race-scale).
//
// Fylder de 15 puljer med AI-hold efter den frosne politik (tier 1/2 altid, tier 3/4
// kun hvor en ægte manager bor) via backend/lib/aiTeamGenerator.js. Idempotent +
// reconcilende → kan køres igen uden duplikering; trimmer overskuds-AI når en ægte
// manager joiner en pulje.
//
// Brug:
//   node scripts/generateAiTeams.js                                  (dry-run plan, ingen DB)
//   node scripts/generateAiTeams.js --apply --supabase-url <PREVIEW_URL> --supabase-key <KEY>
//
// SIKKERHEDSGARANTIER (samme mønster som generateFictionalRiders.js):
//   • Default er DRY-RUN — rører aldrig en DB uden eksplicit --apply.
//   • NÆGTER at skrive til prod-projektet (hardcoded ref-deny). Dette script kører
//     ALDRIG mod prod af sig selv; prod-AI-fyld sker via relaunchOrchestrator i en
//     bevidst, gatet relaunch (backend/scripts/relaunchSeason1.js).
//   • --apply kræver eksplicit --supabase-url + --supabase-key (ingen .env-magi).

import { generateAndAllocateAiTeams } from "../lib/aiTeamGenerator.js";
import { LAUNCH_POPULATION } from "../lib/fictionalLaunchPopulation.js";

// Prod Supabase-projekt — dette script må ALDRIG skrive hertil.
const PROD_PROJECT_REF = "ghwvkxzhsbbltzfnuhhz";

function parseArgs(argv) {
  const args = { seed: LAUNCH_POPULATION.seed, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--seed") args.seed = parseInt(argv[++i], 10);
    else if (a === "--supabase-url") args.url = argv[++i];
    else if (a === "--supabase-key") args.key = argv[++i];
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

function assertNotProd(url) {
  if (String(url || "").toLowerCase().includes(PROD_PROJECT_REF.toLowerCase())) {
    throw new Error(`NÆGTER at røre prod-projektet (${PROD_PROJECT_REF}). Brug en preview/branch-DB.`);
  }
}

function printSummary(summary) {
  console.log("\n=== AI-fyld-opsummering ===");
  console.log(`Oprettet: ${summary.created} AI-hold`);
  console.log(`Fjernet:  ${summary.removed} AI-hold (reconcile)`);
  console.log("\nPr. pulje (tier · ægte managere · target-AI · AI-før · delta):");
  for (const p of summary.pools || []) {
    const sign = p.delta > 0 ? `+${p.delta}` : `${p.delta}`;
    console.log(`  pulje ${String(p.pool_id).padEnd(3)} tier ${p.tier}  mgr ${p.real_managers}  target ${p.target_ai}  før ${p.ai_before}  ${sign}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.apply) {
    console.log("DRY-RUN — ingen DB rørt. Tilføj --apply + preview-credentials for at allokere AI-hold.");
    console.log("Politik: tier 1/2-puljer fyldes altid til 24; tier 3/4 kun puljer med >=1 ægte manager.");
    return;
  }

  if (!args.url || !args.key) {
    throw new Error("--apply kræver --supabase-url og --supabase-key");
  }
  assertNotProd(args.url);

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(args.url, args.key);

  console.log(`Allokerer AI-hold mod ${args.url} (seed ${args.seed})...`);
  const summary = await generateAndAllocateAiTeams({ supabase, seed: args.seed });
  printSummary(summary);
  console.log("\nFærdig.");
}

main().catch((err) => {
  console.error("Fejl:", err.message);
  process.exitCode = 1;
});
