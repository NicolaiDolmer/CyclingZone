#!/usr/bin/env node
// Kalibrerings-sweep for ungdoms-stat-generatoren (#3458 fase 2 → #3561-regression).
//
// BAGGRUND: #3458 fase 2 tunede signatureBoostPerWeight/statCeilBoosted ALENE mod
// G1-G4 (arketype-genfinding). Ingen af de fire gates måler ABSOLUTTE niveauer, så
// tuningen landede på boost=15/loft=99 → rå signatur-stat ~93-99 → afledt evne ~90
// på 16-årige, dvs. bedre end spillets 50 dyreste ryttere. Prod-konsekvens 9/8:
// 374 elite-ungdomsryttere, markedsværdi op til 42 mio.
//
// Dette script sweeper (signatureBoostPerWeight × statCeilBoosted) gennem PRÆCIS
// samme afled-kæde som simArchetypeGeneration3458.js og tilføjer de to gates der
// manglede:
//
//   G5  potentiale-loftet respekteres: current må ALDRIG løfte ability_caps over
//       det potentiale-drevne ungdoms-loft. buildCapsForRider gør caps =
//       max(potentiale-loft, current), så en for høj start-stat overskriver hele
//       potentiale-semantikken (en pot-1,0-rytter fik caps 99 = værdi 38 mio).
//       Mål: 100 % af kandidaterne.
//   G6  ungdoms-startbånd: bedste NUVÆRENDE afledte evne. #2064's ejer-godkendte
//       ankre — 16-årig bedste ~6, graduerings-alder (20-21) ~12, senior-median 21.
//       Mål: median ≤ 15 og p99 ≤ 25 (må ikke starte over senior-medianen).
//
//   node scripts/simArchetypeCalibration3458.js [--n=1500] [--seed=2026]

import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { ratingFromAbilities } from "../lib/scoutingReport.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const N = parseInt(arg("n", "1500"), 10);
const SEED = parseInt(arg("seed", "2026"), 10);
const REFERENCE_YEAR = 2026;

function buildPercentileFn(sortedAsc) {
  return (v) => {
    let lo = 0, hi = sortedAsc.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedAsc[mid] < v) lo = mid + 1; else hi = mid; }
    let lo2 = lo, hi2 = sortedAsc.length;
    while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sortedAsc[mid] <= v) lo2 = mid + 1; else hi2 = mid; }
    return Math.round((((lo + lo2) / 2) / (sortedAsc.length || 1)) * 99);
  };
}
const median = (s) => (!s.length ? 0 : s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2);
const pctl = (s, p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];

// Kør hele kæden for ét kalibrerings-punkt og returnér alle gate-tal.
function evaluate(cfg) {
  const rng = makeRng(SEED);
  const candidates = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: N, genCfg: cfg,
  });

  const riders = candidates.map((c, i) => {
    const riderRow = { id: `sim-${SEED}-${i}`, ...c.rider };
    const physiology = seedPhysiologyFromLegacy(riderRow);
    const abilities = deriveAbilities(physiology, riderRow);
    const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);

    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
    const age = REFERENCE_YEAR - Number(String(riderRow.birthdate).slice(0, 4));
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age }, bootstrap.primary.key, bootstrap.secondary.key);

    // G5-referencen: rytterens TOP-loft må ikke overstige hvad potentialet tillader.
    // Måles på MAKS over evnerne — ikke pr. evne: en lav "modsat" evne (oppositeFactor
    // 0,12 → cap ~4 ved pot 1) brydes rutinemæssigt af en helt normal start-evne på ~6,
    // og det har den altid gjort. Det der ØDELAGDE prod var at TOPPEN blev løftet:
    // caps = max(potentiale-loft, current), så en mættet start-stat gav en pot-1,0-
    // rytter caps 99 (loft 35) → markedsværdi 38 mio.
    const youthCaps = buildYouthCaps(riderRow.potentiale, bootstrap.primary.key, bootstrap.secondary.key);
    const maxYouthCap = Math.max(...VISIBLE_ABILITIES.map((a) => Number(youthCaps[a]) || 0));
    const maxActualCap = Math.max(...VISIBLE_ABILITIES.map((a) => Number(caps[a]) || 0));
    const breaksPotentialCeiling = maxActualCap > maxYouthCap;

    const final = computeRiderTypes(caps, typesBaseline);
    // G6 måles på de FYSISKE evner: #2064's ankre ("16-årig bedste anlæg ~6, graduering
    // ~12") handler om anlæggene. `aggression` har et alders-drevet gulv (~20 for ALLE
    // 16-21-årige, uafhængigt af stats) og ville ellers dominere målingen som støj.
    const PHYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];
    const bestCurrent = Math.max(...PHYS.map((a) => Number(abilities[a]) || 0));

    return {
      archetypeDraw: c.archetypeDraw, abilities, caps, potentiale: riderRow.potentiale, age,
      finalPrimary: final.primary.key, breaksPotentialCeiling, bestCurrent,
      maxCap: Math.max(...VISIBLE_ABILITIES.map((a) => Number(caps[a]) || 0)),
      maxRawStat: Math.max(...Object.entries(riderRow).filter(([k]) => k.startsWith("stat_")).map(([, v]) => Number(v) || 0)),
    };
  });
  const n = riders.length;

  // G1
  let g1 = 0;
  for (const r of riders) {
    const { primary, secondary, isHybrid } = r.archetypeDraw;
    if (isHybrid ? (r.finalPrimary === primary || r.finalPrimary === secondary) : r.finalPrimary === primary) g1++;
  }

  // G2/G3
  const rawScores = riders.map((r) => {
    const s = {};
    for (const t of RIDER_TYPE_KEYS) s[t] = ratingFromAbilities(buildCapsForRider(r.abilities, { potentiale: r.potentiale, age: r.age }, t, null), t);
    return s;
  });
  const pctlFnByType = Object.fromEntries(
    RIDER_TYPE_KEYS.map((t) => [t, buildPercentileFn(rawScores.map((s) => s[t]).sort((a, b) => a - b))])
  );
  let g3 = 0; const depths = [];
  for (let i = 0; i < n; i++) {
    const norm = RIDER_TYPE_KEYS.map((t) => ({ t, p: pctlFnByType[t](rawScores[i][t]) })).sort((a, b) => b.p - a.p);
    if (norm[0].t === riders[i].finalPrimary) g3++;
    depths.push(norm[0].p - norm[1].p);
  }

  // G4
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of riders) dist[r.finalPrimary]++;
  const distPct = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, Math.round((dist[t] / n) * 1000) / 10]));

  // G5 / G6
  const g5Ok = riders.filter((r) => !r.breaksPotentialCeiling).length;
  const bestSorted = riders.map((r) => r.bestCurrent).sort((a, b) => a - b);
  const capSorted = riders.map((r) => r.maxCap).sort((a, b) => a - b);
  const rawSorted = riders.map((r) => r.maxRawStat).sort((a, b) => a - b);

  return {
    g1: Math.round((g1 / n) * 1000) / 10,
    g2: median([...depths].sort((a, b) => a - b)),
    g3: Math.round((g3 / n) * 1000) / 10,
    g4Violations: RIDER_TYPE_KEYS.filter((t) => distPct[t] < 5 || distPct[t] > 30),
    distPct,
    g5Pct: Math.round((g5Ok / n) * 1000) / 10,
    bestCurrentMedian: median(bestSorted),
    bestCurrentP99: pctl(bestSorted, 0.99),
    bestCurrentMax: bestSorted[bestSorted.length - 1],
    maxCapMedian: median(capSorted),
    maxCapMax: capSorted[capSorted.length - 1],
    maxRawStatMedian: median(rawSorted),
    maxRawStatMax: rawSorted[rawSorted.length - 1],
  };
}

