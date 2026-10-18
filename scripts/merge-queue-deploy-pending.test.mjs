import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const queue = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
const classifier = fileURLToPath(new URL('./ci/deploy-verification-state.mjs', import.meta.url)).replaceAll("'", "''");
const sha = 'a'.repeat(40);

// #6859: deploy-verify.yml is split into jobs; the queue reads the release job
// "Deploy live + smoke" at job level. The fixture serves one run (id 10) whose
// attempt 1 can be a pending deployment observation and attempt 2 a release.
function runFixture(mode) {
  const script = `
    $ErrorActionPreference='Stop'; $DryRun=$false; $Repo='fixture/repo';
    $taskClock=[DateTime]::Parse('2026-10-06T06:00:00Z').ToUniversalTime();
    $taskReruns=0; $taskReadsAfterRerun=0; $taskJobReads=0; $taskRunReads=0; $script:handedOffRuns=@();
    $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Wait-ForDeployVerification'},$true);
    Invoke-Expression $fn.Extent.Text;
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'list'){return '[{"databaseId":10,"headSha":"${sha}"}]'}
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'rerun'){$script:taskReruns++;return ''}
      if($GhArgs[0] -eq 'api' -and $GhArgs[1] -match '/runs/10$'){
        $script:taskRunReads++;
        $attempt=1; $status='completed'; $conclusion='success';
        if('${mode}' -in @('waiting','released','settling')){$status='in_progress';$conclusion=$null}
        if('${mode}' -eq 'pendingWhileRunning' -and $script:taskRunReads -le 2){$status='in_progress';$conclusion=$null}
        if('${mode}' -in @('failed','cronRed')){$conclusion='failure'}
        if($script:taskReruns -gt 0){$script:taskReadsAfterRerun++;if($script:taskReadsAfterRerun -ge 2){$attempt=2}}
        return (@{id=10;head_sha='${sha}';run_attempt=$attempt;status=$status;conclusion=$conclusion}|ConvertTo-Json -Compress)
      }
      if($GhArgs[0] -eq 'api' -and $GhArgs[1] -match '/attempts/(\\d+)/jobs'){
        $attempt=[int]$Matches[1]; $script:taskJobReads++;
        $isPending=($attempt -eq 1 -and '${mode}' -in @('recovered','pendingWhileRunning')) -or '${mode}' -eq 'alwaysPending';
        $smoke=if($isPending){'skipped'}else{'success'}; $pending=if($isPending){'success'}else{'skipped'};
        $smokeStatus=if('${mode}' -eq 'settling' -and $script:taskJobReads -le 2){'in_progress'}else{'completed'};
        $jobStatus='completed'; $jobConclusion='success';
        if('${mode}' -eq 'waiting'){$jobStatus='in_progress';$jobConclusion=$null}
        if('${mode}' -eq 'failed'){$jobConclusion='failure';$smoke='failure'}
        $name=if('${mode}' -eq 'oldLayout'){'verify'}else{'Deploy live + smoke'};
        $steps=@(@{name='Deployment still pending';status='completed';conclusion=$pending},@{name='Smoke-test prod';status=$smokeStatus;conclusion=$smoke});
        $jobs=@(@{name=$name;run_id=10;run_attempt=$attempt;status=$jobStatus;conclusion=$jobConclusion;steps=$steps});
        if('${mode}' -eq 'cronRed'){$jobs+=@{name='Cron proof (non-blocking)';run_id=10;run_attempt=$attempt;status='completed';conclusion='failure';steps=@()}}
        return (@{jobs=$jobs}|ConvertTo-Json -Depth 6 -Compress)
      }
      throw 'Unexpected GitHub operation'
    }
    $state=Wait-ForDeployVerification -Sha '${sha}' -TimeoutMinutes 2 -ClassifierPath '${classifier}' -Now {$script:taskClock} -Pause {param($Seconds) $script:taskClock=$script:taskClock.AddSeconds($Seconds)};
    $out=@{state=$state;reruns=$taskReruns;readsAfterRerun=$taskReadsAfterRerun;handedOff=@($script:handedOffRuns)};
    Write-Output ('RESULT='+($out|ConvertTo-Json -Compress));
  `;
  const output = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('RESULT=')).slice(7));
}

