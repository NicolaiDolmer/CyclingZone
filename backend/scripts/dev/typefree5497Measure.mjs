#!/usr/bin/env node
// #5497 R2-R5 — måling af det typefri værdiforslag (DEV-ONLY, 100 % read-only).
//
// Læser KUN lokale, private filer (ingen DB, ingen credentials, ingen
// skrivninger andre steder end --out):
//   <evidence>/simulation.json          S3/v3-sæsonsimulering (R2-fit-mål)
//   <evidence>/snapshot.json            hele populationen (R5 før/efter)
//   <evidence>/ability-market-raw.json  betalingsafstemt markedsudtræk (R4)
//   --choices=<privat json>             ejerens valg (krone-niveau, markedsvægt,
//                                       markedsloft, præmie-trin). Tallene står
//                                       KUN i den private fil, aldrig her.
//
// Skriver privat rapport (tal + navne) til --out, som SKAL ligge under en
// gitignoreret balance-internals/-mappe. Scriptet nægter ellers.
//
// Brug:
//   node backend/scripts/dev/typefree5497Measure.mjs \
//     --evidence=<privat mappe> --choices=<privat ejer-valg.json> \
//     --out=<repo>/balance-internals/<dato>-5497-typefree
//
// Rører ikke: riderValuation.js-dispatch, marketValueModel.js, model-JSON'er,
// app_config. Der findes ingen --apply.
//
// v2 (23/9): ejer-valg 1-4 bygget ind, prognose v2 (reference uden evnen selv,
// loft kun for styrker, profil valgt så loft-budgettet svarer til v4's),
// udvikl-og-sælg før/efter på alle præmie-trin, glathed forklaret pr. felt.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { riderOverall, valuationOutput, valuationTypeFor } from "../../lib/riderValuation.js";
import { predictBaseValueV4, currentProductionValue } from "../../lib/riderCareerNpv.js";
import { signatureFactor } from "../../lib/riderProgression.js";
import {
  MAX_DEVELOP_SELL_ROI,
  projectAbilitiesForward,
  developAndSellGate,
  eliteUnbuyableGate,
  scaleContinuityGate,
} from "../../lib/valuationV4Scorecard.js";
import { DISPLAY_RECIPE_KEYS } from "../../lib/weights/displayRecipes.js";
import { FAIRPLAY_DEFAULTS } from "../../lib/fairplayScoring.js";
import { effectiveOutput, productionFromOutput, terrainUse } from "../../lib/valuationTypefree/abilityProduction.js";
import { fitTypefreeProduction } from "../../lib/valuationTypefree/fitProduction.js";
import { buildCapsTypefree, headroomBudget, profileSignature, stepTypefree } from "../../lib/valuationTypefree/careerTypefree.js";
import {
  ELITE_PREMIUM_PHASE_STEPS,
  predictBaseValueTypefree,
  predictBaseValueTypefreeByStep,
  currentProductionValueTypefree,
  TYPEFREE_MODEL_ID_PROPOSAL,
} from "../../lib/valuationTypefree/typefreeValuation.js";
import {
  fitCommon,
  fitLocal,
  marketAdjustedValue,
  qualifyMarketEvidence,
} from "../../lib/valuationTypefree/marketComponent.js";

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const EVIDENCE = arg("evidence");
const OUT = arg("out");
const CHOICES = arg("choices");
if (!EVIDENCE || !OUT || !CHOICES) {
  console.error("Brug: --evidence=<privat mappe> --choices=<privat ejer-valg.json> --out=<.../balance-internals/...>");
  process.exit(2);
}
if (!resolve(OUT).replace(/\\/g, "/").includes("/balance-internals/")) {
  console.error("Nægter: --out skal ligge under balance-internals/ (privat, gitignoreret).");
  process.exit(2);
}

// ── Ejer-valg (private tal) ─────────────────────────────────────────────────
const choicesFile = JSON.parse(readFileSync(CHOICES, "utf8"));
const ch = choicesFile.choices ?? {};
const LEVEL = ch.level;
const MARKET_WEIGHT = Number(ch.market_weight);
const MARKET_CAP = Math.log(Number(ch.market_cap_multiple));
const STEPS = Array.isArray(ch.elite_premium_phase_steps) ? ch.elite_premium_phase_steps.map(Number) : null;
if (!["A", "B"].includes(LEVEL) || !(MARKET_WEIGHT >= 0) || !(MARKET_CAP > 0) || !STEPS?.length
  || !STEPS.every((s) => s >= 0 && s <= 1) || ch.elite_premium !== "phase_out" || ch.glide_everyone !== false) {
  console.error("Nægter: --choices mangler/indeholder ugyldige ejer-valg (level, market_weight, market_cap_multiple, elite_premium=phase_out, elite_premium_phase_steps, glide_everyone=false).");
  process.exit(2);
}
if (JSON.stringify(STEPS) !== JSON.stringify([...ELITE_PREMIUM_PHASE_STEPS])) {
  console.error("Nægter: præmie-trinnene i --choices matcher ikke ELITE_PREMIUM_PHASE_STEPS.");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const KEYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "aggression", "positioning", "tactics"];
const load = (f) => JSON.parse(readFileSync(join(EVIDENCE, f), "utf8"));
const sha = (f) => createHash("sha256").update(readFileSync(join(EVIDENCE, f))).digest("hex").slice(0, 16);
const median = (xs) => {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2;
};
const quantile = (xs, q) => {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))] : null;
};
const sum = (xs) => xs.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
const hashUnit = (s) => parseInt(createHash("md5").update(String(s)).digest("hex").slice(0, 8), 16) / 0xffffffff;
const ageBand = (a) => (a <= 21 ? "<=21" : a <= 25 ? "22-25" : a <= 29 ? "26-29" : a <= 33 ? "30-33" : "34+");
const stepName = (i) => `trin${i}_k${STEPS[i]}`;

const v4Model = JSON.parse(readFileSync(new URL("../../lib/riderValuationModelV4.json", import.meta.url), "utf8"));
const report = {
  generated_for: "#5497 v2",
  owner_choices: { source: CHOICES.replace(/\\/g, "/").split("/").pop(), decided_at: choicesFile.decided_at, level: LEVEL, market_weight: MARKET_WEIGHT, market_cap_multiple: Number(ch.market_cap_multiple), elite_premium_phase_steps: STEPS, glide_everyone: false },
  inputs: {}, r2: {}, profile_selection: {}, level: {}, model: {}, population: {}, gates: {}, develop_and_sell: {}, market: {}, smoothness: {}, type_swap: {},
};

