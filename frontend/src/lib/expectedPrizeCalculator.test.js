import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeExpectedRacePoints,
  computeExpectedRacePrize,
  formatExpectedPrize,
  PRIZE_PER_POINT,
} from "./expectedPrizeCalculator.js";

// race_points fixture — sub-set mirroring backend uciRacePointDefaults seeding for verified classes.
// Numbers verified against docs/metrics/season-1-prize-audit.json (ProSeries baseline).
function fixturePoints() {
  const rows = [];
  const push = (race_class, result_type, points) => {
    points.forEach((p, i) => rows.push({ race_class, result_type, rank: i + 1, points: p }));
  };

  // ProSeries — full coverage (matches audit baseline for sæson 1)
  push("ProSeries", "Klassement", [
    200, 150, 125, 100, 85, 70, 60, 50, 40, 35, 30, 25, 20, 15, 10,
    ...Array(15).fill(5), ...Array(10).fill(3),
  ]);
  push("ProSeries", "Klassiker", [
    200, 150, 125, 100, 85, 70, 60, 50, 40, 35, 30, 25, 20, 15, 10,
    ...Array(15).fill(5), ...Array(10).fill(3),
  ]);
  push("ProSeries", "Etapeplacering", [20, 15, 10, 5, 3]);
  push("ProSeries", "Pointtroje", [32, 24, 17]);
  push("ProSeries", "Bjergtroje", [32, 24, 17]);
  push("ProSeries", "Ungdomstroje", [16, 10, 6]);
  push("ProSeries", "Forertroje", [5]);
  push("ProSeries", "BjergtrojeDag", [3]);
  push("ProSeries", "PointtrojeDag", [3]);
  push("ProSeries", "UngdomstrojeDag", [3]);
  push("ProSeries", "EtapelobHold", [10]);
  push("ProSeries", "KlassikerHold", [10]);

  // TourFrance — partial (Klassement + jersey finals + per-day jerseys for sanity check)
  push("TourFrance", "Klassement", [
    1300, 1040, 880, 750, 620, 520, 425, 360, 295, 230, 190, 165,
    140, 110, 100, 90, 85, 80, 70, 60,
    ...Array(5).fill(50), ...Array(5).fill(40), ...Array(10).fill(35),
    ...Array(10).fill(25), ...Array(5).fill(20), ...Array(5).fill(15),
  ]);
  push("TourFrance", "Etapeplacering", [210, 150, 110, 90, 70, 55, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
  push("TourFrance", "Pointtroje", [210, 150, 110]);
  push("TourFrance", "Bjergtroje", [210, 150, 110]);
  push("TourFrance", "Ungdomstroje", [100, 60, 30]);
  push("TourFrance", "Forertroje", [25]);
  push("TourFrance", "BjergtrojeDag", [15]);
  push("TourFrance", "PointtrojeDag", [15]);
  push("TourFrance", "UngdomstrojeDag", [15]);
  push("TourFrance", "EtapelobHold", [65]);

  // Monuments — Klassiker only (one-day verification)
  push("Monuments", "Klassiker", [
    800, 640, 520, 440, 360, 280, 240, 200, 160, 135, 110, 95,
    85, 65, 55, 50, 50, 50, 50, 50,
    ...Array(10).fill(30), ...Array(20).fill(15),
    ...Array(5).fill(10), ...Array(5).fill(5),
  ]);
  push("Monuments", "Pointtroje", [80, 60, 42]);
  push("Monuments", "Bjergtroje", [80, 60, 42]);
  push("Monuments", "Ungdomstroje", [40, 25, 15]);
  push("Monuments", "KlassikerHold", [40]);

  return rows;
}

// ---------- computeExpectedRacePoints ----------

test("ProSeries one-day → 1308 points (matches audit baseline)", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "ProSeries",
    raceType: "single",
    stages: 1,
    racePoints,
  });
  assert.equal(result, 1308);
});

test("ProSeries 5-stage race → 1643 points (matches audit baseline)", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "ProSeries",
    raceType: "stage_race",
    stages: 5,
    racePoints,
  });
  assert.equal(result, 1643);
});

test("ProSeries 4-stage race → 1576 points (matches audit baseline)", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "ProSeries",
    raceType: "stage_race",
    stages: 4,
    racePoints,
  });
  assert.equal(result, 1576);
});

