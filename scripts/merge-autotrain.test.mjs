// Tests for scripts/merge-autotrain.mjs (#7654).
// Koer: node --test scripts/merge-autotrain.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  QUEUE_CI_TIMEOUT_MINUTES,
  TRAIN_MAX_BATCH,
  completeFileList,
  confirmBeforeQueue,
  decideAction,
  deployImpact,
  evaluatePr,
  hasOwnerMergeApproval,
  mainVerifiedFromRuns,
  parseArgs,
  queueArgs,
  requiredChecksStatus,
  reviewGateStatus,
  run,
  selectTrain,
} from './merge-autotrain.mjs';
import {
  ALERT_AFTER_RUNS,
  REASON,
  guardFindings,
  hookLines,
  latestOwnerMarkerSha,
  needsCiFacts,
  nextGuardState,
  restartCandidates,
  runMergeGuard,
} from './merge-guard.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = 'NicolaiDolmer';
const GREEN_REQUIRED = [{ name: 'backend-tests', bucket: 'pass' }, { name: 'gitleaks', bucket: 'pass' }];
const GREEN_ALL = [{ name: 'review-gate', bucket: 'pass', event: 'pull_request_target', startedAt: '2026-11-04T10:00:00Z' }];
const STANDING = { category: 'c', label: '(c) Dependabot/docs/CI-hooks-test', reason: 'docs uden spillertekst', ownerGo: false };
const OWNER_GO = { category: 'ejer-go', label: 'kraever ejer-go', reason: 'UI: frontend/src/x.jsx', ownerGo: true };

function pr(overrides = {}) {
  return { number: 100, title: 'docs: noget', isDraft: false, baseRefName: 'main', mergeable: 'MERGEABLE', headRefOid: HEAD, labels: [], comments: [], ...overrides };
}

const QUIET = { deploys: false, solo: false };
const DEPLOYS = { deploys: true, solo: false };

