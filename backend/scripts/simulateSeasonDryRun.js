#!/usr/bin/env node
// Race-engine dry-run / kalibrerings-cockpit (#1102).
//
// Kører HELE den kalibrerede launch-population gennem den ægte light-motor over en
// hel sæson — 100% in-memory, rører INTET i prod/DB/flag. Formålet er at kalibrere
// motoren mod ejer-definerede mål-vinderrater og at gøre det SYNLIGT: ud over
// console-rapporten skrives en selvstændig HTML-cockpit (--html) med hele Grand
// Tour'en etape-for-etape (startliste + resultater) + en målscorecard.
//
// Kæden (præcis som prod-backfillsne + previewFictionalPopulation.js):
//   generateFictionalRiders → deriveAbilities → computeRiderTypes/predictBaseValue
//     → simulateStage / buildRaceResults (UÆNDREDE rene funktioner)
//
//   node scripts/simulateSeasonDryRun.js [--seed=2026] [--count=800] \
//        [--races=300] [--field=140] [--gtField=176] [--html=<sti>] [--no-html] \
//        [--condition=random] [--roles] [--enforce-targets] \
//        [--population=<fil>] [--condition=snapshot] [--enforce-dominance]
//
// #2224 (Race v3 S0): --population=<sti til population-snapshot.json> kører
// harnesset mod en ÆGTE prod-population-snapshot (produceret af
// exportPopulationSnapshot.js) i stedet for den genererede fiktive population.
// I population-mode er B-scorecardet/udbruds-bånd/roles-bånd/liveness ALTID
// rapport-only (håndhæves aldrig, uanset --enforce-*-flag) — de bånd er
// kalibreret mod den GENEREREDE population. --condition=snapshot bruger
// snapshottets egne form/fatigue-værdier (kun gyldigt sammen med --population).
// Sektion F (dominans/varians-scorecard, #2224) kører i ALLE modes og kan
// håndhæves med --enforce-dominance. UDEN --population er scriptet
// bit-identisk med før #2224 (determinisme-guard).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, makeRng } from "../lib/fictionalRiderGenerator.js";
import { resolveMix } from "../lib/fictionalRiderMixPresets.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue, riderOverall, riderSpecialty } from "../lib/riderValuation.js";
import { DEMAND_VECTORS, finaleFor } from "../lib/raceStageProfileGenerator.js";
import { simulateStage, stableSeed, NOISE_SD_SCALE, aggressionScore, BREAKAWAY_BONUS, FORM_RACE_WEIGHT, FATIGUE_RACE_WEIGHT, DISTANCE_BAND_MIDPOINTS } from "../lib/raceSimulator.js";
// Sub-3 (#2771) Task 7: --routes berigelse (pass 2) af harnessets inline-byggede
// stageProfiles — SAMME rene funktion som prod-generatoren bruger.
import { attachRoute } from "../lib/raceRouteGenerator.js";
import { buildRaceResults } from "../lib/raceRunner.js";
import { evaluateRaceStructuralOracles, evaluateAbilityLivenessOracle, evaluateIncidentBoundsOracle } from "../lib/raceDryRunOracles.js";
import { abilityRankSensitivity, breakawayParticipationGapByAggression, SENSITIVITY_DELTA } from "../lib/raceSensitivity.js";
import { autopickTeamSelection } from "../lib/raceAutopick.js";
import { RACE_V3_TUNING } from "../lib/raceRoles.js";
import {
  observeRace, aggregateObservations, winRateStats, giniOverWins, helperPlacementDeltas,
  helperCounterfactualDeltas, median, quantile, observeIncidents, aggregateIncidentObservations,
} from "../lib/raceDominanceMetrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const SEED = parseInt(arg("seed", "2026"), 10);
const COUNT = parseInt(arg("count", "800"), 10);
const RACES = parseInt(arg("races", "300"), 10);
const FIELD = parseInt(arg("field", "140"), 10);
const GT_FIELD = parseInt(arg("gtField", "176"), 10);
const REFERENCE_YEAR = 2026;
const WRITE_HTML = !arg("no-html", false);
// #1420: --mix=<preset> varierer rytter-blandingen (default = uændret population).
// resolveMix kaster ved ukendt navn (fail fast med listen over gyldige presets).
const MIX = arg("mix", "default");
const mixOverride = resolveMix(MIX);
// #1198/#1144: strukturelle motor-oracles (sektion D) håndhæves ALTID (exit 1 ved
// brud). Kalibrerings-bånd (sektion B-scorecardet) håndhæves kun med dette flag,
// da baseline-targets afventer ejer-beslutning (se kalibrerings-loggen nedenfor).
const ENFORCE_TARGETS = !!arg("enforce-targets", false);
// B4 (#1306): --condition=random tilsætter seeded form/træthed per rytter.
// Neutral-mode (fraværende flag) er UÆNDRET — ingen ekstra rng-kald i den sti.
const CONDITION_MODE = arg("condition", null) === "random";
// #1307: --roles snake-drafter hvert felt i hold af 8 og tildeler race_role
// (captain/hunter/helper) → måler hold- og udbruds-mekanikken mod populationen.
// Prøve-trækningen (sampleField) er UÆNDRET — roller udledes deterministisk af
// prøven og konsumerer ingen rng, så felterne er identiske med neutral-mode.
const ROLES_MODE = !!arg("roles", false);
// #2352/#2353 (Race v3 S1+S2): --v3 aktiverer work-cost + TEAM_RACE_WEIGHT_V3 +
// dagsform + jour sans + FORM_RACE_WEIGHT_V3 i simulateStage (raceSimulator.js's
// v3-parameter — SAMME flag som app_config.race_engine_v3_scoring styrer i prod).
// Kræver --roles (work-cost er meningsløst uden roller i feltet).
// De NEUTRALE tvilling-kald (helperPlacementDeltas' baseline, kaptajn-delta-tvillingen)
// forbliver v3=false med vilje — de definerer "uden roller"-referencen, PRÆCIS som
// S0-baseline'en gjorde det uden work-cost.
const V3_MODE = !!arg("v3", false);
if (V3_MODE && !ROLES_MODE) {
  console.error("❌ --v3 kræver --roles (work-cost er meningsløst uden en rolle at koste).");
  process.exit(1);
}
// Plan 1 (#1122): --enforce-liveness gør evne-liveness-scorecardet (sektion E) til
// en hard gate (exit 1). Default off, så Phase A's race:gate forbliver grøn mens
// instrumentet bygges; tilføjes race:gate-scriptet i Phase C når motoren er grøn.
const ENFORCE_LIVENESS = !!arg("enforce-liveness", false);
// #1021 Fase 1 (post-launch): udbruds-realisme-båndene (BREAKAWAY_TARGETS) er
// KANDIDAT-bånd der endnu ikke er cross-seed-kalibreret mod den nuværende
// population (#1428 ability v3 + #1434 leadout-cut flyttede fordelingen). De er
// derfor afkoblet fra --enforce-targets og RAPPORT-ONLY som standard, så de ikke
// maskerer/blokerer de launch-kritiske gates. #1021-kalibrerings-sessionen kan
// gøre dem til en hard gate igen med --enforce-breakaway når båndene er re-fittet.
const ENFORCE_BREAKAWAY = !!arg("enforce-breakaway", false);
// #2224 (Race v3 S0): --population=<sti> kører mod en ÆGTE prod-population-
// snapshot (schema_version 1, se exportPopulationSnapshot.js) i stedet for den
// genererede fiktive population. Population-koden ligger UDELUKKENDE i nye
// grene (POPULATION_MODE-gates) — uden flaget er scriptet bit-identisk med før.
const POPULATION_PATH = arg("population", null);
const POPULATION_MODE = !!POPULATION_PATH;
// #2224: --enforce-dominance gør sektion F (dominans/varians-scorecard) til en
// hard gate (exit 1). Default off (rapport-only), ligesom de øvrige --enforce-*.
const ENFORCE_DOMINANCE = !!arg("enforce-dominance", false);
// Sub-3 (#2771) Task 7: --routes beriger hvert inline-bygget stageProfile med
// rutefelter (distance_km/climbs/sprints/sectors) via attachRoute — SAMME rene
// funktion som prod-generatoren (raceStageProfileGenerator.js) bruger i pass 2.
// Uden flaget er scriptet BIT-IDENTISK med før #2771 (determinisme-guard, som
// POPULATION_MODE/V3_MODE før det). --enforce-route-bands gør sektion G
// (rute-realisme-bånd) til en hard gate (exit 1); kræver --routes.
const ROUTES_MODE = !!arg("routes", false);
const ENFORCE_ROUTE_BANDS = !!arg("enforce-route-bands", false);
if (ENFORCE_ROUTE_BANDS && !ROUTES_MODE) {
  console.error("❌ --enforce-route-bands kræver --routes (der er intet rute-realisme-bånd at håndhæve uden ruter).");
  process.exit(1);
}
const conditionArg = arg("condition", null);
if (conditionArg === "snapshot" && !POPULATION_MODE) {
  console.error("❌ --condition=snapshot kræver --population=<fil>");
  process.exit(1);
}
// #2224: --condition=snapshot (population-only) bruger snapshottets EGNE
// form/fatigue-værdier (ingen rng-forbrug). --condition=random er uændret og
// virker i begge modes (se CONDITION_MODE nedenfor).
const CONDITION_SNAPSHOT = conditionArg === "snapshot";
// HAS_CONDITION samler begge condition-kilder til brug i population-entrants
// (fatigue-damping i autopick + form/fatigue på entrants) — CONDITION_MODE
// alene styrer fortsat den genererede stis (uændrede) adfærd.
const HAS_CONDITION = CONDITION_MODE || CONDITION_SNAPSHOT;
// #1420: per-run default HTML-sti, så reruns med forskellige parametre kan
// holdes åbne side om side (gitignored out/). --html=<sti> overstyrer. Defineres
// her, fordi navnet afhænger af CONDITION_MODE/ROLES_MODE/MIX ovenfor.
const HTML_PATH = arg("html", join(
  __dirname, "out",
  `cockpit-${MIX}-${SEED}${CONDITION_MODE ? "-cond" : ""}${ROLES_MODE ? "-roles" : ""}${V3_MODE ? "-v3" : ""}.html`,
));

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

// #2224: population-snapshot (schema_version 1, se exportPopulationSnapshot.js).
// Fail-fast ved ukendt/manglende schema_version — vi vil ALDRIG stiltiende
// fejltolke et format vi ikke kender.
const populationData = POPULATION_MODE ? JSON.parse(readFileSync(POPULATION_PATH, "utf8")) : null;
if (POPULATION_MODE && populationData?.schema_version !== 1) {
  console.error(`❌ Ukendt population-snapshot schema_version: ${populationData?.schema_version} (kun 1 understøttet). Fil: ${POPULATION_PATH}`);
  process.exit(1);
}

// ── Ejer-besluttede gate-bånd (2026-06-11, jf. genre-benchmark-research) ──────
// Interim-bånd nåelige med motor-tuning alene. FULDE mål (7/6) bevaret nedenfor;
// hæves via population-berigelse (cobbles/hilly) + evne-system v2 #1122 (itt).
//   Fulde mål: flat 90 · itt tt 85 · cobbles 90 (interim-bånd 80, jf. research) · hilly 50 · mountain 85.
const TARGETS = {
  flat:          { label: "sprinter ≥90%", types: ["sprinter"], pct: 0.90 },
  itt:           { label: "tt ≥60% (interim)", types: ["tt"], pct: 0.60 },
  itt_tempo:     { label: "tt+gc ≥95%", terrain: "itt", types: ["tt", "gc"], pct: 0.95 },
  cobbles:       { label: "brostensrytter ≥80%", types: ["brostensrytter"], pct: 0.80 },
  hilly:         { label: "puncheur ≥35% (interim)", types: ["puncheur"], pct: 0.35 },
  // #1021: mellembjerg er udbruds-bevidst (~17-25% af etaperne vindes realistisk fra
  // udbrud → bredere vinderfelt). high_mountain (summit, favoritterne afgør) forbliver strengt.
  mountain:      { label: "gc+climber+baroudeur ≥82% (udbruds-bevidst, #1021)", types: ["gc", "climber", "baroudeur"], pct: 0.82 },
  high_mountain: { label: "gc+climber+baroudeur ≥85%", types: ["gc", "climber", "baroudeur"], pct: 0.85 },
};

