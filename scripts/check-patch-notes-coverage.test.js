const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isUserFacingFile,
  classifyFiles,
  hasOptOut,
  hasSkipLabel,
  parseVersions,
  suggestNextVersion,
  evaluate,
} = require("./check-patch-notes-coverage.js");

// ---- File classification -------------------------------------------------

test("isUserFacingFile: frontend/src component/page files are user-facing", () => {
  assert.equal(isUserFacingFile("frontend/src/pages/RacesPage.jsx"), true);
  assert.equal(isUserFacingFile("frontend/src/components/admin/SeasonCycleSection.jsx"), true);
  assert.equal(isUserFacingFile("frontend/src/lib/logEvent.js"), true);
  assert.equal(isUserFacingFile("frontend/src/App.css"), true);
});

test("isUserFacingFile: locales files are user-facing", () => {
  assert.equal(isUserFacingFile("frontend/public/locales/en/banners.json"), true);
  assert.equal(isUserFacingFile("frontend/public/locales/da/banners.json"), true);
});

test("isUserFacingFile: test files under frontend/src are excluded", () => {
  assert.equal(isUserFacingFile("frontend/src/App.authRestore.test.js"), false);
  assert.equal(isUserFacingFile("frontend/src/pages/PatchNotesPage.test.js"), false);
  assert.equal(isUserFacingFile("frontend/src/components/admin/sections/BalanceDriftWatchSection.guard.test.js"), false);
});

test("isUserFacingFile: backend and non-locale public files are not user-facing", () => {
  assert.equal(isUserFacingFile("backend/routes/api.js"), false);
  assert.equal(isUserFacingFile("frontend/public/favicon.svg"), false);
  assert.equal(isUserFacingFile("docs/NOW.md"), false);
  assert.equal(isUserFacingFile("database/2026-05-16-app-config.sql"), false);
});

test("classifyFiles: detects patch notes data file touched", () => {
  const { patchNoteTouched } = classifyFiles([
    "frontend/src/pages/RacesPage.jsx",
    "frontend/src/data/patchNotes.js",
  ]);
  assert.equal(patchNoteTouched, true);
});

test("classifyFiles: PatchNotesPage.jsx alone does not count as the data file", () => {
  // The rendering component is not the source of truth; frontend/src/data/patchNotes.js is.
  const { patchNoteTouched } = classifyFiles([
    "frontend/src/pages/RacesPage.jsx",
    "frontend/src/pages/PatchNotesPage.jsx",
  ]);
  assert.equal(patchNoteTouched, false);
});

// ---- Opt-out / skip parsing ------------------------------------------------

test("hasOptOut: matches the exact convention with a plain hyphen", () => {
  assert.equal(hasOptOut("Some body text.\n\npatch-notes: n/a - pure refactor, no UI change\n"), true);
});

test("hasOptOut: matches em-dash and en-dash variants, case-insensitive", () => {
  assert.equal(hasOptOut("PATCH-NOTES: N/A — internal tooling only"), true);
  assert.equal(hasOptOut("patch-notes: n/a – docs cleanup"), true);
});

test("hasOptOut: does not match free-text prose without the marker", () => {
  assert.equal(hasOptOut("Ingen brugerrettet UI-ændring i denne PR."), false);
  assert.equal(hasOptOut("This is a refactor er ikke brugerrettet, see body."), false);
});

test("hasOptOut: requires a reason after the dash, not just the marker", () => {
  assert.equal(hasOptOut("patch-notes: n/a"), false);
  assert.equal(hasOptOut("patch-notes: n/a —"), false);
});

test("hasSkipLabel: recognizes docs-only and backend-only", () => {
  assert.equal(hasSkipLabel(["docs-only"]), true);
  assert.equal(hasSkipLabel(["backend-only", "priority:med"]), true);
  assert.equal(hasSkipLabel(["priority:med"]), false);
  assert.equal(hasSkipLabel([]), false);
  assert.equal(hasSkipLabel(undefined), false);
});

// ---- Version suggestion ----------------------------------------------------

test("parseVersions + suggestNextVersion: bumps the last segment of the top version", () => {
  const content = `export const PATCHES = [\n  { version: "7.116", date: "2026-08-10" },\n  { version: "7.115", date: "2026-08-09" },\n];\n`;
  assert.deepEqual(parseVersions(content), ["7.116", "7.115"]);
  assert.equal(suggestNextVersion(content), "7.117");
});

