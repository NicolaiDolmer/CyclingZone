// scripts/verify-affected.test.mjs
// ============================================================
// Tests for the tiered-verification classifier (#3556).
// Run: node --test scripts/verify-affected.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAndUnion,
  isCountableSourceFile,
  classifyTier,
  componentSlug,
  extractComponentName,
  parseRouteMap,
  deriveAffectedSpecs,
  SOURCE_FILE_COUNT_THRESHOLD,
} from "./verify-affected.mjs";

// --------------------------------------------------------------
// normalizeAndUnion
// --------------------------------------------------------------

test("normalizeAndUnion merges, dedupes, sorts and normalizes backslashes", () => {
  const result = normalizeAndUnion([
    "b/two.js\na/one.js\n",
    "a/one.js\nc\\three.js\n",
    "",
    null,
  ]);
  assert.deepEqual(result, ["a/one.js", "b/two.js", "c/three.js"]);
});

test("normalizeAndUnion returns empty array for all-empty inputs", () => {
  assert.deepEqual(normalizeAndUnion(["", "\n", null, undefined]), []);
});

// --------------------------------------------------------------
// isCountableSourceFile
// --------------------------------------------------------------

test("isCountableSourceFile excludes docs and images", () => {
  assert.equal(isCountableSourceFile("docs/NOW.md"), false);
  assert.equal(isCountableSourceFile("pr-screens/foo.png"), false);
  assert.equal(isCountableSourceFile("assets/thing.svg"), false);
});

test("isCountableSourceFile counts code/config files", () => {
  assert.equal(isCountableSourceFile("frontend/src/pages/TrainingPage.jsx"), true);
  assert.equal(isCountableSourceFile("backend/lib/economyEngine.js"), true);
  assert.equal(isCountableSourceFile("frontend/public/locales/en/training.json"), true);
});

// --------------------------------------------------------------
// classifyTier — FULL-tier rules
// --------------------------------------------------------------

test("classifyTier: backend/** triggers FULL", () => {
  const result = classifyTier(["backend/routes/riders.js"]);
  assert.equal(result.tier, "FULL");
  assert.ok(result.reasons.some((r) => r.includes("backend/**")));
});

test("classifyTier: frontend/src/lib/** triggers FULL", () => {
  const result = classifyTier(["frontend/src/lib/api.js"]);
  assert.equal(result.tier, "FULL");
  assert.ok(result.reasons.some((r) => r.includes("frontend/src/lib/**")));
});

test("classifyTier: frontend/src/hooks/** triggers FULL", () => {
  const result = classifyTier(["frontend/src/hooks/useAuth.js"]);
  assert.equal(result.tier, "FULL");
  assert.ok(result.reasons.some((r) => r.includes("frontend/src/hooks/**")));
});

test("classifyTier: components/ui/** triggers FULL (delt komponent)", () => {
  const result = classifyTier(["frontend/src/components/ui/Button.jsx"]);
  assert.equal(result.tier, "FULL");
  assert.ok(result.reasons.some((r) => r.includes("delt komponent")));
});

test("classifyTier: components/rider/** triggers FULL", () => {
  const result = classifyTier(["frontend/src/components/rider/RiderFilters.jsx"]);
  assert.equal(result.tier, "FULL");
});

test("classifyTier: components/race/** triggers FULL", () => {
  const result = classifyTier(["frontend/src/components/race/RaceLink.jsx"]);
  assert.equal(result.tier, "FULL");
});

test("classifyTier: a NON-shared component subdir does NOT trigger the shared-component rule", () => {
  const result = classifyTier(["frontend/src/components/board/BoardEmptyState.jsx"]);
  assert.equal(result.tier, "AFFECTED");
});

test("classifyTier: i18n locale json triggers FULL", () => {
  const result = classifyTier(["frontend/public/locales/da/training.json"]);
  assert.equal(result.tier, "FULL");
  assert.ok(result.reasons.some((r) => r.includes("i18n locale-fil")));
});

test("classifyTier: non-locale frontend json (e.g. a component's colocated json) does not trigger the i18n rule alone", () => {
  const result = classifyTier(["frontend/src/pages/TrainingPage.jsx"]);
  assert.equal(result.tier, "AFFECTED");
});

