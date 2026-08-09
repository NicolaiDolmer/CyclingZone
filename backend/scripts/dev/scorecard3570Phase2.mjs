#!/usr/bin/env node
// Scorecard for #3570 FASE 2 (caps fra det TRUKNE anlæg, ejer-go 9/8 sent).
//
// FØR/EFTER for nye akademi-kuld (n=3000, fast seed), FØR = fase 1-kæden (PR #3571,
// stadig på disk her via buildCohortRecord i lib/progressionGates3564.mjs — caps
// formet af BOOTSTRAP-gættet), EFTER = fase 2-kæden (denne PR — caps formet DIREKTE
// af archetype_draw, samme kæde som backend/lib/backfillCores.js's deriveForRiderIds
// nu bruger, GC-guarden slettet i riderTypes.js).
//
// Måler: G1 total + PR. TRUKKET ANLÆG (kritisk: gc-linjen), G4 (knaphedsmål-
// fordeling), I1/I2/I3 (de omdøbte 9/8-invarianter — uændrede semantikker, se
// scripts/dev/lib/progressionGates3564.mjs). NEGATIV-TEST: fase 1-linjen (FØR) skal
// stadig vise den kendte gc-defekt (~0 % genfinding for trukne gc-anlæg).
//
//   node scripts/dev/scorecard3570Phase2.mjs [--n=3000] [--seed=2026]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "../../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS, RIDER_TYPES, scoreRiderType, GUARDS } from "../../lib/riderTypes.js";
import { gateI1CapsWithinPotentialLoft, gateI2YouthBandCeiling, gateI3GraduationLevelTail, PHYSICAL_ABILITIES } from "./lib/progressionGates3564.mjs";

