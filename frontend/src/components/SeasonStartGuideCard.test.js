import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5755 — bestyrelses-punktets mandat-wiring (flag-stadie + fetchBoardMeeting).
//
// Repoet kører `node --test` uden DOM-renderer, så vi guard'er wiringen
// kildekode-strukturelt (samme mønster som SeasonWrapNudgeCard.goldCta.test.js).
// Den rene beslutningslogik (resolveBoardStartItem) er dækket separat i
// lib/seasonStartGuide.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "SeasonStartGuideCard.jsx"), "utf8");

test("#5755 kun 'beta'/'on' tæller som mandat aktivt for viewer, aldrig 'off'/ukendt", () => {
  assert.match(source, /stage !== "beta" && stage !== "on"/);
});

test("#5755 CodeRabbit-fund: et fejlet/tomt fetchBoardMeeting() må ALDRIG sætte loaded:true", () => {
  // Regression: `loaded: true` på et null-svar fik resolveBoardStartItem til
  // at læse et fejlet kald som "mandatet er underskrevet" (falsk Done).
  assert.match(
    source,
    /meeting != null\)\s*setBoardMandate\(\{\s*enabled: true,\s*loaded: true,\s*meeting\s*\}\)/,
    "loaded:true skal kun sættes når meeting er et ægte (ikke-null) payload",
  );
});

test("#5755 bestyrelses-punktets `to`/`done` bygges via resolveBoardStartItem, ikke ad hoc i komponenten", () => {
  assert.match(source, /resolveBoardStartItem\(\{/);
});