test('pending attempt reruns exactly once and ignores stale completed attempt before the release', () => {
  const result = runFixture('recovered');
  assert.equal(result.state, 'released');
  assert.equal(result.reruns, 1);
  assert.equal(result.readsAfterRerun, 2);
});

test('#6859: a pending release job is never rerun while its run is still in progress', () => {
  const result = runFixture('pendingWhileRunning');
  assert.equal(result.state, 'released');
  assert.equal(result.reruns, 1);
});

test('explicit-clock deadline preserves pending and never triggers a rerun of a running worker', () => {
  assert.deepEqual(runFixture('waiting'), { state: 'pending', reruns: 0, readsAfterRerun: 0, handedOff: [] });
});

test('a red release job returns failed immediately without pending retry', () => {
  assert.deepEqual(runFixture('failed'), { state: 'failed', reruns: 0, readsAfterRerun: 0, handedOff: [] });
});

test('repeated completed pending observations stop at the rerun limit without a release', () => {
  const result = runFixture('alwaysPending');
  assert.equal(result.state, 'pending');
  assert.equal(result.reruns, 2);
});

test('#6859: a red cron proof (red run) still releases the queue: the release job decides', () => {
  assert.deepEqual(runFixture('cronRed'), { state: 'released', reruns: 0, readsAfterRerun: 0, handedOff: [10] });
});

test('8/10 + #6859: job steps still settling are re-read, also while the run is running', () => {
  assert.deepEqual(runFixture('settling'), { state: 'released', reruns: 0, readsAfterRerun: 0, handedOff: [10] });
});

test('#6487/#6859: running run with deploy + smoke green releases the queue and records the run', () => {
  assert.deepEqual(runFixture('released'), { state: 'released', reruns: 0, readsAfterRerun: 0, handedOff: [10] });
});

test('#6859: the old single-job layout is never read as a release (fail-closed)', () => {
  assert.deepEqual(runFixture('oldLayout'), { state: 'unknown', reruns: 0, readsAfterRerun: 0, handedOff: [] });
});

function gateActions(states) {
  const list = states.map(state => `'${state}'`).join(',');
  const script = `
    $ErrorActionPreference='Stop';
    $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-DeployGateAction'},$true);
    Invoke-Expression $fn.Extent.Text;
    $out=@{}; foreach($s in @(${list})){ $out[$s]=Get-DeployGateAction $s };
    Write-Output ('RESULT='+($out|ConvertTo-Json -Compress));
  `;
  const output = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('RESULT=')).slice(7));
}

test('#6318 review: deferred long-cadence proof is shown but never stops the queue', () => {
  const actions = gateActions(['verified', 'deferred', 'released', 'pending', 'failed', 'unknown', '', 'garbage']);
  assert.deepEqual(actions, { verified: 'continue', deferred: 'continue', released: 'continue', pending: 'pending', failed: 'stop',
    unknown: 'stop', '': 'stop', garbage: 'stop' });
  const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
  const call = source.indexOf('$deployState = Wait-ForDeployVerification');
  assert.ok(call > 0);
  const block = source.slice(call, source.indexOf('} else {', call));
  assert.match(block, /Get-DeployGateAction \$deployState/);
  // The deferred branch only prints; exits belong to pending/stop gates.
  const deferred = block.slice(block.indexOf("if ($deployState -eq 'deferred')"), block.indexOf("if ($gate -eq 'pending')"));
  assert.doesNotMatch(deferred, /\bexit\b/);
});

