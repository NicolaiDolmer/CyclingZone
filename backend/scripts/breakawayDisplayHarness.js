#!/usr/bin/env node
// scripts/breakawayDisplayHarness.js
// ============================================================
// #1499 — simulér-før-ship: RAPPORT-ONLY frekvensmåling af de DESKRIPTIVE
// udbruds-etiketter (in_breakaway + breakaway_caught) pr. terræn, mod den ÆGTE
// fiktive population. Beviser at etiketterne ser realistiske ud FØR ship.
//
// Måler intet om balance (det gør race:gate); dette script verificerer kun at
// displaylaget — afledt via deriveBreakawayStatus — rammer realistiske bånd:
//   in_breakaway-andel (af alle finishers) bør ligne den gate-målte escapee-
//     selektions-andel; den er per-rytter, ikke per-vinder, så den er lavere.
//   survived-andel (escapees der holdt hjem) sættes i relation til de validerede
//     udbruds-VINDER-bånd fra kalibrerings-loggen 2026-06-16 (flat 1-7 %, rolling
//     4-15, hilly 18-45, mountain 15-50, high_mountain 0-15, cobbles 2-15) — vundne
//     udbrud er den strengeste delmængde af "holdt hjem", så survived ≥ winner-andel.
//
// Genbruger PRÆCIS samme felt-konstruktion som simulateSeasonDryRun.js (samme
// value-kæde) men er en separat, fokuseret rapport (ingen gate, ingen exit 1).
//
// Usage:
//   node scripts/breakawayDisplayHarness.js [--seed=2026] [--races=300] [--field=140] [--count=800]
//
// Exit 0 altid (rapport-only). Refs #1499.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, makeRng } from "../lib/fictionalRiderGenerator.js";
import { resolveMix } from "../lib/fictionalRiderMixPresets.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue, riderOverall, riderSpecialty } from "../lib/riderValuation.js";
import { DEMAND_VECTORS, finaleFor } from "../lib/raceStageProfileGenerator.js";
import { simulateStage, stableSeed, deriveBreakawayStatus } from "../lib/raceSimulator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const SEED = parseInt(arg("seed", "2026"), 10);
const RACES = parseInt(arg("races", "300"), 10);
const FIELD = parseInt(arg("field", "140"), 10);
const COUNT = parseInt(arg("count", "800"), 10);
const REFERENCE_YEAR = 2026;
const MIX = arg("mix", "default");
const mixOverride = resolveMix(MIX);

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

// Validerede udbruds-VINDER-bånd (kalibrerings-loggen 2026-06-16). survived-andelen
// (alle escapees der holdt hjem) er et SUPERSET af vinder-andelen → survived ≥ min.
const WINNER_BANDS = {
  flat: [1, 7], rolling: [4, 15], hilly: [18, 45],
  mountain: [15, 50], high_mountain: [0, 15], cobbles: [2, 15],
};
const TERRAINS = ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles"];

// ── Felt-konstruktion (spejler simulateSeasonDryRun.js) ──────────────────────
const { riders: raw } = generateFictionalRiders({ count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR, ...mixOverride });
const field = raw.map((r, i) => {
  const id = `r${i}`;
  const abilities = deriveAbilities(r._meta?.physiology ?? {}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
  const derived = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
  return {
    id, team_id: null,
    specialty: riderSpecialty(abilities),
    overall: riderOverall(abilities),
    baseValue: predictBaseValue({ primary_type: derived }, abilities, model),
    abilities,
  };
});

function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}

const pct = (a, b) => (b ? (100 * a) / b : 0);
const f1 = (n) => n.toFixed(1).padStart(5);

console.log(`\n🏴  #1499 BREAKAWAY-DISPLAY HARNESS — seed=${SEED} races=${RACES}/terræn field=${FIELD} (rapport-only, rører ikke prod)\n`);
console.log("─".repeat(86));
console.log(
  `${"terræn".padEnd(14)}${"in_brk%".padStart(9)}${"survived%".padStart(11)}${"caught%".padStart(9)}` +
  `${"winnerHeld%".padStart(12)}${"winner-bånd".padStart(13)}   status`,
);
console.log("─".repeat(86));

let anyFlag = false;
for (const terrain of TERRAINS) {
  const demand = DEMAND_VECTORS[terrain];
  const rng = makeRng(stableSeed(`brkdisp:${SEED}:${terrain}`));
  const finaleRng = makeRng(stableSeed(`brkdisp:${SEED}:${terrain}:finale`));

  let finishers = 0, inBreak = 0, survived = 0, caught = 0;
  let races = 0, winnerHeld = 0;

  for (let i = 0; i < RACES; i++) {
    const sample = sampleField(rng, field, FIELD);
    const raceSeed = stableSeed(`${terrain}:${i}`);
    const finaleType = finaleFor(finaleRng, terrain);
    const entrants = sample.map((r) => ({ rider_id: r.id, team_id: null, abilities: r.abilities }));
    const { ranked } = simulateStage({
      entrants,
      stageProfile: { profile_type: terrain, finale_type: finaleType, demand_vector: demand },
      seed: raceSeed,
    });
    const status = deriveBreakawayStatus(ranked);
    races++;
    if ((ranked[0].components.breakaway || 0) > 0) winnerHeld++;
    for (const r of ranked) {
      finishers++;
      const st = status.get(r.rider_id);
      if (st.in_breakaway) {
        inBreak++;
        if (st.breakaway_caught) caught++; else survived++;
      }
    }
  }

  const survPct = pct(survived, inBreak);   // andel af escapees der holdt hjem
  const winnerHeldPct = pct(winnerHeld, races);
  const [lo, hi] = WINNER_BANDS[terrain];
  // Plausibilitets-tjek: vinder-andelen (strengeste delmængde) skal ligge i båndet.
  const winnerOk = winnerHeldPct >= lo - 1 && winnerHeldPct <= hi + 1; // ±1pp slack (rapport, ikke gate)
  if (!winnerOk) anyFlag = true;
  console.log(
    `${terrain.padEnd(14)}${f1(pct(inBreak, finishers))}%  ${f1(survPct)}%   ${f1(pct(caught, inBreak))}%` +
    `   ${f1(winnerHeldPct)}%     [${lo}-${hi}]%   ${winnerOk ? "✓" : "⚠ winner uden for bånd"}`,
  );
}

console.log("─".repeat(86));
console.log(
  `\nLæsning: in_brk% = andel af ALLE finishers der var escapee (per-rytter). survived% / caught%\n` +
  `= split af escapees (holdt hjem vs. indhentet). winnerHeld% = etapens vinder var escapee\n` +
  `(den gate-validerede metrik) og skal ligge i winner-båndet → beviser at survived/caught-\n` +
  `etiketten hviler på en realistisk udbruds-fordeling.\n`,
);
console.log(anyFlag
  ? "⚠  Mindst ét terræns winner-andel lå uden for båndet (rapport-only — IKKE en gate; udbruds-\n   båndene er selv KANDIDAT-bånd, jf. simulateSeasonDryRun.js, og re-fittes post-launch #1021)."
  : "✅  Alle terræners winner-andel inden for de validerede bånd — udbruds-etiketterne ser realistiske ud.");
