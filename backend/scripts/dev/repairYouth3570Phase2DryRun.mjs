#!/usr/bin/env node
// #3570 fase 2 — SAMLET reparations-dry-run for de 2.356 eksisterende unge (16-21).
// Ejer-beslutning: ÉN kørsel (ikke to), ny label + gen-formede lofter i samme pas,
// INGEN mutation (læser en dateret snapshot, skriver kun til scratchpad).
//
// For hver rytter:
//   (a) NY LABEL = computeRiderTypes(EKSISTERENDE ability_caps, ungdoms-baseline)
//       — guard-sletningen (isGc-blokken fjernet fra riderTypes.js) er allerede
//       aktiv i denne worktree, så gc bliver nu et muligt resultat for gamle ryttere.
//   (b) GEN-FORMEDE LOFTER = buildCapsForRider(NUVÆRENDE abilities, {potentiale},
//       nyPrimær, nySekundær) — samme kald-form som backfillCores.js's
//       deriveForRiderIds bruger til re-derive af eksisterende ryttere (ingen alder
//       sendes med, matcher produktionsstien for eksisterende/strandede ryttere).
//
// Input:  scratchpad/snap-3570-reclass/youth_16_21_full.json (snapshottet 15-evne-
//         sæt — original-snapshottet manglede tactics/positioning, suppleret fra
//         live DB, se tactics_positioning_map.json + merge-scriptet i samme mappe).
// Output: scratchpad/snap-3570-reclass/fase2/reparations-dryrun.json (rådata) +
//         reparations-dryrun.md (ejer-klar rapport).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "../../lib/riderProgression.js";
import { computeRiderTypes, RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import { gateI1CapsWithinPotentialLoft } from "./lib/progressionGates3564.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/5ea4d8d3-1258-4104-a2c6-9f902b84d615/scratchpad/snap-3570-reclass";
const OUT_DIR = join(SNAP_DIR, "fase2");
mkdirSync(OUT_DIR, { recursive: true });

const adultBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaselineYouth.json"), "utf8"));
const v4Model = JSON.parse(readFileSync(join(__dirname, "../../lib/riderValuationModelV4.json"), "utf8"));

const riders = JSON.parse(readFileSync(join(SNAP_DIR, "youth_16_21_full.json"), "utf8"));

const PHYSICAL = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];
const TECHNICAL = ["descending", "cobblestone", "positioning"];
const MENTAL = ["aggression", "tactics"];
const CATEGORY_OF = Object.fromEntries([
  ...PHYSICAL.map((a) => [a, "physical"]),
  ...TECHNICAL.map((a) => [a, "technical"]),
  ...MENTAL.map((a) => [a, "mental"]),
]);

const median = (vals) => {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const p90 = (vals) => {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
};
const max = (vals) => {
  const s = vals.filter(Number.isFinite);
  return s.length ? Math.max(...s) : null;
};

const records = [];
let floorViolationCount = 0;
const floorViolationExamples = [];

for (const r of riders) {
  const oldPrimary = r.primary_type;
  const oldSecondary = r.secondary_type;
  const oldCaps = r.ability_caps;

  const currentAbilities = {};
  for (const k of VISIBLE_ABILITIES) if (r.abilities[k] != null) currentAbilities[k] = Number(r.abilities[k]);

  const rowModel = selectTypesBaseline(r.age, adultBaseline, youthBaseline);
  const newTypes = computeRiderTypes(oldCaps, rowModel);
  const newPrimary = newTypes.primary.key;
  const newSecondary = newTypes.secondary.key;

  const newCaps = buildCapsForRider(currentAbilities, { potentiale: r.potentiale }, newPrimary, newSecondary);

  // Spiller-beskyttelse: må ALDRIG sænke cap under nuværende evne.
  const floorBreaks = [];
  for (const a of VISIBLE_ABILITIES) {
    if (newCaps[a] < currentAbilities[a]) floorBreaks.push({ ability: a, cap: newCaps[a], current: currentAbilities[a] });
  }
  if (floorBreaks.length > 0) {
    floorViolationCount++;
    if (floorViolationExamples.length < 10) {
      floorViolationExamples.push({ rider_id: r.rider_id, name: `${r.firstname} ${r.lastname}`, floorBreaks });
    }
  }

  // I1-gate-input: max cap må aldrig overstige max(youthCaps) for det NYE anlæg.
  const youthCapsForGate = buildYouthCaps(r.potentiale, newPrimary, newSecondary);

  // Loft-rating (scouting-visning) for gammelt hhv. nyt primær-type mod hhv. gammel/ny caps.
  const ceilOldForOldType = ratingFromAbilities(oldCaps, oldPrimary);
  const ceilNewForNewType = ratingFromAbilities(newCaps, newPrimary);
  const ceilNewForOldType = ratingFromAbilities(newCaps, oldPrimary); // samme type, nye caps — isolerer caps-effekten alene

  // Kontrafaktisk værdi: HVIS valuation_type senere synkes til den nye type.
  const cfRider = { ...r, valuation_type: newPrimary, age: r.age, potentiale: r.potentiale };
  const cfBaseValue = predictBaseValue(cfRider, currentAbilities, v4Model);

  records.push({
    rider_id: r.rider_id,
    name: `${r.firstname} ${r.lastname}`,
    age: r.age,
    potentiale: r.potentiale,
    owner_kind: r.owner_kind,
    manager: r.manager_display_name,
    is_academy: r.is_academy,
    oldPrimary, oldSecondary, newPrimary, newSecondary,
    typeChanged: oldPrimary !== newPrimary,
    oldCaps, newCaps,
    capDelta: Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, newCaps[a] - (oldCaps[a] ?? 0)])),
    floorBreaks,
    caps: newCaps,
    youthCaps: youthCapsForGate,
    ceilOldForOldType, ceilNewForNewType, ceilNewForOldType,
    actualBaseValue: r.base_value,
    actualMarketValue: r.market_value,
    valuationType: r.valuation_type,
    counterfactualBaseValue: cfBaseValue,
  });
}