test("suggestNextVersion: returns null when no versions are found", () => {
  assert.equal(suggestNextVersion("export const PATCHES = [];\n"), null);
});

// ---- Design principle 5 (#3564): prove the guard against #623's 4 known
// real misses. File lists below are the ACTUAL changed files from the merge
// commits (verified against git history: 0b645cb9, d1173aa3, c97c413b,
// 8befaca1) — not synthetic examples.

test("known miss #601 (payroll-summary, 0b645cb9): would have been flagged", () => {
  const changedFiles = [
    "backend/lib/economyEngine.js",
    "backend/lib/economyInvariants.test.js",
    "backend/lib/loanEngine.js",
    "backend/lib/seasonTransition.js",
    "backend/lib/seasonTransition.test.js",
    "backend/routes/api.js",
    "frontend/src/components/admin/SeasonCycleSection.jsx",
  ];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, true);
  assert.deepEqual(result.userFacingFiles, ["frontend/src/components/admin/SeasonCycleSection.jsx"]);
});

test("known miss #456 (survey-CTA banner, d1173aa3): would have been flagged", () => {
  const changedFiles = [
    "database/2026-05-16-app-config.sql",
    "docs/NOW.md",
    "frontend/public/locales/da/banners.json",
    "frontend/public/locales/en/banners.json",
    "frontend/src/components/SurveyBanner.jsx",
    "frontend/src/i18n/index.js",
    "frontend/src/lib/logEvent.js",
    "frontend/src/pages/DashboardPage.jsx",
  ];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, true);
  assert.equal(result.userFacingFiles.length, 6);
  assert.ok(result.userFacingFiles.includes("frontend/src/components/SurveyBanner.jsx"));
  assert.ok(result.userFacingFiles.includes("frontend/public/locales/da/banners.json"));
});

test("known miss #145 (bid-input clearing bug, c97c413b): would have been flagged", () => {
  const changedFiles = ["frontend/src/pages/AuctionsPage.jsx"];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, true);
  assert.deepEqual(result.userFacingFiles, ["frontend/src/pages/AuctionsPage.jsx"]);
});

test("known miss #112 (xlsx ArrayBuffer security fix, 8befaca1): would have been flagged", () => {
  const changedFiles = ["frontend/src/pages/RacesPage.jsx"];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, true);
  assert.deepEqual(result.userFacingFiles, ["frontend/src/pages/RacesPage.jsx"]);
});

// ---- Non-flagging controls (must NOT fire) ---------------------------------

test("control: same shape as #601 but patch notes data file also touched", () => {
  const changedFiles = [
    "backend/routes/api.js",
    "frontend/src/components/admin/SeasonCycleSection.jsx",
    "frontend/src/data/patchNotes.js",
  ];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, false);
  assert.equal(result.reason, "patch-notes-updated");
});

test("control: docs-only label suppresses the flag", () => {
  const changedFiles = ["frontend/src/pages/AuctionsPage.jsx"];
  const result = evaluate({ changedFiles, prBody: "", labels: ["docs-only"], patchNotesContent: "" });
  assert.equal(result.flagged, false);
  assert.equal(result.reason, "skip-label");
});

test("control: explicit opt-out line in PR body suppresses the flag", () => {
  const changedFiles = ["frontend/src/pages/AuctionsPage.jsx"];
  const body = "## Hvad\nRefactor.\n\npatch-notes: n/a — internal refactor, no behaviour change\n";
  const result = evaluate({ changedFiles, prBody: body, labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, false);
  assert.equal(result.reason, "opt-out-line");
});

test("control: backend-only PR with no frontend/locales files never flags", () => {
  const changedFiles = ["backend/lib/economyEngine.js", "backend/routes/api.js"];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, false);
  assert.equal(result.reason, "no-user-facing-files");
});

test("control: test-file-only frontend change never flags", () => {
  const changedFiles = ["frontend/src/App.authRestore.test.js"];
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent: "" });
  assert.equal(result.flagged, false);
  assert.equal(result.reason, "no-user-facing-files");
});

test("evaluate: includes a version suggestion when flagged and patch notes content is available", () => {
  const changedFiles = ["frontend/src/pages/AuctionsPage.jsx"];
  const patchNotesContent = `export const PATCHES = [\n  { version: "7.116", date: "2026-08-10" },\n];\n`;
  const result = evaluate({ changedFiles, prBody: "", labels: [], patchNotesContent });
  assert.equal(result.flagged, true);
  assert.equal(result.suggestedVersion, "7.117");
});
