#!/usr/bin/env node
// #3448 · Niveau-anker-scenarier (READ-ONLY). Løser a_floor_shift for et ønsket
// endepunkts-niveau og scorer hvert scenarie på uge-1-effekt, endepunkt,
// fordeling, hold-spredning og kontant/trup-forhold.
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config({ path: "C:/Dev/CyclingZone/backend/.env" });

import { meanAbilityScore, predictMarketPrice, computeSupport, blendTarget, applyWeeklyCap } from "../lib/marketValueModel.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { RIDER_BASE_VALUE_FALLBACK } from "../lib/marketUtils.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../lib/riderTypes.js";

const MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "marketValueModelV1.json");
const OUT = "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/e7ee93d4-a9b7-440a-8c2a-bd528b529254/scratchpad/anchor-scenarios.json";
const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
const WEIGHT = 0.5, CAP = 0.25, SEASON = 2;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n == null ? "-" : Math.round(n).toLocaleString("da-DK");
const pct = (n) => (n * 100).toFixed(1).replace(".", ",") + " %";

// ── data ──
const teams = await fetchAllRows(() => sb.from("teams").select("id, division, is_ai, is_test_account, is_frozen, is_bank, balance").order("id"));
const realIds = new Set(teams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id));
const tmeta = new Map(teams.map((t) => [t.id, t]));
const humanCash = sum(teams.filter((t) => !t.is_ai && realIds.has(t.id)).map((t) => Number(t.balance) || 0));

const riders = await fetchAllRows(() => sb.from("riders")
  .select("id, firstname, lastname, team_id, birthdate, popularity, potentiale, primary_type, is_retired, is_academy, base_value").order("id"));
const pop = riders.filter((r) => r.team_id != null && realIds.has(r.team_id) && !r.is_retired && !r.is_academy);
const abRows = await fetchAllRowsChunkedIn(pop.map((r) => r.id), (c) => sb
  .from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).in("rider_id", c).order("rider_id"));
const abById = new Map(abRows.map((r) => [r.rider_id, r]));

const auctions = await fetchAllRows(() => sb.from("auctions").select("rider_id, is_guaranteed_sale")
  .eq("status", "completed").not("current_bidder_id", "is", null).gt("current_price", 0).order("id"));
const offers = await fetchAllRows(() => sb.from("transfer_offers").select("rider_id")
  .eq("status", "accepted").not("rider_id", "is", null).order("id"));
const saleIds = new Set([...auctions.filter((a) => !a.is_guaranteed_sale).map((a) => a.rider_id), ...offers.map((o) => o.rider_id)].filter(Boolean));
const saleRiders = await fetchAllRowsChunkedIn([...saleIds], (c) => sb.from("riders").select("id, birthdate, primary_type").in("id", c).order("id"));
const saleAb = await fetchAllRowsChunkedIn([...saleIds], (c) => sb.from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).in("rider_id", c).order("rider_id"));
const saleAbById = new Map(saleAb.map((r) => [r.rider_id, r]));
const salesIndex = [];
for (const r of saleRiders) {
  const ab = saleAbById.get(r.id); if (!ab || !r.birthdate || !r.primary_type) continue;
  const O = meanAbilityScore(ab), age = ageForSeason(r.birthdate, SEASON);
  if (O == null || age == null) continue;
  salesIndex.push({ O, age, primary_type: r.primary_type });
}
const g = model.guard || {};
const gopt = { oWindow: g.O_window ?? 5, ageWindow: g.age_window ?? 3, K: g.K };

// ── basis pr. rytter (uanker) ──
const base = [];
for (const r of pop) {
  const ab = abById.get(r.id); if (!ab || !r.birthdate || !r.primary_type) continue;
  const O = meanAbilityScore(ab), age = ageForSeason(r.birthdate, SEASON);
  if (O == null || age == null) continue;
  const current = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
  const pred0 = predictMarketPrice({ O, age, potentiale: Number(r.potentiale) || 0, popularity: Number(r.popularity) || 0, is_youth: false, primary_type: r.primary_type }, model.coefficients);
  const support = computeSupport({ O, age, primary_type: r.primary_type }, salesIndex, gopt);
  const t = tmeta.get(r.team_id) || {};
  base.push({ id: r.id, name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(), current, pred0, support,
    is_ai: !!t.is_ai, division: t.division, team_id: r.team_id });
}
const totalNow = sum(base.map((r) => r.current));
const frozenSum = sum(base.filter((r) => r.support === 0).map((r) => r.current));
const activePredSum = sum(base.filter((r) => r.support > 0).map((r) => r.pred0));
console.log(`Population ${base.length} · nu ${fmt(totalNow)} · frosne (support=0) ${fmt(frozenSum)} · aktiv pred-sum ${fmt(activePredSum)}`);
console.log(`Menneskehold kontant: ${fmt(humanCash)}\n`);

