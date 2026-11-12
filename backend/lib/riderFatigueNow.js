// #7801: én kilde til en rytters træthed "lige nu" og "ved start af næste etape".
//
// Uden et instant-stempel er rider_condition åbningen fra aftenen før; datoens etaper står i
// ledgeren, indtil datoen afregnes. Motoren lægger dem oveni ved etapestart, mens fladerne
// har vist åbningen. Derfor regner motor og flader her gennem samme funktioner: motoren
// (raceFatigue.applySameDateEnteringFatigueV2) og de tal, spilleren skal se, kan ikke skilles ad.
//
// Modulet kender kun det, motoren kender i dag: åbningen og datoens registrerede belastninger.
// Stemplede datoer bruger PR1's frosne åbning og receipts gennem instant-readeren.

import { enteringFatigueV2, settleDateFatigueV2 } from "./conditionModelV2.js";
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";
import { copenhagenDateString, copenhagenWallTimeToUTC } from "./copenhagenTime.js";
import { loadMedicalBonusByTeam } from "./medicalEffects.js";
import { isFatigueNow7801Enabled } from "./riderFatigueNowFlag.js";
import { fetchAllRows, SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";
import { dropBindingsAfterRaceExit, loadRaceExitGameDays } from "./trainingRaceDayTick.js";
import { loadInstantConditions, InstantConditionEvidenceError } from "./trainNowInstantCondition7737.js";

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
 * Motorens indgang: datoens tidligere etaper samt stemplet træning.
 * Stemplede ryttere får også form fra den fælles dato-opgørelse.
 * @returns {Promise<number>} antal ryttere hvis træthed blev ændret
 */
export async function applyStageStartFatigue({ supabase, raceId, stageNumber, entrants, medicalBonusByTeam = new Map(), instantOnly = false }) {
  const riders = withCondition(entrants);
  if (!riders.length) return 0;
  const start = await loadStageStart({ supabase, raceId, stageNumber });
  if (!start) return 0;
  const instant = await loadInstantConditions({ supabase, riderIds: riders.map(r => r.rider_id), tickDate: start.tickDate, beforeGameDay: start.gameDay });
  let changed = 0;
  for (const rider of riders) {
    const condition = instant.get(rider.rider_id);
    if (!condition) continue;
    if (condition.fatigue !== rider.fatigue) changed++;
    Object.assign(rider, condition);
  }
  const legacy = riders.filter(r => !instant.has(r.rider_id));
  if (instantOnly || !legacy.length) return changed;
  const loadsByRider = await loadUnsettledDateLoads({
    supabase, riderIds: legacy.map((r) => r.rider_id), tickDate: start.tickDate, beforeGameDay: start.gameDay,
  });
  return changed + applyDateLoads(legacy, loadsByRider, medicalBonusByTeam);
}

/**
 * Fladernes indgang: kopier af `riders` med trætheden lige nu. Samme rækkeform som motorens
 * entrants ({ rider_id, team_id, fatigue, abilities: { recovery } }). Uden condition_model_v2
 * er rider_condition selv det sande tal for ryttere uden et instant-stempel.
 */
export async function ridersWithFatigueNow({ supabase, riders, now = new Date(), beforeGameDay = null, medicalBonusByTeam = new Map() }) {
  const copies = (riders ?? []).map((r) => ({ ...r }));
  const instant = await loadInstantConditions({ supabase, riderIds: copies.map(r => r.rider_id), tickDate: copenhagenDateString(now), beforeGameDay, failOpenWhenOff: true });
  for (const rider of copies) if (instant.has(rider.rider_id)) Object.assign(rider, instant.get(rider.rider_id));
  const known = withCondition(copies).filter(r => !instant.has(r.rider_id));
  if (!known.length || !await isConditionModelV2Enabled(supabase)) return copies;
  const loadsByRider = await loadUnsettledDateLoads({
    supabase, riderIds: known.map((r) => r.rider_id), tickDate: copenhagenDateString(now), beforeGameDay,
  });
  applyDateLoads(known, loadsByRider, medicalBonusByTeam);
  return copies;
}

// ── #7801 PR 2: kalderne bag kontakten fatigue_now_7801 ─────────────────────────────
// Uden instant-stempel giver slukket kontakt dagens tal uændret. Et holdbart stempel
// læses også efter OFF; tændt bruger fladerne samme kerne som motoren ovenfor.

/**
 * Træthed lige nu før et felt på datoen: åbningen plus rytterens kørte etaper på tidligere
 * løbsdage samme dato. `loadRows` = datoens ledger-rækker (kun originaler), fx motorens
 * canonicalLoadRows. Træningens regler vurderes på dette tal, når kontakten er tændt.
 */
export function fatigueNowBeforeGameDay({ openingFatigue, loadRows = [], riderId, beforeGameDay, recoveryAbility = 50, medicalBonus = 0, cfg }) {
  const loads = (loadRows ?? [])
    .filter((row) => String(row.rider_id) === String(riderId) && Number(row.game_day) < Number(beforeGameDay))
    .sort((a, b) => Number(a.game_day) - Number(b.game_day))
    .map((row) => Number(row.load) || 0);
  return riderFatigueNow({ openingFatigue, dateLoads: loads, recoveryAbility, medicalBonus, cfg });
}

/**
 * Trætheden før hvert af datoens felter, i løbsdags-orden: åbningen plus de etaper, der
 * ligger i tidligere felter. Skaderisikoen ved træning regner på dette tal, når kontakten er
 * tændt, så et hårdt pas efter en etape samme dato vurderes på den trætte rytter.
 */
export function slotFatiguesNow({ openingFatigue, intensities = [], raceLoads = [], recoveryAbility = 50, medicalBonus = 0, cfg }) {
  const loads = [];
  return intensities.map((intensity, index) => {
    const fatigue = riderFatigueNow({ openingFatigue, dateLoads: loads, recoveryAbility, medicalBonus, cfg });
    if (intensity === "race") loads.push(Number(raceLoads[index]) || 0);
    return fatigue;
  });
}

const sameMap = (conditions) => new Map((conditions ?? []).map((c) => [c.rider_id, c.fatigue]));

async function recoveryByRiderFor(supabase, riderIds) {
  const out = new Map();
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    // pagination-safe: én række pr. rytter, ≤100 pr. kald.
    const { data, error } = await supabase.from("rider_derived_abilities")
      .select("rider_id, recovery").in("rider_id", riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE));
    if (error) throw new Error(`rider_derived_abilities (fatigue now): ${error.message}`);
    for (const row of data ?? []) out.set(row.rider_id, row.recovery);
  }
  return out;
}

