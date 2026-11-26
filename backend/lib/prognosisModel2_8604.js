// #8604 Del 2 · Model 2 for prognosen: "hvor ender han ved toppen, hvis han træner som nu?"
//
// Ejerens valg 24/11 (model 2) og designet "Model 2 til ny designdom" 24/11:
//   - Én afrundet prognose fra første dag. En ny rytters manglende historik forsinker
//     ikke tallet: datoer uden facit simuleres med holdets plan for rytteren.
//   - Simuleringen bruger motorens egne XP-grene: træningsgrenen (standardCareerShares,
//     samme fordeling som motorens tick) og løbsgrenen (developmentXpAbilityDelta med
//     løbsdagens program), motorens pointkøb (buyPoints), aldersandel, sæsonskiftets
//     tilbagegang (developRiderSeasonV2) og samme aldringsregel som skiftet.
//   - En endelig, afregnet dato erstatter én simuleret dato i rytterens mix. Intervallet
//     snævrer ind, efterhånden som flere af mixets datoer er faktiske.
//   - Skønnet manageren ser, kalibrerer referencekarrieren: holdets synlige potentiale er
//     forventet toprating, så kørslen finder det optjeningsinput, der fører standard-
//     karrieren fra rytterens nuværende evner op til netop det skøn. Rytterens skjulte
//     potentiale læses aldrig. Prognosen ligger aldrig over skønnet eller under ratingen nu.
//   - Kalibrering, optjening og mix bliver på serveren. Kun det afrundede tal og det
//     afrundede interval forlader den, via ruterne.
//   - Batchen kører uden for anmodningen og publicerer idempotent pr. (rytter, hold):
//     samme input giver samme hash, og så skrives intet.
//
// Bag kontakten prognosis_model2 (app_config, seedet "off"). Slukket læses tabellen
// aldrig, og prognosen er præcis den nuværende.
//
// Hard rule 17: konstanterne her er runtime-værdier; målinger og begrundelser med tal
// ligger privat (OneDrive-handoff 8604-prognose).

import { createHash } from "node:crypto";

import {
  buyPoints, developmentXpAbilityDelta, xpPerDate,
} from "./developmentXp.ts";
import {
  STANDARD_CAREER, expectedTopRating, standardCareerRotation, standardCareerShares,
} from "./developmentXpExpectedTop.ts";
import { applyTrainingCatalog, isTrainingCatalogV3EnabledForTeam, v3SmartDefaultFocus } from "./trainingCatalogV3.js";
import { resolveProgram } from "./dailyTraining.js";
import { RACE_DAY_FALLBACK_PROFILE, raceDayProgram } from "./raceDayYield.js";
import { PROGRAM_SLOTS, programForSession, resolveDayProgram, sessionForDayEntry, weekDaysHaveSessions } from "./trainingPrograms.js";
import { WEEKDAY_KEYS, isValidIntensity } from "./training.js";
import { loadRotationPlans, loadRotationReceipts, rotationProgram } from "./trainingRotationProgress.js";
import { isTrainingCellsEnabledForTeam } from "./trainingWeekPlanCellsFlag.js";
import { isTrainingEffortLevelsEnabled } from "./trainingEffortLevels.js";
import { buildRaceDayStageByRider } from "./raceDayStageLookup.js";
import { developRiderSeasonV2, xpAgingConfig } from "./riderProgression.js";
import { REGISTRY_ABILITY_KEYS, abilityMeta } from "./abilityRegistry.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";
import { abilityValue } from "./weights/displayRecipes.js";
import { publicEstimateView } from "./potentialEstimate.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import { privateConfigHash } from "./privateConfig.ts";
import { loadEstimateDevelopmentXp, loadEstimateTeamIds } from "./potentialEstimateWriter.js";

export const PROGNOSIS_MODEL2_FLAG_KEY = "prognosis_model2";
export const PROGNOSIS_MODEL2_TABLE = "rider_prognosis_model2";
// Hæves ved enhver ændring af beregningen: hashen ændrer sig, og alle rækker skrives om.
// v2 (#8810): motorens planopløsning, etapens profil, uafgjorte felter og datoer på tværs af sæsoner.
export const PROGNOSIS_MODEL2_VERSION = "8604-m2-v2";

// Mixets længde i datoer. Ejerens 14 dage (24/11): efter så mange faktiske datoer er hele
// mixet rytterens eget, og intervallet er så smalt, som modellen tillader.
export const MODEL2_WINDOW_DATES = 14;
// Halv bredde af intervallet i ratingpoint uden faktiske datoer og med et helt faktisk mix.
export const MODEL2_BAND_HALF_START = 6;
export const MODEL2_BAND_HALF_FULL = 2;
// Hvor langt tilbage batchen læser afregnede felter.
export const MODEL2_LOOKBACK_DAYS = 28;
// Den daglige fulde kørsel starter fra denne time (Europe/Copenhagen), efter nattens afregning.
export const MODEL2_DAILY_FROM_HOUR = 5;

