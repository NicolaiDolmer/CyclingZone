// #6798 — POST /api/training/run-today naar en anden koersel holder holdets
// reservation (#6759): motoren kaster en retryable "held"-fejl, intet er skrevet.
// Routen skal svare 409 training_in_progress UDEN Sentry (frontend's runToday
// behandler enhver 409 som "allerede koert": refresh, ingen fejltekst). Andre fejl,
// ogsaa andre retryable (forbigaaende gateway), er stadig 500 + Sentry.
//
// Samme teknik som apiTrainingMeDayClose.routes.test.js: handleren fra api.js
// koeres ordret; kun dens I/O-afhaengigheder erstattes.
//
// Refs #6798 #6759

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isTrainingReservationHeldError, TRAINING_RESERVATION_HELD } from "./dailyTrainingEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8").replace(/\r\n/g, "\n");

const DEPS = [
  "router", "requireAuth", "marketWriteLimiter", "isViewerBetaTester", "isDailyTrainingEnabled",
  "isTrainingConditionPerDateEnabled", "supabase", "loadTrainingState", "isTrainingTickPerRaceDayEnabled",
  "trainingWindowOpen", "resolveDayCloseStatus", "teamGameDaysFromDayClose", "TRAINING_SWEEP_FROM_HOUR",
  "runTeamTrainingDay", "isTrainingReservationHeldError", "captureException",
];

function loadHandler({ raceDayTickOn, runTeamTrainingDay, captured }) {
  const start = apiSource.indexOf('router.post("/training/run-today"');
  const end = apiSource.indexOf("\n});", start) + 4;
  assert.ok(start >= 0 && end > start, "run-today-handleren findes i api.js");
  let handler;
  const router = { post(_path, ...handlers) { handler = handlers.at(-1); } };
  const register = new Function(...DEPS, apiSource.slice(start, end));
  register(
    router, () => {}, () => {}, async () => false, async () => true,
    async () => false, {}, async () => ({ activeSeasonId: "season", activeSeasonNumber: 5 }), async () => raceDayTickOn,
    () => true, async () => ({ closed: true, gameDays: [3] }), () => [3], 20,
    runTeamTrainingDay, isTrainingReservationHeldError, (err) => captured.push(err),
  );
  return handler;
}

function heldError() {
  return Object.assign(new Error("training_day_runs: reservation is held by an unfinished run"),
    { retryable: true, code: TRAINING_RESERVATION_HELD });
}

async function call(handler) {
  const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ team: { id: "team", parked_at: null, league_division_id: "div" } }, response);
  return response;
}

for (const raceDayTickOn of [false, true]) {
  const path = raceDayTickOn ? "loebsdags-stien" : "den gamle kalenderdags-sti";

  test(`#6798 (${path}): optaget reservation → 409 training_in_progress, ingen Sentry`, async () => {
    const captured = [];
    const handler = loadHandler({ raceDayTickOn, captured, runTeamTrainingDay: async () => { throw heldError(); } });
    const res = await call(handler);
    assert.equal(res.code, 409);
    assert.deepEqual(res.body, { error: "training_in_progress" });
    assert.equal(captured.length, 0, "ingen Sentry for en forventet, kortvarig tilstand");
  });

  test(`#6798 (${path}): anden retryable fejl (gateway) → stadig 500 + Sentry`, async () => {
    const captured = [];
    const gateway = Object.assign(new Error("team_facilities: 502 Bad gateway"), { retryable: true });
    const handler = loadHandler({ raceDayTickOn, captured, runTeamTrainingDay: async () => { throw gateway; } });
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
