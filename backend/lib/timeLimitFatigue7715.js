// #7715 (ejer 5/11, SLUKKET): meget traette ryttere risikerer tidsgraensen, med varsel.
//
// Eet sted der oversaetter en rytter + en etape til reglen i mechanics/timeLimit.ts.
// Broen bruger det til motoren, taktik og udtagelse til maerket, saa varslet og
// motoren regner paa de samme tal. Spilleren faar kun et ja eller nej: alvoren og
// taersklerne bliver her og i motoren (fog of war).
//
// Kontakten: app_config time_limit_fatigue_7715 = "on" (praecis den streng), alt andet
// er slukket, og en fejl taender aldrig. Kontakten gaelder kun loeb der starter efter den
// er taendt: et ja bindes paa races.time_limit_fatigue_7715 ved foerste etape-claim, samme
// princip som regel-revisionen. Et loeb uden binding faar aldrig reglen undervejs. Et bundet
// loeb koerer faerdigt med reglen, ogsaa hvis kontakten slukkes eller et opslag fejler (ejer
// 6/11). Vaerdien "stop" er ejerens noedstop og fjerner reglen fra naeste etape.

import { readFlagStage } from "./featureStage.js";
import { ROUTE_MATCH_ABILITY_KEYS, routeMatchRaw, routeMatchRevisionFor, stageRouteVector } from "./routeMatch.js";
import { timeLimitFatigueSeverity7715 } from "./engine/v4/mechanics/timeLimit.ts";
import { isS5ProfilesV3OrLater, raceHasStarted } from "./raceEngineRulesRevision.ts";
import { enteringFatigueV2, stageLoadV2 } from "./conditionModelV2.js"; // #7890
import { copenhagenDateString } from "./copenhagenTime.js"; // #7890
import { SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js"; // #7890
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js"; // #7890

export const TIME_LIMIT_FATIGUE_7715_FLAG_KEY = "time_limit_fatigue_7715";
export const TIME_LIMIT_FATIGUE_7715_EMERGENCY_STOP = "stop";

/** Kun den eksakte streng "on" taender. */
export function evaluateTimeLimitFatigue7715Flag(value) {
  return value === "on";
}

export async function isTimeLimitFatigue7715Enabled(supabase) {
  return evaluateTimeLimitFatigue7715Flag(await readFlagStage(supabase, TIME_LIMIT_FATIGUE_7715_FLAG_KEY));
}

/** Noedstop kun ved den eksakte vaerdi; en opslagsfejl maa aldrig aendre et loeb i gang. */
async function isEmergencyStop7715(supabase, readStage) {
  return Promise.resolve()
    .then(() => readStage(supabase, TIME_LIMIT_FATIGUE_7715_FLAG_KEY))
    .then((value) => value === TIME_LIMIT_FATIGUE_7715_EMERGENCY_STOP, () => false);
}

/** Rytterens eget niveau paa rutematchens skala: snittet af hans evner. */
export function riderOwnLevel7715(abilities) {
  if (!abilities) return null;
  return routeMatchRaw(abilities, Object.fromEntries(ROUTE_MATCH_ABILITY_KEYS.map((k) => [k, 1])));
}

/** Alvoren paa etapen for de ryttere der har risikoen, noeglet paa rider_id. Kun tal > 0. */
export function timeLimitFatigueSeverities7715({ riders, stageRow, revision }) {
  const out = {};
  const vector = stageRow ? stageRouteVector(stageRow, revision) : null;
  if (!vector) return out;
  for (const rider of riders ?? []) {
    const severity = timeLimitFatigueSeverity7715({
      fatigue: rider.fatigue,
      stageFit: routeMatchRaw(rider.abilities, vector),
      ownLevel: riderOwnLevel7715(rider.abilities),
      profileType: stageRow.profile_type,
    });
    if (severity > 0) out[rider.rider_id] = severity;
  }
  return out;
}

/**
 * Varslet til fladerne: { [rider_id]: { [stage_number]: true } }, kun ramte etaper.
 * #7890: `fatigueAtStage` (Map etape -> Map rytter -> traethed, fra stageStartFatigues7715)
 * giver hver etape traetheden ved dens start, som motoren ser den. Uden den, eller for en
 * rytter den ikke kender, bruges rytterens egen traethed som foer.
 */
export function timeLimitRiskByRider7715({ riders, stages, race, fatigueAtStage = null }) {
  const revision = routeMatchRevisionFor(race);
  const out = {};
  if (!isS5ProfilesV3OrLater(revision)) return out;
  for (const stageRow of stages ?? []) {
    const atStart = fatigueAtStage?.get(Number(stageRow.stage_number));
    const stageRiders = atStart ? (riders ?? []).map((r) => (atStart.has(r.rider_id) ? { ...r, fatigue: atStart.get(r.rider_id) } : r)) : riders;
    for (const riderId of Object.keys(timeLimitFatigueSeverities7715({ riders: stageRiders, stageRow, revision }))) {
      (out[riderId] ??= {})[stageRow.stage_number] = true;
    }
  }
  return out;
}

/**
 * #7890: traetheden ved hver kommende etapes start, som motoren regner den
 * (riderFatigueNow.applyStageStartFatigue): rytterens aabning plus belastningen fra
 * datoens tidligere etaper, hver minus én restitution (enteringFatigueV2). En koert etape
 * taeller med sin registrerede belastning (`recordedLoadsByRider`: datoens uafregnede
 * raekker { game_day, load }), en ikke-koert med en prognose (stageLoadV2 med holdets
 * indsats, ellers normal). Uden dette saa varslet kun morgenens traethed, saa paa en dag
 * med flere etaper kunne en rytter ryge ud af traethed uden varsel.
 * Etaper paa en senere dato end i dag starter fra aabningen (nattens afregning kendes ikke
 * endnu); mangler planen dato eller loebsdag, bruges aabningen. Medicinsk afdeling regnes
 * ikke med (0), saa varslet hellere kommer én gang for meget end for lidt. REN.
 * @returns {Map<number, Map<string, number>>}
 */
export function stageStartFatigues7715({ riders, stages, schedule, stagesCompleted = 0, todayStr, recordedLoadsByRider = new Map(), effortFor = () => "normal", revision = null }) {
  const out = new Map();
  const slot = new Map();
  for (const row of schedule ?? []) {
    const gameDay = Number(row?.game_day);
    const at = row?.scheduled_at ? new Date(row.scheduled_at) : null;
    if (!Number.isInteger(gameDay) || !at || !Number.isFinite(at.getTime())) continue;
    slot.set(Number(row.stage_number), { gameDay, date: copenhagenDateString(at) });
  }
  const done = Number(stagesCompleted) || 0;
  const sorted = (stages ?? []).slice().sort((a, b) => Number(a.stage_number) - Number(b.stage_number));
  for (const stage of sorted) {
    const n = Number(stage.stage_number);
    if (n <= done) continue;
    const own = slot.get(n);
    const before = own ? sorted.filter((p) => { const s = slot.get(Number(p.stage_number)); return s && s.date === own.date && s.gameDay < own.gameDay; }) : [];
    const byRider = new Map();
    for (const rider of riders ?? []) {
      const opening = Number(rider?.fatigue);
      if (rider?.fatigue == null || !Number.isFinite(opening)) continue;
      if (!before.length) { byRider.set(rider.rider_id, opening); continue; }
      const recorded = own.date === todayStr ? recordedLoadsByRider.get(String(rider.rider_id)) ?? [] : [];
      const loads = before.map((p) => {
        const pn = Number(p.stage_number);
        if (pn <= done) return recorded.filter((r) => Number(r.game_day) === slot.get(pn).gameDay).reduce((sum, r) => sum + (Number(r.load) || 0), 0);
        return stageLoadV2({ profileType: p.profile_type, distanceKm: p.distance_km ?? null, stageNumber: pn, effort: effortFor(rider.rider_id, pn) ?? "normal", rulesRevision: revision });
      });
      byRider.set(rider.rider_id, enteringFatigueV2({ openingFatigue: opening, priorLoadsToday: loads, recoveryAbility: Number(rider.abilities?.recovery ?? 50) }));
    }
    out.set(n, byRider);
  }
  return out;
}

/**
 * #7890: traetheden ved hver kommende etapes start for fladernes varsel (taktik, holdfane,
 * udtagelse). Kun under condition_model_v2, for kun dér laegger motoren datoens tidligere
 * etaper oven i aabningen. Indsatsen tages fra holdets gemte ordrer (`teamId`), ellers
 * normal. Best-effort: en fejl eller slukket model = null, og varslet bruger aabningen
 * som foer. Kaldes kun, naar reglen gaelder loebet (raceTimeLimitFatigue7715Applies).
 */
export async function loadStageStartFatigues7715({ supabase, race, teamId = null, riders, stages, now = new Date(), checkConditionV2 = isConditionModelV2Enabled }) {
  try {
    if (await checkConditionV2(supabase) !== true) return null;
    const { data: schedule, error } = await supabase.from("race_stage_schedule")
      .select("stage_number, scheduled_at, game_day").eq("race_id", race.id); // pagination-safe: ét løbs etaper (< 30 rækker)
    if (error) return null;
    const effortByStage = new Map();
    if (teamId != null) {
      const { data: orders, error: ordersError } = await supabase.from("race_team_orders")
        .select("stage_number, riders").eq("race_id", race.id).eq("team_id", teamId); // pagination-safe: ét holds ordrer i ét løb (< 30 rækker)
      if (!ordersError) {
        for (const row of orders ?? []) {
          const m = new Map();
          for (const r of Array.isArray(row.riders) ? row.riders : []) if (r?.rider_id != null && typeof r.effort === "string") m.set(String(r.rider_id), r.effort);
          effortByStage.set(Number(row.stage_number), m);
        }
      }
    }
    const todayStr = copenhagenDateString(now);
    const recordedLoadsByRider = Number(race.stages_completed) > 0
      ? await loadTodayStageLoads7715({ supabase, riderIds: (riders ?? []).map((r) => r.rider_id), todayStr })
      : new Map();
    return stageStartFatigues7715({
      riders, stages, schedule, stagesCompleted: race.stages_completed ?? 0, todayStr, recordedLoadsByRider,
      effortFor: (riderId, stageNumber) => effortByStage.get(stageNumber)?.get(String(riderId)) ?? "normal",
      revision: routeMatchRevisionFor(race),
    });
  } catch {
    // best-effort: varslet maa aldrig vaelte fladen; uden skoennet bruges aabningen.
    return null;
  }
}

/**
 * #7890: datoens uafregnede etape-belastninger pr. rytter (samme raekker som
 * riderFatigueNow.loadUnsettledDateLoads, men med loebsdagen, saa hver etape faar sine).
 * Best-effort: en fejl = intet (varslet falder tilbage til prognosen og aabningen).
 */
export async function loadTodayStageLoads7715({ supabase, riderIds, todayStr }) {
  const out = new Map();
  try {
    for (let i = 0; i < (riderIds ?? []).length; i += SUPABASE_IN_CHUNK_SIZE) {
      const { data, error } = await supabase.from("training_race_loads")
        .select("rider_id, game_day, load")
        .in("rider_id", riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE))
        .eq("tick_date", todayStr)
        .is("consumed_at", null).is("duplicate_of_race_id", null);
      if (error) return new Map();
      for (const row of data ?? []) {
        const key = String(row.rider_id);
        if (!out.has(key)) out.set(key, []);
        out.get(key).push({ game_day: row.game_day, load: row.load });
      }
    }
  } catch {
    // best-effort: varslet maa aldrig vaelte taktik-fladen.
    return new Map();
  }
  return out;
}

