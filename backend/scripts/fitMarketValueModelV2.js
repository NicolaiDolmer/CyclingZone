#!/usr/bin/env node
// Markedsmodel v2 - refit med KVALIFICERET evidens (#3750) og evidensvægt pr.
// rytter (#3645 / beslutning 3, docs/audits/2026-08-15-oekonomi-beslutninger-1-3.md).
//
// READ-ONLY mod databasen: kun SELECT. Ingen writes, ingen migrationer, ingen
// mutation af riders. Scriptet skriver KUN lokale filer (model-artefakt +
// rapporter), og kun når du beder om det (--write-artifact / --report-dir).
//
// ─────────────────────────────────────────────────────────────────────────────
// HVORFOR v2 (og hvorfor v1.1's tal ikke kan genbruges)
//
// v1/v1.1 (backend/scripts/fitMarketValueModelV1.js på PR #3449's branch) trænede
// på "completed auctions m. bud + accepterede transfer_offers", vægtet 2:1 for
// auktioner med >=2 BUD. #3750 viste hvad de 1-buds-auktioner ER: bankens egne
// auktioner starter på YOUTH_AUCTION_START_RATE (0,25) x rytterens værdi
// (backend/lib/youthMarket.js), og en auktion med én budgiver clearer PRÆCIS på
// startprisen. Prisen er altså modellens eget output ganget med en konstant vi
// selv har sat - og den indgik i fittet som om den var en observation af
// betalingsvilje. Målt her: 869 af 1.208 afsluttede auktioner med køber (71,9 %)
// lukkede på nøjagtig startprisen.
//
// v2 retter to ting:
//
//   1. FILTER (#3750). Kun KVALIFICERET evidens træner modellen. Definitionen er
//      ejer-vedtaget 15/8 (beslutning 3) og implementeret i buildQualifiedSales():
//        a) auktioner med mindst TO FORSKELLIGE budgivere OG en slutpris der steg
//           over startprisen, ELLER
//        b) forhandlede handler (accepterede transfer_offers) mellem to menneske-
//           hold,
//        c) UNDTAGEN handler over 3x rytterens ankerværdi (kollusions-/outlier-
//           værn, designkritikkens §5.3a),
//        d) UNDTAGEN handler i par der har handlet 3 eller flere gange i vinduet
//           (samme værn - alle observerede >3x-afvigere lå i netop de par).
//      Bemærk (a): kravet er FORSKELLIGE budgivere, ikke antal bud. To bud fra
//      samme hold er ikke konkurrence. v1 talte rå bud.
//
//   2. EVIDENSVÆGT PR. RYTTER (beslutning 3). v1.1 blandede med
//      w = global_weight x min(1, n/K) - en hård mætning ved K. v2 bruger
//      Z = n / (n + K) med K = 12: værdien følger markedet i præcis den grad der
//      findes sammenlignelige handler for netop den rytter. Ingen skal beslutte
//      hvornår der skrues op; det sker af sig selv, rytter for rytter. n tælles i
//      samme nabolag som v1's guard (samme type, ±5 O-point, ±3 år), men KUN over
//      kvalificerede handler.
//      Artefaktet bærer guard.support_mode = "evidence_ratio_n_over_n_plus_k".
//      ⚠️ En runtime der implementerer min(1, n/K) må IKKE læse dette artefakt.
//
// Derudover rettet i v2 (begge var flaget som blokerende i
// docs/audits/2026-08-14-oplaas-vaerdier-og-loefter.md, "Før sweepet kan køre"):
//
//   - ALDERS-DEFINITIONEN. v1 fittede på kontinuert kalenderalder på salgs-
//     tidspunktet, mens runtime evaluerer på heltals-sæsonalder (ageForSeason).
//     v2 fitter på sæsonalder: hvert salg mappes til det sæsonnummer der var
//     aktivt da handlen skete (seasons.start_date/end_date), og alderen regnes med
//     den kanoniske ageForSeason. Fit og runtime deler nu alders-skala.
//   - TYPE-KOLONNEN. v1 fittede og prissatte på live primary_type. Resten af
//     værdikæden (riderValuation.js) læser `valuation_type ?? primary_type`.
//     v2 tager kolonnen som parameter (--type-column) og MÅLER begge, så
//     ejer-beslutningen kan træffes på tal frem for på en default.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCORECARD (samme metode som auditten 14/8)
//
// Tidsbaseret holdout (seneste 20 % af de kvalificerede handler). Rapporterer
// MAE(CZ$) OG MEDIAN absolut fejl side om side - auditten viste at få store
// handler ellers bestemmer rangordenen - plus MAPE. Sammenlignet mod:
//
//   - v4 (LIVE) - den model der kører i dag, backend/lib/riderValuationModelV4.json
//     via predictBaseValueV4. Dette er GATEN: v2 skal måle mindst lige så godt.
//   - ANKER - den trivielle "brug den værdi rytteren i forvejen var listet til".
//     Auditten viste at den slog begge rigtige modeller, fordi 65 % af handlerne
//     lukkede på ankeret. Efter #3750-filteret er de handler væk, så ankeret er
//     ikke længere en selvopfyldende profeti - men den skal stadig med, ellers
//     ved vi ikke om vi måler noget.
//   - (valgfrit) en tidligere markedsmodel via --legacy-model=<sti>.
//
// ─────────────────────────────────────────────────────────────────────────────
// BRUG (kør fra backend/ - dotenv/config forventer backend/.env i cwd)
//
//   node scripts/fitMarketValueModelV2.js
//   node scripts/fitMarketValueModelV2.js --type-column=primary_type
//   node scripts/fitMarketValueModelV2.js --write-artifact
//   node scripts/fitMarketValueModelV2.js --report-dir=../docs/snapshots/3750
//   node scripts/fitMarketValueModelV2.js --legacy-model=./marketValueModelV1.draft.json
//
// Uden --write-artifact rører scriptet INGEN filer i backend/lib/. Der er
// bevidst ingen automatisk promotion-gate her: v2 skifter både datagrundlag og
// blandingsformel, så et "er MAE blevet 10 % værre"-tjek mod v1.1 ville
// sammenligne to forskellige ting.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { ABILITY_KEYS, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V4_MODEL_PATH = join(__dirname, "..", "lib", "riderValuationModelV4.json");
const ARTIFACT_PATH = join(__dirname, "..", "lib", "marketValueModelV2.json");

// ── Parametre (alle ejer-besluttede, se hovedkommentaren for kilde) ──────────
export const EVIDENCE_K = 12;          // beslutning 3: Z = n/(n+K), K beholdes på 12
export const GUARD_O_WINDOW = 5;       // "sammenlignelig rytter": ±5 O-point
export const GUARD_AGE_WINDOW = 3;     // ... og ±3 år, samme type
export const MAX_PRICE_MULTIPLE = 3;   // designkritik §5.3a: drop handler over 3x ankerværdi
export const MAX_PAIR_TRADES = 3;      // drop handler i par med 3+ handler i vinduet
const HOLDOUT_FRAC = 0.2;

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const TYPE_COLUMN = argValue("type-column", "valuation_type");
const WRITE_ARTIFACT = process.argv.includes("--write-artifact");
const REPORT_DIR = argValue("report-dir", null);
const LEGACY_MODEL_PATH = argValue("legacy-model", null);

