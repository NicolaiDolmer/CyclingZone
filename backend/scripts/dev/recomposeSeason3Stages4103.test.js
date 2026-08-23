// #4103: unit-tests for de rene planlægnings-/genereringsfunktioner i
// recomposeSeason3Stages4103.mjs. Ingen DB — bygger syntetiske grupper.

import test from "node:test";
import assert from "node:assert/strict";
import {
  nearestMultiple, bestAddCandidateStage, bestRemoveCandidateStage,
  planTierCategory, buildRecomposedStage,
} from "./recomposeSeason3Stages4103.mjs";

function makeGroup({ stages, terrainArchetype = null, types, tier = 1, groupSize = 1, name = "Test Race", externalId = "ext-1" }) {
  const stagesMap = new Map(types.map((t, i) => [i + 1, t]));
  return {
    poolRaceId: "pool-1", tier, name, raceType: "stage_race", stages, raceClass: null,
    externalId, terrainArchetype, raceIds: Array.from({ length: groupSize }, (_, i) => `race-${i}`),
    groupSize, stagesMap,
  };
}

test("nearestMultiple: runder til nærmeste multiplum, ties op", () => {
  assert.equal(nearestMultiple(22.4, 2), 22);
  assert.equal(nearestMultiple(11.2, 4), 12);
  assert.equal(nearestMultiple(53.76, 8), 56);
  assert.equal(nearestMultiple(5, 1), 5);
  assert.equal(nearestMultiple(5, 0), 5, "step<=0 falder tilbage til almindelig runding");
});

test("bestAddCandidateStage(itt): vælger prolog (etape 1) når den er flad/rolling og ledig", () => {
  const g = makeGroup({ stages: 5, types: ["flat", "hilly", "mountain", "hilly", "flat"] });
  const cand = bestAddCandidateStage("itt", g);
  assert.deepEqual(cand, { stageNumber: 1, fromType: "flat", toType: "itt" });
});

test("bestAddCandidateStage(itt): itt_hilly i mountain_tour/summit_tour", () => {
  const g = makeGroup({ stages: 5, terrainArchetype: "summit_tour", types: ["mountain", "flat", "mountain", "high_mountain", "high_mountain"] });
  const cand = bestAddCandidateStage("itt", g);
  assert.equal(cand.toType, "itt_hilly");
});

test("bestAddCandidateStage(itt): respekterer cap (1 for kort løb) og undgår nabo-ITT", () => {
  const g = makeGroup({ stages: 5, types: ["itt", "flat", "mountain", "flat", "flat"] });
  // Cap er allerede nået (1 itt), kortere løb (stages<15) → cap 1.
  assert.equal(bestAddCandidateStage("itt", g), null);
});

test("bestAddCandidateStage(itt): springer flad/rolling over hvis nabo allerede er ITT", () => {
  const g = makeGroup({ stages: 20, types: ["itt", "flat", "mountain", "mountain", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "flat"] });
  // GT (stages>=15) cap=2, kun 1 itt lige nu → kan tilføje én mere, men IKKE etape 2 (nabo til etape 1's itt).
  const cand = bestAddCandidateStage("itt", g);
  assert.notEqual(cand.stageNumber, 2);
});

test("bestAddCandidateStage(cobbles): kun flad, maks 1, aldrig summit_tour", () => {
  const g1 = makeGroup({ stages: 4, terrainArchetype: "summit_tour", types: ["flat", "mountain", "high_mountain", "high_mountain"] });
  assert.equal(bestAddCandidateStage("cobbles", g1), null);

  const g2 = makeGroup({ stages: 4, terrainArchetype: "mountain_tour", types: ["flat", "flat", "mountain", "mountain"] });
  const cand = bestAddCandidateStage("cobbles", g2);
  assert.deepEqual(cand, { stageNumber: 1, fromType: "flat", toType: "cobbles" });

  g2.stagesMap.set(1, "cobbles"); // allerede 1 cobbles
  assert.equal(bestAddCandidateStage("cobbles", g2), null, "maks 1 cobbles pr. løb");
});

test("bestAddCandidateStage(high_mountain): kun i mountain_tour/grand_tour/summit_tour, aldrig ny nabo, finale foretrukket", () => {
  const notEligible = makeGroup({ stages: 4, terrainArchetype: "hilly_tour", types: ["flat", "hilly", "mountain", "hilly"] });
  assert.equal(bestAddCandidateStage("high_mountain", notEligible), null);

  const g = makeGroup({ stages: 6, terrainArchetype: "mountain_tour", types: ["flat", "mountain", "hilly", "mountain", "hilly", "mountain"] });
  const cand = bestAddCandidateStage("high_mountain", g);
  assert.equal(cand.stageNumber, 6, "finalen (sidste mountain-etape) foretrækkes");

  // Etape 2 og 4 er BEGGE nabo til etape 3's high_mountain (ville skabe ny nabo-blok) —
  // kun etape 6 (uden nabo-high_mountain) er berettiget.
  const adjacency = makeGroup({ stages: 7, terrainArchetype: "mountain_tour", types: ["flat", "mountain", "high_mountain", "mountain", "hilly", "mountain", "hilly"] });
  const cand2 = bestAddCandidateStage("high_mountain", adjacency);
  assert.equal(cand2.stageNumber, 6);
});

test("bestRemoveCandidateStage(itt): behold mindst 1 i GT (stages>=15) og itt-bundne arketyper", () => {
  const gt = makeGroup({ stages: 18, terrainArchetype: "grand_tour", types: Array(18).fill("flat") });
  gt.stagesMap.set(1, "itt");
  assert.equal(bestRemoveCandidateStage("itt", gt), null, "kun 1 itt i en GT — må ikke fjernes");

  const balanced = makeGroup({ stages: 7, terrainArchetype: "balanced_week", types: ["itt", "flat", "hilly", "mountain", "flat", "hilly", "flat"] });
  assert.equal(bestRemoveCandidateStage("itt", balanced), null, "itt-bundet arketype — kun 1 itt, må ikke fjernes");
});