/** Første etape i løbets etapeliste (den, assistenten udtager til). Uden liste: etape 1. */
export function firstStageNumber(stages) {
  const numbers = (stages ?? []).map((s) => Number(s?.stage_number || 1)).filter(Number.isFinite);
  return numbers.length ? Math.min(...numbers) : 1;
}

/**
 * Etapens planlagte start som `now` og dens løbsdag. Null, hvis etapen ikke er planlagt; så
 * lægger motoren heller intet oveni (applyStageStartFatigue).
 */
export async function loadStageStartAt({ supabase, raceId, stageNumber }) {
  const { data, error } = await supabase.from("race_stage_schedule")
    .select("game_day, scheduled_at").eq("race_id", raceId).eq("stage_number", stageNumber).maybeSingle();
  if (error) throw new Error(`race_stage_schedule (fatigue now): ${error.message}`);
  const gameDay = Number(data?.game_day);
  const at = data?.scheduled_at ? new Date(data.scheduled_at) : null;
  if (!Number.isInteger(gameDay) || !at || !Number.isFinite(at.getTime())) return null;
  return { now: at, gameDay };
}

/** Tallet lige nu kunne ikke regnes (fatigueByRiderNow med onError: "throw"); fladen viser "—". */
export class FatigueNowUnavailableError extends Error {}

/** Åbningen pr. rytter, præcis som rider_condition har den (kontakten slukket, eller intet at lægge oveni). */
export const openingFatigueMap = sameMap;

// Kernen: åbningen plus de etaper, der er kørt på datoen `at` før `beforeGameDay`.
async function liveFatigueMap({ supabase, conditions, base, abilityByRider, teamIdByRider, teamId, at, beforeGameDay }) {
  const ids = [...base.keys()];
  const recovery = abilityByRider ?? await recoveryByRiderFor(supabase, ids);
  const recoveryOf = (id) => {
    const value = recovery.get(id);
    return Number(typeof value === "object" && value != null ? value.recovery : value ?? 50);
  };
  const teamOf = (id) => teamIdByRider?.get(id) ?? teamId;
  const riders = (conditions ?? []).map((c) => ({
    rider_id: c.rider_id, team_id: teamOf(c.rider_id), fatigue: c.fatigue, form: c.form,
    abilities: { recovery: Number.isFinite(recoveryOf(c.rider_id)) ? recoveryOf(c.rider_id) : 50 },
  }));
  const medicalBonusByTeam = await isConditionModelV2Enabled(supabase)
    ? await loadMedicalBonusByTeam(supabase, riders.map((r) => r.team_id))
    : new Map();
  const live = await ridersWithFatigueNow({ supabase, riders, now: at, beforeGameDay, medicalBonusByTeam });
  return new Map(live.map((r) => [r.rider_id, r.fatigue]));
}