// ── Type-skift-matrix ────────────────────────────────────────────────────────
function buildMatrix(recs) {
  const m = {};
  for (const t of RIDER_TYPE_KEYS) m[t] = Object.fromEntries(RIDER_TYPE_KEYS.map((t2) => [t2, 0]));
  for (const r of recs) {
    if (!m[r.oldPrimary]) m[r.oldPrimary] = Object.fromEntries(RIDER_TYPE_KEYS.map((t2) => [t2, 0]));
    m[r.oldPrimary][r.newPrimary] = (m[r.oldPrimary][r.newPrimary] || 0) + 1;
  }
  return m;
}
const matrixTotal = buildMatrix(records);
const matrixHuman = buildMatrix(records.filter((r) => r.owner_kind === "human"));

function shareDist(recs, field) {
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of recs) dist[r[field]] = (dist[r[field]] || 0) + 1;
  const n = recs.length || 1;
  return Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, { n: dist[t], pct: (dist[t] / n) * 100 }]));
}
const distBeforeTotal = shareDist(records, "oldPrimary");
const distAfterTotal = shareDist(records, "newPrimary");
const humanRecs = records.filter((r) => r.owner_kind === "human");
const distBeforeHuman = shareDist(humanRecs, "oldPrimary");
const distAfterHuman = shareDist(humanRecs, "newPrimary");

// ── Caps-diff-fordeling pr. evne + kategori ──────────────────────────────────
const perAbilityDiff = {};
for (const a of VISIBLE_ABILITIES) {
  const deltas = records.map((r) => r.capDelta[a]);
  const increases = deltas.filter((d) => d > 0);
  const decreases = deltas.filter((d) => d < 0).map((d) => -d);
  perAbilityDiff[a] = {
    category: CATEGORY_OF[a],
    nIncreased: increases.length,
    nDecreased: decreases.length,
    nUnchanged: deltas.length - increases.length - decreases.length,
    increaseMedian: median(increases), increaseP90: p90(increases), increaseMax: max(increases),
    decreaseMedian: median(decreases), decreaseP90: p90(decreases), decreaseMax: max(decreases),
  };
}
const perCategoryDiff = {};
for (const cat of ["physical", "technical", "mental"]) {
  const abilities = VISIBLE_ABILITIES.filter((a) => CATEGORY_OF[a] === cat);
  const allDeltas = [];
  for (const r of records) for (const a of abilities) allDeltas.push(r.capDelta[a]);
  const increases = allDeltas.filter((d) => d > 0);
  const decreases = allDeltas.filter((d) => d < 0).map((d) => -d);
  perCategoryDiff[cat] = {
    nIncreased: increases.length, nDecreased: decreases.length,
    increaseMedian: median(increases), increaseP90: p90(increases), increaseMax: max(increases),
    decreaseMedian: median(decreases), decreaseP90: p90(decreases), decreaseMax: max(decreases),
  };
}

// ── Store spillervendte udsving (>=20 point på én evne) ──────────────────────
const BIG_SWING_THRESHOLD = 20;
const bigSwings = [];
for (const r of records) {
  for (const a of VISIBLE_ABILITIES) {
    const d = r.capDelta[a];
    if (Math.abs(d) >= BIG_SWING_THRESHOLD) {
      bigSwings.push({ rider_id: r.rider_id, name: r.name, manager: r.manager, owner_kind: r.owner_kind, ability: a, old: r.oldCaps[a], new: r.newCaps[a], delta: d });
    }
  }
}
bigSwings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

// ── Loft-reduktion (cap < gammel cap, IKKE et gulv-brud) ─────────────────────
let ridersWithAnyReduction = 0;
const reductionMagnitudesPerRider = [];
for (const r of records) {
  const reductions = VISIBLE_ABILITIES.map((a) => -r.capDelta[a]).filter((d) => d > 0);
  if (reductions.length) {
    ridersWithAnyReduction++;
    reductionMagnitudesPerRider.push(Math.max(...reductions));
  }
}

