// Deterministisk generator for fiktive ryttere (#669).
//
// Producerer komplette, spilbare rytter-records UDEN at røre databasen — kaldt
// af backend/scripts/generateFictionalRiders.js. Designprincipper (se
// docs/slices/669-fictional-riders.md):
//   • Deterministisk: samme (seed, referenceYear) → identisk output. Egen
//     seeded PRNG (mulberry32), aldrig Math.random.
//   • pcm_id ALTID null → markerer "egen rytter", usynlig for PCM-resultat-import.
//   • Sætter ALDRIG generated-kolonner (market_value/salary), base_value eller id —
//     DB udleder/backfill ejer dem. Ingen team_id (fri agent).
//   • Navne-unikhed håndhæves mod eksisterende DB-navne (foldNameNordic) for ikke
//     at gøre en ægte PCM-rytter "ambiguous" ved resultat-import (§3-fælden).

import { foldNameNordic } from "./pcmRiderMatcher.js";
import { NAME_CLUSTERS, clusterForNationality } from "./fictionalRiderNames.js";
import { seedArchetypePhysiology } from "./archetypePhysiology.js";
import {
  drawArchetype,
  drawSecondaryArchetype,
  DEFAULT_DISTRIBUTION,
  ARCHETYPE_TYPES,
} from "./archetypeDistribution.js";
import { isU25ForReferenceYear } from "./riderSeasonAge.js";
import { signatureProfile, blendArchetypeSignature, signatureMagnitudeScale } from "./archetypeSignature.js";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it.value;
  }
  return items[items.length - 1].value;
}

