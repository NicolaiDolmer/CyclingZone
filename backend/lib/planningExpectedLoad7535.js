// #7535 (ejervalg 16/11, punkt 5): kolonnen "Belastning" paa planlaegningssiden.
// Den forventede belastning af loebet for rytteren, som ORD: let, mellem eller haard.
//
// Ejerens krav: intet tal for forventet traethed efter loebet, og ordet maa ikke kunne regnes
// tilbage til et tal. Derfor forlader kun ordet serveren; selve belastningen bliver her.
//
// Ingen ny formel: belastningen pr. etape er motorens egen (conditionModelV2.stageLoadV2 med indsats
// "normal", samme kald som raceFatigue.raceConditionLoads), lagt sammen over de etaper der endnu ikke
// er koert. Rytterens loebsdage i saesonen regnes med som i motoren. Kun under condition_model_v2;
// slukket = ingen ord.
//
// #8294 (hard rule 17): graenserne mellem ordene er balance-tal og bor KUN i den lukkede tabel
// private_config (noeglen planning_expected_load_7535, form i planningExpectedLoad7535Params.js).
// Mangler eller er raekken ugyldig: intet ord (fladen skjuler kolonnen) og en advarsel uden tal.
import { stageLoadV2 } from "./conditionModelV2.js";
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";
import { routeMatchRevisionFor } from "./routeMatch.js";
import { readPrivateConfigEntry, PRIVATE_CONFIG_KEYS } from "./privateConfig.ts";

export const EXPECTED_LOAD_WORDS = Object.freeze(["light", "medium", "hard"]);
export const PLANNING_EXPECTED_LOAD_KEY = "planning_expected_load_7535";

/**
 * REN. Ordet for en samlet belastning. Uden gyldige graenser (eller uden tal) = null.
 * @param {number} total
 * @param {{ lightBelow: number, hardFrom: number } | null | undefined} thresholds
 */
export function expectedLoadWord(total, thresholds) {
  const v = Number(total);
  if (!Number.isFinite(v) || !thresholds) return null;
  const { lightBelow, hardFrom } = thresholds;
  if (!Number.isFinite(lightBelow) || !Number.isFinite(hardFrom)) return null;
  if (v < lightBelow) return "light";
  if (v < hardFrom) return "medium";
  return "hard";
}

// Advarslen om en manglende raekke skrives hoejst hvert 10. minut pr. proces, saa et loeb der aabnes
// mange gange ikke fylder loggen. Ugyldig raekke og databasefejl advarer privateConfig.ts selv om.
const MISSING_WARN_EVERY_MS = 10 * 60_000;
let lastMissingWarnAt = -Infinity;

/**
 * Graenserne fra private_config, eller null (mangler, ugyldig eller databasefejl). Logger aldrig tallene.
 * @returns {Promise<{ lightBelow: number, hardFrom: number } | null>}
 */
export async function readPlanningExpectedLoadThresholds({ supabase, log = console, now = Date.now }) {
  const entry = await readPrivateConfigEntry(supabase, PLANNING_EXPECTED_LOAD_KEY, {
    log, now, schema: PRIVATE_CONFIG_KEYS.planning_expected_load_7535.parse,
  });
  if (entry.status === "ok") return entry.value;
  if (entry.status === "missing" && now() - lastMissingWarnAt >= MISSING_WARN_EVERY_MS) {
    lastMissingWarnAt = now();
    log?.warn?.(`[private-config] ${PLANNING_EXPECTED_LOAD_KEY} mangler: planlaegningssiden viser intet belastningsord. Saet den med scripts/ops/setPrivateConfig.mjs`);
  }
  return null;
}

/**
 * REN. Forventet belastning pr. rytter som ord.
 * @param {{ riderIds: string[],
 *           stages: Array<{ stage_number: number, profile_type?: string|null, distance_km?: number|null }>,
 *           stagesCompleted?: number, seasonRaceDaysByRider?: Map<string, number>, revision?: string|null,
 *           thresholds: { lightBelow: number, hardFrom: number } | null }} args
 * @returns {Record<string, "light"|"medium"|"hard">}
 */
export function expectedLoad7535({ riderIds, stages, stagesCompleted = 0, seasonRaceDaysByRider = new Map(), revision = null, thresholds = null }) {
  const done = Number(stagesCompleted) || 0;
  const ahead = (stages ?? [])
    .filter((s) => Number(s?.stage_number) > done)
    .sort((a, b) => Number(a.stage_number) - Number(b.stage_number));
  const out = {};
  if (!ahead.length || !thresholds) return out;
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
    const word = expectedLoadWord(total, thresholds);
    if (word) out[id] = word;
  }
  return out;
}

const RACE_COLUMNS = "id, season_id, status, stages_completed, engine_rules_revision, scheduled_for, race_type, stages";

/**
 * Laeser og regner for holdets ryttere. `deps` kan erstattes i tests (graenserne via
 * `deps.readThresholds`, aldrig den rigtige kilde).
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function loadExpectedLoad7535({ supabase, teamId, raceId, deps = {} }) {
  const conditionV2 = deps.isConditionModelV2Enabled ?? isConditionModelV2Enabled;
  if (await conditionV2(supabase) !== true) return { status: 200, body: { enabled: false, riders: {} } };

  // Uden gyldige graenser intet ord: samme svar som slukket model, saa fladen skjuler kolonnen.
  const readThresholds = deps.readThresholds ?? readPlanningExpectedLoadThresholds;
  const thresholds = await readThresholds({ supabase });
  if (!thresholds) return { status: 200, body: { enabled: false, riders: {} } };

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
        thresholds,
      }),
    },
  };
}