const MENTAL = new Set(VISIBLE_ABILITIES.filter((ability) => abilityMeta(ability)?.category === "mental"));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function isPrognosisModel2Enabled(supabase) {
  return evaluateFlagStage(await readFlagStage(supabase, PROGNOSIS_MODEL2_FLAG_KEY));
}

// ── Mixet: programmer pr. dato ───────────────────────────────────────────────────

// Én dato i mixet er evnernes andel af datoens XP: summen over datoens felter, vægtet så
// datoen tæller som én dato, uanset hvor mange felter den havde.
function addShares(into, shares, weight) {
  for (const [ability, share] of Object.entries(shares)) {
    if (share > 0) into[ability] = (into[ability] ?? 0) + share * weight;
  }
  return into;
}

// Løbsgrenen: motorens XP for løbsdagens program som andel af rytterens XP på en hård dato.
// Programmet bygges af etapens profil, som i motoren (raceDayProgram med rytterens etape);
// en ukendt profil falder til motorens egen fallback. Andelen afhænger ikke af potentiale
// eller alder (begge ganges på i xpPerDate), så den regnes med et neutralt input.
function raceShares(profileType, primaryType, secondaryType, params) {
  const program = raceDayProgram(profileType ?? RACE_DAY_FALLBACK_PROFILE);
  const out = {};
  for (const ability of VISIBLE_ABILITIES) {
    const mental = MENTAL.has(ability);
    const unit = xpPerDate({ potentiale: null, age: null, mental }, params);
    if (!(unit > 0)) continue;
    const xp = developmentXpAbilityDelta({ ability, age: null, potentiale: null, program, primaryType, secondaryType }, params);
    if (xp > 0) out[ability] = xp / unit;
  }
  return out;
}

// Motorens mærke for et løbsfelt, hvis løb endnu ikke er afgjort: ingen udvikling på feltet.
export const UNKNOWN_PENDING = "unknown_pending";

/** Et felt, motoren endnu ikke har afregnet (dets løb mangler sit facit). */
export function isUnsettledSlot(slot) {
  return slot?.intensity === UNKNOWN_PENDING || slot?.status === UNKNOWN_PENDING;
}

export function isRaceSlot(slot) {
  return slot?.race_day === true || slot?.race_day === "true" || slot?.intensity === "race";
}

/**
 * Ét afregnet felt som evneandele. Hvile og et uafgjort felt giver intet; ukendt fokus giver
 * kun det, kataloget kender. Et løbsfelt bruger etapens profil (`profile_type`, sat af batchen).
 */
export function slotShares(slot, { primaryType, secondaryType }, params, { catalogV3 = true } = {}) {
  if (isUnsettledSlot(slot)) return {};
  if (isRaceSlot(slot)) return raceShares(slot.profile_type ?? null, primaryType, secondaryType, params);
  if (!slot?.intensity || slot.intensity === "rest" || !slot.focus) return {};
  const program = applyTrainingCatalog({ focus: slot.focus, intensity: slot.intensity }, { v3: catalogV3 });
  return standardCareerShares(primaryType, secondaryType, params, program);
}

/**
 * De faktiske datoer, nyeste sidst. Én dato = alle datoens felter (unikke pr. sæson og løbsdag,
 * så en gentaget levering af samme felt aldrig tæller to gange, og datoer fra forrige sæson på
 * holdet bevares). Kun datoer før `today`: dagens dato er endnu åben. En dato med et uafgjort
 * felt er ikke endelig: den tæller ikke som faktisk og bliver simuleret, til motoren har afregnet.
 */
export function observedDateEntries(slots, rider, params, { today, window = MODEL2_WINDOW_DATES, catalogV3 = true } = {}) {
  const bySlot = new Map();
  for (const slot of slots ?? []) {
    if (!slot?.tick_date || (today && slot.tick_date >= today)) continue;
    bySlot.set(`${slot.season_id ?? ""}:${slot.game_day ?? slot.tick_date}`, slot);
  }
  const byDate = new Map();
  for (const slot of bySlot.values()) {
    if (!byDate.has(slot.tick_date)) byDate.set(slot.tick_date, []);
    byDate.get(slot.tick_date).push(slot);
  }
  const settled = [...byDate.keys()].filter((date) => !byDate.get(date).some(isUnsettledSlot));
  const dates = settled.sort().slice(-window);
  return dates.map((date) => {
    const daySlots = byDate.get(date);
    const entry = {};
    for (const slot of daySlots) addShares(entry, slotShares(slot, rider, params, { catalogV3 }), 1 / daySlots.length);
    return entry;
  });
}

// Kontakterne, motoren læser for holdet, når den opløser dagens program. Uden kontekst: det
// katalog, der er live, og ingen programceller eller indsatsniveauer (motorens slukkede sti).
export const DEFAULT_TRAINING_SWITCHES = Object.freeze({ programsOn: false, catalogV3: true, effortLevels: false });

