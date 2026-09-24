// backend/scripts/lib/headToHeadObservers.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { RACE_V4_TUNING } from "../../lib/engine/v4/tuning.ts";
import { terrainScore } from "../../lib/raceSimulator.js";
import { observeRace } from "../../lib/raceDominanceMetrics.js";
import {
  observeStageV4,
  pickV3TerrainFavorite,
  FAVORITE_DEFINITIONS,
  cohesionFraction,
  winnerGroupSize,
  spreadAtRank,
  descentAttackGainStats,
} from "./headToHeadObservers.js";

function ability(overrides = {}) {
  const base = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

test("observeStageV4: hoej-punch rytter vinder punch-etape -> favoriteWon true", () => {
  const results = [
    { rider_id: "strong_puncher", rank: 1, time_seconds: 100, group_id: "g1", status: "finished" },
    { rider_id: "weak_puncher", rank: 2, time_seconds: 110, group_id: "g2", status: "finished" },
  ];
  const entrants = {
    strong_puncher: { abilities: ability({ punch: 90, acceleration: 85, climbing: 70, tactics: 60 }) },
    weak_puncher: { abilities: ability({ punch: 20, acceleration: 20, climbing: 20, tactics: 20 }) },
  };
  const teamByRider = new Map([["strong_puncher", "teamA"], ["weak_puncher", "teamB"]]);
  const obs = observeStageV4({
    results, entrants, teamByRider,
    route: { finale_type: "punch" }, tuning: RACE_V4_TUNING,
    raceId: "race1", terrain: "hilly",
  });
  assert.equal(obs.favoriteId, "strong_puncher");
  assert.equal(obs.favoriteWon, true);
  assert.equal(obs.winnerId, "strong_puncher");
  assert.equal(obs.fieldSize, 2);
});

test("observeStageV4: manglende entrant-abilities udelades stille (ingen kast)", () => {
  const results = [{ rider_id: "ghost", rank: 1, time_seconds: 100, group_id: "g1", status: "finished" }];
  const obs = observeStageV4({
    results, entrants: {}, teamByRider: new Map(),
    route: { finale_type: "punch" }, tuning: RACE_V4_TUNING, raceId: "r", terrain: "hilly",
  });
  assert.equal(obs.favoriteId, null);
  assert.equal(obs.winnerId, "ghost");
});

test("observeStageV4: tom results-liste giver den tomme-kontrakt (samme shape som raceDominanceMetrics)", () => {
  const obs = observeStageV4({ results: [], entrants: {}, teamByRider: new Map(), route: {}, tuning: RACE_V4_TUNING });
  assert.equal(obs.fieldSize, 0);
  assert.equal(obs.favoriteWon, false);
  assert.equal(obs.maxSameTeamTop10, 0);
});

test("observeStageV4: null team_id tæller som eget unikt hold (ikke klumpet)", () => {
  const results = Array.from({ length: 4 }, (_, i) => ({
    rider_id: `r${i}`, rank: i + 1, time_seconds: 100 + i, group_id: "g", status: "finished",
  }));
  const entrants = Object.fromEntries(results.map((r) => [r.rider_id, { abilities: ability() }]));
  const teamByRider = new Map(); // ingen hold -> alle null
  const obs = observeStageV4({
    results, entrants, teamByRider, route: { finale_type: "bunch_sprint" }, tuning: RACE_V4_TUNING,
  });
  assert.equal(obs.maxSameTeamTop10, 1);
  assert.equal(obs.distinctTeamsTop10, 4);
});

// ── #5583: den ikke-cirkulaere favorit (v3-terrainScore) ──────────────────
//
// Syntetisk felt: "rouleur" er bedst paa etapens v3-kravvektor (her kun
// `flat`, en bevidst kunstig vektor), "sprinter" er bedst paa v4-finalens
// bunch_sprint-vektor. De to definitioner SKAL derfor pege paa hver sin rytter.

const STAGE_DEMAND = { flat: 1, randomness: 1 };

const DEFINITION_FIELD = {
  rouleur: { abilities: ability({ flat: 95, sprint: 40, acceleration: 40, positioning: 40 }) },
  sprinter: { abilities: ability({ flat: 40, sprint: 95, acceleration: 95, positioning: 95 }) },
  helper: { abilities: ability({ flat: 60, sprint: 60 }) },
  domestique: { abilities: ability({ flat: 30, sprint: 30 }) },
};

function resultsInOrder(ids) {
  return ids.map((id, i) => ({ rider_id: id, rank: i + 1, time_seconds: 100 + i, group_id: "g1", status: "finished" }));
}

function observeWith(favoriteBy, ids, extra = {}) {
  return observeStageV4({
    results: resultsInOrder(ids),
    entrants: DEFINITION_FIELD,
    teamByRider: new Map(),
    route: { finale_type: "bunch_sprint" },
    tuning: RACE_V4_TUNING,
    terrain: "flat",
    favoriteBy,
    stageDemandVector: STAGE_DEMAND,
    ...extra,
  });
}

test("#5583 FAVORITE_DEFINITIONS: gatens definition er default og foerst", () => {
  assert.deepEqual([...FAVORITE_DEFINITIONS], ["finale_score", "v3_terrain"]);
});

test("#5583 v3_terrain: favoritten er feltets hoejeste v3-terrainScore, ikke finalens evne-score", () => {
  const ids = ["sprinter", "rouleur", "helper", "domestique"];
  const finale = observeWith("finale_score", ids);
  const terrain = observeWith("v3_terrain", ids);
  assert.equal(finale.favoriteId, "sprinter", "finalens bunch_sprint-vektor peger paa sprinteren");
  assert.equal(terrain.favoriteId, "rouleur", "v3-kravvektoren peger paa rouleuren");
  const expected = Object.entries(DEFINITION_FIELD)
    .map(([id, e]) => ({ id, score: terrainScore(e.abilities, STAGE_DEMAND) }))
    .sort((a, b) => b.score - a.score)[0].id;
  assert.equal(terrain.favoriteId, expected);
});

test("#5583 v3_terrain: uafhaengig af finalens sortering (samme favorit i enhver maalraekkefoelge)", () => {
  const orders = [
    ["sprinter", "rouleur", "helper", "domestique"],
    ["rouleur", "sprinter", "helper", "domestique"],
    ["domestique", "helper", "sprinter", "rouleur"],
    ["helper", "domestique", "rouleur", "sprinter"],
  ];
  for (const ids of orders) {
    const obs = observeWith("v3_terrain", ids);
    assert.equal(obs.favoriteId, "rouleur", `raekkefoelge ${ids.join(",")}`);
    assert.equal(obs.favoriteRank, ids.indexOf("rouleur") + 1, "favoriteRank er rytterens egen placering");
    assert.equal(obs.favoriteWon, ids[0] === "rouleur");
  }
  // Ogsaa naar results-arrayet selv ligger uden for rang-orden.
  const shuffled = resultsInOrder(["sprinter", "helper", "rouleur", "domestique"]).reverse();
  assert.equal(pickV3TerrainFavorite(shuffled, DEFINITION_FIELD, STAGE_DEMAND).rider_id, "rouleur");
});

test("#5583 v3_terrain: uafhaengig af W'-reserve og af finalens kravvektor/tuning", () => {
  const ids = ["sprinter", "rouleur", "helper", "domestique"];
  const baseline = observeWith("v3_terrain", ids);
  // (a) Uden tuning overhovedet — der er intet W'-vaegt- eller finale-opslag at laene.
  const noTuning = observeWith("v3_terrain", ids, { tuning: null, route: {} });
  // (b) En finale-vektor der entydigt peger paa en ANDEN rytter (W'-reserve-leddet
  //     i finale-scoren laeses via samme tuning-sti).
  const skewed = {
    ...RACE_V4_TUNING,
    finale: { ...RACE_V4_TUNING.finale, demandVectorByFinaleType: { bunch_sprint: { sprint: 1 } } },
  };
  const skewedTuning = observeWith("v3_terrain", ids, { tuning: skewed });
  // (c) Resultat-raekker der baerer en (fiktiv) W'-reserve der favoriserer en anden.
  const withReserve = observeStageV4({
    results: resultsInOrder(ids).map((r) => ({ ...r, wprime_reserve_fraction: r.rider_id === "domestique" ? 1 : 0 })),
    entrants: DEFINITION_FIELD,
    teamByRider: new Map(),
    route: { finale_type: "bunch_sprint" },
    tuning: RACE_V4_TUNING,
    favoriteBy: "v3_terrain",
    stageDemandVector: STAGE_DEMAND,
  });
  for (const obs of [noTuning, skewedTuning, withReserve]) {
    assert.equal(obs.favoriteId, baseline.favoriteId);
    assert.equal(obs.favoriteRank, baseline.favoriteRank);
  }
});

test("#5583 v3_terrain: peger paa SAMME rytter som v3's observeRace paa samme felt og vektor", () => {
  const ids = ["sprinter", "helper", "rouleur", "domestique"];
  // v3's ranked baerer components.terrain = terrainScore(abilities, demand_vector)
  // (raceSimulator.simulateStage) — v3-raekkefoelgen her er bevidst en anden end v4's.
  const v3Ranked = ["domestique", "sprinter", "helper", "rouleur"].map((id, i) => ({
    rider_id: id, rank: i + 1, components: { terrain: terrainScore(DEFINITION_FIELD[id].abilities, STAGE_DEMAND) },
  }));
  const v3 = observeRace({ ranked: v3Ranked, teamByRider: new Map() });
  const v4 = observeWith("v3_terrain", ids);
  assert.equal(v4.favoriteId, v3.favoriteId);
});

test("#5583 v3_terrain: lige score -> laveste rider_id (samme tiebreak som observeRace)", () => {
  const twins = {
    b_twin: { abilities: ability({ flat: 80 }) },
    a_twin: { abilities: ability({ flat: 80 }) },
  };
  const results = resultsInOrder(["b_twin", "a_twin"]);
  assert.equal(pickV3TerrainFavorite(results, twins, STAGE_DEMAND).rider_id, "a_twin");
});

test("#5583 v3_terrain: en udgaaet favorit er stadig favoritten (og har ikke vundet)", () => {
  const results = [
    ...resultsInOrder(["sprinter", "helper", "domestique"]),
    { rider_id: "rouleur", rank: 4, time_seconds: 90, group_id: "g2", status: "abandoned" },
  ];
  const obs = observeStageV4({
    results, entrants: DEFINITION_FIELD, teamByRider: new Map(),
    route: { finale_type: "bunch_sprint" }, tuning: RACE_V4_TUNING,
    favoriteBy: "v3_terrain", stageDemandVector: STAGE_DEMAND,
  });
  assert.equal(obs.favoriteId, "rouleur");
  assert.equal(obs.favoriteWon, false);
});

test("#5583 v3_terrain uden v3-kravvektor kaster (aldrig en gaettet favorit)", () => {
  assert.throws(
    () => observeWith("v3_terrain", ["rouleur", "sprinter"], { stageDemandVector: undefined }),
    /stageDemandVector/,
  );
});

test("#5583 ukendt favoriteBy kaster", () => {
  assert.throws(() => observeWith("strongest", ["rouleur"]), /ukendt favoriteBy/);
});

test("#5583 default er uaendret: udeladt favoriteBy == finale_score (gatens definition)", () => {
  const ids = ["sprinter", "rouleur", "helper", "domestique"];
  const explicit = observeWith("finale_score", ids);
  const implicit = observeStageV4({
    results: resultsInOrder(ids), entrants: DEFINITION_FIELD, teamByRider: new Map(),
    route: { finale_type: "bunch_sprint" }, tuning: RACE_V4_TUNING, terrain: "flat",
  });
  assert.deepEqual(implicit, explicit);
});

test("cohesionFraction: alle paa vindertiden -> 1.0", () => {
  assert.equal(cohesionFraction([0, 0, 0, 0]), 1);
});

test("cohesionFraction: kun vinderen -> 1/N", () => {
  assert.equal(cohesionFraction([0, 5, 8, 12]), 0.25);
});

test("cohesionFraction: tom liste -> null", () => {
  assert.equal(cohesionFraction([]), null);
});

test("winnerGroupSize: solo-sejr (kun 1 paa mindste tid) -> 1", () => {
  assert.equal(winnerGroupSize([100, 105, 110]), 1);
});

test("winnerGroupSize: gruppesejr (flere paa mindste tid) -> N", () => {
  assert.equal(winnerGroupSize([100, 100, 100, 105]), 3);
});

test("spreadAtRank: spaend fra rank 1 til rank n", () => {
  assert.equal(spreadAtRank([0, 2, 4, 6, 8], 3), 4);
  assert.equal(spreadAtRank([0, 2], 10), 2); // clamper til sidste tilgaengelige rang
});

test("descentAttackGainStats: filtrerer paa direction=descent + type=finale_attack", () => {
  const events = [
    { type: "finale_attack", params: { direction: "descent", gained_seconds: 12 } },
    { type: "finale_attack", params: { direction: "descent", gained_seconds: 18 } },
    { type: "finale_attack", params: { kind: "placement_gap", gap_seconds: 3 } }, // ingen direction -> ignoreres
    { type: "incident", params: {} },
  ];
  const stats = descentAttackGainStats(events);
  assert.equal(stats.count, 2);
  assert.equal(stats.min, 12);
  assert.equal(stats.max, 18);
});

test("descentAttackGainStats: ingen matches -> nulstillet objekt uden kast", () => {
  const stats = descentAttackGainStats([]);
  assert.deepEqual(stats, { count: 0, min: null, max: null });
});
