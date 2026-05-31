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
$d = Get-BranchMergeDecision -AncestryMerged $true -MergedPrState $null
Check "ancestry vinder over gh-ubestemt" ($d.Merged -and $d.Method -eq 'ancestry' -and -not $d.ForceDelete) "Method=$($d.Method) Force=$($d.ForceDelete)"

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
