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
    # Splat via @args, not bare array — PowerShell's `& cmd $array` folds the
    # array into a single string for strict CLI parsers (Rust/Clap, e.g. railway).
    # gh/git tolerate this accidentally, but railway/vercel reject it.
    $exe = $Command[0]
    $callArgs = @($Command[1..($Command.Length - 1)])
    $output = & $exe @callArgs 2>&1
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
    return "auth-failure: update SUPABASE_SERVICE_KEY in Infisical (env=dev or prod) to a valid sb_secret_* — backend/.env fallback only if not using infisical run (#337)"
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

# --- Sentry prod-state probe helpers (#620) ---
# Probe Vercel/Railway for live env-var keys. Capture ONLY names, never values —
# secrets must not be persisted to cache or log. Cache 5 min in $env:TEMP to keep
# doctor-runs fast (CLI calls = ~500ms-2s each). DOCTOR_NO_CACHE=1 bypasser cache.

function Get-SentryProbeCachePath {
  param([string]$Provider)
  $cacheDir = Join-Path ([System.IO.Path]::GetTempPath()) "cyclingzone-doctor-cache"
  if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  }
  return Join-Path $cacheDir "sentry-probe-$Provider.json"
}

function Read-SentryProbeCache {
  param([string]$Provider, [int]$MaxAgeSeconds = 300)
  if ($env:DOCTOR_NO_CACHE -eq "1") { return $null }
  $path = Get-SentryProbeCachePath -Provider $Provider
  if (-not (Test-Path $path)) { return $null }
  try {
    $cached = Get-Content $path -Raw | ConvertFrom-Json
    $age = (Get-Date) - [datetime]::Parse($cached.cached_at)
    if ($age.TotalSeconds -gt $MaxAgeSeconds) { return $null }
    return $cached.state
  } catch {
    return $null
  }
}

function Write-SentryProbeCache {
  param([string]$Provider, [object]$State)
  try {
    $payload = [PSCustomObject]@{
      cached_at = (Get-Date).ToString("o")
      state = $State
    }
    $path = Get-SentryProbeCachePath -Provider $Provider
    $payload | ConvertTo-Json -Depth 5 | Set-Content -Path $path -Encoding UTF8
  } catch {
    # Cache write failures are non-fatal — next call just re-probes.
  }
}

function New-SentryProbeUnavailable {
  param([string]$Reason)
  return [PSCustomObject]@{
    Available = $false
    Reason = $Reason
    HasFrontendDsn = $false
    HasAuthToken = $false
    HasBackendDsn = $false
    KeyCount = 0
  }
}

function Get-VercelSentryProdState {
  $cached = Read-SentryProbeCache -Provider "vercel"
  if ($null -ne $cached) { return $cached }

  $vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue
  if (-not $vercelCmd) {
    return (New-SentryProbeUnavailable -Reason "vercel CLI not installed")
  }

  $result = Try-Run @("vercel", "env", "ls", "production", "--format", "json")
  if (-not $result.Ok -and ($result.Text -notmatch "(?m)^\s*[\{\[]")) {
    $first = (($result.Text -split "`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
    return (New-SentryProbeUnavailable -Reason "vercel env ls failed: $first")
  }

  # Vercel CLI may print progress text before JSON, and versions differ between
  # returning an array and wrapping it as { envs: [...] }. Strip non-JSON lines
  # and handle both shapes; only key names are retained below.
  $lines = @($result.Text -split "`n")
  $jsonStartLine = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -match "^[\{\[]") {
      $jsonStartLine = $i
      break
    }
  }
  if ($jsonStartLine -lt 0) {
    return (New-SentryProbeUnavailable -Reason "vercel output had no JSON body")
  }
  $jsonText = @($lines[$jsonStartLine..($lines.Count - 1)]) -join "`n"
  try {
    $parsed = $jsonText | ConvertFrom-Json
  } catch {
    return (New-SentryProbeUnavailable -Reason "vercel JSON parse failed")
  }

  $envEntries = if ($parsed -is [array]) {
    @($parsed)
  } elseif ($parsed.PSObject.Properties.Name -contains "envs") {
    @($parsed.envs)
  } else {
    return (New-SentryProbeUnavailable -Reason "vercel JSON unexpected shape (no array/.envs)")
  }

  # vercel env ls --format json returns [{key, type, target, ...}, ...] or
  # {envs: [{key, type, target, ...}, ...]} depending on CLI version.
  # We extract ONLY .key (name); values are encrypted server-side and never in this output.
  $prodKeys = @($envEntries | Where-Object { $_.target -contains "production" } | ForEach-Object { $_.key })
  $state = [PSCustomObject]@{
    Available = $true
    Reason = $null
    HasFrontendDsn = ($prodKeys -contains "VITE_SENTRY_DSN")
    HasAuthToken = ($prodKeys -contains "SENTRY_AUTH_TOKEN")
    HasBackendDsn = $false  # Vercel only hosts frontend here
    KeyCount = $prodKeys.Count
  }
  Write-SentryProbeCache -Provider "vercel" -State $state
  return $state
}

