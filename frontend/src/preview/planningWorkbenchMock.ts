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
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = copenhagenToday();
const G0 = 200; // loebsdag for i dag
const gd = (offset: number) => G0 + offset;

// [id, navn, klasse, etapetyper, startOffset, slutOffset]
type RaceDef = [string, string, string, string[], number, number];
const RACE_DEFS: RaceDef[] = [
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
const TEMPLATE: Record<string, Record<string, unknown> | undefined> = {
  flat: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 1),
  mountain: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 2),
  high_mountain: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 3),
  itt: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-up-1" && p.stage_number === 4),
  rolling: SEED_STAGE_PROFILES.find((p) => p.race_id === "race-live-1"),
};

// Raekkerne spredes ind i seedets egen liste i mockHandlers.js; en lav, loes type holder dens udledte typer uroerte.
export const PLANNING_STAGE_PROFILES: any[] = RACE_DEFS.flatMap(([id, , , types]) =>
  types.map((type, i) => ({ ...TEMPLATE[type], race_id: id, stage_number: i + 1, profile_type: type })),
);

export const PLANNING_RACE_IDS = new Set(RACE_DEFS.map((d) => d[0]));

const ABILITY_KEYS = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration", "recovery", "tactics", "positioning", "flat", "tempo", "durability", "aggression", "descending"];
const abilities = (over: Record<string, number>) => Object.fromEntries(ABILITY_KEYS.map((k) => [k, over[k] ?? 52]));

