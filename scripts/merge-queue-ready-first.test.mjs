import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 23/10 (ejer: "een PR ad gangen"): klar-foerst, opdatering af kun den forreste PR,
// og SKIP i stedet for STOP naar en enkelt PR ikke er groen. Main-roed stopper stadig.

const queue = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const load = names => `
  $ast=[Management.Automation.Language.Parser]::ParseFile('${queue}',[ref]$null,[ref]$null);
  foreach($name in @(${names.map(name => `'${name}'`).join(',')})){
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);
    Invoke-Expression $fn.Extent.Text;
  }`;
function pwsh(script) {
  const res = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const line = res.stdout.split(/\r?\n/).find(l => l.startsWith('RESULT='));
  return { status: res.status, stdout: res.stdout + res.stderr, result: line ? JSON.parse(line.slice(7)) : null };
}

// Stubs: hver Get-PrPlanEntry-laesning tager naeste tilstand fra listen.
const harness = (states, failed, { front = 7, reserved = false, advance = false } = {}) => `
  ${load(['Wait-PrGreen'])}
  $script:states = @(${states.map(([exit, merge]) => `@{ checksExit=${exit}; checksSummary='s'; headSha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; mergeState='${merge}' }`).join(',')});
  $script:reads = 0; $script:updates = 0; $script:updated = @{}; $NoUpdateBehind = $false
  $script:frontPr = ${front}; $script:branchUpdateAttempted = $${reserved ? 'true' : 'false'}
  function Get-PrPlanEntry([int]$n) { $i=[Math]::Min($script:reads, $script:states.Count-1); $script:reads++; [pscustomobject]$script:states[$i] }
  function Test-RequiredCheckFailedBecauseBehind([int]$n, [string]$sha) { return $${failed ? 'true' : 'false'} }
  function Test-BranchUpdateSlotOpen { return $true }
  function Invoke-PrUpdateBehind([int]$n) { $script:updates++; $script:updated["$n"] = $true; return $true }
  $script:t = [datetime]'2026-10-23T12:00:00'
  $now = { $script:t }; $pause = { param($s) $script:t = $script:t.AddSeconds($s) }
  $r = Wait-PrGreen 7 5 -Now $now -Pause $pause
  ${advance ? '$script:frontPr = 8; $null = Wait-PrGreen 8 5 -Now $now -Pause $pause' : ''}
  "RESULT=" + (@{ exit=$r.checksExit; reads=$script:reads; updates=$script:updates } | ConvertTo-Json -Compress)`;

test('Wait-PrGreen venter til groen og opdaterer ikke en PR der kun afventer', () => {
  const { result, stdout } = pwsh(harness([[8, 'BEHIND'], [8, 'BEHIND'], [0, 'BEHIND']], false));
  assert.ok(result, stdout);
  assert.equal(result.exit, 0);
  assert.equal(result.updates, 0, 'afventende checks er ingen grund til at opdatere');
});

test('Wait-PrGreen opdaterer EEN gang naar PR er bagud og et paakraevet check fejler', () => {
  const { result, stdout } = pwsh(harness([[1, 'BEHIND'], [1, 'BEHIND'], [8, 'BLOCKED'], [0, 'CLEAN']], true));
  assert.ok(result, stdout);
  assert.equal(result.exit, 0);
  assert.equal(result.updates, 1, 'kun een opdatering pr. PR');
});

test('Wait-PrGreen opdaterer ikke en roed PR der ikke er bagud', () => {
  const { result, stdout } = pwsh(harness([[1, 'CLEAN'], [1, 'CLEAN'], [0, 'CLEAN']], true));
  assert.ok(result, stdout);
  assert.equal(result.updates, 0);
});

test('queue cannot update a PR outside the front slot', () => {
  const { result, stdout } = pwsh(harness([[1, 'BEHIND']], true, { front: 8 }));
  assert.ok(result, stdout);
  assert.equal(result.updates, 0);
});

test('queue cannot update a second PR after reserving the branch update slot', () => {
  const { result, stdout } = pwsh(harness([[1, 'BEHIND']], true, { reserved: true }));
  assert.ok(result, stdout);
  assert.equal(result.updates, 0);
});

test('a timed-out front candidate consumes the only update attempt in the train', () => {
  const { result, stdout } = pwsh(harness([[1, 'BEHIND']], true, { advance: true }));
  assert.ok(result, stdout);
  assert.equal(result.updates, 1);
});

