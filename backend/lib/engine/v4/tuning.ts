// backend/lib/engine/v4/tuning.ts
// Race Engine v4 F2 (#4030): EngineTuning-default.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §4-5.
//
// Alle konstanter er START-KANDIDATER (samme forbehold som raceNarrative.js's
// Tier 1-taerskler / raceRoles.js's RACE_V3_TUNING): kalibreres i head-to-head-
// harnesset (23-24/8) mod §5's virkeligheds-ankre, ikke gaettet endeligt her.
// Hver konstant har ÉN kommentarlinje (byggeplan §8, Fase A-krav).
//
// REN — ingen import fra oevrigt backend. Overridable i harness/tests via
// spread (`{ ...RACE_V4_TUNING, selection: { ...RACE_V4_TUNING.selection, ... } }`).

import type { EffortLevel, EngineTuning, ProfileType, SegmentKind } from "./types.ts";

// Generisk dyb-freeze: RACE_V3_TUNING's moenster (Object.freeze) er fladt fordi
// den er en flad tuning-flade; v4's tuning har nestede grupper (§4-5's kategorier)
// og skal vaere reelt immutable hele vejen ned, ikke kun paa top-niveau.
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const tuning: EngineTuning = {
  physiology: {
    cpWeights: {
      tempo: 0.45, // vaegt paa tempo-evnen i CP-tærsklen (§5-formlen, /99-normaliseret)
      endurance: 0.35, // vaegt paa endurance-evnen i CP-tærsklen
      climbSpec: 0.2, // vaegt paa climbing-evnen, kun paa climb-segmenter (isClimb-gate)
      tt: 0.2, // vaegt paa time_trial-evnen, kun paa flade segmenter (isFlat-gate)
    },
    wprimeWeights: {
      punch: 0.4, // vaegt paa punch-evnen i anaerob reserve (wprimeMax)
      accel: 0.3, // vaegt paa acceleration-evnen i wprimeMax
      sprint: 0.3, // vaegt paa sprint-evnen i wprimeMax
    },
    rechargeRateBase: 0.0006, // basis-genopladningsrate af W' pr. sekund under CP (eksponentiel, §5)
    recoveryFloorFraction: 0.5, // gulv i "0.5 + 0.5·A.recovery/99"-formlen (§5)
  },

  dayform: {
    sd: 0.018, // gaussian sd for dagsform-komponenten (samme anker som RACE_V3_TUNING.DAYFORM_SD)
    jourSansPBase: 0.03, // p(jour sans) ved neutral dagsform (samme anker som v3 JOUR_SANS_P_BASE)
    jourSansFormLow: 40, // form <= denne => hoejeste jour-sans-sandsynlighed
    jourSansFormHigh: 70, // form >= denne => laveste jour-sans-sandsynlighed
    jourSansPMultLowform: 5 / 3, // multiplikator paa base ved form <= formLow (v3-anker)
    jourSansPMultHighform: 2 / 3, // multiplikator paa base ved form >= formHigh (v3-anker)
    jourSansMagnitudeMin: 0.05, // mindste kollaps-magnitude, normaliseret CP-reduktion
    jourSansMagnitudeMax: 0.1, // stoerste kollaps-magnitude, normaliseret CP-reduktion
  },

  work: {
    frontWorkFactor: {
      flat: 1.0, // front-rytterens work-cost-multiplikator paa flat (baseline, ingen bonus/straf)
      rolling: 1.0, // front-rytterens work-cost-multiplikator paa rolling
      climb: 1.0, // front-rytterens work-cost-multiplikator paa climb
      descent: 1.0, // front-rytterens work-cost-multiplikator paa descent
      cobbles: 1.0, // front-rytterens work-cost-multiplikator paa cobbles
    },
    draftFactor: {
      flat: 0.55, // hjul-rabat paa flat (hoej rabat, §4 punkt 1)
      rolling: 0.6, // hjul-rabat paa rolling (hoej rabat)
      climb: 0.9, // hjul-rabat paa climb (lav rabat — laesaerodynamik betyder mindre op ad bakke)
      descent: 0.75, // hjul-rabat paa descent (mellem rabat)
      cobbles: 0.85, // hjul-rabat paa cobbles (lav-mellem — ujaevnt terraen reducerer laesgevinst)
    },
    frontFraction: 0.2, // andel af gruppen (stærkeste cp foerst) der regnes for "front" i work-cost-fordelingen
  },

  terrain: {
    baseDemand: {
      flat: 0.55, // normaliseret CP-demand en gruppe typisk holder paa flat
      rolling: 0.6, // normaliseret CP-demand paa rolling
      climb: 0.8, // normaliseret CP-demand paa climb (hoejere — selektions-drivende)
      descent: 0.3, // normaliseret CP-demand paa descent (lav — frit fald, lidt pedalering)
      cobbles: 0.65, // normaliseret CP-demand paa cobbles
    },
    baseSpeedKmh: {
      flat: 42, // intern illustrativ basishastighed, flat (km/t — fog-gates aldrig timeline-params)
      rolling: 36, // intern illustrativ basishastighed, rolling
      climb: 18, // intern illustrativ basishastighed, climb
      descent: 55, // intern illustrativ basishastighed, descent
      cobbles: 32, // intern illustrativ basishastighed, cobbles
    },
    // #4604: kalibreret 2/9 fra 0,25 mod #2415's ejer-godkendte bjerg-top-10-baand
    // (180-240 s) paa hele S3-kalenderen, 180-rytters felt — praecis den kalibrering
    // filens header lovede ("START-KANDIDATER ... kalibreres i head-to-head-harnesset").
    // Denne konstant styrer hvor meget tempo-drift der akkumulerer MELLEM grupper
    // efter selektionen, og var den dominerende gap-kilde: 85 % (488 af 574 s) af
    // 10.-plads-gappet paa bjergetaper var drift EFTER selektionen, ikke selve
    // selektionen — gaps voksede endda paa flade run-in-kilometre.
    // Kalibreret OVEN PAA #4606 (W'-tidskonstant + gruppe-lae-fart-gevinst).
    // Ét seed svinger betydeligt (#4606's fund), saa kalibreringen er koert over
    // 5 seeds x 426 etaper. Middel (spaend) af bjerg-top-10-spredningen:
    //   0,12 -> 211 s (177-237) · 0,13 -> 230 s (193-258) · 0,25 -> 447 s (418-486)
    // 0,12 rammer baandets midte med den mindste afvigelse paa tvaers af seeds
    // (ét seed 3 s under 180; 0,13 laegger til gengaeld to seeds ~15 s over 240).
    strengthSpeedGain: 0.12, // skalering af hastigheds-multiplikator pr. enhed kollektiv-CP over/under baseDemand
    speedMultiplierBounds: [0.7, 1.3], // clamp paa hastigheds-multiplikatoren (undgaar urealistiske yderpunkter)
  },

  groups: {
    mergeThresholdSeconds: 2, // gap (sekunder) under hvilket to grupper smelter sammen
    gapUpdateThresholdSeconds: 1, // min. gap-delta (sekunder) foer et gap_update-event emitteres
  },

  selection: {
    deficitWeight: 1.0, // vaegt paa testet-evne-underskuddet i selektions-scoren (§4 punkt 3)
    energyDeficitWeight: 1.0, // vaegt paa W'-underskuddet i selektions-scoren
    noiseSdBase: 0.15, // stoej-sd som andel af |deficit| (§4: "skalerer magnitude, aldrig fortegn")
    splitThreshold: 0.12, // selektions-score-taerskel der udloeser peloton_splits
  },

  descent: {
    attackWindowSeconds: [10, 20], // descent attack-gevinst-loft, sekunder (mor-spec §4 M3, ejer-valg)
    minTechnicalityForAttack: 2, // kun T2-T3-segmenter kan udloese descent attack
    minAbilityGapForAttack: 15, // minimum descending-evne-forskel (0-99-skala) for at angribe
    incidentRiskBase: 0.01, // basis-styrt-risiko pr. descent-segment ved angreb (seeded)
    // UBRUGT i formlen efter #4905 (6/9): feltet staar i den frosne DescentTuning-
    // kontrakt (types.ts, arkitekt-only) og kan ikke fjernes uden at røre den fil.
    // Den subtraktive form (base - dampening*ability) kunne naa PRAECIS 0 ved
    // enhver descending >= ~67 (0.01 / 0.00015 ≈ 66,7) — netop de bedste
    // nedkoerere, som `findAttackers` altid vaelger som angribere. Nedkoersels-
    // uheld blev derfor statistisk usynlige, ogsaa i regn (issue-maaling: 40
    // loeb x 120 angreb = 0 uheld). Formlen i mechanics/descent.ts bruger nu
    // multiplikativ daempning MED GULV fra DESCENT_EXTRA_TUNING i stedet (samme
    // "additiv tuning uden om den frosne kontrakt"-moenster som #4604's
    // regrupperings-lag laengere nede i denne fil).
    incidentRiskDescendingDampening: 0.00015, // risiko-reduktion pr. descending-evne-point (LEGACY, ubrugt — se kommentar ovenfor)
  },

  finale: {
    demandVectorByFinaleType: {
      bunch_sprint: { sprint: 0.5, acceleration: 0.2, positioning: 0.2, flat: 0.1 },
      reduced_sprint: { sprint: 0.35, acceleration: 0.2, punch: 0.15, positioning: 0.15, endurance: 0.15 },
      punch: { punch: 0.45, acceleration: 0.25, climbing: 0.15, tactics: 0.15 },
      breakaway: { aggression: 0.3, tempo: 0.25, endurance: 0.25, tactics: 0.2 },
      descent: { descending: 0.5, positioning: 0.2, aggression: 0.15, tactics: 0.15 },
      long_climb: { climbing: 0.55, endurance: 0.3, tempo: 0.15 },
      solo_tt: { time_trial: 0.6, tempo: 0.25, endurance: 0.15 },
    }, // pr. finale-type placerings-demand (M4, §4 punkt "punch-tungt ved finale_type: 'punch'")
  },

  bonusSeconds: {
    finishSeconds: [10, 6, 4], // maal-bonus 1./2./3. plads (M9, §4 punkt 12/#2413)
    intermediateSeconds: [3, 2, 1], // indlagt spurt-bonus 1./2./3. plads
  },
};

