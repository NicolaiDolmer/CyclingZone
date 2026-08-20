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
  targetReadyAt,
  missionReadyAt,
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

// #3671: gulvet er RELATIVT. Før var det en absolut konstant der klippede flere
// niveauer ned til samme tal — med basis [9,6,4,3] og gulv 5,0 gav niveau 2 og 3
// begge 5,0, så det sidste scout-trin købte matematisk nul for de 150 af 203
// menneskehold uden chefscout. Nu leverer spejderen en ANDEL af indsnævringen.
const BASE = [9, 6, 4, 3]; // CEIL_HALF_WIDTH_BY_LEVEL efter #3666

test("scoutHalfWidth: hvert niveau køber altid noget, for enhver spejder", () => {
  for (const overall of [40, 48, 55, 59, 60, 70, 85, 99]) {
    for (let level = 1; level < BASE.length; level += 1) {
      const forrige = scoutHalfWidth(level - 1, { overall }, BASE);
      const nu = scoutHalfWidth(level, { overall }, BASE);
      assert.ok(nu < forrige,
        `spejder ${overall}: niveau ${level} købte intet (${forrige} → ${nu}). `
        + "Det var præcis defekten i #3671.");
    }
  }
});

test("scoutHalfWidth: fuld scouting er bit-identisk med det gamle gulv", () => {
  // Den egenskab der gør omlægningen sikker: ingen spejder får et SKARPERE bånd
  // end den absolutte konstant tillod før, så maskeringen på sit strammeste
  // punkt — dér anti-inversionen er mest følsom — er uændret.
  for (const overall of [40, 48, 55, 59, 60, 70, 85, 99]) {
    const nu = scoutHalfWidth(BASE.length - 1, { overall }, BASE);
    const gammelt = minHalfWidthByScoutRating(overall);
    assert.ok(Math.abs(nu - gammelt) < 1e-9,
      `spejder ${overall}: fuldt scoutet gav ${nu}, det gamle gulv gav ${gammelt}`);
  }
});

test("scoutHalfWidth: uscoutet er base[0] for alle — ingen bliver dårligere stillet", () => {
  for (const overall of [40, 60, 99]) {
    assert.equal(scoutHalfWidth(0, { overall }, BASE), BASE[0]);
  }
});

test("scoutHalfWidth: resultatet ligger altid i [base[level], base[0]]", () => {
  for (const overall of [40, 70, 99]) {
    for (let level = 0; level < BASE.length; level += 1) {
      const h = scoutHalfWidth(level, { overall }, BASE);
      assert.ok(h >= BASE[level] - 1e-9 && h <= BASE[0] + 1e-9,
        `spejder ${overall}, niveau ${level}: ${h} er uden for [${BASE[level]}, ${BASE[0]}]`);
    }
  }
});