/**
 * Assistentens udtagelse til flere løb (Race Hubs auto-udfyld og forhåndsvisning): hvert løb
 * får trætheden ved sin første etapes planlagte start, som assistenten ved løbsstart
 * (raceRunner), så tallet ikke afhænger af hvornår knappen trykkes. `races` = [{ id, stages }].
 * Løb med samme startdato og løbsdag deler én udregning.
 *
 * Slukket: `byRace` er null og intet læses ud over kontakten; kalderen bruger da åbningen
 * (`fatById`) som i dag. Tændt: `byRace` har et map pr. løb; et uplanlagt løb eller en
 * læsefejl giver åbningen for det løb, som i motoren.
 * @returns {Promise<{ fatById: Map<string, number|null>, byRace: Map<string, Map<string, number|null>>|null }>}
 */
export async function fatigueByRiderForRaces({ supabase, conditions, abilityByRider = null, teamIdByRider = null, teamId = null, races = [], now = new Date() }) {
  const base = sameMap(conditions);
  if (!base.size || !races.length) return { fatById: base, byRace: null };
  if (!await isFatigueNow7801Enabled(supabase)) {
    // #7737 (foer taending): samme tal som fatigueByRiderNow med 7801 slukket, saa
    // udtagelsen og assistenten viser det samme for en rytter med et Traen nu-stempel.
    const instant = await loadInstantConditions({ supabase, riderIds: [...base.keys()], tickDate: copenhagenDateString(now), failOpenWhenOff: true });
    for (const [id, condition] of instant) base.set(id, condition.fatigue);
    return { fatById: base, byRace: null };
  }
  const byRace = new Map();
  const byStart = new Map();
  let recovery = abilityByRider;
  for (const race of races) {
    try {
      const start = await loadStageStartAt({ supabase, raceId: race.id, stageNumber: firstStageNumber(race.stages) });
      if (!start) { byRace.set(race.id, base); continue; }
      const key = `${copenhagenDateString(start.now)}|${start.gameDay}`;
      if (!byStart.has(key)) {
        recovery ??= await recoveryByRiderFor(supabase, [...base.keys()]);
        byStart.set(key, await liveFatigueMap({
          supabase, conditions, base, abilityByRider: recovery, teamIdByRider, teamId, at: start.now, beforeGameDay: start.gameDay,
        }));
      }
      byRace.set(race.id, byStart.get(key));
    } catch (err) {
      if (err instanceof InstantConditionEvidenceError) throw err;
      // best-effort, som fatigueByRiderNow: udtagelsen falder tilbage til åbningen.
      console.warn(`[fatigue-now-7801] fell back to opening fatigue: ${err.message}`);
      byRace.set(race.id, base);
    }
  }
  return { fatById: base, byRace };
}

/**
 * Træthed pr. rytter til fladerne og assistentens udtagelse. `conditions` = rider_condition-
 * rækker ({ rider_id, fatigue }). Slukket uden instant-stempel: dagens map uændret.
 * Tændt: trætheden lige nu. `abilityByRider` (rider_id → { recovery }) læses selv, hvis den
 * ikke gives; holdet findes via `teamIdByRider` eller `teamId`.
 *
 * `atStage` ({ raceId, stageNumber }) gør tallet til trætheden ved den etapes start: etapens
 * planlagte starttidspunkt er `now`, og kun datoens løbsdage før etapen tæller, som i motoren.
 * Assistenten udtager til en bestemt etape, så dens tal må ikke afhænge af, hvornår koden kører.
 * Planen læses først efter kontakten, så slukket læser intet nyt.
 *
 * Legacy-fejl kan give åbningen. Fejl i instant-evidens kastes altid, fordi den
 * gemte foreløbige tilstand ikke kan bruges som erstatning for en verificeret åbning.
 *
 * `onError` (kun med kontakten tændt): "opening" (standard, motoren og assistenten) falder
 * tilbage til åbningen. "throw" (fladerne) kaster FatigueNowUnavailableError, så kalderen kan
 * vise "—" frem for morgenens tal, der ellers ikke kan skelnes fra et beregnet tal.
 */
