// #6984 M4 + M8: holdlægens ord på holdudtagelsen. Kun under condition_model_v2.
// Ord, aldrig tal: svaret bærer kun nøgler (fresh/ready/tired/rest/injured og
// ready/ready_but_spent_later/already_heavy/rest_first/injured), aldrig træthed eller
// løbsdage. Skarpheden (antal trin) følger afdelingens niveau (medicalEffects).
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";
import { CONDITION_V2_CONFIG } from "./conditionModelV2.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { doctorAssessment, doctorSeasonAdvice, assessmentLevels } from "./medicalEffects.js";
import { loadSeasonRaceDaysByRider, applySameDateEnteringFatigueV2 } from "./raceFatigue.js";
import { isS5ProfilesV2OrLater } from "./raceEngineRulesRevision.ts";
import { medicalBonus } from "./medicalEffects.js";

const GT_MIN_STAGES = 15;

/** M8: løbsdagen hvor en rytter regnes for "kørt flad" (en del af vejen mod sæsonloftet). */
export const SEASON_SPENT_SHARE = 0.6;
export function seasonAdviceThresholds(cfg = CONDITION_V2_CONFIG) {
  const toCap = (cfg.seasonCap - 1) / cfg.seasonPerDay;
  return { seasonFreeDays: cfg.seasonFreeDays, seasonCapDays: Math.round(cfg.seasonFreeDays + SEASON_SPENT_SHARE * toCap) };
}

export const isGrandTour = (race) => Number(race?.stages) >= GT_MIN_STAGES && race?.race_type === "stage_race";

/**
 * REN: lægens rapport for et sæt ryttere.
 * @param {{ riders: Array<{id:string, fatigue:number|null, injured?:boolean}>, tier:number,
 *   seasonRaceDaysByRider?: Map<string,number>|null, plannedGtRaceDays?: number|null }} args
 *   plannedGtRaceDays = etaper i denne og sæsonens senere Grand Tours (kun for en GT).
 */
export function buildDoctorReport({ riders, tier, seasonRaceDaysByRider = null, plannedGtRaceDays = null }) {
  const thresholds = seasonAdviceThresholds();
  const byRider = {};
  for (const r of riders ?? []) {
    const entry = { assessment: doctorAssessment({ fatigue: r.fatigue, injured: !!r.injured, tier }) };
    if (seasonRaceDaysByRider && plannedGtRaceDays != null) {
      entry.season = doctorSeasonAdvice({
        fatigue: r.fatigue, injured: !!r.injured, tier,
        seasonRaceDays: seasonRaceDaysByRider.get(String(r.id)) ?? 0,
        plannedRaceDaysToLastGt: plannedGtRaceDays,
      }, thresholds);
    }
    byRider[r.id] = entry;
  }
  return { levels: assessmentLevels(tier), riders: byRider };
}

/** IO: rapporten til GET /races/:raceId/selection. null når flaget er off eller ved fejl. */
export async function loadDoctorReportForSelection({ supabase, race, teamId, riders }) {
  try {
    if (!(await isConditionModelV2Enabled(supabase))) return null;
    const { facilityTier, staff } = await loadTrainingStaffContext(supabase, teamId, { track: "medical" });
    const assessed = await ridersAtNextStageStart({ supabase, race, riders, teamId, medical: medicalBonus(facilityTier, staff) });
    let seasonRaceDaysByRider = null;
    let plannedGtRaceDays = null;
    if (isGrandTour(race) && race.season_id) {
      seasonRaceDaysByRider = await loadSeasonRaceDaysByRider({ supabase, seasonId: race.season_id, riderIds: riders.map((r) => r.id) });
      // pagination-safe: sæsonens Grand Tours i én division (3).
      let q = supabase.from("races").select("id, stages, stages_completed, scheduled_for, race_type")
        .eq("season_id", race.season_id).eq("race_type", "stage_race").gte("stages", GT_MIN_STAGES);
      if (race.league_division_id) q = q.eq("league_division_id", race.league_division_id);
      const { data, error } = await q;
      if (error) throw new Error(`races (doctor): ${error.message}`);
      const from = race.scheduled_for ?? "";
      plannedGtRaceDays = (data ?? [])
        .filter((g) => g.id === race.id || String(g.scheduled_for ?? "") >= String(from))
        .reduce((sum, g) => sum + Math.max(0, Number(g.stages) - Number(g.stages_completed ?? 0)), 0);
    }
    return buildDoctorReport({ riders: assessed, tier: facilityTier, seasonRaceDaysByRider, plannedGtRaceDays });
  } catch (err) {
    // best-effort: visning; en fejl må aldrig vælte udtagelsen. Ingen rapport = panelet viser intet.
    console.error(`doctor report failed (race ${race?.id}): ${err?.message ?? err}`);
    return null;
  }
}

/**
 * M4 skal vurdere den træthed rytteren STARTER næste etape med. Har løbet B2 (bundet
 * til s5_profiles_v2+, kun under condition_model_v2), lægger motoren datoens endnu ikke
 * afregnede belastninger oven i åbningen; lægen bruger samme helper, ellers ville han
 * vurdere etape 2+ på morgenens tal. Ellers er åbningen svaret. Kopier, intet muteres.
 */
export async function ridersAtNextStageStart({ supabase, race, riders, teamId, medical = 0 }) {
  const copies = (riders ?? []).map((r) => ({ ...r }));
  if (race?.race_type !== "stage_race") return copies;
  const { data: rev, error } = await supabase.from("races").select("engine_rules_revision, stages_completed").eq("id", race.id).maybeSingle();
  if (error) throw new Error(`races (doctor revision): ${error.message}`);
  if (!isS5ProfilesV2OrLater(rev?.engine_rules_revision)) return copies;
  const entrants = copies.map((r) => ({ rider_id: r.id, team_id: teamId, fatigue: r.fatigue, abilities: { recovery: r.abilities?.recovery ?? 50 } }));
  await applySameDateEnteringFatigueV2({ supabase, raceId: race.id, stageNumber: Number(rev?.stages_completed ?? 0) + 1, entrants, medicalBonusByTeam: new Map([[teamId, medical]]) });
  return copies.map((r, i) => ({ ...r, fatigue: entrants[i].fatigue }));
}
