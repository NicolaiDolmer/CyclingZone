// Kilde-struktur-guards for #4979's etapeprofil-række (samme mønster som
// RaceTacticsTab.contract.test.js: repoet kører node --test uden jsdom, så
// komponent-kontrakter pinnes på kilden).
//
// Hvad der pinnes, og hvorfor:
//   1. Uden rutedata renderes INTET — ingen syntetisk profil på en flade der
//      ikke har en rute (samme gate som StageProfileCard).
//   2. ÉN graf, compact tier, ingen sektionsoverskrift: rækken er tynd og
//      må ikke vokse til endnu et kort med eget hoved (fold-disciplin).
//   3. Rækken bærer intet interaktivt — den ene guld-knap bor i fanens kort.
//   4. Hold-fanen tegner rækken ØVERST, og siden fodrer den med hero'ens
//      etape (focusProfile), ikke med en etape fanen selv finder på.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), "utf8");
const source = read("RaceStageProfileRow.jsx");
const teamTab = read("RaceTeamTab.jsx");
const page = read("../../pages/RaceDetailPage.jsx");

test("uden rutedata renderer rækken intet", () => {
  assert.match(source, /if \(!profile \|\| !hasRouteData\(profile\)\) return null;/);
});

test("én graf, compact tier — ingen sektionsoverskrift og ingen anden profil-komponent", () => {
  const graphs = source.match(/<StageProfileGraph/g) || [];
  assert.equal(graphs.length, 1, "præcis én graf i rækken");
  assert.match(source, /tier="compact"/);
  assert.doesNotMatch(source, /SectionHeader|<h2|<h3/);
  assert.doesNotMatch(source, /<StageProfileCard|<StageDetailPanel/);
});

test("rækken er ren visning: ingen knapper, ingen guld-primær", () => {
  assert.doesNotMatch(source, /<button|variant="primary"/);
});

test("Hold-fanen tegner rækken øverst, og siden fodrer den med hero'ens etape", () => {
  assert.match(teamTab, /<RaceStageProfileRow profile=\{stageProfile\}/);
  const rowAt = teamTab.indexOf("const profileRow = (");
  const rosterAt = teamTab.indexOf('data-testid="race-team-tab"');
  assert.ok(rowAt > 0 && rosterAt > rowAt, "rækken skal stå før holdlistens kort");
  // FØR løbet er fanen holdudtagelsen — rækken skal også stå der.
  assert.match(teamTab, /id="race-selection-anchor"[\s\S]{0,220}<RaceStageProfileRow/);
  assert.match(page, /stageProfile=\{focusProfile\}/);
});
