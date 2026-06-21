#!/usr/bin/env node
// Relaunch-orchestrator CLI (#1103). DRY-RUN DEFAULT.
//
// Kører ALTID en dry-run-preview først og printer summary. --apply udfører mod den
// DB env peger på. Prod kræver lagdelt opt-in (--target-prod + typed --confirm +
// RELAUNCH_1101_CUTOVER_ACK=true). Den ægte prod-relaunch er hård-gatet på #1101
// base_value-cutover (ejer-verifikation).
//
//   node scripts/relaunchSeason1.js
//       # dry-run-preview mod env-DB (skriver intet)
//   node scripts/relaunchSeason1.js --apply
//       # RIGTIG kørsel mod NON-prod env (fx preview/branch) — bruges til verifikation
//   node scripts/relaunchSeason1.js --apply --target-prod --confirm "RELAUNCH SEASON 1"
//       # prod (kræver desuden RELAUNCH_1101_CUTOVER_ACK=true)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runRelaunchSeason1, assertRelaunchProdGuard, isProdSupabaseUrl } from "../lib/relaunchOrchestrator.js";

const START_DATE = "2026-06-22"; // TdF-relaunch (ejer-besluttet 2026-06-22)

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const APPLY = process.argv.includes("--apply");
const TARGET_PROD = process.argv.includes("--target-prod");
const CONFIRM = argValue("--confirm");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const isProd = isProdSupabaseUrl(SUPABASE_URL);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`=== RELAUNCH SÆSON 1 — DRY-RUN preview (${isProd ? "PROD" : "non-prod"} env) ===`);
  const dry = await runRelaunchSeason1(supabase, { dryRun: true, startDate: START_DATE });
  console.log(JSON.stringify(dry, null, 2));

  const guard = assertRelaunchProdGuard({
    apply: APPLY,
    isProd,
    targetProd: TARGET_PROD,
    confirm: CONFIRM,
    cutoverAck: process.env.RELAUNCH_1101_CUTOVER_ACK,
  });
  if (!guard.proceed) {
    console.log(`\n(dry-run only — ${guard.reason}. Send --apply for at udføre.)`);
    return;
  }

  console.log(`\n=== UDFØRER relaunch (${guard.target}) ===`);
  const result = await runRelaunchSeason1(supabase, { dryRun: false, startDate: START_DATE });
  console.log(JSON.stringify(result, null, 2));
  console.log("\n✅ Relaunch færdig.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
