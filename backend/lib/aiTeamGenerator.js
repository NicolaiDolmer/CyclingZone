// AI-fill-generator (#1688, forever-relaunch AI-fill + race-scale) — additivt oven
// på den frosne 4-tier/15-pulje-pyramide (#1608). Et levedygtigt race-felt kan ikke
// afvikles i en tom pulje; denne modul fylder puljerne med AI-hold efter en frosset
// politik, så ægte managere altid har modstandere — UDEN nogensinde at fortrænge en
// ægte manager.
//
// POLITIK (frosset, ejer-direktiv #1688):
//   • tier 1 OG tier 2-puljer → fyld ALTID med AI op til POOL_TARGET_SIZE (24).
//     (Toppen skal være levende selv før spillere er rykket op dertil.)
//   • tier 3 OG tier 4-puljer → fyld med AI KUN i puljer med >=1 ægte manager.
//     (Bunden/midten er bred; AI spildes ikke i tomme puljer der aldrig afvikler løb.)
//
// IDEMPOTENT: hver pulje top-up'es kun til target ud fra det LIVE antal — re-run
// duplikerer aldrig. REMOVE-AI-WHEN-MANAGER-ARRIVES (reconcile): når en ægte manager
// joiner en pulje, trimmes overskuds-AI så pulje-størrelse <= target; ægte managere
// tælles FØRST og fjernes ALDRIG. En tier-3/4-pulje der mister sin sidste manager
// tømmes for AI (target falder til 0 → al AI trimmes).
//
// DETERMINISTISK: holdnavne + per-hold rytter-seed udledes af basis-seed XOR
// hash(pulje+indeks), så en re-run/replay giver identiske hold.
//
// Wiring: injiceret dep i relaunchOrchestrator (efter allocateLeaguePools, før
// sæson-transition) + runnable script (backend/scripts/generateAiTeams.js). Modulet
// rører ALDRIG prod af sig selv — kalderen leverer supabase-klienten.

import { POOL_TARGET_SIZE, MIN_DIVISION, MAX_DIVISION, INITIAL_BALANCE } from "./economyConstants.js";
import { LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";
import {
  deriveTeamSeed,
  buildWeakStarterPool,
  STARTER_SQUAD,
} from "./starterSquadAllocator.js";
import { generateFictionalRiders } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { fetchExistingFoldedNamesForAi, makeAiTeamName, AI_TEAM_NAME_PREFIX } from "./aiTeamNames.js";

export { AI_TEAM_NAME_PREFIX };

const INSERT_BATCH = 500;

// "Ægte manager" = samme diskriminator som ranglisten/kapacitets-logikken
// (feedback_match_ui_filter_for_capacity_logic): ikke-AI, ikke-bank, ikke-frossen,
// ikke-test. service_role/bulk bypasser RLS, så vi gentager filteret eksplicit.
function isRealManager(team) {
  return team.is_ai === false
    && !team.is_bank
    && !team.is_frozen
    && !team.is_test_account;
}

function isAiTeam(team) {
  return team.is_ai === true;
}

// Politik: hvor mange AI skal en pulje have, givet antal ægte managere i den?
//   tier 1/2: altid op til target.
//   tier 3/4: kun hvis >=1 manager — og da op til target (managere medregnes i feltet).
function targetAiCountForPool(tier, realManagerCount) {
  const alwaysFill = tier === MIN_DIVISION || tier === MIN_DIVISION + 1; // tier 1 og 2
  if (alwaysFill) return Math.max(0, POOL_TARGET_SIZE - realManagerCount);
  // tier 3/4: kun puljer med mindst én ægte manager.
  if (realManagerCount <= 0) return 0;
  return Math.max(0, POOL_TARGET_SIZE - realManagerCount);
}

// Indsæt ÉT AI-hold i en pulje (deterministisk navn + seed), allokér dets 8-rytter-
// trup. allocateSquadForTeam er injicérbar (test bruger en DB-fri fake; prod bruger
// defaultAllocateSquadForTeam = den svage pulje-mekanik + derive-kæden).
async function createAiTeam(supabase, { pool, ordinal, baseSeed, usedNames, allocateSquadForTeam }) {
  const name = makeAiTeamName({ baseSeed, poolId: pool.id, ordinal, usedNames });
  const { data, error } = await supabase
    .from("teams")
    .insert({
      name,
      is_ai: true,
      division: pool.tier,
      league_division_id: pool.id,
      balance: INITIAL_BALANCE,
    })
    .select("id");
  if (error) throw new Error(`AI-team insert (pulje ${pool.id}): ${error.message}`);
  const teamId = (data && data[0] && data[0].id) || null;
  if (!teamId) throw new Error(`AI-team insert returnerede intet id (pulje ${pool.id})`);
  await allocateSquadForTeam(supabase, teamId, { pool, baseSeed, ordinal });
  return teamId;
}

// Fjern N AI-hold fra en pulje (deterministisk: laveste id først). Sletter holdets
// ryttere FØR holdet (riders.team_id -> teams er ON DELETE SET NULL i skemaet, men
// vi vil ikke efterlade ejerløse AI-ryttere i markedet → eksplicit delete).
async function removeAiTeams(supabase, aiTeams, count) {
  const toRemove = [...aiTeams].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, count);
  if (!toRemove.length) return 0;
  const ids = toRemove.map((t) => t.id);
  for (let i = 0; i < ids.length; i += INSERT_BATCH) {
    const batch = ids.slice(i, i + INSERT_BATCH);
    const { error: rErr } = await supabase.from("riders").delete().in("team_id", batch);
    if (rErr) throw new Error(`AI-rider delete: ${rErr.message}`);
    const { error: tErr } = await supabase.from("teams").delete().in("id", batch);
    if (tErr) throw new Error(`AI-team delete: ${tErr.message}`);
  }
  return toRemove.length;
}

