import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FINALIZE_STEPS,
  applicableSteps,
  buildFinalizeState,
  isAttemptOnceStep,
  isFinalizeComplete,
  normalizeFinalizeState,
  readFinalizeState,
  remainingSteps,
  writeFinalizeState,
} from "./raceFinalizeState.js";

test("normalizeFinalizeState: markering for en ANDEN etape ignoreres", () => {
  const raw = { stage_index: 0, stage_number: 1, done: ["write"] };
  assert.equal(normalizeFinalizeState(raw, { stageNumber: 2 }), null);
  assert.deepEqual(normalizeFinalizeState(raw, { stageNumber: 1 }).done, ["write"]);
});

test("normalizeFinalizeState: skrald ind → null ud (aldrig et halvt objekt)", () => {
  for (const raw of [null, undefined, 42, "write", [], {}, { stage_number: "x" }]) {
    assert.equal(normalizeFinalizeState(raw, { stageNumber: 1 }), null, `raw=${JSON.stringify(raw)}`);
  }
});

test("normalizeFinalizeState: ukendte trin-navne filtreres væk", () => {
  const st = normalizeFinalizeState({ stage_number: 3, done: ["write", "teleport", "notify"] }, { stageNumber: 3 });
  assert.deepEqual(st.done, ["write", "notify"]);
});

test("applicableSteps: mellem-etape har hverken matview, board eller status-flush", () => {
  const mid = applicableSteps({ isFinalStage: false });
  assert.ok(!mid.includes("matview"));
  assert.ok(!mid.includes("board"));
  assert.ok(!mid.includes("status-flush"));
  assert.ok(mid.includes("write") && mid.includes("enrichment") && mid.includes("notify"));
});

test("applicableSteps: rest-day med KUN når der er et game_day-hul", () => {
  assert.ok(!applicableSteps({ isFinalStage: false, hasRestDay: false }).includes("rest-day"));
  assert.ok(applicableSteps({ isFinalStage: false, hasRestDay: true }).includes("rest-day"));
});

test("applicableSteps: final-etape har hele kæden (minus rest-day uden hul)", () => {
  const fin = applicableSteps({ isFinalStage: true });
  assert.deepEqual(fin, FINALIZE_STEPS.filter((s) => s !== "rest-day"));
});

test("remainingSteps/isFinalizeComplete: markeringen driver hvad der mangler", () => {
  const steps = applicableSteps({ isFinalStage: false });
  const state = { done: ["write", "standings"] };
  assert.deepEqual(remainingSteps(state, steps), ["enrichment", "fatigue", "notify"]);
  assert.equal(isFinalizeComplete(state, steps), false);
  assert.equal(isFinalizeComplete({ done: steps }, steps), true);
});

test("ENGANGS-trin er præcis fatigue/rest-day/notify — resten må gentages", () => {
  const once = FINALIZE_STEPS.filter(isAttemptOnceStep);
  assert.deepEqual(once, ["fatigue", "rest-day", "notify"]);
});

test("buildFinalizeState: done skrives i kanonisk rækkefølge, ikke kalder-rækkefølge", () => {
  const st = buildFinalizeState({ stageIndex: 2, stageNumber: 3, isFinalStage: true, startedAt: "T", done: ["notify", "write", "standings"] });
  assert.deepEqual(st.done, ["write", "standings", "notify"]);
  assert.equal(st.final, true);
  assert.equal(st.stage_index, 2);
});

test("readFinalizeState: DB-fejl → null (må aldrig vælte afviklingen)", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "column does not exist" } }) }) }),
    }),
  };
  assert.equal(await readFinalizeState(supabase, "r1"), null);
});

test("readFinalizeState: kaster klienten, fanges det stadig", async () => {
  const supabase = { from: () => { throw new Error("boom"); } };
  assert.equal(await readFinalizeState(supabase, "r1"), null);
});

test("writeFinalizeState: state=null rydder BEGGE kolonner", async () => {
  const writes = [];
  const supabase = {
    from: () => ({ update: (obj) => { writes.push(obj); return { eq: async () => ({ error: null }) }; } }),
  };
  await writeFinalizeState(supabase, "r1", null);
  assert.deepEqual(writes[0], { finalize_state: null, finalize_updated_at: null });
});

test("writeFinalizeState: skriver tidsstempel sammen med markeringen", async () => {
  const writes = [];
  const supabase = {
    from: () => ({ update: (obj) => { writes.push(obj); return { eq: async () => ({ error: null }) }; } }),
  };
  const now = new Date("2026-09-04T18:00:00.000Z");
  const state = buildFinalizeState({ stageIndex: 0, stageNumber: 1, isFinalStage: false, startedAt: null, done: ["write"] });
  assert.equal(await writeFinalizeState(supabase, "r1", state, { now }), true);
  assert.equal(writes[0].finalize_updated_at, "2026-09-04T18:00:00.000Z");
  assert.deepEqual(writes[0].finalize_state.done, ["write"]);
});
