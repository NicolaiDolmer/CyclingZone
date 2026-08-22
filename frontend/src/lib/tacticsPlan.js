// Taktik-ordrer v1 (race engine v4, #4030) — rene, testbare afledninger til
// TacticsCard.jsx. Ingen IO her (ingen fetch/Date.now uden parameter); adapteren
// (tacticsOrdersAdapter.js) leverer data, denne fil regner ren logik på dem.
//
// Ordre-kontrakten (spec: docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md):
//   TeamOrder = { team_id, breakaway_stance: "chase"|"neutral"|"let_go",
//                 riders: [{ rider_id, effort: "protect"|"normal"|"save", try_break }] }

export const EFFORT_KEYS = ["protect", "normal", "save"];
export const BREAKAWAY_STANCES = ["chase", "neutral", "let_go"];

// T4 (spec): fraværende ordre for en rytter = neutrale defaults.
export function defaultRiderOrder(riderId) {
  return { rider_id: riderId, effort: "normal", try_break: false };
}

export function defaultTeamOrder(riderIds = []) {
  return { team_id: null, breakaway_stance: "neutral", riders: riderIds.map(defaultRiderOrder) };
}

// Ryttere kan være tilføjet/fjernet i lineupet siden ordrerne sidst blev gemt —
// round-trip kun dem der stadig er i truppen, tilføj neutrale ordrer for
// nytilkomne (samme mønster som RaceSelectionPanel's free_role_ids-filtrering).
export function mergeOrderWithRoster(order, riderIds = []) {
  const known = new Map((order?.riders || []).map((r) => [r.rider_id, r]));
  return {
    team_id: order?.team_id ?? null,
    breakaway_stance: order?.breakaway_stance ?? "neutral",
    riders: riderIds.map((id) => known.get(id) || defaultRiderOrder(id)),
  };
}

// i18n-nøglen for stance-teksten ("let_go" → "letGo", resten uændret).
export function stanceI18nKey(stance) {
  return stance === "let_go" ? "letGo" : stance;
}

export function effortCounts(riders = []) {
  const counts = { protect: 0, normal: 0, save: 0 };
  for (const r of riders) {
    if (counts[r.effort] != null) counts[r.effort] += 1;
  }
  return counts;
}

export function setRiderEffort(order, riderId, effort) {
  return { ...order, riders: order.riders.map((r) => (r.rider_id === riderId ? { ...r, effort } : r)) };
}

export function toggleTryBreak(order, riderId) {
  return { ...order, riders: order.riders.map((r) => (r.rider_id === riderId ? { ...r, try_break: !r.try_break } : r)) };
}

export function setBreakawayStance(order, stance) {
  return { ...order, breakaway_stance: stance };
}

export function isOrderLocked(locksAt, now = Date.now()) {
  if (!locksAt) return false;
  const t = new Date(locksAt).getTime();
  return Number.isFinite(t) && now >= t;
}

// Team plan er afledt tekst i v1 (spec §UI-anatomi), ikke et input. captainName
// kan være null (endnu ingen kaptajn valgt i lineupet ovenfor).
export function teamPlanKey(stance, captainName) {
  if (!captainName) return { key: "tacticsOrders.plan.noCaptain", params: {} };
  return { key: `tacticsOrders.plan.${stanceI18nKey(stance)}`, params: { captain: captainName } };
}
