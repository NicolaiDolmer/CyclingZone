// #7535 · Preview-seed til planlaegningssiden (/planning/workbench). KUN til lokal/preview-mocken
// (VITE_PREVIEW_MOCK), aldrig til prod. Datoerne er relative til i dag, saa siden altid har et
// "naeste 7 dage" at vise; loebsdage deles bevidst mellem nogle loeb, saa overlap og ugeoversigtens
// baner kan ses. Rytternavne og tal er opdigtet eksempeldata (ikke spillere).
import { SEED_STAGE_PROFILES } from "./seedData.js";

export function isWorkbenchPreview() {
  try {
    return typeof window !== "undefined" && window.location.pathname.startsWith("/planning/workbench");
  } catch {
    return false;
  }
}

function copenhagenToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = copenhagenToday();
const G0 = 200; // loebsdag for i dag
const gd = (offset) => G0 + offset;

// [id, navn, klasse, etapetyper, startOffset, slutOffset]
const RACE_DEFS = [
  ["wb-piceno", "Giro del Piceno", "Class1", ["flat"], 0, 0],
  ["wb-dender", "Omloop van de Denderstreek", "Class2", ["rolling"], 1, 1],
  ["wb-preview", "Tour de Preview", "ProSeries", ["flat", "mountain", "high_mountain", "itt"], 1, 4],
  ["wb-wallonie", "Grand Prix de Wallonie", "Class1", ["mountain"], 3, 3],
  ["wb-rovigo", "Gran Premio di Rovigo", "Class1", ["flat"], 5, 5],
  ["wb-navarra", "Vuelta a Navarra", "ProSeries", ["rolling", "flat", "mountain", "itt", "high_mountain"], 6, 10],
  ["wb-crit", "Criterium Preview", "Class2", ["flat"], 7, 7],
  ["wb-appenninica", "Coppa Appenninica", "Class1", ["high_mountain"], 12, 12],
  ["wb-jura", "Tour du Jura", "ProSeries", ["flat", "itt", "mountain", "high_mountain"], 14, 17],
  ["wb-kempen", "Klassieker van de Kempen", "Class2", ["flat"], 18, 18],
];

const ONE_DAY_SIZE = 6;
const STAGE_RACE_SIZE = 8;

const RACES = RACE_DEFS.map(([id, name, raceClass, types, start, end]) => ({
  id,
  name,
  raceClass,
  stages: types.length,
  status: "scheduled",
  stagesCompleted: 0,
  lineupLocked: false,
  gameDayStart: gd(start),
  gameDayEnd: gd(end),
  restGameDays: [],
  sizeMin: ONE_DAY_SIZE,
  sizeMax: types.length > 1 ? STAGE_RACE_SIZE : ONE_DAY_SIZE,
  demandVector: { climbing: 0.4, sprint: 0.3, tempo: 0.3 },
}));

// Ruteprofiler: kopier af seedets egne etaper (samme felter som race_stage_profiles) pr. rutetype.
const TEMPLATE = {
  flat: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 1),
  mountain: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 2),
  high_mountain: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 3),
  itt: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 4),
  rolling: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-live-1"),
};

export const PLANNING_STAGE_PROFILES = RACE_DEFS.flatMap(([id, , , types]) =>
  types.map((type, i) => ({ ...TEMPLATE[type], race_id: id, stage_number: i + 1, profile_type: type })),
);

export const PLANNING_RACE_IDS = new Set(RACE_DEFS.map((d) => d[0]));

const ABILITY_KEYS = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration", "recovery", "tactics", "positioning", "flat", "tempo", "durability", "aggression", "descending"];
const abilities = (over) => Object.fromEntries(ABILITY_KEYS.map((k) => [k, over[k] ?? 52]));

// [id, navn, type, evner, form, traethed, skadet]
const RIDER_DEFS = [
  ["wb-r01", "Nebiyu Berhane", "climber", { climbing: 78, endurance: 70, recovery: 66 }, 72, 30, false],
  ["wb-r02", "Wilson Maldonado", "sprinter", { sprint: 76, acceleration: 74, flat: 70 }, 64, 29, false],
  ["wb-r03", "Fei Fu", "sprinter", { sprint: 79, acceleration: 72, positioning: 68 }, 72, 26, false],
  ["wb-r04", "Robbe Bos", "rouleur", { flat: 72, tempo: 70, endurance: 66 }, 72, 27, false],
  ["wb-r05", "Yeison Ferreyra", "puncheur", { punch: 77, acceleration: 70, climbing: 62 }, 74, 40, false],
  ["wb-r06", "Riad Zerouali", "sprinter", { sprint: 68, flat: 66 }, 72, 30, false],
  ["wb-r07", "Axel Andersson", "baroudeur", { aggression: 74, endurance: 68, punch: 64 }, 72, 29, false],
  ["wb-r08", "Zhen Ren", "tt", { time_trial: 77, tempo: 72, flat: 66 }, 72, 30, false],
  ["wb-r09", "Jonas Baumann", "puncheur", { punch: 74, climbing: 66, endurance: 64 }, 72, 29, false],
  ["wb-r10", "Raul Gil", "climber", { climbing: 80, endurance: 74, descending: 66 }, 66, 22, false],
  ["wb-r11", "Abdel Jaziri", "rouleur", { flat: 70, tempo: 68, durability: 66 }, 62, 20, false],
  ["wb-r12", "Rik Maes", "puncheur", { punch: 72, climbing: 64, acceleration: 66 }, 70, 25, false],
  ["wb-r13", "Ignacio Moreno", "rouleur", { flat: 66, endurance: 70, tempo: 66 }, 74, 38, false],
  ["wb-r14", "Joaquin Ibarra", "brostensrytter", { cobblestone: 76, flat: 68, punch: 64 }, 70, 26, true],
  ["wb-r15", "Hajun Pyo", "tt", { time_trial: 79, tempo: 74, endurance: 66 }, 74, 29, false],
  ["wb-r16", "Nicolas Sanz", "climber", { climbing: 76, endurance: 72, recovery: 64 }, 62, 18, false],
];

