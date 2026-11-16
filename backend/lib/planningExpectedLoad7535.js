// #7535 (ejervalg 16/11, punkt 5): kolonnen "Belastning" paa planlaegningssiden.
// Den forventede belastning af loebet for rytteren, som ORD: let, mellem eller haard.
//
// Ejerens krav: intet tal for forventet traethed efter loebet, og ordet maa ikke kunne regnes
// tilbage til et tal. Derfor forlader kun ordet serveren; selve belastningen bliver her.
//
// Ingen ny formel: belastningen pr. etape er motorens egen (conditionModelV2.stageLoadV2 med indsats
// "normal", samme kald som raceFatigue.raceConditionLoads), lagt sammen over de etaper der endnu ikke
// er koert. Rytterens loebsdage i saesonen regnes med som i motoren. Graenserne mellem ordene er en
// visningsregel (ikke motor) og staar kun her. Kun under condition_model_v2; slukket = ingen ord.
import { stageLoadV2 } from "./conditionModelV2.js";
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";
import { routeMatchRevisionFor } from "./routeMatch.js";

export const EXPECTED_LOAD_WORDS = Object.freeze(["light", "medium", "hard"]);

// Visningsgraenser for ordene (summen af motorens etapebelastning ved normal indsats).
const LIGHT_BELOW = 12;
const HARD_FROM = 30;

/** REN. Ordet for en samlet belastning. */
export function expectedLoadWord(total) {
  const v = Number(total);
  if (!Number.isFinite(v)) return null;
  if (v < LIGHT_BELOW) return "light";
  if (v < HARD_FROM) return "medium";
  return "hard";
}

/**
 * REN. Forventet belastning pr. rytter som ord.
 * @param {{ riderIds: string[],
 *           stages: Array<{ stage_number: number, profile_type?: string|null, distance_km?: number|null }>,
 *           stagesCompleted?: number, seasonRaceDaysByRider?: Map<string, number>, revision?: string|null }} args
 * @returns {Record<string, "light"|"medium"|"hard">}
 */
export function expectedLoad7535({ riderIds, stages, stagesCompleted = 0, seasonRaceDaysByRider = new Map(), revision = null }) {
  const done = Number(stagesCompleted) || 0;
  const ahead = (stages ?? [])
    .filter((s) => Number(s?.stage_number) > done)
    .sort((a, b) => Number(a.stage_number) - Number(b.stage_number));
  const out = {};
  if (!ahead.length) return out;
  for (const id of riderIds ?? []) {
    const baseDays = Number(seasonRaceDaysByRider.get(String(id))) || 0;
    let total = 0;
    ahead.forEach((stage, k) => {
      total += Number(stageLoadV2({
        profileType: stage.profile_type ?? null,
        distanceKm: stage.distance_km ?? null,
        stageNumber: Number(stage.stage_number),
        effort: "normal",
        seasonRaceDays: baseDays + k + 1,
        rulesRevision: revision,
      })) || 0;
    });
    const word = expectedLoadWord(total);
    if (word) out[id] = word;
  }
  return out;
}

const RACE_COLUMNS = "id, season_id, status, stages_completed, engine_rules_revision, scheduled_for, race_type, stages";

/**
 * Laeser og regner for holdets ryttere. `deps` kan erstattes i tests.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function loadExpectedLoad7535({ supabase, teamId, raceId, deps = {} }) {
  const conditionV2 = deps.isConditionModelV2Enabled ?? isConditionModelV2Enabled;
  if (await conditionV2(supabase) !== true) return { status: 200, body: { enabled: false, riders: {} } };

  const { data: race, error: raceErr } = await supabase.from("races").select(RACE_COLUMNS).eq("id", raceId).maybeSingle();
  if (raceErr) throw new Error(`races (expected load 7535): ${raceErr.message}`);
  if (!race) return { status: 404, body: { error: "race_not_found" } };

  const [ridersRes, stagesRes] = await Promise.all([
    // pagination-safe: ét holds ryttere (maks ~30).
    supabase.from("riders").select("id").eq("team_id", teamId).eq("is_retired", false),
    // pagination-safe: ét loebs etaper (< 30 raekker).
    supabase.from("race_stage_profiles").select("stage_number, profile_type, distance_km").eq("race_id", raceId),
  ]);
  if (ridersRes.error) throw new Error(`riders (expected load 7535): ${ridersRes.error.message}`);
  if (stagesRes.error) throw new Error(`race_stage_profiles (expected load 7535): ${stagesRes.error.message}`);
  const riderIds = (ridersRes.data ?? []).map((r) => r.id);
  if (!riderIds.length || !(stagesRes.data ?? []).length) return { status: 200, body: { enabled: true, riders: {} } };

  const loadSeasonRaceDays = deps.loadSeasonRaceDaysByRider ?? (await import("./raceFatigue.js")).loadSeasonRaceDaysByRider;
  let seasonRaceDaysByRider = new Map();
  try {
    seasonRaceDaysByRider = await loadSeasonRaceDays({ supabase, seasonId: race.season_id, riderIds });
  } catch {
    // best-effort: uden loebsdagene regnes ordet som ved saesonens foerste loebsdag.
    seasonRaceDaysByRider = new Map();
  }

  return {
    status: 200,
    body: {
      enabled: true,
      riders: expectedLoad7535({
        riderIds,
        stages: stagesRes.data ?? [],
        stagesCompleted: race.stages_completed,
        seasonRaceDaysByRider,
        revision: routeMatchRevisionFor(race),
      }),
    },
  };
}
