// #6207: ét rute-match-tal fra motoren. Låser kontrakten mod frontendens
// suitability.js (samme tal for samme vektor) og løbstallets aggregering.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRouteMatch,
  raceRouteVector,
  ROUTE_MATCH_ABILITY_KEYS,
  routeMatchRaw,
  routeMatchRevisionFor,
  routeMatchScore,
  stageRouteVector,
} from "./routeMatch.js";
import { CURRENT_RACE_RULES_REVISION } from "./raceEngineRulesRevision.ts";
import { riderSuitability, SUITABILITY_ABILITY_KEYS } from "../../frontend/src/lib/suitability.js";

const TERRAIN = { flat: 0.4, sprint: 0.3, positioning: 0.2, endurance: 0.1, randomness: 0.5 };

function stage(n, profile_type, finale_type, demand_vector = TERRAIN, extra = {}) {
  return { race_id: "r1", stage_number: n, profile_type, finale_type, demand_vector, distance_km: 180, ...extra };
}

function rider(seed) {
  return Object.fromEntries(ROUTE_MATCH_ABILITY_KEYS.map((k, i) => [k, 40 + ((i * 7 + seed) % 50)]));
}

const SAMPLE_STAGES = [
  stage(1, "flat", "bunch_sprint"),
  stage(2, "hilly", "punch", { punch: 0.5, climbing: 0.3, endurance: 0.2 }),
  stage(3, "mountain", "long_climb", { climbing: 0.7, endurance: 0.3 }),
  stage(4, "itt", "solo_tt", { time_trial: 0.6, positioning: 0.4 }),
];

test("samme 15 evner i samme rækkefølge som frontendens suitability.js", () => {
  assert.deepEqual([...ROUTE_MATCH_ABILITY_KEYS], SUITABILITY_ABILITY_KEYS);
});

test("frontendens riderSuitability giver samme tal som routeMatchScore for motorens vektor", () => {
  const rm = buildRouteMatch({ race: null, stages: SAMPLE_STAGES });
  assert.ok(rm.raceVector, "løbet skal have en vektor");
  for (const seed of [0, 3, 11, 29]) {
    const ab = rider(seed);
    assert.equal(riderSuitability(ab, rm.raceVector).score, rm.race(ab));
    for (const s of rm.stageVectors) {
      assert.equal(riderSuitability(ab, s.vector).score, routeMatchScore(ab, s.vector));
    }
  }
});

test("hver etapevektor summer til 1 og bærer ikke randomness", () => {
  for (const s of SAMPLE_STAGES) {
    const v = stageRouteVector(s, CURRENT_RACE_RULES_REVISION);
    assert.ok(v, `etape ${s.stage_number} skal have en vektor`);
    const sum = Object.values(v).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `etape ${s.stage_number} summer til ${sum}`);
    assert.equal(v.randomness, undefined);
  }
});

test("løbstallet er det afrundede snit af de urundede etapetal", () => {
  const rm = buildRouteMatch({ race: null, stages: SAMPLE_STAGES });
  for (const seed of [1, 8, 17]) {
    const ab = rider(seed);
    const mean = rm.stageVectors.reduce((acc, s) => acc + routeMatchRaw(ab, s.vector), 0) / rm.stageVectors.length;
    assert.equal(rm.race(ab), Math.round(mean));
  }
});

test("en rytter med 99 i alt giver 100 på hver etape og i løbet", () => {
  const ab = Object.fromEntries(ROUTE_MATCH_ABILITY_KEYS.map((k) => [k, 99]));
  const rm = buildRouteMatch({ race: null, stages: SAMPLE_STAGES });
  assert.equal(rm.race(ab), 100);
  assert.deepEqual(rm.stagesList(ab), [100, 100, 100, 100]);
});

test("enkeltstart regnes på motorens tidskørsels-evne, ikke den gemte positionering", () => {
  const v = stageRouteVector(SAMPLE_STAGES[3], CURRENT_RACE_RULES_REVISION);
  assert.ok((v.time_trial ?? 0) > (v.positioning ?? 0), "tidskørsel skal veje mest");
  const tt = { ...rider(0), time_trial: 95, positioning: 20 };
  const pos = { ...rider(0), time_trial: 20, positioning: 95 };
  assert.ok(routeMatchScore(tt, v) > routeMatchScore(pos, v));
});

test("stagesByNumber nøgler på stage_number og stagesList følger etape-rækkefølgen", () => {
  const shuffled = [SAMPLE_STAGES[2], SAMPLE_STAGES[0], SAMPLE_STAGES[3], SAMPLE_STAGES[1]];
  const rm = buildRouteMatch({ race: null, stages: shuffled });
  const ab = rider(5);
  const byNumber = rm.stagesByNumber(ab);
  assert.deepEqual(Object.keys(byNumber).map(Number), [1, 2, 3, 4]);
  assert.deepEqual(rm.stagesList(ab), [1, 2, 3, 4].map((n) => byNumber[n]));
});

test("ingen data giver null, aldrig et opfundet tal", () => {
  assert.equal(raceRouteVector([], CURRENT_RACE_RULES_REVISION), null);
  assert.equal(stageRouteVector(null, CURRENT_RACE_RULES_REVISION), null);
  const rm = buildRouteMatch({ race: null, stages: [] });
  assert.equal(rm.race(rider(0)), null);
  assert.equal(routeMatchScore(null, { flat: 1 }), null);
});

test("revisionen: et bundet løb bruger sin egen, et ukendt eller nyt løb den aktuelle", () => {
  assert.equal(routeMatchRevisionFor(null), CURRENT_RACE_RULES_REVISION);
  assert.equal(routeMatchRevisionFor({ engine_rules_revision: "findes_ikke" }), CURRENT_RACE_RULES_REVISION);
  assert.equal(routeMatchRevisionFor({ engine_rules_revision: CURRENT_RACE_RULES_REVISION }), CURRENT_RACE_RULES_REVISION);
});
