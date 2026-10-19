import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findTrainCulprit } from './merge-queue-train.mjs';

// #6859 (ejer 18/10): merge-tog som standard, koeen venter kun paa deploy +
// smoke, cron-beviset alarmerer men blokerer ikke, og et roedt tog peger selv
// den skyldige PR ud.

const queue = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Runs in static-guards without npm ci, so no YAML dependency: slice a job's
// text block out of a workflow (top-level job keys are indented two spaces).
function jobBlock(workflow, job) {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  const start = jobs.search(new RegExp(`^  ${job}:\\n`, 'm'));
  assert.ok(start >= 0, `job ${job} exists`);
  const rest = jobs.slice(start + 1);
  const next = rest.search(/^  [a-z0-9_-]+:\n/m);
  return next > 0 ? rest.slice(0, next) : rest;
}
const stepNames = block => [...block.matchAll(/^ {6}- name: (.+?)\s*$/gm)].map(match => match[1]);

function psFunctions(names, body) {
  const script = `
    $ErrorActionPreference='Stop';
    $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
    foreach($name in @(${names.map(name => `'${name}'`).join(',')})){
      $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);
      Invoke-Expression $fn.Extent.Text;
    }
    ${body}
  `;
  const output = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('RESULT=')).slice(7));
}

const pr = (number, extra = {}) => ({ number, ciOk: true, touchesBackend: false, touchesRailway: true, touchesVercel: false, ...extra });

test('culprit: a single PR in the train is always the culprit', () => {
  assert.deepEqual(findTrainCulprit({ failure: 'unknown', prs: [pr(1)] }), { culprit: 1, suspects: [1], reason: 'eneste PR i toget' });
});

test('culprit: red CI names the first red SHA but reports the prefix as suspects, not a culprit (Codex P2)', () => {
  const result = findTrainCulprit({ failure: 'ci', prs: [pr(1), pr(2, { ciOk: false }), pr(3, { ciOk: false })] });
  assert.equal(result.culprit, null);
  assert.equal(result.firstFailing, 2);
  assert.deepEqual(result.suspects, [1, 2]);
  assert.deepEqual(findTrainCulprit({ failure: 'ci', prs: [pr(1, { ciOk: null }), pr(2, { ciOk: null })] }).suspects, [1, 2]);
});

test('culprit: a deploy failure points at the only PR that triggers the failing target', () => {
  const train = [pr(1, { touchesVercel: true }), pr(2, { touchesBackend: true }), pr(3)];
  assert.equal(findTrainCulprit({ failure: 'vercel', prs: train }).culprit, 1);
  assert.equal(findTrainCulprit({ failure: 'railway', prs: train }).culprit, 2);
  // Smoke covers both targets: two suspects, no single culprit.
  assert.deepEqual(findTrainCulprit({ failure: 'smoke', prs: train }), { culprit: null, suspects: [1, 2], reason: "flere PR'er udloeser smoke" });
});

test('culprit: railway falls back to Railway-triggering PRs when no PR touches backend production code', () => {
  const train = [pr(1, { touchesRailway: false }), pr(2), pr(3, { touchesRailway: false })];
  assert.equal(findTrainCulprit({ failure: 'railway', prs: train }).culprit, 2);
});

test('culprit: ambiguous or unknown evidence lists suspects in merge order and never invents a culprit', () => {
  const train = [pr(5, { touchesVercel: true }), pr(3, { touchesVercel: true })];
  assert.deepEqual(findTrainCulprit({ failure: 'vercel', prs: train }).suspects, [5, 3]);
  assert.equal(findTrainCulprit({ failure: 'vercel', prs: train }).culprit, null);
  assert.deepEqual(findTrainCulprit({ failure: 'unknown', prs: train }), { culprit: null, suspects: [5, 3], reason: 'ingen PR kunne kobles til fejlen (unknown)' });
  // Missing classification counts as "triggers the target" (fail-safe).
  assert.deepEqual(findTrainCulprit({ failure: 'vercel', prs: [{ number: 7 }, pr(8)] }).culprit, 7);
  assert.deepEqual(findTrainCulprit({ failure: 'ci', prs: [] }), { culprit: null, suspects: [], reason: 'ukendt tog' });
  assert.deepEqual(findTrainCulprit(), { culprit: null, suspects: [], reason: 'ukendt tog' });
});

