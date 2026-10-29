// #5319 · migrationsscriptets rene planlægning (ingen DB, kører aldrig mod prod).
import test from "node:test";
import assert from "node:assert/strict";
import {
  isTimeTrialOrGcRider, migrateWeekDays, planThresholdMigration, parseArgs,
} from "./5319-migrate-threshold-plans.mjs";

const riders = new Map([
  ["r-tt", { id: "r-tt", primary_type: "tt", secondary_type: null }],
  ["r-gc2", { id: "r-gc2", primary_type: "climber", secondary_type: "gc" }],
  ["r-punch", { id: "r-punch", primary_type: "puncheur", secondary_type: "baroudeur" }],
]);

test("dry-run er default; --apply skal stå eksplicit", () => {
  assert.deepEqual(parseArgs([]), { apply: false, dryRun: true, log: null });
  assert.deepEqual(parseArgs(["--apply", "--log", "x.json"]), { apply: true, dryRun: false, log: "x.json" });
});

test("kun enkeltstarts- og klassementsryttere (primær eller sekundær)", () => {
  assert.equal(isTimeTrialOrGcRider(riders.get("r-tt")), true);
  assert.equal(isTimeTrialOrGcRider(riders.get("r-gc2")), true);
  assert.equal(isTimeTrialOrGcRider(riders.get("r-punch")), false);
  assert.equal(isTimeTrialOrGcRider(undefined), false);
});

test("ugeplan: threshold i session og slots flyttes, resten urørt", () => {
  const days = {
    mon: { session: "threshold", intensity: "hard", slots: [null, "threshold", "sprint", null, null] },
    tue: { session: "endurance", intensity: "easy" },
  };
  const out = migrateWeekDays(days);
  assert.equal(out.changedCells, 2);
  assert.equal(out.days.mon.session, "itt_long");
  assert.equal(out.days.mon.intensity, "hard");
  assert.deepEqual(out.days.mon.slots, [null, "itt_long", "sprint", null, null]);
  assert.deepEqual(out.days.tue, days.tue);
  assert.equal(days.mon.session, "threshold", "input muteres ikke");
  assert.equal(migrateWeekDays({ mon: { session: "sprint", intensity: "hard" } }), null);
  assert.equal(migrateWeekDays(null), null);
});

test("plan: tæller planer og ryttere, springer andre typer og holdrækker over, og er idempotent", () => {
  const plans = [
    { id: 1, rider_id: "r-tt", focus: "threshold" },
    { id: 2, rider_id: "r-gc2", focus: "threshold" },
    { id: 3, rider_id: "r-punch", focus: "threshold" },
    { id: 4, rider_id: "r-tt", focus: "sprint" },
  ];
  const weekPlans = [
    { id: 10, rider_id: "r-tt", days: { mon: { session: "threshold", intensity: "hard" } } },
    { id: 11, rider_id: null, days: { mon: { session: "threshold", intensity: "hard" } } },
    { id: 12, rider_id: "r-punch", days: { mon: { session: "threshold", intensity: "hard" } } },
  ];
  const first = planThresholdMigration({ plans, weekPlans, ridersById: riders });
  assert.deepEqual(first.summary, { plans: 2, weekPlans: 1, weekCells: 1, riders: 2 });
  assert.deepEqual(first.planUpdates.map((u) => u.id), [1, 2]);
  assert.deepEqual(first.weekUpdates.map((u) => u.id), [10]);

  // Efter apply: rækkerne står på itt_long, og en ny kørsel finder intet.
  const appliedPlans = plans.map((p) => (first.planUpdates.some((u) => u.id === p.id) ? { ...p, focus: "itt_long" } : p));
  const appliedWeeks = weekPlans.map((w) => first.weekUpdates.find((u) => u.id === w.id)
    ? { ...w, days: first.weekUpdates.find((u) => u.id === w.id).days } : w);
  const second = planThresholdMigration({ plans: appliedPlans, weekPlans: appliedWeeks, ridersById: riders });
  assert.deepEqual(second.summary, { plans: 0, weekPlans: 0, weekCells: 0, riders: 0 });
});
