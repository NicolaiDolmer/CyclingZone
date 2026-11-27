import test from 'node:test';
import assert from 'node:assert/strict';
import { fableNotice, pendingPullRequests, requiresFableReview } from './fable-dom-notice.mjs';

const head = 'a'.repeat(40);
const base = {
  pr: { state: 'OPEN', isDraft: false, baseRefName: 'main', headRefOid: head },
  expectedHead: head,
  checks: [{ name: 'frontend-build', bucket: 'pass' }],
  files: [{ path: 'backend/lib/trainingCondition.ts' }],
  comments: [],
};

test('uses engine, training and player-number file categories and excludes tests and unrelated docs', () => {
  for (const path of ['backend/lib/engine/v4/index.ts', 'backend/lib/raceRunner.js', 'backend/lib/trainingCondition.ts', 'backend/lib/economy.js', 'frontend/src/pages/TrainingPage.jsx', 'frontend/src/data/marketBalance.ts', 'backend/scripts/dev/8606LateRiderCompensation.mjs']) {
    assert.equal(requiresFableReview([{ path }]), true, path);
  }
  for (const path of ['backend/lib/engine/v4/index.test.ts', 'frontend/src/components/notifications/Inbox.tsx', 'docs/TRAINING_RULES.md']) {
    assert.equal(requiresFableReview([{ path }]), false, path);
  }
});

test('green current head gets a comment, not a merge request or agent trigger', () => {
  assert.match(fableNotice(base), /^Fable-dom mangler/);
  assert.match(fableNotice({ ...base, pr: { ...base.pr, isDraft: true } }), /^Fable-dom mangler/);
  assert.doesNotMatch(fableNotice(base), /@claude|@codex/);
  for (const override of [
    { pr: { ...base.pr, headRefOid: 'b'.repeat(40) } },
    { checks: [{ bucket: 'fail' }] }, { checks: [{ bucket: 'pending' }] },
    { files: null }, { files: [{ path: 'docs/TRAINING_RULES.md' }] },
  ]) {
    assert.equal(fableNotice({ ...base, ...override }), null);
  }
});

test('a trusted receipt deduplicates only the same HEAD', () => {
  const receipt = { user: { login: 'github-actions[bot]' }, body: fableNotice(base) };
  assert.equal(fableNotice({ ...base, comments: [receipt] }), null);
  assert.ok(fableNotice({ ...base, comments: [{ ...receipt, user: { login: 'other-user' } }] }));
});

test('binds the real Actions pull_requests shape by repository id and exact head', () => {
  const repo = 'example/CyclingZone';
  const entry = { number: 12, head: { sha: head }, base: { repo: { id: 87, name: 'CyclingZone' } } };
  const event = {
    repository: { id: 87, full_name: repo },
    workflow_run: { event: 'pull_request', conclusion: 'success', head_sha: head, pull_requests: [entry] },
  };
  assert.deepEqual(pendingPullRequests(event, repo), [entry]);
  assert.deepEqual(pendingPullRequests(event, 'other/CyclingZone'), []);
  assert.deepEqual(pendingPullRequests({ ...event, workflow_run: { ...event.workflow_run, head_sha: 'b'.repeat(40) } }, repo), []);
});
