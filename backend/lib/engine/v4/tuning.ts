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

import type { EngineTuning } from "./types.ts";

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
    strengthSpeedGain: 0.25, // skalering af hastigheds-multiplikator pr. enhed kollektiv-CP over/under baseDemand
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
