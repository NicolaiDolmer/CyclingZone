#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PATCH_FILE = "frontend/src/data/patchNotes.js";
const NOW_FILE = "docs/NOW.md";
// Forward-guard mod stille core-smoke patch-notes-snapshot-drift (#1853→#1862,
// #1864→#1874): /patch-notes åbner nyeste entry by default, så en ny top-version
// vokser first paint forbi den maskede visual-diff-threshold. frontend-smoke er
// kun ADVISORY → driften blokerede ikke merge og slap igennem 2×. Denne required
// guard (kører i frontend-build) kræver at snapshots refreshes i SAMME PR.
// Siden #2211 er /patch-notes skipSnapshot:true (intet pixel-snapshot at drifte),
// så kravet er betinget af at ruten faktisk snapshottes i core-smoke.spec.js —
// genaktiveres snapshottet, re-armeres guarden automatisk.
const SMOKE_SPEC_FILE = "frontend/tests/e2e/core-smoke.spec.js";
const SNAPSHOT_PREFIX = "frontend/tests/e2e/core-smoke.spec.js-snapshots/patch-notes-";
// Escape-hatch til den sjældne nye top-entry der er verificeret sub-threshold:
// sæt token'en ALENE på sin egen linje i en commit-besked i PR'en (#2535 —
// substring-match citerede token'en fra andre beskeder/kommentarer utilsigtet).
const SNAPSHOT_OPT_OUT = "[patch-notes-snapshot-ok]";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function tryRun(command, args) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
}

function repoRoot() {
  return run("git", ["rev-parse", "--show-toplevel"]);
}

function readFile(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function readGitFile(ref, file) {
  return tryRun("git", ["show", `${ref}:${file}`]);
}

function parseVersions(content) {
  return [...content.matchAll(/"?version"?:\s*["'](\d+(?:\.\d+){1,2})["']/g)].map(match => match[1]);
}

function compareVersion(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function changedFiles(baseRef) {
  const diff = tryRun("git", ["diff", "--name-only", `${baseRef}...HEAD`]);
  return diff ? diff.split(/\r?\n/).filter(Boolean) : [];
}

function commitMessages(baseRef) {
  // To-dot range: kun commits på HEAD som ikke er i baseRef (PR'ens egne commits).
  return tryRun("git", ["log", "--format=%B", `${baseRef}..HEAD`]);
}

// Opt-out kræver at token'en står ALENE på sin egen linje i en commit-besked —
// ellers opter en besked der blot CITERER/nævner token'en (fx i en postmortem-
// beskrivelse eller en anden guards fejlbesked) PR'en ud utilsigtet (#2535).
function hasOptOutToken(messages, token) {
  return messages
    .split(/\r?\n/)
    .some((line) => line.trim() === token);
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// True hvis /patch-notes-ruten pixel-snapshottes i core-smoke.spec.js (dvs. har
// et entry uden skipSnapshot:true). Mangler filen/entry'et, eller er ruten
// skipSnapshot, findes der intet snapshot at drifte → refresh-kravet skippes.
function patchNotesRouteIsSnapshotted(root) {
  let spec;
  try {
    spec = readFile(root, SMOKE_SPEC_FILE);
  } catch {
    return false;
  }
  const entry = spec.match(/\{[^{}]*path:\s*["']\/patch-notes["'][^{}]*\}/);
  if (!entry) return false;
  return !/skipSnapshot:\s*true/.test(entry[0]);
}

function fail(message) {
  console.error(`patch-notes-check: ${message}`);
  process.exitCode = 1;
}

function main() {
  const root = repoRoot();
  const baseRef = process.env.PATCH_NOTES_BASE_REF || "origin/main";
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const versions = parseVersions(readFile(root, PATCH_FILE));

  if (versions.length === 0) {
    fail(`No version entries found in ${PATCH_FILE}.`);
    return;
  }

  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
  if (duplicates.length > 0) {
    fail(`Duplicate PatchNotes versions: ${[...new Set(duplicates)].join(", ")}.`);
  }

  for (let i = 1; i < versions.length; i += 1) {
    if (compareVersion(versions[i - 1], versions[i]) <= 0) {
      fail(`Versions must be newest-first: ${versions[i - 1]} appears before ${versions[i]}.`);
      break;
    }
  }

  const changed = changedFiles(baseRef);
  const patchNotesChanged = changed.includes(PATCH_FILE);
  const nowChanged = changed.includes(NOW_FILE);
  const baseContent = readGitFile(baseRef, PATCH_FILE);
  const baseVersions = baseContent ? parseVersions(baseContent) : [];

  // Ændringer der IKKE rører den parsede versionsliste (kommentarer, typos,
  // formattering) skal ikke tvinge et version-bump (#2535). Enhver reel
  // ændring — ny entry, kollision, re-ordering — ændrer listen og rammer
  // stadig bump-kravet nedenfor (#154-beskyttelsen).
  const versionsUnchanged = baseVersions.length > 0 && arraysEqual(versions, baseVersions);

  if (patchNotesChanged && baseVersions.length > 0 && !versionsUnchanged) {
    const currentTop = versions[0];
    const baseTop = baseVersions[0];
    const addedNewTopVersion = compareVersion(currentTop, baseTop) > 0;
    if (!addedNewTopVersion) {
      fail(`Top PatchNotes version ${currentTop} must be greater than ${baseRef}'s ${baseTop}.`);
    }
    if (!nowChanged && eventName === "pull_request") {
      fail(`${NOW_FILE} must be updated when ${PATCH_FILE} changes.`);
    }
    // En ny top-version flytter /patch-notes' first paint → core-smoke-snapshots
    // SKAL refreshes i samme PR, ellers driver de stille (advisory frontend-smoke).
    // Kun relevant hvis ruten faktisk snapshottes (ikke skipSnapshot, jf. #2211).
    if (addedNewTopVersion && eventName === "pull_request" && patchNotesRouteIsSnapshotted(root)) {
      const snapshotChanged = changed.some((file) => file.startsWith(SNAPSHOT_PREFIX));
      const optedOut = hasOptOutToken(commitMessages(baseRef), SNAPSHOT_OPT_OUT);
      if (!snapshotChanged && !optedOut) {
        fail(
          `New PatchNotes version ${currentTop} added but core-smoke snapshots were not ` +
          `refreshed. /patch-notes opens the newest entry by default, so a new version grows ` +
          `first paint past the visual-diff threshold. Run \`cd frontend && npm run ` +
          `test:e2e:update\` and commit the updated ${SNAPSHOT_PREFIX}*.png files ` +
          `(or add ${SNAPSHOT_OPT_OUT} on its own line in a commit message if the new entry is ` +
          `verified sub-threshold).`
        );
      }
    }
  }

  if (!process.exitCode) {
    console.log(`patch-notes-check: ok (${versions.length} versions, top ${versions[0]}).`);
  }
}

module.exports = {
  parseVersions,
  compareVersion,
  hasOptOutToken,
  arraysEqual,
  patchNotesRouteIsSnapshotted,
};

if (require.main === module) {
  main();
}