// Box-Muller — bruger to rng()-kald, så determinismen bevares.
// Eksporteret så race-simulatoren (#1102 slice 2) genbruger samme seeded
// normalfordeling (issue-krav: "genbrug makeRng/Box-Muller").
export function gaussian(rng, mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ── De 14 stats (rækkefølge som schema.sql) ───────────────────────────────────
export const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

// Fjern intern `_meta` (audit/inspektion, ikke en DB-kolonne) → ren INSERT-payload.
// Delt af CLI'en og integrationstesten, så de tester præcis samme vej.
//
// #3606: ÉT felt løftes UD af `_meta` før strippet — det TRUKNE anlæg
// (`_meta.archetypeDraw`) bliver til DB-kolonnen `archetype_draw`.
//
// Rod-årsagen det lukker: generatoren trækker en arketype og former hele rytterens
// stats + krop efter den (buildStats/buildDemographics), men trækket forsvandt her.
// Klassifikatoren skulle så GÆTTE typen bagefter ud fra netop de stats — og det
// gæt er rodårsagen bag #3570 (se resolveRiderTypes i riderTypes.js for
// fikspunkt-målingen). Akademi-stien har persisteret sit træk siden #3570 fase 2
// (academyIntake.js); ALLE andre generator-stier smed det væk. Målt på prod 10/8:
// 0 af 287 ryttere på menneskehold oprettet siden 1/8 bar et anlæg.
//
// Denne ENE linje dækker hver eneste produktions-sti, fordi de alle passerer
// herigennem: buildWeakStarterPool (start-trup kerne+hale, AI tier 3/4, begge
// dev-top-ups), generateAiRiderBatchWithCap (AI tier 1/2), generateLaunchPopulation
// → relaunchOrchestrator, og scripts/generateFictionalRiders.js.
//
// Guarden (`_meta?.archetypeDraw`) holder kaldere med et syntetisk `_meta` (fx
// starterSquadAllocator.test.js' `_meta: { age: 23 }`) bit-identiske med før.
export function toInsertPayload(riders) {
  return riders.map(({ _meta, ...row }) => (
    _meta?.archetypeDraw ? { ...row, archetype_draw: _meta.archetypeDraw } : row
  ));
}

// ── Type-arketyper: sigter de 8 AFLEDTE ryttertyper direkte (#669/#677-launch) ─
// Hver arketype svarer til en type i riderTypes.js og booster de stats, der via
// abilityDerivation.js driver den types POSITIV-vægtede abilities, og dæmper off-
// type-stats (rolle-svaghed ON, ejer-beslutning). Det gør den afledte type
// pålidelig (≈ den tilsigtede) frem for at lade z-score+guards default'e alt til tt.
//   • boost: stat → +løft oven på tier-basen (signatur-stat løftes mest).
//   • damp:  stats der trækkes ned, så typen bliver skarp.
//   • minStats: hårdt gulv så type-GUARDS i riderTypes.js opfyldes ved ALLE tiers
//       (gc kræver climbing/tt/recovery samtidigt høje; mapping PCM→ability: 72→63,
//       67→49 ≥ guard-tærskler 57/43).
//   • capSpeciality: loft så rouleur (intet speciale ≥79) ikke guardes ud
//       (ability 79 ↔ PCM ~78).
export const ARCHETYPES = [
  { type: "sprinter",       boost: { stat_sp: 12, stat_acc: 9, stat_fl: 6 },                                   damp: ["stat_bj", "stat_kb", "stat_udh"], heightMean: 182, bmi: 22.8 },
  { type: "tt",             boost: { stat_tt: 12, stat_prl: 10, stat_fl: 5 },                                  damp: ["stat_sp", "stat_bk", "stat_bj"],  heightMean: 185, bmi: 22.2 },
  { type: "climber",        boost: { stat_bj: 12, stat_kb: 8, stat_bk: 5,  stat_udh: 5 },                      damp: ["stat_sp", "stat_acc", "stat_fl"], heightMean: 173, bmi: 19.5 },
  { type: "puncheur",       boost: { stat_bk: 11, stat_kb: 8, stat_bj: 6,  stat_udh: 5 },                      damp: ["stat_tt", "stat_sp"],             heightMean: 176, bmi: 21.0 },
  { type: "brostensrytter", boost: { stat_bro: 13, stat_fl: 7, stat_udh: 5, stat_bk: 5 },                      damp: ["stat_bj", "stat_sp"],             heightMean: 184, bmi: 23.2 },
  { type: "baroudeur",      boost: { stat_ftr: 11, stat_fl: 5, stat_bk: 5,  stat_udh: 6, stat_ned: 5, stat_res: 5 }, damp: ["stat_tt"],                  heightMean: 179, bmi: 21.3 },
  { type: "rouleur",        boost: { stat_fl: 6,  stat_udh: 5, stat_res: 4 },                                  damp: [],                                 heightMean: 180, bmi: 21.6, capSpeciality: 76 },
  { type: "gc",             boost: { stat_bj: 10, stat_tt: 9, stat_res: 8, stat_kb: 7, stat_udh: 5, stat_mod: 5 }, damp: ["stat_sp"],                   heightMean: 177, bmi: 20.3, minStats: { stat_bj: 72, stat_tt: 67, stat_res: 67 } },
];
export const ARCHETYPE_BY_TYPE = Object.fromEntries(ARCHETYPES.map((a) => [a.type, a]));

// Stats der tæller som "speciale" for rouleur-cap'en (matcher riderTypes.js).
const SPECIALITY_STATS = ["stat_bj", "stat_kb", "stat_bk", "stat_bro", "stat_tt", "stat_sp"];

// ── Styrke-tiers: eksakt kvote (ikke vægtet sampling) → præcis værdi-pyramide ──
// statMean = overall stat-niveau pr. tier; tier styrer hvor højt arketypens
// boostede signatur-stats lander → afledt ability-output → base_value-bånd.
// Kvote = andel af count (ejer-spec ~800: 12 super / 60 stjerner / 230 solide /
// resten domestik). uci-felterne er legacy efter #1101-cutover (økonomien kører
// på base_value via backfill); potential/popularity styrer demografi.
//
// v3-kalibrering (#1194): værdimodellen blender speciale 50/50 med SNITTET af
// alle evner (riderValuation.js), så de øvre bånd kræver BREDE profiler —
// dampScale skalerer rolle-svagheds-dæmpningen ned pr. tier (superstjerner er
// alsidige, domestikker beholder fuld rolle-svaghed). sd strammes mod toppen:
// modellens konvekse kurve (c·O²) forstørrer stat-varians eksponentielt deroppe,
// så et bredt sd ville skyde enkelte superstjerner langt over værdi-loftet
// (~25M) og tabe andre under 8M. statMean/dampScale/sd er empirisk tunet mod
// 12/60/230/500 via scripts/previewFictionalPopulation.js.
const TIERS = [
  { value: "superstar",  fraction: 12 / 800,  statMean: 70.75, dampScale: 0.35, sd: 1.5,  uci: [1800, 4000], potential: [3.0, 5.0], popularity: [70, 100] },
  { value: "star",       fraction: 60 / 800,  statMean: 67,    dampScale: 0.5,  sd: 2.5,  uci: [700, 1800],  potential: [3.0, 6.0], popularity: [45, 85] },
  { value: "solid",      fraction: 230 / 800, statMean: 63.75, dampScale: 0.75, sd: 2.75, uci: [120, 700],   potential: [2.0, 5.0], popularity: [10, 50] },
  { value: "domestique", fraction: null,      statMean: 53,   dampScale: 1,    sd: 3.5,  uci: [1, 120],     potential: [1.0, 4.0], popularity: [0, 18] }, // rest
];

// Plan 2 (#1122): tier → fysiologi-NIVEAU (0..1) til arketype-skæv seeding.
// Spejler værdi-pyramiden: superstjerner kører tæt på elite-loftet.
const TIER_PHYSIOLOGY_LEVEL = { superstar: 0.92, star: 0.75, solid: 0.55, domestique: 0.30 };

// #1420: eksponér default-fraktionerne (afledt af TIERS) så mix-presets kan bygge
// skews oven på dem uden at duplikere tallene. domestique udelades (er rest).
export const DEFAULT_TIER_FRACTIONS = Object.fromEntries(
  TIERS.filter((t) => t.fraction != null).map((t) => [t.value, t.fraction]),
);

// v3-værdi-udligning (#1194): værdimodellens type-offsets (riderValuationModel.json:
// sprinter +1.06 … puncheur −0.66) flytter bånd-grænserne flere O-enheder pr. type.
// Uden modvægt eksploderer sprinter-toppen (~4× en tt-profil ved samme stats) og
// puncheur/rouleur når aldrig deres tier-bånd. Justerer tier-basen (stat-point)
// pr. arketype; empirisk tunet mod preview-harnessen.
const TYPE_MEAN_ADJUST = {
  sprinter: -1.5, climber: -0.5, brostensrytter: 0, baroudeur: 0.5,
  gc: 0.5, tt: -1, rouleur: 1.5, puncheur: 1.5,
};

// Tier-aware type-fordeling (vægte) — realistisk peloton: ledere (gc/klatrer/
// sprinter/tt/puncheur/brosten) i toppen, hjælpere (rouleur/baroudeur)
// i bunden. Sikrer også at GUARD-tunge typer (gc) kun lander hvor de kan opfylde
// guarden. Gulv på sjældne typer håndhæves efter sampling (ENSURE_MIN_TYPES).
const TIER_TYPE_WEIGHTS = {
  superstar:  { gc: 3, climber: 3, sprinter: 2, tt: 2, puncheur: 1, brostensrytter: 2 },
  star:       { gc: 3, climber: 4, sprinter: 4, tt: 3, puncheur: 2, brostensrytter: 2, baroudeur: 1 },
  solid:      { gc: 2, climber: 4, sprinter: 4, tt: 3, puncheur: 2, brostensrytter: 2, baroudeur: 3, rouleur: 2 },
  domestique: { climber: 4, sprinter: 3, tt: 2, puncheur: 2, brostensrytter: 1, baroudeur: 4, rouleur: 6 },
};

// #1420: alias-eksport til mix-presets (resolveMix bygger skews oven på disse).
export const DEFAULT_TIER_TYPE_WEIGHTS = TIER_TYPE_WEIGHTS;

// Globalt gulv på sjældne typer (ejer-spec: etape-variation kræver dybde i alle
// discipliner). Håndhæves ved at promovere de billigste over-repræsenterede typer.
//
// #3458 fase 2 PR2: gulvet er nu KUN aktivt på LEGACY-stien (eksplicit
// tierTypeWeights-override, #1420 dev-tooling). DEFAULT-stien (ALLE rigtige
// produktions-kaldere, se generateFictionalRiders nedenfor) trækker i stedet fra
// archetypeDistribution.js, hvis eget FLOOR_PCT (~8,5 % pr. type, langt over dette
// gulv) håndhæves i selve MÅL-FORDELINGEN frem for som en efterfølgende
// promoverings-løkke — dvs. #3570/S2's degenerations-klasse kan strukturelt ikke
// opstå der. #3570/S2's skalering nedenfor er BEVARET og håndhæves fortsat på
// legacy-stien; se scaleMinTypes + kommentaren i type-sekvensen.
//
// #3570/S2 (10/8): gulvene er ANTAL, kalibreret mod ejer-spec'ens ~800-rytter-felt
// ("alle 8 repræsenteret, gulv gc≥30, sprinter≥40" — orakel i
// fictionalLaunchPopulation.js: LAUNCH_TYPE_FLOORS). De blev oprindeligt håndhævet
// som ABSOLUTTE tal pr. GENERATOR-KALD, hvilket var harmløst så længe det eneste
// kaldsted var launch-populationen (count 800, #669 7/6).
//
// Fra 20/6 begyndte trup-stierne at kalde generatoren med små counts:
//   #1560 (20/6) allocateStarterSquadForTeam → buildWeakStarterPool(count 8)
//   #1820 (23/6) hale-puljen                → buildWeakStarterPool(count 4)
//   #2065 (30/6) AI-hold tier 3/4           → buildWeakStarterPool(count 8 og 16)
// "Mindst 30 gc og mindst 40 sprintere" i et træk på 8 promoverer HELE trækket:
// målt over 15.000 kald pr. størrelse er count 4/8/16/24/30/48 alle 100 %
// sprinter+gc og 0 af de øvrige seks arketyper. Degenerationen aftager først
// over count ≈ 96 og er væk ved ≈ 240. Målt på prod 10/8 er 5.550 af 8.199
// levende ryttere født ad en sådan sti.
//
// Gulvet er derfor en ANDEL af feltet, ikke et absolut tal: det skaleres til det
// faktiske count med 800 som kalibrerings-reference. Ved count = 800 giver
// skaleringen præcis 30/40 igen → relaunch-populationen er byte-identisk.
// Linjen nedenfor holdes ordret (scripts/gateMutationAudit.js' pop-MUT-6 patcher
// netop denne tekst).
const ENSURE_MIN_TYPES = { gc: 30, sprinter: 40 };
const ENSURE_MIN_REFERENCE_COUNT = 800;

/**
 * Gulvene skaleret til et konkret `count`. Et gulv der runder til 0 håndhæves
 * ikke: ved små træk er "mindst én gc" ikke et gulv, det er en kvote der spiser
 * hele trækket. Ren funktion — forbruger INGEN rng, så determinismen for et
 * givet (seed, count) er uændret.
 *
 * @param {number} count antal ryttere i dette generator-kald
 * @returns {Object<string, number>} type → minimumsantal for netop dette kald
 */
export function scaleMinTypes(count, mins = ENSURE_MIN_TYPES, reference = ENSURE_MIN_REFERENCE_COUNT) {
  const scaled = {};
  for (const [type, min] of Object.entries(mins)) {
    const n = Math.round((min * count) / reference);
    if (n > 0) scaled[type] = n;
  }
  return scaled;
}

// ── #3458 fase 2 PR2: DEFAULT-stien — arketype-prior fra archetypeDistribution.js ──
// (samme mønster som akademiets PR1, udvidet til markeds-/AI-/launch-populationen).
// Denne sti bruges når INGEN tierTypeWeights-override er givet (dvs. ALLE rigtige
// produktions-kaldere: starterSquadAllocator.js, aiTeamGenerator.js, fictionalLaunch-
// Population.js — ingen af dem sætter tierTypeWeights). Eksplicit tierTypeWeights
// (#1420 dev-tooling/mix-presets, fictionalRiderMixPresets.js) bruger FORTSAT den
// gamle TIER_TYPE_WEIGHTS-mekanisme uændret (se generateFictionalRiders nedenfor) —
// et bevidst dobbelt-spor der holder dev-tool-kontrakten (og dens tests) intakt.

// Eksplicit, KOMMENTERET tier-modifikator OVEN PÅ archetypeDistribution-formlen
// (IKKE en parallel tabel — kun multiplikative afvigelser fra mål-fordelingen).
// Bevarer den gamle TIER_TYPE_WEIGHTS' tier-differentiering (flere gc/tt-specialister
// i toppen af værdi-pyramiden, hvor etapeløbs-/tt-stjerner hører hjemme; flere
// rouleur/baroudeur-hjælperyttere i bunden) uden at duplikere hele fordelingen.
// Multiplicerer DEFAULT_DISTRIBUTION FØR trækning — drawArchetype normaliserer selv
// (vægtet sum), så absolutte tal er ligegyldige, kun RATIOEN mellem typer tæller.
// Udeladte typer (ingen nøgle) = uændret (×1). FLOOR_PCT (~8,5%) i archetypeDistribution.js
// betyder ingen type kan blive helt væk selv efter en nedvægtning.
// #3458 fase 2 PR2 (empirisk justeret via sim-harness): gc/tt-multiplikatoren for
// superstar/star DÆMPET (fra 2.6/1.8 og 1.8/1.4) — gc/tt er de to typer med mest
// evne-OVERLAP (climbing+time_trial delt mellem gc/climber/tt, se GC_TIME_TRIAL/
// CLIMBING_BOOST_RATIO), OG superstar/star-tiernes dampScale (0,35/0,5 — "superstjerner
// er alsidige", uændret v3-værdi-udligningsmekanik) svækker BEVIDST dæmpningen af
// off-type-stats ved høje tiers — de to effekter sammen gjorde netop superstar/
// star markant sværere at klassificere korrekt (målt: 66,7%/72,7% G1 mod 90-92%
// for solid/domestique). Mildere gc/tt-vægtning holder STADIG tier-differentieringen
// (flere etapeløbs-/tt-specialister i toppen), blot mindre aggressivt.
const TIER_ARCHETYPE_MODIFIER = Object.freeze({
  superstar:  Object.freeze({ gc: 1.15, tt: 1.1, climber: 1.2, sprinter: 1.1, rouleur: 0.5, baroudeur: 0.5 }),
  star:       Object.freeze({ gc: 1.1, tt: 1.05, climber: 1.1, rouleur: 0.65, baroudeur: 0.65 }),
  solid:      Object.freeze({ gc: 1.2, tt: 1.1, rouleur: 0.85 }),
  domestique: Object.freeze({ rouleur: 1.3, baroudeur: 1.15, gc: 0.5, tt: 0.7 }),
});

function distributionForTier(tierValue) {
  const modifier = TIER_ARCHETYPE_MODIFIER[tierValue];
  if (!modifier) return DEFAULT_DISTRIBUTION;
  const out = {};
  for (const t of ARCHETYPE_TYPES) out[t] = DEFAULT_DISTRIBUTION[t] * (modifier[t] ?? 1);
  return out;
}

// Klassifikator-vægt-afledt boost/dæmp for MARKEDS-/AI-/launch-populationen —
// samme MØNSTER som akademiets signatureProfile (archetypeSignature.js), men
// magnitude-formlen er TILPASSET: akademiets flade "vægt × konstant" forudsætter
// en SMAL, lav basis (16-årige, statCeil 54→99 — langt over stat-loftet 85, så
// enhver rimelig boost mætter). Markeds-populationen spænder derimod over 4
// værdi-TIERS på den SAMME hårde [50,85]-skala (statMean 53 → 70,75) — en flad
// konstant der adskiller vægt-1 fra vægt-3 ved domestique-tieren (mean 53) METTER
// IDENTISK (begge ability 99) ved superstar-tieren (mean 70,75), fordi begge
// allerede passerer pcmFrac-loftet på 85 — hele separations-idéen forsvinder netop
// øverst i værdi-pyramiden. LØSNINGEN: normalisér boost/damp-magnitude til en
// ANDEL af tier'ens EGET resterende hovedrum (til loft/gulv), skaleret af den
// STØRSTE vægt i selve signatur-profilen (signatureMagnitudeScale) — typens EGEN
// top-evne mætter dermed PÅLIDELIGT uanset tier, mens delte lavere-vægtede evner
// kun får en forholdsmæssig mindre andel af det SAMME hovedrum. Tier-invariant
// udgave af akademiets vægt-proportionalitets-princip — ikke et nyt princip.
const ADULT_SIGNATURE_CFG = Object.freeze({
  // KENDT, ROD-ÅRSAGS-UNDERSØGT SPÆNDING (empirisk, se PR-body): boost-magnitude
  // er den SAMME "hvor ekstrem er signatur-evnen"-drejeknap som predictBaseValue's
  // speciale-led læser (v3-kalibrering, riderValuation.js — RØRES IKKE). Et
  // hovedrum stort nok til akademiets G1-niveau (95,6%, jf. YOUTH_GEN_CONFIG)
  // SPRÆNGER launch-populationens EKSISTERENDE, ejer-godkendte værdi-pyramide-
  // kalibrering (fictionalLaunchPopulation.test.js: superstjerner∈[3,18] —
  // 1,45 gav 105!). 0,67 er det HØJESTE hovedrum der stadig holder pyramiden
  // (superstjerner=4, stjerner=95, maxV=36,3M, alle inden for de eksisterende
  // grænser) — værdipyramiden er en PRE-EXISTING, testet invariant og VINDER
  // over G1 her. Dæmpnings-siden (dampHeadroomFraction) påvirker IKKE maxV
  // (verificeret empirisk: konstant ~36,3M for damp 0,66→4,0) og kan derfor
  // skrues højere for ekstra klassifikations-kontrast uden værdi-risiko.
  boostHeadroomFraction: 0.67,
  dampHeadroomFraction: 2.0,
  // Samme designfund som akademiet (archetypeSignature.js/academyGenerator.js):
  // gc's climbing+time_trial er BEGGE vægt-3, og time_trial ALENE er en RIVAL-
  // typs (tt) hele signatur — symmetrisk mætning af begge vinder tt-normaliseringen
  // (G3) for gc næsten hver gang.
  gcTimeTrialBoostRatio: 0.55,
  gcClimbingBoostRatio: 0.85,
});

// TYPE_MEAN_ADJUST-lookup for et arketype-træk (hybrid: gennemsnit af de to).
// Defineret her (frem for inline) da den bruges to steder (gaussian-base OG
// hovedrums-beregning nedenfor).
// REBASE-NOTE 4/9 (#3512 mod main): `draw.isHybrid` findes ikke længere — #3632
// fjernede hybrid-flaget, ALLE ryttere har nu en reel sekundær. Vægten er derfor
// eksplicit (secondarySignatureWeight, låst til 0 på main, se
// SECONDARY_SIGNATURE_WEIGHT) i stedet for et 15%-flag. w = 0 ⇒ præcis primærens
// eget tal, dvs. samme værdi PR'ens ikke-hybride 85% fik.
function typeMeanAdjustFor(draw, w) {
  const primaryAdj = TYPE_MEAN_ADJUST[draw.primary] ?? 0;
  if (!(w > 0) || !draw.secondary || draw.secondary === draw.primary) return primaryAdj;
  const secondaryAdj = TYPE_MEAN_ADJUST[draw.secondary] ?? 0;
  return primaryAdj * (1 - w) + secondaryAdj * w;
}

// #3458 fase 2 PR2 (fund efter generateAiRiderBatchWithCap-verifikation, se
// AI_SIGNATURE_CFG nedenfor for udledningen): cfg er nu et PARAMETER (default
// ADULT_SIGNATURE_CFG), ikke en fast modul-konstant — AI tier 1/2 skal kunne bede
// om en MILDERE signatur-intensitet uden at svække markeds-/launch-populationens.
function buildStatsFromSignature(
  rng,
  tier,
  draw,
  cfg = ADULT_SIGNATURE_CFG,
  secondaryWeight = SECONDARY_SIGNATURE_WEIGHT,
) {
  // REBASE-NOTE 4/9 (#3512 mod main): PR'en blandede de to anlægs signaturer for
  // de ~15% der var `isHybrid`. #3632/#3634 har siden gjort sekundæren universel
  // OG låst dens vægt til 0, fordi `npm run race:gate` (#1102, SEPARAT CI-trin —
  // IKKE en del af `node --test`) fejler ved enhver vægt derover: dens bånd er en
  // golden-population-fixture. Blandingen er derfor bevaret men slukket, præcis
  // som legacy-grenens blendArchetypeShape. Ved w = 0 er dette bit-identisk med
  // PR'ens ikke-hybride sti. Hæves vægten, skal race:gate rekalibreres FØRST —
  // sænk aldrig en gate for at få et tal til at passe.
  const w = draw.secondary && draw.secondary !== draw.primary
    ? clamp(Number(secondaryWeight) || 0, 0, 0.5)
    : 0;
  const signature = w > 0
    ? blendArchetypeSignature(draw.primary, draw.secondary, cfg)
    : signatureProfile(draw.primary, cfg);
  const maxBoost = signatureMagnitudeScale(signature.boost);
  const maxDamp = signatureMagnitudeScale(signature.damp);
  const adjustedMean = tier.statMean + typeMeanAdjustFor(draw, w);
  // #1194's dampScale (superstar 0,35/star 0,5 — "superstjerner er alsidige") er tunet
  // til VÆRDI-pyramiden (bevarer et højt snit på tværs af evner for elite-værdi-båndet),
  // ikke til klassifikations-SEPARATION — anvendt råt gav superstar/star markant
  // dårligere G1 (66,7%/72,7% mod 90-92% for solid/domestique) fordi off-type-stats
  // knap nok dæmpes ved høje tiers. Et LOKALT gulv (KUN her, TIERS' egen dampScale-
  // værdi/OLD buildStats' brug er urørt) sikrer nok kontrast til klassifikation uden at
  // fjerne #1194's "alsidig elite"-intention helt.
  const dampScale = Math.max(tier.dampScale ?? 1, 0.8);
  const headroomUp = STAT_CEIL - adjustedMean;
  const headroomDown = adjustedMean - STAT_FLOOR;
  const stats = {};
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, adjustedMean, tier.sd ?? 3.5);
    if (signature.boost[key]) {
      const frac = maxBoost > 0 ? signature.boost[key] / maxBoost : 0;
      v += headroomUp * frac * cfg.boostHeadroomFraction;
    } else if (signature.damp[key]) {
      const frac = maxDamp > 0 ? signature.damp[key] / maxDamp : 0;
      v -= headroomDown * frac * cfg.dampHeadroomFraction * dampScale;
    }
    stats[key] = Math.round(clamp(v, STAT_FLOOR, STAT_CEIL));
  }
  return stats;
}

