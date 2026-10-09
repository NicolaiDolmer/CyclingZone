import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const queue = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
const classifier = fileURLToPath(new URL('./ci/deploy-verification-state.mjs', import.meta.url)).replaceAll("'", "''");
const sha = 'a'.repeat(40);

function runFixture(mode) {
  const script = `
    $ErrorActionPreference='Stop'; $DryRun=$false; $Repo='fixture/repo';
    $taskClock=[DateTime]::Parse('2026-10-06T06:00:00Z').ToUniversalTime();
    $taskReruns=0; $taskReadsAfterRerun=0; $taskJobReads=0;
    $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Wait-ForDeployVerification'},$true);
    Invoke-Expression $fn.Extent.Text;
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'list'){return '[{"databaseId":10,"headSha":"${sha}"}]'}
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'rerun'){$script:taskReruns++;return ''}
      if($GhArgs[0] -eq 'api' -and $GhArgs[1] -match '/runs/10$'){
        $attempt=1; $status='completed'; $conclusion='success';
        if('${mode}' -eq 'waiting'){$status='in_progress';$conclusion=$null}
        if('${mode}' -eq 'failed'){$conclusion='failure'}
        if($script:taskReruns -gt 0){$script:taskReadsAfterRerun++;if($script:taskReadsAfterRerun -ge 2){$attempt=2}}
        return (@{id=10;head_sha='${sha}';run_attempt=$attempt;status=$status;conclusion=$conclusion}|ConvertTo-Json -Compress)
      }
      if($GhArgs[0] -eq 'api' -and $GhArgs[1] -match '/attempts/(\\d+)/jobs'){
        $attempt=[int]$Matches[1];$smoke=if($attempt -eq 1 -or '${mode}' -eq 'alwaysPending'){'skipped'}else{'success'};$pending=if($attempt -eq 1 -or '${mode}' -eq 'alwaysPending'){'success'}else{'skipped'};
        if('${mode}' -in @('deferred','missingCron')){$smoke='success';$pending='skipped'}
        $cronVerified=if('${mode}' -eq 'deferred'){'skipped'}else{'success'};
        $cronDeferred=if('${mode}' -eq 'deferred'){'success'}else{'skipped'};
        $script:taskJobReads++;
        if('${mode}' -eq 'settling'){$smoke='success';$pending='skipped'}
        $smokeStatus=if('${mode}' -eq 'settling' -and $script:taskJobReads -le 2){'in_progress'}else{'completed'};
        $steps=@(@{name='Smoke-test prod';status=$smokeStatus;conclusion=$smoke},@{name='Deployment still pending';status='completed';conclusion=$pending});
        if('${mode}' -ne 'missingCron'){$steps+=@(@{name='Cron check-ins verified';status='completed';conclusion=$cronVerified},@{name='Cron check-ins deferred';status='completed';conclusion=$cronDeferred})}
        return (@{jobs=@(@{run_id=10;run_attempt=$attempt;steps=$steps})}|ConvertTo-Json -Depth 6 -Compress)
      }
      throw 'Unexpected GitHub operation'
    }
    $state=Wait-ForDeployVerification -Sha '${sha}' -TimeoutMinutes 1 -ClassifierPath '${classifier}' -Now {$script:taskClock} -Pause {param($Seconds) $script:taskClock=$script:taskClock.AddSeconds($Seconds)};
    Write-Output ('RESULT='+(@{state=$state;reruns=$taskReruns;readsAfterRerun=$taskReadsAfterRerun}|ConvertTo-Json -Compress));
  `;
  const output = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('RESULT=')).slice(7));
}

test('pending attempt reruns exactly once and ignores stale completed attempt before verification', () => {
  const result = runFixture('recovered');
  assert.equal(result.state, 'verified');
  assert.equal(result.reruns, 1);
  assert.equal(result.readsAfterRerun, 2);
});

test('explicit-clock deadline preserves pending and never triggers a rerun of a running worker', () => {
  assert.deepEqual(runFixture('waiting'), { state: 'pending', reruns: 0, readsAfterRerun: 0 });
});

test('actual failure returns immediately without pending retry', () => {
  assert.deepEqual(runFixture('failed'), { state: 'failed', reruns: 0, readsAfterRerun: 0 });
});

test('repeated completed pending observations stop at the rerun limit without verification', () => {
  const result = runFixture('alwaysPending');
  assert.equal(result.state, 'pending');
  assert.equal(result.reruns, 2);
});

test('deferred cron evidence stops immediately without resetting its boundary through rerun', () => {
  assert.deepEqual(runFixture('deferred'), { state: 'deferred', reruns: 0, readsAfterRerun: 0 });
});

test('8/10: job steps still settling right after completion are re-read, not treated as unknown', () => {
  assert.deepEqual(runFixture('settling'), { state: 'verified', reruns: 0, readsAfterRerun: 0 });
});

test('successful smoke without cron evidence stops fail-closed', () => {
  assert.deepEqual(runFixture('missingCron'), { state: 'unknown', reruns: 0, readsAfterRerun: 0 });
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
  const actions = gateActions(['verified', 'deferred', 'pending', 'failed', 'unknown', '', 'garbage']);
  assert.deepEqual(actions, { verified: 'continue', deferred: 'continue', pending: 'pending', failed: 'stop',
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

test('#6318 review: queue deploy timeout covers one full deploy-verify job', () => {
  const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
  const queueMinutes = Number(source.match(/\[int\] \$DeployVerifyTimeoutMinutes = (\d+)/)[1]);
  const workflow = readFileSync(new URL('../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  const jobMinutes = Number(workflow.match(/^ {4}timeout-minutes: (\d+)/m)[1]);
  assert.ok(queueMinutes >= jobMinutes + 5, `queue ${queueMinutes} min must exceed job ${jobMinutes} min plus run-creation slack`);
});