// ── LEGACY gc-guard (FØR #3570 fase 2 — SLETTET fra lib/riderTypes.js af denne PR) ──
// Reproduceret HER, KUN til FØR-linjen i denne scorecard, så negativ-testen faktisk
// sammenligner mod den kendte, dokumenterede defekt (0/303 gc-trukne genkendt, målt
// 9/8, gcFunnel3570.mjs i wf_a1281334-109-1) — IKKE mod den nuværende (guard-fjernede)
// riderTypes.js, som ville tilsløre hvor meget af rettelsen der kommer fra
// archetype_draw ALENE. Tærsklerne (53/53/27) er de historiske GUARDS-værdier FØR
// denne PR — se git-historikken for riderTypes.js hvis de skal verificeres.
const LEGACY_GC_GUARD = Object.freeze({ gcClimbing: 53, gcTimeTrial: 53, gcRecovery: 27 });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function legacyComputeRiderTypes(abilities, baseline) {
  const out = new Set();
  const SPECIALITY_ABILITIES = ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"];
  if (SPECIALITY_ABILITIES.some((a) => num(abilities[a]) >= GUARDS.highSpeciality)) out.add("rouleur");
  if (num(abilities.sprint) > num(abilities.cobblestone)) out.add("brostensrytter");
  const isGc = num(abilities.climbing) >= LEGACY_GC_GUARD.gcClimbing
    && num(abilities.time_trial) >= LEGACY_GC_GUARD.gcTimeTrial
    && num(abilities.recovery) >= LEGACY_GC_GUARD.gcRecovery
    && num(abilities.punch) <= num(abilities.time_trial);
  if (!isGc) out.add("gc");
  let scored = RIDER_TYPES.filter((t) => !out.has(t.key)).map((t) => ({ key: t.key, score: scoreRiderType(abilities, t.weights, baseline) }));
  if (scored.length < 2) scored = RIDER_TYPES.map((t) => ({ key: t.key, score: scoreRiderType(abilities, t.weights, baseline) }));
  scored.sort((a, b) => b.score - a.score);
  return { primary: scored[0], secondary: scored[1] };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaselineYouth.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const N = parseInt(arg("n", "3000"), 10);
const SEED = parseInt(arg("seed", "2026"), 10);
const REFERENCE_YEAR = 2026;

// Samme ejer-defineret knaphedsmål som scorecard3570YouthBaseline.mjs (#3564-kæden).
const SCARCITY_TARGET_PCT = Object.freeze({
  baroudeur: 11, climber: 17, sprinter: 15, tt: 9,
  puncheur: 13, gc: 9, brostensrytter: 9, rouleur: 17,
});

// ── FASE 2-kæde (EFTER): caps formes DIREKTE af det trukne anlæg ────────────────
function buildPhase2Record({ riderRow, archetypeDraw, id }) {
  const rr = { id, ...riderRow };
  const physiology = seedPhysiologyFromLegacy(rr);
  const abilities = deriveAbilities(physiology, rr);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const age = REFERENCE_YEAR - Number(String(rr.birthdate).slice(0, 4));
  const caps = buildCapsForRider(baseline, { potentiale: rr.potentiale, age }, archetypeDraw.primary, archetypeDraw.secondary);
  const final = computeRiderTypes(caps, youthBaseline);
  const youthCaps = buildYouthCaps(rr.potentiale, archetypeDraw.primary, archetypeDraw.secondary);
  const physVals = PHYSICAL_ABILITIES.map((a) => Number(abilities[a]) || 0).sort((a, b) => b - a);
  return {
    id, age, potentiale: rr.potentiale,
    primaryType: final.primary.key, secondaryType: final.secondary.key,
    archetypeDraw,
    abilities, caps, youthCaps, bestPhysical: physVals[0] ?? 0,
  };
}

function runPhase2Cohort(n, seed) {
  const rng = makeRng(seed);
  const candidates = generateAcademyCandidates({ rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: n });
  return candidates.map((c, i) => buildPhase2Record({ riderRow: c.rider, archetypeDraw: c.archetypeDraw, id: `p2-${i}` }));
}

// ── FASE 1-kæde (FØR): caps formes af BOOTSTRAP-gættet, klassificeret med den
// LEGACY gc-guard (denne PR sletter guarden — se LEGACY_GC_GUARD ovenfor for hvorfor
// FØR-linjen ikke kan bruge den nuværende lib/riderTypes.js direkte). Isolerer
// PRÆCIS de to variabler fase 2 ændrer (draw-vs-bootstrap-caps OG guard-tilstede-vs-
// slettet) i ÉN FØR/EFTER-sammenligning, tro mod den dokumenterede 9/8-defekt.
function runPhase1Cohort(n, seed) {
  const rng = makeRng(seed);
  const candidates = generateAcademyCandidates({ rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: n });
  return candidates.map((c, i) => {
    const rr = { id: `p1-${i}`, ...c.rider };
    const physiology = seedPhysiologyFromLegacy(rr);
    const abilities = deriveAbilities(physiology, rr);
    const bootstrap = legacyComputeRiderTypes(abilities, NEUTRAL_BASELINE);
    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
    const age = REFERENCE_YEAR - Number(String(rr.birthdate).slice(0, 4));
    const caps = buildCapsForRider(baseline, { potentiale: rr.potentiale, age }, bootstrap.primary.key, bootstrap.secondary.key);
    const final = legacyComputeRiderTypes(caps, youthBaseline);
    const youthCaps = buildYouthCaps(rr.potentiale, bootstrap.primary.key, bootstrap.secondary.key);
    const physVals = PHYSICAL_ABILITIES.map((a) => Number(abilities[a]) || 0).sort((a, b) => b - a);
    return {
      id: rr.id, age, potentiale: rr.potentiale,
      primaryType: final.primary.key, secondaryType: final.secondary.key,
      archetypeDraw: c.archetypeDraw,
      abilities, caps, youthCaps, bestPhysical: physVals[0] ?? 0,
    };
  });
}

// ── G1 (total + pr. trukket anlæg) + G4 ──────────────────────────────────────────
function g1AndG4(records) {
  let hits = 0;
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  const perArchetype = {}; // { archetype: { n, hits } }
  for (const r of records) {
    const key = r.primaryType;
    dist[key]++;
    const { primary, secondary, isHybrid } = r.archetypeDraw;
    const hit = isHybrid ? (key === primary || key === secondary) : key === primary;
    if (hit) hits++;
    if (!perArchetype[primary]) perArchetype[primary] = { n: 0, hits: 0 };
    perArchetype[primary].n++;
    if (key === primary) perArchetype[primary].hits++;
  }
  const distPct = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, (dist[t] / records.length) * 100]));
  const g4Violations = RIDER_TYPE_KEYS.filter((t) => distPct[t] < 5 || distPct[t] > 30);
  return { g1: (hits / records.length) * 100, distPct, g4Violations, perArchetype };
}