test('#6318 review: queue deploy timeout covers one full release job', () => {
  const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
  const queueMinutes = Number(source.match(/\[int\] \$DeployVerifyTimeoutMinutes = (\d+)/)[1]);
  const workflow = readFileSync(new URL('../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  // The first job-level timeout belongs to the release job, the only job the queue waits for.
  assert.match(workflow, /^jobs:\s+(?:#[^\r\n]*\s+)*release:\s+name: Deploy live \+ smoke/m);
  const jobMinutes = Number(workflow.match(/^ {4}timeout-minutes: (\d+)/m)[1]);
  assert.ok(queueMinutes >= jobMinutes + 5, `queue ${queueMinutes} min must exceed job ${jobMinutes} min plus run-creation slack`);
});

// #6859: handed-off runs are judged at job level. Each fixture run lists its
// release-checks and cron-proof job states.
function failedHandedOff(runs, extra = '') {
  const script = `
    $ErrorActionPreference='Stop'; $Repo='fixture/repo';
    $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-FailedHandedOffRuns'},$true);
    Invoke-Expression $fn.Extent.Text;
    $script:fixtureRuns='${JSON.stringify(runs)}' | ConvertFrom-Json;
    $script:handedOffRuns=@($script:fixtureRuns | ForEach-Object { $_.id });
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      $id=[int](($GhArgs[1] -replace '.*/runs/','') -replace '/.*','');
      $r=$script:fixtureRuns | Where-Object { $_.id -eq $id };
      if($r.PSObject.Properties['unreadable']){return $null}
      if($GhArgs[1] -match '/jobs'){
        $jobs=@(@{name='Deploy live + smoke';run_id=$id;run_attempt=1;status='completed';conclusion='success';steps=@()});
        if($r.checks){$jobs+=@{name='Release checks';run_id=$id;run_attempt=1;status=$r.checks.status;conclusion=$r.checks.conclusion;steps=@()}}
        if($r.cron){$jobs+=@{name='Cron proof (non-blocking)';run_id=$id;run_attempt=1;status='completed';conclusion=$r.cron;steps=@()}}
        return (@{jobs=$jobs}|ConvertTo-Json -Depth 6 -Compress)
      }
      return (@{id=$id;run_attempt=1;status=$r.status;conclusion=$r.conclusion}|ConvertTo-Json -Compress)
    }
    Write-Output ('RESULT='+(ConvertTo-Json -InputObject @(Get-FailedHandedOffRuns -ClassifierPath '${classifier}' ${extra}) -Compress));
  `;
  const output = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('RESULT=')).slice(7));
}

test('#6859: red release checks stop the next merge; a red cron proof or running checks do not', () => {
  const done = conclusion => ({ status: 'completed', conclusion });
  assert.deepEqual(failedHandedOff([
    { id: 1, status: 'in_progress', conclusion: null, checks: { status: 'in_progress', conclusion: null } },
    { id: 2, status: 'completed', conclusion: 'success', checks: done('success'), cron: 'success' },
    { id: 3, status: 'completed', conclusion: 'failure', checks: done('success'), cron: 'failure' }]), []);
  assert.deepEqual(failedHandedOff([
    { id: 2, status: 'completed', conclusion: 'failure', checks: done('failure'), cron: 'success' },
    { id: 3, unreadable: true },
    { id: 4, status: 'completed', conclusion: 'cancelled', checks: done('cancelled') },
    { id: 5, status: 'completed', conclusion: 'success' }]),
  ['2 (failed: release checks failure)', '3 (ulaeselig)', '4 (failed: release checks cancelled)', '5 (failed: release checks missing)']);
  const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
  const check = source.indexOf('$failedRuns = @(Get-FailedHandedOffRuns)');
  assert.equal(check, -1, 'the plain call is replaced by a waiting call');
  const waiting = source.indexOf('$failedRuns = @(Get-FailedHandedOffRuns -WaitMinutes $ReleaseChecksWaitMinutes)');
  assert.ok(waiting > 0 && waiting < source.indexOf('guarded-merge --pr'), 'handed-off runs are checked (and awaited) before every real merge');
  assert.ok(source.indexOf('$finalFailed = @(Get-FailedHandedOffRuns -WaitMinutes $ReleaseChecksWaitMinutes)') > 0, 'the last release checks are observed at the end of the queue');
});

test('#6861 (Codex P2): running release checks are awaited and a hang stops the queue', () => {
  const running = { id: 7, status: 'in_progress', conclusion: null, checks: { status: 'in_progress', conclusion: null } };
  assert.deepEqual(failedHandedOff([running], '-WaitMinutes 0.001 -PollSeconds 0'), ['7 (release checks ikke faerdige efter 0.001 min)']);
  assert.deepEqual(failedHandedOff([running]), [], 'without a wait budget the old non-blocking read is unchanged');
});