function evalWith(overrides = {}, ctx = {}) {
  return evaluatePr(pr(overrides), { requiredChecks: GREEN_REQUIRED, allChecks: GREEN_ALL, classification: STANDING, ownerLogin: OWNER, deploy: QUIET, ...ctx });
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
  it('ejer-go er klar men ikke med i toget uden markoer', () => {
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

describe('#8331 eet samlet tog + deploy-reglen', () => {
  it('op til TRAIN_MAX_BATCH (5) PR\'er i eet tog, aeldste foerst', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => evalWith({ number: n }));
    assert.equal(TRAIN_MAX_BATCH, 5);
    assert.deepEqual(selectTrain(list), [1, 2, 3, 4, 5]);
  });
  it('hoejst een deploy-PR (den aeldste), og den sidst i toget', () => {
    const list = [
      evalWith({ number: 10 }, { deploy: DEPLOYS }),
      evalWith({ number: 11 }),
      evalWith({ number: 12 }, { deploy: DEPLOYS }),
      evalWith({ number: 13 }),
    ];
    assert.deepEqual(selectTrain(list), [11, 13, 10]);
  });
  it('fuldt tog: deploy-PR\'en faar sin plads, de stille venter', () => {
    const list = [evalWith({ number: 1 }, { deploy: DEPLOYS }), ...[2, 3, 4, 5, 6].map((n) => evalWith({ number: n }))];
    assert.deepEqual(selectTrain(list), [2, 3, 4, 5, 1]);
    assert.deepEqual(selectTrain(list, { maxBatch: 1 }), [1]);
  });
  it('ukendt deploy-status taeller som deploy (fail-safe)', () => {
    const unknown = evaluatePr(pr({ number: 7 }), { requiredChecks: GREEN_REQUIRED, allChecks: GREEN_ALL, classification: STANDING, ownerLogin: OWNER });
    assert.equal(unknown.deploys, true);
    assert.deepEqual(selectTrain([unknown, evalWith({ number: 8 }, { deploy: DEPLOYS })]), [7]);
  });
  it('deployImpact bruger koeens fil-regler (merge-queue-files.mjs)', () => {
    assert.deepEqual(deployImpact([{ path: 'docs/GITHUB_WORKFLOW.md' }, { path: 'pr-screens/a.png' }]), { deploys: false, solo: false });
    assert.equal(deployImpact([{ path: 'backend/lib/economy.js' }]).deploys, true);
    assert.equal(deployImpact(['scripts/x.mjs']).deploys, true, 'Railway bygger igen');
    assert.deepEqual(deployImpact([{ path: 'database/2026-11-17-x.sql' }]), { deploys: true, solo: true });
    assert.deepEqual(deployImpact([]), { deploys: true, solo: true });
    assert.deepEqual(deployImpact(null), { deploys: true, solo: true });
  });
  it('queueArgs: eet tog, hoved pr. PR, CI-frist 90 min og een deploy pr. tog', () => {
    const args = queueArgs({ script: 'q.ps1', train: [11, 13, 10], repo: 'o/r', expectHeads: ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)] });
    const val = (name) => args[args.indexOf(name) + 1];
    assert.equal(val('-Pr'), '11,13,10');
    assert.equal(val('-ExpectHead'), `${'a'.repeat(40)},${'b'.repeat(40)},${'c'.repeat(40)}`);
    assert.equal(QUEUE_CI_TIMEOUT_MINUTES, 90);
    assert.equal(val('-CiTimeoutMinutes'), '90');
    assert.equal(val('-MaxBatch'), String(TRAIN_MAX_BATCH));
    assert.equal(val('-MaxDeployBatch'), '1');
    assert.equal(val('-Repo'), 'o/r');
  });
  it('merge-queue.ps1: samme MaxBatch-loft, og -ExpectHead er een SHA pr. PR', () => {
    const ps = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
    assert.equal(Number(/\[int\] \$MaxBatch = (\d+)/.exec(ps)?.[1]), TRAIN_MAX_BATCH);
    assert.ok(ps.includes('$ExpectHeads["$($PrNumbers[$i])"] = $expectList[$i]'), 'hoved pr. PR i -Pr-raekkefoelgen');
    assert.ok(ps.includes('$expectList.Count -ne $PrNumbers.Count'), 'antallet skal passe');
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
      argv: [], now: NOW, repoRoot: dir, out: quiet,
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

  it('#8331: koerer koeen EEN gang med eet samlet tog og lader ejer-go vente', async () => {
    const selected = [evalWith({ number: 21 }), evalWith({ number: 23 }), evalWith({ number: 22 }, { classification: OWNER_GO })];
    const calls = [];
    const result = await run({
      argv: ['--repo', 'o/r'], now: NOW, repoRoot: dir, out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: ({ train, repo }) => { calls.push({ train, repo }); return 0; },
    });
    assert.deepEqual(calls, [{ train: [21, 23], repo: 'o/r' }]);
    assert.deepEqual(result.queued, [21, 23]);
  });

  it('#8331: deploy-PR\'en koerer sidst i det samlede tog', async () => {
    const selected = [evalWith({ number: 24 }, { deploy: DEPLOYS }), evalWith({ number: 25 }), evalWith({ number: 26 }, { deploy: DEPLOYS })];
    const calls = [];
    await run({
      argv: [], now: NOW, repoRoot: dir, blockFile: join(dir, 'b-deploy.json'), out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: ({ train }) => { calls.push(train); return 0; },
    });
    assert.deepEqual(calls, [[25, 24]]);
  });

  it('nyt hoved efter udvaelgelsen: PR\'en springes over (arver ikke kategori eller ejer-go)', async () => {
    const selected = [evalWith({ number: 31 }), evalWith({ number: 32 })];
    const calls = [];
    const res = await run({
      argv: [], now: NOW, repoRoot: dir, out: quiet,
      readMarker: () => null, evaluate: () => selected,
      reevaluate: (n) => (n === 31 ? { ...selected[0], headSha: 'd'.repeat(40) } : selected[1]),
      runQueue: ({ train }) => { calls.push(train); return 0; },
    });
    assert.deepEqual(calls, [[32]]);
    assert.deepEqual(res.queued, [32]);
  });

  it('en anden koe der starter under den friske vurdering: intet tog', async () => {
    const selected = [evalWith({ number: 41 }), evalWith({ number: 42 })];
    let markerReads = 0;
    const calls = [];
    const res = await run({
      argv: [], now: NOW, repoRoot: dir, out: quiet,
      // 1. laesning: ingen koe. 2. (lige foer koeen startes): en anden koe koerer.
      readMarker: () => (++markerReads >= 2 ? { pid: 7, startedAt: '2026-11-04T11:59:00Z', prs: [], merged: [] } : null),
      evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: ({ train }) => { calls.push(train); return 0; },
    });
    assert.deepEqual(calls, []);
    assert.equal(res.action, 'skip-active');
  });

  it('exit 3 (en anden koe naaede at tage markoeren): ingen laas', async () => {
    const blockFile = join(dir, 'b-busy.json');
    const selected = [evalWith({ number: 43 })];
    const res = await run({
      argv: [], now: NOW, repoRoot: dir, blockFile, out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: () => 3,
    });
    assert.deepEqual(res.results, [{ prs: [43], exit: 3 }]);
    assert.equal(existsSync(blockFile), false);
  });

  it('exit 2 (nogle sprunget over, resten verificeret af koeen): ingen laas', async () => {
    const blockFile = join(dir, 'b-partial.json');
    const selected = [evalWith({ number: 44 }), evalWith({ number: 45 })];
    await run({
      argv: [], now: NOW, repoRoot: dir, blockFile, out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: () => 2,
    });
    assert.equal(existsSync(blockFile), false);
  });

  it('Codex P1 #7657: koeen faar det vurderede hoved pr. PR med (-ExpectHead)', async () => {
    const selected = [evalWith({ number: 51 }), evalWith({ number: 52, headRefOid: 'c'.repeat(40) })];
    const calls = [];
    await run({
      argv: [], now: NOW, repoRoot: dir, blockFile: join(dir, 'b7.json'), out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
      runQueue: ({ train, expectHeads }) => { calls.push({ train, expectHeads }); return 0; },
    });
    assert.deepEqual(calls, [{ train: [51, 52], expectHeads: [HEAD, 'c'.repeat(40)] }]);
    const ps = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
    assert.ok(ps.includes('[string] $ExpectHead') && ps.includes('$fresh.headSha -ne $expectedHead'), 'merge-queue.ps1 merger aldrig et andet hoved end det godkendte');
    assert.ok(ps.includes('$recheck.headSha -ne $expectedHead'), 'og igen lige foer merge (efter ventetid/baseline-loesning)');
  });

  it('Codex P1 #7657: exit != 0 stopper toget og laaser, til main er verificeret', async () => {
    const blockFile = join(dir, 'b8.json');
    const selected = [evalWith({ number: 61 }), evalWith({ number: 62 })];
    const calls = [];
    const base = {
      argv: [], now: NOW, repoRoot: dir, blockFile, out: quiet,
      readMarker: () => null, evaluate: () => selected, reevaluate: sameAgain(selected),
    };
    const first = await run({ ...base, runQueue: ({ train }) => { calls.push(train); return 75; } });
    assert.deepEqual(calls, [[61, 62]], 'eet tog, ingen ny koe efter en fejlet/uverificeret koe');
    assert.deepEqual(first.results, [{ prs: [61, 62], exit: 75 }]);
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
      argv: [], now: NOW, repoRoot: dir, out: quiet,
      readMarker: () => null, evaluate: () => { throw new Error('gh nede'); }, runQueue: () => { throw new Error('maa ikke kaldes'); },
    });
    assert.equal(res.action, 'error');
  });

  it('parseArgs', () => {
    assert.deepEqual(parseArgs(['--dry-run', '--log', '--repo', 'o/r']), { dryRun: true, log: true, repo: 'o/r' });
  });
});