test("classifyTier: playwright.config.js triggers FULL", () => {
  const result = classifyTier(["frontend/playwright.config.js"]);
  assert.equal(result.tier, "FULL");
});

test("classifyTier: package.json at any level triggers FULL", () => {
  assert.equal(classifyTier(["package.json"]).tier, "FULL");
  assert.equal(classifyTier(["frontend/package.json"]).tier, "FULL");
  assert.equal(classifyTier(["backend/package.json"]).tier, "FULL");
});

test("classifyTier: package-lock.json triggers FULL", () => {
  assert.equal(classifyTier(["frontend/package-lock.json"]).tier, "FULL");
});

test("classifyTier: vite config triggers FULL", () => {
  assert.equal(classifyTier(["frontend/vite.config.js"]).tier, "FULL");
});

test(`classifyTier: more than ${SOURCE_FILE_COUNT_THRESHOLD} countable source files triggers FULL`, () => {
  const files = Array.from({ length: SOURCE_FILE_COUNT_THRESHOLD + 1 }, (_, i) => `frontend/src/pages/Page${i}.jsx`);
  const result = classifyTier(files);
  assert.equal(result.tier, "FULL");
  assert.ok(result.reasons.some((r) => r.includes("kildefiler i alt")));
});

test(`classifyTier: exactly ${SOURCE_FILE_COUNT_THRESHOLD} countable source files stays AFFECTED`, () => {
  const files = Array.from({ length: SOURCE_FILE_COUNT_THRESHOLD }, (_, i) => `frontend/src/pages/Page${i}.jsx`);
  const result = classifyTier(files);
  assert.equal(result.tier, "AFFECTED");
});

test("classifyTier: docs/screenshots do not count toward the source-file threshold", () => {
  const files = [
    "frontend/src/pages/TrainingPage.jsx",
    "docs/NOW.md",
    "pr-screens/before.png",
    "pr-screens/after.png",
    "docs/screenshots/foo.png",
    "CHANGELOG.md",
    "README.md",
  ];
  // 7 files total, but only 1 is countable — must stay AFFECTED.
  const result = classifyTier(files);
  assert.equal(result.tier, "AFFECTED");
});

test("classifyTier: small isolated frontend page diff stays AFFECTED", () => {
  const result = classifyTier(["frontend/src/pages/TrainingPage.jsx"]);
  assert.equal(result.tier, "AFFECTED");
  assert.deepEqual(result.reasons, []);
});

// --------------------------------------------------------------
// componentSlug
// --------------------------------------------------------------

test("componentSlug strips trailing -page and kebab-cases", () => {
  assert.equal(componentSlug("TrainingPage"), "training");
  assert.equal(componentSlug("RaceDetailPage"), "race-detail");
  assert.equal(componentSlug("RankingsHubPage"), "rankings-hub");
});

test("componentSlug kebab-cases components without a Page suffix", () => {
  assert.equal(componentSlug("AuctionBidWarModal"), "auction-bid-war-modal");
  assert.equal(componentSlug("BoardEmptyState"), "board-empty-state");
});

// --------------------------------------------------------------
// extractComponentName
// --------------------------------------------------------------

test("extractComponentName reads the leading PascalCase identifier from the basename", () => {
  assert.equal(extractComponentName("frontend/src/pages/TrainingPage.jsx"), "TrainingPage");
  assert.equal(extractComponentName("frontend/src/pages/TrainingPage.raceDay.test.js"), "TrainingPage");
  assert.equal(extractComponentName("frontend/src/components/board/BoardEmptyState.jsx"), "BoardEmptyState");
});

// --------------------------------------------------------------
// parseRouteMap
// --------------------------------------------------------------

test("parseRouteMap maps component name to the last static route segment", () => {
  const src = `
    <Route path="training" element={<TrainingPage />} />
    <Route path="standings" element={<RankingsHubPage />} />
    <Route path="riders/:id" element={<RiderStatsPage />} />
    <Route path="staff" element={<Navigate to="/klub?tab=staff" replace />} />
  `;
  const map = parseRouteMap(src);
  assert.equal(map.get("TrainingPage"), "training");
  assert.equal(map.get("RankingsHubPage"), "standings");
  assert.equal(map.get("RiderStatsPage"), "riders");
  assert.equal(map.has("Navigate"), false);
});

