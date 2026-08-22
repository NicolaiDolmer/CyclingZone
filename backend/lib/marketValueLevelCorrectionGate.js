// #3449/#3750 · Niveau-korrektionens SØNDAGS-GATE.
//
// PROBLEM: engangs-korrektionen (v4 x c) kan kun kalibreres mod ÉT frit
// signal — den forhandlede kanal (accepterede transfer_offers mellem to
// menneskehold). Målingen 19/8 (docs/audits/...vaerdimodel-refit-scorecard.md
// + scratchpad-noten samme dag) viste den kanal i kraftig, monoton drift
// (rullende 30-dages-median 0,25 → 0,91 over 50 dage) — et c fittet på hele
// historikken er derfor en bagudskuende aflæsning af en kanal der endnu ikke
// har fundet et niveau. EJER-BESLUTNING 19/8: gaten omdefineres fra "to
// kanaler enige" til "forhandlet kanal STABIL" — se
// marketValueLevelCorrectionConfig.js for de to konfigurerbare kriterier.
//
// DENNE FIL MÅLER OG FORESLÅR. Den skriver ALDRIG til riders.market_value —
// selve korrektionen er en separat, ejer-gated engangs-kørsel (se
// backend/scripts/marketValueLevelCorrectionApply.js), tidligst 30/8. Sweepen
// her kører hver søndag (dansk tid) og persisterer kun MÅLINGEN + gate-status.
//
// EVIDENS-GENBRUG: samme kvalificerings-logik som #3750-filteret
// (buildQualifiedSales i backend/scripts/fitMarketValueModelV2.js), indsnævret
// til KUN kilde 'transfer' — auktioner er bevidst udenfor (beslutning 3,
// 19/8): bankens auktioner starter på YOUTH_AUCTION_START_RATE x værdien og
// måler derfor delvist sin egen udgangsværdi, og spiller-auktioner må ikke
// listes over værdien (censureret opad). Kun forhandlede handler er frie i
// begge retninger.
//
// KADENCE + DEDUP: samme mønster som marketValueSundaySweep.js — søndags-gated
// (Europe/Copenhagen), persisteret claim-FØR-skrivning via
// market_value_level_correction_gate_log (UNIQUE measured_date), for at en
// Railway-genstart midt i søndagsvinduet ikke kan trigge en dobbelt-måling.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { copenhagenDateString, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { buildQualifiedSales, median } from "../scripts/fitMarketValueModelV2.js";
import {
  readMinQualifiedTrades,
  readStabilityBand,
} from "./marketValueLevelCorrectionConfig.js";
import { captureException } from "./sentry.js";

export const LEVEL_CORRECTION_GATE_LOG_TABLE = "market_value_level_correction_gate_log";

const DAY_MS = 24 * 60 * 60 * 1000;
const NEGOTIATED_WINDOW_DAYS = 90;
const ROLLING_WINDOW_DAYS = 30;
const ROLLING_STEP_DAYS = 7;
const ROLLING_POINTS = 3;

const noop = () => {};

function isMissingTableError(error) {
  const msg = String(error?.message || "");
  return error?.code === "42P01" || /does not exist|schema cache/i.test(msg);
}

function priceOverAnchorRatios(sales) {
  return sales
    .map((s) => {
      const price = Number(s.price);
      const anchor = Number(s.anchor_value);
      return Number.isFinite(price) && Number.isFinite(anchor) && anchor > 0 ? price / anchor : null;
    })
    .filter((v) => v != null);
}

/**
 * Rullende N-punkts 30-dages-median af pris/anker, trin `stepDays` tilbage fra
 * `now`. Ren funktion — samme byggesten som scratchpad-målingen 19/8, gjort
 * testbar uden database. Rækkefølgen er ÆLDST → NYEST (samme som rapportens
 * tabel), så det seneste punkt altid er sidste element.
 *
 * @param {Array<{sale_ts:string, price:number, anchor_value:number}>} qualifiedSales
 * @param {object} opts
 * @param {Date} opts.now
 */