/**
 * Gaelder reglen for dette loeb lige nu? Et loeb der ikke er startet, faar den, naar
 * kontakten er taendt. Et startet kun hvis den blev bundet ved dets foerste etape, og saa
 * ogsaa med slukket kontakt. Kun noedstoppet fjerner den.
 * En fejl = nej: varslet maa aldrig vaelte taktik-fladen.
 */
export async function raceTimeLimitFatigue7715Applies({ supabase, race, checkEnabled = isTimeLimitFatigue7715Enabled, readStage = readFlagStage }) {
  if (!raceHasStarted(race)) return await Promise.resolve().then(() => checkEnabled(supabase)).catch(() => false) === true;
  try {
    const { data, error } = await readBinding7715({ supabase, race });
    if (error || data?.time_limit_fatigue_7715 !== true) return false;
    return !(await isEmergencyStop7715(supabase, readStage));
  } catch {
    // best-effort: varslet maa aldrig vaelte taktik-fladen; en fejl betyder blot intet maerke.
    return false;
  }
}

/**
 * Forklaringen efter etapen: { rider_id -> etape } for de ryttere motoren satte ud af
 * traethed. Laeser kun loebets tidslinjer, og kun naar holdet har udgaaede ryttere. Haenger
 * ikke paa kontakten, saa forklaringen staar, ogsaa hvis den senere slukkes. En fejl = ingen
 * forklaring: fladen maa aldrig vaelte af det.
 */
