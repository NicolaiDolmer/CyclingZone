import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// #6859 (owner 18/10): deploy-verify.yml is split into jobs. The merge queue
// waits only for the release job (deployment ready + smoke). Its JOB-level
// conclusion is the signal, so the queue never reads step states of a
// still-running job (#6487 did, which was fragile). The cron proof runs in its
// own job and never gates the queue; the release checks stop the queue before
// its NEXT merge when they are red (handedOffRunVerdict below).
export const RELEASE_JOB = 'Deploy live + smoke';
export const RELEASE_CHECKS_JOB = 'Release checks';
export const CRON_PROOF_JOB = 'Cron proof (non-blocking)';
const FAILED_TARGET_STEPS = [['Failed target vercel', 'vercel'], ['Failed target railway', 'railway'], ['Failed target smoke', 'smoke']];

const RUN_STATUSES = ['queued', 'in_progress', 'waiting', 'pending', 'requested', 'completed'];

function validRun(run) {
  return Number.isSafeInteger(run?.id) && Number.isSafeInteger(run?.run_attempt) && RUN_STATUSES.includes(run?.status);
}

// Exactly one job of this name in this run attempt; null when absent, undefined
// when the evidence is unusable (no job list or a duplicate name).
function attemptJob(run, jobResponse, name) {
  if (!Array.isArray(jobResponse?.jobs)) return undefined;
  const matches = jobResponse.jobs.filter(job => job?.run_id === run.id && job?.run_attempt === run.run_attempt && job?.name === name);
  if (matches.length > 1) return undefined;
  return matches[0] ?? null;
}

const single = (steps, name) => {
  const found = steps.filter(step => step?.name === name);
  return found.length === 1 ? found[0] : null;
};

// The release job can finish a pending observation successfully. Only its own
// smoke step and matching attempt metadata establish 'released'.
export function deploymentAttemptState(run, jobResponse, sha, minimumAttempt) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha) || run?.head_sha !== sha || !validRun(run)
    || !Number.isSafeInteger(minimumAttempt) || minimumAttempt < 1) return 'unknown';
  if (run.run_attempt < minimumAttempt) return 'waiting';
  const job = attemptJob(run, jobResponse, RELEASE_JOB);
  if (job === undefined) return 'unknown';
  // A finished run without a finished release job is not evidence of anything.
  if (job === null || job.status !== 'completed') return run.status === 'completed' ? 'unknown' : 'waiting';
  if (job.conclusion === 'failure' || job.conclusion === 'timed_out') return 'failed';
  if (job.conclusion !== 'success' || !Array.isArray(job.steps)) return 'unknown';
  const smoke = single(job.steps, 'Smoke-test prod');
  const pending = single(job.steps, 'Deployment still pending');
  if (smoke?.status !== 'completed' || pending?.status !== 'completed') return 'unknown';
  if (pending.conclusion === 'success' && smoke.conclusion === 'skipped') return 'pending';
  if (pending.conclusion === 'skipped' && smoke.conclusion === 'success') return 'released';
  return 'unknown';
}

// Verdict for a run the queue already released on: 'running' (release checks
// not finished, the run reports itself), 'ok', or 'failed: <reason>'. A red
// cron proof is deliberately NOT a failure here (owner 18/10: alarm, no stop).
export function handedOffRunVerdict(run, jobResponse) {
  if (!validRun(run)) return 'failed: unreadable run';
  const release = attemptJob(run, jobResponse, RELEASE_JOB);
  const checks = attemptJob(run, jobResponse, RELEASE_CHECKS_JOB);
  if (release === undefined || checks === undefined) return 'failed: unreadable jobs';
  // A rerun attempt of a released run must reach release again.
  if (release && release.status === 'completed' && release.conclusion !== 'success') return `failed: release ${release.conclusion}`;
  if (!checks || checks.status !== 'completed') return run.status === 'completed' ? 'failed: release checks missing' : 'running';
  if (checks.conclusion !== 'success') return `failed: release checks ${checks.conclusion}`;
  return 'ok';
}

// Which deploy target made the release job fail ('vercel' | 'railway' |
// 'smoke'), from the explicit marker steps; 'unknown' otherwise.
export function failedTarget(run, jobResponse) {
  if (!validRun(run)) return 'unknown';
  const job = attemptJob(run, jobResponse, RELEASE_JOB);
  if (!job || !Array.isArray(job.steps)) return 'unknown';
  const hits = FAILED_TARGET_STEPS.filter(([name]) => {
    const step = single(job.steps, name);
    return step?.status === 'completed' && step.conclusion === 'success';
  }).map(([, target]) => target);
  return hits.length === 1 ? hits[0] : 'unknown';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  try {
    if (args[0] === '--handed-off') console.log(handedOffRunVerdict(read(args[1]), read(args[2])));
    else if (args[0] === '--failed-target') console.log(failedTarget(read(args[1]), read(args[2])));
    else console.log(deploymentAttemptState(read(args[0]), read(args[1]), args[2], Number(args[3])));
  } catch {
    console.log(args[0] === '--handed-off' ? 'failed: unreadable' : 'unknown');
  }
}
