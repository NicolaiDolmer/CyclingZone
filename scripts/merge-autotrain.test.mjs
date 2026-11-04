// Tests for scripts/merge-autotrain.mjs (#7654).
// Koer: node --test scripts/merge-autotrain.test.mjs

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  ALERT_THROTTLE_MS,
  READY_ALERT_AFTER_MS,
  buildAlertMessage,
  completeFileList,
  confirmBeforeQueue,
  decideAction,
  dueAlerts,
  evaluatePr,
  hasOwnerMergeApproval,
  mainVerifiedFromRuns,
  markAlerted,
  parseArgs,
  requiredChecksStatus,
  reviewGateStatus,
  run,
  selectTrain,
  updateReadyState,
} from './merge-autotrain.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = 'NicolaiDolmer';
const GREEN_REQUIRED = [{ name: 'backend-tests', bucket: 'pass' }, { name: 'gitleaks', bucket: 'pass' }];
const GREEN_ALL = [{ name: 'review-gate', bucket: 'pass', event: 'pull_request_target', startedAt: '2026-11-04T10:00:00Z' }];
const STANDING = { category: 'c', label: '(c) Dependabot/docs/CI-hooks-test', reason: 'docs uden spillertekst', ownerGo: false };
const OWNER_GO = { category: 'ejer-go', label: 'kraever ejer-go', reason: 'UI: frontend/src/x.jsx', ownerGo: true };

function pr(overrides = {}) {
  return { number: 100, title: 'docs: noget', isDraft: false, baseRefName: 'main', mergeable: 'MERGEABLE', headRefOid: HEAD, labels: [], comments: [], ...overrides };
}

function evalWith(overrides = {}, ctx = {}) {
  return evaluatePr(pr(overrides), { requiredChecks: GREEN_REQUIRED, allChecks: GREEN_ALL, classification: STANDING, ownerLogin: OWNER, ...ctx });
}

describe('requiredChecksStatus', () => {
  it('groen naar alle er pass/skipping og mindst een er pass', () => {
    assert.equal(requiredChecksStatus([...GREEN_REQUIRED, { name: 's', bucket: 'skipping' }]).green, true);
  });
  it('tom liste, kun skipping, pending og fail er ikke groen', () => {
    assert.equal(requiredChecksStatus([]).green, false);
    assert.equal(requiredChecksStatus(null).green, false);
    assert.equal(requiredChecksStatus([{ name: 's', bucket: 'skipping' }]).green, false);
    assert.match(requiredChecksStatus([{ name: 'ci', bucket: 'pending' }]).reason, /afventer/);
    assert.match(requiredChecksStatus([{ name: 'ci', bucket: 'fail' }]).reason, /roed/);
  });
});

describe('reviewGateStatus', () => {
  it('kun pull_request_target taeller', () => {
    assert.equal(reviewGateStatus([{ name: 'review-gate', bucket: 'pass', event: 'pull_request' }]).green, false);
    assert.equal(reviewGateStatus([]).green, false);
  });
  it('nyeste koersel afgoer', () => {
    const runs = [
      { name: 'review-gate', bucket: 'pass', event: 'pull_request_target', startedAt: '2026-11-04T09:00:00Z' },
      { name: 'review-gate', bucket: 'fail', event: 'pull_request_target', startedAt: '2026-11-04T10:00:00Z' },
    ];
    assert.equal(reviewGateStatus(runs).green, false);
    assert.equal(reviewGateStatus([runs[1], { ...runs[0], startedAt: '2026-11-04T11:00:00Z' }]).green, true);
  });
  it('en koersel uden starttid regnes som nyest (som league-check.ps1)', () => {
    const runs = [
      { name: 'review-gate', bucket: 'pass', event: 'pull_request_target', startedAt: '2026-11-04T10:00:00Z' },
      { name: 'review-gate', bucket: 'pending', event: 'pull_request_target', startedAt: '0001-01-01T00:00:00Z' },
    ];
    assert.match(reviewGateStatus(runs).reason, /afventer/);
  });
});

