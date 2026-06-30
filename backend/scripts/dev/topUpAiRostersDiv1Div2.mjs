// Engangs prod-fix (2026-06-30, ejer-godkendt) — top de EKSISTERENDE AI-hold i
// division 1 (tier 1) og division 2 (tier 2) op til 24 ryttere pr. hold. Rører
// ALDRIG eksisterende ryttere (kun tilføjelse) — ejer-direktiv: "Du skal ikke
// fjerne nogen fra holdet der er der nu, blot tilføje de ryttere der mangler".
//
// v2 (samme dag, #2065-postmortem): v1 klampede ALLE 14 stat-felter ind i et smalt
// vindue → urealistisk alsidige (gode til ALT samtidig) og dermed grotesk
// overprissatte ryttere (900 indsat, gns. 364k CZ$, enkelte over 3 mio — over
// Pogačar). Rullet tilbage. v2 brugte i stedet den ÆGTE arketype-generator
// (100% "solid" til tier 1) — MEN solid-tierens konvekse værdikurve ruller af og
// til en ekstrem outlier (gns. 1,52 mio, max 8,16 mio for tier-1-batchen). Også
// rullet tilbage (kun tier 1 — tier 2's 600 domestique-ryttere var fine, gns. 23k,
// max 74k, ingen outliers, og er bevaret).
//
// v3 (denne version): lavere solid-andel (25%, ikke 100%) + et HÅRDT værdiloft
// (generateAiRiderBatchWithCap, AI_TIER_VALUE_CAP) der forkaster/rerruller enhver
// rytter over loftet FØR insert — garanterer grænsen uanset tier-blandingens
// statistiske hale. Se backend/scripts/simAiRosterTierWindows.js for kalibreringen.
//
// FORUDSÆTNING (verificeret 2026-06-30): AI-ejede ryttere kan ikke længere
// auktioneres/tilbydes/byttes/lejes af managere (api.js-gates lukket samme dag) —
// uden den spærre ville denne top-up gøre AI-rosters til et gratis-for-alle
// rekrutterings-bord.
//
// SIKKER PRE-FLIGHT som standard: ingen DB-skrivning uden --live. Idempotent:
// genkører kun top op til 24 ud fra det LIVE antal — ingen dobbelt-indsættelse.
//
// Kør pre-flight:  infisical run --env=prod -- node backend/scripts/dev/topUpAiRostersDiv1Div2.mjs
// Kør live:        infisical run --env=prod -- node backend/scripts/dev/topUpAiRostersDiv1Div2.mjs --live

import { createClient } from "@supabase/supabase-js";
import { AI_SQUAD, aiTierFractionsForTier, aiValueCapForTier, generateAiRiderBatchWithCap, deriveTeamSeed } from "../../lib/starterSquadAllocator.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";
import { fetchExistingFoldedNamesForAi } from "../../lib/aiTeamNames.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";

const LIVE = process.argv.includes("--live");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Eget seed-offset, distinkt fra det oprindelige squad-gens (+1688), så top-up-
// batchen ikke kolliderer (navn/rng) med det oprindelige squad-gen ELLER v1-forsøget.
const TOPUP_SEED_OFFSET = 9200;
const INSERT_BATCH = 500;

async function main() {
  console.log(`MODE=${LIVE ? "LIVE (skriver til prod)" : "PRE-FLIGHT (ingen DB-skrivning)"}\n`);

  const { data: pools, error: poolErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").in("tier", [1, 2]);
  if (poolErr) throw new Error(`league_divisions: ${poolErr.message}`);
  const poolById = new Map(pools.map((p) => [p.id, p]));
  const poolIds = pools.map((p) => p.id);

  const { data: teams, error: teamErr } = await supabase
    .from("teams").select("id, name, league_division_id")
    .eq("is_ai", true).in("league_division_id", poolIds);
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);

  const existingFoldedNames = LIVE ? await fetchExistingFoldedNamesForAi(supabase) : new Set();

  let totalAdded = 0;
  let teamsToppedUp = 0;
  const byTier = { 1: { teams: 0, added: 0 }, 2: { teams: 0, added: 0 } };

  for (const team of teams) {
    const pool = poolById.get(team.league_division_id);
    const { count, error: cntErr } = await supabase
      .from("riders").select("id", { count: "exact", head: true }).eq("team_id", team.id);
    if (cntErr) throw new Error(`riders count ${team.id}: ${cntErr.message}`);

    const missing = AI_SQUAD.TOTAL_SIZE - (count || 0);
    if (missing <= 0) continue;

    console.log(`tier ${pool.tier}  ${team.name.padEnd(34)}  ${count} → 24  (+${missing})`);
    teamsToppedUp++;
    totalAdded += missing;
    byTier[pool.tier].teams++;
    byTier[pool.tier].added += missing;

    if (!LIVE) continue;

    const tierFractions = aiTierFractionsForTier(pool.tier);
    const seed = deriveTeamSeed((LAUNCH_POPULATION.seed + TOPUP_SEED_OFFSET) >>> 0, `${team.id}`);
    const payload = generateAiRiderBatchWithCap({
      count: missing, tierFractions, valueCap: aiValueCapForTier(pool.tier),
      seed, referenceYear: LAUNCH_POPULATION.referenceYear, existingFoldedNames,
    }).map((r) => ({ ...r, team_id: team.id }));

    const insertedIds = [];
    for (let i = 0; i < payload.length; i += INSERT_BATCH) {
      const batch = payload.slice(i, i + INSERT_BATCH);
      const { data, error } = await supabase.from("riders").insert(batch).select("id");
      if (error) throw new Error(`insert ${team.id} ved ${i}: ${error.message}`);
      insertedIds.push(...(data || []).map((r) => r.id));
    }
    await deriveForRiderIds(supabase, insertedIds, { dryRun: false });
  }

  console.log("\n=== Opsummering ===");
  console.log(`Tier 1: ${byTier[1].teams} hold toppet op, +${byTier[1].added} ryttere`);
  console.log(`Tier 2: ${byTier[2].teams} hold toppet op, +${byTier[2].added} ryttere`);
  console.log(`Total: ${teamsToppedUp} hold, +${totalAdded} ryttere`);
  if (!LIVE) console.log("\nPre-flight — tilføj --live for at skrive til prod.");
}

main().catch((err) => {
  console.error("Fejl:", err.message);
  process.exitCode = 1;
});
