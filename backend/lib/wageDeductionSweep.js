// #2840 · Dagsbaseret løntræk — daglig sweep-motor. Kører KUN når
// wage_deduction_mode=daily (app_config, se wageDeductionConfig.js). Følger
// samme mønster som trainingSweep.js/scoutSweep.js: en 5-min-poll gated på
// "dansk klokken >= 22" (SWEEP_FROM_HOUR), idempotent via en dags-marker-
// tabel (wage_daily_runs, UNIQUE(team_id, tick_date)) OG via
// finance_transactions' egen idempotency_key-unique-index som sikkerhedsnet
// under marker-tabellen (samme dobbelt-lag som resten af daily-cadence-
// systemet).
//
// Dagsrate-formel: dailyRate(rider) = round(rider.salary / seasonLengthDays).
// seasonLengthDays = seasons.race_days_total (materialiseret ved sæson-start,
// distinkte kalender-løbsdage — se seasonRaceDays.js) med en sikker fallback
// hvis feltet mangler/er 0 (bør ikke ske for en aktiv sæson med bygget
// kalender, men undgår en division med 0).
//
// Pro-rata er en KONSEKVENS af modellen, ikke speciel logik: hver dag
// forespørges holdets AKTUELLE roster (riders.team_id = team.id), så en
// rytter købt midt i sæsonen kun optjener dagstræk fra den dag han rent
// faktisk er på truppen — og en frigivet rytter stopper med at koste fra
// samme dag hans team_id nulstilles (se releasesRider-stierne, alle nuller
// team_id synkront).
//
// Håndtering af midlertidig negativ saldo (ejer-designspørgsmål, #2840-
// kommentar 30/7): INGEN emergency-lån udløses her for et enkelt dagstræk —
// det ville udløse et nødlån hver eneste dag for ethvert hold der ligger nær
// nul, hvilket er langt mere aggressivt end sæson-upfront-modellens ét-
// gangs-nødlån. debitTeam har ingen balance-gulv (samme RPC som resten af
// motoren), så saldoen kan gå negativ — holdet betaler den eksisterende
// season_end_negative_interest-rente af det ved sæson-slut, præcis som i
// dag. Dette er en bevidst forenkling, flagget som åbent spørgsmål til
// dry-run-simuleringen før mode nogensinde flippes til "daily" i prod.

import { copenhagenHour, copenhagenDateString } from "./copenhagenTime.js";
import { readWageDeductionMode, isDailyWageMode } from "./wageDeductionConfig.js";
import { debitTeam } from "./economyEngine.js";
import { FINANCE_REASON } from "./economyConstants.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";

export const SWEEP_FROM_HOUR = 22;

// Fallback hvis seasons.race_days_total mangler/er 0 — matcher schema-defaulten
// (database/schema.sql: race_days_total INTEGER DEFAULT 60).
export const DEFAULT_SEASON_LENGTH_DAYS = 60;

/**
 * Er det tid til den daglige lønsweep? (dansk tid >= kl. 22, samme vindue som
 * trainingSweep/scoutSweep — ét samlet "dagen er slut"-øjeblik for al
 * daglig-cadence-processering).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

/**
 * Ren funktion: beregn dagens samlede løntræk + antal betalte ryttere for ét
 * hold, givet holdets AKTUELLE roster og sæsonens længde i rigtige dage.
 * Ryttere med salary<=0 (fx ikke-signede akademi-pladser) tælles ikke med.
 * @param {Array<{salary?: number}>} riders
 * @param {number} seasonLengthDays
 * @returns {{amount: number, ridersCharged: number, seasonLengthDays: number}}
 */
export function computeTeamDailyWage(riders, seasonLengthDays) {
  const length = Number.isFinite(seasonLengthDays) && seasonLengthDays > 0
    ? seasonLengthDays
    : DEFAULT_SEASON_LENGTH_DAYS;

  let amount = 0;
  let ridersCharged = 0;
  for (const rider of riders || []) {
    const salary = Number(rider?.salary) || 0;
    if (salary <= 0) continue;
    amount += Math.round(salary / length);
    ridersCharged += 1;
  }
  return { amount, ridersCharged, seasonLengthDays: length };
}

/**
 * Filtrer hold der IKKE allerede har fået trukket løn for tickDate.
 * @param {Array<{id: string}>} teams
 * @param {Array<{team_id: string, tick_date: string}>} todaysRuns
 * @param {string} tickDate — YYYY-MM-DD
 * @returns {Array<{id: string}>}
 */
export function teamsNeedingWageSweep(teams, todaysRuns, tickDate) {
  const ranToday = new Set(
    (todaysRuns || []).filter((r) => r.tick_date === tickDate).map((r) => r.team_id)
  );
  return (teams || []).filter((t) => !ranToday.has(t.id));
}

