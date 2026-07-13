import test from "node:test";
import assert from "node:assert/strict";
import {
  peakStatus,
  terrainKey,
  isSummitFinish,
  stageProfileStrip,
  raceProfileSummary,
  countRivalPeaks,
  PEAK_STATUS_ONTRACK_TQ,
} from "./plannerBoard.js";

test("peakStatus: optakt ikke begyndt → pending uanset tq", () => {
  // window_start = 100, leadup 14 → optakt starter dag 86. today 80 < 86.
  assert.equal(peakStatus({ trainingQuality: 0.95, todayOrdinal: 80, windowStartOrdinal: 100, leadupDays: 14 }), "pending");
});

test("peakStatus: optakt kører + høj tq → on_track", () => {
  assert.equal(peakStatus({ trainingQuality: 0.8, todayOrdinal: 90, windowStartOrdinal: 100, leadupDays: 14 }), "on_track");
});

test("peakStatus: optakt kører + lav tq → at_risk", () => {
  assert.equal(peakStatus({ trainingQuality: 0.44, todayOrdinal: 95, windowStartOrdinal: 100, leadupDays: 14 }), "at_risk");
});

test("peakStatus: tq lig tærsklen → on_track (inklusiv)", () => {
  assert.equal(peakStatus({ trainingQuality: PEAK_STATUS_ONTRACK_TQ, todayOrdinal: 95, windowStartOrdinal: 100, leadupDays: 14 }), "on_track");
});

test("peakStatus: manglende tq under optakt → pending", () => {
  assert.equal(peakStatus({ trainingQuality: null, todayOrdinal: 95, windowStartOrdinal: 100, leadupDays: 14 }), "pending");
});

test("terrainKey: mapper profiler til buckets, ukendt → flat", () => {
  assert.equal(terrainKey("high_mountain"), "mountain");
  assert.equal(terrainKey("rolling"), "hilly");
  assert.equal(terrainKey("itt"), "itt");
  assert.equal(terrainKey("cobbles"), "cobbles");
  assert.equal(terrainKey(undefined), "flat");
  assert.equal(terrainKey("nonsense"), "flat");
});

test("isSummitFinish: bjerg-profil ELLER lang-klatrings-finale", () => {
  assert.equal(isSummitFinish("mountain", null), true);
  assert.equal(isSummitFinish("high_mountain", "bunch_sprint"), true);
  assert.equal(isSummitFinish("hilly", "long_climb"), true);
  assert.equal(isSummitFinish("flat", "bunch_sprint"), false);
  assert.equal(isSummitFinish("rolling", "punch"), false);
});

test("stageProfileStrip: sorterer efter stage_number + markerer summit", () => {
  const strip = stageProfileStrip([
    { stage_number: 2, profile_type: "flat", finale_type: "bunch_sprint" },
    { stage_number: 1, profile_type: "mountain", finale_type: "long_climb" },
    { stage_number: 3, profile_type: "itt", finale_type: "solo_tt" },
  ]);
  assert.deepEqual(strip, [
    { stage: 1, terrain: "mountain", summit: true },
    { stage: 2, terrain: "flat", summit: false },
    { stage: 3, terrain: "itt", summit: false },
  ]);
});

test("raceProfileSummary: tæller etaper + summit finishes", () => {
  const strip = stageProfileStrip([
    { stage_number: 1, profile_type: "flat" },
    { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
    { stage_number: 3, profile_type: "high_mountain" },
  ]);
  assert.deepEqual(raceProfileSummary(strip), { stages: 3, summitFinishes: 2 });
});

test("countRivalPeaks: distinkte rival-hold pr. løb, mit hold ekskluderet", () => {
  const rows = [
    { target_race_id: "r1", team_id: "me" },     // mit — tælles ikke
    { target_race_id: "r1", team_id: "rivalA" },
    { target_race_id: "r1", team_id: "rivalB" },
    { target_race_id: "r1", team_id: "rivalA" },  // dublet-hold → tælles én gang
    { target_race_id: "r2", team_id: "rivalA" },
    { target_race_id: null, team_id: "rivalC" },   // intet mål — ignoreres
  ];
  const counts = countRivalPeaks(rows, "me");
  assert.equal(counts.get("r1"), 2);
  assert.equal(counts.get("r2"), 1);
  assert.equal(counts.has("r3"), false);
});

test("countRivalPeaks: løb hvor kun mit hold topper → ingen entry", () => {
  const counts = countRivalPeaks([{ target_race_id: "r1", team_id: "me" }], "me");
  assert.equal(counts.has("r1"), false);
});