// ── KALIBRERINGS-LOG (2026-06-11) — tuning COMMITTET, gate grøn på 3 seeds ────
// NOISE_SD_SCALE 0.20→0.16 (raceSimulator.js). Strategi (genre-research): skærp
// nøgle-evne-vægte + sænk støj — mål blev IKKE sænket. Endelige vægte: se
// DEMAND_VECTORS i raceStageProfileGenerator.js (ÉT sted at tune).
// Født-som pr. seed 2026/7/42 (bånd i parentes), alle ✓:
//   flat 93/97/93 (≥90) · itt tt 66/65/62 (≥60) · itt tt+gc 100/100/100 (≥95)
//   cobbles 98/100/100 (≥80) · hilly 82/82/47 (≥35) · mountain 93/93/99 (≥85)
//   high_mountain 91/91/99 (≥85) · udbruds-andel 0% (rapport-only, uændret).
// FUND: itt er population-bundet — tt-born overgår gc-born ALENE på time_trial
//   (+1,5 PCM snit) og positioning (fl-boost); alle neutrale dimensioner favoriserer
//   gc (+1,5 base-adjust). Deraf pos-tung itt-vektor; plateau ~62% på seed 42
//   (binding seed, gc-tunge tt-ruller). Fuldt mål (tt 85%) kræver evne-system v2 #1122.
// FUND: udbrud (baroudeur) på bjerg kan IKKE købes med vægte — tactics/positioning-
//   skift gav 0 baroudeur-sejre men +12% puncheur (gruppen faldt 93→87%). Kræver
//   ægte udbruds-mekanik i den fulde motor (#1021).
//
// ── KALIBRERINGS-LOG (2026-06-12, #1307 Task 9) — udbrud + roller, 3 seeds grønne ──
// Endelige konstanter (raceSimulator.js): BREAKAWAY_PROFILES flat 0.30 / rolling
//   0.17 / mountain 0.33 · BREAKAWAY_TOP_EXCLUDED 0.05 · HUNTER_WEIGHT_MULTIPLIER 2
//   · TEAM_RACE_WEIGHT 0.024. BREAKAWAY_TARGETS-båndene blev IKKE justeret.
// FUND: design-værdierne (0.10/0.12/0.16, cut 0.4) gav 0,0 % escapee-sejre overalt —
//   pyramide-populationens terrain-gab ved cut'et (0.33-0.55) overstiger enhver
//   "lille" bonus. Cut 0.05 + spread-skala bonusser løste det; på flat eskaperer
//   sub-top-SPRINTERE (p5-p10), så sprinter ≥90 %-målet og udbruds-båndet er
//   forenelige. Hunter-vægt ×3→×2 + TEAM 0.010→0.024 gjorde kaptajn-deltaet
//   positivt (ved ×3 stjal hunters netto sejre fra kaptajnerne på alle seeds).
// Udbruds-bånd (escapee-vinder-andel) pr. seed — neutral/condition/roles, alle ✓:
//   seed 2026: flat 2.3/2.0/4.0 (bånd 1-10) · rolling 9.0/8.7/6.7 (2-12) · mountain 10.0/10.0/10.3 (5-25)
//   seed 7  (roles): flat 6.0 · rolling 8.7 · mountain 10.3
//   seed 42 (roles): flat 5.7 · rolling 6.3 · mountain 10.0
// Roles-metrikker (roles vs neutral-tvilling, 8×300 løb): kaptajn-delta
//   2026 +20 (2063/2043) · 7 +9 (2077/2068) · 42 +15 (2117/2102); hunter/helper-
//   escapee-ratio 3.4 / 2.8 / 3.0 (krav >1.5).
// Scorecard (født-som) holdt på alle 7 mål i alle 5 gate-kørsler; binding margin:
//   flat sprinter 90 % (seed 42 roles + 2026 roles) — flat-bonus >0.30 vælter den.
//
// ── BASELINE-LOG (2026-07-11, #2224 Race v3 S0) — dominans/varians mod ÆGTE population ──
// Første sektion F-måling mod prod-snapshot (scripts/baselines/population-snapshot-
// 2026-07-11.json: 368 hold / 5.650 ryttere / 15 puljer). 3 seeds (2026/7/42) ×
// neutral/condition=snapshot/roles — INGEN motor-ændring (S0). Fuld rapport:
// docs/audits/2026-07-11-race-v3-s0-baseline.md. Spænd over de 9 kørsler:
//   favoriteWinRate 53.0-54.9 % (bånd 25-40) · maxSeasonWinRate 87.2-89.5 % (≤45 —
//   matcher prod-evidensens 82-88 %, #2224 §2) · favoritePodiumRate 76.3-78.1 % (55-75)
//   · ittFavoriteWinRate 71.0-76.7 % (45-65) · share4PlusSameTeamTop10 4.5-5.9 % (≤5;
//   én-dags-linsen — prods 25 % er målt på GC-resultater m. tynde felter, se rapport)
//   · helperLossMedianGc 0.0 (mål 10-30; hjælper-arbejde er gratis i dag) · gini 0.945-0.952.
// FUND: udbruds-bånd eksploderer i population-mode (flat 42-48 % escapee-sejre vs bånd
//   1-7 %) — puljerne er langt mere evne-homogene end den genererede 800-population, så
//   udbruds-bonussen afgør langt flere løb. Kontekst for #1021-refit + S1/S2-kalibrering.
// S1-mål: helperLossMedianGc + share4Plus i bånd; S2-mål: favorit/max-win-rates i bånd.
//
// ── KALIBRERINGS-LOG (2026-07-12, #1176 Race v3 S4) — uheld/DNF-bånd, 3 seeds grønne ──
// evaluateIncidentBoundsOracle (raceDryRunOracles.js) + observeIncidents/
// aggregateIncidentObservations (raceDominanceMetrics.js) wired ind i harnesset
// (enkelt-dags-terrain-loop + GT's 21 etaper, feltstørrelse deriveret kumulativt
// pr. abandon — se buildRaceResults-kaldet). Mål: DNF-rate (abandon alene)
// 0,3-1,5 % af feltet/etape, hård cap ≤ INCIDENT_MAX_FIELD_SHARE (5 %), itt/ttt
// laveste uheldsrate, cobbles højeste, abandon-andel 25 %±10pp.
// RUN 1 (Worker A's oprindelige kandidater, uændrede — flat/rolling 0.008,
//   hilly 0.007, mountain/high_mountain 0.006, itt/ttt 0.002, cobbles 0.025,
//   classic 0.015): meanDnfRatePct 0,227 % (seed 2026) — UNDER gulvet 0,3 %.
//   AFVIST: basen var for lav til at ramme spec-båndet (abandon-andel 25,6 %
//   var i sig selv fin — det er uheldsraten der skal op, ikke ABANDON_SHARE).
// RUN 2 (+~18-20 % oven på RUN 3's kandidat: flat/rolling/_default 0.020,
//   hilly 0.017, mountain/high_mountain 0.015, cobbles 0.045, classic 0.027):
//   meanDnfRatePct 0,446-0,461 % på tværs af 3 seeds — i bånd, men KUN marginalt
//   bedre margin end RUN 3 (0,40→0,45 %) for en uforholdsmæssig stor basis-
//   forhøjelse (~14 % DNF-stigning for ~20 % base-stigning — sub-lineær pga.
//   hard cap + positioning-dæmpning). AFVIST: ikke nok gevinst til at
//   retfærdiggøre at gå uden for task-spec'ens foreslåede interval
//   (flat 0,014-0,02 · cobbles 0,03-0,04).
// VALGT (RUN 3, baget ind i RACE_V3_TUNING, env-override pr. profil tilføjet
//   — RACE_V3_INCIDENT_BASE_<PROFIL>, samme mønster som S1/S2):
//   flat/rolling/_default 0.017 · hilly 0.015 · mountain/high_mountain 0.013 ·
//   itt/ttt 0.003 (uændret ift. kandidat — "meget lav" var allerede opfyldt) ·
//   cobbles 0.040 · classic 0.024.
// Målt pr. seed (--v3 --roles --enforce-dominance, 8 terræner × 300 løb + GT):
//   seed 2026: DNF ⌀0,408 % · uheldsrate ⌀1,622 % · maks-etape 5,00 % (= cap,
//     IKKE over) · abandon-andel 25,2 %. Pr. profil (uheld/DNF): cobbles
//     3,388/0,893 % · classic 2,131/0,517 % · flat 1,546/0,381 % · rolling
//     1,541/0,368 % · mountain 1,535/0,430 % · hilly 1,335/0,340 % ·
//     high_mountain 1,267/0,266 % · itt 0,252/0,076 %.
//   seed 7: DNF ⌀0,393 % · uheldsrate ⌀1,620 % · maks-etape 5,00 % · abandon
//     24,3 %. cobbles højest (3,286 %), itt lavest (0,258 %) — orden holder.
//   seed 42: DNF ⌀0,408 % · uheldsrate ⌀1,619 % · maks-etape 5,00 % · abandon
//     25,2 %. cobbles højest (3,338 %), itt lavest (0,262 %) — orden holder.
// Alle 3 seeds: evaluateIncidentBoundsOracle → ✓ (0 brud). ITT/TTT laveste og
// cobbles højeste uheldsrate holder på ALLE 3 seeds uden undtagelse.
// REGRESSIONS-CHECK: dominans-scorecardets ØVRIGE bånd (favoriteWinRate,
//   maxSeasonWinRate, favoritePodiumRate, share4PlusSameTeamTop10,
//   avgDistinctTeamsTop10) forblev ✓ på alle 3 seeds, PRÆCIS som FØR denne
//   ændring (baseline målt før S4-harness-wiring). De 2-3 kendte røde bånd
//   (ittFavoriteWinRate — kun seed 2026 · helperLossMedianGc ·
//   helperLossTop15MedianGc — alle 3 seeds) er UÆNDREDE pre-eksisterende S1/S2-
//   fund (ikke S4's ansvar) — INGEN nye brud introduceret af uheld/DNF.
// FUND: DNF-raten er sub-lineær i base-sandsynligheden (hard cap ved 5 %
//   klipper cobbles-halen, positioning-dæmpning klipper resten) — en
//   fremtidig re-kalibrering der vil have MERE margin fra 0,3 %-gulvet skal
//   forvente at skulle skrue markant mere end proportionalt op.
//
// ── KALIBRERINGS-LOG (2026-07-22, #2771 Task 7) — sektion G rute-realisme-bånd ──
// --routes/--enforce-route-bands wired ind (attachRoute beriger terrain-loopets
// + GT's inline stageProfiles; A/B-tvilling isolerer rute-effekten pr. terræn,
// samme entrants+raceSeed). Tunables rørt: KUN LONG_DAY_ENDURANCE_WEIGHT (jf.
// task-mandat — SUMMIT/VALLEY/LAST_CLIMB/TECHNICAL_FINALE/SPRINTER_DENSITY var
// alle allerede grønne fra Task 1/3/4's kalibrering, ingen ændring nødvendig).
// RUN 1 (default 0.05, N=300/bånd): longDayEnduranceLift +0.3pp (seed 2026) —
//   umåleligt, langt under +3pp-kravet (longDayComponent-magnituden ved
//   distFactor=1.15 var ~0.0075 score-point, under halvdelen af mountains
//   noise-sd ~0.016 — druknede i støj).
// RUN 2 (0.50-0.80, N=300): +3.0pp/+3.3pp/+5.0pp (seed 2026/7/42-mønster) — men
//   AFVIST ved 0.80+: cobbles-TARGETS-båndet (≥80 %) knækkede på seed 2026
//   (distanceFactor/longDayComponent er GENERISK pr. profil-type med et
//   DISTANCE_BAND_MIDPOINTS-opslag, ikke mountain-specifikt — cobbles-ruters
//   egen distance-varians nød samme term). Desuden var seed 7 FASTLÅST på
//   nøjagtigt +3.0pp for 0.65-0.75 — N=300 giver kun 0,33pp opløsning pr.
//   vundet løb, for groft til pålideligt at skelne "+3,0" fra "+3,3" på
//   grænsen (kvantiseringsstøj, ikke et ægte plateau).
// RUN 3 (VALGT): ROUTE_LIFT_N 300→600 (halverer kvantiseringsstøjen) +
//   LONG_DAY_ENDURANCE_WEIGHT 0.05→0.65. Alle 3 seeds, komfortabel margin:
//   longDayEnduranceLift seed 2026 +4.0pp · seed 7 +4.3pp · seed 42 +4.0pp
//   (krav >+3pp). INGEN regression: cobbles/itt-TARGETS ✓ på alle 3 seeds
//   (itt var faktisk MARGINALT rødt allerede ved 0.05 under --routes — 0.65
//   løftede den tilbage over 60 %-gulvet som en BIVIRKNING, ikke målet).
// Øvrige sektion G-bånd (ingen tuning nødvendig, grønne fra Task 1/3/4):
//   summitValleyGapRatio 2.16-2.20 (krav ≥1.5) · ittDistanceGapRatio 2.75-4.13
//   (krav ≥2.0) · technicalFinaleLift +2.0pp til +8.3pp (krav >0pp, alle 3 seeds).
// LOOP-GUARD UDLØST (2 uændrede bånd på tværs af iterationer, ARKITEKT-EJET —
// se rapport for fuld mekanisme-analyse, IKKE rettet her):
//   1) prologP90Gap (krav ≤25s, målt 84-101s på alle 3 seeds): stageGapModels
//      itt-gren (Task 1, FROSSEN) skalerer KUN spread med distance
//      (ITT_REFERENCE_KM=30) — bunch forbliver 0 unconditionelt, så en 6 km
//      prolog stadig omsætter feltets FULDE evne-baserede score-deficit
//      (uændret af distance) gennem et spread-gulv på 150 (clampet). Ingen af
//      Task 7's tunables rører itt-grenen — kræver en Task-1-revision (fx et
//      prolog-specifikt bunch-vindue) for at lukke.
//   2) BREAKAWAY_TARGETS hilly/flat (--enforce-breakaway): PRÆ-EKSISTERENDE —
//      BARE seed 42 (ingen --routes, ingen Sub-3-kode i spil) fejlede hilly
//      allerede (17,3 % < 18,0 %-gulvet), fordi race:gate ALDRIG har kørt med
//      --enforce-breakaway (baseFlags mangler den). routeBreakawayFactor's
//      sqrt(distanceFactor)-led (Task 4, FROSSEN) tilføjer en let systematisk
//      NEDAD-bias under --routes (Jensens ulighed: E[√X] < √E[X]=1 for en
//      distance-faktor der varierer symmetrisk om 1) — nok til at skubbe
//      hilly/flat den sidste smule under/over de allerede stram-kalibrerede
//      grænser på alle 3 seeds. SPRINTER_DENSITY_RANGE (min tunable) er UDEN
//      effekt her (kræver --roles, som denne kørsel ikke bruger). Kræver enten
//      en BREAKAWAY_TARGETS-rekalibrering (#1021-ejet, låst her) eller en
//      justering af routeBreakawayFactor's distance-led (Task 4, ikke Task 7).
const TERRAINS = ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "cobbles", "classic"];

// ── Udbruds-gate-bånd (#1307, 2026-06-12) — escapee-VINDER-andel pr. terræn ───
// Andel af sejre vundet af en rytter med aktiv udbruds-bonus
// (components.breakaway > 0) — uafhængigt af født-som-type, modsat born-as-
// linsen i "udbruds-andel"-rapporten nedenfor. Måles i ALLE modes; RAPPORT-ONLY
// som standard (post-launch #1021), håndhæves kun med --enforce-breakaway.
//
// #1021 Fase 1: bånd pr. terræn, grundet i virkelige data (2026-06-16). Bonus er nu
// finale-gradient-bevidst (BREAKAWAY_BONUS), så hilly/high_mountain/cobbles er IKKE
// længere konstruktions-0. high_mountain er summit-domineret → lavt bånd (de få ikke-
// summit-dage løfter det lidt). mountain-båndet er bredt: det blander summit (~0) +
// descent (~40%). KANDIDAT-bånd: cross-seed-verifikation viste 2026-06-17 at de
// fejler 18/20 seeds mod den NYE population (#1428 ability v3 + #1434 leadout-cut
// flyttede fordelingen: flat ~+2pp, hilly under gulvet). Re-fit hører til #1021
// post-launch-kalibrering — IKKE en launch-blocker (win-rate-dominans uændret).
const BREAKAWAY_TARGETS = {
  flat:          { min: 0.01, max: 0.07 },
  rolling:       { min: 0.04, max: 0.15 },
  hilly:         { min: 0.18, max: 0.45 },
  mountain:      { min: 0.15, max: 0.50 },
  high_mountain: { min: 0.00, max: 0.15 },
  cobbles:       { min: 0.02, max: 0.15 },
};

// ── Hjælpere ──────────────────────────────────────────────────────────────────
const padE = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);
const pct1 = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const pctS = (a, b) => `${pct1(a, b)}%`;
const money = (n) => (n == null ? "—" : `${(Math.round(n / 1000) / 1000).toFixed(2).replace(/\.?0+$/, "")}M`);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
}
function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}
const top3 = (hist, total) => Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 3)
  .map(([t, n]) => `${t} ${pctS(n, total)}`).join(", ");
function keyAbilityOf(demand) {
  return Object.entries(demand).filter(([k]) => k !== "randomness").sort((a, b) => b[1] - a[1])[0][0];
}

// Sub-3 (#2771) Task 7: beriger en terrain-sektionens inline stageProfile med
// rutefelter — samme rene attachRoute() som prod-generatoren. Synthetisk
// race-identitet PR. LØB (raceIndex = løbets loop-index) — IKKE konstant pr.
// terræn — så de 300 løb pr. terræn trækker 300 FORSKELLIGE ruter (en
// konstant race-id ville give samme rute hver gang, jf. attachRoute's
// seed = f(race-identitet, stage_number)). isStageRace=true unconditionelt
// (harnessets terrain-sektioner er enkelt-dags, men rutens sprint/klatre-
// generering skal opføre sig som en etape i et etapeløb, jf. Task 7 spec).
// itt-sektionen tvinges til stage_number=2 (ikke 1): stage_number===1 + itt +
// isStageRace=true ville trække en PROLOG (5-8 km) i attachRoute — det ville
// forurene itt-bandets [15,40] km-forudsætning (ittDistanceGapRatio,
// prologP90Gap måles separat med hånd-byggede distancer, se sektion G).
function attachRouteToProfile(baseProfile, terrain, raceIndex) {
  const stage_number = terrain === "itt" ? 2 : 1;
  const syntheticRace = { id: `dryrun-${terrain}-${raceIndex}`, name: `Dryrun ${terrain}` };
  const route = attachRoute({ stage_number, profile_type: terrain, finale_type: baseProfile.finale_type }, syntheticRace, true);
  return { ...baseProfile, stage_number, ...route };
}

