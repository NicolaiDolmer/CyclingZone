import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GREEN_FINISH_SCALES, INTERMEDIATE_SPRINT_SCALE, KOM_SCALES,
  FINISH_BONUS_SECONDS, INTERMEDIATE_BONUS_SECONDS, computePassages,
} from "./racePassages.js";

test("Tour-skalaer er ejer-låste værdier", () => {
  assert.deepEqual(GREEN_FINISH_SCALES.flat, [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(GREEN_FINISH_SCALES.rolling, [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(GREEN_FINISH_SCALES.mountain, [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(INTERMEDIATE_SPRINT_SCALE, [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(KOM_SCALES.HC, [20, 15, 12, 10, 8, 6, 4, 2]);
  assert.deepEqual(KOM_SCALES["1"], [10, 8, 6, 4, 2, 1]);
  assert.deepEqual(KOM_SCALES["4"], [1]);
  assert.deepEqual(FINISH_BONUS_SECONDS, [10, 6, 4]);
  assert.deepEqual(INTERMEDIATE_BONUS_SECONDS, [3, 2, 1]);
});

test("ingen rutedata → tomt resultat (data-gating)", () => {
  const out = computePassages({
    ranked: [{ rider_id: "a", rank: 1, components: { breakaway: 0 } }],
    stageProfile: { profile_type: "flat", stage_number: 1 }, // ingen climbs/sprints/distance_km
    entrants: [{ rider_id: "a", abilities: {} }],
    seed: 42, isStageRace: true,
  });
  assert.deepEqual(out.passages, []);
  assert.equal(out.perRider.size, 0);
});

test("endagsløb → tomt resultat", () => {
  const out = computePassages({
    ranked: [{ rider_id: "a", rank: 1, components: { breakaway: 0 } }],
    stageProfile: { profile_type: "classic", distance_km: 240, climbs: [], sprints: [{ name: "Finish", km: 240, kind: "finish" }], sectors: [] },
    entrants: [{ rider_id: "a", abilities: {} }],
    seed: 42, isStageRace: false,
  });
  assert.deepEqual(out.passages, []);
});

// Hjælper til testene: 6 ryttere, 2 escapees (b holder hjem, e indhentes).
// components.breakaway > 0 = escapee; e slutter bag ikke-escapees = caught.
function fixture() {
  const ranked = [
    { rider_id: "b", rank: 1, components: { breakaway: 0.2 } },  // escapee, vandt → holdt hjem
    { rider_id: "a", rank: 2, components: { breakaway: 0 } },
    { rider_id: "c", rank: 3, components: { breakaway: 0 } },
    { rider_id: "d", rank: 4, components: { breakaway: 0 } },
    { rider_id: "e", rank: 5, components: { breakaway: 0.1 } },  // escapee, indhentet
    { rider_id: "f", rank: 6, components: { breakaway: 0 } },
  ];
  const entrants = ["a", "b", "c", "d", "e", "f"].map((id) => ({
    rider_id: id, team_id: `t${id}`,
    abilities: { climbing: 60, sprint: 60, punch: 50, acceleration: 50, positioning: 50, endurance: 50 },
  }));
  const stageProfile = {
    stage_number: 3, profile_type: "mountain", finale_type: "descent", distance_km: 170,
    climbs: [
      { name: "Col A", category: "2", crest_km: 60, length_km: 8, avg_gradient: 6, summit_finish: false },
      { name: "Col B", category: "1", crest_km: 150, length_km: 12, avg_gradient: 7.5, summit_finish: false },
    ],
    sprints: [
      { name: "Intermediate Sprint", km: 85, kind: "intermediate" },
      { name: "Finish", km: 170, kind: "finish" },
    ],
    sectors: [],
  };
  return { ranked, entrants, stageProfile };
}

test("escapees passerer først ved tidligt waypoint (km 60 < catch)", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  const komA = out.passages.find((p) => p.kind === "kom" && p.index === 0);
  const first2 = komA.results.slice(0, 2).map((r) => r.rider_id).sort();
  assert.deepEqual(first2, ["b", "e"]); // begge escapees foran feltet ved km 60
  assert.equal(komA.results[0].points, 5); // cat 2-skala: 5/3/2/1
});

test("overlevende escapee fører ved ALLE waypoints; indhentet kun før catch_km", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  for (const p of out.passages.filter((x) => x.kind !== "finish")) {
    assert.equal(p.results[0] && ["b", "e"].includes(p.results[0].rider_id), true);
    // b (survived) er ALTID i front-gruppen:
    const bRank = p.results.find((r) => r.rider_id === "b")?.passage_rank;
    assert.ok(bRank <= 2);
  }
});

test("determinisme: samme input+seed → deep-equal; andet seed → (typisk) andet resultat", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const a = computePassages({ ranked, entrants, stageProfile, seed: 999, isStageRace: true });
  const b = computePassages({ ranked, entrants, stageProfile, seed: 999, isStageRace: true });
  assert.deepEqual(a.passages, b.passages);
});

test("mål-waypoint bruger motorens rangorden — genberegnes ALDRIG", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  const finish = out.passages.find((p) => p.kind === "finish");
  assert.deepEqual(finish.results.map((r) => r.rider_id).slice(0, 3), ["b", "a", "c"]);
  assert.equal(finish.results[0].points, 20); // mountain-målskala
  assert.equal(finish.results[0].bonus_seconds, 10);
  assert.equal(finish.results[1].bonus_seconds, 6);
});

test("mellemsprint giver 20/17/15-point + 3/2/1 bonus", () => {
  const { ranked, entrants, stageProfile } = fixture();
  const out = computePassages({ ranked, entrants, stageProfile, seed: 1234, isStageRace: true });
  const s = out.passages.find((p) => p.kind === "sprint");
  assert.equal(s.results[0].points, 20);
  assert.equal(s.results[0].bonus_seconds, 3);
  assert.equal(s.results[3]?.bonus_seconds ?? 0, 0);
});

// Ekstra kant-tests (Task 3, Step 5).
test("summit-finish fordobler HC-point (40 til 1.-passage)", () => {
  const ranked = [
    { rider_id: "a", rank: 1, components: { breakaway: 0 } },
    { rider_id: "b", rank: 2, components: { breakaway: 0 } },
    { rider_id: "c", rank: 3, components: { breakaway: 0 } },
    { rider_id: "d", rank: 4, components: { breakaway: 0 } },
  ];
  const entrants = ["a", "b", "c", "d"].map((id) => ({
    rider_id: id, team_id: `t${id}`,
    abilities: { climbing: 70, sprint: 40, punch: 50, acceleration: 50, positioning: 50, endurance: 60 },
  }));
  const stageProfile = {
    stage_number: 8, profile_type: "high_mountain", distance_km: 180,
    climbs: [
      { name: "Summit HC", category: "HC", crest_km: 180, length_km: 15, avg_gradient: 8, summit_finish: true },
    ],
    sprints: [{ name: "Finish", km: 180, kind: "finish" }],
    sectors: [],
  };
  const out = computePassages({ ranked, entrants, stageProfile, seed: 55, isStageRace: true });
  const kom = out.passages.find((p) => p.kind === "kom");
  assert.equal(kom.results[0].points, 40); // HC-skala fordoblet: 20*2
  assert.deepEqual(kom.results.map((r) => r.rider_id).slice(0, 3), ["a", "b", "c"]); // motorens rangorden
});

test("rytter uden abilities-data crasher ikke", () => {
  const ranked = [
    { rider_id: "a", rank: 1, components: { breakaway: 0 } },
    { rider_id: "b", rank: 2, components: { breakaway: 0 } },
    { rider_id: "c", rank: 3, components: { breakaway: 0 } },
    { rider_id: "d", rank: 4, components: { breakaway: 0 } },
  ];
  // "b" har ingen abilities overhovedet, "c" mangler helt fra entrants.
  const entrants = [
    { rider_id: "a", abilities: { climbing: 60, sprint: 60, punch: 50, acceleration: 50, positioning: 50, endurance: 50 } },
    { rider_id: "b" },
    { rider_id: "d", abilities: { climbing: 55, sprint: 55, punch: 45, acceleration: 45, positioning: 45, endurance: 45 } },
  ];
  const stageProfile = {
    stage_number: 4, profile_type: "hilly", distance_km: 150,
    climbs: [{ name: "Petit Col", category: "3", crest_km: 40, length_km: 4, avg_gradient: 5, summit_finish: false }],
    sprints: [{ name: "Finish", km: 150, kind: "finish" }],
    sectors: [],
  };
  assert.doesNotThrow(() => {
    const out = computePassages({ ranked, entrants, stageProfile, seed: 7, isStageRace: true });
    assert.ok(out.passages.length > 0);
  });
});

test("3-rytter felt (mindre end skala) uddeler kun 3", () => {
  const ranked = [
    { rider_id: "a", rank: 1, components: { breakaway: 0 } },
    { rider_id: "b", rank: 2, components: { breakaway: 0 } },
    { rider_id: "c", rank: 3, components: { breakaway: 0 } },
  ];
  const entrants = ["a", "b", "c"].map((id) => ({
    rider_id: id, team_id: `t${id}`,
    abilities: { climbing: 60, sprint: 60, punch: 50, acceleration: 50, positioning: 50, endurance: 50 },
  }));
  const stageProfile = {
    stage_number: 5, profile_type: "flat", distance_km: 190,
    climbs: [],
    sprints: [{ name: "Finish", km: 190, kind: "finish" }],
    sectors: [],
  };
  const out = computePassages({ ranked, entrants, stageProfile, seed: 3, isStageRace: true });
  const finish = out.passages.find((p) => p.kind === "finish");
  assert.equal(finish.results.length, 3);
});
