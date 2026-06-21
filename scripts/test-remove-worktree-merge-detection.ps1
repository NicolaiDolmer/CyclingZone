# test-remove-worktree-merge-detection.ps1
#
# Verificerer merge-detektionen i scripts/lib/git-merge-detection.ps1 (brugt af
# remove-worktree.ps1). Dækker den oprindelige bug: 'git branch --merged' ser
# ikke squash-merges, så squash-merged branches blev efterladt lokalt.
#
# Hermetisk: kræver KUN git (ikke gh / netværk). gh-stien (Test-BranchHasMergedPr)
# verificeres indirekte ved at injicere dens tre mulige svar ($true/$false/$null)
# i den rene beslutnings-funktion Get-BranchMergeDecision, og squash-sletningens
# nødvendige '-D' bevises mod ægte git ('git branch -d' nægter, '-D' lykkes).
#
# Brug:
#   pwsh -File scripts/test-remove-worktree-merge-detection.ps1
#
# Refs: forbedring af remove-worktree.ps1 squash-merge-detektion (2026-05-31).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\git-merge-detection.ps1')

$pass = 0
$fail = 0
$failDetails = New-Object System.Collections.Generic.List[string]

function Check {
  param([string]$Label, [bool]$Condition, [string]$Got = '')
  if ($Condition) {
    $script:pass++
    Write-Host ("  [PASS] {0}" -f $Label) -ForegroundColor Green
  } else {
    $script:fail++
    $detail = if ($Got) { "$Label -> $Got" } else { $Label }
    Write-Host ("  [FAIL] {0}" -f $detail) -ForegroundColor Red
    $script:failDetails.Add($detail)
  }
}

# --- Del 1: ren beslutnings-logik (Get-BranchMergeDecision, ingen IO) --------
Write-Host ""
Write-Host "Del 1: Get-BranchMergeDecision (ren logik)"

$d = Get-BranchMergeDecision -AncestryMerged $true -MergedPrState $false
Check "ancestry merged -> Merged" $d.Merged "Merged=$($d.Merged)"
Check "ancestry merged -> Method=ancestry" ($d.Method -eq 'ancestry') "Method=$($d.Method)"
Check "ancestry merged -> ForceDelete=false (-d)" (-not $d.ForceDelete) "ForceDelete=$($d.ForceDelete)"

$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $true
Check "squash PR -> Merged" $d.Merged "Merged=$($d.Merged)"
Check "squash PR -> Method=squash-pr" ($d.Method -eq 'squash-pr') "Method=$($d.Method)"
Check "squash PR -> ForceDelete=true (-D)" $d.ForceDelete "ForceDelete=$($d.ForceDelete)"

$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $false
Check "ingen merge -> NOT Merged" (-not $d.Merged) "Merged=$($d.Merged)"
Check "ingen merge -> Method=none" ($d.Method -eq 'none') "Method=$($d.Method)"

$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $null
Check "gh ubestemt -> NOT Merged" (-not $d.Merged) "Merged=$($d.Merged)"
Check "gh ubestemt -> Method=unknown" ($d.Method -eq 'unknown') "Method=$($d.Method)"

# Ancestry vinder selv hvis gh ikke kunne svare ($null) — vi rammer aldrig gh.
# (AheadCount udeladt => $null => zero-ahead-guarden springes over; gammel adfærd.)
$d = Get-BranchMergeDecision -AncestryMerged $true -MergedPrState $null
Check "ancestry vinder over gh-ubestemt" ($d.Merged -and $d.Method -eq 'ancestry' -and -not $d.ForceDelete) "Method=$($d.Method) Force=$($d.ForceDelete)"

# --- BUG 1: zero-ahead guard (frisk branch fejlklassificeret som merged) ------
# En frisk branch uden egne commits ser ancestry-merged ud (tippet ER i base),
# men har 0 unikke commits. Ancestry kan IKKE skelne 'frisk/aktiv worktree' fra
# 'merged efter eget arbejde' — så et ancestry-hit med ahead==0 MÅ beholdes,
# ellers ryger nyoprettede fleet-worktrees (data-tab, issue #1271).
$d = Get-BranchMergeDecision -AncestryMerged $true -MergedPrState $false -AheadCount 0
Check "zero-ahead + ancestry -> NOT Merged (frisk, behold)" (-not $d.Merged) "Merged=$($d.Merged)"
Check "zero-ahead + ancestry -> Method=fresh" ($d.Method -eq 'fresh') "Method=$($d.Method)"

# Frisk uden ancestry-hit men stadig 0 ahead -> behold.
$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $false -AheadCount 0
Check "zero-ahead uden ancestry -> NOT Merged (frisk, behold)" (-not $d.Merged -and $d.Method -eq 'fresh') "Merged=$($d.Merged) Method=$($d.Method)"

