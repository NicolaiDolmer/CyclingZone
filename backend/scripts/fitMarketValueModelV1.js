#!/usr/bin/env node
// Markedsmodel v1.1 — iteration på v1 (issue #3448), ejer-beslutning 6/8: "værdierne
// skal afspejle hvad managers rent faktisk køber og sælger dem til … omdømme, alder,
// nationalitet, evner, ryttertype mv." v1.1 (#3448 leveranceplan pkt. 2) løser tre ting
// v1 efterlod åbne:
//   1) Popularity-konfounden (v1: koefficient -0,0185, modsat intentionen) —
//      undersøgt empirisk (korrelationer + tre refit-varianter) og afgjort her.
//   2) Støtte-guard for uhandlede segmenter (elite/youth, v4-værdi 1,7-22,8M, 0
//      handelsevidens — jf. #2799: v4's elitepriser er SELV beviseligt oppustede).
//   3) Ugentligt pr.-rytter ændrings-loft, simuleret uge-for-uge 9/8 → 16/8 → 23/8
//      (sæsonskiftet) under tre loft-kandidater (±15/25/40%).
//
// READ-ONLY mod prod: kun SELECT. Ingen writes, ingen migrationer. Skriver KUN:
//   backend/scripts/marketValueModelV1.draft.json  (v1.1-koefficienter + guard)
// samt læsbare rapporter til scratchpad (se REPORT_PATH/REPORT_JSON_PATH nedenfor).
//
// Metode (uændret ln-lineær hedonisk model, egen OLS/WLS — ingen nye dependencies):
//   ln(price) = a + b·O + c·O² + d·age + e·age² + f·potentiale + [g·popularity(_resid)]
//               + h·is_youth + offset[primary_type]
//   O = meanAbilityScore(abilities) — SAMME kanoniske O-beregning som
//   backend/lib/riderValuation.js (riderOverall/meanAbilityScore), 0-99 kontinuert.
//
// Vægtning: konkurrerende salg (≥2 bud i auction_bids) vægtes 2:1 mod 1-buds-salg
// og transfer_offers (forhandlet, ikke konkurrence-prissat).
//
// Holdout: seneste 20% af salgene TIDSMÆSSIGT (sale_ts) — undgår at fremtiden
// lækker ind i træningssættet. Samme split som v1, så v1/v1.1/v4 er direkte
// sammenlignelige.
//
//   node scripts/fitMarketValueModelV1.js   (kør fra backend/ — dotenv/config
//   forventer backend/.env i cwd)
//
// --refit (#3448 pkt. 5, tilføjet i implementerings-PR'en): kvalitets-gate for
// UGENTLIG genfitning af den PROMOVEREDE model (backend/lib/marketValueModelV1.json,
// den marketValueSundaySweep.js rent faktisk læser). Uden --refit skriver
// scriptet KUN draft-JSON'en (uændret adfærd — inspicér før du promoverer). Med
// --refit sammenlignes den nye fits holdout-MAE(CZ$) mod den NUVÆRENDE
// promoverede models (holdout.market_v1_1.mae_czk) — forværres den med MERE end
// 10 %, AFVISES overskrivningen (exit-kode 1, draft-JSON skrives stadig til
// inspektion). Første promotion (ingen fil endnu på PROMOTED_MODEL_PATH) har
// intet at sammenligne imod og promoverer uden gate. Selve den UGENTLIGE
// KADENCE af refit forbliver manuel/agent-drevet i v1 — ingen cron kalder dette
// script; det er et bevidst fravalg (se PR #3448's beskrivelse), ikke en
// forglemmelse.
//
//   node scripts/fitMarketValueModelV1.js --refit

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { ABILITY_KEYS, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { predictBaseValueV4 } from "../lib/riderCareerNpv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "marketValueModelV1.draft.json");
const V4_MODEL_PATH = join(__dirname, "..", "lib", "riderValuationModelV4.json");
const PROMOTED_MODEL_PATH = join(__dirname, "..", "lib", "marketValueModelV1.json");
const SCRATCH_DIR =
  "C:\\Users\\Nicolai\\AppData\\Local\\Temp\\claude\\C--Dev-CyclingZone\\9e7f6053-4cce-4595-93fa-ef5fe13ed219\\scratchpad";
const REPORT_PATH = join(SCRATCH_DIR, "market_value_model_v1_1_report.md");
const REPORT_JSON_PATH = join(SCRATCH_DIR, "market_value_model_v1_1_report.json");

const REFIT_MODE = process.argv.includes("--refit");
const REFIT_MAE_REGRESSION_THRESHOLD = 0.10; // #3448 pkt. 5: nægt overskrivning hvis holdout-MAE forværres >10%

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
const HOLDOUT_FRAC = 0.2;

// Guard-vindue for "handelsevidens i rytterens feature-region": ±5 O-point, ±3 år,
// samme primary_type (prisniveauer er typeoffset-drevne — evidens for én type siger
// intet om en anden). Se pkt. 2 (guard-design) for K-valg (databaseret, se nedenfor).
const GUARD_O_WINDOW = 5;
const GUARD_AGE_WINDOW = 3;

// Loft-kandidater der simuleres (pkt. 3).
const CAP_CANDIDATES = [0.15, 0.25, 0.40];

// ─────────────────────────────── Helpers (rene funktioner) ───────────────────

function meanAbilityScore(abilities) {
  let sum = 0, n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : null;
}

function ageAt(birthdate, atDate) {
  if (!birthdate || !atDate) return null;
  const b = new Date(birthdate).getTime();
  const d = new Date(atDate).getTime();
  if (!Number.isFinite(b) || !Number.isFinite(d)) return null;
  return (d - b) / MS_PER_YEAR;
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function quantile(arr, q) {
  const a = [...arr].filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

function ageBand(age) {
  if (age < 23) return "<23";
  if (age < 26) return "23-25";
  if (age < 29) return "26-28";
  if (age < 32) return "29-31";
  return "32+";
}

// Gauss-Jordan-elimination m. partial pivoting. Løser A·x = b.
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-9) {
      throw new Error(`Singulær design-matrix ved kolonne ${col} (kolinearitet — for få samples for en feature).`);
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const pivVal = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// ── Generaliseret feature-/design-matrix-lag (understøtter flere feature-sæt:
//    A=raw popularity, B=uden popularity, C=residualiseret popularity, samt
//    side-regressionen der residualiserer popularity selv). ──
function featureValue(key, r) {
  switch (key) {
    case "intercept": return 1;
    case "O": return r.O;
    case "O2": return r.O * r.O;
    case "age": return r.age;
    case "age2": return r.age * r.age;
    case "potentiale": return r.potentiale;
    case "popularity": return r.popularity;
    case "popularity_resid": return r.popularity_resid;
    case "is_youth": return r.is_youth;
    default: throw new Error(`Ukendt feature-nøgle: ${key}`);
  }
}

function buildDesignRow(r, featureKeys, dummyTypes) {
  const x = featureKeys.map((k) => featureValue(k, r));
  for (const t of dummyTypes) x.push(r.primary_type === t ? 1 : 0);
  return x;
}

function fitWLS(rows, featureKeys, dummyTypes, { yFn = (r) => r.ln_price, wFn = (r) => r.weight } = {}) {
  const p = featureKeys.length + dummyTypes.length;
  const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
  const XtWy = new Array(p).fill(0);
  for (const r of rows) {
    const x = buildDesignRow(r, featureKeys, dummyTypes);
    const w = wFn(r);
    const y = yFn(r);
    for (let i = 0; i < p; i++) {
      XtWy[i] += w * x[i] * y;
      for (let j = 0; j < p; j++) XtWX[i][j] += w * x[i] * x[j];
    }
  }
  return solveLinearSystem(XtWX, XtWy);
}

function predictLinear(beta, r, featureKeys, dummyTypes) {
  const x = buildDesignRow(r, featureKeys, dummyTypes);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += beta[i] * x[i];
  return s;
}

function weightedR2(rows, beta, featureKeys, dummyTypes, { yFn = (r) => r.ln_price, wFn = (r) => r.weight } = {}) {
  let wSum = 0, wyMean = 0;
  for (const r of rows) { wSum += wFn(r); wyMean += wFn(r) * yFn(r); }
  wyMean /= wSum;
  let ssRes = 0, ssTot = 0;
  for (const r of rows) {
    const pred = predictLinear(beta, r, featureKeys, dummyTypes);
    const y = yFn(r);
    ssRes += wFn(r) * (y - pred) ** 2;
    ssTot += wFn(r) * (y - wyMean) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : null;
}

function evalHoldout(rows, predictLnFn) {
  let sumAbsLn = 0, sumAbsCz = 0, sumApe = 0, n = 0;
  for (const r of rows) {
    const predLn = predictLnFn(r);
    if (predLn == null || !Number.isFinite(predLn)) continue;
    const predCz = Math.exp(predLn);
    sumAbsLn += Math.abs(predLn - r.ln_price);
    sumAbsCz += Math.abs(predCz - r.price);
    sumApe += Math.abs(predCz - r.price) / r.price;
    n += 1;
  }
  return {
    n,
    mae_ln: n ? sumAbsLn / n : null,
    mae_czk: n ? Math.round(sumAbsCz / n) : null,
    mape: n ? sumApe / n : null,
  };
}

function activeDummyTypes(rows, refType) {
  const present = new Set(rows.map((r) => r.primary_type));
  return RIDER_TYPE_KEYS.filter((t) => t !== refType && present.has(t));
}

function assembleOffsets(beta, refType, dummyTypes, featureCount) {
  const raw = { [refType]: 0 };
  dummyTypes.forEach((t, i) => { raw[t] = beta[featureCount + i]; });
  const offsets = {};
  for (const t of RIDER_TYPE_KEYS) offsets[t] = Object.prototype.hasOwnProperty.call(raw, t) ? raw[t] : null;
  const known = Object.values(offsets).filter((v) => Number.isFinite(v));
  const floor = known.length ? Math.min(...known) : 0;
  const shifted = {};
  for (const t of RIDER_TYPE_KEYS) shifted[t] = Number.isFinite(offsets[t]) ? offsets[t] - floor : null;
  return { offsets: shifted, floorShift: floor, unsampledTypes: RIDER_TYPE_KEYS.filter((t) => offsets[t] === null) };
}

function offsetFor(type, offsetDict) {
  const v = offsetDict[type];
  if (Number.isFinite(v)) return v;
  const known = Object.values(offsetDict).filter((x) => Number.isFinite(x));
  return known.length ? Math.min(...known) : 0;
}

// Fuld ln(price)-prædiktion fra det FÆRDIGE (skiftet) v1.1-koefficient-sæt.
// popularityMode styrer om/hvordan popularity indgår (jf. pkt. 1-beslutning).
function predictMarketLn(coef, { O, age, potentiale, popularity, popularity_resid, is_youth, primary_type }) {
  const off = offsetFor(primary_type, coef.offset);
  let s = coef.a + coef.b * O + coef.c * O * O + coef.d_age * age + coef.e_age2 * age * age +
    coef.f_potentiale * potentiale + coef.h_is_youth * (is_youth ? 1 : 0) + off;
  if (coef.popularity_mode === "raw") s += coef.g_popularity * popularity;
  else if (coef.popularity_mode === "residualized") s += coef.g_popularity * popularity_resid;
  return s;
}

// Weighted Pearson-korrelation.
function weightedCorr(rows, xFn, yFn, wFn = (r) => r.weight) {
  let wSum = 0, xMean = 0, yMean = 0;
  for (const r of rows) { const w = wFn(r); wSum += w; xMean += w * xFn(r); yMean += w * yFn(r); }
  xMean /= wSum; yMean /= wSum;
  let cov = 0, varX = 0, varY = 0;
  for (const r of rows) {
    const w = wFn(r);
    const dx = xFn(r) - xMean, dy = yFn(r) - yMean;
    cov += w * dx * dy; varX += w * dx * dx; varY += w * dy * dy;
  }
  return (varX > 0 && varY > 0) ? cov / Math.sqrt(varX * varY) : null;
}

function weightedMean(rows, xFn, wFn = (r) => r.weight) {
  let wSum = 0, s = 0;
  for (const r of rows) { const w = wFn(r); wSum += w; s += w * xFn(r); }
  return wSum > 0 ? s / wSum : null;
}

function fmtCz(n) { return n == null ? "n/a" : Math.round(n).toLocaleString("da-DK"); }
function fmtPct(n) { return n == null ? "n/a" : (n * 100).toFixed(1) + "%"; }

// ─────────────────────────────────────── main ────────────────────────────────

async function main() {
  console.log("=== Markedsmodel v1.1 — popularity-konfound + støtte-guard + ugentligt loft (#3448) ===");
  console.log("READ-ONLY mod prod. Ingen writes ud over marketValueModelV1.draft.json + scratchpad-rapporter.\n");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // ── 1. Salg: completed auctions m. bud + accepterede transfer_offers ── (uændret fra v1)
  const auctionRows = await fetchAllRows(() => supabase
    .from("auctions")
    .select("id, rider_id, current_price, actual_end, is_guaranteed_sale, is_youth, is_flash, starting_price")
    .eq("status", "completed")
    .not("current_bidder_id", "is", null)
    .gt("current_price", 0)
    .order("id"));

  const transferRows = await fetchAllRows(() => supabase
    .from("transfer_offers")
    .select("id, rider_id, offer_amount, counter_amount, updated_at")
    .eq("status", "accepted")
    .not("rider_id", "is", null)
    .order("id"));

  const rawSales = [];
  for (const a of auctionRows) {
    rawSales.push({
      sale_id: a.id, source: "auction", rider_id: a.rider_id, price: Number(a.current_price),
      sale_ts: a.actual_end, is_guaranteed_sale: !!a.is_guaranteed_sale, is_youth: !!a.is_youth,
      is_flash: !!a.is_flash, starting_price: a.starting_price, n_bids: null,
    });
  }
  let transferSkippedBadPrice = 0;
  for (const t of transferRows) {
    const price = Number(t.counter_amount ?? t.offer_amount);
    if (!Number.isFinite(price) || price <= 0) { transferSkippedBadPrice++; continue; }
    rawSales.push({
      sale_id: t.id, source: "transfer", rider_id: t.rider_id, price,
      sale_ts: t.updated_at, is_guaranteed_sale: false, is_youth: false, is_flash: false,
      starting_price: null, n_bids: null,
    });
  }

  const guaranteedCount = rawSales.filter((s) => s.is_guaranteed_sale).length;
  const sales = rawSales.filter((s) => !s.is_guaranteed_sale);

  console.log(`Salg: ${auctionRows.length} completed auctions + ${transferRows.length} accepted transfer_offers ` +
    `(${transferSkippedBadPrice} droppet: ugyldig pris) = ${rawSales.length} rå salg.`);

  const auctionIds = auctionRows.map((a) => a.id);
  const bidRows = auctionIds.length
    ? await fetchAllRowsChunkedIn(auctionIds, (chunk) => supabase
        .from("auction_bids").select("auction_id").in("auction_id", chunk).order("id"))
    : [];
  const bidCountByAuction = new Map();
  for (const b of bidRows) bidCountByAuction.set(b.auction_id, (bidCountByAuction.get(b.auction_id) || 0) + 1);
  for (const s of sales) {
    if (s.source === "auction") s.n_bids = bidCountByAuction.get(s.sale_id) || 0;
  }
  const competitiveCount = sales.filter((s) => s.source === "auction" && s.n_bids >= 2).length;
  console.log(`Konkurrerende auktioner (>=2 bud): ${competitiveCount} af ${sales.filter((s) => s.source === "auction").length}.`);

  // ── 2. Ryttere + evner ── (uændret fra v1)
  const riderIds = [...new Set(sales.map((s) => s.rider_id))];
  const riderRows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("riders")
    .select("id, birthdate, nationality_code, popularity, potentiale, primary_type, secondary_type, is_u25")
    .in("id", chunk).order("id"));
  const riderById = new Map(riderRows.map((r) => [r.id, r]));

  const abilityRows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("rider_derived_abilities").select("*").in("rider_id", chunk).order("rider_id"));
  const currentAbilitiesById = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const historyRows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("rider_derived_ability_history")
    .select("rider_id, snapshot_date, abilities")
    .in("rider_id", chunk).order("rider_id"));
  const historyById = new Map();
  for (const h of historyRows) {
    const arr = historyById.get(h.rider_id) || [];
    arr.push(h);
    historyById.set(h.rider_id, arr);
  }
  for (const arr of historyById.values()) arr.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  function nearestHistoricalAbilities(riderId, saleTs) {
    const arr = historyById.get(riderId);
    if (!arr || !arr.length) return null;
    const saleDay = String(saleTs).slice(0, 10);
    let best = null;
    for (const h of arr) {
      if (h.snapshot_date <= saleDay) best = h;
      else break;
    }
    return best ? best.abilities : null;
  }

  // ── 3. Byg feature-rækker ── (uændret fra v1)
  const rows = [];
  let usedHistorical = 0, usedCurrentFallback = 0, droppedMissingRider = 0, droppedMissingAbilities = 0, droppedUntyped = 0;
  for (const s of sales) {
    const rider = riderById.get(s.rider_id);
    if (!rider || !rider.birthdate) { droppedMissingRider += 1; continue; }
    const age = ageAt(rider.birthdate, s.sale_ts);
    if (age == null || age < 14 || age > 45) { droppedMissingRider += 1; continue; }

    let abilities = nearestHistoricalAbilities(s.rider_id, s.sale_ts);
    let abilitiesSource = "historical";
    if (!abilities) {
      const cur = currentAbilitiesById.get(s.rider_id);
      abilities = cur || null;
      abilitiesSource = "current_fallback";
    }
    if (!abilities) { droppedMissingAbilities += 1; continue; }
    const O = meanAbilityScore(abilities);
    if (O == null) { droppedMissingAbilities += 1; continue; }

    const type = rider.primary_type;
    if (!type || !RIDER_TYPE_KEYS.includes(type)) { droppedUntyped += 1; continue; }

    if (abilitiesSource === "historical") usedHistorical += 1; else usedCurrentFallback += 1;

    rows.push({
      sale_id: s.sale_id, source: s.source, rider_id: s.rider_id, price: s.price,
      ln_price: Math.log(s.price), sale_ts: s.sale_ts,
      weight: s.source === "auction" && s.n_bids >= 2 ? 2 : 1,
      O, age, potentiale: Number(rider.potentiale) || 0, popularity: Number(rider.popularity) || 0,
      is_youth: s.is_youth ? 1 : 0, primary_type: type, nationality_code: rider.nationality_code,
      abilities_source: abilitiesSource,
    });
  }

  console.log(`\nFeature-rækker: ${rows.length} (droppet: ${droppedMissingRider} mgl. rider/alder, ` +
    `${droppedMissingAbilities} mgl. evner, ${droppedUntyped} utypede).`);

  // Reference-type + fulde dummy-typer (bruges til BÅDE pris-modellen og
  // popularity-sideregressionen — bestemmes tidligt så begge kan dele den).
  const typeCounts = {};
  for (const r of rows) typeCounts[r.primary_type] = (typeCounts[r.primary_type] || 0) + 1;
  const refType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
  const fullDummyTypes = activeDummyTypes(rows, refType);

  // ═══════════════════════════════════════════════════════════════════════
  // PKT. 1 — Popularity-konfound: korrelationer + tre refit-varianter
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n══════════════ PKT. 1: Popularity-konfound ══════════════");

  const corrPopO = weightedCorr(rows, (r) => r.popularity, (r) => r.O);
  const corrPopAge = weightedCorr(rows, (r) => r.popularity, (r) => r.age);
  const corrPopPotentiale = weightedCorr(rows, (r) => r.popularity, (r) => r.potentiale);
  const corrPopLnPrice = weightedCorr(rows, (r) => r.popularity, (r) => r.ln_price);
  const corrPopIsYouth = weightedCorr(rows, (r) => r.popularity, (r) => r.is_youth);

  console.log(`Korrelation (vægtet, n=${rows.length}):`);
  console.log(`  popularity ↔ O           : ${corrPopO?.toFixed(3)}`);
  console.log(`  popularity ↔ age         : ${corrPopAge?.toFixed(3)}`);
  console.log(`  popularity ↔ potentiale  : ${corrPopPotentiale?.toFixed(3)}`);
  console.log(`  popularity ↔ ln(price)   : ${corrPopLnPrice?.toFixed(3)}  (rå, u-kontrolleret signal)`);
  console.log(`  popularity ↔ is_youth    : ${corrPopIsYouth?.toFixed(3)}`);

  const popByType = {};
  for (const t of [refType, ...fullDummyTypes]) {
    popByType[t] = weightedMean(rows.filter((r) => r.primary_type === t), (r) => r.popularity);
  }
  console.log("Gns. popularity pr. type (vægtet):");
  for (const [t, v] of Object.entries(popByType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(16)} ${v?.toFixed(1)}`);
  }

  // Side-regression: residualisér popularity mod (O, age, age², potentiale, type) —
  // dvs. den del af popularity der IKKE allerede er forklaret af de andre features
  // der er i hovedmodellen. Bruges i variant C.
  const POP_SIDE_FEATURES = ["intercept", "O", "O2", "age", "age2", "potentiale"];
  const popBeta = fitWLS(rows, POP_SIDE_FEATURES, fullDummyTypes, { yFn: (r) => r.popularity, wFn: () => 1 });
  const popSideR2 = weightedR2(rows, popBeta, POP_SIDE_FEATURES, fullDummyTypes, { yFn: (r) => r.popularity, wFn: () => 1 });
  for (const r of rows) {
    r.popularity_resid = r.popularity - predictLinear(popBeta, r, POP_SIDE_FEATURES, fullDummyTypes);
  }
  console.log(`\nSide-regression popularity ~ O+O²+age+age²+potentiale+type: R²=${popSideR2?.toFixed(4)} ` +
    `(hvor meget af popularity-variansen O/alder/potentiale/type allerede "forklarer" — resten er popularity_resid).`);

  const corrResidPopLnPrice = weightedCorr(rows, (r) => r.popularity_resid, (r) => r.ln_price);
  console.log(`Korrelation popularity_resid ↔ ln(price): ${corrResidPopLnPrice?.toFixed(3)} ` +
    `(dette ER i store træk hvad variant C's koefficient måler).`);

  // Tre feature-sæt for hovedprismodellen.
  const FEATURES_A = ["intercept", "O", "O2", "age", "age2", "potentiale", "popularity", "is_youth"]; // v1: raw popularity
  const FEATURES_B = ["intercept", "O", "O2", "age", "age2", "potentiale", "is_youth"];                // uden popularity
  const FEATURES_C = ["intercept", "O", "O2", "age", "age2", "potentiale", "popularity_resid", "is_youth"]; // residualiseret

  // ── 4. Tidsbaseret train/holdout-split (fælles for alle tre varianter) ──
  const sorted = [...rows].sort((a, b) => String(a.sale_ts).localeCompare(String(b.sale_ts)));
  const holdoutN = Math.round(sorted.length * HOLDOUT_FRAC);
  const trainRows = sorted.slice(0, sorted.length - holdoutN);
  const holdoutRows = sorted.slice(sorted.length - holdoutN);
  console.log(`\nTrain/holdout (tidsbaseret, seneste ${(HOLDOUT_FRAC * 100).toFixed(0)}%): ` +
    `train n=${trainRows.length}, holdout n=${holdoutRows.length} (${holdoutRows[0]?.sale_ts} → ${holdoutRows[holdoutRows.length - 1]?.sale_ts}).`);

  const trainDummyTypes = activeDummyTypes(trainRows, refType);

  function fitAndEval(featureKeys, label) {
    const beta = fitWLS(trainRows, featureKeys, trainDummyTypes);
    const trainR2 = weightedR2(trainRows, beta, featureKeys, trainDummyTypes);
    const holdout = evalHoldout(holdoutRows, (r) => predictLinear(beta, r, featureKeys, trainDummyTypes));
    console.log(`\nVariant ${label}: train R²(log)=${trainR2?.toFixed(4)}  ` +
      `holdout MAE(ln)=${holdout.mae_ln?.toFixed(4)}  MAE(CZ$)=${holdout.mae_czk?.toLocaleString()}  MAPE=${(holdout.mape * 100).toFixed(1)}%`);
    return { beta, trainR2, holdout };
  }

  const variantA = fitAndEval(FEATURES_A, "A (raw popularity, = v1)");
  const variantB = fitAndEval(FEATURES_B, "B (uden popularity)");
  const variantC = fitAndEval(FEATURES_C, "C (popularity residualiseret)");

  const popIdxA = FEATURES_A.indexOf("popularity");
  const popIdxC = FEATURES_C.indexOf("popularity_resid");
  console.log(`\nKoefficient popularity: variant A(raw)=${variantA.beta[popIdxA].toFixed(4)}  ` +
    `variant C(resid)=${variantC.beta[popIdxC].toFixed(4)}`);

  // ── Beslutning (databaseret, se rapport for fuld begrundelse) ──
  // Regel: foretræk C (transformér) hvis fortegnet vender til positivt OG
  // holdout-MAE ikke forværres nævneværdigt (>2%) vs. B. Ellers foretræk B (drop)
  // hvis B er inden for 2% af den bedste holdout-MAE (parsimoni — ingen grund til
  // at beholde en variabel der ikke måler noget validt). Ellers behold A.
  const maeA = variantA.holdout.mae_czk, maeB = variantB.holdout.mae_czk, maeC = variantC.holdout.mae_czk;
  const cPositive = variantC.beta[popIdxC] > 0;
  let popularityDecision, chosenVariant, chosenFeatures, chosenLabel;
  if (cPositive && maeC <= maeB * 1.02) {
    popularityDecision = "transform";
    chosenVariant = variantC; chosenFeatures = FEATURES_C; chosenLabel = "C (popularity residualiseret)";
  } else if (maeB <= Math.min(maeA, maeC) * 1.02) {
    popularityDecision = "drop";
    chosenVariant = variantB; chosenFeatures = FEATURES_B; chosenLabel = "B (uden popularity)";
  } else {
    popularityDecision = "keep_raw";
    chosenVariant = variantA; chosenFeatures = FEATURES_A; chosenLabel = "A (raw popularity, uændret fra v1)";
  }
  console.log(`\n→ BESLUTNING (popularity): ${popularityDecision.toUpperCase()} — vælger variant ${chosenLabel}.`);

  // ── 5. Final fit PÅ HELE datasættet med den VALGTE feature-spec (til draft-json) ──
  const finalBeta = fitWLS(rows, chosenFeatures, fullDummyTypes);
  const finalR2 = weightedR2(rows, finalBeta, chosenFeatures, fullDummyTypes);
  const featureBaseCount = chosenFeatures.length;
  const { offsets: finalOffsets, floorShift, unsampledTypes } = assembleOffsets(finalBeta, refType, fullDummyTypes, featureBaseCount);
  const finalA = finalBeta[0] + floorShift;

  const idxO = chosenFeatures.indexOf("O"), idxO2 = chosenFeatures.indexOf("O2");
  const idxAge = chosenFeatures.indexOf("age"), idxAge2 = chosenFeatures.indexOf("age2");
  const idxPot = chosenFeatures.indexOf("potentiale");
  const idxPopRaw = chosenFeatures.indexOf("popularity");
  const idxPopResid = chosenFeatures.indexOf("popularity_resid");
  const idxYouth = chosenFeatures.indexOf("is_youth");

  const finalCoef = {
    a: finalA,
    b: finalBeta[idxO],
    c: finalBeta[idxO2],
    d_age: finalBeta[idxAge],
    e_age2: finalBeta[idxAge2],
    f_potentiale: finalBeta[idxPot],
    g_popularity: idxPopRaw >= 0 ? finalBeta[idxPopRaw] : (idxPopResid >= 0 ? finalBeta[idxPopResid] : 0),
    popularity_mode: idxPopRaw >= 0 ? "raw" : (idxPopResid >= 0 ? "residualized" : "dropped"),
    h_is_youth: finalBeta[idxYouth],
    offset: finalOffsets,
    a_floor_shift: 0,
  };
  // Hvis droppet: g_popularity meningsløs, sæt til 0 eksplicit for klarhed.
  if (finalCoef.popularity_mode === "dropped") finalCoef.g_popularity = 0;

  console.log(`\n── Final v1.1-fit (HELE datasættet, n=${rows.length}, popularity=${finalCoef.popularity_mode}, weighted R²(log)=${finalR2?.toFixed(4)}) ──`);
  console.log(`a=${finalA.toFixed(4)} b(O)=${finalCoef.b.toFixed(5)} c(O²)=${finalCoef.c.toExponential(3)} ` +
    `d(age)=${finalCoef.d_age.toFixed(4)} e(age²)=${finalCoef.e_age2.toExponential(3)} ` +
    `f(potentiale)=${finalCoef.f_potentiale.toFixed(4)} g(popularity, ${finalCoef.popularity_mode})=${finalCoef.g_popularity.toFixed(4)} ` +
    `h(is_youth)=${finalCoef.h_is_youth.toFixed(4)}`);

  // v1-koefficienter (uændret, for direkte sammenligning i output).
  const v1Coef = {
    a: 5.250117292803289, b: 0.09755971515350939, c: 0.00016375821380286776,
    d_age: 0.13920874227234634, e_age2: -0.0023008744653105913, f_potentiale: 0.2352095529674077,
    g_popularity: -0.018473006511599104, popularity_mode: "raw", h_is_youth: -0.45230065783017426,
    offset: {
      sprinter: 0.5863098247249124, tt: 0.181537445137884, climber: 0.27353128225558293,
      puncheur: 0.6113251439443864, brostensrytter: 0.4178199391995449, baroudeur: 0,
      rouleur: 0.022364545556452984, gc: 0.13581808688633046,
    },
  };
  const v1Holdout = { n: 205, mae_ln: 0.914436700508712, mae_czk: 56118, mape: 0.7971360302500812 };

  // v1.1 holdout på SAMME split (den valgte variants tal, allerede beregnet ovenfor).
  const v1_1Holdout = chosenVariant.holdout;

  // v4 (LIVE) på samme holdout, til 3-vejs-sammenligning.
  const v4Model = JSON.parse(readFileSync(V4_MODEL_PATH, "utf8"));
  let v4Skipped = 0;
  const v4Holdout = evalHoldout(holdoutRows, (r) => {
    const abilities = nearestHistoricalAbilities(r.rider_id, r.sale_ts) || currentAbilitiesById.get(r.rider_id);
    if (!abilities) { v4Skipped += 1; return null; }
    const v4Value = predictBaseValueV4(
      { primary_type: r.primary_type, potentiale: r.potentiale, age: r.age },
      abilities, v4Model,
    );
    if (!Number.isFinite(v4Value) || v4Value <= 0) { v4Skipped += 1; return null; }
    return Math.log(v4Value);
  });

  console.log(`\n── 3-vejs holdout-sammenligning (n=${holdoutRows.length}) ──`);
  console.log(`v1   (raw popularity)      : MAE(CZ$)=${v1Holdout.mae_czk.toLocaleString()}  MAPE=${(v1Holdout.mape * 100).toFixed(1)}%`);
  console.log(`v1.1 (${finalCoef.popularity_mode.padEnd(12)})       : MAE(CZ$)=${v1_1Holdout.mae_czk?.toLocaleString()}  MAPE=${(v1_1Holdout.mape * 100).toFixed(1)}%`);
  console.log(`v4   (LIVE)                : MAE(CZ$)=${v4Holdout.mae_czk?.toLocaleString()}  MAPE=${(v4Holdout.mape * 100).toFixed(1)}%  (${v4Skipped} skipped)`);

  // ═══════════════════════════════════════════════════════════════════════
  // PKT. 2 — Støtte-guard for uhandlede segmenter
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n══════════════ PKT. 2: Støtte-guard ══════════════");

  // Index: type → [{O, age}] over ALLE handler i datasættet (n=1027) — "hvor
  // meget reel handelsevidens findes der nær denne rytters (O, alder) inden for
  // samme type".
  const salesByType = new Map();
  for (const r of rows) {
    const arr = salesByType.get(r.primary_type) || [];
    arr.push({ O: r.O, age: r.age });
    salesByType.set(r.primary_type, arr);
  }
  function countNearby(O, age, type) {
    const arr = salesByType.get(type) || [];
    let c = 0;
    for (const s of arr) {
      if (Math.abs(s.O - O) <= GUARD_O_WINDOW && Math.abs(s.age - age) <= GUARD_AGE_WINDOW) c += 1;
    }
    return c;
  }

  // ── 6. Ejet population (deles af guard-kalibrering + scorecard + simulering) ──
  const allTeams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_ai, is_test_account, is_frozen, is_bank").order("id"));
  const realTeamIds = new Set(
    allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id)
  );
  const divisionByTeam = new Map(allTeams.map((t) => [t.id, t.division]));

  const allRiders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, birthdate, popularity, potentiale, primary_type, is_retired, is_academy, market_value")
    .order("id"));
  const ownedRiders = allRiders.filter((r) =>
    r.team_id != null && realTeamIds.has(r.team_id) && !r.is_retired && !r.is_academy
  );
  console.log(`\nEjet population: ${ownedRiders.length} ryttere (team_id sat, ejer-hold ikke test/frosset/bank, ikke retired/academy).`);

  const allAbilities = await fetchAllRows(() => supabase
    .from("rider_derived_abilities").select("*").order("rider_id"));
  const abilitiesByRider = new Map(allAbilities.map((a) => [a.rider_id, a]));

  const NOW = new Date();
  const population = [];
  let scPopSkipped = 0;
  for (const r of ownedRiders) {
    const ab = abilitiesByRider.get(r.id);
    if (!ab || !r.birthdate) { scPopSkipped += 1; continue; }
    const age = ageAt(r.birthdate, NOW);
    const O = meanAbilityScore(ab);
    if (age == null || O == null || !r.primary_type) { scPopSkipped += 1; continue; }
    const popularity = Number(r.popularity) || 0;
    const popularity_resid = popularity - predictLinear(popBeta, { O, age, potentiale: Number(r.potentiale) || 0, primary_type: r.primary_type }, POP_SIDE_FEATURES, fullDummyTypes);
    const marketLn = predictMarketLn(finalCoef, {
      O, age, potentiale: Number(r.potentiale) || 0, popularity, popularity_resid,
      is_youth: false, primary_type: r.primary_type,
    });
    const marketValue = Math.max(1, Math.round(Math.exp(marketLn)));
    const currentValue = Number(r.market_value) || 0;
    const nearby = countNearby(O, age, r.primary_type);
    population.push({
      rider_id: r.id, division: divisionByTeam.get(r.team_id) ?? null, age, primary_type: r.primary_type,
      O, current_value: currentValue, market_value: marketValue, count_nearby: nearby,
    });
  }
  console.log(`Scorecard-population: ${population.length} (${scPopSkipped} droppet: mgl. evner/alder/type).`);

  // Kalibrér K: se på fordelingen af count_nearby over den EJEDE population —
  // det er her guard'en reelt skal virke (ikke på selve salgsdatasættet, hvor
  // "nærmeste handel" trivielt tæller sig selv).
  const nearbyAll = population.map((p) => p.count_nearby);
  const nearbyPercentiles = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((q) => [q, quantile(nearbyAll, q)]);
  console.log("\ncount_nearby-fordeling over ejet population (±5 O-point, ±3 år, samme type):");
  for (const [q, v] of nearbyPercentiles) console.log(`  P${Math.round(q * 100)}: ${v}`);
  const zeroSupportCount = population.filter((p) => p.count_nearby === 0).length;
  console.log(`  Andel med count_nearby=0 (INGEN handelsevidens): ${((zeroSupportCount / population.length) * 100).toFixed(1)}% (n=${zeroSupportCount})`);

  // K-valg: median count_nearby over de riders der HAR mindst 1 nærliggende
  // handel (dvs. "typisk handlet" tæthed) — riders med denne tæthed eller mere
  // får FULD tillid (support=1); riders med mindre får proportionalt mindre
  // vægt; riders med 0 får support=0 (guard'en fastfryser dem — se pkt. 3-note).
  const positiveNearby = nearbyAll.filter((n) => n > 0);
  const K = Math.max(3, Math.round(median(positiveNearby) || 5));
  console.log(`  → K valgt = ${K} (median count_nearby blandt riders MED >=1 nærliggende handel).`);

  function supportFor(countNearby) { return Math.min(1, countNearby / K); }
  for (const p of population) p.support = supportFor(p.count_nearby);

  // Guard-dækning pr. aldersbånd (viser eksplicit at elite/youth-segmentet har
  // lav/nul støtte — den empiriske bekræftelse af problemet issue #3448 beskriver).
  const guardByAgeBand = {};
  for (const p of population) {
    const band = ageBand(p.age);
    (guardByAgeBand[band] ??= []).push(p.support);
  }
  console.log("\nGuard-dækning (median support) pr. aldersbånd:");
  for (const band of ["<23", "23-25", "26-28", "29-31", "32+"]) {
    const arr = guardByAgeBand[band] || [];
    console.log(`  ${band.padEnd(8)} median support=${median(arr)?.toFixed(2)}  P10=${quantile(arr, 0.1)?.toFixed(2)}  n=${arr.length}`);
  }

  // Ekstra: guard-status for de kendte #2799-hale-outliers (current_value > 1,7M —
  // v4-elitesegmentet der er beviseligt oppustet).
  const highValueRiders = population.filter((p) => p.current_value >= 1_700_000);
  const highValueZeroSupport = highValueRiders.filter((p) => p.support === 0).length;
  console.log(`\n#2799-segment (current_value >= 1,7M, n=${highValueRiders.length}): ` +
    `${highValueZeroSupport} (${((highValueZeroSupport / (highValueRiders.length || 1)) * 100).toFixed(0)}%) har support=0 (ingen handelsevidens → guard fastfryser dem denne runde).`);

  // ═══════════════════════════════════════════════════════════════════════
  // PKT. 3 — Ugentlig konvergens-simulering (3 loft-kandidater × 3 uger)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n══════════════ PKT. 3: Konvergens-simulering ══════════════");
  console.log("Antagelse: INGEN nye handler i simuleringsperioden (konservativt) — support/market_value konstant pr. uge.");

  // Uge-skema: (dato-label, global markedsvægt FØR guard-multiplikation)
  const WEEKS = [
    { label: "2026-08-09", globalWeight: 0.5 },
    { label: "2026-08-16", globalWeight: 0.5 },
    { label: "2026-08-23_saesonskifte", globalWeight: 1.0 },
  ];

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // simResults[cap][weekIndex] = array of { rider_id, division, age, primary_type, value, prevValue }
  const simResults = {};
  for (const cap of CAP_CANDIDATES) {
    let prevByRider = new Map(population.map((p) => [p.rider_id, p.current_value]));
    simResults[cap] = [];
    for (const week of WEEKS) {
      const weekRows = [];
      for (const p of population) {
        const prev = prevByRider.get(p.rider_id);
        const effectiveWeight = week.globalWeight * p.support;
        const target = effectiveWeight * p.market_value + (1 - effectiveWeight) * prev;
        const lo = prev * (1 - cap), hi = prev * (1 + cap);
        const newVal = clamp(target, lo, hi);
        weekRows.push({
          rider_id: p.rider_id, division: p.division, age: p.age, primary_type: p.primary_type,
          current_value: p.current_value, market_value: p.market_value, support: p.support,
          prev_value: prev, value: newVal,
        });
        prevByRider.set(p.rider_id, newVal);
      }
      simResults[cap].push({ label: week.label, globalWeight: week.globalWeight, rows: weekRows });
    }
  }

  function weekSummary(weekRows) {
    const relFromBaseline = weekRows.filter((r) => r.current_value > 0).map((r) => (r.value - r.current_value) / r.current_value);
    const byAgeBand = {};
    for (const r of weekRows) {
      const band = ageBand(r.age);
      (byAgeBand[band] ??= []).push((r.value - r.current_value) / (r.current_value || 1));
    }
    const ageBandTable = ["<23", "23-25", "26-28", "29-31", "32+"].map((band) => ({
      band, n: (byAgeBand[band] || []).length,
      median_rel_change: median(byAgeBand[band] || []),
      p10_rel_change: quantile(byAgeBand[band] || [], 0.1),
      p90_rel_change: quantile(byAgeBand[band] || [], 0.9),
    }));
    const byDivision = {};
    for (const r of weekRows) {
      const d = r.division ?? "ukendt";
      (byDivision[d] ??= []).push((r.value - r.current_value) / (r.current_value || 1));
    }
    const divisionTable = Object.entries(byDivision)
      .sort((a, b) => (a[0] === "ukendt" ? 1 : b[0] === "ukendt" ? -1 : Number(a[0]) - Number(b[0])))
      .map(([division, arr]) => ({
        division, n: arr.length, median_rel_change: median(arr),
        p10_rel_change: quantile(arr, 0.1), p90_rel_change: quantile(arr, 0.9),
      }));
    return {
      median_rel_change: median(relFromBaseline), p10_rel_change: quantile(relFromBaseline, 0.1), p90_rel_change: quantile(relFromBaseline, 0.9),
      age_band_table: ageBandTable, division_table: divisionTable,
    };
  }

  const simSummary = {};
  for (const cap of CAP_CANDIDATES) {
    simSummary[cap] = simResults[cap].map((w) => ({ label: w.label, globalWeight: w.globalWeight, ...weekSummary(w.rows) }));
    console.log(`\n── Loft ±${(cap * 100).toFixed(0)}% ──`);
    for (const w of simSummary[cap]) {
      console.log(`  ${w.label} (gw=${w.globalWeight}): median=${fmtPct(w.median_rel_change)} P10=${fmtPct(w.p10_rel_change)} P90=${fmtPct(w.p90_rel_change)}`);
    }
  }

  // Konvergens-mål: hvor stor andel af populationen er inden for 5% af deres
  // FULDE (u-loftede, u-guardede) 100%-markedsmål ved udgangen af uge 3 (23/8)?
  // Bruges til at afveje loft-kandidaterne mod hinanden.
  function convergenceShare(cap) {
    const week3 = simResults[cap][2].rows;
    let within5pct = 0;
    for (const r of week3) {
      const fullTarget = r.support * r.market_value + (1 - r.support) * r.current_value; // fuld guard-vægtet mål ved gw=1.0, u-loftet
      const gap = fullTarget > 0 ? Math.abs(r.value - fullTarget) / fullTarget : 0;
      if (gap <= 0.05) within5pct += 1;
    }
    return within5pct / week3.length;
  }
  const convergence = Object.fromEntries(CAP_CANDIDATES.map((c) => [c, convergenceShare(c)]));
  console.log("\nKonvergens ved 23/8 (andel af population inden for 5% af deres fulde guard-vægtede markedsmål, gw=1.0):");
  for (const [c, share] of Object.entries(convergence)) console.log(`  ±${(c * 100).toFixed(0)}%: ${fmtPct(share)}`);

  // Anbefalet loft: IKKE "vælg det der konvergerer hurtigst" (det vil pr.
  // konstruktion altid pege på ±40% — et cirkulært kriterie, da et større loft
  // ALTID konvergerer hurtigere). Loftets rolle er at bounde det MAKSIMALE
  // enkelt-uge-chok pr. rytter (per design: |Δ|/prev <= cap, hver uge) — det er
  // selve sikkerhedsventilen ejeren bad om ("løbende overgang, fordi der ikke
  // er så meget data endnu"). Default er derfor ±25% (balance: mærkbar men ikke
  // voldsom enkelt-uge-bevægelse); eskalér til ±40% KUN hvis ±25% giver
  // utilstrækkelig fremdrift (<40% konvergens); de-eskalér til ±15% hvis ±25%
  // allerede er tæt på mætning (>=85% — mere aggressivt loft giver da minimal
  // ekstra værdi mod ekstra chok-risiko).
  let recommendedCap;
  if (convergence[0.25] >= 0.85) recommendedCap = 0.15;
  else if (convergence[0.25] < 0.40) recommendedCap = 0.40;
  else recommendedCap = 0.25;
  console.log(`\n→ ANBEFALET LOFT: ±${(recommendedCap * 100).toFixed(0)}% (se rapport for fuld begrundelse).`);

  // Top-10 største flytninger under det anbefalede loft (uge 3, 23/8, vs.
  // oprindelig current_value).
  const recWeek3 = simResults[recommendedCap][2].rows;
  const byAbsDelta = [...recWeek3].sort((a, b) => Math.abs(b.value - b.current_value) - Math.abs(a.value - a.current_value));
  const top10Movers = byAbsDelta.slice(0, 10).map((r) => ({
    rider_id: r.rider_id, age: Math.round(r.age * 10) / 10, primary_type: r.primary_type, division: r.division,
    support: Math.round(r.support * 100) / 100,
    current_value: r.current_value, market_value: r.market_value, value_23_8: Math.round(r.value),
    delta: Math.round(r.value - r.current_value),
  }));
  console.log(`\nTop-10 største flytninger ved 23/8 under ±${(recommendedCap * 100).toFixed(0)}%-loftet:`);
  for (const m of top10Movers) {
    console.log(`  rider=${m.rider_id.slice(0, 8)} alder=${m.age} type=${m.primary_type} div=${m.division} ` +
      `support=${m.support} nu=${fmtCz(m.current_value)} → 23/8=${fmtCz(m.value_23_8)} (${m.delta >= 0 ? "+" : ""}${fmtCz(m.delta)})`);
  }

  // ── 7. Skriv draft-model-JSON (v1.1) ──
  const draftModel = {
    version: "market_v1_1",
    method: "hedonic-ols-actual-transactions",
    fitted_at: new Date().toISOString(),
    formula: finalCoef.popularity_mode === "raw"
      ? "ln(price) = a + b*O + c*O^2 + d_age*age + e_age2*age^2 + f_potentiale*potentiale + g_popularity*popularity + h_is_youth*is_youth + offset[primary_type]"
      : finalCoef.popularity_mode === "residualized"
        ? "ln(price) = a + b*O + c*O^2 + d_age*age + e_age2*age^2 + f_potentiale*potentiale + g_popularity*popularity_resid + h_is_youth*is_youth + offset[primary_type]  (popularity_resid = popularity - OLS[O,O2,age,age2,potentiale,type])"
        : "ln(price) = a + b*O + c*O^2 + d_age*age + e_age2*age^2 + f_potentiale*potentiale + h_is_youth*is_youth + offset[primary_type]  (popularity DROPPET — konfunderet med potentiale/type, se popularity_analysis)",
    O_definition: "meanAbilityScore(abilities) — kanonisk O fra backend/lib/riderValuation.js (0-99, urundet)",
    reference_type: refType,
    coefficients: finalCoef,
    popularity_analysis: {
      decision: popularityDecision,
      corr_popularity_O: corrPopO, corr_popularity_age: corrPopAge, corr_popularity_potentiale: corrPopPotentiale,
      corr_popularity_ln_price_raw: corrPopLnPrice, corr_popularity_is_youth: corrPopIsYouth,
      pop_by_type_weighted_mean: popByType,
      popularity_side_regression_r2: popSideR2,
      corr_popularity_resid_ln_price: corrResidPopLnPrice,
      variant_holdouts: {
        A_raw_popularity: variantA.holdout, B_no_popularity: variantB.holdout, C_residualized_popularity: variantC.holdout,
      },
      variant_coefficients: { A_popularity_coef: variantA.beta[popIdxA], C_popularity_resid_coef: variantC.beta[popIdxC] },
    },
    guard: {
      description: "w_rider = global_market_weight × support(rider). support(rider) = min(1, count_nearby / K), " +
        "count_nearby = antal handler i træningsdatasættet med SAMME primary_type inden for ±O_window O-point OG ±age_window år af rytterens (O, alder).",
      formula: "w_rider = global_weight * min(1, count_nearby / K)",
      O_window: GUARD_O_WINDOW, age_window: GUARD_AGE_WINDOW, K,
      k_calibration: "K = median(count_nearby) blandt ejede ryttere med >=1 nærliggende handel — riders på/over typisk handels-tæthed får fuld tillid (support=1); tyndere tætheder skalerer lineært ned til 0.",
      zero_support_share: zeroSupportCount / population.length,
      high_value_segment_zero_support_share: highValueRiders.length ? highValueZeroSupport / highValueRiders.length : null,
      note: "Ved support=0 (ingen handelsevidens) FRYSER guard'en rytteren på nuværende current_value (v4-tal) — den hverken bekræfter eller korrigerer v4's kendte oppustning (#2799). Konvergens for dette segment afhænger af FREMTIDIGE handler i ugentlige refits, ikke denne iteration alene.",
    },
    weekly_cap: {
      candidates_simulated: CAP_CANDIDATES,
      recommended: recommendedCap,
      convergence_share_within_5pct_at_season_change: convergence,
      weeks_simulated: WEEKS.map((w) => w.label),
      assumption: "INGEN nye handler i simuleringsperioden (konservativt) — market_value og support antaget konstant pr. uge.",
    },
    n: rows.length,
    n_auction: rows.filter((r) => r.source === "auction").length,
    n_transfer: rows.filter((r) => r.source === "transfer").length,
    n_competitive_bids: rows.filter((r) => r.source === "auction" && r.weight === 2).length,
    weighting: "2x for auctions med >=2 bud (auction_bids), 1x for 1-buds-auktioner og transfer_offers",
    excluded_guaranteed_sale: guaranteedCount,
    abilities_source: { historical_snapshot: usedHistorical, current_fallback: usedCurrentFallback },
    nationality_excluded: { reason: "for tynd tæthed pr. land (uændret vurdering fra v1)" },
    fit_r2_log_weighted: finalR2,
    holdout: {
      holdout_frac: HOLDOUT_FRAC,
      n_holdout: holdoutRows.length,
      n_train: trainRows.length,
      market_v1: v1Holdout,
      market_v1_1: v1_1Holdout,
      v4_live: v4Holdout,
      train_r2_log_weighted: chosenVariant.trainR2,
    },
    notes:
      "v1.1 (#3448 pkt. 2) — popularity: " + popularityDecision + " (se popularity_analysis). Støtte-guard tilføjet " +
      "for uhandlede segmenter (elite/youth) — se guard-blok. Ugentligt ændrings-loft ±" + (recommendedCap * 100) +
      "% anbefalet efter simulering af 3 kandidater over 3 uger (9/8, 16/8, 23/8-sæsonskifte). Fittet READ-ONLY af " +
      "backend/scripts/fitMarketValueModelV1.js mod samme datasæt som v1 (989 completed auctions + accepterede transfer_offers).",
  };
  writeFileSync(OUT_PATH, JSON.stringify(draftModel, null, 2) + "\n");
  console.log(`\nSkrev ${OUT_PATH}`);

  // ── 7b. --refit kvalitets-gate (#3448 pkt. 5) ──
  // Sammenligner den nye fits holdout-MAE(CZ$) mod den NUVÆRENDE promoverede
  // models (backend/lib/marketValueModelV1.json — den fil marketValueSundaySweep.js
  // rent faktisk læser). Forværres MAE med >10% AFVISES overskrivningen —
  // draft-JSON'en (ovenfor) er stadig skrevet til inspektion, men den
  // PROMOVEREDE model rører scriptet ikke. Ingen tidligere promoveret model
  // (første kørsel) ⇒ promovér uden gate.
  if (REFIT_MODE) {
    const newMae = v1_1Holdout.mae_czk;
    let previousMae = null;
    let promotedExists = false;
    try {
      const promoted = JSON.parse(readFileSync(PROMOTED_MODEL_PATH, "utf8"));
      promotedExists = true;
      previousMae = promoted?.holdout?.market_v1_1?.mae_czk ?? promoted?.holdout?.market_v1?.mae_czk ?? null;
    } catch {
      // Ingen promoveret model endnu — intet at sammenligne imod, se nedenfor.
    }

    if (promotedExists && Number.isFinite(previousMae) && Number.isFinite(newMae)) {
      const regression = (newMae - previousMae) / previousMae;
      if (regression > REFIT_MAE_REGRESSION_THRESHOLD) {
        console.error(
          `\n❌ --refit AFVIST: ny holdout-MAE(CZ$)=${newMae.toLocaleString()} er ${(regression * 100).toFixed(1)}% ` +
          `VÆRRE end den promoverede models ${previousMae.toLocaleString()} (tærskel: ${(REFIT_MAE_REGRESSION_THRESHOLD * 100).toFixed(0)}%). ` +
          `${PROMOTED_MODEL_PATH} er IKKE overskrevet — kun draft-JSON'en (${OUT_PATH}) er opdateret.`
        );
        process.exitCode = 1;
      } else {
        writeFileSync(PROMOTED_MODEL_PATH, JSON.stringify(draftModel, null, 2) + "\n");
        console.log(
          `\n✅ --refit GODKENDT: ny holdout-MAE(CZ$)=${newMae.toLocaleString()} ` +
          `(${regression >= 0 ? "+" : ""}${(regression * 100).toFixed(1)}% vs. tidligere ${previousMae.toLocaleString()}) — ` +
          `promoverede ${PROMOTED_MODEL_PATH}.`
        );
      }
    } else {
      writeFileSync(PROMOTED_MODEL_PATH, JSON.stringify(draftModel, null, 2) + "\n");
      console.log(`\n✅ --refit: ingen tidligere promoveret model at sammenligne imod — promoverede ${PROMOTED_MODEL_PATH} uden gate (første kørsel).`);
    }
  }

  // ── 8. Skriv fuld rapport til scratchpad ──
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const reportJson = {
    fitted_at: draftModel.fitted_at,
    popularity_analysis: draftModel.popularity_analysis,
    final_coefficients: finalCoef,
    final_r2_log_weighted: finalR2,
    holdout: draftModel.holdout,
    guard: draftModel.guard,
    guard_ageband_coverage: Object.fromEntries(["<23", "23-25", "26-28", "29-31", "32+"].map((band) => {
      const arr = guardByAgeBand[band] || [];
      return [band, { median_support: median(arr), p10_support: quantile(arr, 0.1), n: arr.length }];
    })),
    weekly_cap_simulation: simSummary,
    convergence_at_23_8: convergence,
    recommended_cap: recommendedCap,
    top10_movers_recommended_cap: top10Movers,
    owned_population_n: population.length,
  };
  writeFileSync(REPORT_JSON_PATH, JSON.stringify(reportJson, null, 2) + "\n");

  const md = [];
  md.push("# Markedsmodel v1.1 — fit- og simuleringsrapport (#3448)");
  md.push("");
  md.push(`Fittet: ${draftModel.fitted_at}`);
  md.push("");
  md.push("## 1. Popularity-konfound");
  md.push("");
  md.push(`Korrelation (vægtet, n=${rows.length}): popularity↔O=${corrPopO?.toFixed(3)}, popularity↔age=${corrPopAge?.toFixed(3)}, ` +
    `popularity↔potentiale=${corrPopPotentiale?.toFixed(3)}, popularity↔ln(price) rå=${corrPopLnPrice?.toFixed(3)}.`);
  md.push(`Side-regression popularity~O+age+potentiale+type: R²=${popSideR2?.toFixed(4)}. Residual-korrelation popularity_resid↔ln(price)=${corrResidPopLnPrice?.toFixed(3)}.`);
  md.push("");
  md.push("| Variant | Popularity | Koef. (popularity/resid) | Train R²(log) | Holdout MAE(CZ$) | Holdout MAPE |");
  md.push("|---|---|---|---|---|---|");
  md.push(`| A | raw | ${variantA.beta[popIdxA].toFixed(4)} | ${variantA.trainR2?.toFixed(4)} | ${fmtCz(variantA.holdout.mae_czk)} | ${fmtPct(variantA.holdout.mape)} |`);
  md.push(`| B | droppet | n/a | ${variantB.trainR2?.toFixed(4)} | ${fmtCz(variantB.holdout.mae_czk)} | ${fmtPct(variantB.holdout.mape)} |`);
  md.push(`| C | residualiseret | ${variantC.beta[popIdxC].toFixed(4)} | ${variantC.trainR2?.toFixed(4)} | ${fmtCz(variantC.holdout.mae_czk)} | ${fmtPct(variantC.holdout.mape)} |`);
  md.push("");
  md.push(`**Beslutning: ${popularityDecision.toUpperCase()}** — valgt variant: ${chosenLabel}.`);
  md.push("");
  md.push("## 2. Holdout-kvalitet v1 vs. v1.1 vs. v4 (samme split, n=" + holdoutRows.length + ")");
  md.push("| Model | MAE(ln) | MAE(CZ$) | MAPE |");
  md.push("|---|---|---|---|");
  md.push(`| v1 | ${v1Holdout.mae_ln.toFixed(4)} | ${fmtCz(v1Holdout.mae_czk)} | ${fmtPct(v1Holdout.mape)} |`);
  md.push(`| v1.1 (${finalCoef.popularity_mode}) | ${v1_1Holdout.mae_ln?.toFixed(4)} | ${fmtCz(v1_1Holdout.mae_czk)} | ${fmtPct(v1_1Holdout.mape)} |`);
  md.push(`| v4 (LIVE) | ${v4Holdout.mae_ln?.toFixed(4)} | ${fmtCz(v4Holdout.mae_czk)} | ${fmtPct(v4Holdout.mape)} |`);
  md.push("");
  md.push("## 3. Støtte-guard");
  md.push("");
  md.push("`w_rider = global_market_weight × support(rider)`, `support(rider) = min(1, count_nearby / K)`, " +
    `count_nearby = handler i træningsdata med samme type inden for ±${GUARD_O_WINDOW} O-point og ±${GUARD_AGE_WINDOW} år. K=${K}.`);
  md.push("");
  md.push(`Andel af ejet population med count_nearby=0 (INGEN evidens): ${fmtPct(zeroSupportCount / population.length)}.`);
  md.push(`#2799-segment (current_value >= 1,7M): ${highValueRiders.length} ryttere, ${fmtPct(highValueRiders.length ? highValueZeroSupport / highValueRiders.length : null)} har support=0.`);
  md.push("");
  md.push("### Guard-dækning (median support) pr. aldersbånd");
  md.push("| Aldersbånd | n | Median support | P10 support |");
  md.push("|---|---|---|---|");
  for (const band of ["<23", "23-25", "26-28", "29-31", "32+"]) {
    const arr = guardByAgeBand[band] || [];
    md.push(`| ${band} | ${arr.length} | ${median(arr)?.toFixed(2)} | ${quantile(arr, 0.1)?.toFixed(2)} |`);
  }
  md.push("");
  md.push("## 4. Konvergens-simulering (ingen nye handler antaget)");
  md.push("");
  for (const cap of CAP_CANDIDATES) {
    md.push(`### Loft ±${(cap * 100).toFixed(0)}%`);
    md.push("");
    for (const w of simSummary[cap]) {
      md.push(`**${w.label}** (global markedsvægt=${w.globalWeight}) — median=${fmtPct(w.median_rel_change)}, P10=${fmtPct(w.p10_rel_change)}, P90=${fmtPct(w.p90_rel_change)}`);
      md.push("");
      md.push("| Aldersbånd | n | Median | P10 | P90 |");
      md.push("|---|---|---|---|---|");
      for (const a of w.age_band_table) {
        md.push(`| ${a.band} | ${a.n} | ${fmtPct(a.median_rel_change)} | ${fmtPct(a.p10_rel_change)} | ${fmtPct(a.p90_rel_change)} |`);
      }
      md.push("");
      md.push("| Division | n | Median | P10 | P90 |");
      md.push("|---|---|---|---|---|");
      for (const d of w.division_table) {
        md.push(`| ${d.division} | ${d.n} | ${fmtPct(d.median_rel_change)} | ${fmtPct(d.p10_rel_change)} | ${fmtPct(d.p90_rel_change)} |`);
      }
      md.push("");
    }
  }
  md.push(`### Konvergens ved 23/8 (andel af population inden for 5% af fuldt guard-vægtet markedsmål)`);
  md.push("| Loft | Konvergens |");
  md.push("|---|---|");
  for (const [c, share] of Object.entries(convergence)) md.push(`| ±${(Number(c) * 100).toFixed(0)}% | ${fmtPct(share)} |`);
  md.push("");
  md.push(`**Anbefalet loft: ±${(recommendedCap * 100).toFixed(0)}%**`);
  md.push("");
  md.push(`### Top-10 største flytninger ved 23/8 under det anbefalede loft`);
  md.push("| Rider ID | Alder | Type | Division | Support | Nuværende | Markedsmål | 23/8-værdi | Delta |");
  md.push("|---|---|---|---|---|---|---|---|---|");
  for (const m of top10Movers) {
    md.push(`| ${m.rider_id} | ${m.age} | ${m.primary_type} | ${m.division} | ${m.support} | ${fmtCz(m.current_value)} | ${fmtCz(m.market_value)} | ${fmtCz(m.value_23_8)} | ${m.delta >= 0 ? "+" : ""}${fmtCz(m.delta)} |`);
  }
  md.push("");

  writeFileSync(REPORT_PATH, md.join("\n"));
  console.log(`\nSkrev fuld rapport: ${REPORT_PATH}`);
  console.log(`Skrev JSON-rapport: ${REPORT_JSON_PATH}`);
  console.log("\n=== Færdig (read-only, ingen prod-mutation) ===");
}

main().catch((e) => {
  console.error("FEJL:", e);
  process.exit(1);
});
