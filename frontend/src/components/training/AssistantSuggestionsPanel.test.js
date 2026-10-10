import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-string-guard for #4699 (samme mønster som TrainingPage.wiring.test.js).
// Panelets accept-flade skal spejle serverens kontrakt: smart-bulk skriver
// ALDRIG en rytter der allerede har managerens eget fokus (§9.3 i
// docs/ASSISTANT_RULES.md). Før fixet havde hver række en aktiv checkbox og
// "Accept all" var aktiv uanset hvad, så et fuldt planlagt hold kunne trykke og
// få "Updated 0 riders" tilbage - rapporteret som "kan slet ikke anvendes".
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "AssistantSuggestionsPanel.jsx"), "utf8");

test("#4699 en række med managerens egen plan kan ikke markeres", () => {
  assert.match(src, /disabled=\{busy \|\| row\.hasPlan\}/,
    "checkboxen skal være slået fra for en rytter accept-stien springer over");
  assert.match(src, /t\("assistantSuggestions\.yourPlanMarker"\)/,
    "rækken skal sige HVORFOR den ikke kan accepteres");
});

test("#4699 'Accept all' er slået fra når der ikke er noget acceptabelt", () => {
  assert.match(src, /disabled=\{busy \|\| acceptableCount === 0\}/,
    "knappen skal gates på det acceptable antal, ikke på visningens længde");
  assert.doesNotMatch(src, /disabled=\{busy \|\| visibleRows\.length === 0\}/,
    "den gamle gate på visningens længde må ikke være tilbage");
  assert.match(src, /t\("assistantSuggestions\.acceptAll", \{ n: acceptableCount \}\)/,
    "labellen skal vise hvor mange den faktisk anvender");
});

test("#4699 panelet forklarer et fuldt planlagt hold hvorfor der intet er at acceptere", () => {
  assert.match(src, /visibleRows\.length > 0 && acceptableCount === 0/);
  assert.match(src, /t\("assistantSuggestions\.allHavePlanNote"\)/);
});

test("#4699 acceptableCount er en prop, ikke en gen-udledning i visningen", () => {
  assert.match(src, /^\s*acceptableCount,$/m,
    "panelet er ren visning: det acceptable sæt udledes i lib/assistantTrainingSuggestions.js");
  assert.doesNotMatch(src, /visibleRows\.filter\(/,
    "panelet må ikke bygge sin egen parallelle acceptabel-regel");
});

// #4522: programsektionen pr. rytter-gruppe er ren visning; afledningen bor i
// lib/assistantProgramSuggestions.ts og skrivningen i serverens keepOwn-sti.
test("#4522 programsektionen vises kun med grupper og har ingen egen afledning", () => {
  assert.match(src, /programGroups\.length > 0 &&/, "ingen grupper = ingen sektion");
  assert.match(src, /^\s*programGroups = \[\],$/m, "gruppelisten er en prop, ikke udledt i panelet");
  assert.doesNotMatch(src, /buildProgramSuggestionGroups|primary_type/,
    "panelet bygger ikke sine egne grupper");
});

test("#4522 intet anvendes foer klik: hver gruppe har en knap der kalder handleren, slaaet fra mens der arbejdes", () => {
  assert.match(src, /disabled=\{busy \|\| programBusy\}/);
  assert.match(src, /onClick=\{\(\) => onApplyProgramGroup\?\.\(group\)\}/);
  assert.match(src, /t\("assistantSuggestions\.programApply", \{ n: group\.riderIds\.length \}\)/);
});

test("#4522 programsektionen tilfoejer ingen ekstra primaer knap", () => {
  const section = src.slice(src.indexOf('data-testid="assistant-program-section"'), src.indexOf("{programMessage &&"));
  assert.doesNotMatch(section, /variant="primary"/);
});
