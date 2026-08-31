import test from "node:test";
import assert from "node:assert/strict";

import { runSeasonStartHooks } from "./seasonStartHooks.js";

const supabase = { from: () => { throw new Error("skal ikke bruges — begge hooks er injiceret"); } };

test("returnerer ét log-fragment pr. hook, i fast rækkefølge (træthed, form, akademi, bonus-udløb)", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => ({ ran: true, changed: 12 }),
      applySeasonFormReset: async () => ({ ran: true, changed: 5 }),
      runSeasonAcademyIntake: async () => ({ ran: true, candidates: 7 }),
    },
  });
  assert.deepEqual(log, [
    { phase: "season_fatigue_reset", ran: true, changed: 12 },
    { phase: "season_form_reset", ran: true, changed: 5 },
    { phase: "season_academy_intake", ran: true, candidates: 7 },
    { phase: "board_bonus_offer_expiry", expired: 0 },
  ]);
});

test("en fejl i trætheds-hooket stopper IKKE form- eller akademi-hooket", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => { throw new Error("upsert nede"); },
      applySeasonFormReset: async () => ({ ran: true, changed: 5 }),
      runSeasonAcademyIntake: async () => ({ ran: true, candidates: 3 }),
    },
  });
  assert.equal(log[0].phase, "season_fatigue_reset");
  assert.equal(log[0].error, "upsert nede");
  assert.deepEqual(log[1], { phase: "season_form_reset", ran: true, changed: 5 });
  assert.deepEqual(log[2], { phase: "season_academy_intake", ran: true, candidates: 3 });
  assert.deepEqual(log[3], { phase: "board_bonus_offer_expiry", expired: 0 });
});

test("en fejl i form-hooket stopper IKKE akademi-hooket", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => { throw new Error("mode 'band' uden season"); },
      runSeasonAcademyIntake: async () => ({ ran: true, candidates: 3 }),
    },
  });
  assert.equal(log.length, 3);
  assert.equal(log[0].phase, "season_form_reset");
  assert.equal(log[0].error, "mode 'band' uden season");
  assert.deepEqual(log[1], { phase: "season_academy_intake", ran: true, candidates: 3 });
  assert.deepEqual(log[2], { phase: "board_bonus_offer_expiry", expired: 0 });
});

test("en fejl i akademi-hooket kaster ikke videre op i transitionen", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => { throw new Error("seed nede"); },
    },
  });
  // Træthed + form var slukket → ingen fase-rækker; kun akademi-fejlen står tilbage.
  assert.equal(log.length, 2);
  assert.equal(log[0].phase, "season_academy_intake");
  assert.equal(log[0].error, "seed nede");
});

test("alle tre gated mekanikker off → kun bonus-udløbet står tilbage (#4482 er IKKE flag-gatet)", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
    },
  });
  assert.deepEqual(log, [{ phase: "board_bonus_offer_expiry", expired: 0 }]);
});

test("andre 'ran: false'-årsager end flag_off logges (fejlkonfiguration skal ses)", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "academy_flag_off" }),
    },
  });
  assert.deepEqual(log, [{ phase: "season_academy_intake", ran: false, reason: "academy_flag_off" }, { phase: "board_bonus_offer_expiry", expired: 0 }]);
});

test("toSeasonNumber sendes videre til form-hooket som 'season' (idempotens-seed for band-mode)", async () => {
  let receivedSeason;
  const log = await runSeasonStartHooks({
    supabase,
    toSeasonNumber: 3,
    deps: {
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async ({ season }) => {
        receivedSeason = season;
        return { ran: true, mode: "band", changed: 0 };
      },
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
    },
  });
  assert.equal(receivedSeason, 3);
  assert.deepEqual(log, [{ phase: "season_form_reset", ran: true, mode: "band", changed: 0 }, { phase: "board_bonus_offer_expiry", expired: 0 }]);
});

// ── #4482 · bonus-udløbet ────────────────────────────────────────────────────

test("#4482 bonus-udløbet får den AFSLUTTEDE sæsons id, ikke den nye", async () => {
  // Off-by-one her ville enten lade tilbuddene leve videre (intet lukket hul)
  // eller dræbe et tilbud der lige var givet. Derfor måles argumentet direkte.
  let modtaget = "IKKE KALDT";
  await runSeasonStartHooks({
    supabase,
    toSeasonNumber: 4,
    fromSeasonId: "season-3",
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
      expireSeasonScopedConsequences: async (_sb, seasonId) => {
        modtaget = seasonId;
        return { expired: 4 };
      },
    },
  });
  assert.equal(modtaget, "season-3");
});

test("#4482 en fejl i bonus-udløbet vælter ikke sæsonskiftet", async () => {
  const log = await runSeasonStartHooks({
    supabase,
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
      expireSeasonScopedConsequences: async () => { throw new Error("db nede"); },
    },
  });
  assert.deepEqual(log, [{ phase: "board_bonus_offer_expiry", error: "db nede" }]);
});

test("#4482 bonus-udløbet logges ALTID — det er ikke flag-gatet", async () => {
  // De tre andre hooks ændrer spil-balance og skal kunne slås fra. Denne LUKKER
  // et hul: en tilstand hvor pengehullet står åbent må ikke kunne opstå ved et
  // uheld. Fælder hvis nogen tilføjer en flag-gate.
  const log = await runSeasonStartHooks({
    supabase,
    fromSeasonId: "season-3",
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
    },
  });
  assert.ok(
    log.some((l) => l.phase === "board_bonus_offer_expiry"),
    "bonus-udløbet skal stå i fase-loggen uanset de andre flags",
  );
});
