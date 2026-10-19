import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// #6859 (owner 18/10): the merge queue's stall alarm. A step (CI main, deploy,
// release checks) without progress for -StallMinutes writes a STALL line,
// alarms Discord ops (DISCORD_OPS_WEBHOOK_URL, else console only) and stops
// instead of waiting for the timeout.

const queue = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
const classifier = fileURLToPath(new URL('./ci/deploy-verification-state.mjs', import.meta.url)).replaceAll("'", "''");
const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sha = 'a'.repeat(40);

const load = names => `
  $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
  foreach($name in @(${names.map(name => `'${name}'`).join(',')})){
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);
    Invoke-Expression $fn.Extent.Text;
  }`;
function pwsh(script, env = {}) {
  const res = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8', env: { ...process.env, ...env } });
  const line = res.stdout.split(/\r?\n/).find(l => l.startsWith('RESULT='));
  return { status: res.status, stdout: res.stdout, result: line ? JSON.parse(line.slice(7)) : null };
}

// Deploy verify fixture: run 10, release job in progress. mode 'stuck' = the
// same observation forever, 'progress' = one more completed step per read,
// 'norun' = the run never appears.
function deployFixture(mode, { timeout = 60, stall = 15 } = {}) {
  return pwsh(`
    $ErrorActionPreference='Stop'; $DryRun=$false; $Repo='fixture/repo'; $script:handedOffRuns=@(); $script:queueStall=$null;
    $clock=[DateTime]::Parse('2026-10-18T12:00:00Z').ToUniversalTime(); $start=$clock; $reads=0;
    ${load(['Wait-ForDeployVerification'])}
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'list'){ if('${mode}' -eq 'norun'){return '[]'}; return '[{"databaseId":10,"headSha":"${sha}"}]' }
      if($GhArgs[0] -eq 'api' -and $GhArgs[1] -match '/runs/10$'){ return (@{id=10;head_sha='${sha}';run_attempt=1;status='in_progress';conclusion=$null}|ConvertTo-Json -Compress) }
      if($GhArgs[0] -eq 'api' -and $GhArgs[1] -match '/jobs'){
        $script:reads++; $done=if('${mode}' -eq 'progress'){$script:reads}else{3};
        $steps=@(1..($done+2) | ForEach-Object { if($_ -le $done){@{name="s$_";status='completed';conclusion='success'}}else{@{name="s$_";status='in_progress';conclusion=$null}} });
        return (@{jobs=@(@{name='Deploy live + smoke';run_id=10;run_attempt=1;status='in_progress';conclusion=$null;steps=$steps})}|ConvertTo-Json -Depth 6 -Compress)
      }
      throw 'Unexpected GitHub operation'
    }
    $state=Wait-ForDeployVerification -Sha '${sha}' -TimeoutMinutes ${timeout} -StallMinutes ${stall} -ClassifierPath '${classifier}' -Now {$script:clock} -Pause {param($Seconds) $script:clock=$script:clock.AddSeconds($Seconds)};
    Write-Output ('RESULT='+(@{state=$state;stall=$script:queueStall;minutes=[int]($clock-$start).TotalMinutes;handedOff=@($script:handedOffRuns)}|ConvertTo-Json -Compress));
  `).result;
}

test('deploy verify without progress for -StallMinutes is a STALL, long before the timeout', () => {
  const result = deployFixture('stuck');
  assert.equal(result.state, 'stalled');
  assert.match(result.stall, /^Deploy verify \(run 10, attempt 1\): 'waiting' uden job- eller trin-skift$/);
  assert.ok(result.minutes >= 15 && result.minutes <= 16, `stalled after ${result.minutes} min`);
  assert.deepEqual(result.handedOff, []);
});

test('deploy verify that keeps progressing is never a STALL; the timeout still decides', () => {
  const result = deployFixture('progress', { timeout: 30 });
  assert.equal(result.state, 'pending');
  assert.equal(result.stall, null);
});

test('a deploy verify run that is never created is a STALL with that reason', () => {
  const result = deployFixture('norun');
  assert.equal(result.state, 'stalled');
  assert.equal(result.stall, `Deploy verify: ingen koersel oprettet for ${sha}`);
});

