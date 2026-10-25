import test from "node:test";
import assert from "node:assert/strict";
import { assistantKindFor, daysOverLimit } from "./TrainingTeamTableBModel.ts";

test("assistent: forslag giver Use, ellers Agrees", () => {
  assert.equal(assistantKindFor({ noDay: false, suggested: true, decided: true }), "use");
  assert.equal(assistantKindFor({ noDay: false, suggested: false, decided: true }), "agrees");
});

test("assistent: ingen dag viser det eksisterende dag-valg, ikke Agrees", () => {
  assert.equal(assistantKindFor({ noDay: true, suggested: false, decided: true }), "noDay");
});

test("assistent: efter Train now paastaar kolonnen intet", () => {
  assert.equal(assistantKindFor({ noDay: false, suggested: true, decided: false }), "none");
  assert.equal(assistantKindFor({ noDay: false, suggested: false, decided: false }), "none");
});

test("Dage 70+: manglende felt = null, manglende rytter = 0, tal passerer", () => {
  assert.equal(daysOverLimit(null, "a"), null);
  assert.equal(daysOverLimit(undefined, "a"), null);
  assert.equal(daysOverLimit({}, "a"), 0);
  assert.equal(daysOverLimit({ a: 4 }, "a"), 4);
  assert.equal(daysOverLimit({ a: -1 }, "a"), 0);
});
