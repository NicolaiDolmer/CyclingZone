// #1140 — klient-siden af "Your first race"-gaten: kun ?preview=first-race
// sendes videre (alt andet droppes), og et svar der ikke er et tydeligt
// "visible: true" giver INTET kort.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readFirstRacePreviewParam, normalizeFirstRaceCardPayload } from "./useFirstRaceCard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("readFirstRacePreviewParam: kun den praecise vaerdi slipper igennem", () => {
  assert.equal(readFirstRacePreviewParam("?preview=first-race"), "first-race");
  assert.equal(readFirstRacePreviewParam("?x=1&preview=first-race"), "first-race");
  assert.equal(readFirstRacePreviewParam("?preview=other"), null);
  assert.equal(readFirstRacePreviewParam("?preview="), null);
  assert.equal(readFirstRacePreviewParam(""), null);
  assert.equal(readFirstRacePreviewParam(undefined), null);
});

test("normalizeFirstRaceCardPayload: fail-safe til intet kort", () => {
  assert.equal(normalizeFirstRaceCardPayload(null), null);
  assert.equal(normalizeFirstRaceCardPayload({}), null);
  assert.equal(normalizeFirstRaceCardPayload({ visible: false }), null);
  assert.equal(normalizeFirstRaceCardPayload({ visible: "true" }), null);
  assert.deepEqual(
    normalizeFirstRaceCardPayload({ visible: true, preview: true, assistant_picks: true, mail: true, next_season_start: "2026-11-02" }),
    { preview: true, assistant_picks: true, mail: true, next_season_start: "2026-11-02" },
  );
  // Manglende booleans bliver false, aldrig truthy: en saetning der ikke er bekraeftet udelades.
  assert.deepEqual(
    normalizeFirstRaceCardPayload({ visible: true }),
    { preview: false, assistant_picks: false, mail: false, next_season_start: null },
  );
});

test("DashboardPage: kortet skjuler holdudtagelses-kortet og ejer guldet kun mens det vises", () => {
  const src = readFileSync(resolve(__dirname, "../pages/DashboardPage.jsx"), "utf8");
  assert.match(src, /const showTeamSelectionCta = Boolean\(squadSelectionMissingRace\) && !firstRaceCardModel;/);
  assert.match(src, /firstRaceMomentActive: firstRaceMomentActive \|\| Boolean\(firstRaceCardModel\?\.showCta\)/);
  assert.match(src, /squadCtaEligible: showTeamSelectionCta/);
  // Aldrig sammen med first-race-momentet (#3310).
  assert.match(src, /Boolean\(firstRaceCard\) && !firstRaceMomentActive/);
});
