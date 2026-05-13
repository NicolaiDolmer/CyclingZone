param(
  [string]$Repo = "NicolaiDolmer/CyclingZone",
  [switch]$FailOnWarning,
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$results = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Detail
  )
  $results.Add([PSCustomObject]@{
    Check = $Name
    Status = $Status
    Detail = $Detail
  })
}

function Try-Run {
  param([string[]]$Command)
  try {
    $output = & $Command[0] $Command[1..($Command.Length - 1)] 2>&1
    return [PSCustomObject]@{ Ok = ($LASTEXITCODE -eq 0); Text = ($output -join "`n") }
  } catch {
    return [PSCustomObject]@{ Ok = $false; Text = $_.Exception.Message }
  }
}

function Gh-Json {
  param([string]$Path)
  $result = Try-Run @("gh", "api", $Path)
  if (-not $result.Ok) { return $null }
  if ($result.Text.Trim() -eq "[]") { return @() }
  return $result.Text | ConvertFrom-Json
}

function Get-AuditFailureDetail {
  param(
    [string]$Text,
    [string]$MigrationHint
  )
  if ($Text -match "auth-failure|Legacy API keys are disabled|Invalid API key|JWT expired|Invalid JWT|401|403") {
    return "auth-failure: rotate local backend/.env SUPABASE_SERVICE_KEY to sb_secret_* (#337)"
  }
  if ($Text -match "rpc-missing|function .* does not exist|Could not find the function|relation .* does not exist|schema cache|404") {
    return "rpc-missing: $MigrationHint"
  }
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return "other: audit script failed without stderr/stdout"
  }
  $firstLine = (($Text -split "`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
  return "other: $firstLine"
}

$rootResult = Try-Run @("git", "rev-parse", "--show-toplevel")
if ($rootResult.Ok) {
  $root = $rootResult.Text.Trim() -replace "\\", "/"
  Add-Check "repo-root" ($(if ($root -eq "C:/dev/CyclingZone") { "OK" } else { "WARN" })) $root
} else {
  Add-Check "repo-root" "FAIL" $rootResult.Text
}

$statusResult = Try-Run @("git", "status", "-sb")
if ($statusResult.Ok) {
  $dirtyLines = @($statusResult.Text -split "`n" | Where-Object { $_ -match "^\s*(M|A|D|R|C|\?\?)\s" })
  Add-Check "git-status" ($(if ($dirtyLines.Count -eq 0) { "OK" } else { "WARN" })) ($statusResult.Text -replace "`n", " | ")
} else {
  Add-Check "git-status" "FAIL" $statusResult.Text
}

$ghAuth = Try-Run @("gh", "auth", "status")
Add-Check "gh-auth" ($(if ($ghAuth.Ok) { "OK" } else { "FAIL" })) ($ghAuth.Text -split "`n" | Select-Object -First 1)

$hooksPath = Try-Run @("git", "config", "--get", "core.hooksPath")
$hooksText = if ($hooksPath.Ok) { $hooksPath.Text.Trim() } else { "" }
Add-Check "local-hooks" ($(if ($hooksText -eq ".githooks") { "OK" } else { "WARN" })) ($(if ($hooksText) { $hooksText } else { "core.hooksPath not set" }))

$trackedSecrets = Try-Run @("git", "ls-files", ".mcp.json", "*.env", ".codex.local/*")
Add-Check "tracked-secrets" ($(if ([string]::IsNullOrWhiteSpace($trackedSecrets.Text)) { "OK" } else { "FAIL" })) ($(if ($trackedSecrets.Text) { $trackedSecrets.Text -replace "`n", ", " } else { "none" }))

$repoInfo = Gh-Json "repos/$Repo"
if ($repoInfo) {
  $security = $repoInfo.security_and_analysis
  $secret = $security.secret_scanning.status
  $push = $security.secret_scanning_push_protection.status
  $validity = $security.secret_scanning_validity_checks.status
  $dependabot = $security.dependabot_security_updates.status
  $securityStatus = if ($secret -eq "enabled" -and $push -eq "enabled" -and $dependabot -eq "enabled") { "OK" } else { "WARN" }
  Add-Check "github-security" $securityStatus "secret=$secret, push=$push, validity=$validity, dependabot=$dependabot"
  Add-Check "auto-merge-setting" ($(if ($repoInfo.allow_auto_merge -eq $true) { "OK" } else { "WARN" })) "allow_auto_merge=$($repoInfo.allow_auto_merge), delete_branch_on_merge=$($repoInfo.delete_branch_on_merge)"
} else {
  Add-Check "github-security" "WARN" "gh api unavailable"
}

$branch = Gh-Json "repos/$Repo/branches/main"
$protection = Gh-Json "repos/$Repo/branches/main/protection"
if ($branch -and $protection) {
  $checks = @($protection.required_status_checks.checks | ForEach-Object { $_.context })
  $strict = $protection.required_status_checks.strict
  $hasCoreChecks = ($checks -contains "backend-tests") -and ($checks -contains "frontend-build") -and ($checks -contains "dependency-review")
  Add-Check "main-protection" ($(if ($branch.protected -and $hasCoreChecks -and $strict) { "OK" } else { "FAIL" })) "protected=$($branch.protected), strict=$strict, checks=$($checks -join ',')"
}

$rulesets = Gh-Json "repos/$Repo/rulesets"
if ($null -ne $rulesets) {
  $rulesetCount = @($rulesets).Count
  Add-Check "rulesets" ($(if ($rulesetCount -gt 0) { "OK" } else { "WARN" })) "$rulesetCount rulesets"
}

$alerts = Gh-Json "repos/$Repo/dependabot/alerts?state=open"
if ($alerts -ne $null) {
  $highAlerts = @($alerts | Where-Object { $_.security_advisory.severity -in @("high", "critical") })
  Add-Check "dependabot-alerts" ($(if ($highAlerts.Count -eq 0) { "OK" } else { "WARN" })) "$($alerts.Count) open, $($highAlerts.Count) high/critical"
}

$runs = Try-Run @("gh", "run", "list", "--repo", $Repo, "--limit", "20", "--json", "conclusion,status,workflowName,url")
if ($runs.Ok) {
  $parsedRuns = $runs.Text | ConvertFrom-Json
  $failedRuns = @($parsedRuns | Where-Object { $_.conclusion -eq "failure" })
  $detail = if ($failedRuns.Count -eq 0) {
    "0 failures in last 20 runs"
  } else {
    ($failedRuns | Select-Object -First 3 | ForEach-Object { "$($_.workflowName) <$($_.url)>" }) -join "; "
  }
  Add-Check "recent-actions" ($(if ($failedRuns.Count -eq 0) { "OK" } else { "WARN" })) $detail
}

$issues = Try-Run @("gh", "issue", "list", "--repo", $Repo, "--state", "open", "--limit", "300", "--json", "number,title,labels")
if ($issues.Ok) {
  $parsedIssues = $issues.Text | ConvertFrom-Json
  $missing = @()
  foreach ($issue in $parsedIssues) {
    $labels = @($issue.labels | ForEach-Object { $_.name })
    if (-not ($labels | Where-Object { $_ -like "priority:*" }) -or
        -not ($labels | Where-Object { $_ -like "type:*" }) -or
        -not ($labels | Where-Object { $_ -like "claude:*" })) {
      $missing += "#$($issue.number)"
    }
  }
  Add-Check "issue-label-schema" ($(if ($missing.Count -eq 0) { "OK" } else { "WARN" })) ($(if ($missing.Count) { "missing: $($missing -join ', ')" } else { "all open issues have priority/type/claude labels" }))
}

$qualityIssues = Try-Run @("gh", "issue", "list", "--repo", $Repo, "--state", "open", "--label", "claude:todo", "--limit", "100", "--json", "number,title,labels,url")
if ($qualityIssues.Ok) {
  $parsedQualityIssues = $qualityIssues.Text | ConvertFrom-Json
  $urgent = @($parsedQualityIssues | Where-Object {
    $labelNames = @($_.labels | ForEach-Object { $_.name })
    ($labelNames -contains "priority:high" -or $labelNames -contains "priority:med") -and
      ($labelNames -contains "type:bug" -or $labelNames -contains "epic:quality-hardening" -or $labelNames -contains "security")
  })
  $detail = if ($urgent.Count -eq 0) {
    "no open high/med quality bugs/security issues"
  } else {
    ($urgent | Select-Object -First 5 | ForEach-Object { "#$($_.number) $($_.title)" }) -join " | "
  }
  Add-Check "quality-inbox" ($(if ($urgent.Count -eq 0) { "OK" } else { "WARN" })) $detail
}

$infisicalCmd = Get-Command infisical -ErrorAction SilentlyContinue
$infisicalWinget = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Recurse -Filter "infisical.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($infisicalCmd) {
  Add-Check "infisical-cli" "OK" $infisicalCmd.Source
} elseif ($infisicalWinget) {
  Add-Check "infisical-cli" "OK" "$($infisicalWinget.FullName) (restart shell to refresh PATH)"
} else {
  Add-Check "infisical-cli" "WARN" "not found — install: winget install Infisical.infisical (see docs/CROSS_PC_SETUP.md)"
}

