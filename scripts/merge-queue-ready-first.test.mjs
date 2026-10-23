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
const harness = (states, failed) => `
  ${load(['Wait-PrGreen'])}
  $script:states = @(${states.map(([exit, merge]) => `@{ checksExit=${exit}; checksSummary='s'; mergeState='${merge}' }`).join(',')});
  $script:reads = 0; $script:updates = 0; $script:updated = @{}; $NoUpdateBehind = $false
  function Get-PrPlanEntry([int]$n) { $i=[Math]::Min($script:reads, $script:states.Count-1); $script:reads++; [pscustomobject]$script:states[$i] }
  function Test-RequiredCheckFailed([int]$n) { return $${failed ? 'true' : 'false'} }
  function Invoke-PrUpdateBehind([int]$n) { $script:updates++; $script:updated["$n"] = $true; return $true }
  $script:t = [datetime]'2026-10-23T12:00:00'
  $now = { $script:t }; $pause = { param($s) $script:t = $script:t.AddSeconds($s) }
  $r = Wait-PrGreen 7 5 -Now $now -Pause $pause
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
  const calls = source.match(/'update-branch'/g) || [];
  assert.equal(calls.length, 1);
  assert.match(source, /function Invoke-PrUpdateBehind[\s\S]*?'update-branch'/);
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
  assert.ok(source.includes('$coversTrain = ((-not $script:batchVercel) -or $entryVercel) -and ((-not ($script:batchRailway -or $script:batchBackend)) -or $entryRailway)'));
  assert.match(source, /if \(-not \$DryRun -and \$script:batchMerged\.Count -gt 0 -and \(\$entrySolo -or -not \$coversTrain\)\) \{[\s\S]*?Close-OpenTrain/);
});
