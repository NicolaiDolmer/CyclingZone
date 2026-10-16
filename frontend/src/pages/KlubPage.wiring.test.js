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

test("KlubPage grupperer live faciliteter før coming-soon (#1441 Slice 1)", () => {
  assert.match(src, /groupedFacilities/);
  assert.match(src, /filter\(\(f\) => f\.effectLive\)/);
  assert.match(src, /filter\(\(f\) => !f\.effectLive\)/);
});

// #6666 retning D: opsummering øverst (drift, løn, saldo) erstatter introtekst +
// sæson-sætning; kort-gitter 1→3 kolonner; ét guld-kort = billigste opgradering.
test("KlubPage viser opsummering (drift/løn/saldo) og ingen introtekst", () => {
  assert.match(src, /summary\.upkeep/);
  assert.match(src, /summary\.wages/);
  assert.match(src, /summary\.balance/);
  assert.ok(!/page\.intro/.test(src), "introteksten er væk (TASTE: ingen intro mellem sidehoved og indhold)");
});

test("KlubPage: kort i et gitter (1 kolonne på telefon, 3 på desktop) og ét guld-kort", () => {
  assert.match(src, /grid-cols-1 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(src, /primaryUpgradeTrack\(groupedFacilities\)/);
  assert.match(src, /primary=\{f\.track === primaryTrack\}/);
});
