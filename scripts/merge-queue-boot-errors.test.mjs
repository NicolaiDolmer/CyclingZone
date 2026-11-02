import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('queue distinguishes exhausted evidence probes without exposing their raw output', () => {
  const path = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference='Stop';
    $ast=[Management.Automation.Language.Parser]::ParseFile('${path}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WaveEvidenceFailure'},$true);
    Invoke-Expression $fn.Extent.Text;
    @(@{boot=(Get-WaveEvidenceFailure @('private-command-fixture','WAVE_BOOT_IDENTITY_UNAVAILABLE')); process=(Get-WaveEvidenceFailure @('WAVE_PROCESS_SNAPSHOT_UNAVAILABLE')); other=(Get-WaveEvidenceFailure @('ordinary lock rejection'))}) | ConvertTo-Json -Compress
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.match(value.boot, /boot-identitet.*ikke en afvist boelgelaas/);
  assert.match(value.process, /procesbevis/);
  assert.equal(value.other, null);
  assert.doesNotMatch(result.stdout, /private-command-fixture/);
});