/** EngineTuning-default (deep-frosset). Override via spread i harness/tests. */
export const RACE_V4_TUNING: EngineTuning = deepFreeze(tuning);

// ── M4 (finale.ts, Fase B3, #4030) — ADDITIVE finale-tuning ───────────────────
// SS2's frosne FinaleTuning-kontrakt (types.ts) rummer kun demandVectorByFinaleType.
// Disse ekstra konstanter er en BEVIDST SEPARAT eksport (ikke en del af
// EngineTuning-typen, som er frosset og kun aendres af arkitekten) — finale.ts
// importerer denne direkte i stedet for at laese den via ctx.tuning.finale.
// Fysisk placeret her ("tuning.ts's finale-sektion") saa alle finale-konstanter
// samles ét sted, jf. byggeplanens B3-scope ("additive felter i tuning.ts's
// finale-sektion") uden at braekke den frosne kontrakt.
const finaleExtra = {
  chaseClosingSecondsPerKmPerUnit: 40, // sekunder/km lukket pr. enheds netto jagt-fordel (chasePower-leadDefend + wprimeWeight*reserveDiff)
  chaseWprimeWeight: 0.5, // vaegt paa W'-reserve-differencen (jager vs. flygter) i lukkehastigheden
  wprimeReserveWeight: 0.15, // vaegt paa egen W'-reserve i finale-placerings-scoren (#3965: reserve skal taelle for forspringsryttere)
  placementGapMarginSeconds: 0.4, // margin OVER tuning.groups.mergeThresholdSeconds pr. placerings-tier (saa reelle splits ikke folder sammen igen i segmentLoop's efterfoelgende mergeGroups-kald)
  placementGapScoreScale: 3, // skalerer score-differencen mellem to naboplacerings-tiers til ekstra sekunder ud over margin+jitter
  placementGapJitterMaxSeconds: 0.3, // uniform jitter [0, max) paa tier-gap'et — paavirker KUN stoerrelsen, aldrig raekkefolgen (rank-guard-moenstret, designdoc §4)
  placementFullResolutionCount: 20, // kun de N bedst placerede kontendere faar individuelle tiers; resten bunches i én samlet haleklump-gruppe
};

/** M4 additiv finale-tuning (deep-frosset). Se finaleExtra-kommentaren ovenfor. */
export const FINALE_EXTRA_TUNING = deepFreeze(finaleExtra);

// ── M1 (segmentLoop.ts, #4604) — ADDITIV gruppe-lae-tuning ────────────────────
// Samme "bevidst separat eksport"-moenster som finaleExtra ovenfor: SS2's
// frosne EngineTuning-kontrakt (types.ts, arkitekt-only) har ingen noegle for
// dette, saa segmentLoop.ts importerer konstanten direkte.
//
// HVORFOR (maalt 2/9, #4604): gruppe-hastigheden blev udelukkende afledt af
// gruppens staerkeste ryttere (computeGroupTempo's kollektive CP) UDEN noget
// stoerrelses-led. En enkelt elite-rytter fik derfor hoejere kollektiv CP end
// en 180-mands peloton — og dermed hoejere fart — saa ethvert solo-udbrud
// voksede monotont resten af etapen. Maalt paa S3-kalenderen ankom 83 % af de
// flade etaper til finalen med en front-pulje paa ÉN rytter, og massespurten
// blev derfor afgjort af en solo-rytter i stedet for af sprinterne.
// tuning.work.draftFactor modellerede allerede laeen paa OMKOSTNINGS-siden
// (W'-forbrug); dette er den manglende halvdel paa FART-siden.
//
// Terraen-vaegten genbruges bevidst fra draftFactor (1 - draftFactor) i stedet
// for en ny per-terraen-tabel: laegevinsten er stor hvor hjul-rabatten er stor
// (flad) og lille hvor den er lille (klatring). Ét sted at kalibrere, ikke to.
const groupDraftExtra = {
  maxSpeedGain: 0.12, // loft paa den relative fart-gevinst en fuldt bemandet gruppe faar over en solo-rytter med samme kollektive CP, FOER terraen-vaegtning
  referenceSize: 60, // gruppe-stoerrelse hvor stoerrelses-faktoren naar 1 (logaritmisk aftagende marginalnytte derunder; stoerre grupper clampes til 1)
};

/** M1 additiv gruppe-lae-tuning (deep-frosset). Se groupDraftExtra-kommentaren ovenfor. */
export const GROUP_DRAFT_EXTRA_TUNING = deepFreeze(groupDraftExtra);

// ── M13 (mechanics/teamTimeTrial.ts, #4030) — ADDITIV TTT-tuning ──────────────
// Samme moenster som finaleExtra ovenfor: TTT er IKKE en del af SS2's frosne
// EngineTuning-kontrakt (types.ts, arkitekt-only), saa dens haandtag lever
// separat her. mechanics/teamTimeTrial.ts importerer denne direkte.
const tttExtra = {
  countbackRiderRank: 5, // "k'te rytters passage" (#2412-skitsen: "4. eller 5. rytter") saetter holdets officielle tid; clampes til min(rank, holdets startantal) pr. hold
};

/** M13 additiv TTT-tuning (deep-frosset). Se tttExtra-kommentaren ovenfor. */
export const TTT_EXTRA_TUNING = deepFreeze(tttExtra);

// ── M6 (mechanics/leadout.ts, #4030) — ADDITIV leadout-tuning ─────────────────
// Samme begrundelse som finaleExtra ovenfor: M6 er en F3-mekanik der bygger
// oven paa den frosne EngineTuning-kontrakt uden at aendre den. leadout.ts
// importerer denne direkte (samme moenster som finale.ts <- FINALE_EXTRA_TUNING).
const leadoutExtra = {
  maxScoreBonus: 0.12, // haardt loft paa finale-placerings-score-bonussen (samme skala som finale.ts's wprimeReserveWeight=0.15 — bounded, aldrig deterministisk sejr, mor-spec §4 M6)
  fullTrainSize: 3, // antal leadout-ryttere i kontendentpuljen der giver fuld stoerrelses-multiplikator (aftagende marginalnytte derover, jf. trainSizeFactor)
};

/** M6 additiv leadout-tuning (deep-frosset). Se leadoutExtra-kommentaren ovenfor. */
export const LEADOUT_EXTRA_TUNING = deepFreeze(leadoutExtra);

// ── M9 (mechanics/bonusSeconds.ts, #4030) — ADDITIV bonussekunder-tuning ──────
// tuning.ts's frosne `EngineTuning.bonusSeconds` (types.ts) baerer allerede
// finishSeconds/intermediateSeconds-baandene (10/6/4 + 3/2/1, F2-placeholder
// for M9 der da endnu ikke var bygget). Disse EKSTRA konstanter er de
// haandtag M9 selv har brug for og som IKKE er en del af den frosne
// BonusSecondsTuning-kontrakt: hvilke finale-typer der overhovedet er
// mass-finish-etaper (ikke-ITT, jf. #2413-scopet "10/6/4s til top 3 paa
// masse-etaper (ikke ITT)"), og det haarde per-rytter-per-etape-loft
// (#2413: "GC-effekten er bounded (maks. ~10s/etape)").
const bonusSecondsExtra = {
  finishBonusEligibleFinaleTypes: [
    "bunch_sprint",
    "reduced_sprint",
    "punch",
    "breakaway",
    "descent",
    "long_climb",
  ], // #2413: maal-bonus KUN paa masse-etaper — solo_tt (ITT) er bevidst UDELADT
  maxTotalBonusSecondsPerRiderPerStage: 10, // #2413: samlet GC-effekt bounded ~10s/etape, ogsaa naar samme rytter baade tager maal- og indlagt-spurt-bonus
  intermediateSprintQualityWeights: { sprint: 0.5, acceleration: 0.3, positioning: 0.2 }, // evne-vaegte for hvem der tager en indlagt spurt (distinkt fra finale.ts's egne demandVectorByFinaleType, saa spurt-udfaldet ikke er en ren kopi af maal-udfaldet)
  intermediateSprintNoiseSd: 0.06, // seedet stoej-sd paa spurt-scoren (rank-guard-moenstret: stoej flytter afstande, ikke fortegn — se computeIntermediateSprintOrder)

  // ── Passage-POINT (#2770, ejer-beslutning 6/9) ─────────────────────────────
  // Point-skalaerne er EJER-LAASTE Tour-skalaer (spec §4, 22/7) og staar i dag i
  // backend/lib/racePassages.js. De er spejlet 1:1 her — IKKE gentunet — fordi
  // v4's mekanik er den eneste kilde naar motoren er taendt, og det samlede
  // pointudbud pr. etape derfor skal vaere praecis det samme foer og efter
  // flippet (ellers ville en motorskifte-dag aendre alle groenne/prikkede
  // troeje-regnskaber). Skalaerne er offentlig spilinformation (spilleren ser
  // point i klassementet), ikke en fog-gated vaegt.
  //
  // AENDRER DU NOGET HER, aendrer du det ogsaa i racePassages.js — ellers
  // driver de to lag fra hinanden paa den vaerst taenkelige maade: usynligt.
  // headToHeadV4.js's paritets-maaling er vagten (--parity-noten i PR-body).
  finishPointsByProfileType: {
    flat: [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2],
    cobbles: [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2],
    rolling: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
    hilly: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
    classic: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
    gravel: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
    mountain: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    high_mountain: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    itt: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    itt_hilly: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    ttt: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  } as Record<string, readonly number[]>,
  // Ukendt profile_type falder tilbage paa bjerg-skalaen — samme fallback som
  // racePassages.scaleFor (GREEN_FINISH_SCALES.mountain). NB: itt_hilly findes
  // ikke i v3's tabel og ramte derfor netop det fallback; her staar den
  // eksplicit med samme vaerdier, saa resultatet er uaendret.
  finishPointsFallbackProfileType: "mountain",
  intermediateSprintPoints: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as readonly number[],
  komPointsByCategory: {
    HC: [20, 15, 12, 10, 8, 6, 4, 2],
    "1": [10, 8, 6, 4, 2, 1],
    "2": [5, 3, 2, 1],
    "3": [2, 1],
    "4": [1],
  } as Record<string, readonly number[]>,
  summitFinishPointMultiplier: 2, // HC/1. kategori der SLUTTER paa toppen taeller dobbelt (racePassages.scaleFor)
  summitFinishDoubledCategories: ["HC", "1"] as readonly string[],
  // Profil-typer hvor maal-bonussekunder ALDRIG uddeles. v3 gater paa
  // profile_type (itt/ttt), M9's egen `finishBonusEligibleFinaleTypes` gater paa
  // finale_type (solo_tt udeladt). BEGGE gates er aktive: en enkeltstart hvis
  // raekke mangler finale_type (legacy) skal ogsaa vaere daekket.
  bonusExcludedProfileTypes: ["itt", "itt_hilly", "ttt"] as readonly string[],
  // Evne-vaegte for hvem der tager en bjergpassage. Spejler racePassages'
  // KOM_BLEND_BIG/KOM_BLEND_SMALL: de store kategorier er ren klatring +
  // udholdenhed, de smaa afgoeres af en kort rampe (punch/acceleration).
  komQualityWeightsBig: { climbing: 0.75, endurance: 0.25 },
  komQualityWeightsSmall: { climbing: 0.5, punch: 0.35, acceleration: 0.15 },
  komSmallCategories: ["3", "4"] as readonly string[],
  komNoiseSd: 0.03, // samme stoej-niveau som racePassages.WAYPOINT_NOISE_SD
};

