#!/usr/bin/env node
// DB-frit sim-harness for #3634/#3631: hvad koster det at give VOKSEN-generatorens
// ryttere et sekundært anlæg, og hvor stærkt må bi-typen forme kroppen?
//
// Baggrund (målt 16/8, #3634): `fictionalRiderGenerator.js` trak ÉN arketype og
// skrev `archetypeDraw: { primary, secondary: null }`. 72 ryttere blev født uden
// anlægs-sekundær på tre døgn — 24/døgn, alle via startholds-stien til nye
// menneskeejede hold. Nedstrøms udpegede klassifikatoren en `secondary_type`
// alligevel, så kolonnen var aldrig NULL; den kunne bare drifte ved hver natlig
// genberegning. Samme rod driver #3631's skævhed: klassifikator-gættet trak mod
// alrounder-stats (rouleur 29,5 % + sprinter 24,2 % = 53,7 % mod tilsigtet 30,3 %).
//
// Rettelsen former kroppen efter BEGGE anlæg med vægten
// `SECONDARY_SIGNATURE_WEIGHT`. Denne harness måler vægten mod de gates der
// allerede findes for voksen-generatoren, så tallet er MÅLT og ikke lånt fra
// akademi-stien (hvis 0,10 er kalibreret mod en anden mekanik — se #3634).
//
// REFERENCEARM: `--w=0` er BIT-IDENTISK med koden før #3634 (verificeret mod
// origin/main for fire seed/count-kombinationer). Sekundæren trækkes fra en EGEN
// rng-understrøm, så forankringen i sig selv ikke flytter populationen — vægten
// er den eneste variabel mellem armene.
//
// Spejler produktionskæden fra backfillCores.deriveForRiderIds for VOKSNE:
//   physiology → deriveAbilities → buildCapsForRider(DET TRUKNE anlæg) →
//   computeRiderTypes(selectTypesBaseline(alder))
//
// Rører INTET i DB. Informativ (exit 0) — gates fejler i `node --test`, ikke her.
//
//   node scripts/simSecondaryArchetype3634.js [--n=3000] [--seed=20260816]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateFictionalRiders,
  STAT_KEYS,
  SECONDARY_SIGNATURE_WEIGHT,
} from "../lib/fictionalRiderGenerator.js";
import { DEFAULT_DISTRIBUTION, ARCHETYPE_TYPES } from "../lib/archetypeDistribution.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { selectTypesBaseline } from "../lib/riderTypesBaselineSelect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (navn, fallback) => {
  const traeffer = process.argv.find((a) => a.startsWith(`--${navn}=`));
  return traeffer ? Number(traeffer.split("=")[1]) : fallback;
};

const N = arg("n", 3000);
const SEED = arg("seed", 20260816);
const REFERENCE_YEAR = 2026;

const typesBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const youthTypesBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaselineYouth.json"), "utf8"));

// Samme liste som akademi-gatens: aggression er UNDTAGET (alders-drevet gulv
// uafhængigt af stats, ville gøre specialiserings-gabet umåleligt).
const PHYSICAL_ABILITIES = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
]);

// De separations-krav voksen-generatorens EGNE gates allerede håndhæver
// (lib/fictionalRiderGenerator.test.js). Marginen = målt forskel − krav; negativ
// margin betyder at en bestående gate ville fejle ved den vægt.
const BOOST_SEPARATION = [
  ["sprinter", "stat_sp", "climber", 5],
  ["climber", "stat_bj", "sprinter", 5],
  ["tt", "stat_tt", "sprinter", 5],
  ["brostensrytter", "stat_bro", "climber", 5],
];
const DAMP_SEPARATION = [
  ["climber", "stat_bj", "stat_sp", 10],
  ["sprinter", "stat_sp", "stat_bj", 10],
];

// #3570/S2's knaphedsmål + porte, kopieret fra generator-testen så harnessen og
// gaten måler PRÆCIS det samme tal på start-trup-stien (count = 8).
const SCARCITY_TARGET = {
  sprinter: 15, tt: 9, climber: 17, puncheur: 13,
  brostensrytter: 9, baroudeur: 11, rouleur: 17, gc: 9,
};
const S2_GATES = { distinctFraction: 0.88, minSharePct: 3.0, maxL1: 40 };
const targetExpectedDistinct = (count) => Object.values(SCARCITY_TARGET)
  .reduce((s, t) => s + (1 - (1 - t / 100) ** count), 0);

/**
 * Marginerne på voksen-generatorens EGNE bestående gates, målt på PRÆCIS den
 * population testene bruger (seed 5, count 800) — ikke på en proxy-population.
 * Margin = målt forskel − kravet; ≤ 0 betyder at `node --test` ville fejle.
 */
