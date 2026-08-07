// Daglig trænings-orchestrator (#1305) — eksekverer ÉN trænings-dag for ÉT hold.
//
// Idempotent via UNIQUE(team_id, tick_date) i training_day_runs: reservation-first
// strategi bruger en pending-row som mutex. Postgres 23505 unique-violation ved INSERT
// → alreadyRan=true uden videre DB-skriv.
//
// Spejler riderProgressionEngine.js: DI-supabase, loft genberegnet pr. tick
// (buildCapsForRider, #2471 — ikke lazy-initeret), batched writes (runBatched),
// ageForSeason-helper genbrugt herfra.
//
// Kaldes af: POST /api/training/run-today (manager, bonus=true) + cron-sweep
// (assistant, bonus=false). Ingen nondeterminisme udover `now`-default +
// updated_at-timestamps.

import { copenhagenDateString, copenhagenWeekdayKey, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { resolveProgram, applyDailyTick, applyRaceDevelopmentTick } from "./dailyTraining.js";
import { resolveDayIntensity } from "./training.js";
import { nextFatigue, nextForm, conditionMultiplier, injuryRisk, rollInjury, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { buildCapsForRider, sameCaps } from "./riderProgression.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { isAcademyAge, ACADEMY } from "./academyFlag.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { riderLevelBand } from "./staffAbilityConstants.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";

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
// helt hold pga. én best-effort-berigelse. Kun kaldt når raceDayEngineOn (kald-
// stedet sender Promise.resolve({data:[],error:null}) når flag off — ingen ekstra
// DB-belastning for en slukket feature).
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
 * @returns {Promise<{ alreadyRan: boolean, tickDate: string, report?: object }>}
 */
export async function runTeamTrainingDay({
  supabase, teamId, seasonId, seasonNumber, executedBy, now = new Date(),
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");
  if (!seasonId) throw new Error("seasonId required");
  if (!Number.isFinite(seasonNumber)) throw new Error("seasonNumber required");
  if (executedBy !== "manager" && executedBy !== "assistant") {
    throw new Error(`executedBy must be 'manager' or 'assistant', got: ${executedBy}`);
  }

  const tickDate = copenhagenDateString(now);
  const bonus = executedBy === "manager";

  // ── 1) Reservation: INSERT pending-row; 23505 → alreadyRan ───────────────────
  const { error: insertError } = await supabase
    .from("training_day_runs")
    .insert({
      team_id: teamId,
      tick_date: tickDate,
      executed_by: executedBy,
      bonus_applied: bonus,
      report: { pending: true },
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { alreadyRan: true, tickDate };
    }
    throw new Error(`training_day_runs insert: ${insertError.message}`);
  }

  // ── Phase 1: Loads + ren beregning (ingen writes) ────────────────────────────
  // Ved fejl her slettes reservationen, så holdet kan retrye samme dag.
  let abilityUpdates, conditionUpserts, reportRiders, historyRows;
  try {
  // ── 2) Load riders (ikke-pensionerede, dette hold) ──────────────────────────
  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select("id, primary_type, secondary_type, potentiale, birthdate, firstname, lastname, team_id, is_academy")
    .eq("team_id", teamId)
    .eq("is_retired", false);
  if (ridersError) throw new Error(`riders load: ${ridersError.message}`);
  if (!riders || riders.length === 0) {
    const emptyReport = { riders: [], bonus_applied: bonus, executed_by: executedBy, tick_date: tickDate };
    await supabase.from("training_day_runs")
      .update({ report: emptyReport })
      .eq("team_id", teamId)
      .eq("tick_date", tickDate);
    return { alreadyRan: false, tickDate, report: emptyReport };
  }

  const riderIds = riders.map((r) => r.id);

  // #3459 D1: flaget afgør om løbsdags-lookuppet overhovedet skal køre — læst FØR
  // batch-Promise.all'et så den betingede query kan indgå i samme batch (kodemap-
  // kravet: "i samme Promise.all som øvrige hold-inputs") uden at spilde en query
  // på en slukket feature.
  const raceDayEngineOn = await isRaceDayEngineEnabled(supabase);

  // ── 3) Load abilities, training plans + condition i parallell ─────────────────
  const [
    { data: abilityRows, error: abilityError },
    { data: planRows, error: planError },
    { data: conditionRows, error: conditionError },
    { data: weekPlanRow, error: weekPlanError },
    raceDayResult,
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
    // #3459 D1: kun query'et når flagget er on — flag off giver en no-op-promise
    // (bit-identisk med før #3459, ingen ekstra DB-kald).
    raceDayEngineOn
      ? loadRacedRiderIdsToday(supabase, riderIds, now, tickDate)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (abilityError) throw new Error(`abilities load: ${abilityError.message}`);
  if (planError) throw new Error(`plans load: ${planError.message}`);
  if (conditionError) throw new Error(`condition load: ${conditionError.message}`);
  if (weekPlanError) throw new Error(`week plan load: ${weekPlanError.message}`);

  // #3459 D1 fail-safe: query-fejl → tom mængde (INGEN løbsdag antaget), log warning.
  // Kaster ALDRIG — en fejlet best-effort-berigelse må ikke vælte hele holdets
  // trænings-dag (samme filosofi som Plan B's facilitets-load, #1441).
  let racedRiderIds = new Set();
  // #3459 D2: rider_id → profil-type for dagens løb (RACE_PROFILE_ABILITY_MAP-nøgle).
  // Fallback pr. rytter = 'rolling' (samme ukendt-profil-fallback som raceFatigueLoad)
  // — sat eksplicit nedenfor, IKKE først inde i applyRaceDevelopmentTick, så en
  // manglende race_stage_profiles-række aldrig kan give en udefineret evneliste.
  const racedRiderProfileByRider = new Map();
  if (raceDayEngineOn) {
    if (raceDayResult.error) {
      // ASCII-only besked (#i18n-leak-guard, BACKEND_CONTEXT matcher error/message-linjer med
      // æ/ø/å) — dette er intern ops-logging, ikke en spiller-synlig API-fejl.
      console.warn(`  ⚠️ race-day lookup failed for team ${teamId} (${tickDate}): ${raceDayResult.error.message} - assuming no race day (fail-safe)`);
    } else {
      const racedRows = raceDayResult.data ?? [];
      racedRiderIds = new Set(racedRows.map((r) => r.rider_id));

      // #3459 D2: hent profil-typen for de racede etaper — kun de race_id'er der
      // rent faktisk optræder i dagens racede rækker (typisk 0-1 pr. hold pr. dag).
      const raceIds = [...new Set(racedRows.map((r) => r.race_id).filter(Boolean))];
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
    program.intensity = resolveDayIntensity({
      weekday,
      riderOverrideDays: riderOverrideByRider.get(rider.id) ?? null,
      teamWeekDays,
      planIntensity: program.intensity,
      hasExplicitPlan,
    });

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

    // #2437 — MIDLERTIDIG INTERIM (ejer-godkendt 15/7), fjernes igen når den rigtige
    // model (jævn alders-taper, egen session) lander. Rod-årsag (verificeret, IKKE
    // issue-tekstens diagnose): #2202 lod akademi-alder få et SÆSON-loft
    // (computeAcademySeasonCeiling/SEASON_FRAC_BY_AGE, #2082/#1938) sendt som `caps`
    // til applyDailyTick i stedet for livstids-loftet. dailyAbilityDelta's gap
    // (=cap−current) faldt fra ~17,9 til ~2,0 → dagsraten kollapsede ~9x og aftog
    // derefter eksponentielt resten af sæsonen. Det var IKKE pulje-udtømning —
    // sæson-budgettet stod 83% ubrugt i prod, fordi raten MOD budgettet selv aftog
    // for hurtigt til nogensinde at nå det.
    // Interim: INTET sæson-loft — tickCaps = livstids-loftet (`caps`) for ALLE
    // ryttere. I stedet dæmpes akademi-alderens daglige rate direkte via
    // ACADEMY.INTERIM_RATE_MULT (=1/3, kalibreret i careerCurveSimulation.js mod
    // ægte prod-population). hardDailyCap (#2082/#1938-sikkerhedsnettet) er uændret.
    const inAcademy = isAcademyAge(age);
    const tickCaps = caps;

    // Er rytteren skadet i dag?
    const injuredToday = !!(cond.injured_until && cond.injured_until >= tickDate);

    // #3459 D1: racede rytteren i dag (flag on)? injuredToday har forrang (kan i
    // praksis ikke ske samtidig — en skadet rytter stilles ikke til start — men
    // defensivt konsistent med resten af grenen).
    const racedToday = !injuredToday && raceDayEngineOn && racedRiderIds.has(rider.id);

    // Pre-tick træthed til skaderisiko-beregning (brug den aktuelle, ikke den næste).
    const preFatigue = Number(cond.fatigue ?? 0);
    // D1: "race" er bevidst IKKE en gyldig DAILY_TRAINING_CONFIG.intensities-nøgle —
    // DAILY_TRAINING_CONFIG.fatigueLoad["race"] er undefined → nextFatigue's
    // `?? 0`-fallback giver PRÆCIS D1-semantikken (intet trænings-load, IKKE
    // rest-intensitetens -14). Samme "??0"-mekanisme injuryRisk() læner sig på
    // nedenfor (intensity !== "hard" → 0 risiko — ingen trænings-skaderisiko på
    // løbsdage, se "Åbne designbeslutninger" i PR-body).
    const effectiveIntensity = injuredToday ? "rest" : racedToday ? "race" : program.intensity;

    // Daglig tick: raske ryttere får ENTEN en normal træningsdag ELLER (racede i
    // dag) en race-udviklings-dag — GENSIDIGT UDELUKKENDE grene i samme if/else,
    // så dobbelt-kredit er umulig by construction (#3459 D2). Skadede ryttere får
    // ingen af delene (no gains, program.intensity/training_plans RØRES ALDRIG —
    // G5-invarianten).
    let tickResult = null;
    if (!injuredToday && age != null) {
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
        progress: abRow.ability_progress ?? {},
        program,
        conditionMult: condMult,
        bonus,
        potentiale: rider.potentiale,
        hardDailyCap: inAcademy ? ACADEMY.HARD_DAILY_CAP : undefined,
        // #2437 interim: akademi-alderens rate dæmpes direkte (se blok-kommentaren
        // ved tickCaps ovenfor); voksne uændret (1.0 = bit-identisk).
        academyRateMult: inAcademy ? ACADEMY.INTERIM_RATE_MULT : 1.0,
        // Plan B (#1441): facilitets-magnitude + chef-specialisering. riderLevel
        // (u23/senior — #2529) styrer chefens niveau-affinitets-match pr. rytter.
        staff: trainingStaff,
        facilityTier: trainingFacilityTier,
        riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
      };
      if (racedToday) {
        // #3459 D2: profil-typen slås op pr. rytter (racedRiderProfileByRider,
        // fallback 'rolling' allerede sat ovenfor) — devMult følger
        // RACE_DEV_CONFIG's default (1.15) via applyRaceDevelopmentTick.
        tickResult = applyRaceDevelopmentTick({
          ...sharedTickArgs,
          profileType: racedRiderProfileByRider.get(rider.id) ?? "rolling",
        });
      } else {
        tickResult = applyDailyTick(sharedTickArgs);
      }
    }

    // Træthed + form for næste dag. #3459 D3: recoveryBase/recoveryFraction følger
    // race_day_engine_enabled — udeladt (flag off) = CONDITION_CONFIG's status quo
    // (bit-identisk); on = RACE_DAY_ENGINE_RECOVERY_CONFIG (4.5/0.15, empirisk valgt).
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

    if (!injuredToday) {
      const risk = injuryRisk({ intensity: effectiveIntensity, fatigue: preFatigue });
      if (risk > 0) {
        const roll = rollInjury({ riderId: rider.id, dateStr: tickDate, risk });
        if (roll.injured) {
          injuryDays = roll.days;
          newlyInjured = true;
          // Skaden starter EFTER dagens session (inkl. i morgen og frem).
          newInjuredUntil = addDaysToDate(tickDate, roll.days);
          newInjuryCause = "training_overload";
        }
      }
    }

    // Ryd skade når injured_until er passeret.
    if (cond.injured_until && cond.injured_until < tickDate) {
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
    conditionUpserts.push({
      rider_id: rider.id,
      form: newForm,
      fatigue: newFatigue,
      injured_until: newInjuredUntil,
      injury_cause: newInjuryCause,
      updated_at: now.toISOString(),
    });

    // Rapport-linje pr. rytter.
    reportRiders.push({
      rider_id: rider.id,
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      score: tickResult?.score ?? 0,
      gains: tickResult?.gains ?? {},
      gains_detail: gainsDetail,
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
    });
  }

  } catch (phase1Err) {
    // Load/beregnings-fejl: slet reservationen så holdet kan retrye samme dag.
    try {
      await supabase.from("training_day_runs")
        .delete()
        .eq("team_id", teamId)
        .eq("tick_date", tickDate);
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
  };
  const { error: updateError } = await supabase
    .from("training_day_runs")
    .update({ report })
    .eq("team_id", teamId)
    .eq("tick_date", tickDate);
  if (updateError) throw new Error(`training_day_runs update: ${updateError.message}`);

  return { alreadyRan: false, tickDate, report };
}
