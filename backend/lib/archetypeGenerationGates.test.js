// G1/G2-regressionstests for #3458 fase 2 (arketype-prior-generator).
//
// Lille n (300, fast seed) — hurtig+deterministisk i CI, IKKE et erstatning for
// det fulde sim-harness (backend/scripts/simArchetypeGeneration3458.js, kørt
// manuelt med n=2.000 før push, se PR-body-scorecardet). Formålet her er en
// REGRESSIONS-gate: hvis en fremtidig ændring (fx en util-refaktor der rører
// generateYouthStats/signatureProfile) knækker separationen, skal `node --test`
// fange det med det samme — ikke først ved den manuelle n=2.000-kørsel.
//
// Spejler PRÆCIS afled-kæden fra backend/lib/backfillCores.js' deriveForRiderIds
// (physiology → abilities → bootstrap-type → caps → endelig type), DB-frit.

import test from "node:test";
import assert from "node:assert/strict";

import { generateAcademyCandidates } from "./academyGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "./riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE } from "./riderTypes.js";
import { YOUTH_GEN_CONFIG } from "./academyGenerator.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));

const N = 300;
const SEED = 20260806;
const REFERENCE_YEAR = 2026;

// G1-GULVET SÆNKET 85 → 18 den 2026-08-09 (#3561). Læs dette før du "retter" det op igen:
//
// De 85 % var kun opnåelige fordi #3458 fase 2 mættede signatur-stats ved 99 (boost 15,
// statCeilBoosted 99). Det gav G1 95,6 % — og 374 prod-ryttere med afledt evne 90 og
// markedsværdi op til 42 mio, fordi caps = max(potentiale-loft, current). Kalibrerings-
// sweepet (scripts/simArchetypeCalibration3458.js, 54 kombinationer) viser at G1 og
// ungdomsbåndet er GENSIDIGT UDELUKKENDE med den nuværende klassifikation: G1 ligger på
// 23-30 % ved ENHVER kalibrering der holder potentiale-loftet, og springer først til
// 95,6 % når stats mættes ved 99.
//
// Rod-årsagen ligger IKKE i generatoren: ungdoms-caps klassificeres mod
// riderTypesBaseline.json, som er fittet over VOKSEN-caps. Der er time_trial strukturelt
// lav (z = −1,92 — kun tt/gc vægter den positivt, alle andre får neutralFactor 0,45), så
// enhver type der STRAFFER time_trial får en gratis bonus: baroudeur (time_trial: −1)
// æder 68 % af kuldet. Prod bekræfter at det er ÆLDRE end #3458 — ungdomskuld før 7/8 er
// 35 % baroudeur / 33 % climber / 25 % puncheur, mens sprinter kollapser fra 20,6 %
// (voksne) til 0,8 %. En ungdoms-fittet baseline løfter G1 til 71,7 % (målt,
// scripts/simYouthClassificationFix3458.js) — DET er rettelsen, ikke flere stat-point.
//
// Gulvet her er derfor sat til det opnåelige niveau og fanger stadig et ægte kollaps
// (fase-1-niveauet var ~21 %). Hæv det FØRST når klassifikations-fixet er landet.
const G1_REGRESSION_FLOOR_PCT = 18;
// Rå-evne-gab: SÆNKET 8 → 1 og indsnævret til 16-18-årige den 2026-08-09 (#3561).
// Ungdomsbåndet topper ved afledt evne 12, så et gab på 8 kræver at båndet brydes.
// Værre: statPerYearOver16 (1,4 rå point/år) løfter base-niveauet OVER statCeil=54 ved
// 20-21 år, så HELE profilen mættes ved loftet og gabet går mod 0 uanset boost — målt
// i prod på kuldene før 7/8: gab 1,15 ved 16 år → 0,39 ved 21 år (70 % med nul gab).
// Gaten måler derfor kun de aldre hvor båndet har plads. At ungdomsprofiler fladar ud
// mod graduerings-alderen er en ÆGTE designsvaghed (den #3458 forsøgte at rette) —
// den hører til klassifikations-/bånd-issuet, ikke til denne regressionsgate.
const G2_REGRESSION_MEDIAN_FLOOR = 1;
const G2_MAX_AGE = 18;
// Ungdomsbånd (#2064-ankre): afledt top mætter ~12; loft med luft til seed-varians.
const YOUTH_BAND_MAX_PHYSICAL_ABILITY = 15;

