import { test } from "node:test";
import assert from "node:assert/strict";
import { showsDnfStagePrefix, showsStageCount } from "./raceTypeLabels.ts";

test("#7566: kun etapeløb viser antal etaper ved typemærket", () => {
  assert.equal(showsStageCount("stage_race"), true);
  assert.equal(showsStageCount("single"), false);
  assert.equal(showsStageCount(null), false);
});

test("#7566: 'Etape N' foran en udgået rytter kun i samlet visning af et etapeløb", () => {
  assert.equal(showsDnfStagePrefix("overall", "stage_race"), true);
  assert.equal(showsDnfStagePrefix("stage", "stage_race"), false);
  assert.equal(showsDnfStagePrefix("overall", "single"), false);
  assert.equal(showsDnfStagePrefix("overall", undefined), false);
});
