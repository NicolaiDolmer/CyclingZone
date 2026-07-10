// Talentspejder Fase 3 (#2244) — RENE scout-engine-funktioner, ingen I/O.
// Mønster: facilityEngine.js. Spejder-rating driver kapacitet, cost/varighed
// pr. opgave-type, og præcisions-gulvet (halvbredde-loft) på tværs af
// scouting.js (stjerne-bånd) og scoutingReport.js (loft-rating-bånd).
//
// Ejer-låste defaults (docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md):
//   default-spejder overall 40 · kapacitet 1 (2 ved overall≥80)
//   target: 3 dage/niveau-step, 15.000/niveau-step
//   mission: 14 dage, 60.000 flat
//   gulv: lineær interp overall 40→5.0, 99→3.0 (rating-point-skala, CEIL_HALF_WIDTH_BY_LEVEL[3]=3)
//   loft: middelmådig spejder (overall<60) kommer ALDRIG under gulv 4.5

export const DEFAULT_SCOUT = Object.freeze({
  overall: 40,
  roleSkills: Object.freeze({ evaluation: 40, reach: 40 }),
  isDefault: true,
});

export const SCOUT_JOB_CONFIG = Object.freeze({
  target: Object.freeze({ daysPerLevel: 3, costPerLevel: 15000 }),
  mission: Object.freeze({ days: 14, cost: 60000, shortlistMin: 3, shortlistMax: 5 }),
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
export function minHalfWidthByScoutRating(overall) {
  const raw = Number(overall);
  const o = Math.max(GULV_FLOOR_OVERALL, Math.min(GULV_CEIL_OVERALL, Number.isFinite(raw) ? raw : DEFAULT_SCOUT.overall));
  const t = (o - GULV_FLOOR_OVERALL) / (GULV_CEIL_OVERALL - GULV_FLOOR_OVERALL);
  const interpolated = GULV_FLOOR_VALUE + t * (GULV_CEIL_VALUE - GULV_FLOOR_VALUE);
  if (o < MEDIOCRE_OVERALL_THRESHOLD) return Math.max(interpolated, MEDIOCRE_HALF_WIDTH_CAP);
  return interpolated;
}

// Effektiv half-width pr. niveau: max(baseHalfWidthByLevel[level], gulv).
// baseHalfWidthByLevel er i den kaldende moduls egen enhed (rating-point for
// scoutingReport.js' CEIL_HALF_WIDTH_BY_LEVEL, stjerne for scouting.js'
// baseHalfWidthByAge/residualHalfWidth) — unitScale konverterer gulvet
// (altid beregnet i rating-point) til den enhed. Default unitScale=1 (rating-point).
export function scoutHalfWidth(level, scout = DEFAULT_SCOUT, baseHalfWidthByLevel, unitScale = 1) {
  if (!Array.isArray(baseHalfWidthByLevel) || baseHalfWidthByLevel.length === 0) {
    throw new Error("scoutHalfWidth: baseHalfWidthByLevel skal være et ikke-tomt array");
  }
  const idx = Math.max(0, Math.min(Number(level) || 0, baseHalfWidthByLevel.length - 1));
  const base = baseHalfWidthByLevel[idx];
  const floor = minHalfWidthByScoutRating(scout?.overall ?? DEFAULT_SCOUT.overall) * unitScale;
  return Math.max(base, floor);
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
// startdato; mission: fast varighed (14 dage).
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
