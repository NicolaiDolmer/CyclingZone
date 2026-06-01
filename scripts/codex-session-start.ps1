param(
  [switch]$Json,
  [switch]$FailOnWarning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param(
    [string]$Check,
    [ValidateSet("OK","WARN","FAIL")] [string]$Status,
    [string]$Detail
  )
  $results.Add([PSCustomObject]@{
    check = $Check
    status = $Status
    detail = $Detail
  })
}

function Run-Cmd {
  param(
    [Parameter(Mandatory)] [string]$File,
    [string[]]$Args = @()
  )
  try {
    $output = & $File @Args 2>&1
    return [PSCustomObject]@{
      ok = ($LASTEXITCODE -eq 0)
      text = (($output | ForEach-Object { "$_" }) -join "`n")
      code = $LASTEXITCODE
    }
  } catch {
    return [PSCustomObject]@{
      ok = $false
      text = $_.Exception.Message
      code = 1
    }
  }
}

function First-Line {
  param([string]$Text)
  $line = @($Text -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
  if ($line.Count -eq 0) { return "" }
  return [string]$line[0]
}

function Has-SecretLikeToken {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $false }
  $content = Get-Content -Raw -Path $Path -ErrorAction SilentlyContinue
  if (-not $content) { return $false }

  $patterns = @(
    '[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    '(?i)(service[_-]?role|api[_-]?key|auth[_-]?token|discord[_-]?token)"?\s*[:=]\s*"[^"$%{][^"]{12,}"'
  )

  foreach ($pattern in $patterns) {
    if ($content -match $pattern) { return $true }
  }
  return $false
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
Set-Location $repoRoot

$gitRoot = Run-Cmd "git" @("rev-parse", "--show-toplevel")
if ($gitRoot.ok) {
  $normalized = (($gitRoot.text.Trim()) -replace "\\", "/")
  $expected = (((Resolve-Path $repoRoot).Path.TrimEnd("\", "/")) -replace "\\", "/")
  Add-Result "repo-root" ($(if ($normalized -eq $expected) { "OK" } else { "FAIL" })) $normalized
} else {
  Add-Result "repo-root" "FAIL" (First-Line $gitRoot.text)
}

$fetch = Run-Cmd "git" @("fetch", "--prune", "origin")
Add-Result "git-fetch" ($(if ($fetch.ok) { "OK" } else { "WARN" })) ($(if ($fetch.ok) { "origin fetched" } else { First-Line $fetch.text }))

$status = Run-Cmd "git" @("status", "-sb")
if ($status.ok) {
  Add-Result "git-status" "OK" (($status.text -replace "`n", " | "))
} else {
  Add-Result "git-status" "FAIL" (First-Line $status.text)
}

$trackedSecrets = Run-Cmd "git" @("ls-files", ".mcp.json", "*.env", ".codex.local/*")
if ($trackedSecrets.ok -and [string]::IsNullOrWhiteSpace($trackedSecrets.text)) {
  Add-Result "tracked-secrets" "OK" "none"
} else {
  Add-Result "tracked-secrets" "FAIL" (($trackedSecrets.text -replace "`n", ", "))
}

$mcpPath = Join-Path $repoRoot ".mcp.json"
if (Test-Path $mcpPath) {
  if (Has-SecretLikeToken -Path $mcpPath) {
    Add-Result "mcp-local-secret" "FAIL" ".mcp.json contains secret-like material; rotate token and use environment/Infisical"
  } else {
    Add-Result "mcp-local-secret" "OK" ".mcp.json exists without obvious inline secret"
  }
} else {
  Add-Result "mcp-local-secret" "OK" ".mcp.json not present"
}

$untracked = Run-Cmd "git" @("ls-files", "--others", "--exclude-standard")
if ($untracked.ok) {
  $localArtifacts = @($untracked.text -split "`n" | Where-Object {
    $_ -match '^issues(_list|_summary)?\.txt$' -or
    $_ -match '^(issues|open_issues)\.json$' -or
    $_ -match '^\.agents/'
  })
  if ($localArtifacts.Count -eq 0) {
    Add-Result "local-artifacts" "OK" "no known Codex cache artifacts"
  } else {
    Add-Result "local-artifacts" "WARN" ("regenerable local artifacts: " + (($localArtifacts | Select-Object -First 8) -join ", "))
  }
} else {
  Add-Result "local-artifacts" "WARN" (First-Line $untracked.text)
}

$auditScript = Join-Path $repoRoot "scripts/cross-pc-forensic-audit.ps1"
$audit = Run-Cmd "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $auditScript)
Add-Result "cross-pc-audit" ($(if ($audit.ok) { "OK" } else { "FAIL" })) ($(if ($audit.ok) { "clean or warnings only" } else { First-Line $audit.text }))

$doctorScript = Join-Path $repoRoot "scripts/agent-doctor.ps1"
$doctor = Run-Cmd "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $doctorScript, "-Json")
try {
  $jsonStart = $doctor.text.IndexOf("{")
  if ($jsonStart -lt 0) { throw "no JSON object in output" }
  $doctorJson = $doctor.text.Substring($jsonStart) | ConvertFrom-Json
  $doctorStatus = if ($doctorJson.summary.fail -eq 0 -and $doctor.ok) { "OK" } else { "WARN" }
  Add-Result "agent-doctor" $doctorStatus ("$($doctorJson.summary.fail) fail, $($doctorJson.summary.warn) warn, $($doctorJson.summary.ok) ok")
} catch {
  Add-Result "agent-doctor" "WARN" ($(if ($doctor.ok) { "doctor ran but JSON parsing failed" } else { First-Line $doctor.text }))
}

$issues = Run-Cmd "gh" @("issue", "list", "--label", "claude:todo", "--state", "open", "--limit", "10")
Add-Result "issue-queue" ($(if ($issues.ok) { "OK" } else { "WARN" })) ($(if ($issues.ok) { (($issues.text -split "`n" | Select-Object -First 1) -join "") } else { First-Line $issues.text }))

$fails = @($results | Where-Object { $_.status -eq "FAIL" })
$warns = @($results | Where-Object { $_.status -eq "WARN" })

if ($Json) {
  [PSCustomObject]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    summary = [PSCustomObject]@{
      fail = $fails.Count
      warn = $warns.Count
      ok = @($results | Where-Object { $_.status -eq "OK" }).Count
    }
    checks = $results
  } | ConvertTo-Json -Depth 5
} else {
  Write-Host ""
  Write-Host "CyclingZone Codex session start"
  Write-Host "================================"
  $results | Format-Table -AutoSize
  Write-Host ""
  Write-Host "Summary: $($fails.Count) fail, $($warns.Count) warn"
}

if ($fails.Count -gt 0) { exit 1 }
if ($FailOnWarning -and $warns.Count -gt 0) { exit 1 }
exit 0
