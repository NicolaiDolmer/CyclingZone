#!/usr/bin/env node
// DRY-RUN (READ-ONLY) af søndags-sweepen fra #3448/PR #3449.
//
// Kører den ÆGTE runMarketValueSundaySweep mod prod-populationen, men med en
// supabase-proxy der opsnapper enhver riders.update og gemmer den i stedet for
// at skrive. Ingen writes, ingen migrationer, ingen app_config-ændringer.
// Producerer et scorecard: fordeling før/efter, outliers, loft-effekt.
//
//   node scripts/dryRunMarketValueSweep.mjs [globalWeight] [weeklyCap]

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: "C:/Dev/CyclingZone/backend/.env" });

import { runMarketValueSundaySweep } from "../lib/marketValueSundaySweep.js";
import { meanAbilityScore, predictMarketPrice, computeSupport, blendTarget, applyWeeklyCap } from "../lib/marketValueModel.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { RIDER_BASE_VALUE_FALLBACK } from "../lib/marketUtils.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../lib/riderTypes.js";

const OUT_JSON = "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/e7ee93d4-a9b7-440a-8c2a-bd528b529254/scratchpad/market-value-dryrun.json";

const GLOBAL_WEIGHT = Number(process.argv[2] ?? 0.5);
const WEEKLY_CAP = Number(process.argv[3] ?? 0.25);
const SUNDAY = new Date("2026-08-09T10:00:00+02:00");
const MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "marketValueModelV1.json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const real = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ── READ-ONLY-proxy: riders.update() opsnappes, alt andet passerer igennem ──
const captured = [];
let blockedWrites = 0;
const dryRun = {
  from(table) {
    const builder = real.from(table);
    return new Proxy(builder, {
      get(target, prop) {
        if (prop === "update" || prop === "insert" || prop === "upsert" || prop === "delete") {
          return (payload) => {
            blockedWrites += 1;
            const rec = { table, payload };
            return {
              eq: (_col, val) => {
                captured.push({ id: val, ...payload });
                return Promise.resolve({ data: null, error: null });
              },
              then: (res) => res({ data: null, error: null, dryRun: rec }),
            };
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  },
};

// ── Instrumentering: fang population + model så vi kan bygge scorecardet ──
let capturedPopulation = null;
let capturedModel = null;

async function fetchPopulationInstrumented({ supabase }) {
  const allTeams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_ai, is_test_account, is_frozen, is_bank").order("id"));
  const realTeamIds = new Set(
    allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id)
  );
  const teamMeta = new Map(allTeams.map((t) => [t.id, { division: t.division, is_ai: t.is_ai }]));
  const allRiders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, firstname, lastname, team_id, birthdate, popularity, potentiale, primary_type, is_retired, is_academy, base_value")
    .order("id"));
  const pop = allRiders.filter((r) =>
    r.team_id != null && realTeamIds.has(r.team_id) && !r.is_retired && !r.is_academy
  );
  capturedPopulation = { pop, teamMeta };
  return pop;
}

const sweepResult = await runMarketValueSundaySweep({
  supabase: dryRun,
  now: SUNDAY,
  isEnabled: async () => true,
  readGlobalWeight: async () => GLOBAL_WEIGHT,
  readWeeklyCap: async () => WEEKLY_CAP,
  loadModel: () => {
    const m = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
    capturedModel = m;
    return m;
  },
  fetchPopulation: fetchPopulationInstrumented,
  hasAlreadyRunToday: async () => ({ alreadyRun: false, tableMissing: false }),
  logSweepRun: async () => {},
  log: (m) => console.log("  [sweep] " + m),
});

console.log("\nSweep-resultat (dry-run):", JSON.stringify(sweepResult, null, 2));
console.log(`Opsnappede writes: ${captured.length} (blokerede write-kald: ${blockedWrites})`);

// ── Genberegn pr. rytter for scorecardet (samme rene funktioner som sweepen) ──
const seasonNumber = sweepResult.seasonNumber;
const model = capturedModel;
const { pop, teamMeta } = capturedPopulation;

const abilityRows = await fetchAllRowsChunkedIn(pop.map((r) => r.id), (chunk) => real
  .from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).in("rider_id", chunk).order("rider_id"));
const abilitiesById = new Map(abilityRows.map((r) => [r.rider_id, r]));

// SalesIndex (samme definition som sweepen)
const auctionRows = await fetchAllRows(() => real
  .from("auctions").select("rider_id, is_guaranteed_sale").eq("status", "completed")
  .not("current_bidder_id", "is", null).gt("current_price", 0).order("id"));
const transferRows = await fetchAllRows(() => real
  .from("transfer_offers").select("rider_id").eq("status", "accepted").not("rider_id", "is", null).order("id"));
const saleIds = new Set();
for (const a of auctionRows) if (a.rider_id && !a.is_guaranteed_sale) saleIds.add(a.rider_id);
for (const t of transferRows) if (t.rider_id) saleIds.add(t.rider_id);
const saleRiders = await fetchAllRowsChunkedIn([...saleIds], (chunk) => real
  .from("riders").select("id, birthdate, primary_type").in("id", chunk).order("id"));
const saleAbilities = await fetchAllRowsChunkedIn([...saleIds], (chunk) => real
  .from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).in("rider_id", chunk).order("rider_id"));
const saleAbById = new Map(saleAbilities.map((r) => [r.rider_id, r]));
const salesIndex = [];
for (const r of saleRiders) {
  const ab = saleAbById.get(r.id);
  if (!r.birthdate || !r.primary_type || !ab) continue;
  const O = meanAbilityScore(ab);
  const age = ageForSeason(r.birthdate, seasonNumber);
  if (O == null || age == null) continue;
  salesIndex.push({ O, age, primary_type: r.primary_type });
}

const guard = model.guard || {};
const guardOpts = { oWindow: guard.O_window ?? 5, ageWindow: guard.age_window ?? 3, K: guard.K };

const rows = [];
for (const r of pop) {
  const ab = abilitiesById.get(r.id);
  if (!ab || !r.birthdate || !r.primary_type) continue;
  const O = meanAbilityScore(ab);
  const age = ageForSeason(r.birthdate, seasonNumber);
  if (O == null || age == null) continue;
  const current = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
  const marketPred = predictMarketPrice(
    { O, age, potentiale: Number(r.potentiale) || 0, popularity: Number(r.popularity) || 0, is_youth: false, primary_type: r.primary_type },
    model.coefficients
  );
  const support = computeSupport({ O, age, primary_type: r.primary_type }, salesIndex, guardOpts);
  const target = blendTarget(current, marketPred, GLOBAL_WEIGHT, support);
  const capped = applyWeeklyCap(current, target, WEEKLY_CAP);
  const next = Math.max(1, Math.round(capped));
  const meta = teamMeta.get(r.team_id) || {};
  rows.push({
    id: r.id, name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(), type: r.primary_type, age, O: Math.round(O * 10) / 10,
    division: meta.division ?? null, is_ai: !!meta.is_ai,
    current, marketPred: Math.round(marketPred), support, target: Math.round(target),
    next, delta: next - current, pct: current > 0 ? (next - current) / current : 0,
    capBound: Math.abs(target - current) > WEEKLY_CAP * current + 0.5,
    uncappedPct: current > 0 ? (target - current) / current : 0,
  });
}

// Kryds-tjek mod sweepens egne opsnappede writes
const myChanged = rows.filter((x) => x.next !== x.current);
const capturedMap = new Map(captured.map((c) => [c.id, c.base_value]));
let mismatch = 0;
for (const x of myChanged) if (capturedMap.get(x.id) !== x.next) mismatch += 1;
console.log(`Kryds-tjek: sweep skrev ${captured.length}, scorecard beregner ${myChanged.length} ændringer, ${mismatch} afvigelser.`);

const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

const cur = rows.map((r) => r.current);
const nxt = rows.map((r) => r.next);
const report = {
  meta: { runAt: new Date().toISOString(), globalWeight: GLOBAL_WEIGHT, weeklyCap: WEEKLY_CAP, seasonNumber,
    modelVersion: model.version, K: guardOpts.K, salesIndexSize: salesIndex.length,
    sweepResult, capturedWrites: captured.length, crossCheckMismatch: mismatch },
  population: { scanned: rows.length, changed: myChanged.length, unchanged: rows.length - myChanged.length,
    ai: rows.filter((r) => r.is_ai).length, human: rows.filter((r) => !r.is_ai).length },
  totals: { sumBefore: sum(cur), sumAfter: sum(nxt), pctChange: (sum(nxt) - sum(cur)) / sum(cur) },
  distribution: {
    before: { min: Math.min(...cur), p10: q(cur, .1), p25: q(cur, .25), median: q(cur, .5), p75: q(cur, .75), p90: q(cur, .9), p99: q(cur, .99), max: Math.max(...cur), mean: sum(cur) / cur.length },
    after: { min: Math.min(...nxt), p10: q(nxt, .1), p25: q(nxt, .25), median: q(nxt, .5), p75: q(nxt, .75), p90: q(nxt, .9), p99: q(nxt, .99), max: Math.max(...nxt), mean: sum(nxt) / nxt.length },
  },
  direction: {
    up: myChanged.filter((r) => r.delta > 0).length,
    down: myChanged.filter((r) => r.delta < 0).length,
    frozenZeroSupport: rows.filter((r) => r.support === 0).length,
    fullSupport: rows.filter((r) => r.support >= 1).length,
    medianSupport: q(rows.map((r) => r.support), .5),
  },
  cap: {
    capBound: rows.filter((r) => r.capBound).length,
    capBoundUp: rows.filter((r) => r.capBound && r.uncappedPct > 0).length,
    capBoundDown: rows.filter((r) => r.capBound && r.uncappedPct < 0).length,
    sumUncappedMove: sum(rows.map((r) => Math.abs(r.target - r.current))),
    sumCappedMove: sum(rows.map((r) => Math.abs(r.next - r.current))),
    worstUncappedPct: q(rows.map((r) => r.uncappedPct), 0.01),
    biggestUncappedDrop: [...rows].sort((a, b) => a.uncappedPct - b.uncappedPct).slice(0, 5)
      .map((r) => ({ name: r.name, type: r.type, age: r.age, current: r.current, marketPred: r.marketPred, support: r.support, uncappedPct: r.uncappedPct, cappedPct: r.pct })),
    weeksToConvergeMedian: null,
  },
  valueBands: (() => {
    const bands = [[0, 50e3], [50e3, 150e3], [150e3, 400e3], [400e3, 1e6], [1e6, 1.7e6], [1.7e6, 5e6], [5e6, Infinity]];
    return bands.map(([lo, hi]) => {
      const inBand = rows.filter((r) => r.current >= lo && r.current < hi);
      return { band: `${lo / 1000}k-${hi === Infinity ? "∞" : hi / 1000 + "k"}`, n: inBand.length,
        medianPct: q(inBand.map((r) => r.pct), .5), medianSupport: q(inBand.map((r) => r.support), .5),
        down: inBand.filter((r) => r.delta < 0).length, up: inBand.filter((r) => r.delta > 0).length,
        sumBefore: sum(inBand.map((r) => r.current)), sumAfter: sum(inBand.map((r) => r.next)) };
    });
  })(),
  topMoversDown: [...myChanged].sort((a, b) => a.delta - b.delta).slice(0, 15)
    .map((r) => ({ name: r.name, type: r.type, age: r.age, O: r.O, div: r.division, ai: r.is_ai, current: r.current, marketPred: r.marketPred, support: Math.round(r.support * 100) / 100, next: r.next, delta: r.delta, pct: r.pct, uncappedPct: r.uncappedPct })),
  topMoversUp: [...myChanged].sort((a, b) => b.delta - a.delta).slice(0, 15)
    .map((r) => ({ name: r.name, type: r.type, age: r.age, O: r.O, div: r.division, ai: r.is_ai, current: r.current, marketPred: r.marketPred, support: Math.round(r.support * 100) / 100, next: r.next, delta: r.delta, pct: r.pct, uncappedPct: r.uncappedPct })),
  eliteSegment: (() => {
    const elite = rows.filter((r) => r.current >= 1_700_000);
    return { n: elite.length, zeroSupport: elite.filter((r) => r.support === 0).length,
      medianPct: q(elite.map((r) => r.pct), .5), sumBefore: sum(elite.map((r) => r.current)), sumAfter: sum(elite.map((r) => r.next)) };
  })(),
};

// Konvergens: hvor mange uger med ±25 % loft før target nås (uændret marked)
const weeksNeeded = rows.filter((r) => r.support > 0 && r.current > 0).map((r) => {
  let c = r.current, w = 0;
  while (w < 52) {
    const t = blendTarget(c, r.marketPred, GLOBAL_WEIGHT, r.support);
    const nc = Math.max(1, Math.round(applyWeeklyCap(c, t, WEEKLY_CAP)));
    if (Math.abs(nc - c) <= Math.max(1, c * 0.001)) break;
    c = nc; w += 1;
  }
  return w;
});
report.cap.weeksToConvergeMedian = q(weeksNeeded, .5);
report.cap.weeksToConvergeP90 = q(weeksNeeded, .9);

writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
console.log("\nRapport skrevet: " + OUT_JSON);
console.log(JSON.stringify({ meta: report.meta, population: report.population, totals: report.totals, direction: report.direction, cap: { ...report.cap, biggestUncappedDrop: undefined } }, null, 2));
process.exit(0);
