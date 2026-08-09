// Youth-cohort-generator for akademi-MVP (#1308).
//
// Genererer 3-5 ungdomskandidater pr. kuld til et holds akademi. Genbruger
// fictionalRiderGenerator's PRNG/navne-logik — ingen duplikering. Ung-
// talent har lavere stats-mean (raw) + bred potentiale-spredning.

import {
  gaussian,
  STAT_KEYS,
  weightedPick,
  makeUniqueName,
  DEFAULT_NATIONALITY_WEIGHTS,
  ARCHETYPE_BY_TYPE,
} from "./fictionalRiderGenerator.js";
import { clusterForNationality } from "./fictionalRiderNames.js";
import { NAME_CLUSTERS } from "./fictionalRiderNames.js";
import { ACADEMY } from "./academyFlag.js";
import { drawArchetypePair } from "./archetypeDistribution.js";
import { RIDER_TYPES } from "./riderTypes.js";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// #2064 (ejer-valg 19/7): geometrisk potentiale-fordeling — hvert halve trin er
// POTENTIALE_DECAY gange så sandsynligt som det forrige. Bunden er enorm, toppen
// er lotteri (6.0 ≈ 0,11% ≈ "årtiets talent"; jf. FM-wonderkids/virkelige akademier).
// 'Seriøs' AFLEDES nu af trækket (pot ≥ 4.5) i stedet for at styre det.
export const POTENTIALE_TIERS = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
export const POTENTIALE_DECAY = 0.55;
const POTENTIALE_WEIGHTS = POTENTIALE_TIERS.map((_, k) => POTENTIALE_DECAY ** k);
const POTENTIALE_WEIGHT_SUM = POTENTIALE_WEIGHTS.reduce((a, b) => a + b, 0);

export function drawPotentiale(rng) {
  let roll = rng() * POTENTIALE_WEIGHT_SUM;
  for (let k = 0; k < POTENTIALE_WEIGHTS.length; k++) {
    roll -= POTENTIALE_WEIGHTS[k];
    if (roll <= 0) return POTENTIALE_TIERS[k];
  }
  return POTENTIALE_TIERS[POTENTIALE_TIERS.length - 1];
}

// Vælg et ungdoms-anlæg (#3458 fase 2: arketype-prior-først). Trækkes fra
// archetypeDistribution.js' mål-fordeling (formel afledt af MÅL-kalenderens
// K-B-profil + demand-mapping + scarcity-modifikatorer + gulv — IKKE en fast
// tabel her, se archetypeDistribution.js for kilden). ~15 % trækkes som en
// to-arketype-hybrid (drawArchetypePair) — det anlæg der senere skal give
// generateYouthStats nok SEPARATION til at klassifikatoren genfinder typen
// af sig selv (design-spec G1). Typen skrives ALDRIG direkte som rytterens
// type — kun `deriveForRiderIds`-kæden (physiology→abilities→caps→klassifikator)
// tildeler den endelige type; dette er blot en formnings-PRIOR for stats.
function pickYouthArchetype(rng) {
  return drawArchetypePair(rng);
}

/**
 * Generér et akademi-kuld af ungdomskandidater (rører ingen DB).
 *
 * @param {object}  opts
 * @param {function} opts.rng              seeded PRNG (fra makeRng)
 * @param {number}  opts.referenceYear     beregner alder/fødselsdato mod dette år
 * @param {Set<string>} opts.existingNames foldNameNordic-sæt af eksisterende navne (muteres)
 * @param {{ dominant_nationality?: string }} [opts.identityBasis]  nation-bias
 * @param {number|null} [opts.countOverride]         #2064 S0: overstyr antal (drip-kuld-størrelse)
 * @param {object} [opts.genCfg]  stat-genererings-config; default YOUTH_GEN_CONFIG.
 *   KUN til kalibrerings-harnesses (simArchetypeCalibration.js) — produktionsstien
 *   sender den ALDRIG, så en fejlkalibrering kan ikke snige sig ind via en call-site.
 * @returns {{ is_serious: boolean, rider: object }[]}
 */