// ── I1-gate (0 brud, ellers rødt flag) ────────────────────────────────────────
const i1 = gateI1CapsWithinPotentialLoft(records.map((r) => ({ id: r.rider_id, potentiale: r.potentiale, caps: r.caps, youthCaps: r.youthCaps })));

// ── Værdi-tjek: frysningen holder (valuation_type urørt) + kontrafaktisk delta ──
const cfDeltas = records
  .filter((r) => r.counterfactualBaseValue != null && r.actualBaseValue != null)
  .map((r) => ({ ...r, delta: r.counterfactualBaseValue - r.actualBaseValue, deltaPct: (r.counterfactualBaseValue - r.actualBaseValue) / r.actualBaseValue * 100 }));
const cfDeltaAbsPct = cfDeltas.map((r) => Math.abs(r.deltaPct));
const cfTypeChangedOnly = cfDeltas.filter((r) => r.typeChanged);
const cfBig = cfDeltas.filter((r) => Math.abs(r.deltaPct) >= 20).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

// ── Pr. manager (human only) ──────────────────────────────────────────────────
const byManager = new Map();
for (const r of humanRecs) {
  const key = r.manager || "(ukendt)";
  if (!byManager.has(key)) byManager.set(key, { manager: key, riders: 0, typeChanged: 0, anyCapMoved: 0, anyCapReduced: 0, bigSwings: 0 });
  const m = byManager.get(key);
  m.riders++;
  if (r.typeChanged) m.typeChanged++;
  const anyMoved = VISIBLE_ABILITIES.some((a) => r.capDelta[a] !== 0);
  if (anyMoved) m.anyCapMoved++;
  const anyReduced = VISIBLE_ABILITIES.some((a) => r.capDelta[a] < 0);
  if (anyReduced) m.anyCapReduced++;
  m.bigSwings += VISIBLE_ABILITIES.filter((a) => Math.abs(r.capDelta[a]) >= BIG_SWING_THRESHOLD).length;
}
const managerRows = [...byManager.values()].sort((a, b) => b.typeChanged - a.typeChanged || b.riders - a.riders);

// ── Ratingsvisning (scouting/progression-bar) ─────────────────────────────────
const ceilShiftsForUnchangedType = records
  .filter((r) => !r.typeChanged)
  .map((r) => r.ceilNewForOldType - r.ceilOldForOldType);
const ceilShiftAbs = ceilShiftsForUnchangedType.map(Math.abs);

// ── Skriv output ───────────────────────────────────────────────────────────
const summary = {
  n: records.length,
  typeChangedTotal: records.filter((r) => r.typeChanged).length,
  typeChangedHuman: humanRecs.filter((r) => r.typeChanged).length,
  matrixTotal, matrixHuman,
  distBeforeTotal, distAfterTotal, distBeforeHuman, distAfterHuman,
  gcBefore: { total: distBeforeTotal.gc, human: distBeforeHuman.gc },
  gcAfter: { total: distAfterTotal.gc, human: distAfterHuman.gc },
  baroudeurBefore: { total: distBeforeTotal.baroudeur, human: distBeforeHuman.baroudeur },
  baroudeurAfter: { total: distAfterTotal.baroudeur, human: distAfterHuman.baroudeur },
  rouleurBefore: { total: distBeforeTotal.rouleur, human: distBeforeHuman.rouleur },
  rouleurAfter: { total: distAfterTotal.rouleur, human: distAfterHuman.rouleur },
  perAbilityDiff, perCategoryDiff,
  bigSwingCount: bigSwings.length,
  bigSwingRiderCount: new Set(bigSwings.map((s) => s.rider_id)).size,
  floorViolationCount, floorViolationExamples,
  ridersWithAnyReduction,
  reductionMedian: median(reductionMagnitudesPerRider),
  reductionP90: p90(reductionMagnitudesPerRider),
  reductionMax: max(reductionMagnitudesPerRider),
  i1,
  cfDeltaCount: cfDeltas.length,
  cfDeltaAbsPctMedian: median(cfDeltaAbsPct),
  cfDeltaAbsPctP90: p90(cfDeltaAbsPct),
  cfDeltaAbsPctMax: max(cfDeltaAbsPct),
  cfBigCount: cfBig.length,
  cfTypeChangedOnlyCount: cfTypeChangedOnly.length,
  ceilShiftUnchangedTypeMedian: median(ceilShiftAbs),
  ceilShiftUnchangedTypeP90: p90(ceilShiftAbs),
  ceilShiftUnchangedTypeMax: max(ceilShiftAbs),
  managerRowsTop: managerRows.slice(0, 15),
  managerRowsCount: managerRows.length,
};

writeFileSync(join(OUT_DIR, "reparations-dryrun.json"), JSON.stringify({ summary, bigSwingsTop50: bigSwings.slice(0, 50), cfBigTop30: cfBig.slice(0, 30), records }, null, 2));

console.log(JSON.stringify(summary, null, 2));