/** M9 additiv bonussekunder-tuning (deep-frosset). Se bonusSecondsExtra-kommentaren ovenfor. */
export const BONUS_SECONDS_EXTRA_TUNING = deepFreeze(bonusSecondsExtra);

// ── M3 (mechanics/descent.ts, #4604) — ADDITIV nedkoersels-regruppering ───────
// SS2's frosne DescentTuning (types.ts) baerer KUN angrebs-/risiko-haandtagene;
// den kender ingen regruppering. Samme "bevidst separat eksport"-moenster som
// finaleExtra ovenfor: mechanics/descent.ts importerer denne DIREKTE, saa den
// frosne kontrakt (arkitekt-only) staar uroert.
//
// HVORFOR den findes (#4604, F3-anker 3): segmentLoop's generiske gap-bogfoering
// er `gap = max(0, gap + (dtGruppe - dtFront))` — monotont IKKE-faldende for
// enhver gruppe bagude, paa ALLE terraen-kinds. En nedkoersel kunne derfor kun
// skabe tid, aldrig give den tilbage, og M3's eneste tids-effekt var et SPLIT.
// Virkeligheden er den modsatte: en nedkoersel udligner typisk smaa huller
// (hastigheden er tyngde-/aerodynamik-domineret, ikke effekt-domineret, saa en
// jagende gruppe taber ikke terraen paa at vaere svagere), og skaber sjaeldent
// store. Uden dette lag blev nedkoersels-finaler lige saa spredte som
// bjergankomster (nedkoersels-/summit-ratio ~1,1 mod kravet <= 0,5).
const descentExtra = {
  regroupSecondsPerKm: 0, // MIDTVEJS-nedkoersel, absolut led. BEVIDST 0 i denne PR: enhver regruppering paa en midtvejs-nedkoersel trækker direkte fra bjerg-top10-spredningen (#2415-baandet), og de to ankre deler etaper. Midtvejs-regruppering hoerer til en faelles kalibrering af begge baand, ikke til denne PR - se #4610
  regroupGapFractionPerKm: 0, // MIDTVEJS-nedkoersel, proportionalt led. Samme begrundelse som ovenfor
  regroupMaxGapFractionPerSegment: 0.85, // haardt loft: ét nedkoersels-segment maa ALDRIG udradere mere end denne andel af et hul — en aegte selektion skal kunne overleve en nedkoersel
  regroupTechnicalityFactor: { 1: 1.3, 2: 1.0, 3: 0.65 } as Record<1 | 2 | 3, number>, // T1 udligner mest (bred, hurtig vej), T3 mindst (teknisk vej lader en staerk descender forsvare hullet)
  regroupFinishSecondsPerKm: 10, // FINALE-nedkoersel, absolut led: sekunder af hullet til gruppen foran der lukkes pr. km
  regroupFinishGapFractionPerKm: 0.15, // FINALE-nedkoersel, proportionalt led: andel af et stort hul der lukkes pr. km
  regroupAbilitySpanPoints: 25, // descending-evne-forskel (0-99-skala) mellem jagende og forankoerende gruppe der giver fuldt udslag paa lukkehastigheden
  regroupAbilityFactorBounds: [0.9, 1.1] as const, // clamp paa evne-faktoren — en svagere gruppe lukker mindre, en staerkere mere, men ALDRIG negativt (et hul kan aldrig VOKSE af regrupperingen)
  // Angrebs-kvalifikationens OEVRE reference (#4604). DescentTuning.minAbilityGapForAttack
  // maaler mod gruppens SVAGESTE descender: i et felt paa 150+ ryttere ligger
  // minimum saa lavt at stort set hele feltet kvalificerer, og "angrebet" bliver
  // et split hvor 60-70 % af feltet koerer fra resten. Maalt paa syntetiske felter
  // foer fixet: 96 af 150 og 122 af 180 ryttere i "angrebsgruppen". Dette vindue
  // maaler i stedet mod gruppens BEDSTE descender, saa kun de reelt bedste gaar —
  // og bevarer praefiks-egenskaben monotoni-beviset i descent.ts hviler paa
  // (det er fortsat en ren evne-taerskel, saa den kvalificerende delmaengde er
  // altid et sammenhaengende praefiks sorteret paa faldende descending-evne).
  attackAbilityWindowPoints: 8, // kun ryttere inden for saa mange descending-point af gruppens bedste descender kan gaa med i et nedkoersels-angreb
  maxGroupSizeForAttack: 40, // et nedkoersels-angreb gaar normalt kun fra en ALLEREDE reduceret gruppe. Man koerer ikke 20 sekunder fra en samlet hovedgruppe paa en nedkoersel — dér er der altid nogen paa hjulet. Uden gaten udloeste M3 et angreb ud af selve feltet paa hver eneste tekniske nedkoersel
  minTechnicalityForLargeGroupAttack: 3, // undtagelsen: fra en STOR gruppe kan der stadig angribes, men kun paa den svaereste vejtype (T3). Ellers ville gruppestoerrelses-gaten slaa M3's angreb (ejer-beslutning 6) helt ihjel paa et realistisk felt

  // Styrt-risiko-GULV (#4905, ejer-beslutning 6/9, RACE_ENGINE_RULES §9 pkt. 4):
  // "styrt skal graduere og vaere en synlig del af loebet; nedkoersler i regn er
  // den mest realistiske kilde til styrt for netop de gode nedkoerere". Maalt
  // problem: DescentTuning.incidentRiskDescendingDampening (subtraktiv, frosset
  // kontrakt) daempede risikoen til PRAECIS 0 for enhver descending >= ~67 —
  // og `findAttackers` vaelger altid de bedste descendere i gruppen som
  // angribere, saa uheldet blev statistisk usynligt (40 loeb x 120 angreb = 0
  // uheld, ogsaa i regn). Erstatter den subtraktive daempning MULTIPLIKATIVT:
  // mechanics/descent.ts's incidentProbability ganger tuning.descent's
  // vejr-justerede incidentRiskBase (M11's weatherAdjustedRiskBase, ganger
  // FOERST) med max(incidentRiskFloorFraction, 1 - incidentRiskAbilityDampeningFraction * ability/99)
  // — en evne-multiplikator der ALDRIG kan naa 0, saa selv ability=99 bevarer
  // mindst `incidentRiskFloorFraction` af den faktiske (vejr-forstaerkede)
  // risiko. Monotont ikke-stigende i evne per konstruktion (max af en konstant
  // og en faldende linje er selv ikke-stigende) => invariant 3 uberoert: en
  // bedre descender faar ALDRIG hoejere risiko end en daarligere.
  incidentRiskFloorFraction: 0.25, // STARTGAET til kalibrering (backend/scripts/v4DescentIncidents.js): andel af den vejr-justerede basisrisiko selv den bedste descender (ability 99) altid beholder
  incidentRiskAbilityDampeningFraction: 1, // STARTGAET: hvor stor en andel af (1 - gulv) evnen maksimalt kan daempe risikoen med ved ability=99 — 1 => fuld daempning ned til praecis gulvet ved den bedste descender
} as const;

/** M3 additiv regrupperings-tuning (deep-frosset). Se descentExtra-kommentaren ovenfor. */
export const DESCENT_EXTRA_TUNING = deepFreeze(descentExtra);

