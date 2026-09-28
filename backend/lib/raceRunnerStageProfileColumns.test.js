// #5826: v4 skal have etapens GEMTE rute og vejr fra race_stage_profiles.
// Uden segments/weather i raceRunner's select genopbygger routeAdapter ruten og
// trækker vejret fra en fælles fallback-nøgle ("adhoc:<etape>:weather"), så alle
// etaper med samme profil og etapenummer fik identisk vejr.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STAGE_PROFILE_COLUMNS } from "./raceRunner.js";
import { routeFromStageProfileRow } from "./engine/v4/adapters/routeAdapter.ts";

const columns = STAGE_PROFILE_COLUMNS.split(",").map((c) => c.trim());

test("#5826 raceRunner henter v4's gemte rute og vejr", () => {
  assert.ok(columns.includes("segments"));
  assert.ok(columns.includes("weather"));
});

test("#2770 passage-lagets rutefelter hentes stadig", () => {
  for (const c of ["stage_number", "profile_type", "finale_type", "demand_vector", "distance_km", "elevation_gain_m", "climbs", "sprints", "sectors"]) {
    assert.ok(columns.includes(c), c);
  }
});

test("#5826 en række med gemt vejr får SIT vejr, ikke fallbackens", () => {
  const base = {
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", distance_km: 150,
    climbs: [], sprints: [], sectors: [],
    segments: [{ kind: "flat", from_km: 0, to_km: 150 }],
  };
  const rain = routeFromStageProfileRow({ ...base, weather: { kind: "rain", wind_exposure: 0.45 } });
  const dry = routeFromStageProfileRow({ ...base, weather: { kind: "wind", wind_exposure: 0.1 } });
  assert.deepEqual(rain.weather, { kind: "rain", wind_exposure: 0.45 });
  assert.deepEqual(dry.weather, { kind: "wind", wind_exposure: 0.1 });
});