/**
 * Slet ALLE eksisterende AI-hold + deres ryttere. Bruges af relaunch-orchestratoren FØR
 * AI-fyld, så AI-feltet regenereres validt fra bunden (#1688). Et pre-eksisterende AI-hold
 * kan ellers overleve relaunchen som et phantom: reset'en bevarer is_ai-hold, og
 * generateAndAllocateAiTeams top-up'er kun rundt om dem i puljerne — fx prod's "AI"-hold i
 * div 1 med 0 ryttere ville blive stående som et tomt felt-medlem. Dette er en bevidst
 * engangs-wipe, IKKE en del af den idempotente reconcile-sti. Idempotent: no-op uden AI-hold.
 *
 * @returns {Promise<{teams:number}>}
 */
export async function clearAllAiTeams(supabase) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const { data: aiTeams, error } = await supabase.from("teams").select("id").eq("is_ai", true);
  if (error) throw new Error(`clearAllAiTeams (teams read): ${error.message}`);
  const ids = (aiTeams || []).map((t) => t.id);
  if (!ids.length) return { teams: 0 };
  for (let i = 0; i < ids.length; i += INSERT_BATCH) {
    const batch = ids.slice(i, i + INSERT_BATCH);
    const { error: rErr } = await supabase.from("riders").delete().in("team_id", batch);
    if (rErr) throw new Error(`clearAllAiTeams (rider delete): ${rErr.message}`);
    const { error: tErr } = await supabase.from("teams").delete().in("id", batch);
    if (tErr) throw new Error(`clearAllAiTeams (team delete): ${tErr.message}`);
  }
  return { teams: ids.length };
}

/**
 * Generér + allokér AI-hold på tværs af alle 15 puljer efter den frosne politik.
 * Idempotent + reconcilende. Rører ALDRIG prod af sig selv (kalderen ejer klienten).
 *
 * @param {object}   args
 * @param {object}   args.supabase  Supabase-klient (service-role i prod-stien).
 * @param {number}  [args.seed]     Basis-seed (default LAUNCH_POPULATION.seed).
 * @param {object}  [args.deps]     { allocateSquadForTeam } — injicérbar for test.
 * @returns {Promise<{created:number, removed:number, pools:object[]}>}
 */