// ── M10 (mechanics/incidents.ts, #4030 #4080) — ADDITIV incidents-tuning ──────
// SS2's frosne EngineTuning-kontrakt (types.ts) baerer INGEN incidents-sektion
// (arkitekten har ikke tilfoejet den) — samme "bevidst separat eksport"-moenster
// som finaleExtra ovenfor: mechanics/incidents.ts importerer denne konstant
// DIREKTE i stedet for at laese den via ctx.tuning. Mor-spec §4 M10 + §8
// beslutning 8 (3 km-reglen, flade etaper vs. bjergetaper).
const incidentsExtra = {
  baseRiskPerSegment: {
    flat: 0.003, // basis-styrt-risiko pr. flat-segment (ambient, IKKE angrebs-koblet — adskilt fra descent.ts's angriber-only risiko)
    rolling: 0.004, // basis-styrt-risiko pr. rolling-segment
    climb: 0.0025, // basis-styrt-risiko pr. climb-segment (lavest — lav hastighed daemper alvoren/frekvensen)
    descent: 0.005, // basis-styrt-risiko pr. descent-segment (ambient baggrundsrisiko, oveni descent.ts's angrebs-risiko)
    cobbles: 0.012, // basis-styrt-risiko pr. cobbles-segment (hoejest — ujaevnt terraen, M8-forlaeb)
  } as Record<SegmentKind, number>,
  positioningDampening: 0.00006, // risiko-reduktion pr. positioning-evne-point (0-99-skala) — samme daempnings-moenster som descent.ts's incidentRiskDescendingDampening, ALDRIG omvendt fortegn
  threeKmRuleWindowKm: 3, // "3 km-reglen"-vinduet fra maalstregen (mor-spec §8 beslutning 8)
  flatProfileTypes: ["flat", "rolling", "cobbles", "gravel", "classic"] as ProfileType[], // "FLADE etaper" i 3 km-reglens forstand — MODSAT bjergetaper; hilly/mountain/high_mountain udelukket (afgoerende gradient ved maal, M4-punch-territorium), itt/itt_hilly/ttt udelukket (ingen bundt-placering at beskytte). Start-kandidat, justerbar i head-to-head
  unprotectedTimeLossSecondsRange: [5, 25] as readonly [number, number], // sekunder tabt ved et LET styrt UDEN 3 km-reglens beskyttelse — rent uheld, bevidst IKKE evne-skaleret (crash-alvor er ikke en testet evne, jf. monotoni-invarianten der kun gaelder evne-testede mekanikker). #2944: dette er trappens TRIN 1

  // ── #2944-trappen (ejer-beslutning 6/9, LAAST) ─────────────────────────────
  // ALLE vaerdier herunder er STARTGAET, KALIBRERES — de er valgt saa
  // uheldsraten lander i ejerens maalbaand (1-2 % af rytterne pr. etape) og
  // maales af backend/scripts/headToHeadV4.js's uhelds-sektion. Ingen af dem
  // er ejer-godkendte tal; de er regressionsvagt indtil et scorecard siger
  // andet (doktrinen "et gulv er ikke et maal", #4221).

  // Risikoen er PR. KM, ikke pr. segment: `baseRiskPerSegment` laeses som
  // risikoen for ét segment af `referenceSegmentKm` laengde og skaleres
  // lineaert med segmentets faktiske laengde. Uden det ville en rute med 12
  // korte segmenter give 4x risikoen af en rute med 3 lange — altsaa lod
  // rute-MODELLENS granularitet, ikke etapens laengde, bestemme uheldsraten.
  referenceSegmentKm: 40,

  // Art-fordeling. Rest (1 - mechanicalShare) er styrt. v3's tilsvarende
  // INCIDENT_MECHANICAL_SHARE er 0,3; her lidt hoejere, fordi v4's mekaniske
  // uheld pr. konstruktion er UFARLIGE (kun tid) og derfor kan vaere hyppigere
  // uden at goere loebet mere uretfaerdigt (#2944's kerne-klage).
  mechanicalShare: 0.4,

  // Alvorsaksen INDEN FOR styrt (summen af hard+serious < 1; resten er light).
  // "serious" er ejerens SJAELDNE trin: ~3 % af styrt, dvs. langt under én pr.
  // etape ved et normalt felt. Testen incidents.test.ts laaser <= 8 % som
  // regressions-loft (dokumenteret taerskel, ikke maalet).
  crashSeverityShares: { hard: 0.22, serious: 0.03 },

  hardCrashTimeLossSecondsRange: [60, 240] as readonly [number, number], // TRIN 2: stort tidstab, men rytteren gennemfoerer
  hardCrashInjuryDaysRange: [1, 4] as readonly [number, number], // TRIN 2: skade i dage (v3's INCIDENT_INJURY_MIN/MAX_DAYS er 1-5)
  seriousCrashInjuryDaysRange: [4, 14] as readonly [number, number], // TRIN 3: udgaar + laengere skade

  // TRIN 4: mekanisk uheld (punktering, kaede, hjul). ALDRIG abandoned, ALDRIG
  // skade — kun tid. Spaendet er smallere end et haardt styrt: et hjulskift
  // koster typisk mindre end at samle sig selv op.
  mechanicalTimeLossSecondsRange: [20, 90] as readonly [number, number],
  // "En hjaelper taet paa giver hurtigere hjulskift": multiplikator paa
  // tidstabet naar betingelsen holder. STRENGT under 1, saa testen
  // "hjaelper => strengt mindre tidstab" ikke kan blive vakuoest sand.
  mechanicalHelperTimeLossFactor: 0.45,

  // HAARDT LOFT pr. etape — ARVET fra v3's RACE_V3_INCIDENT_MAX_FIELD_SHARE
  // (0,05 = 5 % af feltet). Loftet er REGRESSIONSVAGT, ikke maalet: maalet er
  // 1-2 %, og et loft der binder er et signal om at basis-risikoen er for hoej.
  maxIncidentsFieldShare: 0.05,

  // En udgaaet rytter flyttes til sin egen gruppe med dette gap, saa han (a)
  // aldrig merges tilbage ind i feltet af mergeGroups, (b) ikke laenger
  // traekker i nogen gruppes tempo, og (c) sorterer sidst uanset opgoer.
  // Vaerdien er en REPRAESENTATION af "ingen maaltid", ikke en paastand om en
  // faktisk tid; index.ts sorterer i forvejen abandoned sidst.
  abandonedGapSeconds: 3600,
};

/** M10 additiv incidents-tuning (deep-frosset). Se incidentsExtra-kommentaren ovenfor. */
export const INCIDENTS_EXTRA_TUNING = deepFreeze(incidentsExtra);

// ── M8 (mechanics/cobbles.ts, #4030 #4030-m8-m11) — ADDITIVE cobbles-tuning ──
// Samme praecedens som finaleExtra ovenfor: SelectionTuning (types.ts) er
// frosset og daekker kun M2 (klatring); cobbles-selektionen spejler dens form
// (deficit x vaegt + stoej + splitThreshold) men er sit eget saet konstanter,
// saa den ikke deler haandtag med M2's kalibrering. cobbles.ts importerer
// denne direkte (samme moenster som finale.ts's FINALE_EXTRA_TUNING-import).
const cobblesExtra = {
  deficitWeight: 1.0, // vaegt paa cobblestone-evne-underskuddet i cobbles-selektions-scoren (spejler tuning.selection.deficitWeight)
  starWeight: 1.0, // vaegt paa sector.stars/5 i scoren ("sector-stars x rytterens cobblestone-evne", mor-spec M8)
  noiseSdBase: 0.15, // stoej ~ N(0, sd*|baseScore|) — skalerer KUN magnitude, aldrig fortegn (samme moenster som SelectionTuning, monotoni-invarianten)
  splitThreshold: 0.12, // score-taerskel der udloeser en cobbles-split (samme start-anker som tuning.selection.splitThreshold)
  minStarsForRealWeight: 3, // kun sektorer med stars >= denne ("reel vaegt") kan udloese splits — under taersklen er sektoren en kosmetisk passage (F1 rute-bibliotek haandsliber de 4-5-stjernede sektorer, mor-spec §3.1)
  effectFractionBounds: [0.15, 0.2] as const, // "15-20 % effekt paa udvalgte punch-etaper" (mor-spec §3.1/§4 M8): split-gap'et clampes til denne andel af sektorens forventede krydsningstid (terrain.baseSpeedKmh.cobbles), saa reel-vaegt-sektorer faar bounded men maerkbar effekt
  punchFinaleMultiplier: 1.15, // ekstra vaegt naar route.finale_type === 'punch' ("udvalgte punch-etaper" — brosten+punch-kombinationen mor-spec §3.1 fremhaever) — multiplicerer effectFractionBounds, stadig clampet til [0,1]-krydsningstidsandel af hook'en
  incidentRiskBase: 0.008, // basis-styrt-risiko pr. reel-vaegt-cobbles-passage (F3-fundament for brosten-kaos, groups.ts's RaceGroup.cohesion-kommentar), samme stoerrelsesorden som tuning.descent.incidentRiskBase
  incidentRiskCobblestoneDampening: 0.00012, // daempning pr. cobblestone-evne-point (0-99-skala) — samme subtraktive moenster som tuning.descent.incidentRiskDescendingDampening
};

/** M8 additiv cobbles-tuning (deep-frosset). Se cobblesExtra-kommentaren ovenfor. */
export const COBBLES_EXTRA_TUNING = deepFreeze(cobblesExtra);

