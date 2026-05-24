#!/usr/bin/env pwsh
# Mock-test af agent-doctor's sentry-config status-matrix (#620).
# Bypasser CLI via DOCTOR_MOCK_SENTRY_PROBE env-var; verificér alle 5 matrix-cases.
# Bruges efter ændringer i Get-VercelSentryProdState / Get-RailwaySentryProdState
# for at sikre at OK/WARN-branches stadig matches forventet output.

param([switch]$Verbose)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$doctor = Join-Path $repoRoot "scripts/agent-doctor.ps1"
$cases = @(
  @{
    Name = "1. begge probes OK + begge har DSN"
    Mock = '{"vercel":{"Available":true,"HasFrontendDsn":true,"HasAuthToken":true,"HasBackendDsn":false,"KeyCount":8,"Reason":null},"railway":{"Available":true,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":true,"KeyCount":17,"Reason":null}}'
    ExpectedStatus = "OK"
    ExpectedDetail = "prod wired"
  },
  @{
    Name = "2. begge probes OK + Railway mangler SENTRY_DSN"
    Mock = '{"vercel":{"Available":true,"HasFrontendDsn":true,"HasAuthToken":true,"HasBackendDsn":false,"KeyCount":8,"Reason":null},"railway":{"Available":true,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":false,"KeyCount":15,"Reason":null}}'
    ExpectedStatus = "WARN"
    ExpectedDetail = "prod ikke wired"
  },
  @{
    Name = "3. Vercel fejler, Railway OK"
    Mock = '{"vercel":{"Available":false,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":false,"KeyCount":0,"Reason":"vercel CLI not installed"},"railway":{"Available":true,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":true,"KeyCount":17,"Reason":null}}'
    ExpectedStatus = "WARN"
    ExpectedDetail = "partial prod probe"
  },
  @{
    Name = "4. begge probes fejler, lokal pakker+DSN fully set"
    Mock = '{"vercel":{"Available":false,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":false,"KeyCount":0,"Reason":"vercel CLI not installed"},"railway":{"Available":false,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":false,"KeyCount":0,"Reason":"railway CLI not installed"}}'
    ExpectedStatus = "WARN"
    ExpectedDetail = "kun lokal verificeret"
    ExtraEnv = @{ SENTRY_DSN = "https://mock@mock.sentry.io/1"; VITE_SENTRY_DSN = "https://mock@mock.sentry.io/1" }
  },
  @{
    Name = "5. begge probes fejler, lokal kun pakker (ingen DSN)"
    Mock = '{"vercel":{"Available":false,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":false,"KeyCount":0,"Reason":"vercel CLI not installed"},"railway":{"Available":false,"HasFrontendDsn":false,"HasAuthToken":false,"HasBackendDsn":false,"KeyCount":0,"Reason":"railway CLI not installed"}}'
    ExpectedStatus = "WARN"
    ExpectedDetail = "lokal:"
  }
)

$passed = 0
$failed = 0

foreach ($case in $cases) {
  $argList = @("-NoProfile", "-File", $doctor, "-Json")
  $envBlock = @{
    DOCTOR_MOCK_SENTRY_PROBE = $case.Mock
    DOCTOR_NO_CACHE = "1"
  }
  # Cases 1-3,5: unset local DSN so they can't accidentally trigger fallback's local-wired branch
  if (-not $case.ContainsKey("ExtraEnv")) {
    $envBlock.SENTRY_DSN = ""
    $envBlock.VITE_SENTRY_DSN = ""
  } else {
    foreach ($k in $case.ExtraEnv.Keys) { $envBlock[$k] = $case.ExtraEnv[$k] }
  }

  # Subshell to scope env-var changes
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = "pwsh"
  foreach ($a in $argList) { [void]$startInfo.ArgumentList.Add($a) }
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.UseShellExecute = $false
  foreach ($k in $envBlock.Keys) { $startInfo.Environment[$k] = [string]$envBlock[$k] }
  $proc = [System.Diagnostics.Process]::Start($startInfo)
  $stdout = $proc.StandardOutput.ReadToEnd()
  $proc.WaitForExit()

  try {
    $parsed = $stdout | ConvertFrom-Json
    $sentry = $parsed.checks | Where-Object { $_.Check -eq "sentry-config" }
  } catch {
    Write-Host ("[FAIL] {0} — JSON parse failed" -f $case.Name) -ForegroundColor Red
    $failed++; continue
  }

  $statusOk = $sentry.Status -eq $case.ExpectedStatus
  $detailOk = $sentry.Detail -like ("*{0}*" -f $case.ExpectedDetail)

  if ($statusOk -and $detailOk) {
    Write-Host ("[PASS] {0}" -f $case.Name) -ForegroundColor Green
    if ($Verbose) { Write-Host "       got: $($sentry.Status) — $($sentry.Detail)" -ForegroundColor DarkGray }
    $passed++
  } else {
    Write-Host ("[FAIL] {0}" -f $case.Name) -ForegroundColor Red
    Write-Host ("       expected status={0}, detail like '*{1}*'" -f $case.ExpectedStatus, $case.ExpectedDetail) -ForegroundColor Yellow
    Write-Host ("       got      status={0}, detail={1}" -f $sentry.Status, $sentry.Detail) -ForegroundColor Yellow
    $failed++
  }
}

Write-Host ""
Write-Host ("Result: {0} passed, {1} failed" -f $passed, $failed) -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
if ($failed -gt 0) { exit 1 }
exit 0
