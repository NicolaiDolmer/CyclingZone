// Kilde-struktur-guards for intentions-fladen (#4632, variant B) — samme
// mønster som RaceSelectionPanel.autoSelect.test.js: repoet kører node --test
// uden jsdom, så komponent-kontrakter pinnes på kilden.
//
// Hvad der pinnes, og hvorfor det er værd at pinne:
//   1. Trinnene kommer fra serverens valid_efforts, ALDRIG en lokal femtrins-
//      liste — ellers ville et UI deployet før flag-flippet tilbyde valg
//      backenden afviser med 400 (stage_roles_invalid_effort).
//   2. Endagsløb har ingen etape-vælger, og kolonnen hedder "løbsdag".
//   3. Præcis ÉN guld-knap i kortet (TASTE P3): "Gem etape N". "Kopiér til
//      etape N" er sekundær.
//   4. Rollen redigeres ikke længere pr. etape — kolonnen er ren visning.
//   5. Fladen viser ingen tal ud over etapenumre (fog of war).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RaceIntentionPanel.jsx"), "utf8");

test("trinnene kommer fra serverens valid_efforts, ikke fra en hardkodet liste", () => {
  assert.match(source, /orderedEfforts\(data\?\.valid_efforts\)/);
  // Ingen lokal opremsning af de fem værdier i selve fladen.
  assert.doesNotMatch(source, /"grupetto"/);
  assert.doesNotMatch(source, /"all_out"/);
});

test("endagsløb: ingen etape-vælger, og kolonnen hedder løbsdag", () => {
  assert.match(source, /const isOneDay = \(data\?\.stage_count \?\? 0\) <= 1;/);
  assert.match(source, /isOneDay \? \(\s*<span/);
  assert.match(source, /intention\.colIntentionRaceDay/);
  assert.match(source, /intention\.saveRaceDay/);
});

test("kørte etaper kan ikke åbnes i vælgeren", () => {
  assert.match(source, /const locked = sn <= stagesCompleted;/);
  assert.match(source, /disabled=\{locked \|\| saving\}/);
});

test("præcis én guld-knap: Gem er primary, Kopiér er secondary", () => {
  const primaries = source.match(/variant="primary"/g) || [];
  assert.equal(primaries.length, 1, "kortet må have præcis én guld-primær knap");
  assert.match(source, /variant="secondary"[\s\S]{0,200}intention\.copyToStage/);
  assert.match(source, /variant="primary"[\s\S]{0,300}intention\.save/);
});

test("rollen er ren visning — ingen rolle-vælger pr. etape længere", () => {
  assert.doesNotMatch(source, /race_role: e\.target\.value/);
  assert.doesNotMatch(source, /<select/);
  assert.match(source, /roleLabelKey\(baseRoleForRider\(rider\)\)/);
});

test("gem sender hele diffen for de redigerbare etaper (PUT'en er REPLACE)", () => {
  assert.match(source, /diffToOverrides\(\{ matrix: draftMatrix, riders \}\)/);
  assert.match(source, /method: "PUT"/);
});

test("fog of war: ingen tal, procenter eller loft-signaler i fladens tekst", () => {
  assert.doesNotMatch(source, /%/);
  assert.doesNotMatch(source, /WORK_COST|MULT|multiplier/i);
});
