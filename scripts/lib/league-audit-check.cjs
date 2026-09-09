// Privileged audit bridge: only trusted workflow code may load this module.
const NAME = 'league-size-invariant';

async function targetForRun(github, context) {
  const run = context.payload.workflow_run;
  if (!run || run.event !== 'pull_request') return null;
  if (!/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error('Invalid source SHA');
  const pulls = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit,
    { ...context.repo, commit_sha: run.head_sha, per_page: 100 });
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const current = pulls.filter(pr => pr.state === 'open' && pr.head.sha === run.head_sha
    && pr.base.repo.full_name === repository);
  return current.length ? { sha: run.head_sha, pulls: current.map(pr => pr.number) } : null;
}

async function startCheck(github, context, target, now) {
  const external_id = `league-audit:${target.sha}`;
  const checks = await github.paginate(github.rest.checks.listForRef,
    { ...context.repo, ref: target.sha, check_name: NAME, per_page: 100 });
  const matches = checks.filter(check => check.external_id === external_id);
  if (matches.length > 1) throw new Error('Duplicate league audit checks');
  const fields = { ...context.repo, name: NAME, status: 'in_progress', started_at: now,
    details_url: `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}` };
  const response = matches.length
    ? await github.rest.checks.update({ ...fields, check_run_id: matches[0].id })
    : await github.rest.checks.create({ ...fields, head_sha: target.sha, external_id });
  return response.data.id;
}

function publicSummary(raw) {
  if (!Number.isInteger(raw.total_findings) || raw.total_findings < 0
    || !Array.isArray(raw.findings) || raw.findings.length !== raw.total_findings
    || !Number.isInteger(raw.groups_checked) || raw.groups_checked < 1) {
    throw new Error('Incomplete league audit measurement');
  }
  // Never publish production team/rider identifiers, names or retirement candidates.
  return { generated_at: raw.generated_at, groups_checked: raw.groups_checked,
    required_team_count: raw.required_team_count, total_findings: raw.total_findings,
    waiting_count: (raw.waiting || []).length,
    findings: raw.findings.map(({ label, count, required, delta }) => ({ label, count, required, delta })) };
}

async function finishCheck(github, context, id, summary, succeeded, now) {
  const conclusion = succeeded && summary?.total_findings === 0 ? 'success' : 'failure';
  await github.rest.checks.update({ ...context.repo, check_run_id: id,
    status: 'completed', conclusion, completed_at: now,
    output: { title: conclusion === 'success' ? 'League invariant measured healthy' : 'League invariant not verified healthy',
      summary: summary ? JSON.stringify(summary, null, 2)
        : 'Audit did not return a valid measurement. No green result is inferred.' } });
}

module.exports = { NAME, targetForRun, startCheck, publicSummary, finishCheck };
