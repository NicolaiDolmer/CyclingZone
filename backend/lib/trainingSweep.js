// Assistent-sweep for daglig træning (#1305) — kører efter kl. 22 dansk tid for
// alle menneskelige hold der ikke allerede har trænet i dag. Idempotent: motoren
// bruger UNIQUE(team_id, tick_date) som mutex, så gentagne sweeps er harmløse.
//
// Hold-diskriminator: is_ai=false, is_bank=false, is_frozen=false,
// is_test_account=false — matcher boardAutoAccept.js + checkDebtWarnings (kanonik
// for "rigtige hold" i hele spillet).

import { copenhagenHour, copenhagenDateString, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { refreshChangedRiderValues } from "./riderValueRefresh.js";
import { runMarketValueSundaySweep } from "./marketValueSundaySweep.js"; // #3448
import { captureException } from "./sentry.js";

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
 * @returns {Promise<{swept: number, failed?: number, skipped?: string, valueRefresh?: {scanned: number, changed: number, written: number}}>}
 */
export async function runTrainingSweep({
  supabase,
  now = new Date(),
  runDay = runTeamTrainingDay,
  refreshValues = refreshChangedRiderValues,
  runMarketValueSweep = runMarketValueSundaySweep,
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

  // #3459 D4: race_day_engine_enabled fjerner is_ai=false-filteret — AI-hold kører
  // gennem SAMME dailyTrainingEngine som menneskehold (samme motor, nul asymmetri).
  // Flag off (default) = eksakt samme query som før #3459 (bit-identisk).
  const raceDayEngineOn = await isRaceDayEngineEnabled(supabase);
  const teamsQuery = raceDayEngineOn
    ? supabase.from("teams").select("id").eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false)
    : supabase.from("teams").select("id").eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);

  const [teamsResult, seasonResult, runsResult] = await Promise.all([
    teamsQuery,

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

  // #1364/#3448: base_value følger udviklede evner. Fuld refresh (skriver kun
  // ændrede) fungerer samtidig som sikkerhedsnet/reconcile — MEN kadencen er
  // #3448 (6/8) lagt om fra DAGLIGT til KUN SØNDAG: ejer-beslutningen var at
  // værdier fremadrettet kun skal flytte sig søndagsvist (matcher
  // marketValueSundaySweep.js's egen søndags-gate, så de to værdi-kilder
  // opdaterer i samme rytme i stedet for at en daglig v4-only-refresh
  // overskriver/udjævner søndagens markedsblend midt i ugen). Type-
  // reklassificering (primary_type/secondary_type) følger MED til søndag —
  // acceptabelt, da typer er potentiale-stabile (ændrer sig sjældent, jf.
  // #3325/#3345) og derfor ikke har brug for daglig frekvens. Selve
  // TRÆNINGEN (runDay ovenfor) er UÆNDRET daglig — kun værdi-genberegningen
  // er søndags-gated.
  let valueRefresh = null;
  let marketValueSweep = null;
  if (copenhagenWeekdayKey(tickDate) === "sun") {
    try {
      valueRefresh = await refreshValues(supabase, { log: (m) => console.log(`  ${m}`) });
    } catch (err) {
      // #2389 A2: fejler refresh'en, driver base_value ud af sync med udviklede
      // evner uden alarm (samme klasse som #2392) — capture.
      console.error("  ❌ value-refresh efter sweep fejlede:", err.message);
      captureException(err, { tags: { cron: "training sweep", stage: "value-refresh" } });
    }

    // #3448 — markedsblendet er SIDSTE skridt i søndagens værdi-pipeline, og
    // rækkefølgen er hele pointen: refreshValues ovenfor genberegner base_value
    // rent fra v4 og skriver alt der afviger. Kørte markedsblendet i sin egen
    // cron tidligere på søndagen, ville denne refresh skrive blendet væk igen
    // for præcis de ryttere blendet havde flyttet — og sweepens dato-dedup ville
    // så blokere en ny kørsel. Featuren ville se ud til at virke og reelt være
    // en no-op. Ét ordnet flow er derfor eneste korrekte placering.
    //
    // Sweepen bærer selv sine gates (søndag, market_value_sweep_enabled
    // fail-safe OFF, atomisk dato-claim), så kaldet er en no-op indtil ejeren
    // flipper flaget. Egen try/catch: et fejlende markedsblend må ikke
    // maskere/annullere træningen eller v4-refresh'en ovenfor.
    try {
      marketValueSweep = await runMarketValueSweep({ supabase, now });
    } catch (err) {
      // Bevidst uden æ/ø/å i selve strengen — samme konvention som
      // "value-refresh"-linjen ovenfor (i18n-check-leaks.mjs's DANISH_CHARS
      // -detektor kigger på string-literaler; denne fils baseline er 0).
      console.error("  ❌ market-value sweep fejlede:", err.message);
      captureException(err, { tags: { cron: "training sweep", stage: "market-value-sweep" } });
    }
  }

  const base = failed > 0 ? { swept, failed } : { swept };
  const withRefresh = valueRefresh ? { ...base, valueRefresh } : base;
  return marketValueSweep?.ran ? { ...withRefresh, marketValueSweep } : withRefresh;
}
