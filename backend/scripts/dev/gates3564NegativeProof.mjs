#!/usr/bin/env node
// #3564 — NEGATIV-TEST AF PORTE: beviser at hver ny port (progressionGates3564.mjs) rent
// faktisk FEJLER på en kendt defekt, og BESTÅR på en sund reference-population (F5).
// En port der ikke kan fejle på en kendt defekt er ikke en port (design-princip 5).
//
// Fixtures:
//   F1  DEFEKT 7/8-CONFIG      — akademi-kæden med den faktiske 7/8-konfiguration (#3561).
//   F2  NUVÆRENDE CONFIG        — akademi-kæden UÆNDRET (9/8-underkorrektionen i bunden).
//   F3  NUVÆRENDE VÆKSTMOTOR    — livscyklus-sim 16→24 med dagens dailyTraining/riderProgression.
//   F4  PROD-STOCK               — den målte 9/8-beholdningsfordeling (§3), hårdkodet.
//   F5  SUND SKELET-POPULATION — håndbygget, IKKE tunet generator-output (design-princip 8:
//       "tun ALDRIG for at bestå en gate" — F5 er en referencepopulation, ikke en kalibrering).
//   F6  ADULT-PATH-DEFEKT (supplerende, ud over OPGAVEns F1-F5) — syntetisk voksen-genereret
//       population med evner over loftet, til T3-N2 (som IKKE dækkes af akademi-kæden).
//   F7  VÆRDI/LØN-DEFEKT (supplerende) — syntetiske {før,efter}-værdi/løn-arrays med kendte
//       brud, til T4-N1/T4-H1 (som opererer på abstrakte værdi-arrays, ikke generator-output).
//
// KØR: node scripts/dev/gates3564NegativeProof.mjs
// OUTPUT: matrix-tabel til stdout + JSON til scripts/dev/gates-matrix-3564.json (se
// bundnote i node-scriptets afslutning — ingen delt scratch-sti var oplyst i opgaven).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { drawPotentiale, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { YOUTH_PROGRESSION_CONFIG } from "../../lib/riderProgression.js";

import {
  deriveCohort, PHYSICAL_ABILITIES, median, loftForPotential,
  gateI1CapsWithinPotentialLoft, gateI2YouthBandCeiling, gateI3GraduationLevelTail,
  gateT1N2P99CapsPerTier, gateT1N3PostRemapDistribution, gateT1H1PotentialeTail,
  gateT2N1AntiFrontloading, gateT2M1MedianAtAnchors, gateT2H1ZeroGapAt21, gateT2H2Over85PctBeforeAge24,
  gateT3M1TwoSidedBands, gateT3N2AdultPathsWithinLoft,
  gateT4N1ValueTotalAndCap, gateT4H1ValueMovementAndSalary,
} from "./lib/progressionGates3564.mjs";
import { buildCapsForRider, buildYouthCaps } from "../../lib/riderProgression.js";
import { simulateLifecyclePopulation } from "./lib/lifecycleSim3564.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "riderTypesBaseline.json"), "utf8"));

// ════════════════════════════════════════════════════════════════════════════════
// F1 — DEFEKT 7/8-CONFIG (#3561): den faktiske deployede konfiguration 7/8-9/8.
// ════════════════════════════════════════════════════════════════════════════════
const F1_DEFECT_GENCFG_PATCH = Object.freeze({
  signatureBoostPerWeight: 15,
  statCeilBoosted: 99,
  dampPerWeight: 2.6,
  startLuckSd: 1.2,
});

function buildF1() {
  const rng = makeRng(20260709);
  // MERGE med YOUTH_GEN_CONFIG (patch er KUN de 4 ændrede nøgler, jf. OPGAVE-teksten
  // "resten = nuværende YOUTH_GEN_CONFIG") — genCfg-parameteren i generateAcademyCandidates
  // ERSTATTER hele config-objektet, den fletter ikke selv (samme mønster som
  // checkYouthBand2064.mjs's `{ ...YOUTH_GEN_CONFIG, ...patch }`).
  const genCfg = Object.freeze({ ...YOUTH_GEN_CONFIG, ...F1_DEFECT_GENCFG_PATCH });
  return deriveCohort({ rng, referenceYear: 2026, count: 3000, genCfg, typesBaseline, idPrefix: "f1" });
}

// ════════════════════════════════════════════════════════════════════════════════
// F2 — NUVÆRENDE CONFIG (uændret YOUTH_GEN_CONFIG): 9/8-underkorrektionen i bunden.
// ════════════════════════════════════════════════════════════════════════════════
function buildF2() {
  const rng = makeRng(20260810);
  return deriveCohort({ rng, referenceYear: 2026, count: 3000, typesBaseline, idPrefix: "f2" }); // genCfg udeladt = default
}

