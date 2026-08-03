#!/usr/bin/env node
// #3133 (fair-play/B) — dry-run: kør fair-play prisbåndet mod de sidste N dages
// FAKTISKE handler i prod og opgør hvor mange ægte handler der ville være
// blokeret ved kandidat-bånd. READ-ONLY — ingen writes, ingen mutationer.
//
// Genbruger den ÆGTE håndhævelses-logik (getPriceBandViolation/
// getSwapPriceBandViolation fra lib/transferPriceBand.js) 1:1, så rapporten
// aldrig kan drifte fra hvad backend rent faktisk håndhæver.
//
// Dækker de tre håndhævelsespunkter fra #3133:
//   - transfer_offers, status='accepted' (pris = counter_amount ?? offer_amount)
//   - swap_offers, status='accepted' (SAMLET værdi: begge ryttere + cash_adjustment/counter_cash)
//   - auctions, oprettet i vinduet, starting_price for EGEN rytter
//     (proxy: starting_price <= rider.market_value — se KENDTE BEGRÆNSNINGER)
//
//   node scripts/transferPriceBandDryRun.js                       # 90 dage, candidate A (25%/3x) + empirisk P10/P90
//   node scripts/transferPriceBandDryRun.js --days=30
//   node scripts/transferPriceBandDryRun.js --floor=0.25 --cap=3   # override candidate A
//
// KENDTE BEGRÆNSNINGER (læs før tallene bruges til en beslutning):
//   1. market_value er RYTTERENS NUVÆRENDE værdi, ikke en historisk snapshot
//      på handelstidspunktet — der findes ingen snapshot-kolonne. Værdien kan
//      have ændret sig siden (progression/økonomi-genberegning).
//   2. "Egen rytter"-auktioner identificeres ikke direkte (ingen isOwnRider-
//      snapshot på auctions-rækken) — proxy'en er starting_price <= market_value,
//      som er PRÆCIS den betingelse der gør et gulv-tjek overhovedet relevant
//      (fri-agent/bank-auktioner kræver allerede price >= value og rammes
//      derfor aldrig af et gulv < 100%). Nogle få grænsetilfælde (pris ==
//      value på en ikke-egen-rytter-auktion) kan snige sig med.
//   3. Swap-stikprøven er typisk lille (encifret over 90 dage) — percentil-
//      baserede kandidatbånd for swaps er IKKE statistisk robuste på et så
//      lille datasæt; brug primært 25%/3x-kandidaten for swaps.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, read-only forbrug her).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { getPriceBandViolation, getSwapPriceBandViolation } from "../lib/transferPriceBand.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const DAYS = parseInt(arg("days", "90"), 10);
const CANDIDATE_A_FLOOR = Number(arg("floor", "0.25"));
const CANDIDATE_A_CAP = Number(arg("cap", "3"));

function pad(value, width) {
  const s = String(value ?? "");
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtRatio(n) {
  return Number.isFinite(n) ? n.toFixed(3) : "—";
}

// Lineær-interpoleret percentil (samme metode som Postgres percentile_cont).
function percentileCont(sortedValues, p) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = p * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const frac = idx - lo;
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * frac;
}

