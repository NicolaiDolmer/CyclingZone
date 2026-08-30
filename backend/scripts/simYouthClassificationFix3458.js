#!/usr/bin/env node
// Test af de to PRINCIPIELLE rettelser af ungdoms-typeklassifikationen.
//
// FUND (diagCapsClassification3458.js + prod): bootstrap rammer arketypen 82,6 % ved
// ungdoms-realistiske stats, men den ENDELIGE type rammer kun ~26 %, fordi ungdoms-caps
// klassificeres mod riderTypesBaseline.json — fittet over VOKSEN-caps. I det rum er
// time_trial strukturelt lav (z=−1,92: kun tt/gc vægter den positivt, alle andre får
// neutralFactor 0,45), så enhver type der STRAFFER time_trial får en gratis bonus:
// baroudeur (time_trial:−1) æder 68 % af kuldet. Prod bekræfter at det er ældre end
// #3458: ungdomskuld før 7/8 er 35 % baroudeur / 33 % climber / 25 % puncheur, mens
// sprinter kollapser fra 20,6 % (voksne) til 0,8 %.
//
// Ingen tuning af generator-konstanterne kan rette dette — derfor testes rettelser af
// selve klassifikations-INPUTTET:
//
//   A) UNGDOMS-FITTET BASELINE — fit mean/std over ungdoms-caps og klassificér mod den.
//      z-scores bliver meningsfulde INDEN FOR kuldet i stedet for mod en voksenpopulation
//      ungdomsrytterne pr. definition ligger under.
//   B) KLASSIFICÉR PÅ DET UTAPEREDE POTENTIALE-LOFT — "hvad bliver han som færdig
//      rytter" i stedet for "hvad er hans alders-taperede loft i dag". Matcher #3325's
//      ejer-beslutning (typen viser POTENTIALE, ikke dagens form) og lander i voksen-
//      rummet, hvor den shippede baseline faktisk passer.
//
//   node scripts/simYouthClassificationFix3458.js [--boost=2] [--ceil=60] [--n=1500]

import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS, ABILITY_KEYS } from "../lib/riderTypes.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shippedBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const BOOST = parseFloat(arg("boost", "2"));
const CEIL = parseInt(arg("ceil", "60"), 10);
const N = parseInt(arg("n", "1500"), 10);

const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, signatureBoostPerWeight: BOOST, statCeilBoosted: CEIL });
const rng = makeRng(2026);
const candidates = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: N, genCfg: cfg });

const rows = candidates.map((c, i) => {
  const riderRow = { id: `fix-${i}`, ...c.rider };
  const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const age = ageForSeason(riderRow.birthdate, 1);
  const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age }, bootstrap.primary.key, bootstrap.secondary.key);
  // B: det UTAPEREDE potentiale-loft = rytterens færdige (voksen-ækvivalente) profil.
  const matureCaps = buildYouthCaps(riderRow.potentiale, bootstrap.primary.key, bootstrap.secondary.key);
  return { draw: c.archetypeDraw, abilities, caps, matureCaps, bootstrapPrimary: bootstrap.primary.key };
});

// Fit en baseline (mean/std pr. evne) over et vilkårligt caps-sæt.
function fitBaseline(sets) {
  const mean = {}, std = {};
  for (const a of ABILITY_KEYS) {
    const vals = sets.map((s) => Number(s[a]) || 0);
    const m = vals.reduce((x, y) => x + y, 0) / (vals.length || 1);
    const v = vals.reduce((x, y) => x + (y - m) ** 2, 0) / (vals.length || 1);
    mean[a] = m; std[a] = Math.sqrt(v) || 1;
  }
  return { mean, std };
}

const hitRate = (finalKeyFn) => {
  let hits = 0;
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of rows) {
    const key = finalKeyFn(r);
    dist[key]++;
    // #3632: G1 er STRIKS (den trukne primaer) — alle anlaeg er nu to-delte.
    if (key === r.draw.primary) hits++;
  }
  return { pct: Math.round((hits / rows.length) * 1000) / 10, dist };
};

const youthBaseline = fitBaseline(rows.map((r) => r.caps));
const matureBaseline = fitBaseline(rows.map((r) => r.matureCaps));

const variants = {
  "NUVÆRENDE (caps × voksen-baseline)": (r) => computeRiderTypes(r.caps, shippedBaseline).primary.key,
  "A: caps × UNGDOMS-fittet baseline": (r) => computeRiderTypes(r.caps, youthBaseline).primary.key,
  "B: modent loft × voksen-baseline": (r) => computeRiderTypes(r.matureCaps, shippedBaseline).primary.key,
  "B2: modent loft × modent-fittet baseline": (r) => computeRiderTypes(r.matureCaps, matureBaseline).primary.key,
};

console.log(`=== Ungdoms-klassifikation: rettelses-test (boost=${BOOST}, loft=${CEIL}, n=${N}) ===\n`);
console.log(`Bootstrap rammer arketypen: ${hitRate((r) => r.bootstrapPrimary).pct} %  (loftet for enhver caps-baseret variant)\n`);

for (const [name, fn] of Object.entries(variants)) {
  const { pct, dist } = hitRate(fn);
  const distPct = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, Math.round((dist[t] / rows.length) * 1000) / 10]));
  const violations = RIDER_TYPE_KEYS.filter((t) => distPct[t] < 5 || distPct[t] > 30);
  console.log(`${name}`);
  console.log(`  G1 (rammer arketypen): ${pct} %${pct >= 90 ? "  ✓" : ""}`);
  console.log(`  G4 (fordeling 5-30 %): ${violations.length === 0 ? "OK ✓" : `brud på ${violations.join(", ")}`}`);
  console.log(`  fordeling: ${RIDER_TYPE_KEYS.map((t) => `${t.slice(0, 5)}=${distPct[t]}`).join("  ")}\n`);
}