# Merged PR vinder OVER fresh-guarden: en merget PR betyder worktreet er FÆRDIGT
# (ikke frisk) — også når tippet er ancestry-merged med ahead==0 (fx --no-ff PR).
$d = Get-BranchMergeDecision -AncestryMerged $true -MergedPrState $true -AheadCount 0
Check "zero-ahead + merged PR -> Merged (PR-bevis vinder)" ($d.Merged -and $d.ForceDelete) "Merged=$($d.Merged) Force=$($d.ForceDelete)"

# Egne commits + merged PR (det normale squash-tilfælde): slet via -D.
$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $true -AheadCount 3
Check "ahead>0 + merged PR -> Merged via -D" ($d.Merged -and $d.ForceDelete) "Merged=$($d.Merged) Force=$($d.ForceDelete)"

# Egne commits, ingen merge -> behold.
$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $false -AheadCount 2
Check "ahead>0 uden merge -> NOT Merged (none)" (-not $d.Merged -and $d.Method -eq 'none') "Merged=$($d.Merged) Method=$($d.Method)"

# Egne commits, gh ubestemt -> behold (aldrig slet uden bekræftelse).
$d = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $null -AheadCount 2
Check "ahead>0 + gh ubestemt -> NOT Merged (unknown)" (-not $d.Merged -and $d.Method -eq 'unknown') "Merged=$($d.Merged) Method=$($d.Method)"

# --- Del 2: ægte git — almindelig merge vs. squash-merge --------------------
Write-Host ""
Write-Host "Del 2: ancestry-detektion mod aegte git-repo"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "  [FAIL] git ikke fundet paa PATH" -ForegroundColor Red
  exit 1
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "cz-merge-detect-$PID"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null

function Invoke-Git {
  & git -C $tmp @args 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') fejlede (exit $LASTEXITCODE)" }
}