describe('hasOwnerMergeApproval', () => {
  const marker = (sha) => `ok <!-- merge-autotrain: ejer-merge sha=${sha} -->`;
  it('kraever ejerens konto og nuvaerende hoved', () => {
    assert.equal(hasOwnerMergeApproval([{ author: { login: OWNER }, body: marker(HEAD.slice(0, 7)) }], { headSha: HEAD, ownerLogin: OWNER }), true);
    assert.equal(hasOwnerMergeApproval([{ author: { login: 'someone-else' }, body: marker(HEAD) }], { headSha: HEAD, ownerLogin: OWNER }), false);
    assert.equal(hasOwnerMergeApproval([{ author: { login: OWNER }, body: marker('b'.repeat(40)) }], { headSha: HEAD, ownerLogin: OWNER }), false);
  });
  it('den klaebende klassifikator-markoer er IKKE et go', () => {
    const sticky = '<!-- merge-queue-category: ejer-go -->';
    assert.equal(hasOwnerMergeApproval([{ author: { login: OWNER }, body: sticky }], { headSha: HEAD, ownerLogin: OWNER }), false);
  });
});

describe('evaluatePr (udvaelgelse)', () => {
  it('groen staaende kategori er klar og med i toget', () => {
    const e = evalWith();
    assert.equal(e.ready, true);
    assert.equal(e.eligible, true);
  });
  it('draft, anden base, hold-label og konflikt afvises', () => {
    assert.equal(evalWith({ isDraft: true }).ready, false);
    assert.equal(evalWith({ baseRefName: 'develop' }).ready, false);
    assert.equal(evalWith({ labels: [{ name: 'claude:blocked' }] }).ready, false);
    assert.equal(evalWith({ mergeable: 'CONFLICTING' }).ready, false);
    assert.equal(evalWith({ mergeable: 'UNKNOWN' }).ready, false);
  });
  it('roede/afventende checks eller review-gate afvises', () => {
    assert.equal(evalWith({}, { requiredChecks: [{ name: 'ci', bucket: 'fail' }] }).ready, false);
    assert.equal(evalWith({}, { allChecks: [] }).ready, false);
  });
  it('ejer-go er klar (til alarmen) men ikke med i toget uden markoer', () => {
    const e = evalWith({}, { classification: OWNER_GO });
    assert.equal(e.ready, true);
    assert.equal(e.eligible, false);
  });
  it('ejer-go med ejerens markoer paa hovedet er med', () => {
    const comments = [{ author: { login: OWNER }, body: `<!-- merge-autotrain: ejer-merge sha=${HEAD} -->` }];
    assert.equal(evalWith({ comments }, { classification: OWNER_GO }).eligible, true);
  });
  it('manglende klassifikation behandles som ejer-go', () => {
    const e = evalWith({}, { classification: null });
    assert.equal(e.ready, true);
    assert.equal(e.eligible, false);
  });
  it('selectTrain tager kun eligible, sorteret', () => {
    const list = [evalWith({ number: 9 }), evalWith({ number: 3 }), evalWith({ number: 5 }, { classification: OWNER_GO })];
    assert.deepEqual(selectTrain(list), [3, 9]);
  });
});

describe('completeFileList', () => {
  it('kraever at REST-listen er komplet (ellers null = ejer-go)', () => {
    const pages = [[{ filename: 'docs/a.md', additions: 1, deletions: 0 }]];
    assert.deepEqual(completeFileList(pages, 1), [{ path: 'docs/a.md', additions: 1, deletions: 0 }]);
    assert.equal(completeFileList(pages, 2), null);
    assert.equal(completeFileList([], 0), null);
    assert.equal(completeFileList(null, 1), null);
  });
  it('omdoebning vurderes ogsaa paa kildestien', () => {
    const files = completeFileList([[{ filename: 'docs/moved.js', previous_filename: 'backend/lib/economy.js', additions: 0, deletions: 0, status: 'renamed' }]], 1);
    assert.deepEqual(files.map((f) => f.path), ['docs/moved.js', 'backend/lib/economy.js']);
    assert.ok(files[1].deletions > 0, 'kildestien taeller som slettet');
  });
});

