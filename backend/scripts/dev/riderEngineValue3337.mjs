#!/usr/bin/env node
// #3337 del 2 — "motor-værdi" pr. ÆGTE rytter, renset for hold/udtagelse/rolle.
//
// Hver ægte D2-rytter injiceres (som free_role, med ét fælles syntetisk rider_id så
// rng-sekvensen er identisk for alle) i det SAMME sæt ægte D2-etapeløb. Vi måler de
// point han henter. Resultatet er rytterens rene motor-værdi — uafhængig af hvilket
// hold han er på, hvor tit han bliver udtaget, og hvilken rolle han får.
// Derefter holdes motor-værdien op mod hans markedspris.
//
//   node scripts/dev/riderEngineValue3337.mjs --data=<inputs.json> [--tier=2] [--maxRaces=18]

import { readFileSync, writeFileSync } from "node:fs";
import { buildRaceResults } from "../../lib/raceRunner.js";
import { buildRacePointsLookup } from "../../lib/raceResultsEngine.js";
import { DEMAND_VECTORS } from "../../lib/raceStageProfileGenerator.js";

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return process.argv.includes(`--${n}`) ? true : d;
};
const DATA = arg("data", "./3337-inputs.json");
const TIER = Number(arg("tier", "2"));
const MAX_RACES = Number(arg("maxRaces", "18"));
const OUT = arg("out", null);

const PHYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];
const ALL = [...PHYS, "cobblestone", "descending", "positioning", "tactics", "aggression"];

const D = JSON.parse(readFileSync(DATA, "utf8"));
const abById = new Map(D.abilities.map((a) => [a.rider_id, a]));
const riderById = new Map(D.riders.map((r) => [r.id, r]));
const profByRace = new Map();
for (const p of D.profiles) { (profByRace.get(p.race_id) ?? profByRace.set(p.race_id, []).get(p.race_id)).push(p); }
const entriesByRace = new Map();
for (const e of D.entries) { (entriesByRace.get(e.race_id) ?? entriesByRace.set(e.race_id, []).get(e.race_id)).push(e); }
const pointsByClass = new Map();
for (const rp of D.racePoints) { (pointsByClass.get(rp.race_class) ?? pointsByClass.set(rp.race_class, []).get(rp.race_class)).push(rp); }

const SYNTH_ID = "ffffffff-0000-4000-8000-00000000000f";
const SYNTH_TEAM = "ffffffff-0000-4000-8000-0000000000ff";

const races = D.races
  .filter((r) => r.tier === TIER && r.pool === 0)
  .filter((r) => (profByRace.get(r.id) || []).length > 0 && (entriesByRace.get(r.id) || []).length >= 60)
  .slice(0, MAX_RACES)
  .map((r) => {
    const stages = (profByRace.get(r.id) || []).slice().sort((a, b) => a.stage_number - b.stage_number)
      .map((p) => ({
        stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type,
        demand_vector: p.demand_vector || DEMAND_VECTORS[p.profile_type],
        distance_km: p.distance_km, climbs: p.climbs, sprints: p.sprints, sectors: p.sectors,
      }));
    const field = (entriesByRace.get(r.id) || []).map((e) => {
      const a = abById.get(e.rider_id);
      if (!a) return null;
      return { rider_id: e.rider_id, team_id: e.team_id, is_u25: false, abilities: a, form: 50, fatigue: 0, race_role: e.race_role || null };
    }).filter(Boolean);
    const pointsLookup = buildRacePointsLookup({ racePoints: pointsByClass.get(r.race_class) || [], raceType: r.race_type });
    const mtn = stages.filter((s) => s.profile_type === "mountain" || s.profile_type === "high_mountain").length;
    return { race: { id: r.id, race_type: r.race_type }, name: r.name, race_type: r.race_type, stages, field, pointsLookup, mtnShare: mtn / stages.length };
  })
  .filter((r) => Object.keys(r.pointsLookup).length > 0);

// Testkandidater: alle ryttere med abilities i tier-felterne
const candidates = [...new Set(D.entries
  .filter((e) => { const r = D.races.find((x) => x.id === e.race_id); return r && r.tier === TIER; })
  .map((e) => e.rider_id))].filter((id) => abById.get(id));

console.error(`races=${races.length} candidates=${candidates.length}`);

