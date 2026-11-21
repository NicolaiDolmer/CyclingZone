// #7947 retning 5: skitsens model. Koeres med node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayEffort, dayLoad, DAY_LOAD_ARROW, effortOf, fatigueStep, fillRotation } from "./r5model.ts";
import type { Session } from "./model.ts";

test("aktiv restitution er Rest, lang tur er Easy, tempo Medium", () => {
  assert.equal(effortOf("recovery"), "rest");
  assert.equal(effortOf("endurance"), "easy");
  assert.equal(effortOf("tempo"), "medium");
  assert.equal(effortOf("sprint"), "hard");
  assert.equal(dayEffort(["endurance", "tempo", "recovery"]), "medium");
});

test("Day load: fem ord, og meget haard dag har sin egen pil", () => {
  assert.equal(dayLoad(["rest", "rest", "rest", "rest", "rest"]), "easy");
  assert.equal(dayLoad(["sprint", "sprint", "stage", "threshold", "vo2max"]), "veryHard");
  assert.equal(DAY_LOAD_ARROW.easy, "up");
  assert.equal(DAY_LOAD_ARROW.veryHard, "downMuch");
});

test("traethedens skala har fire trin og stiger med tallet", () => {
  assert.deepEqual([10, 45, 60, 80].map(fatigueStep), [0, 1, 2, 3]);
});

test("rotationen venter ved loeb og hviledag, intet pas springes over", () => {
  const rotation: Session[] = ["tempo", "sprint", "endurance"];
  const blocked = [
    [null, "race", null],
    ["restDay", "restDay", "restDay"],
    [null, null, null],
  ] as const;
  const r = fillRotation(rotation, 2, blocked, () => "Stage 3");
  const numbers = r.week.flat().flatMap((c) => (c.kind === "session" ? [c.n] : []));
  assert.deepEqual(numbers, [2, 3, 1, 2, 3]);
  assert.equal(r.ridden, 5);
  assert.equal(r.carried, 4);
  assert.equal(r.nextStart, 1);
});
