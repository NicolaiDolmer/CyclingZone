import { test } from "node:test";
import assert from "node:assert/strict";
import { getBestId } from "./compareStats.js";

test("getBestId — uafgjort (samme værdi) fremhæver ingen (#5316)", () => {
  const riders = [
    { id: "a", rating: 80 },
    { id: "b", rating: 80 },
  ];
  assert.equal(getBestId(riders, "rating"), null);
});

test("getBestId — a > b fremhæver a", () => {
  const riders = [
    { id: "a", rating: 85 },
    { id: "b", rating: 80 },
  ];
  assert.equal(getBestId(riders, "rating"), "a");
});

test("getBestId — a < b fremhæver b", () => {
  const riders = [
    { id: "a", rating: 70 },
    { id: "b", rating: 80 },
  ];
  assert.equal(getBestId(riders, "rating"), "b");
});

test("getBestId — lavere er bedst: laveste værdi fremhæves", () => {
  const riders = [
    { id: "a", salary: 5000 },
    { id: "b", salary: 3000 },
  ];
  assert.equal(getBestId(riders, "salary", { higherIsBetter: false }), "b");
});

test("getBestId — lavere er bedst + uafgjort fremhæver ingen", () => {
  const riders = [
    { id: "a", salary: 4000 },
    { id: "b", salary: 4000 },
  ];
  assert.equal(getBestId(riders, "salary", { higherIsBetter: false }), null);
});

test("getBestId — tre sammenlignede, uafgjort mellem to bedste fremhæver ingen", () => {
  const riders = [
    { id: "a", value: 100 },
    { id: "b", value: 100 },
    { id: "c", value: 50 },
  ];
  assert.equal(getBestId(riders, "value"), null);
});

test("getBestId — manglende felt behandles som 0", () => {
  const riders = [
    { id: "a" },
    { id: "b", age: 5 },
  ];
  assert.equal(getBestId(riders, "age"), "b");
});

test("getBestId — under 2 sammenlignede giver ingen vinder", () => {
  assert.equal(getBestId([{ id: "a", rating: 80 }], "rating"), null);
  assert.equal(getBestId([], "rating"), null);
});
