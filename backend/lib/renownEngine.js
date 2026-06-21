// backend/lib/renownEngine.js
// Renown-multiplier (Fase 2, #1663): sponsor-basen skalerer med klub-omdømme
// (division + resultat-historik). Ren funktion — ingen I/O. Aktivitet er IKKE en
// multiplier-faktor (det er per-løbsdag-indkomst, se sponsorRaceDayIncome.js).
import { SPONSOR_INCOME_BY_DIVISION, SPONSOR_INCOME_BASE } from "./economyConstants.js";

// Harness-kalibreret (#1663 Fase J, 2026-06-21 — se docs/audits/2026-06-21-renown-sponsor-
// calibration.md). W_RESULTS=0,45 trækker det modne D1-felt dead-on break-even (median-net
// ≈ +4k) UDEN at hæve divergens (Gini falder faktisk — de stærke hold bærer den dybeste
// løn-deficit, så at booste dem komprimerer net-spredningen). MAX_MULTIPLIER=1,40 = top-
// holdets ceiling (resultsScore=1,0 → 1+0,45 = 1,45, clamp'et til 1,40) → aktiv clamp.
export const W_RESULTS = 0.45;
export const MAX_MULTIPLIER = 1.40;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// resultsScore ∈ [0,1]: sidste sæsons point relativt til divisions-median × rank-faktor,
// clamp'et. 0 hvis ingen historik (frisk hold → multiplier 1,0).
export function computeResultsScore({ lastSeasonStanding, divisionStandings = [] }) {
  if (!lastSeasonStanding) return 0;
  const points = Math.max(0, Number(lastSeasonStanding.total_points) || 0);
  const divisionPoints = divisionStandings.map((s) => Math.max(0, Number(s.total_points) || 0));
  const medianPoints = median(divisionPoints);
  const pointsFactor = medianPoints > 0 ? points / medianPoints : points > 0 ? 1 : 0;
  const size = divisionStandings.length;
  const rank = Number.isInteger(lastSeasonStanding.rank_in_division)
    ? lastSeasonStanding.rank_in_division
    : null;
  const rankNormalized = rank === null ? 1 : size > 1 ? clamp((rank - 1) / (size - 1), 0, 1) : 0;
  const rankFactor = clamp(1 - rankNormalized, 0, 1);
  return clamp(pointsFactor * rankFactor, 0, 1);
}

export function computeRenownMultiplier({ lastSeasonStanding, divisionStandings = [] }) {
  const resultsScore = computeResultsScore({ lastSeasonStanding, divisionStandings });
  return clamp(1 + W_RESULTS * resultsScore, 1.0, MAX_MULTIPLIER);
}

// renownTarget = den SAMLEDE sponsor et hold tjener ved fuld aktivitet.
// Splittes i garanteret base + per-løbsdag i sponsorOffers.js.
export function renownTarget({ division, lastSeasonStanding, divisionStandings = [] }) {
  const base = SPONSOR_INCOME_BY_DIVISION[division] ?? SPONSOR_INCOME_BASE;
  return Math.round(base * computeRenownMultiplier({ division, lastSeasonStanding, divisionStandings }));
}