// Datoens andele som gennemsnittet af dens felter. Ens felter regnes én gang, så en dato med ét
// program er præcis det programs andele.
function dateSharesFromPrograms(programs, primaryType, secondaryType, params) {
  const groups = new Map();
  for (const program of programs) {
    const key = JSON.stringify([program.focus, program.intensity, program.focusAbilities ?? null, program.focusWeights ?? null]);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { program, count: 1 });
  }
  if (groups.size === 1) return standardCareerShares(primaryType, secondaryType, params, programs[0]);
  const out = {};
  for (const { program, count } of groups.values()) {
    addShares(out, standardCareerShares(primaryType, secondaryType, params, program), count / programs.length);
  }
  return out;
}

// Ugens dage fra `startWeekday`, så de simulerede datoer følger kalenderen fra i dag.
function weekdaysFrom(startWeekday) {
  const start = Math.max(0, WEEKDAY_KEYS.indexOf(startWeekday));
  return WEEKDAY_KEYS.map((_, i) => WEEKDAY_KEYS[(start + i) % WEEKDAY_KEYS.length]);
}

// Bærer ugeplanen noget for ugedagene: en intensitet eller (med programceller) en session.
function weekDaysConfigured(days, programsOn) {
  if (!days || typeof days !== "object") return false;
  if (programsOn && weekDaysHaveSessions(days)) return true;
  return WEEKDAY_KEYS.some((weekday) => isValidIntensity(days[weekday]?.intensity));
}

/**
 * Ét felts program på en ugedag, opløst som i motoren (dailyTrainingEngine.js): rytterens plan
 * (resolveProgram), assistentens fokus uden egen plan (v3SmartDefaultFocus), ugeplanens lag
 * (resolveDayProgram: rytterens egen række, hans plan, holdets række) og holdets katalog.
 */
function weekdaySlotProgram({ weekday, slotIndex, plan, primaryType, secondaryType, riderDays, teamDays, switches }) {
  const program = resolveProgram(plan, primaryType);
  const hasExplicitPlan = Boolean(plan?.focus && plan?.intensity);
  if (!hasExplicitPlan) {
    program.focus = v3SmartDefaultFocus(program.focus, { primary_type: primaryType, secondary_type: secondaryType }, { v3: switches.catalogV3 });
  }
  const day = resolveDayProgram({
    weekday, slotIndex, riderOverrideDays: riderDays ?? null, teamWeekDays: teamDays ?? null, program, hasExplicitPlan,
    programsOn: switches.programsOn, catalogV3: switches.catalogV3, effortLevels: switches.effortLevels,
  });
  if (day.source === "program") program.focus = day.focus;
  program.intensity = day.intensity;
  return program;
}

/**
 * Holdets plan for rytteren som datoer, opløst med motorens egen planopløsning:
 *   - en rotation (training_week_plans, plan_kind 'rotation'): passene i rækkefølge fra rytterens
 *     plads (rotationProgram), et pas pr. felt, så hvert pas tæller lige meget over en hel omgang;
 *   - ellers ugeplanen (rytterens egen række, hans gemte plan, holdets række) dag for dag og felt
 *     for felt via resolveDayProgram;
 *   - uden nogen plan er det assistentens roterende plan for typen (samme som standardkarrieren).
 * `context`: { riderDays, teamDays, switches, rotation, rotationReceipts, startWeekday }.
 */
export function plannedDateEntries(plan, { primaryType, secondaryType }, params, context = {}) {
  const switches = { ...DEFAULT_TRAINING_SWITCHES, ...(context.switches ?? {}) };
  const { riderDays = null, teamDays = null, rotation = null, rotationReceipts = null } = context;
  const hasExplicitPlan = Boolean(plan?.focus && plan?.intensity);
  const weekdays = weekdaysFrom(context.startWeekday);
  const slotProgram = (weekday, slotIndex) => weekdaySlotProgram({
    weekday, slotIndex, plan, primaryType, secondaryType, riderDays, teamDays, switches,
  });
  const finish = (program) => applyTrainingCatalog(program, { v3: switches.catalogV3 });

  if (rotation) {
    const first = rotationProgram({
      rotation, receipts: rotationReceipts ?? [], dateReceipts: [], previousFocus: resolveProgram(plan, primaryType).focus,
      catalogV3: switches.catalogV3, effortLevels: switches.effortLevels,
    });
    if (first) {
      const length = rotation.passes.length;
      return Array.from({ length }, (_, d) => {
        const weekday = weekdays[d % weekdays.length];
        const programs = Array.from({ length: PROGRAM_SLOTS }, (_, slotIndex) => {
          const fallback = slotProgram(weekday, slotIndex);
          const pass = rotation.passes[(first.index + d * PROGRAM_SLOTS + slotIndex) % length];
          const chosen = programForSession(pass.session, fallback.focus, {
            catalogV3: switches.catalogV3, effortLevels: switches.effortLevels, effort: pass.effort,
          });
          // Som motoren: et pas, der ikke kan køres, efterlader dagens program.
          return finish(chosen?.ok ? { ...fallback, focus: chosen.focus, intensity: chosen.intensity } : fallback);
        });
        return dateSharesFromPrograms(programs, primaryType, secondaryType, params);
      });
    }
  }

  const configured = hasExplicitPlan || weekDaysConfigured(riderDays, switches.programsOn) || weekDaysConfigured(teamDays, switches.programsOn);
  if (!configured) {
    return standardCareerRotation(primaryType).map((program) => standardCareerShares(primaryType, secondaryType, params, program));
  }
  const dates = weekdays.map((weekday) => dateSharesFromPrograms(
    Array.from({ length: PROGRAM_SLOTS }, (_, slotIndex) => finish(slotProgram(weekday, slotIndex))),
    primaryType, secondaryType, params,
  ));
  // En plan, der er ens alle ugens dage, er én dato (samme mix som en gentaget plan).
  const keys = new Set(dates.map((entry) => JSON.stringify(entry)));
  return keys.size === 1 ? [dates[0]] : dates;
}