export async function generateAndAllocateAiTeams({ supabase, seed = LAUNCH_POPULATION.seed, deps = {} } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const allocateSquadForTeam = deps.allocateSquadForTeam || defaultAllocateSquadForTeam;
  const baseSeed = (Number(seed) >>> 0);

  const { data: pools, error: poolErr } = await supabase
    .from("league_divisions")
    .select("id, tier, pool_index, label")
    .order("tier")
    .order("pool_index");
  if (poolErr) throw new Error(`league_divisions: ${poolErr.message}`);
  if (!pools || !pools.length) return { created: 0, removed: 0, pools: [] };

  const { data: teams, error: teamErr } = await supabase
    .from("teams")
    .select("id, name, is_ai, is_bank, is_frozen, is_test_account, division, league_division_id");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);

  // Eksisterende AI-holdnavne (for navne-unikhed på re-run/reconcile).
  const usedNames = new Set((teams || []).filter(isAiTeam).map((t) => t.name).filter(Boolean));

  let created = 0;
  let removed = 0;
  const poolSummaries = [];

  for (const pool of pools) {
    const inPool = (teams || []).filter((t) => t.league_division_id === pool.id);
    const realManagers = inPool.filter(isRealManager);
    const aiTeams = inPool.filter(isAiTeam);
    const targetAi = targetAiCountForPool(pool.tier, realManagers.length);
    const delta = targetAi - aiTeams.length;

    if (delta > 0) {
      for (let k = 0; k < delta; k++) {
        await createAiTeam(supabase, {
          pool,
          ordinal: aiTeams.length + k,
          baseSeed,
          usedNames,
          allocateSquadForTeam,
        });
        created++;
      }
    } else if (delta < 0) {
      removed += await removeAiTeams(supabase, aiTeams, -delta);
    }

    poolSummaries.push({
      pool_id: pool.id,
      tier: pool.tier,
      real_managers: realManagers.length,
      target_ai: targetAi,
      ai_before: aiTeams.length,
      delta,
    });
  }

  return { created, removed, pools: poolSummaries };
}

// PROD-STI (default): allokér en svag 8-rytter-trup til et AI-hold via den samme
// dedikerede-svage-pulje-mekanik (#1487) + derive-kæden (data-hale-garanti:
// physiology→abilities→type→base_value) som start-trupperne. Indsætter med team_id
// sat (intet orphan-vindue). Deterministisk per-hold seed.
async function defaultAllocateSquadForTeam(supabase, teamId, { pool, baseSeed, ordinal }) {
  const referenceYear = LAUNCH_POPULATION.referenceYear;
  const existingFoldedNames = await fetchExistingFoldedNamesForAi(supabase);
  // Per-hold seed: basis (+ et AI-offset så det ikke spejler start-trupperne) XOR
  // hash(pulje:indeks). Deterministisk + hold-unik.
  const teamSeed = deriveTeamSeed((baseSeed + 1688) >>> 0, `${pool.id}:${ordinal}`);
  const poolPayload = buildWeakStarterPool({
    count: STARTER_SQUAD.CORE_SIZE,
    seed: teamSeed,
    referenceYear,
    existingFoldedNames,
    generate: generateFictionalRiders,
  }).map((r) => ({ ...r, team_id: teamId }));

  const insertedIds = [];
  for (let i = 0; i < poolPayload.length; i += INSERT_BATCH) {
    const batch = poolPayload.slice(i, i + INSERT_BATCH);
    const { data, error } = await supabase.from("riders").insert(batch).select("id");
    if (error) throw new Error(`AI starter-squad insert ${teamId}: ${error.message}`);
    insertedIds.push(...(data || []).map((r) => r.id));
  }
  // Data-hale-garanti.
  await deriveForRiderIds(supabase, insertedIds, { dryRun: false });
  return insertedIds;
}

