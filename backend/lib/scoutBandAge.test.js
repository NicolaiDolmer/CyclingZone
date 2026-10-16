import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scoutBandAge } from "./scoutBandAge.js";
import { ageForSeason, LAUNCH_REFERENCE_YEAR } from "./riderSeasonAge.js";

test("scoutBandAge: soeson-drevet, ikke wall-clock", () => {
  assert.equal(scoutBandAge("2001-03-01", 1), LAUNCH_REFERENCE_YEAR - 2001);
  assert.equal(scoutBandAge("2001-03-01", 3), LAUNCH_REFERENCE_YEAR + 2 - 2001);
  assert.equal(scoutBandAge("2001-03-01", 3), ageForSeason("2001-03-01", 3));
});

test("scoutBandAge: 1. januar er tidszone-uafhaengig", () => {
  assert.equal(scoutBandAge("2001-01-01", 1), LAUNCH_REFERENCE_YEAR - 2001);
});

test("scoutBandAge: manglende input giver null", () => {
  assert.equal(scoutBandAge(null, 1), null);
  assert.equal(scoutBandAge(undefined, 1), null);
  assert.equal(scoutBandAge("2001-03-01", NaN), null);
});

test("development-projection bruger scoutBandAge, ikke kalenderaar", () => {
  const api = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "routes", "api.js"), "utf8");
  const start = api.indexOf('"/riders/:id/development-projection"');
  assert.ok(start > 0);
  const block = api.slice(start, start + 3500);
  assert.match(block, /scoutBandAge\(/);
  assert.doesNotMatch(block, /new Date\(\)\.getFullYear\(\)/);
});
