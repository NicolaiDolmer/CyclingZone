// Talentspejder Fase 3 (#2244) — RENE scout-engine-funktioner, ingen I/O.
// Mønster: facilityEngine.js. Spejder-rating driver kapacitet, cost/varighed
// pr. opgave-type, og præcisions-gulvet (halvbredde-loft) på tværs af
// scouting.js (stjerne-bånd) og scoutingReport.js (loft-rating-bånd).
//
// Ejer-låste defaults (docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md):
//   default-spejder overall 40 · kapacitet 1 (2 ved overall≥80)
//   target: 1.000/niveau-step, ~30 min svartid UANSET niveau (ejer-beslutning 18/7,
//   #2644 — se targetEtaMinutes nedenfor for hvorfor "30 min" og "0 dage" er samme ting)
//   mission: 1 dag, 6.000 flat
//   (rekalibreret 10/7 fra 15.000/60.000 efter scoutTravelScorecard-FAIL:
//    85-177% af sæsonindkomst ved aktiv kadence, mål [2%,15%] —
//    se docs/audits/2026-07-10-talentspejder-gates.md)
//   #3652 (spillerforslag 11/8, jeppek: "maybe the 2-day trip should be a bit
//   shorter... maybe just 1 day", ejer-direktiv 12-13/8-tråden): dage 2→1.
//   scoutTravelScorecard.js's gate er UÆNDRET PASS (D1 6,3% / D2 10,3% /
//   D3 13,2% af [2%,15%]) fordi dens model-profil bruger en FAST kadence
//   (1 mission/måned), ikke en varigheds-afledt en — cost pr. mission er
//   uændret 6.000. Modellen fanger derfor IKKE at kapacitets-loftet (1 aktiv
//   opgave ad gangen for de fleste hold) nu frigiver et missions-slot dobbelt
//   så hurtigt, så det TEORETISKE spend-loft for en spiller der konstant
//   genkøer også fordobles — D3 lå allerede tættest på 15%-loftet. Ikke
//   kørt gennem en kadence-opdateret scorecard-variant; flaget eksplicit i
//   PR'en til ejer-review, ikke et selvstændigt merge-argument her.
//   mission: 6.000 flat, uændret (se ovenfor)
//   gulv: lineær interp overall 40→5.0, 99→3.0 (rating-point-skala, CEIL_HALF_WIDTH_BY_LEVEL[3]=3)
//   loft: middelmådig spejder (overall<60) kommer ALDRIG under gulv 4.5

export const DEFAULT_SCOUT = Object.freeze({
  overall: 40,
  roleSkills: Object.freeze({ evaluation: 40, reach: 40 }),
  isDefault: true,
});

// #2458 (ejer-go 16/7): tempoet sat kraftigt ned — 14-dages missioner døde i
// glemsel (0 af 35 aktive nåede at modne før sæsongrænsen), og "svar i
// overmorgen"-loopet passer spillets 1-2 logins/dag-rytme. Inflation styres
// ikke af varigheden men af kapacitet (1-2 samtidige), rejseomkostninger og
// potentiale-sløret shortlist — de er alle uændrede.
// #2644 (ejer-beslutning 18/7): enkelt-rytter-undersøgelse ("target") svarer på
// ~30 minutter, UANSET niveau — ejeren justerede eksplicit ned fra mockuppens
// ~2 timer ("Må gerne være meget kort"). etaMinutes er en HÅNDHÆVET deadline:
// lazyCompleteDueTargetAssignments (scoutTargetMaturation.js) modner due
// undersøgelser ved hver visning af Scouting-centralen (getScoutState), 30 min
// efter start. daysPerLevel:0 sætter ready_on = started_on (samme kalenderdag),
// så den nattelige 22-sweep (scoutSweep.js) er backstop for hold der aldrig
// åbner siden inden da.
export const SCOUT_JOB_CONFIG = Object.freeze({
  target: Object.freeze({ daysPerLevel: 0, costPerLevel: 1000, etaMinutes: 30 }),
  // #3652: days 2→1 (spillerforslag 11/8). Se kommentaren ovenfor.
  mission: Object.freeze({ days: 1, cost: 6000, shortlistMin: 3, shortlistMax: 5 }),
});

const CAPACITY_HIGH_THRESHOLD = 80;

// Kapacitet: 1 samtidig opgave, 2 ved overall ≥ 80 (spec beslutning 2).
export function scoutCapacity(scout = DEFAULT_SCOUT) {
  const overall = Number(scout?.overall ?? DEFAULT_SCOUT.overall);
  return overall >= CAPACITY_HIGH_THRESHOLD ? 2 : 1;
}