/**
 * Mixet: de faktiske datoer erstatter simulerede datoer én for én. Med n faktiske datoer er
 * resten af vinduet holdets plan. Uden plan og uden facit er det standardkarrieren.
 */
export function blendMix(observed, planned, window = MODEL2_WINDOW_DATES) {
  const actual = (observed ?? []).slice(-window);
  const fill = window - actual.length;
  const plan = planned?.length ? planned : [{}];
  const simulated = Array.from({ length: Math.max(0, fill) }, (_, i) => plan[i % plan.length]);
  return [...simulated, ...actual];
}

// ── Karrieren ────────────────────────────────────────────────────────────────────

function ratingOf(abilities, primaryType, secondaryType) {
  const { best_role_rating: rating } = bestRoleForAbilities(abilities, { primaryType, secondaryType });
  return isNum(rating) ? rating : null;
}

/**
 * Karrieren fra rytterens evner og bjælker nu med et mix af datoer. Samme løkke som
 * expectedCareer (developmentXpExpectedTop.ts): XP pr. dato efter alder, motorens pointkøb,
 * sæsonskiftets tilbagegang og topniveauet langs vejen. Med standardrotationen og tomme
 * bjælker er svaret bit for bit expectedCareer (test). Deterministisk.
 */
export function simulateMixCareer(rider, dates, params, career = STANDARD_CAREER) {
  if (!rider?.abilities || !isNum(rider.age) || !dates?.length) return null;
  const age = Math.round(rider.age);
  const primaryType = rider.primaryType ?? null;
  const secondaryType = rider.secondaryType ?? null;
  let state = {};
  for (const ability of VISIBLE_ABILITIES) {
    const value = abilityValue(rider.abilities[ability]);
    if (value !== null) state[ability] = value;
  }
  if (!Object.keys(state).length) return null;
  const ratingNow = ratingOf(state, primaryType, secondaryType);
  if (ratingNow == null) return null;
  const bars = {};
  for (const [ability, bar] of Object.entries(rider.bars ?? {})) {
    const n = Number(bar);
    if (Number.isFinite(n) && n > 0 && ability in state) bars[ability] = n;
  }
  const entries = dates.map((entry) => Object.entries(entry));
  let top = ratingNow;
  let topAge = age;
  const agingCfg = xpAgingConfig(params);
  for (let a = age; a <= career.endAge; a++) {
    const physical = xpPerDate({ potentiale: rider.potentiale, age: a }, params);
    const mental = xpPerDate({ potentiale: rider.potentiale, age: a, mental: true }, params);
    for (let d = 0; d < career.datesPerSeason; d++) {
      for (const [ability, share] of entries[d % entries.length]) {
        const level = state[ability];
        if (!isNum(level)) continue;
        const out = buyPoints({ level, bar: bars[ability] ?? 0, xp: (MENTAL.has(ability) ? mental : physical) * share }, params);
        bars[ability] = out.bar;
        state[ability] = out.level;
      }
    }
    const rating = ratingOf(state, primaryType, secondaryType);
    if (rating != null && rating > top) {
      top = rating;
      topAge = a;
    }
    const dev = developRiderSeasonV2(
      { id: rider.id, primary_type: primaryType, potentiale: rider.potentiale, age: a + 1 },
      state, a, agingCfg ? { load: career.declineLoad, cfg: agingCfg } : { load: career.declineLoad },
    );
    state = { ...state, ...dev.next };
  }
  return { rating: top, ratingNow, atAge: topAge };
}

/** Optjeningsinputtets mulige værdier: talfilens kurve fra bund til top. */
function proxyDomain(params) {
  const points = params.potentialXp ?? [];
  const lo = Math.min(...points.map((p) => p.at));
  const hi = Math.max(...points.map((p) => p.at));
  return Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi ? { lo, hi } : null;
}

// Fast antal halveringer, så søgningen er deterministisk og har samme pris for alle ryttere.
export const MODEL2_CALIBRATION_STEPS = 18;

/**
 * Invers kalibrering: det optjeningsinput, der fører standardkarrieren fra rytterens evner
 * nu til skønnet manageren ser. Topniveauet stiger aldrig, når inputtet falder, så en fast
 * halvering finder det mindste input, der når skønnet. Uden for kurvens dækning bruges
 * nærmeste ende. Skjult potentiale indgår ikke. null uden evner eller alder.
 */