export function generateAcademyCandidates({
  rng,
  referenceYear,
  existingNames,
  identityBasis = null,
  countOverride = null,
  genCfg = YOUTH_GEN_CONFIG,
}) {
  // ── Antal kandidater ─────────────────────────────────────────────────────────
  // #2064 S0: `??` sikrer at rng()-trækkene sker i NØJAGTIG samme rækkefølge som
  // før når countOverride er null (determinisme for eksisterende kaldere uændret).
  const count = countOverride ??
    (ACADEMY.INTAKE_MIN + Math.floor(rng() * (ACADEMY.INTAKE_MAX - ACADEMY.INTAKE_MIN + 1)));

  // ── Nationalitets-vægte (med evt. bias) ─────────────────────────────────────
  let natWeights = DEFAULT_NATIONALITY_WEIGHTS;
  if (identityBasis?.dominant_nationality) {
    const dom = identityBasis.dominant_nationality;
    natWeights = DEFAULT_NATIONALITY_WEIGHTS.map((entry) =>
      entry.value === dom ? { ...entry, weight: entry.weight * 3 } : entry
    );
    // Sørg for at dominant_nationality er i listen (fx lille nation med 0-base)
    if (!natWeights.some((e) => e.value === dom)) {
      natWeights = [...natWeights, { value: dom, weight: 30 }];
    }
  }

  // ── Byg hvert kandidat-objekt ────────────────────────────────────────────────
  const candidates = [];
  for (let i = 0; i < count; i++) {
    // Nationalitet
    const nationality_code = weightedPick(rng, natWeights);
    const clusterKey = clusterForNationality(nationality_code);
    const cluster = NAME_CLUSTERS[clusterKey];

    // Navn (dedupliceret mod existingNames — muterer sættet)
    const { firstname, lastname } = makeUniqueName(rng, cluster, existingNames);

    // Alder + fødselsdato
    const age = Math.round(
      clamp(gaussian(rng, 18, 1.6), ACADEMY.MIN_AGE, ACADEMY.MAX_AGE)
    );
    const birthdate = `${referenceYear - age}-06-15`;

    // Potentiale: geometrisk træk (0.5-trin, 1.0-6.0). 'Seriøs' = pot ≥ 4.5 (afledt).
    const potentiale = drawPotentiale(rng);
    const is_serious = potentiale >= 4.5;

    // Stats: lav, anlægs-formet, talent-skaleret ungdoms-profil (#1791). Anlæg vælges deterministisk
    // fra arketype-mål-fordelingen (#3458 fase 2, ~15% hybrid); de lave stats giver via
    // fallback-derivationen lave evner i ungdoms-båndet.
    const archetypeDraw = pickYouthArchetype(rng); // { primary, secondary, isHybrid }
    const { stats } = generateYouthStats({
      rng,
      age,
      potentiale,
      archetypeType: archetypeDraw.primary,
      secondaryArchetypeType: archetypeDraw.secondary,
      cfg: genCfg,
    });

    // Krop: spred højde/vægt så physiology-seedingen ikke defaulter alle til
    // 180cm/70kg (#1478). Neutralt WorldTour-range; weight afledt af plausibel BMI.
    const height = Math.round(clamp(gaussian(rng, 180, 5), 165, 196));
    const bmi = clamp(gaussian(rng, 21.5, 1.0), 18.5, 24.5);
    const weight = Math.round(bmi * (height / 100) ** 2);

    candidates.push({
      is_serious,
      // #3458 sim-harness/test-introspektion ALENE — IKKE en DB-kolonne. Aldrig
      // spredt ind i rider-insert-payloaden (academyIntake spreader kun `.rider`),
      // så arketype-trækket lækker aldrig til `riders`-tabellen: den ENDELIGE type
      // tildeles udelukkende af deriveForRiderIds-kæden (klassifikatoren skal selv
      // GENFINDE arketypen — se G1 i design-spec'en).
      archetypeDraw,
      rider: {
        firstname,
        lastname,
        birthdate,
        nationality_code,
        pcm_id: null,
        is_academy: false,
        team_id: null,
        potentiale,
        height,
        weight,
        ...stats,
      },
    });
  }

  return candidates;
}

