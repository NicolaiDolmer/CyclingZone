#!/usr/bin/env node
// READ-ONLY måling (ejer-observation 6/8): "det ligner ikke, at de ryttertyper
// rytterne har, faktisk er dem hvor de har bedst potentiale."
//
// Test: for hver human-ejet rytter beregnes det KONTRAFAKTISKE loft i alle 8
// roller — caps_t = buildCapsForRider(abilities, {potentiale, age}, t, null) og
// score_t = ratingFromAbilities(caps_t, t) — dvs. "hvor godt kunne rytteren
// blive i rolle t, hvis rollen var hans primære". Den tildelte primary_type
// sammenlignes så med argmax.
//
//   node scripts/measureBestType3372.js [output.json]

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
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad/best-type-3372.json";
const OUT_PATH = process.argv[2] || DEFAULT_OUT;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=== #3372 tildelt type vs. bedste kontrafaktiske rolle (READ-ONLY) ===");
  const { data: season } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = season?.number ?? 1;

  const abilityCols = VISIBLE_ABILITIES.join(", ");
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${abilityCols}, riders!inner(id, team_id, is_retired, birthdate, potentiale, primary_type, secondary_type)`)
      .order("rider_id"));

  let n = 0, matchBest = 0, inTop2 = 0;
  const gaps = [];
  const bestDist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  const assignedDist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  const worstExamples = [];

  for (const row of rows) {
    const r = row.riders;
    if (!r || r.team_id == null || r.is_retired || !r.primary_type) continue;
    const abilities = {};
    for (const a of VISIBLE_ABILITIES) abilities[a] = row[a];
    const age = ageForSeason(r.birthdate, seasonNumber);

    const scores = RIDER_TYPE_KEYS.map((t) => {
      const capsT = buildCapsForRider(abilities, { potentiale: r.potentiale, age }, t, null);
      return { t, score: ratingFromAbilities(capsT, t) };
    }).sort((a, b) => b.score - a.score);

    const best = scores[0];
    const assignedRank = scores.findIndex((s) => s.t === r.primary_type);
    const assignedScore = scores[assignedRank]?.score ?? null;

    n++;
    bestDist[best.t]++;
    assignedDist[r.primary_type] = (assignedDist[r.primary_type] ?? 0) + 1;
    if (best.t === r.primary_type) matchBest++;
    if (assignedRank <= 1) inTop2++;
    const gap = best.score - assignedScore;
    gaps.push(gap);
    if (gap >= 8) worstExamples.push({ id: r.id, age, potentiale: r.potentiale, assigned: r.primary_type, assignedScore, best: best.t, bestScore: best.score, gap });
  }

  gaps.sort((a, b) => a - b);
  const pct = (x) => Math.round((x / n) * 1000) / 10;
  const perc = (p) => gaps[Math.min(gaps.length - 1, Math.floor((gaps.length - 1) * p))];

  const out = {
    meta: { generatedAt: new Date().toISOString(), n, seasonNumber },
    matchBestPct: pct(matchBest),
    inTop2Pct: pct(inTop2),
    gap: { median: perc(0.5), p75: perc(0.75), p90: perc(0.9), max: gaps[gaps.length - 1] },
    gapGe5Pct: pct(gaps.filter((g) => g >= 5).length),
    gapGe10Pct: pct(gaps.filter((g) => g >= 10).length),
    bestDist, assignedDist,
    worstExamples: worstExamples.sort((a, b) => b.gap - a.gap).slice(0, 15),
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  console.log(`n=${n}`);
  console.log(`Tildelt primær ER bedste kontrafaktiske rolle: ${out.matchBestPct} %`);
  console.log(`Tildelt primær i top-2:                        ${out.inTop2Pct} %`);
  console.log(`Gap (bedste − tildelte rolle-loft): median ${out.gap.median} · P75 ${out.gap.p75} · P90 ${out.gap.p90} · max ${out.gap.max}`);
  console.log(`Andel med gap ≥5: ${out.gapGe5Pct} % · ≥10: ${out.gapGe10Pct} %`);
  console.log("Fordeling hvis alle fik deres ARGMAX-rolle:", JSON.stringify(out.bestDist));
  console.log("Fordeling som TILDELT i dag:               ", JSON.stringify(out.assignedDist));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
