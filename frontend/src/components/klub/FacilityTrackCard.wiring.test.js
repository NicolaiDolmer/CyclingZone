import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-string-guard for FacilityTrackCards to-variant-wiring (#1441 Slice 1):
// spejler KlubPage.wiring.test.js-stilen (ingen jsdom i repoet). Beviser at den
// låste teaser-variant ikke kan købes og at live-variant bruger ROI-copy.
const src = readFileSync(new URL("./FacilityTrackCard.jsx", import.meta.url), "utf8");

test("FacilityTrackCard forgrener på effectLive med tidlig locked-return", () => {
  assert.match(src, /if \(!effectLive\)/);
  const returnIdx = src.indexOf("if (!effectLive)");
  const maxedIdx = src.indexOf("const maxed");
  assert.ok(returnIdx > -1 && maxedIdx > returnIdx, "locked-return skal komme før live-variantens const maxed");
});

test("locked teaser-variant: Coming soon + soon-copy, INGEN upgrade-Button", () => {
  const lockedBlock = src.slice(src.indexOf("if (!effectLive)"), src.indexOf("const maxed"));
  assert.match(lockedBlock, /facilities\.comingSoon/);
  assert.match(lockedBlock, /tracks\.\$\{track\}\.soon/);
  assert.ok(!/<Button/.test(lockedBlock), "locked-variant må ikke rendre <Button> (køb er låst)");
  assert.ok(!/onUpgrade/.test(lockedBlock), "locked-variant må ikke wire onUpgrade");
});

test("live-variant: ROI-copy (klartekst) + upgrade-Button + staff", () => {
  const liveBlock = src.slice(src.indexOf("const maxed"));
  assert.match(liveBlock, /roi\.\$\{track\}Build/);
  assert.match(liveBlock, /roi\.\$\{track\}/);
  assert.match(liveBlock, /<Button/);
  assert.match(liveBlock, /onUpgrade\(track\)/);
});