function generatorGateMargins(w) {
  const { riders } = generateFictionalRiders({
    seed: 5, count: 800, referenceYear: REFERENCE_YEAR, secondarySignatureWeight: w,
  });
  const avg = (arche, key) => {
    const sub = riders.filter((r) => r._meta.archetype === arche);
    return sub.length ? sub.reduce((s, r) => s + r[key], 0) / sub.length : NaN;
  };
  const boost = BOOST_SEPARATION.map(([a, key, b, krav]) => ({
    navn: `${a}.${key} > ${b}.${key} + ${krav}`, margin: avg(a, key) - avg(b, key) - krav,
  }));
  const damp = DAMP_SEPARATION.map(([a, hoej, lav, krav]) => ({
    navn: `${a}.${hoej} > ${a}.${lav} + ${krav}`, margin: avg(a, hoej) - avg(a, lav) - krav,
  }));
  return [...boost, ...damp];
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/**
 * Den analytisk FORVENTEDE sekundær-fordeling: sekundæren trækkes fra
 * DEFAULT_DISTRIBUTION betinget af "≠ primær" og renormaliseret, og voksen-stiens
 * primær-fordeling er tier-vægtet (IKKE DEFAULT_DISTRIBUTION). Marginalen er
 * derfor ikke identisk med DEFAULT_DISTRIBUTION — den her er facit for hvad
 * trækket FAKTISK sigter mod, og L1 mod den skiller "trækket virker" fra
 * "trækket sigter et andet sted end 12,5 %".
 */
function expectedSecondaryShare(primaryShare) {
  const d = DEFAULT_DISTRIBUTION;
  const out = Object.fromEntries(ARCHETYPE_TYPES.map((t) => [t, 0]));
  for (const p of ARCHETYPE_TYPES) {
    const pp = primaryShare[p] ?? 0;
    if (!pp) continue;
    const rest = ARCHETYPE_TYPES.filter((t) => t !== p).reduce((s, t) => s + d[t], 0);
    for (const t of ARCHETYPE_TYPES) {
      if (t === p) continue;
      out[t] += pp * (d[t] / rest);
    }
  }
  return out;
}

function l1(aShare, bShare) {
  return ARCHETYPE_TYPES.reduce((s, t) => s + Math.abs((aShare[t] ?? 0) - (bShare[t] ?? 0)), 0);
}

// Start-trup-stien (count = 8) poolet over mange kald — den sti de 72 ryttere kom ad.
function starterSquadStats(w, calls = 600, count = 8) {
  const pooledPrimary = {};
  const pooledSecondary = {};
  let n = 0;
  let distinctSum = 0;
  let udenAnlaeg = 0;
  for (let k = 0; k < calls; k++) {
    const { riders } = generateFictionalRiders({
      seed: (2026 + k * 7919) >>> 0, count, referenceYear: REFERENCE_YEAR, secondarySignatureWeight: w,
    });
    const arch = riders.map((r) => r._meta.archetype);
    for (const r of riders) {
      pooledPrimary[r._meta.archetype] = (pooledPrimary[r._meta.archetype] || 0) + 1;
      const sec = r._meta.archetypeDraw.secondary;
      if (!sec || sec === r._meta.archetypeDraw.primary) udenAnlaeg++;
      else pooledSecondary[sec] = (pooledSecondary[sec] || 0) + 1;
    }
    n += arch.length;
    distinctSum += new Set(arch).size;
  }
  const share = (pool) => Object.fromEntries(ARCHETYPE_TYPES.map((t) => [t, (100 * (pool[t] || 0)) / n]));
  const primaryShare = share(pooledPrimary);
  const secondaryShare = share(pooledSecondary);
  const s2l1 = ARCHETYPE_TYPES.reduce((s, t) => s + Math.abs(primaryShare[t] - SCARCITY_TARGET[t]), 0);
  return {
    n,
    udenAnlaeg,
    primaryShare,
    secondaryShare,
    secL1Default: l1(secondaryShare, DEFAULT_DISTRIBUTION),
    secL1Expected: l1(secondaryShare, expectedSecondaryShare(primaryShare)),
    secMinShare: Math.min(...ARCHETYPE_TYPES.map((t) => secondaryShare[t])),
    secMaxShare: Math.max(...ARCHETYPE_TYPES.map((t) => secondaryShare[t])),
    meanDistinct: distinctSum / calls,
    distinctFloor: S2_GATES.distinctFraction * targetExpectedDistinct(count),
    s2l1,
    s2minShare: Math.min(...ARCHETYPE_TYPES.map((t) => primaryShare[t])),
  };
}

// Launch-skala-populationen (count = N) — stats, krop og klassifikator-kohærens.
function populationStats(w) {
  const { riders } = generateFictionalRiders({
    seed: SEED, count: N, referenceYear: REFERENCE_YEAR, secondarySignatureWeight: w,
  });

  let statMin = Infinity;
  let statMax = -Infinity;
  let udenAnlaeg = 0;
  let striks = 0;
  let loes = 0;
  let kropPrimaer = 0;
  let kropSekundaer = 0;
  const gab = [];
  const sekundaerFordeling = {};
  const primaerFordeling = {};

  for (let i = 0; i < riders.length; i++) {
    const r = riders[i];
    for (const key of STAT_KEYS) {
      if (r[key] < statMin) statMin = r[key];
      if (r[key] > statMax) statMax = r[key];
    }
    const { primary, secondary } = r._meta.archetypeDraw;
    primaerFordeling[primary] = (primaerFordeling[primary] || 0) + 1;
    if (!secondary || secondary === primary) udenAnlaeg++;
    else sekundaerFordeling[secondary] = (sekundaerFordeling[secondary] || 0) + 1;

    // Produktionskæden for en VOKSEN rytter (backfillCores.deriveForRiderIds).
    const riderRow = { id: `sim-${i}`, ...r };
    const evner = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (evner[k] != null) baseline[k] = Number(evner[k]);
    const alder = REFERENCE_YEAR - Number(String(riderRow.birthdate).slice(0, 4));
    const model = selectTypesBaseline(alder, typesBaseline, youthTypesBaseline);
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age: alder }, primary, secondary || null);
    const endelig = computeRiderTypes(caps, model);
    if (endelig.primary.key === primary) striks++;
    if (endelig.primary.key === primary || endelig.primary.key === secondary) loes++;

    // KROPPEN ALENE: klassificér de rå afledte evner UDEN de anlægs-formede caps.
    // Det er den eneste måling der isolerer vægtens effekt — G1/G1-løs ovenfor
    // læser caps, og caps formes af anlægget uanset vægt (naturalSecondaryFactor
    // 0,82), så de ville se ens ud selv hvis kroppen slet ikke pegede på bi-typen.
    // Præcis den tilstand #3634 kalder problemet: "et evne-loft i en retning
    // kroppen ikke peger".
    const krop = computeRiderTypes(baseline, model);
    if (krop.primary.key === primary) kropPrimaer++;
    if (secondary && (krop.primary.key === secondary || krop.secondary.key === secondary)) kropSekundaer++;

    const v = PHYSICAL_ABILITIES.map((k) => Number(evner[k]) || 0).sort((a, b) => b - a);
    gab.push(v[0] - v[1]);
  }

  const avg = (arche, key) => {
    const sub = riders.filter((r) => r._meta.archetype === arche);
    return sub.length ? sub.reduce((s, r) => s + r[key], 0) / sub.length : NaN;
  };
  const boostMargin = Math.min(...BOOST_SEPARATION.map(([a, key, b, krav]) => avg(a, key) - avg(b, key) - krav));
  const dampMargin = Math.min(...DAMP_SEPARATION.map(([a, hoej, lav, krav]) => avg(a, hoej) - avg(a, lav) - krav));

  const pct = (pool) => Object.fromEntries(ARCHETYPE_TYPES.map((t) => [t, (100 * (pool[t] || 0)) / riders.length]));
  const secShare = pct(sekundaerFordeling);
  return {
    statMin, statMax, udenAnlaeg,
    g1: (striks / riders.length) * 100,
    g1loes: (loes / riders.length) * 100,
    kropPrimaer: (kropPrimaer / riders.length) * 100,
    kropSekundaer: (kropSekundaer / riders.length) * 100,
    gabMedian: median(gab),
    gabSnit: gab.reduce((s, x) => s + x, 0) / gab.length,
    boostMargin, dampMargin,
    secShare,
    secL1Default: l1(secShare, DEFAULT_DISTRIBUTION),
    secL1Expected: l1(secShare, expectedSecondaryShare(pct(primaerFordeling))),
  };
}

