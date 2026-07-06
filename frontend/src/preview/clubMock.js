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

// #2220 A4b: preview-repræsentative evner. Overall-bånd pr. tier (spejler backendens
// TIER_OVERALL_BAND-midtpunkter groft) + rolle-akser (spejler lib/staffAbilities.js).
// Ikke backendens deterministiske derivation — kun plausible tal så profil-flowet kan
// klikkes igennem i preview. staff.id = `staff-<track>` (1 aktiv pr. spor).
const OVERALL_BY_TIER = { 1: 36, 2: 52, 3: 63, 4: 74, 5: 82 };
const DIMENSIONS = ["physical", "mental", "technical"];
const LEVELS = ["youth", "junior", "senior"];
const ROLE_SKILLS = {
  training: [],
  scouting: ["evaluation", "reach"],
  medical: ["recovery", "injuryPrevention"],
  academy: ["intake", "growth"],
  commercial: ["negotiation", "marketing"],
};

// Deep-clone seed én gang pr. session (module-scope state).
const state = JSON.parse(JSON.stringify(SEED_CLUB));

function util(staffTier) { return staffTier == null ? 0.5 : 0.5 + 0.1 * staffTier; }

function hashish(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
function clampAxis(v) { return Math.max(1, Math.min(99, Math.round(v))); }

// Evne-profil for preview: primær-kolonnens første akse boostes (+12) så
// specialiserings-headline er meningsfuld; niveauer ligger lidt lavere.
function abilitiesFor(role, tier, name) {
  const overall = OVERALL_BY_TIER[tier] ?? 40;
  const seed = hashish(`${role}:${tier}:${name}`);
  const val = (axis, base) => clampAxis(base + ((hashish(String(axis) + seed) % 11) - 5));
  const dimensions = {};
  const roleSkills = {};
  const levels = {};
  const primary = role === "training" ? DIMENSIONS : ROLE_SKILLS[role];
  const target = role === "training" ? dimensions : roleSkills;
  primary.forEach((k, i) => { target[k] = val(k, overall + (i === 0 ? 12 : 0)); });
  LEVELS.forEach((k) => { levels[k] = val(k, overall - 3); });
  return { overall, dimensions, levels, roleSkills };
}

// Højest-scorende akse (spejler frontendens topStaffAxis) → akse-nøgle | null.
function topAxisKey(ab) {
  const entries = [
    ...Object.entries(ab.dimensions || {}),
    ...Object.entries(ab.levels || {}),
    ...Object.entries(ab.roleSkills || {}),
  ];
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function facilitiesPayload() {
  const facilities = TRACKS.map((track) => {
    const f = state.facilities[track];
    const upgradePrice = f.tier >= 5 ? null : PRICE[f.tier + 1];
    const staffTier = f.staff?.tier ?? null;
    return {
      track, tier: f.tier, upgradePrice, tierUpkeep: UPKEEP[f.tier],
      // #2220 A4b: staff bærer nu id (dyb-link) + overall (rating-cirkel/sammenligning).
      staff: f.staff ? { id: `staff-${track}`, name: f.staff.name, tier: f.staff.tier, salary: SALARY[f.staff.tier], overall: OVERALL_BY_TIER[f.staff.tier] } : null,
      effectiveBonus: (BASE_EFFECT[track][f.tier] || 0) * util(staffTier),
      // Plan B (#1441): training-effekten er wired i trænings-motoren → live.
      effectLive: track === "training",
    };
  });
  // #2220 A4b: sæson-omkostnings-resume (upkeep + payroll vs. saldo).
  const totalUpkeep = facilities.reduce((s, fac) => s + (fac.tierUpkeep || 0), 0);
  const totalPayroll = facilities.reduce((s, fac) => s + (fac.staff ? fac.staff.salary : 0), 0);
  return { facilities, seasonCost: { totalUpkeep, totalPayroll, balance: 500000 } };
}

function candidatesFor(role) {
  const facTier = Math.max(1, state.facilities[role]?.tier || 0);
  return NAME_POOL.slice(0, 3).map((name, i) => {
    const tier = 1 + (i % facTier);
    // #2220 A4b: kandidater bærer overall + topSpecialization til sammenligning.
    const ab = abilitiesFor(role, tier, name);
    return { name, role, tier, salary: SALARY[tier], overall: ab.overall, topSpecialization: topAxisKey(ab) };
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
  // #2220 A4b: GET /api/club/staff/:id — fuld evne-profil (id = `staff-<track>`).
  // Efter candidates-tjekket ovenfor, så /candidates ikke fanges her.
  if (/\/api\/club\/staff\/[^/]+$/.test(pathname) && !pathname.endsWith("/candidates") && method === "GET") {
    const id = pathname.split("/").pop();
    const track = id.replace(/^staff-/, "");
    const f = state.facilities[track];
    if (!f?.staff) return { status: 404, body: { error: "staff_not_found" } };
    const abilities = abilitiesFor(track, f.staff.tier, f.staff.name);
    return { status: 200, body: { role: track, tier: f.staff.tier, salary: SALARY[f.staff.tier], name: f.staff.name, abilities } };
  }
  return null; // ikke en club-route
}

export const __constants = { PRICE, UPKEEP, SALARY, BASE_EFFECT };
