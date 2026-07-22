// backend/lib/racePassages.js
// Sub-2 (#2770): passage-lag — ren efterbehandling af simulateStage-output.
// Dedikerede rng-strømme (stableSeed-afledte) → motorens main-rng/noise-sekvens
// er bit-identisk. Ingen DB, ingen Math.random/Date.
import { makeRng, gaussian } from "./fictionalRiderGenerator.js";
import { stableSeed, deriveBreakawayStatus } from "./raceSimulator.js";

// Ejer-låste Tour-skalaer (spec §4, 22/7) — tunes ALDRIG mod scorecard.
export const GREEN_FINISH_SCALES = Object.freeze({
  flat:          Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  cobbles:       Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  rolling:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  hilly:         Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  classic:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  mountain:      Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  high_mountain: Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  itt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  ttt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
});
export const INTERMEDIATE_SPRINT_SCALE = Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
export const KOM_SCALES = Object.freeze({
  HC:  Object.freeze([20, 15, 12, 10, 8, 6, 4, 2]),
  "1": Object.freeze([10, 8, 6, 4, 2, 1]),
  "2": Object.freeze([5, 3, 2, 1]),
  "3": Object.freeze([2, 1]),
  "4": Object.freeze([1]),
});
export const FINISH_BONUS_SECONDS = Object.freeze([10, 6, 4]);
export const INTERMEDIATE_BONUS_SECONDS = Object.freeze([3, 2, 1]);
// Tunbare (scorecard, Task 8):
export const SPRINT_CAPTAIN_CONTEST_MULTIPLIER = 1.15;
export const WAYPOINT_NOISE_SD = 0.03;
export const CATCH_KM_RANGE = Object.freeze([0.55, 0.92]); // andel af distance

export function computePassages({ ranked = [], stageProfile = {}, entrants = [], seed, isStageRace }) {
  const empty = { passages: [], perRider: new Map() };
  if (!isStageRace) return empty;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const sprints = Array.isArray(stageProfile.sprints) ? stageProfile.sprints : [];
  const distance = Number(stageProfile.distance_km);
  // Data-gating: uden rute (ingen distance og ingen waypoints) → legacy.
  if (!Number.isFinite(distance) && climbs.length === 0 && sprints.length === 0) return empty;
  // ... (Task 3-4 fylder ud)
  return empty;
}
