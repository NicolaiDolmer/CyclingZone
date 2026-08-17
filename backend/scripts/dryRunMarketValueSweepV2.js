#!/usr/bin/env node
// Tørkørsel af det markedsdrevne søndags-sweep med et v2-artefakt (#3750/#3449).
//
// ⚠️ READ-ONLY. Scriptet udfører KUN SELECT. Det skriver aldrig til riders,
// aldrig til app_config, aldrig til sweep-loggen. Det er hele pointen: vi skal
// kunne se hvad sweepen VILLE gøre, før nogen overvejer at lade den gøre det
// ("simulér-før-ship"). Kør det mod hvad du vil - prod, staging, en branch.
//
// Kæden er den samme som backend/lib/marketValueSundaySweep.js (PR #3449) med
// ÉN bevidst forskel, som er selve pointen i beslutning 3 (15/8):
//
//     v1.1 (PR #3449):  support = min(1, n/K)          - hård mætning ved K
//     v2   (her):       Z       = n/(n + K)            - evidensvægt pr. rytter
//
//     w_rider   = global_weight x Z_rider
//     target    = (1 - w) x nuværende + w x markedsgæt
//     ny_værdi  = clamp(target, nuværende x (1 - cap), nuværende x (1 + cap))
//
// n er antallet af KVALIFICEREDE handler (samme #3750-filter som fit-scriptet)
// med samme type inden for ±O_window O-point og ±age_window år af rytteren.
//
// BRUG (kør fra backend/):
//   node scripts/dryRunMarketValueSweepV2.js
//   node scripts/dryRunMarketValueSweepV2.js --global-weight=1 --weekly-cap=0.25
//   node scripts/dryRunMarketValueSweepV2.js --weeks=4          (konvergens)
//   node scripts/dryRunMarketValueSweepV2.js --report=../docs/snapshots/3750/dryrun.json
//
// Databasen tages fra SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env, præcis
// som fit-scriptet. Peg på et andet miljø ved at sætte dem i miljøet:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/dryRunMarketValueSweepV2.js

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import {
  meanAbilityScore, evidenceWeight, predictMarketLn, buildQualifiedSales,
  seasonNumberAt, median, quantile,
} from "./fitMarketValueModelV2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const MODEL_PATH = argValue("model", join(__dirname, "..", "lib", "marketValueModelV2.json"));
const GLOBAL_WEIGHT = Number(argValue("global-weight", "1"));
const WEEKLY_CAP = Number(argValue("weekly-cap", "0.25"));
const WEEKS = Math.max(1, Number(argValue("weeks", "1")));
const REPORT_PATH = argValue("report", null);
const TOP_MOVERS = Math.max(1, Number(argValue("top-movers", "15")));

