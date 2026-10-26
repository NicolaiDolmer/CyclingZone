// #6912 B: motorens udbrudschance. Rene dele + orkestreringen med en falsk motor.
import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetBreakawayOutlookCache,
  chaseReason,
  computeBreakawayOutlook,
  getBreakawayOutlookCached,
  oddsFraction,
  outlookCacheKey,
  outlookSeedString,
  sampleFromStageResult,
  summarizeOutlook,
} from "./breakawayOutlook.js";

// ── oddsFraction ────────────────────────────────────────────────────────────
test("oddsFraction: 0 sejre er 'under 1 af 10', aldrig 'nul'", () => {
  assert.deepEqual(oddsFraction(0, 40), { under: [1, 10] });
});

test("oddsFraction: alle sejre er 'over 9 af 10'", () => {
  assert.deepEqual(oddsFraction(40, 40), { over: [9, 10] });
});

test("oddsFraction: runder til nærmeste enkle brøk", () => {
  assert.deepEqual(oddsFraction(20, 40), { about: [1, 2] });
  assert.deepEqual(oddsFraction(10, 40), { about: [1, 4] });
  assert.deepEqual(oddsFraction(30, 40), { about: [3, 4] });
  assert.deepEqual(oddsFraction(13, 40), { about: [1, 3] });
  assert.deepEqual(oddsFraction(1, 40), { about: [1, 10] });
});

test("oddsFraction: ugyldigt input → null", () => {
  assert.equal(oddsFraction(1, 0), null);
  assert.equal(oddsFraction(5, 4), null);
  assert.equal(oddsFraction(-1, 4), null);
  assert.equal(oddsFraction(1.5, 4), null);
});

// ── chaseReason ─────────────────────────────────────────────────────────────
const s = (caught, chasingTeams) => ({ known: true, breakawayWin: !caught, caught, chasingTeams });

test("chaseReason: hentes sjældent → nobodyChases", () => {
  assert.deepEqual(chaseReason([s(false, 0), s(false, 0), s(true, 3)]), { kind: "nobodyChases" });
});

test("chaseReason: median antal jagende hold i de hentede kørsler", () => {
  assert.deepEqual(chaseReason([s(true, 1), s(true, 2), s(true, 2)]), { kind: "fewChase" });
  assert.deepEqual(chaseReason([s(true, 3), s(true, 4), s(true, 5), s(false, 0)]), { kind: "manyChase" });
  assert.deepEqual(chaseReason([s(true, 0), s(true, 0)]), { kind: "nobodyChases" });
});

// ── sampleFromStageResult ───────────────────────────────────────────────────
test("sampleFromStageResult: vinderens dom + hold der hentede udbruddet", () => {
  const res = {
    ranked: [{ rider_id: "a", breakaway_win: false }],
    v4Output: { timeline: { events: [
      { type: "breakaway_caught", params: { chasing_team_ids: ["t1", "t2"] } },
      { type: "breakaway_caught", params: { chasing_team_ids: ["t2", "t3"] } },
      { type: "finish" },
    ] } },
  };
  assert.deepEqual(sampleFromStageResult(res), { breakawayWin: false, known: true, caught: true, chasingTeams: 3 });
});

test("sampleFromStageResult: uden dom er udfaldet ukendt", () => {
  assert.equal(sampleFromStageResult({ ranked: [{ rider_id: "a" }] }).known, false);
  assert.equal(sampleFromStageResult(null).known, false);
});

// ── summarizeOutlook ────────────────────────────────────────────────────────
test("summarizeOutlook: ét ukendt udfald → ingen chance (motoren står ikke inde for tallet)", () => {
  assert.deepEqual(summarizeOutlook([s(true, 1), { known: false }]), { available: false, reason: "engine_unsure" });
  assert.deepEqual(summarizeOutlook([]), { available: false, reason: "engine_unsure" });
});

test("summarizeOutlook: brøk + årsag", () => {
  const out = summarizeOutlook([s(false, 0), s(true, 4), s(true, 4), s(true, 3)]);
  assert.deepEqual(out, { available: true, runs: 4, odds: { about: [1, 4] }, chase: { kind: "manyChase" } });
});

// ── computeBreakawayOutlook med falsk motor ────────────────────────────────
const RACE = { id: "race-1", stages: 3, stages_completed: 1, status: "running" };

function fakeEngine({ winsFor = () => false } = {}) {
  const calls = [];
  return {
    calls,
    simulateStage(args) {
      calls.push(args);
      const won = winsFor(args.seedString);
      return {
        ranked: [{ rider_id: "w", breakaway_win: won }],
        v4Output: { timeline: { events: won ? [] : [{ type: "breakaway_caught", params: { chasing_team_ids: ["t1"] } }] } },
      };
    },
  };
}

