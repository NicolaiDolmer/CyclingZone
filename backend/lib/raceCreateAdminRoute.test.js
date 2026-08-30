import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateRaceStageProfiles, GENERATOR_VERSION, toStageProfileRow } from "./raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #2812 — admin race create: rute-felter (distance_km/elevation_gain_m/
// climbs/sprints/sectors) skal persisteres på lige fod med
// tierCalendarMaterializer.js og backfillRaceStageProfiles.js.
// ------------------------------------------------------------
// Rod-årsag: POST /api/admin/races mappede kun race_id/stage_number/
// profile_type/finale_type/demand_vector/segments/weather til
// race_stage_profiles-rækken — de fem rute-felter manglede, selvom
// generator_version blev stemplet (loves rutedata der ikke fandtes).
// En kode-kommentar fra #4028 erklærede hullet "uden for scope" — det
// er nu lukket via den delte row-shaper toStageProfileRow().
// ============================================================

function isolatePostHandler() {
  const match = apiSource.match(
    /router\.post\(\s*"\/admin\/races"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere POST /admin/races-handler-block");
  return match[0];
}

test("POST /admin/races bruger den delte toStageProfileRow-mapper (ikke en lokal inline-liste)", () => {
  const block = isolatePostHandler();
  assert.match(
    block,
    /toStageProfileRow\(\s*createdRace\.id\s*,\s*p\s*\)/,
    "POST-handler skal bygge race_stage_profiles-rækker via toStageProfileRow, samme som tierCalendarMaterializer.js + backfillRaceStageProfiles.js",
  );
});

test("toStageProfileRow udfylder alle fem rute-felter for et enkeltstart-løb", () => {
  const race = { id: "race-1", race_type: "single", stages: 1 };
  const profiles = generateRaceStageProfiles(race);
  assert.ok(profiles.length > 0);
  for (const p of profiles) {
    const row = toStageProfileRow(race.id, p);
    assert.equal(row.race_id, race.id);
    assert.equal(typeof row.distance_km, "number");
    assert.equal(typeof row.elevation_gain_m, "number");
    assert.ok(Array.isArray(row.climbs), "climbs skal være et array");
    assert.ok(Array.isArray(row.sprints), "sprints skal være et array");
    assert.ok(Array.isArray(row.sectors), "sectors skal være et array");
    assert.equal(row.generator_version, GENERATOR_VERSION);
    assert.equal(row.is_manual, false);
  }
});

test("toStageProfileRow udfylder alle fem rute-felter for hver etape i et etapeløb", () => {
  const race = { id: "race-2", race_type: "stage_race", stages: 5 };
  const profiles = generateRaceStageProfiles(race);
  assert.equal(profiles.length, 5);
  for (const p of profiles) {
    const row = toStageProfileRow(race.id, p);
    assert.equal(typeof row.distance_km, "number", `etape ${p.stage_number}: distance_km mangler`);
    assert.equal(typeof row.elevation_gain_m, "number", `etape ${p.stage_number}: elevation_gain_m mangler`);
    assert.ok(Array.isArray(row.climbs), `etape ${p.stage_number}: climbs mangler`);
    assert.ok(Array.isArray(row.sprints), `etape ${p.stage_number}: sprints mangler`);
    assert.ok(Array.isArray(row.sectors), `etape ${p.stage_number}: sectors mangler`);
  }
});
