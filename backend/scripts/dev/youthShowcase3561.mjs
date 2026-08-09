#!/usr/bin/env node
// Datagrundlag for den VISUELLE gennemgang af ungdoms-generatoren (#3561).
//
// Producerer ét JSON-objekt med alt ejeren skal kunne se:
//   1. Konkrete rytter-eksempler fra HVER kalibrering (gammel / min / foreslået / defekt)
//   2. Bedste-evne pr. alder, så kalibreringerne kan holdes op mod de FAKTISKE prod-kuld
//   3. Livscyklus-projektion via den ÆGTE trænings-formel (dailyAbilityDelta)
//   4. Potentiale-topper (loftByPotential × rolle-faktor)
//
// Rører INTET i DB.  node scripts/dev/youthShowcase3561.mjs > showcase.json

import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider, YOUTH_PROGRESSION_CONFIG } from "../../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE } from "../../lib/riderTypes.js";
import { dailyAbilityDelta, DAILY_TRAINING_CONFIG, DEFAULT_PROGRAM } from "../../lib/dailyTraining.js";

const REF_YEAR = 2026;
const PHYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];

// ── De fire kalibreringer der sammenlignes ──────────────────────────────────────
// "gammel" kan ikke udtrykkes i den nuværende config (fase 1 brugte en anden
// boost-tabel), så den approksimeres med de vægte der giver SAMME rå løft:
// climber stat_bj fik 12 × 0,20 = +2,4 ⇒ vægt 3 × 0,8 = +2,4. Damp var fladt −1
// ⇒ dampPerWeight 1,0 rammer vægt-1-straffen præcist.
const CALIBRATIONS = {
  foreslaaet:     { signatureBoostPerWeight: 0.8, dampPerWeight: 1.0, statCeilBoosted: 54, label: "Foreslået — matcher det gamle" },
  min_nuvaerende: { signatureBoostPerWeight: 2, dampPerWeight: 2.6, statCeilBoosted: 54, label: "Min PR (for aggressiv)" },
  defekt_3458:    { signatureBoostPerWeight: 15, dampPerWeight: 2.6, statCeilBoosted: 99, label: "Defekt (7-9/8)" },
};

function buildRider(candidate, i) {
  const riderRow = { id: `sc-${i}`, ...candidate.rider };
  const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const age = REF_YEAR - Number(String(riderRow.birthdate).slice(0, 4));
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age }, bootstrap.primary.key, bootstrap.secondary.key);
  return { riderRow, abilities, caps, age, type: bootstrap.primary.key, secondary: bootstrap.secondary.key, draw: candidate.archetypeDraw };
}

function cohort(cfgPatch, n, seed = 4242) {
  const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, ...cfgPatch });
  const rng = makeRng(seed);
  const cands = generateAcademyCandidates({ rng, referenceYear: REF_YEAR, existingNames: new Set(), countOverride: n, genCfg: cfg });
  return cands.map(buildRider);
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

// ── 1+2: kalibrerings-sammenligning ─────────────────────────────────────────────
const comparison = {};
for (const [key, patch] of Object.entries(CALIBRATIONS)) {
  const riders = cohort(patch, 900);
  const byAge = {};
  for (let a = 16; a <= 21; a++) {
    const g = riders.filter((r) => r.age === a);
    if (!g.length) continue;
    const bests = g.map((r) => Math.max(...PHYS.map((k) => r.abilities[k])));
    const gaps = g.map((r) => { const v = PHYS.map((k) => r.abilities[k]).sort((x, y) => y - x); return v[0] - v[1]; });
    byAge[a] = { n: g.length, bedsteEvne: avg(bests), gab: avg(gaps) };
  }
  // Konkrete eksempler: én lav-, én middel- og én høj-potentiale rytter
  const pick = (lo, hi) => riders.find((r) => r.riderRow.potentiale >= lo && r.riderRow.potentiale <= hi);
  const examples = [pick(1, 1.5), pick(2.5, 3.5), pick(4.5, 6)].filter(Boolean).map((r) => ({
    navn: `${r.riderRow.firstname} ${r.riderRow.lastname}`,
    alder: r.age, potentiale: r.riderRow.potentiale, type: r.type, anlaeg: r.draw.primary,
    evner: Object.fromEntries(PHYS.map((k) => [k, r.abilities[k]])),
    caps: Object.fromEntries(PHYS.map((k) => [k, r.caps[k]])),
  }));
  comparison[key] = {
    label: patch.label,
    maxEvne: Math.max(...riders.map((r) => Math.max(...PHYS.map((k) => r.abilities[k])))),
    maxCap: Math.max(...riders.map((r) => Math.max(...VISIBLE_ABILITIES.map((k) => r.caps[k])))),
    byAge, examples,
  };
}