describe('confirmBeforeQueue', () => {
  const selected = evalWith({ number: 5 });
  it('ok naar PR\'en stadig er eligible paa samme hoved', () => {
    assert.equal(confirmBeforeQueue(selected, selected).ok, true);
  });
  it('afvist ved nyt hoved eller tabt klarhed', () => {
    assert.match(confirmBeforeQueue(selected, { ...selected, headSha: 'e'.repeat(40) }).reason, /flyttet/);
    assert.equal(confirmBeforeQueue(selected, { ...selected, eligible: false, reason: 'checks: roed' }).ok, false);
    assert.equal(confirmBeforeQueue(selected, null).ok, false);
  });
});

describe('decideAction (koe koerer allerede)', () => {
  it('levende markoer = goer intet, selv med klare PRer', () => {
    const d = decideAction({ activeMarker: { pid: 1, startedAt: '2026-11-04T10:00:00Z' }, train: [1, 2] });
    assert.equal(d.run, false);
    assert.match(d.reason, /koerer allerede/);
  });
  it('ingen markoer + tom liste = ingen koe; ellers koe', () => {
    assert.equal(decideAction({ activeMarker: null, train: [] }).run, false);
    assert.equal(decideAction({ activeMarker: null, train: [4] }).run, true);
  });
});

