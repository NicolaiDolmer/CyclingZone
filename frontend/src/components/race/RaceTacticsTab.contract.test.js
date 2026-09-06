// Kilde-struktur-guards for Taktik-fanen (#4613, variant A) — samme mønster som
// RaceSelectionPanel.autoSelect.test.js: repoet kører node --test uden jsdom, så
// komponent-kontrakter pinnes på kilden.
//
// Hvad der pinnes, og hvorfor det er værd at pinne:
//   1. Trinnene kommer fra serverens valid_efforts, ALDRIG en lokal femtrins-
//      liste — ellers ville et UI deployet før flag-flippet tilbyde valg
//      backenden afviser med 400 (stage_roles_invalid_effort).
//   2. Endagsløb har ingen etape-vælger, og kolonnen hedder "løbsdag".
//   3. Præcis ÉN guld-knap i fanen (TASTE P3): "Gem etape N". "Kopiér til
//      etape N" er sekundær.
//   4. Rollen redigeres ikke pr. etape — kolonnen er ren visning.
//   5. Et gem rammer BEGGE endpoints for den åbne etape (#4613's hele pointe:
//      intention og ordrer hører til samme dag og samme knap).
//   6. En låst etape kan åbnes, men aldrig gemmes.
//   7. Fladen viser ingen tal ud over etapenumre (fog of war).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RaceTacticsTab.jsx"), "utf8");

test("trinnene kommer fra serverens valid_efforts, ikke fra en hardkodet liste", () => {
  assert.match(source, /orderedEfforts\(roles\?\.valid_efforts\)/);
  // Ingen lokal opremsning af de fem værdier i selve fladen.
  assert.doesNotMatch(source, /"grupetto"/);
  assert.doesNotMatch(source, /"all_out"/);
});

test("endagsløb: ingen etape-vælger, og kolonnen hedder løbsdag", () => {
  assert.match(source, /const isOneDay = stageCount <= 1;/);
  assert.match(source, /isOneDay \? \(\s*<span/);
  assert.match(source, /intention\.colIntentionRaceDay/);
  assert.match(source, /intention\.saveRaceDay/);
});

test("præcis én guld-knap: Gem er primary, Kopiér er secondary", () => {
  const primaries = source.match(/variant="primary"/g) || [];
  assert.equal(primaries.length, 1, "fanen må have præcis én guld-primær knap");
  assert.match(source, /variant="secondary"[\s\S]{0,200}intention\.copyToStage/);
  assert.match(source, /variant="primary"[\s\S]{0,300}intention\.save/);
});

test("rollen er ren visning — ingen rolle-vælger pr. etape", () => {
  assert.doesNotMatch(source, /race_role: e\.target\.value/);
  assert.doesNotMatch(source, /<select/);
  assert.match(source, /tacticsOrders\.roleLabel\.\$\{roleKey\(baseRoleForRider\(rider\)\)\}/);
});

test("ét gem rammer begge endpoints for den åbne etape", () => {
  assert.match(source, /diffToOverrides\(\{ matrix: draftMatrix, riders \}\)/);
  assert.match(source, /\/api\/races\/\$\{raceId\}\/stage-roles/);
  assert.match(source, /saveTacticsCard\(\{ raceId, stage: activeStage, order \}\)/);
  // Ordrerne gemmes EFTER intentionen, så en afvist intention (400) ikke
  // efterlader en halvt gemt dag.
  const rolesAt = source.indexOf("/stage-roles`");
  const ordersAt = source.indexOf("saveTacticsCard({ raceId");
  assert.ok(rolesAt > 0 && ordersAt > rolesAt, "intentionen skal gemmes før ordrerne");
});

test("en låst etape kan åbnes, men aldrig gemmes", () => {
  assert.match(source, /if \(stageLocked\) return;/);
  assert.match(source, /const dirty = !stageLocked &&/);
  // Vælgerens knapper er IKKE disabled på låste etaper — man skal kunne se
  // tilbage på hvad man sendte dem ud med.
  assert.doesNotMatch(source, /disabled=\{locked \|\| saving\}/);
});

test("fog of war: ingen tal, procenter eller loft-signaler i fladens tekst", () => {
  assert.doesNotMatch(source, /%/);
  assert.doesNotMatch(source, /WORK_COST|MULT|multiplier/i);
});
