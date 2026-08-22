#!/usr/bin/env node
// Måling til #3337 — betaler specialisering sig?
//
// Kontrolleret parvis eksperiment: samme ÆGTE felt, samme rytter-id, samme seed,
// KUN evne-vektoren ændres. Én syntetisk rytter injiceres ad gangen i hvert ægte
// D2-etapeløb (S2), og hele løbet køres gennem den ÆGTE motor (buildRaceResults →
// simulateStage, v3 = prod-flagets tilstand). Ingen DB-skrivning.
//
//   node scripts/dev/specializationHarness3337.mjs --data=<inputs.json> [--tier=2] [--budget=450] [--reps=3]

import { readFileSync } from "node:fs";
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
const BUDGET = Number(arg("budget", "450"));
const REPS = Number(arg("reps", "3"));
const V3 = arg("v1", false) ? false : true;
const REAL_CONDITION = !!arg("real-condition", false);

const PHYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];
const TECH = { cobblestone: 20, descending: 20, positioning: 20, tactics: 34, aggression: 25 }; // D2-median, IDENTISK for alle profiler

// Form-vektorer over de 10 fysiske evner. Fordeles på et FAST samlet budget.
const SHAPES = {
  // Ren bjergrytter: alt i klatre-vektoren (mountain/high_mountain), intet tempo-/fladtalent.
  ren_bjergrytter:   { climbing: 10, tempo: 4.5, endurance: 4.5, recovery: 3, durability: 2, time_trial: 0.6, flat: 0.6, sprint: 0.4, acceleration: 0.6, punch: 2 },
  // Komplet GC-rytter: klatring OG enkeltstart (det spillerne kalder "for god til alt").
  komplet_gc:        { climbing: 7, time_trial: 6, tempo: 3.5, endurance: 4, recovery: 2.5, durability: 2, flat: 2.5, punch: 1.5, sprint: 0.5, acceleration: 0.7 },
  // Bred allrounder: alle 10 fysiske evner ens.
  bred_allrounder:   { climbing: 1, time_trial: 1, flat: 1, tempo: 1, sprint: 1, acceleration: 1, punch: 1, endurance: 1, recovery: 1, durability: 1 },
  // Ren sprinter.
  ren_sprinter:      { sprint: 10, acceleration: 5, flat: 4, endurance: 1.5, durability: 1.5, punch: 1, tempo: 0.6, recovery: 0.8, climbing: 0.4, time_trial: 0.6 },
  // Ren puncheur (kuperet).
  ren_puncheur:      { punch: 10, tempo: 5, endurance: 3, acceleration: 2, climbing: 2, recovery: 1.5, durability: 1.5, flat: 1.5, sprint: 1, time_trial: 0.8 },
  // Ren tempokører.
  ren_tempokorer:    { time_trial: 10, flat: 5, endurance: 3, durability: 2, tempo: 2, recovery: 1.5, climbing: 1, punch: 1, acceleration: 1, sprint: 0.8 },
};

// Fordel BUDGET over de 10 fysiske evner efter formvægte; clamp [8, 99]; iterér til sum≈budget.
function buildAbilities(shape, budget) {
  const keys = PHYS;
  let w = keys.map((k) => shape[k] ?? 0);
  const out = {};
  let scale = budget / w.reduce((a, b) => a + b, 0);
  for (let iter = 0; iter < 60; iter++) {
    let sum = 0;
    const free = [];
    let freeW = 0;
    for (let i = 0; i < keys.length; i++) {
      const raw = w[i] * scale;
      const v = Math.max(8, Math.min(99, raw));
      out[keys[i]] = v;
      sum += v;
      if (v > 8 && v < 99) { free.push(i); freeW += w[i]; }
    }
    const diff = budget - sum;
    if (Math.abs(diff) < 0.5 || !free.length || freeW === 0) break;
    scale += diff / freeW;
  }
  for (const k of keys) out[k] = Math.round(out[k]);
  // sidste justering på den største frie evne så summen rammer præcist
  let sum = keys.reduce((s, k) => s + out[k], 0);
  const order = [...keys].sort((a, b) => out[b] - out[a]);
  for (const k of order) {
    if (sum === budget) break;
    const step = sum > budget ? -1 : 1;
    const nv = out[k] + step;
    if (nv >= 8 && nv <= 99) { out[k] = nv; sum += step; }
  }
  return { ...out, ...TECH };
}