function scenario(label, shift) {
  const F = Math.exp(shift);
  const rows = base.map((r) => {
    const pred = r.pred0 * F;
    const target = blendTarget(r.current, pred, WEIGHT, r.support);
    const next = Math.max(1, Math.round(applyWeeklyCap(r.current, target, CAP)));
    return { ...r, pred, next, endpoint: r.support > 0 ? pred : r.current,
      capBound: Math.abs(target - r.current) > CAP * r.current + 0.5 };
  });
  const w1 = sum(rows.map((r) => r.next));
  const ep = sum(rows.map((r) => r.endpoint));
  const humans = rows.filter((r) => !r.is_ai);
  const epHuman = sum(humans.map((r) => r.endpoint));
  const byTeam = new Map();
  for (const r of humans) {
    const t = byTeam.get(r.team_id) || { cur: 0, end: 0 };
    t.cur += r.current; t.end += r.endpoint; byTeam.set(r.team_id, t);
  }
  const teamPcts = [...byTeam.values()].map((t) => (t.end - t.cur) / t.cur);
  const weeks = rows.filter((r) => r.support > 0).map((r) => {
    let c = r.current, w = 0;
    while (w < 60) {
      const nc = Math.max(1, Math.round(applyWeeklyCap(c, blendTarget(c, r.pred, WEIGHT, r.support), CAP)));
      if (Math.abs(nc - c) <= Math.max(1, c * 0.001)) break;
      c = nc; w += 1;
    }
    return w;
  });
  const epVals = rows.map((r) => r.endpoint);
  return {
    label, shift, factor: F,
    week1Total: w1, week1Pct: (w1 - totalNow) / totalNow,
    endpointTotal: ep, endpointPct: (ep - totalNow) / totalNow,
    endpointHuman: epHuman, cashOverSquad: humanCash / epHuman,
    epMedian: q(epVals, .5), epP90: q(epVals, .9), epMax: Math.max(...epVals),
    capBound: rows.filter((r) => r.capBound).length,
    up: rows.filter((r) => r.next > r.current).length,
    down: rows.filter((r) => r.next < r.current).length,
    teamMedian: q(teamPcts, .5), teamP10: q(teamPcts, .1), teamP90: q(teamPcts, .9),
    teamWorst: Math.min(...teamPcts), teamBest: Math.max(...teamPcts),
    weeksMedian: q(weeks, .5), weeksP90: q(weeks, .9),
    topEndpoint: [...rows].sort((a, b) => b.endpoint - a.endpoint).slice(0, 3).map((r) => ({ name: r.name, current: r.current, endpoint: Math.round(r.endpoint) })),
  };
}

// Løs shift for et ønsket endepunkts-niveau (som andel af nuværende total)
function shiftForTargetTotal(targetPct) {
  const T = totalNow * (1 + targetPct);
  const F = (T - frozenSum) / activePredSum;
  if (F <= 0) throw new Error("uopnåeligt mål: frosne ryttere alene overstiger målet");
  return Math.log(F);
}

// Alternativt anker-kriterium: gør MEDIAN-HOLDETS trupværdi uændret. Mere
// ærligt for spilleroplevelsen end en aggregeret sum — halvdelen op, halvdelen
// ned. Binær søgning fordi median-hold-effekten er monoton i shift.
function shiftForNeutralMedianTeam() {
  const f = (shift) => scenario("probe", shift).teamMedian;
  let lo = -2, hi = 3;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const scenarios = [
  scenario("S0 — som planlagt (intet anker)", 0),
  scenario("SM — median-holdet uændret", shiftForNeutralMedianTeam()),
  scenario("S½ — endepunkt −50 %", shiftForTargetTotal(-0.50)),
  scenario("S1 — endepunkt −40 %", shiftForTargetTotal(-0.40)),
  scenario("S2 — endepunkt −30 %", shiftForTargetTotal(-0.30)),
  scenario("S3 — endepunkt −20 %", shiftForTargetTotal(-0.20)),
  scenario("S4 — endepunkt uændret", shiftForTargetTotal(0)),
];

for (const s of scenarios) {
  console.log(`\n══ ${s.label} ══  a_floor_shift = ${s.shift.toFixed(4)}  (×${s.factor.toFixed(2)} på hver pris)`);
  console.log(`  Uge 1:      ${fmt(s.week1Total)}  (${pct(s.week1Pct)})   ${s.up} op / ${s.down} ned · ${s.capBound} på loftet`);
  console.log(`  Endepunkt:  ${fmt(s.endpointTotal)}  (${pct(s.endpointPct)})   median ${fmt(s.epMedian)} · P90 ${fmt(s.epP90)} · max ${fmt(s.epMax)}`);
  console.log(`  Kontant/trup ved endepunkt: ${s.cashOverSquad.toFixed(2)}×   (i dag 0,51×)`);
  console.log(`  Hold: median ${pct(s.teamMedian)} · P10 ${pct(s.teamP10)} · P90 ${pct(s.teamP90)} · værste ${pct(s.teamWorst)} · bedste ${pct(s.teamBest)}`);
  console.log(`  Søndage til konvergens: median ${s.weeksMedian} · P90 ${s.weeksP90}`);
  console.log(`  Dyreste ved endepunkt: ${s.topEndpoint.map((t) => `${t.name} ${fmt(t.current)}→${fmt(t.endpoint)}`).join(" · ")}`);
}

writeFileSync(OUT, JSON.stringify({ totalNow, frozenSum, activePredSum, humanCash, scenarios }, null, 2));
console.log(`\nSkrevet: ${OUT}`);
process.exit(0);