/**
 * Reconcilér AI-fyld i ÉN pulje efter den frosne politik (#1688), efter at puljens
 * felt har ændret sig løbende (et nyt ægte hold er rykket ind — #1739). Når en ægte
 * manager joiner en pulje medregnes den i feltet, så AI-target falder med 1 og ét
 * overskuds-AI-hold trimmes; pulje-størrelsen holdes på POOL_TARGET_SIZE i stedet for
 * at vokse. Bug'en før dette: generateAndAllocateAiTeams (som ejer trim-logikken) kørte
 * KUN ved relaunch, så et nyt hold midt i sæsonen efterlod AI-feltet urørt og puljen
 * for stor. Dette er den samme delta-logik som den fulde generator, men afgrænset til
 * én pulje — så holdoprettelses-stien kan kalde den uden at scanne hele pyramiden.
 *
 * Symmetrisk: trimmer overskuds-AI (delta < 0) OG top-up'er en underfyldt pulje
 * (delta > 0, fx en tom tier-1/2-pulje), så funktionen også kan reparere drift.
 * Idempotent: no-op når puljen allerede er på target. Ægte managere tælles FØRST og
 * fjernes ALDRIG. Rører ALDRIG prod af sig selv (kalderen ejer klienten).
 *
 * @param {object}  args
 * @param {object}  args.supabase  Supabase-klient (service-role i prod-stien).
 * @param {string|number} args.poolId  league_divisions.id for puljen der skal reconciles.
 * @param {number} [args.seed]      Basis-seed (default LAUNCH_POPULATION.seed) — kun brugt ved top-up.
 * @param {object} [args.deps]      { allocateSquadForTeam } — injicérbar for test.
 * @returns {Promise<{created:number, removed:number, poolId:(string|number), tier:(number|null), realManagers:number, targetAi:number, aiBefore:number, delta:number}>}
 */
export async function reconcileAiTeamsForPool({ supabase, poolId, seed = LAUNCH_POPULATION.seed, deps = {} } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (poolId == null) throw new Error("poolId required");
  const allocateSquadForTeam = deps.allocateSquadForTeam || defaultAllocateSquadForTeam;
  const baseSeed = (Number(seed) >>> 0);

  const { data: poolRows, error: poolErr } = await supabase
    .from("league_divisions")
    .select("id, tier, pool_index, label")
    .eq("id", poolId);
  if (poolErr) throw new Error(`league_divisions (pulje ${poolId}): ${poolErr.message}`);
  const pool = (poolRows || [])[0];
  if (!pool) {
    // Pre-migration / mock-edge: puljen findes ikke (fx nyt hold med league_division_id=null).
    // Intet felt at reconcile mod → no-op.
    return { created: 0, removed: 0, poolId, tier: null, realManagers: 0, targetAi: 0, aiBefore: 0, delta: 0 };
  }

  const { data: inPool, error: teamErr } = await supabase
    .from("teams")
    .select("id, name, is_ai, is_bank, is_frozen, is_test_account, division, league_division_id")
    .eq("league_division_id", pool.id);
  if (teamErr) throw new Error(`teams (pulje ${pool.id}): ${teamErr.message}`);

  const teamsInPool = inPool || [];
  const realManagers = teamsInPool.filter(isRealManager);
  const aiTeams = teamsInPool.filter(isAiTeam);
  const targetAi = targetAiCountForPool(pool.tier, realManagers.length);
  const delta = targetAi - aiTeams.length;

  let created = 0;
  let removed = 0;

  if (delta < 0) {
    removed = await removeAiTeams(supabase, aiTeams, -delta);
  } else if (delta > 0) {
    // Navne-unikhed: hent eksisterende AI-navne globalt (re-run/reconcile-sikkerhed).
    const { data: allAi, error: aiErr } = await supabase
      .from("teams").select("name").eq("is_ai", true);
    if (aiErr) throw new Error(`teams (AI-navne): ${aiErr.message}`);
    const usedNames = new Set((allAi || []).map((t) => t.name).filter(Boolean));
    for (let k = 0; k < delta; k++) {
      await createAiTeam(supabase, {
        pool,
        ordinal: aiTeams.length + k,
        baseSeed,
        usedNames,
        allocateSquadForTeam,
      });
      created++;
    }
  }

  return {
    created,
    removed,
    poolId: pool.id,
    tier: pool.tier,
    realManagers: realManagers.length,
    targetAi,
    aiBefore: aiTeams.length,
    delta,
  };
}

export const __testables = { targetAiCountForPool, isRealManager, defaultAllocateSquadForTeam };

void MAX_DIVISION; // dokumenterer politik-domænet (tier 1..MAX_DIVISION); ingen direkte brug.