// ── Rapport ──────────────────────────────────────────────────────────────────
const VAEGTE = [0, 0.1, 0.2, 0.35, 0.5];

console.log(`\n=== #3634 voksen-generatorens sekundære anlæg — sim (n=${N}, seed=${SEED}) ===`);
console.log(`Produktionsvægt: SECONDARY_SIGNATURE_WEIGHT = ${SECONDARY_SIGNATURE_WEIGHT}`);
console.log("w=0 er referencearmen: BIT-IDENTISK med koden før #3634 (kun archetype_draw.secondary er ny).\n");

console.log("── Kroppens kohærens med anlægget (launch-skala, count = n) ──");
console.log("Kolonnerne 'krop→' klassificerer de RÅ afledte evner uden anlægs-formede caps.");
console.log(
  `${"vægt".padEnd(8)} | uden anlæg | ${"krop→primær".padStart(11)} | ${"krop→sekundær".padStart(13)} | ` +
  `${"G1 striks".padStart(9)} | ${"G1 løs".padStart(6)} | ${"gab med".padStart(7)} | ${"gab snit".padStart(8)} | ` +
  `stat-spænd | ${"sek. L1 mod DEFAULT".padStart(19)}`,
);
console.log("-".repeat(130));
const pop = {};
for (const w of VAEGTE) {
  const r = populationStats(w);
  pop[w] = r;
  const maerke = w === SECONDARY_SIGNATURE_WEIGHT ? "*" : " ";
  console.log(
    `${(maerke + String(w)).padEnd(8)} | ${String(r.udenAnlaeg).padStart(10)} | ${r.kropPrimaer.toFixed(1).padStart(11)} | ` +
    `${r.kropSekundaer.toFixed(1).padStart(13)} | ${r.g1.toFixed(1).padStart(9)} | ${r.g1loes.toFixed(1).padStart(6)} | ` +
    `${String(r.gabMedian).padStart(7)} | ${r.gabSnit.toFixed(2).padStart(8)} | ` +
    `${String(r.statMin).padStart(4)}-${String(r.statMax).padEnd(5)} | ${r.secL1Default.toFixed(1).padStart(19)}`,
  );
}