// ── M11 (mechanics/weather.ts, #4030 #4030-m8-m11) — ADDITIVE vejr-tuning ────
// Vejr-laget er et RISIKO-LAG i F3 (task-brief: "regn forstaerker T2/T3- og
// brosten-risiko + descent attack-risiko") — ingen ny EngineTuning-noegle
// (frosset kontrakt, types.ts, arkitekt-only), samme additiv-praecedens som
// finaleExtra/cobblesExtra. "vejr-teknik" (ejer-valg 20/8 §4 punkt 13, ny stat
// der foedes SKJULT) faar her KUN et hook-punkt: weatherTechniqueProxyWeights
// bruges af weather.ts's weatherTechniqueProxy() til at approksimere stat'en
// fra EKSISTERENDE evner indtil F4 tilfoejer den rigtige AbilityKey/Entrant-
// noegle (arkitekt-only, types.ts) — ingen DB-aendring, ingen migration her.
const weatherExtra = {
  rainIncidentRiskMultiplier: 1.6, // regn forstaerker T2/T3-/brosten-/descent-attack-risiko markant (mor-spec M11) — multiplikator paa den relevante mekaniks incidentRiskBase
  windIncidentRiskMultiplier: 1.15, // let forhoejet risiko ved vind (fundament for sidevind/vifter #2476 — IKKE selve vifte-mekanikken, kun basis-risiko-koblingen)
  sunOvercastIncidentRiskMultiplier: 1.0, // baseline, ingen risiko-effekt ved sol/overskyet
  weatherTechniqueDampeningPerPoint: 0.00015, // daempning pr. "vejr-teknik"(-proxy)-point — samme stoerrelsesorden/subtraktive moenster som tuning.descent.incidentRiskDescendingDampening
  weatherTechniqueProxyWeights: { descending: 0.5, durability: 0.5 }, // proxy-vaegte for den endnu-ufoedte "vejr-teknik"-evne (0-99-skala) — F4 erstatter proxy'en med abilities.weather_technique naar noeglen lander i types.ts

  // ── BELASTNINGS-ARMEN (#3855, M11-wiring 6/9) ────────────────────────────
  // Risiko-felterne ovenfor var HELE M11 da modulet blev bygget, og de daekker
  // kun "regn forstaerker styrt-risiko". Men et vejr-lag der udelukkende
  // flytter uheldstal er usynligt i et resultat, og ejer-reglen (§9 punkt 1)
  // er at vejret skal vaere koblet ind foer flippet — ikke bare importeret.
  //
  // Felterne herunder saenker rytterens CP (baeredygtige troeskel), samme sted
  // og samme form som distanceFatigueExtra nedenfor. En foerste udgave gangede
  // i stedet paa KRAFTKRAVET; maalt over 12 loeb pr. vejrtype flyttede det
  // arbejdet 4-7 % og intet andet (samme grupper, samme splits, samme hale) —
  // se mechanics/weather.ts's belastnings-blok for hvorfor det er strukturelt
  // og ikke et kalibreringsspoergsmaal. Vejret skaber i oevrigt ingen ny
  // splitaarsag: sidevind-selektion (vifter, #2476) er fortsat eget spor.
  //
  // STARTGAET, KALIBRERES. Tallene er valgt saa scorecardets ankre bliver
  // inden for deres eget stoej-spaend over 3 seeds (maalt i wiring-PR'en), ikke
  // mod en virkeligheds-reference — der findes ingen offentlig "hvad koster
  // regn"-maaling at ankre i, jf. §4's "et gulv er ikke et maal".
  rainCpPenalty: 0.05, // regn rammer HELE etapen uanset terraen (vaadt underlag, kulde, flere opbremsninger og genaccelerationer) — andel af CP en rytter UDEN vejr-teknik mister
  windCpPenaltyMax: 0.07, // vind rammer kun i det omfang etapen er eksponeret: ganges med route.weather.wind_exposure (0-1) OG med terraen-eksponeringen nedenfor
  windExposureByTerrain: { flat: 1, rolling: 0.85, cobbles: 0.9, descent: 0.5, climb: 0.25 }, // aabent terraen fanger vinden, en stigning ligger i lae af sig selv — samme rangorden som work.draftFactor's terraen-ordning
  weatherTechniqueCpReliefFraction: 0.6, // andelen af straffen "vejr-teknik" fjerner ved FULD teknik (99); resten betaler alle. Bevidst under 1: vejret er aldrig gratis, heller ikke for den bedste (§9 punkt 3). Det er SPREDNINGEN i dette led — ikke straffens stoerrelse — der differentierer feltet, fordi gruppens kollektive CP falder sammen med den enkeltes
};

/** M11 additiv vejr-tuning (deep-frosset). Se weatherExtra-kommentaren ovenfor. */
export const WEATHER_EXTRA_TUNING = deepFreeze(weatherExtra);

// ── M12 (mechanics/effortCost.ts, #4030) — ADDITIV effort-cost-tuning ────────
// Samme moenster som finaleExtra ovenfor: SS2's frosne EngineTuning-type
// (types.ts) har ingen "effortCost"-noegle (kun arkitekten aendrer den frosne
// kontrakt), saa denne er en BEVIDST SEPARAT eksport som mechanics/
// effortCost.ts importerer direkte. Kontrakt (opgave-brief M12): "effort-
// niveauet (protect/normal/save fra TeamOrder) modulerer work-cost/W'-forbrug
// i fysiologi-ticket" — genimplementering af raceRoles.js's
// effortFatigueMultiplier-MOENSTER (samme tre startvaerdier, ANKRET paa
// raceRoles.RACE_V3_TUNING.FATIGUE_MULTIPLIER_PROTECT/_SAVE/_NORMAL: v3-
// tallene er allerede spillet ind mod virkelige etaper) som en ren v4-
// funktion — v4 importerer ALDRIG raceRoles.js selv (renheds-graensen).
//
// #4632 (loebsdagens intention, ejer 5-6/9): skalaen er udvidet til FEM trin.
// De to nye yderpunkter ANKRER paa v3's nye startgaet praecis som de tre gamle
// ankrede paa v3's kalibrerede tal — raceRoles.RACE_V3_TUNING.
// FATIGUE_MULTIPLIER_GRUPETTO/_ALL_OUT (0.5 / 1.5). Begge er STARTGAET,
// KALIBRERES sammen med resten af M12-wiringen; v4 er ikke live.
//
// WIRET 6/9 (#4632, model C): tallene er nu LIVE i segmentLoop.ts's
// kraftkrav-beregning — men de er stadig startgaet. Maalt paa tvillinger
// (identiske ryttere, samme loeb, 20 seeds) ved wiringen: all_out koster
// ~+2.000 work_norm paa en flad etape og ~+4.000 med 12.000 ekstra sekunder
// over CP paa en bjergetape, grupetto sparer omtrent det samme den anden vej.
// Det er en STOR arm — den skal kalibreres sammen med bjerg-/hale-
// kalibreringen (#4707), ikke laases her.
const effortCostExtra = {
  demandMultiplierGrupetto: 0.5, // <save: koerer med i grupettoen, gaar ikke efter noget (raceRoles FATIGUE_MULTIPLIER_GRUPETTO-anker, STARTGAET)
  demandMultiplierProtect: 1.2, // >1: beskytter/traekker for holdet koster ekstra effekt-krav (raceRoles FATIGUE_MULTIPLIER_PROTECT-anker)
  demandMultiplierNormal: 1.0, // =1: baseline, ingen modulation
  demandMultiplierSave: 0.7, // <1: koerer bevidst inden for sig selv (raceRoles FATIGUE_MULTIPLIER_SAVE-anker)
  demandMultiplierAllOut: 1.5, // >protect: alt ud (raceRoles FATIGUE_MULTIPLIER_ALL_OUT-anker, STARTGAET)
};

/** M12 additiv effort-cost-tuning (deep-frosset). Se effortCostExtra-kommentaren ovenfor. */
export const EFFORT_COST_EXTRA_TUNING = deepFreeze(effortCostExtra);

// ── M7 (mechanics/distanceFatigue.ts, #4030) — ADDITIV distance-slid-tuning ──
// Samme moenster som finaleExtra/effortCostExtra ovenfor. Kontrakt (mor-spec
// §4 M7 + §8 beslutning 12): monument-effekten (250 km+ draener finalen,
// gradvis/distance-skaleret, "baaret af endurance") + dag-til-dag-slid via
// Entrant.condition. Alle vaerdier START-KANDIDATER (kalibreres i head-to-
// head-harnesset, f2-core-design.md §7), ikke gaettet endeligt her.
const distanceFatigueExtra = {
  // KALIBRERET 6/9 ved wiringen (#4885): rampen laa 220-280 km. Maalt paa en
  // repraesentativ offline-kalender (v4TailSpread.js, 141 etaper) ligger 3 af
  // 141 etaper over 220 km — mekanikken var altsaa live paa ~2 % af kalenderen
  // og doed paa resten. Rampen starter nu ved 150 km og naar sit maks ved 280,
  // saa "distance-slid" faktisk er en funktion af distancen paa hele
  // kalenderen, mens MAKSIMUM stadig kun naas paa monument-distancer (mor-spec
  // §4 M7's "~250 km" ligger paa 77 % af rampen). START-KANDIDATER, kalibreres
  // videre naar bjerg-/hale-kalibreringen (#4707) er ejer-afgjort.
  monumentThresholdKm: 150, // km hvor draeningen begynder — under mor-spec'ens "~250 km", saa rampen er godt i gang PAA monument-distancer og maalbar paa lange normal-etaper
  monumentRampKm: 130, // km-vindue draeningen naar sit maks over, efter threshold (glidende rampe, ikke et spring) — naar maks ved 280 km (150+130)
  monumentMaxCpPenalty: 0.12, // maks CP-reduktion (fraktion, 0-1) ved/efter rampens slutning, FOER endurance-mildning — op til 12% for en gennemsnitlig-endurance rytter
  monumentEnduranceMitigation: 0.6, // 0-1: andel af draeningen fuld endurance-evne (99) mildner — en 99-endurance-rytter oplever kun 40% af den fulde draening
  conditionFloorMultiplier: 0.85, // CP-multiplikator ved condition=0 (vaerst taenkelige dag-til-dag-slid); condition=1 => multiplikator 1 (ingen straf)
};

/** M7 additiv distance-slid-tuning (deep-frosset). Se distanceFatigueExtra-kommentaren ovenfor. */
export const DISTANCE_FATIGUE_EXTRA_TUNING = deepFreeze(distanceFatigueExtra);