export function computeRollingMedians(qualifiedSales, {
  now,
  windowDays = ROLLING_WINDOW_DAYS,
  stepDays = ROLLING_STEP_DAYS,
  points = ROLLING_POINTS,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("computeRollingMedians: `now` (Date) er påkrævet");
  }
  const results = [];
  for (let i = points - 1; i >= 0; i--) {
    const windowEndMs = now.getTime() - i * stepDays * DAY_MS;
    const windowStartMs = windowEndMs - windowDays * DAY_MS;
    const inWindow = qualifiedSales.filter((s) => {
      const ts = new Date(s.sale_ts).getTime();
      return Number.isFinite(ts) && ts > windowStartMs && ts <= windowEndMs;
    });
    const ratios = priceOverAnchorRatios(inWindow);
    results.push({
      window_end: new Date(windowEndMs).toISOString().slice(0, 10),
      n: ratios.length,
      median: median(ratios),
    });
  }
  return results;
}

/**
 * Gate-evalueringen — ren, DB-fri, testbar. Se filens header for kontrakten.
 *
 * @param {object} args
 * @param {Array} args.qualified90d — kvalificerede forhandlede handler i 90-dages-vinduet
 * @param {Array<{window_end:string, n:number, median:number|null}>} args.rollingMedians — ÆLDST→NYEST, forventet længde 3
 * @param {number} args.minQualifiedTrades
 * @param {number} args.stabilityBand
 */
export function evaluateLevelCorrectionGate({
  qualified90d,
  rollingMedians,
  minQualifiedTrades,
  stabilityBand,
}) {
  const n90 = qualified90d.length;
  const median90 = median(priceOverAnchorRatios(qualified90d));
  const base = { n90, median90, rollingMedians, minQualifiedTrades, stabilityBand };

  if (n90 < minQualifiedTrades) {
    return {
      ...base,
      status: "red",
      reason: "insufficient_evidence",
      reasonText: `Kun ${n90} kvalificerede forhandlede handler i 90-dages-vinduet (kræver mindst ${minQualifiedTrades}).`,
      cCandidate: null,
    };
  }

  const validPoints = Array.isArray(rollingMedians) ? rollingMedians.filter((p) => Number.isFinite(p?.median)) : [];
  if (validPoints.length < ROLLING_POINTS) {
    return {
      ...base,
      status: "red",
      reason: "insufficient_rolling_history",
      reasonText: `Kun ${validPoints.length} af ${ROLLING_POINTS} rullende 30-dages-vinduer har nok data til en median.`,
      cCandidate: null,
    };
  }

  const medians = validPoints.map((p) => p.median);
  const spread = Math.max(...medians) - Math.min(...medians);
  // Epsilon-tolerance: en grænseværdi der lander PRÆCIS på båndet (fx 0,75-0,60
  // med 0,15-båndet) kan floating-point-runde til 0,15000000000000002 og
  // ellers vippe en reel grænsesag den forkerte vej.
  if (spread > stabilityBand + 1e-9) {
    return {
      ...base,
      status: "red",
      reason: "unstable_channel",
      reasonText:
        `De seneste ${ROLLING_POINTS} rullende 30-dages-medianer spænder ${spread.toFixed(3)} ` +
        `(${medians.map((m) => m.toFixed(3)).join(" → ")}), over stabilitetsbåndet ±${stabilityBand}.`,
      spread,
      cCandidate: null,
    };
  }

  // FYRINGSVÆRDIEN er medianen af det NYESTE 30-dages-vindue, ikke median90.
  // Filens egen header dokumenterer hvorfor: kanalen har været i monoton drift
  // (0,25 → 0,91 over 50 dage), så et c fittet på hele 90-dages-historikken er
  // en bagudskuende aflæsning — målt 21/8 var median90 0,67 mod 0,89 i det
  // friske vindue, dvs. ~25 % overkorrektion. Stabilitets-gaten (spread ≤ bånd)
  // garanterer at de tre vinduer er enige, så det nyeste vindue er ikke et
  // enkelt-uges udsving når gaten er grøn. median90 rapporteres fortsat i
  // gate-loggen til sammenligning. (Session-beslutning 21/8, logget på #3750.)
  const latestWindowMedian = validPoints[validPoints.length - 1].median;
  return {
    ...base,
    status: "green",
    reason: "stable",
    reasonText:
      `Forhandlet kanal stabil: ${n90} kvalificerede handler, seneste ${ROLLING_POINTS} rullende medianer ` +
      `inden for ±${stabilityBand} af hinanden (spænd ${spread.toFixed(3)}). ` +
      `c = nyeste 30-dages-vindues median (${latestWindowMedian.toFixed(3)}; median90 til sammenligning: ${median90?.toFixed(3) ?? "n/a"}).`,
    spread,
    cCandidate: latestWindowMedian,
  };
}

