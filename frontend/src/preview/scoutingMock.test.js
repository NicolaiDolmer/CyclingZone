// Statefuld Scouting-central-mock (#2244/#2644) — kontrakt-tests mod de felter
// ScoutingCentralPage/useScoutingCentral faktisk læser. NB: modulet har
// module-scope state; testene her kører sekventielt mod samme instans (som i
// browseren), så rækkefølgen er en del af testen.
import test from "node:test";
import assert from "node:assert/strict";
import { scoutingMockRoute } from "./scoutingMock.js";
import { RIDERS, RIVAL_TEAM } from "./seedData.js";

test("scouting/me: scoutSystemEnabled=true + gamle slots-felter bevaret", () => {
  const res = scoutingMockRoute("GET", "/api/scouting/me", null);
  assert.equal(res.status, 200);
  assert.equal(res.body.scoutSystemEnabled, true);
  assert.deepEqual(res.body.slots, { total: 3, used: 0, remaining: 3 });
  assert.equal(res.body.maxLevel, 3);
});

test("scouting/central: fuld side-payload (scout, capacity, jobConfig, seed-shortlist)", () => {
  const res = scoutingMockRoute("GET", "/api/scouting/central", null);
  assert.equal(res.status, 200);
  const { scout, active, completed, capacity, jobConfig } = res.body;
  assert.equal(scout.isDefault, true);
  assert.equal(capacity, 1);
  assert.deepEqual(jobConfig, { targetEtaMinutes: 30, targetCostPerLevel: 1000, missionDays: 2, missionCost: 6000 });
  assert.deepEqual(active, []);
  // Seed-mission med #2644-status-labels: mindst én free_agent + én med holdnavn.
  const mission = completed.find((c) => c.kind === "mission");
  assert.ok(mission?.result?.shortlist?.length >= 3);
  assert.ok(mission.result.top_rider_id);
  const statuses = Object.values(mission.riderStatus);
  assert.ok(statuses.some((s) => s.status === "free_agent"));
  assert.ok(statuses.some((s) => s.status === "team" && s.teamName === RIVAL_TEAM.name));
});

test("riders/names: opløser både seed-ryttere og fiktive free agents", () => {
  const mission = scoutingMockRoute("GET", "/api/scouting/central", null).body.completed[0];
  const res = scoutingMockRoute("POST", "/api/riders/names", { ids: mission.result.shortlist });
  assert.equal(res.status, 200);
  assert.equal(res.body.riders.length, mission.result.shortlist.length);
  assert.ok(res.body.riders.every((r) => typeof r.name === "string" && r.name.length > 0));
  const seedRider = res.body.riders.find((r) => r.id === RIDERS[1].id);
  assert.equal(seedRider.name, `${RIDERS[1].firstname} ${RIDERS[1].lastname}`);
});

test("start mission → aktiv i køen; kapacitet 1 → næste start afvises med error.capacity", () => {
  const start = scoutingMockRoute("POST", "/api/scouting/assignments", { kind: "mission", criteria: { scope: "u23" } });
  assert.equal(start.status, 200);
  assert.equal(start.body.ok, true);
  assert.equal(start.body.assignment.kind, "mission");
  assert.deepEqual(start.body.assignment.mission_criteria, { scope: "u23" });
  assert.ok(start.body.assignment.ready_on);

  const central = scoutingMockRoute("GET", "/api/scouting/central", null);
  assert.equal(central.body.active.length, 1);

  const second = scoutingMockRoute("POST", "/api/scouting/assignments", { kind: "target", riderId: RIDERS[1].id });
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { ok: false, error: "capacity" });
});

test("cancel: fjerner fra køen; ukendt id → 404", () => {
  const active = scoutingMockRoute("GET", "/api/scouting/central", null).body.active;
  assert.equal(active.length, 1);
  const res = scoutingMockRoute("POST", `/api/scouting/assignments/${active[0].id}/cancel`, null);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(scoutingMockRoute("GET", "/api/scouting/central", null).body.active.length, 0);

  const missing = scoutingMockRoute("POST", "/api/scouting/assignments/nope/cancel", null);
  assert.equal(missing.status, 404);
});

test("uhåndterede paths (fx estimates) → null, så generisk /api-blok tager over", () => {
  assert.equal(scoutingMockRoute("POST", "/api/scouting/estimates", { riderIds: [] }), null);
  assert.equal(scoutingMockRoute("GET", "/api/riders/rider-1", null), null);
});
