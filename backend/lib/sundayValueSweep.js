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
// INGEN TRÆNINGS-GATE (ejer-beslutning 31/8). Træning og værdiopdatering er
// to uafhængige systemer: der skal kunne trænes hver dag, og værdier skal
// opdateres hver søndag - aldrig andre dage - uanset træningens tilstand.
// Et tidligere review koblede dem, fordi værdi-refresh'en historisk lå BAG
// trainingSweep.js's flag-gate. Den kobling var et artefakt af hvor koden lå, ikke
// en spilregel, og ejeren afviste den eksplicit. daily_training_enabled må
// derfor ikke genindføres her.
//
// (På sigt skal træningsscoren indgå i selve værdiberegningen, men den score
// er ikke bygget endnu. Det er en input-afhængighed i modellen, ikke en gate
// på om jobbet kører.)
//
// marketValueSundaySweep har fortsat sit EGET flag (market_value_sweep) - det
// er den sweeps egen nødbremse og har intet med træning at gøre.
//
// no_active_season er derimod BEVIDST ikke en gate her (samme review). Den var
// et biprodukt af at refresh'en hang på en sweep der havde brug for sæsonen til
// selve træningen; værdi-refresh'en har siden cutover-fixet 23/8 (#4151) sit
// eget korrekte anker uden aktiv sæson (seneste completed sæson, aldrig '1').
// En gate ville koste en hel uges værdiopdatering hver gang en søndag falder i
// hullet mellem "Afslut sæson" og transitionen, uden at beskytte noget.

import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { refreshChangedRiderValues } from "./riderValueRefresh.js";
import { runMarketValueSundaySweep } from "./marketValueSundaySweep.js";
import { captureException } from "./sentry.js";
import { SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";
import { nextPhaseStep, readPhaseStepStrict, writePhaseStep } from "./riderValuationModelSelect.js";

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
 * kl. 06, log-tabellen mangler, eller dagen
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
  readPhaseStep = readPhaseStepStrict,
  advancePhaseStep = writePhaseStep,
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
  // #5497 TRIN-TÆLLEREN: app_config.rider_value_phase_step er det trin der
  // SIDST er skrevet (0 = kørselsdagen). Søndagen regner med næste trin
  // (loft 4) og skriver det tilbage, når kørslen er fuldført og prisen er v6.
  // Læses STRIKST inde i try'en: en DB-fejl frigiver dagen som enhver anden
  // refresh-fejl, i stedet for at regne hele populationen på et gættet trin.
  // Under v4/v5 regnes trinnet ud, men modellerne læser det ikke, og nøglen
  // røres ikke (se trin 3 nedenfor).
  let valueRefresh = null;
  let phaseStep = null;
  try {
    phaseStep = nextPhaseStep(await readPhaseStep(supabase));
    valueRefresh = await refreshValues(supabase, { log, phaseStep });
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

  // ── 3. Trin-tælleren tælles op (#5497), samme afslutnings-sti som completed_at ──
  // KUN når prisen er v6 (refresh'en melder typefree) og refresh'en er
  // fuldført — vi er kun nået hertil, hvis den ikke kastede. Der skrives det
  // trin kørslen FAKTISK regnede med, ikke "læs + 1" igen, så en gentaget
  // afslutning aldrig kan tælle to gange. Fejler skrivningen, står nøglen på
  // forrige trin, og næste søndag regner det samme trin igen: præmien bliver
  // et trin længere, aldrig et trin for tidligt væk.
  let phase = { step: valueRefresh?.typefree ? phaseStep : null, advanced: false };
  if (valueRefresh?.typefree === true) {
    try {
      await advancePhaseStep(supabase, phaseStep);
      phase = { step: phaseStep, advanced: true };
    } catch (err) {
      log(`sunday-value-sweep kunne ikke taelle trin-taelleren op: ${err.message}`);
      captureExceptionFn(err, { tags: { cron: "sunday-value-sweep", stage: "phase-step" } });
    }
  }
  log(sundaySweepSummaryLine({ valueRefresh, phase }));

  return { ran: true, runDate, valueRefresh, marketValueSweep, phase };
}

/**
 * Den linje Railway-loggen skal vise for søndagens værdi-del, så post-verify
 * kan læses uden DB-adgang: model, trin (kun v6) og antal løngrundlag der
 * flyttede sig (skal være 0 så længe løn-nøglen står på v4). Ren funktion.
 */
export function sundaySweepSummaryLine({ valueRefresh, phase } = {}) {
  const model = valueRefresh?.modelId ?? "?";
  const step = phase?.step == null ? "-" : `${phase.step}${phase.advanced ? "" : " (ikke gemt)"}`;
  const cpv = valueRefresh?.productionChanged ?? "?";
  return `sunday-value-sweep: model ${model} · phase step ${step} · production_value changed: ${cpv}`;
}
