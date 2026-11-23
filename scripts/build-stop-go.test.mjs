import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseArgs, validateGo, buildComment, run } from './build-stop-go.mjs';
import { findOwnerGo, OWNER_LOGIN } from './lib/build-stop.mjs';

process.env.CZ_BUILD_STOP_NO_GH ??= '1';

const ARGS = ['--issue', '9001', '--area', 'sponsor', '--quote', 'Ja, byg den'];

test('parseArgs: flag, værdier og ukendte argumenter', () => {
  assert.deepEqual(parseArgs([...ARGS, '--dry-run']), { dryRun: true, repo: 'NicolaiDolmer/CyclingZone', issue: '9001', area: 'sponsor', quote: 'Ja, byg den' });
  assert.throws(() => parseArgs(['--issue']), /mangler en værdi/);
  assert.throws(() => parseArgs(['--hvad', '1']), /ukendt argument/);
});

test('validateGo: issue, område og citat valideres', () => {
  assert.deepEqual(validateGo({ issue: '9001', area: ' udvikling-2 ', quote: 'Ja,\n  kør' }), { issue: 9001, area: 'udvikling-2', quote: 'Ja, kør' });
  assert.throws(() => validateGo({ issue: 'x', area: 'a', quote: 'Ja' }), /--issue/);
  assert.throws(() => validateGo({ issue: 1, area: '<omraade>', quote: 'Ja' }), /--area/);
  assert.throws(() => validateGo({ issue: 1, area: 'a b', quote: 'Ja' }), /--area/);
  assert.throws(() => validateGo({ issue: 1, area: 'a', quote: '  ' }), /--quote/);
  assert.throws(() => validateGo({ issue: 1, area: 'a', quote: 'sagde "ja"' }), /anførselstegn/);
  assert.throws(() => validateGo({ issue: 1, area: 'a', quote: 'ja -->' }), /HTML/);
  assert.throws(() => validateGo({ issue: 1, area: 'a', quote: 'Ja, brug `sponsor`' }), /markdown-kode/, 'Codex P2: citatet skal kunne læses tilbage uændret');
});

test('buildComment: kommentaren læses af samme parser som håndhævelsen', () => {
  const body = buildComment({ area: 'sponsor', quote: 'Ja, byg den' });
  assert.match(body, /<!-- build-stop: ejer-go area=sponsor -->/);
  assert.deepEqual(findOwnerGo([{ login: OWNER_LOGIN, body }]), { area: 'sponsor', quote: 'Ja, byg den' });
});

test('run: skriver kommentaren via gh og bekræfter markøren ved at læse den tilbage', () => {
  const calls = [];
  const logs = [];
  const exec = (cmd, args) => { calls.push([cmd, ...args]); return ''; };
  const code = run(ARGS, { exec, readBack: () => ({ area: 'sponsor', quote: 'Ja, byg den' }), log: m => logs.push(m) });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 6), ['gh', 'issue', 'comment', '9001', '--repo', 'NicolaiDolmer/CyclingZone']);
  assert.match(calls[0][7], /build-stop: ejer-go area=sponsor/);
  assert.match(logs.join('\n'), /#9001 tæller nu som på listen/);
});

test('run: markør der ikke tæller ved tilbagelæsning (fx anden konto) giver exit 1', () => {
  const logs = [];
  assert.equal(run(ARGS, { exec: () => '', readBack: () => null, log: m => logs.push(m) }), 1);
  assert.match(logs.join('\n'), /repo-ejerens konto/);
  assert.equal(run(ARGS, { exec: () => '', readBack: () => ({ area: 'andet', quote: 'Ja, byg den' }), log: () => {} }), 1, 'ældre markør med andet område tæller ikke som bekræftelse');
});

test('run: gh-fejl giver exit 1, forkert brug exit 2, --dry-run skriver intet', () => {
  assert.equal(run(ARGS, { exec: () => { throw Error('HTTP 403'); }, readBack: () => assert.fail('ingen tilbagelæsning'), log: () => {} }), 1);
  assert.equal(run(['--issue', '1'], { exec: () => assert.fail('nej'), log: () => {} }), 2);
  const logs = [];
  assert.equal(run([...ARGS, '--dry-run'], { exec: () => assert.fail('dry-run skriver intet'), readBack: () => assert.fail('nej'), log: m => logs.push(m) }), 0);
  assert.match(logs.join('\n'), /--dry-run, intet skrevet til #9001/);
});

test('CLI: --dry-run virker som kommando og forkert brug giver exit 2', () => {
  const out = execFileSync(process.execPath, ['scripts/build-stop-go.mjs', ...ARGS, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /<!-- build-stop: ejer-go area=sponsor -->/);
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/build-stop-go.mjs', '--area', 'x'], { stdio: 'pipe' }),
    (err) => err.status === 2,
  );
});
