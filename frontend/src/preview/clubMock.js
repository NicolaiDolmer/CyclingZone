// Statefuld preview-mock for /api/club/* (#1441 A3). Muterer en in-memory kopi af
// SEED_CLUB så ejerens gennemklik er ægte (køb hæver tier, ansæt/fyr fylder/tømmer).
// Konstanterne er en 1:1-spejling af backend/lib/facilityConstants.js (parity-test
// i clubMock.parity.test.js sikrer de ikke driver fra hinanden — co-SSOT).
import { SEED_CLUB } from "./seedData.js";

const PRICE = { 1: 12000, 2: 26000, 3: 50000, 4: 100000, 5: 240000 };
const UPKEEP = { 0: 0, 1: 1500, 2: 3500, 3: 8000, 4: 15000, 5: 30000 };
const SALARY = { 1: 100, 2: 250, 3: 600, 4: 1300, 5: 2600 };
const BASE_EFFECT = {
  training: { 0: 0, 1: 0.03, 2: 0.045, 3: 0.074, 4: 0.11, 5: 0.165 },
  scouting: { 0: 0, 1: 0.015, 2: 0.032, 3: 0.07, 4: 0.145, 5: 0.30 },
  medical: { 0: 0, 1: 0.06, 2: 0.09, 3: 0.148, 4: 0.22, 5: 0.33 },
  academy: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 },
  commercial: { 0: 0, 1: 0.0006, 2: 0.0013, 3: 0.0027, 4: 0.0057, 5: 0.012 },
};
const TRACKS = ["training", "scouting", "medical", "academy", "commercial"];
const NAME_POOL = ["Marc Vandenbroucke", "Henrik Sørensen", "Luca Bertolini", "Íñigo Sarasola", "Tomas Nyholm", "Ruben De Waele"];

// Deep-clone seed én gang pr. session (module-scope state).
const state = JSON.parse(JSON.stringify(SEED_CLUB));

function util(staffTier) { return staffTier == null ? 0.5 : 0.5 + 0.1 * staffTier; }

function facilitiesPayload() {
  return {
    facilities: TRACKS.map((track) => {
      const f = state.facilities[track];
      const upgradePrice = f.tier >= 5 ? null : PRICE[f.tier + 1];
      const staffTier = f.staff?.tier ?? null;
      return {
        track, tier: f.tier, upgradePrice, tierUpkeep: UPKEEP[f.tier],
        staff: f.staff ? { name: f.staff.name, tier: f.staff.tier, salary: SALARY[f.staff.tier] } : null,
        effectiveBonus: (BASE_EFFECT[track][f.tier] || 0) * util(staffTier),
        effectLive: false,
      };
    }),
  };
}

function candidatesFor(role) {
  const facTier = Math.max(1, state.facilities[role]?.tier || 0);
  return NAME_POOL.slice(0, 3).map((name, i) => {
    const tier = 1 + (i % facTier);
    return { name, role, tier, salary: SALARY[tier] };
  });
}

// Router: (method, pathname, search, body) → { status, body }.
export function clubMockRoute(method, pathname, search, body) {
  if (pathname.endsWith("/api/club/facilities") && method === "GET") return { status: 200, body: facilitiesPayload() };
  if (pathname.endsWith("/api/club/facilities/upgrade") && method === "POST") {
    const track = body?.track;
    const f = state.facilities[track];
    if (!f) return { status: 400, body: { error: "invalid_track" } };
    if (f.tier >= 5) return { status: 400, body: { error: "max_tier" } };
    f.tier += 1;
    return { status: 200, body: { ok: true, track, tier: f.tier, price: PRICE[f.tier] } };
  }
  if (pathname.endsWith("/api/club/staff/candidates") && method === "GET") {
    const role = new URLSearchParams(search).get("role");
    if (!TRACKS.includes(role)) return { status: 400, body: { error: "invalid_role" } };
    return { status: 200, body: { role, facilityTier: state.facilities[role].tier, candidates: candidatesFor(role) } };
  }
  if (pathname.endsWith("/api/club/staff/hire") && method === "POST") {
    const { role, candidateName } = body || {};
    const f = state.facilities[role];
    if (!f) return { status: 400, body: { error: "invalid_role" } };
    if (f.staff) return { status: 409, body: { error: "role_occupied" } };
    const cand = candidatesFor(role).find((c) => c.name === candidateName);
    if (!cand) return { status: 400, body: { error: "invalid_candidate" } };
    if (cand.tier > f.tier) return { status: 400, body: { error: "staff_tier_exceeds_facility" } };
    f.staff = { name: cand.name, tier: cand.tier };
    return { status: 200, body: { ok: true, staff: { ...cand, salary: SALARY[cand.tier] } } };
  }
  if (pathname.endsWith("/api/club/staff/fire") && method === "POST") {
    const { role } = body || {};
    const f = state.facilities[role];
    if (!f?.staff) return { status: 404, body: { error: "no_active_staff" } };
    const severance = Math.round(SALARY[f.staff.tier] * 0.5);
    f.staff = null;
    return { status: 200, body: { ok: true, severance } };
  }
  return null; // ikke en club-route
}

export const __constants = { PRICE, UPKEEP, SALARY, BASE_EFFECT };