export async function fatigueByRiderNow({ supabase, conditions, abilityByRider = null, teamIdByRider = null, teamId = null, now = new Date(), atStage = null, onError = "opening" }) {
  const base = sameMap(conditions);
  if (!base.size) return base;
  if (!await isFatigueNow7801Enabled(supabase)) {
    const instant = await loadInstantConditions({ supabase, riderIds: [...base.keys()], tickDate: copenhagenDateString(now), failOpenWhenOff: true });
    for (const [id, condition] of instant) base.set(id, condition.fatigue);
    return base;
  }
  try {
    let at = now;
    let beforeGameDay = null;
    if (atStage) {
      const start = await loadStageStartAt({ supabase, raceId: atStage.raceId, stageNumber: atStage.stageNumber });
      if (!start) return base;
      at = start.now;
      beforeGameDay = start.gameDay;
    }
    return await liveFatigueMap({ supabase, conditions, base, abilityByRider, teamIdByRider, teamId, at, beforeGameDay });
  } catch (err) {
    if (err instanceof InstantConditionEvidenceError) throw err;
    const instant = await loadInstantConditions({ supabase, riderIds: [...base.keys()], tickDate: copenhagenDateString(now), failOpenWhenOff: true });
    if (instant.size) throw new InstantConditionEvidenceError(`instant stage evidence: ${err.message}`, { cause: err });
    if (onError === "throw") throw new FatigueNowUnavailableError(`fatigue now unavailable: ${err.message}`, { cause: err });
    // best-effort: udtagelsen falder tilbage til dagens tal (åbningen).
    console.warn(`[fatigue-now-7801] fell back to opening fatigue: ${err.message}`);
    return base;
  }
}

/** Et kendt træthedstal: null/undefined/"" er ukendt ("—"), ikke 0. */
export function isKnownFatigue(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function nextDateString(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Rytternes næste etape i dag eller i morgen (dansk dato): rider_id → { raceId, stageNumber,
 * gameDay, tickDate }. Kun etaper, der ikke er kørt (løbets stages_completed), uanset uret:
 * en forsinket etape, hvis planlagte tid er passeret, er stadig rytterens næste. Længere frem
 * gives intet skøn (ejerens punkt 4): planen for dagene imellem er et gæt.
 */
export async function loadNextStageByRider({ supabase, riderIds, seasonId, now = new Date() }) {
  const out = new Map();
  if (!riderIds?.length || !seasonId) return out;
  const today = copenhagenDateString(now);
  const tomorrow = nextDateString(today);
  const from = new Date(copenhagenWallTimeToUTC(today, 0)).toISOString();
  const until = new Date(copenhagenWallTimeToUTC(nextDateString(tomorrow), 0)).toISOString();
  const planned = await fetchAllRows(() => supabase.from("race_stage_schedule")
    .select("race_id, stage_number, game_day, scheduled_at")
    .gte("scheduled_at", from).lt("scheduled_at", until)
    .order("scheduled_at").order("race_id").order("stage_number"));
  if (!planned.length) return out;
  const completedByRace = new Map();
  const raceIds = [...new Set(planned.map((s) => s.race_id))];
  for (let i = 0; i < raceIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    // pagination-safe: én række pr. løb, ≤100 pr. kald.
    const { data, error } = await supabase.from("races")
      .select("id, stages_completed").in("id", raceIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE));
    if (error) throw new Error(`races (fatigue now): ${error.message}`);
    for (const race of data ?? []) completedByRace.set(race.id, Number(race.stages_completed) || 0);
  }
  // Et løb, der ikke kan læses, giver intet skøn frem for et skøn til en kørt etape.
  const schedule = planned.filter((s) => completedByRace.has(s.race_id)
    && Number(s.stage_number) > completedByRace.get(s.race_id));
  if (!schedule.length) return out;
  const gameDays = [...new Set(schedule.map((s) => Number(s.game_day)).filter(Number.isFinite))];
  const stageBy = new Map(schedule.map((s) => [`${s.race_id}:${Number(s.game_day)}`, s]));
  const entryDays = [];
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    // pagination-safe: ≤100 ryttere × højst to datoers løbsdage, UNIQUE (rider_id, season_id, game_day).
    const { data, error } = await supabase.from("race_entry_days")
      .select("rider_id, race_id, game_day").eq("season_id", seasonId)
      .in("rider_id", riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE)).in("game_day", gameDays);
    if (error) throw new Error(`race_entry_days (fatigue now): ${error.message}`);
    entryDays.push(...(data ?? []));
  }
  if (!entryDays.length) return out;
  // Samme udgangsregel som træningens binding: efter udgang kører rytteren ikke flere etaper.
  const { data: exits, error: exitErr } = await loadRaceExitGameDays({ supabase, rows: entryDays });
  if (exitErr) throw new Error(`race exits (fatigue now): ${exitErr.message ?? exitErr}`);
  for (const entry of dropBindingsAfterRaceExit(entryDays, exits)) {
    const stage = stageBy.get(`${entry.race_id}:${Number(entry.game_day)}`);
    if (!stage) continue;
    const prev = out.get(entry.rider_id);
    if (prev && prev.scheduledAt <= stage.scheduled_at) continue;
    out.set(entry.rider_id, {
      raceId: stage.race_id, stageNumber: Number(stage.stage_number), gameDay: Number(stage.game_day),
      tickDate: copenhagenDateString(new Date(stage.scheduled_at)), scheduledAt: stage.scheduled_at,
    });
  }
  for (const [id, next] of out) {
    if (next.tickDate !== today && next.tickDate !== tomorrow) out.delete(id);
  }
  return out;
}