console.log("\n── Marginer på voksen-generatorens BESTÅENDE gates (seed 5, count 800 — testens egen population) ──");
console.log("Margin ≤ 0 ⇒ `node --test` fejler ved den vægt.");
const gateNavne = generatorGateMargins(0).map((g) => g.navn);
console.log(`${"vægt".padEnd(8)} | ` + gateNavne.map((n) => n.padStart(34)).join(" | "));
console.log("-".repeat(8 + gateNavne.length * 37));
const marginer = {};
for (const w of VAEGTE) {
  const m = generatorGateMargins(w);
  marginer[w] = m;
  const maerke = w === SECONDARY_SIGNATURE_WEIGHT ? "*" : " ";
  console.log(`${(maerke + String(w)).padEnd(8)} | ` + m.map((g) => g.margin.toFixed(2).padStart(34)).join(" | "));
}

console.log("\n── Start-trup-stien (count = 8, 600 kald — den sti de 72 ryttere kom ad) ──");
console.log(
  `${"vægt".padEnd(8)} | uden anlæg | ${"distinkt".padStart(8)} | ${"port".padStart(5)} | ` +
  `${"S2 L1".padStart(6)} | ${"S2 min%".padStart(7)} | ${"sek. min%".padStart(9)} | ${"sek. max%".padStart(9)} | ` +
  `${"sek. L1 mod DEFAULT".padStart(19)}`,
);
console.log("-".repeat(118));
const starter = {};
for (const w of VAEGTE) {
  const r = starterSquadStats(w);
  starter[w] = r;
  const maerke = w === SECONDARY_SIGNATURE_WEIGHT ? "*" : " ";
  console.log(
    `${(maerke + String(w)).padEnd(8)} | ${String(r.udenAnlaeg).padStart(10)} | ${r.meanDistinct.toFixed(2).padStart(8)} | ` +
    `${r.distinctFloor.toFixed(2).padStart(5)} | ${r.s2l1.toFixed(1).padStart(6)} | ${r.s2minShare.toFixed(2).padStart(7)} | ` +
    `${r.secMinShare.toFixed(2).padStart(9)} | ${r.secMaxShare.toFixed(2).padStart(9)} | ${r.secL1Default.toFixed(1).padStart(19)}`,
  );
}

console.log("\n── Sekundær-fordeling ved produktionsvægten (start-trup-stien, count = 8) ──");
console.log(`${"type".padEnd(16)} | ${"målt %".padStart(7)} | ${"DEFAULT %".padStart(9)} | ${"afvig pp".padStart(8)} | før #3634 (målt prod 16/8)`);
console.log("-".repeat(86));
// Klassifikator-gættets fordeling FØR fixet, målt i prod 16/8 (#3634-kommentaren).
const FOER_PROD = { rouleur: 29.5, sprinter: 24.2 };
for (const t of ARCHETYPE_TYPES) {
  const m = starter[SECONDARY_SIGNATURE_WEIGHT].secondaryShare[t];
  const d = DEFAULT_DISTRIBUTION[t];
  const foer = FOER_PROD[t] != null ? `${FOER_PROD[t].toFixed(1)} %` : "";
  console.log(
    `${t.padEnd(16)} | ${m.toFixed(2).padStart(7)} | ${d.toFixed(2).padStart(9)} | ` +
    `${(m - d >= 0 ? "+" : "") + (m - d).toFixed(2)}`.padEnd(11) + ` | ${foer}`,
  );
}

