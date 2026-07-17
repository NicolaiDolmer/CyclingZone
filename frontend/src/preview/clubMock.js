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
// Plan B (#1441) + #2530: 1:1-spejling af backend/lib/facilityConstants.js'
// EFFECT_LIVE_BY_TRACK (co-SSOT, parity-testet i clubMock.parity.test.js) så
// ejerens preview ALDRIG viser en anden facilitets-status end prod.
const EFFECT_LIVE_BY_TRACK = { training: true, scouting: true, medical: false, academy: false, commercial: false };
const NAME_POOL = ["Marc Vandenbroucke", "Henrik Sørensen", "Luca Bertolini", "Íñigo Sarasola", "Tomas Nyholm", "Ruben De Waele"];

// #2220 A4b: preview-repræsentative evner. Overall-bånd pr. tier (spejler backendens
// TIER_OVERALL_BAND-midtpunkter groft) + rolle-akser (spejler lib/staffAbilities.js).
// Ikke backendens deterministiske derivation — kun plausible tal så profil-flowet kan
// klikkes igennem i preview. staff.id = `staff-<track>` (1 aktiv pr. spor).
const OVERALL_BY_TIER = { 1: 36, 2: 52, 3: 63, 4: 74, 5: 82 };
const DIMENSIONS = ["physical", "mental", "technical"];
const LEVELS = ["u23", "senior"]; // #2529: youth+junior kollapset til u23
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
    // #2311 (Slice 2): tier-preview før køb — samme formel som backend (base[tier+1] × util),
    // null ved max tier (co-SSOT med facilityRoutesHandlers.js, dækket af parity-test).
    const nextTierBonus = f.tier >= 5 ? null : (BASE_EFFECT[track][f.tier + 1] || 0) * util(staffTier);
    return {
      track, tier: f.tier, upgradePrice, tierUpkeep: UPKEEP[f.tier],
      // #2220 A4b: staff bærer nu id (dyb-link) + overall (rating-cirkel/sammenligning).
      staff: f.staff ? { id: `staff-${track}`, name: f.staff.name, tier: f.staff.tier, salary: SALARY[f.staff.tier], overall: OVERALL_BY_TIER[f.staff.tier] } : null,
      effectiveBonus: (BASE_EFFECT[track][f.tier] || 0) * util(staffTier),
      nextTierBonus,
      // Plan B (#1441) + #2530: training + scouting er wired i deres respektive
      // motorer → live. Spejler backend/lib/facilityConstants.js EFFECT_LIVE_BY_TRACK
      // (co-SSOT, dækket af clubMock.parity.test.js) så ejerens preview ALDRIG
      // viser en anden facilitets-status end prod.
      effectLive: EFFECT_LIVE_BY_TRACK[track] ?? false,
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

// #2450: personale-oversigt på tværs af hold. Preview har kun ét "rigtigt" team
// (ejerens egen klub-state) — de øvrige rækker er en statisk, plausibel andre-
// hold-pulje så oversigt + public-profil-fallback kan klikkes igennem uden en
// ægte flerklub-backend. Egen staff (id `staff-<track>`) rammer stadig FØRST
// /api/club/staff/:id (fuld matrix); disse `other-staff-N`-id'er 404'er der og
// falder korrekt tilbage til /api/staff/:id/public (samme flow som prod).
const OTHER_TEAMS = [
  { id: "team-other-1", name: "Rocourt Cycling", division: 2 },
  { id: "team-other-2", name: "Nordkyst Racing", division: 1 },
  { id: "team-other-3", name: "Sud-Ouest CC", division: 3 },
];
const OTHER_STAFF_SEED = [
  { team: OTHER_TEAMS[0], role: "training", tier: 4, name: "Elena Sarti" },
  { team: OTHER_TEAMS[0], role: "medical", tier: 2, name: "Karel Novotny" },
  { team: OTHER_TEAMS[1], role: "scouting", tier: 5, name: "Aldo Terranova" },
  { team: OTHER_TEAMS[2], role: "commercial", tier: 3, name: "Ingrid Solheim" },
];

function directoryPayload() {
  const own = TRACKS.map((track) => {
    const f = state.facilities[track];
    if (!f.staff) return null;
    const ab = abilitiesFor(track, f.staff.tier, f.staff.name);
    return {
      id: `staff-${track}`, name: f.staff.name, role: track, tier: f.staff.tier, salary: SALARY[f.staff.tier],
      overall: ab.overall, topSpecialization: topAxisKey(ab),
      teamId: "own-team", teamName: "Dit hold", division: 2, isAiTeam: false,
    };
  }).filter(Boolean);
  const others = OTHER_STAFF_SEED.map((s, i) => {
    const ab = abilitiesFor(s.role, s.tier, s.name);
    return {
      id: `other-staff-${i}`, name: s.name, role: s.role, tier: s.tier, salary: SALARY[s.tier],
      overall: ab.overall, topSpecialization: topAxisKey(ab),
      teamId: s.team.id, teamName: s.team.name, division: s.team.division, isAiTeam: false,
    };
  });
  return { staff: [...own, ...others] };
}

// Router: (method, pathname, search, body) → { status, body }.
export function clubMockRoute(method, pathname, search, body) {
  if (pathname.endsWith("/api/staff/directory") && method === "GET") return { status: 200, body: directoryPayload() };
  if (/\/api\/staff\/([^/]+)\/public$/.test(pathname) && method === "GET") {
    const id = pathname.match(/\/api\/staff\/([^/]+)\/public$/)[1];
    const row = directoryPayload().staff.find((s) => s.id === id);
    if (!row) return { status: 404, body: { error: "staff_not_found" } };
    return { status: 200, body: row };
  }
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

export const __constants = { PRICE, UPKEEP, SALARY, BASE_EFFECT, EFFECT_LIVE_BY_TRACK };