// ── M5 (mechanics/breakaway.ts, #4030/#3855) — ADDITIV udbruds-tuning ─────────
// Samme praecedens som finaleExtra ovenfor: SS2's EngineTuning-kontrakt
// (types.ts) har intet breakaway-felt (frosset, kun arkitekten aendrer den) —
// disse er de reelt kalibrerbare haandtag for jagt-interesse-modellen (#2416),
// importeret direkte af breakaway.ts. Lokale, ikke-kalibrerbare struktur-
// konstanter (MIN/MAX-stoerrelse, score-vaegte) bor i selve mechanics-filen,
// samme moenster som climbSelection.ts's GRADIENT_NORM_PCT-kommentar.
const breakawayExtra = {
  sprinterInterestWeight: 0.5, // vaegt paa jagt-gruppens kollektive sprint-evne i chase-forcen (#2416: "sprinterholds interesse")
  gcThreatWeight: 0.35, // vaegt paa udbrydernes kollektive climbing/tempo/tt-proxy (#2416: "GC-trussel fra udbryderne")
  lateRaceUrgencyWeight: 0.25, // vaegt paa hvor langt etapen er naaet (0 ved start, 1 ved maal) i chase-forcen
  enginePowerResistanceWeight: 0.45, // vaegt paa udbruddets kollektive endurance/tempo i moddstanden (#2416: "udbruddets samlede motorstyrke")
  countResistanceWeight: 0.2, // vaegt paa udbruds-stoerrelsen (flere ryttere ruller bedre, #2416) i modstanden
  breakawayReferenceCount: 4, // rytterantal der giver countFactor=1 (skalerer lineaert, clamp [0, 1.5] i computeNetChaseAdvantage)
  closingSecondsPerKmPerUnit: 25, // sekunder/km lukket pr. enheds netto jagt-fordel (samme formmoenster som finaleExtra.chaseClosingSecondsPerKmPerUnit)
  stanceEffectWeight: 0.3, // T3 breakaway_stance-signalets vaegt paa netto-fordelen (bounded, se stanceMultiplierBounds)
  stanceMultiplierBounds: [0.7, 1.3] as readonly [number, number], // clamp paa stance-multiplikatoren — forhindrer at EN holdordre kan vaelte jagtens fortegn (mor-spec §5)
  finaleTypeChaseWeightDefault: 0.4, // sprinterholds-interesse-vaegt naar finale_type er ukendt/null
  finaleTypeChaseWeight: {
    bunch_sprint: 1.0, // massespurt-finale: maksimal sprinterhold-interesse i at koere udbruddet ind
    reduced_sprint: 0.65, // reduceret spurt: stadig hoej interesse
    punch: 0.3, // punch-finale: lav sprinter-interesse (sprinterhold jagter sjaeldent punch-finaler haardt)
    breakaway: 0.1, // breakaway-favoriseret finale: minimal sprinter-interesse (feltet forventer selv et udbrud)
    descent: 0.15, // nedkoersels-finale: lav sprinter-interesse
    long_climb: 0.1, // lang klatring: minimal sprinter-interesse
    solo_tt: 0.05, // enkeltstart: irrelevant (ingen felt-dynamik) men holdt lav i stedet for 0 for robusthed
  } as Partial<Record<import("./types.ts").FinaleType, number>>, // pr. finale-type sprinterhold-interesse-vaegt (#2416's "terraen + rest-km-proxy")
};

/** M5 additiv udbruds-tuning (deep-frosset). Se breakawayExtra-kommentaren ovenfor. */
export const BREAKAWAY_EXTRA_TUNING = deepFreeze(breakawayExtra);

// ── Sub-tick-fysiologi (#4030, fixture-fund 21/8) — ADDITIV physiology-tuning ─
// SS2's frosne PhysiologyTuning-kontrakt (types.ts) baerer ikke disse felter.
// Samme moenster som finaleExtra ovenfor: physiology.ts importerer denne
// direkte i stedet for at laese den via ctx.tuning/input.tuning.physiology.
//
// BAGGRUND: segmentLoop.ts's tickGroupRiders kaldte foer tickPhysiology ÉN
// gang pr. rytter pr. segment med hele segmentets dtSeconds (ofte flere
// tusinde sekunder). For taering (demand>cp) er ét stort Euler-skridt
// matematisk EKSAKT (lineaer ODE, konstant koefficient) — problemet er
// genopladningens eksponentielle ODE (`wprime += rate*(max-wprime)*dt`):
// naar `rate*dt` bliver stor (hvilket den rutinemaessigt gjorde ved et helt
// segments dtSeconds), overskyder ÉT Euler-skridt maalstregen og klampes til
// wprimeMax — dvs. reel "kør traet ELLER fuldt genoplad i ét hop" i stedet
// for den gradvise eksponentielle kurve. Fixet: del segmentets dtSeconds i N
// lige store sub-tick (§ physiology.planSubTicks/tickPhysiologyOverSegment),
// N afledt af segmentets km-laengde (kmPerSubTick) sa laengere segmenter faar
// flere, kortere sub-tick — genopladning naermer sig den sande eksponentielle
// kurve i stedet for at "snappe" til fuld reserve. Taering forbliver
// vaerdimaessigt uaendret (lineaer, sub-tick-invariant), men rapporteres nu
// ogsaa gradvist internt (samme akkumulerings-mekanisme for begge grene).
const physiologySubTick = {
  kmPerSubTick: 1, // ét sub-tick pr. paabegyndt km segment-laengde (§4030-fixture-fundet: "fx pr. km")
  maxSubTicksPerSegment: 300, // perf-/determinisme-gulv: laengste realistiske etape-segment (~300 km) faar stadig <=1 sub-tick/km
};

/** Sub-tick-fysiologi-tuning (deep-frosset). Se physiologySubTick-kommentaren ovenfor. */
export const PHYSIOLOGY_SUBTICK_TUNING = deepFreeze(physiologySubTick);

// ── W'-taerings-tidskonstant (#4604) — ADDITIV physiology-tuning ──────────────
// SS2's frosne PhysiologyTuning-kontrakt baerer ikke dette felt; samme
// additiv-praecedens som finaleExtra ovenfor.
//
// HVORFOR (maalt 2/9): §5-formlen taerer W' som `(demand - cp) * dtSeconds`.
// wprimeMax er NORMALISERET (0-1, maks 1,0 ved punch=accel=sprint=99), mens
// dtSeconds er et helt segments varighed - typisk 2.000-5.000 sekunder. Et
// overforbrug paa bare 0,001 over CP toemte derfor hele reserven paa ét
// segment. W' var i praksis BINAER: enten praecis fuld (strengt under CP hele
// vejen) eller nul. Maalt paa S3-kalenderen betoed det at 179 af 180 ryttere
// stod med wprime <= 0 ved etapens foerste stigning, hvorefter M2's
// wprime-tvungne selektion shellede hele feltet i ét skridt - ogsaa paa
// etaper klassificeret som massespurt.
//
// Tidskonstanten er den manglende bro mellem de to enheder: hvor mange
// sekunder ved et normaliseret overforbrug paa 1,0 der skal til for at toemme
// en FULD reserve. Genopladnings-grenen har allerede sin egen tidsskala
// (rechargeRateBase, ~1/0,0006 s) og roeres ikke.
const physiologyWprimeDrain = {
  timeConstantSeconds: 240, // sekunder ved normaliseret overforbrug 1,0 der toemmer en fuld reserve; en rytter 0,1 over CP holder ~40 min paa en halv reserve
};

/** W'-taerings-tidskonstant (deep-frosset). Se physiologyWprimeDrain-kommentaren ovenfor. */
export const PHYSIOLOGY_WPRIME_DRAIN_TUNING = deepFreeze(physiologyWprimeDrain);

// ── #4885 (physiology.ts) — ADDITIV udmattelses-tuning ───────────────────────
// HVORFOR (maalt 7/9, docs/audits/v4-tail-spread-2026-09-07.md): W' blev taeret
// og genopladet, men INGEN steder laest tilbage i den baeredygtige troeskel.
// segmentLoop.riderCpForSegment var deriveCp x distance-slid x holdrolle x vejr
// + dagsform - en toemt reserve gjorde altsaa ingen rytter langsommere. Feltet
// havde derfor ingen fysiologisk hale overhovedet: bjerg-p90 laa paa 2,7 % af
// vindertiden mod virkelighedens 8-15 %, og tidsgraensen (M15) fyrede 0 gange
// paa 351 bjerg-/kuperet-/brostens-koersler.
//
// Eksponenten > 1 er den vigtige del af formen: de foerste procent af reserven
// er naesten gratis (en rytter der lige har sprintet over en top er ikke koert
// i saenk), de sidste er dyre. Uden den ville ENHVER rytter der har rykket én
// gang koere langsommere resten af dagen, og fronten - der ligger under CP i
// normaltilstanden - ville blive ramt sammen med halen.
const physiologyWprimeDepletion = {
  maxCpPenalty: 0.45, // maks andel af CP en FULDSTAENDIG toemt reserve koster. STARTGAET, kalibreret i v4TailSpread-harnesset
  exponent: 2, // kurve-form: udtoemning^exponent, saa de foerste procent af reserven er naesten gratis
};

/** Udmattelses-tuning (deep-frosset). Se physiologyWprimeDepletion-kommentaren ovenfor. */
export const PHYSIOLOGY_WPRIME_DEPLETION_TUNING = deepFreeze(physiologyWprimeDepletion);

