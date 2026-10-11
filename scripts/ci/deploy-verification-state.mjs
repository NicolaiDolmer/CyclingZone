import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// #6487: a running attempt is "released" once its deployment is ready, smoke
// passed and the cron proof has started. The merge queue hands the remaining
// proof to the run (which comments on the PR) instead of blocking on it. Any
// failed or cancelled step before that point keeps it waiting: the completed
// run then decides, fail-closed.
const CRON_STEP = 'Verify affected cron check-ins';
function releasedWhileRunning(run, jobResponse) {
  if (!Array.isArray(jobResponse?.jobs)) return false;
  const matches = jobResponse.jobs.filter(job => job.run_id === run.id && job.run_attempt === run.run_attempt
    && Array.isArray(job.steps) && job.steps.some(step => step.name === CRON_STEP));
  if (matches.length !== 1) return false;
  const steps = matches[0].steps;
  const cron = steps.findIndex(step => step.name === CRON_STEP);
  if (!['in_progress', 'completed'].includes(steps[cron].status)) return false;
  const before = steps.slice(0, cron);
  const smoke = before.find(step => step.name === 'Smoke-test prod');
  const pending = before.find(step => step.name === 'Deployment still pending');
  return smoke?.status === 'completed' && smoke.conclusion === 'success'
    && pending?.status === 'completed' && pending.conclusion === 'skipped'
    && before.every(step => step.status === 'completed' && ['success', 'skipped'].includes(step.conclusion));
}

// The workflow can finish a pending observation successfully. Only its actual
// smoke step and matching attempt metadata establish release verification.
export function deploymentAttemptState(run, jobResponse, sha, minimumAttempt) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha) || run?.head_sha !== sha
    || !Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run?.run_attempt)
    || !Number.isSafeInteger(minimumAttempt) || minimumAttempt < 1) return 'unknown';
  if (!['queued', 'in_progress', 'waiting', 'pending', 'requested', 'completed'].includes(run.status)) return 'unknown';
  if (run.run_attempt < minimumAttempt) return 'waiting';
  if (run.status !== 'completed') return releasedWhileRunning(run, jobResponse) ? 'released' : 'waiting';
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'failed';
  if (run.conclusion !== 'success' || !Array.isArray(jobResponse?.jobs)) return 'unknown';
  const matches = jobResponse.jobs.filter(job => job.run_id === run.id && job.run_attempt === run.run_attempt
    && Array.isArray(job.steps) && job.steps.some(step => step.name === 'Smoke-test prod'));
  if (matches.length !== 1) return 'unknown';
  const steps = matches[0].steps;
  const smoke = steps.find(step => step.name === 'Smoke-test prod');
  const pending = steps.find(step => step.name === 'Deployment still pending');
  if (smoke?.status !== 'completed' || pending?.status !== 'completed') return 'unknown';
  if (pending?.conclusion === 'success' && smoke?.conclusion === 'skipped') return 'pending';
  if (pending?.conclusion === 'skipped' && smoke?.conclusion === 'success') {
    const verified = steps.filter(step => step.name === 'Cron check-ins verified');
    const deferred = steps.filter(step => step.name === 'Cron check-ins deferred');
    if (verified.length !== 1 || deferred.length !== 1
      || verified[0].status !== 'completed' || deferred[0].status !== 'completed') return 'unknown';
    if (verified[0].conclusion === 'success' && deferred[0].conclusion === 'skipped') return 'verified';
    if (verified[0].conclusion === 'skipped' && deferred[0].conclusion === 'success') return 'deferred';
  }
  return 'unknown';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , runPath, jobsPath, sha, minimum] = process.argv;
    console.log(deploymentAttemptState(JSON.parse(readFileSync(runPath, 'utf8')),
      JSON.parse(readFileSync(jobsPath, 'utf8')), sha, Number(minimum)));
  } catch { console.log('unknown'); }
}
