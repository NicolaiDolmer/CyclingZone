import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  COMMAND_LENGTH_LIMIT,
  testArgumentBatches,
  windowsArgumentLength,
} from "./run-tests-args.mjs";

test("Windows quoting counts quotes, whitespace, backslash runs and UTF-16", () => {
  for (const [arg, expected] of [
    ["", 2],
    ["abc", 3],
    ["a b", 5],
    ["a\tb", 5],
    ['a"b', 6],
    ['a\\"b', 8],
    ["a b\\", 7],
    ["a b\\\\", 9],
    ["🚲", 2],
  ])
    assert.equal(windowsArgumentLength(arg), expected, JSON.stringify(arg));
});

test("long executable and flags consume budget; all files occur exactly once", () => {
  const executable = "C:\\Program Files\\" + "long worktree segment\\".repeat(8) + "node.exe";
  const prefix = [
    "--test",
    "--import",
    "./test-setup.js",
    '--test-name-pattern=a "quoted" pattern\\',
  ];
  const files = Array.from({ length: 2000 }, (_, i) => `lib\\nested path\\test-${i}.test.mjs`);
  const batches = testArgumentBatches(executable, prefix, files);
  assert.ok(batches.length > 2);
  assert.deepEqual(
    batches.flatMap((args) => args.slice(prefix.length)),
    files
  );
  for (const args of batches) {
    assert.deepEqual(args.slice(0, prefix.length), prefix);
    const length =
      windowsArgumentLength(executable) +
      1 +
      args.reduce((n, arg) => n + 1 + windowsArgumentLength(arg), 0);
    assert.ok(length <= COMMAND_LENGTH_LIMIT);
  }
});

test("exact budget boundary, empty suite and individually oversized input", () => {
  assert.deepEqual(testArgumentBatches("node", ["--test"], ["a", "b"], 15), [
    ["--test", "a"],
    ["--test", "b"],
  ]);
  assert.deepEqual(testArgumentBatches("node", ["--test"], ["a", "b"], 16), [["--test", "a", "b"]]);
  assert.deepEqual(testArgumentBatches("node", ["--test"], []), []);
  assert.throws(() => testArgumentBatches("node", ["--test"], ["a"], 13), RangeError);
  assert.throws(() => testArgumentBatches("node", ["x".repeat(30000)], ["a"]), RangeError);
});

test("bounded argv survives native Windows quoting and preserves argument values", () => {
  const values = Array.from({ length: 1600 }, (_, i) => `path ${i}\\"quoted"\\`);
  const prefix = ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "--"];
  const batches = testArgumentBatches(process.execPath, prefix, values);
  assert.ok(batches.length > 1);
  const received = [];
  for (const args of batches) {
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    received.push(...JSON.parse(result.stdout));
  }
  assert.deepEqual(received, values);
});