function Get-RailwaySentryProdState {
  $cached = Read-SentryProbeCache -Provider "railway"
  if ($null -ne $cached) { return $cached }

  $railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
  if (-not $railwayCmd) {
    return (New-SentryProbeUnavailable -Reason "railway CLI not installed")
  }

  $result = Try-Run @("railway", "variables", "--service", "CyclingZone", "--json")
  if (-not $result.Ok) {
    $first = (($result.Text -split "`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
    return (New-SentryProbeUnavailable -Reason "railway variables failed: $first")
  }

  try {
    $vars = $result.Text | ConvertFrom-Json
  } catch {
    return (New-SentryProbeUnavailable -Reason "railway JSON parse failed")
  }

  # railway variables --json returns {KEY: "value", ...}. We extract ONLY .Name
  # from PSObject.Properties; .Value is discarded immediately and never stored.
  $keys = @($vars.PSObject.Properties | ForEach-Object { $_.Name })
  $state = [PSCustomObject]@{
    Available = $true
    Reason = $null
    HasFrontendDsn = $false  # Railway only hosts backend here
    HasAuthToken = $false
    HasBackendDsn = ($keys -contains "SENTRY_DSN")
    KeyCount = $keys.Count
  }
  Write-SentryProbeCache -Provider "railway" -State $state
  return $state
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

$frontendEnvKeys = Try-Run @("node", "scripts/check-frontend-env-keys.mjs")
Add-Check "frontend-env-keys" ($(if ($frontendEnvKeys.Ok) { "OK" } else { "FAIL" })) (($frontendEnvKeys.Text -split "`n" | Where-Object { $_.Trim() }) -join " | ")

# install-parity — fanger drift mellem package-lock.json og faktisk installed node_modules.
# Bidt af #616 (express-rate-limit 7.5.1 vs lock 8.5.2 efter PR #579) og #618 (PC2's frontend var
# 1-3 patches bagud lockfile mens `npm install` rapporterede "up to date"). Tjekker kun direct
# deps fra package.json — transitive deps håndteres af lockfile-integriteten selv.
$installParityDrifts = New-Object System.Collections.Generic.List[object]
foreach ($ws in @(".", "backend", "frontend")) {
  $pkgPath = if ($ws -eq ".") { "package.json" } else { "$ws/package.json" }
  $lockPath = if ($ws -eq ".") { "package-lock.json" } else { "$ws/package-lock.json" }
  $modulesDir = if ($ws -eq ".") { "node_modules" } else { "$ws/node_modules" }
  if (-not (Test-Path $pkgPath) -or -not (Test-Path $lockPath)) { continue }
  try {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json -AsHashtable
    $lock = Get-Content $lockPath -Raw | ConvertFrom-Json -AsHashtable
  } catch {
    $installParityDrifts.Add([PSCustomObject]@{ Workspace = $ws; Dep = "(parse-error)"; Lock = "?"; Installed = $_.Exception.Message })
    continue
  }
  $directDeps = New-Object System.Collections.Generic.HashSet[string]
  foreach ($section in @("dependencies", "devDependencies")) {
    if ($pkg.ContainsKey($section) -and $pkg[$section]) {
      foreach ($key in $pkg[$section].Keys) { [void]$directDeps.Add($key) }
    }
  }
  if (-not $lock.ContainsKey("packages")) { continue }
  $lockPackages = $lock["packages"]
  foreach ($depName in $directDeps) {
    $lockKey = "node_modules/$depName"
    if (-not $lockPackages.ContainsKey($lockKey)) { continue }
    $lockEntry = $lockPackages[$lockKey]
    # Skip platform-mismatched optional deps (linux/darwin binaries on win32 etc.)
    if ($lockEntry.ContainsKey("optional") -and $lockEntry["optional"]) {
      $platformMismatch = $false
      if ($lockEntry.ContainsKey("os") -and $lockEntry["os"]) {
        $osList = @($lockEntry["os"]) | ForEach-Object { ([string]$_).ToLower() }
        $hasWin = $osList -contains "win32"
        $hasNotWin = $osList -contains "!win32"
        if ((-not $hasWin -and -not $hasNotWin) -or $hasNotWin) { $platformMismatch = $true }
      }
      if (-not $platformMismatch -and $lockEntry.ContainsKey("cpu") -and $lockEntry["cpu"]) {
        $cpuList = @($lockEntry["cpu"]) | ForEach-Object { ([string]$_).ToLower() }
        $hasX64 = $cpuList -contains "x64"
        $hasNotX64 = $cpuList -contains "!x64"
        if ((-not $hasX64 -and -not $hasNotX64) -or $hasNotX64) { $platformMismatch = $true }
      }
      if ($platformMismatch) { continue }
    }
    $lockVersion = $lockEntry["version"]
    $installedPkg = Join-Path $modulesDir "$depName/package.json"
    if (-not (Test-Path $installedPkg)) {
      $installParityDrifts.Add([PSCustomObject]@{ Workspace = $ws; Dep = $depName; Lock = $lockVersion; Installed = "MISSING" })
      continue
    }
    try {
      $installedVersion = (Get-Content $installedPkg -Raw | ConvertFrom-Json -AsHashtable)["version"]
    } catch {
      $installParityDrifts.Add([PSCustomObject]@{ Workspace = $ws; Dep = $depName; Lock = $lockVersion; Installed = "(parse-error)" })
      continue
    }
    if ($installedVersion -ne $lockVersion) {
      $installParityDrifts.Add([PSCustomObject]@{ Workspace = $ws; Dep = $depName; Lock = $lockVersion; Installed = $installedVersion })
    }
  }
}
$installParityDetail = if ($installParityDrifts.Count -eq 0) {
  "all direct deps match lockfile across root/backend/frontend"
} else {
  $sample = ($installParityDrifts | Select-Object -First 3 | ForEach-Object { "$($_.Workspace)/$($_.Dep): lock=$($_.Lock) inst=$($_.Installed)" }) -join "; "
  "$($installParityDrifts.Count) drift(s) — run 'npm run sync-deps'. Sample: $sample"
}
Add-Check "install-parity" ($(if ($installParityDrifts.Count -eq 0) { "OK" } else { "WARN" })) $installParityDetail

$repoInfo = Gh-Json "repos/$Repo"
if ($repoInfo) {
  if ($repoInfo.PSObject.Properties.Name -contains "security_and_analysis" -and $repoInfo.security_and_analysis) {
    $security = $repoInfo.security_and_analysis
    $secret = $security.secret_scanning.status
    $push = $security.secret_scanning_push_protection.status
    $validity = $security.secret_scanning_validity_checks.status
    $dependabot = $security.dependabot_security_updates.status
    $securityStatus = if ($secret -eq "enabled" -and $push -eq "enabled" -and $dependabot -eq "enabled") { "OK" } else { "WARN" }
    Add-Check "github-security" $securityStatus "secret=$secret, push=$push, validity=$validity, dependabot=$dependabot"
  } else {
    Add-Check "github-security" "WARN" "security_and_analysis unavailable to this token"
  }
  if ($repoInfo.PSObject.Properties.Name -contains "allow_auto_merge") {
    $deleteBranchOnMerge = if ($repoInfo.PSObject.Properties.Name -contains "delete_branch_on_merge") { $repoInfo.delete_branch_on_merge } else { "unavailable" }
    Add-Check "auto-merge-setting" ($(if ($repoInfo.allow_auto_merge -eq $true) { "OK" } else { "WARN" })) "allow_auto_merge=$($repoInfo.allow_auto_merge), delete_branch_on_merge=$deleteBranchOnMerge"
  } else {
    Add-Check "auto-merge-setting" "WARN" "allow_auto_merge unavailable to this token"
  }
} else {
  Add-Check "github-security" "WARN" "gh api unavailable"
}

$branch = Gh-Json "repos/$Repo/branches/main"
$protection = Gh-Json "repos/$Repo/branches/main/protection"
if ($branch -and $protection) {
  $checks = @($protection.required_status_checks.checks | ForEach-Object { $_.context })
  $strict = $protection.required_status_checks.strict
  $hasCoreChecks = ($checks -contains "backend-tests") -and ($checks -contains "frontend-build") -and ($checks -contains "dependency-review")
  # FAIL kun ved reel breakage: ubeskyttet main eller manglende core-status-checks.
  # strict=False ("require up-to-date before merge") er BEVIDST — strict=True serialiserer
  # merges og bremser auto-merge-throughput (allow_auto_merge=True). Tidligere FAIL på
  # strict=False var cry-wolf (sundhedsaudit 2026-06-02); strict vises kun i detail nu.
  Add-Check "main-protection" ($(if ($branch.protected -and $hasCoreChecks) { "OK" } else { "FAIL" })) "protected=$($branch.protected), strict=$strict, checks=$($checks -join ',')"
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
    $hasPriority = [bool]($labels | Where-Object { $_ -like "priority:*" })
    $hasType = [bool]($labels | Where-Object { $_ -like "type:*" })
    $hasClaude = [bool]($labels | Where-Object { $_ -like "claude:*" })
    $hasOtherAgent = [bool]($labels | Where-Object { $_ -in @("agent:codex", "agent:manus") })
    $hasDocsOnly = $labels -contains "docs-only"
    $hasEpic = [bool]($labels | Where-Object { $_ -like "epic:*" }) -or ($issue.title -match "^\s*\[Epic\]")
    $isInvestigation = $labels -contains "type:investigation"

    $requiresPriority = -not ($hasEpic -or $isInvestigation)
    $requiresClaude = -not ($hasOtherAgent -or $hasDocsOnly)

    if (($requiresPriority -and -not $hasPriority) -or
        -not $hasType -or
        ($requiresClaude -and -not $hasClaude)) {
      $missing += "#$($issue.number)"
    }
  }
  Add-Check "issue-label-schema" ($(if ($missing.Count -eq 0) { "OK" } else { "WARN" })) ($(if ($missing.Count) { "missing after exemptions: $($missing -join ', ')" } else { "all open issues satisfy priority/type/claude schema after exemptions" }))
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
$infisicalWinget = $null
if ($env:LOCALAPPDATA) {
  $wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  $infisicalWinget = Get-ChildItem -Path $wingetPackages -Recurse -Filter "infisical.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if ($infisicalCmd) {
  Add-Check "infisical-cli" "OK" $infisicalCmd.Source
} elseif ($infisicalWinget) {
  Add-Check "infisical-cli" "OK" "$($infisicalWinget.FullName) (restart shell to refresh PATH)"
} else {
  Add-Check "infisical-cli" "WARN" "not found — install: winget install Infisical.infisical (see docs/CROSS_PC_SETUP.md)"
}

# Sentry config — probes live prod-state (Vercel + Railway) for env-var presence,
# falls back to local env scan if CLIs unavailable. Source of truth = prod, since
# #348 close-out showed local-only check produces both false-WARN (prod live, local
# empty) AND false-OK (local set, prod missing — original cause of #348). See #620.
$sentryHasBackendPkg = (Test-Path "backend/package.json") -and ((Get-Content -Raw "backend/package.json") -match "@sentry/node")
$sentryHasFrontendPkg = (Test-Path "frontend/package.json") -and ((Get-Content -Raw "frontend/package.json") -match "@sentry/react")

$localHasBackendDsn = [bool]$env:SENTRY_DSN
$localHasFrontendDsn = [bool]$env:VITE_SENTRY_DSN
foreach ($envFile in @("backend/.env")) {
  if (Test-Path $envFile) {
    $content = Get-Content -Raw $envFile
    if ($content -match "(?m)^\s*SENTRY_DSN\s*=\s*\S") { $localHasBackendDsn = $true }
  }
}
foreach ($envFile in @("frontend/.env", "frontend/.env.local", "frontend/.env.production")) {
  if (Test-Path $envFile) {
    $content = Get-Content -Raw $envFile
    if ($content -match "(?m)^\s*VITE_SENTRY_DSN\s*=\s*\S") { $localHasFrontendDsn = $true }
  }
}

# Probe live prod env-var keys (NOT values — helpers only return presence flags).
# Test hook: DOCTOR_MOCK_SENTRY_PROBE='{"vercel":{...},"railway":{...}}' bypasser CLI.
if ($env:DOCTOR_MOCK_SENTRY_PROBE) {
  try {
    $mockState = $env:DOCTOR_MOCK_SENTRY_PROBE | ConvertFrom-Json
    $vercelState = $mockState.vercel
    $railwayState = $mockState.railway
  } catch {
    $vercelState = New-SentryProbeUnavailable -Reason "mock JSON parse failed"
    $railwayState = $vercelState
  }
} else {
  $vercelState = Get-VercelSentryProdState
  $railwayState = Get-RailwaySentryProdState
}

$prodFrontendOk = [bool]($vercelState.Available -and $vercelState.HasFrontendDsn)
$prodBackendOk = [bool]($railwayState.Available -and $railwayState.HasBackendDsn)
$anyProbeWorked = [bool]($vercelState.Available -or $railwayState.Available)
$bothProbesWorked = [bool]($vercelState.Available -and $railwayState.Available)

if ($bothProbesWorked -and $prodFrontendOk -and $prodBackendOk) {
  $localNote = if (-not ($localHasFrontendDsn -and $localHasBackendDsn)) { " (lokal .env mangler DSN, men prod runtime er live)" } else { "" }
  Add-Check "sentry-config" "OK" "prod wired: Vercel VITE_SENTRY_DSN + Railway SENTRY_DSN$localNote"
} elseif ($bothProbesWorked) {
  $missing = @()
  if (-not $prodFrontendOk) { $missing += "Vercel VITE_SENTRY_DSN" }
  if (-not $prodBackendOk) { $missing += "Railway SENTRY_DSN" }
  Add-Check "sentry-config" "WARN" "prod ikke wired: missing $($missing -join ', ') — kør scripts/setup-sentry-frontend.ps1 (#348)"
} elseif ($anyProbeWorked) {
  $haves = @(); $unverified = @()
  if ($vercelState.Available) {
    if ($prodFrontendOk) { $haves += "Vercel VITE_SENTRY_DSN" } else { $haves += "Vercel probe OK but VITE_SENTRY_DSN missing" }
  } else { $unverified += "Vercel ($($vercelState.Reason))" }
  if ($railwayState.Available) {
    if ($prodBackendOk) { $haves += "Railway SENTRY_DSN" } else { $haves += "Railway probe OK but SENTRY_DSN missing" }
  } else { $unverified += "Railway ($($railwayState.Reason))" }
  Add-Check "sentry-config" "WARN" "partial prod probe — verified: $($haves -join '; '); unverified: $($unverified -join '; ')"
} else {
  # No live probe available — fall back to local env + package signals.
  $sentrySignals = @()
  if ($sentryHasBackendPkg) { $sentrySignals += "backend-package" }
  if ($sentryHasFrontendPkg) { $sentrySignals += "frontend-package" }
  if ($localHasBackendDsn) { $sentrySignals += "backend-dsn-local" }
  if ($localHasFrontendDsn) { $sentrySignals += "frontend-dsn-local" }
  $fallbackNote = "fallback: vercel ($($vercelState.Reason)); railway ($($railwayState.Reason))"
  if ($sentryHasBackendPkg -and $sentryHasFrontendPkg -and $localHasBackendDsn -and $localHasFrontendDsn) {
    Add-Check "sentry-config" "WARN" "kun lokal verificeret ($($sentrySignals -join ', ')); $fallbackNote"
  } elseif ($sentrySignals.Count -gt 0) {
    Add-Check "sentry-config" "WARN" "lokal: $($sentrySignals -join ', '); $fallbackNote"
  } else {
    Add-Check "sentry-config" "WARN" "not configured; $fallbackNote"
  }
}

$tokenHygiene = Try-Run @("pwsh", "-NoProfile", "-File", "scripts/check-agent-token-hygiene.ps1")
if ($tokenHygiene.Ok) {
  Add-Check "token-hygiene" "OK" "startup context within configured limits"
} else {
  Add-Check "token-hygiene" "WARN" "run scripts/check-agent-token-hygiene.ps1"
}

# memory-refs — mekanisk forward-guard mod stale konsoliderings-baseline (#753).
# check-memory-refs.ps1 gemmer en baseline-snapshot (#N + (*.md)-pegepinde per
# memory-fil) FØR konsolidering og verificerer EFTER. Faldgrube: hvis snapshotten
# er ældre end den nyeste memory-fil, beskriver den et forældet state — et
# efterfølgende -Verify ville sammenligne mod en stale baseline og kunne både
# misse reelle tab OG flagge falske. Denne check fanger det:
#   - ingen snapshot          -> OK (intet under konsolidering, ikke relevant)
#   - snapshot >= memory-mtime -> OK (frisk baseline)
#   - snapshot <  memory-mtime -> WARN (stale: re-snapshot eller verificér nu)
# Default-stier matcher check-memory-refs.ps1 så de to scripts deler baseline.
$memoryDir = Join-Path $env:USERPROFILE ".claude\projects\C--Dev-CyclingZone\memory"
$memoryRoot = if (Get-Variable -Name root -Scope 0 -ErrorAction SilentlyContinue) { $root } else { (Get-Location).Path }
$memoryBaseline = Join-Path $memoryRoot "docs/metrics/memory-refs-snapshot.json"
if (-not (Test-Path $memoryDir)) {
  Add-Check "memory-refs" "OK" "memory-dir not present on this PC — check not applicable"
} elseif (-not (Test-Path $memoryBaseline)) {
  Add-Check "memory-refs" "OK" "no baseline snapshot — nothing mid-consolidation (run check-memory-refs.ps1 -Snapshot before consolidating)"
} else {
  try {
    $snap = Get-Content $memoryBaseline -Raw | ConvertFrom-Json
    # ConvertFrom-Json (PS7) auto-deserialiserer ISO-8601-strenge til [datetime].
    # Hvis ikke (ren streng) -> parse invariant/roundtrip, så vi ikke rammer
    # da-DK-locale (US-format "MM/dd/yyyy" fejler ellers på dansk culture).
    $snapTime = if ($snap.generated -is [datetime]) {
      $snap.generated
    } else {
      [datetime]::Parse([string]$snap.generated, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
    }
    $newest = Get-ChildItem -Path $memoryDir -Filter "*.md" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $newest) {
      Add-Check "memory-refs" "OK" "no *.md files in memory-dir"
    } elseif ($newest.LastWriteTime -gt $snapTime) {
      $newestLocal = $newest.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
      $snapLocal = $snapTime.ToString("yyyy-MM-dd HH:mm:ss")
      Add-Check "memory-refs" "WARN" "stale baseline: $($newest.Name) ($newestLocal) er nyere end snapshot ($snapLocal) — kør 'check-memory-refs.ps1 -Verify' nu (eller -Snapshot igen hvis konsolidering ikke er i gang)"
    } else {
      Add-Check "memory-refs" "OK" "baseline fresh (snapshot $($snapTime.ToString('yyyy-MM-dd HH:mm:ss')) >= newest memory-file)"
    }
  } catch {
    Add-Check "memory-refs" "WARN" "baseline unreadable: $($_.Exception.Message)"
  }
}

# RLS coverage audit — fanger slice 14 / #279 bug-mønstret lokalt før push.
# Post-Phase-5 (#327): foretrækker `infisical run --env=dev` for at hente secrets
# fra Infisical ved runtime, falder tilbage til backend/.env loading hvis CLI
# ikke er logget ind eller projektet ikke er linket.
$envPath = Join-Path $root "backend/.env"
$infisicalExe = if ($infisicalCmd) { $infisicalCmd.Source } elseif ($infisicalWinget) { $infisicalWinget.FullName } else { $null }
$auditPrefix = @()
if ($infisicalExe -and (Test-Path (Join-Path $root ".infisical.json"))) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $null = & $infisicalExe user get token 2>$null
    if ($LASTEXITCODE -eq 0) {
      $auditPrefix = @($infisicalExe, "run", "--env=dev", "--")
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}
if ($auditPrefix.Count -eq 0 -and (Test-Path $envPath) -and -not $env:SUPABASE_URL) {
  Get-Content $envPath | ForEach-Object {
    if ($_ -match "^\s*([^=#\s]+)\s*=\s*(.*)$") {
      $name = $Matches[1]; $value = $Matches[2].Trim()
      if ($name -in @("SUPABASE_URL", "SUPABASE_SERVICE_KEY") -and -not (Get-Item "env:$name" -ErrorAction SilentlyContinue)) {
        Set-Item "env:$name" $value
      }
    }
  }
}
function Extract-AuditJson {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  $idx = $Text.IndexOf('{')
  if ($idx -lt 0) { return $null }
  return $Text.Substring($idx)
}

if ($auditPrefix.Count -gt 0 -or ($env:SUPABASE_URL -and $env:SUPABASE_SERVICE_KEY)) {
  $rlsResult = Try-Run ($auditPrefix + @("node", "backend/scripts/audit-rls-coverage.js", "--json"))
  if ($rlsResult.Ok) {
    $rlsJson = Extract-AuditJson $rlsResult.Text
    try {
      $rlsData = $rlsJson | ConvertFrom-Json
      $crit = [int]$rlsData.critical_count
      $detail = if ($crit -eq 0) { "no frontend-blocked tables" } else { "critical: $(($rlsData.critical | ForEach-Object { $_.table }) -join ', ')" }
      Add-Check "rls-coverage" ($(if ($crit -eq 0) { "OK" } else { "FAIL" })) $detail
    } catch {
      Add-Check "rls-coverage" "WARN" "audit ran but JSON parse failed"
    }
  } else {
    Add-Check "rls-coverage" "WARN" (Get-AuditFailureDetail $rlsResult.Text "apply database/2026-05-10-audit-rls-helper.sql")
  }

  $livenessResult = Try-Run ($auditPrefix + @("node", "backend/scripts/audit-feature-liveness.js", "--json"))
  if ($livenessResult.Ok) {
    $livenessJson = Extract-AuditJson $livenessResult.Text
    try {
      $livenessData = $livenessJson | ConvertFrom-Json
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
  $skipHint = if ($infisicalExe) { "infisical login + ensure .infisical.json (or populate backend/.env)" } else { "install Infisical CLI (winget install Infisical.infisical) or populate backend/.env" }
  Add-Check "rls-coverage" "WARN" "skipped (no auth — $skipHint)"
  Add-Check "feature-liveness" "WARN" "skipped (no auth — $skipHint)"
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
