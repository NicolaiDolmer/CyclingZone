// #3448 · Markedsdrevet værdi-eftersyn — søndags-sweep.
//
// PROBLEM: base_value (og dermed market_value = COALESCE(base_value,1000),
// schema.sql) kommer i dag udelukkende fra v4 (karriere-NPV, en RATING-model —
// den priser aldrig faktiske handler). #3448's markedsmodel v1.1 (fittet mod
// 1.027 ægte handler, se issue-kommentarerne 6/8) er markant bedre kalibreret
// mod hvad managers rent faktisk betaler (holdout MAE 56.118 CZ$/MAPE 79,7 % vs.
// v4's 119.571/191,0 %) — men v4 er STADIG mere pålidelig for uhandlede segmenter
// (elite/youth, nul handelsevidens, jf. #2799's kendte v4-oppustning). Denne
// sweep BLANDER de to i stedet for at cutover'e: hver rytters nye base_value er
// en vægtet blanding af hans nuværende værdi (v4-arv + tidligere blends) og
// markedsmodellens gæt, hvor vægten skaleres af HANS EGEN handelsevidens
// (support-guarden, K=12/±5 O/±3 år) — og bevægelsen er loftet pr. uge, så
// segmentet konvergerer kontrolleret i stedet for at springe (se
// marketValueModel.js for de fire rene byggesten).
//
// KADENCE: kun søndage (Europe/Copenhagen) — ejer-beslutning 6/8, se
// trainingSweep.js's tilsvarende gate + dens kommentar for begrundelsen (værdier
// skal fremadrettet KUN flytte sig søndagsvist, ikke daglige mikro-bevægelser).
//
// KILL-SWITCH: app_config.market_value_sweep_enabled, DEFAULT 'off'
// (marketValueSweepConfig.js). Denne fil rører INTET i prod før ejeren selv
// flipper flaget — se database/2026-08-06-3448-market-value-sweep.sql's header.
//
// DEDUP: market_value_sunday_sweep_log (UNIQUE sweep_date) — persisteret, samme
// begrundelse som discord_race_digest_log (in-memory guards nulstiller ved
// Railway-redeploy; en tick der kører flere gange kunne ellers dobbelt-køre
// sweepen samme søndag efter en genstart). Dagen CLAIMES atomisk FØR første
// rytter-skrivning og opsummeres bagefter — se defaultClaimSweepDate.
//
// RÆKKEFØLGE PÅ SØNDAGE (kritisk): sweepen kaldes som SIDSTE trin i
// trainingSweep.js's søndags-værdi-pipeline, EFTER refreshChangedRiderValues.
// Kørte markedsblendet først, ville v4-refresh'en kl. 22 samme søndag genberegne
// base_value rent fra v4 og dermed skrive blendet væk igen for præcis de ryttere
// sweepen havde flyttet — featuren ville se ud til at virke og reelt være en
// no-op. Derfor er der bevidst INGEN selvstændig timeligt cron-tick for denne
// sweep; se trainingSweep.js's kald + cron.js.
//
// SALESINDEX-FORENKLING (bevidst, dokumenteret afvigelse fra fit-scriptet):
// fit-scriptet matcher hvert salg mod rytterens abilities PÅ SALGSTIDSPUNKTET
// (historisk snapshot, rider_derived_ability_history) for at fitte modellen så
// præcist som muligt. Denne sweep bruger i stedet CURRENT abilities for de
// samme solgte ryttere til at bygge sit salesIndex — support-guarden måler kun
// "hvor tæt handelsevidens findes der nær DENNE rytters nuværende (O,alder)",
// ikke selve prismodellen, så den historiske præcision fit-scriptet har brug
// for er ikke nødvendig her, og forenklingen sparer et ekstra
// history-opslag hver søndag.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { ABILITY_KEYS } from "./riderTypes.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { copenhagenDateString, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { meanAbilityScore, predictMarketPrice, computeSupport, blendTarget, applyWeeklyCap } from "./marketValueModel.js";
import { isMarketValueSweepEnabled, readMarketValueGlobalWeight, readMarketValueWeeklyCap } from "./marketValueSweepConfig.js";
import { RIDER_BASE_VALUE_FALLBACK } from "./marketUtils.js";
import { captureException } from "./sentry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, "marketValueModelV1.json");
const noop = () => {};
const WRITE_CONCURRENCY = 25;

export const MARKET_VALUE_SWEEP_LOG_TABLE = "market_value_sunday_sweep_log";

function isMissingTableError(error) {
  const msg = String(error?.message || "");
  return error?.code === "42P01" || /does not exist|schema cache/i.test(msg);
}

