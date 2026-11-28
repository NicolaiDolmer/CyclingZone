import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { latestOwnerMarkerSha, readGuardState, writeGuardState } from './merge-guard.mjs';
import { assertMergeAllowed } from './wave-policy.mjs';

const THIRTY_MINUTES = 30 * 60_000;
const HEAD = /^[a-f0-9]{40}$/i;
const mark = (headSha) => `<!-- merge-stall-v1 head=${headSha} -->`;

function nextAction(evaluation) {
  const reason = String(evaluation.reason ?? '');
  if (evaluation.waveBlocked) return ['bølgelås', 'Vent på frigivelse af bølgens overlappende filer.'];
  if (reason.startsWith('checks: roed:')) return ['røde checks', 'Ret de røde checks på dette HEAD og kør preflight.'];
  if (reason.includes('review-gate') && !reason.includes('afventer')) {
    return ['review mangler på HEAD', 'Bestil et review af det aktuelle HEAD.'];
  }
  if (reason.includes('ikke klassificeres')) return ['klassificering mangler', 'Kontrollér PR-klassificeringen og det tilhørende filgrundlag.'];
  if (!evaluation.headSha.startsWith(evaluation.ownerMarkerSha)) {
    return ['ejer-markøren peger på et ældre HEAD', 'Vis det aktuelle HEAD til ejeren og afvent et nyt merge-go.'];
  }
  if (/mergeable=(CONFLICTING|DIRTY)/.test(reason)) {
    return ['konflikt med main', 'Opdatér grenen og indhent review og ejer-go på det nye HEAD.'];
  }
  if (reason === 'draft') return ['PR’en er kladde', 'Markér PR’en klar, når verifikationen er afsluttet.'];
  if (reason.includes('afventer')) return ['checks afventer', 'Kontrollér de aktuelle Actions-kørsler på PR’en.'];
  return ['klassificering eller PR-status afventer', 'Kontrollér PR-status og klassificering på det aktuelle HEAD.'];
}

export function dueStallComments(evaluations, { seen = {}, now } = {}) {
  const next = {};
  const notices = [];
  for (const evaluation of evaluations) {
    const { number, headSha, ownerMarkerSha, eligible, waveBlocked } = evaluation;
    if (!Number.isSafeInteger(number) || number <= 0 || !HEAD.test(headSha) || !ownerMarkerSha || (eligible && !waveBlocked)) continue;
    const prior = seen[number];
    const since = prior?.headSha === headSha && Number.isFinite(Date.parse(prior.since))
      ? prior.since : now.toISOString();
    next[number] = { headSha, since };
    if (now.getTime() - Date.parse(since) <= THIRTY_MINUTES) continue;
    const [reason, suggestion] = nextAction(evaluation);
    notices.push({ number, headSha, reason, suggestion });
  }
  return { seen: next, notices };
}

export function stallCommentBody({ headSha, reason, suggestion }) {
  return `**Merge-stilstand på \`${headSha.slice(0, 9)}\`**\n\n${reason}. ${suggestion}\n\n${mark(headSha)}`;
}

export function shouldPostStallComment(pr, { headSha }, ownerLogin) {
  if (pr?.state !== 'OPEN' || pr.headRefOid !== headSha || !latestOwnerMarkerSha(pr.comments, ownerLogin)) return false;
  return !pr.comments.some((comment) =>
    comment.author?.login?.toLowerCase() === ownerLogin.toLowerCase() && String(comment.body).includes(mark(headSha)));
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (result.status !== 0) throw new Error('GitHub operation failed');
  return result.stdout;
}

function blockedByWave(evaluation, dir, repo) {
  if (!evaluation.eligible || !evaluation.ownerMarkerSha || !existsSync(join(dir, 'wave-active.json'))) return false;
  try { assertMergeAllowed(dir, evaluation.number, undefined, repo); return false; }
  catch { return true; }
}

function reserve(path) {
  mkdirSync(dirname(path), { recursive: true });
  try { closeSync(openSync(path, 'wx')); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}

export function commentPostOutcome(stdout) {
  const responses = [...String(stdout ?? '').matchAll(/^HTTP\/\S+ (\d{3})\b/gm)];
  const status = Number(responses.at(-1)?.[1]);
  if (status === 201) return 'created';
  if ([400, 401, 403, 404, 410, 422, 429].includes(status)) return 'rejected';
  return 'uncertain';
}

function postStallComment(repo, notice, reservation, log) {
  const response = spawnSync('gh', [
    'api', '--method', 'POST', '--include', `repos/${repo}/issues/${notice.number}/comments`,
    '-f', `body=${stallCommentBody(notice)}`,
  ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  const outcome = commentPostOutcome(response.stdout);
  if (outcome === 'rejected') {
    unlinkSync(reservation);
    log(`  #${notice.number}: GitHub afviste stilstandsbeskeden. Prøver igen ved næste optag.`);
  } else if (outcome === 'created') {
    log(`  Stilstandsbesked på #${notice.number} (${notice.reason}).`);
  } else {
    log(`  #${notice.number}: kunne ikke bekræfte stilstandsbeskeden.`);
  }
}

export function runStallComments({ evaluations, repo, repoRoot, now, dryRun, log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  const dir = join(repoRoot, '.claude', 'run');
  const file = join(dir, 'merge-stall-comments.json');
  const prior = readGuardState(file);
  const relevant = evaluations.map((evaluation) => ({
    ...evaluation, waveBlocked: blockedByWave(evaluation, dir, repo),
  }));
  const { seen, notices } = dueStallComments(relevant, { seen: prior?.seen, now });
  if (!dryRun && (prior || Object.keys(seen).length)) writeGuardState(file, { seen });
  const ownerLogin = repo.split('/')[0];
  for (const notice of notices) {
    if (dryRun) { log(`  DRY-RUN: stilstandsbesked for #${notice.number}: ${notice.reason}.`); continue; }
    try {
      const pr = JSON.parse(gh(['pr', 'view', String(notice.number), '--repo', repo, '--json', 'state,headRefOid,comments']));
      if (!shouldPostStallComment(pr, notice, ownerLogin)) continue;
      // Reserve before POST so an uncertain response cannot cause a duplicate on retry.
      const reservation = join(dir, 'merge-stall-comments', `${repo.split('/').join('__')}-${notice.number}-${notice.headSha}`);
      if (!reserve(reservation)) continue;
      postStallComment(repo, notice, reservation, log);
    } catch { log(`  #${notice.number}: kunne ikke bekræfte stilstandsbeskeden.`); }
  }
}
