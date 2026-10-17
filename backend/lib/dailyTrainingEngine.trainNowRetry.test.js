// #6798 / #6827 — POST /api/training/run-today naar en anden koersel holder holdets
// reservation: motoren kaster en retryable "held"-fejl, intet er skrevet. Routen
// skal svare 409 training_in_progress UDEN Sentry og stoppe (ingen senere
// loebsdage). Frontend's runToday behandler enhver 409 som "allerede koert":
// refresh, ingen fejltekst. Andre fejl, ogsaa andre retryable (forbigaaende
// gateway), er stadig 500 + Sentry.
//
// Samme teknik som apiTrainingMeDayClose.routes.test.js: handleren fra api.js
// koeres ordret; kun dens I/O-afhaengigheder erstattes. #6827: reservations-
// testene koerer den RIGTIGE motor (runTeamTrainingDay) mod en lille in-memory
// training_day_runs med de to partielle unikke indexe, ikke en stub der kaster.
//
// Refs #6798 #6759 #6827

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runTeamTrainingDay, isTrainingReservationHeldError, LEGACY_RESERVATION_STAGE_LOADING,
} from "./dailyTrainingEngine.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8").replace(/\r\n/g, "\n");

const DEPS = [
  "router", "requireAuth", "marketWriteLimiter", "isViewerBetaTester", "isDailyTrainingEnabled",
  "isTrainingConditionPerDateEnabled", "supabase", "loadTrainingState", "isTrainingTickPerRaceDayEnabled",
  "trainingWindowOpen", "resolveDayCloseStatus", "teamGameDaysFromDayClose", "TRAINING_SWEEP_FROM_HOUR",
  "runTeamTrainingDay", "isTrainingReservationHeldError", "captureException",
];

const TEAM_ID = "team";
const SEASON_ID = "season";

function loadHandler({ raceDayTickOn, runDay = runTeamTrainingDay, supabase = {}, gameDays = [3], captured }) {
  const start = apiSource.indexOf('router.post("/training/run-today"');
  const end = apiSource.indexOf("\n});", start) + 4;
  assert.ok(start >= 0 && end > start, "run-today-handleren findes i api.js");
  let handler;
  const router = { post(_path, ...handlers) { handler = handlers.at(-1); } };
  const register = new Function(...DEPS, apiSource.slice(start, end));
  register(
    router, () => {}, () => {}, async () => false, async () => true,
    async () => false, supabase, async () => ({ activeSeasonId: SEASON_ID, activeSeasonNumber: 5 }), async () => raceDayTickOn,
    () => true, async () => ({ closed: true, gameDays }), () => gameDays, 20,
    runDay, isTrainingReservationHeldError, (err) => captured.push(err),
  );
  return handler;
}

async function call(handler) {
  const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ team: { id: TEAM_ID, parked_at: null, league_division_id: "div" } }, response);
  return response;
}

// Lille PostgREST-lignende fake: kun det motoren roerer FOER rytter-arbejdet
// (flag-laesninger, reservationens INSERT og opslaget af en optaget noegle).
// Kolonne-projektion inkl. "alias:report->>felt" spejler PostgREST, saa motorens
// smalle select testes som den sendes. Alt andet kaster, saa testen fejler hoejt,
// hvis motoren naar videre end reservationen.
function fakeSupabase({ flags = {}, runs = [] } = {}) {
  const tables = {
    app_config: Object.entries(flags).map(([key, value]) => ({ key, value })),
    training_day_runs: runs,
  };
  const inserts = [];
  const read = (row, expr) => {
    if (!expr.includes("->>")) return row[expr];
    const [base, key] = expr.split("->>");
    const value = row[base]?.[key];
    return value == null ? value : String(value);
  };
  const project = (row, cols) => {
    if (!cols || cols === "*") return { ...row };
    return Object.fromEntries(cols.split(",").map((part) => {
      const [alias, expr] = part.includes(":") ? part.trim().split(":") : [part.trim(), part.trim()];
      return [alias, read(row, expr)];
    }));
  };
  function query(table, { cols = null, filters = [] } = {}) {
    if (!(table in tables)) throw new Error(`unexpected table in reservation test: ${table}`);
    const rows = () => tables[table].filter((row) => filters.every(([col, val]) => read(row, col) === val));
    return {
      select(selected) { return query(table, { cols: selected, filters }); },
      eq(col, val) { return query(table, { cols, filters: [...filters, [col, val]] }); },
      async maybeSingle() { return { data: rows().map((row) => project(row, cols))[0] ?? null, error: null }; },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: rows().map((row) => project(row, cols)), error: null }).then(onFulfilled, onRejected);
      },
      insert(row) {
        inserts.push(row);
        const hasGameDay = row.game_day != null;
        const taken = tables[table].some((x) => (hasGameDay
          ? x.game_day != null && x.team_id === row.team_id && x.season_id === row.season_id
            && (x.squad ?? "senior") === (row.squad ?? "senior") && x.game_day === row.game_day
          : x.game_day == null && x.team_id === row.team_id && x.tick_date === row.tick_date));
        if (taken) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        throw new Error("reservation test reached a free key; seed a run row for every game day");
      },
    };
  }
  return { tables, inserts, from: (table) => query(table) };
}