// FAIL-CLOSED MODEL-GUARD (#3750). Sweepen er den ENESTE runtime-sti der skriver
// markedsblendede værdier, og indtil nu kunne den læse et hvilket som helst
// artefakt, også v1.1, der er fittet på 1.027 handler hvor tre fjerdedele af
// bankens kroner clearede på nøjagtig startprisen (målt 30/8: 981 salg /
// 68,29 mio. / 73,0 % af kronerne på 0-1 budgiver, gennemsnitligt prisløft
// 1,003). Det er præcis den konstant #3750 blev åbnet for at få ud af modellen.
//
// Guarden er en VAGT, ikke et modelvalg: den kræver at artefaktet BÆRER en
// `evidence_filter`-blok (fit-scriptet skriver den, jf. fitMarketValueModelV2.js'
// buildQualifiedSales), så et ufiltreret artefakt ikke kan glide ind ad bagdøren
// den dag kill-switchen flippes til `on`. HVILKEN model der skal være live
// (v1.1 vs. v2) er en ejer-beslutning og hører til i #3449, så denne guard rører
// IKKE MODEL_PATH.
export function assertQualifiedEvidenceModel(model, { source = MODEL_PATH } = {}) {
  const filter = model?.evidence_filter;
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new Error(
      `market-value-sunday-sweep: modellen i ${source} mangler en 'evidence_filter'-blok og er derfor ` +
      "ikke fittet på kvalificeret evidens (#3750). Sweepen fail-closer frem for at skrive base_value " +
      "ud fra et artefakt der kan være trænet på mekaniske bank-salg. Fit et nyt artefakt med " +
      "scripts/fitMarketValueModelV2.js, eller peg MODEL_PATH på et filtreret artefakt (ejer-beslutning, #3449)."
    );
  }
  if (!Array.isArray(filter.criteria) || filter.criteria.length === 0) {
    throw new Error(
      `market-value-sunday-sweep: 'evidence_filter' i ${source} har ingen 'criteria', ` +
      "så blokken dokumenterer ingen filtrering (#3750)."
    );
  }
  return model;
}

function defaultLoadModel() {
  return assertQualifiedEvidenceModel(JSON.parse(readFileSync(MODEL_PATH, "utf8")));
}

async function defaultFetchActiveSeasonNumber({ supabase }) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`market-value-sunday-sweep season lookup: ${error.message}`);
  return data?.number ?? null;
}

// Samme "handel"-definition som fit-scriptet: completed auktioner MED køber
// (guaranteed-sale/bank-salg ekskluderet — det er ikke et markedspris-signal)
// + accepterede transfer_offers.
async function defaultFetchSaleRiderIds({ supabase }) {
  const auctionRows = await fetchAllRows(() => supabase
    .from("auctions")
    .select("rider_id, is_guaranteed_sale")
    .eq("status", "completed")
    .not("current_bidder_id", "is", null)
    .gt("current_price", 0)
    .order("id"));
  const transferRows = await fetchAllRows(() => supabase
    .from("transfer_offers")
    .select("rider_id")
    .eq("status", "accepted")
    .not("rider_id", "is", null)
    .order("id"));
  const ids = new Set();
  for (const a of auctionRows) { if (a.rider_id && !a.is_guaranteed_sale) ids.add(a.rider_id); }
  for (const t of transferRows) { if (t.rider_id) ids.add(t.rider_id); }
  return [...ids];
}

async function defaultFetchRidersByIds({ supabase, riderIds }) {
  if (!riderIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("riders").select("id, birthdate, primary_type").in("id", chunk).order("id"));
  return new Map(rows.map((r) => [r.id, r]));
}

async function defaultFetchAbilitiesByRider({ supabase, riderIds }) {
  if (!riderIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).in("rider_id", chunk).order("rider_id"));
  return new Map(rows.map((r) => [r.rider_id, r]));
}

// "Ejede+AI"-population: samme diskriminator som fit-scriptets scorecard —
// team_id sat, ejer-hold ikke test/frosset/bank (AI-hold ER med, jf. #3448's
// arkitektur-note "ejede+AI riders"), ikke retired/academy.
async function defaultFetchPopulation({ supabase }) {
  const allTeams = await fetchAllRows(() => supabase
    .from("teams").select("id, is_test_account, is_frozen, is_bank").order("id"));
  const realTeamIds = new Set(
    allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id)
  );
  const allRiders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, birthdate, popularity, potentiale, primary_type, is_retired, is_academy, base_value")
    .order("id"));
  return allRiders.filter((r) =>
    r.team_id != null && realTeamIds.has(r.team_id) && !r.is_retired && !r.is_academy
  );
}