describe('#8000 no ready notifications', () => {
  it('merges eligible PRs without reading webhook configuration or sending HTTP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autotrain-no-alert-'));
    try {
      const selected = [evalWith({ number: 81 })];
      const calls = [];
      const result = await run({
        argv: [], now: new Date('2026-11-11T12:00:00Z'), repoRoot: dir,
        env: new Proxy({}, { get() { throw new Error('must not read webhook env'); } }),
        fetchFn: () => { throw new Error('must not send HTTP'); },
        readMarker: () => null, evaluate: () => selected, reevaluate: () => selected[0],
        runQueue: ({ train }) => { calls.push(train); return 0; }, out: () => {},
      });
      assert.deepEqual(calls, [[81]]);
      assert.equal(result.action, 'queue');
      assert.equal(existsSync(join(dir, '.claude/run/merge-autotrain-state.json')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── Merge-vagten (#8331) ────────────────────────────────────────────────────

const OLD = 'b'.repeat(40);
const GUARD_NOW = new Date('2026-11-20T12:00:00Z');
const markerComment = (sha, login = OWNER) => ({ author: { login }, body: `merge <!-- merge-autotrain: ejer-merge sha=${sha} -->` });
// En PR med ejer-markoer, vurderet med de givne checks (standard: alt groent, ejer-go-kategori).
function guardEval(overrides = {}, ctx = {}) {
  return evaluatePr(pr({ comments: [markerComment(HEAD)], ...overrides }), {
    requiredChecks: GREEN_REQUIRED, allChecks: GREEN_ALL, classification: OWNER_GO, ownerLogin: OWNER, deploy: QUIET, ...ctx,
  });
}
const minutesAgo = (m) => new Date(GUARD_NOW.getTime() - m * 60_000).toISOString();
const PENDING_REQUIRED = [{ name: 'backend-tests', bucket: 'pending' }];

describe('merge-vagt: ejer-markoer', () => {
  it('seneste markoer fra ejerens konto vinder; andre konti ignoreres', () => {
    assert.equal(latestOwnerMarkerSha([markerComment(OLD), markerComment(HEAD)], OWNER), HEAD);
    assert.equal(latestOwnerMarkerSha([markerComment(HEAD), markerComment(OLD, 'someone')], OWNER), HEAD);
    assert.equal(latestOwnerMarkerSha([markerComment(HEAD, 'someone')], OWNER), null);
    assert.equal(latestOwnerMarkerSha([], OWNER), null);
  });
  it('evaluatePr baerer markoeren, ogsaa ved tidlige afslag', () => {
    assert.equal(guardEval({ isDraft: true }).ownerMarkerSha, HEAD);
    assert.equal(evalWith().ownerMarkerSha, null);
  });
});

describe('merge-vagt: klassifikation (guardFindings)', () => {
  const one = (e, facts) => guardFindings({ evaluations: [e], ciFacts: facts ? { [e.number]: facts } : {}, now: GUARD_NOW });

  it('eligible PR og PR uden markoer giver intet fund', () => {
    const eligible = guardEval();
    assert.equal(eligible.eligible, true);
    assert.deepEqual(one(eligible), []);
    assert.deepEqual(one(evalWith({ isDraft: true })), []);
  });
  it('markoer paa gammelt commit (fx efter merge af main)', () => {
    const [f] = one(guardEval({ comments: [markerComment(OLD.slice(0, 7))] }));
    assert.equal(f.reason, REASON.STALE_MARKER);
    assert.match(f.detail, /bbbbbbb/);
  });
  it('CI ikke startet: ingen hoved-CI-koersel og hovedet er over 15 min gammelt', () => {
    const e = guardEval({}, { requiredChecks: PENDING_REQUIRED });
    assert.equal(needsCiFacts(e), true);
    assert.equal(one(e, { ciRuns: 0, headCommittedAt: minutesAgo(40) })[0].reason, REASON.CI_NOT_STARTED);
    // Nyt hoved (under fristen), koersel findes, eller ukendt commit-tid: ingen genstart.
    assert.equal(one(e, { ciRuns: 0, headCommittedAt: minutesAgo(5) })[0].reason, REASON.PENDING);
    assert.equal(one(e, { ciRuns: 1, headCommittedAt: minutesAgo(40) })[0].reason, REASON.PENDING);
    assert.equal(one(e, { ciRuns: 0, headCommittedAt: '' })[0].reason, REASON.PENDING);
    assert.equal(one(e)[0].reason, REASON.PENDING);
  });
  it('roede checks med navne, review mangler, konflikt, kladde, andet', () => {
    const red = one(guardEval({}, { requiredChecks: [{ name: 'backend-tests', bucket: 'fail' }] }))[0];
    assert.equal(red.reason, REASON.RED);
    assert.match(red.detail, /backend-tests/);
    const review = [{ name: 'review-gate', bucket: 'fail', event: 'pull_request_target', startedAt: '2026-11-20T10:00:00Z' }];
    assert.equal(one(guardEval({}, { allChecks: review }))[0].reason, REASON.REVIEW);
    assert.equal(one(guardEval({ mergeable: 'CONFLICTING' }))[0].reason, REASON.CONFLICT);
    assert.equal(one(guardEval({ isDraft: true }))[0].reason, REASON.DRAFT);
    assert.equal(one(guardEval({ labels: [{ name: 'hold' }] }))[0].reason, REASON.OTHER);
  });
  it('roede checks paa et gammelt hoved meldes som roede checks (de skal rettes foer nyt go)', () => {
    const e = guardEval({ comments: [markerComment(OLD)] }, { requiredChecks: [{ name: 'gitleaks', bucket: 'fail' }] });
    assert.equal(one(e)[0].reason, REASON.RED);
  });
});

describe('merge-vagt: taeller, nulstilling og alerts', () => {
  const finding = (pr, reason, extra = {}) => ({ pr, title: `PR ${pr}`, headSha: HEAD, reason, detail: '', ...extra });
  const t1 = new Date('2026-11-20T10:00:00Z');
  const t2 = new Date('2026-11-20T10:20:00Z');
  const t3 = new Date('2026-11-20T10:40:00Z');

  it('samme aarsag taeller op og bevarer since; alert foerst efter 2 koersler', () => {
    const s1 = nextGuardState(null, [finding(1, REASON.STALE_MARKER)], { now: t1, openNumbers: [1] });
    assert.equal(s1.entries[1].count, 1);
    assert.deepEqual(s1.alerts, []);
    const s2 = nextGuardState(s1, [finding(1, REASON.STALE_MARKER)], { now: t2, openNumbers: [1] });
    assert.equal(ALERT_AFTER_RUNS, 2);
    assert.equal(s2.entries[1].count, 2);
    assert.equal(s2.entries[1].since, t1.toISOString());
    assert.equal(s2.alerts.length, 1);
    assert.equal(s2.alerts[0].pr, 1);
    assert.equal(s2.alerts[0].since, t1.toISOString());
    assert.match(s2.alerts[0].suggestion, /markoer/);
  });
  it('ny aarsag starter forfra; PR uden fund (eligible/lukket/merget) nulstilles', () => {
    const s1 = nextGuardState(null, [finding(1, REASON.STALE_MARKER), finding(2, REASON.RED)], { now: t1, openNumbers: [1, 2] });
    const s2 = nextGuardState(s1, [finding(1, REASON.REVIEW), finding(2, REASON.RED)], { now: t2, openNumbers: [1, 2] });
    assert.equal(s2.entries[1].count, 1);
    assert.equal(s2.entries[1].since, t2.toISOString());
    assert.equal(s2.entries[2].count, 2);
    const s3 = nextGuardState(s2, [finding(1, REASON.REVIEW)], { now: t3, openNumbers: [1] });
    assert.equal(s3.entries[2], undefined);
    assert.deepEqual(s3.alerts.map((a) => a.pr), [1]);
  });
  it('checks der afventer giver aldrig alert', () => {
    let s = null;
    for (const now of [t1, t2, t3]) s = nextGuardState(s, [finding(3, REASON.PENDING)], { now, openNumbers: [3] });
    assert.equal(s.entries[3].count, 3);
    assert.deepEqual(s.alerts, []);
  });
  it('genstart kun een gang pr. hoved-SHA; nyt hoved maa genstartes igen', () => {
    const f = finding(4, REASON.CI_NOT_STARTED);
    assert.equal(restartCandidates([f], null).length, 1);
    assert.equal(restartCandidates([f], { restarts: { 4: { headSha: HEAD } } }).length, 0);
    assert.equal(restartCandidates([{ ...f, headSha: OLD }], { restarts: { 4: { headSha: HEAD } } }).length, 1);
    assert.equal(restartCandidates([finding(4, REASON.RED)], null).length, 0);
  });
  it('genstarten huskes, selv naar PR\'en en koersel ikke kunne vurderes; kun meget gamle ryddes', () => {
    const prev = { restarts: { 4: { headSha: HEAD, at: '2026-11-20T09:00:00Z' }, 5: { headSha: HEAD, at: '2026-09-01T09:00:00Z' } } };
    const s = nextGuardState(prev, [], { now: t1, openNumbers: [] });
    assert.deepEqual(Object.keys(s.restarts), ['4']);
    assert.equal(restartCandidates([finding(4, REASON.CI_NOT_STARTED)], s).length, 0);
  });
  it('fejlet genaabning bliver i alerts, til PR\'en ses aaben igen', () => {
    const failed = { pr: 6, reason: REASON.REOPEN_FAILED, since: t1.toISOString() };
    const s1 = nextGuardState({ reopenFailed: { 6: failed } }, [], { now: t2, openNumbers: [] });
    assert.deepEqual(s1.alerts.map((a) => a.reason), [REASON.REOPEN_FAILED]);
    const s2 = nextGuardState(s1, [], { now: t3, openNumbers: [6] });
    assert.deepEqual(s2.alerts, []);
  });
  it('review-gate i koe er "afventer", ikke "review mangler"', () => {
    const queued = [{ name: 'review-gate', bucket: 'pending', event: 'pull_request_target', startedAt: '2026-11-20T10:00:00Z' }];
    const [f] = guardFindings({ evaluations: [guardEval({}, { allChecks: queued })], now: GUARD_NOW });
    assert.equal(f.reason, REASON.PENDING);
  });
});

describe('merge-vagt: runMergeGuard (gh injiceret)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-guard-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  // Falsk gh: ingen CI-koersel, hovedet committet for 40 min siden; close/reopen registreres.
  function fakeGh({ reopenFails = false } = {}) {
    const calls = [];
    const gh = (args) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'run') return { status: 0, stdout: '[]', stderr: '' };
      if (args[0] === 'api') return { status: 0, stdout: `${minutesAgo(40)}\n`, stderr: '' };
      if (args[1] === 'reopen' && reopenFails) return { status: 1, stdout: '', stderr: 'nej' };
      return { status: 0, stdout: '', stderr: '' };
    };
    return { gh, calls };
  }
  const stuck = () => [guardEval({ number: 8495, title: 'chore(deps): noget' }, { requiredChecks: PENDING_REQUIRED })];

  it('CI ikke startet: luk+genaabn een gang, alert ved anden koersel, ingen ny genstart paa samme SHA', () => {
    const file = join(dir, 'g1.json');
    const lines = [];
    const a = fakeGh();
    const r1 = runMergeGuard({ evaluations: stuck(), repo: 'o/r', now: GUARD_NOW, gh: a.gh, file, log: (l) => lines.push(l) });
    assert.deepEqual(a.calls.filter((c) => c.startsWith('pr ')), ['pr close', 'pr reopen']);
    assert.equal(r1.state.restarts[8495].headSha, HEAD);
    assert.deepEqual(r1.state.alerts, []);
    assert.ok(lines.some((l) => /MERGE-VAGT: #8495 lukket\+genaabnet/.test(l)));

    const b = fakeGh();
    const later = new Date(GUARD_NOW.getTime() + 20 * 60_000);
    const r2 = runMergeGuard({ evaluations: stuck(), repo: 'o/r', now: later, gh: b.gh, file, log: (l) => lines.push(l) });
    assert.deepEqual(b.calls.filter((c) => c.startsWith('pr ')), [], 'samme SHA genstartes aldrig igen');
    assert.equal(r2.state.alerts.length, 1);
    assert.equal(r2.state.alerts[0].reason, REASON.CI_NOT_STARTED);
    assert.ok(lines.some((l) => /^ {2}MERGE-VAGT: #8495 /.test(l)));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).alerts[0].pr, 8495);
  });

  it('dry-run: ingen genstart og ingen tilstand', () => {
    const file = join(dir, 'g2.json');
    const a = fakeGh();
    runMergeGuard({ evaluations: stuck(), repo: 'o/r', now: GUARD_NOW, gh: a.gh, file, dryRun: true });
    assert.deepEqual(a.calls.filter((c) => c.startsWith('pr ')), []);
    assert.equal(existsSync(file), false);
  });

  it('fejlet genaabning giver alert med det samme', () => {
    const a = fakeGh({ reopenFails: true });
    const r = runMergeGuard({ evaluations: stuck(), repo: 'o/r', now: GUARD_NOW, gh: a.gh, file: join(dir, 'g3.json') });
    assert.deepEqual(a.calls.filter((c) => c.startsWith('pr ')), ['pr close', 'pr reopen', 'pr reopen']);
    assert.equal(r.state.alerts[0].reason, REASON.REOPEN_FAILED);
    assert.equal(r.state.restarts[8495].ok, false);
  });

  it('henter kun CI-fakta for PR\'er med markoer og ikke-groenne checks', () => {
    const a = fakeGh();
    runMergeGuard({ evaluations: [guardEval({ number: 1 }), guardEval({ number: 2, comments: [markerComment(OLD)] }), evalWith({ number: 3 })], repo: 'o/r', now: GUARD_NOW, gh: a.gh, file: join(dir, 'g4.json') });
    assert.deepEqual(a.calls, []);
  });

  it('run() kalder vagten med vurderingerne, og en vagt-fejl stopper ikke toget', async () => {
    const seen = [];
    const res = await run({
      argv: ['--dry-run'], now: GUARD_NOW, repoRoot: dir, out: () => {},
      readMarker: () => null, evaluate: () => [evalWith({ number: 11 })],
      guard: (opts) => { seen.push(opts); throw new Error('vagt nede'); },
    });
    assert.equal(res.action, 'dry-run');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].dryRun, true);
    assert.deepEqual(seen[0].evaluations.map((e) => e.number), [11]);
  });
});

describe('merge-vagt: Stop-hooken (check-now-md.sh)', () => {
  const state = (updatedAt) => nextGuardState(
    nextGuardState(null, [{ pr: 8315, title: 'fix: noget', headSha: HEAD, reason: REASON.STALE_MARKER, detail: 'markoer bbbbbbb, hoved aaaaaaa' }], { now: new Date('2026-11-20T09:40:00Z') }),
    [{ pr: 8315, title: 'fix: noget', headSha: HEAD, reason: REASON.STALE_MARKER, detail: 'markoer bbbbbbb, hoved aaaaaaa' }],
    { now: new Date(updatedAt) },
  );

  it('hookLines: een linje pr. alert med stabil noegle; gammel tilstand ignoreres', () => {
    const s = state('2026-11-20T10:00:00Z');
    const lines = hookLines(s, { now: new Date('2026-11-20T10:05:00Z') });
    assert.equal(lines.length, 1);
    const [key, text] = lines[0].split('\t');
    assert.equal(key, 'merge-guard:8315:gammel-markoer:2026-11-20T09:40:00.000Z');
    assert.match(text, /^MERGE-VAGT: #8315 /);
    assert.match(text, /Spoerg ejeren nu/);
    assert.deepEqual(hookLines(s, { now: new Date('2026-11-20T23:00:00Z') }), []);
    assert.deepEqual(hookLines(null), []);
  });

  it('hooken blokerer med alert-linjen, og respekterer stop_hook_active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-hook-'));
    try {
      assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
      const file = join(dir, 'merge-guard.json');
      writeFileSync(file, JSON.stringify(state('2026-11-20T10:00:00Z')));
      const hook = fileURLToPath(new URL('./check-now-md.sh', import.meta.url)).replaceAll('\\', '/');
      const env = { ...process.env, HOME: dir, USERPROFILE: dir, MERGE_GUARD_FILE: file, CHECK_NOW_MD_NOW_EPOCH: String(Date.parse('2026-11-20T10:05:00Z') / 1000) };
      const runHook = (input) => {
        const res = spawnSync('bash', [hook], { cwd: dir, input, encoding: 'utf8', env, timeout: 60_000 });
        assert.equal(res.status, 0, res.stderr);
        return JSON.parse(res.stdout.trim());
      };
      const blocked = runHook('');
      assert.equal(blocked.decision, 'block');
      assert.match(blocked.reason, /MERGE-VAGT: #8315 /);
      const active = runHook('{"stop_hook_active": true}');
      assert.equal(active.decision, undefined);
      assert.match(active.systemMessage, /MERGE-VAGT: #8315 /);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
