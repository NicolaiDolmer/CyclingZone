#!/usr/bin/env node
// #5497 R2-R5 — måling af det typefri værdiforslag (DEV-ONLY, 100 % read-only).
//
// Læser KUN lokale, private snapshots (ingen DB, ingen credentials, ingen
// skrivninger andre steder end --out):
//   <evidence>/simulation.json          S3/v3-sæsonsimulering (R2-fit-mål)
//   <evidence>/snapshot.json            hele populationen (R5 før/efter)
//   <evidence>/ability-market-raw.json  betalingsafstemt markedsudtræk (R4)
//
// Skriver privat rapport (tal + navne) til --out, som SKAL ligge under en
// gitignoreret balance-internals/-mappe. Scriptet nægter ellers.
//
// Brug:
//   node backend/scripts/dev/typefree5497Measure.mjs \
//     --evidence=<privat mappe> --out=<repo>/balance-internals/<dato>-5497-typefree
//
// Rører ikke: riderValuation.js-dispatch, marketValueModel.js, model-JSON'er,
// app_config. Der findes ingen --apply.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { riderOverall, valuationOutput, valuationTypeFor } from "../../lib/riderValuation.js";
import { predictBaseValueV4, currentProductionValue } from "../../lib/riderCareerNpv.js";
import { projectAbilitiesForward, developAndSellGate, eliteUnbuyableGate, scaleContinuityGate } from "../../lib/valuationV4Scorecard.js";
import { DISPLAY_RECIPE_KEYS } from "../../lib/weights/displayRecipes.js";
import { FAIRPLAY_DEFAULTS } from "../../lib/fairplayScoring.js";
import { effectiveOutput, terrainUse } from "../../lib/valuationTypefree/abilityProduction.js";
import { fitTypefreeProduction } from "../../lib/valuationTypefree/fitProduction.js";
import { buildCapsTypefree, profileSignature, stepTypefree } from "../../lib/valuationTypefree/careerTypefree.js";
import {
  predictBaseValueTypefree,
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
if (!EVIDENCE || !OUT) {
  console.error("Brug: --evidence=<privat mappe> --out=<.../balance-internals/...>");
  process.exit(2);
}
if (!resolve(OUT).replace(/\\/g, "/").includes("/balance-internals/")) {
  console.error("Nægter: --out skal ligge under balance-internals/ (privat, gitignoreret).");
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

const v4Model = JSON.parse(readFileSync(new URL("../../lib/riderValuationModelV4.json", import.meta.url), "utf8"));
const report = { generated_for: "#5497", inputs: {}, r2: {}, model: {}, population: {}, gates: {}, market: {}, smoothness: {}, type_swap: {}, choices: {} };

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
  const O = Math.min(effectiveOutput(s.abilities, P), P.c < 0 ? -P.b / (2 * P.c) : Infinity);
  return P.a + P.b * O + P.c * O * O;
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

// ── Model-objekt (forslag) ──────────────────────────────────────────────────
const tfModel = {
  model_id: TYPEFREE_MODEL_ID_PROPOSAL,
  production: P,
  discount: v4Model.discount,
  scale: v4Model.scale,
  level_correction: v4Model.level_correction,
  profile: { ref_sd: 0.5, width_sd: 0.5, width_floor: 2 },
  elite_premium: { overall_threshold: v4Model.elite_premium.overall_threshold, k: v4Model.elite_premium.k },
  source: { simulation_sha: report.inputs.simulation.sha, season: sim.season_number, K: sim.K },
};
const tfUniform = { ...tfModel, profile: { ref_sd: 0, width_sd: 0, width_floor: 1e9 } };
report.level = {};
report.model = tfModel;

// ── R5: hele populationen ───────────────────────────────────────────────────
const snap = load("snapshot.json");
report.inputs.snapshot = { sha: sha("snapshot.json"), read_at: snap.read_at, season: snap.season_number, riders: snap.riders.length };
const abById = new Map(snap.abilities.map((a) => [a.rider_id, a]));
const teamById = new Map(snap.teams.map((t) => [t.id, t]));
const isHumanTeam = (t) => t && t.is_ai === false && !t.is_bank && !t.is_test_account && !t.is_frozen;
// Krone-niveau. Variant A = v4's omregning (scale × niveau-korrektion) lagt
// direkte på den nye simulerings NPV. Variant B = samme METODE som v4's scale
// blev fundet med (fitRiderValuationV4.js: median-match mod gældende værdi) —
// dvs. medianen holdes, relative priser flytter. Begge rapporteres; B bruges
// til den relative før/efter-analyse. Ingen sum kalibreres.
{
  const v4s = [], tfA = [];
  for (const r of snap.riders) {
    if (r.is_retired) continue;
    const ab = abById.get(r.id);
    const age = ageForSeason(r.birthdate, snap.season_number);
    if (!ab || !Number.isFinite(age)) continue;
    const abilities = Object.fromEntries(KEYS.map((k) => [k, ab[k]]));
    const rider = { primary_type: r.primary_type, valuation_type: r.valuation_type, potentiale: r.potentiale, age };
    const a = predictBaseValueV4(rider, abilities, v4Model);
    const b = predictBaseValueTypefree(rider, abilities, tfModel);
    if (a > 0 && b > 0) { v4s.push(a); tfA.push(b); }
  }
  const kB = median(v4s) / median(tfA);
  report.level = {
    variant_A_median_delta_vs_v4: median(tfA) / median(v4s) - 1,
    variant_A_total_ratio_vs_v4: sum(tfA) / sum(v4s),
    variant_B_scale_multiplier: kB,
    v4_function_mean_ln_residual_on_S3_sim: (() => {
      const r = sim.samples.filter((s) => s.e_prize > 0);
      return r.reduce((s, x) => s + (Math.log(x.e_prize) - v4Ln(x)), 0) / r.length;
    })(),
  };
  tfModel.scale = v4Model.scale * kB;
  tfModel.scale_method = "B: v4-metoden (median-match), ikke en sum";
  tfUniform.scale = tfModel.scale;
}
const pop = [];
for (const r of snap.riders) {
  if (r.is_retired) continue;
  const ab = abById.get(r.id);
  if (!ab) continue;
  const abilities = Object.fromEntries(KEYS.map((k) => [k, ab[k]]));
  const age = ageForSeason(r.birthdate, snap.season_number);
  if (!Number.isFinite(age)) continue;
  const rider = { primary_type: r.primary_type, valuation_type: r.valuation_type, potentiale: r.potentiale, age };
  const team = teamById.get(r.team_id);
  const row = {
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
    tf: predictBaseValueTypefree(rider, abilities, tfModel),
    tf_no_premium: predictBaseValueTypefree(rider, abilities, tfModel, { premium: false }),
    tf_uniform: predictBaseValueTypefree(rider, abilities, tfUniform),
    cpv_v4: currentProductionValue(rider, abilities, v4Model),
    cpv_tf: currentProductionValueTypefree(rider, abilities, tfModel),
    O_tf: effectiveOutput(abilities, P),
  };
  pop.push(row);
}
const valid = pop.filter((r) => r.v4 > 0 && r.tf > 0);
const delta = (r, k = "tf") => r[k] / r.v4 - 1;
const groupStats = (rows, key, k = "tf") => {
  const g = {};
  for (const r of rows) (g[key(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(g).sort().map(([gk, rs]) => [gk, {
    n: rs.length,
    median_delta: median(rs.map((r) => delta(r, k))),
    p10_delta: quantile(rs.map((r) => delta(r, k)), 0.1),
    p90_delta: quantile(rs.map((r) => delta(r, k)), 0.9),
    total_before: sum(rs.map((r) => r.v4)),
    total_after: sum(rs.map((r) => r[k])),
  }]));
};
const stored_vs_fresh_v4 = median(valid.filter((r) => r.stored > 0).map((r) => Math.abs(r.stored / r.v4 - 1)));
report.population = {
  n: valid.length,
  median_abs_stored_vs_fresh_v4: stored_vs_fresh_v4,
  overall: groupStats(valid, () => "alle"),
  by_owner: groupStats(valid, (r) => (r.human ? "menneskehold" : r.ai ? "AI-hold" : r.free ? "fri" : "andet")),
  by_primary_type: groupStats(valid, (r) => r.primary_type ?? "ukendt"),
  by_age: groupStats(valid, (r) => ageBand(r.age)),
  by_potentiale: groupStats(valid, (r) => String(Math.round(Number(r.potentiale) || 0))),
  variant_no_premium: groupStats(valid, () => "alle", "tf_no_premium"),
  variant_uniform_career: groupStats(valid, () => "alle", "tf_uniform"),
  variant_uniform_by_age: groupStats(valid, (r) => ageBand(r.age), "tf_uniform"),
  cpv: {
    median_delta: median(valid.filter((r) => r.cpv_v4 > 0 && r.cpv_tf > 0).map((r) => r.cpv_tf / r.cpv_v4 - 1)),
    by_primary_type: (() => {
      const g = {};
      for (const r of valid) if (r.cpv_v4 > 0 && r.cpv_tf > 0) (g[r.primary_type] ??= []).push(r.cpv_tf / r.cpv_v4 - 1);
      return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, median(v)]));
    })(),
  },
};

// Menneskehold: rytterværdi og kontanter HVER FOR SIG.
const teams = {};
for (const r of valid.filter((x) => x.human)) {
  const t = (teams[r.team_id] ??= { team: r.team, riders: 0, before: 0, after: 0, cash: teamById.get(r.team_id)?.balance ?? null });
  t.riders += 1; t.before += r.v4; t.after += r.tf;
}
const teamRows = Object.values(teams).map((t) => ({ ...t, delta: t.after / t.before - 1 })).sort((a, b) => a.delta - b.delta);
report.population.human_teams = {
  n: teamRows.length,
  median_team_delta: median(teamRows.map((t) => t.delta)),
  p10_team_delta: quantile(teamRows.map((t) => t.delta), 0.1),
  p90_team_delta: quantile(teamRows.map((t) => t.delta), 0.9),
  teams_losing_over_25pct: teamRows.filter((t) => t.delta < -0.25).length,
  teams_gaining_over_25pct: teamRows.filter((t) => t.delta > 0.25).length,
  total_rider_value_before: sum(teamRows.map((t) => t.before)),
  total_rider_value_after: sum(teamRows.map((t) => t.after)),
  total_cash_unchanged: sum(teamRows.map((t) => t.cash)),
  worst10: teamRows.slice(0, 10),
  best10: teamRows.slice(-10).reverse(),
};
const losers = valid.filter((r) => r.human && delta(r) < -0.5).sort((a, b) => delta(a) - delta(b));
report.population.loss_list = {
  human_riders_losing_over_half: losers.length,
  human_riders_total: valid.filter((r) => r.human).length,
  rows: losers.map((r) => ({ name: r.name, team: r.team, type: r.primary_type, age: r.age, overall: r.overall, potentiale: r.potentiale, v4: r.v4, tf: r.tf, delta: delta(r), terrain_use: terrainUse(r.abilities, P) })),
};
report.population.top20_gainers_human = valid.filter((r) => r.human).sort((a, b) => delta(b) - delta(a)).slice(0, 20)
  .map((r) => ({ name: r.name, team: r.team, type: r.primary_type, age: r.age, overall: r.overall, v4: r.v4, tf: r.tf, delta: delta(r) }));

// ── Scorecard: eksisterende regressionsgrænser (hver for sig) ────────────────
const gScale = scaleContinuityGate(valid.map((r) => r.v4), valid.map((r) => r.tf));
const gEliteOld = eliteUnbuyableGate(valid.map((r) => ({ overall: r.overall, v4Value: r.tf })), { ceiling: v4Model.elite_premium.affordability_ceiling });
const gEliteV4 = eliteUnbuyableGate(valid.map((r) => ({ overall: r.overall, v4Value: r.v4 })), { ceiling: v4Model.elite_premium.affordability_ceiling });
// Udvikl-og-sælg med den typefri fremskrivning (samme horisont som scorecardet: 4).
const prospects = valid.filter((r) => r.age <= 21 && Number(r.potentiale) >= 5);
const best = prospects.reduce((b, r) => (r.tf > (b?.tf ?? -Infinity) ? r : b), null);
let gDev = null;
if (best) {
  const sig = profileSignature(best.abilities, tfModel.profile);
  const caps = buildCapsTypefree(best.abilities, sig, best.potentiale);
  let ab = { ...best.abilities };
  for (let s = 0; s < 4; s++) ab = stepTypefree(ab, caps, sig, { potentiale: best.potentiale, age: best.age + s });
  const bvAt = predictBaseValueTypefree({ potentiale: best.potentiale, age: best.age + 4 }, ab, tfModel);
  gDev = developAndSellGate({ bvStart: best.tf, cpvStart: best.cpv_tf, bvAtHorizon: bvAt, seasons: 4 });
  const bestV4 = prospects.reduce((b, r) => (r.v4 > (b?.v4 ?? -Infinity) ? r : b), null);
  const proj = projectAbilitiesForward(bestV4.abilities, { primaryType: valuationTypeFor(bestV4, v4Model), potentiale: bestV4.potentiale, startAge: bestV4.age }, 4);
  const bvAtV4 = predictBaseValueV4({ primary_type: bestV4.primary_type, valuation_type: bestV4.valuation_type, potentiale: bestV4.potentiale, age: proj.ageAtHorizon }, proj.abilities, v4Model);
  report.gates.develop_and_sell_v4_reference = developAndSellGate({ bvStart: bestV4.v4, cpvStart: bestV4.cpv_v4, bvAtHorizon: bvAtV4, seasons: 4 });
}
// Omformuleret elite-gate (forslag): rangorden, intet beløb.
const eliteRank = (() => {
  const elite = valid.filter((r) => r.overall >= 55);
  const below = valid.filter((r) => r.overall >= 45 && r.overall < 55);
  const medBelow = median(below.map((r) => r.tf));
  const cheaper = elite.filter((r) => r.tf < medBelow).length;
  return { name: "Elite-rangorden: ingen overall≥55 under medianen af overall 45-54", hard: true, ok: elite.length > 0 && cheaper === 0, n_elite: elite.length, n_cheaper: cheaper };
})();
report.gates.regression_limits = {
  scale_continuity: gScale,
  elite_unbuyable_old_formulation_tf: gEliteOld,
  elite_unbuyable_old_formulation_v4: gEliteV4,
  develop_and_sell_tf: gDev,
  determinism: { name: "Determinisme", hard: true, ok: true, detail: `fit deterministisk (Nelder-Mead fast start); simulation sha ${report.inputs.simulation.sha}` },
};
report.gates.new_quality_measures = { elite_rank_proposed: eliteRank };

// ── Glathed: ét evnepoint ────────────────────────────────────────────────────
const smoothSample = valid.filter((r) => hashUnit(`sm:${r.id}`) < 0.12);
const jumps = { tf: [], v4: [] };
let worst = null;
for (const r of smoothSample) {
  const rider = { primary_type: r.primary_type, valuation_type: r.valuation_type, potentiale: r.potentiale, age: r.age };
  for (const k of KEYS) {
    if (r.abilities[k] >= 99) continue;
    const up = { ...r.abilities, [k]: r.abilities[k] + 1 };
    const tf = predictBaseValueTypefree(rider, up, tfModel) / r.tf - 1;
    const v4 = predictBaseValueV4(rider, up, v4Model) / r.v4 - 1;
    jumps.tf.push(tf); jumps.v4.push(v4);
    if (!worst || Math.abs(tf) > Math.abs(worst.rel)) worst = { rel: tf, ability: k, age: r.age, overall: r.overall };
  }
}
const js = (xs) => ({ n: xs.length, p50: quantile(xs.map(Math.abs), 0.5), p99: quantile(xs.map(Math.abs), 0.99), max: Math.max(...xs.map(Math.abs)), negative: xs.filter((x) => x < -1e-9).length });
report.smoothness = { tf: js(jumps.tf), v4_fixed_type: js(jumps.v4), worst_tf: worst };

// ── Typebyte-ækvivalens ──────────────────────────────────────────────────────
const swapSample = valid.filter((r) => hashUnit(`sw:${r.id}`) < 0.06);
let tfMismatch = 0, v4Differs = 0;
const v4Spread = [];
for (const r of swapSample) {
  const tfv = new Set(), v4v = [];
  for (const t of DISPLAY_RECIPE_KEYS) {
    const rider = { primary_type: t, valuation_type: t, potentiale: r.potentiale, age: r.age };
    tfv.add(predictBaseValueTypefree(rider, r.abilities, tfModel));
    v4v.push(predictBaseValueV4(rider, r.abilities, v4Model));
  }
  if (tfv.size !== 1) tfMismatch++;
  if (new Set(v4v).size > 1) v4Differs++;
  v4Spread.push(Math.max(...v4v) / Math.min(...v4v));
}
report.type_swap = { n: swapSample.length, tf_riders_with_any_difference: tfMismatch, v4_riders_with_any_difference: v4Differs, v4_median_max_over_min: median(v4Spread), v4_p90_max_over_min: quantile(v4Spread, 0.9) };

// ── R4: markedskomponent ─────────────────────────────────────────────────────
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
// Holdout: niveauet (lvl) er markedets samlede niveau vs. modellen og styres af
// #3449-korrektionen — det lægges på ALLE varianter, så sammenligningen måler
// RELATIVE priser, som er det markedskomponenten må flytte.
const variants = {
  v4_base: (o) => o.base_v4 * Math.exp(lvlV4),
  tf_base: (o) => o.base * Math.exp(lvl),
  tf_common: (o) => o.base * Math.exp(lvl + common.predict(o)),
  tf_common_local: (o) => o.base * Math.exp(lvl + common.predict(o) + local.predict(o)),
};
const testV4 = test.filter((o) => o.base_v4 > 0);
const holdout = {};
for (const [k, f] of Object.entries(variants)) {
  const rows = k === "v4_base" ? testV4 : test;
  holdout[k] = { n: rows.length, median_ape: mape(rows, f), mean_abs_log_error: mael(rows, f) };
}
// Robusthed: holdout på ALLE handler efter fit-datoen der består de øvrige
// filtre, også dem prisafvigelses-filteret ellers smider ud (ellers måles kun
// handler der i forvejen ligger tæt på modellen).
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
// Fælles/lokal indflydelse på populationen, pr. gruppe (w = 1, intet loft).
const influence = {};
for (const r of valid) {
  const x = { abilities: r.abilities, age: r.age, O: r.O_tf };
  const c = common.predict(x), l = local.predict(x), ev = local.evidence(x);
  const g = (influence[ageBand(r.age)] ??= { n: 0, c: [], l: [], ev: [] });
  g.n++; g.c.push(c); g.l.push(l); g.ev.push(ev);
}
const influenceOut = Object.fromEntries(Object.entries(influence).sort().map(([k, g]) => [k, {
  n: g.n,
  median_abs_common: median(g.c.map(Math.abs)),
  median_abs_local: median(g.l.map(Math.abs)),
  share_evidence_over_half: g.ev.filter((e) => e > 0.5).length / g.n,
  median_evidence: median(g.ev),
}]));
const oBand = (o) => (o < 30 ? "O<30" : o < 45 ? "O30-45" : o < 60 ? "O45-60" : "O60+");
const influenceO = {};
for (const r of valid) {
  const x = { abilities: r.abilities, age: r.age, O: r.O_tf };
  (influenceO[oBand(r.O_tf)] ??= []).push({ c: common.predict(x), l: local.predict(x), ev: local.evidence(x) });
}
// Glathed for markedsleddet: +1 evnepoint.
const mJumps = [];
for (const r of smoothSample.slice(0, 300)) {
  const x = { abilities: r.abilities, age: r.age, O: r.O_tf };
  const base = common.predict(x) + local.predict(x);
  for (const k of KEYS) {
    const up = { ...r.abilities, [k]: r.abilities[k] + 1 };
    const xu = { abilities: up, age: r.age, O: effectiveOutput(up, P) };
    mJumps.push(Math.exp(common.predict(xu) + local.predict(xu) - base) - 1);
  }
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
  influence_by_age: influenceOut,
  influence_by_output: Object.fromEntries(Object.entries(influenceO).sort().map(([k, g]) => [k, {
    n: g.length, median_abs_common: median(g.map((x) => Math.abs(x.c))), median_abs_local: median(g.map((x) => Math.abs(x.l))), median_evidence: median(g.map((x) => x.ev)),
  }])),
  smoothness_plus_one: js(mJumps),
};

writeFileSync(join(OUT, "typefree5497-report.json"), JSON.stringify(report, (k, v) => (k === "abilities" ? undefined : v), 2));
writeFileSync(join(OUT, "typefree5497-model-proposal.json"), JSON.stringify(tfModel, null, 2));
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
console.log(JSON.stringify({
  r2: report.r2,
  population_median_delta: pct(report.population.overall.alle.median_delta),
  scale_gate: gScale.ok,
  elite_old: gEliteOld.ok,
  elite_rank: eliteRank.ok,
  develop_sell: gDev?.ok,
  type_swap: report.type_swap,
  smoothness: report.smoothness,
  human_losers_over_half: losers.length,
  level: report.level,
  market: { funnel, n_train: train.length, n_test: test.length, holdout, holdoutWide, sel, weightGrid },
  by_type: Object.fromEntries(Object.entries(report.population.by_primary_type).map(([k, v]) => [k, pct(v.median_delta)])),
  by_age: Object.fromEntries(Object.entries(report.population.by_age).map(([k, v]) => [k, pct(v.median_delta)])),
  by_owner: Object.fromEntries(Object.entries(report.population.by_owner).map(([k, v]) => [k, [pct(v.median_delta), v.total_after / v.total_before]])),
  uniform: [pct(report.population.variant_uniform_career.alle.median_delta), Object.fromEntries(Object.entries(report.population.variant_uniform_by_age).map(([k, v]) => [k, pct(v.median_delta)]))],
  no_premium: pct(report.population.variant_no_premium.alle.median_delta),
  teams: { ...report.population.human_teams, worst10: undefined, best10: undefined },
  dev: gDev, devV4: report.gates.develop_and_sell_v4_reference, eliteOld: gEliteOld.detail, eliteV4: gEliteV4.detail, eliteRank,
  r2total: report.population.overall,
}, null, 2));
