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
//
// KILL-SWITCH: daily_training_enabled gælder også her (review 31/8). Værdi-
// refresh'en lå før BAG trainingSweep.js's flag-gate, så ejerens nødbremse
// frøs værdierne sammen med træningen. Flytningen til eget job må ikke gøre
// nødbremsen smallere end den var: slukker ejeren træningen fordi motoren
// udvikler forkert, skal værdierne heller ikke prissættes oven på præcis de
// evner. Ingen flag-ændring var en del af ejer-beslutningen 30/8, kun tidspunkt.
//
// no_active_season er derimod BEVIDST ikke en gate her (samme review). Den var
// et biprodukt af at refresh'en hang på en sweep der havde brug for sæsonen til
// selve træningen; værdi-refresh'en har siden cutover-fixet 23/8 (#4151) sit
// eget korrekte anker uden aktiv sæson (seneste completed sæson, aldrig '1').
// En gate ville koste en hel uges værdiopdatering hver gang en søndag falder i
// hullet mellem "Afslut sæson" og transitionen, uden at beskytte noget.

import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { refreshChangedRiderValues } from "./riderValueRefresh.js";
import { runMarketValueSundaySweep } from "./marketValueSundaySweep.js";
import { captureException } from "./sentry.js";
import { SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";

// Genudstilles her, men bor i economyConstants.js: den fil har ingen imports,
// så frontendens paritetstest kan importere tallet i CI (se kommentaren der).
export { SUNDAY_VALUE_FROM_HOUR };
export const RIDER_VALUE_SUNDAY_LOG_TABLE = "rider_value_sunday_log";

const noop = () => {};

// KUN ægte "tabellen findes ikke". Postgres' 42P01 og PostgREST's PGRST205
// (table not found in schema cache) er de to sande koder. Den tidligere brede
// /does not exist|schema cache/ ramte også PGRST204, som er KOLONNE-mismatch
// ("Could not find the 'x' column of 'rider_value_sunday_log' in the schema
// cache") — en omdøbt kolonne ville dermed slå hele værdi-jobbet tavst fra i
// stedet for at kaste. Ukendt kode ⇒ ikke tabel-fravær; en klient uden kode
// falder tilbage til en besked-regex der kræver BÅDE tabelnavnet og
// relation/table-ordlyden, så kolonne-beskeder ikke matcher.
function isMissingTableError(error) {
  const code = String(error?.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  if (code) return false;
  const msg = String(error?.message || "");
  return new RegExp(`(relation|table) \\S*${RIDER_VALUE_SUNDAY_LOG_TABLE}\\S* does not exist`, "i").test(msg);
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

// FRIGIV dagens claim igen. Kaldes KUN når v4-refresh'en fejlede, altså før
// markedsblendet har skrevet noget: uden den ville et enkelt 8-sekunders
// statement-timeout koste hele ugens værdiopdatering, fordi næste tick blot
// fandt claim-rækken og svarede already_ran_today. Før #4419 lå refresh'en i
// trainingSweep, som cron kaldte hvert 5. minut, så en transient fejl helede
// sig selv; det loft må omlægningen ikke fjerne.
async function defaultReleaseRunDate({ supabase, runDate }) {
  const { error } = await supabase.from(RIDER_VALUE_SUNDAY_LOG_TABLE).delete().eq("run_date", runDate);
  if (error) throw error;
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
      completed_at: new Date().toISOString(),
    })
    .eq("run_date", runDate);
  if (error) throw error;
}

/**
 * Kør søndagens værdi-pipeline. No-op hvis: ikke søndag (dansk tid), før
 * kl. 06, daily_training_enabled er slukket, log-tabellen mangler, eller dagen
 * allerede er kørt. Fejler v4-refresh'en, frigives dagens claim igen, og
 * jobbet svarer skipped:"value_refresh_failed", så næste tick prøver forfra.
 *
 * @param {object} args
 * @param {object} args.supabase, service-role Supabase-client
 * @param {Date} args.now, PÅKRÆVET (AGENTS.md hard rule 16): en default ville
 *   lade tests læse vægur-tiden, og et søndags-gated job ville så bestå eller
 *   fejle afhængigt af hvilken ugedag suiten kører.
 * @returns {Promise<{ran: boolean, skipped?: string, runDate?: string,
 *   claimReleased?: boolean, valueRefresh?: object|null,
 *   marketValueSweep?: object|null}>}
 */
export async function runSundayValueSweep({
  supabase,
  now,
  refreshValues = refreshChangedRiderValues,
  runMarketValueSweep = runMarketValueSundaySweep,
  claimRunDate = defaultClaimRunDate,
  releaseRunDate = defaultReleaseRunDate,
  completeRun = defaultCompleteRun,
  trainingEnabled = isDailyTrainingEnabled,
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

  // Kill-switch FØR claim'et: er træningen slukket, må dagen ikke tælle som
  // brugt — ellers ville et tick før et flag-flip stjæle søndagen.
  if (!(await trainingEnabled(supabase))) return { ran: false, skipped: "flag_off" };

  const { claimed, tableMissing } = await claimRunDate({ supabase, runDate });
  if (tableMissing) {
    // Fail-safe'en er korrekt (ingen mutation uden dedup-anker), men den må
    // ikke være tavs: cron-wrapperen logger kun når ran er true, så et
    // permanent skip ville ellers se ud som en normal uge, uge efter uge.
    log(`sunday-value-sweep skippet: ${RIDER_VALUE_SUNDAY_LOG_TABLE} findes ikke`);
    captureExceptionFn(
      new Error(`sunday-value-sweep: ${RIDER_VALUE_SUNDAY_LOG_TABLE} mangler, vaerdier opdateres ikke`),
      { tags: { cron: "sunday-value-sweep", stage: "claim" } }
    );
    return { ran: false, skipped: "log_table_missing" };
  }
  if (!claimed) return { ran: false, skipped: "already_ran_today" };

  // ── 1. v4-refresh: base_value/CPV/typer følger de udviklede evner ──
  let valueRefresh = null;
  try {
    valueRefresh = await refreshValues(supabase, { log });
  } catch (err) {
    // FEJLET REFRESH ⇒ FRIGIV DAGEN OG PRØV IGEN. Vi gør bevidst IKKE noget
    // andet her: markedsblendet springes over, fordi næste forsøgs v4-refresh
    // ville skrive et blend fra dette tick væk igen (samme rækkefølge-fejlmode
    // som headeren beskriver). Retry er sikker, også når refresh'en nåede at
    // skrive nogle ryttere: den genberegner rent fra v4 og skriver kun diffs.
    // Loftet er cadencen selv — det timelige tick giver højst ~18 forsøg inde i
    // søndagens vindue, færre end de ~24 den 5-minutters sweep gav før #4419.
    log(`value-refresh fejlede: ${err.message}`);
    captureExceptionFn(err, { tags: { cron: "sunday-value-sweep", stage: "value-refresh" } });
    try {
      await releaseRunDate({ supabase, runDate });
    } catch (releaseErr) {
      // Kan vi ikke frigive, står claim'et, og næste tick svarer
      // already_ran_today — den gamle adfærd. Så det skal ses.
      log(`sunday-value-sweep kunne ikke frigive claim: ${releaseErr.message}`);
      captureExceptionFn(releaseErr, { tags: { cron: "sunday-value-sweep", stage: "release-claim" } });
      return { ran: false, skipped: "value_refresh_failed", runDate, claimReleased: false };
    }
    return { ran: false, skipped: "value_refresh_failed", runDate, claimReleased: true };
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
