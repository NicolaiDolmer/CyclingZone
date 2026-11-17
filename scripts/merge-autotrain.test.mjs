// Tests for scripts/merge-autotrain.mjs (#7654).
// Koer: node --test scripts/merge-autotrain.test.mjs

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

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
