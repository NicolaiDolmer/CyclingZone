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

export function validateSelectionClient({ riderIds, captainId, sprintCaptainId, hunterId, size, availableCount }) {
  const errors = [];
  const effectiveMin = Math.min(size.min, availableCount ?? size.min);
  if (riderIds.length < effectiveMin || riderIds.length > size.max) errors.push("selection_wrong_size");
  if (!captainId) errors.push("selection_captain_required");
  const roles = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roles).size !== roles.length) errors.push("selection_role_overlap");
  return errors;
}