// ── R2: fit af typefri produktion på S3-simuleringen ───────────────────────
const sim = load("simulation.json");
report.inputs.simulation = { sha: sha("simulation.json"), season: sim.season_number, K: sim.K, samples: sim.samples.length };
const inFit = sim.samples.filter((s) => hashUnit(`fit:${s.rider_id}`) < 0.5);
const inHold = sim.samples.filter((s) => hashUnit(`fit:${s.rider_id}`) >= 0.5);
const t0 = Date.now();
// Anbefalet indtil R1: lige programvægt pr. terræn (fast), kun beta/alpha/a/b/c fittes.
// Fri fit af andelene rapporteres som advarsel (degenererer mod det terræn
// v3-simuleringen betaler mest for).
const EQUAL = Object.fromEntries(DISPLAY_RECIPE_KEYS.map((k) => [k, 1]));
const fitFree = fitTypefreeProduction(sim.samples, { maxIter: 3000 });
const fitHalf = fitTypefreeProduction(inFit, { maxIter: 3000, fixedShares: EQUAL });
const fitAll = fitTypefreeProduction(sim.samples, { maxIter: 3000, fixedShares: EQUAL });
const r2On = (rows, predictLn) => {
  const r = rows.filter((s) => Number(s.e_prize) > 0);
  const y = r.map((s) => Math.log(s.e_prize));
  const m = y.reduce((a, b) => a + b, 0) / y.length;
  let sse = 0, sst = 0;
  r.forEach((s, i) => { sse += (y[i] - predictLn(s)) ** 2; sst += (y[i] - m) ** 2; });
  return 1 - sse / sst;
};
const tfLn = (P) => (s) => {
  const v = productionFromOutput(effectiveOutput(s.abilities, P), P);
  return v == null ? NaN : Math.log(v);
};
// v4's live produktionsfunktion (type-keyet) på samme simulering, med den
// frosne type-kæde som i produktionen: valuation_type findes ikke i sim'et,
// så primary_type bruges (samme fallback som valuationTypeFor).
const v4Ln = (s) => {
  const f = v4Model.fit;
  const type = s.primary_type;
  const O = valuationOutput(s.abilities, type, { alpha: f.alpha ?? 1 });
  const offs = Object.values(f.offset);
  return f.a + f.b * O + f.c * O * O + (f.offset[type] ?? Math.min(...offs));
};
report.r2 = {
  typefree_fit_all_in_sample: fitAll.r2_log,
  typefree_free_shares_in_sample: fitFree.r2_log,
  free_shares_params: fitFree.params,
  typefree_fit_half_holdout: r2On(inHold, tfLn(fitHalf.params)),
  v4_live_function_on_this_sim_all: r2On(sim.samples, v4Ln),
  v4_live_function_on_this_sim_holdout_half: r2On(inHold, v4Ln),
  n_fit: fitAll.n_samples,
  iterations: fitAll.iterations,
  seconds: (Date.now() - t0) / 1000,
};
const P = fitAll.params;

// ── Population (snapshot) ────────────────────────────────────────────────────
const snap = load("snapshot.json");
report.inputs.snapshot = { sha: sha("snapshot.json"), read_at: snap.read_at, season: snap.season_number, riders: snap.riders.length };
const abById = new Map(snap.abilities.map((a) => [a.rider_id, a]));
const teamById = new Map(snap.teams.map((t) => [t.id, t]));
const isHumanTeam = (t) => t && t.is_ai === false && !t.is_bank && !t.is_test_account && !t.is_frozen;
const base = [];
for (const r of snap.riders) {
  if (r.is_retired) continue;
  const ab = abById.get(r.id);
  if (!ab) continue;
  const age = ageForSeason(r.birthdate, snap.season_number);
  if (!Number.isFinite(age)) continue;
  const abilities = Object.fromEntries(KEYS.map((k) => [k, ab[k]]));
  base.push({ r, age, abilities, rider: { primary_type: r.primary_type, valuation_type: r.valuation_type, potentiale: r.potentiale, age } });
}

// ── Model-objekter ───────────────────────────────────────────────────────────
// v1 = forslaget fra 22/9 (reference med evnen selv, alle evner mindst
// mellemniveauets loft). Beholdes KUN som "før" i udvikl-og-sælg og glathed.
const V1_PROFILE = { reference: "including_self", headroom: "off_floor", ref_sd: 0.5, width_sd: 0.5, width_floor: 2 };
const tfModel = {
  model_id: TYPEFREE_MODEL_ID_PROPOSAL,
  version: "v2",
  production: P,
  discount: v4Model.discount,
  scale: v4Model.scale,
  level_correction: v4Model.level_correction,
  profile: null, // vælges nedenfor
  elite_premium: { overall_threshold: v4Model.elite_premium.overall_threshold, k: v4Model.elite_premium.k },
  elite_premium_phase_steps: STEPS,
  market: { weight: MARKET_WEIGHT, cap_ln: MARKET_CAP },
  source: { simulation_sha: report.inputs.simulation.sha, season: sim.season_number, K: sim.K },
};