const P = pop[SECONDARY_SIGNATURE_WEIGHT];
const S = starter[SECONDARY_SIGNATURE_WEIGHT];
const minMargin = Math.min(...(marginer[SECONDARY_SIGNATURE_WEIGHT] ?? generatorGateMargins(SECONDARY_SIGNATURE_WEIGHT)).map((g) => g.margin));
const gates = [
  ["G-A  ingen rytter fødes uden anlægs-sekundær (launch-skala)", P.udenAnlaeg === 0, `${P.udenAnlaeg} uden`],
  ["G-B  ingen rytter fødes uden anlægs-sekundær (start-trup)", S.udenAnlaeg === 0, `${S.udenAnlaeg} uden`],
  ["G-C  sekundær-fordeling: L1 mod DEFAULT_DISTRIBUTION ≤ 8 pp", S.secL1Default <= 8, `${S.secL1Default.toFixed(1)} pp`],
  ["G-D  ingen sekundær type under 3 % (mod 3,1 % i prod før)", S.secMinShare >= 3, `${S.secMinShare.toFixed(2)} %`],
  ["G-E  ingen sekundær type over 20 % (mod 33,7 % i prod før)", S.secMaxShare <= 20, `${S.secMaxShare.toFixed(2)} %`],
  ["G-F  stat-skala holder [50,85]", P.statMin >= 50 && P.statMax <= 85, `${P.statMin}-${P.statMax}`],
  ["G-G  bestående generator-gates: mindste margin ≥ 2,0 point", minMargin >= 2, `margin ${minMargin.toFixed(2)}`],
  ["G-H  kroppen er ikke blevet mindre kohærent med anlægget", P.kropSekundaer >= pop[0].kropSekundaer, `${P.kropSekundaer.toFixed(1)} % mod referencearmens ${pop[0].kropSekundaer.toFixed(1)} %`],
  ["G-I  S2: distinkte arketyper pr. træk over porten", S.meanDistinct >= S.distinctFloor, `${S.meanDistinct.toFixed(2)} ≥ ${S.distinctFloor.toFixed(2)}`],
  ["G-J  S2: L1 mod knaphedsmålene under porten (40 pp)", S.s2l1 <= S2_GATES.maxL1, `${S.s2l1.toFixed(1)} pp`],
  ["G-K  S2: ingen primær arketype under 3 %", S.s2minShare >= S2_GATES.minSharePct, `${S.s2minShare.toFixed(2)} %`],
  ["G-L  specialiserings-dybde: median rå-evne-gab ≥ 5", P.gabMedian >= 5, `median ${P.gabMedian}`],
];
console.log("\n── Scorecard ved produktionsvægten ──");
let alleGroenne = true;
for (const [navn, ok, tal] of gates) {
  if (!ok) alleGroenne = false;
  console.log(`  ${ok ? "GRØN " : "RØD  "} ${navn.padEnd(60)} ${tal}`);
}
console.log(`\n  Samlet: ${alleGroenne ? "ALLE GATES GRØNNE" : "MINDST ÉN GATE RØD — vægten kan ikke shippes"}`);
console.log(
  "\nLæsning: kolonnen 'krop→sekundær' stiger med vægten — det er dér bi-typen bliver\n" +
  "aflæselig i kroppen. Prisen står i margin-tabellen ovenfor.\n" +
  "\n" +
  "VIGTIGT — denne harness er IKKE den bindende gate. `npm run race:gate` (#1102) er\n" +
  "grøn på 3/3 seeds ved vægt 0 og fejler ved ENHVER vægt derover, også 0,02\n" +
  "(cobbles: brostensrytter 78 % mod ≥80 %). Dens kalibrerings-bånd er i praksis en\n" +
  "golden-population-fixture, tunet mod præcis den population generatoren laver i dag.\n" +
  "Derfor er produktionsvægten 0: forankringen og fordelings-fixet (G-A til G-E) er\n" +
  "uafhængige af vægten og virker fuldt ud, mens populationen forbliver bit-identisk.\n" +
  "Kør ALTID race:gate, ikke kun denne harness, før vægten røres.\n",
);
