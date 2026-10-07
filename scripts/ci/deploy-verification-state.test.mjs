import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentAttemptState } from './deploy-verification-state.mjs';

const SHA = 'a'.repeat(40);
const run = { id: 10, head_sha: SHA, run_attempt: 2, status: 'completed', conclusion: 'success' };
const jobs = steps => ({ jobs: [{ run_id: 10, run_attempt: 2, steps }] });
const step = (name, conclusion) => ({ name, conclusion, status: 'completed' });

test('a pending deployment observation is never verified despite a successful workflow', () => {
  assert.equal(deploymentAttemptState(run, jobs([step('Deployment still pending', 'success'), step('Smoke-test prod', 'skipped')]), SHA, 2), 'pending');
});

test('a passing smoke and completed workflow positively establish verification', () => {
  assert.equal(deploymentAttemptState(run, jobs([step('Deployment still pending', 'skipped'), step('Smoke-test prod', 'success'),
    step('Cron check-ins verified', 'success'), step('Cron check-ins deferred', 'skipped')]), SHA, 2), 'verified');
});

test('smoke alone, skipped cron gate and deferred check-ins never establish verification', () => {
  const base = [step('Deployment still pending', 'skipped'), step('Smoke-test prod', 'success')];
  assert.equal(deploymentAttemptState(run, jobs(base), SHA, 2), 'unknown');
  assert.equal(deploymentAttemptState(run, jobs([...base, step('Cron check-ins verified', 'skipped'),
    step('Cron check-ins deferred', 'success')]), SHA, 2), 'deferred');
  assert.equal(deploymentAttemptState(run, jobs([...base, step('Cron check-ins verified', 'skipped'),
    step('Cron check-ins deferred', 'skipped')]), SHA, 2), 'unknown');
});

test('real deployment/probe failures remain terminal failures', () => {
  assert.equal(deploymentAttemptState({ ...run, conclusion: 'failure' }, jobs([step('Smoke-test prod', 'failure')]), SHA, 2), 'failed');
});

test('running attempt and stale attempt after rerun request keep waiting', () => {
  assert.equal(deploymentAttemptState({ ...run, status: 'in_progress', conclusion: null }, jobs([]), SHA, 2), 'waiting');
  assert.equal(deploymentAttemptState({ ...run, run_attempt: 1 }, jobs([]), SHA, 2), 'waiting');
});

test('missing/mismatched evidence cannot establish a verified deployment', () => {
  for (const [r, j] of [
    [{ ...run, head_sha: 'b'.repeat(40) }, jobs([])],
    [run, {}], [run, jobs([])],
    [run, { jobs: [{ run_id: 11, run_attempt: 2, steps: [step('Smoke-test prod', 'success')] }] }],
    [run, { jobs: [{ run_id: 10, run_attempt: 1, steps: [step('Smoke-test prod', 'success')] }] }],
    [run, jobs([step('Smoke-test prod', 'skipped')])],
    [{ ...run, status: 'unknown-provider-state' }, jobs([])],
    [run, jobs([{ ...step('Smoke-test prod', 'success'), status: 'in_progress' }, step('Deployment still pending', 'skipped')])],
  ]) assert.equal(deploymentAttemptState(r, j, SHA, 2), 'unknown');
});
