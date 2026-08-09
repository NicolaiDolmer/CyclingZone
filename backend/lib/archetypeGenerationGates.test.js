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
import { selectTypesBaseline } from "./riderTypesBaselineSelect.js";
import { YOUTH_GEN_CONFIG } from "./academyGenerator.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
// #3570: den ENDELIGE klassifikation for akademi-kandidater (altid < 22 år) skal nu
// gennem selectTypesBaseline ligesom deriveForRiderIds/backfillCores.js — ellers
// tester denne gate en anden kodesti end den produktionen faktisk kører.
const youthTypesBaseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaselineYouth.json"), "utf8"));

const N = 300;
const SEED = 20260806;
const REFERENCE_YEAR = 2026;

// G1-GULVET SÆNKET 85 → 18 den 2026-08-09 (#3561), HÆVET 18 → 35 den 2026-08-09
// (#3570, klassifikations-fixet er nu landet). Læs dette før du "retter" det op igen:
//
// De 85 % var kun opnåelige fordi #3458 fase 2 mættede signatur-stats ved 99 (boost 15,
// statCeilBoosted 99). Det gav G1 95,6 % — og 374 prod-ryttere med afledt evne 90 og
// markedsværdi op til 42 mio, fordi caps = max(potentiale-loft, current). Kalibrerings-
// sweepet (scripts/simArchetypeCalibration3458.js, 54 kombinationer) viser at G1 og
// ungdomsbåndet er GENSIDIGT UDELUKKENDE med den nuværende klassifikation: G1 ligger på
// 23-30 % ved ENHVER kalibrering der holder potentiale-loftet, og springer først til
// 95,6 % når stats mættes ved 99.
//
// Rod-årsagen lå IKKE i generatoren: ungdoms-caps blev klassificeret mod
// riderTypesBaseline.json, som er fittet over VOKSEN-caps. Der er time_trial strukturelt
// lav (z = −1,92 — kun tt/gc vægter den positivt, alle andre får neutralFactor 0,45), så
// enhver type der STRAFFER time_trial fik en gratis bonus: baroudeur (time_trial: −1)
// åd 68-77 % af kuldet (målt 9/8: 76,7 % af human-ejede 16-21-årige i prod).
//
// #3570 FASE 1-RETTELSEN (landet, PR #3571): en SEPARAT ungdoms-fittet baseline
// (riderTypesBaselineYouth.json) bruges til den ENDELIGE klassifikation for
// < 22-årige (selectTypesBaseline) — MÅLT dengang (bootstrap-drevne caps, denne fils
// population): G1 24,0 % (voksen-baseline) → 44,7 % (ungdoms-baseline).
//
// #3570 FASE 2-RETTELSEN (denne PR, ejer-go 9/8 sent): runCohort ovenfor er opdateret
// til at bruge caps formet af DET TRUKNE ANLÆG (archetypeDraw.primary/secondary)
// direkte, i stedet for et BOOTSTRAP-gæt (klassificeret mod flade, næsten-ens
// 16-21-års-profiler under NEUTRAL_BASELINE — målt 9/8: 0/303 gc-trukne genkendt som
// gc). GC-guarden (riderTypes.js) er samtidig slettet. MÅLT (denne fils population,
// n=300, seed=20260806, EFTER begge ændringer):
//   G1 (produktion: draw-caps + ungdoms-baseline)        72,3 %
//   G1 (draw-caps + VOKSEN-baseline)                     71,3 %  (se negativ-test)
//   G1 (BOOTSTRAP-caps + ungdoms-baseline — fase 1-kæden) 49,3 %
//   G1 (BOOTSTRAP-caps + VOKSEN-baseline — den ORIGINALE, dokumenterede pre-#3570-
//       defekt, 76,7 % baroudeur i prod 9/8)               28,3 %
// Draw-caps former en så adskilt profil at selv voksen-baselinen nu klassificerer
// rimeligt (71,3 % — kun 1pp under produktionens 72,3 %); FASE 1's
// ungdoms-baseline-fix var derfor et NØDVENDIGT men ikke TILSTRÆKKELIGT skridt —
// fase 2's draw-caps er den dominerende driver (49,3 % → 72,3 %, se negativ-testene).
//
// Gulvet er hævet 35 → 60 (≈12pp under det målte 72,3 %, samme
// sikkerhedsmargin-princip som de tidligere gulve havde).
const G1_REGRESSION_FLOOR_PCT = 60;
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
// G7 (ejer-valg 9/8, #3561): hvor stor en andel af de 16-17-årige må fødes på
// GRADUERINGS-niveau (evne 12 = det §2a sætter for 20-21-årige)? Medianerne alene
// fangede ikke dette: koden lå på kerne 1 / bedste 4 mod aftalens 3/6 — altså under —
// mens 7,1 % af kuldet blev født i toppen af hele båndet, to tredjedele af dem med
// potentiale ≤ 2. De sprang fem års udvikling over. Målt efter startLuckSd 1,2 → 0,6: 3,7 %.
const G7_MAX_PCT_BORN_AT_GRADUATION_LEVEL = 5;
const GRADUATION_LEVEL_ABILITY = 12;