test("bestRemoveCandidateStage(itt): fjerner fra ENDEN først, behold åbnings-ITT", () => {
  const g = makeGroup({ stages: 7, terrainArchetype: "hilly_tour", types: ["itt", "flat", "hilly", "itt", "flat", "hilly", "flat"] });
  const cand = bestRemoveCandidateStage("itt", g);
  assert.equal(cand.stageNumber, 4, "senere itt fjernes før åbnings-itt (etape 1)");
});

test("bestRemoveCandidateStage(cobbles): aldrig cobbled_tour (identitet)", () => {
  const g = makeGroup({ stages: 5, terrainArchetype: "cobbled_tour", types: ["flat", "cobbles", "mountain", "flat", "flat"] });
  assert.equal(bestRemoveCandidateStage("cobbles", g), null);
});

test("bestRemoveCandidateStage(high_mountain): behold mindst 1 i summit_tour/grand_tour", () => {
  const g = makeGroup({ stages: 4, terrainArchetype: "summit_tour", types: ["flat", "mountain", "high_mountain", "high_mountain"] });
  const cand = bestRemoveCandidateStage("high_mountain", g);
  assert.ok(cand, "2 high_mountain, floor 1 → kan fjerne 1");
  g.stagesMap.set(cand.stageNumber, "mountain");
  assert.equal(bestRemoveCandidateStage("high_mountain", g), null, "kun 1 tilbage — floor rammer");
});

test("planTierCategory: fordeler konverteringer over FLERE grupper deterministisk før den dobler op i én", () => {
  const groups = [
    makeGroup({ stages: 5, types: ["flat", "hilly", "mountain", "hilly", "flat"], externalId: "a" }),
    makeGroup({ stages: 5, types: ["flat", "hilly", "mountain", "hilly", "flat"], externalId: "b" }),
    makeGroup({ stages: 5, types: ["flat", "hilly", "mountain", "hilly", "flat"], externalId: "c" }),
  ];
  const { picks, gapGroups } = planTierCategory({ category: "itt", direction: "add", groups, needGroupConversions: 2 });
  assert.equal(picks.length, 2);
  assert.equal(gapGroups, 0);
  const distinctGroups = new Set(picks.map((p) => p.group.externalId));
  assert.equal(distinctGroups.size, 2, "2 forskellige grupper konverteret, ikke samme gruppe to gange");
});

test("planTierCategory: er deterministisk (samme input → samme valg) på tværs af to kørsler", () => {
  const build = () => [
    makeGroup({ stages: 5, types: ["flat", "hilly", "mountain", "hilly", "flat"], externalId: "a" }),
    makeGroup({ stages: 5, types: ["flat", "hilly", "mountain", "hilly", "flat"], externalId: "b" }),
  ];
  const run1 = planTierCategory({ category: "itt", direction: "add", groups: build(), needGroupConversions: 1 });
  const run2 = planTierCategory({ category: "itt", direction: "add", groups: build(), needGroupConversions: 1 });
  assert.equal(run1.picks[0].group.externalId, run2.picks[0].group.externalId);
  assert.equal(run1.picks[0].stageNumber, run2.picks[0].stageNumber);
});

test("planTierCategory: rapporterer gab uden at tvinge når kandidater er udtømte", () => {
  const groups = [makeGroup({ stages: 4, terrainArchetype: "summit_tour", types: ["flat", "mountain", "high_mountain", "high_mountain"] })];
  // Kun 1 flad-kandidat findes for cobbles, men summit_tour er ekskluderet fra cobbles-tilføj → 0 kandidater.
  const { picks, gapGroups } = planTierCategory({ category: "cobbles", direction: "add", groups, needGroupConversions: 3 });
  assert.equal(picks.length, 0);
  assert.equal(gapGroups, 3);
});

test("buildRecomposedStage: deterministisk (samme input → byte-identisk output)", () => {
  const seedRace = { id: "r1", external_id: "ext-xyz", pool_race_id: "pool-1", season_id: "00000000-0000-0000-0000-000000000003", name: "Testronde", race_class: null, season_variant: 0 };
  const a = buildRecomposedStage(seedRace, 3, "cobbles");
  const b = buildRecomposedStage(seedRace, 3, "cobbles");
  assert.deepEqual(a, b);
  assert.equal(a.profile_type, "cobbles");
  assert.ok(a.distance_km >= 150 && a.distance_km <= 170, "cobbles distance-bånd");
  assert.ok(Array.isArray(a.segments) && a.segments.length > 0);
  assert.ok(a.weather && typeof a.weather === "object");
});

test("buildRecomposedStage: forskellig profile_type giver forskelligt (men stadig deterministisk) output for samme etape", () => {
  const seedRace = { id: "r1", external_id: "ext-xyz", pool_race_id: "pool-1", season_id: "00000000-0000-0000-0000-000000000003", name: "Testronde", season_variant: 0 };
  const cobbles = buildRecomposedStage(seedRace, 3, "cobbles");
  const itt = buildRecomposedStage(seedRace, 3, "itt");
  assert.notEqual(cobbles.distance_km >= 15 && cobbles.distance_km <= 40, true, "cobbles er ikke i ITT-båndet");
  assert.ok(itt.distance_km >= 15 && itt.distance_km <= 40, "itt distance-bånd (eller prolog-bånd 5-8)");
});