export function calibrateEarningProxy(rider, estimate, params, career = STANDARD_CAREER) {
  const domain = proxyDomain(params);
  if (!domain || !isNum(estimate)) return null;
  const topAt = (p) => expectedTopRating({ ...rider, potentiale: p, ceiling: null }, params, career);
  const hiTop = topAt(domain.hi);
  if (hiTop == null) return null;
  if (hiTop < estimate) return domain.hi;
  if (topAt(domain.lo) >= estimate) return domain.lo;
  let lo = domain.lo;
  let hi = domain.hi;
  for (let step = 0; step < MODEL2_CALIBRATION_STEPS; step++) {
    const mid = (lo + hi) / 2;
    if (topAt(mid) >= estimate) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Intervallets halve bredde: snævrer ind for hver faktisk dato, bliver aldrig bredere. */
export function bandHalfWidth(observedDates, window = MODEL2_WINDOW_DATES) {
  const n = Math.max(0, Math.min(window, Math.floor(Number(observedDates) || 0)));
  const half = MODEL2_BAND_HALF_START - (MODEL2_BAND_HALF_START - MODEL2_BAND_HALF_FULL) * (n / window);
  return Math.round(half);
}

/**
 * Model 2 for én rytter. Ren funktion.
 *   rider     { id, abilities, bars, age, primaryType, secondaryType }
 *   estimate  holdets synlige skøn (tallet manageren ser), eller null
 *   observed  datoer fra observedDateEntries, planned fra plannedDateEntries
 * Returnerer { value, lo, hi, observedDates } eller null, når der intet er at fremskrive.
 */
export function computeModel2Prognosis({ rider, estimate, observed = [], planned = null }, params, career = STANDARD_CAREER) {
  if (!rider || !isNum(estimate)) return null;
  const proxy = calibrateEarningProxy({ ...rider, bars: undefined }, estimate, params, career);
  if (proxy == null) return null;
  const plan = planned ?? plannedDateEntries(null, rider, params);
  const mix = blendMix(observed, plan);
  const result = simulateMixCareer({ ...rider, potentiale: proxy }, mix, params, career);
  if (!result) return null;
  const nowRating = Math.max(1, Math.round(result.ratingNow));
  const ceiling = Math.max(nowRating, Math.round(estimate));
  const value = Math.max(nowRating, Math.min(ceiling, Math.round(result.rating)));
  const observedDates = Math.min(MODEL2_WINDOW_DATES, observed.length);
  const half = bandHalfWidth(observedDates);
  const lo = Math.max(nowRating, Math.min(value, value - half));
  const hi = Math.min(ceiling, Math.max(value, value + half));
  return { value: Math.min(99, value), lo: Math.max(1, lo), hi: Math.min(99, hi), observedDates };
}

// ── Batch: forbered prognoserne uden for anmodningen ─────────────────────────────

const ABILITY_COLUMNS = `rider_id, ability_progress, ${REGISTRY_ABILITY_KEYS.join(", ")}`;

function inputHash(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function isoMinusDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

export const raceSlotKey = (riderId, seasonId, gameDay) => `${riderId}:${seasonId}:${Number(gameDay)}`;

/**
 * Ren sammenkobling: (rytter, sæson, løbsdag) → etapens profil. Pr. sæson og løbsdag samme regel
 * som motorens buildRaceDayStageByRider: etaperesultater og endagsløbets GC, aldrig tour-GC.
 */
export function raceProfilesBySlot({ races = [], schedule = [], results = [], profileRows = [] }) {
  const raceById = new Map(races.map((race) => [race.id, race]));
  const single = new Set(races.filter((race) => race.race_type === "single").map((race) => race.id));
  const counted = results.filter((row) => row.result_type === "stage" || (row.result_type === "gc" && single.has(row.race_id)));
  const groups = new Map();
  for (const row of schedule) {
    const seasonId = raceById.get(row.race_id)?.season_id;
    if (!seasonId) continue;
    const key = `${seasonId}:${Number(row.game_day)}`;
    if (!groups.has(key)) groups.set(key, { seasonId, gameDay: Number(row.game_day), rows: [] });
    groups.get(key).rows.push(row);
  }
  const out = new Map();
  for (const { seasonId, gameDay, rows } of groups.values()) {
    const raceIds = new Set(rows.map((row) => row.race_id));
    const stages = buildRaceDayStageByRider({
      scheduleRows: rows,
      resultRows: counted.filter((row) => raceIds.has(row.race_id)),
      profileRows: profileRows.filter((row) => raceIds.has(row.race_id)),
    });
    for (const [riderId, stage] of stages) out.set(raceSlotKey(riderId, seasonId, gameDay), stage.profileType ?? RACE_DAY_FALLBACK_PROFILE);
  }
  return out;
}

/** Standard-I/O mod Supabase. Testene giver deres egen. */
export function supabaseModel2Io(supabase) {
  return {
    async activeSeason() {
      const { data, error } = await supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle();
      if (error) throw new Error(`seasons: ${error.message}`);
      return data ?? null;
    },
    teamIds: () => loadEstimateTeamIds(supabase),
    riders: (teamId) => fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, birthdate, primary_type, secondary_type, best_role_rating, is_retired")
      .eq("team_id", teamId).order("id")),
    estimates: (teamId) => fetchAllRows(() => supabase.from("rider_potential_estimates")
      .select("rider_id, value, certainty, previous_value, previous_certainty, changed_at").eq("team_id", teamId).order("rider_id")),
    abilities: (riderIds) => fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_abilities")
      .select(ABILITY_COLUMNS).in("rider_id", chunk).order("rider_id")),
    plans: (teamId, seasonId) => fetchAllRows(() => supabase.from("training_plans")
      .select("rider_id, focus, intensity").eq("team_id", teamId).eq("season_id", seasonId).order("rider_id")),
    // Sæsonen nu og den før: vinduet kan gå hen over sæsonskiftet.
    async seasonIds(season) {
      const number = Number(season.number);
      const { data, error } = await supabase.from("seasons").select("id, number").in("number", [number - 1, number]);
      if (error) throw new Error(`seasons: ${error.message}`);
      return [...new Set([season.id, ...(data ?? []).map((row) => row.id)])];
    },
    // Kun de felter mixet bruger, ikke hele rapporten (indekset team_id, season_id, tick_date).
    // Holdets kvitteringer på tværs af sæsonerne i vinduet: samme hold, så forrige sæsons datoer bevares.
    slots: (teamId, seasonIds, since, today) => fetchAllRows(() => supabase.from("training_rider_ticks")
      .select("rider_id, season_id, game_day, tick_date, focus:report->>focus, intensity:report->>intensity, race_day:report->>race_day, status:report->>status")
      .eq("team_id", teamId).in("season_id", seasonIds).gte("tick_date", since).lt("tick_date", today)
      .order("rider_id").order("tick_date").order("game_day")),
    // Samme rækker som motoren læser: holdets række (rider_id NULL) og rytternes egne.
    weekPlans: (teamId) => fetchAllRows(() => supabase.from("training_week_plans")
      .select("rider_id, days, plan_kind").eq("team_id", teamId).order("rider_id")),
    // Samme kontakter som motoren, læst for holdet. Programceller kun, når en række bærer sessioner.
    async trainingSwitches(teamId, weekRows) {
      const [programsOn, catalogV3, effortLevels] = await Promise.all([
        weekRows.some((row) => weekDaysHaveSessions(row.days)) ? isTrainingCellsEnabledForTeam(supabase, teamId) : false,
        isTrainingCatalogV3EnabledForTeam(supabase, teamId),
        isTrainingEffortLevelsEnabled(supabase),
      ]);
      return { programsOn, catalogV3, effortLevels };
    },
    // Rotationerne og rytternes plads i dem, med motorens egne indlæsere.
    async rotations({ teamId, weekRows, riderIds, plans, today }) {
      const byRider = await loadRotationPlans({ supabase, teamId, weekRows, riderIds, plans });
      const receipts = await loadRotationReceipts({ supabase, teamId, tickDate: today, rotationByRider: byRider });
      return { byRider, receipts };
    },
    // Etapens profil for hvert løbsfelt: samme sammenkobling som motorens løbsdagsopslag
    // (race_results ⋈ race_stage_schedule på løbsdagen, scopet til feltets sæson).
    async raceProfiles({ riderIds, slots }) {
      const seasonIds = [...new Set(slots.map((slot) => slot.season_id).filter(Boolean))];
      const gameDays = [...new Set(slots.map((slot) => Number(slot.game_day)).filter(Number.isFinite))];
      if (!seasonIds.length || !gameDays.length || !riderIds.length) return new Map();
      const races = await fetchAllRows(() => supabase.from("races")
        .select("id, season_id, race_type").in("season_id", seasonIds).order("id"));
      if (!races.length) return new Map();
      const schedule = await fetchAllRowsChunkedIn(races.map((race) => race.id), (chunk) => supabase.from("race_stage_schedule")
        .select("race_id, stage_number, game_day").in("race_id", chunk).in("game_day", gameDays).order("race_id").order("stage_number"));
      const raceIdsOnDays = [...new Set(schedule.map((row) => row.race_id))];
      if (!raceIdsOnDays.length) return new Map();
      const results = await fetchAllRowsChunkedIn(raceIdsOnDays, (chunk) => supabase.from("race_results")
        .select("rider_id, race_id, stage_number, result_type").in("result_type", ["stage", "gc"])
        .in("race_id", chunk).in("rider_id", riderIds).order("race_id").order("rider_id").order("stage_number"));
      const ridden = [...new Set(results.map((row) => row.race_id))];
      const profileRows = ridden.length ? await fetchAllRowsChunkedIn(ridden, (chunk) => supabase.from("race_stage_profiles")
        .select("race_id, stage_number, profile_type").in("race_id", chunk).order("race_id").order("stage_number")) : [];
      return raceProfilesBySlot({ races, schedule, results, profileRows });
    },
    published: (teamId) => fetchAllRows(() => supabase.from(PROGNOSIS_MODEL2_TABLE)
      .select("rider_id, input_hash").eq("team_id", teamId).order("rider_id")),
    async upsert(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(PROGNOSIS_MODEL2_TABLE).upsert(rows.slice(i, i + 500), { onConflict: "rider_id,team_id" });
        if (error) throw new Error(`${PROGNOSIS_MODEL2_TABLE} upsert: ${error.message}`);
      }
    },
    async remove(teamId, riderIds) {
      if (!riderIds.length) return;
      const { error } = await supabase.from(PROGNOSIS_MODEL2_TABLE).delete().eq("team_id", teamId).in("rider_id", riderIds);
      if (error) throw new Error(`${PROGNOSIS_MODEL2_TABLE} delete: ${error.message}`);
    },
  };
}

