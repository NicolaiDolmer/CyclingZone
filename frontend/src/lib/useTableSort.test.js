import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRows, compareValues } from "./useTableSort.js";

// Enheds-test af den delte tabel-sort-helper (useTableSort). Selve hooken er en
// tynd useState/useMemo-indpakning; al ikke-triviel adfærd bor i sortRows +
// compareValues, som testes her uden React-render (kodebasens node --test).

const rows = [
  { name: "Charlie", value: 30, age: 22 },
  { name: "alice", value: 10, age: null },
  { name: "Bob", value: 20, age: 25 },
];

test("desc sorterer numerisk faldende", () => {
  const out = sortRows(rows, (r) => r.value, "desc");
  assert.deepEqual(out.map((r) => r.value), [30, 20, 10]);
});

test("asc sorterer numerisk stigende", () => {
  const out = sortRows(rows, (r) => r.value, "asc");
  assert.deepEqual(out.map((r) => r.value), [10, 20, 30]);
});

test("strenge sorteres case-insensitivt + lokaliseret", () => {
  const out = sortRows(rows, (r) => r.name, "asc");
  assert.deepEqual(out.map((r) => r.name), ["alice", "Bob", "Charlie"]);
});

test("streng-tal kollateres numerisk, ikke leksikografisk (10 > 9)", () => {
  const data = [{ v: "9" }, { v: "10" }, { v: "1" }];
  const out = sortRows(data, (r) => r.v, "asc");
  assert.deepEqual(out.map((r) => r.v), ["1", "9", "10"]);
});

test("null/tomme værdier lander altid sidst — også i desc", () => {
  const descOut = sortRows(rows, (r) => r.age, "desc");
  assert.equal(descOut[descOut.length - 1].name, "alice", "null-age skal ligge sidst i desc");
  const ascOut = sortRows(rows, (r) => r.age, "asc");
  assert.equal(ascOut[ascOut.length - 1].name, "alice", "null-age skal ligge sidst i asc");
});

test("muterer ikke input-arrayet", () => {
  const original = [...rows];
  sortRows(rows, (r) => r.value, "desc");
  assert.deepEqual(rows, original, "sortRows skal returnere en kopi");
});

test("sortering er stabil ved lige værdier", () => {
  const data = [
    { id: "a", k: 1 },
    { id: "b", k: 1 },
    { id: "c", k: 1 },
  ];
  const out = sortRows(data, (r) => r.k, "desc");
  assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"], "lige nøgler beholder input-rækkefølge");
});

test("manglende/ugyldig accessor → uændret rækkefølge", () => {
  assert.deepEqual(sortRows(rows, null, "desc"), rows);
  assert.deepEqual(sortRows(rows, undefined, "asc"), rows);
});

test("compareValues: tal før streng-fallback", () => {
  assert.ok(compareValues(2, 10) < 0, "2 < 10 numerisk");
  assert.ok(compareValues("b", "a") > 0, "b > a");
  assert.equal(compareValues(null, null), 0);
  assert.ok(compareValues(null, 5) > 0, "null sorteres efter tal");
});