export async function loadFatigueOutStages7715({ supabase, race, riderIds }) {
  const out = new Map();
  if (!riderIds?.length) return out;
  const wanted = new Set(riderIds);
  let rows = null;
  try {
    // Kun et bundet loeb kan have saadan en haendelse: spar tidslinjerne for alle andre.
    const { data: binding, error: bindingError } = await readBinding7715({ supabase, race });
    if (bindingError || binding?.time_limit_fatigue_7715 !== true) return out;
    const { data, error } = await supabase.from("race_stage_timelines").select("stage_number, events").eq("race_id", race.id).order("stage_number", { ascending: true });
    rows = error ? null : data;
  } catch {
    // best-effort: uden forklaringen er fladen stadig fuldt brugbar, den maa aldrig vaelte af det.
    rows = null;
  }
  for (const row of rows ?? []) {
    const events = Array.isArray(row.events) ? row.events : row.events?.events ?? [];
    for (const event of events) {
      if (event?.type !== "outside_time_limit") continue;
      for (const id of event.params?.fatigue_rider_ids ?? []) if (wanted.has(id)) out.set(id, row.stage_number);
    }
  }
  return out;
}

/** Kun "kolonnen findes ikke". En constraint-fejl der naevner kolonnen, skal larme. */
function isMissingBindingColumn7715(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (!message.includes("time_limit_fatigue_7715")) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find/i.test(message);
}

