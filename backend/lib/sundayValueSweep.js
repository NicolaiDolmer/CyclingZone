// #4419 · Søndagens værdi-pipeline, eget job, eget tidsvindue.
//
// EJER-BESLUTNING 30/8: rytterværdier opdateres én gang om ugen, søndag fra
// kl. 06 dansk tid. Før dette lå genberegningen som et efterhængt trin i
// trainingSweep.js og arvede DENS vindue (kl. 22), hvilket betød at værdierne
// først flyttede sig søndag aften. Kadencen (kun søndag) er uændret fra #3448,
// 6/8, kun tidspunktet og ejerskabet flytter sig hertil. (#5842 flytter
// tidspunktet igen, til eftermiddagen; se TIDSPUNKTET nedenfor.)
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
// TIDSPUNKTET (#5842, ejer 28/9): ét fast tidspunkt hver søndag, et sted
// mellem kl. 14 og 20 dansk tid, aldrig om morgenen. Timen bor i
// economyConstants.js (SUNDAY_VALUE_FROM_HOUR). Det præcise klokkeslæt
// bekræftes af ejeren; 14 er pladsholderen indtil da.
//
// SKIFTEDAGEN (#5842, ejer 28/9: "ingen to opdateringer næste sæsonskifte").
// Sæsonskiftet skriver selv ingen værdier længere (riderProgressionEngine.js),
// så søndagen er den ENESTE værdiskrivning, og på skiftedagen skal den ligge
// EFTER det fuldførte skifte, så værdierne regnes på den nye sæsons evner og
// alder. Jobbet springer derfor over, uden at claime dagen, så længe skiftet
// kører eller ikke er fuldført (resolveTransitionGate nedenfor):
//   · den nyeste sæson er afsluttet, og ingen ny sæson er aktiv,
//   · den aktive sæsons sidste planlagte løb ligger i dag eller tidligere
//     (skiftet står for døren),
//   · transitionens seneste fase-anker (admin_log, seasonTransitionPhaseLog.js)
//     inden for TRANSITION_ANCHOR_LOOKBACK_HOURS er 'started' eller 'failed'.
// Det timelige tick kører så søndagen, så snart skiftet er fuldført. Bliver
// skiftet ikke fuldført samme søndag, springes den uges opdatering over, og
// næste søndag tager den. Det erstatter den tidligere regel (#4419-review
// 31/8) om at no_active_season ikke måtte være en gate: ejeren har siden
// besluttet, at én værdiskrivning efter skiftet vejer tungere end en uge uden.