if (!["valuation_type", "primary_type"].includes(TYPE_COLUMN)) {
  console.error(`Ukendt --type-column=${TYPE_COLUMN} (valuation_type | primary_type)`);
  process.exit(1);
}

// ───────────────────────────── Rene hjælpefunktioner ─────────────────────────

export function meanAbilityScore(abilities) {
  let sum = 0, n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : null;
}

/** Evidensvægt pr. rytter (beslutning 3). Z = n/(n+K) - ingen hård mætning. */
export function evidenceWeight(countNearby, K = EVIDENCE_K) {
  const n = Number(countNearby);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / (n + K);
}

export function median(arr) {
  const a = [...arr].filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function quantile(arr, q) {
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

function pairKey(a, b) {
  if (!a || !b) return null;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Gauss-Jordan m. partial pivoting. Løser A·x = b.
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-9) {
      throw new Error(`Singulær design-matrix ved kolonne ${col} (for få observationer for en feature).`);
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

function featureValue(key, r) {
  switch (key) {
    case "intercept": return 1;
    case "O": return r.O;
    case "O2": return r.O * r.O;
    case "age": return r.age;
    case "age2": return r.age * r.age;
    case "potentiale": return r.potentiale;
    case "popularity": return r.popularity;
    case "is_youth": return r.is_youth;
    case "is_auction": return r.source === "auction" ? 1 : 0;
    default: throw new Error(`Ukendt feature-nøgle: ${key}`);
  }
}

function buildDesignRow(r, featureKeys, dummyTypes) {
  const x = featureKeys.map((k) => featureValue(k, r));
  for (const t of dummyTypes) x.push(r.type === t ? 1 : 0);
  return x;
}

function fitOLS(rows, featureKeys, dummyTypes, { yFn = (r) => r.ln_price } = {}) {
  const p = featureKeys.length + dummyTypes.length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (const r of rows) {
    const x = buildDesignRow(r, featureKeys, dummyTypes);
    const y = yFn(r);
    for (let i = 0; i < p; i++) {
      Xty[i] += x[i] * y;
      for (let j = 0; j < p; j++) XtX[i][j] += x[i] * x[j];
    }
  }
  // Ridge-stabilisering: n er lille efter #3750-filteret, og type-dummies kan
  // være næsten-kolineære med O/alder i tynde celler. Et mikroskopisk ridge-led
  // (1e-6 på den ikke-konstante diagonal) ændrer ikke koefficienterne målbart,
  // men forhindrer at et enkelt tyndt type-niveau vælter hele fittet.
  for (let i = 1; i < p; i++) XtX[i][i] += 1e-6;
  return solveLinearSystem(XtX, Xty);
}

function predictLinear(beta, r, featureKeys, dummyTypes) {
  const x = buildDesignRow(r, featureKeys, dummyTypes);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += beta[i] * x[i];
  return s;
}

function r2(rows, beta, featureKeys, dummyTypes) {
  let yMean = 0;
  for (const r of rows) yMean += r.ln_price;
  yMean /= rows.length;
  let ssRes = 0, ssTot = 0;
  for (const r of rows) {
    const pred = predictLinear(beta, r, featureKeys, dummyTypes);
    ssRes += (r.ln_price - pred) ** 2;
    ssTot += (r.ln_price - yMean) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : null;
}

/**
 * Holdout-metrikker. MAE OG median-absolut-fejl rapporteres side om side -
 * auditten 14/8 viste at MAE alene lader få store handler bestemme rangordenen
 * (median-AE 4.801-7.355 mod MAE 33.000-45.000 på samme sæt).
 */
export function evalHoldout(rows, predictCzFn) {
  const absErrors = [];
  const apes = [];
  const lnErrors = [];
  let n = 0, skipped = 0;
  for (const r of rows) {
    const predCz = predictCzFn(r);
    if (!Number.isFinite(predCz) || predCz <= 0) { skipped += 1; continue; }
    absErrors.push(Math.abs(predCz - r.price));
    apes.push(Math.abs(predCz - r.price) / r.price);
    lnErrors.push(Math.abs(Math.log(predCz) - Math.log(r.price)));
    n += 1;
  }
  return {
    n,
    skipped,
    mae_czk: n ? Math.round(absErrors.reduce((a, b) => a + b, 0) / n) : null,
    median_ae_czk: n ? Math.round(median(absErrors)) : null,
    // Gennemsnits-MAPE er ubrugelig på dette datasæt: enkelte handler ligger på
    // få hundrede CZ$, så en absolut fejl på nogle tusinde giver flere tusinde
    // procent. MEDIAN-APE er den aflæselige. Begge rapporteres, så ingen kan
    // tage den forkerte i god tro.
    mape: n ? apes.reduce((a, b) => a + b, 0) / n : null,
    median_ape: n ? median(apes) : null,
    // Skalafri fejl på log-skalaen - den skala modellen faktisk er fittet på.
    mae_ln: n ? lnErrors.reduce((a, b) => a + b, 0) / n : null,
  };
}

/**
 * Duan's smearing-estimator. En ln-lineær model prædikterer E[ln y]; exp() af
 * den giver MEDIANEN, ikke middelværdien, og undervurderer derfor systematisk
 * prisen i CZ$ (jo mere spredning, jo mere). Faktoren er middelværdien af
 * exp(residualerne) på TRÆNINGSSÆTTET og anvendes multiplikativt.
 *
 * v1/v1.1 havde ikke denne korrektion. Det er en del af forklaringen på at den
 * markedsdrevne model konsekvent prissatte lavere end v4.
 */
export function smearingFactor(trainRows, predictLnFn) {
  let sum = 0, n = 0;
  for (const r of trainRows) {
    const predLn = predictLnFn(r);
    if (!Number.isFinite(predLn)) continue;
    sum += Math.exp(r.ln_price - predLn);
    n += 1;
  }
  return n ? sum / n : 1;
}

function activeDummyTypes(rows, refType) {
  const present = new Set(rows.map((r) => r.type));
  return RIDER_TYPE_KEYS.filter((t) => t !== refType && present.has(t));
}

function assembleOffsets(beta, refType, dummyTypes, featureCount) {
  const raw = { [refType]: 0 };
  dummyTypes.forEach((t, i) => { raw[t] = beta[featureCount + i]; });
  const known = RIDER_TYPE_KEYS.filter((t) => Number.isFinite(raw[t])).map((t) => raw[t]);
  const floor = known.length ? Math.min(...known) : 0;
  const offsets = {};
  for (const t of RIDER_TYPE_KEYS) {
    offsets[t] = Number.isFinite(raw[t]) ? raw[t] - floor : null;
  }
  return { offsets, floorShift: floor, unsampledTypes: RIDER_TYPE_KEYS.filter((t) => offsets[t] === null) };
}

export function offsetFor(type, offsetDict) {
  const v = offsetDict?.[type];
  if (Number.isFinite(v)) return v;
  const known = Object.values(offsetDict || {}).filter((x) => Number.isFinite(x));
  return known.length ? Math.min(...known) : 0;
}

/** Fuld ln(pris)-prædiktion fra det færdige v2-koefficientsæt. */
export function predictMarketLn(coef, { O, age, potentiale, popularity, is_youth, type }) {
  let s = coef.a
    + coef.b * O
    + coef.c * O * O
    + coef.d_age * age
    + coef.e_age2 * age * age
    + coef.f_potentiale * potentiale
    + coef.h_is_youth * (is_youth ? 1 : 0)
    + offsetFor(type, coef.offset);
  if (coef.popularity_mode === "raw") s += coef.g_popularity * (popularity || 0);
  // Duan-smearing indgår som et additivt ln-led, så prædiktionen er i CZ$-middel
  // og ikke i median. Ældre artefakter uden feltet får faktoren 1 (uændret).
  if (Number.isFinite(coef.smearing) && coef.smearing > 0) s += Math.log(coef.smearing);
  return s;
}

const fmtCz = (n) => (n == null ? "n/a" : Math.round(n).toLocaleString("da-DK"));
const fmtPct = (n) => (n == null ? "n/a" : (n * 100).toFixed(1) + "%");

// ─────────────────────── Kvalificeret evidens (#3750) ────────────────────────

/**
 * Ren funktion - filtrerer rå handler ned til KVALIFICERET evidens og returnerer
 * både resultatet og et fuldt funnel-regnskab. Testbar uden database.
 *
 * @param {Array} rawSales  {sale_id, source:'auction'|'transfer', rider_id, price,
 *   sale_ts, is_guaranteed_sale, is_youth, starting_price, distinct_bidders,
 *   seller_team_id, buyer_team_id, seller_is_human, buyer_is_human, anchor_value}
 */
export function buildQualifiedSales(rawSales, {
  maxPriceMultiple = MAX_PRICE_MULTIPLE,
  maxPairTrades = MAX_PAIR_TRADES,
} = {}) {
  const funnel = {
    raw: rawSales.length,
    dropped_guaranteed_sale: 0,
    dropped_auction_no_competition: 0,
    dropped_auction_price_not_raised: 0,
    dropped_transfer_not_human_to_human: 0,
    dropped_over_price_multiple: 0,
    dropped_repeat_pair: 0,
  };

  const stage1 = [];
  for (const s of rawSales) {
    if (s.is_guaranteed_sale) { funnel.dropped_guaranteed_sale += 1; continue; }
    if (s.source === "auction") {
      // #3750: en auktion med under to FORSKELLIGE budgivere har ingen
      // konkurrence bag prisen, og en auktion der clearer på startprisen er
      // bankens konstant (0,25 x værdi) læst tilbage som en pris.
      if (!(Number(s.distinct_bidders) >= 2)) { funnel.dropped_auction_no_competition += 1; continue; }
      if (!(Number(s.price) > Number(s.starting_price))) { funnel.dropped_auction_price_not_raised += 1; continue; }
    } else {
      // Beslutning 3 (b): forhandlede handler tæller, men kun mellem to
      // menneskehold - en handel med et AI-/bank-/testhold i den ene ende er
      // ikke betalingsvilje mellem to managere.
      if (!s.seller_is_human || !s.buyer_is_human) { funnel.dropped_transfer_not_human_to_human += 1; continue; }
    }
    stage1.push(s);
  }

  // (c) outlier-/kollusionsværn: handler over 3x rytterens ankerværdi.
  const stage2 = [];
  for (const s of stage1) {
    const anchor = Number(s.anchor_value);
    if (Number.isFinite(anchor) && anchor > 0 && Number(s.price) > maxPriceMultiple * anchor) {
      funnel.dropped_over_price_multiple += 1;
      continue;
    }
    stage2.push(s);
  }

  // (d) kollusionsværn: par der har handlet maxPairTrades gange eller mere.
  // Gælder kun handler hvor BEGGE sider er kendte menneskehold - bankens
  // auktioner har ingen modpart at danne par med.
  const pairCounts = new Map();
  for (const s of stage2) {
    const key = (s.seller_is_human && s.buyer_is_human) ? pairKey(s.seller_team_id, s.buyer_team_id) : null;
    if (!key) continue;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  const bannedPairs = new Set([...pairCounts.entries()].filter(([, c]) => c >= maxPairTrades).map(([k]) => k));
  const qualified = [];
  for (const s of stage2) {
    const key = (s.seller_is_human && s.buyer_is_human) ? pairKey(s.seller_team_id, s.buyer_team_id) : null;
    if (key && bannedPairs.has(key)) { funnel.dropped_repeat_pair += 1; continue; }
    qualified.push(s);
  }

  funnel.qualified = qualified.length;
  funnel.banned_pairs = [...bannedPairs];
  return { qualified, funnel };
}

/** Sæsonnummer for et tidspunkt, ud fra seasons.start_date (sorteret). */
export function seasonNumberAt(saleTs, seasons) {
  const day = String(saleTs).slice(0, 10);
  let best = null;
  for (const s of seasons) {
    if (!s.start_date) continue;
    if (s.start_date <= day) best = s;
    else break;
  }
  return best ? best.number : null;
}

// ─────────────────────────────────────── main ────────────────────────────────

async function main() {
  console.log("=== Markedsmodel v2 - refit på kvalificeret evidens (#3750 / #3449 / #3645) ===");
  console.log(`READ-ONLY. Type-kolonne: ${TYPE_COLUMN}. Evidensvægt: Z = n/(n+${EVIDENCE_K}).\n`);

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // ── 1. Hold (til menneske/AI-diskriminatoren) + sæsoner ────────────────────
  const allTeams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_ai, is_test_account, is_frozen, is_bank").order("id"));
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const isHumanTeam = (id) => {
    const t = teamById.get(id);
    return !!t && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen;
  };
  const realTeamIds = new Set(
    allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id)
  );
  const divisionByTeam = new Map(allTeams.map((t) => [t.id, t.division]));

  const seasons = (await fetchAllRows(() => supabase
    .from("seasons").select("number, status, start_date, end_date").order("number")))
    .filter((s) => Number.isFinite(Number(s.number)))
    .map((s) => ({ ...s, number: Number(s.number) }));
  const activeSeason = seasons.find((s) => s.status === "active");
  if (!activeSeason) throw new Error("Ingen aktiv sæson - kan ikke regne sæsonalder.");
  console.log(`Aktiv sæson: ${activeSeason.number} (start ${activeSeason.start_date}).`);

  // ── 2. Rå handler ──────────────────────────────────────────────────────────
  const auctionRows = await fetchAllRows(() => supabase
    .from("auctions")
    .select("id, rider_id, current_price, starting_price, actual_end, is_guaranteed_sale, is_youth, seller_team_id, current_bidder_id")
    .eq("status", "completed")
    .not("current_bidder_id", "is", null)
    .gt("current_price", 0)
    .order("id"));

  const transferRows = await fetchAllRows(() => supabase
    .from("transfer_offers")
    .select("id, rider_id, offer_amount, counter_amount, updated_at, seller_team_id, buyer_team_id")
    .eq("status", "accepted")
    .not("rider_id", "is", null)
    .order("id"));

  // Distinkte budgivere pr. auktion (IKKE antal bud - to bud fra samme hold er
  // ikke konkurrence; v1 talte rå bud og fik derfor 331 hvor der er 327).
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

  // Ankerværdi til 3x-værnet. Rytterens NUVÆRENDE market_value er en
  // tilnærmelse: der findes ingen historik over listet værdi pr. salgsdag
  // (samme begrænsning auditten 14/8 noterede). Værnet rammer kun ekstremer,
  // så tilnærmelsen er acceptabel - men den er en tilnærmelse.
  const saleRiderIds = [...new Set([
    ...auctionRows.map((a) => a.rider_id),
    ...transferRows.map((t) => t.rider_id),
  ].filter(Boolean))];

  const saleRiderRows = await fetchAllRowsChunkedIn(saleRiderIds, (chunk) => supabase
    .from("riders")
    .select("id, birthdate, popularity, potentiale, primary_type, valuation_type, market_value")
    .in("id", chunk).order("id"));
  const saleRiderById = new Map(saleRiderRows.map((r) => [r.id, r]));

  const rawSales = [];
  for (const a of auctionRows) {
    rawSales.push({
      sale_id: a.id, source: "auction", rider_id: a.rider_id,
      price: Number(a.current_price), starting_price: Number(a.starting_price),
      sale_ts: a.actual_end, is_guaranteed_sale: !!a.is_guaranteed_sale, is_youth: !!a.is_youth,
      distinct_bidders: (biddersByAuction.get(a.id) || new Set()).size,
      seller_team_id: a.seller_team_id, buyer_team_id: a.current_bidder_id,
      seller_is_human: isHumanTeam(a.seller_team_id), buyer_is_human: isHumanTeam(a.current_bidder_id),
      anchor_value: Number(saleRiderById.get(a.rider_id)?.market_value) || null,
    });
  }
  let transferSkippedBadPrice = 0;
  for (const t of transferRows) {
    const price = Number(t.counter_amount ?? t.offer_amount);
    if (!Number.isFinite(price) || price <= 0) { transferSkippedBadPrice += 1; continue; }
    rawSales.push({
      sale_id: t.id, source: "transfer", rider_id: t.rider_id,
      price, starting_price: null, sale_ts: t.updated_at,
      is_guaranteed_sale: false, is_youth: false, distinct_bidders: null,
      seller_team_id: t.seller_team_id, buyer_team_id: t.buyer_team_id,
      seller_is_human: isHumanTeam(t.seller_team_id), buyer_is_human: isHumanTeam(t.buyer_team_id),
      anchor_value: Number(saleRiderById.get(t.rider_id)?.market_value) || null,
    });
  }

  const { qualified, funnel } = buildQualifiedSales(rawSales);
  console.log("\n── #3750-filter: fra rå handler til kvalificeret evidens ──");
  console.log(`  Rå handler (completed auctions m. køber + accepterede transfer_offers): ${funnel.raw}` +
    (transferSkippedBadPrice ? ` (+${transferSkippedBadPrice} droppet: ugyldig pris)` : ""));
  console.log(`  − garanterede salg (ikke markedspris)                : ${funnel.dropped_guaranteed_sale}`);
  console.log(`  − auktioner med under 2 FORSKELLIGE budgivere        : ${funnel.dropped_auction_no_competition}`);
  console.log(`  − auktioner hvor prisen ikke steg over startprisen   : ${funnel.dropped_auction_price_not_raised}`);
  console.log(`  − transfers der ikke er menneske-til-menneske        : ${funnel.dropped_transfer_not_human_to_human}`);
  console.log(`  − handler over ${MAX_PRICE_MULTIPLE}x ankerværdi                          : ${funnel.dropped_over_price_multiple}`);
  console.log(`  − handler i par med ${MAX_PAIR_TRADES}+ handler (${funnel.banned_pairs.length} par)          : ${funnel.dropped_repeat_pair}`);
  console.log(`  = KVALIFICERET EVIDENS                              : ${funnel.qualified}`);

  // ── 3. Evner (historisk snapshot på salgsdagen, ellers nuværende) ──────────
  const abilityRows = await fetchAllRowsChunkedIn(saleRiderIds, (chunk) => supabase
    .from("rider_derived_abilities").select("*").in("rider_id", chunk).order("rider_id"));
  const currentAbilitiesById = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const historyRows = await fetchAllRowsChunkedIn(saleRiderIds, (chunk) => supabase
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

  function abilitiesAt(riderId, saleTs) {
    const arr = historyById.get(riderId);
    const saleDay = String(saleTs).slice(0, 10);
    let best = null;
    if (arr) {
      for (const h of arr) {
        if (h.snapshot_date <= saleDay) best = h;
        else break;
      }
    }
    return best ? { abilities: best.abilities, source: "historical" }
      : { abilities: currentAbilitiesById.get(riderId) || null, source: "current_fallback" };
  }

  const typeOf = (rider) => (TYPE_COLUMN === "valuation_type"
    ? (rider?.valuation_type ?? rider?.primary_type ?? null)
    : (rider?.primary_type ?? null));

  // v4 (den KØRENDE model) prissætter ALTID på `valuation_type ?? primary_type`
  // (backend/lib/riderValuation.js linje 117). Referencen i scorecardet skal
  // derfor bruge den kolonne uanset hvad --type-column er sat til - ellers
  // sammenligner vi med en v4 der ikke kører nogen steder, og gaten bliver grøn
  // af den forkerte grund.
  const v4TypeOf = (rider) => (rider?.valuation_type ?? rider?.primary_type ?? null);

  // ── 4. Feature-rækker (sæsonalder - samme skala som runtime) ───────────────
  const rows = [];
  let usedHistorical = 0, usedCurrentFallback = 0;
  let droppedMissingRider = 0, droppedMissingAbilities = 0, droppedUntyped = 0, droppedNoSeason = 0;
  for (const s of qualified) {
    const rider = saleRiderById.get(s.rider_id);
    if (!rider || !rider.birthdate) { droppedMissingRider += 1; continue; }
    const seasonNo = seasonNumberAt(s.sale_ts, seasons);
    if (seasonNo == null) { droppedNoSeason += 1; continue; }
    const age = ageForSeason(rider.birthdate, seasonNo);
    if (age == null || age < 14 || age > 45) { droppedMissingRider += 1; continue; }

    const { abilities, source } = abilitiesAt(s.rider_id, s.sale_ts);
    if (!abilities) { droppedMissingAbilities += 1; continue; }
    const O = meanAbilityScore(abilities);
    if (O == null) { droppedMissingAbilities += 1; continue; }

    const type = typeOf(rider);
    if (!type || !RIDER_TYPE_KEYS.includes(type)) { droppedUntyped += 1; continue; }

    if (source === "historical") usedHistorical += 1; else usedCurrentFallback += 1;

    rows.push({
      sale_id: s.sale_id, source: s.source, rider_id: s.rider_id,
      price: s.price, ln_price: Math.log(s.price), sale_ts: s.sale_ts,
      season_number: seasonNo, anchor_value: s.anchor_value,
      O, age, potentiale: Number(rider.potentiale) || 0, popularity: Number(rider.popularity) || 0,
      is_youth: s.is_youth ? 1 : 0, type, v4_type: v4TypeOf(rider),
      abilities, abilities_source: source,
    });
  }

  console.log(`\nFeature-rækker: ${rows.length} (droppet: ${droppedMissingRider} mgl. rytter/alder, ` +
    `${droppedMissingAbilities} mgl. evner, ${droppedUntyped} utypede, ${droppedNoSeason} uden sæson).`);
  console.log(`  Evner fra historisk snapshot: ${usedHistorical} · nuværende fallback: ${usedCurrentFallback}`);
  if (rows.length < 60) {
    console.log("  ⚠️  n er meget lille. Det er svaret, ikke et problem der skal skjules (#3750).");
  }

  const bySource = { auction: rows.filter((r) => r.source === "auction").length, transfer: rows.filter((r) => r.source === "transfer").length };
  console.log(`  Kilder: ${bySource.auction} konkurrenceprissatte auktioner · ${bySource.transfer} forhandlede handler.`);

  const typeCounts = {};
  for (const r of rows) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  console.log("  Typefordeling i evidensen: " +
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}=${c}`).join(", "));

  // ── 5. Tidsbaseret train/holdout ──────────────────────────────────────────
  const sorted = [...rows].sort((a, b) => String(a.sale_ts).localeCompare(String(b.sale_ts)));
  const holdoutN = Math.max(1, Math.round(sorted.length * HOLDOUT_FRAC));
  const trainRows = sorted.slice(0, sorted.length - holdoutN);
  const holdoutRows = sorted.slice(sorted.length - holdoutN);
  console.log(`\nTrain/holdout (tidsbaseret, seneste ${(HOLDOUT_FRAC * 100).toFixed(0)}%): train n=${trainRows.length}, ` +
    `holdout n=${holdoutRows.length} (${String(holdoutRows[0]?.sale_ts).slice(0, 10)} → ${String(holdoutRows[holdoutRows.length - 1]?.sale_ts).slice(0, 10)}).`);

  const refType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
  const trainDummyTypes = activeDummyTypes(trainRows, refType);

  const FEATURES_BASE = ["intercept", "O", "O2", "age", "age2", "potentiale", "is_youth"];
  const FEATURES_POP = ["intercept", "O", "O2", "age", "age2", "potentiale", "popularity", "is_youth"];

  function fitAndEval(featureKeys, label) {
    const beta = fitOLS(trainRows, featureKeys, trainDummyTypes);
    const trainR2 = r2(trainRows, beta, featureKeys, trainDummyTypes);
    const predLn = (r) => predictLinear(beta, r, featureKeys, trainDummyTypes);
    const smear = smearingFactor(trainRows, predLn);
    const holdout = evalHoldout(holdoutRows, (r) => Math.exp(predLn(r)) * smear);
    const holdoutNoSmear = evalHoldout(holdoutRows, (r) => Math.exp(predLn(r)));
    console.log(`\nVariant ${label}: train R²(log)=${trainR2?.toFixed(4)}  smearing=${smear.toFixed(3)}  ` +
      `holdout MAE=${fmtCz(holdout.mae_czk)}  median-AE=${fmtCz(holdout.median_ae_czk)}  ` +
      `median-APE=${fmtPct(holdout.median_ape)}  MAE(ln)=${holdout.mae_ln?.toFixed(3)}`);
    console.log(`  (uden smearing: MAE=${fmtCz(holdoutNoSmear.mae_czk)}  median-AE=${fmtCz(holdoutNoSmear.median_ae_czk)})`);
    return { beta, trainR2, holdout, holdoutNoSmear, smear, featureKeys };
  }

  const variantBase = fitAndEval(FEATURES_BASE, "BASE (uden popularity)");
  const variantPop = fitAndEval(FEATURES_POP, "POP  (rå popularity)");

  // Udvælgelse af spec - TO krav, ikke ét.
  //
  // v1.1's regel så kun på holdout-MAE, og valgte derfor en model hvor
  // popularity-koefficienten var NEGATIV: "mere populær ⇒ lavere pris". Den
  // model måler bedre og betyder ingenting; koefficienten opsamler residual
  // type-/alders-struktur, ikke en popularitets-præmie (se auditten 14/8, pkt. 5
  // "de to præmis-fejl PR'en selv flager"). Et led med omvendt fortegn må ikke
  // være med til at prissætte spilleres ejendom, uanset hvad MAE siger.
  //
  // Derfor: popularity beholdes KUN hvis koefficienten har det fortegn den
  // påstår at have (positiv) OG varianten forbedrer holdout-MAE med over 2 %.
  const popCoefTrain = variantPop.beta[FEATURES_POP.indexOf("popularity")];
  const popSignOk = popCoefTrain > 0;
  const popMaeOk = Number.isFinite(variantPop.holdout.mae_czk)
    && Number.isFinite(variantBase.holdout.mae_czk)
    && variantPop.holdout.mae_czk < variantBase.holdout.mae_czk * 0.98;
  const keepPopularity = popSignOk && popMaeOk;
  const chosen = keepPopularity ? variantPop : variantBase;
  const chosenFeatures = chosen.featureKeys;
  console.log(`\nPopularity-koefficient (train): ${popCoefTrain.toFixed(5)} - fortegn ${popSignOk ? "OK" : "OMVENDT"}; ` +
    `MAE-forbedring ${popMaeOk ? "over" : "under"} 2 %.`);
  console.log(`→ Valgt spec: ${keepPopularity ? "POP (rå popularity beholdt)" : "BASE (popularity droppet)"}.`);
  if (!popSignOk && popMaeOk) {
    console.log("  ⚠️  POP målte bedre, men blev fravalgt fordi koefficienten er negativ. " +
      "Det er den konfound auditten 14/8 flagede som uløst - den er stadig uløst.");
  }

  // Diagnostik (IKKE en del af den valgte model): hvad siger en kanal-dummy?
  // Auktioner er ankret på bankens startpris, forhandlede handler er ikke. Hvis
  // is_auction-koefficienten er markant negativ, betyder det at auktionskanalen
  // clearer systematisk lavere for samme rytter - et niveau-valg ejeren skal
  // træffe, ikke noget scriptet må træffe stiltiende.
  let channelDiagnostic = null;
  if (bySource.auction >= 20 && bySource.transfer >= 20) {
    const featuresChannel = [...chosenFeatures, "is_auction"];
    const betaChannel = fitOLS(trainRows, featuresChannel, trainDummyTypes);
    const idx = featuresChannel.indexOf("is_auction");
    const holdoutChannel = evalHoldout(holdoutRows, (r) => Math.exp(predictLinear(betaChannel, r, featuresChannel, trainDummyTypes)));
    channelDiagnostic = {
      is_auction_coefficient: betaChannel[idx],
      implied_auction_discount: Math.exp(betaChannel[idx]) - 1,
      holdout: holdoutChannel,
    };
    console.log(`\nDIAGNOSTIK kanal-dummy: is_auction=${betaChannel[idx].toFixed(4)} ` +
      `(auktionskanalen clearer ${fmtPct(channelDiagnostic.implied_auction_discount)} vs. forhandlet, alt andet lige). ` +
      `Holdout MAE=${fmtCz(holdoutChannel.mae_czk)}.`);
  }

  // ── 6. Endeligt fit på HELE den kvalificerede evidens ─────────────────────
  const fullDummyTypes = activeDummyTypes(rows, refType);
  const finalBeta = fitOLS(rows, chosenFeatures, fullDummyTypes);
  const finalR2 = r2(rows, finalBeta, chosenFeatures, fullDummyTypes);
  const { offsets, floorShift, unsampledTypes } = assembleOffsets(finalBeta, refType, fullDummyTypes, chosenFeatures.length);
  if (unsampledTypes.length) {
    console.log(`⚠️  Typer UDEN kvalificeret evidens (offset ekstrapoleret til gulvet): ${unsampledTypes.join(", ")}`);
  }

  const finalSmear = smearingFactor(rows, (r) => predictLinear(finalBeta, r, chosenFeatures, fullDummyTypes));

  const idx = (k) => chosenFeatures.indexOf(k);
  const finalCoef = {
    smearing: finalSmear,
    a: finalBeta[0] + floorShift,
    b: finalBeta[idx("O")],
    c: finalBeta[idx("O2")],
    d_age: finalBeta[idx("age")],
    e_age2: finalBeta[idx("age2")],
    f_potentiale: finalBeta[idx("potentiale")],
    g_popularity: idx("popularity") >= 0 ? finalBeta[idx("popularity")] : 0,
    popularity_mode: idx("popularity") >= 0 ? "raw" : "dropped",
    h_is_youth: finalBeta[idx("is_youth")],
    offset: offsets,
  };

  console.log(`\n── Endeligt v2-fit (n=${rows.length}, R²(log)=${finalR2?.toFixed(4)}, smearing=${finalSmear.toFixed(3)}) ──`);
  console.log(`a=${finalCoef.a.toFixed(4)} b(O)=${finalCoef.b.toFixed(5)} c(O²)=${finalCoef.c.toExponential(3)} ` +
    `d(age)=${finalCoef.d_age.toFixed(4)} e(age²)=${finalCoef.e_age2.toExponential(3)} ` +
    `f(pot)=${finalCoef.f_potentiale.toFixed(4)} h(is_youth)=${finalCoef.h_is_youth.toFixed(4)} ` +
    `popularity=${finalCoef.popularity_mode}`);

  // ── 7. SCORECARD: v2 mod den KØRENDE model (v4) og mod ankeret ────────────
  const v4Model = JSON.parse(readFileSync(V4_MODEL_PATH, "utf8"));
  const trainBeta = chosen.beta;

  const scorecard = {
    market_v2: evalHoldout(holdoutRows, (r) => Math.exp(predictLinear(trainBeta, r, chosenFeatures, trainDummyTypes)) * chosen.smear),
    market_v2_no_smearing: evalHoldout(holdoutRows, (r) => Math.exp(predictLinear(trainBeta, r, chosenFeatures, trainDummyTypes))),
    v4_live: evalHoldout(holdoutRows, (r) => {
      const v = predictBaseValueV4({ primary_type: r.v4_type, potentiale: r.potentiale, age: r.age }, r.abilities, v4Model);
      return Number.isFinite(v) && v > 0 ? v : null;
    }),
    anchor_listed_value: evalHoldout(holdoutRows, (r) => (Number.isFinite(r.anchor_value) && r.anchor_value > 0 ? r.anchor_value : null)),
  };

  // ── Skala-korrigerede referencer ──
  // Hvis markedet siger at v4's RANGORDEN er rigtig og kun NIVEAUET er for højt,
  // så vil "v4 ganget med én konstant" slå en helt ny hedonisk model. Det er en
  // billigere og langt mindre indgribende rettelse end et modelskifte, og den
  // skal derfor måles eksplicit - ellers bygger vi en ny model for at løse et
  // problem en enkelt faktor kunne have løst.
  const trainV4Ratios = [];
  const trainAnchorRatios = [];
  for (const r of trainRows) {
    const v4 = predictBaseValueV4({ primary_type: r.v4_type, potentiale: r.potentiale, age: r.age }, r.abilities, v4Model);
    if (Number.isFinite(v4) && v4 > 0) trainV4Ratios.push(r.price / v4);
    if (Number.isFinite(r.anchor_value) && r.anchor_value > 0) trainAnchorRatios.push(r.price / r.anchor_value);
  }
  const v4ScaleFactor = median(trainV4Ratios);
  const anchorScaleFactor = median(trainAnchorRatios);
  scorecard.v4_live_scaled = evalHoldout(holdoutRows, (r) => {
    const v4 = predictBaseValueV4({ primary_type: r.v4_type, potentiale: r.potentiale, age: r.age }, r.abilities, v4Model);
    return Number.isFinite(v4) && v4 > 0 ? v4 * v4ScaleFactor : null;
  });
  scorecard.anchor_scaled = evalHoldout(holdoutRows, (r) =>
    (Number.isFinite(r.anchor_value) && r.anchor_value > 0 ? r.anchor_value * anchorScaleFactor : null));

  if (LEGACY_MODEL_PATH) {
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_MODEL_PATH, "utf8"));
      const lc = legacy.coefficients;
      scorecard.legacy_market_model = evalHoldout(holdoutRows, (r) => Math.exp(predictMarketLn(
        { ...lc, popularity_mode: lc.popularity_mode === "raw" ? "raw" : "dropped" },
        { O: r.O, age: r.age, potentiale: r.potentiale, popularity: r.popularity, is_youth: r.is_youth, type: r.type }
      )));
    } catch (e) {
      console.log(`  (kunne ikke læse --legacy-model: ${e.message})`);
    }
  }

  const holdoutPrices = holdoutRows.map((r) => r.price);
  console.log(`\nHoldout-priser: P10=${fmtCz(quantile(holdoutPrices, 0.1))} median=${fmtCz(median(holdoutPrices))} ` +
    `P90=${fmtCz(quantile(holdoutPrices, 0.9))} max=${fmtCz(Math.max(...holdoutPrices))}`);
  console.log(`\n── SCORECARD, tidsbaseret holdout n=${holdoutRows.length} (kun kvalificeret evidens) ──`);
  console.log("Model                          MAE(CZ$)    Median-AE   Median-APE   MAE(ln)      n");
  for (const [name, m] of Object.entries(scorecard)) {
    console.log(`${name.padEnd(28)} ${String(fmtCz(m.mae_czk)).padStart(11)} ${String(fmtCz(m.median_ae_czk)).padStart(12)} ` +
      `${String(fmtPct(m.median_ape)).padStart(12)} ${String(m.mae_ln?.toFixed(3) ?? "n/a").padStart(9)} ${String(m.n).padStart(6)}`);
  }

  console.log(`\nSkalafaktorer fittet på træningssættet: v4 x ${v4ScaleFactor?.toFixed(3)} · anker x ${anchorScaleFactor?.toFixed(3)} ` +
    `(median af pris/model over ${trainV4Ratios.length} handler).`);

  // GATEN: v2 skal måle mindst lige så godt som den KØRENDE model (v4) på alle
  // tre robuste mål. Tre og ikke ét, fordi auditten 14/8 viste at MAE alene
  // lader få store handler afgøre rangordenen, og fordi MAE(ln) er den skala
  // modellen faktisk er fittet på.
  const gateChecks = {
    mae_czk: scorecard.market_v2.mae_czk <= scorecard.v4_live.mae_czk,
    median_ae_czk: scorecard.market_v2.median_ae_czk <= scorecard.v4_live.median_ae_czk,
    mae_ln: scorecard.market_v2.mae_ln <= scorecard.v4_live.mae_ln,
  };
  const passed = Object.values(gateChecks).filter(Boolean).length;
  const gate = passed === 3 ? "GROEN" : passed === 0 ? "ROED" : "GUL";
  console.log(`\n→ GATE (v2 mindst lige så god som den KØRENDE v4 på MAE, median-AE OG MAE(ln)): ${gate} (${passed}/3)`);
  for (const [k, ok] of Object.entries(gateChecks)) console.log(`    ${ok ? "bestået" : "FEJLET "}  ${k}`);

  // ── 8. Evidensvægt Z over den ejede population ────────────────────────────
  const allRiders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, birthdate, popularity, potentiale, primary_type, valuation_type, is_retired, is_academy, base_value, market_value")
    .order("id"));
  const ownedRiders = allRiders.filter((r) =>
    r.team_id != null && realTeamIds.has(r.team_id) && !r.is_retired && !r.is_academy);

  const allAbilities = await fetchAllRows(() => supabase
    .from("rider_derived_abilities").select("*").order("rider_id"));
  const abilitiesByRider = new Map(allAbilities.map((a) => [a.rider_id, a]));

  // Nabolag: kvalificerede handler med samme type inden for ±O og ±år.
  const evidenceByType = new Map();
  for (const r of rows) {
    const arr = evidenceByType.get(r.type) || [];
    arr.push({ O: r.O, age: r.age });
    evidenceByType.set(r.type, arr);
  }
  function countNearby(O, age, type) {
    const arr = evidenceByType.get(type) || [];
    let c = 0;
    for (const s of arr) {
      if (Math.abs(s.O - O) <= GUARD_O_WINDOW && Math.abs(s.age - age) <= GUARD_AGE_WINDOW) c += 1;
    }
    return c;
  }

  const population = [];
  let popSkipped = 0;
  for (const r of ownedRiders) {
    const ab = abilitiesByRider.get(r.id);
    const type = typeOf(r);
    const age = ageForSeason(r.birthdate, activeSeason.number);
    const O = ab ? meanAbilityScore(ab) : null;
    if (!ab || O == null || age == null || !type) { popSkipped += 1; continue; }
    const marketPred = Math.max(1, Math.round(Math.exp(predictMarketLn(finalCoef, {
      O, age, potentiale: Number(r.potentiale) || 0, popularity: Number(r.popularity) || 0,
      is_youth: false, type,
    }))));
    const n = countNearby(O, age, type);
    population.push({
      rider_id: r.id, division: divisionByTeam.get(r.team_id) ?? null,
      type, age, O,
      current_value: Number(r.base_value) > 0 ? Number(r.base_value) : (Number(r.market_value) || 0),
      market_pred: marketPred, count_nearby: n, Z: evidenceWeight(n),
    });
  }
  console.log(`\nEjet population: ${population.length} ryttere (${popSkipped} droppet: mgl. evner/alder/type).`);

  const zs = population.map((p) => p.Z);
  const ns = population.map((p) => p.count_nearby);
  console.log(`  count_nearby: P10=${quantile(ns, 0.1)} P50=${median(ns)} P90=${quantile(ns, 0.9)} max=${Math.max(...ns)}`);
  console.log(`  Z=n/(n+${EVIDENCE_K}): P10=${quantile(zs, 0.1)?.toFixed(3)} P50=${median(zs)?.toFixed(3)} ` +
    `P90=${quantile(zs, 0.9)?.toFixed(3)} · andel med Z=0: ${fmtPct(population.filter((p) => p.Z === 0).length / population.length)}`);

  const zByBand = {};
  for (const p of population) (zByBand[ageBand(p.age)] ??= []).push(p.Z);
  console.log("  Median Z pr. aldersbånd: " +
    ["<23", "23-25", "26-28", "29-31", "32+"].map((b) => `${b}=${median(zByBand[b] || [])?.toFixed(3) ?? "n/a"}`).join(" · "));

  // ── 9. Artefakt ───────────────────────────────────────────────────────────
  const artifact = {
    version: "market_v2",
    method: "hedonic-ols-qualified-transactions",
    fitted_at: new Date().toISOString(),
    fitted_against: { database_url_host: String(SUPABASE_URL).replace(/^https?:\/\//, "").split(".")[0] },
    type_column: TYPE_COLUMN,
    reference_type: refType,
    formula: finalCoef.popularity_mode === "raw"
      ? "ln(price) = a + b*O + c*O^2 + d_age*age + e_age2*age^2 + f_potentiale*potentiale + g_popularity*popularity + h_is_youth*is_youth + offset[type]"
      : "ln(price) = a + b*O + c*O^2 + d_age*age + e_age2*age^2 + f_potentiale*potentiale + h_is_youth*is_youth + offset[type]",
    O_definition: "meanAbilityScore(abilities) - kanonisk O (0-99, urundet)",
    age_definition: "ageForSeason(birthdate, sæson på salgstidspunktet) - HELTAL, samme skala som runtime (#3449's v1.1-divergens rettet)",
    coefficients: finalCoef,
    evidence_filter: {
      description: "#3750 + beslutning 3 (15/8): kun kvalificeret evidens træner modellen.",
      criteria: [
        "auktion: mindst 2 FORSKELLIGE budgivere (auction_bids.team_id) OG current_price > starting_price",
        "transfer_offer: status=accepted mellem to menneskehold (ikke AI/bank/test/frosset)",
        "ekskluderet: is_guaranteed_sale",
        `ekskluderet: pris > ${MAX_PRICE_MULTIPLE}x rytterens ankerværdi (riders.market_value på fit-tidspunktet)`,
        `ekskluderet: handler i par med ${MAX_PAIR_TRADES}+ handler i vinduet`,
      ],
      funnel,
      n_qualified_rows: rows.length,
      n_auction: bySource.auction,
      n_transfer: bySource.transfer,
      type_counts: typeCounts,
      anchor_value_caveat: "3x-værnet bruger rytterens NUVÆRENDE market_value; der findes ingen historik over listet værdi pr. salgsdag.",
      abilities_source: { historical_snapshot: usedHistorical, current_fallback: usedCurrentFallback },
      weighting: "1x for alle kvalificerede handler. v1's 2:1-vægtning er væk - efter filteret er alt tilbageværende auktions-evidens konkurrenceprissat.",
    },
    guard: {
      support_mode: "evidence_ratio_n_over_n_plus_k",
      formula: "Z_rider = n / (n + K); w_rider = market_value_global_weight * Z_rider",
      K: EVIDENCE_K,
      O_window: GUARD_O_WINDOW,
      age_window: GUARD_AGE_WINDOW,
      description: "Beslutning 3 (15/8): værdien følger markedet i præcis den grad der findes kvalificerede handler med sammenlignelige ryttere. n = kvalificerede handler med samme type inden for ±O_window O-point og ±age_window år.",
      incompatible_with: "min(1, n/K) (v1.1's computeSupport). En runtime der bruger den formel må IKKE læse dette artefakt.",
      zero_evidence_share: population.length ? population.filter((p) => p.Z === 0).length / population.length : null,
      z_percentiles: { p10: quantile(zs, 0.1), p50: median(zs), p90: quantile(zs, 0.9) },
    },
    fit_r2_log: finalR2,
    holdout: {
      holdout_frac: HOLDOUT_FRAC,
      n_train: trainRows.length,
      n_holdout: holdoutRows.length,
      window: { from: holdoutRows[0]?.sale_ts ?? null, to: holdoutRows[holdoutRows.length - 1]?.sale_ts ?? null },
      train_r2_log: chosen.trainR2,
      scorecard,
      scale_factors: { v4_live: v4ScaleFactor, anchor: anchorScaleFactor },
      gate_vs_running_v4: gate,
      gate_checks: gateChecks,
      method_note: "MAE og median-absolut-fejl rapporteres side om side (audit 14/8: få store handler bestemmer ellers rangordenen). Ankeret er den trivielle 'brug den værdi rytteren var listet til'-model.",
    },
    variants: {
      chosen: keepPopularity ? "raw_popularity" : "base_no_popularity",
      selection_rule: "popularity beholdes kun hvis koefficienten er POSITIV og holdout-MAE forbedres over 2 %. v1.1's regel så kun på MAE og valgte derfor en model med negativ popularity-koefficient.",
      base_no_popularity: { train_r2: variantBase.trainR2, holdout: variantBase.holdout },
      raw_popularity: { train_r2: variantPop.trainR2, holdout: variantPop.holdout, coefficient_train: popCoefTrain, sign_ok: popSignOk },
      channel_dummy_diagnostic: channelDiagnostic,
    },
    population_snapshot: {
      n: population.length,
      skipped: popSkipped,
      count_nearby_percentiles: { p10: quantile(ns, 0.1), p50: median(ns), p90: quantile(ns, 0.9) },
      median_Z_by_age_band: Object.fromEntries(["<23", "23-25", "26-28", "29-31", "32+"].map((b) => [b, median(zByBand[b] || [])])),
    },
    notes: {
      why_v2:
        "v1/v1.1 trænede på 739 mekaniske bank-salg til YOUTH_AUCTION_START_RATE (0,25 x værdi) som om de var betalingsvilje (#3750). " +
        "Modellen lærte en konstant og aflæste den som en pris. v2 træner kun på handler hvor en pris faktisk blev forhandlet eller budt op.",
      open_question_channel_level:
        "Auktioner er ankret på bankens startpris, forhandlede handler er ikke. Se variants.channel_dummy_diagnostic: " +
        "hvis is_auction-koefficienten er markant negativ, er niveauet i modellen et vægtet gennemsnit af to kanaler, ikke ét markedsniveau. " +
        "Ejer-beslutning, ikke en scripts-default.",
      open_question_type_column:
        "Fittet er kørt med type_column=" + TYPE_COLUMN + ". Kør scriptet med den anden kolonne og sammenlign scorecardet før flaget flippes.",
      not_promoted:
        "Dette artefakt flytter INTET af sig selv. Sweepen er kill-switched og market_value_global_weight er seedet til 0 " +
        "(database/2026-08-17-3750-market-value-config.sql). Aktivering er ejer-gated.",
    },
  };

  if (WRITE_ARTIFACT) {
    writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2) + "\n");
    console.log(`\nSkrev artefakt: ${ARTIFACT_PATH}`);
  } else {
    console.log("\n(ingen --write-artifact - artefaktet blev ikke skrevet)");
  }

  if (REPORT_DIR) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const reportPath = join(REPORT_DIR, `fit-v2-${TYPE_COLUMN}.json`);
    writeFileSync(reportPath, JSON.stringify({
      fitted_at: artifact.fitted_at,
      type_column: TYPE_COLUMN,
      evidence_filter: artifact.evidence_filter,
      coefficients: finalCoef,
      holdout: artifact.holdout,
      variants: artifact.variants,
      guard: artifact.guard,
      population_snapshot: artifact.population_snapshot,
    }, null, 2) + "\n");
    console.log(`Skrev rapport: ${reportPath}`);
  }

  console.log("\n=== Færdig (read-only mod databasen) ===");
}

// Kun main() når filen køres direkte - de eksporterede rene funktioner skal
// kunne importeres af tests uden at åbne en DB-forbindelse.
if (process.argv[1] && process.argv[1].endsWith("fitMarketValueModelV2.js")) {
  main().catch((e) => {
    console.error("FEJL:", e);
    process.exit(1);
  });
}
