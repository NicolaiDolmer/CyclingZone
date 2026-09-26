// Daglig trænings-orchestrator (#1305) — eksekverer ÉN trænings-dag for ÉT hold.
//
// Idempotent via et unique-index i training_day_runs: reservation-first strategi
// bruger en pending-row som mutex. Postgres 23505 unique-violation ved INSERT
// → alreadyRan=true uden videre DB-skriv.
//
// #4846/#4847: HVILKET index der er mutexen afgoeres af `training_tick_per_race_day`:
//   flag off → UNIQUE(team_id, tick_date)                                   WHERE game_day IS NULL
//   flag on  → UNIQUE(team_id, season_id, COALESCE(squad,'senior'), game_day) WHERE game_day IS NOT NULL
// De to lever side om side (database/2026-09-14-4846-training-tick-game-day.sql +
// database/2026-09-15-4847-training-day-close-trigger.sql), og flag off er bit-identisk
// med foer: hverken season_id, game_day eller squad skrives.
//
// Spejler riderProgressionEngine.js: DI-supabase, loft genberegnet pr. tick
// (buildCapsForRider, #2471 — ikke lazy-initeret), batched writes (runBatched),
// ageForSeason-helper genbrugt herfra.
//
// Kaldes af: POST /api/training/run-today (manager) + cron-sweeps (assistant):
// trainingSweep.js paa den gamle kalenderdags-sti, trainingDayCloseTrigger.js paa
// loebsdags-stien (#4847). BONUS: `bonus` er true KUN paa den gamle sti — loebsdags-
// stien har ingen bonus (ejer 15/9, TRAINING_RULES.md §13.3 beslutning 3). Ingen
// nondeterminisme udover `now`-default + updated_at-timestamps.