function readBinding7715({ supabase, race }) {
  // schema-columns-ok: time_limit_fatigue_7715 tilfoejes af database/2026-11-06-7715-race-time-limit-fatigue.sql;
  // foer den er applied, er svaret bevidst nej (isMissingBindingColumn7715).
  return supabase.from("races").select("time_limit_fatigue_7715, stages_completed").eq("id", race.id).maybeSingle();
}

/**
 * Et bundet loeb koerer faerdigt med reglen. Kaldes ved hver etape, ogsaa med slukket
 * kontakt: laeser kun bindingen, og noedstoppet fjerner den. Mangler kolonnen, er svaret nej.
 * Andre DB-fejl kaster: etapen maa hellere vente end koere paa de forkerte regler.
 */
export async function raceBoundToTimeLimitFatigue7715({ supabase, race, readStage = readFlagStage }) {
  const { data, error } = await readBinding7715({ supabase, race });
  if (error) {
    if (isMissingBindingColumn7715(error)) return false;
    throw new Error(`race ${race.id}: time_limit_fatigue_7715 kunne ikke laeses (${error.message})`);
  }
  if (data?.time_limit_fatigue_7715 !== true) return false;
  return !(await isEmergencyStop7715(supabase, readStage));
}

/**
 * Kaldes kun med kontakten taendt. Binder et ja ved loebets FOERSTE etape-claim og laeser
 * det ellers. Betinget UPDATE (kun hvis kolonnen stadig er NULL og stages_completed
 * stadig er 0), derefter genlaesning, saa to samtidige claims ender paa samme valg.
 * @returns {Promise<boolean>} om loebet koerer med reglen.
 */
export async function bindRaceTimeLimitFatigue7715({ supabase, race, firstStageClaim, dryRun = false }) {
  const { data: row, error } = await readBinding7715({ supabase, race });
  if (error) {
    if (isMissingBindingColumn7715(error)) return false;
    throw new Error(`race ${race.id}: time_limit_fatigue_7715 kunne ikke laeses (${error.message})`);
  }
  if (row?.time_limit_fatigue_7715 === true) return true;
  const started = raceHasStarted({ id: race.id, stages_completed: row?.stages_completed ?? race.stages_completed ?? null });
  if (firstStageClaim !== true || started) return false;
  if (dryRun) return true;
  // schema-columns-ok: se readBinding7715.
  const { error: bindError } = await supabase
    .from("races").update({ time_limit_fatigue_7715: true }).eq("id", race.id).is("time_limit_fatigue_7715", null).eq("stages_completed", 0);
  if (bindError) {
    if (isMissingBindingColumn7715(bindError)) return false;
    throw new Error(`race ${race.id}: time_limit_fatigue_7715 kunne ikke bindes (${bindError.message})`);
  }
  const { data: after, error: rereadError } = await readBinding7715({ supabase, race });
  if (rereadError) throw new Error(`race ${race.id}: time_limit_fatigue_7715 kunne ikke genlaeses (${rereadError.message})`);
  return after?.time_limit_fatigue_7715 === true;
}