function harness({ engine = fakeEngine(), profileType = "mountain", rulesRevision = "s5_profiles_v3", engineOn = true } = {}) {
  const seen = {};
  const resolveRaceEngineV4 = async () => (engineOn ? { v4Engine: engine, teamOrderRows: [{ team_id: "secret" }] } : { v4Engine: null, teamOrderRows: [] });
  const runDryStage = async ({ stageIndex, resolveV4Engine }) => {
    seen.stageIndex = stageIndex;
    const resolved = await resolveV4Engine({});
    seen.teamOrderRows = resolved.teamOrderRows;
    if (!resolved.v4Engine) return;
    resolved.v4Engine.simulateStage({ stageNumber: stageIndex + 1, stageProfile: { profile_type: profileType }, rulesRevision, seedString: "REAL-SEED", teamOrderRows: resolved.teamOrderRows });
  };
  return { seen, resolveRaceEngineV4, runDryStage, engine };
}

test("computeBreakawayOutlook: næste etape, egne seeds, ingen private ordrer", async () => {
  const h = harness({ engine: fakeEngine({ winsFor: (seed) => seed.endsWith(":0") || seed.endsWith(":1") }) });
  const out = await computeBreakawayOutlook({ race: RACE, runDryStage: h.runDryStage, resolveRaceEngineV4: h.resolveRaceEngineV4, seeds: 8 });
  assert.equal(h.seen.stageIndex, 1);
  assert.deepEqual(h.seen.teamOrderRows, []);
  assert.ok(h.engine.calls.every((c) => c.seedString !== "REAL-SEED"), "løbets rigtige seed bruges aldrig");
  assert.ok(h.engine.calls.every((c) => c.seedString.startsWith("breakaway-outlook:race-1:2:")));
  assert.deepEqual(out, { available: true, runs: 8, odds: { about: [1, 4] }, chase: { kind: "fewChase" }, stageNumber: 2, profileType: "mountain" });
});

test("computeBreakawayOutlook: gates — motor slukket, gammel revision, tidskørsel, færdigt løb", async () => {
  const off = harness({ engineOn: false });
  assert.equal((await computeBreakawayOutlook({ race: RACE, runDryStage: off.runDryStage, resolveRaceEngineV4: off.resolveRaceEngineV4 })).reason, "engine_off");
  const old = harness({ rulesRevision: "s5_profiles_v2" });
  assert.equal((await computeBreakawayOutlook({ race: RACE, runDryStage: old.runDryStage, resolveRaceEngineV4: old.resolveRaceEngineV4 })).reason, "old_rules");
  const itt = harness({ profileType: "itt" });
  assert.equal((await computeBreakawayOutlook({ race: RACE, runDryStage: itt.runDryStage, resolveRaceEngineV4: itt.resolveRaceEngineV4 })).reason, "no_breakaway");
  const done = harness();
  assert.equal((await computeBreakawayOutlook({ race: { ...RACE, stages_completed: 3 }, runDryStage: done.runDryStage, resolveRaceEngineV4: done.resolveRaceEngineV4 })).reason, "race_done");
  assert.equal((await computeBreakawayOutlook({ race: { ...RACE, status: "completed" }, runDryStage: done.runDryStage, resolveRaceEngineV4: done.resolveRaceEngineV4 })).reason, "race_done");
});

test("outlookSeedString: kendt form, adskilt fra løbets seed-navnerum", () => {
  assert.equal(outlookSeedString("r", 2, 5), "breakaway-outlook:r:2:5");
});

// ── cache + single-flight ───────────────────────────────────────────────────
test("getBreakawayOutlookCached: samtidige kald deler én beregning; ny etape = ny nøgle", async () => {
  __resetBreakawayOutlookCache();
  let n = 0;
  const compute = async () => { n += 1; return { available: true, n }; };
  const [a, b] = await Promise.all([
    getBreakawayOutlookCached({ race: RACE, compute }),
    getBreakawayOutlookCached({ race: RACE, compute }),
  ]);
  assert.equal(n, 1);
  assert.deepEqual(a, b);
  await getBreakawayOutlookCached({ race: RACE, compute });
  assert.equal(n, 1, "inden for TTL genbruges svaret");
  await getBreakawayOutlookCached({ race: { ...RACE, stages_completed: 2 }, compute });
  assert.equal(n, 2);
  assert.notEqual(outlookCacheKey(RACE), outlookCacheKey({ ...RACE, stages_completed: 2 }));
});

test("getBreakawayOutlookCached: udløbet TTL beregner forfra; fejl caches ikke", async () => {
  __resetBreakawayOutlookCache();
  let t = 0;
  let n = 0;
  const compute = async () => { n += 1; return { n }; };
  await getBreakawayOutlookCached({ race: RACE, compute, now: () => t, ttlMs: 10 });
  t = 11;
  await getBreakawayOutlookCached({ race: RACE, compute, now: () => t, ttlMs: 10 });
  assert.equal(n, 2);
  __resetBreakawayOutlookCache();
  await assert.rejects(getBreakawayOutlookCached({ race: RACE, compute: async () => { throw new Error("boom"); } }));
  await getBreakawayOutlookCached({ race: RACE, compute });
  assert.equal(n, 3);
});
