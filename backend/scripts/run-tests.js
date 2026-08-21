// #3172: node:internal/test_runner intermittently corrupts worker-IPC data
// ("Unable to deserialize cloned data due to invalid or unsupported version").
// Root cause upstream: nodejs/node#64061, fixed by nodejs/node#64706 (merged
// 2026-07-26) — a signed/unsigned bug in the test runner's internal
// `processRawBuffer` that mishandles large IPC buffers streamed from a
// per-file test worker back to the parent process. That fix has not reached
// our pinned Node 24.x line yet.
//
// lib/economyEngine.test.js is by far the largest backend test file (100+
// top-level tests, 6500+ lines, ~250KB) — its per-worker result payload is
// the one large enough to trip the bug.
//
// A first fix (2026-08-03, PR #3222) ran this file alone in its own pass,
// theorizing the bug needed concurrent IPC traffic from other workers to
// trigger. That theory was WRONG: the isolated pass itself failed with the
// exact same deserialize error twice more the same evening (CI runs
// 30836291715 attempt 1 @17:20 and 30840936886 @18:22, both on the isolated
// Pass 1, zero other workers running). The bug is triggered by this file's
// payload size/shape alone, not by concurrency — isolating it from other
// workers only lowered the odds of hitting the exact buffer boundary that
// trips `processRawBuffer`, it didn't remove the vulnerable code path.
//
// Actual fix: run this one file with `--test-isolation=none`, which makes
// node:test execute it in the *same* process instead of spawning a child
// worker that streams results back over a socket via structured-clone IPC.
// With no IPC round-trip for this file, `processRawBuffer`/`FileTest.parseMessage`
// are never invoked for it, so the bug class cannot trigger regardless of
// payload size or concurrent load. Verified locally: 25/25 consecutive green
// runs, exit codes and failure-propagation confirmed correct (a deliberately
// failing test still exits 1), and the per-file `FileTest` wrapper line that
// appeared in every crash stack trace is absent from `--test-isolation=none`
// output — confirming the vulnerable path is structurally bypassed, not just
// avoided by timing.
//
// `--test-isolation=none` is scoped to Pass 1 ONLY (this one file). Pass 2
// (all other ~340 files) keeps the default process-per-file isolation
// unchanged — disabling isolation suite-wide would risk state/global leakage
// between unrelated test files, a much bigger blast radius than this one
// file needs. Any CLI args npm forwards (e.g. `--test-reporter=spec` from
// `npm test -- --test-reporter=spec`) are passed through to both passes
// unchanged, in addition to the isolation flag on Pass 1.
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
    } else if (entry.isFile() && (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.ts"))) {
      // .test.ts: kun lib/engine/v4/**/*.test.ts (#4030) — Node 24 koerer .ts
      // direkte via type stripping, ingen build-step. Andre .ts-testfiler
      // findes ikke i backend endnu; udvid mønsteret hvis flere kommer.
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function runNodeTest(extraArgs, files, isolationArgs = []) {
  const result = spawnSync(
    process.execPath,
    ["--test", "--import", "./test-setup.js", ...isolationArgs, ...extraArgs, ...files],
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

console.log(
  `\n[run-tests] Pass 1/2: ${ISOLATED_RELATIVE} with --test-isolation=none ` +
    "(#3172 worker-IPC deserialize-bug guard — no child worker, no IPC, bug class cannot trigger)\n",
);
const isolatedStatus = runNodeTest(extraArgs, [ISOLATED_RELATIVE], ["--test-isolation=none"]);
if (isolatedStatus !== 0) {
  process.exit(isolatedStatus);
}

console.log(`\n[run-tests] Pass 2/2: remaining ${restFilesRelative.length} backend test files\n`);
const restStatus = runNodeTest(extraArgs, restFilesRelative);
process.exit(restStatus);