function printReport(label, records) {
  const res = g1AndG4(records);
  console.log(`\n${label}`);
  console.log(`  G1 total (arketype-genfinding): ${res.g1.toFixed(1)} %`);
  console.log("  G1 pr. TRUKKET primær-anlæg:");
  for (const t of RIDER_TYPE_KEYS) {
    const p = res.perArchetype[t];
    if (!p) { console.log(`    ${t.padEnd(15)}  n=0`); continue; }
    console.log(`    ${t.padEnd(15)} ${((p.hits / p.n) * 100).toFixed(1).padStart(5)} %  (n=${p.n}, hits=${p.hits})`);
  }
  console.log(`  G4 (fordeling 5-30% pr. type): ${res.g4Violations.length === 0 ? "OK ✓" : `BRUD på ${res.g4Violations.join(", ")}`}`);
  for (const t of RIDER_TYPE_KEYS) {
    const got = res.distPct[t];
    const target = SCARCITY_TARGET_PCT[t];
    const diff = got - target;
    console.log(`    ${t.padEnd(15)} ${got.toFixed(1).padStart(5)}%  (mål ${String(target).padStart(2)}%, diff ${diff >= 0 ? "+" : ""}${diff.toFixed(1)})`);
  }
  return res;
}

console.log(`=== #3570 fase 2 scorecard (n=${N}, seed=${SEED}) ===`);
const before = runPhase1Cohort(N, SEED); // fase 1 (PR #3571): bootstrap-drevne caps
const after = runPhase2Cohort(N, SEED);  // fase 2 (denne PR): archetype_draw-drevne caps

const resBefore = printReport("FØR (fase 1 — bootstrap-drevne caps, GC-guard aktiv)", before);
const resAfter = printReport("EFTER (fase 2 — archetype_draw-drevne caps, GC-guard slettet)", after);

// ── I1/I2/I3 (de omdøbte 9/8-invarianter, uændrede semantikker) ─────────────────
console.log("\n=== I1/I2/I3 (fase 2, EFTER) ===");
for (const gate of [gateI1CapsWithinPotentialLoft, gateI2YouthBandCeiling, gateI3GraduationLevelTail]) {
  const r = gate(after);
  console.log(`  ${r.pass ? "✓" : "✗"} ${r.id} — ${r.navn}: ${r.målt} (grænse ${r.grænse})`);
}

console.log("\n=== NEGATIV-TEST ===");
const beforeGc = resBefore.perArchetype.gc;
const afterGc = resAfter.perArchetype.gc;
console.log(
  (beforeGc ? (beforeGc.hits / beforeGc.n) * 100 : 0) < 5
    ? `✓ FØR viser den kendte gc-defekt (${beforeGc ? ((beforeGc.hits / beforeGc.n) * 100).toFixed(1) : "0.0"}% af de trukne gc-anlæg genfindes, forventet ~0%)`
    : `✗ UVENTET: FØR genfinder ${beforeGc ? ((beforeGc.hits / beforeGc.n) * 100).toFixed(1) : "0.0"}% gc — forventede den kendte defekt (~0%). Undersøg om fase 1-kæden er ændret.`
);
console.log(
  afterGc && (afterGc.hits / afterGc.n) * 100 > (beforeGc ? (beforeGc.hits / beforeGc.n) * 100 : 0)
    ? `✓ EFTER retter gc-defekten markant: ${beforeGc ? ((beforeGc.hits / beforeGc.n) * 100).toFixed(1) : "0.0"}% → ${((afterGc.hits / afterGc.n) * 100).toFixed(1)}%`
    : `✗ TUNING-ALARM: EFTER forbedrer IKKE gc-genfinding ift. FØR — stop og undersøg.`
);
if (resAfter.g4Violations.length > 0) {
  console.log(`⚠ ÆRLIGT MISS: G4 består IKKE fuldt ud efter fase 2 — stadig brud på: ${resAfter.g4Violations.join(", ")}.`);
}