// Faktiske prod-tal fra kuldene FØR 7/8 (målt 9/8 via execute_sql) — referencen.
// Målt på de 384 'offered'-kandidater fra 19/7-6/8 der ALDRIG fik et hold
// (= aldrig trænet), så det er rene start-værdier.
const prodPre0708 = {
  16: { n: 65, bedsteEvne: 5.2, gab: 1.25, midt: 2.8 }, 17: { n: 82, bedsteEvne: 7.4, gab: 1.96, midt: 3.0 },
  18: { n: 100, bedsteEvne: 9.6, gab: 1.57, midt: 5.4 }, 19: { n: 62, bedsteEvne: 11.8, gab: 0.98, midt: 8.5 },
  20: { n: 48, bedsteEvne: 13.0, gab: 0.29, midt: 11.4 }, 21: { n: 27, bedsteEvne: 13.0, gab: 0.11, midt: 12.5 },
};

// ── 3: livscyklus via den ÆGTE trænings-formel ──────────────────────────────────
// Simulerer sæson for sæson på rytterens SIGNATUR-evne. Ingen staff/faciliteter
// (default 1.0), normal-program, neutral form, ingen støj → den rene kurve.
function projectCareer(startAbility, cap, startAge, potentiale, ability = "endurance", seasons = 12) {
  const points = [{ alder: startAge, evne: Math.round(startAbility * 10) / 10, loft: cap }];
  let current = startAbility;
  for (let s = 0; s < seasons; s++) {
    const alder = startAge + s;
    for (let d = 0; d < DAILY_TRAINING_CONFIG.daysPerSeason; d++) {
      current += dailyAbilityDelta({
        ability, current, cap, age: alder, program: DEFAULT_PROGRAM,
        conditionMult: 1, bonus: false, noise: 1, potentiale,
      });
      if (current > cap) current = cap;
    }
    points.push({ alder: alder + 1, evne: Math.round(current * 10) / 10, loft: cap });
  }
  return points;
}

// Én repræsentativ karriere pr. potentiale-trin, startende på det NYE bånd.
const careers = {};
for (const pot of [1, 2, 3, 4, 5, 6]) {
  const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, ...CALIBRATIONS.foreslaaet });
  const rng = makeRng(1000 + pot);
  // Find en 16-årig med netop dette potentiale
  let found = null;
  for (let tries = 0; tries < 40 && !found; tries++) {
    const cands = generateAcademyCandidates({ rng, referenceYear: REF_YEAR, existingNames: new Set(), countOverride: 60, genCfg: cfg });
    const rs = cands.map(buildRider);
    found = rs.find((r) => r.riderRow.potentiale === pot && r.age <= 17);
  }
  if (!found) continue;
  const sigAbility = PHYS.reduce((best, k) => (found.caps[k] > found.caps[best] ? k : best), PHYS[0]);
  careers[pot] = {
    navn: `${found.riderRow.firstname} ${found.riderRow.lastname}`,
    startAlder: found.age, signaturEvne: sigAbility,
    startEvne: found.abilities[sigAbility], loft: found.caps[sigAbility],
    kurve: projectCareer(found.abilities[sigAbility], found.caps[sigAbility], found.age, pot, sigAbility),
  };
}

// ── 4: potentiale-topper ────────────────────────────────────────────────────────
const c = YOUTH_PROGRESSION_CONFIG;
const potentialeTopper = Object.entries(c.loftByPotential).map(([pot, loft]) => ({
  potentiale: Number(pot),
  signatur: Math.round(loft * c.naturalPrimaryFactor),
  sekundaer: Math.round(loft * c.naturalSecondaryFactor),
  neutral: Math.round(loft * c.neutralFactor),
  modsat: Math.round(loft * c.oppositeFactor),
}));

console.log(JSON.stringify({
  comparison, prodPre0708, careers, potentialeTopper,
  referencer: { seniorMedianEvne: 21, seniorGnsBedsteEvne: 20.2, top50GnsBedsteEvne: 79.7 },
}, null, 2));
