// #6641 · Loebsdagens intention som udbytte-modifikator (variant B, ejer 24/9).
//
// Ejerens beslutning (#4632, 24/9): "intentionen bliver loebsdagens udbytte-
// modifikator, naar den taendes". Variant A (#4850) giver loebsdagen et mellem-pas
// paa etapens profil-evner (raceDayYield.js); variant B lægger managerens valgte
// intention for netop den etape ovenpaa: grupetto giver mindst, all_out mest
// (raceRoles.DEV_MULTIPLIER_BY_EFFORT, samme trappe som traethedsprisen).
//
// GATE: kun naar race_day_intention_enabled er on (kaldstedet laeser flaget).
// Flag off, en rytter uden valgt intention, et AI-hold og enhver opslagsfejl
// giver 1,0, altsaa praecis variant A (bit-identisk med i dag).
//
// KILDEN er managerens etape-valg, race_stage_roles.effort for (loeb, etape,
// rytter) paa loebsdagen. Etapen pr. rytter kommer fra loebsdags-opslaget
// (raceDayStageLookup.js), saa der er ingen ekstra gaet om hvilken etape det var.

import { effortDevelopmentMultiplier } from "./raceRoles.js";

/**
 * Udbytte-multiplikatoren for en loebsdag. Manglende/ukendt intention => 1,0.
 * @param {string|null|undefined} effort
 * @returns {number} > 0
 */
export function raceDayIntentionYieldMultiplier(effort) {
  return effort ? effortDevelopmentMultiplier(effort) : 1;
}

/**
 * Ren sammenkobling: rytter -> valgt intention for den etape han koerte i dag.
 * @param {Map<string, {raceId: string, stageNumber: number}>} stageByRider
 * @param {Array<{race_id: string, stage_number: number, rider_id: string, effort: string|null}>} roleRows
 * @returns {Map<string, string>}
 */
export function raceDayEffortByRider(stageByRider, roleRows = []) {
  const out = new Map();
  for (const row of roleRows ?? []) {
    const stage = stageByRider?.get(row?.rider_id);
    if (!stage || !row.effort) continue;
    if (stage.raceId !== row.race_id || Number(stage.stageNumber) !== Number(row.stage_number)) continue;
    out.set(row.rider_id, row.effort);
  }
  return out;
}

/**
 * Hent managerens intention pr. rytter for dagens etaper. BERIGELSE, ikke en
 * regel-gate: en fejl logges og giver et tomt kort (= variant A for alle).
 * @param {{ supabase: object, stageByRider: Map<string, {raceId: string, stageNumber: number}> }} args
 * @returns {Promise<Map<string, string>>}
 */
export async function loadRaceDayEffortByRider({ supabase, stageByRider }) {
  const riderIds = [...(stageByRider?.keys() ?? [])];
  const raceIds = [...new Set([...(stageByRider?.values() ?? [])].map((s) => s.raceId).filter(Boolean))];
  if (!riderIds.length || !raceIds.length) return new Map();
  const { data, error } = await supabase
    .from("race_stage_roles")
    .select("race_id, stage_number, rider_id, effort")
    .in("race_id", raceIds)
    .in("rider_id", riderIds);
  if (error) {
    console.warn(`  race-day intention lookup failed: ${error.message ?? error} - yield modifier 1.0 (fail-safe)`);
    return new Map();
  }
  return raceDayEffortByRider(stageByRider, data ?? []);
}
