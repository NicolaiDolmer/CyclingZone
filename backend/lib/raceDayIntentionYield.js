// #6641 · Loebsdagens intention som udbytte-modifikator (variant B, ejer 24/9).
//
// Ejerens beslutning (#4632, 24/9): "intentionen bliver loebsdagens udbytte-
// modifikator, naar den taendes". Variant A (#4850) giver loebsdagen et mellem-pas
// paa etapens profil-evner (raceDayYield.js); variant B lægger managerens valgte
// intention for netop den etape ovenpaa: grupetto giver mindst, all_out mest
// (raceRoles.DEV_MULTIPLIER_BY_EFFORT, samme trappe som traethedsprisen).
//
// Altid aktiv (kontakten race_day_intention_enabled er fjernet, krav 5). En
// rytter uden valgt intention, et AI-hold og enhver opslagsfejl giver 1,0,
// altsaa praecis variant A.
//
// KILDEN er den SAMME som motoren koerte paa (raceRunner, #5580): holdordren
// (race_team_orders.riders[].effort) vinder, og managerens etape-raekke
// (race_stage_roles.effort) er fallback (raceStageRoles.resolvedEffortByRiderForStage).
// Etapen pr. rytter kommer fra loebsdags-opslaget (raceDayStageLookup.js), saa der
// er ingen ekstra gaet om hvilken etape det var.

import { effortDevelopmentMultiplier } from "./raceRoles.js";
import { orderEffortByRiderForStage } from "./raceStageRoles.js";

/**
 * Udbytte-multiplikatoren for en loebsdag. Manglende/ukendt intention => 1,0.
 * @param {string|null|undefined} effort
 * @returns {number} > 0
 */
export function raceDayIntentionYieldMultiplier(effort) {
  return effort ? effortDevelopmentMultiplier(effort) : 1;
}

/**
 * Ren sammenkobling: rytter -> den intention motoren koerte ham paa i dag.
 * Ordren vinder over etape-raekken, praecis som raceRunner (#5580); en ordre paa
 * "normal" er ikke et valg og lader etape-raekken staa (orderEffortByRiderForStage).
 * @param {Map<string, {raceId: string, stageNumber: number}>} stageByRider
 * @param {Array<{race_id: string, stage_number: number, rider_id: string, effort: string|null}>} roleRows
 * @param {Array<{race_id: string, stage_number: number, riders: Array<{rider_id: string, effort?: string}>}>} [orderRows]
 * @returns {Map<string, string>}
 */
export function raceDayEffortByRider(stageByRider, roleRows = [], orderRows = []) {
  const out = new Map();
  for (const row of roleRows ?? []) {
    const stage = stageByRider?.get(row?.rider_id);
    if (!stage || !row.effort) continue;
    if (stage.raceId !== row.race_id || Number(stage.stageNumber) !== Number(row.stage_number)) continue;
    out.set(row.rider_id, row.effort);
  }
  const ordersByRace = new Map();
  for (const row of orderRows ?? []) {
    if (!row?.race_id) continue;
    if (!ordersByRace.has(row.race_id)) ordersByRace.set(row.race_id, []);
    ordersByRace.get(row.race_id).push(row);
  }
  const orderMapCache = new Map();
  for (const [riderId, stage] of stageByRider ?? []) {
    const rows = ordersByRace.get(stage.raceId);
    if (!rows) continue;
    const key = `${stage.raceId}:${stage.stageNumber}`;
    if (!orderMapCache.has(key)) orderMapCache.set(key, orderEffortByRiderForStage(rows, stage.stageNumber));
    const effort = orderMapCache.get(key)?.get(String(riderId));
    if (effort) out.set(riderId, effort);
  }
  return out;
}

/**
 * Hent intentionen pr. rytter for dagens etaper (ordre + etape-raekke). BERIGELSE,
 * ikke en regel-gate: en fejl i et af opslagene logges og giver et tomt kort
 * (= variant A for alle), saa udbyttet aldrig bygger paa en halv kilde.
 * @param {{ supabase: object, stageByRider: Map<string, {raceId: string, stageNumber: number}> }} args
 * @returns {Promise<Map<string, string>>}
 */
export async function loadRaceDayEffortByRider({ supabase, stageByRider }) {
  const riderIds = [...(stageByRider?.keys() ?? [])];
  const raceIds = [...new Set([...(stageByRider?.values() ?? [])].map((s) => s.raceId).filter(Boolean))];
  if (!riderIds.length || !raceIds.length) return new Map();
  const roles = await supabase
    .from("race_stage_roles")
    .select("race_id, stage_number, rider_id, effort")
    .in("race_id", raceIds)
    .in("rider_id", riderIds);
  if (roles.error) {
    console.warn(`  race-day intention lookup failed: ${roles.error.message ?? roles.error} - yield modifier 1.0 (fail-safe)`);
    return new Map();
  }
  const orders = await supabase
    .from("race_team_orders")
    .select("race_id, stage_number, riders")
    .in("race_id", raceIds);
  if (orders.error) {
    console.warn(`  race-day intention order lookup failed: ${orders.error.message ?? orders.error} - yield modifier 1.0 (fail-safe)`);
    return new Map();
  }
  return raceDayEffortByRider(stageByRider, roles.data ?? [], orders.data ?? []);
}
