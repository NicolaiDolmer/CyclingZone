// #8725 · Kontakten sentence_case_8725 og kittets `sentence:`-klasse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSentenceCaseOn, applySentenceCase, SENTENCE_CASE_ATTR, SENTENCE_CASE_FLAG_KEY } from "./sentenceCaseFlag.ts";
import { SENTENCE_CASE } from "../components/ui/sentenceCase.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), "utf8");

test("beta og on taender; off, ukendt og manglende svar er off (fail-safe)", () => {
  assert.equal(isSentenceCaseOn("beta"), true);
  assert.equal(isSentenceCaseOn("on"), true);
  assert.equal(isSentenceCaseOn("off"), false);
  assert.equal(isSentenceCaseOn("true"), false);
  assert.equal(isSentenceCaseOn(undefined), false);
  assert.equal(isSentenceCaseOn(null), false);
});

test("noeglen er den samme som backendens katalog", () => {
  assert.equal(SENTENCE_CASE_FLAG_KEY, "sentence_case_8725");
  assert.match(read("../../../backend/lib/stageFlagCatalog.js"), /"sentence_case_8725"/);
});

test("applySentenceCase saetter og fjerner attributten paa roden", () => {
  const attrs = new Map<string, string>();
  const root = {
    setAttribute: (k: string, v: string) => { attrs.set(k, v); },
    removeAttribute: (k: string) => { attrs.delete(k); },
  } as unknown as Element;
  applySentenceCase(true, root);
  assert.equal(attrs.has(SENTENCE_CASE_ATTR), true);
  applySentenceCase(false, root);
  assert.equal(attrs.has(SENTENCE_CASE_ATTR), false);
  assert.doesNotThrow(() => applySentenceCase(true, null));
});

test("index.css definerer sentence:-varianten paa samme attribut", () => {
  const css = read("../index.css");
  assert.match(css, /@custom-variant sentence \(&:is\(\[data-sentence-case\] \*\)\);/);
  assert.equal(SENTENCE_CASE, "sentence:normal-case sentence:tracking-normal");
});

// Kittet beholder sin versal-opskrift (slukket = samme pixels), men hver lille
// label skal baere SENTENCE_CASE, saa kontakten rammer dem alle.
const KIT = [
  "../components/ui/dataTableStyles.js",
  "../components/ui/DataTable.jsx",
  "../components/ui/HeroStats.jsx",
  "../components/ui/Section.jsx",
  "../components/ui/CollapsibleSection.jsx",
  "../components/ui/Divider.jsx",
  "../components/ui/chipStyles.js",
  "../components/ui/badgeStyles.js",
  "../components/ui/fieldStyles.js",
  "../components/ui/tableStyles.js",
  "../components/ui/RiderHoverCard.tsx",
  "../components/Layout.jsx",
];

// #8816: rytterprofilens egne små labels ("Aktiv auktion", "Højeste bud",
// "Naturlig rolle" …) følger samme kontakt. Display-fonten (navnet) er undtaget.
const PROFILE = [
  "../pages/RiderStatsPage.jsx",
  "../components/rider/RiderTypeBadge.jsx",
  "../components/rider/PotentialEstimate.tsx",
  "../components/rider/profile/RiderAbilityHistoryPro.jsx",
  "../components/rider/profile/RiderDevelopmentTab.jsx",
  "../components/rider/profile/RiderHistoryTab.jsx",
  "../components/rider/profile/RiderInterestTab.jsx",
  "../components/rider/profile/RiderPalmaresTab.jsx",
  "../components/rider/profile/RiderPhysiologyTab.jsx",
  "../components/rider/profile/RiderProfileHero.jsx",
  "../components/rider/profile/RiderResultsTab.jsx",
  "../components/rider/profile/RiderScoutingTab.jsx",
  "../components/rider/profile/RiderSwitcherBar.jsx",
  "../components/rider/profile/RiderTrainingScoreCard.tsx",
  "../components/rider/profile/RiderTrainingTab.jsx",
  "../components/rider/profile/RiderTypeRadar.jsx",
];

for (const rel of PROFILE) {
  test(`${rel.split("/").pop()}: rytterprofilens versal-labels baerer SENTENCE_CASE`, () => {
    const lines = read(rel).split("\n").filter((l) => /\buppercase\b/.test(l) && !l.trim().startsWith("//") && !l.includes("font-display") && /className=|= "|= `/.test(l));
    assert.ok(lines.length > 0, "forventede mindst én versal-label");
    for (const line of lines) {
      assert.match(line, /\$\{SENTENCE_CASE\}/, `mangler SENTENCE_CASE: ${line.trim()}`);
    }
  });
}

for (const rel of KIT) {
  test(`${rel.split("/").pop()}: hver uppercase-label baerer SENTENCE_CASE`, () => {
    const src = read(rel);
    const lines = src.split("\n").filter((l) => /\buppercase\b/.test(l) && !l.trim().startsWith("//") && !l.includes("uppercase pille") && /class|"|`/.test(l));
    assert.ok(lines.length > 0, "forventede mindst én versal-label");
    for (const line of lines) {
      assert.match(line, /\$\{SENTENCE_CASE\}/, `mangler SENTENCE_CASE: ${line.trim()}`);
    }
  });
}