test('-StallMinutes 0 turns the alarm off (old timeout behaviour)', () => {
  const result = deployFixture('stuck', { timeout: 30, stall: 0 });
  assert.equal(result.state, 'pending');
  assert.equal(result.stall, null);
});

// CI (main): polling replaces the blocking `gh run watch`.
function ciFixture(mode) {
  return pwsh(`
    $ErrorActionPreference='Stop'; $DryRun=$false; $Repo='fixture/repo'; $script:queueStall=$null;
    $clock=Get-Date -Year 2026 -Month 10 -Day 18 -Hour 12 -Minute 0 -Second 0; $start=$clock; $views=0;
    ${load(['Wait-ForWorkflowRun'])}
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'list'){ return '[{"databaseId":7,"headSha":"${sha}","status":"in_progress","conclusion":null}]' }
      if($GhArgs[0] -eq 'run' -and $GhArgs[1] -eq 'view'){
        $script:views++;
        if('${mode}' -eq 'progress' -and $script:views -ge 60){ return '{"status":"completed","conclusion":"success","jobs":[]}' }
        $done=if('${mode}' -eq 'progress'){$script:views}else{2};
        return (@{status='in_progress';conclusion=$null;jobs=@(@{name='tests';status='in_progress';conclusion=$null;steps=@(1..($done+1) | ForEach-Object { @{name="s$_";status=$(if($_ -le $done){'completed'}else{'in_progress'})} })})}|ConvertTo-Json -Depth 6 -Compress)
      }
      throw "Unexpected GitHub operation $($GhArgs -join ' ')"
    }
    function gh { throw 'gh run watch must not be called' }
    $ok=Wait-ForWorkflowRun -WorkflowFile 'ci.yml' -Sha '${sha}' -TimeoutMinutes 25 -Label 'CI (main) aaaaaaaa' -StallMinutes 15 -Now {$script:clock} -Pause {param($Seconds) $script:clock=$script:clock.AddSeconds($Seconds)};
    Write-Output ('RESULT='+(@{ok=$ok;stall=$script:queueStall;minutes=[int]($clock-$start).TotalMinutes}|ConvertTo-Json -Compress));
  `).result;
}

test('CI (main) without job or step progress is a STALL instead of a 25-minute wait', () => {
  const result = ciFixture('stuck');
  assert.equal(result.ok, false);
  assert.equal(result.stall, "'CI (main) aaaaaaaa' (run 7): ingen job- eller trin-skift (status: in_progress)");
  assert.ok(result.minutes >= 15 && result.minutes <= 16, `stalled after ${result.minutes} min`);
});

test('CI (main) that progresses step by step finishes green without a STALL', () => {
  assert.deepEqual(ciFixture('progress'), { ok: true, stall: null, minutes: 20 });
});

test('running release checks without progress are a STALL; -StallMinutes 0 keeps the old wait', () => {
  const run = (stall, wait) => pwsh(`
    $ErrorActionPreference='Stop'; $Repo='fixture/repo'; $script:queueStall=$null; $script:handedOffRuns=@(7);
    ${load(['Get-FailedHandedOffRuns'])}
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      if($GhArgs[1] -match '/jobs'){ return (@{jobs=@(@{name='Deploy live + smoke';run_id=7;run_attempt=1;status='completed';conclusion='success';steps=@()},@{name='Release checks';run_id=7;run_attempt=1;status='in_progress';conclusion=$null;steps=@(@{name='a';status='completed'})})}|ConvertTo-Json -Depth 6 -Compress) }
      return (@{id=7;run_attempt=1;status='in_progress';conclusion=$null}|ConvertTo-Json -Compress)
    }
    $failed=@(Get-FailedHandedOffRuns -ClassifierPath '${classifier}' -WaitMinutes ${wait} -PollSeconds 0 -StallMinutes ${stall});
    Write-Output ('RESULT='+(@{failed=$failed;stall=$script:queueStall}|ConvertTo-Json -Compress));
  `).result;
  assert.deepEqual(run(0.002, 5), { failed: ['7 (STALL: release checks uden fremskridt i 0.002 min)'], stall: 'Release checks (run 7): ingen job- eller trin-skift' });
  assert.deepEqual(run(0, 0.002), { failed: ['7 (release checks ikke faerdige efter 0.002 min)'], stall: null });
});