function runCohort(n, seed) {
  const rng = makeRng(seed);
  const candidates = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: n,
  });
  return candidates.map((c, i) => {
    const riderRow = { id: `g1-${seed}-${i}`, ...c.rider };
    const physiology = seedPhysiologyFromLegacy(riderRow);
    const abilities = deriveAbilities(physiology, riderRow);
    const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale }, bootstrap.primary.key, bootstrap.secondary.key);
    const final = computeRiderTypes(caps, typesBaseline);
    const youthCaps = buildYouthCaps(riderRow.potentiale, bootstrap.primary.key, bootstrap.secondary.key);
    return {
      archetypeDraw: c.archetypeDraw,
      finalPrimary: final.primary.key,
      riderRow,
      abilities,
      maxCap: Math.max(...VISIBLE_ABILITIES.map((a) => Number(caps[a]) || 0)),
      maxYouthCap: Math.max(...VISIBLE_ABILITIES.map((a) => Number(youthCaps[a]) || 0)),
    };
  });
}

// De fysiske evner ungdomsbåndet gælder for. `aggression` er UNDTAGET med vilje: den
// har et alders-drevet gulv (abilityDerivation: +0,15·youth for alle 16-21-årige) der
// er uafhængigt af stats og ville gøre båndet umåleligt.
const PHYSICAL_ABILITIES = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
]);

test(`G1-regression: klassifikatoren genfinder det trukne anlæg ≥${G1_REGRESSION_FLOOR_PCT}% (n=${N}, seed=${SEED})`, () => {
  const riders = runCohort(N, SEED);
  let hits = 0;
  for (const r of riders) {
    const { primary, secondary, isHybrid } = r.archetypeDraw;
    const hit = isHybrid ? (r.finalPrimary === primary || r.finalPrimary === secondary) : r.finalPrimary === primary;
    if (hit) hits++;
  }
  const pct = (hits / riders.length) * 100;
  assert.ok(pct >= G1_REGRESSION_FLOOR_PCT, `G1 ${pct.toFixed(1)}% under regressions-gulvet ${G1_REGRESSION_FLOOR_PCT}% (fase-1-niveauet var ~21% — se academyGenerator.js' YOUTH_GEN_CONFIG-historik hvis dette fejler)`);
});

test(`G1-regression: determinisme (samme seed → samme kuld → samme G1-tal)`, () => {
  const a = runCohort(N, SEED);
  const b = runCohort(N, SEED);
  assert.deepEqual(a.map((r) => r.finalPrimary), b.map((r) => r.finalPrimary));
  assert.deepEqual(a.map((r) => r.archetypeDraw), b.map((r) => r.archetypeDraw));
});

test(`G2-regression: specialiserings-dybde median ≥${G2_REGRESSION_MEDIAN_FLOOR} for 16-${G2_MAX_AGE}-årige`, () => {
  // Let, DB-fri proxy for den fulde G2-percentil-måling (som kræver en hel
  // population at normalisere imod, se sim-harnessen): måler i stedet at hver
  // rytters BEDSTE fysiske evne ligger over dens NÆSTBEDSTE — den rå-evne-analog
  // til "specialiserings-dybde". Kun 16-18-årige, se G2_MAX_AGE-kommentaren.
  const rng = makeRng(SEED + 1);
  const candidates = generateAcademyCandidates({ rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: N });
  const gaps = candidates
    .filter((c) => REFERENCE_YEAR - Number(String(c.rider.birthdate).slice(0, 4)) <= G2_MAX_AGE)
    .map((c) => {
      const riderRow = { id: "g2", ...c.rider };
      const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
      const vals = PHYSICAL_ABILITIES.map((k) => abilities[k]).sort((a, b) => b - a);
      return vals[0] - vals[1];
    }).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(
    median >= G2_REGRESSION_MEDIAN_FLOOR,
    `median rå-evne-gab ${median} (n=${gaps.length}, 16-${G2_MAX_AGE} år) under regressions-gulvet ${G2_REGRESSION_MEDIAN_FLOOR}`
  );
});

