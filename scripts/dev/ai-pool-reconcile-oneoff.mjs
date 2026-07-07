#!/usr/bin/env node
// One-off: run the existing generateAndAllocateAiTeams() reconcile against PROD to
// trim the excess AI teams left over from missed reconcile triggers on signup
// (2026-07-07 — divisions sitting at 25 instead of POOL_TARGET_SIZE=24).
//
//   node scripts/dev/ai-pool-reconcile-oneoff.mjs            (dry-run: prints plan only)
//   node scripts/dev/ai-pool-reconcile-oneoff.mjs --apply     (applies via generateAndAllocateAiTeams)
//
// Uses backend/.env service-role creds directly against prod — the guardrail in
// scripts/generateAiTeams.js refuses prod on purpose for routine/ad-hoc runs; this
// one-off is the owner-approved exception for a one-time drift cleanup (backup taken
// first: npm run db:backup).

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generateAndAllocateAiTeams } from "../../backend/lib/aiTeamGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../../backend/.env"), quiet: true });

const APPLY = process.argv.includes("--apply");

const POOL_TARGET_SIZE = 24;

function isRealManager(t) {
  return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
}

async function planOnly(supabase) {
  const { data: pools, error: poolErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
  if (poolErr) throw new Error(poolErr.message);
  const { data: teams, error: teamErr } = await supabase
    .from("teams").select("id, is_ai, is_bank, is_frozen, is_test_account, league_division_id");
  if (teamErr) throw new Error(teamErr.message);

  console.log("DRY-RUN plan (no writes):\n");
  let totalRemove = 0;
  for (const pool of pools) {
    const inPool = teams.filter((t) => t.league_division_id === pool.id);
    const real = inPool.filter(isRealManager).length;
    const ai = inPool.filter((t) => t.is_ai === true).length;
    const alwaysFill = pool.tier === 1 || pool.tier === 2;
    const target = alwaysFill ? Math.max(0, POOL_TARGET_SIZE - real) : (real > 0 ? Math.max(0, POOL_TARGET_SIZE - real) : 0);
    const delta = target - ai;
    if (delta !== 0) {
      console.log(`  ${pool.label.padEnd(16)} real=${real}  ai=${ai}  target_ai=${target}  ${delta > 0 ? `+${delta} (create)` : `${delta} (remove)`}`);
      if (delta < 0) totalRemove += -delta;
    }
  }
  console.log(`\nTotal AI-hold to remove: ${totalRemove}`);
  console.log("Re-run with --apply to execute via generateAndAllocateAiTeams().");
}

async function main() {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  if (!APPLY) {
    await planOnly(admin);
    return;
  }

  console.log("APPLYING reconcile against prod...\n");
  const summary = await generateAndAllocateAiTeams({ supabase: admin });
  console.log(`Oprettet: ${summary.created} AI-hold`);
  console.log(`Fjernet:  ${summary.removed} AI-hold`);
  for (const p of summary.pools) {
    if (p.delta !== 0) {
      console.log(`  pulje ${p.pool_id} tier ${p.tier}  mgr ${p.real_managers}  target ${p.target_ai}  før ${p.ai_before}  delta ${p.delta > 0 ? `+${p.delta}` : p.delta}`);
    }
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
