import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDateRange } from "./backfill-growth-snapshots.js";

test("buildDateRange: inklusivt interval, én dato pr. dag", () => {
  const dates = buildDateRange("2026-07-30", "2026-08-02");
  assert.deepEqual(dates, ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
});

test("buildDateRange: samme from/to -> ét element", () => {
  assert.deepEqual(buildDateRange("2026-08-03", "2026-08-03"), ["2026-08-03"]);
});

test("buildDateRange: from efter to -> tomt array", () => {
  assert.deepEqual(buildDateRange("2026-08-05", "2026-08-01"), []);
});

test("buildDateRange: krydser månedsskifte korrekt", () => {
  const dates = buildDateRange("2026-01-30", "2026-02-02");
  assert.deepEqual(dates, ["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
});
