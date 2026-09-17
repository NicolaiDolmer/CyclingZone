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
