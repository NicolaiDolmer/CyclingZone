#!/usr/bin/env node
// Patch notes coverage guard (#3638).
//
// #623 (2026-05-25) measured a 5% real miss-rate over 80 user-facing PRs and
// found 4 concrete misses (#601, #456, #145, #112: user-facing changes merged
// with no patch note) but closed WITHOUT spawning the build issue. #3638
// reopened that gap 78 days later. This script is the guard #623 recommended.
//
// Design constraints carried over from #623/#3638 (both owner-set):
// - ADVISORY ONLY. #3638's 12/8 addendum is explicit: "Flaggeren bør
//   foreslå, ikke blokere — en falsk positiv må ikke stoppe en merge."
//   This script always exits 0. Findings go to stdout + $GITHUB_STEP_SUMMARY
//   as a suggestion, never as a CI failure.
// - "User-facing" is inherited from #623's calibrated 80-PR audit
//   (scripts/patchnotes-audit.sh, commit 1fb7adc5): frontend/src/**/*.{jsx,
//   tsx,js,ts,css} (excluding test files) and frontend/public/locales/**.
// - Design principle 5 (#3564 spec): a new gate must be proven against a
//   known defect before it ships. check-patch-notes-coverage.test.js runs
//   this exact classifier against the 4 real misses' actual changed-file
//   lists and asserts every one would have been flagged.
//
// Known gap (out of scope for v1, noted in #3638): "backend-endpoints der
// ændrer spiller-synlig adfærd" is a semantic judgment, not a file-pattern
// one — this script does not attempt it. File-pattern coverage on the
// frontend surface is what #623 calibrated and what this ships first.
//
// Not covered: help.json (#1171 raises the same missing-enforcement class
// for help/FAQ content) — deliberately out of scope here, see #3638 §4.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PATCH_NOTES_DATA_FILE = "frontend/src/data/patchNotes.js";

const USER_FACING_EXT = /\.(jsx|tsx|js|ts|css)$/;
const TEST_FILE = /\.test\.(jsx?|tsx?)$/i;
const FRONTEND_SRC = /^frontend\/src\//;
const LOCALES_FILE = /^frontend\/public\/locales\/.+\.json$/;

const SKIP_LABELS = ["docs-only", "backend-only"];

// PR-body opt-out per #3638's spec: an explicit line, not free-text prose
// scanning (that was the false-positive source #623's Q1 flagged — a
// deterministic scanner can't reliably parse "ingen call-sites ændres
// her"-style prose, so it isn't attempted; the convention below is the
// machine-checkable replacement). Requires the literal "n/a" plus a reason
// after a dash, tolerant of hyphen/en-dash/em-dash.
const OPT_OUT_LINE = /^\s*patch-notes:\s*n\/a\s*[-–—]+\s*\S.*$/im;

function isUserFacingFile(file) {
  if (LOCALES_FILE.test(file)) return true;
  if (!FRONTEND_SRC.test(file)) return false;
  if (!USER_FACING_EXT.test(file)) return false;
  if (TEST_FILE.test(file)) return false;
  return true;
}

function classifyFiles(files) {
  const userFacingFiles = files.filter(isUserFacingFile);
  const patchNoteTouched = files.includes(PATCH_NOTES_DATA_FILE);
  return { userFacingFiles, patchNoteTouched };
}

function hasOptOut(body) {
  return OPT_OUT_LINE.test(body || "");
}

function hasSkipLabel(labels) {
  return (labels || []).some((label) => SKIP_LABELS.includes(label));
}