// ════════════════════════════════════════════════════════════════════════════════
// F3 — NUVÆRENDE VÆKSTMOTOR: livscyklus-sim 16→24 med dagens dailyTraining/
// riderProgression (frontloading — se lifecycleSim3564.mjs for modelforudsætninger).
// ════════════════════════════════════════════════════════════════════════════════
function buildF3() {
  return simulateLifecyclePopulation({ tiers: [1, 2, 3, 4, 5, 6], perTier: 40, startAge: 16, endAge: 24 });
}

// ════════════════════════════════════════════════════════════════════════════════
// F4 — PROD-STOCK: den DATEREDE 9/8-beholdningsfordeling (snapshot 2026-08-09 14:50
// CEST, snapshot-3564-progression-chain.mjs mod prod ghwvkxzhsbbltzfnuhhz): 248 pot-6
// + 713 pot-5 af 8.153 levende ryttere. (Spec §3's morgental var 8.186 — samme
// top-tiers, -33 i total = normal drift.) Kun de to top-tiers' EKSAKTE tal bruges —
// resten (7.192) fyldes med pot-1 (påvirker IKKE T1-H1's hale-tælling, som kun
// tæller >= threshold, men holder n=8.153 retvisende for σ-beregningen).
// ════════════════════════════════════════════════════════════════════════════════
function buildF4() {
  const values = [];
  for (let i = 0; i < 248; i++) values.push(6.0);
  for (let i = 0; i < 713; i++) values.push(5.0);
  const rest = 8153 - 248 - 713;
  for (let i = 0; i < rest; i++) values.push(1.0);
  return values;
}

// ════════════════════════════════════════════════════════════════════════════════
// F5 — SUND SKELET-POPULATION: HÅNDBYGGET reference (design-princip 8 — porte må ALDRIG
// bestås ved at tune generator-konstanter; F5 tester GATERNE, ikke generatoren).
// Komponeret af separate under-populationer, fordi gaterne selv opererer på strukturelt
// forskellige input-former (generator-kohorte vs. alders-trajektorie vs. værdi-array) —
// se resultat-teksten for hvorfor ÉN fælles population ikke er meningsfuld her.
// ════════════════════════════════════════════════════════════════════════════════