const freshCreatedAt = () => new Date().toISOString();
const settledReport = (gameDay) => ({ riders: [], game_day: gameDay, executed_by: "assistant" });
const raceDayRun = (gameDay, report) => ({
  id: `run-${gameDay}`, team_id: TEAM_ID, season_id: SEASON_ID, squad: "senior", game_day: gameDay,
  tick_date: copenhagenDateString(new Date()), created_at: freshCreatedAt(), report,
});

test("#6827 (loebsdags-stien, rigtig motor): en sweep holder loebsdag 3 → 409 training_in_progress, loebsdag 4 roeres ikke", async () => {
  const captured = [];
  const supabase = fakeSupabase({
    flags: { [TRAINING_TICK_PER_RACE_DAY_FLAG_KEY]: "on" },
    runs: [raceDayRun(3, { pending: true }), raceDayRun(4, settledReport(4))],
  });
  const before = structuredClone(supabase.tables.training_day_runs);
  const res = await call(loadHandler({ raceDayTickOn: true, supabase, gameDays: [3, 4], captured }));
  assert.equal(res.code, 409);
  assert.deepEqual(res.body, { error: "training_in_progress" });
  assert.equal(captured.length, 0, "ingen Sentry for en forventet, kortvarig tilstand");
  assert.deepEqual(supabase.inserts.map((row) => row.game_day), [3], "loekken stopper: ingen senere loebsdage");
  assert.deepEqual(supabase.tables.training_day_runs, before, "intet skrevet");
});

test("#6827 (loebsdags-stien, rigtig motor): afregnede loebsdage → stadig 409 already_trained_today", async () => {
  const captured = [];
  const supabase = fakeSupabase({
    flags: { [TRAINING_TICK_PER_RACE_DAY_FLAG_KEY]: "on" },
    runs: [raceDayRun(3, settledReport(3)), raceDayRun(4, settledReport(4))],
  });
  const res = await call(loadHandler({ raceDayTickOn: true, supabase, gameDays: [3, 4], captured }));
  assert.equal(res.code, 409);
  assert.equal(res.body.error, "already_trained_today");
  assert.equal(captured.length, 0);
  assert.deepEqual(supabase.inserts.map((row) => row.game_day), [3, 4], "en afregnet loebsdag springes over som foer");
});

test("#6798 (den gamle kalenderdags-sti, rigtig motor): frisk 'loading'-reservation → 409 training_in_progress, ingen Sentry", async () => {
  const captured = [];
  const supabase = fakeSupabase({
    runs: [{
      id: "run-legacy", team_id: TEAM_ID, tick_date: copenhagenDateString(new Date()), game_day: null,
      created_at: freshCreatedAt(), report: { pending: true, stage: LEGACY_RESERVATION_STAGE_LOADING, token: "token-of-the-sweep" },
    }],
  });
  const before = structuredClone(supabase.tables.training_day_runs);
  const res = await call(loadHandler({ raceDayTickOn: false, supabase, captured }));
  assert.equal(res.code, 409);
  assert.deepEqual(res.body, { error: "training_in_progress" });
  assert.equal(captured.length, 0);
  assert.deepEqual(supabase.tables.training_day_runs, before, "intet skrevet");
});

for (const raceDayTickOn of [false, true]) {
  const path = raceDayTickOn ? "loebsdags-stien" : "den gamle kalenderdags-sti";
  test(`#6798 (${path}): anden retryable fejl (gateway) → stadig 500 + Sentry`, async () => {
    const captured = [];
    const gateway = Object.assign(new Error("team_facilities: 502 Bad gateway"), { retryable: true });
    const handler = loadHandler({ raceDayTickOn, captured, runDay: async () => { throw gateway; } });
    const res = await call(handler);
    assert.equal(res.code, 500);
    assert.deepEqual(captured, [gateway]);
  });
}

test("#6798: frontend's runToday behandler enhver 409 som 'allerede koert' (refresh, ingen fejltekst)", () => {
  const hook = readFileSync(resolve(__dirname, "../../frontend/src/lib/useTraining.js"), "utf8").replace(/\r\n/g, "\n");
  const start = hook.indexOf("const runToday = useCallback(");
  assert.ok(start >= 0, "useTraining.runToday findes");
  const body = hook.slice(start, hook.indexOf("}, [refresh]);", start));
  assert.match(body, /if \(res\.status === 409\) \{\s*await refresh\(\);\s*return null;\s*\}/,
    "409 → refresh + null, saa training_in_progress opfoerer sig som already_trained_today");
});