const D = JSON.parse(readFileSync(DATA, "utf8"));
const abById = new Map(D.abilities.map((a) => [a.rider_id, a]));
const condById = new Map(D.condition.map((c) => [c.rider_id, c]));
const profByRace = new Map();
for (const p of D.profiles) {
  if (!profByRace.has(p.race_id)) profByRace.set(p.race_id, []);
  profByRace.get(p.race_id).push(p);
}
const entriesByRace = new Map();
for (const e of D.entries) {
  if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
  entriesByRace.get(e.race_id).push(e);
}

const races = D.races
  .filter((r) => r.tier === TIER)
  .filter((r) => (profByRace.get(r.id) || []).length > 0)
  .filter((r) => (entriesByRace.get(r.id) || []).length >= 60);

const SYNTH_ID = "ffffffff-0000-4000-8000-00000000000f"; // samme id for ALLE profiler → identisk rng-sekvens
const SYNTH_TEAM = "ffffffff-0000-4000-8000-0000000000ff";

function stagesFor(race) {
  return (profByRace.get(race.id) || [])
    .slice()
    .sort((a, b) => a.stage_number - b.stage_number)
    .map((p) => ({
      stage_number: p.stage_number,
      profile_type: p.profile_type,
      finale_type: p.finale_type,
      demand_vector: p.demand_vector || DEMAND_VECTORS[p.profile_type],
      distance_km: p.distance_km,
      climbs: p.climbs,
      sprints: p.sprints,
      sectors: p.sectors,
    }));
}

function fieldFor(race) {
  const out = [];
  for (const e of entriesByRace.get(race.id) || []) {
    const a = abById.get(e.rider_id);
    if (!a) continue;
    const c = REAL_CONDITION ? condById.get(e.rider_id) : null;
    out.push({
      rider_id: e.rider_id,
      team_id: e.team_id,
      rider_name: null,
      is_u25: false,
      abilities: a,
      form: c ? c.form : 50,
      fatigue: c ? c.fatigue : 0,
      race_role: e.race_role || null,
    });
  }
  return out;
}

const pointsByClass = new Map();
for (const rp of D.racePoints) {
  if (!pointsByClass.has(rp.race_class)) pointsByClass.set(rp.race_class, []);
  pointsByClass.get(rp.race_class).push(rp);
}

function terrainOfRace(stages) {
  const n = stages.length;
  const cnt = (set) => stages.filter((s) => set.has(s.profile_type)).length;
  const mtn = cnt(new Set(["mountain", "high_mountain"]));
  const flat = cnt(new Set(["flat", "rolling"]));
  return { n, mtn, flat, mtnShare: mtn / n, flatShare: flat / n };
}

const results = []; // {profile, race, rep, gcRank, points, prize, stageWins, field}

