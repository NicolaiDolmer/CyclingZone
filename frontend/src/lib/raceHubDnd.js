// frontend/src/lib/raceHubDnd.js
// Rene helpers til native HTML5 drag-and-drop på trup-fordeling-boardet (#1925).
// Ingen React/DOM — kun payload-kodning + drop-beslutning, så det er node-testbart.
export function encodeDrag({ riderId, fromRaceId }) {
  return JSON.stringify({ riderId, fromRaceId: fromRaceId ?? null });
}

export function decodeDrag(raw) {
  try {
    const o = JSON.parse(raw);
    return o && o.riderId ? { riderId: o.riderId, fromRaceId: o.fromRaceId ?? null } : null;
  } catch {
    return null;
  }
}

// Hvilken handling skal et drop udløse? "add" | "move" | "remove" | "none".
//   pulje  → kolonne : add (eller move hvis rytteren allerede er i et overlappende løb)
//   kolonne→ kolonne : move (samme kolonne → none)
//   kolonne→ pulje   : remove
// Fuldt/frosset mål → none.
export function dropAction({ fromRaceId, toRaceId = null, toKind, targetFull = false, targetLocked = false }) {
  if (toKind === "pool") return fromRaceId ? "remove" : "none";
  if (toKind === "column") {
    if (targetFull || targetLocked) return "none";
    if (fromRaceId && fromRaceId === toRaceId) return "none";
    return fromRaceId ? "move" : "add";
  }
  return "none";
}
