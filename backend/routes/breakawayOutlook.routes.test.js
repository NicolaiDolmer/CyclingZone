// #6912 B · GET /api/races/:raceId/breakaway-outlook. Routeren køres som en rigtig
// express-app på en tilfældig port; Supabase, flag og beregning er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createBreakawayOutlookRouter } from "./breakawayOutlook.js";

const RACE_ID = "3f2b1c9a-1234-4abc-9def-0123456789ab";
const RACE = { id: RACE_ID, stages: 1, stages_completed: 0, status: "scheduled", season_id: "s1" };

function fakeSupabase({ race = RACE, fail = false } = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      queries.push(table);
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
  const supabase = fakeSupabase(opts.db);
  app.use("/api", createBreakawayOutlookRouter({
    supabase,
    requireAuth: (req, _res, next) => { req.team = opts.team === undefined ? { id: "team-1" } : opts.team; next(); },
    readLimiter: (_req, _res, next) => next(),
    isViewerBetaTester: async () => false,
    reportError: (e) => errors.push(e),
    isEnabled: opts.isEnabled ?? (async () => true),
    compute: opts.compute ?? (async () => ({ available: true, runs: 40, odds: { about: [1, 4] }, chase: { kind: "fewChase" }, stageNumber: 1 })),
    getCached: opts.getCached ?? (({ compute }) => compute()),
    runStage: opts.runStage ?? (async () => {}),
    resolveEngine: async () => ({ v4Engine: null, teamOrderRows: [] }),
    checkV4Enabled: opts.checkV4Enabled ?? (async () => true),
    isRelevant: opts.isRelevant ?? (async () => true),
    loadProfileType: opts.loadProfileType ?? (async () => "mountain"),
    loadFingerprint: opts.loadFingerprint ?? (async () => "fp-1"),
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/races`;
  try {
    await fn(base, errors, supabase);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("flag slukket → available:false uden at beregne", async () => {
  let computed = false;
  await withServer({ isEnabled: async () => false, compute: async () => { computed = true; return {}; } }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json(), { available: false, reason: "off" });
  });
  assert.equal(computed, false);
});

test("flag tændt → motorens brøk og årsag", async () => {
  await withServer({}, async (base) => {
    const body = await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json();
    assert.deepEqual(body, { available: true, runs: 40, odds: { about: [1, 4] }, chase: { kind: "fewChase" }, stageNumber: 1 });
  });
});

test("beregningen kører afviklingsstien i dryRun med den injicerede motor-resolver og motor-flaget", async () => {
  const calls = [];
  const checkV4Enabled = async () => true;
  await withServer({
    checkV4Enabled,
    compute: async ({ race, runDryStage }) => {
      await runDryStage({ stageIndex: 0, resolveV4Engine: "RESOLVER" });
      return { available: false, reason: "engine_off", raceId: race.id };
    },
    runStage: async (args) => { calls.push(args); },
  }, async (base) => {
    await fetch(`${base}/${RACE_ID}/breakaway-outlook`);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dryRun, true);
  assert.equal(calls[0].stageIndex, 0);
  assert.equal(calls[0].resolveV4Engine, "RESOLVER");
  assert.equal(calls[0].checkV4Enabled, checkV4Enabled);
  assert.equal(calls[0].race.id, RACE_ID);
});

test("ukendt løb → 404", async () => {
  await withServer({ db: { race: null } }, async (base) => {
    assert.equal((await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).status, 404);
  });
});

test("ugyldigt raceId → 400 uden forespørgsel og uden rapport", async () => {
  let flagRead = false;
  await withServer({ isEnabled: async () => { flagRead = true; return true; } }, async (base, errors, supabase) => {
    const res = await fetch(`${base}/nope/breakaway-outlook`);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { available: false, reason: "invalid_race" });
    assert.deepEqual(supabase.queries, []);
    assert.equal(errors.length, 0);
  });
  assert.equal(flagRead, false);
});

test("ikke relevant for seeren → not_relevant uden motor-, profil-, felt- eller dry-run-arbejde", async () => {
  const work = [];
  let relevanceArgs = null;
  await withServer({
    team: { id: "team-x" },
    isRelevant: async (args) => { relevanceArgs = args; return false; },
    checkV4Enabled: async () => { work.push("v4"); return true; },
    loadProfileType: async () => { work.push("profile"); return "mountain"; },
    loadFingerprint: async () => { work.push("fingerprint"); return "fp"; },
    compute: async () => { work.push("compute"); return {}; },
  }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json(), { available: false, reason: "not_relevant" });
  });
  assert.deepEqual(work, []);
  assert.equal(relevanceArgs.team.id, "team-x");
  assert.equal(relevanceArgs.race.id, RACE_ID);
  assert.ok(relevanceArgs.now instanceof Date, "request-grænsen giver uret videre");
});

test("motor v4 slukket → engine_off før dry-run", async () => {
  const work = [];
  await withServer({
    checkV4Enabled: async () => false,
    loadProfileType: async () => { work.push("profile"); return "mountain"; },
    compute: async () => { work.push("compute"); return {}; },
  }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json(), { available: false, reason: "engine_off" });
  });
  assert.deepEqual(work, []);
});

test("tidskørsel (ITT/TTT) eller manglende profil → no_breakaway før dry-run", async () => {
  for (const profile of ["itt", "itt_hilly", "ttt", null]) {
    let computed = false;
    await withServer({ loadProfileType: async () => profile, compute: async () => { computed = true; return {}; } }, async (base) => {
      assert.deepEqual(await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json(), { available: false, reason: "no_breakaway" }, String(profile));
    });
    assert.equal(computed, false, String(profile));
  }
});

test("startfeltets fingeraftryk sendes med til cachen", async () => {
  let seen = null;
  await withServer({
    loadFingerprint: async ({ raceId }) => `fp-for-${raceId}`,
    getCached: async ({ entriesKey, race }) => { seen = { entriesKey, raceId: race.id }; return { available: false, reason: "busy" }; },
  }, async (base) => {
    await fetch(`${base}/${RACE_ID}/breakaway-outlook`);
  });
  assert.deepEqual(seen, { entriesKey: `fp-for-${RACE_ID}`, raceId: RACE_ID });
});

test("fejl skjuler chancen og rapporteres", async () => {
  await withServer({ compute: async () => { throw new Error("motor"); } }, async (base, errors) => {
    assert.deepEqual(await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json(), { available: false, reason: "error" });
    assert.equal(errors.length, 1);
  });
});

test("samme ødelagte løb: dry-run og rapport kun én gang inden for fejl-cachen (ægte cache)", async () => {
  const { __resetBreakawayOutlookCache, getBreakawayOutlookCached } = await import("../lib/breakawayOutlook.js");
  __resetBreakawayOutlookCache();
  let attempts = 0;
  await withServer({
    // Fast ur (hard rule 16): fejl-TTL'en må ikke kunne udløbe mellem kaldene.
    getCached: (args) => getBreakawayOutlookCached({ ...args, now: () => 0 }),
    compute: async () => { attempts += 1; throw new Error("motor"); },
  }, async (base, errors) => {
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(await (await fetch(`${base}/${RACE_ID}/breakaway-outlook`)).json(), { available: false, reason: "error" });
    }
    assert.equal(errors.length, 1);
  });
  assert.equal(attempts, 1);
  __resetBreakawayOutlookCache();
});
