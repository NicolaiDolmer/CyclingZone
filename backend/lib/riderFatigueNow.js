// #7801: én kilde til en rytters træthed "lige nu" og "ved start af næste etape".
//
// Under dato-opgørelsen er rider_condition åbningen fra aftenen før; datoens etaper står i
// ledgeren, indtil datoen afregnes. Motoren lægger dem oveni ved etapestart, mens fladerne
// har vist åbningen. Derfor regner motor og flader her gennem samme funktioner: motoren
// (raceFatigue.applySameDateEnteringFatigueV2) og de tal, spilleren skal se, kan ikke skilles ad.
//
// Modulet kender kun det, motoren kender i dag: åbningen og datoens registrerede belastninger.
// Dagens træningspas tæller først med ved datoens opgørelse, både her og i motoren.

import { enteringFatigueV2, settleDateFatigueV2 } from "./conditionModelV2.js";
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";

/**
 * Træthed lige nu: åbningen plus datoens etaper, der er kørt og endnu ikke afregnet.
 * Uden belastninger er tallet åbningen, uændret.
 */
export function riderFatigueNow({ openingFatigue, dateLoads = [], recoveryAbility = 50, medicalBonus = 0, cfg }) {
  if (!dateLoads?.length) return openingFatigue;
  return enteringFatigueV2({ openingFatigue, priorLoadsToday: dateLoads, recoveryAbility, medicalBonus, cfg });
}

/**
 * Træthed ved start af en etape. `loadsBeforeStage` = belastningerne på etapens egen dato før
 * etapen. `datesBefore` = hele datoer, der skal afregnes først, som { intensities, raceLoads }
 * til aftenens opgørelse; kun aktuelt når etapen ligger på en senere dato. Felterne samles af
 * kalderen, for de kommer fra planen og er et skøn, indtil datoen er kørt.
 */
export function riderFatigueAtStageStart({ openingFatigue, datesBefore = [], loadsBeforeStage = [], recoveryAbility = 50, medicalBonus = 0, raceDateTrainingDay = false, cfg }) {
  let opening = openingFatigue;
  for (const { intensities, raceLoads } of datesBefore) {
    opening = settleDateFatigueV2({ fatigue: opening, intensities, raceLoads, recoveryAbility, medicalBonus, raceDateTrainingDay, cfg });
  }
  return riderFatigueNow({ openingFatigue: opening, dateLoads: loadsBeforeStage, recoveryAbility, medicalBonus, cfg });
}

/** Etapens løbsdag og dato. Null, hvis etapen ikke er planlagt endnu. */
export async function loadStageStart({ supabase, raceId, stageNumber }) {
  const { data: sched, error: schedErr } = await supabase.from("race_stage_schedule")
    .select("game_day, scheduled_at").eq("race_id", raceId).eq("stage_number", stageNumber).maybeSingle();
  if (schedErr) throw new Error(`race_stage_schedule (same-date fatigue): ${schedErr.message}`);
  const gameDay = Number(sched?.game_day);
  if (!Number.isInteger(gameDay) || !sched?.scheduled_at) return null;
  // Samme dato som ledgerens tick_date (dansk kalenderdato for etapens start).
  return { gameDay, tickDate: copenhagenDateString(new Date(sched.scheduled_at)) };
}

/**
 * Datoens endnu ikke afregnede belastninger pr. rytter i løbsdags-orden (kun originaler).
 * `beforeGameDay` afgrænser til løbsdagene før en etape; udeladt = alt registreret på datoen.
 * Læser kun den ene dato: rækker, der er blevet stående uafregnet på gamle datoer, hører ikke
 * til hverken motorens eller spillerens tal.
 */
export async function loadUnsettledDateLoads({ supabase, riderIds, tickDate, beforeGameDay = null }) {
  const rows = [];
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    // pagination-safe: ≤100 ryttere × højst én datos løbsdage.
    let query = supabase.from("training_race_loads")
      .select("rider_id, game_day, load")
      .in("rider_id", riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE))
      .eq("tick_date", tickDate);
    if (beforeGameDay != null) query = query.lt("game_day", beforeGameDay);
    const { data, error } = await query
      .is("consumed_at", null).is("duplicate_of_race_id", null)
      .order("game_day");
    if (error) throw new Error(`training_race_loads (same-date fatigue): ${error.message}`);
    rows.push(...(data ?? []));
  }
  const loadsByRider = new Map();
  for (const row of rows.slice().sort((a, b) => Number(a.game_day) - Number(b.game_day))) {
    const key = String(row.rider_id);
    if (!loadsByRider.has(key)) loadsByRider.set(key, []);
    loadsByRider.get(key).push(Number(row.load) || 0);
  }
  return loadsByRider;
}

// Ryttere uden condition-række røres ikke (neutral i motoren).
const withCondition = (riders) => (riders ?? []).filter((r) => Number.isFinite(Number(r.fatigue)));

function applyDateLoads(riders, loadsByRider, medicalBonusByTeam) {
  let changed = 0;
  for (const rider of riders) {
    const prior = loadsByRider.get(String(rider.rider_id));
    if (!prior?.length) continue;
    const next = riderFatigueAtStageStart({
      openingFatigue: Number(rider.fatigue), loadsBeforeStage: prior,
      recoveryAbility: rider.abilities?.recovery ?? 50, medicalBonus: medicalBonusByTeam.get(rider.team_id) ?? 0,
    });
    if (next !== Number(rider.fatigue)) changed++;
    rider.fatigue = next;
  }
  return changed;
}

/**
 * Motorens indgang: sætter `entrant.fatigue` til trætheden ved etapens start, når rytteren
 * allerede har kørt etaper samme dato.
 * @returns {Promise<number>} antal ryttere hvis træthed blev ændret
 */
export async function applyStageStartFatigue({ supabase, raceId, stageNumber, entrants, medicalBonusByTeam = new Map() }) {
  const riders = withCondition(entrants);
  if (!riders.length) return 0;
  const start = await loadStageStart({ supabase, raceId, stageNumber });
  if (!start) return 0;
  const loadsByRider = await loadUnsettledDateLoads({
    supabase, riderIds: riders.map((r) => r.rider_id), tickDate: start.tickDate, beforeGameDay: start.gameDay,
  });
  return applyDateLoads(riders, loadsByRider, medicalBonusByTeam);
}

/**
 * Fladernes indgang: kopier af `riders` med trætheden lige nu. Samme rækkeform som motorens
 * entrants ({ rider_id, team_id, fatigue, abilities: { recovery } }). Uden condition_model_v2
 * er rider_condition selv det sande tal, og ledgeren læses ikke.
 */
export async function ridersWithFatigueNow({ supabase, riders, now = new Date(), medicalBonusByTeam = new Map() }) {
  const copies = (riders ?? []).map((r) => ({ ...r }));
  const known = withCondition(copies);
  if (!known.length || !await isConditionModelV2Enabled(supabase)) return copies;
  const loadsByRider = await loadUnsettledDateLoads({
    supabase, riderIds: known.map((r) => r.rider_id), tickDate: copenhagenDateString(now),
  });
  applyDateLoads(known, loadsByRider, medicalBonusByTeam);
  return copies;
}
