import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWave, childArgs } from './codex-wave.mjs';

const now = 1790000000000;
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cz-wave-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const tracks = [1, 2].map(issue => ({ issue, branch: `codex/${issue}-fixture`, title: 'Fixture', ownership: [`fixtures/${issue}`], tier: 'TARGETED', verifyCommands: ['node --test fixture.test.mjs'] }));
function deps(overrides = {}) {
  return { now: () => now, readPrs: async () => [], prefilter: async () => {},
    prepare: async t => ({ ...t, worktree: `/fixture/${t.issue}` }),
    runAgent: async (role, t) => role === 'reviewer' ? { verdict: 'approved', findings: [] } : { status: 'ready', summary: 'fixture', tests: ['pass'] },
    validateResult: async () => {}, ...overrides };
}

test('two independent workers are followed by fresh reviewers; owned marker is released', async (t) => {
  const root = fixture(t), events = [];
  let writers = 0, max = 0;
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture', lanes: 2 }, deps({
    runAgent: async (role, track) => {
      events.push(`${role}:${track.issue}`);
      if (role === 'worker') { writers++; max = Math.max(max, writers); await new Promise(r => setImmediate(r)); writers--; return { status: 'ready', tests: ['pass'] }; }
      return { verdict: 'approved', findings: [] };
    },
  }));
  assert.equal(max, 2);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every(r => r.state === 'ready'));
  for (const track of tracks) assert.ok(events.indexOf(`reviewer:${track.issue}`) > events.indexOf(`worker:${track.issue}`));
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
  assert.ok(existsSync(result.report));
});

test('blocking review gives the same worktree one fix pass and new independent review', async (t) => {
  const root = fixture(t), calls = [];
  let reviews = 0;
  const result = await runWave({ root, runDir: root, tracks: tracks.slice(0, 1), owner: 'fixture' }, deps({
    runAgent: async (role, track) => {
      calls.push([role, track.worktree]);
      if (role === 'reviewer') return ++reviews === 1
        ? { verdict: 'changes_requested', findings: ['fixture failure'] }
        : { verdict: 'approved', findings: [] };
      return { status: 'ready', tests: ['pass'] };
    },
  }));
  assert.deepEqual(calls.map(c => c[0]), ['worker', 'reviewer', 'fixer', 'reviewer']);
  assert.equal(new Set(calls.map(c => c[1])).size, 1);
  assert.equal(result.results[0].state, 'ready');
});

test('setup failure preserves report, does not dispatch, and cleans only owned marker', async (t) => {
  const root = fixture(t);
  let called = false;
  await assert.rejects(runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    prepare: async () => { throw Error('fixture setup failed'); },
    runAgent: async () => { called = true; },
  })), /setup failed/);
  assert.equal(called, false);
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
});

test('unobserved child termination retains marker and prevents unsafe cleanup', async (t) => {
  const root = fixture(t);
  const result = await runWave({ root, runDir: root, tracks: tracks.slice(0, 1), owner: 'fixture' }, deps({
    runAgent: async () => { const e = Error('stop unconfirmed'); e.terminationUnconfirmed = true; throw e; },
  }));
  assert.equal(result.results[0].state, 'blocked');
  assert.equal(existsSync(path.join(root, 'wave-active.json')), true);
  assert.equal(JSON.parse(readFileSync(result.report)).cleanup, 'retained-unconfirmed-child');
});

test('worker failure never becomes ready or reaches reviewer', async (t) => {
  const root = fixture(t), calls = [];
  const result = await runWave({ root, runDir: root, tracks: tracks.slice(0, 1), owner: 'fixture' }, deps({
    runAgent: async role => { calls.push(role); throw Error('fixture tests failed'); },
  }));
  assert.deepEqual(calls, ['worker']);
  assert.equal(result.results[0].state, 'blocked');
});

test('writer and reviewer invocation preserve selected cwd and distinct sandbox roles', () => {
  const t = { worktree: 'C:/fixture/worker', scratch: 'C:/fixture/scratch' };
  assert.ok(childArgs('worker', t, 'schema', 'out').includes('workspace-write'));
  assert.ok(childArgs('reviewer', t, 'schema', 'out').includes('read-only'));
  assert.ok(childArgs('reviewer', t, 'schema', 'out').includes(t.worktree));
  assert.equal(childArgs('worker', t, 'schema', 'out').includes('--dangerously-bypass-approvals-and-sandbox'), false);
});