export const YOUTH_GEN_CONFIG = Object.freeze({
  // Pot-1 anker-niveau ved 16. SÆNKET 3 rå point 2026-07-19 (ejer-valg "−3", #2064 S0):
  // det gamle bånd 51.5-57 gav 16-17-årige med afledt bedste anlæg ~14-21 = på niveau
  // med median-SENIOREN (best 21) fra dag ét ("vinder fra start"-problemet). Nyt bånd
  // ankrer 16-årige på afledt kerne ~3 / bedste ~6 og graduerings-alder (20-21) på ~12
  // — lige under senior-medianen. Loft/peak (loftByPotential, peak 27-28) er URØRT:
  // kun rampen flytter. Empirisk verifikation: docs/superpowers/specs/
  // 2026-07-19-2064-soendags-aargangsmodel-influx-design.md §2a.
  baseStatAt16: 47.5,
  // Stat-løft pr. potentiale-trin over 1 → talent-TENDENS i starten (ikke 1:1 aflæseligt pga. startLuck).
  potStartLift: 0.5,
  // Per-rytter "start-held": ÉT seeded gaussian-træk der løfter/sænker HELE profilen, så
  // potentiale-tiers overlapper. Store talenter kan være langsomme startere; små kan starte lidt over middel.
  //
  // 1,2 → 0,6 den 2026-08-09 (ejer-valg, #3561). #2064 §2a's medianer var overholdt
  // (16-17 lå på kerne 1 / bedste 4 mod aftalens 3/6 — altså UNDER), men HALEN var det
  // ikke: 7,1 % af alle 16-17-årige blev født med bedste anlæg 12, hvilket er præcis
  // det niveau §2a sætter for 20-21-årige VED GRADUERING. To tredjedele af dem
  // (102 af 154) havde potentiale ≤ 2 — altså ikke talenter, bare held i trækket.
  // De sprang dermed fem års udvikling over.
  //
  // Årsagen er skalaen: hele ungdomsbåndet er 4 rå point bredt (50-54 ⇒ evne 1-12), så
  // et startheld med spredning 1,2 rækker fra bunden til toppen af båndet. §2a's
  // hensigt ("små kan starte LIDT over middel") kræver at spredningen er lille i
  // forhold til båndet. 0,6 halverer andelen på graduerings-niveau til 3,7 % uden at
  // flytte medianen og uden at svække talent-signalet (pot-1 median 4 vs pot-6 7,
  // uændret). Mål før du ændrer: scripts/dev/fitYouthStartLuck3561.mjs +
  // scripts/dev/checkYouthBand2064.mjs (sidstnævnte verificerer mod §2a-tabellen).
  startLuckSd: 0.6,
  // Alders-skalering ("spol kurven frem" til faktisk alder).
  statPerYearOver16: 1.4,
  // #3458 fase 2 — empirisk tunet mod G1-G4 via simArchetypeGeneration3458.js (se
  // PR-scorecard for det endelige tal). Tre fund undervejs, i rækkefølge (holdt
  // som kalibrerings-historik — næste tuning-runde starter her, ikke fra bunden):
  //
  //  1) Ved den GAMLE (fase-1) 0.20-skala (klemt ind under det uændrede
  //     statCeil=54) genfandt klassifikatoren KUN 21,5% af de trukne arketyper:
  //     den fysiske signatur-evne kunne aldrig overstige ~12 (pcmFrac-loftet ved
  //     PCM 54), mens `aggression`s ALDERS-drevne gulv (abilityDerivation.js's
  //     youth-komponent — uafhængig af stat_ftr) giver ALLE 16-21-årige ~16-25 i
  //     aggression uanset arketype. Under NEUTRAL_BASELINE-bootstrap OG under den
  //     endelige typesBaseline-klassifikation (fittet på VOKSEN-caps: aggression
  //     har markant lavere mean/std end de fysiske evner) vinder baroudeur derfor
  //     næsten altid medmindre signatur-evnen presses langt over sit gamle loft.
  //  2) Et FLADT, ensartet tillæg pr. signatur-nøgle (statCeilBoosted hævet,
  //     magnitude ens for alle boostede stats) rettede baroudeur-kollapset, men
  //     gav stadig skæv separation MELLEM typer der DELER evner — fx puncheur
  //     (punch:3, tempo:2) "stjal" climber-kandidater (climbing:3, tempo:2,
  //     punch:1, endurance:1), fordi climber's eget boost-mønster (fra den DELTE
  //     ARCHETYPE_BY_TYPE, fictionalRiderGenerator.js — RØRES IKKE her) pressede
  //     tempo/punch lige så højt som climbing selv, og puncheur fik samtidig en
  //     gratis bonus fra climber's (lave, ikke-boostede) time_trial.
  //  3) LØSNINGEN (signatureProfile ovenfor): boost/damp-magnitude er nu
  //     PROPORTIONAL med klassifikatorens EGEN vægt (RIDER_TYPES, riderTypes.js —
  //     importeret READ-ONLY) i stedet for et gæt eller et fladt tal. Den evne
  //     der ADSKILLER en type fra dens nærmeste konkurrent (climbing for climber,
  //     vægt 3, IKKE delt med puncheur) får dermed automatisk et større løft end
  //     en DELT evne (tempo/punch, vægt 1-2) — separationen matcher PRÆCIS det
  //     klassifikatoren selv belønner.
  //
  //  4) SÆNKET 15 → 2 den 2026-08-09 (#3561-regressionen). Punkt 1-3 ovenfor tunede
  //     ALENE mod G1-G4 — ingen af de fire gates måler ABSOLUTTE niveauer. Med
  //     boost 15 × klassifikator-vægt op til 3 blev signatur-stats løftet +45 rå
  //     point oven på en base på ~48-51 og clampet ved statCeilBoosted=99, dvs.
  //     mættet. Prod-følgen 9/8: 374 akademi-kandidater med afledt bedste evne 90
  //     i snit (senior-snit 20, spillets 50 dyreste 80) og markedsværdi op til
  //     42 mio. Rod-årsagen er at buildCapsForRider gør caps = max(potentiale-loft,
  //     current): en mættet start-stat OVERSKRIVER hele potentiale-semantikken, så
  //     en pot-1,0-rytter (loft 35) fik caps 99. Se scripts/simArchetypeCalibration3458.js
  //     for sweepet der måler dette (G5/G6) — og BRUG den før du rører tallene igen.
  //
  //  5) 2 → 0,8 den 2026-08-09, EFTER måling mod prod. Punkt 4 sænkede kun loftet og
  //     ramte dermed niveauet nogenlunde, men lod boostet stå 2,5× over det system der
  //     faktisk virkede: den gamle formel gav climber stat_bj 12 × 0,20 = +2,4 rå point,
  //     mens boost 2 × klassifikator-vægt 3 gav +6. Følgen var alt for firkantede
  //     16-årige — specialiserings-gab 3,9 hvor de virkende kuld lå på 1,25.
  //     0,8 × vægt 3 = +2,4 reproducerer den gamle magnitude PRÆCIST, men med fase 2's
  //     bedre proportionalitet (vægt 3 > 2 > 1 i stedet for den gamle tabels løse tal).
  //     Målt mod de 384 prod-kandidater fra 19/7-6/8 der aldrig fik et hold (= rene
  //     start-værdier): afvigelse 0,12 mod 0,475 for boost 2. Se scripts/dev/
  //     fitYouthCalibration3561.mjs — KØR DEN før du rører tallet igen.
  signatureBoostPerWeight: 0.8,
  // KUN de boostede signatur-stats clampes til dette loft — neutrale/dæmpede stats
  // forbliver i det lave −3-bånd (statCeil).
  //
  // SAT LIG statCeil (99 → 54) den 2026-08-09. INVARIANTEN der skal holdes: en
  // ungdomsrytters NUVÆRENDE evne må aldrig løfte ability_caps over det loft hans
  // potentiale tillader (pot 1 → 35). pcmFrac ankrer PCM 50→evne 1 og 85→evne 99,
  // så rå stat 54 ⇒ afledt evne 12 — præcis #2064's ejer-godkendte anker ("afledt
  // top mætter ~12"). Ethvert loft herover lader current bryde igennem potentiale-
  // loftet for de laveste potentialer. Målt: ceil 54 → G5 (potentiale-loft
  // respekteret) 100 %; ceil 60 → 95-99 %; ceil 99 → 0,2 %.
  //
  // Boostet former derfor INDEN FOR båndet: vægt-3-evner rammer loftet, vægt-1-evner
  // lander ~2 point lavere. Det er den separation ungdomsbåndet tillader.
  statCeilBoosted: 54,
  // Modsatte stats trækkes ned proportionalt med |vægt| (samme princip som
  // signatureBoostPerWeight ovenfor — fx tt's climbing:-2-straf dæmpes hårdere
  // end en almindelig -1-straf).
  //
  // 2,6 → 1,0 den 2026-08-09 (#3561), samme måling som signatureBoostPerWeight: den
  // gamle formel dæmpede fladt med −1, så 1,0 pr. vægtenhed rammer vægt-1-straffen
  // præcist og bevarer proportionaliteten for vægt-2-straffe. 2,6 pressede modsat-evner
  // helt i bund og var halvdelen af den for firkantede profil.
  dampPerWeight: 1.0,
  // Hårde grænser (−3-bånd): gulv → afledt bund ~1-3; loft → afledt top mætter ~12
  // (for IKKE-boostede stats — se statCeilBoosted for signatur-stats' loft).
  sd: 0.8,
  statFloor: 48.5,
  statCeil: 54,
  // #3570 fase 2: FLYTTET hertil (var modul-konstanter GC_TIME_TRIAL_BOOST_RATIO/
  // GC_CLIMBING_BOOST_RATIO) så scorecard-varianter kan sweepe dem uden at
  // duplikere signatureProfile-logikken — se signatureProfile nedenfor for hvorfor
  // gc's to top-vægtede evner historisk blev dæmpet (#3458: undgå at mætte
  // tt-aksen identisk med en ren tidskører i G3/scoutingReport-normaliseringen).
  //
  // GENMÅLT under den NYE caps-kæde (archetype_draw former caps DIREKTE via
  // buildCapsForRider, #3570 fase 2) mod tre varianter — 0.55/0.85 (den gamle
  // værdi), 0.8/0.9, 1.0/1.0, OG kontrol-ekstremerne 0/0 og 0.1/2.0 (se
  // backend/scripts/dev/gcFunnel3570.mjs --gcTt=X --gcClimb=Y, n=3000):
  // ALLE FEM gav BIT-IDENTISK udfald (260/303 = 85,8 % af de trukne gc-anlæg
  // endte gc, hele kuldets fordeling uændret til sidste ryttter). Årsag: caps =
  // max(absolut_loft(potentiale, anlæg), current) i buildCapsForRider — det
  // absolutte loft (som denne ratio IKKE rører; det kommer fra RIDER_TYPES'
  // vægt-FORTEGN via youthRoleFactor, ikke fra generatorens boost-MAGNITUDE)
  // dominerer for stort set alle potentiale-niveauer, fordi ungdomsbåndets
  // afledte current-evner (statCeilBoosted=54 ⇒ afledt ~12) er langt under det
  // absolutte loft. Ratioen former derfor kun de synlige RÅ current-stats en
  // frisk 16-21-årig starter med (en ren display-nuance), IKKE klassifikationen
  // eller livstidsloftet — modsat før fase 2, hvor bootstrap-typen (afledt af
  // NETOP disse current-stats) satte rolle-faktoren for caps.
  //
  // KONKLUSION: ingen af de tre kandidat-varianter forbedrer eller forværrer
  // G1/gc-genfinding — værdien er derfor BEVIDST UÆNDRET (0.55/0.85). At ændre
  // den ville være en tuning uden empirisk gevinst (og ville svække #3458's
  // stadig-gældende G3-display-begrundelse ovenfor uden grund).
  gcTimeTrialBoostRatio: 0.55,
  gcClimbingBoostRatio: 0.85,
});

