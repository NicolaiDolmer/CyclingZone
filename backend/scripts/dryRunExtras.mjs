#!/usr/bin/env node
// Supplerende læsninger til beslutningsarket (READ-ONLY).
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config({ path: "C:/Dev/CyclingZone/backend/.env" });

import { meanAbilityScore, predictMarketPrice, computeSupport } from "../lib/marketValueModel.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { RIDER_BASE_VALUE_FALLBACK } from "../lib/marketUtils.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../lib/riderTypes.js";

const MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "marketValueModelV1.json");
const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const SEASON = 2;
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n == null ? "-" : Math.round(n).toLocaleString("da-DK");

// --- faktiske handelspriser (kontekst for modellens MAPE) ---
const auctions = await fetchAllRows(() => sb.from("auctions")
  .select("rider_id, current_price, is_guaranteed_sale").eq("status", "completed")
  .not("current_bidder_id", "is", null).gt("current_price", 0).order("id"));
const offers = await fetchAllRows(() => sb.from("transfer_offers")
  .select("rider_id, offer_amount, counter_amount").eq("status", "accepted").not("rider_id", "is", null).order("id"));
const prices = [...auctions.filter((a) => !a.is_guaranteed_sale).map((a) => Number(a.current_price)),
                ...offers.map((o) => Number(o.counter_amount ?? o.offer_amount)).filter((n) => n > 0)];
console.log(`FAKTISKE HANDLER: n=${prices.length}  median=${fmt(q(prices, .5))}  p25=${fmt(q(prices, .25))}  p75=${fmt(q(prices, .75))}  p90=${fmt(q(prices, .9))}  max=${fmt(Math.max(...prices))}  sum=${fmt(sum(prices))}`);

// --- population + endpoint ---
const teams = await fetchAllRows(() => sb.from("teams").select("id, division, is_ai, is_test_account, is_frozen, is_bank").order("id"));
const realIds = new Set(teams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id));
const meta = new Map(teams.map((t) => [t.id, t]));
const riders = await fetchAllRows(() => sb.from("riders")
  .select("id, team_id, birthdate, popularity, potentiale, primary_type, is_retired, is_academy, base_value").order("id"));
const pop = riders.filter((r) => r.team_id != null && realIds.has(r.team_id) && !r.is_retired && !r.is_academy);
const abRows = await fetchAllRowsChunkedIn(pop.map((r) => r.id), (c) => sb
  .from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).in("rider_id", c).order("rider_id"));
const abById = new Map(abRows.map((r) => [r.rider_id, r]));

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

const rows = [];
for (const r of pop) {
  const ab = abById.get(r.id); if (!ab || !r.birthdate || !r.primary_type) continue;
  const O = meanAbilityScore(ab), age = ageForSeason(r.birthdate, SEASON);
  if (O == null || age == null) continue;
  const current = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
  const pred = predictMarketPrice({ O, age, potentiale: Number(r.potentiale) || 0, popularity: Number(r.popularity) || 0, is_youth: false, primary_type: r.primary_type }, model.coefficients);
  const support = computeSupport({ O, age, primary_type: r.primary_type }, salesIndex, gopt);
  const t = meta.get(r.team_id) || {};
  rows.push({ current, pred, support, endpoint: support > 0 ? pred : current, is_ai: !!t.is_ai, division: t.division, team_id: r.team_id });
}

const S = (f) => sum(rows.map(f));
console.log(`\nENDEPUNKT (fuld konvergens, uændret marked):`);
console.log(`  Nu:        ${fmt(S((r) => r.current))}`);
console.log(`  Endepunkt: ${fmt(S((r) => r.endpoint))}   (${(((S((r) => r.endpoint) / S((r) => r.current)) - 1) * 100).toFixed(1)} %)`);
for (const [label, filt] of [["Mennesker", (r) => !r.is_ai], ["AI", (r) => r.is_ai]]) {
  const sub = rows.filter(filt);
  console.log(`  ${label.padEnd(10)} n=${String(sub.length).padStart(5)}  nu=${fmt(sum(sub.map((r) => r.current))).padStart(12)}  endepunkt=${fmt(sum(sub.map((r) => r.endpoint))).padStart(12)}  (${(((sum(sub.map((r) => r.endpoint)) / sum(sub.map((r) => r.current))) - 1) * 100).toFixed(1)} %)`);
}

console.log(`\nPR. DIVISION (kun menneskehold):`);
const humans = rows.filter((r) => !r.is_ai);
for (const d of [...new Set(humans.map((r) => r.division))].sort()) {
  const sub = humans.filter((r) => r.division === d);
  console.log(`  Div ${d}: n=${String(sub.length).padStart(4)}  nu=${fmt(sum(sub.map((r) => r.current))).padStart(12)}  endepunkt=${fmt(sum(sub.map((r) => r.endpoint))).padStart(11)}  (${(((sum(sub.map((r) => r.endpoint)) / sum(sub.map((r) => r.current))) - 1) * 100).toFixed(1)} %)`);
}

console.log(`\nPR. HOLD (menneskehold, uge-1-effekt vs endepunkt) — værste 10:`);
const byTeam = new Map();
for (const r of humans) {
  const t = byTeam.get(r.team_id) || { cur: 0, end: 0, n: 0, div: r.division };
  t.cur += r.current; t.end += r.endpoint; t.n += 1; byTeam.set(r.team_id, t);
}
const teamRows = [...byTeam.entries()].map(([id, t]) => ({ id, ...t, pct: (t.end - t.cur) / t.cur }));
teamRows.sort((a, b) => a.pct - b.pct);
for (const t of teamRows.slice(0, 10)) console.log(`  hold ${String(t.id).padStart(4)} div${t.div} n=${t.n}  ${fmt(t.cur).padStart(11)} → ${fmt(t.end).padStart(10)}  (${(t.pct * 100).toFixed(1)} %)`);
console.log(`  ... bedste 3:`);
for (const t of teamRows.slice(-3)) console.log(`  hold ${String(t.id).padStart(4)} div${t.div} n=${t.n}  ${fmt(t.cur).padStart(11)} → ${fmt(t.end).padStart(10)}  (${(t.pct * 100).toFixed(1)} %)`);
const cu = rows.map((r) => r.current), ep = rows.map((r) => r.endpoint);
console.log(`\nFORDELING nu vs endepunkt:`);
for (const [lbl, a] of [["nu", cu], ["endepunkt", ep]]) {
  console.log(`  ${lbl.padEnd(10)} p10=${fmt(q(a, .1))}  p50=${fmt(q(a, .5))}  p90=${fmt(q(a, .9))}  p99=${fmt(q(a, .99))}  max=${fmt(Math.max(...a))}  P99/P50=${(q(a, .99) / q(a, .5)).toFixed(1)}x`);
}
console.log(`\n  Median hold-effekt: ${((q(teamRows.map((t) => t.pct), .5)) * 100).toFixed(1)} %   spredning P10..P90: ${((q(teamRows.map((t) => t.pct), .1)) * 100).toFixed(1)} % .. ${((q(teamRows.map((t) => t.pct), .9)) * 100).toFixed(1)} %`);
process.exit(0);
