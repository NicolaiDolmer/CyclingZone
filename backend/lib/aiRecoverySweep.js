// AI-rytter-restitution (#3015) — daglig recovery-sweep for AI-holdenes ryttere.
//
// PROBLEMET: trainingSweep.js's daglige assistent-sweep filtrerer eksplicit
// is_ai=false (samme "rigtige hold"-diskriminator som boardAutoAccept.js /
// checkDebtWarnings — korrekt DÉR, fordi et AI-hold ikke skal have
// bestyrelsesbeskeder). Træthed er derimod ikke en spiller-notifikation, det er
// en rytter-fysiologisk tilstand der indgår direkte i raceSimulator.js's score
// (formComponent + fatigueComponent). Ved at genbruge diskriminatoren mistede
// AI-hold enhver daglig restitution: målt i prod 2026-07-26, 3.368 af 3.372
// AI-ryttere sad på det absolutte trætheds-loft (100), mod menneskeholdenes
// gennemsnit på 68,6 med reel spredning 0-100.
//
// FIXET (issuets minimale forslag 1, IKKE forslag 2 — se issue-diskussion):
// et separat, dedikeret dagligt tick der KUN kører den samme
// riderCondition.nextFatigue/nextForm-recovery som menneskeholdene får på en
// hviledag. Ingen ability-progression, ingen skaderisiko, ingen trænings-plan —
// AI-ryttere får IKKE spillerens træningsvalg, kun den fysiologiske restitution
// alle andre ryttere er designet til at have. Ingen ny balance-konstant.
//
// Mønster: mirror af trainingSweep.js (samme kl. 22 dansk tid-vindue via
// shouldSweepNow, samme daily_training_enabled-flag, samme
// reservation-som-mutex-idiom, samme per-hold try/catch-isolation), men med sin
// EGEN mutex-tabel (ai_recovery_runs — se database/2026-08-03-ai-recovery-runs.sql)
// i stedet for at genbruge training_day_runs (CHECK executed_by IN
// ('manager','assistant'), menneske-rettet report-skema).

import { copenhagenDateString } from "./copenhagenTime.js";
import { shouldSweepNow, teamsNeedingSweep } from "./trainingSweep.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { nextFatigue, nextForm } from "./riderCondition.js";
import { fetchAllRows } from "./supabasePagination.js";

export const UPSERT_CHUNK = 500;

// Rytter uden rider_derived_abilities-række (bør ikke forekomme, men samme
// fail-safe default som dailyTrainingEngine.js/seasonFatigueReset.js).
const DEFAULT_RECOVERY_ABILITY = 50;

/**
 * Reservér dagens tick for ét AI-hold. INSERT-som-mutex: 23505-kollision
 * betyder et andet sweep-tick allerede har taget denne dag for holdet.
 * @returns {Promise<boolean>} true hvis reservationen lykkedes
 */
async function reserveTeamTick(supabase, teamId, tickDate) {
  const { error } = await supabase
    .from("ai_recovery_runs")
    .insert({ team_id: teamId, tick_date: tickDate });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`ai_recovery_runs insert: ${error.message}`);
  }
  return true;
}

async function markTeamTickCount(supabase, teamId, tickDate, ridersRecovered) {
  const { error } = await supabase
    .from("ai_recovery_runs")
    .update({ riders_recovered: ridersRecovered })
    .eq("team_id", teamId)
    .eq("tick_date", tickDate);
  if (error) throw new Error(`ai_recovery_runs update: ${error.message}`);
}

/**
 * Kør recovery-ticket for ét holds ryttere. Ren fatigue/form-mutation —
 * rører IKKE abilities, ability_progress, injured_until eller injury_cause.
 * @returns {Promise<number>} antal ryttere opdateret
 */
