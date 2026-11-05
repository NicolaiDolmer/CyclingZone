// #7686 · Preview af Udvikling 2.0 tal + ord, uden at backendens trin 4 skal være
// tændt. ?potentialEstimate=on slår visningen til (huskes i localStorage, samme
// mønster som ?youthSquads), =off slår den fra. Standard er off, så Playwright-
// fixtures og snapshots er uændrede. ?potentialState=unsure|fair|sure|learning|unscouted
// viser den tilstand på alle ryttere, =mix går tilbage til blandingen.
//
// Svarene følger kontrakten: tændt = `potentialView`, og lo/hi/prog/ceil/loft og
// prognosen er fjernet, så et preview ikke kan se rigtigt ud på gamle felter.
// Alle tal er opdigtede illustrationer.

const KEY = "cz_mock_potential_estimate";
const STATE_KEY = "cz_mock_potential_state";

export function previewPotentialEstimateEnabled() {
  try {
    const param = new URLSearchParams(window.location.search).get("potentialEstimate");
    if (param === "on") localStorage.setItem(KEY, "1");
    if (param === "off") localStorage.setItem(KEY, "0");
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Læses ved indlæsning, så parameteren virker på enhver side, også en der straks
// omdirigerer og derfor aldrig når at spørge mocken.
previewPotentialEstimateEnabled();

function forcedState() {
  try {
    const param = new URLSearchParams(window.location.search).get("potentialState");
    if (param === "mix") localStorage.removeItem(STATE_KEY);
    else if (param) localStorage.setItem(STATE_KEY, param);
    return localStorage.getItem(STATE_KEY);
  } catch {
    return null;
  }
}
forcedState();

const shown = (value, certainty) => ({
  hidden: false, value, certainty, previousValue: null, previousCertainty: null, changedAt: null,
});

// Fast rækkefølge, så hver tabel viser alle fire tilstande uden at ramme samme
// rytter forskelligt fra flade til flade (H5: samme tal overalt).
const STATES = [
  shown(74, "unsure"),
  shown(61, "fair"),
  shown(68, "sure"),
  { hidden: true, reason: "learning", trainings: 3, trainingsNeeded: 5 },
  { hidden: true, reason: "unscouted" },
];

const FIXED = {
  "rider-1": shown(46, "sure"),
  "rider-2": shown(58, "unsure"),
};

const FORCED = {
  unsure: shown(58, "unsure"),
  fair: shown(52, "fair"),
  sure: shown(46, "sure"),
  learning: STATES[3],
  unscouted: STATES[4],
};

function hash(id) {
  let sum = 0;
  for (const char of String(id)) sum = (sum * 31 + char.charCodeAt(0)) % 9973;
  return sum;
}

function viewFor(id) {
  return FORCED[forcedState()] ?? FIXED[id] ?? STATES[hash(id) % STATES.length];
}

export function previewEstimate(id, seed) {
  const view = viewFor(id);
  return {
    level: view.hidden ? 0 : seed?.level || 1,
    role: seed?.role ?? null,
    now: seed?.now ?? null,
    potentialView: view,
  };
}

export function previewReport(id, seed, own) {
  const view = viewFor(id);
  return {
    level: view.hidden ? 0 : own ? seed.maxLevel : 1,
    maxLevel: seed.maxLevel,
    own,
    looks: view.hidden ? 0 : 1,
    scout: seed.scout,
    potentialView: view,
  };
}

export function previewProjection(id, seed) {
  const view = viewFor(id);
  if (view.hidden) return { level: 0, maxLevel: seed.maxLevel, own: seed.own, potentialView: view, estimateLine: [] };
  const steps = 6;
  return {
    level: seed.level,
    maxLevel: seed.maxLevel,
    own: seed.own,
    now: seed.now,
    primaryKey: seed.primaryKey,
    potentialView: view,
    estimateLine: Array.from({ length: steps + 1 }, (_, season) => ({
      season,
      value: Math.round(seed.now + ((view.value - seed.now) * season) / steps),
    })),
  };
}
