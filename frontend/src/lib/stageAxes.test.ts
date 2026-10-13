// Unit-tests for stageAxes.ts (#6364). Kører med: node --test (i frontend/)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";

import { stageAxes, decisiveClimb, dayDemands } from "./stageAxes.ts";
import { STAGE_PROFILE_TYPES, STAGE_FINALE_TYPES } from "../../../backend/lib/stageProfileTypes.js";
import { legacyStageToS5Axes } from "../../../backend/lib/stageProfileLegacyMapping.js";

const SECTOR_SETS = [
  null,
  [],
  [{ kind: "cobbles", length_km: 2.5 }, { kind: "cobbles", length_km: 1.1 }],
  [{ kind: "gravel", length_km: 3 }],
  [{ kind: "cobbles", length_km: 4 }, { kind: "gravel", length_km: 4 }],
  [{ kind: "cobbles", length_km: 0 }, { kind: "mud", length_km: 2 }, null],
];

test("DRIFT-GUARD: stageAxes == backend legacyStageToS5Axes for alle profil/finale/sektor-kombinationer", () => {
  let checked = 0;
  for (const profile_type of [...STAGE_PROFILE_TYPES, "nonsense", null]) {
    for (const finale_type of [...STAGE_FINALE_TYPES, "nonsense", null]) {
      for (const sectors of SECTOR_SETS) {
        const row = { profile_type, finale_type, sectors };
        assert.deepEqual(stageAxes(row), legacyStageToS5Axes(row), JSON.stringify(row));
        checked += 1;
      }
    }
  }
  assert.ok(checked > 500);
});

test("stageAxes: S4-etape (gammel etiket) vises med sine tre akser", () => {
  const axes = stageAxes({ profile_type: "mountain", finale_type: "long_climb", sectors: [] });
  assert.equal(axes?.terrain, "mountain");
  assert.equal(axes?.finish, "long_climb");
  assert.equal(axes?.surface, "asphalt");
});

test("stageAxes: ukendt profile_type -> null", () => {
  assert.equal(stageAxes({ profile_type: "nonsense" }), null);
  assert.equal(stageAxes(null), null);
});

const climb = (category: string, crest_km: number, extra = {}) => ({
  name: `Col ${crest_km}`, category, crest_km, length_km: 8, avg_gradient: 7, ...extra,
});

test("decisiveClimb: hardeste kategori, og den sidste af dem", () => {
  const d = decisiveClimb({
    distance_km: 175,
    climbs: [climb("1", 60), climb("2", 100), climb("1", 120), climb("2", 163)],
  });
  assert.equal(d?.crestKm, 120);
  assert.equal(d?.kmToGo, 55);
  assert.equal(d?.summit, false);
  assert.equal(d?.isLast, false, "en senere (lavere) stigning følger efter, så der er ikke nedkørsel direkte til mål");
});

test("decisiveClimb: summit kommer kun af summit_finish, aldrig af at toppen ligger tæt på mål", () => {
  const d = decisiveClimb({ distance_km: 150, climbs: [climb("1", 149.6)] });
  assert.equal(d?.summit, false);
  assert.equal(d?.isLast, true);
});

test("decisiveClimb: bjergtop er markeret som summit", () => {
  const d = decisiveClimb({ distance_km: 150, climbs: [climb("HC", 150, { summit_finish: true })] });
  assert.equal(d?.summit, true);
  assert.equal(d?.kmToGo, 0);
});

test("decisiveClimb: kat. 4 afgør aldrig, tidskørsel har ingen, uden stigninger null", () => {
  assert.equal(decisiveClimb({ distance_km: 180, climbs: [climb("4", 90)] }), null);
  assert.equal(decisiveClimb({ distance_km: 30, profile_type: "itt_hilly", climbs: [climb("2", 15)] }), null);
  assert.equal(decisiveClimb({ distance_km: 180, climbs: [] }), null);
  assert.equal(decisiveClimb({ distance_km: 0, climbs: [climb("1", 10)] }), null);
});

test("dayDemands: høj/mid/lav efter vægt mod den største, randomness udeladt", () => {
  const out = dayDemands({ climbing: 0.5, endurance: 0.14, tempo: 0.12, recovery: 0.06, randomness: 0.18 });
  assert.deepEqual(out, [
    { ability: "climbing", level: "high" },
    { ability: "endurance", level: "mid" },
    { ability: "tempo", level: "low" },
    { ability: "recovery", level: "low" },
  ]);
});

test("dayDemands: tom eller ulæselig vektor giver tom liste", () => {
  assert.deepEqual(dayDemands(null), []);
  assert.deepEqual(dayDemands({}), []);
  assert.deepEqual(dayDemands({ randomness: 1 }), []);
});
