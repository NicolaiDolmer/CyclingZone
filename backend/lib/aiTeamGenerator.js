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
  AI_SQUAD,
  aiStatWindowsForTier,
  aiTierFractionsForTier,
  aiValueCapForTier,
  generateAiRiderBatchWithCap,
} from "./starterSquadAllocator.js";
import { generateFictionalRiders } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { fetchExistingFoldedNamesForAi, makeAiTeamName, AI_TEAM_NAME_PREFIX } from "./aiTeamNames.js";
import { fetchAllRows } from "./supabasePagination.js";
import { STALL_WATCHDOG_DEFAULT_THRESHOLDS } from "./stallWatchdog.js";
import { notifyAndClearWatchlistForRiders } from "./notificationService.js";

export { AI_TEAM_NAME_PREFIX };

const INSERT_BATCH = 500;

// "Ægte manager" = samme diskriminator som ranglisten/kapacitets-logikken
// (feedback_match_ui_filter_for_capacity_logic): ikke-AI, ikke-bank, ikke-frossen,
// ikke-test. service_role/bulk bypasser RLS, så vi gentager filteret eksplicit.
// Eksporteret (#2407): aiTeamTrimHealSweep genbruger diskriminatoren til pr.-pulje
// trim-budgettet — én kilde til "hvem tæller som ægte manager".
export function isRealManager(team) {
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
// Eksporteret (#2407): aiTeamTrimHealSweep genbruger politikken som hard-gate
// (sweep'en må aldrig slette en pulje under target).
export function targetAiCountForPool(tier, realManagerCount) {
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

// #2434: hvilke af inflightRaceIds har holdets ryttere entries i? Returnerer de
// DISTINKTE blokerende race_ids (tom liste = ikke blokeret). teamHasInflightEntries
// delegerer hertil. aiTeamTrimHealSweep bruger listen til at afgøre om et blokerende
// løb SELV er stallet (løbs-bevidst stale-detektion) — ikke bare OM holdet er blokeret.
export async function teamInflightRaceIds(supabase, teamId, inflightRaceIds) {
  if (!inflightRaceIds.length) return [];
  const { data: riders, error: rErr } = await supabase.from("riders").select("id").eq("team_id", teamId);
  if (rErr) throw new Error(`AI-trim (riders for ${teamId}): ${rErr.message}`);
  const riderIds = (riders || []).map((r) => r.id);
  if (!riderIds.length) return [];
  const { data: entries, error: eErr } = await supabase
    .from("race_entries")
    .select("race_id")
    .in("race_id", inflightRaceIds)
    .in("rider_id", riderIds);
  if (eErr) throw new Error(`AI-trim (race_entries for ${teamId}): ${eErr.message}`);
  return [...new Set((entries || []).map((e) => e.race_id))];
}

// #2269: har holdets ryttere entries i et IGANGVÆRENDE løb (låst felt, samme
// definition som #2074-guarden: ikke-completed + stages_completed>0)? Et låst hold
// kan ikke hard-slettes — DB-triggeren trg_block_rider_delete_inflight kaster.
// Eksporteret (#2187): genbruges af aiTeamTrimHealSweep til at re-tjekke udskudte hold.
// Delegerer til teamInflightRaceIds (#2434) — én kilde til inflight-blokerings-logikken.
export async function teamHasInflightEntries(supabase, teamId, inflightRaceIds) {
  return (await teamInflightRaceIds(supabase, teamId, inflightRaceIds)).length > 0;
}

// #2389 (Sentry CYCLINGZONE-26/2E/2F): har holdet præmie-rækker i et løb hvis
// præmier endnu ikke er udbetalt (prize_paid_at IS NULL)? Slettes holdet før
// auto-prize-sweepen når at kreditere, kaster balance-RPC'en P0002 midt i payout-
// ticket, og en samtidig standings-recalc kan FK-fejle på det forsvundne hold.
// Sådan et hold udskydes (pending_removal_at) præcis som inflight-blokerede hold —
// auto-prize sweeper hvert 5. minut, så blokeringen klarer sig selv kort efter
// løbets finalization. Eksporteret: genbruges af aiTeamTrimHealSweep.
export async function teamHasUnpaidPrizeResults(supabase, teamId) {
  // fetchAllRows: et holds præmie-rækker kan overstige PostgREST's 1000-row-loft
  // sidst på sæsonen — en trunkeret liste kunne misse netop det uudbetalte løb.
  const resultRows = await fetchAllRows(() => supabase
    .from("race_results")
    .select("race_id")
    .eq("team_id", teamId)
    .gt("prize_money", 0)
    .order("id", { ascending: true }));
  const raceIds = [...new Set((resultRows || []).map((r) => r.race_id))];
  if (!raceIds.length) return false;
  const { data: unpaid, error: rErr } = await supabase
    .from("races")
    .select("id")
    .in("id", raceIds)
    .is("prize_paid_at", null);
  if (rErr) throw new Error(`AI-trim (unpaid races for ${teamId}): ${rErr.message}`);
  return (unpaid || []).length > 0;
}

// Delt inflight-race-lookup (#2187): samme "igangværende løb"-definition brugt af
// removeAiTeams OG heal-sweep-retryen, ét sted.
export async function getInflightRaceIds(supabase) {
  const { data: inflight, error: infErr } = await supabase
    .from("races")
    .select("id")
    .neq("status", "completed")
    .gt("stages_completed", 0);
  if (infErr) throw new Error(`AI-trim (inflight races): ${infErr.message}`);
  return (inflight || []).map((r) => r.id);
}

// #2434: hvilke inflight-løb er REELT STALLEDE? Et løb er stallet når dets NÆSTE
// uafviklede etape (stage_number = stages_completed + 1) skulle være kørt for mere end
// stageAlarmHours siden, men stages_completed er ikke rykket. Dette er præcis samme
// signal som stall-watchdogens etape-stall (b) — genbruger dens tærskel, så de to
// alarmer deler ÉN definition af "en etape hænger".
//
// Formål: aiTeamTrimHealSweep skal kun alarmere om et pending AI-hold når det er
// blokeret af et løb der SELV er gået i stå — ikke når det bare er blokeret af et
// lovligt kørende multi-dag etapeløb (rod-årsagen til CYCLINGZONE-31's falsk-positive
// spam: 48t-tærsklen var kortere end etapeløbenes kalender-spredning).
export async function getStalledInflightRaceIds(
  supabase,
  now = new Date(),
  stageAlarmHours = STALL_WATCHDOG_DEFAULT_THRESHOLDS.stageAlarmHours,
) {
  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, stages_completed")
    .neq("status", "completed")
    .gt("stages_completed", 0);
  if (rErr) throw new Error(`AI-trim (stalled races): ${rErr.message}`);
  if (!races?.length) return [];

  const cutoff = new Date(now.getTime() - stageAlarmHours * 60 * 60 * 1000).toISOString();
  const raceIds = races.map((r) => r.id);

  const dueRows = await fetchAllRows(() => supabase
    .from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at")
    .in("race_id", raceIds)
    .lte("scheduled_at", cutoff)
    .order("race_id", { ascending: true }));
  if (!dueRows.length) return [];

  const nextStageByRace = new Map(races.map((r) => [r.id, (r.stages_completed || 0) + 1]));
  const stalled = new Set();
  for (const row of dueRows) {
    // Kun DEN forfaldne række der ER løbets næste uafviklede etape betyder "stallet".
    if (row.stage_number === nextStageByRace.get(row.race_id)) stalled.add(row.race_id);
  }
  return [...stalled];
}

// #2187: markér AI-hold der IKKE kunne slettes nu (inflight-blokeret) til udskudt
// trim, så en heal-sweep kan fuldføre dem senere (uden at en ny signup i SAMME pulje
// skal ske for at give trimmet en ny chance — det var rod-årsagen til at Division 4
// B/C blev hængende på 26 hold, jf. #2187/#2377). IS NULL-guarden bevarer det
// ORIGINALE udskydelses-tidspunkt (idempotent — gentagne udskydelser af samme hold
// flytter ikke "uret" for heal-sweep'ens stale-detektion).
async function markPendingRemoval(supabase, teamIds) {
  if (!teamIds.length) return;
  const { error } = await supabase
    .from("teams")
    .update({ pending_removal_at: new Date().toISOString() })
    .in("id", teamIds)
    .is("pending_removal_at", null);
  if (error) throw new Error(`AI-trim (pending_removal_at mark): ${error.message}`);
}

// #1847: navne-snapshot FØR rytter/hold-sletning. race_results.rider_id/team_id er
// ON DELETE SET NULL (bevidst: løbshistorik skal overleve AI-churn), og visningen
// hviler derefter alene på de denormaliserede rider_name/team_name-kolonner.
// Insert-stierne (raceRunner/raceResultsEngine) populerer navnene i dag, så dette
// er normalt en no-op (prod 16/7: 0 rækker manglede snapshot) — men skulle en
// (legacy/fremtidig) række mangle det, ville sletningen gøre den permanent
// visningsdød. Backfill de manglende navne mens FK'erne stadig peger på levende
// rækker. DB-triggerne (database/2026-07-16-race-results-orphan-guard.sql) er det
// blivende forsvar for ALLE delete-stier; denne JS-spejling dækker AI-trim-stierne
// uafhængigt af om migrationen er applied. Koster 2 selects pr. sletning i
// normal-tilfældet (0 at-risk rækker).
export async function snapshotRaceResultNamesForTeams(supabase, teamIds) {
  if (!teamIds.length) return { riderNames: 0, teamNames: 0 };

  const { data: riders, error: rErr } = await supabase
    .from("riders")
    .select("id, firstname, lastname")
    .in("team_id", teamIds);
  if (rErr) throw new Error(`navne-snapshot (riders for trim): ${rErr.message}`);
  const nameByRider = new Map(
    (riders || []).map((r) => [r.id, [r.firstname, r.lastname].filter(Boolean).join(" ") || null]),
  );

  let riderNames = 0;
  const riderIds = [...nameByRider.keys()];
  if (riderIds.length) {
    const atRisk = await fetchAllRows(() => supabase
      .from("race_results")
      .select("id, rider_id")
      .in("rider_id", riderIds)
      .is("rider_name", null)
      .order("id", { ascending: true }));
    for (const riderId of new Set(atRisk.map((row) => row.rider_id))) {
      const name = nameByRider.get(riderId);
      if (!name) continue;
      const { error } = await supabase
        .from("race_results")
        .update({ rider_name: name })
        .eq("rider_id", riderId)
        .is("rider_name", null);
      if (error) throw new Error(`navne-snapshot (rider_name ${riderId}): ${error.message}`);
      riderNames += 1;
    }
  }

  const { data: teams, error: tErr } = await supabase
    .from("teams")
    .select("id, name")
    .in("id", teamIds);
  if (tErr) throw new Error(`navne-snapshot (teams for trim): ${tErr.message}`);
  const nameByTeam = new Map((teams || []).map((t) => [t.id, t.name || null]));

  let teamNames = 0;
  const teamAtRisk = await fetchAllRows(() => supabase
    .from("race_results")
    .select("id, team_id")
    .in("team_id", teamIds)
    .is("team_name", null)
    .order("id", { ascending: true }));
  for (const teamId of new Set(teamAtRisk.map((row) => row.team_id))) {
    const name = nameByTeam.get(teamId);
    if (!name) continue;
    const { error } = await supabase
      .from("race_results")
      .update({ team_name: name })
      .eq("team_id", teamId)
      .is("team_name", null);
    if (error) throw new Error(`navne-snapshot (team_name ${teamId}): ${error.message}`);
    teamNames += 1;
  }

  return { riderNames, teamNames };
}

// #2187: slet ét navngivet AI-hold (rytter+hold). Bruges af heal-sweep-retryen, som
// (modsat removeAiTeams' kandidat-udvælgelse fra en pulje-liste) allerede kender det
// præcise hold-id den skal forsøge igen.
export async function deleteAiTeamById(supabase, teamId) {
  // #1847: bevar løbshistorikkens navne før FK'erne SET NULL'er attributionen.
  await snapshotRaceResultNamesForTeams(supabase, [teamId]);
  // #2524: hent navn+id FØR delete — rider_watchlist har ingen FK-cascade, så
  // rytteren ville ellers forsvinde tavst fra enhver managers ønskeliste.
  const { data: watchedRiders } = await supabase.from("riders").select("id, firstname, lastname").eq("team_id", teamId);
  const { error: rErr } = await supabase.from("riders").delete().eq("team_id", teamId);
  if (rErr) throw new Error(`AI-rider delete (${teamId}): ${rErr.message}`);
  await notifyAndClearWatchlistForRiders({ supabase, riders: watchedRiders || [] });
  const { error: tErr } = await supabase.from("teams").delete().eq("id", teamId);
  if (tErr) throw new Error(`AI-team delete (${teamId}): ${tErr.message}`);
}

// Fjern N AI-hold fra en pulje (deterministisk: laveste id først). Sletter holdets
// ryttere FØR holdet (riders.team_id -> teams er ON DELETE SET NULL i skemaet, men
// vi vil ikke efterlade ejerløse AI-ryttere i markedet → eksplicit delete).
// #2269: hold hvis ryttere har entries i et igangværende løb SPRINGES OVER (DB-guarden
// fra #2074 blokerer hard delete af dem) — næste kandidat i id-ordenen tages i stedet.
// #2187: er der ikke nok ledige kandidater, trimmes færre end ønsket, og de sprungne
// (blokerede) hold markeres pending_removal_at — en heal-sweep (aiTeamTrimHealSweep.js)
// retryer dem periodisk, uafhængigt af om puljen får et nyt signup igen.
async function removeAiTeams(supabase, aiTeams, count) {
  const sorted = [...aiTeams].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!sorted.length || count <= 0) return 0;

  const inflightRaceIds = await getInflightRaceIds(supabase);

  const toRemove = [];
  const blockedIds = [];
  for (const team of sorted) {
    if (toRemove.length >= count) break;
    // #2389: uudbetalte præmier blokerer OGSÅ trim — ellers kolliderer sletningen
    // med auto-prize-sweepen/standings-recalc (samme udskudt-trim-mekanik).
    if (await teamHasInflightEntries(supabase, team.id, inflightRaceIds)
        || await teamHasUnpaidPrizeResults(supabase, team.id)) {
      blockedIds.push(team.id);
      continue;
    }
    toRemove.push(team);
  }
  if (toRemove.length < count) {
    // #2407 Fejl 1: markér KUN det faktiske underskud (count - toRemove.length), ikke
    // hvert blokeret hold loopet passerede. Da næsten alle AI-hold typisk er præmie-/
    // inflight-blokeret (#2389), betød "markér alle passerede" at HELE puljen fik
    // pending_removal_at (prod 12-15/7: 65 hold markeret i pulje 9/10/11, kun 5 reelt
    // overskud) — og heal-sweepen ville derefter tælle puljen ned mod 4. De første
    // `deficit` blokerede i id-orden vælges (samme deterministiske orden som selve
    // trim-udvælgelsen).
    const deficit = count - toRemove.length;
    const deferredIds = blockedIds.slice(0, deficit);
    console.warn(
      `  ⏳ AI-trim deferred: ${deficit} AI-hold har entries i igangværende løb (låst felt, #2074) ` +
      `eller uudbetalte præmier (#2389) og kan ikke trimmes nu — markeret pending_removal_at (#2187), ` +
      `en heal-sweep fuldfører når løbet er kørt færdigt og udbetalt.`
    );
    if (deferredIds.length) {
      await markPendingRemoval(supabase, deferredIds);
    }
  }
  if (!toRemove.length) return 0;
  const ids = toRemove.map((t) => t.id);
  for (let i = 0; i < ids.length; i += INSERT_BATCH) {
    const batch = ids.slice(i, i + INSERT_BATCH);
    // #1847: bevar løbshistorikkens navne før FK'erne SET NULL'er attributionen.
    await snapshotRaceResultNamesForTeams(supabase, batch);
    // #2524: hent navn+id FØR delete (rider_watchlist ingen FK-cascade — se
    // notifyAndClearWatchlistForRiders).
    const { data: watchedRiders } = await supabase.from("riders").select("id, firstname, lastname").in("team_id", batch);
    const { error: rErr } = await supabase.from("riders").delete().in("team_id", batch);
    if (rErr) throw new Error(`AI-rider delete: ${rErr.message}`);
    await notifyAndClearWatchlistForRiders({ supabase, riders: watchedRiders || [] });
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
    // #2524: hent navn+id FØR delete (rider_watchlist ingen FK-cascade — se
    // notifyAndClearWatchlistForRiders).
    const { data: watchedRiders } = await supabase.from("riders").select("id, firstname, lastname").in("team_id", batch);
    const { error: rErr } = await supabase.from("riders").delete().in("team_id", batch);
    if (rErr) throw new Error(`clearAllAiTeams (rider delete): ${rErr.message}`);
    await notifyAndClearWatchlistForRiders({ supabase, riders: watchedRiders || [] });
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

// PROD-STI (default): allokér en 24-rytter-trup til et AI-hold, divisions-kvalitet
// afhængig af pool.tier (ejer 2026-06-30). To stier (#2065-postmortem — v1 klampede
// ALLE stats ind i et smalt vindue for alle tiers, hvilket gav urealistisk alsidige
// (og dermed grotesk overprissatte) ryttere for tier 1/2):
//   • tier 1/2: AI_TIER_FRACTIONS → den ÆGTE arketype-generator (samme tier-system
//     som det frie marked) i ÉT hug (ingen kerne/hale-opdeling — kvaliteten er
//     ensartet divisions-niveau, ikke "kerne vs reserve").
//   • tier 3/4: uændret clamp-vindue-sti (kerne+hale, lagdelt) — proven i prod.
// Gælder KUN nye AI-hold; eksisterende AI-rosters er urørte (ejer-beslutning).
// Indsætter med team_id sat (intet orphan-vindue). Deterministisk per-hold seed.
async function defaultAllocateSquadForTeam(supabase, teamId, { pool, baseSeed, ordinal }) {
  const referenceYear = LAUNCH_POPULATION.referenceYear;
  const existingFoldedNames = await fetchExistingFoldedNamesForAi(supabase);
  const tierFractions = aiTierFractionsForTier(pool.tier);

  let poolPayload;
  if (tierFractions) {
    const seed = deriveTeamSeed((baseSeed + 1688) >>> 0, `${pool.id}:${ordinal}`);
    poolPayload = generateAiRiderBatchWithCap({
      count: AI_SQUAD.TOTAL_SIZE, tierFractions, valueCap: aiValueCapForTier(pool.tier),
      seed, referenceYear, existingFoldedNames,
    }).map((r) => ({ ...r, team_id: teamId }));
  } else {
    const { core: coreWindow, tail: tailWindow } = aiStatWindowsForTier(pool.tier);
    // Per-hold seed: basis (+ et AI-offset så det ikke spejler start-trupperne) XOR
    // hash(pulje:indeks). Deterministisk + hold-unik. Eget seed-offset pr. tier (kerne
    // vs hale) → distinkte pools. Kernen bevarer (+1688) så eksisterende AI-holds kerne
    // forbliver deterministisk; halen bruger (+1688+7).
    const coreSeed = deriveTeamSeed((baseSeed + 1688) >>> 0, `${pool.id}:${ordinal}`);
    const tailSeed = deriveTeamSeed((baseSeed + 1688 + 7) >>> 0, `${pool.id}:${ordinal}`);
    const corePayload = buildWeakStarterPool({
      count: AI_SQUAD.CORE_SIZE, seed: coreSeed, referenceYear, existingFoldedNames,
      window: coreWindow, generate: generateFictionalRiders,
    }).map((r) => ({ ...r, team_id: teamId }));
    const tailPayload = buildWeakStarterPool({
      count: AI_SQUAD.TAIL_SIZE, seed: tailSeed, referenceYear, existingFoldedNames,
      window: tailWindow, generate: generateFictionalRiders,
    }).map((r) => ({ ...r, team_id: teamId }));
    poolPayload = [...corePayload, ...tailPayload];
  }

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