const GULV_FLOOR_OVERALL = 40;
const GULV_FLOOR_VALUE = 5.0;
const GULV_CEIL_OVERALL = 99;
const GULV_CEIL_VALUE = 3.0;
const MEDIOCRE_OVERALL_THRESHOLD = 60;
const MEDIOCRE_HALF_WIDTH_CAP = 4.5;

// Half-width-gulv i rating-point-enheder (matcher CEIL_HALF_WIDTH_BY_LEVEL-skalaen)
// pr. spejder-overall: lineær 40→5.0, 99→3.0, monotonisk faldende. Middelmådig
// spejder (overall < 60) kommer ALDRIG under 4.5 (spec beslutning 3 — evigt loft).
//
// #3671: BRUGES NU KUN AF STJERNE-SPORET (scouting.js' rest-bånd), hvor gulvet
// stadig skal virke som en absolut nedre grænse på ét enkelt tal. Rating-bånd-
// sporet er flyttet til den relative form i scoutHalfWidth nedenfor, fordi den
// absolutte konstant dér gjorde hele scout-niveauer værdiløse — se der.
export function minHalfWidthByScoutRating(overall) {
  const raw = Number(overall);
  const o = Math.max(GULV_FLOOR_OVERALL, Math.min(GULV_CEIL_OVERALL, Number.isFinite(raw) ? raw : DEFAULT_SCOUT.overall));
  const t = (o - GULV_FLOOR_OVERALL) / (GULV_CEIL_OVERALL - GULV_FLOOR_OVERALL);
  const interpolated = GULV_FLOOR_VALUE + t * (GULV_CEIL_VALUE - GULV_FLOOR_VALUE);
  if (o < MEDIOCRE_OVERALL_THRESHOLD) return Math.max(interpolated, MEDIOCRE_HALF_WIDTH_CAP);
  return interpolated;
}

// Spejder-kvalitet 0..1 → hvor stor en ANDEL af niveauets indsnævring spejderen
// faktisk kan levere. 40 (default-spejder, ingen chefscout) → 2/3; 99 → 1,0.
//
// Tallet 2/3 er ikke valgt frit: det er præcis den værdi der får et fuldt
// scoutet bånd til at lande på det gamle gulv. Med basis [9,6,4,3] er
//   9 − (2/3)·(9−3) = 5,0 = minHalfWidthByScoutRating(40).
// Og for enhver overall gælder identiteten 9 − q(o)·6 = 5 − 2t(o), dvs. den
// nye formel giver ved FULD scouting bit-identisk samme halvbredde som den
// gamle absolutte konstant gjorde — for hver eneste spejder-rating.
const SCOUT_QUALITY_AT_FLOOR = 2 / 3;

export function scoutQualityFactor(overall) {
  const raw = Number(overall);
  const o = Math.max(GULV_FLOOR_OVERALL, Math.min(GULV_CEIL_OVERALL, Number.isFinite(raw) ? raw : DEFAULT_SCOUT.overall));
  const t = (o - GULV_FLOOR_OVERALL) / (GULV_CEIL_OVERALL - GULV_FLOOR_OVERALL);
  return SCOUT_QUALITY_AT_FLOOR + t * (1 - SCOUT_QUALITY_AT_FLOOR);
}

// Effektiv half-width pr. niveau for RATING-loft-båndet (#3671).
//
// Før: max(base[level], absolut gulv). Gulvet er scout-afhængigt men
// level-UAFHÆNGIGT, så det klippede flere niveauer ned til samme tal: med
// basis [9,6,4,3] og gulv 5,0 (overall 40 = default, 150 af 203 menneskehold)
// gav niveau 2 og 3 begge 5,0. Spilleren betalte 1.000 CZ$ for nul.
//
// Nu: spejderen leverer en ANDEL q af indsnævringen fra base[0] ned til
// base[level]. Hvert niveau køber derfor altid noget — en svag spejder køber
// bare mindre pr. niveau end en stærk. Egenskaber:
//   · level 0 er uændret base[0] for alle (ingen bliver dårligere uscoutet)
//   · fuldt scoutet er bit-identisk med det gamle gulv (se SCOUT_QUALITY_AT_FLOOR)
//   · resultatet ligger altid i [base[level], base[0]] og er monotont i level
//   · formen er ENHEDS-FRI — den arver kaldernes egen enhed, så unitScale-
//     konverteringen der koblede stjerne-sporet til CEIL_HALF_WIDTH_BY_LEVEL[3]
//     er væk. Stjerne-sporet kalder minHalfWidthByScoutRating direkte i stedet.
export function scoutHalfWidth(level, scout = DEFAULT_SCOUT, baseHalfWidthByLevel) {
  if (!Array.isArray(baseHalfWidthByLevel) || baseHalfWidthByLevel.length === 0) {
    throw new Error("scoutHalfWidth: baseHalfWidthByLevel must be a non-empty array");
  }
  const idx = Math.max(0, Math.min(Number(level) || 0, baseHalfWidthByLevel.length - 1));
  const widest = baseHalfWidthByLevel[0];
  const base = baseHalfWidthByLevel[idx];
  const overall = Number(scout?.overall ?? DEFAULT_SCOUT.overall);
  const half = widest - scoutQualityFactor(overall) * (widest - base);
  // "Evigt loft" for den middelmådige spejder (spec-beslutning 3, ejer-låst):
  // under overall 60 kommer båndet aldrig under 4,5 rating-point.
  const capped = Number.isFinite(overall) && overall < MEDIOCRE_OVERALL_THRESHOLD
    ? Math.max(half, Math.min(widest, MEDIOCRE_HALF_WIDTH_CAP))
    : half;
  return capped;
}

