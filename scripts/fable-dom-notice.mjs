import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPlayerNumberFile, isTestFile } from './merge-queue-classify.mjs';
import { mustRunAlone } from './merge-queue-files.mjs';
import { completeFileList, requiredChecksStatus } from './merge-autotrain.mjs';
import { readLatestPrChecks } from './lib/pr-checks.mjs';

const SHA = /^[a-f0-9]{40}$/i;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BOT = 'github-actions[bot]';
const TRAINING_UI = /^frontend\/src\/(?:components\/training\/|pages\/TrainingPage\.|components\/rider\/profile\/RiderTraining)/i;
const FINANCE_CODE = /^backend\/(?:lib|routes)\/(?:finance|billing|payments?|loans?|escrow)/i;
const MONEY_UI = /^frontend\/src\/(?:data\/marketBalance\.|(?:components\/(?:finance|auction)\/|pages\/(?:FinancePage|AuctionsPage)\.))/i;
const COMPENSATION_CODE = /^backend\/scripts\/dev\/(?:\d+LateRiderCompensation|(?:calculate|apply)\d+Compensation|repair\d+LostTraining)\./i;
const mark = (head) => `<!-- fable-dom-v1 head=${head} -->`;

export function requiresFableReview(files) {
  return Array.isArray(files) && files.some((file) => isRelevantPath(file?.path));
}

function isRelevantPath(path) {
  return typeof path === 'string' && !isTestFile(path) && (
    isPlayerNumberFile(path) ||
    (path.startsWith('backend/') && mustRunAlone([path])) ||
    TRAINING_UI.test(path) ||
    FINANCE_CODE.test(path) || MONEY_UI.test(path) || COMPENSATION_CODE.test(path)
  );
}

export function fableNotice({ pr, expectedHead, checks, files, comments = [] }) {
  if (pr?.state !== 'OPEN' || pr.baseRefName !== 'main' || !SHA.test(expectedHead) ||
      pr.headRefOid !== expectedHead || !requiresFableReview(files) || !requiredChecksStatus(checks).green) return null;
  if (comments.some((comment) => comment.user?.login === BOT && String(comment.body).includes(mark(expectedHead)))) return null;
  return `Fable-dom mangler på ${expectedHead.slice(0, 9)}. De krævede checks er grønne. Claude kan nu starte den uafhængige dom.\n\n${mark(expectedHead)}`;
}

function gh(args, { allowExit = [0] } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 35_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || !allowExit.includes(result.status)) throw new Error('GitHub lookup or comment failed');
  return result.stdout;
}

function json(args, options) {
  return JSON.parse(gh(args, options) || 'null');
}

export function pendingPullRequests(event, repo) {
  const run = event?.workflow_run;
  if (event?.repository?.full_name !== repo || !Number.isSafeInteger(event.repository.id) ||
      run?.event !== 'pull_request' || run?.conclusion !== 'success' || !SHA.test(run.head_sha)) return [];
  return (run.pull_requests ?? []).filter((pr) => Number.isSafeInteger(pr.number) && pr.number > 0 &&
    pr.base?.repo?.id === event.repository.id && (!pr.head?.sha || pr.head.sha === run.head_sha));
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!REPO.test(repo ?? '') || !process.env.GITHUB_EVENT_PATH) throw new Error('Missing trusted workflow metadata');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const expectedHead = event.workflow_run?.head_sha;
  for (const { number } of pendingPullRequests(event, repo)) {
    const prArgs = ['pr', 'view', String(number), '--repo', repo, '--json', 'state,isDraft,baseRefName,headRefOid,changedFiles'];
    const pr = json(prArgs);
    if (pr?.state !== 'OPEN' || pr.baseRefName !== 'main' || pr.headRefOid !== expectedHead) continue;
    const pages = json(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/files?per_page=100`]);
    const files = completeFileList(pages, pr.changedFiles);
    if (!requiresFableReview(files)) continue;
    const { required: checks } = readLatestPrChecks({ repo, number, headSha: expectedHead, json, requiredOnly: true });
    if (!requiredChecksStatus(checks).green) continue;
    const comments = json(['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments?per_page=100`]);
    if (!Array.isArray(comments) || comments.some((page) => !Array.isArray(page))) throw new Error('Incomplete comment list');
    const fresh = json(prArgs);
    const body = fableNotice({ pr: fresh, expectedHead, checks, files, comments: comments.flat() });
    if (body) {
      gh(['pr', 'comment', String(number), '--repo', repo, '--body', body]);
      process.stdout.write(`Fable-dom-besked på #${number}.\n`);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (error) {
    process.stderr.write(`Fable-dom: ${error.message}\n`);
    process.exitCode = 1;
  }
}
