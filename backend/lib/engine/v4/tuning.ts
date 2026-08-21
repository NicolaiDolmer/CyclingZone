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