for (const race of races) {
  const stages = stagesFor(race);
  const field = fieldFor(race);
  if (field.length < 60) continue;
  const pointsLookup = buildRacePointsLookup({
    racePoints: pointsByClass.get(race.race_class) || [],
    raceType: race.race_type,
  });
  if (!Object.keys(pointsLookup).length) continue;
  const terr = terrainOfRace(stages);

  for (const [shapeName, shape] of Object.entries(SHAPES)) {
    const abilities = buildAbilities(shape, BUDGET);
    for (let rep = 0; rep < REPS; rep++) {
      const raceObj = { id: rep === 0 ? race.id : `${race.id}:r${rep}`, race_type: race.race_type };
      const entrants = [
        ...field,
        {
          rider_id: SYNTH_ID, team_id: SYNTH_TEAM, rider_name: "SYNTH", is_u25: false,
          abilities, form: 50, fatigue: 0, race_role: "free_role",
        },
      ];
      const { resultRows } = buildRaceResults({ race: raceObj, stages, entrants, pointsLookup, v3: V3 });
      const mine = resultRows.filter((r) => r.rider_id === SYNTH_ID);
      const gcRow = mine.find((r) => r.result_type === "gc");
      const points = mine.reduce((s, r) => s + (r.points_earned || 0), 0);
      const prize = mine.reduce((s, r) => s + (r.prize_money || 0), 0);
      const stageRows = mine.filter((r) => r.result_type === "stage");
      const profByNum = new Map(stages.map((s) => [s.stage_number, s.profile_type]));
      const byTerrain = {};
      for (const sr of stageRows) {
        const pt = profByNum.get(sr.stage_number) || "?";
        byTerrain[pt] ??= { pts: 0, n: 0, wins: 0, top10: 0 };
        byTerrain[pt].pts += sr.points_earned || 0;
        byTerrain[pt].n += 1;
        if (sr.rank === 1) byTerrain[pt].wins += 1;
        if (sr.rank <= 10) byTerrain[pt].top10 += 1;
      }
      const gcPoints = mine.filter((r) => r.result_type === "gc").reduce((s, r) => s + (r.points_earned || 0), 0);
      const jerseyPoints = mine.filter((r) => !["gc", "stage"].includes(r.result_type)).reduce((s, r) => s + (r.points_earned || 0), 0);
      results.push({
        byTerrain, gcPoints, jerseyPoints,
        stagePoints: stageRows.reduce((s, r) => s + (r.points_earned || 0), 0),
        profile: shapeName, race: race.name, raceId: race.id, rep,
        gcRank: gcRow ? gcRow.rank : null,
        points, prize,
        stageWins: stageRows.filter((r) => r.rank === 1).length,
        stageTop10: stageRows.filter((r) => r.rank <= 10).length,
        stages: stages.length,
        field: entrants.length,
        mtnShare: terr.mtnShare, flatShare: terr.flatShare,
      });
    }
  }
}

// ── Rapport ──────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

console.log(`\n#3337 — specialisering vs. bredde | tier ${TIER} | budget ${BUDGET} (sum af 10 fysiske evner) | v3=${V3} | condition=${REAL_CONDITION ? "prod" : "neutral (form 50 / træthed 0)"}`);
console.log(`Etapeløb: ${races.length} · gentagelser pr. løb: ${REPS} · løbs-simuleringer i alt: ${results.length}`);

console.log(`\n--- Evneprofiler (sum af 10 fysiske = ${BUDGET}) ---`);
for (const [name, shape] of Object.entries(SHAPES)) {
  const a = buildAbilities(shape, BUDGET);
  console.log(`${name.padEnd(18)} ` + PHYS.map((k) => `${k.slice(0, 4)}=${String(a[k]).padStart(2)}`).join(" ") + `  Σ=${PHYS.reduce((s, k) => s + a[k], 0)}`);
}

function report(title, rows) {
  if (!rows.length) return;
  console.log(`\n--- ${title} (${new Set(rows.map((r) => r.raceId)).size} løb) ---`);
  console.log("profil".padEnd(18) + "GC-median".padStart(10) + "GC-snit".padStart(9) + "top10 GC%".padStart(11) + "GC-sejr%".padStart(10) + "point/løb".padStart(11) + "præmie/løb".padStart(12) + "etapesejre/løb".padStart(16));
  const byProfile = new Map();
  for (const r of rows) {
    if (!byProfile.has(r.profile)) byProfile.set(r.profile, []);
    byProfile.get(r.profile).push(r);
  }
  const order = [...byProfile.entries()].sort((a, b) => mean(b[1].map((r) => r.points)) - mean(a[1].map((r) => r.points)));
  for (const [p, rs] of order) {
    const gcs = rs.map((r) => r.gcRank).filter((x) => x != null);
    console.log(
      p.padEnd(18) +
      String(med(gcs)).padStart(10) +
      mean(gcs).toFixed(1).padStart(9) +
      (100 * gcs.filter((x) => x <= 10).length / gcs.length).toFixed(1).padStart(10) + "%" +
      (100 * gcs.filter((x) => x === 1).length / gcs.length).toFixed(1).padStart(9) + "%" +
      mean(rs.map((r) => r.points)).toFixed(1).padStart(11) +
      Math.round(mean(rs.map((r) => r.prize))).toLocaleString("da-DK").padStart(12) +
      mean(rs.map((r) => r.stageWins)).toFixed(2).padStart(16)
    );
  }
}