// #3458 fase 2: signatur-profil pr. arketype, afledt af KLASSIFIKATORENS EGNE
// vægte (riderTypes.js RIDER_TYPES — importeret READ-ONLY, ALDRIG muteret her)
// i stedet for fictionalRiderGenerator.js' ARCHETYPE_BY_TYPE (den tabel er delt
// med PR2's voksen-sti og kalibreret til værdi-pyramiden, IKKE til akademi-
// klassifikation — se YOUTH_GEN_CONFIG-kommentaren for hvorfor et flat/ensartet
// boost pr. type-fra-den-tabel gav skæv separation, fx puncheur der "stjal"
// climber-kandidater via delte punch/tempo-evner).
//
// Ved at bruge RIDER_TYPES' EGNE vægte direkte får den evne der ADSKILLER en
// type fra dens nærmeste konkurrent (fx climber's climbing, vægt 3 — IKKE delt
// med puncheur) et proportionalt STØRRE løft end en delt evne (tempo/punch,
// vægt 1-2, delt med puncheur/gc) — separationen matcher dermed PRÆCIS det
// klassifikatoren selv vægter, i stedet for et gæt.
const ABILITY_TO_STAT = Object.freeze({
  climbing: "stat_bj", time_trial: "stat_tt", flat: "stat_fl", tempo: "stat_kb",
  sprint: "stat_sp", acceleration: "stat_acc", punch: "stat_bk", endurance: "stat_udh",
  recovery: "stat_res", durability: "stat_mod", descending: "stat_ned",
  cobblestone: "stat_bro", aggression: "stat_ftr",
});