async function main() {
  const sinceIso = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ── Transfer-offers accepteret i vinduet ────────────────────────────────
  const { data: transferRows, error: transferErr } = await supabase
    .from("transfer_offers")
    .select("id, offer_amount, counter_amount, updated_at, rider:rider_id(market_value)")
    .eq("status", "accepted")
    .gte("updated_at", sinceIso);
  if (transferErr) throw transferErr;

  const transferDeals = (transferRows || [])
    .map((row) => ({
      id: row.id,
      price: row.counter_amount ?? row.offer_amount,
      marketValue: row.rider?.market_value,
    }))
    .filter((d) => Number.isFinite(d.price) && Number.isFinite(d.marketValue) && d.marketValue > 0);

  // ── Swap-offers accepteret i vinduet ────────────────────────────────────
  const { data: swapRows, error: swapErr } = await supabase
    .from("swap_offers")
    .select("id, cash_adjustment, counter_cash, updated_at, offered:offered_rider_id(market_value), requested:requested_rider_id(market_value)")
    .eq("status", "accepted")
    .gte("updated_at", sinceIso);
  if (swapErr) throw swapErr;

  const swapDeals = (swapRows || [])
    .map((row) => ({
      id: row.id,
      offeredMarketValue: row.offered?.market_value,
      requestedMarketValue: row.requested?.market_value,
      cashAdjustment: row.counter_cash ?? row.cash_adjustment ?? 0,
    }))
    .filter((d) => Number.isFinite(d.offeredMarketValue) && d.offeredMarketValue > 0
      && Number.isFinite(d.requestedMarketValue) && d.requestedMarketValue > 0);

  // ── Auktioner oprettet i vinduet (proxy for "egen rytter", se header) ───
  const { data: auctionRows, error: auctionErr } = await supabase
    .from("auctions")
    .select("id, starting_price, created_at, rider:rider_id(market_value)")
    .gte("created_at", sinceIso);
  if (auctionErr) throw auctionErr;

  const auctionDeals = (auctionRows || [])
    .map((row) => ({
      id: row.id,
      price: row.starting_price,
      marketValue: row.rider?.market_value,
    }))
    .filter((d) => Number.isFinite(d.price) && Number.isFinite(d.marketValue) && d.marketValue > 0
      && d.price <= d.marketValue); // proxy: egen-rytter-auktioner har altid price <= value

  // ── Percentiler af de OBSERVEREDE ratio'er (candidate B) ────────────────
  const transferRatios = transferDeals.map((d) => d.price / d.marketValue).sort((a, b) => a - b);
  const auctionRatios = auctionDeals.map((d) => d.price / d.marketValue).sort((a, b) => a - b);
  // Swap: 2 observationer pr. swap (proposing- og receiving-benet), samme
  // model som selve håndhævelsen (getSwapPriceBandViolation tjekker begge).
  const swapRatios = swapDeals
    .flatMap((d) => [
      (d.offeredMarketValue + d.cashAdjustment) / d.requestedMarketValue,
      (d.requestedMarketValue - d.cashAdjustment) / d.offeredMarketValue,
    ])
    .sort((a, b) => a - b);

  const candidateB = {
    transfer: { floorPct: percentileCont(transferRatios, 0.1), capMultiple: percentileCont(transferRatios, 0.9) },
    swap: { floorPct: percentileCont(swapRatios, 0.1), capMultiple: percentileCont(swapRatios, 0.9) },
    auction_start: { floorPct: percentileCont(auctionRatios, 0.1), capMultiple: percentileCont(auctionRatios, 0.9) },
  };

  const candidateA = { floorPct: CANDIDATE_A_FLOOR, capMultiple: CANDIDATE_A_CAP };

  function countTransferRejections(deals, band) {
    let belowFloor = 0, aboveCap = 0, rejected = 0;
    for (const d of deals) {
      const issue = getPriceBandViolation({ price: d.price, marketValue: d.marketValue, ...band });
      if (issue) {
        rejected += 1;
        if (issue.code === "below_price_floor") belowFloor += 1;
        else aboveCap += 1;
      }
    }
    return { total: deals.length, belowFloor, aboveCap, rejected };
  }

  function countSwapRejections(deals, band) {
    let rejected = 0;
    for (const d of deals) {
      const issue = getSwapPriceBandViolation({
        offeredMarketValue: d.offeredMarketValue,
        requestedMarketValue: d.requestedMarketValue,
        cashAdjustment: d.cashAdjustment,
        ...band,
      });
      if (issue) rejected += 1;
    }
    return { total: deals.length, rejected };
  }

  console.log(`\nDRY-RUN #3133 — fair-play prisbånd mod ${DAYS} dages faktiske handler i prod (READ-ONLY)\n`);
  console.log(`Populationer: ${transferDeals.length} accepterede transfers, ${swapDeals.length} accepterede swaps, ${auctionDeals.length} egen-rytter-auktioner (proxy) af ${auctionRows?.length ?? 0} auktioner i alt.\n`);

  console.log("Observerede pris/market_value-ratioer (P10 / median / P90):");
  console.log(pad("Type", 16), pad("n", 6), pad("P10", 8), pad("P50", 8), pad("P90", 8));
  console.log("-".repeat(50));
  console.log(pad("transfer", 16), pad(transferRatios.length, 6), pad(fmtRatio(percentileCont(transferRatios, 0.1)), 8), pad(fmtRatio(percentileCont(transferRatios, 0.5)), 8), pad(fmtRatio(percentileCont(transferRatios, 0.9)), 8));
  console.log(pad("swap (per ben)", 16), pad(swapRatios.length, 6), pad(fmtRatio(percentileCont(swapRatios, 0.1)), 8), pad(fmtRatio(percentileCont(swapRatios, 0.5)), 8), pad(fmtRatio(percentileCont(swapRatios, 0.9)), 8));
  console.log(pad("auction_start", 16), pad(auctionRatios.length, 6), pad(fmtRatio(percentileCont(auctionRatios, 0.1)), 8), pad(fmtRatio(percentileCont(auctionRatios, 0.5)), 8), pad(fmtRatio(percentileCont(auctionRatios, 0.9)), 8));

  for (const [label, band] of [
    [`Kandidat A — floor=${candidateA.floorPct} cap=${candidateA.capMultiple}×`, candidateA],
    ["Kandidat B — hver types egen P10/P90 (empirisk)", null],
  ]) {
    console.log(`\n${label}`);
    console.log(pad("Type", 16), pad("n", 6), pad("gulv-afvist", 12), pad("loft-afvist", 12), pad("afvist total", 13), pad("afvist %", 9));
    console.log("-".repeat(70));

    const transferBand = band || candidateB.transfer;
    const swapBand = band || candidateB.swap;
    const auctionBand = band || candidateB.auction_start;

    const tRes = countTransferRejections(transferDeals, transferBand);
    const sRes = countSwapRejections(swapDeals, swapBand);
    const aRes = countTransferRejections(auctionDeals, auctionBand);

    const bandStr = (b) => `(${fmtRatio(b.floorPct)}× / ${b.capMultiple == null ? "—" : fmtRatio(b.capMultiple) + "×"})`;

    console.log(pad(`transfer ${bandStr(transferBand)}`, 30), pad(tRes.total, 6), pad(tRes.belowFloor, 12), pad(tRes.aboveCap, 12), pad(tRes.rejected, 13), pad(tRes.total ? fmtPct(tRes.rejected / tRes.total) : "—", 9));
    console.log(pad(`swap ${bandStr(swapBand)}`, 30), pad(sRes.total, 6), pad("—", 12), pad("—", 12), pad(sRes.rejected, 13), pad(sRes.total ? fmtPct(sRes.rejected / sRes.total) : "—", 9));
    console.log(pad(`auction_start ${bandStr(auctionBand)}`, 30), pad(aRes.total, 6), pad(aRes.belowFloor, 12), pad(aRes.aboveCap, 12), pad(aRes.rejected, 13), pad(aRes.total ? fmtPct(aRes.rejected / aRes.total) : "—", 9));
  }

  console.log("\nHUSK: market_value er NUVÆRENDE værdi (ingen historisk snapshot), og auktions-");
  console.log("populationen er en proxy (starting_price <= market_value) for 'egen rytter'.");
  console.log("Swap-stikprøven er lille — brug den forsigtigt til at konkludere et bånd.\n");
}

main().catch((err) => {
  console.error("Dry-run fejlede:", err.message);
  process.exit(1);
});