test('a red required check is accepted only with explicit stale-base evidence on the same HEAD', () => {
  const { result, stdout } = pwsh(`
    ${load(['Test-RequiredCheckFailedBecauseBehind'])}
    $Repo = 'o/r'
    $script:head = 'a' * 40
    $expected = $script:head
    $script:state = 'FAILURE'; $script:title = 'Tests failed'
    function Get-PrCheckSnapshot { return @{required=@(@{name='CI'; bucket='fail'; state=$script:state; link='https://github.com/o/r/actions/runs/1/job/9'})} }
    function Invoke-GhWithRetry($a, [switch]$TolerateFailure) {
      if ($a[1] -eq 'repos/o/r/actions/jobs/9') { return 'https://api.github.com/repos/o/r/check-runs/11' }
      if ($a[1] -eq 'repos/o/r/check-runs/11') {
        return ConvertTo-Json @{ head_sha=$script:head; name='CI'; title=$script:title; conclusion='failure' } -Compress
      }
      throw 'unexpected request'
    }
    $unrelated = Test-RequiredCheckFailedBecauseBehind 7 $expected
    $script:title = 'Branch is behind the base branch.'
    $stale = Test-RequiredCheckFailedBecauseBehind 7 $expected
    $script:head = 'b' * 40
    $old = Test-RequiredCheckFailedBecauseBehind 7 $expected
    $script:head = $expected
    $script:state = 'PENDING'
    $pending = Test-RequiredCheckFailedBecauseBehind 7 $expected
    "RESULT=" + (@{ unrelated=$unrelated; stale=$stale; old=$old; pending=$pending } | ConvertTo-Json -Compress)
  `);
  assert.ok(result, stdout);
  assert.deepEqual(result, { unrelated: false, stale: true, old: false, pending: false });
});

test('a later train can reserve the slot only after the prior update has terminal checks', () => {
  const { result, stdout } = pwsh(`
    ${load(['Test-BranchUpdateSlotOpen'])}
    $Repo = 'o/r'
    $script:branchUpdateSlot = 'simulated'
    $script:oldHead = 'a' * 40
    $script:newHead = $script:oldHead
    $script:state = 'OPEN'; $script:bucket = 'pending'
    $script:branchUpdateSlotLogged = $false
    $now = { [datetimeoffset]'2026-11-24T12:00:00Z' }
    function Test-Path { return $true }
    function Get-Content { return (ConvertTo-Json @{ repo=$Repo; number=7; head=$script:oldHead; checks=@('CI'); expiresAt='2026-11-24T14:00:00Z' } -Compress) }
    function Get-PrCheckSnapshot { return @{ required=@(@{name='CI';bucket=$script:bucket}) } }
    function Invoke-GhWithRetry($a, [switch]$TolerateFailure) {
      if ($a -contains 'state,headRefOid') { return (ConvertTo-Json @{ state=$script:state; headRefOid=$script:newHead } -Compress) }
      if ($a -contains '.headRefOid') { return $script:newHead }
      throw 'unexpected request'
    }
    $unchanged = Test-BranchUpdateSlotOpen -Now $now
    $script:newHead = 'b' * 40
    $pending = Test-BranchUpdateSlotOpen -Now $now
    $script:bucket = 'fail'
    $terminal = Test-BranchUpdateSlotOpen -Now $now
    $script:state = 'CLOSED'
    $closed = Test-BranchUpdateSlotOpen -Now $now
    "RESULT=" + (@{ unchanged=$unchanged; pending=$pending; terminal=$terminal; closed=$closed } | ConvertTo-Json -Compress)
  `);
  assert.ok(result, stdout);
  assert.deepEqual(result, { unchanged: false, pending: false, terminal: true, closed: true });
});

