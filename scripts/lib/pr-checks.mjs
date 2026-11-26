import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateRunsPath, pickGateRun } from '../review-gate.mjs';

const SHA_RE = /^[a-f0-9]{40}$/i;
const CHECK_FIELDS = 'name,bucket,state,link,workflow,event,startedAt';

function actionJob(link, repo) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/attempts\/\d+)?\/job\/(\d+)(?:[?#].*)?$/i.exec(link ?? '');
  return match?.[1].toLowerCase() === repo.toLowerCase() ? { run: Number(match[2]), job: Number(match[3]) } : null;
}

function scope(run) {
  return JSON.stringify([run.workflow_id, run.event, run.head_repository?.id, run.head_branch]);
}

function later(candidate, current) {
  return !current || candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id > current.id);
}

function apiRows(json, path, key) {
  const pages = json(['api', '--paginate', '--slurp', path]);
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page?.[key]))) {
    throw new Error('GitHub returned an incomplete Actions response');
  }
  return pages.flatMap(page => page[key]);
}

function latestReviewGateRun(json, repo, number) {
  for (let page = 1; page <= 5; page++) {
    const rows = json(['api', gateRunsPath(repo, page)])?.workflow_runs;
    if (!Array.isArray(rows)) throw new Error('GitHub returned an incomplete review-gate response');
    const run = pickGateRun(rows, number);
    if (run || rows.length < 100) return run;
  }
  return null;
}

/** Seneste ready_for_review paa PR'en (ISO-tid), eller null hvis den aldrig var kladde. */
function latestReadyAt(json, repo, number) {
  const pages = json(['api', '--paginate', '--slurp', 'repos/' + repo + '/issues/' + number + '/events?per_page=100']);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) {
    throw new Error('GitHub returned an incomplete PR event response');
  }
  return pages.flat().filter(e => e?.event === 'ready_for_review' && e.created_at)
    .reduce((latest, e) => (!latest || e.created_at > latest ? e.created_at : latest), null);
}

function currentJob(row, job, run) {
  const conclusion = job.conclusion ?? '';
  const bucket = job.status !== 'completed' ? 'pending' :
    conclusion === 'success' ? 'pass' :
    ['skipped', 'neutral'].includes(conclusion) ? 'skipping' :
    conclusion === 'cancelled' ? 'cancel' : 'fail';
  return { ...row, link: job.html_url, startedAt: job.started_at, event: run.event,
    bucket, state: (conclusion || job.status || 'pending').toUpperCase() };
}