export async function recoverRidersForTeam({ supabase, teamId, now = new Date() }) {
  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select("id")
    .eq("team_id", teamId)
    .eq("is_retired", false);
  if (ridersError) throw new Error(`riders load: ${ridersError.message}`);
  if (!riders || riders.length === 0) return 0;

  const riderIds = riders.map((r) => r.id);

  // Holdets rytter-antal er squad-størrelse (typisk < 30) — langt under
  // #3030's 100-id .in()-grænse, så ingen chunking nødvendig her.
  const [{ data: conditionRows, error: conditionError }, { data: abilityRows, error: abilityError }] =
    await Promise.all([
      supabase.from("rider_condition").select("rider_id, form, fatigue").in("rider_id", riderIds),
      supabase.from("rider_derived_abilities").select("rider_id, recovery").in("rider_id", riderIds),
    ]);
  if (conditionError) throw new Error(`condition load: ${conditionError.message}`);
  if (abilityError) throw new Error(`abilities load: ${abilityError.message}`);

  const condByRider = new Map((conditionRows ?? []).map((c) => [c.rider_id, c]));
  const recoveryByRider = new Map((abilityRows ?? []).map((a) => [a.rider_id, a.recovery]));

  const nowIso = now.toISOString();
  const upserts = riderIds.map((riderId) => {
    const cond = condByRider.get(riderId) ?? { fatigue: 0, form: 50 };
    const preFatigue = Number(cond.fatigue ?? 0);
    const recoveryAbility = recoveryByRider.has(riderId)
      ? recoveryByRider.get(riderId)
      : DEFAULT_RECOVERY_ABILITY;
    // Samme model som en menneskerytters hviledag: intensity "rest", ingen raceLoad
    // (denne sweep kender ikke til dagens løb — raceFatigue.js lægger evt. race-
    // belastning oveni via sin egen sti, uafhængigt af dette daglige tick).
    const newFatigue = nextFatigue({ fatigue: preFatigue, intensity: "rest", recoveryAbility });
    const newForm = nextForm({ form: Number(cond.form ?? 50), fatigue: newFatigue });
    // Rører KUN fatigue/form (+ updated_at) — supabase-js upsert opdaterer kun de
    // angivne kolonner på UPDATE-stien (samme kontrakt som seasonFatigueReset.js),
    // så injured_until/injury_cause bevares uændret.
    return { rider_id: riderId, fatigue: newFatigue, form: newForm, updated_at: nowIso };
  });

  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from("rider_condition").upsert(chunk, { onConflict: "rider_id" });
    if (error) throw new Error(`condition upsert: ${error.message}`);
  }

  return upserts.length;
}

/**
 * Kør assistent-recovery-sweep for AI-hold: samme daglige restitution som
 * menneskeholdene får, uden ability-progression/skaderisiko/træningsplan.
 *
 * @param {object} args
 * @param {object} args.supabase — service-role Supabase-client
 * @param {Date}   [args.now]    — referencetid
 * @param {Function} [args.isEnabled] — DI-hook til test; default isDailyTrainingEnabled
 * @returns {Promise<{swept: number, failed?: number, ridersRecovered: number, skipped?: string}>}
 */
export async function runAiRecoverySweep({
  supabase,
  now = new Date(),
  isEnabled = isDailyTrainingEnabled,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  if (!shouldSweepNow(now)) {
    return { swept: 0, ridersRecovered: 0, skipped: "before_window" };
  }

  const enabled = await isEnabled(supabase);
  if (!enabled) {
    return { swept: 0, ridersRecovered: 0, skipped: "flag_off" };
  }

  const tickDate = copenhagenDateString(now);

  const [teams, runs] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("teams")
        .select("id")
        .eq("is_ai", true)
        .eq("is_bank", false)
        .eq("is_frozen", false)
        .eq("is_test_account", false)
        .order("id")),
    fetchAllRows(() =>
      supabase
        .from("ai_recovery_runs")
        .select("team_id, tick_date")
        .eq("tick_date", tickDate)
        .order("team_id")),
  ]);

  const pending = teamsNeedingSweep(teams, runs, tickDate);

  let swept = 0;
  let failed = 0;
  let ridersRecovered = 0;

  for (const team of pending) {
    let reserved = false;
    try {
      reserved = await reserveTeamTick(supabase, team.id, tickDate);
      if (!reserved) continue; // et andet tick reserverede først i mellemtiden — ikke en fejl

      const n = await recoverRidersForTeam({ supabase, teamId: team.id, now });
      await markTeamTickCount(supabase, team.id, tickDate, n);
      swept += 1;
      ridersRecovered += n;
    } catch (err) {
      // best-effort: per-hold isolation (mirror af trainingSweep.js) — én fejl må
      // ikke stoppe resten af sweep'en. `failed` aggregeres og Sentry-captures af
      // cron.js's runAiRecoverySweepCron-wrapper (samme mønster som
      // runTrainingSweepCron), så fejlen forsvinder IKKE stille fra Sentry — den
      // rapporteres bare ét niveau højere end her.
      //
      // Bevidst FORENKLET vs. dailyTrainingEngine.js's Phase-1/2-split: fejler
      // riders-load/upsert EFTER reservationen er taget, slettes reservationen
      // IKKE. Konsekvensen er lav (holdet prøver igen i morgen — én ekstra dag på
      // høj træthed, ikke et permanent handicap som selve bug'en #3015), så den
      // ekstra kompleksitet ved en retry-samme-dag er ikke vurderet nødvendig her.
      failed += 1;
      console.error(`  ❌ AI-recovery sweep fejlede for hold ${team.id}:`, err.message);
    }
  }

  // Sentry-capture ved fejl håndteres af cron.js's wrapper (mirror af
  // runTrainingSweepCron/runScoutSweepCron-mønstret) — lib-funktionen forbliver
  // ren/testbar uden Sentry-afhængighed.
  const base = failed > 0 ? { swept, failed, ridersRecovered } : { swept, ridersRecovered };
  return base;
}