import { copenhagenDateString, copenhagenWeekdayKey, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { resolveProgram, applyDailyTick } from "./dailyTraining.js";
// #4850 spor C2 (ejer 24/9): loebsdagen er et mellem-pas paa etapens profil-evner,
// koert gennem applyDailyTick. `applyRaceDevelopmentTick` (dailyTraining.js) bliver
// staaende til variant B (dagens intention, #4632), men motoren kalder den ikke mere.
import { raceDayProgram, RACE_DAY_FALLBACK_PROFILE } from "./raceDayYield.js";
import { loadRaceDayStagesByRider } from "./raceDayStageLookup.js";
// #4629: programmer pr. loebsdag laeses gennem SAMME stige (resolveDayProgram
// kalder resolveDayIntensity); flaget off = den gamle linje, bit for bit.
import { resolveDayProgram, programSlotForRaceDay, weekDaysHaveSessions } from "./trainingPrograms.js";
import { isTrainingProgramsEnabledForTeam } from "./trainingProgramsFlag.js";
import { nextFatigue, nextForm, conditionMultiplier, injuryRisk, rollInjury, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { buildCapsForRider, sameCaps } from "./riderProgression.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { riderLevelBand } from "./staffAbilityConstants.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isRaceDayDevelopmentEnabled } from "./raceDayDevelopmentFlag.js";
import { isTrainingTickPerRaceDayEnabled } from "./trainingTickRaceDayFlag.js";
import {
  TRAINING_RACE_DAY_CONFIG, resolveRaceDayBudgetDivisor, raceDaySeedKey, resolveTeamRaceDay,
  loadBoundRiderIdsForRaceDay,
} from "./trainingRaceDayTick.js";
// #5462 (ejer-laast 15/9, TRAINING_RULES §13.3 pkt. 7): skadens VARIGHED regnes i
// LOEBSDAGE naar loebsdagen er tick-enheden. Datamodellen og dens trade-off staar i
// headeren paa injuryRaceDays.js.
import {
  injuryEndGameDay, injuryRaceDaysLeft, isInjuredOnRaceDay, resolveInjuryEndDates,
  loadTeamDivisionId,
} from "./injuryRaceDays.js";

// #4847: standard-truppen paa training_day_runs.squad. Kolonnen har DEFAULT 'senior'
// i skemaet (database/2026-09-15-4847-training-day-close-trigger.sql); konstanten her
// findes for at sweepens noegle-strenge og motorens INSERT kan dele ÉN sandhed.
export const TRAINING_DAY_RUN_DEFAULT_SQUAD = "senior";

// Batched async-runner (samme hjælper som riderProgressionEngine.js).
async function runBatched(items, concurrency, fn) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

// Beregn injured_until-dato: tickDate (YYYY-MM-DD) + days → YYYY-MM-DD.
// Noon UTC undgår DST-kanttilfælde ved dato-aritmetik.
function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// #3459 D1: batch-lookup "hvilke af holdets ryttere racede i dag" — race_results
// (result_type='stage') med imported_at i tickDate's danske kalenderdøgn, filtreret
// på holdets rider_ids. Fail-safe by construction: ALDRIG throw — en query-fejl
// resolver som { data: null, error } så kald-stedet kan falde tilbage til "ingen
// løbsdag antaget" (log warning) i stedet for at vælte hele trænings-dagen for et
// helt hold pga. én best-effort-berigelse. Kun kaldt når raceDayDevelopmentOn
// (#4277; kald-stedet sender Promise.resolve({data:[],error:null}) når flag off —
// ingen ekstra DB-belastning for en slukket feature).
// #3459 D2: select udvidet med race_id + stage_number — koblingspunktet til
// race_stage_profiles (profil-typen) der driver RACE_PROFILE_ABILITY_MAP nedenfor.
async function loadRacedRiderIdsToday(supabase, riderIds, now, tickDate) {
  try {
    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = copenhagenMidnightUTC(new Date(`${addDaysToDate(tickDate, 1)}T12:00:00Z`));
    // pagination-safe: .in("rider_id", riderIds) bounds this to ÉT holds egen
    // rytter-trup (typisk < 30, langt under PostgREST's 1000-rækkers-loft) —
    // samme størrelsesorden som de øvrige team-scopede loads i denne fil (fx
    // abilities/condition ovenfor), ikke en tabel-bred/ubegrænset select.
    const { data, error } = await supabase
      .from("race_results")
      .select("rider_id, race_id, stage_number")
      .eq("result_type", "stage")
      .in("rider_id", riderIds)
      .gte("imported_at", dayStart.toISOString())
      .lt("imported_at", dayEnd.toISOString());
    if (error) return { data: null, error };
    return { data: data ?? [], error: null };
  } catch (err) {
    // best-effort: en synkron/netværks-fejl her må ALDRIG vælte hele holdets
    // trænings-dag pga. én best-effort-berigelse — kald-stedet logger en warning
    // og falder tilbage til "ingen løbsdag antaget" (samme fail-safe-kontrakt
    // som error-grenen ovenfor).
    return { data: null, error: err };
  }
}

// #3459 D2: batch-lookup profil-type pr. (race_id, stage_number) for dagens
// racede ryttere. race_stage_profiles er den RENESTE sti fra race_results til
// RACE_PROFILE_ABILITY_MAP — races/race_stage_schedule har INGEN profil-kolonne
// (kun stage_schedule's scheduled_at, races' race_type/race_class). Fail-safe
// (samme kontrakt som loadRacedRiderIdsToday ovenfor): query-fejl → { data: null,
// error } så kald-stedet falder tilbage til raceFatigueLoad's samme 'rolling'-
// ukendt-profil-fallback i stedet for at vælte trænings-dagen.
async function loadRaceStageProfiles(supabase, raceIds) {
  if (!raceIds.length) return { data: [], error: null };
  try {
    const { data, error } = await supabase
      .from("race_stage_profiles")
      .select("race_id, stage_number, profile_type")
      // pagination-safe: raceIds er dedupet fra ÉT holds dagens racede ryttere
      // (typisk 0-1 løb pr. hold pr. dag, langt under PostgREST's 1000-rækkers-
      // loft) — samme størrelsesorden som race_results-loaded ovenfor, ikke en
      // tabel-bred/ubegrænset select.
      .in("race_id", raceIds);
    if (error) return { data: null, error };
    return { data: data ?? [], error: null };
  } catch (err) {
    // best-effort: en synkron/netværks-fejl her må ALDRIG vælte hele holdets
    // trænings-dag pga. én best-effort-berigelse — kald-stedet falder tilbage
    // til 'rolling'-profilen (samme fail-safe-kontrakt som ovenfor).
    return { data: null, error: err };
  }
}

/**
 * Eksekvér ét dagligt trænings-tick for ét hold.
 *
 * @param {object}  args
 * @param {object}  args.supabase       — service-role client
 * @param {string}  args.teamId         — UUID på holdet
 * @param {string}  args.seasonId       — UUID på aktiv sæson
 * @param {number}  args.seasonNumber   — sæson-nummer (til alder + seed)
 * @param {string}  args.executedBy     — "manager" | "assistant"
 * @param {Date}    [args.now]          — referencetid (default new Date())
 * @param {number}  [args.gameDay]      — #4846: eksplicit loebsdag. SEAM til fase B4
 *   (udloeseren "loebsdagen lukker" kender selv dagen og skal ikke slaa den op igen).
 *   Udeladt + flag on ⇒ resolveTeamRaceDay. Ignoreret naar flaget er off.
 * @param {string}  [args.squad]        — #4847: hvilken loebsdags-akse ticket hoerer til
 *   ("senior" | "u23" | "junior"). Default "senior". Indgaar i mutexens noegle paa
 *   loebsdags-stien, saa #4620's tre akser pr. hold ikke kolliderer. Ignoreret naar
 *   flaget er off (den gamle noegle er (team_id, tick_date)).
 * @returns {Promise<{ alreadyRan: boolean, tickDate: string, gameDay: number|null, squad: string, report?: object }>}
 */
export async function runTeamTrainingDay({
  supabase, teamId, seasonId, seasonNumber, executedBy, now = new Date(), gameDay = null,
  squad = TRAINING_DAY_RUN_DEFAULT_SQUAD,
  // #4629: holdets loebsdage paa datoen (sweepens spaend / knappens gameDays).
  // Kun til programslottet; null ⇒ slot 0.
  dateGameDays = null,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");
  if (!seasonId) throw new Error("seasonId required");
  if (!Number.isFinite(seasonNumber)) throw new Error("seasonNumber required");
  if (executedBy !== "manager" && executedBy !== "assistant") {
    throw new Error(`executedBy must be 'manager' or 'assistant', got: ${executedBy}`);
  }

  const tickDate = copenhagenDateString(now);
  const squadKey = typeof squad === "string" && squad.trim() ? squad.trim() : TRAINING_DAY_RUN_DEFAULT_SQUAD;
  // ── #4847: truppen er KLAR I NOEGLEN, men ikke i rytter-udvaelgelsen ─────────
  // Migrationen (database/2026-09-15-4847-*.sql) lader et hold have én raekke pr.
  // (saeson, trup, loebsdag), saa #4620's tre loebsdags-akser ikke kolliderer.
  // Rytter-queryet nedenfor vaelger derimod STADIG `team_id = X AND is_retired =
  // false` — der findes ingen trup-tilhoersforhold paa `riders` endnu.
  //
  // Et "u23"-tick ville derfor traene HELE truppen EN GANG TIL under en anden
  // noegle: dobbelt-kredit, ikke en U23-session. Motoren afviser derfor alt andet
  // end senior indtil #4620 tilfoejer et verificerbart trup-felt og dette query
  // filtrerer paa det. Noeglen er bygget foerst med vilje (skemaet skal ligge klar
  // foer cutover); grænsen her er det der goer den sikker at have liggende.
  if (squadKey !== TRAINING_DAY_RUN_DEFAULT_SQUAD) {
    throw new Error(
      `squad '${squadKey}' not supported yet: rider selection is not squad-scoped (see #4620). Only '${TRAINING_DAY_RUN_DEFAULT_SQUAD}' is accepted.`,
    );
  }

  // ── 0) #4846: hvilken noegle er mutexen i dag? ───────────────────────────────
  // Flaget SKAL laeses FOER reservationen, fordi noeglen ER laasen. `engineWrite`
  // fordi et cron-sweep ingen viewer har (featureStage.js' skrive-gate).
  //
  // Fail-safe-kaskade: flag off, hold uden division, eller en loebsdag der ikke kan
  // slaas op ⇒ `useRaceDayKey = false` ⇒ PRAECIS den gamle kalenderdags-sti. Et hold
  // stopper aldrig stille med at udvikle sig fordi kalenderen mangler et svar.
  const raceDayTickOn = await isTrainingTickPerRaceDayEnabled(supabase, { engineWrite: true });
  let raceDay = null;
  if (raceDayTickOn) {
    raceDay = Number.isFinite(gameDay)
      ? Number(gameDay)
      : (await resolveTeamRaceDay({ supabase, teamId, seasonId, now })).gameDay;
  }
  const useRaceDayKey = raceDayTickOn && Number.isFinite(raceDay);
  // ── #4847 (ejer-beslutning 15/9, §13.3 beslutning 3): INGEN BONUS paa loebsdags-
  // stien. Den frivillige knap "Koer dagens traening nu" giver kun utaalmodighed, ikke
  // fordel — beslutning 2 (6/9) fjerner de 25 %. Bonussen lever videre PRAECIS saa
  // laenge den gamle kalenderdags-sti goer (flag off = bit-identisk med i dag); den
  // sidste rest af `bonusMult`/`bonus_applied` ryddes ved cutover, ikke her, fordi
  // #4847 skal kunne merges uden at aendre live-balance mens flaget er slukket.
  const bonus = executedBy === "manager" && !useRaceDayKey;
  // Loebsdags-stoej/skade-seed (A3) og den G1-kalibrerede budget-deler. null paa den
  // gamle sti ⇒ dailyTraining.js falder tilbage til dato-seed + cfg.daysPerSeason.
  const tickSeedKey = useRaceDayKey ? raceDaySeedKey({ seasonId, gameDay: raceDay }) : null;
  const seedScope = tickSeedKey ?? tickDate;
  // #4847 punkt 5: deleren kalibreres mod det maal kalenderpakkeren faktisk pakker
  // efter (calendarRaceDayTargets.js' SEASON_RACE_DAY_TARGET, 140 fra S4) i stedet
  // for et duplikeret tal. Synkron siden #4846 (statisk import); await'en er harmloes.
  const budgetDivisor = useRaceDayKey
    ? await resolveRaceDayBudgetDivisor({ seasonNumber })
    : null;
  // #4801: "+1 pr. evne pr. dag" betyder pr. LOEBSDAG naar loebsdagen er tick-enheden.
  // Roret (hardDailyCap) har altid vaeret der, men blev aldrig sendt — reglen er ny.
  const hardDailyCap = useRaceDayKey ? TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay : undefined;

  // Raekke-filter for de senere update/delete-kald: samme noegle som reservationen,
  // ellers ville en update paa (team_id, tick_date) ramme ALLE loebsdage samme dato.
  // #4847: truppen er en del af noeglen paa loebsdags-stien — uden den ville et
  // U23-tick's update ramme senior-raekken paa samme (team, season, game_day).
  const runRowFilter = (query) => (useRaceDayKey
    ? query.eq("team_id", teamId).eq("season_id", seasonId).eq("squad", squadKey).eq("game_day", raceDay)
    : query.eq("team_id", teamId).eq("tick_date", tickDate));

  // ── 1) Reservation: INSERT pending-row; 23505 → alreadyRan ───────────────────
  const { error: insertError } = await supabase
    .from("training_day_runs")
    .insert({
      team_id: teamId,
      tick_date: tickDate,
      executed_by: executedBy,
      bonus_applied: bonus,
      report: { pending: true },
      // Bart INSERT uden ON CONFLICT: det PARTIELLE unique-index paa
      // (team_id, season_id, game_day) WHERE game_day IS NOT NULL rejser 23505
      // praecis som tabel-constrainten gjorde. Udelades felterne, falder raekken
      // tilbage under (team_id, tick_date) WHERE game_day IS NULL.
      // #4847: `squad` sendes KUN paa loebsdags-stien. Den gamle sti lader kolonnens
      // DEFAULT 'senior' staa, saa raekken er bit-identisk med foer.
      ...(useRaceDayKey ? { season_id: seasonId, game_day: raceDay, squad: squadKey } : {}),
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { alreadyRan: true, tickDate, gameDay: useRaceDayKey ? raceDay : null, squad: squadKey };
    }
    throw new Error(`training_day_runs insert: ${insertError.message}`);
  }

  // ── Phase 1: Loads + ren beregning (ingen writes) ────────────────────────────
  // Ved fejl her slettes reservationen, så holdet kan retrye samme dag.
  let abilityUpdates, conditionUpserts, reportRiders, historyRows, raceDayHistoryRows, scoreRows;
  try {
  // ── 2) Load riders (ikke-pensionerede, dette hold) ──────────────────────────
  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select("id, primary_type, secondary_type, potentiale, birthdate, firstname, lastname, team_id, is_academy")
    .eq("team_id", teamId)
    .eq("is_retired", false);
  if (ridersError) throw new Error(`riders load: ${ridersError.message}`);
  if (!riders || riders.length === 0) {
    const emptyReport = {
      riders: [], bonus_applied: bonus, executed_by: executedBy, tick_date: tickDate,
      game_day: useRaceDayKey ? raceDay : null,
    };
    await runRowFilter(supabase.from("training_day_runs").update({ report: emptyReport }));
    return { alreadyRan: false, tickDate, gameDay: useRaceDayKey ? raceDay : null, squad: squadKey, report: emptyReport };
  }

  const riderIds = riders.map((r) => r.id);

  // #3459 D1 / #4277: flagene afgør om løbsdags-lookuppet overhovedet skal køre —
  // læst FØR batch-Promise.all'et så den betingede query kan indgå i samme batch
  // (kodemap-kravet: "i samme Promise.all som øvrige hold-inputs") uden at spilde
  // en query på en slukket feature.
  //
  // #4277: de to flag er UAFHÆNGIGE. `raceDayEngineOn` styrer nu KUN D3
  // (recovery-konstanterne nedenfor); D1+D2 — lookuppet, "race"-intensiteten og
  // udviklings-tick'et — hænger på `raceDayDevelopmentOn`. Læses parallelt: to
  // uafhængige app_config-opslag uden indbyrdes rækkefølge.
  const [raceDayEngineOn, raceDayDevelopmentOn] = await Promise.all([
    isRaceDayEngineEnabled(supabase),
    isRaceDayDevelopmentEnabled(supabase),
  ]);

  // ── 3) Load abilities, training plans + condition i parallell ─────────────────
  const [
    { data: abilityRows, error: abilityError },
    { data: planRows, error: planError },
    { data: conditionRows, error: conditionError },
    { data: weekPlanRow, error: weekPlanError },
    raceDayResult,
    boundRidersResult,
  ] = await Promise.all([
    supabase.from("rider_derived_abilities").select("*").in("rider_id", riderIds),
    supabase.from("training_plans")
      .select("rider_id, focus, intensity")
      .eq("team_id", teamId)
      .eq("season_id", seasonId),
    supabase.from("rider_condition").select("*").in("rider_id", riderIds),
    // #1895: holdets ugentlige rytme (rider_id IS NULL) OG pr-rytter-overrides
    // (rider_id sat) hentes i ÉT kald — begge lever i samme tabel, splittes i JS.
    // PR 1 hentede kun team-rowet; PR 2 tilføjer rytter-override-laget.
    supabase.from("training_week_plans")
      .select("rider_id, days")
      .eq("team_id", teamId),
    // #3459 D1 / #4277: kun query'et når UDVIKLINGS-flagget er on — off giver en
    // no-op-promise (bit-identisk med før #3459, ingen ekstra DB-kald). Bevidst
    // `raceDayDevelopmentOn`, ikke `raceDayEngineOn`: uden D2 har lookuppet ingen
    // aftager, og så er det ren spildt query pr. hold pr. dag.
    // #4847: ogsaa paa loebsdags-aksen, ikke kun naar UDVIKLINGEN er taendt.
    // Bindingen (nedenfor) siger hvem der er OPTAGET; dette siger hvem der
    // faktisk KOERTE. Forskellen er GT-hviledagen, og den skal vaere synlig paa
    // traeningsscoren ("loeb" vs. ingen raekke) uanset udviklings-flaget.
    //
    // #4850 C2: paa loebsdags-aksen er kilden det PRAECISE etape-opslag pr. loebsdag
    // (race_results ⋈ race_stage_schedule paa (race_id, stage_number) hvor game_day =
    // loebsdagen, raceDayStageLookup.js). Det kender ingen binding, saa et afsluttet
    // loeb (bindingen slettet af race_entry_days_rebuild) svarer stadig "koerte".
    // Profilen hentes kun naar udviklingen er taendt: uden den bruges maengden
    // udelukkende til at skelne "koerte" fra "hviledag". Den gamle kalenderdags-sti
    // beholder sit imported_at-opslag uroert.
    useRaceDayKey
      ? loadRaceDayStagesByRider({
        supabase, teamId, seasonId, gameDay: raceDay, riderIds, withProfiles: raceDayDevelopmentOn,
      })
      : raceDayDevelopmentOn
        ? loadRacedRiderIdsToday(supabase, riderIds, now, tickDate)
        : Promise.resolve({ data: [], error: null }),
    // #4847 (ejer-regel 2+3, 18/9): hvem er BUNDET paa denne loebsdag? Kun paa
    // loebsdags-aksen — den gamle kalenderdags-sti har ingen loebsdag at binde paa
    // og er bit-identisk med i dag (ingen ekstra DB-kald naar flaget er off).
    useRaceDayKey
      ? loadBoundRiderIdsForRaceDay({ supabase, riderIds, seasonId, gameDay: raceDay })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (abilityError) throw new Error(`abilities load: ${abilityError.message}`);
  if (planError) throw new Error(`plans load: ${planError.message}`);
  if (conditionError) throw new Error(`condition load: ${conditionError.message}`);
  if (weekPlanError) throw new Error(`week plan load: ${weekPlanError.message}`);

  // ── #4847: loebsdags-BINDINGEN (ejer-regel 2+3, 18/9) ───────────────────────
  // KASTER bevidst, i modsaetning til loebsdags-BERIGELSEN nedenfor. Bindingen
  // afgoer om rytteren overhovedet maa traene i dag; et gaet er enten traening oven
  // i et loeb (regel 2 brudt) eller en taget dag for hele truppen. Tick'et er
  // idempotent og sweepens dags-claim saettes kun ved `failed === 0`, saa den
  // rigtige adfaerd er at fejle holdet og lade naeste 5-min-tick proeve igen.
  // ASCII-only besked (#i18n-leak-guard): intern ops-fejl, ikke spiller-synlig.
  if (useRaceDayKey && boundRidersResult.error) {
    throw new Error(
      `race-day binding load (team ${teamId}, game day ${raceDay}): ${boundRidersResult.error.message ?? boundRidersResult.error} - refusing to tick, retry on next sweep`,
    );
  }
  // Tom mængde paa den gamle sti — ingen loebsdag, ingen binding.
  const boundRiderIds = boundRidersResult.data ?? new Set();

  // #3459 D1 fail-safe: query-fejl → tom mængde (INGEN løbsdag antaget), log warning.
  // Kaster ALDRIG — en fejlet best-effort-berigelse må ikke vælte hele holdets
  // trænings-dag (samme filosofi som Plan B's facilitets-load, #1441).
  let racedRiderIds = new Set();
  // #3459 D2: rider_id → profil-type for dagens løb (RACE_PROFILE_ABILITY_MAP-nøgle).
  // Fallback pr. rytter = 'rolling' (samme ukendt-profil-fallback som raceFatigueLoad)
  // — sat eksplicit nedenfor, IKKE først inde i applyRaceDevelopmentTick, så en
  // manglende race_stage_profiles-række aldrig kan give en udefineret evneliste.
  const racedRiderProfileByRider = new Map();
  if (useRaceDayKey) {
    // #4850 C2: etape-opslaget er en REGEL-GATE paa loebsdags-aksen (samme kontrakt
    // som bindingen ovenfor): svaret afgoer om rytteren maa traene i dag. Et gaet
    // ved fejl er enten traening oven i et loeb (regel 2 brudt) eller en taget dag.
    // Derfor kastes der, og naeste sweep proever igen. ASCII-only besked.
    if (raceDayResult.error) {
      throw new Error(
        `race-day stage lookup (team ${teamId}, game day ${raceDay}): ${raceDayResult.error.message ?? raceDayResult.error} - refusing to tick, retry on next sweep`,
      );
    }
    // Profilen er derimod en BERIGELSE: mangler den, traener loebsdagen 'rolling'.
    if (raceDayResult.profileError) {
      console.warn(`  ⚠️ race-stage-profile lookup failed for team ${teamId} (game day ${raceDay}): ${raceDayResult.profileError.message ?? raceDayResult.profileError} - falling back to '${RACE_DAY_FALLBACK_PROFILE}' (fail-safe)`);
    }
    for (const [riderId, stage] of raceDayResult.data ?? new Map()) {
      racedRiderIds.add(riderId);
      racedRiderProfileByRider.set(riderId, stage.profileType ?? RACE_DAY_FALLBACK_PROFILE);
    }
  } else if (raceDayDevelopmentOn) {
    if (raceDayResult.error) {
      // ASCII-only besked (#i18n-leak-guard, BACKEND_CONTEXT matcher error/message-linjer med
      // æ/ø/å) — dette er intern ops-logging, ikke en spiller-synlig API-fejl.
      console.warn(`  ⚠️ race-day lookup failed for team ${teamId} (${tickDate}): ${raceDayResult.error.message} - assuming no race day (fail-safe)`);
    } else {
      const racedRows = raceDayResult.data ?? [];
      racedRiderIds = new Set(racedRows.map((r) => r.rider_id));

      // #3459 D2: hent profil-typen for de racede etaper — kun de race_id'er der
      // rent faktisk optræder i dagens racede rækker (typisk 0-1 pr. hold pr. dag).
      // #4847: KUN naar udviklingen er taendt. Profil-typen har én aftager,
      // applyRaceDevelopmentTick; er udviklingen slukket, bruger vi mængden
      // udelukkende til at skelne "koerte" fra "hviledag", og saa er opslaget
      // spildt arbejde pr. hold pr. tick.
      const raceIds = raceDayDevelopmentOn
        ? [...new Set(racedRows.map((r) => r.race_id).filter(Boolean))]
        : [];
      const stageProfilesResult = raceIds.length
        ? await loadRaceStageProfiles(supabase, raceIds)
        : { data: [], error: null };
      const profileByRaceStage = new Map();
      if (stageProfilesResult.error) {
        console.warn(`  ⚠️ race-stage-profile lookup failed for team ${teamId} (${tickDate}): ${stageProfilesResult.error.message} - falling back to 'rolling' (fail-safe)`);
      } else {
        for (const row of stageProfilesResult.data ?? []) {
          profileByRaceStage.set(`${row.race_id}:${row.stage_number}`, row.profile_type);
        }
      }
      for (const row of racedRows) {
        const key = `${row.race_id}:${row.stage_number}`;
        racedRiderProfileByRider.set(row.rider_id, profileByRaceStage.get(key) ?? "rolling");
      }
    }
  }

  const abilityByRider = new Map((abilityRows ?? []).map((a) => [a.rider_id, a]));
  const planByRider = new Map((planRows ?? []).map((p) => [p.rider_id, p]));
  const condByRider = new Map((conditionRows ?? []).map((c) => [c.rider_id, c]));
  const weekPlanRows = Array.isArray(weekPlanRow) ? weekPlanRow : [];
  const teamWeekDays = weekPlanRows.find((r) => r.rider_id == null)?.days ?? null;
  // #1895 PR 2: rytter-override-rows → Map(rider_id → days). Rider-override vinder
  // over holdrytmen i resolveDayIntensity (se training.js).
  const riderOverrideByRider = new Map(
    weekPlanRows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.days]),
  );
  const weekday = copenhagenWeekdayKey(tickDate);
  // #4629: programcellerne laeses KUN naar holdet har programdata OG flaget er
  // on for holdet (beta: holdets ejer er beta-tester). Uden programdata er der
  // intet ekstra opslag, og stien er bit-identisk med foer.
  const programsOn = weekPlanRows.some((r) => weekDaysHaveSessions(r.days))
    ? await isTrainingProgramsEnabledForTeam(supabase, teamId)
    : false;
  // Loebsdagens plads blandt holdets loebsdage paa datoen (0-4), samme liste som
  // gitterets kolonner. Kalenderdags-ticket = slot 0 ("I dag").
  const programSlot = useRaceDayKey ? programSlotForRaceDay(raceDay, dateGameDays) : 0;

  // ── 3b) Plan B (#1441): trænings-facilitet + chef (én load pr. hold pr. dag) ──
  // Data-drevet: hold uden faciliteter/chef → { 0, null } → multiplikator præcis 1.0
  // (nul regression). Best-effort inde i loaderen — kan aldrig vælte træningsdagen.
  const { facilityTier: trainingFacilityTier, staff: trainingStaff } =
    await loadTrainingStaffContext(supabase, teamId);

  // ── 4) Tick pr. rytter ────────────────────────────────────────────────────────
  abilityUpdates = []; // { riderId, patch }
  conditionUpserts = []; // { rider_id, form, fatigue, injured_until, injury_cause, updated_at }
  reportRiders = [];
  historyRows = []; // { rider_id, snapshot_date, source, season_number, abilities } — #2000 Udvikling-fane
  // #4846: soester-raekker paa loebsdags-aksen. Tom naar flaget er off.
  raceDayHistoryRows = [];
  // #4851: traeningsscoren pr. rytter pr. pas. Skrives UANSET
  // training_score_visible — flaget gater kun visningen, og uden historik ville
  // den foerste sparkline vaere ét punkt den dag flaget taendes.
  scoreRows = [];

  for (const rider of riders) {
    const abRow = abilityByRider.get(rider.id);
    if (!abRow) {
      // Ingen abilities-række: spring over stille (spec: same guard as L0).
      continue;
    }

    const age = ageForSeason(rider.birthdate, seasonNumber);
    const cond = condByRider.get(rider.id) ?? { form: 50, fatigue: 0, injured_until: null, injury_cause: null };
    const plan = planByRider.get(rider.id) ?? null;
    const program = resolveProgram(plan, rider.primary_type);
    // #1895/#2438: lagdelt ugerytme-opløsning — rører KUN intensitet, aldrig
    // program.focus. Prioritet: rytterens EGEN pr-dag-override (individuel
    // ugeplan) > rytterens EGEN eksplicitte plan (training_plans, hasExplicitPlan)
    // > holdets ugerytme (kun DEFAULT for ryttere uden egen override) >
    // sæson-intensiteten (resolveDayIntensity). #2438 — ejerens præcedens: en
    // individuel rytter-indstilling overtrumfer den ugentlige rutine.
    const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
    // #4629: med programsOn kan en programcelle ogsaa saette SESSIONEN (fokus);
    // uden er det praecis den gamle `program.intensity = resolveDayIntensity(...)`.
    // Loeb er loeb (ejer-valg 2): en rytter der koerer/er bundet i dag rammer
    // racedToday/boundRestToday nedenfor, og programmets session springes over.
    const dayProgram = resolveDayProgram({
      weekday,
      slotIndex: programSlot,
      riderOverrideDays: riderOverrideByRider.get(rider.id) ?? null,
      teamWeekDays,
      program,
      hasExplicitPlan,
      programsOn,
    });
    if (dayProgram.source === "program") program.focus = dayProgram.focus;
    program.intensity = dayProgram.intensity;

    // Byg abilities-objekt kun fra VISIBLE_ABILITIES (ikke formula_version etc.)
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) {
      if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    }

    // Livstidsloftet GENBEREGNES hver tick — det er en ren funktion af potentiale,
    // anlæg og nuværende evne, så en forkert persisteret værdi kan ikke overleve.
    // Tidligere lazy-initede vi ("skriv kun når ability_caps er NULL") med den
    // baseline-bundne voksen-formel uanset alder, mens backfill-stien brugte den
    // afkoblede ungdoms-formel. Hvilken semantik en rytter endte med var derfor et
    // møntkast afgjort af hvilken kodesti der ramte ham først (#2001-mønsteret), og
    // feltet blev aldrig genopbygget. Se buildCapsForRider for den samlede model.
    // age medsendes (#2472, 16/7) så buildCapsForRider kan aftrappe det absolutte
    // loft efter peakAge — uden den ville post-peak-ryttere ikke aldres (blocker-fund).
    const caps = buildCapsForRider(abilities, { ...rider, age }, rider.primary_type, rider.secondary_type);
    const capsChanged = !sameCaps(abRow.ability_caps, caps);

    // #2437's interim-knapper er FJERNET i #3709 trin 5 — se sharedTickArgs
    // nedenfor for hvorfor (kort: de bremsede en model der maettede, og trin 4
    // fjerner maetningen ved roden). tickCaps = livstids-loftet for ALLE aldre,
    // uaendret siden #2437; det er nu den eneste semantik der findes.
    const tickCaps = caps;

    // Er rytteren skadet i dag?
    // #5462: paa loebsdags-aksen spoerges der paa LOEBSDAGEN, ikke paa datoen — en
    // kalenderdato baerer fra S4 fem loebsdage, saa en dato-sammenligning ville holde
    // rytteren ude resten af dagen efter at hans sidste skadede loebsdag var gaaet.
    // Uden loebsdags-felterne (skade skrevet foer flippet, eller flag off) falder
    // `isInjuredOnRaceDay` tilbage til praecis det gamle udtryk.
    const injuredToday = useRaceDayKey
      ? isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: raceDay, tickDate })
      : !!(cond.injured_until && cond.injured_until >= tickDate);

    // #3459 D1 / #4277: racede rytteren i dag (udviklings-flag on)? injuredToday
    // har forrang (kan i praksis ikke ske samtidig — en skadet rytter stilles ikke
    // til start — men defensivt konsistent med resten af grenen).
    //
    // #4277: `raceDayDevelopmentOn` er den eneste gate her. Med udviklingen off
    // er `racedRiderIds` altid tom (lookuppet kørte ikke), så gaten er teknisk
    // redundant — den bliver stående fordi den gør intentionen læsbar dér hvor
    // grenen vælges, i stedet for at hvile på en tom mængde langt oppe i filen.
    //
    // #4847 (ejer-regel 2, 18/9): paa loebsdags-aksen SKAERES `racedRiderIds` med
    // bindingen. `racedRiderIds` er noeglet paa KALENDERDAGEN (race_results.
    // imported_at), og en kalenderdag baerer flere loebsdage — uden skaeringen ville
    // en rytter der koerte paa loebsdag N ogsaa taelle som "racede" paa loebsdag N+1
    // (samme dato) og faa en udviklings-dag han ikke har koert for. Bindingen er
    // loebsdags-noeglet og er derfor den praecise mængde.
    //
    // #4850 C2: paa loebsdags-aksen er `racedRiderIds` nu selv loebsdags-noeglet
    // (etape-opslaget), saa skaeringen med bindingen er ikke laengere noedvendig —
    // og den ville vaere FORKERT: bindingen forsvinder naar loebet er afsluttet
    // (race_entry_days_rebuild ved status `completed`, spec risiko 1), og saa fik
    // en rytter i et afsluttet endagsloeb eller paa sidste etape almindelig
    // traening oven i loebet. "Koerte" goer ham derfor ogsaa BUNDET: loeb ELLER
    // traening, uanset om bindings-raekken stadig findes.
    // KOERTE han en etape i dag? (uafhaengigt af om udviklingen er taendt)
    const rodeToday = racedRiderIds.has(rider.id);
    const boundToday = useRaceDayKey && (boundRiderIds.has(rider.id) || rodeToday);
    const racedToday = !injuredToday && raceDayDevelopmentOn && rodeToday;

    // #4847 (ejer-regel 2+3, 18/9): BUNDET, men ikke paa en udviklings-loebsdag.
    // To tilfaelde ender her, og begge skal vaere HVILE, ikke traening:
    //   · GT-hviledagen — rytteren er inde i et etapeloeb og koerer ikke i dag
    //     (regel 3: "saa skal han jo bare sove om natten og koere loeb igen").
    //   · Rytteren KOERTE i dag, men `race_day_development_enabled` er slukket.
    //     Foer denne aendring gav praecis den tilstand traening oven i loebet —
    //     regel 2 brudt, og den bug ejeren fandt 18/9 i denne PR.
    // Resultatet er det samme som en skadet rytters: intet tick, ingen score-raekke,
    // ingen historik — kun condition/restitution. "Loeb ELLER traening, aldrig begge."
    const boundRestToday = !injuredToday && !racedToday && boundToday;

    // Pre-tick træthed til skaderisiko-beregning (brug den aktuelle, ikke den næste).
    const preFatigue = Number(cond.fatigue ?? 0);
    // #3924 trin 2: pre-tick fremdrift, snapshottet FØR tickResult muterer den —
    // rapport-linjen bærer den videre (progress_before) så frontend kan udlede
    // hvor meget af DAGENS bar der kom fra netop dette pas (mørkere segment på
    // "på vej mod næste point"-baren). Samme kilde som sharedTickArgs.progress
    // nedenfor, ét sted, så de to aldrig kan divergere.
    const preProgress = abRow.ability_progress ?? {};
    // D1: "race" er bevidst IKKE en gyldig DAILY_TRAINING_CONFIG.intensities-nøgle —
    // DAILY_TRAINING_CONFIG.fatigueLoad["race"] er undefined → nextFatigue's
    // `?? 0`-fallback giver PRÆCIS D1-semantikken (intet trænings-load, IKKE
    // rest-intensitetens -14). Samme "??0"-mekanisme injuryRisk() læner sig på
    // nedenfor (intensity !== "hard" → 0 risiko — ingen trænings-skaderisiko på
    // løbsdage, se "Åbne designbeslutninger" i PR-body).
    // #4847: `boundRestToday` faar "rest" — den rigtige restitutions-semantik for en
    // hviledag inde i et etapeloeb (og for en loebsdag hvor udviklingen er slukket).
    const effectiveIntensity = injuredToday
      ? "rest"
      : racedToday
        ? "race"
        : boundRestToday
          ? "rest"
          : program.intensity;

    // Daglig tick: raske ryttere får ENTEN en normal træningsdag ELLER (racede i
    // dag) en race-udviklings-dag — GENSIDIGT UDELUKKENDE grene i samme if/else,
    // så dobbelt-kredit er umulig by construction (#3459 D2). Skadede ryttere får
    // ingen af delene (no gains, program.intensity/training_plans RØRES ALDRIG —
    // G5-invarianten).
    // #4847: `boundRestToday` er den TREDJE gren — samme udfald som skadet (intet
    // tick), men en anden grund. Den staar i betingelsen og ikke som en tom
    // tick-type, saa "loeb ELLER traening" er umuligt at bryde by construction.
    let tickResult = null;
    if (!injuredToday && !boundRestToday && age != null) {
      const condMult = conditionMultiplier({ form: Number(cond.form ?? 50), fatigue: preFatigue });
      // Fælles parametre for begge tick-typer — samme program/condition/staff/
      // facility/academy-kæde uanset kilde (design-krav: skrivestien er blind
      // for kilden, se applyRaceDevelopmentTick's docblok).
      const sharedTickArgs = {
        riderId: rider.id,
        dateStr: tickDate,
        age,
        abilities,
        caps: tickCaps,
        progress: preProgress,
        program,
        conditionMult: condMult,
        bonus,
        potentiale: rider.potentiale,
        // ── TRIN 5 (#3709, beslutning 13, ejer 14/8): ÉN MODEL ────────────────
        // `hardDailyCap` og `academyRateMult` er FJERNET. Begge fandtes kun for
        // at bremse en model der mættede: da hver evne nåede sit loft inden for
        // karrieren under alle indstillinger, var akademi-alderens høje rate en
        // spike der skulle dæmpes. Trin 4 fjerner mætningen ved roden — rolle-
        // raten gør at ryttere ikke længere NÅR deres lofter — og så bremser de
        // to knapper ikke længere en fejl, de bremser bare væksten.
        //
        // ATTRIBUTIONEN GØR DETTE BÆRENDE, IKKE OPRYDNING. Målt: beholdes
        // akademiets 1/3-dæmpning oven på trin 4, falder kandidatens
        // rating-median fra 28 til 22 — altså langt UNDER dagens 27, for alle.
        // Trin 4 og 5 er derfor ét ship; trin 5 kan ikke udskydes uden at ramme
        // spillerne med et midlertidigt fald.
        //
        // Akademiet adskiller sig herefter KUN ved `youthMultiplier` (1,50 ved
        // 16 år, aftagende til 1,00 ved 22) — som `dailyAbilityDelta` allerede
        // ganger ind selv. `computeAcademySeasonCeiling` var i forvejen ude af
        // produktionsstien (#2437 satte tickCaps = caps).
        // #3709 trin 4: anlægget sendes med, så rolle-raten kan slås op pr. evne.
        primaryType: rider.primary_type,
        secondaryType: rider.secondary_type,
        // Plan B (#1441): facilitets-magnitude + chef-specialisering. riderLevel
        // (u23/senior — #2529) styrer chefens niveau-affinitets-match pr. rytter.
        staff: trainingStaff,
        facilityTier: trainingFacilityTier,
        riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
        // ── #4846 (fase B2) ──────────────────────────────────────────────────
        // Alle tre er null/undefined naar flaget er off ⇒ dailyTraining.js
        // falder tilbage til dato-seed, cfg.daysPerSeason og Infinity-loftet,
        // altsaa BIT-IDENTISK med foer.
        tickSeedKey,
        budgetDivisor,
        hardDailyCap,
      };
      if (racedToday) {
        // #4850 variant A (ejer 24/9, S1 valgt efter simuleringen i #5640):
        // loebsdagen er et MELLEM-PAS paa etapens profil-evner, koert gennem den
        // samme applyDailyTick som en traeningsdag. Rytterens PLAN er ikke input
        // (ejer-dom 24/8): programmet bygges kun af profilen (raceDayProgram), saa
        // en hvile-plan giver stadig udvikling af at koere loeb. +1-loftet sendes
        // ALTID paa loebs-grenen, ogsaa paa den gamle kalenderdags-sti, hvor
        // hardDailyCap ellers er undefined. Profil-fallback 'rolling' er sat ovenfor.
        //
        // #4632 SEAM (variant B, dagens intention): effort-modifikatoren lever i
        // applyRaceDevelopmentTick (dailyTraining.js) og laegges ovenpaa naar
        // race_day_intention_enabled og v4 taendes. Den sendes BEVIDST IKKE her.
        tickResult = applyDailyTick({
          ...sharedTickArgs,
          program: raceDayProgram(racedRiderProfileByRider.get(rider.id) ?? RACE_DAY_FALLBACK_PROFILE),
          hardDailyCap: TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay,
        });
      } else {
        tickResult = applyDailyTick(sharedTickArgs);
      }
    }

    // Træthed + form for næste dag. #3459 D3: recoveryBase/recoveryFraction følger
    // race_day_engine_enabled — udeladt (flag off) = CONDITION_CONFIG's status quo
    // (bit-identisk); on = RACE_DAY_ENGINE_RECOVERY_CONFIG (4.5/0.15, empirisk valgt).
    //
    // #4277: BEVIDST `raceDayEngineOn`, ikke udviklings-flagget. Restitutions-
    // konstanterne er kalibreret mod HELE populationens træthedsfordeling (median
    // 57 mod 67 med de gamle tal), ikke mod løbsdags-udviklingen. At slukke
    // udviklingen må ikke rulle dem tilbage — det var netop koblingen der gjorde
    // "sluk udviklingen for S3" umulig før dette split.
    const newFatigue = nextFatigue({
      fatigue: preFatigue,
      intensity: effectiveIntensity,
      recoveryAbility: abilities.recovery ?? 50,
      ...(raceDayEngineOn ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {}),
    });
    const newForm = nextForm({ form: Number(cond.form ?? 50), fatigue: newFatigue });

    // Ny skade? (kun for raske ryttere, baseret på PRE-tick træthed)
    let newInjuredUntil = cond.injured_until ?? null;
    let newInjuryCause = cond.injury_cause ?? null;
    let injuryDays = 0;
    let newlyInjured = false;
    // #5462: loebsdags-sandheden. Kun relevant paa loebsdags-aksen; paa den gamle sti
    // forlader ingen af de tre vaerdier denne blok (ingen kolonner skrives).
    let newInjuryEndGameDay = cond.injury_end_game_day ?? null;
    let newInjurySeasonId = cond.injury_season_id ?? null;
    // A previous season's coordinate cannot be looked up on the new axis.
    // Keep injured_until as the conservative calendar fallback.
    if (useRaceDayKey && newInjurySeasonId !== seasonId) {
      newInjuryEndGameDay = null;
      newInjurySeasonId = null;
    }

    if (!injuredToday) {
      const risk = injuryRisk({ intensity: effectiveIntensity, fatigue: preFatigue });
      if (risk > 0) {
        // #4846 A3: skade-rullet seedes paa SAMME scope som traenings-stoejen.
        // Med dato-seed ville to loebsdage samme kalenderdag give identisk
        // skade-udfald; rollInjury bruger `dateStr` udelukkende som seed-hale,
        // saa scopet kan skiftes her uden at roere riderCondition.js.
        // #5462 (ejer-laast 15/9, §13.3 pkt. 7): VARIGHEDEN er nu i LOEBSDAGE paa
        // loebsdags-aksen, skaleret med saesonens loebsdage pr. kalenderdato
        // (ejer-valg 22/9). De efterfoelgende skalerede ticks mistes.
        // `injured_until` udledes af den
        // efter loekken (ÉT batch-opslag for hele holdets nye skader); indtil da staar
        // kalenderdagen som fallback, saa en skade ALTID bliver skrevet, ogsaa hvis
        // kalenderopslaget ikke kan svare.
        const roll = rollInjury({ riderId: rider.id, dateStr: seedScope, risk });
        if (roll.injured) {
          injuryDays = roll.days;
          newlyInjured = true;
          // Skaden starter EFTER dagens session (inkl. i morgen og frem).
          newInjuredUntil = addDaysToDate(tickDate, roll.days);
          newInjuryCause = "training_overload";
          if (useRaceDayKey) {
            newInjuryEndGameDay = injuryEndGameDay({ gameDay: raceDay, days: roll.days, seasonNumber });
            newInjurySeasonId = newInjuryEndGameDay == null ? null : seasonId;
          }
        }
      }
    }

    // Ryd skade når den er passeret.
    if (useRaceDayKey) {
      // #5462: paa loebsdags-aksen afgoeres raskmeldingen af LOEBSDAGEN naar den
      // findes — ellers af datoen, praecis som foer. En skade fra FOER flippet har
      // ingen loebsdag og loeber derfor faerdig paa kalenderdage (overgangs-reglen:
      // ingen igangvaerende skade skifter betydning tavst).
      //
      // `!newlyInjured` er med HER og bevidst IKKE paa den gamle sti nedenfor: en
      // rytter hvis skade udloeb i gaar, og som bliver skadet igen i dag, faar paa
      // den gamle sti sin friske skade nulstillet af dette led (fejl der er aeldre
      // end #5462 — se slutrapportens out-of-scope-fund). Flag off skal vaere
      // bit-identisk, saa den bliver staaende som den er.
      if (!newlyInjured && cond.injured_until
        && !isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: raceDay, tickDate })) {
        newInjuredUntil = null;
        newInjuryCause = null;
        newInjuryEndGameDay = null;
        newInjurySeasonId = null;
      }
    } else if (cond.injured_until && cond.injured_until < tickDate) {
      newInjuredUntil = null;
      newInjuryCause = null;
    }

    // Saml ability-patch: gains fra tick + opdateret progress + evt. initierede caps.
    const abilityPatch = {};
    if (tickResult) {
      // Skriv de opdaterede abilities tilbage (kun dem der faktisk steg).
      for (const k of VISIBLE_ABILITIES) {
        if (tickResult.abilities[k] !== abilities[k]) {
          abilityPatch[k] = tickResult.abilities[k];
        }
      }
      abilityPatch.ability_progress = tickResult.progress;
    }
    if (capsChanged) {
      abilityPatch.ability_caps = caps;
    }
    // #2437: season_budget_baseline/season_budget_season skrives IKKE længere —
    // sæson-loftet er fjernet (se blok-kommentaren ved tickCaps ovenfor). Kolonnerne
    // er droppet fra skemaet (#2590, database/2026-07-19-drop-season-budget-cols.sql).
    if (Object.keys(abilityPatch).length > 0) {
      abilityUpdates.push({ riderId: rider.id, patch: abilityPatch });
    }

    // #2000 Udvikling-fane: snapshot den fulde post-tick evnevektor de dage rytteren
    // FAKTISK fik en evne-gevinst (mindst én VISIBLE_ABILITIES-nøgle i patchen — ikke
    // bare progress/caps). Flade dage springes over; Recharts connectNulls + season-/
    // baseline-punkter holder kurven sammenhængende. Persisteres best-effort i Phase 2.
    if (tickResult && VISIBLE_ABILITIES.some((k) => k in abilityPatch)) {
      const snapshot = {};
      for (const k of VISIBLE_ABILITIES) snapshot[k] = tickResult.abilities[k];
      historyRows.push({
        rider_id: rider.id,
        snapshot_date: tickDate,
        source: "daily_training",
        season_number: seasonNumber,
        abilities: snapshot,
      });
      // #4846: paa loebsdags-aksen skrives snapshottet OGSAA til soesterbordet, som
      // har (rider_id, season_id, game_day, source) som noegle. Den gamle tabel
      // beholder sin kalenderdags-noegle — hele vaerditrend-/rating-laesesiden
      // (riderValueTrend, proRiderHistory, marketValueSundaySweep,
      // riderRatingTrajectory) haenger paa den, og en divisionsafhaengig takt dér
      // ville give systematisk forskellige kurver mellem D1 og D4 (spec §3.2).
      if (useRaceDayKey) {
        raceDayHistoryRows.push({
          rider_id: rider.id,
          season_id: seasonId,
          game_day: raceDay,
          source: racedToday ? "race_development" : "daily_training",
          season_number: seasonNumber,
          snapshot_date: tickDate,
          abilities: snapshot,
        });
      }
    }

    // ── #4851: traeningsscoren for dagens pas ────────────────────────────────
    // ÉN raekke pr. rytter pr. pas. Skrivningen sker i SAMME kald som tick'et
    // (Phase 2 nedenfor), bag samme reservation/mutex som resten af dagen, saa
    // en score aldrig kan staa uden det tick den beskriver.
    //
    // Tre tilstande, praecis som spec §4.4 kraever:
    //   hviledag / skadet   ⇒ INGEN raekke (der var intet pas at maale)
    //   loebsdag            ⇒ raekke med score NULL + was_race_day (fladen: "loeb")
    //   traeningsdag        ⇒ raekke med tallet 1-99 + de stoerste bidrag
    // `intention` er NULL i fase A: race_entries har ingen intentions-kolonne
    // endnu (#4632). Kolonnen findes for at den kan udfyldes uden migration.
    const scoreDetail = tickResult?.trainingScore ?? null;
    if (scoreDetail) {
      scoreRows.push({
        rider_id: rider.id,
        team_id: teamId,
        season_id: seasonId,
        tick_date: tickDate,
        game_day: useRaceDayKey ? raceDay : null,
        score: racedToday ? null : scoreDetail.score,
        session: scoreDetail.session,
        day_type: scoreDetail.dayType,
        was_race_day: racedToday,
        intention: null,
        contributions: racedToday ? null : scoreDetail.contributions,
      });
    } else if (boundRestToday && rodeToday) {
      // #4847: rytteren KOERTE en etape, men fik intet tick fordi udviklingen er
      // slukket. Uden denne raekke ville traeningsfladen vise et HUL netop paa de
      // dage hvor der skete mest — spec par. 4.4's tre tilstande kraever "loebsdag
      // ⇒ raekke med score NULL + was_race_day". `session`/`day_type` er NULL:
      // han koerte ikke et pas, og kolonnerne er nullable netop til det.
      // En GT-HVILEDAG (boundRestToday uden rodeToday) faar bevidst INGEN raekke —
      // det er "hviledag" i de tre tilstande, ikke "loebsdag".
      scoreRows.push({
        rider_id: rider.id,
        team_id: teamId,
        season_id: seasonId,
        tick_date: tickDate,
        game_day: raceDay,
        score: null,
        session: null,
        day_type: null,
        was_race_day: true,
        intention: null,
        contributions: null,
      });
    }

    // Gennembruds-detalje (#1305 polish): faktisk tal-spring pr. gevinst, så
    // rapporten kan vise "71 → 72" frem for flad "+1". from = pre-tick, to = post-tick.
    const gainsDetail = {};
    if (tickResult) {
      for (const [ability, n] of Object.entries(tickResult.gains)) {
        if (n > 0) {
          gainsDetail[ability] = { from: abilities[ability] ?? 0, to: tickResult.abilities[ability] };
        }
      }
    }

    // Condition upsert (altid — fatigue/form ændrer sig selv på hviledage).
    // #5462: de tre loebsdags-kolonner sendes KUN paa loebsdags-aksen. Flag off er
    // dermed bit-identisk helt ned i payloaden — upsert-stien roerer kun de kolonner
    // den faar med, saa en eksisterende raekkes loebsdags-felter er ogsaa urørte.
    conditionUpserts.push({
      rider_id: rider.id,
      form: newForm,
      fatigue: newFatigue,
      injured_until: newInjuredUntil,
      injury_cause: newInjuryCause,
      updated_at: now.toISOString(),
      ...(useRaceDayKey
        ? {
          injury_end_game_day: newInjuryEndGameDay,
          injury_season_id: newInjurySeasonId,
          // Denormaliseret rest, opfrisket ved HVERT tick fra den absolutte
          // sandhed (slut-loebsdagen). Et misset tick selvheler derfor paa det
          // naeste; feltet er aldrig en nedtaelling der kan drive.
          injury_race_days_left: newInjuryEndGameDay == null
            ? null
            : injuryRaceDaysLeft({ endGameDay: newInjuryEndGameDay, currentGameDay: raceDay }),
        }
        : {}),
    });

    // Rapport-linje pr. rytter.
    reportRiders.push({
      rider_id: rider.id,
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      score: tickResult?.score ?? 0,
      gains: tickResult?.gains ?? {},
      gains_detail: gainsDetail,
      // #3924 trin 2: pre-tick fremdrift — kun til frontend-udledning af dagens
      // bidrag til "på vej mod næste point"-baren, aldrig til ny trænings-logik.
      progress_before: preProgress,
      status: tickResult?.status ?? "rest",
      form: newForm,
      fatigue: newFatigue,
      fatigue_delta: newFatigue - preFatigue,
      injured: injuredToday || newlyInjured,
      injury_days: injuryDays,
      focus: program.focus,
      intensity: effectiveIntensity,
      focus_source: plan ? "plan" : "auto",
      // #3459 D1 — additivt rapport-felt (fremtidig UI, jf. spec V3 "Løbsdag —
      // dagens træning erstattes af løbet"). false når flag off (bit-identisk
      // datamodel, ingen eksisterende consumer læser feltet endnu).
      race_day: racedToday,
      // #4847 (ejer-regel 3): rytteren er BUNDET til et loeb paa denne loebsdag —
      // enten fordi han koerer, eller fordi han er inde i et etapeloebs spaend
      // (GT-hviledag). Additivt rapport-felt, altid false paa den gamle sti.
      bound_race_day: boundToday,
      // #4846: hvilken loebsdag ticket hoerer til. null paa den gamle sti.
      game_day: useRaceDayKey ? raceDay : null,
    });
  }

  // ── #5462: udled `injured_until` af slut-LOEBSDAGEN ──────────────────────────
  // ÉT batch-opslag for hele holdets tick, efter loekken — ikke ét pr. skadet rytter.
  // Datoen er den foerste loebsdag >= slut-loebsdagen der rent faktisk har en etape
  // i divisionens kalender (en tom loebsdag har ingen raekke, CALENDAR_RULES §1e-b),
  // og derfor siger UI'et "ca. <dato>".
  //
  // FAIL-SAFE: svarer opslaget ikke (ingen division, tom kalender, DB-fejl), BLIVER
  // kalenderdagens fallback staaende paa `injured_until`. Skaden bliver altid skrevet;
  // loebsdags-felterne baerer stadig den praecise sandhed, og motorens egen
  // raskmelding laeser dem — kun gatens dato er saa et skoen.
  if (useRaceDayKey) {
    const needDates = conditionUpserts.filter((row) => row.injury_end_game_day != null);
    if (needDates.length) {
      const divisionId = await loadTeamDivisionId({ supabase, teamId });
      const dateByGameDay = await resolveInjuryEndDates({
        supabase,
        seasonId,
        divisionId,
        endGameDays: needDates.map((row) => row.injury_end_game_day),
      });
      for (const row of needDates) {
        const dateStr = dateByGameDay.get(row.injury_end_game_day) ?? null;
        if (dateStr) row.injured_until = dateStr;
      }
    }
  }

  } catch (phase1Err) {
    // Load/beregnings-fejl: slet reservationen så holdet kan retrye samme dag.
    try {
      await runRowFilter(supabase.from("training_day_runs").delete());
    } catch { /* swallow — original fejl er vigtigst */ }
    throw phase1Err;
  }

  // ── Phase 2: Writes ───────────────────────────────────────────────────────────
  // Fra dette punkt er writes i gang: ved fejl bevares reservationen BEVIDST (blokeret dag er
  // sikrere end dobbelt-tick efter delvise ability-writes). Manuel recovery: slet rækken.

  // ── 5) Persistér ─────────────────────────────────────────────────────────────
  // Ability-updates (gains + progress + evt. caps).
  await runBatched(abilityUpdates, 25, ({ riderId, patch }) =>
    supabase.from("rider_derived_abilities")
      .update(patch)
      .eq("rider_id", riderId)
      .then(({ error }) => {
        if (error) throw new Error(`abilities update ${riderId}: ${error.message}`);
      }));

  // #2000 Udvikling-fane: best-effort historik-snapshot EFTER abilities er persisteret.
  // En fejl her må ALDRIG kaste/rulle træningsdagen tilbage (afledt visning, ikke
  // spil-state) → fang + log. Idempotent via UNIQUE(rider_id,snapshot_date,source).
  if (historyRows.length > 0) {
    try {
      for (let i = 0; i < historyRows.length; i += 500) {
        const { error } = await supabase
          .from("rider_derived_ability_history")
          .upsert(historyRows.slice(i, i + 500), { onConflict: "rider_id,snapshot_date,source", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
    } catch (histErr) {
      console.error(`  ⚠️ ability-history snapshot (daily) fejlede for hold ${teamId}:`, histErr.message);
    }
  }

  // #4846: loebsdags-snapshottet. Samme best-effort-kontrakt som ovenfor — en fejl
  // her maa ALDRIG kaste (afledt visning, ikke spil-state). Idempotent via
  // UNIQUE(rider_id, season_id, game_day, source).
  if (raceDayHistoryRows.length > 0) {
    try {
      for (let i = 0; i < raceDayHistoryRows.length; i += 500) {
        const { error } = await supabase
          .from("rider_ability_race_day_history")
          .upsert(raceDayHistoryRows.slice(i, i + 500), {
            onConflict: "rider_id,season_id,game_day,source", ignoreDuplicates: true,
          });
        if (error) throw new Error(error.message);
      }
    } catch (histErr) {
      // best-effort: loebsdags-snapshottet er AFLEDT visning, ikke spil-state. Et
      // kast her ville vaelte en traeningsdag hvis evne-writes allerede er landet
      // (Phase 2 bevarer reservationen med vilje) — samme kontrakt som
      // kalenderdags-historikken ovenfor. Fejlen logges, dagen staar.
      console.error(`  ⚠️ ability-history snapshot (race day) fejlede for hold ${teamId}:`, histErr.message);
    }
  }

  // #4851: traeningsscoren. Samme best-effort-kontrakt som historik-snapshottene
  // ovenfor — scoren er AFLEDT visning (+ en kvittering paa dagens kvalitet),
  // ikke spil-state, og et kast her ville vaelte en traeningsdag hvis
  // evne-writes allerede er landet. Bart INSERT: de to partielle unikke indexe
  // (database/2026-09-15-4851-rider-training-scores.sql) rejser 23505 hvis
  // raekken allerede findes, og en gentagelse er praecis det
  // training_day_runs-reservationen i forvejen forhindrer.
  if (scoreRows.length > 0) {
    try {
      for (let i = 0; i < scoreRows.length; i += 500) {
        const batch = scoreRows.slice(i, i + 500);
        const { error } = await supabase.from("rider_training_scores").insert(batch);
        if (!error) continue;
        if (error.code !== "23505") throw new Error(error.message);
        // 23505 paa et MULTI-row INSERT afbryder HELE saetningen: de raekker der
        // IKKE var dubletter ville gaa tavst tabt hvis vi bare gik videre. Det
        // kan ske selv med training_day_runs-reservationen, fordi score-noeglen
        // ikke indeholder team_id — en rytter der er skiftet hold beholder sine
        // gamle raekker. Vi falder derfor tilbage til raekke-for-raekke og
        // sluger kun den enkelte dublet.
        for (const row of batch) {
          const { error: rowError } = await supabase.from("rider_training_scores").insert(row);
          if (rowError && rowError.code !== "23505") throw new Error(rowError.message);
        }
      }
    } catch (scoreErr) {
      // best-effort: scoren er AFLEDT visning (+ en kvittering paa dagens
      // kvalitet), ikke spil-state. Et kast her ville vaelte en traeningsdag
      // hvis evne-writes allerede er landet (Phase 2 bevarer reservationen med
      // vilje) — samme kontrakt som historik-snapshottene ovenfor. Fejlen
      // logges, dagen staar, og naeste tick skriver videre.
      console.error(`  ⚠️ training-score write fejlede for hold ${teamId}:`, scoreErr.message);
    }
  }

  // Condition upserts.
  if (conditionUpserts.length) {
    for (let i = 0; i < conditionUpserts.length; i += 500) {
      const { error } = await supabase
        .from("rider_condition")
        .upsert(conditionUpserts.slice(i, i + 500), { onConflict: "rider_id" });
      if (error) throw new Error(`condition upsert: ${error.message}`);
    }
  }

  // Opdatér training_day_runs-row med det rigtige rapport-indhold.
  const report = {
    riders: reportRiders,
    bonus_applied: bonus,
    executed_by: executedBy,
    tick_date: tickDate,
    game_day: useRaceDayKey ? raceDay : null,
  };
  const { error: updateError } = await runRowFilter(
    supabase.from("training_day_runs").update({ report }),
  );
  if (updateError) throw new Error(`training_day_runs update: ${updateError.message}`);

  return { alreadyRan: false, tickDate, gameDay: useRaceDayKey ? raceDay : null, squad: squadKey, report };
}
