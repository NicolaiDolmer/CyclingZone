// Statefuld preview-mock for Season Planner (/planner) — #1834-test-flow.
//
// Bag VITE_PREVIEW_MOCK: gør at ejeren kan klikke HELE peak-planner-flowet igennem
// på en preview med ægte-agtige ryttere/løb FØR launch-flaget flippes — sæt peak,
// om-målret (drag/select), fjern, auto-plan træning. In-memory state muteres pr.
// kald (deep-clone af seed ved session-start), præcis som clubMock.js. Selv-
// indeholdt (seed + state + routing i én fil) — planner-seed genbruges intet andet
// sted. Serverer board'et i SAMME form som GET /api/peak-plans/board.

const DAY_MS = 86_400_000;
const LEADUP = 14, MAX_PER_RIDER = 2, RADIUS = 2, LOCK_LEAD = 3;
const TODAY = "2026-06-01"; // fast "nu" så form-kurver/lås er deterministiske i preview

function ord(iso) { return Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS; }
function addDays(iso, n) { return new Date(ord(iso) * DAY_MS + n * DAY_MS).toISOString().slice(0, 10); }

const BUILD_WEEK = { mon: { intensity: "hard" }, tue: { intensity: "normal" }, wed: { intensity: "hard" }, thu: { intensity: "normal" }, fri: { intensity: "hard" }, sat: { intensity: "normal" }, sun: { intensity: "rest" } };
const TAPER_WEEK = { mon: { intensity: "normal" }, tue: { intensity: "easy" }, wed: { intensity: "normal" }, thu: { intensity: "easy" }, fri: { intensity: "easy" }, sat: { intensity: "rest" }, sun: { intensity: "rest" } };

const DEMANDS = {
  flat: { sprint: 0.61, acceleration: 0.15, flat: 0.06, positioning: 0.08, endurance: 0.02, randomness: 0.08 },
  hilly: { punch: 0.35, climbing: 0.2, tempo: 0.15, endurance: 0.1, positioning: 0.08, randomness: 0.12 },
  mountain: { climbing: 0.5, tempo: 0.12, endurance: 0.14, recovery: 0.06, punch: 0.04, tactics: 0.02, positioning: 0.02, randomness: 0.1 },
  itt: { time_trial: 0.58, positioning: 0.24, flat: 0.06, randomness: 0.12 },
};
const FOCUS_FOR = { flat: "sprint", hilly: "vo2max", mountain: "vo2max", itt: "aero" };

function ability(over = {}) {
  const base = { climbing: 38, time_trial: 38, sprint: 38, punch: 40, endurance: 46, cobblestone: 36, acceleration: 40, recovery: 44, tactics: 42, positioning: 46, flat: 40, tempo: 42, durability: 44, aggression: 38, descending: 42 };
  return { ...base, ...over };
}

function mountainStages(n, summits) {
  const terrains = ["flat", "hilly", "mountain", "hilly", "itt", "mountain", "flat", "mountain"];
  return Array.from({ length: n }, (_, i) => {
    const terrain = terrains[i % terrains.length];
    const summit = terrain === "mountain" && summits > 0 && (i % 2 === 0);
    return { stage: i + 1, terrain, summit };
  });
}

function raceProfileSummary(strip) {
  return { stages: strip.length, summitFinishes: strip.filter((s) => s.summit).length };
}

function makeRace(id, name, terrain, date, isMine, stages, summits, division, rivalPeakCount) {
  const strip = stages > 1 ? mountainStages(stages, summits) : [{ stage: 1, terrain, summit: terrain === "mountain" }];
  return {
    id, name, raceClass: stages > 1 ? "WorldTour" : "ProSeries", division, isMine,
    date, gameDayStart: ord(date), gameDayEnd: ord(date) + (stages - 1), stages, terrain,
    stageProfiles: strip, profileSummary: raceProfileSummary(strip),
    demandVector: DEMANDS[terrain] || DEMANDS.flat, rivalPeakCount,
  };
}

const RACES = [
  makeRace("r-coastal", "Coastal Sprint", "flat", "2026-04-20", true, 1, 0, 3, 1),
  makeRace("r-hill", "Hill GP", "hilly", "2026-05-10", true, 1, 0, 3, 2),
  makeRace("r-alpine", "Alpine Classic", "mountain", "2026-06-14", true, 6, 2, 3, 3),
  makeRace("r-nat", "Nationals TT", "itt", "2026-06-25", false, 1, 0, 2, 0),
  makeRace("r-tour", "Grand Tour", "mountain", "2026-07-15", true, 8, 3, 3, 4),
  makeRace("r-monument", "Autumn Monument", "hilly", "2026-09-05", true, 1, 0, 3, 1),
];
const RACE_BY_ID = new Map(RACES.map((r) => [r.id, r]));