const out = [];
let done = 0;
for (const rid of candidates) {
  const ab = abById.get(rid);
  const meta = riderById.get(rid) || {};
  let points = 0, prize = 0, gcSum = 0, gcN = 0, top10 = 0, wins = 0, stageWins = 0;
  let mtnPoints = 0, flatPoints = 0, stageRacePoints = 0, singlePoints = 0;
  for (const R of races) {
    const entrants = [
      ...R.field.filter((e) => e.rider_id !== rid),
      { rider_id: SYNTH_ID, team_id: SYNTH_TEAM, is_u25: false, abilities: ab, form: 50, fatigue: 0, race_role: "free_role" },
    ];
    const { resultRows } = buildRaceResults({ race: R.race, stages: R.stages, entrants, pointsLookup: R.pointsLookup, v3: true });
    const mine = resultRows.filter((x) => x.rider_id === SYNTH_ID);
    const p = mine.reduce((s, x) => s + (x.points_earned || 0), 0);
    points += p;
    prize += mine.reduce((s, x) => s + (x.prize_money || 0), 0);
    const gc = mine.find((x) => x.result_type === "gc");
    if (gc) { gcSum += gc.rank; gcN++; if (gc.rank <= 10) top10++; if (gc.rank === 1) wins++; }
    stageWins += mine.filter((x) => x.result_type === "stage" && x.rank === 1).length;
    if (R.mtnShare >= 0.4) mtnPoints += p; else flatPoints += p;
    if (R.race_type === "stage_race") stageRacePoints += p; else singlePoints += p;
  }
  const vals = PHYS.map((k) => Number(ab[k]) || 0).sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const medianA = (vals[4] + vals[5]) / 2;
  const meanA = sum / 10;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - meanA) ** 2, 0) / 10);
  out.push({
    rider_id: rid,
    market_value: meta.market_value ?? null,
    primary_type: meta.primary_type ?? null,
    valuation_type: meta.valuation_type ?? null,
    sum10: sum, mean10: meanA, max10: vals[9], median10: medianA,
    peak_abs: vals[9] - medianA,               // spidshed i evne-point
    peak_rel: meanA > 0 ? sd / meanA : 0,      // variationskoefficient = "hvor spids"
    climbing: Number(ab.climbing) || 0, time_trial: Number(ab.time_trial) || 0, sprint: Number(ab.sprint) || 0, punch: Number(ab.punch) || 0,
    points, prize, gcMean: gcN ? gcSum / gcN : null, top10, wins, stageWins, mtnPoints, flatPoints,
    stageRacePoints, singlePoints,
  });
  if (++done % 100 === 0) console.error(`  ${done}/${candidates.length}`);
}

if (OUT) writeFileSync(OUT, JSON.stringify(out));

// ── Rapport ──────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const corr = (xs, ys) => {
  const n = xs.length; if (n < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
};
const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k + 1; }); return r; };
const spearman = (xs, ys) => corr(rank(xs), rank(ys));

console.log(`\n#3337 del 2 — motor-værdi pr. ægte rytter | tier ${TIER} | ${races.length} etapeløb | ${out.length} ryttere`);
console.log(`Løbstyper: ${races.filter(r => r.race_type === "stage_race").length} etapeløb + ${races.filter(r => r.race_type !== "stage_race").length} endagsløb`);

const withVal = out.filter((r) => Number.isFinite(Number(r.market_value)) && r.market_value > 0);
console.log(`\nKorrelationer (n=${out.length}):`);
console.log(`  samlet evnesum (Σ10)   → point : Spearman ${spearman(out.map(r => r.sum10), out.map(r => r.points)).toFixed(3)}`);
console.log(`  spidshed (max−median)  → point : Spearman ${spearman(out.map(r => r.peak_abs), out.map(r => r.points)).toFixed(3)}`);
console.log(`  klatring               → point : Spearman ${spearman(out.map(r => r.climbing), out.map(r => r.points)).toFixed(3)}`);
console.log(`  enkeltstart            → point : Spearman ${spearman(out.map(r => r.time_trial), out.map(r => r.points)).toFixed(3)}`);
console.log(`  spurt                  → point : Spearman ${spearman(out.map(r => r.sprint), out.map(r => r.points)).toFixed(3)}`);
console.log(`  punch                  → point : Spearman ${spearman(out.map(r => r.punch), out.map(r => r.points)).toFixed(3)}`);
console.log(`  markedsværdi           → point : Spearman ${spearman(withVal.map(r => Number(r.market_value)), withVal.map(r => r.points)).toFixed(3)} (n=${withVal.length})`);

