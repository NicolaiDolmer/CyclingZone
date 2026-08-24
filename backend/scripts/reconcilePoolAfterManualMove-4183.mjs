#!/usr/bin/env node
// ENGANGS (#4183, 24/8): efter at to fejlplacerede spillerhold er flyttet manuelt
// fra D3 til D4, skal maalpuljen trimmes tilbage til 24 hold.
//
// Bruger motorens EGEN reconcileAiTeamsForPool - samme funktion der koerer ved
// hver ny tilmelding - i stedet for haandlavet SQL. Det er vigtigt: den rene
// SQL-vej ville springe snapshotRaceResultNamesForTeams (#1847, bevar loebs-
// historikkens navne) og watchlist-notifikationen (#2524, rytteren forsvinder
// ellers tavst fra managers oenskelister) over.
//
// Default er DRY-RUN. Skriver kun med --apply.
//
//   node scripts/reconcilePoolAfterManualMove-4183.mjs --pool 9
//   node scripts/reconcilePoolAfterManualMove-4183.mjs --pool 9 --apply

import { createClient } from "@supabase/supabase-js";
import { reconcileAiTeamsForPool } from "../lib/aiTeamGenerator.js";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const poolArg = argv[argv.indexOf("--pool") + 1];
const POOL_ID = Number(poolArg);
if (!Number.isFinite(POOL_ID)) {
  console.error("Brug: --pool <id> [--apply]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Mangler SUPABASE_URL og/eller SUPABASE_SERVICE_KEY i miljoeet.");
  process.exit(1);
}
const supabase = createClient(url, key);

const { data: pool } = await supabase
  .from("league_divisions").select("id, tier, label").eq("id", POOL_ID).maybeSingle();
if (!pool) {
  console.error(`Pulje ${POOL_ID} findes ikke.`);
  process.exit(1);
}

const { data: teams } = await supabase
  .from("teams")
  .select("id, name, is_ai, is_bank, is_frozen, is_test_account, pending_removal_at")
  .eq("league_division_id", POOL_ID);

const live = (teams || []).filter((t) => t.is_bank !== true && t.pending_removal_at == null);
const players = live.filter((t) => t.is_ai !== true);
const ai = live.filter((t) => t.is_ai === true);

console.log(`Pulje ${pool.id} (${pool.label}, tier ${pool.tier})`);
console.log(`  hold i dag: ${live.length}  ->  spillere ${players.length} + AI ${ai.length}`);
console.log(`  maal: 24 hold`);

if (!APPLY) {
  console.log(`\nDRY-RUN. Koer med --apply for at trimme AI-fyldet til 24.`);
  process.exit(0);
}

const summary = await reconcileAiTeamsForPool({ supabase, poolId: POOL_ID });
console.log(`\nreconcileAiTeamsForPool:`);
console.log(`  AI foer: ${summary.aiBefore}  maal-AI: ${summary.targetAi}  delta: ${summary.delta}`);
console.log(`  oprettet: ${summary.created}  fjernet: ${summary.removed}`);

const { data: after } = await supabase
  .from("teams").select("id, is_ai, is_bank, pending_removal_at").eq("league_division_id", POOL_ID);
const liveAfter = (after || []).filter((t) => t.is_bank !== true && t.pending_removal_at == null);
console.log(`\nEfter: ${liveAfter.length} hold i puljen (${liveAfter.filter((t) => t.is_ai !== true).length} spillere + ${liveAfter.filter((t) => t.is_ai === true).length} AI)`);
console.log(liveAfter.length === 24 ? "OK - puljen er paa 24." : `ADVARSEL - puljen er paa ${liveAfter.length}, ikke 24.`);