// ── Profil-valg (prognose v2) ────────────────────────────────────────────────
// Regel (uafhængig af udvikl-og-sælg-grænsen): blandt kandidater med reference
// uden evnen selv og loft kun for styrker vælges dem hvis loft-budget (snit
// loft-faktor i populationen) ligger inden for BUDGET_TOL af v4's (typens
// faktorer). Blandt dem vælges færrest "+1 evnepoint sænker grundværdien" på
// glatheds-stikprøven (ny normal = uden præmie, så kun prognosen måles).
// Uafgjort → nærmest v4's budget. Ingen kandidat inden for tolerancen →
// nærmest budget. To familier: snit+spredning af de øvrige evner (fast gitter)
// og blød maksimum af de øvrige (forskydningen løses så budgettet rammer v4's).
const BUDGET_TOL = 0.01;
const v4Budget = (() => {
  let s = 0, n = 0;
  for (const p of base) {
    const vt = valuationTypeFor(p.rider, v4Model);
    for (const k of KEYS) { s += signatureFactor(vt, k); n++; }
  }
  return s / n;
})();
const tfBudget = (profile) => sum(base.map((p) => headroomBudget(p.abilities, profile))) / base.length;
const gridSample = base.filter((p) => hashUnit(`sm:${p.r.id}`) < 0.12);
const negCount = (model) => {
  let neg = 0, over1 = 0, n = 0, worst = 0;
  for (const p of gridSample) {
    const b = predictBaseValueTypefree(p.rider, p.abilities, model, { premium: false });
    if (!(b > 0)) continue;
    for (const k of KEYS) {
      if (p.abilities[k] >= 99) continue;
      const d = predictBaseValueTypefree(p.rider, { ...p.abilities, [k]: p.abilities[k] + 1 }, model, { premium: false }) / b - 1;
      n++;
      if (d < -1e-9) neg++;
      if (d < -0.01) over1++;
      worst = Math.min(worst, d);
    }
  }
  return { n, negative: neg, negative_over_1pct: over1, worst };
};
const grid = [];
for (const ref_sd of [0, 0.25, 0.5]) for (const width_sd of [0.5, 1, 2]) for (const width_floor of [2, 4]) {
  const profile = { reference: "leave_one_out", headroom: "strengths_only", ref_sd, width_sd, width_floor };
  const budget = tfBudget(profile);
  grid.push({ profile, budget, budget_diff_vs_v4: budget - v4Budget, smoothness_no_premium: negCount({ ...tfModel, profile }) });
}
for (const tau of [1, 2, 4]) for (const width of [4, 6, 8]) {
  // Budgettet stiger monotont med forskydningen: halvering til 0,1 point.
  let lo = -40, hi = 40;
  for (let it = 0; it < 20; it++) {
    const mid = (lo + hi) / 2;
    if (tfBudget({ reference: "soft_max_others", headroom: "strengths_only", tau, width, offset: mid }) < v4Budget) lo = mid; else hi = mid;
  }
  const profile = { reference: "soft_max_others", headroom: "strengths_only", tau, width, offset: Math.round(((lo + hi) / 2) * 10) / 10 };
  const budget = tfBudget(profile);
  grid.push({ profile, budget, budget_diff_vs_v4: budget - v4Budget, smoothness_no_premium: negCount({ ...tfModel, profile }) });
}
const within = grid.filter((g) => Math.abs(g.budget_diff_vs_v4) <= BUDGET_TOL);
const pool = within.length ? within : [...grid].sort((a, b) => Math.abs(a.budget_diff_vs_v4) - Math.abs(b.budget_diff_vs_v4)).slice(0, 1);
const chosen = [...pool].sort((a, b) => a.smoothness_no_premium.negative - b.smoothness_no_premium.negative
  || Math.abs(a.budget_diff_vs_v4) - Math.abs(b.budget_diff_vs_v4))[0];
tfModel.profile = chosen.profile;
report.profile_selection = {
  rule: "reference uden evnen selv + loft kun for styrker; loft-budget inden for tolerance af v4's; færrest +1-fald (uden præmie) på glatheds-stikprøven",
  budget_tolerance: BUDGET_TOL,
  v4_budget: v4Budget,
  v1_budget: tfBudget(V1_PROFILE),
  v1_smoothness_no_premium: negCount({ ...tfModel, profile: V1_PROFILE }),
  n_within_tolerance: within.length,
  chosen,
  grid,
};
const tfV1 = { ...tfModel, profile: V1_PROFILE, version: "v1 (22/9)" };

// ── Krone-niveau (ejer-valg 1) ──────────────────────────────────────────────
// A = v4's omregning (scale × niveau-korrektion) lagt direkte på den nye
// simulerings NPV, ingen median-match. B (median-match) rapporteres kun som
// information. Ingen sum kalibreres.
{
  const v4s = [], tfA = [];
  for (const p of base) {
    const a = predictBaseValueV4(p.rider, p.abilities, v4Model);
    const b = predictBaseValueTypefree(p.rider, p.abilities, tfModel);
    if (a > 0 && b > 0) { v4s.push(a); tfA.push(b); }
  }
  const kB = median(v4s) / median(tfA);
  report.level = {
    choice: LEVEL,
    variant_A_median_delta_vs_v4: median(tfA) / median(v4s) - 1,
    variant_A_total_ratio_vs_v4: sum(tfA) / sum(v4s),
    variant_B_scale_multiplier_info_only: kB,
    v4_function_mean_ln_residual_on_S3_sim: (() => {
      const r = sim.samples.filter((s) => s.e_prize > 0);
      return r.reduce((s, x) => s + (Math.log(x.e_prize) - v4Ln(x)), 0) / r.length;
    })(),
  };
  if (LEVEL === "B") {
    tfModel.scale = v4Model.scale * kB;
    tfV1.scale = tfModel.scale;
  }
  tfModel.scale_method = LEVEL === "A" ? "A: v4's omregning uændret (ejer-valg 22/9)" : "B: median-match";
}
report.model = tfModel;