/**
 * Forbered prognoserne for ét hold. Ren beregning oven på io; returnerer tællingen.
 * `onlyMissing`: kun ryttere uden en publiceret række (timekørslen for nye ryttere).
 */
export async function prepareTeamModel2({ io, teamId, season, params, today, now, onlyMissing = false }) {
  const riders = (await io.riders(teamId)).filter((rider) => rider.is_retired !== true);
  const published = new Map((await io.published(teamId)).map((row) => [row.rider_id, row.input_hash]));
  const gone = [...published.keys()].filter((id) => !riders.some((rider) => rider.id === id));
  const wanted = onlyMissing ? riders.filter((rider) => !published.has(rider.id)) : riders;
  const counts = { riders: wanted.length, written: 0, unchanged: 0, skipped: 0, removed: gone.length };
  if (!onlyMissing) await io.remove(teamId, gone);
  if (!wanted.length) return counts;
  const ids = wanted.map((rider) => rider.id);
  const seasonIds = await io.seasonIds(season);
  const [estimates, abilityRows, plans, slots, weekRows] = await Promise.all([
    io.estimates(teamId), io.abilities(ids), io.plans(teamId, season.id),
    io.slots(teamId, seasonIds, isoMinusDays(today, MODEL2_LOOKBACK_DAYS), today),
    io.weekPlans(teamId),
  ]);
  const wantedIds = new Set(ids);
  const ownSlots = slots.filter((slot) => wantedIds.has(slot.rider_id));
  const raceSlots = ownSlots.filter((slot) => isRaceSlot(slot) && !isUnsettledSlot(slot));
  const [switches, rotations, profiles] = await Promise.all([
    io.trainingSwitches(teamId, weekRows),
    io.rotations({ teamId, weekRows, riderIds: ids, plans, today }),
    raceSlots.length ? io.raceProfiles({ riderIds: [...new Set(raceSlots.map((slot) => slot.rider_id))], slots: raceSlots }) : new Map(),
  ]);
  const estimateBy = new Map(estimates.map((row) => [row.rider_id, row]));
  const abilitiesBy = new Map(abilityRows.map((row) => [row.rider_id, row]));
  const planBy = new Map(plans.map((row) => [row.rider_id, row]));
  const teamDays = weekRows.find((row) => row.rider_id == null)?.days ?? null;
  const riderDaysBy = new Map(weekRows.filter((row) => row.rider_id != null).map((row) => [row.rider_id, row.days]));
  const startWeekday = copenhagenWeekdayKey(today);
  const slotsBy = new Map();
  for (const slot of ownSlots) {
    const withProfile = isRaceSlot(slot) ? { ...slot, profile_type: profiles.get(raceSlotKey(slot.rider_id, slot.season_id, slot.game_day)) ?? null } : slot;
    if (!slotsBy.has(slot.rider_id)) slotsBy.set(slot.rider_id, []);
    slotsBy.get(slot.rider_id).push(withProfile);
  }
  const paramsVersion = privateConfigHash(params);
  const rows = [];
  for (const rider of wanted) {
    const abilities = abilitiesBy.get(rider.id);
    const types = { primaryType: rider.primary_type ?? null, secondaryType: rider.secondary_type ?? null };
    const age = ageForSeason(rider.birthdate, Number(season.number));
    const ratingNow = abilities ? ratingOf(abilities, types.primaryType, types.secondaryType) : null;
    const view = publicEstimateView(estimateBy.get(rider.id), { currentRating: ratingNow ?? rider.best_role_rating });
    if (!abilities || age == null || view.hidden) { counts.skipped += 1; continue; }
    const plan = planBy.get(rider.id) ?? null;
    const visible = Object.fromEntries(VISIBLE_ABILITIES.map((ability) => [ability, abilities[ability] ?? null]));
    // Hashen dækker præcis det, beregningen bruger: de opløste datoer, ikke de rå rækker.
    const observed = observedDateEntries(slotsBy.get(rider.id) ?? [], types, params, { today, catalogV3: switches.catalogV3 });
    const planned = plannedDateEntries(plan, types, params, {
      riderDays: riderDaysBy.get(rider.id) ?? null, teamDays, switches, startWeekday,
      rotation: rotations.byRider.get(rider.id) ?? null, rotationReceipts: rotations.receipts.get(rider.id) ?? null,
    });
    const hash = inputHash([
      PROGNOSIS_MODEL2_VERSION, paramsVersion, rider.id, teamId, age, types, view.value, visible,
      abilities.ability_progress ?? null, observed, planned,
    ]);
    if (published.get(rider.id) === hash) { counts.unchanged += 1; continue; }
    const riderInput = { id: rider.id, abilities: visible, bars: abilities.ability_progress ?? null, age, ...types };
    const result = computeModel2Prognosis({ rider: riderInput, estimate: view.value, observed, planned }, params);
    // En rytters karriere er ren CPU: giv event-loopet fri mellem rytterne, så batchen aldrig
    // holder anmodninger hen.
    await new Promise((resolve) => setImmediate(resolve));
    if (!result) { counts.skipped += 1; continue; }
    rows.push({
      rider_id: rider.id, team_id: teamId, value: result.value, band_lo: result.lo, band_hi: result.hi,
      observed_dates: result.observedDates, model_version: PROGNOSIS_MODEL2_VERSION, input_hash: hash, computed_at: now.toISOString(),
    });
  }
  await io.upsert(rows);
  counts.written = rows.length;
  return counts;
}

