// #7947 PR 2+4 (Let/Mellem/Haard): frossent facit for skrivestierne og aldringsbremsens taelling.
//
// Koeres paa MERGE-BASEN i et separat, read-only worktree (#7587): basen kender hverken indsats i
// ruterne eller det koerte niveau paa score-raekken. Testen (trainingEffortLevels.pr24.test.js)
// koerer SAMME scenarier med den nye kode og kontakten manglende, off eller beta og skal give
// basens fingeraftryk bit for bit. Fixturen genereres aldrig med den nye kode.
//
// Kun fingeraftryk (hashes) staar i fixturen, ingen balance-tal.
//
//   programCell : PUT /api/training/programs/cell, en raekke kald med og uden indsats
//                 (gyldig, null, ugyldig), svar + slutstand.
//   groupCell   : PUT /api/training/groups/:id/cell, samme slags kald, svar + slutstand
//                 (gruppens felter og kopierne i rytternes raekker).
//   seasonLoad  : computeSeasonLoad og loadSeasonDevelopmentLoad over faste raekker uden
//                 koert niveau (som alle raekker er, naar kontakten er off).
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";

import { createTrainingProgramsRouter } from "../routes/trainingPrograms.js";
import { createTrainingGroupsRouter } from "../routes/trainingGroups.js";
import { programWeekDaysFor } from "./trainingPrograms.js";
import { computeSeasonLoad, loadSeasonDevelopmentLoad } from "./seasonDevelopmentLoad.js";

export const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

// Tidsstempler fra `new Date()` i ruterne er ikke en del af udfaldet.
function stripTimes(value) {
  if (Array.isArray(value)) return value.map(stripTimes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => k !== "updated_at" && k !== "created_at")
      .map(([k, v]) => [k, stripTimes(v)]));
  }
  return value;
}

