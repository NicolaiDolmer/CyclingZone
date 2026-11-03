import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const runner = new URL("./run-tests.js", import.meta.url).href;

// Exercise the real entrypoint without loading game tests or writing fixtures.
function runFixture({ count = 1100, results = [], flags = ["--test-reporter=spec"] } = {}) {
  const source = `
    import childProcess from 'node:child_process';
    import fs from 'node:fs';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const nativeSpawn = childProcess.spawnSync;
    const calls = [];
    const names = Array.from({length: ${count}}, (_, i) =>
      'long fixture path with spaces ' + String(i).padStart(4, '0') + '.test.' + ['js', 'ts', 'mjs'][i % 3]);
    const entry = (name, directory = false) => ({name, isDirectory: () => directory, isFile: () => !directory});
    fs.readdirSync = (dir) => path.basename(dir) === 'lib'
      ? ['economyEngine.test.js', ...names].map(name => entry(name))
      : [entry('lib', true), entry('node_modules', true), entry('.git', true), entry('ignored.txt')];
    const results = ${JSON.stringify(results)};
    childProcess.spawnSync = (exe, args, options) => {
      calls.push({exe, args, options});
      // Windows itself rejects the old unbounded argv. Other platforms use
      // the same boundary model so the regression remains portable.
      if (args.join(' ').length > 32767) {
        if (process.platform === 'win32') return nativeSpawn(exe, args, {cwd: options.cwd, encoding: 'utf8'});
        return {error: Object.assign(new Error('argv exceeds Windows limit'), {code: 'ENAMETOOLONG'})};
      }
      const result = results[calls.length - 1] ?? {status: 0};
      if (result.error) result.error = Object.assign(new Error(result.error), {code: result.error});
      return result;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, 'run-tests.js', ...${JSON.stringify(flags)}];
    console.log = () => {};
    process.exit = status => { throw Object.assign(new Error('fixture exit'), {exitStatus: status}); };
    try { await import(${JSON.stringify(runner)}); }
    catch (error) { process.stdout.write(JSON.stringify({calls, status: error.exitStatus, error: error.code})); }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("long suite is bounded, every file runs once, flags and isolation are preserved", () => {
  const result = runFixture();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.ok(result.calls.length > 2);
  assert.deepEqual(result.calls[0].args.slice(-2), [
    "--test-reporter=spec",
    "lib" + (process.platform === "win32" ? "\\" : "/") + "economyEngine.test.js",
  ]);
  const files = result.calls.flatMap((call) =>
    call.args.filter((arg) => /\.test\.(js|ts|mjs)$/.test(arg))
  );
  assert.equal(files.length, 1101);
  assert.equal(new Set(files).size, files.length);
  for (const [i, call] of result.calls.entries()) {
    assert.equal(call.args.includes("--test-isolation=none"), i === 0);
    assert.ok(call.args.includes("--test-reporter=spec"));
    assert.equal(call.options.stdio, "inherit");
    assert.ok(call.options.cwd.endsWith("backend"));
    assert.ok(call.args.join(" ").length < 32767);
  }
});

for (const [name, outcome, status, error] of [
  ["test failure", { status: 7 }, 7, undefined],
  ["signal", { status: null, signal: "SIGTERM" }, 1, undefined],
  ["spawn failure", { error: "EACCES" }, undefined, "EACCES"],
]) {
  for (const pass of [0, 1, 2])
    test(`${name} at invocation ${pass + 1}`, () => {
      const total = runFixture().calls.length;
      const results = Array.from({ length: pass }, () => ({ status: 0 }));
      results.push(outcome);
      const result = runFixture({ results });
      assert.equal(result.status, status);
      assert.equal(result.error, error);
      // A spawn error aborts at once. A failing isolated pass (invocation 1) skips
      // pass 2 as before; a failing batch in pass 2 still runs the remaining batches.
      const expectedCalls = error !== undefined || pass === 0 ? pass + 1 : total;
      assert.equal(result.calls.length, expectedCalls);
    });
}

test("first failing batch status wins even if a later batch fails too", () => {
  const total = runFixture().calls.length;
  assert.ok(total >= 3, "fixture splits pass 2 into at least two batches");
  const results = [{ status: 0 }, { status: 3 }, ...Array.from({ length: total - 2 }, () => ({ status: 9 }))];
  const result = runFixture({ results });
  assert.equal(result.status, 3);
  assert.equal(result.calls.length, total);
});

test("no remaining files never invokes implicit Node discovery", () => {
  const result = runFixture({ count: 0, flags: [] });
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 1);
});

test("multiple passthrough flags retain their values and order in every batch", () => {
  const flags = [
    "--test-name-pattern",
    'a "quoted" pattern\\',
    "--test-concurrency=2",
    "--test-reporter=spec",
  ];
  const result = runFixture({ flags });
  assert.equal(result.status, 0);
  for (const call of result.calls) {
    const start = call.args.indexOf(flags[0]);
    assert.deepEqual(call.args.slice(start, start + flags.length), flags);
  }
});