// Same version-list parser as check-patch-notes-version.js (kept independent
// on purpose — this script must never import from a required-gate script and
// accidentally couple their failure modes).
function parseVersions(content) {
  return [...content.matchAll(/"?version"?:\s*["'](\d+(?:\.\d+){1,2})["']/g)].map((m) => m[1]);
}

// #623 Q2 finding: version-suggestion is trivially "max + 1 on the last
// segment" — a smarter guess isn't worth building. Collision risk (two PRs
// merging same day both suggest the same next version) is called out in the
// rendered message, not solved here.
function suggestNextVersion(patchNotesContent) {
  const versions = parseVersions(patchNotesContent);
  if (versions.length === 0) return null;
  const parts = versions[0].split(".").map(Number);
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

function evaluate({ changedFiles, prBody, labels, patchNotesContent }) {
  const { userFacingFiles, patchNoteTouched } = classifyFiles(changedFiles);

  if (userFacingFiles.length === 0) {
    return { flagged: false, reason: "no-user-facing-files", userFacingFiles };
  }
  if (patchNoteTouched) {
    return { flagged: false, reason: "patch-notes-updated", userFacingFiles };
  }
  if (hasSkipLabel(labels)) {
    return { flagged: false, reason: "skip-label", userFacingFiles };
  }
  if (hasOptOut(prBody)) {
    return { flagged: false, reason: "opt-out-line", userFacingFiles };
  }
  return {
    flagged: true,
    reason: "missing-patch-note",
    userFacingFiles,
    suggestedVersion: patchNotesContent ? suggestNextVersion(patchNotesContent) : null,
  };
}

module.exports = {
  PATCH_NOTES_DATA_FILE,
  isUserFacingFile,
  classifyFiles,
  hasOptOut,
  hasSkipLabel,
  parseVersions,
  suggestNextVersion,
  evaluate,
};

if (require.main === module) {
  main();
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function repoRoot() {
  return run("git", ["rev-parse", "--show-toplevel"]) || process.cwd();
}

function loadPullRequestEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return event.pull_request || null;
  } catch {
    return null;
  }
}

function main() {
  const root = repoRoot();
  const baseRef = process.env.PATCH_NOTES_BASE_REF || "origin/main";
  const diff = run("git", ["diff", "--name-only", `${baseRef}...HEAD`]);
  const changedFiles = diff ? diff.split(/\r?\n/).filter(Boolean) : [];

  const pr = loadPullRequestEvent();
  const prBody = pr?.body || "";
  const labels = (pr?.labels || []).map((label) => label.name);

  let patchNotesContent = "";
  try {
    patchNotesContent = fs.readFileSync(path.join(root, PATCH_NOTES_DATA_FILE), "utf8");
  } catch {
    patchNotesContent = "";
  }

  const result = evaluate({ changedFiles, prBody, labels, patchNotesContent });

  if (!result.flagged) {
    const message = `patch-notes-coverage: ok (${result.reason}, ${result.userFacingFiles.length} user-facing file(s) checked).`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Patch notes coverage (advisory)\n\nOK — ${result.reason}.\n`);
    }
    process.exit(0);
  }

  const lines = [];
  lines.push("### ⚠️ Patch notes coverage (advisory)");
  lines.push("");
  lines.push(
    `Denne PR rører brugerrettede filer, men \`${PATCH_NOTES_DATA_FILE}\` er ikke ændret, og der er hverken en ` +
    "\`docs-only\`/\`backend-only\`-label eller en `patch-notes: n/a — <grund>`-linje i PR-body."
  );
  lines.push("");
  lines.push("**Brugerrettede filer:**");
  for (const file of result.userFacingFiles) lines.push(`- \`${file}\``);
  lines.push("");
  if (result.suggestedVersion) {
    lines.push(
      `**Foreslået næste version:** \`${result.suggestedVersion}\` — verificér mod ${baseRef}'s aktuelle max ` +
      "version før commit (to PR'er merget samme dag kan foreslå samme nummer, jf. #623 Q2)."
    );
    lines.push("");
  }
  lines.push(
    "Dette er en advisory og blokerer ikke merge. Tilføj en patch note, en skip-label, eller en " +
    "`patch-notes: n/a — <grund>`-linje i PR-body hvis flaget er forkert."
  );
  lines.push("");
  lines.push(
    "Kendt begrænsning: guarden ser kun på filsti-mønstre (frontend/src + locales) — backend-endpoints der " +
    "ændrer spiller-synlig adfærd flagges ikke automatisk (semantisk vurdering, ikke sti-baseret; se #3638)."
  );

  const report = lines.join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  }
  // Advisory: never fail the build (owner mandate, #3638 12/8 addendum).
  process.exit(0);
}
