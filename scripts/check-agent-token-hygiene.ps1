param(
  [int]$WarnTokens = 7500,
  [int]$FailTokens = 12000,
  [int]$MaxTranscriptBytes = 900000,
  [int]$HarnessTokensEstimate = 5700,
  [switch]$FailOnWarning,
  [string]$BaselineOut = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ApproxTokens {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return 0 }
  $chars = (Get-Content $Path -Raw).Length
  return [math]::Ceiling($chars / 4)
}

function Add-Result {
  param(
    [System.Collections.Generic.List[object]]$Results,
    [string]$Name,
    [string]$Status,
    [string]$Detail
  )
  $Results.Add([PSCustomObject]@{
    Check = $Name
    Status = $Status
    Detail = $Detail
  })
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { throw "Not inside a git repo." }
$repoRoot = $repoRoot.Trim()
Set-Location $repoRoot

$results = New-Object System.Collections.Generic.List[object]

# CodexOnly = true betyder filen kun auto-loades af Codex CLI (AGENTS.md-konvention), ikke Claude Code.
# Begge regnes til Codex cold-start; kun !CodexOnly regnes til Claude cold-start.
# Ref: #382 maalings-fix. Codex auto-loader AGENTS.md (OpenAI Codex-konvention); Claude Code loader CLAUDE.md.
$contextFiles = @(
  @{ Name = "CLAUDE.md"; Path = "CLAUDE.md"; Warn = 1200; Fail = 2000 },
  @{ Name = "AGENTS.md"; Path = "AGENTS.md"; Warn = 4500; Fail = 6500; CodexOnly = $true },
  @{ Name = "NOW.md"; Path = "docs/NOW.md"; Warn = 900; Fail = 1500 },
  @{ Name = "GUARDRAILS_CORE.md"; Path = "docs/GUARDRAILS_CORE.md"; Warn = 1300; Fail = 2200 },
  @{ Name = "SESSION_CONTEXT.md"; Path = ".codex.local/SESSION_CONTEXT.md"; Warn = 800; Fail = 1200; OptionalCache = $true; CodexOnly = $true }
)

$claudeFileTotal = 0
$codexFileTotal = 0
foreach ($item in $contextFiles) {
  if (-not (Test-Path $item.Path)) {
    $optionalCache = $item.ContainsKey("OptionalCache") -and $item.OptionalCache
    $missingStatus = if ($optionalCache) { "OK" } else { "WARN" }
    $missingDetail = if ($optionalCache) { "missing optional cache" } else { "missing" }
    Add-Result $results $item.Name $missingStatus $missingDetail
    continue
  }
  $tokens = Get-ApproxTokens $item.Path
  $isCodexOnly = $item.ContainsKey("CodexOnly") -and $item.CodexOnly
  $codexFileTotal += $tokens
  if (-not $isCodexOnly) { $claudeFileTotal += $tokens }
  $lines = (Get-Content $item.Path | Measure-Object -Line).Lines
  $status = if ($tokens -gt $item.Fail) { "FAIL" } elseif ($tokens -gt $item.Warn) { "WARN" } else { "OK" }
  $scope = if ($isCodexOnly) { " [Codex-only]" } else { "" }
  Add-Result $results $item.Name $status "$tokens approx tokens, $lines lines$scope"
}

# Legacy alias for backward compat - matcher Codex cold-start (alle filer)
$total = $codexFileTotal
$claudeStatus = if ($claudeFileTotal -gt $FailTokens) { "FAIL" } elseif ($claudeFileTotal -gt $WarnTokens) { "WARN" } else { "OK" }
$codexStatus = if ($codexFileTotal -gt $FailTokens) { "FAIL" } elseif ($codexFileTotal -gt $WarnTokens) { "WARN" } else { "OK" }
Add-Result $results "claude-context-files" $claudeStatus "$claudeFileTotal approx tokens (Claude Code auto-load: CLAUDE.md + NOW.md + GUARDRAILS_CORE.md)"
Add-Result $results "codex-context-files" $codexStatus "$codexFileTotal approx tokens (Codex auto-load: ovenstaaende + AGENTS.md + SESSION_CONTEXT.md)"

$memoryCandidates = @(
  (Join-Path $env:USERPROFILE ".claude\projects\C--dev-CyclingZone\memory\MEMORY.md"),
  (Join-Path $env:OneDrive "CyclingZone-context\memory\MEMORY.md")
) | Where-Object { $_ -and (Test-Path $_) }
$memoryTokens = 0
if ($memoryCandidates.Count -gt 0) {
  $memoryPath = $memoryCandidates[0]
  $memoryTokens = Get-ApproxTokens $memoryPath
  $memoryStatus = if ($memoryTokens -gt 2000) { "FAIL" } elseif ($memoryTokens -gt 1500) { "WARN" } else { "OK" }
  Add-Result $results "claude-memory" $memoryStatus "$memoryTokens approx tokens in MEMORY.md (HOT auto-load)"
  $total += $memoryTokens
} else {
  Add-Result $results "claude-memory" "WARN" "MEMORY.md not found"
}

$projectDir = Join-Path $env:USERPROFILE ".claude\projects\C--dev-CyclingZone"
if (Test-Path $projectDir) {
  $latestTranscript = Get-ChildItem $projectDir -File -Filter "*.jsonl" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latestTranscript) {
    $status = if ($latestTranscript.Length -gt ($MaxTranscriptBytes * 1.5)) {
      "FAIL"
    } elseif ($latestTranscript.Length -gt $MaxTranscriptBytes) {
      "WARN"
    } else {
      "OK"
    }
    $kb = [math]::Round($latestTranscript.Length / 1024, 1)
    Add-Result $results "latest-transcript" $status "$kb KB, $($latestTranscript.Name)"
  } else {
    Add-Result $results "latest-transcript" "OK" "no transcripts found"
  }
} else {
  Add-Result $results "latest-transcript" "WARN" "Claude project dir not found"
}

