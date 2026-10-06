import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as freeze from './wave-freeze.mjs';

const source = readFileSync(new URL('../.claude/workflows/wave.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', 'setTimeout', 'clearTimeout',
  source.replace('export const meta =', 'const meta ='));
const branch = 'codex/recovery-fixture';

function harness(builds, { review = 'GODKENDT', probe = 'hard-cap' } = {}) {
  const calls = [], logs = [], timers = new Map();
  let timerId = 0, buildIndex = 0;
  const agent = async (prompt, options) => {
    calls.push({ prompt, ...options });
    if (options.phase === 'Fase 0 - opsaetning') return { ok: true, waveId: 'fixture-wave', lanes: [{ branch, ready: true }] };
    if (options.phase === 'Oprydning') return { activeFileRemoved: true, watchStopped: true, pendingNeverTaken: [], markerTracks: [] };
    if (options.phase === 'Review') {
      if (options.label.startsWith('ret ')) return 'Fixed in the same worktree';
      return { verdict: review, summary: 'fixture', pr: 'none', findings: review === 'BLOKERENDE' ? [{ severity: 'blokerende', what: 'Fixture bug', file: 'scripts/x.mjs' }] : [] };
    }
    if (options.label.startsWith('frys-probe ')) return typeof probe === 'function' ? probe() : { ok: true, verdict: probe, reason: 'fixture', lastCommitAgeMinutes: 1, extendMinutes: 5, stopsWave: false, dirty: false, unpushed: 0 };
    const result = builds[buildIndex++];
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result() : result;
  };
  const run = execute({ tracks: [{ issue: 6227, branch, title: 'fixture', ownership: ['scripts/x.mjs'] }], lanes: 1, rollingIntake: false },
    agent, tasks => Promise.all(tasks.map(task => task())), () => {}, value => logs.push(value),
    (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, id => timers.delete(id));
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const fireWindow = async () => {
    await flush();
    const entry = [...timers].find(([, timer]) => timer.ms > 60_000);
    assert.ok(entry, 'An actual builder waiting window must exist');
    timers.delete(entry[0]); entry[1].fn();
    await flush();
  };
  return { run, calls, logs, timers, flush, fireWindow, builders: () => calls.filter(call => call.phase === 'Laner' && call.label.startsWith('#6227')) };
}

test('pure recovery classification accepts only terminal API envelopes', () => {
  const classify = freeze.classifyBuildRecoveryFailure;
  assert.equal(typeof classify, 'function');
  for (const status of [529, 503]) assert.equal(classify({ settled: true, error: Error(`API Error: ${status} Unavailable`) }).reason, `api-${status}`);
  for (const outcome of [{ settled: false, error: Error('API Error: 529 Overloaded') },
    { settled: true, value: 'Fixed earlier API Error: 529', error: null },
    { settled: true, error: Error('request timed out') }, { settled: true, value: null, error: null },
    { settled: true, error: Error('API Error: response timeout') }]) assert.equal(classify(outcome), null);
});

test('actual workflow resumes rejected 529 exactly once, in the same worktree, then reviews', async () => {
  const h = harness([Error('API Error: 529 Overloaded'), 'Built']);
  const result = await h.run;
  assert.equal(h.builders().length, 2);
  assert.match(h.builders()[1].prompt, /recovery 1\/1/);
  assert.ok(h.builders()[1].prompt.includes(result.tracks[0].recovery.worktree));
  assert.equal(h.calls.filter(call => call.phase === 'Review').length, 1);
  assert.equal(result.tracks[0].review, 'GODKENDT');
  assert.equal(result.tracks[0].recovery.review, 'GODKENDT');
});

test('actual workflow resumes a returned single-line API error', async () => {
  const h = harness(['API Error: 529 Overloaded', 'Built']);
  const result = await h.run;
  assert.equal(h.builders().length, 2);
  assert.equal(result.tracks[0].review, 'GODKENDT');
});

test('a second terminal failure stops without a third builder and retains recovery evidence', async () => {
  const h = harness([Error('API Error: 503 Unavailable'), Error('API Error: 529 Overloaded')]);
  const result = await h.run;
  assert.equal(h.builders().length, 2);
  assert.equal(h.calls.filter(call => call.phase === 'Review').length, 0);
  assert.equal(result.tracks[0].status, 'fejl');
  assert.equal(result.stopped[0].recovery.outcome, 'exhausted');
});

test('ordinary exceptions and unconfirmed timeouts do not start recovery', async () => {
  for (const error of [Error('Tests failed'), Error('API Error: response timeout')]) {
    const h = harness([error]); const result = await h.run;
    assert.equal(h.builders().length, 1);
    assert.equal(result.tracks[0].status, 'fejl');
    assert.equal(result.tracks[0].recovery, undefined);
  }
});

test('explicit terminal timeout can resume, successful reports quoting old failures cannot', async () => {
  const timeout = Object.assign(Error('API Error: response timeout'), { terminalConfirmed: true });
  const resumed = harness([timeout, 'Built']); await resumed.run;
  assert.equal(resumed.builders().length, 2);
  const handled = harness(['Handled an earlier API Error: 529; tests passed']); await handled.run;
  assert.equal(handled.builders().length, 1);
});

test('recovered work receives the normal blocking-review fix step', async () => {
  const h = harness([Error('API Error: 529 Overloaded'), 'Built'], { review: 'BLOKERENDE' });
  const result = await h.run;
  assert.equal(result.tracks[0].status, 'rettet');
  assert.equal(h.calls.filter(call => call.label.startsWith('ret ')).length, 1);
});

test('local waiting-window expiry leaves the same writer alive without recovery', async () => {
  const h = harness([() => new Promise(() => {})]);
  await h.fireWindow(); const result = await h.run;
  assert.equal(h.builders().length, 1);
  assert.equal(result.tracks[0].status, 'timeout');
  assert.equal(result.tracks[0].recovery, undefined);
});

test('extension continues waiting on the original builder and reviews it when it returns', async () => {
  let finish;
  const h = harness([() => new Promise(resolve => { finish = resolve; })], { probe: 'extend' });
  await h.fireWindow(); finish('Built'); const result = await h.run;
  assert.equal(h.builders().length, 1);
  assert.equal(result.tracks[0].review, 'GODKENDT');
});

test('recovery waiting-window timeout never launches a third writer', async () => {
  const h = harness([Error('API Error: 529 Overloaded'), () => new Promise(() => {})]);
  await h.fireWindow(); const result = await h.run;
  assert.equal(h.builders().length, 2);
  assert.equal(result.tracks[0].status, 'timeout');
});

test('recovery keeps time already charged for an expired builder window and probe', async () => {
  let rejectFirst, finishSecond;
  const h = harness([
    () => new Promise((_, reject) => { rejectFirst = reject; }),
    () => new Promise(resolve => { finishSecond = resolve; }),
  ], { probe: 'extend' });
  await h.fireWindow();
  rejectFirst(Error('API Error: 529 Overloaded'));
  await h.flush();
  const windows = [...h.timers.values()].filter(timer => timer.ms > 60_000);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].ms, 55 * 60_000, '180 cap minus original 120 window and 5-minute probe');
  finishSecond('Built');
  const result = await h.run;
  assert.equal(result.tracks[0].review, 'GODKENDT');
});

