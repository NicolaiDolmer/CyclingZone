#!/usr/bin/env node
// Diagnose: HVORFOR kan klassifikatoren ikke genfinde arketypen ved lave (ungdoms-
// realistiske) stats? Sweepet (simArchetypeCalibration3458.js) viser G1 ~25 % ved
// boost 1-5 og 95,6 % først ved boost=15/loft=99 (stats mættet ved 99).
//
// Hypotese: BOOTSTRAP-typen (computeRiderTypes mod NEUTRAL_BASELINE på de NUVÆRENDE
// evner) afgør caps' rolle-faktor. Ved NEUTRAL_BASELINE er z = den rå evneværdi, og
// `aggression` har et ALDERS-drevet gulv (abilityDerivation: 0.85·pcmFrac(stat_ftr)
// + 0.15·youth, youth=1 for alle 16-21-årige) som er uafhængigt af arketypen. Er de
// fysiske evner i ungdomsbåndet (~6-12) mens aggression ligger ~20, vinder baroudeur
// (aggression vægt 3) uanset hvad anlægget peger på — og caps formes så efter den
// forkerte type, hvorefter den ENDELIGE klassifikation bare bekræfter fejlen.
//
//   node scripts/diagArchetypeBootstrap3458.js [--boost=2] [--ceil=60] [--n=1200]

import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const BOOST = parseFloat(arg("boost", "2"));
const CEIL = parseInt(arg("ceil", "60"), 10);
const N = parseInt(arg("n", "1200"), 10);

const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, signatureBoostPerWeight: BOOST, statCeilBoosted: CEIL });
const rng = makeRng(2026);
const candidates = generateAcademyCandidates({
  rng, referenceYear: 2026, existingNames: new Set(), countOverride: N, genCfg: cfg,
});

const rows = candidates.map((c, i) => {
  const riderRow = { id: `diag-${i}`, ...c.rider };
  const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  return { draw: c.archetypeDraw, abilities, bootstrapPrimary: bootstrap.primary.key };
});

console.log(`=== Bootstrap-diagnose (boost=${BOOST}, loftBoosted=${CEIL}, n=${N}) ===\n`);

// 1) Rammer bootstrap arketypen?
// #3632: anlægget er altid to-delt, så "primær ELLER sekundær" ville gøre målingen
// mildere netop hvor den skal være skarp. Striks: ramte den trukne primær?
const hits = rows.filter((r) => r.bootstrapPrimary === r.draw.primary).length;
console.log(`Bootstrap rammer arketypen: ${Math.round((hits / rows.length) * 1000) / 10} %\n`);

// 2) Hvilke typer VINDER bootstrap?
const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
for (const r of rows) dist[r.bootstrapPrimary]++;
console.log("Bootstrap-type-fordeling (hvad klassifikatoren TROR de er):");
for (const t of RIDER_TYPE_KEYS) {
  const pct = Math.round((dist[t] / rows.length) * 1000) / 10;
  console.log(`  ${t.padEnd(16)} ${String(pct).padStart(6)} %  ${"█".repeat(Math.round(pct / 2))}`);
}

// 3) Evne-niveauer: aggression vs. de fysiske evner
const avg = (fn) => Math.round((rows.reduce((s, r) => s + fn(r), 0) / rows.length) * 10) / 10;
const PHYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance"];
console.log(`\nGennemsnitlige evne-niveauer:`);
console.log(`  aggression (alders-drevet gulv) : ${avg((r) => r.abilities.aggression)}`);
console.log(`  bedste FYSISKE evne             : ${avg((r) => Math.max(...PHYS.map((a) => r.abilities[a])))}`);
console.log(`  median fysisk evne              : ${avg((r) => { const v = PHYS.map((a) => r.abilities[a]).sort((a, b) => a - b); return v[v.length >> 1]; })}`);
console.log(`  descending / recovery           : ${avg((r) => r.abilities.descending)} / ${avg((r) => r.abilities.recovery)}`);

// 4) Kontrafaktisk: hvad sker der hvis aggression IKKE talte med i bootstrap?
const distNoAgg = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
let hitsNoAgg = 0;
for (const r of rows) {
  const stripped = { ...r.abilities, aggression: 0 };
  const b = computeRiderTypes(stripped, NEUTRAL_BASELINE);
  distNoAgg[b.primary.key]++;
  if (b.primary.key === r.draw.primary) hitsNoAgg++; // striks, se #3632 ovenfor
}
console.log(`\nKONTRAFAKTISK — bootstrap UDEN aggression:`);
console.log(`  rammer arketypen: ${Math.round((hitsNoAgg / rows.length) * 1000) / 10} %  (mod ${Math.round((hits / rows.length) * 1000) / 10} % med)`);
console.log(`  baroudeur-andel: ${Math.round((distNoAgg.baroudeur / rows.length) * 1000) / 10} % (mod ${Math.round((dist.baroudeur / rows.length) * 1000) / 10} %)`);