// #1307 --roles: snake-draft prøven ind i hold af 8 efter overall (spejler GT'ens
// snake-logik nedenfor), og tildel roller:
//   captain = bedste overall pr. hold
//   hunter  = på hvert ANDET hold (teamIdx % 2 === 0): højeste aggressionScore
//             blandt ikke-kaptajner (stabil rider_id-tiebreak)
//   helper  = alle øvrige
// Deterministisk: ingen rng — udledes alene af prøven.
const ROLES_TEAM_SIZE = 8;

/**
 * Fælles rolle-tildeler brugt af BÅDE terrain-sampleren (assignRoles) og
 * GT-blokken — ét sted at vedligeholde logikken.
 *
 * @param {Map<*, Member[]>}  teamsMap   - Map(teamKey → members[])
 * @param {(m: Member) => number}  getOverall  - henter overall fra et member
 * @param {(m: Member) => string}  getId       - henter den stabile id (tiebreak)
 * @param {(teamKey: *) => number} getTeamIdx  - konverterer teamKey til numerisk indeks
 * @param {(m: Member) => object}  getAbilities - henter abilities-objektet
 * @returns {Map<string, "captain"|"hunter"|"helper">}  roleById (keyed på getId(m))
 */
function assignRolesToTeams(teamsMap, { getOverall, getId, getTeamIdx, getAbilities }) {
  const roleById = new Map();
  for (const [teamKey, members] of teamsMap) {
    // captain = højeste overall (stabil id-tiebreak: lavere streng vinder)
    let captain = members[0];
    for (const m of members) {
      const mOvr = getOverall(m), cOvr = getOverall(captain);
      if (mOvr > cOvr || (mOvr === cOvr && String(getId(m)) < String(getId(captain)))) {
        captain = m;
      }
    }
    roleById.set(getId(captain), "captain");
    // hunter = kun på hvert andet hold (teamIdx % 2 === 0)
    if (getTeamIdx(teamKey) % 2 === 0) {
      let hunter = null;
      let hunterScore = -Infinity;
      for (const m of members) {
        if (getId(m) === getId(captain)) continue;
        const score = aggressionScore(getAbilities(m));
        if (score > hunterScore ||
            (score === hunterScore && hunter && String(getId(m)) < String(getId(hunter)))) {
          hunter = m;
          hunterScore = score;
        }
      }
      if (hunter) roleById.set(getId(hunter), "hunter");
    }
    // helper = alle øvrige
    for (const m of members) {
      if (!roleById.has(getId(m))) roleById.set(getId(m), "helper");
    }
  }
  return roleById;
}

function assignRoles(sample) {
  const byOverall = [...sample].sort((a, b) =>
    b.overall - a.overall || String(a.id).localeCompare(String(b.id))
  );
  const nTeams = Math.ceil(byOverall.length / ROLES_TEAM_SIZE);
  const teamById = new Map();
  const membersByTeam = new Map();
  for (let i = 0; i < byOverall.length; i++) {
    const round = Math.floor(i / nTeams);
    const pos = i % nTeams;
    const teamIdx = round % 2 === 0 ? pos : nTeams - 1 - pos;
    teamById.set(byOverall[i].id, teamIdx);
    if (!membersByTeam.has(teamIdx)) membersByTeam.set(teamIdx, []);
    membersByTeam.get(teamIdx).push(byOverall[i]);
  }
  const roleById = assignRolesToTeams(membersByTeam, {
    getOverall:   (r) => r.overall,
    getId:        (r) => r.id,
    getTeamIdx:   (teamIdx) => teamIdx,
    getAbilities: (r) => r.abilities,
  });
  return { roleById, teamById };
}

// ── 1. Generér + berig felt (hele værdi-kæden, in-memory) ────────────────────
console.log(`\n🚴  RACE-ENGINE DRY-RUN — seed=${SEED}${POPULATION_MODE ? ` population=${POPULATION_PATH}` : ` count=${COUNT} mix=${MIX}`} noise=${NOISE_SD_SCALE}${CONDITION_MODE ? " condition=random" : ""}${CONDITION_SNAPSHOT ? " condition=snapshot" : ""}${ROLES_MODE ? " roles" : ""}${V3_MODE ? " v3(work-cost+team-weight)" : ""} (in-memory, rører ikke prod)\n`);

