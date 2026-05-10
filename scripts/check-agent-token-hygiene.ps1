param(
  [int]$WarnTokens = 7500,
  [int]$FailTokens = 12000,
  [int]$MaxTranscriptBytes = 900000,
  [switch]$FailOnWarning
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

$contextFiles = @(
  @{ Name = "CLAUDE.md"; Path = "CLAUDE.md"; Warn = 1200; Fail = 2000 },
  @{ Name = "AGENTS.md"; Path = "AGENTS.md"; Warn = 4500; Fail = 6500 },
  @{ Name = "NOW.md"; Path = "docs/NOW.md"; Warn = 900; Fail = 1500 },
  @{ Name = "GUARDRAILS_CORE.md"; Path = "docs/GUARDRAILS_CORE.md"; Warn = 1300; Fail = 2200 },
  @{ Name = "SESSION_CONTEXT.md"; Path = ".codex.local/SESSION_CONTEXT.md"; Warn = 800; Fail = 1200 }
)

$total = 0
foreach ($item in $contextFiles) {
  if (-not (Test-Path $item.Path)) {
    Add-Result $results $item.Name "WARN" "missing"
    continue
  }
  $tokens = Get-ApproxTokens $item.Path
  $total += $tokens
  $lines = (Get-Content $item.Path | Measure-Object -Line).Lines
  $status = if ($tokens -gt $item.Fail) { "FAIL" } elseif ($tokens -gt $item.Warn) { "WARN" } else { "OK" }
  Add-Result $results $item.Name $status "$tokens approx tokens, $lines lines"
}

$totalStatus = if ($total -gt $FailTokens) { "FAIL" } elseif ($total -gt $WarnTokens) { "WARN" } else { "OK" }
Add-Result $results "cold-start-context" $totalStatus "$total approx tokens across standard startup files"

$memoryCandidates = @(
  (Join-Path $env:USERPROFILE ".claude\projects\C--dev-CyclingZone\memory\MEMORY.md"),
  (Join-Path $env:OneDrive "CyclingZone-context\memory\MEMORY.md")
) | Where-Object { $_ -and (Test-Path $_) }
if ($memoryCandidates.Count -gt 0) {
  $memoryPath = $memoryCandidates[0]
  $memoryTokens = Get-ApproxTokens $memoryPath
  $memoryStatus = if ($memoryTokens -gt 5000) { "FAIL" } elseif ($memoryTokens -gt 2500) { "WARN" } else { "OK" }
  Add-Result $results "claude-memory" $memoryStatus "$memoryTokens approx tokens in MEMORY.md"
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

Write-Host ""
Write-Host "Agent token hygiene"
Write-Host "==================="
$results | Format-Table -AutoSize

$failures = @($results | Where-Object { $_.Status -eq "FAIL" })
$warnings = @($results | Where-Object { $_.Status -eq "WARN" })
Write-Host ""
Write-Host "Summary: $($failures.Count) fail, $($warnings.Count) warn, $(@($results | Where-Object { $_.Status -eq 'OK' }).Count) ok"

if ($failures.Count -gt 0) { exit 1 }
if ($FailOnWarning.IsPresent -and $warnings.Count -gt 0) { exit 1 }
exit 0
