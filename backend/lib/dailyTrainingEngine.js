// Daglig trænings-orchestrator (#1305) — eksekverer ÉN trænings-dag for ÉT hold.
//
// Idempotent via UNIQUE(team_id, tick_date) i training_day_runs: reservation-first
// strategi bruger en pending-row som mutex. Postgres 23505 unique-violation ved INSERT
// → alreadyRan=true uden videre DB-skriv.
//
// Spejler riderProgressionEngine.js: DI-supabase, caps-lazy-init (buildCaps), batched
// writes (runBatched), ageForSeason-helper genbrugt herfra.
//
// Kaldes af: POST /api/training/run-today (manager, bonus=true) + cron-sweep
// (assistant, bonus=false). Ingen nondeterminisme udover `now`-default +
// updated_at-timestamps.

import { copenhagenDateString } from "./copenhagenTime.js";
import { resolveProgram, applyDailyTick, computeAcademySeasonCeiling } from "./dailyTraining.js";
import { nextFatigue, nextForm, conditionMultiplier, injuryRisk, rollInjury } from "./riderCondition.js";
import { buildCaps } from "./riderProgression.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { isAcademyAge, academySeasonFracForAge, ACADEMY } from "./academyFlag.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { riderLevelBand } from "./staffAbilityConstants.js";

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
    .select("id, primary_type, potentiale, birthdate, firstname, lastname, team_id, is_academy")
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

  // ── 3) Load abilities, training plans + condition i parallell ─────────────────
  const [
    { data: abilityRows, error: abilityError },
    { data: planRows, error: planError },
    { data: conditionRows, error: conditionError },
  ] = await Promise.all([
    supabase.from("rider_derived_abilities").select("*").in("rider_id", riderIds),
    supabase.from("training_plans")
      .select("rider_id, focus, intensity")
      .eq("team_id", teamId)
      .eq("season_id", seasonId),
    supabase.from("rider_condition").select("*").in("rider_id", riderIds),
  ]);

  if (abilityError) throw new Error(`abilities load: ${abilityError.message}`);
  if (planError) throw new Error(`plans load: ${planError.message}`);
  if (conditionError) throw new Error(`condition load: ${conditionError.message}`);

  const abilityByRider = new Map((abilityRows ?? []).map((a) => [a.rider_id, a]));
  const planByRider = new Map((planRows ?? []).map((p) => [p.rider_id, p]));
  const condByRider = new Map((conditionRows ?? []).map((c) => [c.rider_id, c]));

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
    const program = resolveProgram(plan);

    // Byg abilities-objekt kun fra VISIBLE_ABILITIES (ikke formula_version etc.)
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) {
      if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    }

    // Caps lazy-init: samme mønster som riderProgressionEngine.developRidersForSeason.
    let caps = abRow.ability_caps;
    const capsWasNull = !caps || typeof caps !== "object";
    if (capsWasNull) {
      caps = buildCaps(abilities, rider.primary_type, rider.potentiale);
    }

    // #2082/#1938 (ejer-godkendt 5/7): akademi-alder får et SÆSON-BUDGET-loft i stedet
    // for livstids-loftet direkte — væksten mætter ved sæsonens andel af gappet, uanset
    // hvor mange dage sæsonen varer (sæsonlængde er ikke en fast konstant, jf. #2082).
    // seasonBudgetBaseline snapshottes ved sæsonens FØRSTE tick (season_budget_season
    // matcher ikke den aktuelle seasonNumber) og genbruges resten af sæsonen.
    const inAcademy = isAcademyAge(age);
    let seasonBudgetBaseline = null;
    let seasonBudgetRefreshed = false;
    if (inAcademy) {
      const staleBaseline = abRow.season_budget_season !== seasonNumber
        || !abRow.season_budget_baseline || typeof abRow.season_budget_baseline !== "object";
      if (staleBaseline) {
        seasonBudgetBaseline = abilities; // snapshot FØR dagens tick
        seasonBudgetRefreshed = true;
      } else {
        seasonBudgetBaseline = abRow.season_budget_baseline;
      }
    }
    const tickCaps = inAcademy
      ? computeAcademySeasonCeiling({ seasonStartAbilities: seasonBudgetBaseline, lifetimeCaps: caps, frac: academySeasonFracForAge(age) })
      : caps;

    // Er rytteren skadet i dag?
    const injuredToday = !!(cond.injured_until && cond.injured_until >= tickDate);

    // Pre-tick træthed til skaderisiko-beregning (brug den aktuelle, ikke den næste).
    const preFatigue = Number(cond.fatigue ?? 0);
    const effectiveIntensity = injuredToday ? "rest" : program.intensity;

    // Daglig tick: kun på raske ryttere (skadet → no gains, behandles som rest).
    let tickResult = null;
    if (!injuredToday && age != null) {
      const condMult = conditionMultiplier({ form: Number(cond.form ?? 50), fatigue: preFatigue });
      tickResult = applyDailyTick({
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
        // Plan B (#1441): facilitets-magnitude + chef-specialisering. riderLevel
        // (youth/junior/senior) styrer chefens niveau-affinitets-match pr. rytter.
        staff: trainingStaff,
        facilityTier: trainingFacilityTier,
        riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
      });
    }

    // Træthed + form for næste dag.
    const newFatigue = nextFatigue({
      fatigue: preFatigue,
      intensity: effectiveIntensity,
      recoveryAbility: abilities.recovery ?? 50,
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
    if (capsWasNull) {
      abilityPatch.ability_caps = caps;
    }
    if (seasonBudgetRefreshed) {
      abilityPatch.season_budget_baseline = seasonBudgetBaseline;
      abilityPatch.season_budget_season = seasonNumber;
    }
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
