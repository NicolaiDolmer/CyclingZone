// Assistent-sweep for daglig træning (#1305) — kører efter kl. 22 dansk tid for
// alle menneskelige hold der ikke allerede har trænet i dag. Idempotent: motoren
// bruger UNIQUE(team_id, tick_date) som mutex, så gentagne sweeps er harmløse.
//
// Hold-diskriminator: is_ai=false, is_bank=false, is_frozen=false,
// is_test_account=false — matcher boardAutoAccept.js + checkDebtWarnings (kanonik
// for "rigtige hold" i hele spillet).

import { copenhagenHour, copenhagenDateString } from "./copenhagenTime.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";

export const SWEEP_FROM_HOUR = 22;

/**
 * Er det tid til assistent-sweep? (dansk tid >= kl. 22)
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

/**
 * Filtrer hold der IKKE allerede har kørt træning for tickDate.
 * @param {Array<{id: string}>} teams
 * @param {Array<{team_id: string, tick_date: string}>} todaysRuns
 * @param {string} tickDate — YYYY-MM-DD
 * @returns {Array<{id: string}>}
 */
export function teamsNeedingSweep(teams, todaysRuns, tickDate) {
  const ranToday = new Set(
    todaysRuns.filter((r) => r.tick_date === tickDate).map((r) => r.team_id)
  );
  return teams.filter((t) => !ranToday.has(t.id));
}

/**
 * Kør assistent-sweep: træner alle menneskelige hold der ikke allerede har
 * trænet i dag. Kalder runTeamTrainingDay sekventielt pr. hold så én fejl
 * ikke stopper resten.
 *
 * @param {object} args
 * @param {object} args.supabase     — service-role Supabase-client
 * @param {Date}   [args.now]        — referencetid (default new Date())
 * @param {Function} [args.runDay]   — DI-hook til test; default runTeamTrainingDay
 * @returns {Promise<{swept: number, failed?: number, skipped?: string}>}
 */
export async function runTrainingSweep({
  supabase,
  now = new Date(),
  runDay = runTeamTrainingDay,
} = {}) {
  // ── Tidsvindue ────────────────────────────────────────────────────────────────
  if (!shouldSweepNow(now)) {
    return { swept: 0, skipped: "before_window" };
  }

  // ── Feature flag ──────────────────────────────────────────────────────────────
  const enabled = await isDailyTrainingEnabled(supabase);
  if (!enabled) {
    return { swept: 0, skipped: "flag_off" };
  }

  // ── Hold + sæson + dagens kørsler ─────────────────────────────────────────────
  const tickDate = copenhagenDateString(now);

  const [teamsResult, seasonResult, runsResult] = await Promise.all([
    supabase
      .from("teams")
      .select("id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false),

    supabase
      .from("seasons")
      .select("id, number")
      .eq("status", "active")
      .maybeSingle(),

    supabase
      .from("training_day_runs")
      .select("team_id, tick_date")
      .eq("tick_date", tickDate),
  ]);

  if (teamsResult.error) throw new Error(`teams: ${teamsResult.error.message}`);
  if (seasonResult.error) throw new Error(`seasons: ${seasonResult.error.message}`);
  if (runsResult.error) throw new Error(`training_day_runs: ${runsResult.error.message}`);
  // null data uden error må ikke blive et stille "swept: 0" — fail højlydt i trackedTick.
  if (!teamsResult.data) throw new Error("teams query returned null (unexpected)");
  if (!runsResult.data) throw new Error("training_day_runs query returned null (unexpected)");

  // ── Ingen aktiv sæson → skip ──────────────────────────────────────────────────
  if (!seasonResult.data) {
    return { swept: 0, skipped: "no_active_season" };
  }

  const season = seasonResult.data;
  const teams = teamsResult.data ?? [];
  const runs = runsResult.data ?? [];

  // ── Sekventiel sweep (idempotent-safe via engine-mutex) ───────────────────────
  const pending = teamsNeedingSweep(teams, runs, tickDate);

  let swept = 0;
  let failed = 0;

  for (const team of pending) {
    try {
      const result = await runDay({
        supabase,
        teamId: team.id,
        seasonId: season.id,
        seasonNumber: season.number,
        executedBy: "assistant",
        now,
      });
      // alreadyRan = motor fandt en reservation fra siden vi loadede runs-listen
      // → tæller IKKE som swept (opgave-specifikation: "alreadyRan doesn't count").
      if (!result.alreadyRan) {
        swept += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`  ❌ Training sweep fejlede for hold ${team.id}:`, err.message);
    }
  }

  return failed > 0 ? { swept, failed } : { swept };
}