const RIDER_TYPE_WEIGHTS_BY_KEY = Object.freeze(
  Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights])),
);

// #3458: gc er det ENESTE anlæg hvis to TOP-vægtede evner (climbing OG
// time_trial, begge vægt 3) er en RIVAL-typs HELE signatur på egen hånd (tt =
// { time_trial: 3 } alene). Et symmetrisk climbing=time_trial-boost mætter
// derfor time_trial lige så højt som en REN tt-profil (ability 99 for begge),
// hvilket vinder "som-var-han-tt"-normaliseringen (G3, scoutingReport.js'
// blendedOutput — en ANDEN formel end riderTypes.js' kontrast, urørt her) fra
// gc næsten hver gang (målt via simArchetypeGeneration3458.js: gc alene stod
// for ~90% af ALLE G3-mismatches). Modvirkes HER (akademi-genereringen alene —
// hverken riderTypes.js' vægte røres): gc's time_trial/climbing-signatur
// dæmpes af cfg.gcTimeTrialBoostRatio/gcClimbingBoostRatio (YOUTH_GEN_CONFIG,
// #3570 fase 2 — flyttet fra modul-konstanter til cfg så scorecard-varianter
// kan sweepe forholdet uden at duplikere denne funktion; se YOUTH_GEN_CONFIG's
// kommentar for den GENMÅLTE værdi under den nye caps-kæde).