// [id, navn, type, evner, form, traethed, skadet]
type RiderDef = [string, string, string, Record<string, number>, number, number, boolean];
const RIDER_DEFS: RiderDef[] = [
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

const FIT: Record<string, string[]> = { flat: ["sprint", "flat"], rolling: ["flat", "punch"], mountain: ["climbing", "endurance"], high_mountain: ["climbing", "endurance", "recovery"], itt: ["time_trial", "tempo"] };
const fitFor = (ab: Record<string, number>, type: string) => {
  const keys = FIT[type] ?? ["flat"];
  return Math.round(keys.reduce((s, k) => s + (ab[k] ?? 50), 0) / keys.length);
};

const day = (offset: number) => addDays(TODAY, offset);
const ISO_START = (offset: number) => `${day(offset)}T11:00:00Z`;

// Gemte udtagelser: nogle loeb er klar, nogle mangler ryttere, nogle er tomme.
const PICKS: Record<string, string[]> = {
  "wb-piceno": ["wb-r02", "wb-r03", "wb-r04", "wb-r06", "wb-r11", "wb-r13"],
  "wb-dender": ["wb-r05", "wb-r09", "wb-r12"],
  "wb-preview": ["wb-r01", "wb-r07", "wb-r08", "wb-r10", "wb-r15", "wb-r16", "wb-r04", "wb-r11"],
  "wb-wallonie": ["wb-r10", "wb-r01", "wb-r16", "wb-r07", "wb-r12"],
  "wb-navarra": ["wb-r15", "wb-r08", "wb-r01"],
};

const entries = Object.entries(PICKS).flatMap(([raceId, ids]) =>
  ids.map((riderId, i) => ({ raceId, riderId, raceRole: i === 0 ? "captain" : null })),
);

const overlaps = (a: { id: string; gameDayStart: number; gameDayEnd: number }, b: { id: string; gameDayStart: number; gameDayEnd: number }) => a.id !== b.id && a.gameDayStart <= b.gameDayEnd && b.gameDayStart <= a.gameDayEnd;

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
export function planningSelectionSeed(raceId: string) {
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
        suitability: Math.round(stageSuitability.reduce((s: number, v: number) => s + v, 0) / stageSuitability.length),
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

// Nation, foedselsdato og skade (riders + rider_condition), som trup-tabellen laeser direkte.
// Opdigtet: to ryttere er U23 i saeson 5, den skadede har en rask-igen-dato om fire dage.
const NATIONS = ["et", "co", "cn", "be", "co", "ma", "se", "cn", "de", "es", "tn", "be", "es", "ar", "kr", "es"];
const BORN: Record<string, string> = { "wb-r03": "2009-03-14", "wb-r12": "2008-07-02" };
export const PLANNING_RIDER_ROWS = RIDER_DEFS.map(([id, , , , , , injured], i) => ({
  id,
  nationality_code: NATIONS[i] ?? null,
  birthdate: BORN[id] ?? "1998-05-20",
  rider_condition: { injured_until: injured ? day(3) : null, injury_race_days_left: null },
}));

/**
 * "Lad assistenten udtage" i preview-mocken (POST /api/races/selection/auto/propose har ingen server
 * her). Samme form som serverens svar: egne valg bliver, de tomme pladser fyldes med de bedst egnede
 * raske ryttere, der ikke er optaget i et loeb paa samme loebsdage. Kun en troværdig efterligning til
 * billederne; den rigtige assistent er serverens.
 */
export function previewAssistantProposals(raceIds: string[], overrides: Record<string, Array<{ rider_id: string; race_role: string | null }>> = {}) {
  const current = new Map<string, string[]>(RACES.map((r) => [r.id, overrides[r.id]?.map((e) => e.rider_id) ?? PICKS[r.id] ?? []]));
  const ordered = RACES.filter((r) => raceIds.includes(r.id)).sort((a, b) => a.gameDayStart - b.gameDayStart);
  const proposals: Array<{ race_id: string; entries: Array<{ rider_id: string; race_role: string | null }>; added: number }> = [];
  const skipped: Array<{ race_id: string; reason: string }> = [];
  for (const race of ordered) {
    const own = overrides[race.id] ?? (PICKS[race.id] ?? []).map((id, i) => ({ rider_id: id, race_role: i === 0 ? "captain" : null }));
    const need = race.sizeMax - own.length;
    if (need <= 0) {
      skipped.push({ race_id: race.id, reason: "selection_full" });
      continue;
    }
    const types = RACE_DEFS.find((d) => d[0] === race.id)?.[3] ?? ["flat"];
    const mine = new Set(own.map((e) => e.rider_id));
    const busy = new Set(RACES.filter((o) => overlaps(race, o)).flatMap((o) => current.get(o.id) ?? []));
    const fills = RIDER_DEFS.filter(([id, , , , , , injured]) => !injured && !mine.has(id) && !busy.has(id))
      .map(([id, , , ab]) => ({ id, fit: types.reduce((s, t) => s + fitFor(ab, t), 0) / types.length }))
      .sort((a, b) => b.fit - a.fit || a.id.localeCompare(b.id))
      .slice(0, need);
    if (!fills.length) {
      skipped.push({ race_id: race.id, reason: "selection_no_eligible_riders" });
      continue;
    }
    const entries = [...own, ...fills.map((f) => ({ rider_id: f.id, race_role: "helper" as string | null }))];
    if (!entries.some((e) => e.race_role === "captain")) entries[own.length].race_role = "captain";
    current.set(race.id, entries.map((e) => e.rider_id));
    proposals.push({ race_id: race.id, entries, added: fills.length });
  }
  return { ok: true, proposals, skipped };
}

/**
 * "Efter loebet" i preview-mocken (GET /api/races/:id/after-race-fatigue har ingen server her). Kun en
 * troværdig illustration til billederne: haardere og laengere loeb giver hoejere tal. Det rigtige tal
 * regnes af serveren med motorens model (backend/lib/planningAfterRace7535.js), aldrig her.
 */
const PREVIEW_STAGE_WEIGHT: Record<string, number> = { flat: 6, rolling: 8, mountain: 12, high_mountain: 15, itt: 5 };
export function previewAfterRace(raceId: string): Record<string, number> | null {
  const def = RACE_DEFS.find((d) => d[0] === raceId);
  if (!def) return null;
  const types = def[3];
  const out: Record<string, number> = {};
  for (const [id, , , ab, , fatigue] of RIDER_DEFS) {
    let f = fatigue;
    for (const type of types) f = Math.min(100, f + (PREVIEW_STAGE_WEIGHT[type] ?? 8) - (4 + ((ab.recovery ?? 52) - 50) / 10));
    out[id] = Math.max(0, Math.round(f));
  }
  return out;
}

// Formtop i preview-mocken: samme form som GET /api/peak-plans/board, med seedets ryttere og loeb.
let previewPeaks: Array<{ id: string; riderId: string; raceId: string }> = [
  { id: "pk-1", riderId: "wb-r10", raceId: "wb-jura" },
  { id: "pk-2", riderId: "wb-r01", raceId: "wb-navarra" },
  { id: "pk-3", riderId: "wb-r01", raceId: "wb-appenninica" },
  { id: "pk-4", riderId: "wb-r05", raceId: "wb-dender" },
  { id: "pk-5", riderId: "wb-r15", raceId: "wb-preview" },
];
const PREVIEW_PEAK_MAX = 2;

export function previewPeakBoard() {
  const raceById = new Map(RACES.map((r, i) => [r.id, { race: r, start: RACE_DEFS[i][4], end: RACE_DEFS[i][5] }]));
  return {
    enabled: true,
    season: { id: "season-preview-planning", number: 5 },
    maxPerRider: PREVIEW_PEAK_MAX,
    today: TODAY,
    leadupDays: 14,
    paybackDays: 7,
    riders: RIDER_DEFS.map(([id, name, type, ab, form, fatigue], i) => {
      const [firstname, ...rest] = name.split(" ");
      return {
        id,
        firstname,
        lastname: rest.join(" "),
        nationality: NATIONS[i] ?? null,
        primaryType: type,
        squad: "senior",
        rating: Math.round(Object.values(ab).reduce((s, v) => s + v, 0) / Math.max(1, Object.values(ab).length)),
        form,
        fatigue,
        peaks: previewPeaks
          .filter((p) => p.riderId === id)
          .map((p) => {
            const hit = raceById.get(p.raceId);
            return {
              id: p.id,
              targetRaceId: p.raceId,
              targetRaceName: hit?.race.name ?? null,
              isSuggestion: false,
              locked: false,
              windowStart: hit ? day(Math.max(0, hit.start - 3)) : null,
              windowEnd: hit ? day(hit.end + 1) : null,
              status: "pending",
              value: { floor: 3, ceiling: 6, current: null, payback: -3 },
              paybackCollisions: [],
            };
          }),
      };
    }),
    races: RACES.map((r, i) => ({ id: r.id, name: r.name, isMine: true, started: false, date: day(RACE_DEFS[i][4]), dateEnd: day(RACE_DEFS[i][5]) })),
  };
}

export function previewApplyPeaks(pairs: Array<{ riderId: string; raceId: string }>) {
  let created = 0;
  const skipped: Array<{ rider_id: string; target_race_id: string; reason: string }> = [];
  for (const { riderId, raceId } of pairs) {
    const mine = previewPeaks.filter((p) => p.riderId === riderId);
    if (mine.some((p) => p.raceId === raceId)) skipped.push({ rider_id: riderId, target_race_id: raceId, reason: "duplicate_target" });
    else if (mine.length >= PREVIEW_PEAK_MAX) skipped.push({ rider_id: riderId, target_race_id: raceId, reason: "max_peaks_reached" });
    else {
      previewPeaks = [...previewPeaks, { id: `pk-${Date.now()}-${created}`, riderId, raceId }];
      created += 1;
    }
  }
  return { ok: true, created, skipped };
}

export function previewRemovePeak(planId: string) {
  previewPeaks = previewPeaks.filter((p) => p.id !== planId);
  return { ok: true };
}

/** Saeson-belastning (GET /api/races/distribution, seasonLoadByRider) ud fra seedets egne udtagelser. */
export const PLANNING_SEASON_LOAD: Record<string, { races: number; raceDays: number }> = {};
for (const [raceId, ids] of Object.entries(PICKS)) {
  const race = RACES.find((r) => r.id === raceId);
  const days = race ? race.gameDayEnd - race.gameDayStart + 1 : 1;
  for (const id of ids) {
    const cur = PLANNING_SEASON_LOAD[id] ?? { races: 0, raceDays: 0 };
    PLANNING_SEASON_LOAD[id] = { races: cur.races + 1, raceDays: cur.raceDays + days };
  }
}
