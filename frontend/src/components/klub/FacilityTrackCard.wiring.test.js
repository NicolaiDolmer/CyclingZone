import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-string-guard for FacilityTrackCards to-variant-wiring (#1441 Slice 1,
// omskrevet til retning D i #6666): spejler KlubPage.wiring.test.js-stilen (ingen
// jsdom i repoet). Beviser at det låste "kommer snart"-kort ikke kan købes, at
// live-kortet viser trappen og at kun det udpegede kort får den gyldne knap.
const src = readFileSync(new URL("./FacilityTrackCard.tsx", import.meta.url), "utf8");
const stair = readFileSync(new URL("./TierStair.tsx", import.meta.url), "utf8");

test("FacilityTrackCard forgrener på effectLive med tidlig locked-return", () => {
  assert.match(src, /if \(!effectLive\)/);
  const returnIdx = src.indexOf("if (!effectLive)");
  const maxedIdx = src.indexOf("const maxed");
  assert.ok(returnIdx > -1 && maxedIdx > returnIdx, "locked-return skal komme før live-variantens const maxed");
});

test("kommer snart-kort: stiplet + teaser-sætning, INGEN knap/trappe/køb", () => {
  const lockedBlock = src.slice(src.indexOf("if (!effectLive)"), src.indexOf("const maxed"));
  assert.match(lockedBlock, /facilities\.comingSoon/);
  assert.match(lockedBlock, /tracks\.\$\{track\}\.teaser/);
  assert.match(lockedBlock, /border-dashed/);
  assert.ok(!/<Button/.test(lockedBlock), "locked-variant må ikke rendre <Button> (køb er låst)");
  assert.ok(!/onUpgrade/.test(lockedBlock), "locked-variant må ikke wire onUpgrade");
  assert.ok(!/TierStair/.test(lockedBlock), "locked-variant viser ingen trappe");
});

test("live-kort: stort effekt-tal, trappe, drift ved næste niveau + knap", () => {
  const liveBlock = src.slice(src.indexOf("const maxed"));
  assert.match(liveBlock, /roi\.\$\{track\}Build/);
  assert.match(liveBlock, /<TierStair facility=\{facility\}/);
  assert.match(liveBlock, /facilities\.upkeepAt/);
  assert.match(liveBlock, /<Button/);
  assert.match(liveBlock, /onUpgrade\(track\)/);
});

test("kun det udpegede kort er guld: variant følger `primary`, ellers secondary", () => {
  assert.match(src, /variant=\{primary \? "primary" : "secondary"\}/);
  assert.ok(!/variant="primary"/.test(src), "ingen hårdkodet guld-knap i kortet");
});

test("TierStair: trappen scroller i kortet og markerer nuværende niveau", () => {
  assert.match(stair, /overflow-x-auto/);
  assert.match(stair, /aria-current=\{state === "current" \? "step" : undefined\}/);
  // Pris kun for niveauer man ikke ejer endnu.
  assert.match(stair, /state === "next" \|\| state === "future"/);
});

test("#6936 drift-linjen skjules når facilitets-upkeep er fjernet (showUpkeep)", () => {
  assert.match(src, /showUpkeep = true/, "default viser drift som før");
  assert.match(src, /\{showUpkeep && \(/, "drift-linjen rendres kun med showUpkeep");
  const page = readFileSync(new URL("../../pages/KlubPage.jsx", import.meta.url), "utf8");
  assert.match(page, /upkeepCharged !== false/, "Klub-siden følger backendens upkeepCharged");
  assert.match(page, /showUpkeep=\{showUpkeep\}/);
  assert.match(page, /\.\.\.\(showUpkeep \? \[\["summary\.upkeep"/, "opsummeringens drift-tal skjules også");
});
