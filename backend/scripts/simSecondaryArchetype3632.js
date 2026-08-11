#!/usr/bin/env node
// DB-frit sim-harness for #3632: hvad koster det at give ALLE ryttere et sekundært
// anlæg, og hvor stærkt må sekundæren forme kroppen?
//
// Baggrund: indtil 11/8 afgjorde `HYBRID_PROBABILITY = 0.15` om der overhovedet blev
// trukket en sekundær arketype, så 85 % af alle nye ryttere fik `secondary: null` i
// anlægget — mens `riders.secondary_type` blev udfyldt af klassifikatoren alligevel og
// derfor kunne drifte ved hver natlig genberegning (#3593). Ejer-beslutning 11/8: alle
// ryttere har en sekundær. To konstanter var kalibreret dengang kun 15 % havde en, og
// rammer nu 100 %:
//
//   secondarySignatureWeight  (academyGenerator.YOUTH_GEN_CONFIG) — hvor meget af
//     bi-typens signatur der blandes ind i FØDSELS-statsene. Var 0,5 (50/50-hybridkrop).
//   naturalSecondaryFactor    (riderProgression.YOUTH_PROGRESSION_CONFIG) — bi-typens
//     andel af evne-LOFTET (0,82 mod 0,45 for en neutral evne).
//
// Harnessen spejler PRÆCIS produktionskæden fra backfillCores.deriveForRiderIds
// (generateAcademyCandidates → physiology → abilities → draw-formede caps → endelig
// klassifikation mod ungdoms-baselinen) og måler mod gate-definitionerne i
// lib/archetypeGenerationGates.test.js:
//
//   G1 STRIKS  genfandt klassifikatoren den TRUKNE PRIMÆR?   (gulv 52 %)
//   G1 løs     ramte den primær ELLER sekundær?              (oplysende, ikke gate)
//   G2         specialiserings-dybde: bedste − næstbedste rå evne, 16-18 år (median ≥1)
//   G5         current må aldrig løfte caps over potentiale-loftet (0 brud)
//   G6         ingen afledt fysisk evne over ungdomsbåndets 15
//   G7         højst 5 % af 16-17-årige født på graduerings-niveau (evne ≥12)
//
// Rører INTET i DB. Informativ (exit 0) — gates fejler i `node --test`, ikke her.
//
//   node scripts/simSecondaryArchetype3632.js [--n=3000] [--seed=20260806]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildYouthCaps, YOUTH_PROGRESSION_CONFIG } from "../lib/riderProgression.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { selectTypesBaseline } from "../lib/riderTypesBaselineSelect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (navn, fallback) => {
  const traeffer = process.argv.find((a) => a.startsWith(`--${navn}=`));
  return traeffer ? Number(traeffer.split("=")[1]) : fallback;
};

const N = arg("n", 3000);
const SEED = arg("seed", 20260806);
const REFERENCE_YEAR = 2026;

const typesBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const youthTypesBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaselineYouth.json"), "utf8"));