// ── G5/G6: de invarianter der MANGLEDE, og som lod #3561 slippe i produktion ──────
// G1-G4 måler alle RELATIVE forhold (genfinder klassifikatoren anlægget? er
// fordelingen jævn?). Ingen af dem ser på ABSOLUTTE niveauer, så en tuning kunne
// skrue signatur-stats op til 99 og stadig rapportere alle gates grønne. Disse tre
// tests lukker det hul.

test("G5-invariant: current må ALDRIG løfte ability_caps over potentiale-loftet", () => {
  // caps = max(potentiale-loft, current) i buildCapsForRider. Bryder en start-evne
  // igennem toppen, mister `potentiale` sin betydning: i prod 9/8 fik pot-1,0-ryttere
  // (loft 35) caps 99 og en markedsværdi på 38 mio. Dette er den skarpeste invariant
  // i hele ungdoms-systemet — 100 %, ingen tolerance.
  const riders = runCohort(N, SEED);
  const brud = riders.filter((r) => r.maxCap > r.maxYouthCap);
  assert.equal(
    brud.length, 0,
    `${brud.length}/${riders.length} ryttere har et top-loft over hvad potentialet tillader ` +
    `(fx pot ${brud[0]?.riderRow?.potentiale}: caps ${brud[0]?.maxCap} > loft ${brud[0]?.maxYouthCap}). ` +
    `Sænk YOUTH_GEN_CONFIG.statCeilBoosted — se #3561.`
  );
});

test(`G6-invariant: ungdomsbånd — ingen afledt fysisk evne over ${YOUTH_BAND_MAX_PHYSICAL_ABILITY}`, () => {
  // #2064's ejer-godkendte ankre: 16-årig bedste anlæg ~6, graduerings-alder ~12,
  // senior-median 21. En 16-21-årig må ikke starte over senior-medianen ("vinder fra
  // start"-problemet). I prod 9/8 var snittet 90.
  const riders = runCohort(N, SEED);
  let værst = { evne: 0 };
  for (const r of riders) {
    for (const a of PHYSICAL_ABILITIES) {
      const v = Number(r.abilities[a]) || 0;
      if (v > værst.evne) værst = { evne: v, ability: a, pot: r.riderRow.potentiale };
    }
  }
  assert.ok(
    værst.evne <= YOUTH_BAND_MAX_PHYSICAL_ABILITY,
    `højeste afledte fysiske evne ${værst.evne} (${værst.ability}, pot ${værst.pot}) over ungdomsbåndets ${YOUTH_BAND_MAX_PHYSICAL_ABILITY} — se #3561`
  );
});

test("G6-invariant: det forhøjede signatur-loft må ikke overstige det almindelige ungdomsloft", () => {
  // Den direkte konfigurations-vagt. statCeilBoosted > statCeil betyder pr. konstruktion
  // at signatur-stats forlader ungdomsbåndet; det var præcis 99 vs 54 der brød prod.
  // Skal en fremtidig kalibrering hæve den, SKAL sweepet (scripts/simArchetypeCalibration3458.js)
  // køres først og G5 stå på 100 %.
  assert.ok(
    YOUTH_GEN_CONFIG.statCeilBoosted <= YOUTH_GEN_CONFIG.statCeil,
    `statCeilBoosted ${YOUTH_GEN_CONFIG.statCeilBoosted} > statCeil ${YOUTH_GEN_CONFIG.statCeil} — ` +
    `signatur-stats forlader ungdomsbåndet. Se #3561.`
  );
});