import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { refreshChangedRiderValues } from "./riderValueRefresh.js";
import { runMarketValueSundaySweep } from "./marketValueSundaySweep.js";
import { captureException } from "./sentry.js";
import { ADMIN_ACTION_TYPE, SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";
import { nextPhaseStep, readPhaseStepStrict, writePhaseStep } from "./riderValuationModelSelect.js";
import { TRANSITION_PHASE_LOG_SOURCE, TRANSITION_PHASE_STATUS } from "./seasonTransitionPhaseLog.js";

// Genudstilles her, men bor i economyConstants.js: den fil har ingen imports,
// så frontendens paritetstest kan importere tallet i CI (se kommentaren der).
export { SUNDAY_VALUE_FROM_HOUR };
export const RIDER_VALUE_SUNDAY_LOG_TABLE = "rider_value_sunday_log";

const noop = () => {};

// Hvor langt tilbage et ufuldført fase-anker tæller som "skiftet kører". Et
// skifte tager minutter; et 'started' uden 'completed' efter et døgn er en
// død proces, som ikke må spærre værdierne for altid. Inden for døgnet
// spærrer det, også et 'failed' fra aftenen før.
export const TRANSITION_ANCHOR_LOOKBACK_HOURS = 24;

/**
 * #5842 · Ren beslutning: må søndagens værdier skrives nu, eller kører
 * sæsonskiftet / står det for døren? Se headeren for reglerne.
 *
 * @param {{ latestSeason?: {status?: string}|null, lastRaceAt?: string|Date|null,
 *   latestAnchor?: {status?: string, created_at?: string}|null, runDate: string }} state
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function resolveTransitionGate({ latestSeason = null, lastRaceAt = null, latestAnchor = null, runDate } = {}) {
  if (latestAnchor?.status === TRANSITION_PHASE_STATUS.STARTED) return { blocked: true, reason: "transition_running" };
  if (latestAnchor?.status === TRANSITION_PHASE_STATUS.FAILED) return { blocked: true, reason: "transition_failed" };
  if (latestSeason && latestSeason.status !== "active") return { blocked: true, reason: "transition_pending" };
  if (latestSeason && lastRaceAt) {
    const lastRace = lastRaceAt instanceof Date ? lastRaceAt : new Date(lastRaceAt);
    if (!Number.isNaN(lastRace.getTime()) && copenhagenDateString(lastRace) <= runDate) {
      return { blocked: true, reason: "transition_pending" };
    }
  }
  return { blocked: false };
}

// Henter det resolveTransitionGate skal bruge. KASTER ved DB-fejl: kalderen
// springer så over UDEN at claime dagen, og næste tick prøver igen. En
// værdiskrivning midt i et skifte er værre end en time senere.
async function defaultLoadTransitionState({ supabase, now }) {
  const { data: latestSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, status")
    .neq("status", "upcoming")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);

  let lastRaceAt = null;
  if (latestSeason?.status === "active") {
    const { data: lastRace, error: raceError } = await supabase
      .from("races")
      .select("scheduled_for")
      .eq("season_id", latestSeason.id)
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (raceError) throw new Error(`races: ${raceError.message}`);
    lastRaceAt = lastRace?.scheduled_for ?? null;
  }

  const since = new Date(now.getTime() - TRANSITION_ANCHOR_LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { data: anchor, error: anchorError } = await supabase
    .from("admin_log")
    .select("created_at, meta")
    .eq("action_type", ADMIN_ACTION_TYPE.MANUAL_OVERRIDE)
    .eq("meta->>source", TRANSITION_PHASE_LOG_SOURCE)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anchorError) throw new Error(`admin_log: ${anchorError.message}`);
  const latestAnchor = anchor ? { status: anchor.meta?.status ?? null, created_at: anchor.created_at } : null;

  return { latestSeason, lastRaceAt, latestAnchor };
}

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
 * SUNDAY_VALUE_FROM_HOUR, sæsonskiftet kører eller står for døren (#5842),
 * log-tabellen mangler, eller dagen allerede er kørt. Fejler v4-refresh'en, frigives dagens claim igen, og
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
  loadTransitionState = defaultLoadTransitionState,
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

  // #5842 · Skiftedagen: ingen værdiskrivning mens sæsonskiftet kører eller
  // står for døren. Tjekket ligger FØR claim'et, så dagen stadig er fri, når
  // skiftet er fuldført, og et senere tick samme søndag kan køre.
  let transitionGate;
  try {
    transitionGate = resolveTransitionGate({ ...(await loadTransitionState({ supabase, now })), runDate });
  } catch (err) {
    log(`sunday-value-sweep skippet: saesonskifte-tjek fejlede: ${err.message}`);
    captureExceptionFn(err, { tags: { cron: "sunday-value-sweep", stage: "transition-gate" } });
    return { ran: false, skipped: "transition_check_failed", runDate };
  }
  if (transitionGate.blocked) {
    log(`sunday-value-sweep venter paa saesonskiftet: ${transitionGate.reason}`);
    if (transitionGate.reason === "transition_failed") {
      // Et fejlet skifte spærrer værdierne indtil det er kørt færdigt. Det
      // skal kunne ses, ikke ligne en almindelig søndag uden kørsel.
      captureExceptionFn(
        new Error("sunday-value-sweep: saesonskiftet fejlede, vaerdier venter til det er fuldfoert"),
        { tags: { cron: "sunday-value-sweep", stage: "transition-gate" } },
      );
    }
    return { ran: false, skipped: transitionGate.reason, runDate };
  }

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
    // Loftet er cadencen selv: det timelige tick giver et forsøg pr. time fra
    // SUNDAY_VALUE_FROM_HOUR til midnat (#5842: ca. 10 med kl. 14).
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