// F5a — generator-kohorte for I1/I2/I3/T1-N2/T3-M1: matcher §2a's population-brede
// bånd-medianer (kerne/bedste), potentiale trukket fra den ÆGTE geometriske fordeling.
const BAND_VALUE_TEMPLATE = Object.freeze({
  "16-17": [1, 1, 2, 2, 3, 3, 4, 4, 5, 6],
  "18-19": [4, 5, 6, 7, 8, 8, 9, 10, 11, 12],
  "20-21": [12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
});
function bandOf(age) { return age <= 17 ? "16-17" : age <= 19 ? "18-19" : "20-21"; }

function buildF5aGeneratorCohort(n = 3000) {
  const rng = makeRng(555);
  const records = [];
  for (let i = 0; i < n; i++) {
    const potentiale = drawPotentiale(rng);
    const age = 16 + Math.floor(rng() * 6); // uniform 16-21 (ACADEMY.MIN/MAX_AGE)
    const template = BAND_VALUE_TEMPLATE[bandOf(age)];
    // Beskeden per-rytter jitter (global profil-shift {-1,0,0,0,+1}) for variation uden
    // at flytte bånd-medianen (design-princip: håndbygget reference, ikke en tunet gate).
    const shift = [-1, 0, 0, 0, 1][Math.floor(rng() * 5)];
    const values = template.map((v) => Math.max(1, Math.min(20, v + shift)));
    const abilities = {};
    PHYSICAL_ABILITIES.forEach((k, idx) => { abilities[k] = values[idx]; });
    const primaryType = "climber", secondaryType = null;
    const caps = buildCapsForRider(abilities, { potentiale, age }, primaryType, secondaryType);
    const youthCaps = buildYouthCaps(potentiale, primaryType, secondaryType);
    const sorted = [...values].sort((a, b) => b - a);
    const bestPhysical = sorted[0], secondBestPhysical = sorted[1];
    const corePhysical = median(values);
    const loft = Math.max(...Object.values(youthCaps));
    records.push({
      id: `f5a-${i}`, age, potentiale, primaryType, secondaryType,
      abilities, caps, youthCaps, bestPhysical, secondBestPhysical, corePhysical,
      loft, ratio: loft ? bestPhysical / loft : 0,
    });
  }
  return records;
}

// F5b — alders-trajektorie for T2-N1/T2-M1/T2-H1/T2-H2: bygget DIREKTE på §5-skelettet
// (piecewise-lineær mellem 16/22/28-ankrene, fladt derefter), IKKE simuleret via motoren.
function skeletonTarget(potentiale, age) {
  const anchors = { 1: [4, 22, 33], 2: [5, 29, 45], 3: [6, 36, 57], 4: [6, 42, 67], 5: [6, 48, 77], 6: [6, 53, 86] };
  const [a16, a22, a28] = anchors[potentiale];
  if (age <= 16) return a16;
  if (age <= 22) return a16 + (a22 - a16) * ((age - 16) / 6);
  if (age <= 28) return a22 + (a28 - a22) * ((age - 22) / 6);
  return a28;
}
function buildF5bGrowthTrajectory({ perAgeTier = 20 } = {}) {
  const rng = makeRng(556);
  const records = [];
  for (const potentiale of [1, 2, 3, 4, 5, 6]) {
    const loft = YOUTH_PROGRESSION_CONFIG.loftByPotential[potentiale];
    for (let age = 16; age <= 28; age++) {
      const target = skeletonTarget(potentiale, age);
      for (let i = 0; i < perAgeTier; i++) {
        const noise = (rng() - 0.5) * 2; // ±1 point jitter
        const bestPhysical = Math.max(1, Math.min(loft, Math.round(target + noise)));
        const gap = 2 + Math.floor(rng() * 3); // 2-4 point specialiserings-gab, aldrig nul
        const secondBestPhysical = Math.max(1, bestPhysical - gap);
        records.push({
          id: `f5b-${potentiale}-${age}-${i}`, potentiale, age, bestPhysical, secondBestPhysical,
          loft, ratio: loft ? bestPhysical / loft : 0,
        });
      }
    }
  }
  return records;
}

// F5c — potentiale-hale (flow+stock): den ÆGTE geometriske trækfordeling, uændret.
function buildF5cFlow(n = 3000) {
  const rng = makeRng(557);
  const values = [];
  for (let i = 0; i < n; i++) values.push(drawPotentiale(rng));
  return values;
}

// F5d — voksen-generator-sti (T3-N2): syntetisk, alle evner sikkert under loft.
function buildF5dAdultPaths(n = 500) {
  const rng = makeRng(558);
  const records = [];
  for (let i = 0; i < n; i++) {
    const potentiale = drawPotentiale(rng);
    // Brug SAMME loftForPotential (rundet interpolation) som gaten selv bruger — en anden
    // (afrundings-)formel her ville give falske brud på halve tiers, se progressionGates3564.mjs.
    const loft = loftForPotential(potentiale, YOUTH_PROGRESSION_CONFIG.loftByPotential);
    records.push({ id: `f5d-${i}`, potentiale, generatedAbility: Math.round(loft * (0.5 + rng() * 0.35)) }); // 50-85% af loft, sikkert under
  }
  return records;
}

// F5e — værdi/løn (T4): 0 %-diff før/efter + alle salær-gates inden for grænser.
function buildF5eValueSalary() {
  const before = Array.from({ length: 200 }, (_, i) => 3000 + (i % 50) * 400);
  const after = [...before]; // ingen ændring — total-diff 0 %, p99-bevægelse 0 %
  const ageGroups = ["u21", "22-27", "28-33", "34+"];
  const beforeByAgeGroup = {}, afterByAgeGroup = {};
  ageGroups.forEach((g, gi) => {
    const slice = before.slice(gi * 50, gi * 50 + 50);
    beforeByAgeGroup[g] = slice; afterByAgeGroup[g] = slice;
  });
  const salaries = before.map((v) => ({ salary: Math.max(250, Math.round(v * 0.04)), value: v }));
  return { before, after, beforeByAgeGroup, afterByAgeGroup, salaries };
}

// ════════════════════════════════════════════════════════════════════════════════
// F6 (supplerende) — ADULT-PATH-DEFEKT: syntetisk voksen-genereret population hvor
// evner OVERSTIGER loftByPotential[pot] — den defekt T3-N2 findes for at fange, og som
// hverken F1-F5 (akademi-/vækst-/stock-baserede) demonstrerer.
// ════════════════════════════════════════════════════════════════════════════════
function buildF6AdultPathDefect(n = 300) {
  const rng = makeRng(600);
  const records = [];
  for (let i = 0; i < n; i++) {
    const potentiale = drawPotentiale(rng);
    const loft = loftForPotential(potentiale, YOUTH_PROGRESSION_CONFIG.loftByPotential);
    records.push({ id: `f6-${i}`, potentiale, generatedAbility: Math.round(loft * (1.05 + rng() * 0.3)) }); // 105-135% af loft
  }
  return records;
}

// F4b (supplerende, "flow"-skala af F4's stock-defekt): et ENKELT kuld (n=300) hvor et
// scouting-/importbrud har banket 9 ryttere op på pot-6 — samme fænomen som F4, men
// pr. kuld i stedet for beholdning, så T1-H1's to labels ("flow" vs "stock") begge har
// en defekt-fixture at fejle på (OPGAVE: "Kør både pr. kuld og på beholdning").
function buildF4bFlowDefect(n = 300, injected = 9) {
  const rng = makeRng(601);
  const values = [];
  for (let i = 0; i < n - injected; i++) values.push(drawPotentiale(rng));
  for (let i = 0; i < injected; i++) values.push(6.0);
  return values;
}

// ════════════════════════════════════════════════════════════════════════════════
// F7 (supplerende) — VÆRDI/LØN-DEFEKT: total flytter +18 % (over ±5%), én rytter
// eksploderer til et outlier-loft-brud, p99 for u21-gruppen flytter 60 % (over 25 %),
// en løn under gulvet, og løn/værdi ramte den kendte 111 %-p90-outlier (#3561-læringen).
// ════════════════════════════════════════════════════════════════════════════════
function buildF7ValueSalaryDefect() {
  const before = Array.from({ length: 200 }, (_, i) => 3000 + (i % 50) * 400);
  const after = before.map((v, i) => (i === 0 ? 42_000_000 : Math.round(v * 1.18))); // outlier + samlet +18%
  const ageGroups = ["u21", "22-27", "28-33", "34+"];
  const beforeByAgeGroup = {}, afterByAgeGroup = {};
  ageGroups.forEach((g, gi) => {
    const bSlice = before.slice(gi * 50, gi * 50 + 50);
    const aSlice = after.slice(gi * 50, gi * 50 + 50);
    beforeByAgeGroup[g] = bSlice;
    afterByAgeGroup[g] = gi === 0 ? aSlice.map((v) => v * 1.6) : aSlice; // u21 p99 flytter 60%
  });
  const salaries = before.map((v, i) => ({ salary: i === 1 ? 100 : Math.round(v * 0.04), value: v })); // salary[1] under gulv 250
  salaries[2] = { salary: Math.round(salaries[2].value * 1.11), value: salaries[2].value }; // 111%-outlieren (#3561)
  return { before, after, beforeByAgeGroup, afterByAgeGroup, salaries };
}

// ════════════════════════════════════════════════════════════════════════════════
// PORT-MATRIX: (gate-funktion + fixture-udtræk) pr. fixture. n/a = fixturen giver ikke
// den datatype porten kræver (fx værdi-arrays vs. generator-records).
// ════════════════════════════════════════════════════════════════════════════════

function runMatrix() {
  console.log("Bygger fixtures …");
  const F1 = buildF1();
  const F2 = buildF2();
  const F3 = buildF3();
  const F4 = buildF4();
  const F5a = buildF5aGeneratorCohort();
  const F5b = buildF5bGrowthTrajectory();
  const F5c = buildF5cFlow();
  const F5d = buildF5dAdultPaths();
  const F5e = buildF5eValueSalary();
  const F6 = buildF6AdultPathDefect();
  const F7 = buildF7ValueSalaryDefect();
  const F4b = buildF4bFlowDefect();
  console.log("Fixtures klar. Kører porte …\n");

  // T1-N3 tager {fordeling, mål} direkte — defekt = §3's målte prod-overskud.
  const t1n3Defect = { fordeling: { "pot5-6": 11.7 }, mål: { "pot5-6": 1.4 } };
  const t1n3Sane = { fordeling: { "pot5-6": 1.4 }, mål: { "pot5-6": 1.4 } };

  const rows = [
    // id label, function, per-fixture argument-builder (undefined = n/a for den fixture)
    gateRow("I1/T1-N1", (recs) => gateI1CapsWithinPotentialLoft(recs), { F1, F2, F5: F5a }),
    gateRow("I2", (recs) => gateI2YouthBandCeiling(recs), { F1, F2, F5: F5a }),
    gateRow("I3", (recs) => gateI3GraduationLevelTail(recs), { F1, F2, F5: F5a }),
    gateRow("T1-N2", (recs) => gateT1N2P99CapsPerTier(recs), { F1, F2, F5: F5a }),
    gateRow("T1-N3", (arg) => gateT1N3PostRemapDistribution(arg), { F1: t1n3Defect, F5: t1n3Sane }),
    gateRow("T1-H1(flow)", (vals) => gateT1H1PotentialeTail(vals, { label: "flow" }), { F4b, F5: F5c }),
    gateRow("T1-H1(stock)", (vals) => gateT1H1PotentialeTail(vals, { label: "stock" }), { F4, F5: F5c }),
    gateRow("T2-N1", (recs) => gateT2N1AntiFrontloading(recs), { F1, F3, F5: F5b }),
    gateRow("T2-M1", (recs) => gateT2M1MedianAtAnchors(recs), { F1, F3, F5: F5b }),
    gateRow("T2-H1", (recs) => gateT2H1ZeroGapAt21(recs), { F3, F5: F5b }),
    gateRow("T2-H2", (recs) => gateT2H2Over85PctBeforeAge24(recs), { F3, F5: F5b }),
    gateRow("T3-M1", (recs) => gateT3M1TwoSidedBands(recs), { F1, F2, F5: F5a }),
    gateRow("T3-N2", (recs) => gateT3N2AdultPathsWithinLoft(recs), { F6, F5: F5d }),
    gateRow("T4-N1", (arg) => gateT4N1ValueTotalAndCap({ before: arg.before, after: arg.after, hardCapPerRider: 20_000_000 }), { F7, F5: F5e }),
    gateRow("T4-H1", (arg) => gateT4H1ValueMovementAndSalary({
      beforeByAgeGroup: arg.beforeByAgeGroup, afterByAgeGroup: arg.afterByAgeGroup, salaries: arg.salaries,
      salaryValueP90CapFrac: 1.0, maxSingleSalary: 2_000_000,
    }), { F7, F5: F5e }),
  ];

  return rows;
}

function gateRow(id, fn, fixtures) {
  const cells = {};
  for (const [fixtureLabel, arg] of Object.entries(fixtures)) {
    if (arg === undefined) { cells[fixtureLabel] = { status: "n/a" }; continue; }
    try {
      const res = fn(arg);
      cells[fixtureLabel] = { status: res.pass ? "PASS" : "FAIL", målt: res.målt, navn: res.navn, grænse: res.grænse };
    } catch (e) {
      cells[fixtureLabel] = { status: "ERROR", målt: String(e?.message || e) };
    }
  }
  return { id, cells };
}

// ════════════════════════════════════════════════════════════════════════════════
function printMatrix(rows) {
  const fixtureLabels = [...new Set(rows.flatMap((r) => Object.keys(r.cells)))];
  const idWidth = Math.max(...rows.map((r) => r.id.length), 6);
  console.log(`${"PORT".padEnd(idWidth)} | ${fixtureLabels.map((f) => f.padEnd(6)).join(" | ")}`);
  console.log("-".repeat(idWidth + fixtureLabels.length * 9));
  for (const row of rows) {
    const cellStr = fixtureLabels.map((f) => (row.cells[f]?.status ?? "n/a").padEnd(6)).join(" | ");
    console.log(`${row.id.padEnd(idWidth)} | ${cellStr}`);
  }
  console.log();
  for (const row of rows) {
    console.log(`── ${row.id} ──`);
    for (const [label, cell] of Object.entries(row.cells)) {
      if (cell.status === "n/a") continue;
      console.log(`  [${cell.status}] ${label}: ${cell.målt ?? ""}`);
    }
  }
}

function checkAcceptance(rows) {
  console.log("\n=== Acceptkriterium: hver port fejler på >=1 defekt-fixture OG består F5 ===");
  let allOk = true;
  for (const row of rows) {
    const f5 = row.cells.F5;
    const f5Ok = f5 ? f5.status === "PASS" : null;
    const defectFails = Object.entries(row.cells).filter(([label, c]) => label !== "F5" && c.status === "FAIL");
    const ok = f5Ok !== false && defectFails.length > 0;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "OK" : "MANGLER"}  ${row.id}: F5=${f5?.status ?? "n/a"}, fejler på [${defectFails.map(([l]) => l).join(", ") || "INGEN"}]`);
  }
  return allOk;
}

const rows = runMatrix();
printMatrix(rows);
const accepted = checkAcceptance(rows);

const outPath = join(__dirname, "gates-matrix-3564.json");
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows, accepted }, null, 2));
console.log(`\nJSON skrevet til ${outPath}`);
console.log(accepted ? "\nALLE PORTE OPFYLDER ACCEPTKRITERIET." : "\nADVARSEL: mindst én port opfylder IKKE acceptkriteriet — se ovenfor.");
process.exitCode = accepted ? 0 : 1;
