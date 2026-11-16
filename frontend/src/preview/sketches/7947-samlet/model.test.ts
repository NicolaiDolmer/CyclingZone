import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS_PER_DATE, applyWholeDay, dayChoice, openCount, overviewCounts, setField, trainNow, type Field,
} from "./model.ts";

const stage: Field = { kind: "stage", label: "Etape 3" };
const day = (): Field[] => [
  { kind: "train", session: "tempo", changed: false },
  { kind: "train", session: "tempo", changed: false },
  stage,
  { kind: "train", session: "tempo", changed: false },
  { kind: "train", session: "tempo", changed: false },
];

test("en dato har fem felter", () => {
  assert.equal(day().length, FIELDS_PER_DATE);
});

test("hele dagen saetter kun de aabne felter; etapen beholder sit felt", () => {
  const next = applyWholeDay(day(), "rest");
  assert.deepEqual(next[2], stage);
  assert.equal(openCount(next), 4);
  assert.ok(next.filter((f) => f.kind === "train").every((f) => f.kind === "train" && f.session === "rest"));
});

test("et rettet felt er markeret som aendret, og dagens valg er stadig flertallet", () => {
  const next = setField(day(), 4, "sprint");
  assert.deepEqual(next[4], { kind: "train", session: "sprint", changed: true });
  assert.equal(dayChoice(next), "tempo");
});

test("et etapefelt kan ikke rettes", () => {
  assert.deepEqual(setField(day(), 2, "sprint")[2], stage);
});

test("traen nu koerer de aabne felter og laaser dem; etapen venter paa loebet", () => {
  const next = trainNow(day());
  assert.equal(openCount(next), 0);
  assert.deepEqual(next[2], stage);
  assert.equal(dayChoice(next), null);
});

test("overblikket taeller loeb, traening, traette og manglende plan", () => {
  const counts = overviewCounts([
    { fields: day(), hasPlan: true, tired: false },
    { fields: applyWholeDay(day(), "rest"), hasPlan: false, tired: true },
  ]);
  assert.deepEqual(counts, { needsPlan: 1, racing: 2, training: 1, tired: 1 });
});