$prefetchPath = "scripts/session-prefetch-issue.sh"
if (Test-Path $prefetchPath) {
  $prefetch = Get-Content $prefetchPath -Raw
  $bounded = ($prefetch -match "BODY_LIMIT") -and ($prefetch -match "COMMENT_LIMIT") -and ($prefetch -match "MAX_COMMENTS")
  Add-Result $results "issue-prefetch-bounds" ($(if ($bounded) { "OK" } else { "FAIL" })) ($(if ($bounded) { "bounded" } else { "missing bounds" }))
}

$memoryDirTokens = 0
if ($memoryCandidates.Count -gt 0) {
  $memoryDir = Split-Path $memoryCandidates[0] -Parent
  $memoryFiles = Get-ChildItem $memoryDir -Filter "*.md" -ErrorAction SilentlyContinue
  foreach ($f in $memoryFiles) {
    $memoryDirTokens += [math]::Ceiling($f.Length / 4)
  }
  Add-Result $results "memory-dir-total" "INFO" "$memoryDirTokens approx tokens across $($memoryFiles.Count) memory files (on-demand)"

  # Memory-dir growth check vs rolling baseline (#380)
  $memBaselinePath = "docs/metrics/memory-baseline.json"
  if (Test-Path $memBaselinePath) {
    try {
      $memBaseline = Get-Content $memBaselinePath -Raw | ConvertFrom-Json
      if ($memBaseline.previous -and $memBaseline.previous.approxTokens -gt 0) {
        $prevTokens = [int]$memBaseline.previous.approxTokens
        $delta = $memoryDirTokens - $prevTokens
        $pct = if ($prevTokens -gt 0) { [math]::Round(($delta / $prevTokens) * 100, 1) } else { 0 }
        $growthStatus = if ($pct -gt 10) { "WARN" } elseif ($pct -gt 5) { "INFO" } else { "OK" }
        Add-Result $results "memory-dir-growth" $growthStatus "+$delta tok ($pct% vs previous baseline $($memBaseline.previous.timestamp))"
      }
    } catch {
      Add-Result $results "memory-baseline-parse" "WARN" "Kunne ikke parse $memBaselinePath"
    }
  }

  $memoryPath = $memoryCandidates[0]
  $memoryLines = (Get-Content $memoryPath | Measure-Object -Line).Lines
  $memoryLineStatus = if ($memoryLines -gt 50) { "FAIL" } elseif ($memoryLines -gt 40) { "WARN" } else { "OK" }
  Add-Result $results "memory-hot-budget" $memoryLineStatus "MEMORY.md $memoryLines lines (target <40, fail >50)"
}