test('the Discord ops alarm uses DISCORD_OPS_WEBHOOK_URL, falls back to the console and never prints the URL', () => {
  const hook = 'https://discord.invalid/api/webhooks/fixture-secret';
  const script = posted => `
    $ErrorActionPreference='Stop';
    ${load(['Send-QueueStallAlarm'])}
    $script:calls=@();
    $r=Send-QueueStallAlarm -Message 'Merge-koe STALL: x' -Post {param($Uri,$Body) ${posted}; $script:calls+=@{uri=$Uri;body=$Body}};
    Write-Output ('RESULT='+(@{r=$r;calls=@($script:calls)}|ConvertTo-Json -Depth 4 -Compress));`;
  const unset = pwsh(script(''), { DISCORD_OPS_WEBHOOK_URL: '' });
  assert.deepEqual(unset.result, { r: 'console', calls: [] });
  assert.match(unset.stdout, /DISCORD_OPS_WEBHOOK_URL er ikke sat/);
  const sent = pwsh(script(''), { DISCORD_OPS_WEBHOOK_URL: hook });
  assert.equal(sent.result.r, 'sent');
  assert.equal(sent.result.calls[0].uri, hook);
  assert.deepEqual(JSON.parse(sent.result.calls[0].body), { content: 'Merge-koe STALL: x' });
  const failed = pwsh(script(`throw "POST to ${hook} failed"`), { DISCORD_OPS_WEBHOOK_URL: hook });
  assert.equal(failed.result.r, 'failed');
  for (const out of [unset.stdout, sent.stdout.replace(/RESULT=.*/, ''), failed.stdout.replace(/RESULT=.*/, '')]) assert.ok(!out.includes('fixture-secret'));
});

test('Stop-QueueStall writes the STALL line with the cause and merged PRs, alarms and exits 1', () => {
  const res = pwsh(`
    $ErrorActionPreference='Stop'; $StallMinutes=15; $script:batchMerged=@(41,42);
    $script:queueStall="Deploy verify (run 10, attempt 1): 'waiting' uden job- eller trin-skift";
    ${load(['Send-QueueStallAlarm', 'Stop-QueueStall'])}
    Stop-QueueStall
    Write-Output 'NOT REACHED'`, { DISCORD_OPS_WEBHOOK_URL: '' });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /STALL: Deploy verify \(run 10, attempt 1\): 'waiting' uden job- eller trin-skift\. Intet fremskridt i 15 min - koeen stopper i stedet for at vente til timeout\./);
  assert.match(res.stdout, /Allerede merget uden faerdig verifikation: #41, #42/);
  assert.doesNotMatch(res.stdout, /NOT REACHED/);
});

