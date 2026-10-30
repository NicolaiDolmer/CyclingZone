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
  assert.deepEqual(first.summary, { plans: 2, weekPlans: 1, weekCells: 1, riders: 2, groupsMigrated: 0, ridersDetachedFromGroup: 0 });
  assert.deepEqual(first.planUpdates.map((u) => u.id), [1, 2]);
  assert.deepEqual(first.weekUpdates.map((u) => u.id), [10]);

  // Efter apply: rækkerne står på itt_long, og en ny kørsel finder intet.
  const appliedPlans = plans.map((p) => (first.planUpdates.some((u) => u.id === p.id) ? { ...p, focus: "itt_long" } : p));
  const appliedWeeks = weekPlans.map((w) => first.weekUpdates.find((u) => u.id === w.id)
    ? { ...w, days: first.weekUpdates.find((u) => u.id === w.id).days } : w);
  const second = planThresholdMigration({ plans: appliedPlans, weekPlans: appliedWeeks, ridersById: riders });
  assert.deepEqual(second.summary, { plans: 0, weekPlans: 0, weekCells: 0, riders: 0, groupsMigrated: 0, ridersDetachedFromGroup: 0 });
});

// Codex-fund: en gruppe-følger må ikke få sin flytning rullet tilbage af næste
// gruppe-ændring (writeCopies kopierer gruppens uge til alle følgere).
test("gruppe-følgere: ren tt/gc-gruppe flyttes med, blandet gruppe kobler rytteren fra", () => {
  const thresholdWeek = { mon: { session: "threshold", intensity: "hard" } };
  const weekPlans = [
    { id: 20, rider_id: "r-tt", days: thresholdWeek },
    { id: 21, rider_id: "r-gc2", days: thresholdWeek },
    { id: 22, rider_id: "r-punch", days: thresholdWeek },
  ];

  // Gruppe A: kun tt + gc → gruppens uge flyttes, ingen kobles fra.
  const pure = planThresholdMigration({
    weekPlans: weekPlans.slice(0, 2), ridersById: riders,
    groups: [{ id: "gA", days: thresholdWeek, updated_at: "t0" }],
    members: [
      { rider_id: "r-tt", group_id: "gA", follows_group: true },
      { rider_id: "r-gc2", group_id: "gA", follows_group: true },
    ],
  });
  assert.equal(pure.summary.groupsMigrated, 1);
  assert.equal(pure.groupUpdates[0].days.mon.session, "itt_long");
  assert.equal(pure.groupUpdates[0].updated_at, "t0");
  assert.deepEqual(pure.memberDetaches, []);

  // Gruppe B: tt + puncheur → tt kobles fra, gruppen og puncheuren urørt.
  const mixed = planThresholdMigration({
    weekPlans, ridersById: riders,
    groups: [{ id: "gB", days: thresholdWeek }],
    members: [
      { rider_id: "r-tt", group_id: "gB", team_id: "t1", follows_group: true },
      { rider_id: "r-punch", group_id: "gB", team_id: "t1", follows_group: true },
    ],
  });
  assert.deepEqual(mixed.groupUpdates, []);
  assert.deepEqual(mixed.memberDetaches, [{ rider_id: "r-tt", group_id: "gB", team_id: "t1" }]);
  assert.deepEqual(mixed.weekUpdates.map((u) => u.id), [20, 21]);

  // Allerede koblet fra, eller gruppens uge uden Tærskel → intet at gøre.
  const none = planThresholdMigration({
    weekPlans, ridersById: riders,
    groups: [{ id: "gC", days: { mon: { session: "sprint", intensity: "hard" } } }, { id: "gD", days: thresholdWeek }],
    members: [
      { rider_id: "r-tt", group_id: "gC", follows_group: true },
      { rider_id: "r-punch", group_id: "gC", follows_group: true },
      { rider_id: "r-gc2", group_id: "gD", follows_group: false },
      { rider_id: "r-punch", group_id: "gD", follows_group: true },
    ],
  });
  assert.deepEqual(none.groupUpdates, []);
  assert.deepEqual(none.memberDetaches, []);
});

// Review-fund: gruppe uden egen uge, og gentaget kørsel efter låse-konflikt.
test("gruppe uden egen uge kobler den flyttede tt/gc-rytter fra; ren gruppe findes også når følgerne allerede er flyttet", () => {
  const thresholdWeek = { mon: { session: "threshold", intensity: "hard" } };
  const seedGroup = planThresholdMigration({
    weekPlans: [{ id: 30, rider_id: "r-tt", days: thresholdWeek }], ridersById: riders,
    groups: [{ id: "gN", days: null }],
    members: [
      { rider_id: "r-punch", group_id: "gN", follows_group: true },
      { rider_id: "r-tt", group_id: "gN", follows_group: true },
    ],
  });
  assert.deepEqual(seedGroup.memberDetaches.map((d) => d.rider_id), ["r-tt"]);
  assert.deepEqual(seedGroup.groupUpdates, []);

  // Ny kørsel: følgernes rækker står allerede på itt_long, men gruppen har stadig Tærskel.
  const rerun = planThresholdMigration({
    weekPlans: [{ id: 31, rider_id: "r-tt", days: { mon: { session: "itt_long", intensity: "hard" } } }], ridersById: riders,
    groups: [{ id: "gP", days: thresholdWeek, updated_at: "t1" }],
    members: [
      { rider_id: "r-tt", group_id: "gP", follows_group: true },
      { rider_id: "r-gc2", group_id: "gP", follows_group: true },
    ],
  });
  assert.deepEqual(rerun.weekUpdates, []);
  assert.equal(rerun.groupUpdates.length, 1);
  assert.deepEqual(rerun.groupUpdates[0].followerIds, ["r-tt", "r-gc2"]);
});

test("rytter flyttet kun via training_plans kobles også fra en gruppe uden egen uge", () => {
  const out = planThresholdMigration({
    plans: [{ id: 40, rider_id: "r-gc2", focus: "threshold" }], ridersById: riders,
    groups: [{ id: "gN2", days: null }],
    members: [
      { rider_id: "r-punch", group_id: "gN2", follows_group: true },
      { rider_id: "r-gc2", group_id: "gN2", follows_group: true },
    ],
  });
  assert.deepEqual(out.memberDetaches.map((d) => d.rider_id), ["r-gc2"]);
});
