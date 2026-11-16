// #7535 runde 3: kolonnen "Efter loebet" paa planlaegningssiden (spec 2026-11-02, Squad).
// Forventet traethed efter loebets sidste etape ved normal indsats.
//
// Ingen ny formel: belastningen pr. etape er motorens egen (conditionModelV2.stageLoadV2, samme
// kald som raceFatigue.raceConditionLoads med indsats "normal"), og etaperne laegges oven i
// hinanden med én restitution pr. etape gennem motorens enteringFatigueV2. Rytterens egen
// recovery-evne og holdets medicinske afdeling regnes med som i motoren. Kun under
// condition_model_v2; slukket = intet tal (kolonnen viser en streg).
//
// Startpunktet er traetheden lige nu (samme tal som kolonnen Traethed). Dagene mellem nu og
// loebets start kendes ikke (traening og restitution), saa tallet er et skoen ("~").
import { enteringFatigueV2, stageLoadV2 } from "./conditionModelV2.js";
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";
import { routeMatchRevisionFor } from "./routeMatch.js";

/**
 * REN. Forventet traethed efter sidste etape pr. rytter.
 * @param {{ riders: Array<{ rider_id: string, fatigue: number|null, recovery?: number|null }>,
 *           stages: Array<{ stage_number: number, profile_type?: string|null, distance_km?: number|null }>,
 *           stagesCompleted?: number, seasonRaceDaysByRider?: Map<string, number>,
 *           medicalBonus?: number, revision?: string|null }} args
 * @returns {Record<string, number>}
 */
export function afterRaceFatigue7535({ riders, stages, stagesCompleted = 0, seasonRaceDaysByRider = new Map(), medicalBonus = 0, revision = null }) {
  const done = Number(stagesCompleted) || 0;
  const ahead = (stages ?? [])
    .filter((s) => Number(s?.stage_number) > done)
    .sort((a, b) => Number(a.stage_number) - Number(b.stage_number));
  const out = {};
  if (!ahead.length) return out;
  for (const rider of riders ?? []) {
    const start = rider?.fatigue;
    if (start == null || !Number.isFinite(Number(start))) continue;
    const baseDays = Number(seasonRaceDaysByRider.get(String(rider.rider_id))) || 0;
    const loads = ahead.map((stage, k) => stageLoadV2({
      profileType: stage.profile_type ?? null,
      distanceKm: stage.distance_km ?? null,
      stageNumber: Number(stage.stage_number),
      effort: "normal",
      seasonRaceDays: baseDays + k + 1,
      rulesRevision: revision,
    }));
    out[rider.rider_id] = enteringFatigueV2({
      openingFatigue: Number(start),
      priorLoadsToday: loads,
      recoveryAbility: Number(rider.recovery ?? 50),
      medicalBonus,
    });
  }
  return out;
}

const RACE_COLUMNS = "id, season_id, status, stages_completed, engine_rules_revision, scheduled_for, race_type, stages";

/**
 * Laeser og regner for holdets ryttere. `deps` kan erstattes i tests.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function loadAfterRaceFatigue7535({ supabase, teamId, raceId, deps = {} }) {
  const conditionV2 = deps.isConditionModelV2Enabled ?? isConditionModelV2Enabled;
  if (await conditionV2(supabase) !== true) return { status: 200, body: { enabled: false, riders: {} } };

  const { data: race, error: raceErr } = await supabase.from("races").select(RACE_COLUMNS).eq("id", raceId).maybeSingle();
  if (raceErr) throw new Error(`races (after race 7535): ${raceErr.message}`);
  if (!race) return { status: 404, body: { error: "race_not_found" } };

  const [ridersRes, stagesRes] = await Promise.all([
    // pagination-safe: ét holds ryttere (maks ~30).
    supabase.from("riders").select("id").eq("team_id", teamId).eq("is_retired", false),
    // pagination-safe: ét loebs etaper (< 30 raekker).
    supabase.from("race_stage_profiles").select("stage_number, profile_type, distance_km").eq("race_id", raceId),
  ]);
  if (ridersRes.error) throw new Error(`riders (after race 7535): ${ridersRes.error.message}`);
  if (stagesRes.error) throw new Error(`race_stage_profiles (after race 7535): ${stagesRes.error.message}`);
  const riderIds = (ridersRes.data ?? []).map((r) => r.id);
  if (!riderIds.length || !(stagesRes.data ?? []).length) return { status: 200, body: { enabled: true, riders: {} } };

  const [conditionRes, abilitiesRes] = await Promise.all([
    supabase.from("rider_condition").select("rider_id, form, fatigue, injured_until").in("rider_id", riderIds),
    supabase.from("rider_derived_abilities").select("rider_id, recovery").in("rider_id", riderIds),
  ]);
  if (conditionRes.error) throw new Error(`rider_condition (after race 7535): ${conditionRes.error.message}`);
  const recoveryById = new Map((abilitiesRes.error ? [] : abilitiesRes.data ?? []).map((a) => [a.rider_id, a.recovery]));

  // Samme "traethed lige nu" som kolonnen Traethed (riderFatigueNow, best-effort til aabningen).
  const fatigueNow = deps.fatigueByRiderNow ?? (await import("./riderFatigueNow.js")).fatigueByRiderNow;
  let startById;
  try {
    startById = await fatigueNow({ supabase, conditions: conditionRes.data ?? [], teamId });
  } catch {
    startById = new Map((conditionRes.data ?? []).map((c) => [c.rider_id, c.fatigue]));
  }
  const loadSeasonRaceDays = deps.loadSeasonRaceDaysByRider ?? (await import("./raceFatigue.js")).loadSeasonRaceDaysByRider;
  let seasonRaceDaysByRider = new Map();
  try {
    seasonRaceDaysByRider = await loadSeasonRaceDays({ supabase, seasonId: race.season_id, riderIds });
  } catch {
    // best-effort: uden loebsdagene regnes skoennet som saesonens foerste loebsdag.
    seasonRaceDaysByRider = new Map();
  }
  const loadMedical = deps.loadTeamMedicalBonus ?? (await import("./medicalEffects.js")).loadTeamMedicalBonus;
  let medicalBonus = 0;
  try {
    medicalBonus = await loadMedical(supabase, teamId);
  } catch {
    // best-effort: uden afdelingen regnes uden bonus (tallet bliver hellere lidt hoejt end for lavt).
    medicalBonus = 0;
  }

  const riders = riderIds.map((id) => ({ rider_id: id, fatigue: startById.get(id) ?? null, recovery: recoveryById.get(id) ?? 50 }));
  return {
    status: 200,
    body: {
      enabled: true,
      riders: afterRaceFatigue7535({
        riders,
        stages: stagesRes.data ?? [],
        stagesCompleted: race.stages_completed,
        seasonRaceDaysByRider,
        medicalBonus,
        revision: routeMatchRevisionFor(race),
      }),
    },
  };
}