test('an accepted update keeps its reservation, while a definite rejection clears it', () => {
  const { result, stdout } = pwsh(`
    ${load(['Invoke-PrUpdateBehind'])}
    $Repo = 'o/r'
    $script:branchUpdateSlot = Join-Path ([System.IO.Path]::GetTempPath()) ("merge-branch-fixture-" + [guid]::NewGuid())
    $script:updated = @{}
    $script:status = '422 Unprocessable Entity'
    $script:head = 'a' * 40
    $now = { [datetimeoffset]'2026-11-24T12:00:00Z' }
    $script:base = 'stacked-base'
    function Invoke-GhWithRetry($a, [switch]$TolerateFailure) {
      if ($a[1] -eq 'view') {
        return ConvertTo-Json @{ baseRefName=$script:base; headRefOid=$script:head; isDraft=$false; mergeStateStatus='BEHIND'; state='OPEN' } -Compress
      }
      if ($a[1] -eq 'checks') { return '[{"name":"CI"}]' }
      throw 'unexpected request'
    }
    function gh {
      if ($args -notcontains "expected_head_sha=$script:head") { throw 'missing exact HEAD' }
      if (-not (Test-Path -LiteralPath $script:branchUpdateSlot)) { throw 'request before reservation' }
      if ($script:status) { "HTTP/2.0 $script:status" }
    }
    try {
      $nonMain = Invoke-PrUpdateBehind 7 $script:head -Now $now
      $script:base = 'main'
      $null = Invoke-PrUpdateBehind 7 $script:head -Now $now
      $rejected = Test-Path -LiteralPath $script:branchUpdateSlot
      $script:status = '202 Accepted'
      $accepted = Invoke-PrUpdateBehind 7 $script:head -Now $now
      $saved = Test-Path -LiteralPath $script:branchUpdateSlot
      $script:status = $null
      $uncertain = Invoke-PrUpdateBehind 7 $script:head -Now $now
      $retained = Test-Path -LiteralPath $script:branchUpdateSlot
      "RESULT=" + (@{ nonMain=$nonMain; rejected=$rejected; accepted=$accepted; saved=$saved; uncertain=$uncertain; retained=$retained } | ConvertTo-Json -Compress)
    } finally {
      Remove-Item -LiteralPath $script:branchUpdateSlot -ErrorAction SilentlyContinue
    }
  `);
  assert.ok(result, stdout);
  assert.deepEqual(result, { nonMain: false, rejected: false, accepted: true, saved: true, uncertain: false, retained: true });
});

