#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PATCH_FILE = "frontend/src/data/patchNotes.js";
const NOW_FILE = "docs/NOW.md";

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

function fail(message) {
  console.error(`patch-notes-check: ${message}`);
  process.exitCode = 1;
}

const root = repoRoot();
const baseRef = process.env.PATCH_NOTES_BASE_REF || "origin/main";
const eventName = process.env.GITHUB_EVENT_NAME || "";
const versions = parseVersions(readFile(root, PATCH_FILE));

if (versions.length === 0) {
  fail(`No version entries found in ${PATCH_FILE}.`);
} else {
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

  if (patchNotesChanged && baseVersions.length > 0) {
    const currentTop = versions[0];
    const baseTop = baseVersions[0];
    if (compareVersion(currentTop, baseTop) <= 0) {
      fail(`Top PatchNotes version ${currentTop} must be greater than ${baseRef}'s ${baseTop}.`);
    }
    if (!nowChanged && eventName === "pull_request") {
      fail(`${NOW_FILE} must be updated when ${PATCH_FILE} changes.`);
    }
  }
}

if (!process.exitCode) {
  console.log(`patch-notes-check: ok (${versions.length} versions, top ${versions[0]}).`);
}