async function defaultFetchTeams({ supabase }) {
  return fetchAllRows(() => supabase
    .from("teams").select("id, is_ai, is_test_account, is_frozen, is_bank").order("id"));
}

// Samme "forhandlet handel"-definition som fit-scriptets transfer-gren:
// accepterede transfer_offers, pris = coalesce(counter_amount, offer_amount),
// ankerværdi = rytterens NUVÆRENDE market_value (ingen historik findes —
// samme tilnærmelse som fit-scriptet og scratchpad-målingen 19/8 begge noterer).
async function defaultFetchNegotiatedRawSales({ supabase, sinceIso }) {
  const transferRows = await fetchAllRows(() => supabase
    .from("transfer_offers")
    .select("id, rider_id, offer_amount, counter_amount, updated_at, seller_team_id, buyer_team_id")
    .eq("status", "accepted")
    .not("rider_id", "is", null)
    .gte("updated_at", sinceIso)
    .order("id"));

  const teams = await defaultFetchTeams({ supabase });
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const isHumanTeam = (id) => {
    const t = teamById.get(id);
    return !!t && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen;
  };

  const riderIds = [...new Set(transferRows.map((t) => t.rider_id).filter(Boolean))];
  const riderRows = riderIds.length
    ? await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
        .from("riders").select("id, market_value").in("id", chunk).order("id"))
    : [];
  const anchorByRider = new Map(riderRows.map((r) => [r.id, Number(r.market_value) || null]));

  const rawSales = [];
  for (const t of transferRows) {
    const price = Number(t.counter_amount ?? t.offer_amount);
    if (!Number.isFinite(price) || price <= 0) continue;
    rawSales.push({
      sale_id: t.id,
      source: "transfer",
      rider_id: t.rider_id,
      price,
      starting_price: null,
      sale_ts: t.updated_at,
      is_guaranteed_sale: false,
      is_youth: false,
      distinct_bidders: null,
      seller_team_id: t.seller_team_id,
      buyer_team_id: t.buyer_team_id,
      seller_is_human: isHumanTeam(t.seller_team_id),
      buyer_is_human: isHumanTeam(t.buyer_team_id),
      anchor_value: anchorByRider.get(t.rider_id) ?? null,
    });
  }
  return rawSales;
}

async function defaultClaimMeasurement({ supabase, measuredDate }) {
  const { error } = await supabase
    .from(LEVEL_CORRECTION_GATE_LOG_TABLE)
    .insert({ measured_date: measuredDate });
  if (!error) return { claimed: true, tableMissing: false };
  if (isMissingTableError(error)) return { claimed: false, tableMissing: true };
  if (error.code === "23505" || /duplicate key|unique constraint/i.test(String(error.message || ""))) {
    return { claimed: false, tableMissing: false };
  }
  throw new Error(`market-value-level-correction-gate claim: ${error.message}`);
}

async function defaultCompleteMeasurement({ supabase, measuredDate, gate }) {
  const { error } = await supabase
    .from(LEVEL_CORRECTION_GATE_LOG_TABLE)
    .update({
      n_qualified_90d: gate.n90,
      median_price_over_anchor_90d: gate.median90,
      rolling_medians: gate.rollingMedians,
      min_qualified_trades: gate.minQualifiedTrades,
      stability_band: gate.stabilityBand,
      gate_status: gate.status,
      gate_reason: gate.reason,
      gate_reason_text: gate.reasonText,
      c_candidate: gate.cCandidate,
      completed_at: new Date().toISOString(),
    })
    .eq("measured_date", measuredDate);
  if (error) throw error;
}

