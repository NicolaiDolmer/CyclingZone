import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The workflow can finish a pending observation successfully. Only its actual
// smoke step and matching attempt metadata establish release verification.
export function deploymentAttemptState(run, jobResponse, sha, minimumAttempt) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha) || run?.head_sha !== sha
    || !Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run?.run_attempt)
    || !Number.isSafeInteger(minimumAttempt) || minimumAttempt < 1) return 'unknown';
  if (!['queued', 'in_progress', 'waiting', 'pending', 'requested', 'completed'].includes(run.status)) return 'unknown';
  if (run.run_attempt < minimumAttempt || run.status !== 'completed') return 'waiting';
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
  if (pending?.conclusion === 'skipped' && smoke?.conclusion === 'success') return 'verified';
  return 'unknown';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , runPath, jobsPath, sha, minimum] = process.argv;
    console.log(deploymentAttemptState(JSON.parse(readFileSync(runPath, 'utf8')),
      JSON.parse(readFileSync(jobsPath, 'utf8')), sha, Number(minimum)));
  } catch { console.log('unknown'); }
}