// { boost: { stat_key: vægt (>0) }, damp: { stat_key: |vægt| (fra <0) } } for ÉN arketype.
function signatureProfile(archetypeKey, cfg) {
  const weights = RIDER_TYPE_WEIGHTS_BY_KEY[archetypeKey];
  if (!weights) throw new Error(`signatureProfile: ukendt arketype ${archetypeKey}`);
  const boost = {};
  const damp = {};
  for (const [ability, w] of Object.entries(weights)) {
    const statKey = ABILITY_TO_STAT[ability];
    if (!statKey) continue; // evner uden en PCM-kilde (ingen i dag) — spring over
    if (w > 0) boost[statKey] = w;
    else if (w < 0) damp[statKey] = -w;
  }
  if (archetypeKey === "gc") {
    boost[ABILITY_TO_STAT.time_trial] *= cfg.gcTimeTrialBoostRatio;
    boost[ABILITY_TO_STAT.climbing] *= cfg.gcClimbingBoostRatio;
  }
  return { boost, damp };
}

// Bland to arketypers signatur til ÉN syntetisk profil til en hybrid-rytter.
// boost = gennemsnit af de to vægte (union af nøgler, manglende = 0) — begge
// anlæg bidrager, ingen forsvinder. damp = KUN de FÆLLES svagheder (snit, ikke
// union) — en hybrid skal ikke dæmpes på en evne der er den ENE arketypes
// signatur (fx en climber+puncheur-hybrid må ikke dæmpe punch).
function blendArchetypeSignature(primaryKey, secondaryKey, cfg) {
  const a = signatureProfile(primaryKey, cfg);
  const b = signatureProfile(secondaryKey, cfg);
  const boost = {};
  for (const key of new Set([...Object.keys(a.boost), ...Object.keys(b.boost)])) {
    boost[key] = ((a.boost[key] ?? 0) + (b.boost[key] ?? 0)) / 2;
  }
  const damp = {};
  for (const key of Object.keys(a.damp)) {
    if (key in b.damp) damp[key] = (a.damp[key] + b.damp[key]) / 2;
  }
  return { boost, damp };
}