// #3458 fase 2 PR2 — REEL PRODUKTIONS-REGRESSION fundet + rettet (verificeret
// empirisk mod den ÆGTE generateAiRiderBatchWithCap, ikke kun harnesset): AI
// tier 1/2-fyld kombinerer arketype-generatoren med et HÅRDT værdiloft
// (AI_TIER_VALUE_CAP, #2065-sikkerhedsnet, ejer-gated — RØRES IKKE her).
// Værdimodellen blender speciale-scoren 50/50 med snittet af alle evner (v3-
// kalibrering) — jo mere PÅLIDELIGT saturerende signatur-boost, jo oftere bliver
// en KORREKT klassificeret specialist-kandidat værd flere MILLIONER, langt over
// tier 1's 200.000-loft. Ved den oprindelige (G1-optimerede, men værdipyramide-
// brydende) boostHeadroomFraction=1,35 fejlede 9/20 seeds ("kun X/24 under
// loft") mod 0/20 for den GAMLE ARCHETYPE_BY_TYPE-mekanisme — en reel regression.
// ADULT_SIGNATURE_CFG er sidenhen SÆNKET (0,67) for at overholde launch-
// populationens EGEN, pre-existing værdi-pyramide-kalibrering (se dens
// kommentar) — hvilket ALENE bragte AI-fejlraten til 0/80 uden en separat cfg.
// AI_SIGNATURE_CFG bevares alligevel som en EKSPLICIT, UAFHÆNGIGT tunet
// sikkerhedsmargin (defense-in-depth): hvis ADULT_SIGNATURE_CFG senere justeres
// igen (fx et markeds-/værdi-refit løfter loftet), skal AI tier 1/2 IKKE
// stiltiende arve en ny risiko for #2065-klassen af fejl — værdiloftet er
// stadig den ÆGTE garanti (generateAiRiderBatchWithCap forkaster/rerruller),
// denne cfg reducerer blot hvor OFTE loftet rammes. Empirisk tunet (80 seeds,
// begge tiers, ÆGTE 60-runders-budget): boostHeadroomFraction=1,0 gav 2/80
// (2,5%) fejl for tier 2 (100% domestique, 100k-loft — det strammeste); 0,9
// gav 0/80 for BEGGE tiers.
export const AI_SIGNATURE_CFG = Object.freeze({
  ...ADULT_SIGNATURE_CFG,
  boostHeadroomFraction: 0.9,
  dampHeadroomFraction: 0.9,
});