/** Use Actions run creation (not job start times) on the exact PR head. */
export function readLatestPrChecks({ repo, number, headSha, json, requiredOnly = false }) {
  if (!SHA_RE.test(headSha)) throw new Error('Missing PR head for check lookup');
  const args = ['pr', 'checks', String(number), '--repo', repo];
  const options = { allowExit: [0, 1, 8] };
  const required = json([...args, '--required', '--json', CHECK_FIELDS], options) ?? [];
  const all = requiredOnly ? required : json([...args, '--json', CHECK_FIELDS], options) ?? [];
  if (!Array.isArray(required) || !Array.isArray(all)) throw new Error('GitHub returned an invalid PR check list');

  const rows = [...required, ...all];
  if (!rows.some(row => actionJob(row?.link, repo))) return { required, all };
  const linkedGate = (row) => row?.name === 'review-gate' && row.event === 'pull_request_target' && actionJob(row.link, repo);
  const gateRun = rows.some(linkedGate) ? latestReviewGateRun(json, repo, number) : null;
  const ordinaryActions = rows.some(row => actionJob(row?.link, repo) && !linkedGate(row));
  const runs = ordinaryActions
    ? apiRows(json, 'repos/' + repo + '/actions/runs?head_sha=' + headSha + '&per_page=100', 'workflow_runs')
      .filter(run => run.head_sha === headSha && run.workflow_id && run.event && run.head_repository?.id && run.head_branch &&
        (!run.pull_requests?.length || run.pull_requests.some(pr => pr.number === Number(number))))
    : [];
  const byId = new Map(runs.map(run => [run.id, run]));
  const newest = new Map();
  for (const run of runs) {
    const key = scope(run);
    if (later(run, newest.get(key))) newest.set(key, run);
  }

  const jobsByRun = new Map();
  const jobsFor = (run) => {
    if (!jobsByRun.has(run.id)) {
      jobsByRun.set(run.id, apiRows(json, 'repos/' + repo + '/actions/runs/' + run.id + '/jobs?filter=latest&per_page=100', 'jobs'));
    }
    return jobsByRun.get(run.id);
  };
  const runFor = (row) => byId.get(actionJob(row?.link, repo)?.run);
  const keep = (row) => {
    const action = actionJob(row?.link, repo);
    if (!action) return true; // Non-Actions status checks still come from the PR.
    if (linkedGate(row)) {
      // A target run uses the base SHA. It must both belong to the PR and
      // have a result attached to the current PR check snapshot.
      return gateRun?.id === action.run &&
        (gateRun.run_attempt <= 1 || jobsFor(gateRun).some(job => job.id === action.job));
    }
    const run = byId.get(action.run);
    return Boolean(run && newest.get(scope(run)).id === run.id &&
      (run.run_attempt <= 1 || jobsFor(run).some(job => job.id === action.job)));
  };

  const filteredRequired = required.filter(keep);
  const filteredAll = requiredOnly ? null : all.filter(keep);
  const context = (row, run) => JSON.stringify([scope(run), row.name]);
  const seen = new Set(filteredRequired.flatMap((row) => {
    const run = runFor(row);
    return run ? [context(row, run)] : [];
  }));
  const pendingGate = { name: 'review-gate', event: 'pull_request_target', bucket: 'pending' };
  const onlyUnknown = new Set();
  for (const row of required) {
    if (linkedGate(row)) {
      if (!filteredRequired.some(linkedGate) && !filteredRequired.includes(pendingGate)) filteredRequired.push(pendingGate);
      continue;
    }
    const run = runFor(row);
    if (!run) {
      const action = actionJob(row?.link, repo);
      const key = JSON.stringify([action?.run, row.name]);
      if (action && !onlyUnknown.has(key)) {
        filteredRequired.push({ name: row.name, bucket: 'pending' });
        onlyUnknown.add(key);
      }
      continue;
    }
    if (seen.has(context(row, run))) continue;
    const latest = newest.get(scope(run));
    // GitHub's rollup can pick a later *job* from an older rerun and omit the
    // same-named job from the newer workflow. Recover that context from Actions.
    const current = latest.status === 'queued' ? [] : jobsFor(latest).filter(job => job.name === row.name);
    const recovered = current.map(job => currentJob(row, job, latest));
    filteredRequired.push(...(recovered.length ? recovered : [{ name: row.name, bucket: 'pending' }]));
    for (const check of recovered) {
      if (filteredAll && !filteredAll.some(c => c.link === check.link)) filteredAll.push(check);
    }
    seen.add(context(row, run));
  }
  if (filteredAll && rows.some(linkedGate) && !filteredAll.some(linkedGate)) filteredAll.push(pendingGate);

  // #8802: paa en kladde springes jobs over (skipped = groent hos GitHub). Lige
  // efter `gh pr ready` er kladdens pull_request-koersel stadig den nyeste, til
  // ready_for_review-koerslen er oprettet. Et oversprunget required check fra en
  // koersel der er aeldre end seneste ready_for_review, er derfor forældet:
  // pending, aldrig groent. Et check der faktisk koerte (pass/fail, fx gitleaks
  // paa kladden), maalte samme HEAD og staar ved magt.
  const draftSkipped = (row) => row.bucket === 'skipping' && runFor(row)?.event === 'pull_request';
  const readyAt = filteredRequired.some(draftSkipped) ? latestReadyAt(json, repo, number) : null;
  const stale = (row) => Boolean(readyAt && draftSkipped(row) && runFor(row).created_at < readyAt);
  const current = readyAt
    ? filteredRequired.map(row => (stale(row) ? { name: row.name, bucket: 'pending' } : row))
    : filteredRequired;
  return { required: current, all: filteredAll ?? current };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, number, headSha, mode] = process.argv.slice(2);
  try {
    const snapshot = readLatestPrChecks({ repo, number, headSha, requiredOnly: mode === '--required', json(args, { allowExit = [0] } = {}) {
      const result = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
      if (result.error || !allowExit.includes(result.status)) throw new Error('GitHub check lookup failed');
      return JSON.parse(result.stdout || 'null');
    } });
    process.stdout.write(JSON.stringify(snapshot) + '\n');
  } catch (error) {
    process.stderr.write('PR checks: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
