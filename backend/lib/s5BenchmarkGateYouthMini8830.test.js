// #8830 U23 loesning A (ejer 27/11): en ungdoms-mini-GT doemmes mod sin egen bjergtop-kvote
// (summen af de skalerede bjergtop-terraener), ikke seniorens GT-kvote. Senior og S5 uaendret.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGrandTour, expectedGrandTourCounts, isYouthMiniGrandTour } from "./s5BenchmarkGate.js";

const D = 140;
const climb = (category, length_km, crest_km, summit_finish = false) => ({ name: "x", category, length_km, avg_gradient: 6, crest_km, summit_finish });
const finish = () => [{ kind: "finish", km: D }];
const STAGE = {
  itt: () => ({ profile_type: "itt", finale_type: "solo_tt", distance_km: 25, climbs: [], sprints: finish() }),
  flat: () => ({ profile_type: "flat", finale_type: "flat_sprint", distance_km: D, climbs: [], sprints: finish() }),
  mmSummit: () => ({ profile_type: "medium_mountain", finale_type: "long_climb", distance_km: D, climbs: [climb("2", 6, 60), climb("2", 6, D, true)], sprints: finish() }),
  mountainSummit: () => ({ profile_type: "mountain", finale_type: "long_climb", distance_km: D, climbs: [climb("2", 6, 60), climb("1", 10, D, true)], sprints: finish() }),
  highSummit: () => ({ profile_type: "high_mountain", finale_type: "long_climb", distance_km: D, climbs: [climb("1", 10, 70), climb("HC", 12, D, true)], sprints: finish() }),
};

/** 7-etapers Vuelta-mini-GT som generatoren laver den: alle bjergtop-terraener ender paa toppen. */
function vueltaMini(squad) {
  const order = ["itt", "mmSummit", "mountainSummit", "mountainSummit", "highSummit", "itt", "flat"];
  return {
    pool_race_id: "mini-vuelta", name: "Vuelta Ibérica U23", race_type: "stage_race", race_class: "GiroVuelta",
    terrain_archetype: "grand_tour", squad,
    stages: order.map((k, i) => ({ ...STAGE[k](), stage_number: i + 1 })),
  };
}

test("isYouthMiniGrandTour: kun U23/junior, kun fra S6, kun kortere end en rigtig GT", () => {
  assert.equal(isYouthMiniGrandTour({ squad: "u23" }, 7, true), true);
  assert.equal(isYouthMiniGrandTour({ squad: "junior" }, 4, true), true);
  assert.equal(isYouthMiniGrandTour({ squad: "u23" }, 7, false), false);
  assert.equal(isYouthMiniGrandTour({ squad: "senior" }, 7, true), false);
  assert.equal(isYouthMiniGrandTour({ squad: null }, 7, true), false);
  assert.equal(isYouthMiniGrandTour({ squad: "u23" }, 21, true), false);
});

test("U23-mini-GT i S6: bjergtop-kvoten er summen af bjergtop-terraenerne (loesning A)", () => {
  const terrains = expectedGrandTourCounts("vuelta", 7).terrains;
  const want = terrains.high_mountain + terrains.mountain + terrains.medium_mountain;
  const g = checkGrandTour(vueltaMini("u23"), { s6: true });
  assert.equal(g.youthMini, true);
  assert.equal(g.expected.summits, want);
  assert.equal(g.counts.summits, 4);
  assert.ok(!g.violations.some((v) => v.startsWith("bjergtoppe")), g.violations.join(" | "));
});

test("samme loeb uden ungdoms-trup eller i S5: seniorens kvote doemmer som foer", () => {
  const senior = checkGrandTour(vueltaMini(null), { s6: true });
  assert.equal(senior.youthMini, false);
  assert.equal(senior.expected.summits, expectedGrandTourCounts("vuelta", 7).summits);
  assert.ok(senior.violations.some((v) => v.startsWith("bjergtoppe 4 mod kvote")), senior.violations.join(" | "));
  const s5 = checkGrandTour(vueltaMini("u23"), { s6: false });
  assert.equal(s5.youthMini, false);
  assert.ok(s5.violations.some((v) => v.startsWith("bjergtoppe 4 mod kvote")), s5.violations.join(" | "));
});

test("junior-mini-GT i S6: een enkeltstart (ejer 27/11), gaten forventer det samme", () => {
  const e = expectedGrandTourCounts("giro", 4, { maxTimeTrials: 1 });
  assert.equal(e.timeTrials, 1);
  assert.equal(Object.values(e.terrains).reduce((a, b) => a + b, 0), 3);
  assert.equal(expectedGrandTourCounts("giro", 4).timeTrials, 2, "uden loft: uaendret");
});
