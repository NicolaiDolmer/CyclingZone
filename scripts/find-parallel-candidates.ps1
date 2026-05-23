
# find-parallel-candidates.ps1
# Auto-rank claude:todo issues for parallel-safety og foreslaa top bundles
# med NUL touch-area-overlap til en parallel-worktree-orchestration session.
#
# Brug: pwsh -File scripts/find-parallel-candidates.ps1
#
# Output: markdown-table med scored candidates + top-N anbefalede bundles.
#
# Se docs/PARALLEL_WORKTREE_ORCHESTRATION.md step 1.
# Issue: github.com/NicolaiDolmer/CyclingZone/issues/590

param(
  [int]$Limit = 20,
  [int]$BundleSize = 3,
  [int]$NumBundles = 3,
  [int]$MinScore = 0,
  [switch]$IncludeFiltered,
  [string]$Repo = "NicolaiDolmer/CyclingZone"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"



function Get-LabelNames {
  param($Issue)
  if ($null -eq $Issue.labels) { return @() }
  return @($Issue.labels | ForEach-Object { $_.name })
}

function Test-HasLabel {
  param([string[]]$Labels, [string]$Name)
  return ($Labels -contains $Name)
}

function Get-EffortHeuristic {
  param([string]$Body)
  if (-not $Body) { return "?" }
  $lines = $Body -split ([char]10)
  $captured = $false
  foreach ($l in $lines) {
    if ($captured) {
      $t = $l.Trim()
      if ($t.Length -eq 0) { continue }
      if ($t.StartsWith("XL")) { return "XL" }
      if ($t.StartsWith("L ") -or $t.StartsWith("L-")) { return "L" }
      if ($t.StartsWith("M ") -or $t.StartsWith("M-")) { return "M" }
      if ($t.StartsWith("S ") -or $t.StartsWith("S-")) { return "S" }
      break
    }
    if ($l -match "^##.*Effort") { $captured = $true }
  }
  if ($Body -match "[4-9]h") { return "L" }
  if ($Body -match "[12]h") { return "M" }
  return "?"
}



function Get-Score {
  # Hoejere score = bedre parallel-kandidat. Penalty for risk/security; bonus for docs/cleanup.
  param($Issue)
  $labels = Get-LabelNames $Issue
  $body = if ($Issue.body) { $Issue.body } else { "" }
  $score = 10
  if (Test-HasLabel $labels "cat:user-feature") { $score -= 100 }
  if (Test-HasLabel $labels "shared-refactor") { $score -= 100 }
  if (Test-HasLabel $labels "needs-contract") { $score -= 100 }
  if (Test-HasLabel $labels "risk:high") { $score -= 8 }
  if (Test-HasLabel $labels "risk:med") { $score -= 2 }
  if (Test-HasLabel $labels "security") { $score -= 3 }
  if (Test-HasLabel $labels "rls-audit") { $score -= 4 }
  if (Test-HasLabel $labels "needs-ai-triage") { $score -= 1 }
  if (Test-HasLabel $labels "docs-only") { $score += 5 }
  if (Test-HasLabel $labels "backend-only") { $score += 5 }
  if (Test-HasLabel $labels "cleanup") { $score += 4 }
  if (Test-HasLabel $labels "risk:low") { $score += 4 }
  if (Test-HasLabel $labels "type:docs") { $score += 3 }
  if (Test-HasLabel $labels "type:bug") { $score += 1 }
  if (Test-HasLabel $labels "type:investigation") { $score -= 1 }
  if (Test-HasLabel $labels "type:refactor") { $score -= 1 }
  if (Test-HasLabel $labels "priority:high") { $score += 1 }
  if (Test-HasLabel $labels "priority:low") { $score -= 1 }
  $effort = Get-EffortHeuristic $body
  switch ($effort) {
    "S"  { $score += 2 }
    "M"  { $score += 1 }
    "L"  { $score -= 3 }
    "XL" { $score -= 6 }
    "?"  { $score -= 2 }
  }
  return @{ Score = $score; Effort = $effort }
}



function Get-TouchAreas {
  # Heuristik: foreslaa hvilke top-level mapper issuen sandsynligvis roerer.
  # Konflikt-check pr. omraade-prefix - groft estimat, men fanger typiske parallel-konflikter.
  param($Issue)
  $labels = Get-LabelNames $Issue
  $body = if ($Issue.body) { $Issue.body } else { "" }
  $title = if ($Issue.title) { $Issue.title } else { "" }
  $combined = ($title + " " + $body).ToLower()
  $areas = New-Object System.Collections.Generic.HashSet[string]
  $patterns = @(
    @("frontend/src/pages/", "frontend/src/pages/"),
    @("frontend/src/components/", "frontend/src/components/"),
    @("frontend/src/", "frontend/src/"),
    @("frontend/", "frontend/"),
    @("backend/routes/", "backend/routes/"),
    @("backend/services/", "backend/services/"),
    @("backend/", "backend/"),
    @("supabase/migrations/", "supabase/migrations/"),
    @("supabase/", "supabase/"),
    @(".github/workflows/", ".github/workflows/"),
    @(".github/issue_template", ".github/ISSUE_TEMPLATE/"),
    @(".github/", ".github/"),
    @("scripts/", "scripts/"),
    @("tests/", "tests/"),
    @("docs/", "docs/")
  )
  foreach ($p in $patterns) {
    if ($combined.Contains($p[0])) { [void]$areas.Add($p[1]) }
  }
  if ($areas.Count -eq 0) {
    # Label-baserede gaet kun hvis vi ikke har explicit path
    if (Test-HasLabel $labels "docs-only") { [void]$areas.Add("docs/") }
    if (Test-HasLabel $labels "type:docs") { [void]$areas.Add("docs/") }
    if (Test-HasLabel $labels "cat:ai-ops") { [void]$areas.Add("scripts/") }
    if (Test-HasLabel $labels "cat:infra") { [void]$areas.Add("backend/") }
    if (Test-HasLabel $labels "cat:user-feature") { [void]$areas.Add("frontend/src/pages/") }
    if (Test-HasLabel $labels "rls-audit") { [void]$areas.Add("supabase/") }
    if (Test-HasLabel $labels "security") { [void]$areas.Add("backend/") }
  }
  if ($areas.Count -eq 0) { [void]$areas.Add("(unknown - verify manually)") }
  return @($areas) | Sort-Object
}



function Test-AreaOverlap {
  # Konflikt-check: hvis EN omraade er "(unknown ...)" anses det for usikkert (overlap = true)
  param([string[]]$A, [string[]]$B)
  if (($A -contains "(unknown - verify manually)") -or ($B -contains "(unknown - verify manually)")) { return $true }
  foreach ($a in $A) {
    foreach ($b in $B) {
      if ($a -eq $b) { return $true }
      if ($a.StartsWith($b) -or $b.StartsWith($a)) { return $true }
    }
  }
  return $false
}



function Get-BlockedReason {
  param($Issue)
  $labels = Get-LabelNames $Issue
  $reasons = @()
  if (Test-HasLabel $labels "cat:user-feature") { $reasons += "cat:user-feature (kraever Chrome MCP UI-verify)" }
  if (Test-HasLabel $labels "shared-refactor") { $reasons += "shared-refactor (kraever GUARDRAILS_CORE)" }
  if (Test-HasLabel $labels "needs-contract") { $reasons += "needs-contract (kraever GUARDRAILS_CORE)" }
  if (Test-HasLabel $labels "risk:high") { $reasons += "risk:high" }
  if ($reasons.Count -eq 0) { return $null }
  return (($reasons) -join "; ")
}



# ---------- hent data ----------

Write-Host "[info] Henter top $Limit aabne claude:todo issues fra $Repo ..." -ForegroundColor Cyan
$rawJson = & gh issue list --repo $Repo --label "claude:todo" --state open --limit $Limit --json number,title,labels,body,updatedAt 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "gh issue list fejlede: $rawJson"
  exit 1
}
$issues = $rawJson | ConvertFrom-Json
if (-not $issues -or $issues.Count -eq 0) {
  Write-Host "[info] Ingen aabne claude:todo issues fundet." -ForegroundColor Yellow
  exit 0
}
Write-Host "[info] $($issues.Count) issues hentet. Scorer ..." -ForegroundColor Cyan

