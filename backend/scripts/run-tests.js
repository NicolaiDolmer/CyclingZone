// #3172: node:internal/test_runner intermittently corrupts worker-IPC data
// ("Unable to deserialize cloned data due to invalid or unsupported version")
// only when MANY test-file workers stream results back to the parent test
// runner process at the same time. Root cause upstream: nodejs/node#64061,
// fixed by nodejs/node#64706 (merged 2026-07-26) — a signed/unsigned bug in
// the test runner's internal `processRawBuffer` that mishandles large IPC
// buffers. That fix has not reached our pinned Node 24.x line yet, so we
// isolate the offending file instead of waiting on a Node bump.
//
// lib/economyEngine.test.js is by far the largest backend test file (100+
// top-level tests, 6500+ lines, ~250KB) — its per-worker result payload is
// large enough to be the one that trips the bug when it lands concurrently
// with the other ~340 test-file workers. Isolated runs of the file are
// 102/102 green every time; the flake has only ever been observed in the
// full suite (#3169-CI, #3171-CI).
//
// Fix: run the large file alone FIRST (no concurrent worker traffic to race
// against), then run every other backend test file exactly as before (same
// flags, same default concurrency). Any CLI args npm forwards (e.g.
// `--test-reporter=spec` from `npm test -- --test-reporter=spec`) are passed
// through to both passes unchanged.
//
// Deliberately NOT using `--test-concurrency=1` for the whole suite: that
// would serialize all ~344 files and materially slow down CI/local runs for
// a bug that only needs ONE file kept out of the concurrent pool.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISOLATED_RELATIVE = path.join("lib", "economyEngine.test.js");
const IGNORED_DIRS = new Set(["node_modules", ".git"]);

function findTestFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      findTestFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function runNodeTest(extraArgs, files) {
  const result = spawnSync(
    process.execPath,
    ["--test", "--import", "./test-setup.js", ...extraArgs, ...files],
    { stdio: "inherit", cwd: backendRoot },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const extraArgs = process.argv.slice(2);
const isolatedAbsolute = path.join(backendRoot, ISOLATED_RELATIVE);
const allTestFilesAbsolute = findTestFiles(backendRoot, []).sort();

if (!allTestFilesAbsolute.includes(isolatedAbsolute)) {
  // Guard-fail loudly rather than silently running everything together —
  // if the file moves/renames, this script must be updated with it.
  console.error(
    `run-tests.js: expected isolated file not found at ${ISOLATED_RELATIVE} (#3172 guard). ` +
      "Update backend/scripts/run-tests.js if the file moved or was renamed.",
  );
  process.exit(1);
}

// Relative paths, not absolute: with ~340 files, an absolute-path argv (this
// worktree's path alone is ~65 chars) blows past Windows's ~32K CreateProcess
// command-line limit and spawnSync fails with ENAMETOOLONG. Relative paths
// (cwd is already backendRoot) cut the argv to a third of that, with plenty
// of headroom as the suite grows.
const restFilesRelative = allTestFilesAbsolute
  .filter((file) => file !== isolatedAbsolute)
  .map((file) => path.relative(backendRoot, file));

console.log(`\n[run-tests] Pass 1/2: ${ISOLATED_RELATIVE} in isolation (#3172 worker-IPC flake guard)\n`);
const isolatedStatus = runNodeTest(extraArgs, [ISOLATED_RELATIVE]);
if (isolatedStatus !== 0) {
  process.exit(isolatedStatus);
}

console.log(`\n[run-tests] Pass 2/2: remaining ${restFilesRelative.length} backend test files\n`);
const restStatus = runNodeTest(extraArgs, restFilesRelative);
process.exit(restStatus);