test("parseRouteMap keeps first occurrence when a component appears more than once", () => {
  const src = `
    <Route path="first" element={<SamePage />} />
    <Route path="second" element={<SamePage />} />
  `;
  const map = parseRouteMap(src);
  assert.equal(map.get("SamePage"), "first");
});

// --------------------------------------------------------------
// deriveAffectedSpecs
// --------------------------------------------------------------

test("deriveAffectedSpecs: filename-prefix heuristic matches specs starting with the page slug", () => {
  const specFileNames = ["training-race-day.spec.js", "training-report.spec.js", "core-smoke.spec.js", "board-sign.spec.js"];
  const specContents = new Map(specFileNames.map((f) => [f, ""]));
  const routeMap = new Map();
  const matches = deriveAffectedSpecs(["frontend/src/pages/TrainingPage.jsx"], { specFileNames, specContents, routeMap });

  assert.ok(matches.has("training-race-day.spec.js"));
  assert.ok(matches.has("training-report.spec.js"));
  assert.ok(matches.has("core-smoke.spec.js"));
  assert.equal(matches.has("board-sign.spec.js"), false);
});

test("deriveAffectedSpecs: route-grep heuristic catches specs whose filename does not match the component name", () => {
  // RankingsHubPage's route slug is "standings", but the specs are named
  // "standings-*.spec.js" — filename-prefix (slug "rankings-hub") would MISS
  // these; only the route-content grep heuristic should catch them.
  const specFileNames = ["standings-gold-leader.spec.js", "unrelated.spec.js", "core-smoke.spec.js"];
  const specContents = new Map([
    ["standings-gold-leader.spec.js", `await page.goto("/standings");`],
    ["unrelated.spec.js", `await page.goto("/board");`],
    ["core-smoke.spec.js", ""],
  ]);
  const routeMap = new Map([["RankingsHubPage", "standings"]]);
  const matches = deriveAffectedSpecs(["frontend/src/pages/RankingsHubPage.jsx"], { specFileNames, specContents, routeMap });

  assert.ok(matches.has("standings-gold-leader.spec.js"));
  assert.equal(matches.has("unrelated.spec.js"), false);
  assert.ok(matches.has("core-smoke.spec.js"));
});

test("deriveAffectedSpecs: always includes core-smoke.spec.js even with zero other matches", () => {
  const specFileNames = ["core-smoke.spec.js", "totally-unrelated.spec.js"];
  const specContents = new Map(specFileNames.map((f) => [f, ""]));
  const routeMap = new Map();
  const matches = deriveAffectedSpecs(["frontend/src/pages/BrandNewPage.jsx"], { specFileNames, specContents, routeMap });

  assert.deepEqual([...matches.keys()], ["core-smoke.spec.js"]);
  assert.ok(matches.get("core-smoke.spec.js")[0].includes("altid inkluderet"));
});

test("deriveAffectedSpecs: ignores non-page/component files (e.g. lib changes never reach this function in practice)", () => {
  const specFileNames = ["core-smoke.spec.js"];
  const specContents = new Map([["core-smoke.spec.js", ""]]);
  const routeMap = new Map();
  const matches = deriveAffectedSpecs(["frontend/src/styles/tokens.css"], { specFileNames, specContents, routeMap });

  assert.deepEqual([...matches.keys()], ["core-smoke.spec.js"]);
});

test("deriveAffectedSpecs: records both filename and route-grep reasons when both heuristics agree", () => {
  const specFileNames = ["training-race-day.spec.js", "core-smoke.spec.js"];
  const specContents = new Map([
    ["training-race-day.spec.js", `await page.goto("/training");`],
    ["core-smoke.spec.js", ""],
  ]);
  const routeMap = new Map([["TrainingPage", "training"]]);
  const matches = deriveAffectedSpecs(["frontend/src/pages/TrainingPage.jsx"], { specFileNames, specContents, routeMap });

  assert.equal(matches.get("training-race-day.spec.js").length, 2);
});
