// #1307: ren udtagelses-state-logik (testbar uden React). Spejler backendens
// valideringskoder så fejl kan vises FØR kaldet.

export function toggleRider(state, riderId, max) {
  const has = state.riderIds.includes(riderId);
  if (!has && state.riderIds.length >= max) return state;
  const riderIds = has ? state.riderIds.filter((id) => id !== riderId) : [...state.riderIds, riderId];
  return {
    riderIds,
    captainId: has && state.captainId === riderId ? null : state.captainId,
    sprintCaptainId: has && state.sprintCaptainId === riderId ? null : state.sprintCaptainId,
    hunterId: has && state.hunterId === riderId ? null : state.hunterId,
  };
}

// #2028: vælg en fallback-kaptajn EFTER FORTJENESTE når manageren ikke selv har sat en.
// Tidligere valgte board'et `ids[0]` (første rytter i arrayet) → en vilkårlig, ofte
// svagere rytter blev gemt som kaptajn uden intention (fx GC-lederen blev forbigået).
// Nu: højest løb-suitability blandt de udtagne, ekskl. sprint/jæger så roller forbliver
// distinkte; kun hvis ALLE kandidater allerede har en anden rolle falder vi tilbage til
// hele feltet. Tiebreak: rider_id asc (deterministisk). Tom trup → null.
// `suitabilityOf(id)` → 0-100 (eller null/undefined når ukendt → behandles som lavest).
// Spejler race-enginens egen GC-fallback (raceAutopick.resolveCaptain: stærkeste rytter).
export function pickFallbackCaptain({ riderIds = [], sprintId = null, hunterId = null, suitabilityOf }) {
  if (!riderIds.length) return null;
  const eligible = riderIds.filter((id) => id !== sprintId && id !== hunterId);
  const pool = eligible.length ? eligible : riderIds;
  let best = null;
  let bestScore = -Infinity;
  for (const id of pool) {
    const raw = suitabilityOf ? Number(suitabilityOf(id)) : NaN;
    const score = Number.isFinite(raw) ? raw : -1;
    if (score > bestScore || (score === bestScore && best != null && String(id) < String(best))) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

// Spejler backend raceSelection.validateSelection PRÆCIST (#1906): fuld opstilling
// kræves. `required` = løbets pladsantal (size.max). To distinkte fejl så UI kan guide:
//   selection_insufficient_riders → holdet har for få raske ryttere (afmeld / hent fri-agenter)
//   selection_wrong_size          → holdet KAN fylde, men har valgt for få/mange
export function validateSelectionClient({ riderIds, captainId, sprintCaptainId, hunterId, size, availableCount }) {
  const errors = [];
  const required = size.max;
  if (Number.isFinite(availableCount) && availableCount < required) {
    errors.push("selection_insufficient_riders");
  } else if (riderIds.length !== required) {
    errors.push("selection_wrong_size");
  }
  if (!captainId) errors.push("selection_captain_required");
  const roles = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roles).size !== roles.length) errors.push("selection_role_overlap");
  return errors;
}
