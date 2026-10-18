import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deploymentAttemptState, handedOffRunVerdict, failedTarget, RELEASE_JOB, RELEASE_CHECKS_JOB, CRON_PROOF_JOB } from './deploy-verification-state.mjs';

const SHA = 'a'.repeat(40);
const run = { id: 10, head_sha: SHA, run_attempt: 2, status: 'completed', conclusion: 'success' };
const step = (name, conclusion, status = 'completed') => ({ name, conclusion, status });
const job = (name, steps = [], { status = 'completed', conclusion = 'success', run_id = 10, run_attempt = 2 } = {}) =>
  ({ name, status, conclusion, run_id, run_attempt, steps });
const jobs = (...list) => ({ jobs: list });
const released = [step('Deployment still pending', 'skipped'), step('Smoke-test prod', 'success')];

test('#6859: the job names the queue reads are exactly the workflow job names', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  for (const name of [RELEASE_JOB, RELEASE_CHECKS_JOB, CRON_PROOF_JOB]) {
    assert.match(workflow, new RegExp(`^ {4}name: ${name.replace(/[()+]/g, '\\$&')}\\s*$`, 'm'), name);
  }
});

test('a pending deployment observation is never released despite a successful release job', () => {
  assert.equal(deploymentAttemptState(run, jobs(job(RELEASE_JOB, [step('Deployment still pending', 'success'), step('Smoke-test prod', 'skipped')])), SHA, 2), 'pending');
});

test('#6859: a completed release job with a passing smoke releases the queue, whatever the cron proof does', () => {
  for (const cron of ['in_progress', 'queued']) {
    assert.equal(deploymentAttemptState({ ...run, status: 'in_progress', conclusion: null },
      jobs(job(RELEASE_JOB, released), job(CRON_PROOF_JOB, [], { status: cron, conclusion: null })), SHA, 2), 'released');
  }
  // The run itself is red because of the cron proof: still released, never failed.
  assert.equal(deploymentAttemptState({ ...run, conclusion: 'failure' },
    jobs(job(RELEASE_JOB, released), job(CRON_PROOF_JOB, [], { conclusion: 'failure' })), SHA, 2), 'released');
});

test('real deployment/probe failures of the release job remain terminal failures', () => {
  for (const conclusion of ['failure', 'timed_out']) {
    assert.equal(deploymentAttemptState({ ...run, conclusion: 'failure' }, jobs(job(RELEASE_JOB, [step('Smoke-test prod', 'failure')], { conclusion })), SHA, 2), 'failed');
  }
});

test('running release job and stale attempt after rerun request keep waiting', () => {
  const running = { ...run, status: 'in_progress', conclusion: null };
  assert.equal(deploymentAttemptState(running, jobs(), SHA, 2), 'waiting');
  assert.equal(deploymentAttemptState(running, jobs(job(RELEASE_JOB, released, { status: 'in_progress', conclusion: null })), SHA, 2), 'waiting');
  assert.equal(deploymentAttemptState({ ...run, run_attempt: 1 }, jobs(), SHA, 2), 'waiting');
});

test('missing/mismatched evidence cannot establish a release', () => {
  for (const [r, j] of [
    [{ ...run, head_sha: 'b'.repeat(40) }, jobs(job(RELEASE_JOB, released))],
    [run, {}], [run, jobs()],
    [run, jobs(job(RELEASE_JOB, released, { run_id: 11 }))],
    [run, jobs(job(RELEASE_JOB, released, { run_attempt: 1 }))],
    [run, jobs(job(RELEASE_JOB, released), job(RELEASE_JOB, released))],
    [run, jobs(job(RELEASE_JOB, [step('Smoke-test prod', 'skipped')]))],
    [run, jobs(job(RELEASE_JOB, released, { conclusion: 'cancelled' }))],
    [run, jobs(job(RELEASE_JOB, [step('Smoke-test prod', 'success', 'in_progress'), step('Deployment still pending', 'skipped')]))],
    [{ ...run, status: 'unknown-provider-state' }, jobs(job(RELEASE_JOB, released))],
    // The old single-job layout (#6487) is not read as a release.
    [run, jobs({ ...job('verify', [...released, step('Verify affected cron check-ins', 'success')]) })],
  ]) assert.equal(deploymentAttemptState(r, j, SHA, 2), 'unknown');
});

test('#6859: a handed-off run blocks only on red release checks, never on the cron proof', () => {
  const running = { ...run, status: 'in_progress', conclusion: null };
  const ok = job(RELEASE_JOB, released);
  assert.equal(handedOffRunVerdict(running, jobs(ok, job(RELEASE_CHECKS_JOB, [], { status: 'in_progress', conclusion: null }))), 'running');
  assert.equal(handedOffRunVerdict(running, jobs(ok)), 'running');
  assert.equal(handedOffRunVerdict(running, jobs(ok, job(RELEASE_CHECKS_JOB))), 'ok');
  assert.equal(handedOffRunVerdict({ ...run, conclusion: 'failure' }, jobs(ok, job(RELEASE_CHECKS_JOB), job(CRON_PROOF_JOB, [], { conclusion: 'failure' }))), 'ok');
  assert.equal(handedOffRunVerdict({ ...run, conclusion: 'failure' }, jobs(ok, job(RELEASE_CHECKS_JOB, [], { conclusion: 'failure' }))), 'failed: release checks failure');
  assert.equal(handedOffRunVerdict(run, jobs(ok)), 'failed: release checks missing');
  assert.equal(handedOffRunVerdict(run, jobs(job(RELEASE_JOB, released, { conclusion: 'failure' }), job(RELEASE_CHECKS_JOB))), 'failed: release failure');
  assert.equal(handedOffRunVerdict(run, {}), 'failed: unreadable jobs');
  assert.equal(handedOffRunVerdict({ id: 'x' }, jobs(ok)), 'failed: unreadable run');
});

test('#6859: the failing deploy target is read from exactly one marker step', () => {
  const failed = markers => jobs(job(RELEASE_JOB, markers, { conclusion: 'failure' }));
  assert.equal(failedTarget(run, failed([step('Failed target vercel', 'success'), step('Failed target railway', 'skipped'), step('Failed target smoke', 'skipped')])), 'vercel');
  assert.equal(failedTarget(run, failed([step('Failed target vercel', 'skipped'), step('Failed target railway', 'success'), step('Failed target smoke', 'skipped')])), 'railway');
  assert.equal(failedTarget(run, failed([step('Failed target vercel', 'skipped'), step('Failed target railway', 'skipped'), step('Failed target smoke', 'success')])), 'smoke');
  assert.equal(failedTarget(run, failed([step('Failed target vercel', 'success'), step('Failed target smoke', 'success')])), 'unknown');
  assert.equal(failedTarget(run, failed([step('Failed target vercel', 'skipped')])), 'unknown');
  assert.equal(failedTarget(run, {}), 'unknown');
});
