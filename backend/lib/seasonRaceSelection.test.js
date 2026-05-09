import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSeasonRaces,
  selectFirstSeasonRaces,
  DEFAULT_RACE_DAYS_TARGET,
} from "./seasonRaceSelection.js";

function makeRace({ name, race_class, race_type = "single", stages = 1 }) {
  return { name, race_class, race_type, stages };
}

test("selectSeasonRaces — vælger løb indtil race_days_target nås", () => {
  const pool = Array.from({ length: 50 }, (_, i) =>
    makeRace({ name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const result = selectSeasonRaces({ pool, raceDaysTarget: 30 });
  assert.equal(result.totalRaceDays, 30);
  assert.equal(result.selectedCount, 30);
  assert.equal(result.omitted.length, 20);
  assert.ok(result.omitted.every((o) => o.reason === "target_reached"));
});

test("selectSeasonRaces — sæson 1 ekskluderer alle WT-klasser via excludeClasses", () => {
  const pool = [
    makeRace({ name: "Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 }),
    makeRace({ name: "Sanremo", race_class: "Monuments", stages: 1 }),
    makeRace({ name: "Burgos", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Surf Coast", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectFirstSeasonRaces(pool, { raceDaysTarget: 60 });
  assert.ok(result.selected.every((r) => r.race_class === "ProSeries"));
  assert.equal(result.selected.length, 2);
  assert.equal(result.totalRaceDays, 6);
});

test("selectSeasonRaces — overshootTolerance forhindrer at stort etapeløb skubber over", () => {
  const pool = [
    makeRace({ name: "Big", race_class: "ProSeries", race_type: "stage_race", stages: 21 }),
    makeRace({ name: "Small", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 5,
    overshootTolerance: 2,
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "Small");
  assert.equal(result.totalRaceDays, 1);
  assert.equal(result.omitted[0].reason, "would_overshoot");
});

test("selectSeasonRaces — er deterministisk (samme input → samme output)", () => {
  const pool = [
    makeRace({ name: "Beta", race_class: "ProSeries", stages: 3 }),
    makeRace({ name: "Alpha", race_class: "ProSeries", stages: 2 }),
    makeRace({ name: "Gamma", race_class: "ProSeries", stages: 4 }),
  ];
  const a = selectSeasonRaces({ pool, raceDaysTarget: 100 });
  const b = selectSeasonRaces({ pool, raceDaysTarget: 100 });
  assert.deepEqual(
    a.selected.map((r) => r.name),
    b.selected.map((r) => r.name),
  );
});

test("selectSeasonRaces — tom pool returnerer tom liste", () => {
  const result = selectSeasonRaces({ pool: [], raceDaysTarget: 60 });
  assert.equal(result.selectedCount, 0);
  assert.equal(result.totalRaceDays, 0);
});

test("selectSeasonRaces — includeClasses begrænser kandidater", () => {
  const pool = [
    makeRace({ name: "A", race_class: "ProSeries", stages: 1 }),
    makeRace({ name: "B", race_class: "Class1", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    includeClasses: ["ProSeries"],
    raceDaysTarget: 60,
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "A");
});

test("selectSeasonRaces — DEFAULT_RACE_DAYS_TARGET = 60 (matcher seasons.race_days_total)", () => {
  assert.equal(DEFAULT_RACE_DAYS_TARGET, 60);
});

test("selectFirstSeasonRaces — accepterer override af raceDaysTarget", () => {
  const pool = Array.from({ length: 100 }, (_, i) =>
    makeRace({ name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const result = selectFirstSeasonRaces(pool, { raceDaysTarget: 30 });
  assert.equal(result.totalRaceDays, 30);
});