// Default-nationalitetsvægte: afspejler prod-feltet (2026-05-31) + garanteret
// repræsentation af ikke-vestlige nationer (se GUARANTEED) for at teste hybrid-
// navnepools' svageste punkt. Vægt ≈ relativ tilstedeværelse i feltet.
export const DEFAULT_NATIONALITY_WEIGHTS = [
  { value: "FR", weight: 54 }, { value: "IT", weight: 53 }, { value: "BE", weight: 50 },
  { value: "ES", weight: 37 }, { value: "NL", weight: 36 }, { value: "CO", weight: 30 },
  { value: "CN", weight: 27 }, { value: "GB", weight: 27 }, { value: "US", weight: 23 },
  { value: "DE", weight: 22 }, { value: "DK", weight: 22 }, { value: "AU", weight: 19 },
  { value: "JP", weight: 17 }, { value: "NO", weight: 15 }, { value: "PT", weight: 14 },
  { value: "PL", weight: 13 }, { value: "AR", weight: 13 }, { value: "CZ", weight: 12 },
  { value: "KR", weight: 12 }, { value: "NZ", weight: 11 }, { value: "CA", weight: 11 },
  { value: "CH", weight: 10 }, { value: "AT", weight: 10 }, { value: "SE", weight: 8 },
  { value: "SI", weight: 7 }, { value: "DZ", weight: 7 }, { value: "ER", weight: 5 },
  { value: "RW", weight: 4 }, { value: "MA", weight: 5 }, { value: "BR", weight: 6 },
];