test('culprit CLI prints JSON for the queue', () => {
  const out = execFileSync('node', [fileURLToPath(new URL('./merge-queue-train.mjs', import.meta.url)), 'culprit',
    JSON.stringify({ failure: 'railway', prs: [pr(1), pr(2, { touchesBackend: true })] })], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).culprit, 2);
});

test('train is the default: PRs merge on until -MaxBatch; -NoBatch is the exception', () => {
  const result = psFunctions(['Test-MergeWithNext'], `
    $out=@{
      first=Test-MergeWithNext $false 0 5 0 5; fourth=Test-MergeWithNext $false 3 5 3 5; fifth=Test-MergeWithNext $false 4 5 4 5;
      cap=Test-MergeWithNext $false 0 9 4 5; last=Test-MergeWithNext $false 1 2 0 5; noBatch=Test-MergeWithNext $true 0 5 0 5 };
    Write-Output ('RESULT='+($out|ConvertTo-Json -Compress));`);
  assert.deepEqual(result, { first: true, fourth: true, fifth: false, cap: false, last: false, noBatch: false });
  const source = read('./merge-queue.ps1');
  assert.equal(Number(source.match(/\[int\] \$MaxBatch = (\d+)/)[1]), 5);
});

test('#4919 wait rule: no merge in the stage-tick window HH:57-HH:03', () => {
  const result = psFunctions(['Test-InMergeTickWindow'], `
    $out=@{}; foreach($m in 0,3,4,30,56,57,59){ $out["m$m"]=Test-InMergeTickWindow $m };
    Write-Output ('RESULT='+($out|ConvertTo-Json -Compress));`);
  assert.deepEqual(result, { m0: true, m3: true, m4: false, m30: false, m56: false, m57: true, m59: true });
  const source = read('./merge-queue.ps1');
  // Every merge waits for the window first, and one merge runs at a time (no parallel merges).
  const loop = source.slice(source.indexOf('for ($idx = 0; $idx -lt $plan.Count; $idx++)'));
  assert.ok(loop.indexOf('Wait-OutOfMergeTickWindow') < loop.indexOf('guarded-merge --pr'));
});

test('a red train stops the queue and names the culprit for CI and deploy failures', () => {
  const source = read('./merge-queue.ps1');
  const ci = source.slice(source.indexOf('if (-not $ciOk) {'), source.indexOf('$script:batchMerged = @()', source.indexOf('if (-not $ciOk) {')));
  assert.match(ci, /Write-TrainCulprit 'ci'[\s\S]*exit 1/);
  const deploy = source.slice(source.indexOf("if ($gate -ne 'continue') {"));
  assert.match(deploy.slice(0, 400), /Get-TrainFailedTarget[\s\S]*Write-TrainCulprit \$failure[\s\S]*exit 1/);
  // No automatic revert or redeploy of intermediate states (prod action = owner go).
  assert.doesNotMatch(source, /gh pr revert|git revert|railway (?:up|redeploy|rollback)/);
});

