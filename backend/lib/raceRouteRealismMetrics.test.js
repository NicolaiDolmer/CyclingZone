// backend/lib/raceRouteRealismMetrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTier, TIER_TARGETS } from "./raceRouteRealismMetrics.js";

const st = (profile_type, finale_type, distance_km = 160) => ({ profile_type, finale_type, distance_km, sectors: [] });
const stageRace = (stages) => ({ race_type: "stage_race", stages });
const oneDay = (profile_type, finale_type) => ({ race_type: "single", stages: [st(profile_type, finale_type)] });

test("scoreTier tæller summit = long_climb på mtn/hm", () => {
  const races = [{ ...stageRace(), stages: [st("high_mountain", "long_climb"), st("mountain", "long_climb"), st("mountain", "descent")] }];
  const s = scoreTier(3, races);
  assert.equal(s.summit_finishes, 2);
  assert.equal(s.mdown_pct, 33); // 1 descent af 3 bjerg-etaper
});

test("scoreTier tæller fritstående ITT + brosten-i-etapeløb", () => {
  const races = [
    oneDay("itt", "solo_tt"),
    { ...stageRace(), stages: [st("flat", "bunch_sprint"), { ...st("cobbles", "reduced_sprint"), sectors: [{ kind: "cobbles", start_km: 80, length_km: 2 }] }] },
  ];
  const s = scoreTier(3, races);
  assert.equal(s.standalone_itt, 1);
  assert.equal(s.cobbles_in_stagerace, 1);
});

test("GO/NO-GO: en tier under mål fejler gaten", () => {
  const flatOnly = [{ ...stageRace(), stages: [st("flat", "bunch_sprint"), st("mountain", "descent")] }];
  const s = scoreTier(3, flatOnly);
  assert.equal(s.pass, false);
  assert.ok(s.failures.some((f) => f.includes("summit")));
});

test("TIER_TARGETS matcher #2755 for tier 3 og 4", () => {
  assert.equal(TIER_TARGETS[3].summit_min, 8);
  assert.equal(TIER_TARGETS[3].mdown_max_pct, 55);
  assert.equal(TIER_TARGETS[4].summit_min, 4);
  assert.equal(TIER_TARGETS[4].mdown_max_pct, 60);
});