$hotFiles = @(
  @{ Name = "claude-md-budget"; Path = "CLAUDE.md"; WarnLines = 60; FailLines = 80 },
  @{ Name = "now-md-budget"; Path = "docs/NOW.md"; WarnLines = 30; FailLines = 40 }
)
foreach ($hot in $hotFiles) {
  if (Test-Path $hot.Path) {
    $hotLines = (Get-Content $hot.Path | Measure-Object -Line).Lines
    $hotStatus = if ($hotLines -gt $hot.FailLines) { "FAIL" } elseif ($hotLines -gt $hot.WarnLines) { "WARN" } else { "OK" }
    Add-Result $results $hot.Name $hotStatus "$($hot.Path) $hotLines lines (target <$($hot.WarnLines), fail >$($hot.FailLines))"
  }
}

$hostname = $env:COMPUTERNAME
$snapshotPath = "docs/metrics/harness-snapshot-$hostname.json"
$harnessSource = "estimate"
$harnessValue = $HarnessTokensEstimate
if (Test-Path $snapshotPath) {
  try {
    $snap = Get-Content $snapshotPath -Raw | ConvertFrom-Json
    if ($snap.total_harness_tokens -and ($snap.total_harness_tokens -gt 0)) {
      $harnessValue = [int]$snap.total_harness_tokens
      $harnessSource = "measured-snapshot ($snapshotPath)"
    }
  } catch {
    Add-Result $results "harness-snapshot-parse" "WARN" "Kunne ikke parse $snapshotPath, bruger default estimate $HarnessTokensEstimate"
  }
} else {
  Add-Result $results "harness-snapshot-missing" "WARN" "Ingen $snapshotPath for denne PC - fall-back til hardkodet estimate. Se docs/metrics/HARNESS_MEASUREMENT.md for hvordan du tager en maaling."
}

Add-Result $results "harness-blob-estimate" "INFO" "$harnessValue approx tokens (source: $harnessSource)"

# Cold-start split: Claude Code vs Codex CLI auto-loader forskellige filer (#382).
$claudeColdStart = $claudeFileTotal + $memoryTokens + $harnessValue
$codexColdStart = $codexFileTotal + $memoryTokens + $harnessValue
$claudeColdStatus = if ($claudeColdStart -gt 12000) { "FAIL" } elseif ($claudeColdStart -gt 8000) { "WARN" } else { "OK" }
$codexColdStatus = if ($codexColdStart -gt 16000) { "FAIL" } elseif ($codexColdStart -gt 12000) { "WARN" } else { "OK" }
Add-Result $results "claude-cold-start-est" $claudeColdStatus "$claudeColdStart approx tokens (Claude files + memory + harness)"
Add-Result $results "codex-cold-start-est" $codexColdStatus "$codexColdStart approx tokens (Codex files + memory + harness)"

# Legacy alias - matcher codex (worst case) for backward compat med eksisterende baselines.
$coldStartTotal = $codexColdStart
$coldStartStatus = $codexColdStatus
Add-Result $results "cold-start-total-est" $coldStartStatus "$coldStartTotal approx tokens (legacy alias = codex cold-start)"

Write-Host ""
Write-Host "Agent token hygiene"
Write-Host "==================="
$results | Format-Table -AutoSize

$failures = @($results | Where-Object { $_.Status -eq "FAIL" })
$warnings = @($results | Where-Object { $_.Status -eq "WARN" })
Write-Host ""
Write-Host "Summary: $($failures.Count) fail, $($warnings.Count) warn, $(@($results | Where-Object { $_.Status -eq 'OK' }).Count) ok"

if ($BaselineOut) {
  $baseline = [PSCustomObject]@{
    timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")
    host = $hostname
    cold_start_total_est = $coldStartTotal
    claude_cold_start_est = $claudeColdStart
    codex_cold_start_est = $codexColdStart
    file_context_total = $total
    claude_file_total = $claudeFileTotal
    codex_file_total = $codexFileTotal
    harness_blob_value = $harnessValue
    harness_blob_source = $harnessSource
    memory_dir_total = $memoryDirTokens
    checks = $results
  }
  $baselineDir = Split-Path $BaselineOut -Parent
  if ($baselineDir -and -not (Test-Path $baselineDir)) {
    New-Item -ItemType Directory -Path $baselineDir -Force | Out-Null
  }
  $baseline | ConvertTo-Json -Depth 6 | Out-File -FilePath $BaselineOut -Encoding UTF8
  Write-Host ""
  Write-Host "Baseline written: $BaselineOut"
}

if ($failures.Count -gt 0) { exit 1 }
if ($FailOnWarning.IsPresent -and $warnings.Count -gt 0) { exit 1 }
exit 0
