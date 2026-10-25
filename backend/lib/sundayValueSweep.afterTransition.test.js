// #5842 (ejer 25/10): værdierne straks efter et fuldført sæsonskifte, kun én gang.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runValuesAfterTransition } from "./sundayValueSweep.js";

const NOW = new Date("2026-10-25T21:40:00Z"); // søndag 22:40 dansk tid (vintertid)

test("kalder den samme søndags-kørsel med skiftets klokkeslæt og returnerer dens svar", async () => {
  const calls = [];
  const out = await runValuesAfterTransition({
    supabase: {}, now: NOW,
    runSweep: async (args) => { calls.push(args); return { ran: true, written: 12 }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].now, NOW);
  assert.deepEqual(out, { ran: true, written: 12 });
});

test("en dag der allerede er kørt, giver ingen ny skrivning (claim'et bestemmer)", async () => {
  const out = await runValuesAfterTransition({
    supabase: {}, now: NOW,
    runSweep: async () => ({ ran: false, skipped: "already_ran_today" }),
  });
  assert.deepEqual(out, { ran: false, skipped: "already_ran_today" });
});

test("kaster aldrig: en fejl rapporteres, og timetikket er sikkerhedsnettet", async () => {
  const captured = [];
  const out = await runValuesAfterTransition({
    supabase: {}, now: NOW,
    runSweep: async () => { throw new Error("db nede"); },
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
  });
  assert.deepEqual(out, { ran: false, skipped: "error_after_transition" });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ctx.tags.stage, "after_transition");
});