// #2447: nationalitet som rigtig 2-bogstavs ISO-kode (lowercase) — matcher
// riders.nationality_code i produktion (samme format Flag-komponenten kræver).
// Var tidligere 3-bogstavs pseudo-koder ("BEL"/"NOR"/...) der aldrig ville have
// matchet Flag'ens /^[a-z]{2}$/-regex, og derfor ville have vist INGEN flag i
// preview/E2E-skærmbilleder efter denne PR's Flag-genbrug.
const RIDERS = [
  { id: "rd-verm", firstname: "Lars", lastname: "Vermeulen", nationality: "be", primaryType: "climber", secondaryType: "puncheur", isAcademy: true, form: 54, fatigue: 22, injuredUntil: null, abilities: ability({ climbing: 74, tempo: 62, endurance: 60, recovery: 56, punch: 52 }) },
  { id: "rd-krist", firstname: "Henrik", lastname: "Kristiansen", nationality: "no", primaryType: "sprinter", secondaryType: null, isAcademy: false, form: 60, fatigue: 30, injuredUntil: null, abilities: ability({ sprint: 76, acceleration: 70, flat: 58, positioning: 56, climbing: 30 }) },
  { id: "rd-soren", firstname: "Mikkel", lastname: "Sørensen", nationality: "dk", primaryType: "puncheur", secondaryType: "climber", isAcademy: false, form: 50, fatigue: 26, injuredUntil: null, abilities: ability({ punch: 66, tempo: 60, climbing: 50, endurance: 54 }) },
  { id: "rd-novak", firstname: "Tomaz", lastname: "Novak", nationality: "si", primaryType: "gc", secondaryType: "tt", isAcademy: true, form: 57, fatigue: 24, injuredUntil: null, abilities: ability({ climbing: 72, time_trial: 66, tempo: 62, recovery: 58, endurance: 58 }) },
  { id: "rd-bianchi", firstname: "Giulio", lastname: "Bianchi", nationality: "it", primaryType: "rouleur", secondaryType: null, isAcademy: false, form: 48, fatigue: 20, injuredUntil: null, abilities: ability({ flat: 62, endurance: 60, tempo: 54 }) },
];

let counter = 0;
function nextId() { return `pk-${++counter}`; }

function makePeak(riderId, raceId, tq) {
  const race = RACE_BY_ID.get(raceId);
  const windowStart = addDays(race.date, -RADIUS);
  const windowEnd = addDays(race.date, RADIUS);
  const focus = FOCUS_FOR[race.terrain] || "endurance";
  return {
    id: nextId(), riderId, seasonId: "season-preview", targetRaceId: raceId, targetRaceName: race.name,
    windowStart, windowEnd, lockedAt: null, createdAt: TODAY,
    trainingQuality: tq,
    recommendedFocus: focus,
    suggestedTrainingBlock: { recommendedFocus: focus, leadupDays: LEADUP, weekRhythms: { build: BUILD_WEEK, taper: TAPER_WEEK } },
  };
}

function seedPeaks() {
  return [
    makePeak("rd-verm", "r-alpine", 0.93),   // on_track (active)
    makePeak("rd-krist", "r-alpine", 0.55),   // at_risk (active)
    makePeak("rd-krist", "r-coastal", 0.7),   // locked (past)
    makePeak("rd-soren", "r-tour", 0.62),     // pending (lead-up not started)
  ];
}

let peaks = null;
function ensure() { if (!peaks) peaks = seedPeaks(); }

function locked(p) { return ord(p.windowStart) - ord(TODAY) <= LOCK_LEAD; }
function status(p) {
  if (ord(TODAY) < ord(p.windowStart) - LEADUP) return "pending";
  return p.trainingQuality >= 0.6 ? "on_track" : "at_risk";
}
function serialize(p) {
  return { ...p, locked: locked(p), status: status(p) };
}

function buildBoard(peakList) {
  return {
    enabled: true,
    season: { id: "season-preview", number: 1 },
    maxPerRider: MAX_PER_RIDER,
    today: TODAY,
    leadupDays: LEADUP,
    riders: RIDERS.map((r) => ({ ...r, peaks: peakList.filter((p) => p.riderId === r.id).map(serialize) })),
    races: RACES,
  };
}