// #3570 FASE 2: runCohort spejler nu backfillCores.deriveForRiderIds' PRODUKTIONS-
// kæde PRÆCIST — caps formes af det TRUKNE anlæg (archetypeDraw.primary/secondary),
// ikke bootstrap-gættet. Bootstrap beregnes stadig (samme som produktionen — fallback-
// sti for ryttere UDEN et draw) men bruges kun når useBootstrapCaps=true.
//
//   useAdultBaselineOnly (#3570 fase 1-negativ-test): springer selectTypesBaseline-
//     gaten over og bruger UDELUKKENDE voksen-baselinen — reproducerer FASE 1-
//     defekten (unge klassificeret mod voksen-baseline).
//   useBootstrapCaps (#3570 fase 2-negativ-test): bruger BOOTSTRAP-typen (ikke det
//     trukne anlæg) til caps — reproducerer FASE 1-KÆDENS defekt (0/303 gc-trukne
//     genkendt, målt 9/8) OG er den faktiske "intet draw"-kodesti for eksisterende
//     ryttere (backfillCores.js's fallback-gren).
function runCohort(n, seed, { useAdultBaselineOnly = false, useBootstrapCaps = false } = {}) {
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
    // #3570 fase 2: DET TRUKNE anlæg former caps direkte (samme gren som
    // backfillCores.js's deriveForRiderIds tager når rider.archetype_draw findes).
    const capsPrimary = useBootstrapCaps ? bootstrap.primary.key : c.archetypeDraw.primary;
    const capsSecondary = useBootstrapCaps ? bootstrap.secondary.key : (c.archetypeDraw.secondary || null);
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale }, capsPrimary, capsSecondary);
    // #3570: akademi-kandidater er ALTID 16-21 år (< 22) — samme alders-gate som
    // deriveForRiderIds/backfillCores.js bruger i produktion.
    const age = REFERENCE_YEAR - Number(String(riderRow.birthdate).slice(0, 4));
    const finalModel = useAdultBaselineOnly
      ? typesBaseline
      : selectTypesBaseline(age, typesBaseline, youthTypesBaseline);
    const final = computeRiderTypes(caps, finalModel);
    const youthCaps = buildYouthCaps(riderRow.potentiale, capsPrimary, capsSecondary);
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

function g1Pct(riders) {
  let hits = 0;
  for (const r of riders) {
    const { primary, secondary, isHybrid } = r.archetypeDraw;
    const hit = isHybrid ? (r.finalPrimary === primary || r.finalPrimary === secondary) : r.finalPrimary === primary;
    if (hit) hits++;
  }
  return (hits / riders.length) * 100;
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
  const pct = g1Pct(riders);
  assert.ok(pct >= G1_REGRESSION_FLOOR_PCT, `G1 ${pct.toFixed(1)}% under regressions-gulvet ${G1_REGRESSION_FLOOR_PCT}% (fase-1-niveauet var ~21% — se academyGenerator.js' YOUTH_GEN_CONFIG-historik hvis dette fejler)`);
});

// #3570 FASE 2 NEGATIV-TEST (designprincip: en gate skal fejle på KENDT defekt kode).
// Den ORIGINALE, dokumenterede pre-#3570-defekt (bootstrap-caps OG voksen-baseline —
// 76,7 % baroudeur målt i prod 9/8) skal falde LANGT under det nye gulv.
test(`#3570 NEGATIV-TEST (original defekt): bootstrap-caps + voksen-baseline falder under det nye gulv ${G1_REGRESSION_FLOOR_PCT}%`, () => {
  const riders = runCohort(N, SEED, { useAdultBaselineOnly: true, useBootstrapCaps: true });
  const pct = g1Pct(riders);
  assert.ok(
    pct < G1_REGRESSION_FLOOR_PCT,
    `bootstrap-caps + voksen-baseline gav G1 ${pct.toFixed(1)}% — forventede den under ${G1_REGRESSION_FLOOR_PCT}% ` +
    `(hvis den IKKE er det, måler gaten ikke længere den originale defekt)`
  );
});