// ── #4885 (segmentLoop.computeSegmentSpeedKmh) — ADDITIV styrke/fart-tuning ──
// HVORFOR (maalt 7/9): fart-multiplikatoren var
// `1 + strengthSpeedGain * (collectiveCp - baseDemand[kind])` — en ABSOLUT
// CP-difference mod en konstant kalibreret for et midt-skala felt. Det er
// PRAECIS den fejlfamilie #4604 rettede i `tickGroupRiders` (jf. dens egen
// kommentar: "uanset hvor staerkt eller svagt et felt er, kan det ikke ligge
// over sit EGET tempo"), og den overlevede i fart-modellen. Mod den aegte
// population (climb-CP 0,010-0,374) betoed det at den staerkest og den svagest
// taenkelige gruppe hoejst kunne skille sig `strengthSpeedGain x 0,364 ~ 4,4 %`
// i fart — et hardt loft paa halen, uafhaengigt af enhver mekanik.
//
// Formen er nu RELATIV til feltets egen reference-CP paa terraenet
// (segmentLoop's `referenceCpByKind`, den samme top-frontFraction-regel som
// gruppens egen kollektive CP): en gruppe der er lige saa staerk som feltets
// front koerer per definition basishastigheden, uanset om aargangen er staerk
// eller svag. Population-uafhaengig, praecis som #4604 kraevede.
//
// TERRAEN-VAEGTEN er den anden halvdel. I virkeligheden omsaettes styrke til
// fart naesten fuldt op ad bakke og naesten ikke paa flad vej (aerodynamik og
// lae dominerer) — derfor henter en afhaegtet gruppe ikke tid tilbage paa
// nedkoerslen. v4 havde ingen terraen-akse paa styrke overhovedet, men til
// gengaeld en paa gruppe-lae (groupDraftExtra), saa paa flad vej og nedad
// vejede STOERRELSE tungere end STYRKE: en nedslidt grupetto paa 130 koerte
// fra en frisk frontgruppe paa 8 (maalt -2,23 % fart-delta), og den bagerste
// gruppe hentede 286 s tilbage paa én nedkoersel. Rangordenen er den samme som
// work.draftFactor's, af samme fysiske grund.
//
// UNDERSKUDS-EKSPONENTEN adskiller fronten fra halen. Bjerg-top-10-ankeret
// (#2415/#4604, 180-240 s) og hale-baandet maaler den SAMME CP-akse i hver sin
// ende; med en ren lineaer sammenhaeng kan de to baand ikke rammes samtidig
// (top-10-gruppen ligger ~15 % under fronten, halen ~97 % under — forholdet er
// 6,7, mens ankrene kraever ~11). En eksponent > 1 paa UNDERSKUDS-grenen goer
// de sidste procent under referencen dyrere end de foerste: en gruppe taet paa
// referencetempoet er stadig "med i loebet", en gruppe langt under koerer sit
// eget. Overskuds-grenen er og bliver LINEAER - ingen straf paa styrke; kun
// dens vaegt er kalibrerbar (#4914, se surplusWeight nedenfor).
const strengthSpeedExtra = {
  terrainWeight: {
    climb: 1, // fuld vaegt: op ad bakke er fart naesten proportional med baeredygtig effekt
    cobbles: 0.6, // brosten: haardt, men underlaget og ikke motoren saetter farten
    rolling: 0.45, // rullende: mellem
    flat: 0.3, // fladt: aerodynamik og lae dominerer, styrke betyder lidt
    descent: 0.2, // nedad: tyngdekraften koerer, styrke betyder mindst
  },
  deficitExponent: 1.35, // eksponent paa UNDERSKUDS-grenen (collectiveCp under referencen); overskud er lineaert
  // OVERSKUDS-VAEGTEN daemper FRONTEN. Relativiseringen deler med feltets
  // reference-CP (~0,23 paa climb mod den aegte population), hvilket goer BEGGE
  // grene ~4x stejlere. Maalt 7/9 uden denne vaegt: bjerg-top-10-spredningen gik
  // fra 200 s (baand 180-240) til 701 s, mens hale-p90 gik fra 2,7 % til 8,7 %.
  // Vaegten skruer alene overskuds-grenen tilbage, saa bjerg-ankeret holder.
  //
  // Fysisk er asymmetrien den rigtige vej: en gruppe der er STAERKERE end
  // feltets front koerer allerede paa terraenets og aerodynamikkens graense og
  // faar aftagende udbytte af mere kraft; en gruppe der er svagere end
  // loebstempoet mister proportionalt.
  //
  // KALIBRERET 7/9 (#4914, docs/audits/v4-climb-spread-tail-2026-09-07.md) mod
  // den PINNEDE 7/9-population (5.955 ryttere) + de pinnede proxy-etaper, felt
  // 180, 5 seeds. Begge tal var foer sat mod JULI-snapshottet, som #4936 viste
  // var skaevt/forældet: det aegte felt er staerkere og taettere i toppen, saa
  // samme vaegte gav for lidt spredning i BEGGE ender (bjerg-top-10 126 s mod
  // baand 180-240, hoejbjerg-hale 4,90 % mod ejer-baandet 6-12 %). Grenene er
  // hinandens uafhaengige haandtag, maalt hver for sig:
  //   surplusWeight 0.35 -> 0.55 : top-10 126 -> ~196 s, halen naesten uroert
  //   deficitWeight  1.8 -> 2.6  : hoejbjerg-hale 4,90 -> 7,65 %, top-10 uroert
  // Efter (5 seeds): top-10 195,5 s (152,0-227,7) PASS, hoejbjerg-hale 7,65 %
  // (6,67-8,25) PASS, bjerg-hale 10,19 % PASS, fladt 0,20 % PASS. Ingen andet
  // anker gik PASS -> FAIL; nedkoersels-/summit-ratio blev endda bedre
  // (0,417 -> 0,402 mod loftet 0,50).
  surplusWeight: 0.55, // vaegt paa OVERSKUDS-grenen (collectiveCp over referencen). Kalibreret mod bjerg-top-10-ankeret (#2415, 180-240 s)
  deficitWeight: 2.6, // vaegt paa UNDERSKUDS-grenen. Kalibreret mod det EJER-LAASTE hale-baand (bjerg/hoejbjerg 6-12 %, RULES §9 raekke 13)
};

/** #4885 additiv styrke/fart-tuning (deep-frosset). Se strengthSpeedExtra-kommentaren ovenfor. */
export const STRENGTH_SPEED_EXTRA_TUNING = deepFreeze(strengthSpeedExtra);

// ── M15 (mechanics/timeLimit.ts, #2582) — ADDITIV tidsgraense-tuning ─────────
// Samme additive praecedens som finaleExtra ovenfor: SS2's frosne EngineTuning
// (types.ts) har ingen "timeLimit"-noegle, saa mechanics/timeLimit.ts importerer
// denne direkte. Ejer-beslutning 6/9 (UCI-reglen, docs/RACE_ENGINE_RULES.md §2d).
//
// FAKTOR-TABELLEN er andelen af VINDERTIDEN en rytter maa laegge oveni foer han
// er uden for tidsgraensen. Ejer-rammen: UCI's 5-20 %-baand, flad lavest,
// bjerg/summit hoejest, enkeltstart/holdtidskoersel efter UCI-praksis. ALLE
// vaerdier er STARTGAET, kalibreres i harnesset — maalet er "sjaeldent paa flade
// etaper, maerkbart paa haarde bjergetaper, aldrig en massakre".
const timeLimitExtra = {
  factorByProfileType: {
    flat: 0.05, // fladt: laveste baand-ende (UCI's letteste koefficient) — feltet ruller samlet ind, kun en reelt havareret rytter falder udenfor
    rolling: 0.06, // rullende: knap over fladt, samme massefinale-dynamik
    hilly: 0.1, // kuperet: midt i baandet, foerste etapetype hvor selektionen kan hage en svag klatrer af
    cobbles: 0.09, // brosten: kort men nedslidende; UCI's klassiker-praksis er mild fordi sektorerne allerede har splittet feltet
    gravel: 0.11, // grus: laengere og mere nedslidende end brosten (RACE_ENGINE_RULES.md §2b), derfor lidt mildere graense
    classic: 0.11, // monument-arketypen: lang, haard, stor spredning i maal
    mountain: 0.15, // bjerg: hoej ende af baandet — grupettoen er normen her, ikke undtagelsen
    high_mountain: 0.2, // hoejbjerg/summit: baandets top (ejer: "bjerg/summit hoejest")
    itt: 0.25, // enkeltstart: UCI-praksis ligger over 5-20-baandet (typisk 25 %) fordi en TT spreder feltet naturligt
    itt_hilly: 0.25, // kuperet enkeltstart: samme UCI-praksis som itt
    ttt: 0.25, // holdtidskoersel: samme UCI-praksis; en rytter sluppet af sit hold maa ikke ryge ud paa en holdopgave
  } as Record<ProfileType, number>, // graense-faktor pr. etapetype (andel af vindertiden). STARTGAET, kalibreres
  fallbackFactor: 0.1, // faktor naar profile_type mangler/er ukendt — midt i baandet, saa en ukendt type hverken massakrerer eller slukker reglen
  grupettoFieldFraction: 0.2, // andel af FELTET en samlet ankomst skal udgoere foer grupetto-redningen udloeses (UCI bruger typisk 20 %). STARTGAET, kalibreres
  grupettoMinRiders: 8, // absolut gulv: i et lille felt maa 20 % ikke goere enhver lille klump til en grupetto. STARTGAET, kalibreres
  // MAALT 6/9, ikke gaettet: vinduet kan IKKE vaere tuning.groups.mergeThresholdSeconds (2 s).
  // finale.ts bygger hvert placerings-tier med et skridt paa mindst
  // mergeThresholdSeconds + placementGapMarginSeconds (2 + 0,4 s) netop for at
  // segmentLoop's efterfoelgende mergeGroups IKKE folder tierne sammen igen. Et
  // 2-sekunders vindue kan derfor per konstruktion aldrig kaede to tiers sammen,
  // saa en grupetto der ankommer i to klumper ville blive doemt som to smaa
  // grupper og ryge ud — praecis den massakre reglen skal forhindre. Maalt paa en
  // etape hvor halen faldt i to klumper 104 s fra hinanden (18 + 12 ryttere,
  // taerskel 24): 2 s => begge ud, 120 s => samlet og reddet. Vinduet er en
  // ANKOMST-graense ("kom de ind sammen?"), ikke en loebsdynamik-graense.
  grupettoCohesionWindowSeconds: 120, // sammenhaengsvindue paa sluttid: hvor langt der maa vaere mellem to naboer i en samlet ankomst. STARTGAET, kalibreres
};

/** M15 additiv tidsgraense-tuning (deep-frosset). Se timeLimitExtra-kommentaren ovenfor. */
export const TIME_LIMIT_EXTRA_TUNING = deepFreeze(timeLimitExtra);

