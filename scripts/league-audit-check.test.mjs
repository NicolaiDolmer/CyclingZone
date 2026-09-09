import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { targetForRun, startCheck, publicSummary, finishCheck } from './lib/league-audit-check.cjs';

const sha = 'a'.repeat(40);
test('privileged audit checks out only its trusted revision and never consumes PR artifacts', () => {
  const workflow = readFileSync(new URL('../.github/workflows/league-size-invariant-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.doesNotMatch(workflow, /download-artifact|ref:.*head_sha|pull_request_target:/);
});
const now = '2026-09-09T12:00:00Z';
const context = { repo: { owner: 'owner', repo: 'repo' }, runId: 42,
  payload: { workflow_run: { event: 'pull_request', head_sha: sha, pull_requests: [] } } };
const pull = { number: 123, state: 'open', head: { sha, repo: { full_name: 'fork/repo' } },
  base: { repo: { full_name: 'owner/repo' } }, user: { login: 'dependabot[bot]' } };
function api(pulls = [pull], checks = []) {
  const calls = [];
  return { calls, rest: { repos: { listPullRequestsAssociatedWithCommit: 'pulls' },
    checks: { listForRef: 'checks',
      create: async args => { calls.push({ method: 'create', ...args }); return { data: { id: 7 } }; },
      update: async args => { calls.push({ method: 'update', ...args }); return { data: { id: 7 } }; } } },
  paginate: async method => method === 'pulls' ? pulls : checks };
}
test('Dependabot and fork runs resolve to the current PR head without trusting event PR arrays', async () => {
  assert.deepEqual(await targetForRun(api(), context), { sha, pulls: [123] });
});
test('closed, stale and foreign-base PRs receive no check for their new head', async () => {
  assert.equal(await targetForRun(api([{ ...pull, state: 'closed' },
    { ...pull, head: { sha: 'b'.repeat(40) } },
    { ...pull, base: { repo: { full_name: 'other/repo' } } }]), context), null);
});
test('rerunning an audit updates one check on the exact source SHA', async () => {
  const first = api();
  assert.equal(await startCheck(first, context, { sha }, now), 7);
  assert.equal(first.calls[0].head_sha, sha);
  const rerun = api([], [{ id: 7, external_id: `league-audit:${sha}` }]);
  await startCheck(rerun, context, { sha }, now);
  assert.equal(rerun.calls[0].method, 'update');
  assert.equal(rerun.calls[0].check_run_id, 7);
});
test('missing or failed measurement never publishes success', async () => {
  const github = api();
  for (const [summary, succeeded] of [[null, true], [{ total_findings: 0 }, false],
    [{ total_findings: 1 }, true], [{ total_findings: 0 }, true]]) {
    await finishCheck(github, context, 7, summary, succeeded, now);
  }
  assert.deepEqual(github.calls.map(c => c.conclusion), ['failure', 'failure', 'failure', 'success']);
});
test('public reports contain aggregate findings only and reject incomplete measurements', () => {
  const raw = { total_findings: 1, groups_checked: 15, findings: [
    { label: 'Division 4 F', count: 25, required: 24, delta: 1, candidates: [{ id: 'private-id', name: 'private-team' }] }],
  waiting: [{ teamId: 'private-id' }] };
  const safe = publicSummary(raw);
  assert.equal(safe.waiting_count, 1);
  assert.doesNotMatch(JSON.stringify(safe), /private|candidates/);
  assert.throws(() => publicSummary({ ...raw, total_findings: 0 }), /Incomplete/);
  assert.throws(() => publicSummary({ ...raw, groups_checked: 0 }), /Incomplete/);
});