function verdict(r) {
  const pass = r.g1 >= 90 && r.g2 >= 8 && r.g3 >= 90 && r.g4Violations.length === 0
    && r.g5Pct >= 100 && r.bestCurrentMedian <= 15 && r.bestCurrentP99 <= 25;
  return pass ? "PASS" : "fail";
}

const SHIPPED = { boost: YOUTH_GEN_CONFIG.signatureBoostPerWeight, ceil: YOUTH_GEN_CONFIG.statCeilBoosted };
console.log(`=== Kalibrerings-sweep ungdoms-generator (n=${N}, seed=${SEED}) ===`);
console.log(`Shipped (defekt): boost=${SHIPPED.boost} loftBoosted=${SHIPPED.ceil}\n`);
console.log(
  `${"boost".padStart(6)} ${"loft".padStart(5)} | ${"G1%".padStart(5)} ${"G2".padStart(4)} ${"G3%".padStart(5)} ${"G4".padStart(3)} ${"G5%".padStart(6)} | ` +
  `${"evne med".padStart(9)} ${"p99".padStart(4)} ${"max".padStart(4)} | ${"cap med".padStart(8)} ${"cap max".padStart(8)} | ${"råstat max".padStart(10)} | dom`
);

const BOOSTS = (arg("boosts", "1,1.5,2,2.5,3,4,5,7,15")).split(",").map(Number);
const CEILS = (arg("ceils", "56,58,60,62,64,99")).split(",").map(Number);
const results = [];
for (const boost of BOOSTS) {
  for (const ceil of CEILS) {
    const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, signatureBoostPerWeight: boost, statCeilBoosted: ceil });
    const r = evaluate(cfg);
    results.push({ boost, ceil, ...r });
    console.log(
      `${String(boost).padStart(6)} ${String(ceil).padStart(5)} | ${String(r.g1).padStart(5)} ${String(r.g2).padStart(4)} ${String(r.g3).padStart(5)} ` +
      `${String(r.g4Violations.length).padStart(3)} ${String(r.g5Pct).padStart(6)} | ${String(r.bestCurrentMedian).padStart(9)} ${String(r.bestCurrentP99).padStart(4)} ${String(r.bestCurrentMax).padStart(4)} | ` +
      `${String(r.maxCapMedian).padStart(8)} ${String(r.maxCapMax).padStart(8)} | ${String(r.maxRawStatMax).padStart(10)} | ${verdict(r)}`
    );
  }
}

const passing = results.filter((r) => verdict(r) === "PASS");
console.log(`\n${passing.length} kombination(er) bestod ALLE gates (G1-G6).`);
if (passing.length) {
  // Vælg den med højest G1 blandt de laveste absolutte niveauer (mindst indgribende).
  passing.sort((a, b) => a.bestCurrentP99 - b.bestCurrentP99 || b.g1 - a.g1);
  const best = passing[0];
  console.log(`Anbefalet: signatureBoostPerWeight=${best.boost} statCeilBoosted=${best.ceil}`);
  console.log(JSON.stringify(best, null, 2));
} else {
  console.log("INGEN kombination bestod — gate-sættet eller derivationen skal ændres, ikke bare konstanterne.");
}
