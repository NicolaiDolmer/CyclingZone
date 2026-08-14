// Computes expected CZ$ payout for a race based on race_class + race_type + stages + race_points data.
// Mirrors backend/scripts/audit-season-races.js (single source of truth for the formula).
//
// Stage races: finals counted once (Klassement/Pointtroje/Bjergtroje/Ungdomstroje/EtapelobHold)
//   + per-stage types × stages (Etapeplacering/Forertroje/BjergtrojeDag/PointtrojeDag/UngdomstrojeDag).
// Single races: finals counted once (Klassiker/KlassikerHold) — ingen trøje-klassementer.
//
// #3718: et endagsløb uddeler ikke point-, bjerg- eller ungdomstrøje, hverken i spillet eller i
// virkeligheden (ejer-beslutning 14/8: "vi følger virkeligheden"). Motoren har altid opført sig
// sådan — målt over hele sæson 2 producerede endagsløb kun `gc` (22.133 rækker) og `team` (3.680
// rækker), og ikke én eneste trøje-række. Denne beregner talte dem med alligevel, så hvert
// endagsløb lovede op til 39 % mere end det nogensinde kunne udbetale (ProSeries-endagsløb:
// 1.518 lovet mod 924 uddelt). Over sæson 2's kalender var det 10,07 M CZ$ vist til spillerne
// og aldrig betalt.
//
// Trøje-rækkerne i `race_points` er IKKE død data og må ikke slettes: tabellen er nøglet på
// (race_class, result_type, rank) uden en race_type-dimension, og etapeløbs-stien udbetaler
// præcis de rækker fuldt ud (verificeret: ProSeries-etapeløb forudsiger 594 trøjepoint,
// uddeler 594). Det var kun endagsløbs-konsumenten der var forkert.
//
// All sums multiplied by PRIZE_PER_POINT (75 CZ$/point).

// Frontend single source of truth for PRIZE_PER_POINT. Backend mirror: backend/lib/economyConstants.js
// (separate codebases — the frontend bundle cannot import backend; keep both in sync). Ref #898.
// #1816 (2026-06-23): 1500 → 75 (÷20) — præmie skal være et supplement, ikke den dominerende indtægt.
export const PRIZE_PER_POINT = 75;

const STAGE_RACE_RESULT_TYPES = {
  finals: ["Klassement", "Pointtroje", "Bjergtroje", "Ungdomstroje", "EtapelobHold"],
  perStage: ["Etapeplacering", "Forertroje", "BjergtrojeDag", "PointtrojeDag", "UngdomstrojeDag"],
};

// #3718: KUN Klassiker + KlassikerHold. Tilføj aldrig et trøje-klassement her uden at
// raceResultsEngine.RESULT_TYPE_TO_RACE_POINTS.single og race-motoren kan uddele det —
// ellers lover fladen point igen som spillet ikke betaler.
const SINGLE_RACE_RESULT_TYPES = {
  finals: ["Klassiker", "KlassikerHold"],
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
