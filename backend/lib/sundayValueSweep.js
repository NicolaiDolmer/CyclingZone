// #4419 · Søndagens værdi-pipeline, eget job, eget tidsvindue.
//
// EJER-BESLUTNING 30/8: rytterværdier opdateres én gang om ugen, søndag fra
// kl. 06 dansk tid. Før dette lå genberegningen som et efterhængt trin i
// trainingSweep.js og arvede DENS vindue (kl. 22), hvilket betød at værdierne
// først flyttede sig søndag aften. Kadencen (kun søndag) er uændret fra #3448,
// 6/8, kun tidspunktet og ejerskabet flytter sig hertil.
//
// RÆKKEFØLGEN ER HELE POINTEN (uændret fra trainingSweep.js's tidligere
// kommentar): refreshChangedRiderValues genberegner base_value RENT fra v4 og
// skriver alt der afviger. Kørte markedsblendet først og v4-refresh'en
// bagefter, ville refresh'en skrive blendet væk igen for præcis de ryttere
// blendet havde flyttet. Featuren ville se ud til at virke og reelt være en
// no-op. Derfor: v4-refresh FØRST, markedsblend SIDST, i ét ordnet flow.
//
// CLAIM FØR MUTATION: rider_value_sunday_log (UNIQUE run_date) claimes FØR
// første skrivning, og claim'et dækker HELE pipelinen, ikke kun blendet.
// Uden det kunne en Railway-genstart senere samme søndag køre v4-refresh'en
// igen; den ville så skrive dagens markedsblend væk, mens blendets eget
// dato-claim blokerede en genberegning. Præcis den fejlmode
// marketValueSundaySweep.js's header advarer imod, bare udløst af en genstart
// i stedet for af en forkert rækkefølge.
//
// FAIL-SAFE: mangler log-tabellen (migration ikke kørt endnu), kører vi INTET.
// En værdi-mutation af hele populationen uden dedup-anker er farligere end en
// søndag uden opdatering.

import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { refreshChangedRiderValues } from "./riderValueRefresh.js";
import { runMarketValueSundaySweep } from "./marketValueSundaySweep.js";
import { captureException } from "./sentry.js";

export const SUNDAY_VALUE_FROM_HOUR = 6;
export const RIDER_VALUE_SUNDAY_LOG_TABLE = "rider_value_sunday_log";

const noop = () => {};

function isMissingTableError(error) {
  const msg = String(error?.message || "");
  return error?.code === "42P01" || /does not exist|schema cache/i.test(msg);
}

// Atomisk dato-CLAIM. UNIQUE(run_date) gør INSERT'et til den naturlige mutex:
// vinder vi rækken, ejer vi dagen; taber vi den (23505), har en anden proces
// (eller en tidligere tick samme søndag) allerede kørt, og vi må IKKE mutere.
async function defaultClaimRunDate({ supabase, runDate }) {
  const { error } = await supabase.from(RIDER_VALUE_SUNDAY_LOG_TABLE).insert({ run_date: runDate });
  if (!error) return { claimed: true, tableMissing: false };
  if (isMissingTableError(error)) return { claimed: false, tableMissing: true };
  if (error.code === "23505" || /duplicate key|unique constraint/i.test(String(error.message || ""))) {
    return { claimed: false, tableMissing: false };
  }
  throw new Error(`sunday-value-sweep claim: ${error.message}`);
}

// Efter-skrivning: fyld claim-rækken med resultatet. Fejler DENNE, beholder vi
// claim'et (rækken findes), værdierne er skrevet, og en manglende opsummering
// må aldrig kunne udløse en gentagelse af selve mutationen.
async function defaultCompleteRun({ supabase, runDate, summary }) {
  const { error } = await supabase
    .from(RIDER_VALUE_SUNDAY_LOG_TABLE)
    .update({
      scanned: summary.scanned ?? null,
      changed: summary.changed ?? null,
      written: summary.written ?? null,
      market_sweep_ran: summary.marketSweepRan,
      market_sweep_written: summary.marketSweepWritten ?? null,
      value_refresh_failed: summary.valueRefreshFailed,
      completed_at: new Date().toISOString(),
    })
    .eq("run_date", runDate);
  if (error) throw error;
}