test("en stærk spejder køber mere pr. niveau end en svag", () => {
  const svag = scoutHalfWidth(2, { overall: 40 }, BASE) - scoutHalfWidth(3, { overall: 40 }, BASE);
  const staerk = scoutHalfWidth(2, { overall: 99 }, BASE) - scoutHalfWidth(3, { overall: 99 }, BASE);
  assert.ok(staerk > svag, "#2244's hensigt: en dårlig spejder må ikke levere ekspert-præcision");
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

// ── targetReadyAt (#3548) ───────────────────────────────────────────────────────

test("targetReadyAt: created_at + targetEtaMinutes", () => {
  const createdAt = "2026-07-10T12:00:00.000Z";
  const ready = targetReadyAt(createdAt);
  assert.equal(ready.getTime() - Date.parse(createdAt), SCOUT_JOB_CONFIG.target.etaMinutes * 60_000);
});

// Låser den egenskab hele nedtællingen hviler på: klar-tidspunktet er PRÆCIS
// den grænse lazyCompleteDueTargetAssignments modner mod (created_at <= now -
// etaMinutes). Rykker den ene, skal den anden følge med.
test("targetReadyAt: er præcis den deadline lazy-modningen håndhæver", () => {
  const createdAt = new Date("2026-07-10T12:00:00.000Z");
  const eta = SCOUT_JOB_CONFIG.target.etaMinutes;
  const ready = targetReadyAt(createdAt);

  const justBefore = new Date(ready.getTime() - 1_000);
  const atDeadline = new Date(ready.getTime());
  // Modningens egen test: created_at <= now - etaMinutes.
  const dueBefore = (now) => new Date(now.getTime() - eta * 60_000);
  assert.ok(createdAt > dueBefore(justBefore), "må ikke være due et sekund før ready_at");
  assert.ok(createdAt <= dueBefore(atDeadline), "skal være due præcis på ready_at");
});

test("targetReadyAt: accepterer Date lige så vel som ISO-streng", () => {
  const createdAt = new Date("2026-07-10T12:00:00.000Z");
  assert.equal(targetReadyAt(createdAt).toISOString(), targetReadyAt(createdAt.toISOString()).toISOString());
});

test("targetReadyAt: manglende/ugyldig created_at giver null (ingen gættet nedtælling)", () => {
  assert.equal(targetReadyAt(null), null);
  assert.equal(targetReadyAt(undefined), null);
  assert.equal(targetReadyAt("not-a-date"), null);
  assert.equal(targetReadyAt("2026-07-10T12:00:00.000Z", "not-a-number"), null);
});

// ── missionReadyAt (#3997) ──────────────────────────────────────────────────────

test("missionReadyAt: created_at + mission.days×24t", () => {
  const createdAt = "2026-08-01T09:00:00.000Z";
  const ready = missionReadyAt(createdAt);
  assert.equal(ready.getTime() - Date.parse(createdAt), SCOUT_JOB_CONFIG.mission.days * 24 * 60 * 60 * 1000);
});

test("missionReadyAt: accepterer en eksplicit dage-parameter (flerdages-robusthed)", () => {
  const createdAt = "2026-08-01T09:00:00.000Z";
  const ready = missionReadyAt(createdAt, 3);
  assert.equal(ready.toISOString(), "2026-08-04T09:00:00.000Z");
});

// Låser den egenskab hele modningen hviler på: klar-tidspunktet er PRÆCIS den
// grænse completeDueMissionAssignments modner mod (created_at <= now - dage×24t).
test("missionReadyAt: er præcis den deadline mission-modningen håndhæver", () => {
  const createdAt = new Date("2026-08-01T09:00:00.000Z");
  const days = SCOUT_JOB_CONFIG.mission.days;
  const ready = missionReadyAt(createdAt);

  const justBefore = new Date(ready.getTime() - 1_000);
  const atDeadline = new Date(ready.getTime());
  const dueBefore = (now) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  assert.ok(createdAt > dueBefore(justBefore), "må ikke være due et sekund før ready_at");
  assert.ok(createdAt <= dueBefore(atDeadline), "skal være due præcis på ready_at");
});

test("missionReadyAt: accepterer Date lige så vel som ISO-streng", () => {
  const createdAt = new Date("2026-08-01T09:00:00.000Z");
  assert.equal(missionReadyAt(createdAt).toISOString(), missionReadyAt(createdAt.toISOString()).toISOString());
});

test("missionReadyAt: manglende/ugyldig created_at giver null", () => {
  assert.equal(missionReadyAt(null), null);
  assert.equal(missionReadyAt(undefined), null);
  assert.equal(missionReadyAt("not-a-date"), null);
  assert.equal(missionReadyAt("2026-08-01T09:00:00.000Z", "not-a-number"), null);
});

// #3997 DST-robusthed: ren elapsed-millisekund-aritmetik (getTime() + ms), ALDRIG
// kalenderdags-aritmetik (setUTCDate-stil, readyDateFor ovenfor) — derfor upåvirket
// af at Europe/Copenhagens UTC-offset ændrer sig midt i vinduet.
test("missionReadyAt: DST-forårsspring (CET→CEST, 2026-03-29) — stadig eksakt +24t", () => {
  const createdAt = "2026-03-28T10:00:00.000Z";
  assert.equal(missionReadyAt(createdAt, 1).toISOString(), "2026-03-29T10:00:00.000Z");
});

test("missionReadyAt: DST-efterårsfald (CEST→CET, 2026-10-25) — stadig eksakt +24t", () => {
  const createdAt = "2026-10-24T10:00:00.000Z";
  assert.equal(missionReadyAt(createdAt, 1).toISOString(), "2026-10-25T10:00:00.000Z");
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
