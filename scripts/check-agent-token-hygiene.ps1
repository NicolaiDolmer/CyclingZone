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
  # NOW.md governes kanonisk på LINJER (now-md-budget: warn 30 / fail 40, jf. CLAUDE.md close-out).
  # Token-tærsklerne her er kun en sanity-ceiling mod ekstrem tæthed: en linje-compliant
  # NOW.md med tætte tabel-rækker rammer ~1900-2400 tok ved 30-40 linjer, så Warn=900/Fail=1500
  # fejlede en fil der overholdt linje-budgettet (cry-wolf, sundhedsaudit 2026-06-02). Hævet så
  # kun reel density-bloat ud over linje-checken flagges.
  @{ Name = "NOW.md"; Path = "docs/NOW.md"; Warn = 2000; Fail = 3000 },
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
  # Tærskler hævet 2026-06-25 (governance-audit): de gamle 1500/2000 var sat da MEMORY.md var
  # ~1.400 tok. Efter at have demoteret alt graduaret/smalt til WARM koster de tilbageværende
  # ~38 hårdt-tjente guards legitimt ~2.700 tok. Auto-loaded adfærds-memory er den billigste
  # token (ændrer adfærd hver session) — gaten skal fange ægte drift (vi var på 3.600), ikke
  # tvinge sletning af guards der bider. Hold i sync med scripts/hooks/check-memory-budget.sh.
  $memoryStatus = if ($memoryTokens -gt 3200) { "FAIL" } elseif ($memoryTokens -gt 2800) { "WARN" } else { "OK" }
  Add-Result $results "claude-memory" $memoryStatus "$memoryTokens approx tokens in MEMORY.md (HOT auto-load; target <=2800, fail >3200)"
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
    # Den AKTIVE sessions transcript vokser ubundet og kan ikke reduceres midt i en
    # session — størrelsen siger intet om hvad der pushes og er ikke handlingsbar her.
    # Et FAIL ramte derfor enhver lang session uanset kvalitet (cry-wolf, audit 2026-06-02).
    # → Aldrig FAIL. Kun en blød WARN ved meget stor fil (nudge til /compact eller frisk session).
    $status = if ($latestTranscript.Length -gt ($MaxTranscriptBytes * 3)) { "WARN" } else { "INFO" }
    $kb = [math]::Round($latestTranscript.Length / 1024, 1)
    $note = if ($status -eq "WARN") { " — overvej /compact eller frisk session" } else { "" }
    Add-Result $results "latest-transcript" $status "$kb KB, $($latestTranscript.Name)$note"
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
  # Linje-tærskler hævet 2026-06-25 (governance-audit) — se claude-memory-kommentar ovenfor.
  $memoryLineStatus = if ($memoryLines -gt 54) { "FAIL" } elseif ($memoryLines -gt 48) { "WARN" } else { "OK" }
  Add-Result $results "memory-hot-budget" $memoryLineStatus "MEMORY.md $memoryLines lines (target <48, fail >54)"
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
    # Staleness-check: snapshot >30 dage gammel → WARN om re-maaling (#2684)
    if ($snap.captured) {
      try {
        $capturedDate = [datetimeoffset]::Parse($snap.captured)
        $daysOld = ([datetimeoffset]::UtcNow - $capturedDate).Days
        if ($daysOld -gt 30) {
          Add-Result $results "harness-snapshot-staleness" "WARN" "$snapshotPath er $daysOld dage gammel (captured: $($snap.captured)) — re-maal harness jf. docs/metrics/HARNESS_MEASUREMENT.md (efter disable-boelge)"
        }
      } catch {
        # Ignorér dato-parse-fejl lydløst — snapshot er stadig brugbart til tokens
      }
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
# Cold-start-aggregatet = controllable (docs+memory) + harness-blob. De HANDLINGSBARE
# dele er allerede gated andetsteds: docs via claude/codex-context-files, memory via
# claude-memory + memory-hot-budget. Harness-blobben ($harnessValue tok) er infrastruktur
# (system-prompt + MCP/tool-schemas + skills) og kan IKKE reduceres ved at redigere docs —
# kun ved at disconnecte connectors/plugins (docs/AI_OPS_DISABLE_PLAYBOOK.md). På denne PC
# er harness alene ~15k tok, så et FAIL-gate på aggregatet (tærskel 12k/16k) var strukturelt
# umuligt at tilfredsstille via doc-trimning = cry-wolf (sundhedsaudit 2026-06-02).
# → Rapportér aggregatet som INFO til baseline-tracking; gating sker på de handlingsbare del-checks.
$claudeControllable = $claudeFileTotal + $memoryTokens
$codexControllable = $codexFileTotal + $memoryTokens
Add-Result $results "claude-cold-start-est" "INFO" "$claudeColdStart approx tokens (controllable $claudeControllable docs+memory, gated separat; harness $harnessValue infra, ej doc-reducerbar)"
Add-Result $results "codex-cold-start-est" "INFO" "$codexColdStart approx tokens (controllable $codexControllable docs+memory, gated separat; harness $harnessValue infra, ej doc-reducerbar)"

# Legacy alias - matcher codex (worst case) for backward compat med eksisterende baselines.
$coldStartTotal = $codexColdStart
Add-Result $results "cold-start-total-est" "INFO" "$coldStartTotal approx tokens (legacy alias = codex cold-start)"

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
