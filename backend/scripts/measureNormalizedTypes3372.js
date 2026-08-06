#!/usr/bin/env node
// READ-ONLY måling (ejer-spørgsmål 6/8): hvordan ville forslag A (normaliserede
// type-skalaer) se ud på den ÆGTE population?
//
// Normalisering: pr. type transformeres rytterens kontrafaktiske loft-score til
// hans PERCENTIL blandt alle ryttere i samme rolle (0-99). Dermed betyder "80"
// det samme i alle otte roller: "bedre potentiale i rollen end 80 % af feltet".
//
// Målt output: (1) argmax-fordeling under normaliseret skala (kollapser den
// stadig?), (2) andel hvor tildelt primærtype = normaliseret bedste rolle,
// (3) specialiserings-dybde (bedste minus næstbedste percentil — er rytterne
// reelt differentierede, eller er populationen "mudret"= generator-problem?).
//
//   node scripts/measureNormalizedTypes3372.js [output.json]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { ratingFromAbilities } from "../lib/scoutingReport.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DEFAULT_OUT =
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad/normalized-types-3372.json";
const OUT_PATH = process.argv[2] || DEFAULT_OUT;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=== #3372 forslag A: percentil-normaliserede type-skalaer (READ-ONLY) ===");
  const { data: season } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = season?.number ?? 1;

  const abilityCols = VISIBLE_ABILITIES.join(", ");
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${abilityCols}, riders!inner(id, team_id, is_retired, birthdate, potentiale, primary_type, secondary_type, firstname, lastname)`)
      .order("rider_id"));

  const riders = [];
  for (const row of rows) {
    const r = row.riders;
    if (!r || r.team_id == null || r.is_retired || !r.primary_type) continue;
    const abilities = {};
    for (const a of VISIBLE_ABILITIES) abilities[a] = row[a];
    const age = ageForSeason(r.birthdate, seasonNumber);
    const scores = {};
    for (const t of RIDER_TYPE_KEYS) {
      const capsT = buildCapsForRider(abilities, { potentiale: r.potentiale, age }, t, null);
      scores[t] = ratingFromAbilities(capsT, t);
    }
    riders.push({ id: r.id, assigned: r.primary_type, potentiale: r.potentiale, age, scores });
  }
  const n = riders.length;

  // Percentil-transform pr. type (mod hele populationen i den rolle).
  const sortedByType = {};
  for (const t of RIDER_TYPE_KEYS) sortedByType[t] = riders.map((r) => r.scores[t]).sort((a, b) => a - b);
  const pctl = (t, v) => {
    const arr = sortedByType[t];
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    let lo2 = lo, hi2 = arr.length;
    while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (arr[mid] <= v) lo2 = mid + 1; else hi2 = mid; }
    const rank = (lo + lo2) / 2; // midt-rang ved ties
    return Math.round((rank / arr.length) * 99);
  };

  let matchNorm = 0, top2Norm = 0;
  const normDist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  const depths = [];
  const examples = [];
  for (const r of riders) {
    const norm = RIDER_TYPE_KEYS.map((t) => ({ t, p: pctl(t, r.scores[t]) })).sort((a, b) => b.p - a.p);
    normDist[norm[0].t]++;
    const rank = norm.findIndex((x) => x.t === r.assigned);
    if (rank === 0) matchNorm++;
    if (rank <= 1) top2Norm++;
    depths.push(norm[0].p - norm[1].p);
    if (examples.length < 8 && rank > 2 && r.potentiale >= 5) {
      examples.push({ id: r.id, assigned: r.assigned, potentiale: r.potentiale, age: r.age, norm: norm.slice(0, 4) });
    }
    r._norm = norm;
  }

  depths.sort((a, b) => a - b);
  const perc = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  const pct = (x) => Math.round((x / n) * 1000) / 10;

  // Én konkret rytter til scout-mockuppen: værste mismatch under RÅ skala der
  // er velklassificeret under normaliseret (viser hvad A retter).
  const showcase = riders
    .map((r) => {
      const rawSorted = RIDER_TYPE_KEYS.map((t) => ({ t, v: r.scores[t] })).sort((a, b) => b.v - a.v);
      return { r, rawBest: rawSorted[0], rawAll: rawSorted, normRankOfAssigned: r._norm.findIndex((x) => x.t === r.assigned) };
    })
    .filter((x) => x.rawBest.t !== x.r.assigned && x.normRankOfAssigned === 0 && x.r.potentiale >= 5)
    .sort((a, b) => (b.rawBest.v - b.r.scores[b.r.assigned]) - (a.rawBest.v - a.r.scores[a.r.assigned]))[0];

  const out = {
    meta: { generatedAt: new Date().toISOString(), n, seasonNumber },
    normArgmaxDist: normDist,
    matchNormPct: pct(matchNorm),
    top2NormPct: pct(top2Norm),
    specializationDepth: { median: perc(depths, 0.5), p25: perc(depths, 0.25), p75: perc(depths, 0.75), pctDepth0: pct(depths.filter((d) => d === 0).length) },
    examplesAssignedNotTop3: examples,
    showcase: showcase ? {
      id: showcase.r.id, assigned: showcase.r.assigned, potentiale: showcase.r.potentiale, age: showcase.r.age,
      raw: showcase.rawAll, norm: showcase.r._norm,
    } : null,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  console.log(`n=${n}`);
  console.log(`Argmax-fordeling under NORMALISERET skala:`, JSON.stringify(normDist));
  console.log(`Tildelt primær = normaliseret bedste rolle: ${out.matchNormPct} % (top-2: ${out.top2NormPct} %)`);
  console.log(`Specialiserings-dybde (bedste − næstbedste percentil): median ${out.specializationDepth.median} · P25 ${out.specializationDepth.p25} · P75 ${out.specializationDepth.p75} · andel med dybde 0: ${out.specializationDepth.pctDepth0} %`);
  if (out.showcase) console.log(`Showcase-rytter: tildelt=${out.showcase.assigned}, rå-bedste=${out.showcase.raw[0].t}, se JSON.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
