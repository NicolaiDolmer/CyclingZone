// frontend/src/lib/strategyLogic.js
// Race Hub S3: rene UI-helpers til Holdstrategi-fladen. Ingen React, ingen I/O.
// TERRAIN_BUCKETS spejler backend/lib/raceTerrain.js (verificeret i test).

export const TERRAIN_BUCKETS = ["flat", "hilly", "mountain", "cobbles", "itt"];

// Flyt element i `dir` (-1 op, +1 ned) med clamp; returnerer ny liste.
export function moveInList(list, index, dir) {
  const next = [...list];
  const j = index + dir;
  if (j < 0 || j >= next.length) return next;
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

// Toggle medlemskab i en liste (bevarer rækkefølge ved tilføj-til-sidst).
export function toggleInList(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// Top-3 kaptajn-kandidater for en bucket efter suitability (desc), tiebreak id (asc).
// Ryttere uden suitability-tal for bucketen udelades.
export function autoSuggestCaptains(roster, bucket) {
  return [...roster]
    .filter((r) => Number.isFinite(r.suitabilities?.[bucket]))
    .sort((a, b) => (b.suitabilities[bucket] - a.suitabilities[bucket]) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 3)
    .map((r) => r.id);
}

// Aggregér preview-diff til overskrifts-tal.
export function summarizeDiff(diff = {}) {
  let changedRaces = 0, totalAdded = 0, totalRemoved = 0, captainChanges = 0;
  for (const d of Object.values(diff)) {
    const changed = d.added.length || d.removed.length || d.captainChange;
    if (changed) changedRaces += 1;
    totalAdded += d.added.length;
    totalRemoved += d.removed.length;
    if (d.captainChange) captainChanges += 1;
  }
  return { changedRaces, totalAdded, totalRemoved, captainChanges };
}
