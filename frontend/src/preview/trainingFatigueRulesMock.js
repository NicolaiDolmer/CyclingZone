// #4854/#5620 · preview-mock for /api/training/fatigue-rules (traethedsgraense, beta).
//
// Kun i installPreviewMock.js (ikke mockHandlers.js), saa Playwright-snapshots af
// /training ikke flytter sig. Funktionen er ON paa preview (override af den aegte
// beta-gate), saa ejeren kan se og gennemklikke den foer flaget flyttes.
// ?fatigueRule=off giver dagens Ugeplan-fane til et foer/efter-par.
// Statefuld i hukommelsen; roster og stempler er fiktive preview-data.

const DAYS = 7;

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysBack(n) {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return isoDate(d);
  });
}

const ROSTER = [
  { id: "rider-1", name: "Ada Pedersen", fatigue: 38 },
  { id: "rider-2", name: "Mikkel Hansen", fatigue: 51 },
  { id: "pv-fr-3", name: "Sofie Lund", fatigue: 74 },
  { id: "pv-fr-4", name: "Jonas Berg", fatigue: 66 },
  { id: "pv-fr-5", name: "Emil Kjær", fatigue: 29 },
  { id: "pv-fr-6", name: "Lukas Holm", fatigue: 81 },
];

const state = {
  team: { threshold: 65, fallback: "rest", recoveryAfterStage: true },
  riders: { "pv-fr-6": { threshold: 75, fallback: "recovery", recoveryAfterStage: null } },
};

function recent(days) {
  const [, , d3, , d5, d6, d7] = days;
  return [
    { date: d3, gameDay: 10, riderId: "pv-fr-3", kind: "after_stage", fallback: "recovery", fatigue: 58, threshold: null },
    { date: d5, gameDay: 20, riderId: "pv-fr-3", kind: "fatigue", fallback: "rest", fatigue: 71, threshold: 65 },
    { date: d5, gameDay: 20, riderId: "pv-fr-6", kind: "fatigue", fallback: "recovery", fatigue: 79, threshold: 75 },
    { date: d6, gameDay: 25, riderId: "pv-fr-6", kind: "fatigue", fallback: "recovery", fatigue: 83, threshold: 75 },
    { date: d7, gameDay: 30, riderId: "pv-fr-3", kind: "fatigue", fallback: "rest", fatigue: 74, threshold: 65 },
    { date: d7, gameDay: 30, riderId: "pv-fr-4", kind: "fatigue", fallback: "rest", fatigue: 66, threshold: 65 },
    { date: d7, gameDay: 30, riderId: "pv-fr-6", kind: "fatigue", fallback: "recovery", fatigue: 81, threshold: 75 },
  ];
}

export function previewFatigueRulesEnabled() {
  try {
    const param = new URLSearchParams(window.location.search).get("fatigueRule");
    if (param === "on") localStorage.setItem("cz_mock_fatigue_rule", "1");
    if (param === "off") localStorage.setItem("cz_mock_fatigue_rule", "0");
    return localStorage.getItem("cz_mock_fatigue_rule") !== "0";
  } catch {
    return true;
  }
}

export function trainingFatigueRulesMockRoute(method, pathname, body) {
  if (!/^\/api\/training\/fatigue-rules(\/|$)/.test(pathname)) return null;
  if (!previewFatigueRulesEnabled()) {
    return method === "GET" ? { status: 200, body: { enabled: false } } : { status: 404, body: { error: "not_found" } };
  }
  if (method === "GET") {
    const days = daysBack(DAYS);
    return {
      status: 200,
      body: { enabled: true, today: days.at(-1), days, team: state.team, riders: state.riders, roster: ROSTER, recent: recent(days) },
    };
  }
  if (method === "PUT" && pathname.endsWith("/team")) {
    const { threshold = null, fallback = null, recoveryAfterStage = false } = body ?? {};
    state.team = threshold == null && !recoveryAfterStage ? null : { threshold, fallback, recoveryAfterStage };
    return { status: 200, body: { ok: true } };
  }
  const m = pathname.match(/\/riders\/([^/]+)$/);
  if (method === "PUT" && m) {
    const { mode, threshold = null, fallback = null } = body ?? {};
    if (mode === "team") delete state.riders[m[1]];
    else state.riders[m[1]] = mode === "own"
      ? { threshold, fallback, recoveryAfterStage: null }
      : { threshold: null, fallback: "off", recoveryAfterStage: null };
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { error: "not_found" } };
}
