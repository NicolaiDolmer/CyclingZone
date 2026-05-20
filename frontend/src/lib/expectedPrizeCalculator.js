// Computes expected CZ$ payout for a race based on race_class + race_type + stages + race_points data.
// Mirrors backend/scripts/audit-season-races.js (single source of truth for the formula).
//
// Stage races: finals counted once (Klassement/Pointtroje/Bjergtroje/Ungdomstroje/EtapelobHold)
//   + per-stage types × stages (Etapeplacering/Forertroje/BjergtrojeDag/PointtrojeDag/UngdomstrojeDag).
// Single races: finals counted once (Klassiker/Pointtroje/Bjergtroje/Ungdomstroje/KlassikerHold).
//
// All sums multiplied by PRIZE_PER_POINT (1500 CZ$/point).

export const PRIZE_PER_POINT = 1_500;

const STAGE_RACE_RESULT_TYPES = {
  finals: ["Klassement", "Pointtroje", "Bjergtroje", "Ungdomstroje", "EtapelobHold"],
  perStage: ["Etapeplacering", "Forertroje", "BjergtrojeDag", "PointtrojeDag", "UngdomstrojeDag"],
};

const SINGLE_RACE_RESULT_TYPES = {
  finals: ["Klassiker", "Pointtroje", "Bjergtroje", "Ungdomstroje", "KlassikerHold"],
  perStage: [],
};

function sumPoints(racePoints, raceClass, resultType) {
  let sum = 0;
  for (const row of racePoints) {
    if (row.race_class === raceClass && row.result_type === resultType) {
      sum += row.points || 0;
    }
  }
  return sum;
}

export function computeExpectedRacePoints({ raceClass, raceType, stages, racePoints }) {
  if (!raceClass || !Array.isArray(racePoints) || racePoints.length === 0) return 0;
  const isStage = raceType === "stage_race";
  const cfg = isStage ? STAGE_RACE_RESULT_TYPES : SINGLE_RACE_RESULT_TYPES;
  const stageCount = isStage ? Math.max(1, stages || 1) : 1;

  let total = 0;
  for (const resultType of cfg.finals) {
    total += sumPoints(racePoints, raceClass, resultType);
  }
  for (const resultType of cfg.perStage) {
    total += sumPoints(racePoints, raceClass, resultType) * stageCount;
  }
  return total;
}

export function computeExpectedRacePrize({ raceClass, raceType, stages, racePoints }) {
  return computeExpectedRacePoints({ raceClass, raceType, stages, racePoints }) * PRIZE_PER_POINT;
}

export function formatExpectedPrize(amount) {
  if (!amount || amount < 0) return "~0 CZ$";
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    const decimals = millions >= 10 ? 0 : 1;
    return `~${millions.toFixed(decimals).replace(".", ",")}M CZ$`;
  }
  if (amount >= 1_000) {
    return `~${Math.round(amount / 1_000)}k CZ$`;
  }
  return `~${amount} CZ$`;
}