test("ProSeries 6-stage race → 1710 points (matches audit baseline)", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "ProSeries",
    raceType: "stage_race",
    stages: 6,
    racePoints,
  });
  assert.equal(result, 1710);
});

test("TourFrance 21-stage race summerer finals + per-stage", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "TourFrance",
    raceType: "stage_race",
    stages: 21,
    racePoints,
  });
  // Klassement final = 8735 (sum of 50-rank array w/ tail fills)
  // Pointtroje 470 + Bjergtroje 470 + Ungdomstroje 190 + EtapelobHold 65
  // Etapeplacering per stage = 910 → × 21 = 19110
  // Forertroje 25 × 21 = 525
  // Bjerg/Point/UngdomsDag × 21 each = 315 × 3 = 945
  // Total = 8735 + 470 + 470 + 190 + 65 + 19110 + 525 + 945 = 30510
  assert.equal(result, 30510);
});

test("Monuments one-day Klassiker → finals only (no per-stage)", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "Monuments",
    raceType: "single",
    stages: 1,
    racePoints,
  });
  // Klassiker = first 20 sum 4435 + 30×10 + 15×20 + 10×5 + 5×5 = 5110
  // Pointtroje 182 + Bjergtroje 182 + Ungdomstroje 80 + KlassikerHold 40
  // Total = 5110 + 182 + 182 + 80 + 40 = 5594
  assert.equal(result, 5594);
});

test("missing race_class returns 0", () => {
  assert.equal(
    computeExpectedRacePoints({ raceClass: null, raceType: "single", stages: 1, racePoints: fixturePoints() }),
    0,
  );
});

test("empty racePoints returns 0", () => {
  assert.equal(
    computeExpectedRacePoints({ raceClass: "ProSeries", raceType: "single", stages: 1, racePoints: [] }),
    0,
  );
});

test("unknown race_class returns 0", () => {
  assert.equal(
    computeExpectedRacePoints({ raceClass: "UnknownClass", raceType: "single", stages: 1, racePoints: fixturePoints() }),
    0,
  );
});

test("stages=0 on stage_race defaults to 1 stage", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePoints({
    raceClass: "ProSeries",
    raceType: "stage_race",
    stages: 0,
    racePoints,
  });
  // 1-stage stage_race: finals (1308 same as one-day except Klassement instead of Klassiker, EtapelobHold instead of KlassikerHold — same numeric)
  // + per-stage (Etapeplacering 53 + Forertroje 5 + 3×3 jerseys = 67) × 1 = 67
  // Total = 1308 + 67 = 1375
  assert.equal(result, 1375);
});

// ---------- computeExpectedRacePrize ----------

test("computeExpectedRacePrize multiplies points by 1500", () => {
  const racePoints = fixturePoints();
  const result = computeExpectedRacePrize({
    raceClass: "ProSeries",
    raceType: "single",
    stages: 1,
    racePoints,
  });
  assert.equal(result, 1308 * 1500); // = 1.962.000 CZ$ (matches audit baseline)
});

test("PRIZE_PER_POINT is 1500", () => {
  assert.equal(PRIZE_PER_POINT, 1500);
});

// ---------- formatExpectedPrize ----------

test("formatExpectedPrize — millions with one decimal under 10M", () => {
  assert.equal(formatExpectedPrize(2_464_500), "~2,5M CZ$");
  assert.equal(formatExpectedPrize(1_962_000), "~2,0M CZ$");
  assert.equal(formatExpectedPrize(4_400_000), "~4,4M CZ$");
});

test("formatExpectedPrize — millions without decimal at 10M+", () => {
  assert.equal(formatExpectedPrize(34_240 * 1500), "~51M CZ$");
});

test("formatExpectedPrize — thousands rounded", () => {
  assert.equal(formatExpectedPrize(125_000), "~125k CZ$");
  assert.equal(formatExpectedPrize(2_400), "~2k CZ$");
});

test("formatExpectedPrize — below 1k", () => {
  assert.equal(formatExpectedPrize(450), "~450 CZ$");
});

test("formatExpectedPrize — 0 / negative / null", () => {
  assert.equal(formatExpectedPrize(0), "~0 CZ$");
  assert.equal(formatExpectedPrize(null), "~0 CZ$");
  assert.equal(formatExpectedPrize(-100), "~0 CZ$");
});