// Nationer der ALTID skal være repræsenteret mindst én gang (RFC-default).
const GUARANTEED = ["CN", "JP", "KR", "CO", "DZ", "ER"];

// Den ægte PCM-stat-skala er HÅRDT [50,85] (verificeret mod prod 2026-06-07:
// 8.969 PCM-ryttere, alle 14 stats i præcis [50,85] — 0 udenfor). Fiktive ryttere
// SKAL holde sig på samme skala: ellers clampes deres outliers til evne-1/99 ved
// kilden i evne-systemet (#1122, abilityDerivation.js: PCM 50→spil-1, 85→spil-99).
// Skalaen er fast (empirisk om PCM), derfor hardcodet — ikke koblet til evne-
// systemets tuning-ankre (CALIBRATION), selvom de tilfældigvis er samme tal nu.
// #3458 fase 2 PR2: eksporteret så starterSquadAllocator.js kan RESKALERE (ikke
// blot clampe) ind i sit svage vindue uden at duplikere denne skala — se
// buildWeakStarterPool's kommentar for hvorfor reskalering afløste clamp.
export const STAT_FLOOR = 50;
export const STAT_CEIL = 85;

// Kalibreret mod den ægte poolede PCM-fordeling (prod 2026-06-07): mean ~60.5,
// sd ~5.6, median 60, p99 ~75, max 85 — dvs. 85 er EKSTREMT sjældent (~1% af
// stats > 75). Modellen holder sig inden for [50,85] ved konstruktion: smalt
// tier-spænd + moderate rolle-boosts + stram gaussian (sd 4). clamp er kun et
// sikkerhedsnet for de sjældne gaussiske haler (ikke en aktiv stat-grænse, som
// det gamle [40,88] var). Specialisering bevares: rolle-primær løftes mærkbart
// over base, så sprintere ≫ klatrere i sprint osv.
// #3634: hvor meget af BI-typens signatur der blandes ind i voksen-statsene.
//
// Akademi-stien har den samme knap (YOUTH_GEN_CONFIG.secondarySignatureWeight,
// 0,10) — men dens mekanik er en anden (vægtet klassifikator-profil mod et smalt
// ungdomsbånd, ikke ARCHETYPES' boost-punkter mod [50,85]), så tallet kan IKKE
// lånes. Voksen-vægten er MÅLT for sig med scripts/simSecondaryArchetype3634.js.
// At de to lander på samme tal er et sammentræf, ikke en kobling.
//
// MÅLINGEN (16/8, n=3.000 + margin-sweep over 40 seeds à 800 ryttere):
//
//   vægt | krop→sekundær | krop→primær | mindste margin på de 6 bestående
//        |  (aflæselig?) | (identitet) | generator-gates | seeds der FEJLER
//   -----|---------------|-------------|-----------------|------------------
//   0    |      18,2 %   |    58,5 %   |  4,16 (p10 4,55)|  0/40   ← VALGT (se nedenfor)
//   0,10 |      27,4 %   |    53,9 %   |  0,71 (p10 1,27)|  0/40   ← separations-loftet
//   0,15 |         —     |       —     | −0,25 (p10 0,37)|  1/40
//   0,20 |      32,8 %   |    49,1 %   | −1,03 (p10−0,41)| 14/40
//   0,25 |         —     |       —     | −1,85           | 32/40
//
// "krop→sekundær" = andelen hvor bi-typen kan AFLÆSES i de rå afledte evner
// (klassificeret UDEN de anlægs-formede caps). Ved w = 0 er den 18,2 % — omtrent
// hvad et tilfældigt anlæg giver, hvilket ER problemet: rytteren fik et evne-loft
// (naturalSecondaryFactor 0,82) i en retning kroppen ikke pegede.
//
// Separations-loftet er sat af ÉN gate: `sprinter.stat_sp > sprinter.stat_bj + 10`
// (fictionalRiderGenerator.test.js, "rolle-svagheder dæmper off-type-stats"). En
// sprinter med klatrer-bitype får netop stat_bj løftet i stedet for dæmpet — det
// er den tilsigtede fysik, og gaten er formuleret i en verden hvor ryttere kun
// havde ÉT anlæg.
//
// ── HVORFOR VÆRDIEN ER 0 OG IKKE 0,10 ────────────────────────────────────────
//
// `npm run race:gate` (backend/scripts/raceGate.js, #1102) er GRØN på 3/3 seeds
// før denne ændring og fejler ved ENHVER vægt over 0 — målt:
//
//   vægt  | race:gate     | hvilke bånd falder
//   ------|---------------|-------------------------------------------------
//   0     | 3/3 pass      | (bit-identisk population — kan ikke fejle)
//   0,02  | 2/3 pass      | cobbles: brostensrytter 78 % mod ≥80 %
//   0,05  | 2/3 pass      | do.
//   0,075 | 1/3 pass      | + itt: tt 59 % mod ≥60 %
//   0,10  | 1/3 pass      | + itt_tempo, favoriteWinRate 52,8-57,2 % mod [25,40]
//
// Gatens kalibrerings-bånd er i praksis en GOLDEN-POPULATION-fixture: de er tunet
// mod præcis den population generatoren producerer i dag, så enhver ændring af
// kroppen tripper dem — også en på 2 %. Det er ikke et argument for at bi-typen
// er forkert; det er en måling af at gaten ikke kan skelne "populationen blev
// bevidst ændret" fra "motoren gik i stykker".
//
// Derfor er vægten 0: ALT det presserende i #3634/#3631 (anlægget forankres,
// sekundæren trækkes fra DEFAULT_DISTRIBUTION i stedet for at blive gættet) er
// UAFHÆNGIGT af vægten og virker fuldt ud ved 0. Med 0 er populationen desuden
// bit-identisk med før, så hverken race:gate, balance-snapshottet eller
// rytterøkonomien flytter sig overhovedet.
//
// Blandingen nedenfor er BEVIDST bevaret og målt, ikke død kode: den er den ene
// konstant der mangler, hvis ejeren beslutter at bi-typen også skal forme kroppen.
// Prisen for at hæve den er målt og står i PR #3800 — kort: ~11 % lavere
// medianværdi på nyfødte ryttere, og race:gate's bånd skal rekalibreres FØRST.
// Sænk aldrig en af de to gates for at få et tal til at passe.
// Jf. .claude/learnings/2026-08-11-guard-premise-decay-archetype-draw.md.
export const SECONDARY_SIGNATURE_WEIGHT = 0;

