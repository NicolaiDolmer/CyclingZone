// #6853 / #5764 (løsning B): én regel for hvilken rolles potentiale fladerne viser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bestPotentialBand, displayPotentialBand } from "./potentialDisplayBand.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

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

test("displayPotentialBand: altid rollen med højest potentiale", () => {
  assert.equal(displayPotentialBand(bands, "climber").key, "puncheur");
  assert.equal(displayPotentialBand(bands, "unknown").key, "puncheur");
});

test("displayPotentialBand: det valgte bånds midtpunkt er aldrig under den naturlige rolles", () => {
  for (const natural of ["climber", "puncheur", "rouleur"]) {
    const nat = bands.find((b) => b.key === natural);
    const shown = displayPotentialBand(bands, natural);
    assert.ok(shown.progLo + shown.progHi >= nat.progLo + nat.progHi);
  }
});

test("wiring: estimates, scouting-rapport og akademi vælger gennem samme regel", () => {
  assert.match(apiSource, /displayPotentialBand\(bands, rider\.primary_type\)/);
  assert.match(apiSource, /bestPotentialBand\(types, rider\.primary_type\)/);
  assert.doesNotMatch(apiSource, /viewerPotentialBestRole|isPotentialBestRoleEnabled/);
});