const processState = { fullRunDate: null };

/**
 * Batchen. Daglig fuld kørsel fra MODEL2_DAILY_FROM_HOUR, ellers kun ryttere uden række, så
 * en ny rytter får sin prognose inden for en time. Kontakt slukket = intet læses ud over
 * kontakten. Ét hold, der fejler, vælter ikke resten.
 */
export async function runPrognosisModel2Batch({ supabase, now = new Date(), io = null, state = processState, log = console }) {
  if (!(await isPrognosisModel2Enabled(supabase))) return { ran: false, skipped: "flag_off" };
  const params = await loadEstimateDevelopmentXp(supabase, { now, log });
  if (!params) return { ran: false, skipped: "xp_off" };
  const dataIo = io ?? supabaseModel2Io(supabase);
  const season = await dataIo.activeSeason();
  if (!season?.id || !Number.isFinite(Number(season.number))) return { ran: false, skipped: "no_season" };
  const today = copenhagenDateString(now);
  const full = state.fullRunDate !== today && copenhagenHour(now) >= MODEL2_DAILY_FROM_HOUR;
  const totals = { teams: 0, riders: 0, written: 0, unchanged: 0, skipped: 0, removed: 0 };
  let failedTeams = 0;
  let firstError = null;
  for (const teamId of await dataIo.teamIds()) {
    try {
      const counts = await prepareTeamModel2({ io: dataIo, teamId, season, params, today, now, onlyMissing: !full });
      totals.teams += 1;
      for (const key of Object.keys(counts)) totals[key] += counts[key];
    } catch (err) {
      // best-effort: holdet tages igen ved næste kørsel; ét samlet Sentry-event pr. kørsel.
      failedTeams += 1;
      firstError ??= err.message;
      log?.error?.(`  prognosis model 2 failed for team ${teamId}: ${err.message}`);
    }
  }
  if (full && !failedTeams) state.fullRunDate = today;
  return { ran: true, full, ...totals, failedTeams, ...(firstError ? { firstError } : {}) };
}

