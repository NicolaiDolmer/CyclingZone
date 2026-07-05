import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-string-guard for KlubPage-wiringen (spejler TrainingPage.wiring.test.js):
// læs kildefilen som tekst og assertér på nøgle-wiring, så vi fanger regression
// uden jsdom. Hooken er konsolideret til ét `facs`-objekt (kendt bug rettet), så
// enabled-gaten læses som `facs.enabled`.
const src = readFileSync(new URL("./KlubPage.jsx", import.meta.url), "utf8");

test("KlubPage bruger useFacilities + gater på enabled", () => {
  assert.match(src, /useFacilities\(\)/);
  assert.match(src, /if \(!facs\.enabled\)/);
  assert.match(src, /EmptyState/);
});

test("KlubPage kalder useFacilities præcis én gang (kendt bug rettet)", () => {
  const calls = src.match(/useFacilities\(\)/g) || [];
  assert.equal(calls.length, 1);
});

test("KlubPage rendrer sporene i TRACK_ORDER og staff-panelet", () => {
  assert.match(src, /TRACK_ORDER/);
  assert.match(src, /FacilityTrackCard/);
  assert.match(src, /StaffPanel/);
});

test("KlubPage bruger klub-namespace", () => {
  assert.match(src, /useTranslation\("klub"\)/);
});
