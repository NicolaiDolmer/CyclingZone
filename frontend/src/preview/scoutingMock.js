// Statefuld preview-mock for Scouting-centralen (#2244 Fase 3 + #2644). Mønster:
// clubMock.js/plannerMock.js — muterer in-memory state så ejerens gennemklik er
// ægte (start mission fylder køen, annullér tømmer den). Routes /api/scouting/me,
// /api/scouting/central, POST /api/scouting/assignments[/:id/cancel] samt
// POST /api/riders/names (batch-navneopslag som siden bruger til kø/shortlist).
//
// /api/scouting/estimates håndteres IKKE her (returnér null → falder igennem til
// den generiske /api-blok, uændret adfærd). Playwright-fixtures går uden om dette
// modul (de bruger apiResponse direkte), så snapshots påvirkes ikke.
//
// jobConfig/kapacitet/fejl-nøgler spejler backend/lib/scoutEngine.js
// (SCOUT_JOB_CONFIG, DEFAULT_SCOUT, canStartAssignment) — co-SSOT som clubMock.
import { RIDERS, TEST_TEAM, RIVAL_TEAM } from "./seedData.js";

const JOB_CONFIG = Object.freeze({
  targetEtaMinutes: 30,
  targetCostPerLevel: 1000,
  missionDays: 2,
  missionCost: 6000,
});

// Ingen hyret spejder i SEED_CLUB (scouting.staff = null) → default-spejderen,
// konsistent med Klub-fanen. Kapacitet 1 (overall < 80, jf. scoutCapacity).
const DEFAULT_SCOUT = Object.freeze({
  overall: 40,
  roleSkills: Object.freeze({ evaluation: 40, reach: 40 }),
  isDefault: true,
});
const CAPACITY = 1;

// Fiktive kontraktfrie ryttere til shortlist-feedet (#2644 del 2: status-labels).
// Egne ids (ikke i RIDERS) så seed-rosteret ikke røres; navne serveres via
// /api/riders/names-mocken nedenfor.
const FREE_AGENTS = Object.freeze({
  "scout-fa-1": "Jonas Vinter",
  "scout-fa-2": "Emil Nørgaard",
  "scout-fa-3": "Théo Lambert",
});

// Én afsluttet mission i seed så shortlist-feedet (inkl. topFind-badge og
// #2644-status-labels: kontraktfri vs. holdnavn) kan verificeres uden klik.
const SEED_COMPLETED = [
  {
    id: "scout-done-1",
    kind: "mission",
    mission_criteria: { scope: "country", value: "dk" },
    status: "completed",
    completed_at: "2026-07-16T09:00:00.000Z",
    result: {
      shortlist: ["scout-fa-1", "scout-fa-2", RIDERS[1].id],
      top_rider_id: "scout-fa-1",
    },
    riderStatus: {
      "scout-fa-1": { status: "free_agent" },
      "scout-fa-2": { status: "free_agent" },
      [RIDERS[1].id]: { status: "team", teamName: RIVAL_TEAM.name },
    },
  },
];

// Deep-clone seed én gang pr. session (module-scope state, samme mønster som clubMock).
const state = {
  active: [],
  completed: JSON.parse(JSON.stringify(SEED_COMPLETED)),
  nextId: 1,
};

function isoDatePlusDays(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function centralPayload() {
  return {
    teamId: TEST_TEAM.id,
    scout: { ...DEFAULT_SCOUT },
    active: state.active,
    completed: state.completed,
    capacity: CAPACITY,
    jobConfig: { ...JOB_CONFIG },
  };
}

function startAssignment(body) {
  // Spejler canStartAssignment-guarden (kapacitet før alt andet) med samme
  // fejl-nøgle som frontendens error.capacity-oversættelse forventer.
  if (state.active.length >= CAPACITY) return { status: 409, body: { ok: false, error: "capacity" } };

  const kind = body?.kind;
  let assignment;
  if (kind === "target") {
    if (!body?.riderId) return { status: 400, body: { ok: false, error: "failed" } };
    assignment = {
      id: `scout-mock-${state.nextId++}`,
      kind: "target",
      rider_id: body.riderId,
      status: "active",
      ready_on: isoDatePlusDays(0),
    };
  } else if (kind === "mission") {
    if (!body?.criteria?.scope) return { status: 400, body: { ok: false, error: "failed" } };
    assignment = {
      id: `scout-mock-${state.nextId++}`,
      kind: "mission",
      mission_criteria: body.criteria,
      status: "active",
      ready_on: isoDatePlusDays(JOB_CONFIG.missionDays),
    };
  } else {
    return { status: 400, body: { ok: false, error: "failed" } };
  }

  state.active.push(assignment);
  return { status: 200, body: { ok: true, assignment } };
}

function cancelAssignment(assignmentId) {
  const idx = state.active.findIndex((a) => a.id === assignmentId);
  if (idx === -1) return { status: 404, body: { ok: false, error: "failed" } };
  state.active.splice(idx, 1);
  return { status: 200, body: { ok: true } };
}

function riderNames(body) {
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const riders = ids
    .map((id) => {
      if (FREE_AGENTS[id]) return { id, name: FREE_AGENTS[id] };
      const r = RIDERS.find((rider) => rider.id === id);
      if (r) return { id, name: [r.firstname, r.lastname].filter(Boolean).join(" ") || null };
      return null;
    })
    .filter(Boolean);
  return { status: 200, body: { riders } };
}

// Router — returnér null for alt vi ikke håndterer (fx /api/scouting/estimates),
// så kaldet falder videre til de generiske /api-blokke i installPreviewMock.
export function scoutingMockRoute(method, pathname, body) {
  if (method === "GET" && pathname.endsWith("/api/scouting/me")) {
    // Gamle slots-felter bevaret (spejler det ægte endpoints spread af slots-state)
    // + scoutSystemEnabled: true, så useScoutingCentral åbner siden i preview.
    return {
      status: 200,
      body: { slots: { total: 3, used: 0, remaining: 3 }, maxLevel: 3, levels: {}, teamId: TEST_TEAM.id, scoutSystemEnabled: true },
    };
  }
  if (method === "GET" && pathname.endsWith("/api/scouting/central")) {
    return { status: 200, body: centralPayload() };
  }
  if (method === "POST" && pathname.endsWith("/api/scouting/assignments")) {
    return startAssignment(body);
  }
  if (method === "POST" && /\/api\/scouting\/assignments\/[^/]+\/cancel$/.test(pathname)) {
    const id = pathname.split("/").slice(-2)[0];
    return cancelAssignment(id);
  }
  if (method === "POST" && pathname.endsWith("/api/riders/names")) {
    return riderNames(body);
  }
  return null;
}