// Atomisk dato-CLAIM — SKAL stå FØR nogen rytter-skrivning.
//
// Rækkefølgen er ikke kosmetik: loftet (±25 %) er relativt til rytterens
// NUVÆRENDE base_value. Skrev vi først værdierne og først bagefter dedup-rækken,
// ville en fejlet (eller af en anden proces vundet) log-insert betyde at næste
// times-tick samme søndag kørte HELE sweepen igen — denne gang med de allerede
// flyttede værdier som udgangspunkt. To kørsler = op til ±56 % på én søndag, tre
// = ±95 %. UNIQUE(sweep_date) gør INSERT'et til den naturlige mutex: vinder vi
// rækken, ejer vi dagen; taber vi den (23505 unique_violation), har en anden
// proces allerede claimet og vi skal IKKE mutere noget.
async function defaultClaimSweepDate({ supabase, sweepDate }) {
  const { error } = await supabase
    .from(MARKET_VALUE_SWEEP_LOG_TABLE)
    .insert({ sweep_date: sweepDate });
  if (!error) return { claimed: true, tableMissing: false };
  if (isMissingTableError(error)) return { claimed: false, tableMissing: true };
  if (error.code === "23505" || /duplicate key|unique constraint/i.test(String(error.message || ""))) {
    return { claimed: false, tableMissing: false };
  }
  throw new Error(`market-value-sunday-sweep claim: ${error.message}`);
}

// Efter-skrivning: fyld claim-rækken med resultatet. Fejler DENNE, beholder vi
// claim'et (rækken findes) — værdierne er skrevet, og en manglende opsummering
// må aldrig kunne udløse en gentagelse af selve mutationen.
async function defaultCompleteSweepRun({ supabase, sweepDate, summary }) {
  const { error } = await supabase
    .from(MARKET_VALUE_SWEEP_LOG_TABLE)
    .update({
      scanned: summary.scanned,
      changed: summary.changed,
      written: summary.written,
      global_weight: summary.globalWeight,
      weekly_cap: summary.weeklyCap,
      sales_index_size: summary.salesIndexSize,
      completed_at: new Date().toISOString(),
    })
    .eq("sweep_date", sweepDate);
  if (error) throw error;
}

async function writeUpdates(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    // Resultatet BINDES eksplicit (ikke .then()-destrukturering): supabase-js
    // kaster ikke, og lint-unchecked-supabase-mutation.mjs (#2974) kræver en
    // bundet `{ error }` på enhver await'et mutation.
    const results = await Promise.all(
      batch.map(async ({ id, base_value }) => {
        const { error } = await supabase.from("riders").update({ base_value }).eq("id", id);
        return { id, error };
      })
    );
    for (const { id, error } of results) {
      if (error) throw new Error(`market-value-sunday-sweep riders update ${id}: ${error.message}`);
    }
    written += batch.length;
  }
  return written;
}

/**
 * Kør søndags-sweepen. No-op (stille) hvis: ikke søndag i dansk tid, kill-switch
 * off, eller allerede kørt for dagens dato (persisteret dedup).
 *
 * @param {object} args
 * @param {object} args.supabase — service-role Supabase-client
 * @param {Date} [args.now]
 * @returns {Promise<{ran:boolean, skipped?:string, scanned?:number, changed?:number, written?:number}>}
 */