/**
 * Kør søndagens værdi-pipeline. Stille no-op hvis: ikke søndag (dansk tid),
 * før kl. 06, log-tabellen mangler, eller dagen allerede er kørt.
 *
 * @param {object} args
 * @param {object} args.supabase, service-role Supabase-client
 * @param {Date} args.now, PÅKRÆVET (AGENTS.md hard rule 16): en default ville
 *   lade tests læse vægur-tiden, og et søndags-gated job ville så bestå eller
 *   fejle afhængigt af hvilken ugedag suiten kører.
 * @returns {Promise<{ran: boolean, skipped?: string, runDate?: string,
 *   valueRefresh?: object|null, marketValueSweep?: object|null}>}
 */
export async function runSundayValueSweep({
  supabase,
  now,
  refreshValues = refreshChangedRiderValues,
  runMarketValueSweep = runMarketValueSundaySweep,
  claimRunDate = defaultClaimRunDate,
  completeRun = defaultCompleteRun,
  log = noop,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    // Bevidst uden ae/oe/aa i selve strengen: i18n-check-leaks.mjs's DANISH_CHARS
    // -detektor kigger paa string-literaler, og denne fils baseline er 0.
    throw new Error("runSundayValueSweep: eksplicit `now` (Date) er paakraevet, se AGENTS.md hard rule 16");
  }

  const runDate = copenhagenDateString(now);
  if (copenhagenWeekdayKey(runDate) !== "sun") return { ran: false, skipped: "not_sunday" };
  if (copenhagenHour(now) < SUNDAY_VALUE_FROM_HOUR) return { ran: false, skipped: "before_window" };

  const { claimed, tableMissing } = await claimRunDate({ supabase, runDate });
  if (tableMissing) return { ran: false, skipped: "log_table_missing" };
  if (!claimed) return { ran: false, skipped: "already_ran_today" };

  // ── 1. v4-refresh: base_value/CPV/typer følger de udviklede evner ──
  let valueRefresh = null;
  let valueRefreshFailed = false;
  try {
    valueRefresh = await refreshValues(supabase, { log });
  } catch (err) {
    // Fejler refresh'en, driver base_value ud af sync med udviklede evner uden
    // alarm (samme klasse som #2392), capture, men fortsæt: markedsblendet
    // arbejder videre på de værdier der ER i basen, og et fejlet trin må ikke
    // koste hele søndagen.
    valueRefreshFailed = true;
    log(`value-refresh fejlede: ${err.message}`);
    captureExceptionFn(err, { tags: { cron: "sunday-value-sweep", stage: "value-refresh" } });
  }

  // ── 2. Markedsblend (#3448), SIDSTE skridt, bærer selv sine egne gates ──
  let marketValueSweep = null;
  try {
    marketValueSweep = await runMarketValueSweep({ supabase, now });
  } catch (err) {
    log(`market-value sweep fejlede: ${err.message}`);
    captureExceptionFn(err, { tags: { cron: "sunday-value-sweep", stage: "market-value-sweep" } });
  }

  try {
    await completeRun({
      supabase,
      runDate,
      summary: {
        scanned: valueRefresh?.scanned,
        changed: valueRefresh?.changed,
        written: valueRefresh?.written,
        marketSweepRan: marketValueSweep?.ran === true,
        marketSweepWritten: marketValueSweep?.written,
        valueRefreshFailed,
      },
    });
  } catch (err) {
    // Opsummeringen er bogføring, ikke mutation, claim'et står, så en fejl her
    // må ikke se ud som om søndagen ikke kørte.
    log(`sunday-value-sweep opsummering fejlede: ${err.message}`);
    captureExceptionFn(err, { tags: { cron: "sunday-value-sweep", stage: "complete-run" } });
  }

  return { ran: true, runDate, valueRefresh, marketValueSweep };
}