try {
  Invoke-Git init -q -b main
  Invoke-Git config user.email "test@cyclingzone.local"
  Invoke-Git config user.name "CZ Test"
  Invoke-Git config commit.gpgsign false

  # Base-commit paa main
  Set-Content -Path (Join-Path $tmp "base.txt") -Value "base" -Encoding utf8
  Invoke-Git add -A
  Invoke-Git commit -q -m "base"

  # Scenarie A: almindelig merge (--no-ff, som en typisk PR-merge-commit)
  Invoke-Git checkout -q -b feat/normal-merge
  Set-Content -Path (Join-Path $tmp "normal.txt") -Value "normal" -Encoding utf8
  Invoke-Git add -A
  Invoke-Git commit -q -m "normal feature"
  Invoke-Git checkout -q main
  Invoke-Git merge -q --no-ff feat/normal-merge -m "Merge feat/normal-merge"

  # Scenarie B: squash-merge (flere commits -> EN ny commit paa main)
  Invoke-Git checkout -q -b feat/squash-merge main
  Set-Content -Path (Join-Path $tmp "squash.txt") -Value "squash one" -Encoding utf8
  Invoke-Git add -A
  Invoke-Git commit -q -m "squash c1"
  Add-Content -Path (Join-Path $tmp "squash.txt") -Value "squash two"
  Invoke-Git add -A
  Invoke-Git commit -q -m "squash c2"
  Invoke-Git checkout -q main
  Invoke-Git merge -q --squash feat/squash-merge
  Invoke-Git commit -q -m "Squashed feat/squash-merge (#999)"

  # Scenarie C: aldrig merged
  Invoke-Git checkout -q -b feat/never-merged main
  Set-Content -Path (Join-Path $tmp "never.txt") -Value "never" -Encoding utf8
  Invoke-Git add -A
  Invoke-Git commit -q -m "never merged"
  Invoke-Git checkout -q main

  # Ancestry-checks
  $aNormal = Test-BranchMergedByAncestry -Branch 'feat/normal-merge' -RepoRoot $tmp -BaseRef 'main'
  Check "almindelig merge fanges af ancestry" $aNormal "fik $aNormal"

  $aSquash = Test-BranchMergedByAncestry -Branch 'feat/squash-merge' -RepoRoot $tmp -BaseRef 'main'
  Check "squash-merge fanges IKKE af ancestry (kerne-bug)" (-not $aSquash) "fik $aSquash (forventede false)"

  $aNever = Test-BranchMergedByAncestry -Branch 'feat/never-merged' -RepoRoot $tmp -BaseRef 'main'
  Check "umerged branch er ikke ancestry-merged" (-not $aNever) "fik $aNever"

  # Beslutning: almindelig merge -> -d
  $dNormal = Get-BranchMergeDecision -AncestryMerged $aNormal -MergedPrState $false
  Check "almindelig merge -> beslutning: slet via -d" ($dNormal.Merged -and -not $dNormal.ForceDelete) "Merged=$($dNormal.Merged) Force=$($dNormal.ForceDelete)"

  # Beslutning: squash (ancestry=false) + simuleret merged PR (gh=$true) -> -D
  $dSquash = Get-BranchMergeDecision -AncestryMerged $aSquash -MergedPrState $true
  Check "squash + merged PR -> beslutning: slet via -D" ($dSquash.Merged -and $dSquash.ForceDelete -and $dSquash.Method -eq 'squash-pr') "Merged=$($dSquash.Merged) Force=$($dSquash.ForceDelete) Method=$($dSquash.Method)"

  # --- Del 2b: BUG 1 — frisk branch uden egne commits (ahead-count) ----------
  Write-Host ""
  Write-Host "Del 2b: zero-ahead-detektion (frisk worktree-beskyttelse)"

  # Scenarie D: frisk branch fra main, INGEN egne commits.
  Invoke-Git checkout -q -b feat/fresh-no-commits main
  Invoke-Git checkout -q main

  # Scenarie E: frisk branch, derefter rykker main FORBI den (frisk-bagud — det
  # præcise tilfælde der ramte 2026-06-21: branch oprettet fra origin/main mens
  # andre PR'er merged, så main voksede forbi en branch uden eget arbejde).
  Invoke-Git checkout -q -b feat/fresh-behind main
  Invoke-Git checkout -q main
  Set-Content -Path (Join-Path $tmp "moved.txt") -Value "main advanced" -Encoding utf8
  Invoke-Git add -A
  Invoke-Git commit -q -m "main advances past fresh branch"

  $ahFresh = Get-BranchAheadCount -Branch 'feat/fresh-no-commits' -RepoRoot $tmp -BaseRef 'main'
  Check "frisk branch: ahead-count = 0" ($ahFresh -eq 0) "fik $ahFresh"

  $ahBehind = Get-BranchAheadCount -Branch 'feat/fresh-behind' -RepoRoot $tmp -BaseRef 'main'
  Check "frisk-bagud branch: ahead-count = 0" ($ahBehind -eq 0) "fik $ahBehind"

  $ahNever = Get-BranchAheadCount -Branch 'feat/never-merged' -RepoRoot $tmp -BaseRef 'main'
  Check "branch med egne commits: ahead-count > 0" ($ahNever -gt 0) "fik $ahNever"

  # Kerne-bug: ancestry ser frisk-bagud som 'merged', men ahead==0 redder den.
  $aBehind = Test-BranchMergedByAncestry -Branch 'feat/fresh-behind' -RepoRoot $tmp -BaseRef 'main'
  Check "frisk-bagud ses (forkert) som ancestry-merged — bug-kilden" $aBehind "fik $aBehind"

  $dBehind = Get-BranchMergeDecision -AncestryMerged $aBehind -MergedPrState $false -AheadCount $ahBehind -BaseRef 'main'
  Check "frisk-bagud -> beslutning: BEHOLD (ikke slet)" (-not $dBehind.Merged -and $dBehind.Method -eq 'fresh') "Merged=$($dBehind.Merged) Method=$($dBehind.Method)"

  # Branch MED egne commits, ikke merged -> stadig korrekt 'none' (ikke fresh).
  $dNever = Get-BranchMergeDecision -AncestryMerged $false -MergedPrState $false -AheadCount $ahNever -BaseRef 'main'
  Check "umerged branch med commits -> NOT Merged (none, ikke fresh)" (-not $dNever.Merged -and $dNever.Method -eq 'none') "Merged=$($dNever.Merged) Method=$($dNever.Method)"

  # Bevis at '-D' faktisk er noedvendig for squash: 'git branch -d' skal naegte.
  & git -C $tmp branch -d feat/squash-merge 2>&1 | Out-Null
  $safeDeleteRefused = ($LASTEXITCODE -ne 0)
  Check "'git branch -d' naegter squash-branch (derfor -D)" $safeDeleteRefused "exit=$LASTEXITCODE (forventede !=0)"

  # ...og at '-D' (force) rydder den op.
  & git -C $tmp branch -D feat/squash-merge 2>&1 | Out-Null
  $forceDeleteWorked = ($LASTEXITCODE -eq 0)
  Check "'git branch -D' sletter squash-branch" $forceDeleteWorked "exit=$LASTEXITCODE (forventede 0)"

  # '-d' rydder den almindelige merge op uden force.
  & git -C $tmp branch -d feat/normal-merge 2>&1 | Out-Null
  Check "'git branch -d' sletter almindelig-merge-branch" ($LASTEXITCODE -eq 0) "exit=$LASTEXITCODE (forventede 0)"

} finally {
  Set-Location ([System.IO.Path]::GetTempPath())
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Summary ----------------------------------------------------------------
$total = $pass + $fail
Write-Host ""
Write-Host "================================="
if ($fail -eq 0) {
  Write-Host "ALL TESTS PASSED ($pass/$total)" -ForegroundColor Green
  exit 0
} else {
  Write-Host "$fail/$total tests FAILED" -ForegroundColor Red
  foreach ($d in $failDetails) { Write-Host "  - $d" -ForegroundColor Red }
  exit 1
}
