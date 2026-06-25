import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStrategy, diffAssignments, bucketSuitabilities } from "./raceStrategy.js";

const roster = new Set(["r0", "r1", "r2", "r3"]);

test("normalizeStrategy: filtrerer stale ids (ikke i roster) tavst", () => {
  const raw = {
    a_chain: ["r0", "ghost", "r2"],
    captain_priorities: { mountain: ["r1", "ghost"], flat: ["r3"] },
    target_race_ids: ["raceA", "raceB"],
  };
  const rules = [{ rider_id: "r1", role_rule: "always_captain" }, { rider_id: "ghost", role_rule: "always_captain" }];
  const s = normalizeStrategy({ row: raw, ruleRows: rules, rosterIds: roster });
  assert.deepEqual(s.aChain, ["r0", "r2"]);
  assert.deepEqual(s.captainPriorities.mountain, ["r1"]);
  assert.deepEqual(s.captainPriorities.flat, ["r3"]);
  assert.deepEqual(s.roleRules, { r1: "always_captain" }); // ghost droppet
  assert.ok(s.targetRaceIds instanceof Set);
  assert.ok(s.targetRaceIds.has("raceA"));
});

test("normalizeStrategy: tom/manglende row → tom strategi (ikke null)", () => {
  const s = normalizeStrategy({ row: null, ruleRows: [], rosterIds: roster });
  assert.deepEqual(s.aChain, []);
  assert.deepEqual(s.captainPriorities, {});
  assert.deepEqual(s.roleRules, {});
  assert.equal(s.targetRaceIds.size, 0);
});

test("normalizeStrategy: dedup beholder første forekomst, bevarer rang", () => {
  const s = normalizeStrategy({ row: { a_chain: ["r0", "r0", "r1"] }, ruleRows: [], rosterIds: roster });
  assert.deepEqual(s.aChain, ["r0", "r1"]);
});

test("normalizeStrategy: ugyldig role_rule droppes", () => {
  const s = normalizeStrategy({ row: null, ruleRows: [{ rider_id: "r0", role_rule: "bogus" }], rosterIds: roster });
  assert.deepEqual(s.roleRules, {});
});

test("diffAssignments: added/removed/captain-skift pr. løb", () => {
  const current = { A: [{ rider_id: "r0", race_role: "captain" }, { rider_id: "r1", race_role: "helper" }] };
  const proposed = { A: [{ rider_id: "r0", race_role: "helper" }, { rider_id: "r2", race_role: "captain" }] };
  const d = diffAssignments({ current, proposed });
  assert.deepEqual(d.A.added, ["r2"]);
  assert.deepEqual(d.A.removed, ["r1"]);
  assert.deepEqual(d.A.captainChange, { from: "r0", to: "r2" });
});

test("diffAssignments: identiske → ingen ændring", () => {
  const same = { A: [{ rider_id: "r0", race_role: "captain" }] };
  const d = diffAssignments({ current: same, proposed: same });
  assert.deepEqual(d.A.added, []);
  assert.deepEqual(d.A.removed, []);
  assert.equal(d.A.captainChange, null);
});

test("bucketSuitabilities: stærk klatrer scorer højere på mountain end svag", () => {
  const profiles = [{ bucket: "mountain", demand_vector: { climbing: 1.0 } }];
  const riders = [
    { rider_id: "strong", abilities: { climbing: 90 } },
    { rider_id: "weak", abilities: { climbing: 20 } },
  ];
  const s = bucketSuitabilities({ stageProfiles: profiles, riders });
  assert.ok(s.strong.mountain > s.weak.mountain);
});

test("bucketSuitabilities: bucket uden profiler → fraværende (UI viser —)", () => {
  const s = bucketSuitabilities({ stageProfiles: [{ bucket: "flat", demand_vector: { sprint: 1 } }], riders: [{ rider_id: "r", abilities: { sprint: 50 } }] });
  assert.ok("flat" in s.r);
  assert.ok(!("itt" in s.r));
});