test('terminal API failure at the original hard cap never starts recovery', async () => {
  let rejectFirst;
  const h = harness([() => new Promise((_, reject) => { rejectFirst = reject; })]);
  await h.flush();
  for (let minute = 0; minute < freeze.WAVE_FREEZE.TRACK_HARD_CAP_MINUTES; minute++) {
    const clockTick = [...h.timers].find(([, timer]) => timer.ms === 60_000);
    assert.ok(clockTick, 'The injected minute clock must be active');
    h.timers.delete(clockTick[0]); clockTick[1].fn();
  }
  rejectFirst(Error('API Error: 529 Overloaded'));
  const result = await h.run;
  assert.equal(h.builders().length, 1);
  assert.equal(result.tracks[0].recovery.outcome, 'budget-exhausted');
  assert.equal(h.calls.filter(call => call.phase === 'Review').length, 0);
});

test('a recovery completed during a pre-cap frozen probe still receives review', async () => {
  let finishBuild, finishProbe;
  const h = harness([Error('API Error: 529 Overloaded'), () => new Promise(resolve => { finishBuild = resolve; })],
    { probe: () => new Promise(resolve => { finishProbe = resolve; }) });
  await h.fireWindow();
  finishBuild('Built'); await h.flush();
  finishProbe({ ok: true, verdict: 'frozen', reason: 'fixture', lastCommitAgeMinutes: 50, stopsWave: true, dirty: false, unpushed: 0 });
  const result = await h.run;
  assert.equal(h.builders().length, 2);
  assert.equal(result.tracks[0].recovery.outcome, 'completed');
  assert.equal(result.tracks[0].review, 'GODKENDT');
});

test('an original builder API error during a pre-cap probe is consumed and resumed once', async () => {
  let rejectBuild, finishProbe;
  const h = harness([() => new Promise((_, reject) => { rejectBuild = reject; }), 'Built'],
    { probe: () => new Promise(resolve => { finishProbe = resolve; }) });
  await h.fireWindow();
  rejectBuild(Error('API Error: 529 Overloaded')); await h.flush();
  finishProbe({ ok: true, verdict: 'frozen', reason: 'fixture', lastCommitAgeMinutes: 50, stopsWave: true, dirty: false, unpushed: 0 });
  const result = await h.run;
  assert.equal(h.builders().length, 2);
  assert.equal(result.tracks[0].review, 'GODKENDT');
});