// Blandt de to anlæg til ÉN syntetisk signatur — samme model som akademi-stiens
// `blendArchetypeSignature` (academyGenerator.js), oversat til voksen-mekanikken
// (ARCHETYPES' boost-punkter + damp-liste i stedet for klassifikator-vægte):
//
//   boost  konvekst snit over UNIONEN af de to anlægs boosts: (1−w)·primær + w·sekundær.
//   damp   en SKALA i [0,1] i stedet for en liste: (1−w) hvis primæren dæmper,
//          + w hvis sekundæren gør. En stat der er ét af anlæggenes SIGNATUR
//          (boost > 0) dæmpes ikke — akademi-stiens "kun de FÆLLES svagheder"-
//          regel, her udtrykt via boost-grenen: en climber+puncheur må ikke
//          dæmpes på punch.
//
// Ved w = 0 reducerer begge linjer PRÆCIS til primærens egne tal, og boost/damp
// er da gensidigt udelukkende (ingen enkelt arketype både booster og dæmper samme
// stat). Kaldet er derfor bit-identisk med koden før #3634 ved w = 0 — det er dét,
// sim-scorecardets referencearm hviler på.
function blendArchetypeShape(primary, secondary, weight) {
  const w = secondary && secondary !== primary ? clamp(Number(weight) || 0, 0, 0.5) : 0;
  const boost = {};
  for (const key of new Set([...Object.keys(primary.boost), ...Object.keys(secondary?.boost ?? {})])) {
    const v = (primary.boost[key] ?? 0) * (1 - w) + (secondary?.boost[key] ?? 0) * w;
    if (v > 0) boost[key] = v;
  }
  const damp = {};
  for (const key of STAT_KEYS) {
    const v = (primary.damp?.includes(key) ? 1 - w : 0) + (secondary?.damp?.includes(key) ? w : 0);
    if (v > 0) damp[key] = v;
  }
  return { boost, damp };
}

function buildStats(rng, tier, archetype, secondary = null, secondaryWeight = 0) {
  const stats = {};
  // TYPE_MEAN_ADJUST følger PRIMÆREN alene: den modvirker værdimodellens
  // type-offset for den type rytteren rent faktisk bliver klassificeret som, og
  // det er primæren (bi-typen flytter formen, ikke prisskiltet).
  const base = tier.statMean + (TYPE_MEAN_ADJUST[archetype.type] ?? 0);
  const dampScale = tier.dampScale ?? 1;
  const shape = blendArchetypeShape(archetype, secondary, secondaryWeight);
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, base, tier.sd ?? 3.5);
    if (shape.boost[key]) v += shape.boost[key] + intBetween(rng, -2, 2);
    else if (shape.damp[key]) v -= intBetween(rng, 5, 10) * dampScale * shape.damp[key];
    stats[key] = Math.round(clamp(v, STAT_FLOOR, STAT_CEIL));
  }
  // Hårdt gulv → opfyld type-GUARDS ved alle tiers (fx gc's climbing/tt/recovery).
  if (archetype.minStats) {
    for (const [key, floor] of Object.entries(archetype.minStats)) {
      if (stats[key] < floor) stats[key] = Math.round(clamp(floor, STAT_FLOOR, STAT_CEIL));
    }
  }
  // Loft → undgå at rouleur guardes ud (speciale < 79 ability ↔ PCM ~78).
  if (archetype.capSpeciality != null) {
    for (const key of SPECIALITY_STATS) stats[key] = Math.min(stats[key], archetype.capSpeciality);
  }
  return stats;
}