const FIT = { flat: ["sprint", "flat"], rolling: ["flat", "punch"], mountain: ["climbing", "endurance"], high_mountain: ["climbing", "endurance", "recovery"], itt: ["time_trial", "tempo"] };
const fitFor = (ab, type) => {
  const keys = FIT[type] ?? ["flat"];
  return Math.round(keys.reduce((s, k) => s + (ab[k] ?? 50), 0) / keys.length);
};

const day = (offset) => addDays(TODAY, offset);
const ISO_START = (offset) => `${day(offset)}T11:00:00Z`;

// Gemte udtagelser: nogle loeb er klar, nogle mangler ryttere, nogle er tomme.
const PICKS = {
  "wb-piceno": ["wb-r02", "wb-r03", "wb-r04", "wb-r06", "wb-r11", "wb-r13"],
  "wb-dender": ["wb-r05", "wb-r09", "wb-r12"],
  "wb-preview": ["wb-r01", "wb-r07", "wb-r08", "wb-r10", "wb-r15", "wb-r16", "wb-r04", "wb-r11"],
  "wb-wallonie": ["wb-r10", "wb-r01", "wb-r16", "wb-r07", "wb-r12"],
  "wb-navarra": ["wb-r15", "wb-r08", "wb-r01"],
};

const entries = Object.entries(PICKS).flatMap(([raceId, ids]) =>
  ids.map((riderId, i) => ({ raceId, riderId, raceRole: i === 0 ? "captain" : null })),
);

const overlaps = (a, b) => a.id !== b.id && a.gameDayStart <= b.gameDayEnd && b.gameDayStart <= a.gameDayEnd;

export const PLANNING_SEASON_SEED = {
  enabled: true,
  season: { id: "season-preview-planning", number: 5 },
  ownPoolId: 1,
  readOnly: false,
  races: RACES,
  riders: RIDER_DEFS.map(([id, name, type, ab, , , injured]) => ({ id, name, primaryType: type, secondaryType: null, abilities: abilities(ab), injured })),
  entries,
  withdrawnRaceIds: [],
  didNotStartRaceIds: [],
  trainNowLockByRace: {},
  dayDates: Array.from({ length: 24 }, (_, i) => ({ gameDay: gd(i), date: day(i) })),
};

/** Svar for GET /api/races/:id/selection paa de seedede loeb, ellers null. */
export function planningSelectionSeed(raceId) {
  const idx = RACE_DEFS.findIndex((d) => d[0] === raceId);
  if (idx < 0) return null;
  const [, name, , types, start] = RACE_DEFS[idx];
  const race = RACES[idx];
  const bound = RACES.filter((o) => overlaps(race, o)).flatMap((o) =>
    (PICKS[o.id] ?? []).map((riderId) => ({ rider_id: riderId, bound_race_id: o.id, bound_race_name: o.name })),
  );
  const mine = new Set(PICKS[raceId] ?? []);
  const picked = PICKS[raceId] ?? [];
  return {
    enabled: true,
    eligible: true,
    withdrawn: false,
    did_not_start: false,
    lineup_locked: false,
    race: { id: raceId, name, status: "scheduled", scheduled_for: ISO_START(start) },
    size: { min: race.sizeMin, max: race.sizeMax },
    sprint_leader_allowed: false,
    trainNowLock: { riderIds: [], pressedAt: null },
    bound_riders: bound.filter((b) => !mine.has(b.rider_id)),
    riders: RIDER_DEFS.map(([id, riderName, type, ab, form, fatigue, injured]) => {
      const stageSuitability = types.map((t) => fitFor(ab, t));
      return {
        id,
        name: riderName,
        primaryType: type,
        secondaryType: null,
        suitability: Math.round(stageSuitability.reduce((s, v) => s + v, 0) / stageSuitability.length),
        stageSuitability,
        form,
        fatigue,
        injured,
        outgoing: false,
        overAge: false,
        abilities: abilities(ab),
      };
    }),
    selection: picked.length
      ? { rider_ids: picked, captain_id: picked[0], sprint_captain_id: null, hunter_id: null, free_role_ids: [], is_auto_filled: false }
      : null,
  };
}