report("ALLE etapeløb", results);
report("KORTE løb (≤5 etaper — lidt akkumuleret træthed)", results.filter((r) => r.stages <= 5));
report("LANGE løb (≥7 etaper — 5-8 dages akkumuleret træthed)", results.filter((r) => r.stages >= 7));
report("BJERG-TUNGE løb (≥40% bjerg/højbjerg)", results.filter((r) => r.mtnShare >= 0.4));
report("FLAD-TUNGE løb (≥50% flad/rolling)", results.filter((r) => r.flatShare >= 0.5));

// Pr. løb: hvem vinder duellen specialist vs. allrounder?
const key = (r) => `${r.raceId}|${r.rep}`;
const grid = new Map();
for (const r of results) {
  if (!grid.has(key(r))) grid.set(key(r), {});
  grid.get(key(r))[r.profile] = r;
}
// Hvor kommer pointene fra?
console.log("\n--- Point-kilde pr. profil (snit pr. løb) ---");
console.log("profil".padEnd(18) + "etapepoint".padStart(12) + "GC-point".padStart(10) + "trøjepoint".padStart(12) + "| etapepoint pr. terræn (snit pr. løb)");
const TERR = ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "cobbles", "classic", "ttt"];
{
  const byProfile = new Map();
  for (const r of results) { (byProfile.get(r.profile) ?? byProfile.set(r.profile, []).get(r.profile)).push(r); }
  for (const [p, rs] of [...byProfile.entries()].sort((a, b) => mean(b[1].map((r) => r.points)) - mean(a[1].map((r) => r.points)))) {
    const terr = TERR.map((t) => {
      const v = mean(rs.map((r) => r.byTerrain[t]?.pts || 0));
      const n = mean(rs.map((r) => r.byTerrain[t]?.n || 0));
      return n > 0.02 ? `${t}=${v.toFixed(0)}` : null;
    }).filter(Boolean).join(" ");
    console.log(p.padEnd(18) + mean(rs.map((r) => r.stagePoints)).toFixed(0).padStart(12) + mean(rs.map((r) => r.gcPoints)).toFixed(0).padStart(10) + mean(rs.map((r) => r.jerseyPoints)).toFixed(0).padStart(12) + "  " + terr);
  }
}

console.log("\n--- Parvise dueller (samme løb, samme felt, samme seed) ---");
const pairs = [
  ["ren_bjergrytter", "bred_allrounder"],
  ["ren_bjergrytter", "komplet_gc"],
  ["komplet_gc", "bred_allrounder"],
  ["ren_sprinter", "bred_allrounder"],
  ["ren_puncheur", "bred_allrounder"],
  ["ren_tempokorer", "bred_allrounder"],
];
console.log("duel".padEnd(38) + "A vinder GC-duel".padStart(18) + "median GC-delta".padStart(17) + "point-delta/løb".padStart(17));
for (const [a, b] of pairs) {
  const deltas = [];
  const pdeltas = [];
  let aWins = 0, n = 0;
  for (const g of grid.values()) {
    if (!g[a] || !g[b] || g[a].gcRank == null || g[b].gcRank == null) continue;
    n++;
    if (g[a].gcRank < g[b].gcRank) aWins++;
    deltas.push(g[b].gcRank - g[a].gcRank);
    pdeltas.push(g[a].points - g[b].points);
  }
  if (!n) continue;
  console.log(`${a} vs ${b}`.padEnd(38) + `${(100 * aWins / n).toFixed(1)}%`.padStart(18) + `${med(deltas) > 0 ? "+" : ""}${med(deltas)}`.padStart(17) + `${mean(pdeltas) > 0 ? "+" : ""}${mean(pdeltas).toFixed(1)}`.padStart(17));
}
