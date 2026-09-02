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

import type { EngineTuning, ProfileType, SegmentKind } from "./types.ts";

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
    incidentRiskDescendingDampening: 0.00015, // risiko-reduktion pr. descending-evne-point
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
};

/** M9 additiv bonussekunder-tuning (deep-frosset). Se bonusSecondsExtra-kommentaren ovenfor. */
export const BONUS_SECONDS_EXTRA_TUNING = deepFreeze(bonusSecondsExtra);

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
  flatProfileTypes: ["flat", "rolling", "cobbles", "classic"] as ProfileType[], // "FLADE etaper" i 3 km-reglens forstand — MODSAT bjergetaper; hilly/mountain/high_mountain udelukket (afgoerende gradient ved maal, M4-punch-territorium), itt/itt_hilly/ttt udelukket (ingen bundt-placering at beskytte). Start-kandidat, justerbar i head-to-head
  unprotectedTimeLossSecondsRange: [5, 25] as readonly [number, number], // sekunder tabt ved et styrt UDEN 3 km-reglens beskyttelse — rent uheld, bevidst IKKE evne-skaleret (crash-alvor er ikke en testet evne, jf. monotoni-invarianten der kun gaelder evne-testede mekanikker)
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
const effortCostExtra = {
  demandMultiplierProtect: 1.2, // >1: beskytter/traekker for holdet koster ekstra effekt-krav (raceRoles FATIGUE_MULTIPLIER_PROTECT-anker)
  demandMultiplierNormal: 1.0, // =1: baseline, ingen modulation
  demandMultiplierSave: 0.7, // <1: koerer bevidst inden for sig selv (raceRoles FATIGUE_MULTIPLIER_SAVE-anker)
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
  monumentThresholdKm: 220, // km hvor monument-draeningen begynder — sat lidt under "~250 km" (mor-spec §4 M7) saa rampen er godt i gang PAA monument-distancer
  monumentRampKm: 60, // km-vindue draeningen naar sit maks over, efter threshold (glidende rampe, ikke et spring) — naar maks ved ~280 km (220+60)
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
