import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCOUT,
  SCOUT_JOB_CONFIG,
  scoutCapacity,
  minHalfWidthByScoutRating,
  scoutHalfWidth,
  travelCostFor,
  readyDateFor,
  canStartAssignment,
} from "./scoutEngine.js";

// ── minHalfWidthByScoutRating (gulv-interpolation) ────────────────────────────

test("gulv: overall 40 → 5.0, overall 99 → 3.0", () => {
  assert.equal(minHalfWidthByScoutRating(40), 5.0);
  assert.equal(minHalfWidthByScoutRating(99), 3.0);
});

test("gulv: monotonisk faldende med stigende overall (≥60, uden for loftet)", () => {
  const vals = [60, 70, 80, 90, 99].map(minHalfWidthByScoutRating);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] <= vals[i - 1], `forventede faldende gulv: ${vals[i - 1]} → ${vals[i]}`);
  }
});

test("gulv: loft — middelmådig spejder (overall < 60) kommer aldrig under 4.5", () => {
  assert.equal(minHalfWidthByScoutRating(40), 5.0); // interpoleret > 4.5 alligevel
  assert.equal(minHalfWidthByScoutRating(55), 4.5); // interpoleret ville være < 4.5 uden loft
  assert.ok(minHalfWidthByScoutRating(59) >= 4.5);
});

test("gulv: uden for [40,99] clampes til endepunkterne", () => {
  assert.equal(minHalfWidthByScoutRating(0), minHalfWidthByScoutRating(40));
  assert.equal(minHalfWidthByScoutRating(150), minHalfWidthByScoutRating(99));
});

// ── scoutHalfWidth ─────────────────────────────────────────────────────────────

test("scoutHalfWidth: gulv slår kun igennem når base er smallere end gulvet", () => {
  const base = [12, 8, 5, 3]; // CEIL_HALF_WIDTH_BY_LEVEL
  // overall 99 → gulv 3.0 == base[3] → uændret
  assert.equal(scoutHalfWidth(3, { overall: 99 }, base), 3);
  // overall 40 → gulv 5.0 > base[3]=3 → gulvet vinder
  assert.equal(scoutHalfWidth(3, { overall: 40 }, base), 5.0);
  // level 0 (base 12) — altid over gulvet, uændret
  assert.equal(scoutHalfWidth(0, { overall: 40 }, base), 12);
});

test("scoutHalfWidth: unitScale konverterer gulvet til stjerne-enheder", () => {
  const base = [1.5, 1.2, 0.8, 0.5]; // stjerne-skala (scouting.js)
  const scale = 0.5 / 3; // residualHalfWidth(0.5) / CEIL_HALF_WIDTH_BY_LEVEL[3](3)
  // overall 99 → gulv 3.0 rating-pt × scale = 0.5 == base[3] → uændret
  assert.ok(Math.abs(scoutHalfWidth(3, { overall: 99 }, base, scale) - 0.5) < 1e-9);
  // overall 40 → gulv 5.0 × scale ≈ 0.833 > base[3]=0.5 → gulvet vinder
  assert.ok(scoutHalfWidth(3, { overall: 40 }, base, scale) > 0.8);
});

test("scoutHalfWidth: DEFAULT_SCOUT bruges når intet scout gives", () => {
  const base = [12, 8, 5, 3];
  assert.equal(scoutHalfWidth(3, undefined, base), scoutHalfWidth(3, DEFAULT_SCOUT, base));
});

// ── scoutCapacity ──────────────────────────────────────────────────────────────

test("kapacitet: overall 79 → 1, overall 80 → 2", () => {
  assert.equal(scoutCapacity({ overall: 79 }), 1);
  assert.equal(scoutCapacity({ overall: 80 }), 2);
});

test("kapacitet: DEFAULT_SCOUT (overall 40) → 1", () => {
  assert.equal(scoutCapacity(DEFAULT_SCOUT), 1);
});

// ── travelCostFor / readyDateFor ────────────────────────────────────────────────

test("travelCostFor: target = costPerLevel × niveau-steps", () => {
  assert.equal(travelCostFor("target", { fromLevel: 0, toLevel: 1 }), SCOUT_JOB_CONFIG.target.costPerLevel);
  assert.equal(travelCostFor("target", { fromLevel: 0, toLevel: 3 }), SCOUT_JOB_CONFIG.target.costPerLevel * 3);
  assert.equal(travelCostFor("target", { fromLevel: 1, toLevel: 2 }), SCOUT_JOB_CONFIG.target.costPerLevel);
});

test("travelCostFor: mission = flat cost", () => {
  assert.equal(travelCostFor("mission"), SCOUT_JOB_CONFIG.mission.cost);
  assert.equal(travelCostFor("mission", { fromLevel: 0, toLevel: 99 }), SCOUT_JOB_CONFIG.mission.cost);
});

test("travelCostFor: ukendt kind kaster", () => {
  assert.throws(() => travelCostFor("bogus"));
});

test("readyDateFor: target = daysPerLevel × niveau-steps efter startdato", () => {
  const start = new Date("2026-07-10T00:00:00Z");
  const ready = readyDateFor("target", start, { fromLevel: 0, toLevel: 2 });
  const expectedDays = SCOUT_JOB_CONFIG.target.daysPerLevel * 2;
  assert.equal(ready.getTime() - start.getTime(), expectedDays * 24 * 60 * 60 * 1000);
});

test("readyDateFor: mission = fast varighed", () => {
  const start = new Date("2026-07-10T00:00:00Z");
  const ready = readyDateFor("mission", start);
  assert.equal(ready.getTime() - start.getTime(), SCOUT_JOB_CONFIG.mission.days * 24 * 60 * 60 * 1000);
});

test("readyDateFor: ugyldig startedOn kaster", () => {
  assert.throws(() => readyDateFor("mission", "not-a-date"));
});

// ── canStartAssignment ──────────────────────────────────────────────────────────

test("canStartAssignment: ok når kapacitet og balance er tilstrækkelig", () => {
  assert.deepEqual(
    canStartAssignment({ activeCount: 0, scout: DEFAULT_SCOUT, balance: 100000, cost: 15000 }),
    { ok: true, reason: null },
  );
});

test("canStartAssignment: afvist ved fuld kapacitet", () => {
  assert.deepEqual(
    canStartAssignment({ activeCount: 1, scout: DEFAULT_SCOUT, balance: 100000, cost: 15000 }),
    { ok: false, reason: "capacity" },
  );
  // overall 80 → kapacitet 2, så activeCount 1 er stadig ok
  assert.deepEqual(
    canStartAssignment({ activeCount: 1, scout: { overall: 80 }, balance: 100000, cost: 15000 }),
    { ok: true, reason: null },
  );
});

test("canStartAssignment: afvist ved utilstrækkelig balance", () => {
  assert.deepEqual(
    canStartAssignment({ activeCount: 0, scout: DEFAULT_SCOUT, balance: 1000, cost: 15000 }),
    { ok: false, reason: "insufficient_funds" },
  );
});

test("canStartAssignment: capacity vinder over insufficient_funds", () => {
  assert.deepEqual(
    canStartAssignment({ activeCount: 1, scout: DEFAULT_SCOUT, balance: 0, cost: 15000 }),
    { ok: false, reason: "capacity" },
  );
});