function board() { return buildBoard(peaks); }

// Statisk, deterministisk board til read-only E2E-smoke (fixtures.installNetworkMocks).
// Bygger fra en frisk seed uden at røre den stateful preview-state, så Playwright og
// det interaktive preview-gennemklik ikke deler mutation.
export function previewPlannerBoard() { return buildBoard(seedPeaks()); }

/**
 * Rout /api/peak-plans* mod den in-memory-preview-state. Returnerer { status, body }
 * eller null (umatchet → kalderen falder tilbage til generisk mock/ægte fetch).
 */
export function plannerMockRoute(method, pathname, _search, body) {
  ensure();
  const m = pathname.match(/^\/api\/peak-plans(?:\/([^/]+)(?:\/(accept-training))?)?$/);
  if (!m) return null;
  const seg = m[1], sub = m[2];

  if (seg === "board" && method === "GET") return { status: 200, body: board() };
  if (!seg && method === "GET") return { status: 200, body: { enabled: true, season: board().season, maxPerRider: MAX_PER_RIDER, plans: peaks.map(serialize) } };

  // POST /api/peak-plans — opret.
  if (!seg && method === "POST") {
    const riderId = body?.rider_id, raceId = body?.target_race_id;
    const rider = RIDERS.find((r) => r.id === riderId);
    if (!rider) return { status: 404, body: { error: "Rider not found" } };
    const mine = peaks.filter((p) => p.riderId === riderId);
    if (mine.some((p) => p.targetRaceId === raceId)) return { status: 409, body: { error: "duplicate_target" } };
    if (mine.length >= MAX_PER_RIDER) return { status: 409, body: { error: "max_reached" } };
    const race = RACE_BY_ID.get(raceId);
    if (!race) return { status: 404, body: { error: "race_not_found" } };
    if (!race.isMine) return { status: 403, body: { error: "race_not_in_calendar" } };
    const p = makePeak(riderId, raceId, 0.72);
    peaks.push(p);
    return { status: 200, body: { ok: true, plan: serialize(p), suggestedTrainingBlock: p.suggestedTrainingBlock } };
  }

  // POST /api/peak-plans/:id/accept-training.
  if (seg && sub === "accept-training" && method === "POST") {
    const p = peaks.find((x) => x.id === seg);
    if (!p) return { status: 404, body: { error: "plan_not_found" } };
    const week = body?.week;
    if (week !== "build" && week !== "taper") return { status: 400, body: { error: "invalid_week" } };
    return { status: 200, body: { ok: true, riderId: p.riderId, week, days: p.suggestedTrainingBlock.weekRhythms[week], recommendedFocus: p.recommendedFocus } };
  }

  // PATCH /api/peak-plans/:id — om-målret.
  if (seg && method === "PATCH") {
    const p = peaks.find((x) => x.id === seg);
    if (!p) return { status: 404, body: { error: "plan_not_found" } };
    if (locked(p)) return { status: 409, body: { error: "locked" } };
    const raceId = body?.target_race_id;
    const race = RACE_BY_ID.get(raceId);
    if (!race) return { status: 404, body: { error: "race_not_found" } };
    if (!race.isMine) return { status: 403, body: { error: "race_not_in_calendar" } };
    if (peaks.some((x) => x.id !== p.id && x.riderId === p.riderId && x.targetRaceId === raceId)) return { status: 409, body: { error: "duplicate_target" } };
    p.targetRaceId = raceId; p.targetRaceName = race.name;
    p.windowStart = addDays(race.date, -RADIUS); p.windowEnd = addDays(race.date, RADIUS);
    const focus = FOCUS_FOR[race.terrain] || "endurance";
    p.recommendedFocus = focus; p.suggestedTrainingBlock.recommendedFocus = focus;
    return { status: 200, body: { ok: true, plan: serialize(p), suggestedTrainingBlock: p.suggestedTrainingBlock } };
  }

  // DELETE /api/peak-plans/:id.
  if (seg && method === "DELETE") {
    const idx = peaks.findIndex((x) => x.id === seg);
    if (idx === -1) return { status: 404, body: { error: "plan_not_found" } };
    if (locked(peaks[idx])) return { status: 409, body: { error: "locked" } };
    peaks.splice(idx, 1);
    return { status: 200, body: { ok: true, id: seg } };
  }

  return null;
}