// ── R4: markedskomponent (fittes på v2-grundværdien, præmie-trin 0) ──────────
const raw = load("ability-market-raw.json");
report.inputs.market = { sha: sha("ability-market-raw.json"), since: raw.meta.since, until: raw.meta.until };
const human = new Set(raw.teams.filter((t) => t.is_ai === false && !t.is_bank && !t.is_test_account && !t.is_frozen).map((t) => t.id));
const seasons = new Map(raw.seasons.map((s) => [s.id, s.number]));
const snapRider = new Map(snap.riders.map((r) => [r.id, r]));
const rawRider = new Map(raw.riders.map((r) => [r.id, r]));
const group = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const payments = group(raw.finance, (f) => f.idempotency_key);
const bidsBy = group(raw.bids, (b) => b.auction_id);
const history = group(raw.history, (h) => h.rider_id);
for (const rows of history.values()) rows.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date) || b.created_at.localeCompare(a.created_at));
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });
const exactPayment = (key, team) => { const p = (payments.get(key) || []).filter((x) => x.team_id === team); return p.length === 1 ? p[0] : null; };
const obs = [];
for (const a of raw.auctions) {
  if (a.status !== "completed" || !human.has(a.current_bidder_id) || !(a.current_price > a.starting_price)) continue;
  const hb = (bidsBy.get(a.id) || []).filter((b) => human.has(b.team_id) && b.team_id !== a.seller_team_id && b.bid_time <= a.actual_end);
  const p = exactPayment((a.is_youth ? "youth_auction_winner:" : "auction_winner:") + a.id, a.current_bidder_id);
  if (!p || p.amount >= 0 || -Number(p.amount) !== Number(a.current_price)) continue;
  obs.push({ id: a.id, kind: "auction", rider_id: a.rider_id, at: p.created_at, price: -Number(p.amount), season: seasons.get(p.season_id),
    seller: a.seller_team_id, buyer: a.current_bidder_id, guaranteed: a.is_guaranteed_sale, distinctEligibleBidders: new Set(hb.map((b) => b.team_id)).size });
}
for (const o of raw.offers) {
  const b = exactPayment("transfer_buyer:" + o.id, o.buyer_team_id), s = exactPayment("transfer_seller:" + o.id, o.seller_team_id);
  if (!b || !s || b.amount >= 0 || Number(s.amount) !== -Number(b.amount)) continue;
  obs.push({ id: o.id, kind: "transfer", rider_id: o.rider_id, at: b.created_at, price: -Number(b.amount), season: seasons.get(b.season_id), seller: o.seller_team_id, buyer: o.buyer_team_id });
}
let noHistory = 0;
for (const e of obs) {
  const saleDay = dayFmt.format(new Date(e.at));
  const h = (history.get(e.rider_id) || []).find((x) => x.snapshot_date < saleDay && x.created_at <= e.at);
  const sr = snapRider.get(e.rider_id);
  const age = ageForSeason(rawRider.get(e.rider_id)?.birthdate ?? sr?.birthdate, e.season);
  if (!h || !Number.isFinite(age) || !KEYS.every((k) => Number.isFinite(Number(h.abilities[k])))) { noHistory++; continue; }
  e.abilities = Object.fromEntries(KEYS.map((k) => [k, Number(h.abilities[k])]));
  e.age = age;
  const rider = { primary_type: sr?.primary_type, valuation_type: sr?.valuation_type, potentiale: sr?.potentiale ?? 1, age };
  e.base = predictBaseValueTypefree(rider, e.abilities, tfModel);
  e.base_v4 = sr?.primary_type ? predictBaseValueV4(rider, e.abilities, v4Model) : null;
  e.O = effectiveOutput(e.abilities, P);
}
const withBase = obs.filter((e) => e.abilities);
const { qualified, funnel, levelShift } = qualifyMarketEvidence(withBase, { humanTeams: human });
qualified.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
const fitDate = qualified[Math.floor(qualified.length * 0.8)].at;
const train = qualified.filter((o) => o.at < fitDate);
const test = qualified.filter((o) => o.at >= fitDate);
const toRow = (o) => ({ ...o, r: Math.log(o.price / o.base) });
const trainRows = train.map(toRow);
// Tuning af (bandwidth, k0, lambda) på en indre tidsdeling af træningsdata.
const innerCut = trainRows[Math.floor(trainRows.length * 0.8)].at;
const innerA = trainRows.filter((o) => o.at < innerCut), innerB = trainRows.filter((o) => o.at >= innerCut);
const mael = (rows, pred) => rows.reduce((s, o) => s + Math.abs(Math.log(pred(o) / o.price)), 0) / rows.length;
const mape = (rows, pred) => median(rows.map((o) => Math.abs(pred(o) - o.price) / o.price));
const tuning = [];
for (const lambda of [1, 10]) for (const bandwidth of [0.3, 0.5, 0.8]) for (const k0 of [2, 5, 10]) {
  const lvlA = median(innerA.map((o) => o.r));
  const cm = fitCommon(innerA.map((o) => ({ ...o, r: o.r - lvlA })), { lambda });
  const lc = fitLocal(innerA.map((o) => ({ ...o, r: o.r - lvlA })), { abilityKeys: KEYS, bandwidth, k0, common: cm });
  tuning.push({ lambda, bandwidth, k0, loss: mael(innerB, (o) => o.base * Math.exp(lvlA) * Math.exp(cm.predict(o) + lc.predict(o))) });
}
tuning.sort((a, b) => a.loss - b.loss);
const sel = tuning[0];
const lvl = median(trainRows.map((o) => o.r));
const lvlV4 = median(train.filter((o) => o.base_v4 > 0).map((o) => Math.log(o.price / o.base_v4)));
const common = fitCommon(trainRows.map((o) => ({ ...o, r: o.r - lvl })), { lambda: sel.lambda });
const local = fitLocal(trainRows.map((o) => ({ ...o, r: o.r - lvl })), { abilityKeys: KEYS, bandwidth: sel.bandwidth, k0: sel.k0, common });
const marketOpts = { common, local, weight: MARKET_WEIGHT, cap: MARKET_CAP };
// Holdout: niveauet (lvl) er markedets samlede niveau vs. modellen og styres af
// #3449-korrektionen — det lægges på ALLE varianter, så sammenligningen måler
// RELATIVE priser, som er det markedskomponenten må flytte.
const variants = {
  v4_base: (o) => o.base_v4 * Math.exp(lvlV4),
  tf_base: (o) => o.base * Math.exp(lvl),
  tf_common: (o) => o.base * Math.exp(lvl + common.predict(o)),
  tf_common_local: (o) => o.base * Math.exp(lvl + common.predict(o) + local.predict(o)),
  tf_owner_choice: (o) => marketAdjustedValue(o.base * Math.exp(lvl), o, marketOpts),
};
const testV4 = test.filter((o) => o.base_v4 > 0);
const holdout = {};
for (const [k, f] of Object.entries(variants)) {
  const rows = k === "v4_base" ? testV4 : test;
  holdout[k] = { n: rows.length, median_ape: mape(rows, f), mean_abs_log_error: mael(rows, f) };
}
// Robusthed: holdout på ALLE handler efter fit-datoen der består de øvrige
// filtre, også dem prisafvigelses-filteret ellers smider ud.
const noBand = qualifyMarketEvidence(withBase, { humanTeams: human, config: { ...FAIRPLAY_DEFAULTS, priceBandFloorPct: 0, priceBandCapMultiple: Infinity } });
const testWide = noBand.qualified.filter((o) => o.at >= fitDate);
const holdoutWide = {};
for (const [k, f] of Object.entries(variants)) {
  const rows = k === "v4_base" ? testWide.filter((o) => o.base_v4 > 0) : testWide;
  holdoutWide[k] = { n: rows.length, median_ape: mape(rows, f), mean_abs_log_error: mael(rows, f) };
}
const weightGrid = [];
for (const w of [0.25, 0.5, 1]) for (const capName of ["1.25", "1.5", "2", "inf"]) {
  const cap = capName === "inf" ? Infinity : Math.log(Number(capName));
  const f = (o) => marketAdjustedValue(o.base * Math.exp(lvl), o, { common, local, weight: w, cap });
  weightGrid.push({ weight: w, cap_multiple: capName, median_ape: mape(test, f), mean_abs_log_error: mael(test, f) });
}

