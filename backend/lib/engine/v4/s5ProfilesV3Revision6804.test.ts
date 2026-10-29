// #6804 (ejer 21/10): s5_profiles_v3 = HELE s5_profiles_v2-pakken + udbrudspakken trin 2,
// SLUKKET. Kontrakten for selve revisionen: kendt, aldrig aktuel, arver alt fra v2.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_RACE_RULES_REVISION,
  isKnownRulesRevision,
  isOfficialTimesV3OrLater,
  isOfficialTimesV4OrLater,
  isOfficialTimesV5OrLater,
  isOrdersGcRulesRevision,
  isOrdersGcV2OrLater,
  isOrdersGcV3OrLater,
  isS5ProfilesV1OrLater,
  isS5ProfilesV2OrLater,
  isS5ProfilesV3OrLater,
  ordersGcGeneration,
  preservesOfficialStageTimes,
  RACE_RULES_REVISIONS,
  resolveRaceRulesRevision,
  sharedTimeModelGeneration,
  surfaceRulesRevision,
  usesSharedGroupTime,
} from "../../raceEngineRulesRevision.ts";
import { normalizeRulesRevision } from "./segmentLoop.ts";

test("#6804: s5_profiles_v3 is known, current since the owner's go 26/10, and inherits every s5_profiles_v2 helper", () => {
  const revision = "s5_profiles_v3";
  assert.equal(isKnownRulesRevision(revision), true);
  assert.equal(CURRENT_RACE_RULES_REVISION, revision, "v3 er aktuel fra ejerens go 26/10");
  for (const helper of [ordersGcGeneration, sharedTimeModelGeneration, isOrdersGcRulesRevision, isOrdersGcV2OrLater, isOrdersGcV3OrLater,
    isOfficialTimesV3OrLater, isOfficialTimesV4OrLater, isOfficialTimesV5OrLater, isS5ProfilesV1OrLater, isS5ProfilesV2OrLater,
    preservesOfficialStageTimes, usesSharedGroupTime]) {
    assert.equal(helper(revision), helper("s5_profiles_v2"), helper.name);
  }
  assert.equal(isS5ProfilesV2OrLater(revision), true);
});

test("#6804: isS5ProfilesV3OrLater is true for exactly s5_profiles_v3", () => {
  assert.deepEqual(RACE_RULES_REVISIONS.map(isS5ProfilesV3OrLater), RACE_RULES_REVISIONS.map((r) => r === "s5_profiles_v3"));
  for (const unknown of [null, undefined, "", "s5_profiles_v2", "s5_profiles_v3 ", 3]) {
    assert.equal(isS5ProfilesV3OrLater(unknown), false);
  }
});

test("#6804: a new race binds to v3; a stored v2 keeps v2; the engine accepts v3", () => {
  const notStarted = { id: "n", stages_completed: 0 };
  const started = { id: "s", stages_completed: 2 };
  assert.equal(resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: CURRENT_RACE_RULES_REVISION }), CURRENT_RACE_RULES_REVISION);
  assert.equal(resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "s5_profiles_v3", currentRevision: CURRENT_RACE_RULES_REVISION }), "s5_profiles_v3");
  assert.equal(resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "s5_profiles_v2", currentRevision: CURRENT_RACE_RULES_REVISION }), "s5_profiles_v2");
  assert.equal(surfaceRulesRevision({ race: notStarted, storedRevision: null }), "s5_profiles_v3");
  assert.equal(normalizeRulesRevision("s5_profiles_v3"), "s5_profiles_v3");
});