// Generér lave, anlægs-formede, alders- OG talent-skalerede stats for én ung, med per-rytter start-held.
// secondaryArchetypeType (#3458, ~15% af kuldet): trækker en to-arketype-hybrid-profil
// (blandet signatur, se blendArchetypeSignature) i stedet for et rent anlæg.
export function generateYouthStats({ rng, age, potentiale, archetypeType, secondaryArchetypeType = null, cfg = YOUTH_GEN_CONFIG }) {
  if (!ARCHETYPE_BY_TYPE[archetypeType]) throw new Error(`generateYouthStats: ukendt arketype ${archetypeType}`);
  const arch = secondaryArchetypeType
    ? blendArchetypeSignature(archetypeType, secondaryArchetypeType, cfg)
    : signatureProfile(archetypeType, cfg);
  const ageLift = Math.max(0, (Number(age) || 16) - 16) * cfg.statPerYearOver16;
  const potLift = (clamp(Number(potentiale) || 1, 1, 6) - 1) * cfg.potStartLift;
  const startLuck = gaussian(rng, 0, cfg.startLuckSd); // ÉT træk pr. rytter (coherent profil-shift) — BLØDGØR talent-tendensen
  const base = cfg.baseStatAt16 + ageLift + potLift + startLuck;
  const stats = {};
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, base, cfg.sd);
    let ceil = cfg.statCeil;
    if (arch.boost[key]) {
      // Proportionalt med klassifikator-vægten (se signatureProfile ovenfor):
      // en vægt-3-evne (fx climber's climbing) får et STØRRE løft end en
      // vægt-1-evne DEN TYPE deler med en konkurrent (fx climber's punch, delt
      // med puncheur) — separationen matcher dermed klassifikatorens egen
      // kontrast-formel i stedet for et gæt.
      v += arch.boost[key] * cfg.signatureBoostPerWeight;
      ceil = cfg.statCeilBoosted; // kun signatur-stats får det højere loft
    } else if (arch.damp[key]) {
      v -= arch.damp[key] * cfg.dampPerWeight;
    }
    stats[key] = Math.round(clamp(v, cfg.statFloor, ceil));
  }
  return { stats, archetypeType, secondaryArchetypeType };
}
