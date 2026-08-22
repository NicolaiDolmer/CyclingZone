#!/usr/bin/env node
// #3337 — hvad er ÉT evne-point værd i GC-sekunder over en hel sæson?
// Analytisk, direkte på motorens egne funktioner + den ÆGTE S2-kalender.
//
//   sekunder(k) = Σ_etaper  (demand_vector[k] / 99) · stageGapModel(etape).spread
//
// stageGapModel er den rute-bevidste gap-model fra raceSimulator.js (samme funktion
// motoren bruger i prod). Ingen DB-skrivning.

import { readFileSync } from "node:fs";
import { stageGapModel, ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { DEMAND_VECTORS } from "../../lib/raceStageProfileGenerator.js";

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const D = JSON.parse(readFileSync(arg("data", "./3337-inputs-all.json"), "utf8"));
const TIER = Number(arg("tier", "2"));

const raceById = new Map(D.races.map((r) => [r.id, r]));
const seen = new Set();
const stages = [];
for (const p of D.profiles) {
  const r = raceById.get(p.race_id);
  if (!r || r.tier !== TIER || r.pool !== 0) continue;
  const k = `${r.name}#${p.stage_number}`;
  if (seen.has(k)) continue;
  seen.add(k);
  stages.push({ ...p, race_type: r.race_type });
}

function report(label, rows) {
  const secByAbility = {};
  let totalSpread = 0;
  const byProfile = {};
  for (const s of rows) {
    const dv = s.demand_vector || DEMAND_VECTORS[s.profile_type] || {};
    const { spread } = stageGapModel(s);
    totalSpread += spread;
    byProfile[s.profile_type] ??= { n: 0, spread: 0 };
    byProfile[s.profile_type].n++;
    byProfile[s.profile_type].spread += spread;
    for (const k of ABILITY_KEYS) {
      const w = Number(dv[k]) || 0;
      if (!w) continue;
      secByAbility[k] = (secByAbility[k] || 0) + (w / 99) * spread;
    }
  }
  console.log(`\n=== ${label} — ${rows.length} etaper (tier ${TIER}, pulje 0, unikke parcours) ===`);
  console.log(`Samlet "tids-budget" (Σ spread) = ${Math.round(totalSpread).toLocaleString("da-DK")} sek. pr. score-point`);
  console.log("\nTerræn".padEnd(16) + "etaper".padStart(8) + "andel etaper".padStart(14) + "Σ spread".padStart(11) + "andel af tid".padStart(14));
  for (const [p, v] of Object.entries(byProfile).sort((a, b) => b[1].spread - a[1].spread)) {
    console.log(p.padEnd(16) + String(v.n).padStart(8) + `${(100 * v.n / rows.length).toFixed(1)}%`.padStart(14) + Math.round(v.spread).toLocaleString("da-DK").padStart(11) + `${(100 * v.spread / totalSpread).toFixed(1)}%`.padStart(14));
  }
  console.log("\nEvne".padEnd(16) + "GC-sek. pr. evne-point".padStart(24) + "indeks (klatring=100)".padStart(23));
  const climb = secByAbility.climbing || 1;
  for (const [k, v] of Object.entries(secByAbility).sort((a, b) => b[1] - a[1])) {
    console.log(k.padEnd(16) + v.toFixed(1).padStart(24) + (100 * v / climb).toFixed(1).padStart(23));
  }
}

report("ETAPELØB (GC-tid)", stages.filter((s) => s.race_type === "stage_race"));
report("HELE KALENDEREN (etapeløb + endagsløb)", stages);

// ── Kontrafaktisk: #3349's terræn-mix (virkelighedens 407 WorldTour-etaper) ───
// Samme gennemsnitlige spread pr. terræn som i dag, men terræn-ANDELENE flyttet
// til virkelighedens fordeling. Svarer på: "løser #3349 problemet?"
{
  const meanSpread = {};
  const cnt = {};
  for (const s of stages) {
    const { spread } = stageGapModel(s);
    meanSpread[s.profile_type] = (meanSpread[s.profile_type] || 0) + spread;
    cnt[s.profile_type] = (cnt[s.profile_type] || 0) + 1;
  }
  for (const k of Object.keys(meanSpread)) meanSpread[k] /= cnt[k];
  // Virkelighedens fordeling (#3349): kuperet 37,6 · bjerg 27,7 · flad 21,5 · ITT 9,1 · rest 4,1
  const MIX = { hilly: 37.6, mountain: 24.0, high_mountain: 3.7, flat: 15.0, rolling: 6.5, itt: 9.1, cobbles: 2.1, classic: 2.0 };
  const sec = {};
  let tot = 0;
  const share = {};
  for (const [p, n] of Object.entries(MIX)) {
    const sp = meanSpread[p] ?? 150;
    share[p] = n * sp;
    tot += n * sp;
    const dv = DEMAND_VECTORS[p] || {};
    for (const k of ABILITY_KEYS) {
      const w = Number(dv[k]) || 0;
      if (w) sec[k] = (sec[k] || 0) + (w / 99) * sp * n;
    }
  }
  console.log(`\n=== KONTRAFAKTISK: #3349's virkeligheds-terrænmix (samme spread-model, 100 etaper) ===`);
  console.log("Terræn".padEnd(16) + "andel etaper".padStart(14) + "andel af GC-tid".padStart(18));
  for (const [p, v] of Object.entries(share).sort((a, b) => b[1] - a[1])) {
    console.log(p.padEnd(16) + `${MIX[p].toFixed(1)}%`.padStart(14) + `${(100 * v / tot).toFixed(1)}%`.padStart(18));
  }
  console.log("\nEvne".padEnd(16) + "indeks (klatring=100)".padStart(23));
  const climb = sec.climbing || 1;
  for (const [k, v] of Object.entries(sec).sort((a, b) => b[1] - a[1])) {
    console.log(k.padEnd(16) + (100 * v / climb).toFixed(1).padStart(23));
  }
}