// ── R5: population på alle præmie-trin (ejer-valg 3 + 4) ────────────────────
// Kørselsdagen (trin 0): alt undtagen præmien skifter på én gang. Derefter
// falder kun præmien, ét trin pr. søndagskørsel. Markedet (valg 2) ligger oven
// på grundværdien på hvert trin; det afhænger ikke af præmie-trinnet.
const pop = [];
for (const p of base) {
  const { r, age, abilities, rider } = p;
  const team = teamById.get(r.team_id);
  const O = effectiveOutput(abilities, P);
  const x = { abilities, age, O };
  const mkt = marketAdjustedValue(1, x, marketOpts); // faktor, loft anvendt
  const tfSteps = predictBaseValueTypefreeByStep(rider, abilities, tfModel, STEPS);
  pop.push({
    id: r.id,
    name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
    team_id: r.team_id,
    team: team?.name ?? null,
    human: isHumanTeam(team),
    ai: team?.is_ai === true,
    free: !r.team_id,
    primary_type: r.primary_type,
    valuation_type: r.valuation_type,
    potentiale: r.potentiale,
    age,
    overall: riderOverall(abilities),
    abilities,
    stored: r.base_value,
    v4: predictBaseValueV4(rider, abilities, v4Model),
    tf_steps: tfSteps,
    mkt_factor: mkt,
    mkt_steps: tfSteps.map((v) => (v > 0 ? Math.round(v * mkt) : null)),
    tf_v1: predictBaseValueTypefree(rider, abilities, tfV1),
    cpv_v4: currentProductionValue(rider, abilities, v4Model),
    cpv_tf: currentProductionValueTypefree(rider, abilities, tfModel),
    O_tf: O,
  });
}
const valid = pop.filter((r) => r.v4 > 0 && r.tf_steps.every((v) => v > 0));
const at = (r, i, kind = "tf") => (kind === "mkt" ? r.mkt_steps[i] : kind === "v1" ? r.tf_v1 : r.tf_steps[i]);
const delta = (r, i, kind) => at(r, i, kind) / r.v4 - 1;
const groupStats = (rows, key, i, kind = "tf") => {
  const g = {};
  for (const r of rows) (g[key(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(g).sort().map(([gk, rs]) => [gk, {
    n: rs.length,
    median_delta: median(rs.map((r) => delta(r, i, kind))),
    p10_delta: quantile(rs.map((r) => delta(r, i, kind)), 0.1),
    p90_delta: quantile(rs.map((r) => delta(r, i, kind)), 0.9),
    total_before: sum(rs.map((r) => r.v4)),
    total_after: sum(rs.map((r) => at(r, i, kind))),
  }]));
};
const humanTeams = (i, kind) => {
  const teams = {};
  for (const r of valid.filter((x) => x.human)) {
    const t = (teams[r.team_id] ??= { team: r.team, riders: 0, before: 0, after: 0, cash: teamById.get(r.team_id)?.balance ?? null });
    t.riders += 1; t.before += r.v4; t.after += at(r, i, kind);
  }
  const rows = Object.values(teams).map((t) => ({ ...t, delta: t.after / t.before - 1 })).sort((a, b) => a.delta - b.delta);
  return {
    n: rows.length,
    median_team_delta: median(rows.map((t) => t.delta)),
    p10_team_delta: quantile(rows.map((t) => t.delta), 0.1),
    p90_team_delta: quantile(rows.map((t) => t.delta), 0.9),
    teams_losing_over_25pct: rows.filter((t) => t.delta < -0.25).length,
    teams_gaining_over_25pct: rows.filter((t) => t.delta > 0.25).length,
    total_rider_value_before: sum(rows.map((t) => t.before)),
    total_rider_value_after: sum(rows.map((t) => t.after)),
    total_cash_unchanged: sum(rows.map((t) => t.cash)),
    rows,
  };
};
const stepSummary = (i, kind) => {
  const ht = humanTeams(i, kind);
  const elite = valid.filter((r) => r.overall >= 55);
  return {
    median_delta_vs_v4: median(valid.map((r) => delta(r, i, kind))),
    total_ratio_vs_v4: sum(valid.map((r) => at(r, i, kind))) / sum(valid.map((r) => r.v4)),
    median_value: median(valid.map((r) => at(r, i, kind))),
    elite_overall55_median_delta: median(elite.map((r) => delta(r, i, kind))),
    elite_overall55_total_ratio: sum(elite.map((r) => at(r, i, kind))) / sum(elite.map((r) => r.v4)),
    human_team_median_delta: ht.median_team_delta,
    human_teams_losing_over_25pct: ht.teams_losing_over_25pct,
    human_riders_losing_over_half: valid.filter((r) => r.human && delta(r, i, kind) < -0.5).length,
    by_owner: groupStats(valid, (r) => (r.human ? "menneskehold" : r.ai ? "AI-hold" : r.free ? "fri" : "andet"), i, kind),
  };
};
const detail = (i, kind) => {
  const ht = humanTeams(i, kind);
  const losers = valid.filter((r) => r.human && delta(r, i, kind) < -0.5).sort((a, b) => delta(a, i, kind) - delta(b, i, kind));
  return {
    by_primary_type: groupStats(valid, (r) => r.primary_type ?? "ukendt", i, kind),
    by_age: groupStats(valid, (r) => ageBand(r.age), i, kind),
    by_potentiale: groupStats(valid, (r) => String(Math.round(Number(r.potentiale) || 0)), i, kind),
    human_teams: { ...ht, rows: undefined, worst10: ht.rows.slice(0, 10), best10: ht.rows.slice(-10).reverse() },
    loss_list: {
      human_riders_losing_over_half: losers.length,
      human_riders_total: valid.filter((r) => r.human).length,
      rows: losers.map((r) => ({ name: r.name, team: r.team, type: r.primary_type, age: r.age, overall: r.overall, potentiale: r.potentiale, v4: r.v4, after: at(r, i, kind), delta: delta(r, i, kind), terrain_use: terrainUse(r.abilities, P) })),
    },
    top20_gainers_human: valid.filter((r) => r.human).sort((a, b) => delta(b, i, kind) - delta(a, i, kind)).slice(0, 20)
      .map((r) => ({ name: r.name, team: r.team, type: r.primary_type, age: r.age, overall: r.overall, v4: r.v4, after: at(r, i, kind), delta: delta(r, i, kind) })),
  };
};
const last = STEPS.length - 1;
report.population = {
  n: valid.length,
  median_abs_stored_vs_fresh_v4: median(valid.filter((r) => r.stored > 0).map((r) => Math.abs(r.stored / r.v4 - 1))),
  note: "Grundværdi = tf; med marked = tf × markedsfaktor (ejerens vægt og loft). Trin 0 = kørselsdagen; kun præmien ændrer sig mellem trinnene.",
  by_step_base: Object.fromEntries(STEPS.map((_, i) => [stepName(i), stepSummary(i, "tf")])),
  by_step_with_market: Object.fromEntries(STEPS.map((_, i) => [stepName(i), stepSummary(i, "mkt")])),
  v1_22_9_level_A_for_reference: { median_delta_vs_v4: median(valid.map((r) => delta(r, 0, "v1"))), total_ratio_vs_v4: sum(valid.map((r) => r.tf_v1)) / sum(valid.map((r) => r.v4)) },
  detail_switch_day_with_market: detail(0, "mkt"),
  detail_new_normal_with_market: detail(last, "mkt"),
  market_factor: {
    median: median(valid.map((r) => r.mkt_factor)),
    p10: quantile(valid.map((r) => r.mkt_factor), 0.1),
    p90: quantile(valid.map((r) => r.mkt_factor), 0.9),
    share_at_cap: valid.filter((r) => Math.abs(Math.log(r.mkt_factor)) >= MARKET_CAP - 1e-9).length / valid.length,
    by_age: Object.fromEntries([...group(valid, (r) => ageBand(r.age)).entries()].sort().map(([k, rs]) => [k, median(rs.map((r) => r.mkt_factor))])),
  },
  cpv: {
    median_delta: median(valid.filter((r) => r.cpv_v4 > 0 && r.cpv_tf > 0).map((r) => r.cpv_tf / r.cpv_v4 - 1)),
  },
};

// ── Scorecard: eksisterende regressionsgrænser (hver for sig, pr. trin) ─────
const gates = {};
for (let i = 0; i < STEPS.length; i++) {
  const vals = valid.map((r) => at(r, i, "tf"));
  const eliteRows = valid.filter((r) => r.overall >= 55);
  const below = valid.filter((r) => r.overall >= 45 && r.overall < 55);
  const medBelow = median(below.map((r) => at(r, i, "tf")));
  const cheaper = eliteRows.filter((r) => at(r, i, "tf") < medBelow).length;
  const gScale = scaleContinuityGate(valid.map((r) => r.v4), vals);
  gates[stepName(i)] = {
    scale_continuity: { ...gScale, owner_status: !gScale.ok && LEVEL === "A" ? "rød, ejer-accepteret 22/9 (valg A)" : null },
    elite_unbuyable_old_formulation_tf: eliteUnbuyableGate(valid.map((r) => ({ overall: r.overall, v4Value: at(r, i, "tf") })), { ceiling: v4Model.elite_premium.affordability_ceiling }),
    elite_rank_proposed: { name: "Elite-rangorden: ingen overall≥55 under medianen af overall 45-54", hard: true, ok: eliteRows.length > 0 && cheaper === 0, n_elite: eliteRows.length, n_cheaper: cheaper },
  };
}
report.gates.by_step = gates;
report.gates.elite_unbuyable_old_formulation_v4 = eliteUnbuyableGate(valid.map((r) => ({ overall: r.overall, v4Value: r.v4 })), { ceiling: v4Model.elite_premium.affordability_ceiling });
report.gates.determinism = { name: "Determinisme", hard: true, ok: true, detail: `fit deterministisk (Nelder-Mead fast start); simulation sha ${report.inputs.simulation.sha}` };

// ── Udvikl-og-sælg: før (v1) / efter (v2) på alle trin + v4-reference ───────
// Samme konvention som scorecardet: den mest værdifulde prospect (≤21 år,
// potentiale ≥5), fremskrevet 4 sæsoner med modellens egen prognose, samme
// model ved start og horisont. Fordelingen over ALLE prospects rapporteres
// ved siden af, så resultatet ikke hviler på én rytter.
const prospects = valid.filter((r) => r.age <= 21 && Number(r.potentiale) >= 5);
const projectTf = (r, model) => {
  const sig = profileSignature(r.abilities, model.profile);
  const caps = buildCapsTypefree(r.abilities, sig, r.potentiale, { headroom: model.profile.headroom });
  let ab = { ...r.abilities };
  for (let s = 0; s < 4; s++) ab = stepTypefree(ab, caps, sig, { potentiale: r.potentiale, age: r.age + s });
  return ab;
};
const devTf = (model) => {
  const rows = prospects.map((r) => {
    const rider = { potentiale: r.potentiale, age: r.age };
    const abH = projectTf(r, model);
    const start = predictBaseValueTypefreeByStep(rider, r.abilities, model, STEPS);
    const horizon = predictBaseValueTypefreeByStep({ ...rider, age: r.age + 4 }, abH, model, STEPS);
    const cpv = currentProductionValueTypefree(rider, r.abilities, model);
    return { r, start, horizon, cpv, overallStart: r.overall, overallHorizon: riderOverall(abH) };
  });
  const out = {};
  for (let i = 0; i < STEPS.length; i++) {
    const gs = rows.map((x) => ({ x, g: developAndSellGate({ bvStart: x.start[i], cpvStart: x.cpv, bvAtHorizon: x.horizon[i], seasons: 4 }) }));
    const best = gs.reduce((b, y) => (y.x.start[i] > (b?.x.start[i] ?? -Infinity) ? y : b), null);
    out[stepName(i)] = {
      gate_most_valuable_prospect: { ...best.g, rider: best.x.r.name, age: best.x.r.age, potentiale: best.x.r.potentiale, overall_start: best.x.overallStart, overall_horizon: best.x.overallHorizon },
      prospects: gs.length,
      median_roi: median(gs.map((y) => y.g.roi)),
      p90_roi: quantile(gs.map((y) => y.g.roi), 0.9),
      over_roi_cap: gs.filter((y) => y.g.roi > MAX_DEVELOP_SELL_ROI).length,
      net_negative: gs.filter((y) => !(y.g.pnl > 0)).length,
    };
  }
  // Realistisk sti under udfasningen: købt på kørselsdagen (trin 0), solgt
  // efter 4 sæsoner, hvor præmien for længst er udfaset (sidste trin).
  const best0 = rows.reduce((b, x) => (x.start[0] > (b?.start[0] ?? -Infinity) ? x : b), null);
  out.bought_switch_day_sold_new_normal = developAndSellGate({ bvStart: best0.start[0], cpvStart: best0.cpv, bvAtHorizon: best0.horizon[last], seasons: 4 });
  return out;
};
const devV4 = (() => {
  const out = {};
  const rows = prospects.map((r) => {
    const proj = projectAbilitiesForward(r.abilities, { primaryType: valuationTypeFor(r, v4Model), potentiale: r.potentiale, startAge: r.age }, 4);
    const hr = { primary_type: r.primary_type, valuation_type: r.valuation_type, potentiale: r.potentiale, age: proj.ageAtHorizon };
    return { r, g: developAndSellGate({ bvStart: r.v4, cpvStart: r.cpv_v4, bvAtHorizon: predictBaseValueV4(hr, proj.abilities, v4Model), seasons: 4 }) };
  });
  const best = rows.reduce((b, y) => (y.r.v4 > (b?.r.v4 ?? -Infinity) ? y : b), null);
  out.gate_most_valuable_prospect = { ...best.g, rider: best.r.name };
  out.median_roi = median(rows.map((y) => y.g.roi));
  out.over_roi_cap = rows.filter((y) => y.g.roi > MAX_DEVELOP_SELL_ROI).length;
  out.net_negative = rows.filter((y) => !(y.g.pnl > 0)).length;
  out.note = "v4 med sin præmie og sit elitegulv, som i dag";
  return out;
})();
report.develop_and_sell = {
  roi_cap: MAX_DEVELOP_SELL_ROI,
  after_v2: devTf(tfModel),
  before_v1_22_9: devTf(tfV1),
  v4_reference: devV4,
};
report.gates.regression_limits = {
  develop_and_sell_tf: Object.fromEntries(STEPS.map((_, i) => [stepName(i), report.develop_and_sell.after_v2[stepName(i)].gate_most_valuable_prospect])),
  scale_continuity: Object.fromEntries(STEPS.map((_, i) => [stepName(i), gates[stepName(i)].scale_continuity])),
};

// ── Glathed: ét evnepoint ────────────────────────────────────────────────────
// Felterne tæller hver for sig (n = antal (rytter, evne)-par på stikprøven):
//   base_v2_*          : grundværdien (v2) — "+1 sænker værdien" i ordets egentlige forstand
//   base_v1_22_9       : samme for 22/9-forslaget (det tal PR-teksten byggede på)
//   with_market_*      : grundværdi × markedsfaktor med ejerens vægt og loft
//   market_factor_only : KUN markedsfaktoren exp(fælles+lokal) med vægt 1 og
//                        intet loft (= 22/9-feltet market.smoothness_plus_one).
//                        Den er en relativ korrektion og SKAL kunne gå begge veje.
const smoothSample = valid.filter((r) => hashUnit(`sm:${r.id}`) < 0.12);
const js = (xs) => ({ n: xs.length, p50: quantile(xs.map(Math.abs), 0.5), p99: quantile(xs.map(Math.abs), 0.99), max: Math.max(...xs.map(Math.abs)), negative: xs.filter((x) => x < -1e-9).length, negative_over_1pct: xs.filter((x) => x < -0.01).length });
const jumps = { base0: [], baseLast: [], v1: [], v4: [], mkt0: [], mktLast: [] };
let worst = null;
for (const r of smoothSample) {
  const rider = { primary_type: r.primary_type, valuation_type: r.valuation_type, potentiale: r.potentiale, age: r.age };
  for (const k of KEYS) {
    if (r.abilities[k] >= 99) continue;
    const up = { ...r.abilities, [k]: r.abilities[k] + 1 };
    const st = predictBaseValueTypefreeByStep(rider, up, tfModel, STEPS);
    const mf = marketAdjustedValue(1, { abilities: up, age: r.age, O: effectiveOutput(up, P) }, marketOpts);
    const d0 = st[0] / r.tf_steps[0] - 1;
    jumps.base0.push(d0);
    jumps.baseLast.push(st[last] / r.tf_steps[last] - 1);
    jumps.mkt0.push((st[0] * mf) / (r.tf_steps[0] * r.mkt_factor) - 1);
    jumps.mktLast.push((st[last] * mf) / (r.tf_steps[last] * r.mkt_factor) - 1);
    jumps.v1.push(predictBaseValueTypefree(rider, up, tfV1) / r.tf_v1 - 1);
    jumps.v4.push(predictBaseValueV4(rider, up, v4Model) / r.v4 - 1);
    if (!worst || d0 < worst.rel) worst = { rel: d0, ability: k, age: r.age, overall: r.overall };
  }
}
const mJumps = [];
for (const r of smoothSample.slice(0, 300)) {
  const x = { abilities: r.abilities, age: r.age, O: r.O_tf };
  const b = common.predict(x) + local.predict(x);
  for (const k of KEYS) {
    const up = { ...r.abilities, [k]: r.abilities[k] + 1 };
    const xu = { abilities: up, age: r.age, O: effectiveOutput(up, P) };
    mJumps.push(Math.exp(common.predict(xu) + local.predict(xu) - b) - 1);
  }
}
report.smoothness = {
  what_counts: "n = antal (rytter, evne)-par; negative = par hvor +1 evnepoint giver lavere tal end før; negative_over_1pct = heraf fald over 1 %.",
  base_v2_switch_day: js(jumps.base0),
  base_v2_new_normal: js(jumps.baseLast),
  base_v1_22_9: js(jumps.v1),
  v4_fixed_type: js(jumps.v4),
  with_market_switch_day: js(jumps.mkt0),
  with_market_new_normal: js(jumps.mktLast),
  market_factor_only_weight1_nocap: js(mJumps),
  worst_base_v2: worst,
};

// ── Typebyte-ækvivalens ──────────────────────────────────────────────────────
const swapSample = valid.filter((r) => hashUnit(`sw:${r.id}`) < 0.06);
let tfMismatch = 0, v4Differs = 0;
const v4Spread = [];
for (const r of swapSample) {
  const tfv = new Set(), v4v = [];
  for (const t of DISPLAY_RECIPE_KEYS) {
    const rider = { primary_type: t, valuation_type: t, potentiale: r.potentiale, age: r.age };
    tfv.add(JSON.stringify(predictBaseValueTypefreeByStep(rider, r.abilities, tfModel, STEPS)));
    v4v.push(predictBaseValueV4(rider, r.abilities, v4Model));
  }
  if (tfv.size !== 1) tfMismatch++;
  if (new Set(v4v).size > 1) v4Differs++;
  v4Spread.push(Math.max(...v4v) / Math.min(...v4v));
}
report.type_swap = { n: swapSample.length, tf_riders_with_any_difference_all_steps: tfMismatch, v4_riders_with_any_difference: v4Differs, v4_median_max_over_min: median(v4Spread), v4_p90_max_over_min: quantile(v4Spread, 0.9) };

// ── Markedsrapport ───────────────────────────────────────────────────────────
const influence = {};
for (const r of valid) {
  const x = { abilities: r.abilities, age: r.age, O: r.O_tf };
  const c = common.predict(x), l = local.predict(x), ev = local.evidence(x);
  const g = (influence[ageBand(r.age)] ??= { n: 0, c: [], l: [], ev: [] });
  g.n++; g.c.push(c); g.l.push(l); g.ev.push(ev);
}
report.market = {
  observations_with_history: withBase.length,
  observations_missing_history_or_age: noHistory,
  funnel,
  level_shift_all_qualified_ln: levelShift,
  fit_date: fitDate,
  n_train: train.length,
  n_test: test.length,
  tuning_selected: sel,
  common_gamma0_ln_reported_not_applied: common.gamma0,
  common_gamma: common.gamma,
  holdout,
  holdout_including_price_outliers: holdoutWide,
  weight_grid: weightGrid,
  influence_by_age: Object.fromEntries(Object.entries(influence).sort().map(([k, g]) => [k, {
    n: g.n,
    median_abs_common: median(g.c.map(Math.abs)),
    median_abs_local: median(g.l.map(Math.abs)),
    share_evidence_over_half: g.ev.filter((e) => e > 0.5).length / g.n,
    median_evidence: median(g.ev),
  }])),
  smoothness_plus_one: js(mJumps),
  smoothness_plus_one_note: "Samme tal som smoothness.market_factor_only_weight1_nocap: kun markedsfaktoren, ikke værdien.",
};

writeFileSync(join(OUT, "typefree5497-report.json"), JSON.stringify(report, (k, v) => (k === "abilities" ? undefined : v), 2));
writeFileSync(join(OUT, "typefree5497-model-proposal.json"), JSON.stringify(tfModel, null, 2));
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const dev = report.develop_and_sell;
console.log(JSON.stringify({
  profile_selection: { v4_budget: v4Budget, v1_budget: report.profile_selection.v1_budget, chosen: chosen.profile, chosen_budget: chosen.budget, chosen_neg: chosen.smoothness_no_premium, v1_neg: report.profile_selection.v1_smoothness_no_premium, within: within.length },
  level: report.level,
  develop_and_sell: Object.fromEntries(STEPS.map((_, i) => [stepName(i), {
    v2: [dev.after_v2[stepName(i)].gate_most_valuable_prospect.ok, pct(dev.after_v2[stepName(i)].gate_most_valuable_prospect.roi), dev.after_v2[stepName(i)].over_roi_cap, dev.after_v2[stepName(i)].net_negative, pct(dev.after_v2[stepName(i)].median_roi)],
    v1: [dev.before_v1_22_9[stepName(i)].gate_most_valuable_prospect.ok, pct(dev.before_v1_22_9[stepName(i)].gate_most_valuable_prospect.roi), dev.before_v1_22_9[stepName(i)].over_roi_cap],
  }])),
  dev_realistic_v2: dev.after_v2.bought_switch_day_sold_new_normal.detail,
  dev_v4: [dev.v4_reference.gate_most_valuable_prospect.detail, pct(dev.v4_reference.median_roi), dev.v4_reference.over_roi_cap],
  gates: Object.fromEntries(STEPS.map((_, i) => [stepName(i), { scale: gates[stepName(i)].scale_continuity.ok, elite_old: gates[stepName(i)].elite_unbuyable_old_formulation_tf.ok, elite_rank: gates[stepName(i)].elite_rank_proposed.ok }])),
  population_base: Object.fromEntries(Object.entries(report.population.by_step_base).map(([k, v]) => [k, [pct(v.median_delta_vs_v4), v.total_ratio_vs_v4.toFixed(3), pct(v.elite_overall55_median_delta), v.human_riders_losing_over_half]])),
  population_market: Object.fromEntries(Object.entries(report.population.by_step_with_market).map(([k, v]) => [k, [pct(v.median_delta_vs_v4), v.total_ratio_vs_v4.toFixed(3), pct(v.elite_overall55_median_delta), v.human_riders_losing_over_half]])),
  smoothness: report.smoothness,
  type_swap: report.type_swap,
  market: { funnel, n_train: train.length, n_test: test.length, holdout, holdoutWide, sel, weightGrid },
}, null, 2));