// PostgREST-fake: select/eq/in/gt/order/limit/range/maybeSingle/update/insert/delete paa et
// in-memory state. Kolonnelisten i select ignoreres (alle kolonner svares).
export function fakeSupabase(state) {
  let seq = 0;
  function builder(table, op = "select", filters = [], payload = null) {
    const match = (row) => filters.every((f) => f(row));
    const sorted = () => (state[table] ?? []).filter(match).sort((a, b) => (String(a.id) > String(b.id) ? 1 : -1));
    const run = () => {
      state[table] ??= [];
      if (op === "update") {
        for (const row of state[table]) if (match(row)) Object.assign(row, structuredClone(payload));
        return { data: null, error: null };
      }
      if (op === "delete") {
        state[table] = state[table].filter((row) => !match(row));
        return { data: null, error: null };
      }
      if (op === "insert") {
        const rows = [payload].flat().map((row) => ({ id: `${table}-${seq += 1}`, ...structuredClone(row) }));
        state[table].push(...rows);
        return { data: rows, error: null };
      }
      return { data: state[table].filter(match).map((r) => structuredClone(r)), error: null };
    };
    const next = (f) => builder(table, op, [...filters, f], payload);
    const obj = {
      select() { return op === "insert" ? obj : builder(table, "select", filters, payload); },
      eq(c, v) { return next((r) => r[c] === v); },
      in(c, vs) { return next((r) => vs.includes(r[c])); },
      gt(c, v) { return next((r) => r[c] > v); },
      order() { return obj; },
      limit(n) { return Promise.resolve({ data: sorted().slice(0, n).map((r) => structuredClone(r)), error: null }); },
      range(from, to) { return Promise.resolve({ data: sorted().slice(from, to + 1).map((r) => structuredClone(r)), error: null }); },
      update(p) { return builder(table, "update", filters, p); },
      delete() { return builder(table, "delete", filters, payload); },
      insert(p) {
        const res = builder(table, "insert", filters, p).__run();
        return {
          select: () => ({ single: async () => ({ data: res.data[0], error: res.error }) }),
          then: (resolve, reject) => Promise.resolve(res).then(resolve, reject),
        };
      },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      __run: run,
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}

async function withRouter(state, mount, create, fn) {
  const app = express();
  app.use(express.json());
  app.use(mount, create({
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.user = { id: "user-a" }; req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => true,
  }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const call = async (method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${port}${mount}${path}`, {
        method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() };
    };
    return await fn(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// `effortFlag`: undefined = ingen raekke for kontakten; ellers dens vaerdi.
function configRows(effortFlag) {
  return [
    { key: "training_programs", value: "beta" },
    { key: "training_program_cells", value: "beta" },
    { key: "training_groups", value: "beta" },
    ...(effortFlag === undefined ? [] : [{ key: "training_effort_levels", value: effortFlag }]),
  ];
}

const RIDERS = [
  { id: "r1", team_id: "team-a", is_retired: false, primary_type: "climber", secondary_type: null },
  { id: "r2", team_id: "team-a", is_retired: false, primary_type: "sprinter", secondary_type: null },
  { id: "r3", team_id: "team-a", is_retired: false, primary_type: "climber", secondary_type: null },
];

// Kaldene: uden indsats (dagens), gyldig indsats paa ugedag og felt, null, ugyldig, en ny rytter.
export const CELL_CALLS = Object.freeze([
  { weekday: "mon", slotIndex: null, session: "vo2max" },
  { weekday: "mon", slotIndex: null, session: "endurance", effort: "hard" },
  { weekday: "tue", slotIndex: 2, session: "sprint", effort: "easy" },
  { weekday: "tue", slotIndex: 3, session: "tempo", effort: null },
  { weekday: "wed", slotIndex: null, session: "threshold", effort: "bogus" },
  { weekday: "thu", slotIndex: 1, session: "technique", effort: "normal" },
  { weekday: "fri", slotIndex: null, session: "recovery", effort: "hard" },
]);

export async function programCellOutcome(effortFlag) {
  const state = {
    app_config: configRows(effortFlag),
    riders: structuredClone(RIDERS),
    seasons: [{ id: "s1", status: "active" }],
    training_plans: [{ rider_id: "r2", team_id: "team-a", season_id: "s1", focus: "sprint", intensity: "hard" }],
    training_week_plans: [{ id: "wp-r1", team_id: "team-a", rider_id: "r1", days: programWeekDaysFor("balanced_week") }],
    training_groups: [], training_group_members: [],
  };
  const answers = await withRouter(state, "/api/training/programs", createTrainingProgramsRouter, async (call) => {
    const out = [];
    for (const riderId of ["r1", "r2"]) {
      for (const body of CELL_CALLS) out.push(await call("PUT", "/cell", { riderId, ...body }));
    }
    return out;
  });
  return stripTimes({ answers, state });
}

export async function groupCellOutcome(effortFlag) {
  const state = {
    app_config: configRows(effortFlag),
    riders: structuredClone(RIDERS),
    seasons: [{ id: "s1", status: "active" }],
    training_plans: [],
    training_week_plans: [{ id: "wp-r1", team_id: "team-a", rider_id: "r1", days: programWeekDaysFor("balanced_week") }],
    training_groups: [{ id: "g1", team_id: "team-a", name: "Group", days: programWeekDaysFor("balanced_week"), program_key: "balanced_week", fatigue_threshold: null, fallback: null, created_at: "t0" }],
    training_group_members: ["r1", "r2", "r3"].map((rider_id) => ({ rider_id, group_id: "g1", team_id: "team-a", follows_group: rider_id !== "r3" })),
  };
  const answers = await withRouter(state, "/api/training/groups", createTrainingGroupsRouter, async (call) => {
    const out = [];
    for (const body of CELL_CALLS) out.push(await call("PUT", "/g1/cell", body));
    return out;
  });
  return stripTimes({ answers, state });
}

// Aldringsbremsens raekker: alle sessionstyper, dubletter, loebsdage, faerdighed, restitution.
const SESSIONS = ["vo2max", "threshold", "tempo", "endurance", "sprint", "technique", "aero", "cobbled_sectors", "recovery", null];
export function seasonTrainingRows() {
  const rows = [];
  let n = 0;
  for (const rider of ["a", "b", "c"]) {
    SESSIONS.forEach((session, i) => {
      for (const day of [1, 2, 2]) {
        n += 1;
        rows.push({
          id: `trn-${String(n).padStart(5, "0")}`, rider_id: rider, season_id: n % 7 === 0 ? "s3" : "s4",
          day_type: session === "recovery" || session == null ? "recovery" : ["technique", "aero"].includes(session) ? "skill" : "training",
          was_race_day: (n % 11) === 0, session, game_day: (n % 5 === 0) ? null : day + i * 3, tick_date: `2026-10-${String(1 + (i % 9)).padStart(2, "0")}`,
        });
      }
    });
  }
  return rows;
}

export async function seasonLoadOutcome() {
  const trainingRows = seasonTrainingRows();
  const pure = [...computeSeasonLoad({ trainingRows: trainingRows.filter((r) => r.season_id === "s4") }).entries()].sort();
  const supabase = fakeSupabase({
    seasons: [{ id: "s3", number: 3 }, { id: "s4", number: 4 }],
    races: [{ id: "race-1", season_id: "s4", race_type: "stage" }, { id: "race-2", season_id: "s4", race_type: "single" }],
    race_results: [
      { id: "res-1", race_id: "race-1", stage_number: 1, result_type: "stage", rider_id: "a" },
      { id: "res-2", race_id: "race-2", stage_number: 1, result_type: "gc", rider_id: "b" },
    ],
    rider_training_scores: trainingRows,
  });
  const loaded = await loadSeasonDevelopmentLoad({ supabase, seasonNumber: 4 });
  return { pure, loaded: { ...loaded, byRider: [...loaded.byRider.entries()].sort() } };
}

// Basen ignorerer kontakten; de tre vaerdier skal give det samme svar som den nye kode slukket.
export const OFF_FLAGS = Object.freeze([undefined, "off", "beta"]);

export async function goldenFromThisCode() {
  const programCell = {};
  const groupCell = {};
  for (const flag of OFF_FLAGS) {
    programCell[String(flag)] = hash(await programCellOutcome(flag));
    groupCell[String(flag)] = hash(await groupCellOutcome(flag));
  }
  return { programCell, groupCell, seasonLoad: hash(await seasonLoadOutcome()) };
}

// `node backend/lib/trainingEffortLevels7947b.golden.mjs <merge-base-sha>` skriver facit til stdout
// (koeres paa basen).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  goldenFromThisCode().then((golden) => process.stdout.write(`${JSON.stringify({ mergeBase: process.argv[2] ?? null, ...golden }, null, 2)}\n`));
}