// #2224: field/byId bygges enten fra en ÆGTE prod-population-snapshot
// (POPULATION_MODE) eller fra den genererede fiktive population (uændret sti).
// Den genererede gren (else) er BYTE-IDENTISK med før #2224 — determinisme-guard.
let field, byId, ridersByTeam, populationPools;
if (POPULATION_MODE) {
  field = populationData.riders.map((r) => {
    const abilities = r.abilities || {};
    const derived = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
    return {
      id: r.id, team_id: r.team_id,
      name: r.name, nat: "",
      // Prod-ryttere har ingen "født-som"-arketype → bornAs ER den afledte type.
      // Sektion B's "født-som"-kolonne er derfor IDENTISK med "afledt" her — se
      // konsol-note (sektion B-header) og HTML-note.
      bornAs: derived,
      derived,
      specialty: riderSpecialty(abilities),
      overall: riderOverall(abilities),
      baseValue: predictBaseValue({ primary_type: derived }, abilities, model),
      is_u25: !!r.is_u25,
      abilities,
    };
  });
  byId = new Map(field.map((r) => [r.id, r]));

  // --condition=snapshot: brug snapshottets EGNE form/fatigue (ingen rng-forbrug).
  if (CONDITION_SNAPSHOT) {
    const snapshotRidersById = new Map(populationData.riders.map((r) => [r.id, r]));
    for (const r of field) {
      const src = snapshotRidersById.get(r.id);
      if (src?.form != null) r.form = src.form;
      if (src?.fatigue != null) r.fatigue = src.fatigue;
    }
  }

  ridersByTeam = new Map();
  for (const r of field) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push(r);
  }
  // Puljer = hold grupperet efter league_division_id; kun puljer med ≥6 hold
  // bruges (spec #2224). pool-tier = tier'en for holdene i puljen (league_divisions
  // er tier-rene i praksis, så teams[0].tier er repræsentativ for hele puljen).
  const byDivision = new Map();
  for (const t of populationData.teams) {
    if (t.league_division_id == null) continue;
    if (!byDivision.has(t.league_division_id)) byDivision.set(t.league_division_id, []);
    byDivision.get(t.league_division_id).push(t);
  }
  populationPools = [...byDivision.values()]
    .filter((teams) => teams.length >= 6)
    .map((teams) => ({ teams, tier: teams[0]?.tier ?? null }));
  if (populationPools.length === 0) {
    console.error(`❌ Population-snapshot har ingen division/pulje med ≥6 hold (${POPULATION_PATH}) — kan ikke bygge felter.`);
    process.exit(1);
  }
} else {
  const { riders: raw } = generateFictionalRiders({ count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR, ...mixOverride });
  field = raw.map((r, i) => {
    const id = `r${i}`;
    // Plan 2 (#1122): evner afledes nu af den arketype-skæve fysiologi (faldt til {}
    // = PCM-fallback hvis profilen mangler). Se abilityDerivation.js (FORMULA_VERSION=3).
    const abilities = deriveAbilities(r._meta?.physiology ?? {}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
    const derived = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
    return {
      id, team_id: null,
      name: `${r.firstname} ${r.lastname}`,
      nat: r.nationality_code,
      bornAs: r._meta?.archetype ?? "?",
      derived,
      specialty: riderSpecialty(abilities),
      overall: riderOverall(abilities),
      baseValue: predictBaseValue({ primary_type: derived }, abilities, model),
      is_u25: !!r.is_u25,
      abilities,
    };
  });
  byId = new Map(field.map((r) => [r.id, r]));
}

// B4: condition-mode — tildel seeded form/træthed per rytter.
// Bruger en DEDIKERET RNG afledt af et XOR-scrambled seed, så den aldrig
// konsumeres i neutral-mode og aldrig forskydes andre træk.
if (CONDITION_MODE) {
  const condRng = makeRng((stableSeed(`condition:${SEED}`) ^ 0xC04D1710) >>> 0);
  for (const r of field) {
    const u1 = condRng();
    const u2 = condRng();
    r.form    = Math.round(30 + u1 * 60); // [30, 90]
    r.fatigue = Math.round(u2 * 70);      // [0, 70]
  }
}

const fieldMedianAbility = (key) => {
  const s = field.map((r) => r.abilities[key]).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ── A. Felt-resumé ────────────────────────────────────────────────────────────
const typeCount = {};
for (const r of field) typeCount[r.derived] = (typeCount[r.derived] || 0) + 1;
const ovSorted = field.map((r) => r.overall).sort((a, b) => a - b);
const bvSorted = field.map((r) => r.baseValue).filter((v) => v != null).sort((a, b) => a - b);
const fieldSummary = {
  n: field.length,
  ov: { p10: percentile(ovSorted, 0.10), median: percentile(ovSorted, 0.50), p90: percentile(ovSorted, 0.90), max: ovSorted[ovSorted.length - 1] },
  bv: { median: percentile(bvSorted, 0.50), p90: percentile(bvSorted, 0.90), max: bvSorted[bvSorted.length - 1] },
  types: Object.entries(typeCount).sort((a, b) => b[1] - a[1]),
};

console.log("─".repeat(80));
console.log("A. FELT-RESUMÉ\n");
console.log(`  Ryttere: ${fieldSummary.n}   ·   Overall: p10 ${fieldSummary.ov.p10} · median ${fieldSummary.ov.median} · p90 ${fieldSummary.ov.p90} · max ${fieldSummary.ov.max}`);
console.log(`  base_value: median ${money(fieldSummary.bv.median)} · p90 ${money(fieldSummary.bv.p90)} · max ${money(fieldSummary.bv.max)}`);
console.log(`  Afledt type-mix: ${fieldSummary.types.map(([t, n]) => `${t} ${pctS(n, field.length)}`).join(" · ")}`);
if (POPULATION_MODE) {
  console.log(`  ⚠ population-mode: "født-som" ovenfor/nedenfor ER den afledte type (prod-ryttere har ingen arketype-label).`);
}

// ── Sektion F (#2224) — akkumulatorer, delt af BEGGE stier ────────────────────
// Rør INTET rng-forbrug: observeRace/bogføring er ren post-hoc læsning af
// simulateStage-outputtet, tilføjet UDEN at ændre rækkefølgen af eksisterende
// kald i den genererede sti (determinisme-guard).
const allDominanceObservations = [];
const seasonWinsByRider = new Map();
const seasonStartsByRider = new Map();
const helperDeltasAll = []; // kun ROLES_MODE, GC-relevante profiler
// #2352 (S1): counterfactual hjælper-tab i TOP-terrain-linsen — parret
// (samme seed) roles-vs-counterfactual-delta for hjælpere i feltets terrain-
// top-15 (se helperCounterfactualDeltas i raceDominanceMetrics.js for linse-
// rationale: fuld-felt-medianen er ~0 pr. konstruktion i hjælper-tunge felter).
// Counterfactual = den eksisterende neutrale tvilling (rolle-strippet) — bit-
// identisk med all-free_role under v3, da ingen af dem betaler work-cost eller
// bygger helperSupport, og work_cost/team konsumerer ingen rng.
const helperTop15DeltasAll = []; // kun ROLES_MODE, GC-relevante profiler
const GC_RELEVANT_PROFILES = new Set(["rolling", "hilly", "mountain", "high_mountain", "classic"]);
// #2353 (S2): realiseret jour-sans-rate (andel rytter-etaper med jour_sans < 0)
// — spec §12-bånd 2-5%. Ren post-hoc læsning af components; kun ≠0 når --v3.
let jourSansHits = 0;
let riderStageCount = 0;
// S4 (#1176): observeIncidents()-observationer, én pr. simuleret etape-instans
// (enkelt-dags-løb + GT's 21 etaper) — KUN fyldt når V3_MODE (rollIncidents er
// dormant ellers, simulateStage returnerer incidents=[] uconditionelt).
const incidentObservations = [];
function recordDominanceObservation(ranked, teamByRider, terrain) {
  allDominanceObservations.push(observeRace({ ranked, teamByRider, terrain }));
  for (const rr of ranked) {
    seasonStartsByRider.set(rr.rider_id, (seasonStartsByRider.get(rr.rider_id) || 0) + 1);
    riderStageCount++;
    if ((rr.components?.jour_sans || 0) < 0) jourSansHits++;
  }
  seasonWinsByRider.set(ranked[0].rider_id, (seasonWinsByRider.get(ranked[0].rider_id) || 0) + 1);
}

// ── B. Terræn-fordeling + indsamling til scorecard/HTML ──────────────────────
// #2224: POPULATION_MODE kører en HELT NY sti (pulje-baseret felt-sampling via
// prod-autopick). Den genererede gren (else) er BYTE-IDENTISK med før #2224 —
// eneste tilføjelse er recordDominanceObservation()/helperDeltasAll-bogføring,
// som er ren post-hoc læsning og konsumerer INGEN rng.
const terrainResults = [];
if (POPULATION_MODE) {
  const sizeRuleForPoolTier = (tier) => (tier === 1 ? { min: 7, max: 7 } : { min: 6, max: 6 });
  for (const terrain of TERRAINS) {
    const demand = DEMAND_VECTORS[terrain];
    const keyAb = keyAbilityOf(demand);
    // NY rng-strøm (population-only) — påvirker ikke den genererede sti.
    const poolRng = makeRng(stableSeed(`dryrun:${SEED}:${terrain}`));
    const finaleRng = makeRng(stableSeed(`dryrun:${SEED}:${terrain}:finale`));
    const bornHist = {}, derivedHist = {};
    const winners = new Set();
    let strongestWon = 0, overallRankSum = 0, winnerKeySum = 0;
    let breakawayWinCount = 0;
    const finaleSplit = {};
    let racesRun = 0;
    // Sub-3 (#2771) A/B: favorit-vinder-rate MED ruter vs BARE (samme entrants +
    // samme raceSeed — kun stageProfilens rutefelter varierer). Kun --routes.
    let abFavoriteWithRoutes = 0, abFavoriteBare = 0, abRaces = 0;

    for (let i = 0; i < RACES; i++) {
      const pool = populationPools[Math.floor(poolRng() * populationPools.length)];
      const finaleType = finaleFor(finaleRng, terrain);
      const sizeRule = sizeRuleForPoolTier(pool.tier);
      const entrants = [];
      for (const team of pool.teams) {
        const roster = ridersByTeam.get(team.id) || [];
        const picks = autopickTeamSelection({
          riders: roster.map((r) => ({ rider_id: r.id, abilities: r.abilities, fatigue: HAS_CONDITION ? r.fatigue : undefined })),
          stages: [{ profile_type: terrain, demand_vector: demand }],
          sizeRule,
        });
        for (const p of picks) {
          const r = byId.get(p.rider_id);
          entrants.push({
            rider_id: p.rider_id,
            team_id: team.id, // #2224: ALTID det rigtige hold i population-mode.
            abilities: r.abilities,
            ...(ROLES_MODE ? { race_role: p.race_role } : {}),
            ...(HAS_CONDITION && r.form    != null ? { form:    r.form }    : {}),
            ...(HAS_CONDITION && r.fatigue != null ? { fatigue: r.fatigue } : {}),
          });
        }
      }
      if (entrants.length < 2) continue; // degenereret pulje/felt — spring løbet over
      const raceSeed = stableSeed(`${terrain}:${i}`);
      const bareStageProfile = { profile_type: terrain, finale_type: finaleType, demand_vector: demand };
      // Sub-3 (#2771): stageProfile beriges med rutefelter KUN under --routes —
      // uden flaget er bareStageProfile === stageProfile (identitet, bit-for-bit
      // som før #2771).
      const stageProfile = ROUTES_MODE ? attachRouteToProfile(bareStageProfile, terrain, i) : bareStageProfile;
      const { ranked, incidents: stageIncidents } = simulateStage({ entrants, stageProfile, seed: raceSeed, v3: V3_MODE });
      racesRun++;
      const w = byId.get(ranked[0].rider_id);
      bornHist[w.bornAs] = (bornHist[w.bornAs] || 0) + 1;
      derivedHist[w.derived] = (derivedHist[w.derived] || 0) + 1;
      winners.add(w.id);
      winnerKeySum += w.abilities[keyAb];
      const byOverall = entrants.map((e) => byId.get(e.rider_id)).sort((a, b) => b.overall - a.overall);
      const rank = byOverall.findIndex((r) => r.id === w.id) + 1;
      overallRankSum += rank;
      if (rank === 1) strongestWon++;
      if ((ranked[0].components.breakaway || 0) > 0) breakawayWinCount++;
      const fkey = finaleType || "none";
      finaleSplit[fkey] = finaleSplit[fkey] || { races: 0, bw: 0 };
      finaleSplit[fkey].races++;
      if ((ranked[0].components.breakaway || 0) > 0) finaleSplit[fkey].bw++;

      const teamByRider = new Map(entrants.map((e) => [e.rider_id, e.team_id]));
      recordDominanceObservation(ranked, teamByRider, terrain);
      // S4 (#1176): entrants.length = feltstørrelse VED DENNE (endags-)løbs start —
      // enkelt-dags-races i denne loop starter altid friskt (ingen cross-race-
      // abandon-arv), så entrants.length er altid den korrekte nævner.
      if (V3_MODE) incidentObservations.push(observeIncidents({ incidents: stageIncidents, fieldSize: entrants.length, profileType: terrain }));

      // Sub-3 (#2771) A/B: ÉN ekstra sim med den BARE (rute-fri) profil, SAMME
      // entrants + raceSeed — isolerer rute-effekten på favorit-vinder-raten.
      if (ROUTES_MODE) {
        const bare = simulateStage({ entrants, stageProfile: bareStageProfile, seed: raceSeed, v3: V3_MODE });
        abRaces++;
        if (rank === 1) abFavoriteWithRoutes++; // 'rank' er allerede vinderens overall-rang MED ruter
        if (byOverall[0].id === bare.ranked[0].rider_id) abFavoriteBare++;
      }

      if (ROLES_MODE) {
        const neutralEntrants = entrants.map(({ race_role: _race_role, ...rest }) => rest);
        // #2353: tvillingen kører med SAMME v3-tilstand som hovedkørslen — S2's
        // dagsform/jour-sans er per-rytter-hashet på (seed, rider_id) og derfor
        // IDENTISK i begge kørsler; de parrede deltaer isolerer stadig KUN
        // rolle-effekterne (work-cost + boost). V3_MODE=false → uændret S0-sti.
        // Rute-effekten holdes ligeledes konstant (SAMME stageProfile som hovedkørslen).
        const neutral = simulateStage({ entrants: neutralEntrants, stageProfile, seed: raceSeed, v3: V3_MODE });
        if (GC_RELEVANT_PROFILES.has(terrain)) {
          const roleByRider = new Map(entrants.map((e) => [e.rider_id, e.race_role]));
          helperDeltasAll.push(...helperPlacementDeltas({ rankedRoles: ranked, rankedNeutral: neutral.ranked, roleByRider }));
          // #2352: top-terrain-linsen (counterfactual = samme neutrale tvilling).
          helperTop15DeltasAll.push(...helperCounterfactualDeltas({ rankedRoles: ranked, rankedCounterfactual: neutral.ranked, roleByRider }));
        }
      }
    }
    terrainResults.push({
      terrain, keyAb, races: racesRun,
      winnerKeyAvg: racesRun ? Math.round(winnerKeySum / racesRun) : 0, fieldMedianKey: fieldMedianAbility(keyAb),
      bornHist, derivedHist, distinct: winners.size,
      avgStrengthRank: racesRun ? overallRankSum / racesRun : 0, strongestWonPct: pct1(strongestWon, racesRun || 1),
      breakawayWinShare: racesRun ? breakawayWinCount / racesRun : 0,
      finaleSplit,
      ...(ROUTES_MODE ? { abFavoriteWithRoutes, abFavoriteBare, abRaces } : {}),
    });
  }
} else {
  for (const terrain of TERRAINS) {
    const demand = DEMAND_VECTORS[terrain];
    const keyAb = keyAbilityOf(demand);
    const rng = makeRng(stableSeed(`dryrun:${SEED}:${terrain}`));
    // #1021: dedikeret finale-rng → field-sampling-sekvensen (rng) er uændret.
    const finaleRng = makeRng(stableSeed(`dryrun:${SEED}:${terrain}:finale`));
    const bornHist = {}, derivedHist = {};
    const winners = new Set();
    let strongestWon = 0, overallRankSum = 0, winnerKeySum = 0;
    // #1307: udbruds-vinder-tæller (ALLE modes) + roles-mode-metrikker.
    let breakawayWinCount = 0;
    const finaleSplit = {}; // #1021: escapee-share pr. finale (bimodale terræner)
    let captainWinsRoles = 0, captainWinsNeutral = 0;
    let hunterEscapes = 0, helperEscapes = 0, hunterExposures = 0, helperExposures = 0;
    // Sub-3 (#2771) A/B: favorit-vinder-rate MED ruter vs BARE (samme entrants +
    // samme raceSeed — kun stageProfilens rutefelter varierer). Kun --routes.
    let abFavoriteWithRoutes = 0, abFavoriteBare = 0, abRaces = 0;

    for (let i = 0; i < RACES; i++) {
      const sample = sampleField(rng, field, FIELD);
      const raceSeed = stableSeed(`${terrain}:${i}`);
      const finaleType = finaleFor(finaleRng, terrain); // #1021: driver udbruds-bonussen
      const roles = ROLES_MODE ? assignRoles(sample) : null;
      const entrants = sample.map((r) => ({
        rider_id: r.id,
        team_id: ROLES_MODE ? `t${roles.teamById.get(r.id)}` : r.id,
        abilities: r.abilities,
        ...(ROLES_MODE ? { race_role: roles.roleById.get(r.id) } : {}),
        ...(CONDITION_MODE && r.form    != null ? { form:    r.form }    : {}),
        ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
      }));
      const bareStageProfile = { profile_type: terrain, finale_type: finaleType, demand_vector: demand };
      // Sub-3 (#2771): stageProfile beriges med rutefelter KUN under --routes —
      // uden flaget er bareStageProfile === stageProfile (identitet, bit-for-bit
      // som før #2771).
      const stageProfile = ROUTES_MODE ? attachRouteToProfile(bareStageProfile, terrain, i) : bareStageProfile;
      const { ranked, incidents: stageIncidents } = simulateStage({ entrants, stageProfile, seed: raceSeed, v3: V3_MODE });

      // #2224 Section F: ren post-hoc bogføring — INGEN rng-forbrug, ingen ændring
      // af rækkefølgen af eksisterende kald ovenfor/nedenfor.
      const teamByRiderGen = new Map(entrants.map((e) => [e.rider_id, e.team_id]));
      recordDominanceObservation(ranked, teamByRiderGen, terrain);
      // S4 (#1176): se population-grenens tvilling-kommentar — entrants.length er
      // altid feltstørrelsen ved dette (endags-)løbs start.
      if (V3_MODE) incidentObservations.push(observeIncidents({ incidents: stageIncidents, fieldSize: entrants.length, profileType: terrain }));

      const w = byId.get(ranked[0].rider_id);
      bornHist[w.bornAs] = (bornHist[w.bornAs] || 0) + 1;
      derivedHist[w.derived] = (derivedHist[w.derived] || 0) + 1;
      winners.add(w.id);
      winnerKeySum += w.abilities[keyAb];
      const byOverall = [...sample].sort((a, b) => b.overall - a.overall);
      const rank = byOverall.findIndex((r) => r.id === w.id) + 1;
      overallRankSum += rank;
      if (rank === 1) strongestWon++;
      if ((ranked[0].components.breakaway || 0) > 0) breakawayWinCount++;
      const fkey = finaleType || "none";
      finaleSplit[fkey] = finaleSplit[fkey] || { races: 0, bw: 0 };
      finaleSplit[fkey].races++;
      if ((ranked[0].components.breakaway || 0) > 0) finaleSplit[fkey].bw++;

      // Sub-3 (#2771) A/B: ÉN ekstra sim med den BARE (rute-fri) profil, SAMME
      // entrants + raceSeed — isolerer rute-effekten på favorit-vinder-raten.
      if (ROUTES_MODE) {
        const bare = simulateStage({ entrants, stageProfile: bareStageProfile, seed: raceSeed, v3: V3_MODE });
        abRaces++;
        if (rank === 1) abFavoriteWithRoutes++; // 'rank' er allerede vinderens overall-rang MED ruter
        if (byOverall[0].id === bare.ranked[0].rider_id) abFavoriteBare++;
      }

      if (ROLES_MODE) {
        if (roles.roleById.get(ranked[0].rider_id) === "captain") captainWinsRoles++;
        // Neutral tvilling: SAMME prøve + seed, men uden roller/hold (som neutral-
        // mode) → måler om rolle-mekanikken netto gavner kaptajnerne.
        const neutralEntrants = sample.map((r) => ({
          rider_id: r.id, team_id: r.id, abilities: r.abilities,
          ...(CONDITION_MODE && r.form    != null ? { form:    r.form }    : {}),
          ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
        }));
        // #2353: v3: V3_MODE — se population-grenens tvilling-kommentar (S2-varians
        // er per-rytter-hashet og identisk i begge kørsler; V3_MODE=false = uændret).
        // Rute-effekten holdes ligeledes konstant (SAMME stageProfile som hovedkørslen).
        const neutral = simulateStage({ entrants: neutralEntrants, stageProfile, seed: raceSeed, v3: V3_MODE });
        if (roles.roleById.get(neutral.ranked[0].rider_id) === "captain") captainWinsNeutral++;
        // #2224 Section F: hjælper-placeringstab (kun GC-relevante profiler).
        if (GC_RELEVANT_PROFILES.has(terrain)) {
          helperDeltasAll.push(...helperPlacementDeltas({ rankedRoles: ranked, rankedNeutral: neutral.ranked, roleByRider: roles.roleById }));
          // #2352: top-terrain-linsen (counterfactual = samme neutrale tvilling).
          helperTop15DeltasAll.push(...helperCounterfactualDeltas({ rankedRoles: ranked, rankedCounterfactual: neutral.ranked, roleByRider: roles.roleById }));
        }
        // Escapee-deltagelse pr. rolle (kun udbruds-egnede terræner producerer escapees).
        if (BREAKAWAY_BONUS[terrain]) {
          for (const r of ranked) {
            const role = roles.roleById.get(r.rider_id);
            if (role === "hunter") {
              hunterExposures++;
              if (r.components.breakaway > 0) hunterEscapes++;
            } else if (role === "helper") {
              helperExposures++;
              if (r.components.breakaway > 0) helperEscapes++;
            }
          }
        }
      }
    }
    terrainResults.push({
      terrain, keyAb, races: RACES,
      winnerKeyAvg: Math.round(winnerKeySum / RACES), fieldMedianKey: fieldMedianAbility(keyAb),
      bornHist, derivedHist, distinct: winners.size,
      avgStrengthRank: overallRankSum / RACES, strongestWonPct: pct1(strongestWon, RACES),
      breakawayWinShare: breakawayWinCount / RACES,
      finaleSplit,
      ...(ROLES_MODE ? { captainWinsRoles, captainWinsNeutral, hunterEscapes, helperEscapes, hunterExposures, helperExposures } : {}),
      ...(ROUTES_MODE ? { abFavoriteWithRoutes, abFavoriteBare, abRaces } : {}),
    });
  }
}

// ── Scorecard vs ejer-mål (født-som = ægte type) ─────────────────────────────
// t.terrain overstyr: itt_tempo er et ekstra bånd på samme terræn som itt.
const scorecard = Object.entries(TARGETS).map(([key, t]) => {
  const terrain = t.terrain ?? key;
  const tr = terrainResults.find((x) => x.terrain === terrain);
  const bornHit = t.types.reduce((s, ty) => s + (tr.bornHist[ty] || 0), 0);
  const derivedHit = t.types.reduce((s, ty) => s + (tr.derivedHist[ty] || 0), 0);
  const bornPct = bornHit / tr.races, derivedPct = derivedHit / tr.races;
  return { terrain: key, label: t.label, targetPct: t.pct, bornPct, derivedPct, pass: bornPct >= t.pct };
});

console.log(`\n${"─".repeat(80)}`);
console.log("B. MÅL-SCORECARD (født-som = ægte rytter-type; afledt = spillets label)\n");
if (POPULATION_MODE) {
  console.log(`   ⚠ population-mode: "født-som" = "afledt" (se felt-resumé) — båndene nedenfor er kalibreret mod den GENEREREDE population og er ALTID rapport-only her, uanset --enforce-*.`);
}
console.log(`   ${padE("terræn", 14)}${padE("mål", 26)}${padE("født-som", 11)}${padE("afledt", 10)}status`);
console.log(`   ${"-".repeat(74)}`);
for (const s of scorecard) {
  const delta = Math.round((s.bornPct - s.targetPct) * 100);
  console.log(`   ${padE(s.terrain, 14)}${padE(s.label, 26)}${padE(`${Math.round(s.bornPct * 100)}%`, 11)}${padE(`${Math.round(s.derivedPct * 100)}%`, 10)}${s.pass ? "✓" : `✗ (${delta >= 0 ? "+" : ""}${delta})`}`);
}
console.log(`\n   Motor belønner rigtig evne? (vinder ⌀nøgle-evne vs felt-median):`);
for (const tr of terrainResults) {
  console.log(`   ${padE(tr.terrain, 14)} ${padE(tr.keyAb, 12)} vinder ⌀${padS(tr.winnerKeyAvg, 2)} vs median ${padS(tr.fieldMedianKey, 2)}   ⌀rang ${tr.avgStrengthRank.toFixed(1)}   distinkt ${tr.distinct}/${tr.races}`);
}

// ── Udbruds-andel (rapport-only, ingen exit-kode) ────────────────────────────
// Baroudeur/fighter = udbrudstyperne; irl vinder de ~40%+ af bjerg-etaper.
// 0% er et rødt flag: motoren er for deterministisk (GC-ryttere dominerer blindt).
// NB: "fighter" er IKKE en nuværende generator-arketype (kun "baroudeur" findes i
// fictionalRiderGenerator.js) — termen beholdes defensivt fra ejerens 7/6-vokabular.
// NB (#1307): dette er en ANDEN linse end udbruds-båndene nedenfor — her måles
// hvor ofte en baroudeur-FØDT rytter vinder bjergsejre (type-linse); båndene
// måler escapee-baserede sejre (components.breakaway > 0) uanset type.
const mtTerrains = terrainResults.filter((x) => x.terrain === "mountain" || x.terrain === "high_mountain");
const breakawayWins = mtTerrains.reduce((s, tr) => s + (tr.bornHist["baroudeur"] || 0) + (tr.bornHist["fighter"] || 0), 0);
const mtTotalWins = mtTerrains.reduce((s, tr) => s + tr.races, 0);
const breakawayShare = pct1(breakawayWins, mtTotalWins);
console.log(`\n   udbruds-andel (baroudeur/fighter) af bjergsejre: ${breakawayShare}% (irl ~40%; 0% = rød flag, rapport-only)`);

// ── Udbruds-bånd (#1307) — escapee-vinder-andel vs BREAKAWAY_TARGETS ─────────
// Evalueres i ALLE modes; RAPPORT-ONLY (post-launch #1021), håndhæves (exit 1)
// kun med --enforce-breakaway. Se exit-blokken + BREAKAWAY_TARGETS-kommentaren.
const breakawayBandFailures = [];
console.log(`\n   UDBRUDS-BÅND (escapee-vinder-andel; RAPPORT-ONLY — post-launch #1021, håndhæv med --enforce-breakaway):`);
for (const [terrain, band] of Object.entries(BREAKAWAY_TARGETS)) {
  const tr = terrainResults.find((x) => x.terrain === terrain);
  const share = tr.breakawayWinShare;
  const ok = share >= band.min && share <= band.max;
  if (!ok) breakawayBandFailures.push(`udbrud:${terrain} ${(share * 100).toFixed(1)}% udenfor [${(band.min * 100).toFixed(1)}%, ${(band.max * 100).toFixed(1)}%]`);
  console.log(`   ${padE(terrain, 14)} ${padS((share * 100).toFixed(1), 5)}%   bånd [${padS((band.min * 100).toFixed(1), 4)}%, ${padS((band.max * 100).toFixed(1), 4)}%]   ${ok ? "✓" : "✗"}`);
}

// ── Roles-mode-metrikker (#1307) — kaptajn-delta + hunter-ratio ──────────────
// captainWinsRoles ≥ captainWinsNeutral: rolle-mekanikken (team-boost + udbrud)
// må ikke NETTO koste kaptajnerne sejre på tværs af terræner.
// hunterEscapeRate > 1.5 × helperEscapeRate: hunter-rollen skal mærkes (pr.
// rytter-løb, aggregeret over de tre udbruds-egnede terræner).
const rolesFailures = [];
if (ROLES_MODE && POPULATION_MODE) {
  // #2224: population-mode bruger prod-rollerne (captain/sprint_captain/helper —
  // ingen "hunter"), så den generede stis hunter-ratio-metrik giver ikke mening
  // her. Rolle-kvalitets-signalet for population-mode er i stedet Section F's
  // helperLossMedianGc (median hjælper-placeringstab). rolesFailures forbliver
  // tom → kan aldrig udløse --enforce-targets-exit i population-mode.
  console.log(`\n   ROLES-METRIKKER: n/a i population-mode (prod-roller har ingen "hunter") — se Section F helperLossMedianGc.`);
} else if (ROLES_MODE) {
  const capRoles = terrainResults.reduce((s, tr) => s + (tr.captainWinsRoles || 0), 0);
  const capNeutral = terrainResults.reduce((s, tr) => s + (tr.captainWinsNeutral || 0), 0);
  const hunterEsc = terrainResults.reduce((s, tr) => s + (tr.hunterEscapes || 0), 0);
  const hunterN = terrainResults.reduce((s, tr) => s + (tr.hunterExposures || 0), 0);
  const helperEsc = terrainResults.reduce((s, tr) => s + (tr.helperEscapes || 0), 0);
  const helperN = terrainResults.reduce((s, tr) => s + (tr.helperExposures || 0), 0);
  const hunterRate = hunterN ? hunterEsc / hunterN : 0;
  const helperRate = helperN ? helperEsc / helperN : 0;
  const capOk = capRoles >= capNeutral;
  const huntOk = hunterRate > 1.5 * helperRate;
  if (!capOk) rolesFailures.push(`kaptajn-delta: roles ${capRoles} < neutral ${capNeutral} sejre`);
  if (!huntOk) rolesFailures.push(`hunter-ratio: ${(hunterRate * 100).toFixed(2)}% ≤ 1.5 × helper ${(helperRate * 100).toFixed(2)}%`);
  console.log(`\n   ROLES-METRIKKER (håndhæves med --enforce-targets):`);
  console.log(`   kaptajn-sejre  roles ${capRoles} vs neutral ${capNeutral} (over ${TERRAINS.length}×${RACES} løb)   ${capOk ? "✓" : "✗"}`);
  console.log(`   escapee-rate   hunter ${(hunterRate * 100).toFixed(2)}% (${hunterEsc}/${hunterN}) vs helper ${(helperRate * 100).toFixed(2)}% (${helperEsc}/${helperN}) · ratio ${helperRate ? (hunterRate / helperRate).toFixed(1) : "∞"} (kræver >1.5)   ${huntOk ? "✓" : "✗"}`);
}

// ── C. Grand Tour (fuld 21-etapers, til eyeball + HTML) ──────────────────────
const GT_TEMPLATE = [
  "flat", "flat", "hilly", "rolling", "itt",
  "flat", "hilly", "mountain", "high_mountain", "flat",
  "rolling", "mountain", "hilly", "flat", "itt",
  "mountain", "high_mountain", "mountain", "high_mountain", "hilly",
  "flat",
];
// Sub-3 (#2771): GT-sektionen beriges ALTID med ruter når --routes er sat (jf.
// Task 7 spec — "GT-sektionens stages beriges altid"). Én synthetisk race-
// identitet for HELE GT'en (ikke pr. etape) — attachRoute's rng-strøm er
// alligevel pr. stage_number, så hver af de 21 etaper får sin egen rute.
const gtStages = GT_TEMPLATE.map((profile_type, i) => {
  const stage_number = i + 1;
  const base = { stage_number, profile_type, demand_vector: DEMAND_VECTORS[profile_type] };
  if (!ROUTES_MODE) return base;
  const route = attachRoute({ stage_number, profile_type, finale_type: undefined }, { id: "dryrun-gt", name: "Dryrun Grand Tour" }, true);
  return { ...base, ...route };
});

// #2224: POPULATION_MODE bygger GT-feltet fra ALLE tier-1-hold (fallback:
// største pulje) via prod-autopick; den genererede gren (else) er UÆNDRET.
let gtRiders, gtEntrants;
if (POPULATION_MODE) {
  const tier1Teams = populationData.teams.filter((t) => t.tier === 1);
  const largestPool = [...populationPools].sort((a, b) => b.teams.length - a.teams.length)[0];
  const gtTeams = tier1Teams.length > 0 ? tier1Teams : (largestPool?.teams ?? []);
  if (gtTeams.length === 0) {
    console.error(`❌ Population-snapshot har hverken tier-1-hold eller nogen pulje at bygge GT-feltet fra.`);
    process.exit(1);
  }
  gtEntrants = [];
  for (const team of gtTeams) {
    const roster = ridersByTeam.get(team.id) || [];
    const picks = autopickTeamSelection({
      riders: roster.map((r) => ({ rider_id: r.id, abilities: r.abilities, fatigue: HAS_CONDITION ? r.fatigue : undefined })),
      stages: gtStages,
      sizeRule: { min: 8, max: 8 },
    });
    for (const p of picks) {
      const r = byId.get(p.rider_id);
      gtEntrants.push({
        rider_id: p.rider_id, team_id: team.id, rider_name: r.name, is_u25: r.is_u25, abilities: r.abilities,
        ...(ROLES_MODE ? { race_role: p.race_role } : {}),
        ...(HAS_CONDITION && r.form    != null ? { form:    r.form }    : {}),
        ...(HAS_CONDITION && r.fatigue != null ? { fatigue: r.fatigue } : {}),
      });
    }
  }
  gtRiders = gtEntrants.map((e) => byId.get(e.rider_id)).sort((a, b) => b.overall - a.overall);
} else {
  const gtRng = makeRng(stableSeed(`dryrun:${SEED}:gt`));
  gtRiders = sampleField(gtRng, field, GT_FIELD).sort((a, b) => b.overall - a.overall);
  const TEAM_SIZE = 8;
  const nTeams = Math.ceil(gtRiders.length / TEAM_SIZE);
  gtEntrants = gtRiders.map((r, i) => {
    const round = Math.floor(i / nTeams), pos = i % nTeams;
    const teamIdx = round % 2 === 0 ? pos : nTeams - 1 - pos;
    return {
      rider_id: r.id, team_id: `t${teamIdx}`, rider_name: r.name, is_u25: r.is_u25, abilities: r.abilities,
      ...(CONDITION_MODE && r.form    != null ? { form:    r.form }    : {}),
      ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
    };
  });

  // #1307 --roles: tildel roller INDEN FOR de eksisterende GT-hold via den
  // fælles assignRolesToTeams-helper (samme regler som terrain-sampleren).
  if (ROLES_MODE) {
    const gtTeams = new Map();
    for (const e of gtEntrants) {
      if (!gtTeams.has(e.team_id)) gtTeams.set(e.team_id, []);
      gtTeams.get(e.team_id).push(e);
    }
    const gtRoleById = assignRolesToTeams(gtTeams, {
      getOverall:   (e) => byId.get(e.rider_id).overall,
      getId:        (e) => e.rider_id,
      getTeamIdx:   (teamId) => Number(teamId.slice(1)),
      getAbilities: (e) => e.abilities,
    });
    for (const e of gtEntrants) {
      e.race_role = gtRoleById.get(e.rider_id);
    }
  }
}

const { resultRows, incidents: gtIncidents } = buildRaceResults({
  race: { id: "gt-dry", race_type: "stage_race" },
  stages: gtStages, entrants: gtEntrants, pointsLookup: {}, v3: V3_MODE,
});
const finalStage = GT_TEMPLATE.length;
const rowsOf = (type, stage) => resultRows.filter((x) => x.result_type === type && x.stage_number === stage).sort((a, b) => a.rank - b.rank);

// S4 (#1176): buildRaceResults (raceRunner.js) ekskluderer allerede abandons fra
// SENERE etapers eget `ranked`-felt internt (dens egen abandonedSet) — det er IKKE
// noget der skal genopbygges her. Denne blok deriverer blot den SAMME kumulative
// abandon-tilstand UDEFRA (ren læsning af gtIncidents' stage_number-stempler) for
// at få den korrekte feltstørrelses-nævner til incident-statistikken pr. etape —
// GC-feltet skrumper realistisk over de 21 etaper, og nævneren skal følge med.
if (V3_MODE) {
  const gtIncidentsByStage = new Map();
  for (const inc of gtIncidents) {
    if (!gtIncidentsByStage.has(inc.stage_number)) gtIncidentsByStage.set(inc.stage_number, []);
    gtIncidentsByStage.get(inc.stage_number).push(inc);
  }
  let gtAbandonedSoFar = 0;
  for (const stage of gtStages) {
    const stageIncidents = gtIncidentsByStage.get(stage.stage_number) || [];
    const fieldSizeAtStage = gtEntrants.length - gtAbandonedSoFar;
    incidentObservations.push(observeIncidents({ incidents: stageIncidents, fieldSize: fieldSizeAtStage, profileType: stage.profile_type }));
    gtAbandonedSoFar += stageIncidents.filter((inc) => inc.outcome === "abandon").length;
  }
}

// Per-etape struktur til HTML
const gtStageData = gtStages.map((s) => {
  const sn = s.stage_number;
  const top = rowsOf("stage", sn).slice(0, 10).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id), time: row.finish_time }));
  const leadFor = (type) => { const r = rowsOf(type, sn)[0]; return r ? byId.get(r.rider_id) : null; };
  return {
    stage_number: sn, profile_type: s.profile_type, keyAb: keyAbilityOf(s.demand_vector), top,
    leader: leadFor("leader"), points_day: leadFor("points_day"), mountain_day: leadFor("mountain_day"), young_day: leadFor("young_day"),
  };
});
const gtFinal = {
  gc: rowsOf("gc", finalStage).slice(0, 20).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id), time: row.finish_time })),
  points: rowsOf("points", finalStage).slice(0, 5).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id) })),
  mountain: rowsOf("mountain", finalStage).slice(0, 5).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id) })),
  young: rowsOf("young", finalStage).slice(0, 5).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id) })),
  team: resultRows.filter((x) => x.result_type === "team" && x.stage_number === finalStage).sort((a, b) => a.rank - b.rank).slice(0, 5),
};