/**
 * Kør søndags-gate-målingen. No-op (stille) hvis: ikke søndag i dansk tid,
 * eller allerede målt for dagens dato (persisteret dedup). Skriver ALDRIG
 * riders.market_value — se filens header.
 *
 * @param {object} args
 * @param {object} args.supabase — service-role Supabase-client
 * @param {Date} args.now
 */
export async function runMarketValueLevelCorrectionGateSweep({
  supabase,
  now,
  // Ejer-direktiv 21/8 (fremrykket overgang til det nye værdisystem): en
  // MANUEL måling må køres på en ikke-søndag via
  // backend/scripts/runLevelCorrectionGateManual.js. Claim-dedup pr. dato
  // gælder stadig, så cron-søndagen og en manuel kørsel kan aldrig
  // dobbelt-måle samme dag. Cron-stien sætter aldrig dette flag.
  manual = false,
  readMinTrades = readMinQualifiedTrades,
  readBand = readStabilityBand,
  fetchNegotiatedRawSales = defaultFetchNegotiatedRawSales,
  claimMeasurement = defaultClaimMeasurement,
  completeMeasurement = defaultCompleteMeasurement,
  log = noop,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  // `now` eksplicit påkrævet (AGENTS.md hard rule 16) — se marketValueSundaySweep.js.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("runMarketValueLevelCorrectionGateSweep: eksplicit `now` (Date) er påkrævet");
  }

  if (!manual && copenhagenWeekdayKey(copenhagenDateString(now)) !== "sun") {
    return { ran: false, skipped: "not_sunday" };
  }

  const measuredDate = copenhagenDateString(now);
  const { claimed, tableMissing } = await claimMeasurement({ supabase, measuredDate });
  if (tableMissing) return { ran: false, skipped: "log_table_missing" };
  if (!claimed) return { ran: false, skipped: "already_measured_today" };

  const [minQualifiedTrades, stabilityBand] = await Promise.all([
    readMinTrades(supabase),
    readBand(supabase),
  ]);

  // Vinduet der dækker BÅDE 90-dages-evidenskravet og de 3 rullende
  // 30-dages-punkter (længste rulle-vindue går 2×stepDays + windowDays
  // tilbage — men 90 dage dækker rigeligt i praksis, så vi henter én gang.
  const fetchWindowDays = Math.max(NEGOTIATED_WINDOW_DAYS, ROLLING_WINDOW_DAYS + (ROLLING_POINTS - 1) * ROLLING_STEP_DAYS);
  const sinceIso = new Date(now.getTime() - fetchWindowDays * DAY_MS).toISOString();

  const rawSales = await fetchNegotiatedRawSales({ supabase, sinceIso });
  const { qualified } = buildQualifiedSales(rawSales);

  const ninetyDayStartMs = now.getTime() - NEGOTIATED_WINDOW_DAYS * DAY_MS;
  const qualified90d = qualified.filter((s) => {
    const ts = new Date(s.sale_ts).getTime();
    return Number.isFinite(ts) && ts > ninetyDayStartMs && ts <= now.getTime();
  });

  const rollingMedians = computeRollingMedians(qualified, { now });

  const gate = evaluateLevelCorrectionGate({
    qualified90d,
    rollingMedians,
    minQualifiedTrades,
    stabilityBand,
  });

  log(
    `market-value-level-correction-gate: ${gate.status.toUpperCase()} (${gate.reason}) — ` +
    `n90=${gate.n90}, median90=${gate.median90?.toFixed(3) ?? "n/a"}, ` +
    `rolling=[${rollingMedians.map((p) => p.median?.toFixed(3) ?? "n/a").join(", ")}]`
  );

  try {
    await completeMeasurement({ supabase, measuredDate, gate });
  } catch (err) {
    // Samme mønster som marketValueSundaySweep.js: claim-rækken forbliver
    // (dagen er "målt", bare uden rapporterede tal), så en fejlet opsummering
    // ikke kan udløse en gentagen måling samme søndag.
    console.error("  ⚠️  market-value-level-correction-gate-log opsummering fejlede (måling ER kørt):", err?.message || err);
    captureExceptionFn(err, { tags: { cron: "market-value-level-correction-gate", stage: "log-complete" } });
  }

  return { ran: true, measuredDate, manual, ...gate };
}
