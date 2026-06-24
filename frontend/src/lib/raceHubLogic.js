// frontend/src/lib/raceHubLogic.js
// Race Hub Fase 1: rene UI-helpers til trup-fordeling-board'et. Holder komponenterne
// thin + giver node --test-dækning. Ingen React, ingen I/O.

// Status-chip for en kolonne. withdrawn vinder; ellers full vs understaffed mod target.
export function computeColumnStatus({ selected, target, withdrawn }) {
  if (withdrawn) return { kind: "withdrawn", selected, target };
  if (selected >= target) return { kind: "full", selected, target };
  return { kind: "understaffed", selected, target };
}

// Er rytteren bundet væk fra `forRaceId` (udtaget i et ANDET overlappende kolonne-løb)?
export function isRiderBound({ bindingMap, riderId, forRaceId }) {
  const races = bindingMap?.[riderId];
  if (!races || !races.length) return false;
  return races.some((id) => id !== forRaceId);
}

// Ledige ryttere til at tilføje til `forRaceId`: i truppen, ikke allerede udtaget her,
// ikke bundet i et overlappende løb.
export function availableRiderIds({ roster = [], selectedIds = [], bindingMap = {}, forRaceId }) {
  const selected = new Set(selectedIds);
  return roster
    .map((r) => r.id)
    .filter((id) => !selected.has(id) && !isRiderBound({ bindingMap, riderId: id, forRaceId }));
}