/**
 * Træningsfladens tal: rider_id → { fatigue, fatigueAtStart }, med form for stemplede datoer.
 * Null ved slukket kontakt uden instant-stempler. `fatigueAtStart` er skønnet ved start af rytterens næste
 * etape, eller null uden en etape i dag eller i morgen.
 *
 * Næste etape i dag: datoens kørte etaper ligger alle før den, så skønnet er tallet lige nu.
 * Næste etape i morgen: aftenens opgørelse (samme prognose som "Træthed i aften", I5), for
 * rytterens første etape i morgen har ingen etaper før sig på datoen.
 */
export async function fatigueOutlookForTeam({ supabase, team, seasonId, conditions, abilityByRider = null, now = new Date() }) {
  if (!(conditions ?? []).length) return null;
  const enabled = await isFatigueNow7801Enabled(supabase);
  const instant = await loadInstantConditions({ supabase, riderIds: conditions.map(c => c.rider_id), tickDate: copenhagenDateString(now), failOpenWhenOff: true });
  if (!enabled && !instant.size) return null;
  const legacy = conditions.filter(c => !instant.has(c.rider_id));
  let fatigueNow = new Map();
  if (enabled) {
    try {
      fatigueNow = await fatigueByRiderNow({ supabase, conditions: legacy, abilityByRider, teamId: team?.id ?? null, now, onError: "throw" });
    } catch (err) {
      if (!(err instanceof FatigueNowUnavailableError)) throw err;
      // Tallet kunne ikke regnes: fladen viser "—" (null), ikke morgenens tal.
      console.warn(`[fatigue-now-7801] training fatigue omitted: ${err.message}`);
      fatigueNow = new Map(legacy.map((c) => [c.rider_id, null]));
    }
  }
  for (const [id, condition] of instant) fatigueNow.set(id, condition.fatigue);
  const out = new Map([...fatigueNow].map(([id, fatigue]) => [id, { fatigue, ...instant.get(id), fatigueAtStart: null }]));
  try {
    const next = await loadNextStageByRider({ supabase, riderIds: [...out.keys()], seasonId, now });
    const today = copenhagenDateString(now);
    let tonight = null;
    if ([...next.values()].some((n) => n.tickDate !== today)) {
      // Dynamisk import: prognosen importerer motorens raceFatigue.js, som importerer dette modul.
      const { loadTeamFatigueForecast } = await import("./trainingWeekPlanForecast.js");
      tonight = await loadTeamFatigueForecast({ supabase, team, seasonId, now });
    }
    for (const [id, n] of next) {
      const row = out.get(id);
      if (!row || instant.incompleteRiderIds.has(id)) continue;
      // Codex P2 (#8054): ukendt træthed lige nu (null, "—") giver også et ukendt skøn ved
      // start. Number(null) er 0, så tallet må ikke tvinges gennem Number() først.
      if (!isKnownFatigue(row.fatigue)) continue;
      if (n.tickDate === today) row.fatigueAtStart = Number(row.fatigue);
      else if (tonight?.available) row.fatigueAtStart = tonight.riders?.[id]?.fatigue ?? null;
    }
  } catch (err) {
    if (err instanceof InstantConditionEvidenceError) throw err;
    // best-effort: uden skøn viser fladen kun tallet lige nu.
    console.warn(`[fatigue-now-7801] stage-start estimate omitted: ${err.message}`);
  }
  return out;
}
