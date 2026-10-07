import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWave, childArgs } from './codex-wave.mjs';
import * as runner from './codex-wave.mjs';

const localAppData = 'C:\\Users\\Fixture\\AppData\\Local';
const appCli = `${localAppData}\\OpenAI\\Codex\\bin\\current\\codex.exe`;
const npmCli = 'C:\\Users\\Fixture\\AppData\\Roaming\\npm\\codex.ps1';
const command = sources => runner.codexCommand({ platform: 'win32', localAppData, discover: () => sources });

test('Windows discovery selects the app CLI when npm shims precede it on PATH', () => {
  assert.deepEqual(command([npmCli, npmCli.replace('.ps1', '.cmd'), appCli]), { file: appCli, prefix: [] });
});

test('app CLI discovery accepts Windows case and slash differences', () => {
  const executable = appCli.replaceAll('\\', '/').toUpperCase();
  assert.deepEqual(command([npmCli, executable]), { file: executable, prefix: [] });
});

test('an unrelated codex.exe does not masquerade as the app binary', () => {
  const unrelated = `${localAppData}\\OpenAI\\Codex\\bin-old\\codex.exe`;
  assert.deepEqual(command([npmCli, unrelated]), { file: 'pwsh', prefix: ['-NoProfile', '-File', npmCli] });
});

test('CLI-only Windows installations preserve PowerShell and executable fallback', () => {
  assert.deepEqual(command(npmCli), { file: 'pwsh', prefix: ['-NoProfile', '-File', npmCli] });
  const exe = 'C:\\Tools\\codex.exe';
  assert.deepEqual(command([exe]), { file: exe, prefix: [] });
});

test('missing CLI discovery fails before a child can be spawned', () => {
  assert.throws(() => command([]), /No Codex CLI found/);
});

test('non-Windows runner preserves PATH resolution without Windows discovery', () => {
  assert.deepEqual(runner.codexCommand({ platform: 'linux', discover: () => { assert.fail('unexpected discovery'); } }),
    { file: 'codex', prefix: [] });
});

const now = 1790000000000;
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cz-wave-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const tracks = [1, 2].map(issue => ({ issue, branch: `codex/${issue}-fixture`, title: 'Fixture', ownership: [`fixtures/${issue}`], tier: 'TARGETED', verifyCommands: ['node --test fixture.test.mjs'] }));
function deps(overrides = {}) {
  return { now: () => now, bootId: () => 'fixture-boot', readPrs: async () => [], prefilter: async () => {},
    prepare: async t => ({ ...t, worktree: `/fixture/${t.issue}` }),
    runAgent: async (role, t) => role === 'reviewer' ? { verdict: 'approved', findings: [] } : { status: 'ready', summary: 'fixture', tests: ['pass'] },
    verifyPermissions: async () => {}, validateResult: async () => {}, ...overrides };
}

test('dispatch counts open PRs, including parked drafts, but never rejects on count', async (t) => {
  const root = fixture(t);
  const prs = Array.from({ length: 6 }, (_, i) => ({ number: i + 10, headRefName: `parked/${i}`, isDraft: true }));
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({ readPrs: async () => prs }));
  assert.ok(result.results.every(r => r.state === 'ready'));
});

// Ejer-beslutning 22/9 (variant B, #5510): loftet paa 8 aabne PR'er er
// fjernet. En boelge maa ikke afvises fordi der allerede er 8+ aabne PR'er -
// lanerne (4) og verifikations-semaforen (2) er fortsat bremsen.
test('a wave is not rejected when 8 or more PRs are already open', async (t) => {
  const root = fixture(t);
  const prs = Array.from({ length: 10 }, (_, i) => ({ number: i + 20, headRefName: `parked/${i}`, isDraft: true }));
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({ readPrs: async () => prs }));
  assert.ok(result.results.every(r => r.state === 'ready'));
});

test('an unfetchable PR list still fails closed and dispatches nothing', async (t) => {
  const root = fixture(t);
  let called = false;
  await assert.rejects(runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    readPrs: async () => { throw Error('PR count unavailable'); },
    runAgent: async () => { called = true; },
  })), /PR count unavailable/);
  assert.equal(called, false);
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
});

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

test('Git metadata permission failure is caught before any writer dispatch', async t => {
  const root=fixture(t); let writers=0, prepared=0;
  await assert.rejects(runWave({root,runDir:root,tracks,owner:'fixture'},deps({
    prepare:async track => {prepared++;return {...track,worktree:'/fixture/owned'};},
    verifyPermissions:async () => {throw Error('Git metadata write probe failed');},
    runAgent:async () => {writers++;},
  })),/Git metadata write probe failed/);
  assert.equal(prepared,1); assert.equal(writers,0);
  assert.equal(existsSync(path.join(root,'wave-active.json')),false);
});

test('automatic approval review is limited to writable worker/fixer roles', () => {
  const track={worktree:'/fixture',scratch:'/scratch'};
  for(const role of ['worker','fixer']) assert.ok(childArgs(role,track,'schema','out').includes('--approve-for-me'));
  assert.equal(childArgs('reviewer',track,'schema','out').includes('--approve-for-me'),false);
  assert.equal(childArgs('worker',{...track,kind:'investigate'},'schema','out').includes('--approve-for-me'),false);
});

test('setup is marked before it can launch worktree or dependency subprocesses', async t => {
  const root = fixture(t);
  await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    prepare: async track => {
      assert.equal(JSON.parse(readFileSync(path.join(root, 'wave-active.json'))).dispatchStarted, true);
      return { ...track, worktree: `/fixture/${track.issue}` };
    },
  }));
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
  assert.ok(childArgs('worker', t, 'schema', 'out').includes('--approve-for-me'));
  assert.equal(childArgs('worker', t, 'schema', 'out').includes('--sandbox'), false);
  assert.ok(childArgs('reviewer', t, 'schema', 'out').includes('read-only'));
  assert.ok(childArgs('reviewer', t, 'schema', 'out').includes(t.worktree));
  assert.equal(childArgs('worker', t, 'schema', 'out').includes('--dangerously-bypass-approvals-and-sandbox'), false);
});

test('Codex child receives explicit runtime even with a Claude parent and no Codex session variables', async () => {
  const { spawnSync } = await import('node:child_process');
  const inherited = { ...process.env, CZ_VERIFY_RUNTIME: 'claude' };
  delete inherited.CODEX_THREAD_ID; delete inherited.CODEX_SESSION_ID;
  const options = runner.agentSpawnOptions(process.cwd(), 'fixture-wave', inherited);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({runtime:process.env.CZ_VERIFY_RUNTIME,wave:process.env.CZ_WAVE_ID}))'], { ...options, encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { runtime: 'codex', wave: 'fixture-wave' });
});