test('deploy-verify: the queue gate is its own job, the cron proof runs after it and only alarms', () => {
  const workflow = read('../.github/workflows/deploy-verify.yml');
  const release = jobBlock(workflow, 'release');
  const cron = jobBlock(workflow, 'cron-proof');
  const checks = jobBlock(workflow, 'release-checks');
  const report = jobBlock(workflow, 'report');
  assert.match(release, /^ {4}name: Deploy live \+ smoke$/m);
  assert.ok(stepNames(release).includes('Smoke-test prod'));
  assert.ok(!stepNames(release).includes('Verify affected cron check-ins'), 'cron proof must not delay the release job');
  assert.match(cron, /^ {4}needs: release$/m);
  assert.ok(stepNames(cron).includes('Verify affected cron check-ins'));
  assert.match(checks, /^ {4}needs: release$/m);
  assert.match(report, /^ {4}needs: \[release, cron-proof, release-checks\]$/m);
  assert.match(report, /^ {4}if: \$\{\{ !cancelled\(\)/m);
  const alarm = report.slice(report.indexOf('- name: Alarm Discord ops'));
  // !cancelled(): a failed PR comment step must never suppress the alarm (Codex review).
  assert.match(alarm, /if: \$\{\{ !cancelled\(\) && \(needs\.cron-proof\.result != 'success' \|\| needs\.release-checks\.result != 'success'\) \}\}/);
  assert.match(alarm, /DISCORD_OPS_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_OPS_WEBHOOK_URL \}\}/);
  // The alarm never fails the run: a missing webhook or a failed POST only warns.
  assert.doesNotMatch(alarm, /exit 1/);
  // One deploy-verify run per SHA; a newer merge never cancels an older proof.
  assert.match(workflow, /^ {2}group: deploy-verify-\$\{\{ github\.event\.inputs\.sha \|\| github\.sha \}\}$/m);
});

test('PR-CI keeps runners free: stale PR runs are cancelled and e2e shards run only on e2e-relevant changes', () => {
  for (const file of ['../.github/workflows/ci.yml', '../.github/workflows/playwright-smoke.yml']) {
    const workflow = read(file);
    assert.match(workflow, /^concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.head_ref \|\| github\.sha \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m, file);
  }
  const smoke = read('../.github/workflows/playwright-smoke.yml');
  assert.match(jobBlock(smoke, 'e2e-shard'), /^ {4}if: .*needs\.changes\.outputs\.frontend == 'true'/m);
  assert.match(jobBlock(smoke, 'changes'), /grep -E '\^\(frontend\//);
});

test('train: a deployment-affecting PR always ends the train (Codex P1)', () => {
  const r = psFunctions(['Test-MergeWithNext'], `
    $a = Test-MergeWithNext $false 0 4 0 5 $false
    $b = Test-MergeWithNext $false 0 4 0 5 $true
    $c = Test-MergeWithNext $true 0 4 0 5 $false
    Write-Output ('RESULT=' + (ConvertTo-Json @($a,$b,$c) -Compress))
  `);
  assert.deepEqual(r, [true, false, false]);
  const queueText = read('./merge-queue.ps1');
  assert.match(queueText, /if \(\$entryBackend -or \$entryRailway -or \$entryVercel\) \{ \$batchWithNext = \$false \}/);
});

test('plan entry: an incomplete file list (100-file cap) fails closed as deploy-affecting (Codex P1)', () => {
  const queueText = read('./merge-queue.ps1');
  assert.match(queueText, /'--json', 'files,changedFiles,title,mergeable,isDraft,headRefOid'/);
  assert.match(queueText, /\$listComplete = \(\$changed -gt 0\) -and \(\$fileCount -ge \$changed\)/);
  // Codex P1 (#6861): rename origins count too - the paginated REST list carries previous_filename.
  assert.match(queueText, /pulls\/\$number\/files", '--paginate'/);
  assert.match(queueText, /\.previous_filename \/\/ ""/);
  assert.match(queueText, /if \(\$cols\.Count -gt 1 -and \$cols\[1\]\) \{ \$paths \+= \$cols\[1\] \}/);
  assert.match(queueText, /\$filesKnown = \$listComplete/);
  assert.match(queueText, /if \(-not \$filesKnown\) \{ \$touchesBackend = \$true; \$touchesRailway = \$true; \$touchesVercel = \$true \}/);
});

test('#6861 (Codex P1/P2): the head is re-validated right before merging, and the stall default exceeds the longest valid step', () => {
  const q = read('./merge-queue.ps1');
  const recheck = q.indexOf('$recheck = Get-PrPlanEntry $n');
  assert.ok(recheck > 0 && recheck < q.indexOf("guarded-merge --pr"), 'recheck happens before the merge call');
  assert.match(q, /\$recheck\.headSha -ne \$fresh\.headSha/);
  assert.match(q, /'--json', 'files,changedFiles,title,mergeable,isDraft,headRefOid'/);
  assert.match(q, /\[int\] \$StallMinutes = 45,/);
});
