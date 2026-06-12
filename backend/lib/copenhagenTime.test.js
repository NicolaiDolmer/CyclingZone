import test from "node:test";
import assert from "node:assert/strict";
import { copenhagenDateString, copenhagenHour } from "./copenhagenTime.js";

test("UTC-aften om sommeren ruller til ny dansk dato (CEST, +2)", () => {
  // 2026-06-11T22:30Z = 2026-06-12 00:30 CEST
  assert.equal(copenhagenDateString(new Date("2026-06-11T22:30:00Z")), "2026-06-12");
  assert.equal(copenhagenHour(new Date("2026-06-11T22:30:00Z")), 0);
});

test("vinter (CET, +1)", () => {
  // 2026-01-15T23:30Z = 2026-01-16 00:30 CET
  assert.equal(copenhagenDateString(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
});

test("midt på dagen", () => {
  assert.equal(copenhagenDateString(new Date("2026-06-11T10:00:00Z")), "2026-06-11");
  assert.equal(copenhagenHour(new Date("2026-06-11T10:00:00Z")), 12);
});

test("default-argument er nu", () => {
  assert.match(copenhagenDateString(), /^\d{4}-\d{2}-\d{2}$/);
  const h = copenhagenHour();
  assert.ok(h >= 0 && h <= 23);
});
