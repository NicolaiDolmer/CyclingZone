#!/usr/bin/env node
// Træn rider-valuation-modellen (#1101) på faktiske kontesterede menneske-salg.
//
// Manuel re-fit (ejer-godkendt) — INGEN auto-læring. Skriver koefficienter +
// metadata til backend/lib/riderValuationModel.json, som committes og bruges af
// riderValuation.js + backfillRiderBaseValue.js.
//
//   node scripts/fitRiderValuationModel.js            # fit + skriv JSON
//   node scripts/fitRiderValuationModel.js --dry-run  # fit + rapportér, skriv intet
//
// Træningssæt (se docs/decisions/rider-valuation-model-v1.md):
//   completed-auktioner, current_price>1, menneske-vinder (ikke AI/test/bank),
//   ≥2 distinkte budgivere (kontesteret). Target = log(current_price).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { ridgeFit, matvec, rSquared } from "../lib/linalg.js";
import {
  FEATURE_KEYS,
  ABILITY_KEYS,
  featurizeRider,
} from "../lib/riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL_PATH = join(__dirname, "../lib/riderValuationModel.json");
const LAMBDA_GRID = [0.1, 0.3, 1, 3, 10];
const CONVEXITY_CAP = 1.5; // "mild" øvre grænse for stejlheds-justering

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a, m) => {
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length || 1);
  return Math.sqrt(v) || 1; // undgå division med 0 for konstante kolonner
};
const pct = (sortedAsc, p) =>
  sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];

// Byg standardiseret design-matrix (med intercept-kolonne 0) fra rå features.
function buildX(rawRows, means, stds) {
  return rawRows.map((f) => {
    const row = [1];
    for (const k of FEATURE_KEYS) {
      const raw = f[k] == null ? means[k] : f[k];
      row.push((raw - means[k]) / stds[k]);
    }
    return row;
  });
}

// k-fold CV for et givet lambda → { mean, se } over folde.
function cvR2(X, y, lambda, k = 5) {
  const n = X.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  // Deterministisk fold-tildeling (ingen shuffle → reproducerbart).
  const scores = [];
  for (let fold = 0; fold < k; fold++) {
    const testSet = new Set(idx.filter((i) => i % k === fold));
    const Xtr = [], ytr = [], Xte = [], yte = [];
    for (let i = 0; i < n; i++) {
      if (testSet.has(i)) { Xte.push(X[i]); yte.push(y[i]); }
      else { Xtr.push(X[i]); ytr.push(y[i]); }
    }
    if (!Xte.length || !Xtr.length) continue;
    const b = ridgeFit(Xtr, ytr, lambda);
    const pred = matvec(Xte, b);
    scores.push(rSquared(yte, pred));
  }
  const m = mean(scores);
  const se = Math.sqrt(scores.reduce((s, v) => s + (v - m) ** 2, 0) / (scores.length || 1)) /
    Math.sqrt(scores.length || 1);
  return { mean: m, se };
}

