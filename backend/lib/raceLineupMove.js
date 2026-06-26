// backend/lib/raceLineupMove.js
// Ren logik for "flyt rytter til løb" (atomisk move-operation, #1925-followup).
// I/O (entries, windows, RPC) ligger i api.js-handleren; her kun det testbare.
import { windowsOverlap } from "./raceBinding.js";

// Find det løb (≠ target) hvor rytteren allerede er udtaget OG som tids-overlapper
// target — det er kilden der skal evicte's ved et move. Ingen overlap → null (ren
// tilføj). Rytteren allerede i target → null (no-op).
export function findOverlappingSourceRaceId({ riderRaceIds = [], toRaceId, windowByRace = {} }) {
  const targetWindow = windowByRace[toRaceId];
  for (const raceId of riderRaceIds) {
    if (raceId === toRaceId) continue;
    if (windowsOverlap(targetWindow, windowByRace[raceId])) return raceId;
  }
  return null;
}

// Validér mål-løbet. Rækkefølge afgør hvilken fejl der vises. fieldSize = max.
export function validateMoveTarget({ targetCount, fieldSize, teamInPool, frozen, eligible }) {
  if (!teamInPool) return { ok: false, error: "move_wrong_pool" };
  if (frozen) return { ok: false, error: "move_target_locked" };
  if (!eligible) return { ok: false, error: "move_rider_ineligible" };
  if (targetCount >= fieldSize) return { ok: false, error: "move_target_full" };
  return { ok: true };
}
