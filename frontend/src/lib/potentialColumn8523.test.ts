import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prognosisViewOf, prognosisViewValue } from "./potentialEstimateDisplay.ts";

// #8523 (ejer 20/11): navn + undertitel, "Potentiale 74 · Rimelig", "ca. 74 · Usikker" afdæmpet,
// egen Potentiale-kolonne efter Rating i trup-listen, prognosen i trup-listen og Udvikling-fanen.
// node --test har ingen DOM, så formen holdes af kilde-guards (samme mønster som unscoutedAndLoft.7932).

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", rel), "utf8");
const locales = join(here, "..", "..", "public", "locales");

const estimate = src("components/rider/PotentialEstimate.tsx");
const teamPage = src("pages/TeamPage.jsx");
const devTab = src("components/TeamDevelopmentTab.jsx");

test("prognosen som sorteringsværdi: tom tilstand giver null, så den falder sidst", () => {
  assert.equal(prognosisViewValue(prognosisViewOf({ prognosisView: { hidden: false, value: 66 } })), 66);
  assert.equal(prognosisViewValue(prognosisViewOf({ prognosisView: { hidden: true, reason: "pastPeak" } })), null);
  assert.equal(prognosisViewValue(null), null);
});

test("Usikker viser 'ca.' og afdæmpet tal, og ordet står efter en prik", () => {
  assert.match(estimate, /unsure \? "text-cz-3" : "text-cz-1"/);
  assert.match(estimate, /potentialNumber\.approx/);
  assert.match(estimate, /aria-hidden="true" className="text-cz-3">·<\/span>/);
});

test("undertitlen 'spejderens skøn' hører til navnet Potentiale", () => {
  assert.match(estimate, /export function PotentialLabel/);
  assert.match(estimate, /potentialNumber\.potentialSubtitle/);
});

test("trup-listen: Potentiale står lige efter Rating med tændt flag, og Prognose følger", () => {
  assert.match(teamPage, /ratingColumn,\s*\.\.\.\(estimateOn \? \[potentialColumn, \.\.\.\(prognosisOn \? \[prognosisColumn\] : \[\]\)\] : \[\]\),\s*typeColumn,/);
  assert.match(teamPage, /\.\.\.\(estimateOn \? \[\] : \[potentialColumn\]\)/, "slukket: kolonnen står uændret efter alder");
  assert.match(teamPage, /sortKey: "_scoutMid"/);
  assert.match(teamPage, /sortKey: "_progValue"/);
});

test("Udvikling-fanen: Prognose-kolonne kun med tændt flag, sorterbar", () => {
  assert.match(devTab, /prognosisMode = estimateMode && decorated\.some/);
  assert.match(devTab, /sortKey: "_prognosisValue"/);
});

test("de nye tekster findes på alle fem sprog og slår ikke et tal op i selve teksten", () => {
  for (const lng of ["da", "en", "es", "fr", "nl"]) {
    const riders = JSON.parse(readFileSync(join(locales, lng, "riders.json"), "utf8"));
    for (const key of ["potentialSubtitle", "potentialTitle", "approx"]) {
      assert.ok(riders.potentialNumber?.[key], `${lng}: potentialNumber.${key}`);
    }
    assert.match(riders.potentialNumber.approx, /\{value\}/, `${lng}: approx tager tallet som variabel`);
    const help = JSON.parse(readFileSync(join(locales, lng, "help.json"), "utf8"));
    const entry = JSON.stringify(help).match(/"potentialBestRoleEstimate":\{"title":"[^"]*","text":"([^"]*)"/);
    assert.ok(entry, `${lng}: hjælpeteksten findes`);
  }
});
