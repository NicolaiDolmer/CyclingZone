import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_ORDER_TARGETS, computeStageOrderStats, detectStageOrderViolations,
} from "./stageOrderMetrics.js";

const stageRace = (archetype, ...profileTypes) => ({
  race_type: "stage_race", terrain_archetype: archetype,
  stages: profileTypes.map((profile_type) => ({ profile_type })),
});
const single = (profile_type) => ({ race_type: "single", terrain_archetype: "flat_sprint", stages: [{ profile_type }] });

test("computeStageOrderStats ignorerer endagsløb", () => {
  const stats = computeStageOrderStats([single("flat"), single("cobbles"), stageRace("hilly_tour", "flat", "hilly")]);
  assert.equal(stats.stageRaces, 1);
});

test("computeStageOrderStats: åbning og finale klassificeres pr. familie", () => {
  const stats = computeStageOrderStats([
    stageRace("a", "mountain", "flat", "hilly"),   // åbner bjerg, slutter kuperet
    stageRace("b", "flat", "hilly", "high_mountain"), // åbner flad, slutter bjerg
    stageRace("c", "itt", "hilly", "rolling"),     // åbner ITT, slutter rullende (flad-familie)
    stageRace("d", "rolling", "mountain", "itt"),  // åbner rullende, slutter ITT
  ]);
  assert.equal(stats.stageRaces, 4);
  assert.equal(stats.mountainOpenPct, 25);
  assert.equal(stats.flatOpenPct, 50, "flat + rolling er samme åbnings-familie");
  assert.equal(stats.ittOpenPct, 25);
  assert.equal(stats.mountainFinishPct, 25);
  assert.equal(stats.flatFinishPct, 25);
  assert.equal(stats.ittFinishPct, 25);
});

test("computeStageOrderStats: 'første halvdel' er ceil(n/2), så etape 2 af 3 tæller med", () => {
  // Spillerens formulering: "we did the mountain day 2, now there's 3 days to get it back".
  const early = computeStageOrderStats([stageRace("a", "flat", "mountain", "hilly")]);
  assert.equal(early.mountainFirstHalfPct, 100, "etape 2 af 3 er i første halvdel");
  const late = computeStageOrderStats([stageRace("a", "flat", "hilly", "mountain")]);
  assert.equal(late.mountainFirstHalfPct, 0, "etape 3 af 3 er ikke første halvdel");
});

test("computeStageOrderStats tæller delte sekvenser og finder den mest delte", () => {
  const stats = computeStageOrderStats([
    stageRace("a", "flat", "mountain"),
    stageRace("b", "flat", "mountain"),
    stageRace("c", "flat", "mountain"),
    stageRace("d", "hilly", "itt"),
  ]);
  assert.equal(stats.distinctSequences, 2);
  assert.equal(stats.maxSharedSequence, 3);
  assert.equal(stats.topSequences[0].sequence, "flat>mountain");
  assert.equal(stats.topSequences[0].count, 3);
  assert.equal(stats.topSequenceSharePct, 75);
});

test("computeStageOrderStats tæller arketyper, også manglende", () => {
  const stats = computeStageOrderStats([
    stageRace("mountain_tour", "flat", "mountain"),
    stageRace("mountain_tour", "flat", "high_mountain"),
    stageRace(null, "flat", "hilly"),
  ]);
  assert.equal(stats.archetypeCounts.mountain_tour, 2);
  assert.equal(stats.archetypeCounts["(ingen arketype)"], 1);
  assert.equal(stats.distinctArchetypes, 2);
});

test("detectStageOrderViolations: den hårde crescendo (før #3326) fejler alle tre kriterier", () => {
  // 10 identiske løb: flad åbning, bjergfinale, ingen tidlige bjerge, samme sekvens.
  const races = Array.from({ length: 10 }, () => stageRace("mountain_tour", "flat", "hilly", "mountain", "high_mountain"));
  const stats = computeStageOrderStats(races);
  const violations = detectStageOrderViolations({ stats, label: "S2" });
  assert.equal(stats.mountainFinishPct, 100);
  assert.equal(stats.mountainFirstHalfPct, 0);
  assert.equal(stats.maxSharedSequence, 10);
  assert.equal(violations.length, 3, `forventede 3 brud, fik: ${violations.join(" | ")}`);
  assert.ok(violations.some((v) => v.includes("slutter på bjerg")));
  assert.ok(violations.some((v) => v.includes("bjerg i første halvdel")));
  assert.ok(violations.some((v) => v.includes("deles af 10 løb")));
});

test("detectStageOrderViolations: varieret sæson består", () => {
  const races = [
    stageRace("a", "flat", "mountain", "hilly", "rolling"),
    stageRace("b", "hilly", "flat", "mountain", "itt"),
    stageRace("c", "itt", "mountain", "flat", "hilly"),
    stageRace("d", "rolling", "hilly", "high_mountain", "flat"),
    stageRace("e", "mountain", "flat", "hilly", "itt"),
  ];
  const stats = computeStageOrderStats(races);
  assert.deepEqual(detectStageOrderViolations({ stats }), []);
  assert.ok(stats.mountainFirstHalfPct >= STAGE_ORDER_TARGETS.mountain_first_half_min_pct);
});

test("detectStageOrderViolations: 0 etapeløb er 'kan ikke vurderes', ikke grønt", () => {
  const stats = computeStageOrderStats([single("flat")]);
  const violations = detectStageOrderViolations({ stats, label: "tier 4" });
  assert.equal(violations.length, 1);
  assert.ok(violations[0].includes("kan ikke vurderes"));
});

test("detectStageOrderViolations: stats=null kaster ikke", () => {
  assert.deepEqual(detectStageOrderViolations({ stats: null }), []);
});
