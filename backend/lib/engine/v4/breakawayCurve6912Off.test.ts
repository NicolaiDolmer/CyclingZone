// #6912 (forspringskurven, SLUKKET): kontakten slukket er bit-identisk for alle revisioner.
// De frosne digests (test-data/breakawayCurve6912OffDigests.json) er skrevet fra merge-basen
// foer kurven og daekker det de andre frosne filer ikke daekker (testUtils/breakawayCurve6912OffDigests.ts).
// s5_profiles_v3 flad/rullende med kontakten slukket: flatChase6912Regression.test.ts (curveOffV3).
// Hashes indeholder ingen balance-tal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURVE_6912_OFF_COMPUTE, computeCurve6912Off, type Curve6912OffKey } from "./testUtils/breakawayCurve6912OffDigests.ts";

const expected = JSON.parse(readFileSync(new URL("./test-data/breakawayCurve6912OffDigests.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("#6912: fixturen daekker praecis de frosne noegler", () => {
  assert.deepEqual(Object.keys(expected).filter((k) => k !== "sourceCommit" && k !== "note"), Object.keys(CURVE_6912_OFF_COMPUTE));
});

for (const key of Object.keys(CURVE_6912_OFF_COMPUTE) as Curve6912OffKey[]) {
  test(`#6912: kurven slukket, ${key} er bit-identisk med foer kurven`, () => {
    assert.deepEqual(computeCurve6912Off(key), expected[key]);
  });
}
