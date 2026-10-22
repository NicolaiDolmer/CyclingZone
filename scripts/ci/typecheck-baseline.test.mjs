import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagnostics, run } from './typecheck-baseline.mjs';

const diagnostic = (file = 'src/a.js', code = 2339, line = 3) =>
  file + '(' + line + ',2): error TS' + code + ': Property does not exist.\n';
function fake({ output = diagnostic(), status = 2, baseline = { 'src/a.js': { TS2339: 1 } }, update = false } = {}) {
  const writes = [], logs = [];
  const exit = run({
    update,
    execute: () => ({ status, stdout: output, stderr: '' }),
    read: () => JSON.stringify(baseline),
    write: (...args) => writes.push(args),
    log: (line) => logs.push(line),
  });
  return { exit, writes, logs };
}

test('parses POSIX and Windows paths, retaining locations and codes', () => {
  const parsed = parseDiagnostics(diagnostic() + diagnostic('src\\b.jsx', 2322, 9));
  assert.deepEqual(parsed.map(({ file, code, line }) => ({ file, code, line })), [
    { file: 'src/a.js', code: 'TS2339', line: 3 },
    { file: 'src/b.jsx', code: 'TS2322', line: 9 },
  ]);
});
test('unchanged diagnostics pass without rewriting baseline', () => {
  assert.deepEqual(fake().writes, []);
  assert.equal(fake().exit, 0);
});
test('new file fails and prints file:line', () => {
  const result = fake({ output: diagnostic('src/new.jsx') });
  assert.equal(result.exit, 1);
  assert.match(result.logs.join('\n'), /src\/new.jsx:3:2/);
});
test('more errors in a file fail even when another file improves', () => {
  assert.equal(fake({ output: diagnostic() + diagnostic(), baseline: {
    'src/a.js': { TS2339: 1 }, 'src/b.js': { TS2339: 10 },
  } }).exit, 1);
});
test('new code fails even when total for file stays unchanged', () => {
  assert.equal(fake({ output: diagnostic('src/a.js', 2322) }).exit, 1);
});
test('update never raises an existing baseline', () => {
  const result = fake({ output: diagnostic() + diagnostic(), update: true });
  assert.equal(result.exit, 1);
  assert.deepEqual(result.writes, []);
});
test('decreases require update so saved budget cannot be reused', () => {
  assert.equal(fake({ output: '', status: 0 }).exit, 1);
  const result = fake({ output: '', status: 0, update: true });
  assert.equal(result.exit, 0);
  assert.deepEqual(JSON.parse(result.writes[0][1]), {});
});
test('update removes fixed codes and files', () => {
  const result = fake({ update: true, baseline: {
    'src/a.js': { TS2339: 2, TS2322: 1 }, 'src/b.jsx': { TS2339: 1 },
  } });
  assert.equal(result.exit, 0);
  assert.deepEqual(JSON.parse(result.writes[0][1]), { 'src/a.js': { TS2339: 1 } });
});
test('missing baseline fails unless explicitly initializing with update', () => {
  const options = { execute: () => ({ status: 2, stdout: diagnostic(), stderr: '' }),
    read: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, log: () => {} };
  assert.equal(run(options), 1);
  const writes = [];
  assert.equal(run({ ...options, update: true, write: (...args) => writes.push(args) }), 0);
  assert.equal(writes.length, 1);
});
test('compiler failure, global errors, and unparsed output fail closed', () => {
  for (const options of [
    { output: '', status: null }, { output: '', status: 1 },
    { output: 'error TS18003: No inputs found.', status: 2 },
    { output: diagnostic() + 'unrecognized compiler output', status: 2 },
  ]) assert.equal(fake(options).exit, 1);
});
test('invalid baseline cannot silently reset the budget', () => {
  for (const baseline of [[], null, { 'src/a.js': { TS2339: -1 } }, { 'src/a.js': { TS2339: '1' } }]) {
    const result = fake({ baseline, update: true });
    assert.equal(result.exit, 1);
    assert.deepEqual(result.writes, []);
  }
});

test('TS7 exit 1 with located diagnostics is a valid typecheck result', () => {
  assert.equal(fake({ status: 1 }).exit, 0);
});

test('multiline diagnostics count only the located error', () => {
  assert.equal(fake({ output: diagnostic() + '  Types of property are incompatible.\n' }).exit, 0);
});
test('stderr, process errors and write failures fail closed', () => {
  for (const result of [
    { status: 0, stdout: '', stderr: 'fatal failure' },
    { status: null, error: new Error('spawn failed') },
  ]) assert.equal(run({ execute: () => result, log: () => {} }), 1);
  assert.equal(run({
    update: true,
    execute: () => ({ status: 0, stdout: '', stderr: '' }),
    read: () => JSON.stringify({ 'src/a.js': { TS2339: 1 } }),
    write: () => { throw new Error('read-only filesystem'); },
    log: () => {},
  }), 1);
});
