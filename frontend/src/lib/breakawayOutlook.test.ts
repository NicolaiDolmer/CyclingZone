import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outlookLine } from "./breakawayOutlook.ts";

test("outlookLine: cirka-brøk + årsag + etape", () => {
  assert.deepEqual(outlookLine({ available: true, odds: { about: [1, 4] }, chase: { kind: "manyChase" }, stageNumber: 2 }), {
    oddsKey: "racehub.hunterExplainer.outlook.about",
    oddsParams: { k: 1, n: 4 },
    reasonKey: "racehub.hunterExplainer.outlook.reason.manyChase",
    stageNumber: 2,
  });
});

test("outlookLine: under/over-formerne", () => {
  assert.equal(outlookLine({ available: true, odds: { under: [1, 10] } })?.oddsKey, "racehub.hunterExplainer.outlook.under");
  assert.equal(outlookLine({ available: true, odds: { over: [9, 10] } })?.oddsKey, "racehub.hunterExplainer.outlook.over");
});

test("outlookLine: intet tal når motoren ikke står inde for det eller formen er ukendt", () => {
  assert.equal(outlookLine(null), null);
  assert.equal(outlookLine({ available: false, reason: "old_rules" }), null);
  assert.equal(outlookLine({ available: true, odds: null }), null);
  assert.equal(outlookLine({ available: true, odds: { about: [4, 1] } }), null);
  assert.equal(outlookLine({ available: true, odds: { about: [0, 4] } }), null);
});

test("outlookLine: ukendt årsag udelades i stedet for at vise en rå nøgle", () => {
  assert.equal(outlookLine({ available: true, odds: { about: [1, 2] }, chase: { kind: "weird" } })?.reasonKey, null);
});

// Alle nøgler findes i alle 5 sprog.
for (const lng of ["en", "da", "fr", "es", "nl"]) {
  test(`outlook-nøgler findes: ${lng}`, () => {
    const races = JSON.parse(readFileSync(new URL(`../../public/locales/${lng}/races.json`, import.meta.url), "utf8"));
    const o: Record<string, any> = races.racehub.hunterExplainer.outlook;
    for (const k of ["about", "under", "over", "stage"]) assert.ok(typeof o[k] === "string" && o[k].trim(), `${lng}:${k}`);
    for (const r of ["nobodyChases", "fewChase", "manyChase"]) assert.ok(typeof o.reason[r] === "string" && o.reason[r].trim(), `${lng}:reason.${r}`);
    for (const k of ["about", "under", "over"]) {
      assert.ok(o[k].includes("{{k}}") && o[k].includes("{{n}}"), `${lng}:${k} skal bruge {{k}} og {{n}}`);
    }
  });
}