// Samme liste som gate-testens: aggression er UNDTAGET (alders-drevet gulv uafhængigt
// af stats, ville gøre specialiserings-gabet umåleligt).
const PHYSICAL_ABILITIES = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
]);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function koer({ statW, capsF, drop = false }) {
  const genCfg = Object.freeze({ ...YOUTH_GEN_CONFIG, secondarySignatureWeight: statW });
  const progCfg = Object.freeze({ ...YOUTH_PROGRESSION_CONFIG, naturalSecondaryFactor: capsF });
  const rng = makeRng(SEED);
  const kandidater = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: N, genCfg,
  });

  let striks = 0, loes = 0, g5brud = 0, g6top = 0, iToppen = 0, unge17 = 0;
  const gab = [];
  const fordeling = {};
  for (let i = 0; i < kandidater.length; i++) {
    const c = kandidater[i];
    const traek = c.archetypeDraw;
    // `drop` isolerer sekundærens effekt: samme kuld, men loftet formes kun af primæren.
    const sekundaer = drop ? null : (traek.secondary || null);
    const rytter = { id: `sim-${i}`, ...c.rider };
    const evner = deriveAbilities(seedPhysiologyFromLegacy(rytter), rytter);
    const absolut = buildYouthCaps(rytter.potentiale, traek.primary, sekundaer, progCfg);
    const caps = {};
    for (const a of VISIBLE_ABILITIES) {
      caps[a] = clamp(Math.max(absolut[a] ?? 0, Math.round(Number(evner[a]) || 0)), 0, 99);
    }
    const alder = REFERENCE_YEAR - Number(String(rytter.birthdate).slice(0, 4));
    const endelig = computeRiderTypes(caps, selectTypesBaseline(alder, typesBaseline, youthTypesBaseline));
    fordeling[endelig.primary.key] = (fordeling[endelig.primary.key] || 0) + 1;

    if (endelig.primary.key === traek.primary) striks++;
    if (endelig.primary.key === traek.primary || endelig.primary.key === traek.secondary) loes++;
    if (Math.max(...VISIBLE_ABILITIES.map((a) => caps[a])) > Math.max(...VISIBLE_ABILITIES.map((a) => absolut[a] ?? 0))) g5brud++;

    const bedsteFysiske = Math.max(...PHYSICAL_ABILITIES.map((a) => Number(evner[a]) || 0));
    if (bedsteFysiske > g6top) g6top = bedsteFysiske;
    if (alder <= 17) { unge17++; if (bedsteFysiske >= 12) iToppen++; }
    if (alder <= 18) {
      const v = PHYSICAL_ABILITIES.map((k) => Number(evner[k]) || 0).sort((a, b) => b - a);
      gab.push(v[0] - v[1]);
    }
  }
  gab.sort((a, b) => a - b);
  const raekker = Object.entries(fordeling).sort((a, b) => b[1] - a[1]);
  const andel = (n) => (n / N) * 100;
  return {
    g1: andel(striks),
    g1loes: andel(loes),
    g2median: gab[Math.floor(gab.length / 2)],
    g2snit: gab.reduce((s, x) => s + x, 0) / gab.length,
    g5brud, g6top,
    g7: (iToppen / Math.max(1, unge17)) * 100,
    top: `${raekker[0][0]} ${andel(raekker[0][1]).toFixed(1)} %`,
    bund: `${raekker[raekker.length - 1][0]} ${andel(raekker[raekker.length - 1][1]).toFixed(1)} %`,
  };
}

const linje = (navn, r) =>
  `${navn.padEnd(30)} | ${r.g1.toFixed(1).padStart(5)} | ${r.g1loes.toFixed(1).padStart(5)} | ` +
  `${String(r.g2median).padStart(3)} | ${r.g2snit.toFixed(2).padStart(5)} | ${String(r.g5brud).padStart(3)} | ` +
  `${String(r.g6top).padStart(3)} | ${r.g7.toFixed(1).padStart(4)} | ${r.top} / ${r.bund}`;

console.log(`\n=== #3632 sekundært anlæg — sim (n=${N}, seed=${SEED}) ===`);
console.log(`Produktionskonfiguration: secondarySignatureWeight=${YOUTH_GEN_CONFIG.secondarySignatureWeight}, ` +
  `naturalSecondaryFactor=${YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor}\n`);
console.log(`${"variant".padEnd(30)} |    G1 |   løs | med |  snit |  G5 |  G6 |  G7 | endelig primær top/bund`);
console.log("-".repeat(124));

const PROD_STAT_W = YOUTH_GEN_CONFIG.secondarySignatureWeight;
const PROD_CAPS_F = YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor;

console.log(linje("PRODUKTION", koer({ statW: PROD_STAT_W, capsF: PROD_CAPS_F })));
console.log(linje("kontrafaktisk: uden sekundær", koer({ statW: 0, capsF: PROD_CAPS_F, drop: true })));
console.log("");
console.log("— hvor meget bi-typen må forme FØDSELS-statsene (loft-faktoren fastholdt):");
for (const statW of [0, 0.1, 0.25, 0.5]) {
  console.log(linje(`  sek.vægt ${statW}`, koer({ statW, capsF: PROD_CAPS_F })));
}
console.log("");
console.log("— hvor meget bi-typen må forme LOFTET (stat-vægten fastholdt på produktionens):");
for (const capsF of [0.45, 0.55, 0.7, 0.82]) {
  console.log(linje(`  loft-faktor ${capsF}`, koer({ statW: PROD_STAT_W, capsF })));
}
console.log(
  "\nLæsning: G1 falder når bi-typen får en større andel af LOFTET (profilen bliver mindre spids);\n" +
  "G2 falder når den får en større andel af FØDSELS-statsene. 0,82/0,10 er den kombination der\n" +
  "holder G2 hvor populationen ligger i dag, uden at røre de ~8.100 eksisterende ryttere der\n" +
  "allerede har et sekundært anlæg på 0,82.\n"
);
