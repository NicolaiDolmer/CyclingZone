// #6574 · GET /api/public/stage-route/:stageId — offentlig, read-only etape-rute.
// Routeren køres som en rigtig express-app på en tilfældig port; Supabase er en fake.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createPublicStageRouteRouter, toPublicStageRoute } from "./publicStageRoute.js";

const STAGE_ID = "11111111-2222-4333-8444-555555555555";
const RACE_ID = "race-a";

function fakeSupabase(tables, { failOn = null } = {}) {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])];
      const api = {
        select() { return api; },
        eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
        maybeSingle() { return api; },
        then(resolve, reject) {
          const result = table === failOn
            ? { data: null, error: { message: "boom" } }
            : { data: rows[0] ?? null, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

const PROFILE = {
  id: STAGE_ID, race_id: RACE_ID, stage_number: 3, profile_type: "mountain",
  distance_km: 160, elevation_gain_m: 2900,
  demand_vector: { secret: 1 }, weather: { wind: 3 }, finale_type: "long_climb",
  climbs: [{ name: "Col A", category: "1", crest_km: 150, length_km: 10, avg_gradient: 7, summit_finish: false, extra: "x" }],
  sprints: [{ km: 80, kind: "intermediate", name: "Sprint" }],
  sectors: [],
  segments: [
    { kind: "rolling", from_km: 0, to_km: 140 },
    { kind: "climb", from_km: 140, to_km: 150, category: "1", avg_gradient: 7, top_elevation_m: 950 },
    { kind: "descent", from_km: 150, to_km: 160, technicality: 2 },
    { kind: "mystery", from_km: 0, to_km: 1 },
  ],
};
const TABLES = { race_stage_profiles: [PROFILE], races: [{ id: RACE_ID, name: "Tour Alpha", stages: 4 }] };

async function withServer(supabase, fn) {
  const app = express();
  app.use("/api/public/stage-route", createPublicStageRouteRouter({ supabase }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}/api/public/stage-route`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("200: whitelisted route fields only, cacheable", async () => {
  await withServer(fakeSupabase(TABLES), async (base) => {
    const res = await fetch(`${base}/${STAGE_ID}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /public/);
    const { stage } = await res.json();
    assert.equal(stage.race_name, "Tour Alpha");
    assert.equal(stage.stage_count, 4);
    assert.equal(stage.stage_number, 3);
    assert.equal(stage.distance_km, 160);
    assert.equal(stage.segments.length, 3, "unknown segment kinds dropped");
    const json = JSON.stringify(stage);
    for (const leak of ["demand_vector", "weather", "top_elevation_m", "technicality", "race_id", "extra"]) {
      assert.ok(!json.includes(leak), `${leak} must not leak`);
    }
  });
});

test("400 on a non-uuid id, 404 on unknown stage", async () => {
  await withServer(fakeSupabase(TABLES), async (base) => {
    assert.equal((await fetch(`${base}/not-a-uuid`)).status, 400);
    const missing = await fetch(`${base}/99999999-2222-4333-8444-555555555555`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "stage_not_found" });
  });
});

test("500 when the read fails, never cached", async () => {
  await withServer(fakeSupabase(TABLES, { failOn: "race_stage_profiles" }), async (base) => {
    const res = await fetch(`${base}/${STAGE_ID}`);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("cache-control"), null);
  });
});

test("toPublicStageRoute tolerates a legacy row without segments", () => {
  const out = toPublicStageRoute({ ...PROFILE, segments: null, climbs: null }, null);
  assert.deepEqual(out.segments, []);
  assert.deepEqual(out.climbs, []);
  assert.equal(out.race_name, "");
});
