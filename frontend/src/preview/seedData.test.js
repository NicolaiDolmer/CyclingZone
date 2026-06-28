import test from "node:test";
import assert from "node:assert/strict";
import {
  RIDERS,
  TEST_TEAM,
  RIVAL_TEAM,
  SEED_RACES,
  SEED_STAGE_PROFILES,
  SEED_STAGE_SCHEDULE,
  SEED_RACE_RESULTS,
} from "./seedData.js";

test("hver rider har et id og et navn", () => {
  for (const r of RIDERS) {
    assert.ok(r.id, "rider mangler id");
    assert.ok(r.firstname && r.lastname, `rider ${r.id} mangler navn`);
  }
});

test("TEST_TEAM er et ikke-AI testhold", () => {
  assert.equal(TEST_TEAM.is_ai, false);
  assert.equal(TEST_TEAM.is_test_account, true);
});

test("hvert løb har konsistent stages_completed-invariant", () => {
  for (const r of SEED_RACES) {
    assert.ok(r.stages_completed <= r.stages, `${r.id}: completed > stages`);
    if (r.status === "completed") {
      assert.equal(r.stages_completed, r.stages, `${r.id}: completed-status men ikke alle etaper kørt`);
    }
  }
});

test("mindst ét 'I gang'-løb (0 < completed < stages)", () => {
  assert.ok(
    SEED_RACES.some(r => r.stages_completed > 0 && r.stages_completed < r.stages),
    "intet live-løb i seed",
  );
});

test("hver demand_vector summerer ~1.0", () => {
  for (const p of SEED_STAGE_PROFILES) {
    const sum = Object.values(p.demand_vector).reduce((a, b) => a + b, 0);
    assert.ok(sum > 0.97 && sum < 1.03, `${p.race_id} st${p.stage_number}: demand_vector sum=${sum}`);
  }
});

test("ingen dangling FK i race_results (race/rider/team findes)", () => {
  const raceIds = new Set(SEED_RACES.map(r => r.id));
  const riderIds = new Set(RIDERS.map(r => r.id));
  const teamIds = new Set([TEST_TEAM.id, RIVAL_TEAM.id]);
  for (const res of SEED_RACE_RESULTS) {
    assert.ok(raceIds.has(res.race_id), `result peger på ukendt race ${res.race_id}`);
    assert.ok(teamIds.has(res.team_id), `result peger på ukendt team ${res.team_id}`);
    if (res.result_type === "team") {
      // #1485 Holdklassement-række: holdet ER entiteten, ingen rytter.
      assert.equal(res.rider_id, null, `team-række ${res.id} må ikke have rider_id`);
    } else {
      assert.ok(riderIds.has(res.rider_id), `result peger på ukendt rider ${res.rider_id}`);
    }
  }
});

test("stage-profiler peger kun på kendte løb", () => {
  const raceIds = new Set(SEED_RACES.map(r => r.id));
  for (const p of SEED_STAGE_PROFILES) {
    assert.ok(raceIds.has(p.race_id), `profil peger på ukendt race ${p.race_id}`);
  }
});

test("schedule-rækker peger kun på kendte løb", () => {
  const raceIds = new Set(SEED_RACES.map(r => r.id));
  for (const s of SEED_STAGE_SCHEDULE) {
    assert.ok(raceIds.has(s.race_id), `schedule peger på ukendt race ${s.race_id}`);
  }
});