# ---------- score + classify ----------

$scored = foreach ($i in $issues) {
  $s = Get-Score $i
  $areas = Get-TouchAreas $i
  $blocked = Get-BlockedReason $i
  [PSCustomObject]@{
    Number     = $i.number
    Title      = $i.title
    Labels     = (Get-LabelNames $i) -join ","
    Score      = [int]$s.Score
    Effort     = $s.Effort
    TouchAreas = $areas
    Blocked    = $blocked
    UpdatedAt  = $i.updatedAt
  }
}



$scored = $scored | Sort-Object Score -Descending
$eligible = @($scored | Where-Object { $null -eq $_.Blocked -and $_.Score -ge $MinScore })

# ---------- bundle-selection (greedy med top-N som anchor) ----------

function Build-Bundle {
  param([PSCustomObject[]]$Candidates, [int]$StartIdx, [int]$Size)
  if ($Candidates.Count -le $StartIdx) { return @() }
  $bundle = New-Object System.Collections.Generic.List[PSCustomObject]
  $usedAreas = New-Object System.Collections.Generic.List[string]
  $anchor = $Candidates[$StartIdx]
  $bundle.Add($anchor)
  foreach ($a in $anchor.TouchAreas) { $usedAreas.Add($a) }
  for ($i = 0; $i -lt $Candidates.Count -and $bundle.Count -lt $Size; $i++) {
    if ($i -eq $StartIdx) { continue }
    $cand = $Candidates[$i]
    $conflict = $false
    foreach ($a in $cand.TouchAreas) {
      foreach ($u in $usedAreas) {
        if (Test-AreaOverlap @($a) @($u)) { $conflict = $true; break }
      }
      if ($conflict) { break }
    }
    if (-not $conflict) {
      $bundle.Add($cand)
      foreach ($a in $cand.TouchAreas) { $usedAreas.Add($a) }
    }
  }
  return @($bundle)
}