// #2224 Section F: GT-dominans på final-GC — observeRace kræver components.terrain
// pr. entrant (bruges kun til at udpege favoritten); GC har ingen enkelt-etape-
// components, så vi bruger rider.overall (0-99) som pre-race styrke-proxy — samme
// linse som ⌀rang-metrikken bruger andetsteds i harnesset. Rapporteres separat
// (ÉN linje), indgår IKKE i sæson-akkumulatorerne (season win/start-rates).
const gtTeamByRider = new Map(gtEntrants.map((e) => [e.rider_id, e.team_id]));
const gtRankedForDominance = rowsOf("gc", finalStage).map((row) => ({
  rider_id: row.rider_id,
  team_id: gtTeamByRider.get(row.rider_id) ?? null,
  rank: row.rank,
  components: { terrain: byId.get(row.rider_id)?.overall ?? 0 },
}));
const gtDominanceObservation = observeRace({
  ranked: gtRankedForDominance,
  teamByRider: gtTeamByRider,
  terrain: "gt-final-gc",
});

const lbl = (r) => `${padE(r.name, 22)} ${padE(r.bornAs, 13)} →${padE(r.derived, 12)} ovr ${padS(r.overall, 2)}  ${money(r.baseValue)}`;
console.log(`\n${"─".repeat(80)}`);
console.log(`C. GRAND TOUR — 21 etaper, ${GT_FIELD}-rytters felt\n`);
console.log(`  🏆 GC top 10:`);
for (const g of gtFinal.gc.slice(0, 10)) console.log(`   ${padS(g.rank, 2)}. ${lbl(g.rider)}  ${g.time ?? ""}`);
console.log(`  👕 Grøn: ${gtFinal.points[0] ? gtFinal.points[0].rider.name + " (" + gtFinal.points[0].rider.bornAs + ")" : "—"} · Bjerg: ${gtFinal.mountain[0] ? gtFinal.mountain[0].rider.name + " (" + gtFinal.mountain[0].rider.bornAs + ")" : "—"} · Ungdom: ${gtFinal.young[0] ? gtFinal.young[0].rider.name : "—"}`);