// Rejseomkostning for en opgave. target: costPerLevel × antal niveau-steps
// (fromLevel→toLevel); mission: flat cost.
export function travelCostFor(kind, { fromLevel = 0, toLevel } = {}) {
  if (kind === "mission") return SCOUT_JOB_CONFIG.mission.cost;
  if (kind === "target") {
    const steps = Math.max(0, (Number(toLevel) || 0) - (Number(fromLevel) || 0));
    return steps * SCOUT_JOB_CONFIG.target.costPerLevel;
  }
  throw new Error(`travelCostFor: ukendt kind "${kind}"`);
}

// Klar-dato for en opgave. target: daysPerLevel × antal niveau-steps efter
// startdato; mission: fast varighed (SCOUT_JOB_CONFIG.mission.days).
export function readyDateFor(kind, startedOn, { fromLevel = 0, toLevel } = {}) {
  const start = startedOn instanceof Date ? startedOn : new Date(startedOn);
  if (Number.isNaN(start.getTime())) throw new Error("readyDateFor: ugyldig startedOn");
  let days;
  if (kind === "mission") {
    days = SCOUT_JOB_CONFIG.mission.days;
  } else if (kind === "target") {
    const steps = Math.max(0, (Number(toLevel) || 0) - (Number(fromLevel) || 0));
    days = steps * SCOUT_JOB_CONFIG.target.daysPerLevel;
  } else {
    throw new Error(`readyDateFor: ukendt kind "${kind}"`);
  }
  const ready = new Date(start);
  ready.setUTCDate(ready.getUTCDate() + days);
  return ready;
}

// #3548: PRÆCIST klar-tidspunkt for en målrettet undersøgelse.
//
// ready_on er en DATO (started_on + daysPerLevel = samme kalenderdag for target),
// så den kan ikke bære en nedtælling på minutter. Deadline'en findes allerede i
// data: lazyCompleteDueTargetAssignments (scoutTargetMaturation.js) modner
// præcis de opgaver hvor `created_at <= now - etaMinutes`. Denne funktion er
// den samme regel læst forlæns, så frontend aldrig regner tidspunktet forfra:
// klar = created_at + etaMinutes.
//
// Returnerer en Date, eller null hvis created_at mangler/er ugyldig (defensivt —
// rækken vises da bare med den gamle flade ETA-copy i stedet for en nedtælling).
export function targetReadyAt(createdAt, etaMinutes = SCOUT_JOB_CONFIG.target.etaMinutes) {
  if (!createdAt) return null;
  const start = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(start.getTime())) return null;
  const minutes = Number(etaMinutes);
  if (!Number.isFinite(minutes)) return null;
  return new Date(start.getTime() + minutes * 60_000);
}

// Kan holdet starte en ny opgave lige nu? Ren guard (mønster: facilityEngine.validateUpgrade).
//   activeCount : antal aktive opgaver hos spejderen nu
//   scout       : spejder-objekt (overall driver kapacitet)
//   balance     : holdets nuværende kassebeholdning
//   cost        : rejseomkostning for den ønskede opgave
// Returnerer { ok, reason } hvor reason ∈ "capacity" | "insufficient_funds" | null.
export function canStartAssignment({ activeCount, scout = DEFAULT_SCOUT, balance, cost }) {
  const capacity = scoutCapacity(scout);
  if ((Number(activeCount) || 0) >= capacity) return { ok: false, reason: "capacity" };
  if ((Number(balance) || 0) < (Number(cost) || 0)) return { ok: false, reason: "insufficient_funds" };
  return { ok: true, reason: null };
}