async function main() {
  const fittedAt = new Date().toISOString().slice(0, 10);
  console.log(`=== Fit rider valuation model ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — asOf ${fittedAt} ===`);

  // --- Hent rådata ---
  const [auctions, teams, bids, riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("auctions").select("id, rider_id, current_price, current_bidder_id, status").order("id")),
    fetchAllRows(() => supabase.from("teams").select("id, is_ai, is_test_account, is_bank").order("id")),
    fetchAllRows(() => supabase.from("auction_bids").select("auction_id, team_id").order("id")),
    fetchAllRows(() => supabase.from("riders").select("id, birthdate, potentiale, popularity, is_u25").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  // Distinkte budgivere pr. auktion.
  const biddersByAuction = new Map();
  for (const b of bids) {
    if (!biddersByAuction.has(b.auction_id)) biddersByAuction.set(b.auction_id, new Set());
    biddersByAuction.get(b.auction_id).add(b.team_id);
  }

  // --- Filtrér træningssæt ---
  const rawRows = [];
  const logPrices = [];
  for (const a of auctions) {
    if (a.status !== "completed" || !(a.current_price > 1)) continue;
    const winner = teamById.get(a.current_bidder_id);
    if (!winner || winner.is_ai || winner.is_test_account || winner.is_bank) continue;
    const nBidders = biddersByAuction.get(a.id)?.size ?? 0;
    if (nBidders < 2) continue; // kun kontesterede
    const rider = riderById.get(a.rider_id);
    const ab = abilityByRider.get(a.rider_id);
    if (!rider || !ab) continue;
    const f = featurizeRider(rider, ab, { asOf: fittedAt });
    if (!ABILITY_KEYS.some((k) => f[k] != null)) continue;
    rawRows.push(f);
    logPrices.push(Math.log(a.current_price));
  }

  const n = rawRows.length;
  console.log(`Træningssæt: ${n} kontesterede menneske-salg`);
  if (n < 30) {
    console.error(`❌ For få datapunkter (${n}) til et meningsfuldt fit. Afbryder.`);
    process.exit(1);
  }

  // --- Means/stds pr. feature (ignorér nulls) ---
  const means = {}, stds = {};
  for (const k of FEATURE_KEYS) {
    const vals = rawRows.map((f) => f[k]).filter((v) => v != null);
    const m = mean(vals);
    means[k] = m;
    stds[k] = std(vals, m);
  }

  const X = buildX(rawRows, means, stds);
  const y = logPrices;

  // --- Vælg lambda via CV + 1-SE-reglen ---
  // Collinearitet blandt evnerne (fx sprint↔acceleration) gør lave λ ustabile:
  // ridge splitter dem i store +/- par der nær ophæver hinanden. CV R² er ~flad
  // hen over grid'et, så vi vælger det STØRSTE λ hvis CV ligger inden for 1 SE af
  // bedste λ — mere robuste, fortolkelige koefficienter, ~gratis nøjagtighed.
  const grid = LAMBDA_GRID.map((lambda) => ({ lambda, ...cvR2(X, y, lambda) }));
  grid.forEach((g) => console.log(`  λ=${g.lambda}\tCV R²=${g.mean.toFixed(3)} (±${g.se.toFixed(3)})`));
  const peak = grid.reduce((a, g) => (g.mean > a.mean ? g : a), grid[0]);
  const threshold = peak.mean - peak.se;
  const within = grid.filter((g) => g.mean >= threshold);
  const chosen = within.reduce((a, g) => (g.lambda > a.lambda ? g : a), within[0]);
  const best = { lambda: chosen.lambda, cv: chosen.mean };
  console.log(`  → peak λ=${peak.lambda} (R²=${peak.mean.toFixed(3)}); 1-SE valg λ=${best.lambda} (R²=${best.cv.toFixed(3)})`);

  // --- Refit på fuldt sæt med bedste lambda ---
  const b = ridgeFit(X, y, best.lambda);
  const trainPred = matvec(X, b);
  const trainR2 = rSquared(y, trainPred);

  // coef-map (b[0] = intercept).
  const coef = {};
  FEATURE_KEYS.forEach((k, i) => { coef[k] = b[i + 1]; });
  const intercept = b[0];
  const logMean = mean(y);

  // --- Konveksitets-justering: genskab realistisk spredning ---
  // Regressionen krymper mod middel → forudsigelser er fladere end markedet.
  // gamma løfter log-spredningen op til den FAKTISKE observerede spredning,
  // capped "mildt" (≤1.5) jf. ejer-valg ("følg data + mild justering").
  const spreadActual = std(y, logMean);
  const spreadPred = std(trainPred, mean(trainPred));
  const convexity = Math.min(CONVEXITY_CAP, Math.max(1, spreadActual / (spreadPred || 1)));

  const model = {
    version: 1,
    fitted_at: fittedAt,
    n_train: n,
    target: "log(current_price)",
    lambda: best.lambda,
    cv_r2: Number(best.cv.toFixed(4)),
    train_r2: Number(trainR2.toFixed(4)),
    log_mean: Number(logMean.toFixed(6)),
    convexity_exponent: Number(convexity.toFixed(4)),
    intercept,
    coef,
    means,
    stds,
    feature_keys: [...FEATURE_KEYS],
    notes: "Ridge på kontesterede menneske-salg. SHADOW — styrer ikke økonomi før cutover (#1101 slice 2).",
  };

  // --- Rapport ---
  console.log(`\nBedste λ=${best.lambda} · CV R²=${best.cv.toFixed(3)} · train R²=${trainR2.toFixed(3)}`);
  console.log(`Konveksitets-eksponent: ${convexity.toFixed(3)} (actual/pred log-spread = ${spreadActual.toFixed(3)}/${spreadPred.toFixed(3)})`);
  console.log("\nKoefficienter (standardiseret — større |værdi| = stærkere prisdriver):");
  Object.entries(coef)
    .sort((a, c) => Math.abs(c[1]) - Math.abs(a[1]))
    .forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v >= 0 ? "+" : ""}${v.toFixed(4)}`));

  const actualSorted = logPrices.map((v) => Math.exp(v)).sort((a, c) => a - c);
  console.log(`\nFaktiske priser (træningssæt): p10 ${Math.round(pct(actualSorted, 0.1))} · median ${Math.round(pct(actualSorted, 0.5))} · p90 ${Math.round(pct(actualSorted, 0.9))}`);

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke model-fil.");
    return;
  }
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2) + "\n");
  console.log(`\n✅ Skrev ${MODEL_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