const fmtCz = (n) => (n == null ? "n/a" : Math.round(n).toLocaleString("da-DK"));
const fmtPct = (n) => (n == null ? "n/a" : (n * 100).toFixed(1) + "%");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }
  const projectRef = String(SUPABASE_URL).replace(/^https?:\/\//, "").split(".")[0];
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
  const typeColumn = model.type_column || "valuation_type";
  const K = model.guard?.K ?? 12;
  const oWindow = model.guard?.O_window ?? 5;
  const ageWindow = model.guard?.age_window ?? 3;

  if (model.guard?.support_mode !== "evidence_ratio_n_over_n_plus_k") {
    console.error(`Artefaktet har support_mode=${model.guard?.support_mode} - dette script implementerer kun Z=n/(n+K).`);
    process.exit(1);
  }

  console.log("=== TØRKØRSEL af markedsdrevet søndags-sweep (READ-ONLY) ===");
  console.log(`Projekt: ${projectRef} · model: ${model.version} fittet ${model.fitted_at}`);
  console.log(`Type-kolonne: ${typeColumn} · Z=n/(n+${K}) · global_weight=${GLOBAL_WEIGHT} · loft=±${fmtPct(WEEKLY_CAP)} · uger=${WEEKS}\n`);

  // ── Hold + sæson ──
  const allTeams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_ai, is_test_account, is_frozen, is_bank").order("id"));
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const isHumanTeam = (id) => {
    const t = teamById.get(id);
    return !!t && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen;
  };
  const realTeamIds = new Set(allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id));
  const divisionByTeam = new Map(allTeams.map((t) => [t.id, t.division]));

  const seasons = (await fetchAllRows(() => supabase
    .from("seasons").select("number, status, start_date").order("number")))
    .map((s) => ({ ...s, number: Number(s.number) }));
  const activeSeason = seasons.find((s) => s.status === "active");
  if (!activeSeason) throw new Error("Ingen aktiv sæson.");

  // ── Kvalificeret evidens (samme filter som fittet) ──
  const auctionRows = await fetchAllRows(() => supabase
    .from("auctions")
    .select("id, rider_id, current_price, starting_price, actual_end, is_guaranteed_sale, is_youth, seller_team_id, current_bidder_id")
    .eq("status", "completed").not("current_bidder_id", "is", null).gt("current_price", 0).order("id"));
  const transferRows = await fetchAllRows(() => supabase
    .from("transfer_offers")
    .select("id, rider_id, offer_amount, counter_amount, updated_at, seller_team_id, buyer_team_id")
    .eq("status", "accepted").not("rider_id", "is", null).order("id"));

  const auctionIds = auctionRows.map((a) => a.id);
  const bidRows = auctionIds.length
    ? await fetchAllRowsChunkedIn(auctionIds, (chunk) => supabase
        .from("auction_bids").select("auction_id, team_id").in("auction_id", chunk).order("id"))
    : [];
  const biddersByAuction = new Map();
  for (const b of bidRows) {
    const set = biddersByAuction.get(b.auction_id) || new Set();
    set.add(b.team_id);
    biddersByAuction.set(b.auction_id, set);
  }

  const saleRiderIds = [...new Set([...auctionRows.map((a) => a.rider_id), ...transferRows.map((t) => t.rider_id)].filter(Boolean))];
  const saleRiders = await fetchAllRowsChunkedIn(saleRiderIds, (chunk) => supabase
    .from("riders").select("id, birthdate, primary_type, valuation_type, market_value").in("id", chunk).order("id"));
  const saleRiderById = new Map(saleRiders.map((r) => [r.id, r]));

  const rawSales = [];
  for (const a of auctionRows) {
    rawSales.push({
      sale_id: a.id, source: "auction", rider_id: a.rider_id, price: Number(a.current_price),
      starting_price: Number(a.starting_price), sale_ts: a.actual_end,
      is_guaranteed_sale: !!a.is_guaranteed_sale, is_youth: !!a.is_youth,
      distinct_bidders: (biddersByAuction.get(a.id) || new Set()).size,
      seller_team_id: a.seller_team_id, buyer_team_id: a.current_bidder_id,
      seller_is_human: isHumanTeam(a.seller_team_id), buyer_is_human: isHumanTeam(a.current_bidder_id),
      anchor_value: Number(saleRiderById.get(a.rider_id)?.market_value) || null,
    });
  }
  for (const t of transferRows) {
    const price = Number(t.counter_amount ?? t.offer_amount);
    if (!Number.isFinite(price) || price <= 0) continue;
    rawSales.push({
      sale_id: t.id, source: "transfer", rider_id: t.rider_id, price, starting_price: null,
      sale_ts: t.updated_at, is_guaranteed_sale: false, is_youth: false, distinct_bidders: null,
      seller_team_id: t.seller_team_id, buyer_team_id: t.buyer_team_id,
      seller_is_human: isHumanTeam(t.seller_team_id), buyer_is_human: isHumanTeam(t.buyer_team_id),
      anchor_value: Number(saleRiderById.get(t.rider_id)?.market_value) || null,
    });
  }
  const { qualified, funnel } = buildQualifiedSales(rawSales);

  const saleAbilities = await fetchAllRowsChunkedIn(saleRiderIds, (chunk) => supabase
    .from("rider_derived_abilities").select("*").in("rider_id", chunk).order("rider_id"));
  const saleAbilitiesById = new Map(saleAbilities.map((a) => [a.rider_id, a]));

  // Evidens-index. Bemærk (samme bevidste forenkling som #3449's sweep): her
  // bruges rytterens NUVÆRENDE evner, ikke evnerne på salgsdagen. Indexet måler
  // kun "hvor tæt findes der evidens på DENNE rytters (O, alder)" - ikke prisen.
  const evidenceByType = new Map();
  for (const s of qualified) {
    const rider = saleRiderById.get(s.rider_id);
    const ab = saleAbilitiesById.get(s.rider_id);
    if (!rider || !ab) continue;
    const type = typeColumn === "valuation_type" ? (rider.valuation_type ?? rider.primary_type) : rider.primary_type;
    const seasonNo = seasonNumberAt(s.sale_ts, seasons) ?? activeSeason.number;
    const age = ageForSeason(rider.birthdate, seasonNo);
    const O = meanAbilityScore(ab);
    if (!type || O == null || age == null) continue;
    const arr = evidenceByType.get(type) || [];
    arr.push({ O, age });
    evidenceByType.set(type, arr);
  }
  const evidenceCount = [...evidenceByType.values()].reduce((a, b) => a + b.length, 0);
  console.log(`Kvalificeret evidens: ${funnel.qualified} handler (${evidenceCount} med brugbar (O, alder)); rå: ${funnel.raw}.`);

  function countNearby(O, age, type) {
    const arr = evidenceByType.get(type) || [];
    let c = 0;
    for (const s of arr) if (Math.abs(s.O - O) <= oWindow && Math.abs(s.age - age) <= ageWindow) c += 1;
    return c;
  }

  // ── Population ──
  const allRiders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, birthdate, popularity, potentiale, primary_type, valuation_type, is_retired, is_academy, base_value")
    .order("id"));
  const owned = allRiders.filter((r) => r.team_id != null && realTeamIds.has(r.team_id) && !r.is_retired && !r.is_academy);
  const allAbilities = await fetchAllRows(() => supabase
    .from("rider_derived_abilities").select("*").order("rider_id"));
  const abilitiesById = new Map(allAbilities.map((a) => [a.rider_id, a]));

  const rows = [];
  let skipped = 0;
  for (const r of owned) {
    const ab = abilitiesById.get(r.id);
    const type = typeColumn === "valuation_type" ? (r.valuation_type ?? r.primary_type) : r.primary_type;
    const age = ageForSeason(r.birthdate, activeSeason.number);
    const O = ab ? meanAbilityScore(ab) : null;
    if (!ab || !type || O == null || age == null) { skipped += 1; continue; }
    const current = Number(r.base_value) > 0 ? Number(r.base_value) : 1000;
    const marketPred = Math.max(1, Math.round(Math.exp(predictMarketLn(model.coefficients, {
      O, age, potentiale: Number(r.potentiale) || 0, popularity: Number(r.popularity) || 0,
      is_youth: false, type,
    }))));
    const n = countNearby(O, age, type);
    rows.push({
      rider_id: r.id, division: divisionByTeam.get(r.team_id) ?? null, type, age, O,
      current_value: current, market_pred: marketPred,
      n, Z: evidenceWeight(n, K), value: current,
    });
  }
  console.log(`Population: ${rows.length} ryttere (${skipped} droppet: mgl. evner/alder/type).\n`);

  // ── Uge-for-uge ──
  const weekSummaries = [];
  for (let week = 1; week <= WEEKS; week++) {
    for (const r of rows) {
      const w = GLOBAL_WEIGHT * r.Z;
      const target = (1 - w) * r.value + w * r.market_pred;
      r.value = Math.max(1, Math.round(clamp(target, r.value * (1 - WEEKLY_CAP), r.value * (1 + WEEKLY_CAP))));
    }
    const rel = rows.filter((r) => r.current_value > 0).map((r) => (r.value - r.current_value) / r.current_value);
    const changed = rows.filter((r) => r.value !== r.current_value).length;
    const sumBefore = rows.reduce((a, r) => a + r.current_value, 0);
    const sumAfter = rows.reduce((a, r) => a + r.value, 0);
    const summary = {
      week,
      changed,
      unchanged: rows.length - changed,
      p10_rel: quantile(rel, 0.1), p50_rel: median(rel), p90_rel: quantile(rel, 0.9),
      losers_over_10pct: rel.filter((v) => v <= -0.10).length,
      losers_over_25pct: rel.filter((v) => v <= -0.25).length,
      gainers_over_10pct: rel.filter((v) => v >= 0.10).length,
      total_value_before: sumBefore, total_value_after: sumAfter,
      total_value_change_rel: sumBefore > 0 ? (sumAfter - sumBefore) / sumBefore : null,
    };
    weekSummaries.push(summary);
    console.log(`Uge ${week}: ${changed} ændret / ${rows.length - changed} uændret · ` +
      `relativ ændring fra udgangspunktet P10=${fmtPct(summary.p10_rel)} median=${fmtPct(summary.p50_rel)} P90=${fmtPct(summary.p90_rel)}`);
    console.log(`         samlet trupværdi ${fmtCz(sumBefore)} → ${fmtCz(sumAfter)} (${fmtPct(summary.total_value_change_rel)}) · ` +
      `${summary.losers_over_25pct} ryttere har tabt 25 %+ · ${summary.gainers_over_10pct} har vundet 10 %+`);
  }

  // ── Største bevægelser ──
  const movers = [...rows].sort((a, b) => Math.abs(b.value - b.current_value) - Math.abs(a.value - a.current_value)).slice(0, TOP_MOVERS);
  console.log(`\nStørste ${TOP_MOVERS} bevægelser efter ${WEEKS} uge(r):`);
  for (const m of movers) {
    const d = m.value - m.current_value;
    console.log(`  ${String(m.rider_id).slice(0, 8)} div=${m.division ?? "?"} ${String(m.type).padEnd(15)} alder=${m.age} ` +
      `n=${String(m.n).padStart(3)} Z=${m.Z.toFixed(2)} · ${fmtCz(m.current_value)} → ${fmtCz(m.value)} (${d >= 0 ? "+" : ""}${fmtCz(d)})`);
  }

  // ── Fordeling pr. division og aldersbånd ──
  const byDivision = {};
  for (const r of rows) {
    const key = r.division ?? "ukendt";
    (byDivision[key] ??= []).push((r.value - r.current_value) / (r.current_value || 1));
  }
  console.log("\nMedian relativ ændring pr. division:");
  for (const [d, arr] of Object.entries(byDivision).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    console.log(`  division ${String(d).padEnd(8)} n=${String(arr.length).padStart(5)} median=${fmtPct(median(arr))} ` +
      `P10=${fmtPct(quantile(arr, 0.1))} P90=${fmtPct(quantile(arr, 0.9))}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    project_ref: projectRef,
    model: { version: model.version, fitted_at: model.fitted_at, type_column: typeColumn, path: MODEL_PATH },
    params: { global_weight: GLOBAL_WEIGHT, weekly_cap: WEEKLY_CAP, weeks: WEEKS, K, o_window: oWindow, age_window: ageWindow },
    evidence_funnel: funnel,
    population: { n: rows.length, skipped },
    weeks: weekSummaries,
    z_distribution: {
      p10: quantile(rows.map((r) => r.Z), 0.1),
      p50: median(rows.map((r) => r.Z)),
      p90: quantile(rows.map((r) => r.Z), 0.9),
      zero_share: rows.filter((r) => r.Z === 0).length / (rows.length || 1),
    },
    top_movers: movers.map((m) => ({
      rider_id: m.rider_id, division: m.division, type: m.type, age: m.age, n: m.n, Z: m.Z,
      before: m.current_value, after: m.value, delta: m.value - m.current_value,
    })),
    division_medians: Object.fromEntries(Object.entries(byDivision).map(([d, arr]) => [d, { n: arr.length, median_rel: median(arr) }])),
  };

  if (REPORT_PATH) {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`\nSkrev rapport: ${REPORT_PATH}`);
  }
  console.log("\n=== Færdig. Intet er skrevet til databasen. ===");
}

main().catch((e) => {
  console.error("FEJL:", e);
  process.exit(1);
});