/**
 * Kør daglig løn-sweep for alle rigtige menneskehold der ikke allerede har
 * fået trukket løn i dag. Skipper stille hvis wage_deduction_mode ikke er
 * "daily", hvis der ingen aktiv sæson er, eller uden for tidsvinduet.
 *
 * @param {object} args
 * @param {object} args.supabase — service-role Supabase-client
 * @param {Date} [args.now] — referencetid (default new Date())
 * @param {Function} [args.debit] — DI-hook til test; default debitTeam
 * @param {Function} [args.readMode] — DI-hook til test; default readWageDeductionMode
 * @returns {Promise<{swept: number, failed?: number, skipped?: string}>}
 */
export async function runWageDeductionSweep({
  supabase,
  now = new Date(),
  debit = debitTeam,
  readMode = readWageDeductionMode,
} = {}) {
  // ── Tidsvindue ────────────────────────────────────────────────────────────
  if (!shouldSweepNow(now)) {
    return { swept: 0, skipped: "before_window" };
  }

  // ── Config-gate ───────────────────────────────────────────────────────────
  const mode = await readMode(supabase);
  if (!isDailyWageMode(mode)) {
    return { swept: 0, skipped: "mode_off" };
  }

  const tickDate = copenhagenDateString(now);

  const [teamsResult, seasonResult, runsResult] = await Promise.all([
    applyHumanTeamFilter(supabase.from("teams").select("id")),

    supabase
      .from("seasons")
      .select("id, race_days_total")
      .eq("status", "active")
      .maybeSingle(),

    supabase
      .from("wage_daily_runs")
      .select("team_id, tick_date")
      .eq("tick_date", tickDate),
  ]);

  if (teamsResult.error) throw new Error(`teams: ${teamsResult.error.message}`);
  if (seasonResult.error) throw new Error(`seasons: ${seasonResult.error.message}`);
  if (runsResult.error) throw new Error(`wage_daily_runs: ${runsResult.error.message}`);
  if (!teamsResult.data) throw new Error("teams query returned null (unexpected)");
  if (!runsResult.data) throw new Error("wage_daily_runs query returned null (unexpected)");

  if (!seasonResult.data) {
    return { swept: 0, skipped: "no_active_season" };
  }

  const season = seasonResult.data;
  const teams = teamsResult.data ?? [];
  const runs = runsResult.data ?? [];
  const pending = teamsNeedingWageSweep(teams, runs, tickDate);

  let swept = 0;
  let failed = 0;

  for (const team of pending) {
    try {
      const { data: riders, error: ridersError } = await supabase
        .from("riders")
        .select("id, salary")
        .eq("team_id", team.id);
      if (ridersError) throw new Error(ridersError.message);

      const { amount, ridersCharged } = computeTeamDailyWage(riders, season.race_days_total);

      if (amount > 0) {
        await debit(
          team.id,
          amount,
          "salary",
          null,
          season.id,
          supabase,
          {
            idempotent: true,
            metadata: {
              code: "tx.salary",
              params: { count: ridersCharged },
            },
            audit: {
              sourcePath: "wageDeductionSweep.runWageDeductionSweep",
              reasonCode: FINANCE_REASON.SEASON_END_SALARY,
              idempotencyKey: `wage_daily:${team.id}:${tickDate}`,
            },
          }
        );
      }

      // Marker-række uanset beløb (også 0-ryttere-hold) så vi ikke gen-
      // forespørger riders for dette hold+dag ved næste 5-min-poll. Selve
      // dobbelttræks-beskyttelsen sidder i finance_transactions'
      // idempotency_key (ovenfor) — denne marker er kun en effektivitets-
      // optimering, ikke den primære mutex.
      const { error: markError } = await supabase.from("wage_daily_runs").insert({
        team_id: team.id,
        tick_date: tickDate,
        riders_charged: ridersCharged,
        amount,
      });
      if (markError && markError.code !== "23505") {
        throw new Error(markError.message);
      }

      swept += 1;
    } catch (err) {
      // best-effort: per-hold try/catch (mirror af trainingSweep/scoutSweep) —
      // én fejlende hold-debitering må ikke stoppe sweepen for resten. `failed`
      // tælles op og logges her; runWageDeductionSweepCron (cron.js) aggregerer
      // failed>0 til ÉN sentryCapture pr. tick, så fejlen ikke går tabt.
      failed += 1;
      console.error(`  ❌ Wage-deduction sweep fejlede for hold ${team.id}:`, err.message);
    }
  }

  return failed > 0 ? { swept, failed } : { swept };
}