// Kontrollér for samlet styrke: inden for hver Σ10-decil, sammenlign spids vs. bred.
console.log(`\n--- Kontrolleret for samlet styrke: Σ10-deciler, spids vs. bred halvdel ---`);
console.log("Σ10-decil".padEnd(12) + "n".padStart(5) + "Σ10-interval".padStart(16) + "point spids".padStart(13) + "point bred".padStart(12) + "faktor".padStart(9) + "GC-snit spids".padStart(15) + "GC-snit bred".padStart(14));
const sorted = [...out].sort((a, b) => a.sum10 - b.sum10);
const D10 = Math.ceil(sorted.length / 10);
for (let d = 0; d < 10; d++) {
  const bucket = sorted.slice(d * D10, (d + 1) * D10);
  if (bucket.length < 10) continue;
  const byPeak = [...bucket].sort((a, b) => a.peak_abs - b.peak_abs);
  const half = Math.floor(byPeak.length / 2);
  const broad = byPeak.slice(0, half);
  const peaked = byPeak.slice(byPeak.length - half);
  const pp = mean(peaked.map(r => r.points)), bp = mean(broad.map(r => r.points));
  console.log(
    `D${d + 1}`.padEnd(12) + String(bucket.length).padStart(5) +
    `${bucket[0].sum10}-${bucket[bucket.length - 1].sum10}`.padStart(16) +
    pp.toFixed(0).padStart(13) + bp.toFixed(0).padStart(12) +
    (bp > 0 ? (pp / bp).toFixed(2) + "x" : "n/a").padStart(9) +
    mean(peaked.map(r => r.gcMean)).toFixed(1).padStart(15) +
    mean(broad.map(r => r.gcMean)).toFixed(1).padStart(14)
  );
}

// Samme, men kontrolleret for PRIS (markedsværdi) — det manageren faktisk vælger på.
console.log(`\n--- Kontrolleret for PRIS: markedsværdi-deciler, spids vs. bred halvdel ---`);
console.log("pris-decil".padEnd(12) + "n".padStart(5) + "median pris".padStart(14) + "point spids".padStart(13) + "point bred".padStart(12) + "faktor".padStart(9));
const byVal = [...withVal].sort((a, b) => Number(a.market_value) - Number(b.market_value));
const V10 = Math.ceil(byVal.length / 10);
for (let d = 0; d < 10; d++) {
  const bucket = byVal.slice(d * V10, (d + 1) * V10);
  if (bucket.length < 10) continue;
  const byPeak = [...bucket].sort((a, b) => a.peak_abs - b.peak_abs);
  const half = Math.floor(byPeak.length / 2);
  const broad = byPeak.slice(0, half);
  const peaked = byPeak.slice(byPeak.length - half);
  const pp = mean(peaked.map(r => r.points)), bp = mean(broad.map(r => r.points));
  console.log(
    `P${d + 1}`.padEnd(12) + String(bucket.length).padStart(5) +
    Math.round(med(bucket.map(r => Number(r.market_value)))).toLocaleString("da-DK").padStart(14) +
    pp.toFixed(0).padStart(13) + bp.toFixed(0).padStart(12) +
    (bp > 0 ? (pp / bp).toFixed(2) + "x" : "n/a").padStart(9)
  );
}

// Pr. ryttertype: point og pris
console.log(`\n--- Pr. primary_type: motor-point vs. markedspris ---`);
console.log("type".padEnd(18) + "n".padStart(6) + "median Σ10".padStart(12) + "median point".padStart(14) + "  heraf etapeløb/endags".padStart(24) + "median pris".padStart(14) + "point pr. mio.".padStart(16));
const byType = new Map();
for (const r of withVal) { const t = r.primary_type || "null"; (byType.get(t) ?? byType.set(t, []).get(t)).push(r); }
for (const [t, rs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const mp = med(rs.map(r => r.points));
  const mv = med(rs.map(r => Number(r.market_value)));
  console.log(t.padEnd(18) + String(rs.length).padStart(6) + med(rs.map(r => r.sum10)).toFixed(0).padStart(12) +
    mp.toFixed(0).padStart(14) + `${med(rs.map(r => r.stageRacePoints)).toFixed(0)} / ${med(rs.map(r => r.singlePoints)).toFixed(0)}`.padStart(24) +
    Math.round(mv).toLocaleString("da-DK").padStart(14) +
    (mv > 0 ? (mp / (mv / 1e6)).toFixed(2) : "n/a").padStart(16));
}