test('Codex #6861 round 3: every deploying PR is deploy-verified, and the tick window is rechecked right before the merge', () => {
  assert.match(source, /\n  if \(\$script:batchBackend -or \$script:batchRailway -or \$script:batchVercel\) \{\n\s+\$deployState = Wait-ForDeployVerification/);
  assert.match(source, /\n  if \(\$entryVercel\) \{ \$script:batchVercel = \$true \}/);
  assert.doesNotMatch(source, /\$batchSize -gt 1 -and \$script:batchRailway/);
  const loop = source.slice(source.indexOf('for ($idx = 0; $idx -lt $plan.Count; $idx++)'));
  const wait = loop.indexOf('$failedRuns = @(Get-FailedHandedOffRuns');
  const recheck = loop.indexOf('Wait-OutOfMergeTickWindow', wait);
  assert.ok(wait > 0 && recheck > wait && recheck < loop.indexOf('guarded-merge --pr'), 'tick window rechecked after the release-checks wait');
});

test('every waiting step in the queue is stall-guarded and stops through Stop-QueueStall', () => {
  assert.equal(Number(source.match(/\[int\] \$StallMinutes = (\d+)/)[1]), 45);
  assert.match(source, /Wait-ForWorkflowRun -WorkflowFile "ci\.yml" .* -StallMinutes \$StallMinutes\n\s+# #6859[^\n]*\n\s+if \(\$script:queueStall\) \{ return \$false \}/);
  assert.match(source, /\$deployState = Wait-ForDeployVerification -Sha \$sha -TimeoutMinutes \$DeployVerifyTimeoutMinutes -StallMinutes \$StallMinutes\n\s+if \(\$deployState -eq 'stalled'\) \{ Stop-QueueStall \}/);
  assert.match(source, /\[double\] \$StallMinutes = \$script:StallMinutes/);
  for (const call of ['$failedRuns = @(Get-FailedHandedOffRuns', '$finalFailed = @(Get-FailedHandedOffRuns', '$ok = Wait-BatchCi', '$ciOk = Wait-BatchCi']) {
    const at = source.indexOf(call);
    assert.ok(at > 0, call);
    assert.match(source.slice(at, at + 250), /if \(\$script:queueStall\) \{ Stop-QueueStall \}/, call);
  }
  // A stalled CI wait is not recorded as red CI (no wrong culprit).
  const batch = source.slice(source.indexOf('function Wait-BatchCi'), source.indexOf('function Exit-Queue'));
  assert.ok(batch.indexOf('if ($script:queueStall) { return $false }') < batch.indexOf('$script:ciResults[$s] = [bool]$ok'));
  const wait = source.slice(source.indexOf('function Wait-ForWorkflowRun'), source.indexOf('function Wait-ForDeployVerification'));
  assert.doesNotMatch(wait, /gh run watch \$runId/);
  // The STALL exit is a stop (1), never the pending code 75.
  const stop = source.slice(source.indexOf('function Stop-QueueStall'), source.indexOf('function Get-DeployGateAction'));
  assert.match(stop, /exit 1\n/);
});

// #6081: exercise the production wait with a fixed clock and scripted API reads.
function ciStatusFixture(observations, { timeout = 1 } = {}) {
  const json = JSON.stringify(observations).replaceAll("'", "''");
  return pwsh(`
    Set-StrictMode -Version Latest; $ErrorActionPreference='Stop';
    $DryRun=$false; $Repo='fixture/repo'; $script:queueStall=$null;
    $script:clock=[DateTime]::Parse('2026-10-19T12:00:00Z'); $script:views=0;
    $observations=ConvertFrom-Json '${json}';
    ${load(['Wait-ForWorkflowRun', 'Wait-BatchCi'])}
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs,[switch]$TolerateFailure)
      if($GhArgs[1] -eq 'list'){ return '[{"databaseId":7,"headSha":"${sha}"}]' }
      if($GhArgs[1] -eq 'view'){
        $index=[Math]::Min($script:views, $observations.Count-1); $script:views++;
        if($null -eq $observations[$index]){return $null}
        return ($observations[$index]|ConvertTo-Json -Depth 6 -Compress)
      }
      throw 'Unexpected operation'
    }
    $ok=Wait-ForWorkflowRun -WorkflowFile 'ci.yml' -Sha '${sha}' -TimeoutMinutes ${timeout} -Label 'CI (main)' -Now {$script:clock} -Pause {param($Seconds) $script:clock=$script:clock.AddSeconds($Seconds)};
    Write-Output ('RESULT='+(@{ok=$ok;views=$script:views}|ConvertTo-Json -Compress));
  `);
}
const ciRun = (status, conclusion = null) => ({ status, conclusion, jobs: [] });

test('#6081 queued/in_progress and transient API errors wait until completed success', () => {
  const result = ciStatusFixture([ciRun('queued'), null, ciRun('in_progress'), ciRun('completed', 'success')], { timeout: 2 });
  assert.equal(result.status, 0);
  assert.deepEqual(result.result, { ok: true, views: 4 });
  assert.doesNotMatch(result.stdout, /ROED/);
});

test('#6081 a pending timeout stops without calling CI red', () => {
  for (const status of ['queued', 'in_progress']) {
    const result = ciStatusFixture([ciRun(status)]);
    assert.equal(result.status, 0);
    assert.deepEqual(result.result, { ok: false, views: 3 });
    assert.match(result.stdout, /VENT.*timeout/i);
    assert.doesNotMatch(result.stdout, /ROED/);
  }
});

test('#6081 only completed failure is red; other conclusions stop without success', () => {
  for (const conclusion of ['success', 'failure', 'cancelled', 'timed_out', null]) {
    const result = ciStatusFixture([ciRun('completed', conclusion)]);
    assert.equal(result.status, 0);
    assert.deepEqual(result.result, { ok: conclusion === 'success', views: 1 });
    assert.equal(result.stdout.includes('ROED'), conclusion === 'failure', String(conclusion));
  }
});

test('#6081 an unfinished run cannot be classified from a stale failure conclusion', () => {
  const result = ciStatusFixture([ciRun('in_progress', 'failure'), ciRun('completed', 'success')]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.result, { ok: true, views: 2 });
  assert.doesNotMatch(result.stdout, /ROED/);
});

test('#6081 batch results distinguish failed CI from missing verification', () => {
  for (const state of ['success', 'failure', 'pending', 'blocked']) {
    const result = pwsh(`
      Set-StrictMode -Version Latest; $ErrorActionPreference='Stop';
      $script:batchShas=@('sha'); $script:ciResults=@{}; $script:queueStall=$null;
      $CiTimeoutMinutes=25; $StallMinutes=45;
      ${load(['Wait-BatchCi'])}
      function Wait-ForWorkflowRun { $script:workflowRunState='${state}'; return ('${state}' -eq 'success') }
      $ok=Wait-BatchCi;
      Write-Output ('RESULT='+(@{ok=$ok;unverified=$script:ciUnverified;ci=$script:ciResults['sha']}|ConvertTo-Json -Compress));
    `);
    assert.equal(result.status, 0);
    assert.deepEqual(result.result, {
      ok: state === 'success',
      unverified: ['pending', 'blocked'].includes(state),
      ci: state === 'success' ? true : state === 'failure' ? false : null,
    });
  }
});

test('#6081 the real batch stop reports confirmed failures even alongside unverified runs', () => {
  const start = source.indexOf('$ciOk = Wait-BatchCi');
  const stopBlock = source.slice(start, source.indexOf('$script:batchMerged = @()', start));
  for (const states of [['failure', 'pending'], ['pending', 'failure'], ['pending', 'blocked']]) {
    const result = pwsh(`
      Set-StrictMode -Version Latest; $ErrorActionPreference='Stop';
      $script:batchShas=@('sha1','sha2'); $script:ciResults=@{}; $script:queueStall=$null;
      $CiTimeoutMinutes=25; $StallMinutes=45; $batchLabel='#1, #2';
      $states=@('${states.join("','")}'); $script:reads=0;
      ${load(['Wait-BatchCi'])}
      function Wait-ForWorkflowRun {
        $script:workflowRunState=$states[$script:reads]; $script:reads++;
        return ($script:workflowRunState -eq 'success')
      }
      function Write-TrainCulprit { Write-Output 'CULPRIT=ci' }
      function Stop-QueueStall { throw 'Unexpected STALL' }
      ${stopBlock}
    `);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.stdout.includes('ROED'), states.includes('failure'), result.stdout);
    assert.equal(result.stdout.includes('CULPRIT=ci'), states.includes('failure'), result.stdout);
  }
});

test('#6081 real culprit serialization preserves unknown CI before a confirmed failure', () => {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url)).replaceAll("'", "''");
  // AST extraction has no script filename; inject only the classifier's directory.
  const loader = load(['Write-TrainCulprit']).replace(
    'Invoke-Expression $fn.Extent.Text;',
    'Invoke-Expression ($fn.Extent.Text.Replace(' + "'$PSScriptRoot', " + '"' + "'" + scriptsDir + "'" + '"));',
  );
  const result = pwsh(`
    $ErrorActionPreference='Stop';
    ${loader}
    $script:ciResults=@{sha1=$null;sha2=$false};
    $script:trainEntries=@(
      [pscustomobject]@{number=1;sha='sha1';touchesBackend=$false;touchesRailway=$false;touchesVercel=$false},
      [pscustomobject]@{number=2;sha='sha2';touchesBackend=$false;touchesRailway=$false;touchesVercel=$false}
    );
    Write-TrainCulprit 'ci';
  `);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Mistaenkte i merge-raekkefoelge: #1, #2\./);
});