$sentrySignals = @()
if ($env:SENTRY_DSN -or $env:VITE_SENTRY_DSN -or $env:SENTRY_AUTH_TOKEN) {
  $sentrySignals += "env-present"
}
if ((Test-Path "backend/package.json") -and ((Get-Content -Raw "backend/package.json") -match "@sentry/node")) {
  $sentrySignals += "backend-package"
}
if ((Test-Path "frontend/package.json") -and ((Get-Content -Raw "frontend/package.json") -match "@sentry/react")) {
  $sentrySignals += "frontend-package"
}
Add-Check "sentry-config" ($(if ($sentrySignals -contains "backend-package" -and $sentrySignals -contains "frontend-package") { "OK" } else { "WARN" })) ($(if ($sentrySignals.Count) { $sentrySignals -join ", " } else { "not configured" }))

$tokenHygiene = Try-Run @("pwsh", "-NoProfile", "-File", "scripts/check-agent-token-hygiene.ps1")
if ($tokenHygiene.Ok) {
  Add-Check "token-hygiene" "OK" "startup context within configured limits"
} else {
  Add-Check "token-hygiene" "WARN" "run scripts/check-agent-token-hygiene.ps1"
}

# RLS coverage audit — fanger slice 14 / #279 bug-mønstret lokalt før push.
# Springes hvis SUPABASE_URL eller SUPABASE_SERVICE_KEY ikke er sat.
$envPath = Join-Path $root "backend/.env"
if ((Test-Path $envPath) -and -not $env:SUPABASE_URL) {
  Get-Content $envPath | ForEach-Object {
    if ($_ -match "^\s*([^=#\s]+)\s*=\s*(.*)$") {
      $name = $Matches[1]; $value = $Matches[2].Trim()
      if ($name -in @("SUPABASE_URL", "SUPABASE_SERVICE_KEY") -and -not (Get-Item "env:$name" -ErrorAction SilentlyContinue)) {
        Set-Item "env:$name" $value
      }
    }
  }
}
if ($env:SUPABASE_URL -and $env:SUPABASE_SERVICE_KEY) {
  $rlsResult = Try-Run @("node", "backend/scripts/audit-rls-coverage.js", "--json")
  if ($rlsResult.Ok) {
    try {
      $rlsData = $rlsResult.Text | ConvertFrom-Json
      $crit = [int]$rlsData.critical_count
      $detail = if ($crit -eq 0) { "no frontend-blocked tables" } else { "critical: $(($rlsData.critical | ForEach-Object { $_.table }) -join ', ')" }
      Add-Check "rls-coverage" ($(if ($crit -eq 0) { "OK" } else { "FAIL" })) $detail
    } catch {
      Add-Check "rls-coverage" "WARN" "audit ran but JSON parse failed"
    }
  } else {
    Add-Check "rls-coverage" "WARN" (Get-AuditFailureDetail $rlsResult.Text "apply database/2026-05-10-audit-rls-helper.sql")
  }

  $livenessResult = Try-Run @("node", "backend/scripts/audit-feature-liveness.js", "--json")
  if ($livenessResult.Ok) {
    try {
      $livenessData = $livenessResult.Text | ConvertFrom-Json
      $total = [int]$livenessData.total_findings
      $by = $livenessData.by_detector
      $detail = if ($total -eq 0) { "no drift findings" } else { "$total finding(s): A=$($by.A) B=$($by.B) C=$($by.C) D=$($by.D)" }
      Add-Check "feature-liveness" ($(if ($total -eq 0) { "OK" } else { "FAIL" })) $detail
    } catch {
      Add-Check "feature-liveness" "WARN" "audit ran but JSON parse failed"
    }
  } else {
    Add-Check "feature-liveness" "WARN" (Get-AuditFailureDetail $livenessResult.Text "apply database/2026-05-10-feature-liveness-helper.sql")
  }
} else {
  Add-Check "rls-coverage" "WARN" "skipped (SUPABASE_URL/SERVICE_KEY missing)"
  Add-Check "feature-liveness" "WARN" "skipped (SUPABASE_URL/SERVICE_KEY missing)"
}

$failures = @($results | Where-Object { $_.Status -eq "FAIL" })
$warnings = @($results | Where-Object { $_.Status -eq "WARN" })
$okCount = @($results | Where-Object { $_.Status -eq 'OK' }).Count

if ($Json.IsPresent) {
  [PSCustomObject]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    summary = [PSCustomObject]@{
      fail = $failures.Count
      warn = $warnings.Count
      ok = $okCount
    }
    checks = $results
  } | ConvertTo-Json -Depth 5
} else {
  Write-Host ""
  Write-Host "CyclingZone agent doctor"
  Write-Host "========================"
  $results | Format-Table -AutoSize

  Write-Host ""
  Write-Host "Summary: $($failures.Count) fail, $($warnings.Count) warn, $okCount ok"
}
if ($FailOnWarning.IsPresent -and ($failures.Count -gt 0 -or $warnings.Count -gt 0)) {
  exit 1
}

if ($failures.Count -gt 0) {
  exit 1
}

Get-Date | Out-Null
exit 0
