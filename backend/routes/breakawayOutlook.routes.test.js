// #6912 B · GET /api/races/:raceId/breakaway-outlook. Routeren køres som en rigtig
// express-app på en tilfældig port; Supabase, flag og beregning er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createBreakawayOutlookRouter } from "./breakawayOutlook.js";

const RACE = { id: "race-a", stages: 1, stages_completed: 0, status: "scheduled", season_id: "s1" };

function fakeSupabase({ race = RACE, fail = false } = {}) {
  return {
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle() { return Promise.resolve(fail ? { data: null, error: { message: "boom" } } : { data: race, error: null }); },
      };
      return api;
    },
  };
}

async function withServer(opts, fn) {
  const app = express();
  const errors = [];
  app.use("/api", createBreakawayOutlookRouter({
    supabase: fakeSupabase(opts.db),
    requireAuth: (_req, _res, next) => next(),
    readLimiter: (_req, _res, next) => next(),
    isViewerBetaTester: async () => false,
    reportError: (e) => errors.push(e),
    isEnabled: opts.isEnabled ?? (async () => true),
    compute: opts.compute ?? (async () => ({ available: true, runs: 40, odds: { about: [1, 4] }, chase: { kind: "fewChase" }, stageNumber: 1 })),
    getCached: opts.getCached ?? (({ compute }) => compute()),
    runStage: opts.runStage ?? (async () => {}),
    resolveEngine: async () => ({ v4Engine: null, teamOrderRows: [] }),
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/races`;
  try {
    await fn(base, errors);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("flag slukket → available:false uden at beregne", async () => {
  let computed = false;
  await withServer({ isEnabled: async () => false, compute: async () => { computed = true; return {}; } }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/race-a/breakaway-outlook`)).json(), { available: false, reason: "off" });
  });
  assert.equal(computed, false);
});

test("flag tændt → motorens brøk og årsag", async () => {
  await withServer({}, async (base) => {
    const body = await (await fetch(`${base}/race-a/breakaway-outlook`)).json();
    assert.deepEqual(body, { available: true, runs: 40, odds: { about: [1, 4] }, chase: { kind: "fewChase" }, stageNumber: 1 });
  });
});

test("beregningen kører afviklingsstien i dryRun med den injicerede motor-resolver", async () => {
  const calls = [];
  await withServer({
    compute: async ({ race, runDryStage }) => {
      await runDryStage({ stageIndex: 0, resolveV4Engine: "RESOLVER" });
      return { available: false, reason: "engine_off", raceId: race.id };
    },
    runStage: async (args) => { calls.push(args); },
  }, async (base) => {
    await fetch(`${base}/race-a/breakaway-outlook`);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dryRun, true);
  assert.equal(calls[0].stageIndex, 0);
  assert.equal(calls[0].resolveV4Engine, "RESOLVER");
  assert.equal(calls[0].race.id, "race-a");
});

test("ukendt løb → 404", async () => {
  await withServer({ db: { race: null } }, async (base) => {
    assert.equal((await fetch(`${base}/nope/breakaway-outlook`)).status, 404);
  });
});

test("fejl skjuler chancen og rapporteres", async () => {
  await withServer({ compute: async () => { throw new Error("motor"); } }, async (base, errors) => {
    assert.deepEqual(await (await fetch(`${base}/race-a/breakaway-outlook`)).json(), { available: false, reason: "error" });
    assert.equal(errors.length, 1);
  });
});
