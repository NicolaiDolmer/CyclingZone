import test from "node:test";
import assert from "node:assert/strict";

import { runSeasonStartHooks } from "./seasonStartHooks.js";

const supabase = { from: () => { throw new Error("skal ikke bruges — begge hooks er injiceret"); } };

test("returnerer ét log-fragment pr. hook, i fast rækkefølge (træthed, form, akademi)", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: true, changed: 12 }),
      applySeasonFormReset: async () => ({ ran: true, changed: 5 }),
      runSeasonAcademyIntake: async () => ({ ran: true, candidates: 7 }),
    },
  });
  assert.deepEqual(log, [
    { phase: "season_fatigue_reset", ran: true, changed: 12 },
    { phase: "season_form_reset", ran: true, changed: 5 },
    { phase: "season_academy_intake", ran: true, candidates: 7 },
  ]);
});

test("en fejl i trætheds-hooket stopper IKKE form- eller akademi-hooket", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => { throw new Error("upsert nede"); },
      applySeasonFormReset: async () => ({ ran: true, changed: 5 }),
      runSeasonAcademyIntake: async () => ({ ran: true, candidates: 3 }),
    },
  });
  assert.equal(log[0].phase, "season_fatigue_reset");
  assert.equal(log[0].error, "upsert nede");
  assert.deepEqual(log[1], { phase: "season_form_reset", ran: true, changed: 5 });
  assert.deepEqual(log[2], { phase: "season_academy_intake", ran: true, candidates: 3 });
});

test("en fejl i form-hooket stopper IKKE akademi-hooket", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => { throw new Error("mode 'band' uden season"); },
      runSeasonAcademyIntake: async () => ({ ran: true, candidates: 3 }),
    },
  });
  assert.equal(log.length, 2);
  assert.equal(log[0].phase, "season_form_reset");
  assert.equal(log[0].error, "mode 'band' uden season");
  assert.deepEqual(log[1], { phase: "season_academy_intake", ran: true, candidates: 3 });
});

test("en fejl i akademi-hooket kaster ikke videre op i transitionen", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => { throw new Error("seed nede"); },
    },
  });
  // Træthed + form var slukket → ingen fase-rækker; kun akademi-fejlen står tilbage.
  assert.equal(log.length, 1);
  assert.equal(log[0].phase, "season_academy_intake");
  assert.equal(log[0].error, "seed nede");
});

test("alle tre gated mekanikker off → TOM log (fase-tællingen er uændret fra før PR'en)", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
    },
  });
  assert.deepEqual(log, []);
});

test("andre 'ran: false'-årsager end flag_off logges (fejlkonfiguration skal ses)", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "academy_flag_off" }),
    },
  });
  assert.deepEqual(log, [{ phase: "season_academy_intake", ran: false, reason: "academy_flag_off" }]);
});

test("toSeasonNumber sendes videre til form-hooket som 'season' (idempotens-seed for band-mode)", async () => {
  let receivedSeason;
  const log = await runSeasonStartHooks({
    supabase,
    toSeasonNumber: 3,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async ({ season }) => {
        receivedSeason = season;
        return { ran: true, mode: "band", changed: 0 };
      },
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
    },
  });
  assert.equal(receivedSeason, 3);
  assert.deepEqual(log, [{ phase: "season_form_reset", ran: true, mode: "band", changed: 0 }]);
});
