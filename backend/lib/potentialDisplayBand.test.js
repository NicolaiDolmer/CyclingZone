// #6853 / #5764 (løsning B): én regel for hvilken rolles potentiale fladerne viser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  POTENTIAL_SINGLE_NUMBER_FLAG_KEY,
  bestPotentialBand,
  displayPotentialBand,
  isPotentialBestRoleEnabled,
} from "./potentialDisplayBand.js";
import { isStageFlagKey } from "./stageFlagCatalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function fakeSupabase(value) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }),
        }),
      }),
    }),
  };
}

const bands = [
  { key: "climber", progLo: 40, progHi: 50 },
  { key: "puncheur", progLo: 44, progHi: 52 },
  { key: "sprinter", progLo: null, progHi: null },
  { key: "rouleur", progLo: 30, progHi: 38 },
];

test("bestPotentialBand: højeste midtpunkt vinder", () => {
  assert.equal(bestPotentialBand(bands, "climber").key, "puncheur");
});

test("bestPotentialBand: lighed giver den naturlige rolle", () => {
  const tie = [
    { key: "climber", progLo: 40, progHi: 50 },
    { key: "puncheur", progLo: 42, progHi: 48 },
  ];
  assert.equal(bestPotentialBand(tie, "puncheur").key, "puncheur");
  assert.equal(bestPotentialBand(tie, "climber").key, "climber");
  // Ingen naturlig rolle blandt de lige: første i listen.
  assert.equal(bestPotentialBand(tie, "sprinter").key, "climber");
});

test("bestPotentialBand: springer roller uden bånd over og giver null uden data", () => {
  assert.equal(bestPotentialBand([{ key: "sprinter", progLo: null, progHi: null }], "sprinter"), null);
  assert.equal(bestPotentialBand([], "climber"), null);
  assert.equal(bestPotentialBand(null, "climber"), null);
});

test("displayPotentialBand: slukket = den naturlige rolle (dagens visning)", () => {
  assert.equal(displayPotentialBand(bands, "climber").key, "climber");
  assert.equal(displayPotentialBand(bands, "climber", { bestRole: false }).key, "climber");
  assert.equal(displayPotentialBand(bands, "unknown"), null);
});

test("displayPotentialBand: tændt = rollen med højest potentiale", () => {
  assert.equal(displayPotentialBand(bands, "climber", { bestRole: true }).key, "puncheur");
});

test("displayPotentialBand: det valgte bånds midtpunkt er aldrig under den naturlige rolles", () => {
  for (const natural of ["climber", "puncheur", "rouleur"]) {
    const nat = displayPotentialBand(bands, natural);
    const shown = displayPotentialBand(bands, natural, { bestRole: true });
    assert.ok(shown.progLo + shown.progHi >= nat.progLo + nat.progHi);
  }
});

test("flaget: fail-safe off, beta kun for beta-testere, on for alle", async () => {
  assert.equal(POTENTIAL_SINGLE_NUMBER_FLAG_KEY, "potential_single_number");
  assert.equal(isStageFlagKey(POTENTIAL_SINGLE_NUMBER_FLAG_KEY), true);
  assert.equal(await isPotentialBestRoleEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isPotentialBestRoleEnabled(fakeSupabase("off")), false);
  assert.equal(await isPotentialBestRoleEnabled(fakeSupabase("beta")), false);
  assert.equal(await isPotentialBestRoleEnabled(fakeSupabase("beta"), { isBetaTester: true }), true);
  assert.equal(await isPotentialBestRoleEnabled(fakeSupabase("on")), true);
  assert.equal(await isPotentialBestRoleEnabled(fakeSupabase("garbage")), false);
});

test("wiring: estimates, scouting-rapport og akademi vælger gennem samme regel", () => {
  assert.match(apiSource, /displayPotentialBand\(bands, rider\.primary_type, \{ bestRole \}\)/);
  assert.match(apiSource, /bestPotentialBand\(types, rider\.primary_type\)/);
  assert.match(apiSource, /buildIntake2View\(supabase, \{[^}]*bestRole: await viewerPotentialBestRole\(req\)/);
  // Akademiets prognose i estimates og rapporten får flaget med.
  const academyCalls = apiSource.match(/loadAcademyPrognoses\(supabase, \{[\s\S]*?\}\);/g) ?? [];
  assert.ok(academyCalls.length >= 2);
  for (const call of academyCalls) assert.match(call, /bestRole/);
});