// ── M16 (mechanics/teamPlay.ts, #4246) — ADDITIV holdspils-tuning ────────────
// Samme additive praecedens som finaleExtra/effortCostExtra ovenfor: SS2's
// frosne EngineTuning (types.ts) har ingen "teamPlay"-noegle, saa
// mechanics/teamPlay.ts importerer denne direkte.
//
// KONTRAKT (auditten 5/9 + ejer-beslutning 1 og 3, RACE_ENGINE_RULES §9): v3
// har to holdspils-kanaler som v4 slet ikke har — kaptajnens BESKYTTELSE
// (raceSimulator.teamComponent: den beskyttede rytter faar holdets arbejde som
// et bounded score-loeft, vaegt teamRaceWeightV3() x helperSupport) og
// hjaelperens PRIS (raceRoles.workCost: en negativ score-delta for at have
// arbejdet). Begge forsvinder ved et flip hvis de ikke findes i v4.
//
// VALUTAEN ER CP, IKKE W'. v4 har ingen "score" at laegge et hold-led paa; den
// har en fysiologi. Den foerste wiring 6/9 forsoegte W' (den anaerobe reserve)
// og var BIT-IDENTISK med og uden hold: siden #4604's relative krav-tempo
// ligger ingen over CP i normaltilstanden, saa W' genoplades fuldt hvert
// segment og enhver delta er visket ud foer naeste segment laeser den. CP er
// den vedvarende akse — den styrer baade gruppens tempo
// (segmentLoop.computeGroupTempo) og klatre-selektionen (M2's testedDeficit),
// altsaa praecis de to steder v3's holdspil ogsaa slaar igennem.
//
// BEVARELSE (ikke en kalibrering, en KONSTRUKTION): kaptajnens bonus-fraktion
// er aldrig stoerre end summen af de omkostnings-fraktioner hans holdkammerater
// faktisk paadrog sig samme segment, ganget med transferEfficiency <= 1.
// Holdspil FLYTTER kraefter, det skaber dem ikke — v4's udgave af "aldrig
// gratis alt-ud" (§9 punkt 3), property-testet, ikke kalibreret.
//
// Ankret er v3's egne kalibrerede
// FORHOLD (raceRoles.RACE_V3_TUNING): hjaelperens pris paa GC-relevante
// profiler er ~9/8 af leadout-prisen paa flad vej, save/grupetto betaler halv
// pris, og all_out betaler INTET. Selve STOERRELSEN kan ikke arves — v3's tal
// er score-deltaer paa en 0-1-skala, v4's er andele af egen CP.
//
// NIVEAUET ER KALIBRERET TIL v3-PARITET (ejer-beslutning 7/9, #4914,
// RACE_ENGINE_RULES §9 punkt 14). Foerste wiring 6/9 ramte et
// beskyttelses-gab paa ~3 pladser mod v3's; det tal blev dengang sammenlignet
// med 19,4 pladser, som var MAALT MOD JULI-POPULATIONEN og er forældet. Mod
// den re-eksporterede population (population-snapshot-2026-09-07.json, #4936)
// er v3's eget gab 7,1 pladser (3,67-9,99 over 5 seeds) — det er DET tal
// pariteten er sat efter, ikke det gamle.
//
// MAALT 7/9 (backend/scripts/teamPlayAbMeasure.mjs, pinnet population +
// pinnede proxy-etaper, 5 seeds, 180-rytters felt, --orders=ai):
//
//   beskyttelses-gab, middel (spaend over seeds)
//     v3 (uaendret referencemotor)  7,10 (3,67-9,99)
//     v4 foer denne kalibrering    -0,06 (-2,01-2,10)
//     v4 med tallene nedenfor       7,35 (4,38-10,19)
//
// INTET anker skifter dom mellem foer og efter, og hale-gaten (§9 punkt 13)
// er PASS paa alle tre laaste baand i begge koersler. Beslutningsgrundlaget
// (A/B-rapporten ejeren valgte ud fra) ligger i
// backend/scripts/out/teamplay-ab-2026-09-07.md.
//
// Forholdene mellem knapperne er UAENDREDE fra wiringen — hele saettet er
// skaleret med samme faktor (x2,7), plus et saenket CP-gulv. Det er derfor
// stadig v3's kalibrerede FORHOLD der er ankret; kun stoerrelsen er ny.
const teamPlayExtra = {
  // Hjaelperens pris over HELE etapen, som andel af hans egen CP. Per segment
  // paadrages `costFraction x (segmentets km / etapens km)`, og summen over
  // etapen er derfor praecis costFraction — uafhaengigt af hvor fint
  // rutemodellen har skaaret etapen op (samme granularitets-uafhaengighed som
  // M10's pr.-km-skalering, RACE_ENGINE_RULES §2c).
  helperCostFractionGc: 0.405, // GC-relevante profiler (rolling/hilly/mountain/high_mountain/classic): hjaelperen traekker hele dagen for sin kaptajn — v3's WORK_COST_HELPER_GC-rolle. KALIBRERET 7/9 til v3-paritet (ejer, #4914)
  helperCostFractionFlat: 0.3591, // flade etaper: leadout-arbejde, kortere og senere end en bjergdags tempotraek — v3's 8/9-forhold mellem FLAT og GC bevaret. KALIBRERET 7/9 til v3-paritet (ejer, #4914)
  helperCostFractionOther: 0.2025, // oevrige profiler (brosten/grus/itt/itt_hilly/ttt): v3 giver helper 0 her, men v4's felt koerer stadig samlet paa brosten — halv pris i stedet for nul, saa holdspillet ikke forsvinder paa en klassiker. KALIBRERET 7/9 til v3-paritet (ejer, #4914)
  hunterCostFraction: 0.135, // `hunter` koerer sit eget loeb (udbruds-kandidat) men bruger stadig kraefter for holdet — lille, profil-uafhaengig pris, praecis som v3's WORK_COST_HUNTER. KALIBRERET 7/9 til v3-paritet (ejer, #4914)

  // Effort-multiplikator paa hjaelperens PRIS (RACE_ENGINE_RULES §9 punkt 3,
  // ejer 6/9: "holdarbejdets pris (all_out fjerner prisen, loftet til 0, aldrig
  // bonus over egen evne)"). Dette er work-cost-AKSEN og ikke M12's
  // demand-akse: de to peger med vilje hver sin vej for all_out — en rytter
  // der giver alt for SIG SELV braender mere (M12's demandMultiplierAllOut
  // 1.5) og arbejder samtidig ikke for holdet (0 her). Derfor sit eget saet
  // konstanter og ikke et delt haandtag med EFFORT_COST_EXTRA_TUNING.
  // Ankret er raceRoles.RACE_V3_TUNING.EFFORT_COST_MULTIPLIER_* 1:1.
  effortCostMultiplier: {
    grupetto: 0.5, // samme halve pris som save (v3: bevidst IKKE lavere — en lavere pris end save ville vaere en resultat-FORDEL, og grupetto maa ikke give en saadan)
    save: 0.5, // koerer bevidst inden for sig selv: halv pris
    normal: 1.0, // fuld pris (baseline)
    protect: 1.0, // fuld pris — `protect` ER holdarbejdet, den rabatteres aldrig
    all_out: 0, // ejer 6/9: all_out FJERNER prisen. LOFTET er strukturelt (Math.max(0, ...) i mechanics/teamPlay.ts): 0 er bunden, aldrig en negativ pris = gratis CP oveni egen evne
  } as Record<EffortLevel, number>,

  // Kaptajnens beskyttelse. `transferEfficiency` er den andel af holdets
  // paadragne pris der naar frem som lae hos den beskyttede rytter; resten er
  // tabt (vind, positionering, rytteren foran der ogsaa skal koere).
  // < 1 er baade realistisk OG bevarelses-garantien.
  transferEfficiency: 0.6, // andel af hjaelpernes pris der bliver til kaptajnens laegevinst. STARTGAET
  // Hardt loft paa kaptajnens bonus over hele etapen, som andel af hans EGEN
  // CP. Uden loftet ville et hold med otte hjaelpere kunne give sin kaptajn en
  // ubegraenset fordel — "bounded fordel-signal" er ejer-formuleringen, og det
  // er DETTE tal der goer den bounded. Bevidst mindre end hjaelperens pris: en
  // kaptajn kan aldrig vinde mere end et helt holds arbejde koster.
  captainMaxBonusFraction: 0.216, // maks. bonus over hele etapen, andel af kaptajnens egen CP. KALIBRERET 7/9 til v3-paritet (ejer, #4914)
  // Gulv under holdarbejdets samlede faktor: selv en hjaelper der har trukket
  // hele dagen for et helt hold er stadig en cykelrytter. Regressionsvagt mod
  // en fremtidig kalibrering der utilsigtet nulstiller nogens CP.
  minCpFactor: 0.58, // KALIBRERET 7/9: saenket fra 0,70 saa hjaelperens fulde pris kan bide igennem paa en hel bjergdag uden at ramme gulvet

  // Mindst én arbejdende holdkammerat i SAMME gruppe kraeves (ejer-brief).
  // Gruppen ER naerheds-modellen i v4 (mor-spec §3.2, samme definition som
  // mechanics/incidents.ts's hasHelperNearby) — en hjaelper der er koert af
  // bagud hjaelper ingen.
  minWorkersForProtection: 1,
  // Maetning: holdstoerrelsen der giver FULD stoette. Flere end dette flytter
  // ikke mere (log-kurve, clampet) — samme "kvalitet over kvantitet, naturligt
  // bounded"-princip som v3's buildTeamContext bruger naar den midler
  // hjaelper-stoetten i stedet for at summere den.
  supportSaturationWorkers: 4, // antal arbejdende holdkammerater i gruppen der giver fuld stoette. STARTGAET
};

/** M16 additiv holdspils-tuning (deep-frosset). Se teamPlayExtra-kommentaren ovenfor. */
export const TEAM_PLAY_EXTRA_TUNING = deepFreeze(teamPlayExtra);