$bundles = New-Object System.Collections.Generic.List[object]
for ($k = 0; $k -lt [Math]::Min($NumBundles, $eligible.Count); $k++) {
  $b = Build-Bundle -Candidates $eligible -StartIdx $k -Size $BundleSize
  if ($b.Count -gt 0) { $bundles.Add($b) }
}

function Get-BundleSignature {
  param($Bundle)
  return (($Bundle | ForEach-Object { $_.Number } | Sort-Object) -join ",")
}

$seen = @{}
$uniqueBundles = New-Object System.Collections.Generic.List[object]
foreach ($b in $bundles) {
  $sig = Get-BundleSignature $b
  if (-not $seen.ContainsKey($sig)) {
    $seen[$sig] = $true
    $uniqueBundles.Add($b)
  }
}



# ---------- output ----------

$now = Get-Date -Format "yyyy-MM-dd HH:mm"
Write-Output "# Parallel candidates - $now"
Write-Output ""
Write-Output "_Source: gh issue list --label claude:todo --state open --limit $Limit. Scoring: penalty for user-feature/shared-refactor/high-risk; bonus for docs-only/backend-only/low-risk. Genereret af scripts/find-parallel-candidates.ps1._"
Write-Output ""
Write-Output "## Scored candidates"
Write-Output ""
Write-Output "| # | Score | Effort | Touch-areas | Title | Status |"
Write-Output "|---:|---:|:---:|---|---|---|"


foreach ($s in $scored) {
  $status = if ($s.Blocked) { "BLOCKED: $($s.Blocked)" } else { "eligible" }
  $areas = (($s.TouchAreas) -join "; ")
  $title = $s.Title.Replace("|", "[bar]")
  if ($s.Blocked -and -not $IncludeFiltered.IsPresent -and $s.Score -lt -50) { continue }
  Write-Output "| #$($s.Number) | $($s.Score) | $($s.Effort) | $areas | $title | $status |"
}
Write-Output ""



if (-not $IncludeFiltered.IsPresent) {
  $skipped = @($scored | Where-Object { $_.Blocked -and $_.Score -lt -50 })
  if ($skipped.Count -gt 0) {
    Write-Output "_$($skipped.Count) hard-blocked issues skjult (cat:user-feature / shared-refactor / needs-contract / risk:high). Brug -IncludeFiltered for at se dem._"
    Write-Output ""
  }
}

Write-Output "## Top $($uniqueBundles.Count) bundles (greedy, NUL touch-area-overlap)"
Write-Output ""
if ($uniqueBundles.Count -eq 0) {
  Write-Output "_Ingen bundles kunne genereres med $BundleSize issues og $MinScore minimum score. Proev -BundleSize 2 eller -MinScore -5._"
} else {
  $idx = 1
  foreach ($b in $uniqueBundles) {
    $nums = (($b | ForEach-Object { "#$($_.Number)" }) -join " + ")
    $totalScore = (($b | Measure-Object -Property Score -Sum).Sum)
    Write-Output "### Bundle ${idx}: $nums (samlet score: $totalScore)"


    Write-Output ""
    Write-Output "| # | Score | Effort | Touch-areas | Title |"
    Write-Output "|---:|---:|:---:|---|---|"
    foreach ($c in $b) {
      $areas = (($c.TouchAreas) -join "; ")
      $title = $c.Title.Replace("|", "[bar]")
      Write-Output "| #$($c.Number) | $($c.Score) | $($c.Effort) | $areas | $title |"
    }
    Write-Output ""
    $idx++
  }
}

Write-Output "## Next steps"
Write-Output ""
Write-Output "1. Pick en bundle (eller hand-tune basen paa scored tabel)"
Write-Output "2. Verificer touch-areas - heuristikken er groft estimat; tjek issue-body for explicit filer"
Write-Output "3. Foelg docs/PARALLEL_WORKTREE_ORCHESTRATION.md step 2-7"
Write-Output ""
Write-Output "_For at se hard-blocked issues: pwsh -File scripts/find-parallel-candidates.ps1 -IncludeFiltered_"