/** Cron-indgangen. */
export async function runPrognosisModel2Tick({ supabase, now = new Date(), capture = captureException }) {
  const result = await runPrognosisModel2Batch({ supabase, now });
  if (result.ran && result.written > 0) {
    console.log(`Prognosis model 2 (${result.full ? "full" : "missing"}): ${result.teams} teams, ${result.written} written, ${result.unchanged} unchanged`);
  }
  if (result.failedTeams > 0) {
    capture(new Error(`prognosis-model2: ${result.failedTeams} teams failed: ${result.firstError}`), { tags: { cron: "prognosis-model2" } });
  }
  return result;
}

// ── Læsning ──────────────────────────────────────────────────────────────────────

/**
 * Den publicerede prognose for holdets egne ryttere. Tallet klemmes ind mellem ratingen nu
 * og det skøn, manageren ser nu, så et skøn der er ændret siden kørslen aldrig overhales.
 * Returnerer Map(riderId → { value, lo, hi }); ryttere uden række er ikke med.
 */
export async function loadModel2Prognoses(supabase, { teamId, riderIds }) {
  const ids = [...new Set((riderIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from(PROGNOSIS_MODEL2_TABLE)
    .select("rider_id, value, band_lo, band_hi").eq("team_id", teamId).in("rider_id", chunk).order("rider_id"));
  return new Map(rows.map((row) => [row.rider_id, { value: Number(row.value), lo: Number(row.band_lo), hi: Number(row.band_hi) }]));
}

/** Ren funktion: den viste Model 2-prognose for ét tal, ét skøn og ratingen nu. */
export function model2View(row, { estimate, currentRating }) {
  if (!row || !isNum(row.value) || !isNum(estimate)) return null;
  const floor = Math.max(1, Math.round(Number(currentRating) || 1));
  const ceiling = Math.max(floor, Math.round(estimate));
  const clamp = (v) => Math.max(floor, Math.min(ceiling, Math.round(v)));
  const value = clamp(row.value);
  const lo = Math.min(value, clamp(isNum(row.lo) ? row.lo : value));
  const hi = Math.max(value, clamp(isNum(row.hi) ? row.hi : value));
  return { hidden: false, value, model: 2, band: { lo, hi } };
}