describe('alarm: klar-ur og throttle', () => {
  const t0 = new Date('2026-11-04T08:00:00Z');
  const at = (ms) => new Date(t0.getTime() + ms);
  const ready = evalWith({ number: 7 }, { classification: OWNER_GO });

  it('ingen alarm foer 2 timer, alarm efter', () => {
    let state = updateReadyState(null, [ready], t0);
    assert.equal(dueAlerts(state, [ready], at(READY_ALERT_AFTER_MS - 60_000)).length, 0);
    state = updateReadyState(state, [ready], at(READY_ALERT_AFTER_MS + 1));
    const due = dueAlerts(state, [ready], at(READY_ALERT_AFTER_MS + 1));
    assert.deepEqual(due.map((d) => d.number), [7]);
  });

  it('hoejst een besked pr. PR pr. 6 timer', () => {
    let state = updateReadyState(null, [ready], t0);
    const first = at(READY_ALERT_AFTER_MS + 1);
    state = markAlerted(updateReadyState(state, [ready], first), [7], first);
    const soon = at(READY_ALERT_AFTER_MS + ALERT_THROTTLE_MS - 60_000);
    assert.equal(dueAlerts(updateReadyState(state, [ready], soon), [ready], soon).length, 0);
    const later = at(READY_ALERT_AFTER_MS + ALERT_THROTTLE_MS + 1);
    assert.equal(dueAlerts(updateReadyState(state, [ready], later), [ready], later).length, 1);
  });

  it('throttlen overlever et kort roedt mellemspil; klar-uret starter forfra', () => {
    let state = updateReadyState(null, [ready], t0);
    const first = at(READY_ALERT_AFTER_MS + 1);
    state = markAlerted(updateReadyState(state, [ready], first), [7], first);
    const red = { ...ready, ready: false };
    state = updateReadyState(state, [red], at(READY_ALERT_AFTER_MS + 60_000));
    assert.ok(state.prs[7].lastAlertAt);
    assert.equal(state.prs[7].readySince, undefined);
    const back = at(READY_ALERT_AFTER_MS + 120_000);
    state = updateReadyState(state, [ready], back);
    assert.equal(state.prs[7].readySince, back.toISOString());
  });

  it('nyt hoved nulstiller klar-uret', () => {
    let state = updateReadyState(null, [ready], t0);
    const moved = { ...ready, headSha: 'c'.repeat(40) };
    state = updateReadyState(state, [moved], at(READY_ALERT_AFTER_MS + 1));
    assert.equal(dueAlerts(state, [moved], at(READY_ALERT_AFTER_MS + 1)).length, 0);
  });

  it('lukkede PRer falder ud af tilstanden', () => {
    const state = updateReadyState(updateReadyState(null, [ready], t0), [], at(1000));
    assert.deepEqual(state.prs, {});
  });

  it('en eligible PR der stadig er klar efter 2 timer meldes (toget har fejlet for den)', () => {
    const eligible = evalWith({ number: 8 });
    const state = updateReadyState(updateReadyState(null, [eligible], t0), [eligible], at(READY_ALERT_AFTER_MS + 1));
    const due = dueAlerts(state, [eligible], at(READY_ALERT_AFTER_MS + 1));
    assert.deepEqual(due.map((d) => d.number), [8]);
    assert.match(buildAlertMessage(due).content, /staaende kategori, men ikke merget/);
  });

  it('beskeden naevner PR, ventetid og grund', () => {
    const msg = buildAlertMessage([{ ...ready, title: 'feat: x', waitedMs: READY_ALERT_AFTER_MS + 5 * 60_000 }], 'o/r');
    assert.match(msg.content, /#7 feat: x/);
    assert.match(msg.content, /venter paa ejer-go/);
    assert.match(msg.content, /github\.com\/o\/r\/pull\/7/);
  });
});

describe('run (IO injiceret)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-autotrain-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const quiet = () => {};

  const NOW = new Date('2026-11-04T12:00:00Z');
  const sameAgain = (selected) => (n) => selected.find((e) => e.number === n);

  it('levende tog-markoer: ingen vurdering, ingen koe', async () => {
    let evaluated = false;
    let queued = false;
    const res = await run({
      argv: [], now: NOW, repoRoot: dir, stateFile: join(dir, 's1.json'), out: quiet,
      readMarker: () => ({ pid: 42, startedAt: '2026-11-04T11:50:00Z', prs: [1], merged: [] }),
      evaluate: () => { evaluated = true; return []; },
      runQueue: () => { queued = true; return 0; },
    });
    assert.equal(res.action, 'skip-active');
    assert.equal(evaluated, false);
    assert.equal(queued, false);
  });

  it('dry-run: ingen koe, ingen Discord, ingen tilstand', async () => {
    let queued = false;
    let posted = false;
    const stateFile = join(dir, 's2.json');
    const res = await run({
      argv: ['--dry-run'], env: { DISCORD_OPS_WEBHOOK_URL: 'https://example.invalid/hook' }, now: NOW, repoRoot: dir, stateFile, out: quiet,
      readMarker: () => null,
      evaluate: () => [evalWith({ number: 11 })],
      runQueue: () => { queued = true; return 0; },
      fetchFn: async () => { posted = true; return { ok: true }; },
    });
    assert.equal(res.action, 'dry-run');
    assert.deepEqual(res.train, [11]);
    assert.equal(queued, false);
    assert.equal(posted, false);
    assert.throws(() => readFileSync(stateFile, 'utf8'));
  });

  it('koerer koeen een PR ad gangen med -Repo og melder ventende ejer-go-PR (fail-soft ved Discord-fejl)', async () => {
    const stateFile = join(dir, 's3.json');
    const t0 = new Date('2026-11-04T08:00:00Z');
    let current = [evalWith({ number: 21 }), evalWith({ number: 23 }), evalWith({ number: 22 }, { classification: OWNER_GO })];
    const calls = [];
    const base = {
      argv: ['--repo', 'o/r'],
      env: { DISCORD_OPS_WEBHOOK_URL: 'https://example.invalid/hook' }, repoRoot: dir, stateFile, out: quiet,
      readMarker: () => null, evaluate: () => current, reevaluate: (n) => current.find((e) => e.number === n),
      runQueue: ({ train, repo }) => { calls.push({ train, repo }); return 0; },
    };
    const first = await run({ ...base, now: t0, fetchFn: async () => ({ ok: true }) });
    assert.deepEqual(calls, [{ train: [21], repo: 'o/r' }, { train: [23], repo: 'o/r' }]);
    assert.deepEqual(first.queued, [21, 23]);
    // De to er merget; kun ejer-go-PR'en er tilbage.
    current = [current[2]];
    // Discord fejler: ingen markering, saa naeste koersel proever igen.
    const late = new Date(t0.getTime() + READY_ALERT_AFTER_MS + 1);
    const failed = await run({ ...base, now: late, fetchFn: async () => { throw new Error('net'); } });
    assert.deepEqual(failed.alerts.map((a) => a.number), [22]);
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).prs[22].lastAlertAt, undefined);
    let bodies = [];
    const sent = await run({ ...base, now: late, fetchFn: async (_u, init) => { bodies.push(init.body); return { ok: true }; } });
    assert.deepEqual(sent.alerts.map((a) => a.number), [22]);
    assert.equal(bodies.length, 1);
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).prs[22].lastAlertAt, late.toISOString());
    bodies = [];
    await run({ ...base, now: new Date(late.getTime() + 20 * 60_000), fetchFn: async (_u, init) => { bodies.push(init.body); return { ok: true }; } });
    assert.equal(bodies.length, 0, 'throttlet inden for 6 timer');
  });

  it('nyt hoved efter udvaelgelsen: PR\'en springes over (arver ikke kategori eller ejer-go)', async () => {
    const selected = [evalWith({ number: 31 }), evalWith({ number: 32 })];
    const calls = [];
    const res = await run({
      argv: [], now: NOW, repoRoot: dir, stateFile: join(dir, 's5.json'), out: quiet,
      readMarker: () => null, evaluate: () => selected,
      reevaluate: (n) => (n === 31 ? { ...selected[0], headSha: 'd'.repeat(40) } : selected[1]),
      runQueue: ({ train }) => { calls.push(train); return 0; },
    });
    assert.deepEqual(calls, [[32]]);
    assert.deepEqual(res.queued, [32]);
  });

  it('en anden koe der starter undervejs stopper resten', async () => {
    const selected = [evalWith({ number: 41 }), evalWith({ number: 42 })];
    let markerReads = 0;
    const calls = [];
    await run({
      argv: [], now: NOW, repoRoot: dir, stateFile: join(dir, 's6.json'), out: quiet,
      // 1. laesning: ingen koe. 2. (foer #41): ingen. 3. (foer #42): en anden koe koerer.
      readMarker: () => (++markerReads >= 3 ? { pid: 7, startedAt: '2026-11-04T11:59:00Z', prs: [], merged: [] } : null),
      evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: ({ train }) => { calls.push(train); return 0; },
    });
    assert.deepEqual(calls, [[41]]);
  });

  it('Codex P1 #7657: koeen faar det vurderede hoved med (-ExpectHead)', async () => {
    const selected = [evalWith({ number: 51 })];
    const calls = [];
    await run({
      argv: [], now: NOW, repoRoot: dir, stateFile: join(dir, 's7.json'), blockFile: join(dir, 'b7.json'), out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: ({ train, expectHead }) => { calls.push({ train, expectHead }); return 0; },
    });
    assert.deepEqual(calls, [{ train: [51], expectHead: selected[0].headSha }]);
    const ps = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
    assert.ok(ps.includes('[string] $ExpectHead') && ps.includes('$fresh.headSha -ne $ExpectHead'), 'merge-queue.ps1 stopper ved et andet hoved end det godkendte');
    assert.ok(ps.includes('$recheck.headSha -ne $ExpectHead'), 'og igen lige foer merge (efter ventetid/baseline-loesning)');
  });

  it('Codex P1 #7657: exit != 0 stopper toget og laaser, til main er verificeret', async () => {
    const blockFile = join(dir, 'b8.json');
    const selected = [evalWith({ number: 61 }), evalWith({ number: 62 })];
    const calls = [];
    const base = {
      argv: [], now: NOW, repoRoot: dir, stateFile: join(dir, 's8.json'), blockFile, out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
    };
    const first = await run({ ...base, runQueue: ({ train }) => { calls.push(train); return 75; } });
    assert.deepEqual(calls, [[61]], 'ingen naeste PR efter en fejlet/uverificeret koe');
    assert.deepEqual(first.results, [{ pr: 61, exit: 75 }]);
    assert.equal(JSON.parse(readFileSync(blockFile, 'utf8')).pr, 61);
    const blocked = await run({ ...base, checkMain: () => ({ ok: false, reason: 'CI koerer' }), runQueue: () => { throw new Error('maa ikke kaldes'); } });
    assert.equal(blocked.action, 'blocked');
    assert.ok(existsSync(blockFile), 'laasen holder paa tvaers af koersler');
    const lifted = await run({ ...base, checkMain: () => ({ ok: true, reason: 'groen' }), runQueue: ({ train }) => { calls.push(train); return 0; } });
    assert.equal(lifted.action, 'queue');
    assert.ok(!existsSync(blockFile), 'laasen haeves foerst ved positiv verifikation');
  });

  it('mainVerifiedFromRuns: CI skal vaere groen, og en deploy skal vaere released med groenne release checks', () => {
    const sha = 'a'.repeat(40);
    const green = [{ headSha: sha, status: 'completed', conclusion: 'success' }];
    assert.equal(mainVerifiedFromRuns({ headSha: sha, ciRuns: [] }).ok, false);
    assert.equal(mainVerifiedFromRuns({ headSha: sha, ciRuns: [{ headSha: sha, status: 'in_progress', conclusion: '' }] }).ok, false);
    assert.equal(mainVerifiedFromRuns({ headSha: sha, ciRuns: [{ headSha: sha, status: 'completed', conclusion: 'failure' }] }).ok, false);
    assert.equal(mainVerifiedFromRuns({ headSha: sha, ciRuns: green }).ok, true, 'ingen deploy-koersel = kun CI');
    assert.equal(mainVerifiedFromRuns({ headSha: 'x', ciRuns: [] }).ok, false);
    const run = { id: 9, run_attempt: 1, status: 'completed', head_sha: sha };
    const job = (name, conclusion, steps) => ({ run_id: 9, run_attempt: 1, name, status: 'completed', conclusion, steps });
    const step = (name, conclusion) => ({ name, status: 'completed', conclusion });
    const release = (pending, smoke) => job('Deploy live + smoke', 'success', [step('Deployment still pending', pending), step('Smoke-test prod', smoke)]);
    // Codex P1: "Deployment still pending" slutter groent, men er ikke en verificeret deploy.
    const stillPending = { run, jobs: { jobs: [release('success', 'skipped'), job('Release checks', 'success', [])] } };
    const r1 = mainVerifiedFromRuns({ headSha: sha, ciRuns: green, deploy: stillPending });
    assert.equal(r1.ok, false);
    assert.match(r1.reason, /pending/);
    const releasedRedChecks = { run, jobs: { jobs: [release('skipped', 'success'), job('Release checks', 'failure', [])] } };
    assert.equal(mainVerifiedFromRuns({ headSha: sha, ciRuns: green, deploy: releasedRedChecks }).ok, false);
    const released = { run, jobs: { jobs: [release('skipped', 'success'), job('Release checks', 'success', [])] } };
    assert.equal(mainVerifiedFromRuns({ headSha: sha, ciRuns: green, deploy: released }).ok, true);
  });

  it('fejl i PR-listningen er fail-soft', async () => {
    const res = await run({
      argv: [], now: NOW, repoRoot: dir, stateFile: join(dir, 's4.json'), out: quiet,
      readMarker: () => null, evaluate: () => { throw new Error('gh nede'); }, runQueue: () => { throw new Error('maa ikke kaldes'); },
    });
    assert.equal(res.action, 'error');
  });

  it('parseArgs', () => {
    assert.deepEqual(parseArgs(['--dry-run', '--log', '--repo', 'o/r']), { dryRun: true, log: true, repo: 'o/r' });
  });
});