function buildDemographics(rng, tier, archetype, referenceYear, secondary = null, secondaryWeight = 0) {
  const age = Math.round(clamp(gaussian(rng, 27, 4.5), 18, 39));
  const birthYear = referenceYear - age;
  const birthMonth = intBetween(rng, 1, 12);
  const birthDay = intBetween(rng, 1, 28);
  const birthdate = `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;
  // U25 = UCI-reglen (ejer-beslutning 2/9-2026): sæson-alder ≤ 25, dvs. født
  // >= referenceår-25. SSOT: riderSeasonAge.isU25ForReferenceYear (delt med
  // raceRunner.js/riderProgressionEngine.js), ikke inlinet her længere.
  const is_u25 = isU25ForReferenceYear(birthdate, referenceYear);

  // #3634: KROPPEN formes af begge anlæg — samme konvekse vægt som statsene, så
  // en climber/brostensrytter ikke længere fødes med en ren klatrekrop. Ved w = 0
  // er begge udtryk primærens egne tal (bit-identisk med koden før #3634).
  const w = secondary && secondary !== archetype ? clamp(Number(secondaryWeight) || 0, 0, 0.5) : 0;
  const heightMean = archetype.heightMean * (1 - w) + (secondary?.heightMean ?? archetype.heightMean) * w;
  const bmi = archetype.bmi * (1 - w) + (secondary?.bmi ?? archetype.bmi) * w;
  const height = Math.round(clamp(gaussian(rng, heightMean, 5), 165, 196));
  const weight = Math.round(bmi * (height / 100) ** 2);

  // Potentiale: tier-interval, løftet for unge, sænket for ældre; 0.5-trin.
  const [pLo, pHi] = tier.potential;
  let pot = pLo + rng() * (pHi - pLo);
  pot += (24 - age) * 0.05;
  pot = clamp(Math.round(pot * 2) / 2, 1.0, 6.0);

  return { birthdate, is_u25, height, weight, potentiale: pot, age };
}

export function makeUniqueName(rng, cluster, usedFolded) {
  // Forsøg simple first+last; ved kollision re-sample. Efter mange forsøg
  // (lille pool ift. count) tilføj mellem-initial for at tvinge unikhed.
  for (let attempt = 0; attempt < 40; attempt++) {
    const first = pick(rng, cluster.first);
    const last = pick(rng, cluster.last);
    const folded = foldNameNordic(`${first} ${last}`);
    if (!usedFolded.has(folded)) {
      usedFolded.add(folded);
      return { firstname: first, lastname: last };
    }
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const first = pick(rng, cluster.first);
    const initial = pick(rng, cluster.first)[0];
    const last = pick(rng, cluster.last);
    const firstname = `${first} ${initial}.`;
    const folded = foldNameNordic(`${firstname} ${last}`);
    if (!usedFolded.has(folded)) {
      usedFolded.add(folded);
      return { firstname, lastname: last };
    }
  }
  throw new Error("Navne-pool udtømt: for mange ryttere for én nationalitets pool — udvid pools eller sænk antal.");
}

/**
 * Generér fiktive rytter-records (rør ingen DB).
 *
 * @param {object} opts
 * @param {number} opts.seed               heltal — styrer al tilfældighed deterministisk
 * @param {number} opts.count              antal ryttere
 * @param {number} opts.referenceYear      år som alder/U25 beregnes mod
 * @param {Set<string>} [opts.existingFoldedNames]  foldNameNordic af alle eksisterende DB-navne.
 *        MUTERES: alle genererede navne føjes til settet, så FLERE kald der deler samme
 *        set aldrig kan trække samme navn (#3416 — kerne+hale-kaldene i buildWeakStarterPool
 *        gav navne-dubletter INDEN FOR samme hold, som væltede rytter-sletning via
 *        race_results_entrant_unique da navne-fallbacken kollapsede nøglerne).
 * @param {Array<{value,weight}>} [opts.nationalityWeights]  override af default-fordeling
 * @param {Object<string,number>} [opts.tierFractions]  override af tier-andele (#1420 mix-presets);
 *        map tier→andel (superstar/star/solid); domestique er altid rest. null = DEFAULT_TIER_FRACTIONS.
 * @param {Object<string,Object<string,number>>} [opts.tierTypeWeights]  override af per-tier
 *        arketype-vægte (#1420); null = DEFAULT_TIER_TYPE_WEIGHTS. Default på begge → uændret adfærd.
 * @param {number} [opts.secondarySignatureWeight]  #3634: hvor meget bi-typen former krop+stats.
 *        Kun til sim-sweepet (scripts/simSecondaryArchetype3634.js); produktionen bruger
 *        modul-konstanten SECONDARY_SIGNATURE_WEIGHT. 0 = kroppen formes af primæren alene
 *        (referencearmen — bit-identisk med koden før #3634). Gælder BEGGE grene:
 *        legacy-grenens blendArchetypeShape OG #3458-grenens blendArchetypeSignature.
 * @param {object} [opts.signatureCfg]  #3458 fase 2 PR2 — KUN NY-stien (ingen
 *        tierTypeWeights-override): boost/dæmp-hovedrums-cfg til buildStatsFromSignature.
 *        Default ADULT_SIGNATURE_CFG (markeds-/launch-styrke). AI tier 1/2 sender
 *        AI_SIGNATURE_CFG (mildere — se dens kommentar for hvorfor).
 * @returns {{ riders: object[], coverage: object, seed: number }}
 */
export function generateFictionalRiders({
  seed,
  count,
  referenceYear,
  existingFoldedNames = new Set(),
  nationalityWeights = DEFAULT_NATIONALITY_WEIGHTS,
  tierFractions = null,
  tierTypeWeights = null,
  secondarySignatureWeight = SECONDARY_SIGNATURE_WEIGHT,
  signatureCfg = ADULT_SIGNATURE_CFG,
}) {
  if (!Number.isInteger(seed)) throw new Error("seed skal være et heltal");
  if (!Number.isInteger(count) || count < 1) throw new Error("count skal være et positivt heltal");
  if (!Number.isInteger(referenceYear)) throw new Error("referenceYear skal være et heltal");

  const rng = makeRng(seed);
  // #4180: navnene traekkes fra en EGEN rng-understroem, ikke fra hovedstroemmen.
  //
  // Foer #4180 kaldte makeUniqueName hovedstroemmen, og antallet af kald afhang
  // af hvor mange navne-KOLLISIONER der opstod. Laengere navnelister giver faerre
  // kollisioner, faerre rng-kald og dermed en forskudt stroem: en ren tilfoejelse
  // af navne aendrede hver eneste rytters stats, krop og alder. Det gjorde
  // navne-vedligehold uforholdsmaessigt dyrt (#4178/#4179) og blandede to ting
  // sammen i enhver balance-diff: navnene og populationen.
  //
  // Med en egen understroem er navnelisterne frakoblet: at tilfoeje, splitte
  // eller udvide et cluster kan ikke laengere flytte en eneste stat. Samme
  // moenster og samme begrundelse som secondaryRng (#3634) nedenfor.
  // Understroemmen er ren funktion af seed, saa determinismen er uaendret.
  // 0x6a09e667 er SHA-256's foerste IV-ord — en veletableret, veldistribueret
  // splitte-konstant, valgt forskellig fra secondaryRng's 0x9e3779b9.
  const nameRng = makeRng((seed + 0x6a09e667) >>> 0);
  // #3416: brug det MEDSENDTE set direkte (ingen kopi) — kopien gjorde at to kald
  // der delte samme set (fx kerne+hale i buildWeakStarterPool) ikke kendte
  // hinandens navne og kunne give samme navn to gange på samme hold.
  const usedFolded = existingFoldedNames;

  // #1420: komposition-override (mix-presets). null = modul-konstanten → samme
  // reference/værdier → identisk rng-forbrug → byte-identisk determinisme.
  // domestique-tieren (fraction == null) er altid rest og kan ikke overrides.
  const tiers = tierFractions
    ? TIERS.map((t) =>
        t.fraction != null && tierFractions[t.value] != null
          ? { ...t, fraction: tierFractions[t.value] }
          : t,
      )
    : TIERS;
  // #3458 fase 2 PR2: eksplicit tierTypeWeights → LEGACY-mekanisme (#1420 dev-
  // tooling, uændret adfærd/determinisme); ingen override (ALLE rigtige
  // produktions-kaldere) → NY arketype-prior-mekanisme (archetypeDistribution.js).
  const usingLegacyTypeWeights = tierTypeWeights != null;
  const typeWeights = tierTypeWeights ?? TIER_TYPE_WEIGHTS;

  // ── Tier-sekvens via eksakt kvote (ikke Poisson-sampling) ───────────────────
  const tierSeq = [];
  const domestiqueTier = tiers.find((t) => t.fraction == null);
  for (const t of tiers) {
    if (t.fraction == null) continue;
    const n = Math.min(Math.round(t.fraction * count), count - tierSeq.length);
    for (let k = 0; k < n; k++) tierSeq.push(t);
  }
  while (tierSeq.length < count) tierSeq.push(domestiqueTier);
  tierSeq.length = count;
  for (let i = tierSeq.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tierSeq[i], tierSeq[j]] = [tierSeq[j], tierSeq[i]];
  }

  // ── Primær-type-sekvens: LEGACY (vægtet pick + gulv) ELLER NY (#3458 prior) ──
  // REBASE-NOTE 4/9 (#3512 mod main efter #3632/#3634/#4180): begge grene trækker
  // NØJAGTIG ÉT rng-kald pr. rytter fra HOVEDstrømmen til primæren, præcis som
  // main gør — det er dét der holder hovedstrømmens forbrug (og dermed stats,
  // krop, alder) på samme offset i begge grene.
  let typeSeq;
  if (usingLegacyTypeWeights) {
    typeSeq = tierSeq.map((t) => {
      const weights = typeWeights[t.value];
      return weightedPick(rng, Object.entries(weights).map(([value, weight]) => ({ value, weight })));
    });
    // #3570/S2 (BEVARET gennem #3458-rebasen): gulvene skaleres til dette kalds
    // count — se ENSURE_MIN_TYPES. Uden skaleringen promoverer "mindst 30 gc og
    // 40 sprintere" HELE trækket ved count 4/8/16/24. Legacy-stien har ingen
    // FLOOR_PCT at falde tilbage på, så skaleringen er den ENESTE ting der holder
    // små legacy-træk fra at degenerere til 100 % sprinter+gc.
    const minTypes = scaleMinTypes(count);
    for (const [type, min] of Object.entries(minTypes)) {
      let have = typeSeq.filter((x) => x === type).length;
      for (let i = 0; i < typeSeq.length && have < min; i++) {
        if (typeWeights[tierSeq[i].value][type] == null) continue; // tier tillader ikke typen
        if (typeSeq[i] === type || minTypes[typeSeq[i]]) continue; // stjæl ikke fra andet gulv
        typeSeq[i] = type;
        have++;
      }
    }
  } else {
    // #3458 fase 2 PR2: arketype-prior-først (samme princip som akademiets PR1) —
    // trækkes fra archetypeDistribution-formlen, tier-modificeret (se
    // TIER_ARCHETYPE_MODIFIER). FLOOR_PCT i selve fordelingen erstatter
    // ENSURE_MIN_TYPES-gulvene her; det er hele pointen med prior-først.
    //
    // REBASE-NOTE 4/9: PR'en kaldte oprindeligt drawArchetypePair(rng, …), som
    // dengang trak BÅDE primær og (15 % af gangene) sekundær fra hovedstrømmen.
    // #3632/#3634 har siden fjernet hybrid-flaget helt — ALLE ryttere har nu en
    // reel sekundær, og den trækkes fra en EGEN understrøm. Vi trækker derfor
    // primæren alene her og lader den fælles sekundær-sekvens nedenfor gælde
    // BEGGE grene.
    typeSeq = tierSeq.map((t) => drawArchetype(rng, distributionForTier(t.value)));
  }

  // ── Sekundær-sekvens (#3634) ────────────────────────────────────────────────
  // Trækkes EFTER gulv-håndhævelsen: gulvene kan overskrive en rytters primære
  // type, og en sekundær trukket før ville kunne ende identisk med den nye primær.
  //
  // EGEN rng-understrøm (seed + 2^32/φ, samme splitte-konstant som i mulberry32'ens
  // egen inkrementering) — bevidst, ikke en genvej: hovedstrømmen er den der former
  // hver eneste stat, krop, alder og navn i hele launch-populationen. Trak vi
  // sekundæren fra den, ville selve DET at forankre anlægget flytte 800 ryttere,
  // og enhver diff i balance-baselinen ville blande to ting sammen: forankringen
  // og bi-typens vægt. Med en egen understrøm er `secondarySignatureWeight: 0`
  // BIT-IDENTISK med koden før #3634, og vægten er dermed den eneste variabel i
  // sim-scorecardet. Determinismen er uændret: understrømmen er ren funktion af seed.
  //
  // REBASE-NOTE 4/9 (#3512): gælder nu BEGGE grene. #3632's kontrakt — "alle nye
  // ryttere fødes med et to-delt anlæg" — er ikke til forhandling, og en gren der
  // fødte 85 % af ryttere med secondary=null (PR'ens oprindelige hybrid-model)
  // ville genindføre præcis det svigt #3634 målte: 72 ryttere på tre døgn fik
  // deres secondary_type udpeget af klassifikatoren i stedet for af anlægget.
  // REBASE-NOTE 4/9 (#3512): sekundæren trækkes fra DEFAULT_DISTRIBUTION i BEGGE
  // grene — IKKE fra den tier-modificerede fordeling. Prøvet og forkastet: en
  // tier-modificeret sekundær-fordeling fælder #3631's gate
  // ("sekundær-fordelingen følger DEFAULT_DISTRIBUTION", L1 ≤ 8 pp — målt 8,3 pp).
  // TIER_ARCHETYPE_MODIFIER er en udtalelse om hvilke LEDER-typer der hører til i
  // hvilket værdi-tier, ikke om hvilket bi-anlæg en rytter fødes med.
  const secondaryRng = makeRng((seed + 0x9e3779b9) >>> 0);
  const secondarySeq = typeSeq.map((primary) => drawSecondaryArchetype(secondaryRng, primary));

  // Byg nationalitets-sekvens: garanterede nationer først, resten vægtet, så
  // deterministisk blandet, så garanterede ikke altid klumper i starten.
  const nationalities = [];
  for (const iso of GUARANTEED) {
    if (nationalities.length < count) nationalities.push(iso);
  }
  while (nationalities.length < count) {
    nationalities.push(weightedPick(rng, nationalityWeights));
  }
  // Fisher-Yates med samme rng (deterministisk).
  for (let i = nationalities.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nationalities[i], nationalities[j]] = [nationalities[j], nationalities[i]];
  }

  const riders = [];
  const coverage = { byCluster: {}, fallbackNationalities: {} };

  for (let i = 0; i < count; i++) {
    const nationality = nationalities[i];
    const clusterKey = clusterForNationality(nationality);
    const cluster = NAME_CLUSTERS[clusterKey];
    if (clusterKey === "generic") {
      coverage.fallbackNationalities[nationality] =
        (coverage.fallbackNationalities[nationality] || 0) + 1;
    }
    coverage.byCluster[clusterKey] = (coverage.byCluster[clusterKey] || 0) + 1;

    const tier = tierSeq[i];
    // demografi (heightMean/bmi) slås op pr. PRIMÆR type i begge grene
    const archetype = ARCHETYPE_BY_TYPE[typeSeq[i]];
    const secondaryArchetype = ARCHETYPE_BY_TYPE[secondarySeq[i]];
    const draw = { primary: typeSeq[i], secondary: secondarySeq[i] };

    const { firstname, lastname } = makeUniqueName(nameRng, cluster, usedFolded);
    const stats = usingLegacyTypeWeights
      ? buildStats(rng, tier, archetype, secondaryArchetype, secondarySignatureWeight)
      : buildStatsFromSignature(rng, tier, draw, signatureCfg, secondarySignatureWeight);
    const demo = buildDemographics(rng, tier, archetype, referenceYear, secondaryArchetype, secondarySignatureWeight);
    const physiology = seedArchetypePhysiology({
      archetype: archetype.type,
      tierLevel: TIER_PHYSIOLOGY_LEVEL[tier.value] ?? 0.5,
      height_cm: demo.height,
      weight_kg: demo.weight,
      rng, // samme seeded rng — forbruger deterministisk efter demografi
    });
    const uci_points = intBetween(rng, tier.uci[0], tier.uci[1]);
    const popularity = intBetween(rng, tier.popularity[0], tier.popularity[1]);

    riders.push({
      pcm_id: null, // markør for "egen rytter" — aldrig sat
      firstname,
      lastname,
      nationality_code: nationality,
      birthdate: demo.birthdate,
      height: demo.height,
      weight: demo.weight,
      popularity,
      uci_points,
      is_u25: demo.is_u25,
      potentiale: demo.potentiale,
      ...stats,
      // Bevidst udeladt (DB udleder/defaulter, backfill ejer base_value): id, base_value, market_value, salary,
      // team_id, ai_team_id, pending_team_id, prize_earnings_bonus, is_retired,
      // created_at, updated_at, acquired_at.
      _meta: {
        tier: tier.value,
        archetype: archetype.type,
        // #3606: rytterens ANLÆG i præcis samme form som akademi-stien persisterer
        // (academyGenerator.js' drawArchetypePair → academyIntake.js:
        // { primary, secondary }). toInsertPayload løfter det til riders.archetype_draw.
        //
        // #3634 (16/8): secondary er ikke længere null. Indtil da trak voksen-
        // generatoren ÉN arketype og formede stats + krop efter den alene, så der
        // var ingen anden arketype i kroppen at persistere — og følgen var at
        // AI-hold- og startholds-ryttere (aiTeamGenerator, starterSquadAllocator)
        // fik deres secondary_type udpeget af klassifikatoren ved hver natlige
        // genberegning, præcis som akademi-ryttere gjorde før #3632. Målt: 72
        // ryttere født uden anlægs-sekundær på tre døgn (24/døgn), alle via
        // startholds-stien til nye menneskeejede hold.
        //
        // Rettelsen er IKKE at skrive en løsrevet sekundær ind (det ville give
        // rytteren et evne-loft — youthRoleFactor 0,82 — i en retning kroppen ikke
        // peger) og heller ikke klassifikatorens gæt (det ville fryse netop gættet,
        // rodårsagen bag #3570, ind som identitet). Kroppen formes nu efter BEGGE
        // anlæg, med SECONDARY_SIGNATURE_WEIGHT som vægt — se blendArchetypeShape.
        archetypeDraw: { primary: archetype.type, secondary: secondaryArchetype.type },
        age: demo.age,
        cluster: clusterKey,
        physiology,
      },
    });
  }

  return { riders, coverage, seed };
}
