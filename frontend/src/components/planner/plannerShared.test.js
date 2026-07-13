import { test } from "node:test";
import assert from "node:assert/strict";
import { dateToOrdinal, monthTicks, formatOrdinalShort, statusMeta, riderTypeKey, riderShortName } from "./plannerShared.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

test("dateToOrdinal: gyldig dato → heltal, ugyldig → null", () => {
  const a = dateToOrdinal("2026-07-13");
  const b = dateToOrdinal("2026-07-14");
  assert.equal(typeof a, "number");
  assert.equal(b - a, 1, "en dags forskel = ordinal +1");
  assert.equal(dateToOrdinal(null), null);
  assert.equal(dateToOrdinal("nonsense"), null);
});

test("monthTicks: ét tick pr. måned inden for intervallet med lokaliseret label", () => {
  const ticks = monthTicks(dateToOrdinal("2026-03-15"), dateToOrdinal("2026-06-10"), MONTHS);
  const labels = ticks.map((t) => t.label);
  // Apr, May, Jun ligger i intervallet (Mar 1 er før start).
  assert.deepEqual(labels, ["Apr", "May", "Jun"]);
});

test("monthTicks: tomt ved ugyldigt interval", () => {
  assert.deepEqual(monthTicks(null, null, MONTHS), []);
  assert.deepEqual(monthTicks(100, 100, MONTHS), []);
});

test("formatOrdinalShort: '12 Jun'-form", () => {
  assert.equal(formatOrdinalShort(dateToOrdinal("2026-06-12"), MONTHS), "12 Jun");
  assert.equal(formatOrdinalShort(null, MONTHS), "");
});

test("statusMeta: redundant glyf pr. status (ikke kun farve)", () => {
  assert.equal(statusMeta("on_track").glyph, "✓");
  assert.equal(statusMeta("at_risk").glyph, "↓");
  assert.equal(statusMeta("pending").glyph, "•");
  assert.equal(statusMeta("unknown").key, "pending");
});

test("riderTypeKey: kendt type → nøgle, ukendt → null", () => {
  assert.equal(riderTypeKey("climber"), "type.climber");
  assert.equal(riderTypeKey("gc"), "type.gc");
  assert.equal(riderTypeKey("wizard"), null);
});

test("riderShortName: initial + efternavn", () => {
  assert.equal(riderShortName({ firstname: "Lars", lastname: "Vermeulen" }), "L. Vermeulen");
  assert.equal(riderShortName({ lastname: "Novak" }), "Novak");
});