// #3570 FASE 2 NEGATIV-TEST (isolerer draw-caps som driveren): den SAMME population,
// med FASE 1-KÆDEN (bootstrap-caps, ungdoms-baseline — PR #3571's shippede kodesti),
// skal give MARKANT lavere G1 end produktionen (draw-caps). Beviser at fase 2's
// arkitektur-fix (archetype_draw former caps) er det der driver forbedringen — ikke
// blot støj fra GC-guard-sletningen alene (som gælder BEGGE linjer her ens).
test("#3570 FASE 2 NEGATIV-TEST: bootstrap-caps (fase 1-kæden) giver markant LAVERE G1 end draw-caps (produktion)", () => {
  const production = g1Pct(runCohort(N, SEED));
  const phase1Chain = g1Pct(runCohort(N, SEED, { useBootstrapCaps: true }));
  assert.ok(
    phase1Chain < production - 15,
    `fase 1-kæden (bootstrap-caps) gav G1 ${phase1Chain.toFixed(1)}% mod produktionens ${production.toFixed(1)}% — ` +
    `forventede mindst 15pp forskel (hvis IKKE, isolerer denne test ikke længere draw-caps' effekt)`
  );
});

// #3570: voksne (>= 22 år) skal ramme PRÆCIS samme kodesti som før fixet —
// selectTypesBaseline skal returnere `typesBaseline` uændret, uanset om
// youthTypesBaseline findes. Bit-identisk klassifikation, ikke bare "samme resultat
// i praksis" — vi tester den FAKTISKE funktion begge produktionsstier kalder.
test("#3570: voksne (≥22 år) er BIT-IDENTISK uændret af ungdoms-baseline-gaten", () => {
  const adultAges = [22, 23, 30, 45, 99];
  for (const age of adultAges) {
    const model = selectTypesBaseline(age, typesBaseline, youthTypesBaseline);
    assert.equal(model, typesBaseline, `alder ${age} skal give den UÆNDREDE voksen-baseline-reference`);
  }
  // Samme caps-sæt, klassificeret via den fulde selectTypesBaseline-sti for en
  // 30-årig, skal give SAMME primary/secondary som et direkte kald mod
  // typesBaseline (den gamle, hidtidige kodesti) — dvs. gaten er et rent no-op for voksne.
  const caps = { climbing: 60, time_trial: 55, flat: 30, tempo: 50, sprint: 20, acceleration: 25, punch: 45, endurance: 55, recovery: 40, durability: 35, descending: 30, cobblestone: 25, aggression: 20 };
  const direct = computeRiderTypes(caps, typesBaseline);
  const gated = computeRiderTypes(caps, selectTypesBaseline(30, typesBaseline, youthTypesBaseline));
  assert.deepEqual(gated, direct, "en 30-årigs klassifikation er uændret af #3570");
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

test(`G7-invariant: højst ${G7_MAX_PCT_BORN_AT_GRADUATION_LEVEL} % af 16-17-årige fødes på graduerings-niveau`, () => {
  // Medianen kan ligge pænt under aftalen mens HALEN er helt gal — det var præcis
  // tilstanden 9/8. Denne gate måler fordelingens top, ikke dens midte.
  const rng = makeRng(SEED + 7);
  const candidates = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: 3000,
  });
  const unge = candidates.filter((c) => REFERENCE_YEAR - Number(String(c.rider.birthdate).slice(0, 4)) <= 17);
  let iToppen = 0;
  for (const c of unge) {
    const riderRow = { id: "g7", ...c.rider };
    const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
    if (Math.max(...PHYSICAL_ABILITIES.map((a) => Number(abilities[a]) || 0)) >= GRADUATION_LEVEL_ABILITY) iToppen++;
  }
  const pct = (iToppen / Math.max(1, unge.length)) * 100;
  assert.ok(
    pct <= G7_MAX_PCT_BORN_AT_GRADUATION_LEVEL,
    `${pct.toFixed(1)} % af de 16-17-årige (${iToppen}/${unge.length}) fødes med evne ≥ ${GRADUATION_LEVEL_ABILITY} — ` +
    `de springer fem års udvikling over. Sænk YOUTH_GEN_CONFIG.startLuckSd; se #3561.`
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