// ── D. STRUKTURELLE MOTOR-ORACLES (#1198/#1144) — håndhævet, exit 1 ved brud ──
// GC-tid-invarianten genberegnes UAFHÆNGIGT af raceRunner: summen af etape-gab
// pr. rytter fra de rå 'stage'-rækker — GC-vinderen skal have feltets minimum.
const parseGap = (t) => {
  const m = /^\+(\d+):(\d{2})$/.exec(String(t || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const cumGapById = new Map();
for (const row of resultRows) {
  if (row.result_type !== "stage") continue;
  const s = parseGap(row.finish_time);
  if (s == null) continue;
  cumGapById.set(row.rider_id, (cumGapById.get(row.rider_id) || 0) + s);
}
const gcAllRows = rowsOf("gc", finalStage);
const gcOracle = gcAllRows.length
  ? {
      winnerCumSeconds: cumGapById.get(gcAllRows[0].rider_id) ?? NaN,
      minCumSeconds: Math.min(...gcAllRows.map((g) => cumGapById.get(g.rider_id) ?? NaN)),
    }
  : null;

// Værdi-sanity: top-decilen (overall) skal være mere værd end bund-decilen.
const medianOf = (arr) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const byOverallDesc = [...field].sort((a, b) => b.overall - a.overall);
const decileN = Math.max(1, Math.floor(field.length / 10));
const valueOracle = {
  topDecileMedian: medianOf(byOverallDesc.slice(0, decileN).map((r) => r.baseValue)),
  bottomDecileMedian: medianOf(byOverallDesc.slice(-decileN).map((r) => r.baseValue)),
};

const structuralFailures = evaluateRaceStructuralOracles({ terrainResults, gc: gcOracle, value: valueOracle });
const failedTargets = scorecard.filter((s) => !s.pass);

console.log(`\n${"─".repeat(80)}`);
console.log("D. STRUKTURELLE MOTOR-ORACLES (håndhævet — exit 1 ved brud)\n");
if (structuralFailures.length) {
  console.log("   ❌ ORACLE-BRUD:");
  for (const f of structuralFailures) console.log(`   - ${f}`);
  process.exitCode = 1;
} else {
  console.log("   ✓ nøgle-evne belønnes på alle terræner · ingen monopol-vindere · GC = laveste tid · værdi-pyramide ikke inverteret");
}
// #2224: i population-mode er B-scorecardet ALTID rapport-only (båndene er
// kalibreret mod den GENEREREDE population) — --enforce-targets ignoreres med
// en note, uanset flag.
if (failedTargets.length) {
  if (ENFORCE_TARGETS && !POPULATION_MODE) {
    console.log(`   ❌ ${failedTargets.length} kalibrerings-bånd under mål (--enforce-targets aktiv → exit 1): ${failedTargets.map((s) => s.terrain).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${failedTargets.length} kalibrerings-bånd under mål (rapport-only${POPULATION_MODE ? " — population-mode, --enforce-targets ignoreret" : "; håndhæv med --enforce-targets"}): ${failedTargets.map((s) => s.terrain).join(", ")}`);
  }
}
// #1307: roles-metrikker (kaptajn-delta + hunter-ratio) er launch-relevante og
// håndhæves med --enforce-targets, præcis som win-rate-scorecardet. #2224: n/a
// i population-mode (rolesFailures forbliver altid tom dér, se ROLES-METRIKKER-blokken).
if (rolesFailures.length) {
  if (ENFORCE_TARGETS && !POPULATION_MODE) {
    console.log(`   ❌ ${rolesFailures.length} roles-bånd brudt (--enforce-targets aktiv → exit 1): ${rolesFailures.join(" · ")}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${rolesFailures.length} roles-bånd brudt (rapport-only; håndhæv med --enforce-targets): ${rolesFailures.join(" · ")}`);
  }
}
// #1021 Fase 1 (post-launch): udbruds-realisme-båndene er KANDIDAT-bånd der endnu
// ikke er cross-seed-kalibreret mod den nuværende population. RAPPORT-ONLY som
// standard, så de ikke maskerer/blokerer de launch-kritiske gates; #1021-
// kalibreringen kan gøre dem hard igen med --enforce-breakaway. #2224: ALTID
// rapport-only i population-mode (samme begrundelse som B-scorecardet).
if (breakawayBandFailures.length) {
  if (ENFORCE_BREAKAWAY && !POPULATION_MODE) {
    console.log(`   ❌ ${breakawayBandFailures.length} udbruds-bånd udenfor (--enforce-breakaway aktiv → exit 1): ${breakawayBandFailures.join(" · ")}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${breakawayBandFailures.length} udbruds-bånd udenfor (rapport-only${POPULATION_MODE ? " — population-mode, --enforce-breakaway ignoreret" : " — post-launch #1021-kalibrering; håndhæv med --enforce-breakaway"}): ${breakawayBandFailures.join(" · ")}`);
  }
}

// ── E. EVNE-LIVENESS (#1122) — rykker hver evne faktisk placeringen? ──────────
// Probe-matrix: (evne, terræn, mode). Terræn-kraft testes neutralt; seam/dynamik-
// evner i deres mode (aggression: udbruds-egnet terræn; durability: condition;
// descending: descent-finale). Gulvet er bevidst lavt (0.05 ⌀rank) — vi tester
// "påvirker den OVERHOVEDET", ikke kalibrerings-styrke (det er scorecardet i B).
// Rapport-only; håndhæves (exit 1) med --enforce-liveness (tilføjes race:gate i Phase C).
const LIVENESS_PROBES = [
  // Allerede-levende terræn-kraft (sanity — skal være grønne fra start):
  { ability: "sprint",      terrain: "flat",          mode: "neutral" },
  { ability: "climbing",    terrain: "mountain",      mode: "neutral" },
  { ability: "time_trial",  terrain: "itt",           mode: "neutral" },
  { ability: "cobblestone", terrain: "cobbles",       mode: "neutral" },
  { ability: "punch",       terrain: "hilly",         mode: "neutral" },
  { ability: "endurance",   terrain: "high_mountain", mode: "neutral" },
  // Plan 1-aktiverede (RØDE i Phase A, GRØNNE efter Phase B):
  { ability: "flat",        terrain: "rolling",       mode: "neutral" },
  { ability: "tempo",       terrain: "mountain",      mode: "neutral" },
  { ability: "durability",  terrain: "high_mountain", mode: "condition" },
  { ability: "descending",  terrain: "mountain",      mode: "finale", finaleType: "descent" },
  // aggression måles separat (deltagelses-gap, ikke rank) — se nedenfor.
];
const LIVENESS_FLOOR = 0.05;
// Plan 1 (#1122, ejer-valgt C1): seam/dynamik-evner har lavere gulv end terræn-
// kraft — de virker gennem mindre seams (durability via placeholder-fatigue til
// #1021, aggression via udbruds-chance, descending via finale-modifier), så et
// lavere "læses-overhovedet"-gulv er korrekt. Terræn-kraft (neutral) beholder 0.05.
const SEAM_FLOOR = 0.02;          // durability/descending (rank-metrik, subtile seams)
const BREAKAWAY_GAP_FLOOR = 0.01; // aggression (deltagelses-gap-metrik — anden skala)
const SEAM_MODES = { breakaway: BREAKAWAY_GAP_FLOOR, condition: SEAM_FLOOR, finale: SEAM_FLOOR };
const floorFor = (mode) => SEAM_MODES[mode] ?? LIVENESS_FLOOR;

// Felt med condition til durability-proben (genbrug condition-felter hvis sat,
// ellers seeded form/fatigue lokalt så proben er reproducerbar uafhængigt af flag).
const livenessField = field.map((r) => {
  if (r.form != null || r.fatigue != null) return r;
  const lr = makeRng((stableSeed(`liveness:${SEED}:${r.id}`) ^ 0x5eed1135) >>> 0);
  return { ...r, form: Math.round(30 + lr() * 60), fatigue: Math.round(30 + lr() * 50) };
});

// Rank-drevne evner (terræn-kraft + durability/descending-seams): per-rytter rank-følsomhed.
const livenessResults = LIVENESS_PROBES.map((p) => {
  const rankGain = abilityRankSensitivity({
    field: p.mode === "condition" ? livenessField : field,
    profileType: p.terrain,
    demandVector: DEMAND_VECTORS[p.terrain],
    ability: p.ability,
    finaleType: p.finaleType ?? null,
    withCondition: p.mode === "condition",
    samples: 150, fieldSize: 80, seed: SEED,
  });
  return { ...p, rankGain, metric: "rank" };
});

// Aggression driver udbruds-CHANCEN (ikke rank): aggregat deltagelses-gap mellem
// top- og bund-aggression-tercil på et udbruds-egnet terræn (mountain). Robust
// signal — beviser at aggression-EVNEN (ikke den gamle proxy) styrer udvælgelsen.
const aggressionGap = breakawayParticipationGapByAggression({
  field, profileType: "mountain", demandVector: DEMAND_VECTORS.mountain,
  races: RACES, fieldSize: FIELD, seed: SEED,
});
livenessResults.push({ ability: "aggression", terrain: "mountain", mode: "breakaway", rankGain: aggressionGap, metric: "bw-gap" });

const livenessFailures = evaluateAbilityLivenessOracle(livenessResults, { floor: LIVENESS_FLOOR, floorByMode: SEAM_MODES });

console.log(`\n${"─".repeat(80)}`);
console.log(`E. EVNE-LIVENESS (terræn-kraft: ⌀rank ved +${SENSITIVITY_DELTA}, gulv ${LIVENESS_FLOOR}; seam rank-gulv ${SEAM_FLOOR}; aggression: udbruds-deltagelses-gap, gulv ${BREAKAWAY_GAP_FLOOR})\n`);
for (const r of livenessResults) {
  const ok = r.rankGain >= floorFor(r.mode);
  const label = r.metric === "bw-gap" ? "bw-gap" : "⌀rank ";
  console.log(`   ${padE(r.ability, 13)} ${padE(r.terrain, 14)} ${padE(r.mode, 10)} ${label} ${padS(r.rankGain.toFixed(2), 6)}   ${ok ? "✓" : "✗ DØDVÆGT"}`);
}
// #2224: ALTID rapport-only i population-mode (probe-bånd kalibreret mod den
// GENEREREDE population) — --enforce-liveness ignoreres med en note.
if (livenessFailures.length) {
  if (ENFORCE_LIVENESS && !POPULATION_MODE) {
    console.log(`   ❌ ${livenessFailures.length} evne(r) er dødvægt (--enforce-liveness aktiv → exit 1):`);
    for (const f of livenessFailures) console.log(`   - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${livenessFailures.length} evne(r) er dødvægt (rapport-only${POPULATION_MODE ? " — population-mode, --enforce-liveness ignoreret" : "; håndhæv med --enforce-liveness"}): ${livenessResults.filter((r) => r.rankGain < floorFor(r.mode)).map((r) => r.ability).join(", ")}`);
  }
}

// ── B4: condition-mode sanity ─────────────────────────────────────────────────
if (CONDITION_MODE) {
  // Score-swing AFLEDES af de faktiske vægte fra raceSimulator (ingen stale tal):
  //   formComponent  = ((form-50)/50)*FORM_RACE_WEIGHT     → [30,90]-interval
  //   fatigueComponent = (fatigue/100)*FATIGUE_RACE_WEIGHT → [0,70]-interval
  const forms    = field.map((r) => r.form    ?? 60);
  const fatigues = field.map((r) => r.fatigue ?? 0);
  const maxForm    = Math.max(...forms),    minForm    = Math.min(...forms);
  const maxFatigue = Math.max(...fatigues), minFatigue = Math.min(...fatigues);
  const meanForm    = Math.round(forms.reduce((s, v) => s + v, 0) / forms.length);
  const meanFatigue = Math.round(fatigues.reduce((s, v) => s + v, 0) / fatigues.length);
  const formSwing    = ((90 - 30) / 50) * FORM_RACE_WEIGHT;   // [30,90]-interval
  const fatigueSwing = (70 / 100) * FATIGUE_RACE_WEIGHT;      // [0,70]-interval
  console.log(`\n   condition-mode sanity (B4 — felt=${field.length} ryttere):`);
  console.log(`   form    range [${minForm}, ${maxForm}] ·  mean ${meanForm}  (tilsigtet [30, 90])`);
  console.log(`   fatigue range [${minFatigue}, ${maxFatigue}] · mean ${meanFatigue} (tilsigtet [0, 70])`);
  console.log(`   max score-swing (condition-interval): form ${formSwing.toFixed(4)} + fatigue ${fatigueSwing.toFixed(4)} = ${(formSwing + fatigueSwing).toFixed(4)}`);
}

// ── F. DOMINANS/VARIANS-SCORECARD (#2224) — kører i ALLE modes ──────────────
// Måler om motoren er for FORUDSIGELIG (samme favorit/hold vinder for ofte)
// eller for FLAD (ingen sammenhæng mellem evne og resultat). Rapport-only som
// standard; --enforce-dominance gør båndene til en hard gate (exit 1).
const DOMINANCE_TARGETS = {
  favoriteWinRate:         { min: 0.25, max: 0.40 },
  maxSeasonWinRate:        { max: 0.45 },            // ≥5 starter
  p95SeasonWinRate:        { max: 0.35 },
  favoritePodiumRate:      { min: 0.55, max: 0.75 },
  share4PlusSameTeamTop10: { max: 0.05 },
  avgDistinctTeamsTop10:   { min: 7.5 },
  ittFavoriteWinRate:      { min: 0.45, max: 0.65 }, // perTerrain.itt
  helperLossMedianGc:      { min: 10, max: 30 },     // tabte pladser, FULD-FELT-linse (S0-arv; ~0 pr. konstruktion i hjælper-tunge felter — se helperLossTop15MedianGc)
  // #2352 (S1, bindende linse): counterfactual hjælper-tab for hjælpere i
  // feltets terrain-top-15 (parret same-seed roles vs. rolle-frit). Ejerens
  // "A — MARKANT"-bånd: median 10-30 tabte pladser.
  helperLossTop15MedianGc: { min: 10, max: 30 },
};
const DOMINANCE_PCT_KEYS = new Set([
  "favoriteWinRate", "maxSeasonWinRate", "p95SeasonWinRate", "favoritePodiumRate",
  "share4PlusSameTeamTop10", "ittFavoriteWinRate",
]);

const dominanceAgg = aggregateObservations(allDominanceObservations);
const seasonWinRateStats = winRateStats({ winsByRider: seasonWinsByRider, startsByRider: seasonStartsByRider, minStarts: 5 });
const seasonGini = giniOverWins({ winsByRider: seasonWinsByRider, startsByRider: seasonStartsByRider });
const helperLossMedianGc = ROLES_MODE ? median(helperDeltasAll) : null;
const helperLossTop15MedianGc = ROLES_MODE ? median(helperTop15DeltasAll) : null;
const helperLossTop15P25 = ROLES_MODE ? quantile(helperTop15DeltasAll, 0.25) : null;
const helperLossTop15P75 = ROLES_MODE ? quantile(helperTop15DeltasAll, 0.75) : null;
// S4 (#1176): uhelds/DNF-scorecard — MÅLT (erstatter den tidligere forward-
// reference "0% — komponent endnu ikke i motoren"). incidentObservations er
// altid [] når v3=false (rollIncidents dormant) → incidentStats.stages=0 →
// evaluateIncidentBoundsOracle returnerer [] uconditionelt (n/a-håndtering).
const incidentStats = aggregateIncidentObservations(incidentObservations);
// Håndhæves sammen med --enforce-dominance (samme gating-idiom som
// DOMINANCE_TARGETS) — cap-målet sendes ind LEVENDE fra RACE_V3_TUNING, så en
// env-override af RACE_V3_INCIDENT_MAX_FIELD_SHARE altid matcher oraklets bånd.
const incidentBoundFailures = V3_MODE
  ? evaluateIncidentBoundsOracle(incidentStats, { maxFieldSharePct: RACE_V3_TUNING.INCIDENT_MAX_FIELD_SHARE * 100 })
  : [];

const dominanceMeasured = {
  favoriteWinRate: dominanceAgg.favoriteWinRate,
  maxSeasonWinRate: seasonWinRateStats.maxWinRate,
  p95SeasonWinRate: seasonWinRateStats.p95WinRate,
  favoritePodiumRate: dominanceAgg.favoritePodiumRate,
  share4PlusSameTeamTop10: dominanceAgg.share4PlusSameTeamTop10,
  avgDistinctTeamsTop10: dominanceAgg.avgDistinctTeamsTop10,
  ittFavoriteWinRate: dominanceAgg.perTerrain?.itt?.favoriteWinRate ?? null,
  helperLossMedianGc,
  helperLossTop15MedianGc,
};

function checkDominanceBand(value, band) {
  if (value == null) return null; // n/a
  if (band.min != null && value < band.min) return false;
  if (band.max != null && value > band.max) return false;
  return true;
}

const dominanceRows = Object.entries(DOMINANCE_TARGETS).map(([key, band]) => {
  const value = dominanceMeasured[key];
  const pass = checkDominanceBand(value, band);
  return { key, value, band, pass };
});
const dominanceFailures = dominanceRows
  .filter((r) => r.pass === false)
  .map((r) => {
    const fmt = (v) => (DOMINANCE_PCT_KEYS.has(r.key) ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
    const bandFmt = DOMINANCE_PCT_KEYS.has(r.key)
      ? `[${r.band.min != null ? (r.band.min * 100).toFixed(1) + "%" : "−"}, ${r.band.max != null ? (r.band.max * 100).toFixed(1) + "%" : "−"}]`
      : `[${r.band.min ?? "−"}, ${r.band.max ?? "−"}]`;
    return `${r.key} ${fmt(r.value)} udenfor ${bandFmt}`;
  });

// team-linse aktiv i denne kørsel — se sektions-note nedenfor.
const dominanceTeamLens = POPULATION_MODE ? "rigtige hold" : (ROLES_MODE ? "snake-draft-hold" : "ingen (hver rytter sit eget hold)");

console.log(`\n${"─".repeat(80)}`);
console.log(`F. DOMINANS/VARIANS-SCORECARD (#2224) — team-linse: ${dominanceTeamLens}\n`);
console.log(`   ${padE("metrik", 25)}${padE("målt", 12)}${padE("bånd", 22)}status`);
console.log(`   ${"-".repeat(74)}`);
for (const r of dominanceRows) {
  const isPct = DOMINANCE_PCT_KEYS.has(r.key);
  const valueStr = r.value == null ? "n/a" : (isPct ? `${(r.value * 100).toFixed(1)}%` : r.value.toFixed(1));
  const bandStr = isPct
    ? `[${r.band.min != null ? (r.band.min * 100).toFixed(0) + "%" : "−"}, ${r.band.max != null ? (r.band.max * 100).toFixed(0) + "%" : "−"}]`
    : `[${r.band.min ?? "−"}, ${r.band.max ?? "−"}]`;
  const statusStr = r.pass == null ? "n/a" : (r.pass ? "✓" : "✗");
  console.log(`   ${padE(r.key, 25)}${padE(valueStr, 12)}${padE(bandStr, 22)}${statusStr}`);
}
console.log(`\n   Gini (sejre, alle startere): ${seasonGini == null ? "n/a" : seasonGini.toFixed(3)} (rapport-only, intet bånd)`);
// #2353: realiseret jour-sans-rate måles når --v3 (spec §12-bånd 2-5% af rytter-
// etaper; rapport-only — basen er en direkte tunings-konstant, ikke en emergent).
const jourSansRatePct = riderStageCount ? (100 * jourSansHits / riderStageCount) : 0;
const dnfLine = V3_MODE && incidentStats.stages
  ? `⌀${incidentStats.meanDnfRatePct.toFixed(3)}% af feltet/etape (bånd 0.3-1.5%) · uheldsrate ⌀${incidentStats.meanIncidentRatePct.toFixed(3)}% · maks. enkelt-etape ${incidentStats.maxIncidentSharePct.toFixed(2)}% (cap ${(RACE_V3_TUNING.INCIDENT_MAX_FIELD_SHARE * 100).toFixed(1)}%) · abandon-andel ${(incidentStats.abandonShareOfIncidents * 100).toFixed(1)}% (mål 25%±10pp)`
  : V3_MODE ? "n/a (0 etape-observationer)" : "0% (kræver --v3)";
console.log(`   Jour-sans-rate: ${V3_MODE ? `${jourSansRatePct.toFixed(2)}% (bånd 2-5%, rapport-only)` : "0% (kræver --v3)"} · DNF-rate: ${dnfLine}`);
console.log(`   GT (final-GC-top10): favorit vandt=${gtDominanceObservation.favoriteWon} podium=${gtDominanceObservation.favoritePodium} · maxSameTeamTop10=${gtDominanceObservation.maxSameTeamTop10} · distinctTeamsTop10=${gtDominanceObservation.distinctTeamsTop10}`);
if (ROLES_MODE) {
  // #2352: fordelings-kontekst for top-terrain-linsen (medianen står i tabellen).
  console.log(`   helperLossTop15 (counterfactual, n=${helperTop15DeltasAll.length}): p25=${helperLossTop15P25 ?? "n/a"} · median=${helperLossTop15MedianGc ?? "n/a"} · p75=${helperLossTop15P75 ?? "n/a"} (positiv = tabte pladser)`);
} else {
  console.log(`   helperLossMedianGc/helperLossTop15MedianGc: n/a (kræver --roles)`);
}
if (V3_MODE) {
  console.log(`\n   UHELDS/DNF-BÅND pr. profil (S4, #1176; håndhæves sammen med --enforce-dominance):`);
  const profileRows = Object.entries(incidentStats.perProfile).sort((a, b) => b[1].meanIncidentRatePct - a[1].meanIncidentRatePct);
  for (const [profile, agg] of profileRows) {
    console.log(`   ${padE(profile, 14)} uheld ⌀${padS(agg.meanIncidentRatePct.toFixed(3), 7)}%   DNF ⌀${padS(agg.meanDnfRatePct.toFixed(3), 7)}%   (n=${agg.stages})`);
  }
  if (incidentBoundFailures.length) {
    if (ENFORCE_DOMINANCE) {
      console.log(`   ❌ ${incidentBoundFailures.length} uhelds/DNF-mål udenfor bånd (--enforce-dominance aktiv → exit 1): ${incidentBoundFailures.join(" · ")}`);
      process.exitCode = 1;
    } else {
      console.log(`   ⚠ ${incidentBoundFailures.length} uhelds/DNF-mål udenfor bånd (rapport-only; håndhæv med --enforce-dominance): ${incidentBoundFailures.join(" · ")}`);
    }
  } else {
    console.log(`   ✓ alle uhelds/DNF-mål inden for bånd`);
  }
}

if (dominanceFailures.length) {
  if (ENFORCE_DOMINANCE) {
    console.log(`   ❌ ${dominanceFailures.length} dominans-mål udenfor bånd (--enforce-dominance aktiv → exit 1): ${dominanceFailures.join(" · ")}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${dominanceFailures.length} dominans-mål udenfor bånd (rapport-only; håndhæv med --enforce-dominance): ${dominanceFailures.join(" · ")}`);
  }
} else {
  console.log(`   ✓ alle dominans-mål inden for bånd`);
}

// ── G. RUTE-REALISME-BÅND + A/B (Sub-3 #2771, Task 7) — kun med --routes ─────
// Målt kun under --routes; håndhævet (exit 1) kun med --enforce-route-bands.
// Sektion B/D/udbruds-bånd OVENFOR er allerede kørt mod rute-berigede
// stageProfiles når --routes er sat (samme stageProfile-konstruktion i terrain-
// loopet ovenfor) — de er derfor IMPLICIT re-verificeret under --routes uden
// en separat kørsel her (spec-krav "eksisterende bånd skal ALSO holde under
// --routes" er opfyldt strukturelt, ikke ved dobbelt-udførelse).
let routeBandRows = [];
let routeBandFailures = [];
if (ROUTES_MODE) {
  // Synthesized batches: hånd-byggede climbs/distance (INGEN rng i selve
  // ruten) — kun felt-sampling + score-støj bruger rng, seedet deterministisk
  // pr. bånd-navn (reproducerbart pr. seed, uafhængigt af terrain-loopets
  // egne rng-strømme ovenfor).
  const ROUTE_BATCH_N = 100;
  // #2771 kalibrering: spec-minimum er 300; 600 valgt for at reducere kvantiserings-
  // støj på grænsen (300 løb → 0,33pp pr. vundet løb — for groft til at skelne
  // "+3,0pp" fra "+3,3pp" pålideligt på tværs af seeds, se KALIBRERINGS-LOG).
  const ROUTE_LIFT_N = 600;
  const ROUTE_FIELD = Math.min(FIELD, field.length);
  const mountainMid = DISTANCE_BAND_MIDPOINTS.mountain; // 170 (jf. raceSimulator.js)

  function runRouteBatch(stageProfile, n, seedKey, fieldSize = ROUTE_FIELD) {
    const rng = makeRng(stableSeed(`dryrun:${SEED}:routebands:${seedKey}`));
    const races = [];
    for (let i = 0; i < n; i++) {
      const sample = sampleField(rng, field, fieldSize);
      const raceSeed = stableSeed(`routebands:${seedKey}:${i}`);
      const entrants = sample.map((r) => ({ rider_id: r.id, team_id: r.id, abilities: r.abilities }));
      const { ranked } = simulateStage({ entrants, stageProfile, seed: raceSeed });
      races.push({ ranked, sample });
    }
    return races;
  }
  // p90-gab pr. løb, derefter MEDIAN over løbene i batchet (samme konvention
  // som prologP90Gap-definitionen: "median over stages").
  function p90GapMedian(races) {
    return median(races.map(({ ranked }) => quantile(ranked.map((r) => r.stageGap), 0.9)));
  }
  function winnerShareTopQuartile(races, abilityFn, threshold) {
    let hits = 0;
    for (const { ranked, sample } of races) {
      const winner = sample.find((r) => r.id === ranked[0].rider_id);
      if (winner && abilityFn(winner) >= threshold) hits++;
    }
    return races.length ? hits / races.length : 0;
  }

  // -- summitValleyGapRatio (≥1.5): summit- vs dal-finish, samme kategori/distance --
  const summitProfile = {
    profile_type: "mountain", distance_km: mountainMid, demand_vector: DEMAND_VECTORS.mountain,
    climbs: [{ category: "1", crest_km: mountainMid, summit_finish: true }],
  };
  const valleyProfile = {
    profile_type: "mountain", distance_km: mountainMid, demand_vector: DEMAND_VECTORS.mountain,
    climbs: [{ category: "1", crest_km: mountainMid - 15, summit_finish: false }], // 15 km ≥ VALLEY_MIN_DESCENT_KM
  };
  const summitP90 = p90GapMedian(runRouteBatch(summitProfile, ROUTE_BATCH_N, "summit"));
  const valleyP90 = p90GapMedian(runRouteBatch(valleyProfile, ROUTE_BATCH_N, "valley"));
  const summitValleyGapRatio = valleyP90 > 0 ? summitP90 / valleyP90 : Infinity;

  // -- prologP90Gap (≤25s): hånd-sat itt-distance i prolog-båndet [5,8] km --
  const prologProfile = { profile_type: "itt", distance_km: 6, demand_vector: DEMAND_VECTORS.itt };
  const prologP90Gap = p90GapMedian(runRouteBatch(prologProfile, ROUTE_BATCH_N, "prolog"));

  // -- ittDistanceGapRatio (≥2): 40 km vs 15 km itt --
  const itt40P90 = p90GapMedian(runRouteBatch({ profile_type: "itt", distance_km: 40, demand_vector: DEMAND_VECTORS.itt }, ROUTE_BATCH_N, "itt40"));
  const itt15P90 = p90GapMedian(runRouteBatch({ profile_type: "itt", distance_km: 15, demand_vector: DEMAND_VECTORS.itt }, ROUTE_BATCH_N, "itt15"));
  const ittDistanceGapRatio = itt15P90 > 0 ? itt40P90 / itt15P90 : Infinity;

  // -- longDayEnduranceLift (>+3pp): endurance-top-kvartil vinder-andel, lang vs kort dag --
  const longProfile = { profile_type: "mountain", distance_km: Math.round(mountainMid * 1.15), demand_vector: DEMAND_VECTORS.mountain };
  const shortProfile = { profile_type: "mountain", distance_km: Math.round(mountainMid * 0.9), demand_vector: DEMAND_VECTORS.mountain };
  const longBatch = runRouteBatch(longProfile, ROUTE_LIFT_N, "long-day");
  const shortBatch = runRouteBatch(shortProfile, ROUTE_LIFT_N, "short-day");
  const enduranceThreshold = quantile(field.map((r) => r.abilities.endurance), 0.75);
  const longDayEnduranceLift = 100 * (
    winnerShareTopQuartile(longBatch, (r) => r.abilities.endurance, enduranceThreshold) -
    winnerShareTopQuartile(shortBatch, (r) => r.abilities.endurance, enduranceThreshold)
  );

  // -- technicalFinaleLift (>0pp): descending+positioning-top-kvartil vinder-andel, teknisk vs ikke --
  const techProfile = {
    profile_type: "mountain", distance_km: mountainMid, demand_vector: DEMAND_VECTORS.mountain, finale_type: "reduced_sprint",
    climbs: [{ category: "1", crest_km: mountainMid - 8, summit_finish: false }], // 8 km efter top → teknisk (descent-vindue [3,12])
  };
  const nonTechProfile = {
    profile_type: "mountain", distance_km: mountainMid, demand_vector: DEMAND_VECTORS.mountain, finale_type: "reduced_sprint",
    climbs: [{ category: "1", crest_km: mountainMid - 30, summit_finish: false }], // 30 km efter top → IKKE teknisk
  };
  const techBatch = runRouteBatch(techProfile, ROUTE_LIFT_N, "tech-finale");
  const nonTechBatch = runRouteBatch(nonTechProfile, ROUTE_LIFT_N, "nontech-finale");
  const technicalComposite = (r) => (r.abilities.descending + r.abilities.positioning) / 2;
  const technicalThreshold = quantile(field.map(technicalComposite), 0.75);
  const technicalFinaleLift = 100 * (
    winnerShareTopQuartile(techBatch, technicalComposite, technicalThreshold) -
    winnerShareTopQuartile(nonTechBatch, technicalComposite, technicalThreshold)
  );

  routeBandRows = [
    { key: "summitValleyGapRatio", value: summitValleyGapRatio, pass: summitValleyGapRatio >= 1.5, band: "≥1.50", fmt: (v) => v.toFixed(2) },
    { key: "prologP90Gap", value: prologP90Gap, pass: prologP90Gap <= 25, band: "≤25s", fmt: (v) => `${v.toFixed(1)}s` },
    { key: "ittDistanceGapRatio", value: ittDistanceGapRatio, pass: ittDistanceGapRatio >= 2, band: "≥2.00", fmt: (v) => v.toFixed(2) },
    { key: "longDayEnduranceLift", value: longDayEnduranceLift, pass: longDayEnduranceLift > 3, band: ">+3pp", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp` },
    { key: "technicalFinaleLift", value: technicalFinaleLift, pass: technicalFinaleLift > 0, band: ">0pp", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp` },
  ];
  routeBandFailures = routeBandRows.filter((r) => !r.pass);

  console.log(`\n${"─".repeat(80)}`);
  console.log(`G. RUTE-REALISME-BÅND (#2771; håndhæves med --enforce-route-bands)\n`);
  console.log(`   ${padE("metrik", 24)}${padE("målt", 12)}${padE("bånd", 10)}status`);
  console.log(`   ${"-".repeat(60)}`);
  for (const r of routeBandRows) {
    console.log(`   ${padE(r.key, 24)}${padE(r.fmt(r.value), 12)}${padE(r.band, 10)}${r.pass ? "✓" : "✗"}`);
  }
  console.log(`   (summit/valley/prolog/itt-distance: N=${ROUTE_BATCH_N} synth. løb/bånd, felt=${ROUTE_FIELD} · long-day/teknisk-finale: N=${ROUTE_LIFT_N}/bånd)`);
  console.log(`   Eksisterende TARGETS/BREAKAWAY_TARGETS/strukturelle oracles ovenfor (B/D) er KØRT MED rute-berigede profiler i denne kørsel (ikke gentaget her).`);
  if (routeBandFailures.length) {
    if (ENFORCE_ROUTE_BANDS) {
      console.log(`   ❌ ${routeBandFailures.length} rute-bånd udenfor (--enforce-route-bands aktiv → exit 1): ${routeBandFailures.map((r) => r.key).join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log(`   ⚠ ${routeBandFailures.length} rute-bånd udenfor (rapport-only; håndhæv med --enforce-route-bands): ${routeBandFailures.map((r) => r.key).join(", ")}`);
    }
  } else {
    console.log(`   ✓ alle rute-realisme-bånd inden for mål`);
  }

  // -- A/B: favorit-vinder-rate MED ruter vs BARE, samme seeds (jf. Task 7 §3) --
  if (!POPULATION_MODE) {
    console.log(`\n   A/B — favorit-vinder-rate MED ruter vs BARE (samme entrants + raceSeed pr. løb, kun stageProfilens rutefelter varierer):`);
    console.log(`   ${padE("terræn", 14)}${padE("med ruter", 12)}${padE("bare", 10)}delta`);
    console.log(`   ${"-".repeat(50)}`);
    for (const tr of terrainResults) {
      if (!tr.abRaces) continue;
      const withPct = pct1(tr.abFavoriteWithRoutes, tr.abRaces);
      const barePct = pct1(tr.abFavoriteBare, tr.abRaces);
      const delta = withPct - barePct;
      console.log(`   ${padE(tr.terrain, 14)}${padE(`${withPct}%`, 12)}${padE(`${barePct}%`, 10)}${delta >= 0 ? "+" : ""}${delta}pp`);
    }
  } else {
    console.log(`\n   A/B: n/a i population-mode (kun implementeret for den genererede sti — se Task 7-rapport).`);
  }
}

// ── HTML-cockpit ──────────────────────────────────────────────────────────────
if (WRITE_HTML) {
  const chip = (r) => r ? `<span class="chip ${r.bornAs}">${esc(r.bornAs)}</span>` : "—";
  const riderCell = (r) => r ? `<b>${esc(r.name)}</b> ${chip(r)} <span class="muted">→${esc(r.derived)} · ovr ${r.overall} · ${money(r.baseValue)}</span>` : "—";

  const scorecardRows = scorecard.map((s) => `
    <tr class="${s.pass ? "pass" : "fail"}">
      <td>${esc(s.terrain)}</td><td>${esc(s.label)}</td>
      <td class="num"><b>${Math.round(s.bornPct * 100)}%</b></td>
      <td class="num muted">${Math.round(s.derivedPct * 100)}%</td>
      <td class="num">${Math.round(s.targetPct * 100)}%</td>
      <td>${s.pass ? "✓ ramt" : `✗ ${Math.round((s.bornPct - s.targetPct) * 100)}`}</td>
    </tr>`).join("");

  const terrainRows = terrainResults.map((tr) => `
    <tr>
      <td>${esc(tr.terrain)}</td><td>${esc(tr.keyAb)}</td>
      <td class="num"><b>${tr.winnerKeyAvg}</b> <span class="muted">vs ${tr.fieldMedianKey}</span></td>
      <td>${esc(top3(tr.bornHist, tr.races))}</td>
      <td class="muted">${esc(top3(tr.derivedHist, tr.races))}</td>
      <td class="num">${tr.avgStrengthRank.toFixed(1)}</td>
      <td class="num">${tr.distinct}/${tr.races}</td>
    </tr>`).join("");

  const typeBar = fieldSummary.types.map(([t, n]) => `<span class="chip ${t}">${esc(t)} ${pctS(n, field.length)}</span>`).join(" ");

  // #2224: dominans/varians-scorecard (sektion F) + win-rate-histogram.
  const dominanceRowsHtml = dominanceRows.map((r) => {
    const isPct = DOMINANCE_PCT_KEYS.has(r.key);
    const valueStr = r.value == null ? "n/a" : (isPct ? `${(r.value * 100).toFixed(1)}%` : r.value.toFixed(1));
    const bandStr = isPct
      ? `[${r.band.min != null ? (r.band.min * 100).toFixed(0) + "%" : "−"}, ${r.band.max != null ? (r.band.max * 100).toFixed(0) + "%" : "−"}]`
      : `[${r.band.min ?? "−"}, ${r.band.max ?? "−"}]`;
    const statusClass = r.pass == null ? "" : (r.pass ? "pass" : "fail");
    const statusText = r.pass == null ? "n/a" : (r.pass ? "✓" : "✗");
    return `
    <tr class="${statusClass}">
      <td>${esc(r.key)}</td><td class="num">${esc(valueStr)}</td><td class="num muted">${esc(bandStr)}</td><td>${statusText}</td>
    </tr>`;
  }).join("");
  const winRateHistMax = Math.max(1, ...seasonWinRateStats.histogram.map((b) => b.count));
  const winRateHistRows = seasonWinRateStats.histogram.map((b) => `
    <tr>
      <td class="num muted">${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%</td>
      <td><div style="background:#5cc8ff;height:10px;width:${Math.round((b.count / winRateHistMax) * 100)}%;border-radius:4px"></div></td>
      <td class="num">${b.count}</td>
    </tr>`).join("");

  const stageBlocks = gtStageData.map((st) => {
    const rows = st.top.map((x) => `<tr><td class="num">${x.rank}</td><td>${riderCell(x.rider)}</td><td class="num muted">${esc(x.time || "")}</td></tr>`).join("");
    const jerseys = [["GC", st.leader], ["Grøn", st.points_day], ["Bjerg", st.mountain_day], ["Ungdom", st.young_day]]
      .filter(([, r]) => r).map(([k, r]) => `${k}: <b>${esc(r.name)}</b> ${chip(r)}`).join(" · ");
    return `
    <details>
      <summary>Etape ${st.stage_number} — <span class="terrain ${st.profile_type}">${esc(st.profile_type)}</span> <span class="muted">(nøgle: ${esc(st.keyAb)})</span></summary>
      <div class="stage-body">
        <table class="results"><thead><tr><th>#</th><th>Rytter</th><th>Tid</th></tr></thead><tbody>${rows}</tbody></table>
        ${jerseys ? `<p class="jerseys">${jerseys}</p>` : ""}
      </div>
    </details>`;
  }).join("");

  const gcRows = gtFinal.gc.map((g) => `<tr><td class="num">${g.rank}</td><td>${riderCell(g.rider)}</td><td class="num muted">${esc(g.time || "")}</td></tr>`).join("");
  const finalJerseys = [["🟢 Point", gtFinal.points[0]?.rider], ["⛰️ Bjerg", gtFinal.mountain[0]?.rider], ["⚪ Ungdom", gtFinal.young[0]?.rider]]
    .map(([k, r]) => `<div class="jcard"><div class="jt">${k}</div>${r ? riderCell(r) : "—"}</div>`).join("");

  const startlist = gtRiders.map((r) => `<tr><td>${esc(r.name)}</td><td>${chip(r)}</td><td class="muted">→${esc(r.derived)}</td><td class="num">${r.overall}</td><td class="num">${esc(r.specialty)}</td><td class="num">${money(r.baseValue)}</td></tr>`).join("");

  // Hele populationen (godkendelses-view) — sorteret efter base_value, med de
  // vigtigste disciplin-evner så feltets indhold kan vurderes direkte.
  const roster = [...field].sort((a, b) => (b.baseValue || 0) - (a.baseValue || 0));
  const rosterRows = roster.map((r, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="muted">${esc(r.nat)}</td><td>${chip(r)}</td><td class="muted">→${esc(r.derived)}</td><td class="num">${r.overall}</td><td class="num">${money(r.baseValue)}</td><td class="num">${r.abilities.climbing}</td><td class="num">${r.abilities.sprint}</td><td class="num">${r.abilities.time_trial}</td><td class="num">${r.abilities.punch}</td><td class="num">${r.abilities.cobblestone}</td><td class="num">${r.abilities.endurance}</td></tr>`).join("");

  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Race-engine cockpit</title>
<style>
:root{--bg:#0f1419;--panel:#1a2129;--line:#2a333d;--txt:#e6edf3;--muted:#8b98a5;--accent:#5cc8ff;--pass:#1f7a3f;--fail:#7a2a2a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 system-ui,Segoe UI,sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 8px}.wrap{max-width:1100px;margin:0 auto}
table{border-collapse:collapse;width:100%;background:var(--panel);border-radius:8px;overflow:hidden;margin:6px 0}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}
tr.pass td:last-child{color:#5fd38a;font-weight:700}tr.fail td:last-child{color:#ff8a8a;font-weight:700}
tr.pass{background:linear-gradient(90deg,rgba(31,122,63,.18),transparent)}tr.fail{background:linear-gradient(90deg,rgba(122,42,42,.18),transparent)}
details{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:6px 0}summary{cursor:pointer;padding:10px 14px;font-weight:600}
.stage-body{padding:0 14px 12px}.results th,.results td{padding:4px 8px}.jerseys{color:var(--muted);font-size:13px;margin:8px 2px 2px}
.terrain,.chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.chip{background:#2a333d;color:#cfd8e0}.terrain{background:#243b53;color:#9ecbff}
.chip.sprinter,.terrain.flat{background:#3a2a4d;color:#d6b3ff}.chip.climber,.chip.gc,.terrain.mountain,.terrain.high_mountain{background:#1f4030;color:#9ff0c0}
.chip.tt,.terrain.itt{background:#0e3a4d;color:#8fe3ff}.chip.brostensrytter,.terrain.cobbles{background:#4d3a1f;color:#f0d49f}
.chip.puncheur,.terrain.hilly{background:#4d2f1f;color:#ffc59f}.chip.baroudeur,.terrain.classic{background:#3a3a1f;color:#e8e89f}
.jcards{display:flex;gap:10px;flex-wrap:wrap}.jcard{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;flex:1;min-width:220px}.jt{color:var(--muted);font-size:12px;margin-bottom:2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:820px){.grid2{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>🚴 Race-engine kalibrerings-cockpit</h1>
<p class="sub">seed ${SEED} · ${POPULATION_MODE ? `population <b>${esc(POPULATION_PATH)}</b> (${field.length} ryttere)` : `${COUNT} ryttere · mix <b>${esc(MIX)}</b>`} · noise ${NOISE_SD_SCALE} · ${RACES} løb/terræn · in-memory (rører ikke prod)</p>
${POPULATION_MODE ? `<p class="sub">⚠ population-mode: "født-som" = "afledt" (prod-ryttere har ingen arketype) · B-scorecard/udbruds-bånd/roles-bånd/liveness er ALTID rapport-only her.</p>` : ""}

<h2>Mål-scorecard <span class="muted" style="font-weight:400">— født-som = ægte rytter-type · afledt = spillets label</span></h2>
<table><thead><tr><th>Terræn</th><th>Mål</th><th class="num">Født-som</th><th class="num">Afledt</th><th class="num">Mål%</th><th>Status</th></tr></thead><tbody>${scorecardRows}</tbody></table>

<h2>Belønner motoren den rigtige evne?</h2>
<p class="sub">Vinder ⌀ i terrænets nøgle-evne vs. felt-median. ⌀rang = vinderens overall-placering i feltet (1 = stærkest).</p>
<table><thead><tr><th>Terræn</th><th>Nøgle-evne</th><th class="num">Vinder ⌀</th><th>Vinder født-som (top3)</th><th>Vinder afledt (top3)</th><th class="num">⌀rang</th><th class="num">Distinkte</th></tr></thead><tbody>${terrainRows}</tbody></table>

<h2>Dominans/varians (#2224) <span class="muted" style="font-weight:400">— team-linse: ${esc(dominanceTeamLens)}</span></h2>
<div class="grid2">
  <div>
    <table><thead><tr><th>Metrik</th><th class="num">Målt</th><th class="num">Bånd</th><th>Status</th></tr></thead><tbody>${dominanceRowsHtml}</tbody></table>
    <p class="sub">Gini (sejre): ${seasonGini == null ? "n/a" : seasonGini.toFixed(3)} (rapport-only) · Jour-sans: ${V3_MODE ? `${jourSansRatePct.toFixed(2)}%` : "n/a (kræver --v3)"} · DNF-rate: ${V3_MODE && incidentStats.stages ? `⌀${incidentStats.meanDnfRatePct.toFixed(2)}%/etape` : "n/a (kræver --v3)"}</p>
    <p class="sub">GT (final-GC-top10): favorit vandt ${gtDominanceObservation.favoriteWon ? "ja" : "nej"} · podium ${gtDominanceObservation.favoritePodium ? "ja" : "nej"} · maxSameTeamTop10 ${gtDominanceObservation.maxSameTeamTop10} · distinctTeamsTop10 ${gtDominanceObservation.distinctTeamsTop10}</p>
  </div>
  <div>
    <h3 style="margin:4px 0">Sæson-win-rate-histogram <span class="muted" style="font-weight:400">(≥5 starter, ${seasonWinRateStats.riders} ryttere)</span></h3>
    <table><thead><tr><th>Interval</th><th></th><th class="num">Ryttere</th></tr></thead><tbody>${winRateHistRows}</tbody></table>
  </div>
</div>

<h2>Feltet</h2>
<p class="sub">${fieldSummary.n} ryttere · overall median ${fieldSummary.ov.median} (p90 ${fieldSummary.ov.p90}, max ${fieldSummary.ov.max}) · base_value median ${money(fieldSummary.bv.median)} (max ${money(fieldSummary.bv.max)})</p>
<p>${typeBar}</p>

<h2>Grand Tour — 21 etaper, ${GT_FIELD}-rytters felt</h2>
<div class="grid2">
  <div>
    <h3 style="margin:4px 0">🏆 Slutstilling (GC)</h3>
    <table class="results"><thead><tr><th>#</th><th>Rytter</th><th>Tid</th></tr></thead><tbody>${gcRows}</tbody></table>
  </div>
  <div>
    <h3 style="margin:4px 0">👕 Trøjer</h3>
    <div class="jcards" style="flex-direction:column">${finalJerseys}</div>
  </div>
</div>
<h3 style="margin:18px 0 4px">Etaper</h3>
${stageBlocks}

<h2>Grand Tour-startliste (${GT_FIELD} ryttere, sorteret efter overall)</h2>
<table><thead><tr><th>Rytter</th><th>Født-som</th><th>Afledt</th><th class="num">Ovr</th><th class="num">Speciale</th><th class="num">Værdi</th></tr></thead><tbody>${startlist}</tbody></table>

<h2>Hele populationen — ${field.length} ryttere <span class="muted" style="font-weight:400">(godkendelses-view, sorteret efter værdi)</span></h2>
<p class="sub">Dette er feltet motoren testes mod. Vurdér: er pyramiden troværdig (få superstjerner, mange domestiques)? Har hver type rigtige tal i sin signatur-evne? Mangler der nogen?</p>
<div style="max-height:620px;overflow:auto;border:1px solid var(--line);border-radius:8px">
<table style="margin:0"><thead><tr><th class="num">#</th><th>Rytter</th><th>Nat</th><th>Født-som</th><th>Afledt</th><th class="num">Ovr</th><th class="num">Værdi</th><th class="num">Klatr</th><th class="num">Sprint</th><th class="num">TT</th><th class="num">Punch</th><th class="num">Brost</th><th class="num">Udh</th></tr></thead><tbody>${rosterRows}</tbody></table>
</div>
</div></body></html>`;

  mkdirSync(dirname(HTML_PATH), { recursive: true });
  writeFileSync(HTML_PATH, html, "utf8");
  console.log(`\n📄 HTML-cockpit: ${HTML_PATH}`);
  console.log(`   Åbn i browser (dobbeltklik, eller: start "" "${HTML_PATH}")`);
}

console.log(`\n${"─".repeat(80)}`);
console.log(`Færdig. Read-only — intet skrevet til prod/DB. Exit-kontrakt: ${process.exitCode === 1 ? "❌ exit 1 (oracle-/bånd-brud)" : "✅ exit 0"}.\n`);