export async function runMarketValueSundaySweep({
  supabase,
  now,
  isEnabled = isMarketValueSweepEnabled,
  readGlobalWeight = readMarketValueGlobalWeight,
  readWeeklyCap = readMarketValueWeeklyCap,
  loadModel = defaultLoadModel,
  fetchActiveSeasonNumber = defaultFetchActiveSeasonNumber,
  fetchSaleRiderIds = defaultFetchSaleRiderIds,
  fetchRidersByIds = defaultFetchRidersByIds,
  fetchAbilitiesByRider = defaultFetchAbilitiesByRider,
  fetchPopulation = defaultFetchPopulation,
  claimSweepDate = defaultClaimSweepDate,
  completeSweepRun = defaultCompleteSweepRun,
  log = noop,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  // `now` er PÅKRÆVET (AGENTS.md hard rule 16): en `now = new Date()`-default
  // lader tests læse vægur-tiden, og en søndags-gated sweep ville så bestå eller
  // fejle afhængigt af hvilken ugedag suiten kører. Cron-grænsefladen injicerer
  // allerede et eksplicit `now`.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("runMarketValueSundaySweep: eksplicit `now` (Date) er påkrævet — se AGENTS.md hard rule 16");
  }

  if (copenhagenWeekdayKey(copenhagenDateString(now)) !== "sun") {
    return { ran: false, skipped: "not_sunday" };
  }

  const enabled = await isEnabled(supabase);
  if (!enabled) return { ran: false, skipped: "flag_off" };

  // MODEL-GUARD FØR CLAIM (#3750). To grunde til at den ligger her og ikke efter
  // claim'et: (1) et ufiltreret artefakt må ikke brænde dagens claim, så en rettet
  // model stadig kan køre samme søndag, og (2) guarden kører på RESULTATET af
  // `loadModel`, ikke kun i defaultLoadModel, fordi `loadModel` er en injicerbar
  // test-seam og en vagt der kan omgås ved at injicere et artefakt er ingen vagt.
  const model = assertQualifiedEvidenceModel(loadModel());

  // CLAIM FØR MUTATION — se defaultClaimSweepDate for hvorfor rækkefølgen er
  // kritisk (dobbelt cap-anvendelse ved gentagelse samme søndag).
  const sweepDate = copenhagenDateString(now);
  const { claimed, tableMissing } = await claimSweepDate({ supabase, sweepDate });
  if (tableMissing) return { ran: false, skipped: "log_table_missing" };
  if (!claimed) return { ran: false, skipped: "already_ran_today" };

  const seasonNumber = await fetchActiveSeasonNumber({ supabase });
  if (seasonNumber == null) return { ran: false, skipped: "no_active_season" };

  const [globalWeight, weeklyCap] = await Promise.all([
    readGlobalWeight(supabase),
    readWeeklyCap(supabase),
  ]);

  // ── 1. SalesIndex (handelsevidens til support-guarden) ──
  const saleRiderIds = await fetchSaleRiderIds({ supabase });
  const [saleRidersById, saleAbilitiesById] = await Promise.all([
    fetchRidersByIds({ supabase, riderIds: saleRiderIds }),
    fetchAbilitiesByRider({ supabase, riderIds: saleRiderIds }),
  ]);
  const salesIndex = [];
  for (const id of saleRiderIds) {
    const rider = saleRidersById.get(id);
    const abilities = saleAbilitiesById.get(id);
    if (!rider?.birthdate || !rider?.primary_type || !abilities) continue;
    const O = meanAbilityScore(abilities);
    const age = ageForSeason(rider.birthdate, seasonNumber);
    if (O == null || age == null) continue;
    salesIndex.push({ O, age, primary_type: rider.primary_type });
  }

  // ── 2. Population (ejede + AI, ikke retired/academy) + guard-parametre ──
  const population = await fetchPopulation({ supabase });
  const popAbilitiesById = await fetchAbilitiesByRider({ supabase, riderIds: population.map((r) => r.id) });

  const guard = model.guard || {};
  const guardOpts = { oWindow: guard.O_window ?? 5, ageWindow: guard.age_window ?? 3, K: guard.K };

  let scanned = 0;
  const updates = [];
  for (const r of population) {
    const abilities = popAbilitiesById.get(r.id);
    if (!abilities || !r.birthdate || !r.primary_type) continue;
    const O = meanAbilityScore(abilities);
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (O == null || age == null) continue;
    scanned += 1;

    const currentValue = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
    const marketPred = predictMarketPrice(
      { O, age, potentiale: Number(r.potentiale) || 0, popularity: Number(r.popularity) || 0, is_youth: false, primary_type: r.primary_type },
      model.coefficients
    );
    const support = computeSupport({ O, age, primary_type: r.primary_type }, salesIndex, guardOpts);
    const target = blendTarget(currentValue, marketPred, globalWeight, support);
    const capped = applyWeeklyCap(currentValue, target, weeklyCap);
    const newBaseValue = Math.max(1, Math.round(capped));
    if (newBaseValue !== currentValue) {
      updates.push({ id: r.id, base_value: newBaseValue });
    }
  }

  const written = await writeUpdates(supabase, updates);

  const summary = {
    ran: true,
    scanned,
    changed: updates.length,
    written,
    globalWeight,
    weeklyCap,
    salesIndexSize: salesIndex.length,
    seasonNumber,
  };
  log(
    `market-value-sunday-sweep: ${scanned} scannet · ${updates.length} ændret · ${written} skrevet ` +
    `(globalWeight=${globalWeight}, weeklyCap=±${(weeklyCap * 100).toFixed(0)}%, salesIndex=${salesIndex.length})`
  );

  try {
    await completeSweepRun({ supabase, sweepDate, summary });
  } catch (err) {
    // Claim-rækken ER skrevet (og bevares) — dagen forbliver dermed låst, så en
    // fejlet opsummering kan IKKE udløse en gentagen kørsel med dobbelt
    // cap-anvendelse. Det eneste tab er selve tællerne; rækken står tilbage med
    // completed_at = NULL, hvilket netop er signalet "kørte, men rapporterede
    // ikke". Derfor må fejlen ikke få sweepen til at se fejlet ud.
    console.error("  ⚠️  market-value-sunday-sweep-log opsummering fejlede (sweep ER kørt, dagen forbliver claimet):", err?.message || err);
    captureExceptionFn(err, { tags: { cron: "market-value-sunday-sweep", stage: "log-complete" } });
  }

  return summary;
}