test('en ikke-groen PR stilles bagerst een gang, og SKIP i stedet for STOP', () => {
  assert.match(source, /if \(-not \$script:deferred\.ContainsKey\("\$n"\) -and \(\$idx \+ 1\) -lt \$plan\.Count\) \{[\s\S]*?\$plan \+= \$entry\n\s*continue/);
  assert.match(source, /\$fresh = Wait-PrGreen \$n \$WaitPendingMinutes/);
  assert.match(source, /SKIP: PR #\$n er ikke groen efter/);
  assert.match(source, /SKIP: PR #\$n overlapper en koerende boelges ownership/);
});

test('-StopOnRedPr bevarer den gamle STOP-adfaerd, og -DryRun er uaendret', () => {
  assert.match(source, /if \(\$fresh\.checksExit -ne 0 -and -not \$StopOnRedPr -and -not \$DryRun\)/);
  assert.match(source, /STOP: PR #\$n har ikke groenne paakraevede checks/);
});

test('aldrig masseopdatering: update-branch kaldes kun fra Invoke-PrUpdateBehind', () => {
  const calls = source.match(/\/update-branch\b/g) || [];
  assert.equal(calls.length, 1);
  assert.match(source, /function Invoke-PrUpdateBehind[\s\S]*?\/update-branch/);
});

test('et tog hvis sidste PR blev sprunget over, verificeres efter loekken', () => {
  // Codex P1 #7104: samme lukning (CI + deploy-verifikation) som et normalt togslut.
  assert.match(source, /if \(-not \$DryRun -and \$script:batchMerged\.Count -gt 0\) \{ Close-OpenTrain \}/);
  assert.match(source, /function Close-OpenTrain \{[\s\S]*?Wait-BatchCi[\s\S]*?Wait-ForDeployVerification[\s\S]*?\n\}/);
  assert.match(source, /\[DELVIS\][\s\S]*?exit 2/);
});

test('Wait-PrGreen: injiceret ur, timeout naas uden vaegur (Codex P1 #7104)', () => {
  // Altid afventende -> efter 5 min (5 pauser a 60 s paa det injicerede ur) gives op.
  const { result, stdout } = pwsh(harness([[8, 'CLEAN']], false));
  assert.ok(result, stdout);
  assert.equal(result.exit, 8);
  assert.equal(result.reads, 6, 'foerste laesning + en pr. minut indtil deadline');
});

test('et aabent tog lukkes foer en solo-PR eller en PR der ikke daekker togets deploy-maal (Codex P1 #7104)', () => {
  assert.ok(source.includes('$coversTrain = ((-not $script:batchVercel) -or [bool]$fresh.touchesVercel) -and ((-not $script:trainNeedsRailway) -or [bool]$fresh.needRailway)'), 'daekning kun fra den friske diff (Codex P1 #7104)');
  assert.match(source, /if \(-not \$DryRun -and \$script:batchMerged\.Count -gt 0 -and \(\$entrySolo -or -not \$coversTrain\)\) \{[\s\S]*?Close-OpenTrain/);
});

test('Exit-Queue lukker et aabent tog med fuld deploy-verifikation (Codex P1 #7104)', () => {
  assert.match(source, /function Exit-Queue\(\[int\]\$Code\) \{[\s\S]*?Close-OpenTrain[\s\S]*?exit \$Code/);
  assert.doesNotMatch(source, /Deploy-verifikation er IKKE ventet/);
});

test('et aabent tog lukkes foer ventetiden paa en udskudt PR (Codex P1 #7104)', () => {
  assert.match(source, /if \(\$script:batchMerged\.Count -gt 0\) \{ Close-OpenTrain \}\n\s*\$script:frontPr = \$n\n\s*try \{ \$fresh = Wait-PrGreen \$n \$WaitPendingMinutes/);
});

test('merge-kø læser faktisk liga-audit på HEAD trods skipped suite i rollup (#7312)', () => {
  const script = fileURLToPath(new URL('./test-league-rest-check.ps1', import.meta.url));
  const res = spawnSync('pwsh', ['-NoProfile', '-File', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});


test('Claude shell hook blocks both direct branch update commands', () => {
  const hook = fileURLToPath(new URL('./hooks/block-direct-pr-update.mjs', import.meta.url));
  for (const [command, expected] of [
    ['for pr in 7 8; do gh pr update-branch "$pr"; done', 2],
    ['gh api --method PUT "repos/o/r/pulls/$pr/update-branch"', 2],
    ["gh 'pr' 'update-branch' 7", 2],
    ["foreach ($n in 7,8) { & gh @('pr', 'update-branch', $n) }", 2],
    ['pwsh -File scripts/merge-queue.ps1 -Pr 7,8', 0],
    ['gh api repos/o/r/pulls/7/commits', 0],
    ['gh issue comment 7 --body "Blocked gh pr update-branch in a loop"', 0],
  ]) {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({tool_input: {command}}),
      encoding: 'utf8',
    });
    assert.equal(result.status, expected, result.error?.message ?? result.stderr);
  }
});

test('expired update reservation releases the slot without GitHub and logs occupied reservations', () => {
  const { result, stdout } = pwsh(`
    ${load(['Test-BranchUpdateSlotOpen'])}
    $Repo = 'o/r'; $script:branchUpdateSlot = 'simulated'
    $script:current = [datetimeoffset]'2026-11-24T12:00:00Z'
    $script:reads = 0
    $script:branchUpdateSlotLogged = $false
    function Test-Path { return $true }
    function Get-Content { return (ConvertTo-Json @{ repo=$Repo; number=7; head=('a' * 40); expiresAt='2026-11-24T12:01:00Z' } -Compress) }
    function Invoke-GhWithRetry { $script:reads++; return $null }
    $held = Test-BranchUpdateSlotOpen -Now { $script:current }
    $script:current = $script:current.AddMinutes(1)
    $expired = Test-BranchUpdateSlotOpen -Now { $script:current }
    function Get-Content { return '{}' }
    function Get-Item { return @{LastWriteTimeUtc=[datetime]'2026-11-24T10:01:00Z'} }
    $legacyExpired = Test-BranchUpdateSlotOpen -Now { $script:current }
    "RESULT=" + (@{ held=$held; expired=$expired; legacyExpired=$legacyExpired; reads=$script:reads } | ConvertTo-Json -Compress)
  `);
  assert.ok(result, stdout);
  assert.deepEqual(result, { held: false, expired: true, legacyExpired: true, reads: 1 });
  assert.match(stdout, /vagt:.*#7/);
});
