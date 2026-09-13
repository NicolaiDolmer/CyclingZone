# new-worktree.ps1
#
# Opretter et git worktree til parallel Claude Code-session og setup'er:
#   - .env hardlinks DIREKTE til OneDrive-context\secrets (omgår cascade-cloud-fil-issue)
#   - node_modules junction til delt cache (sparer ~500 MB + install-tid) - MEDMINDRE
#     -OwnNodeModules er sat, se nedenfor.
#   - Memory + codex-junctions via link-onedrive-context.ps1 -RepoRoot <worktree>
#
# Brug:
#   pwsh -File scripts/new-worktree.ps1 -Branch feat/min-feature
#   pwsh -File scripts/new-worktree.ps1 -Branch fix/abc -FromBranch origin/develop
#
# -OwnNodeModules (#5143):
#   Dependency-baner (Express 4->5, dotenv-opgraderinger, osv.) der kører `npm
#   install`/`npm ci` i worktreet ville ellers reificere IND I den delte
#   junction-cache og potentielt paavirke alle andre worktrees + hovedcheckoutet.
#   Med -OwnNodeModules koerer scriptet i stedet `npm ci` i selve worktreet for
#   hver package.json-mappe der findes (rod, backend, frontend, marketing) -
#   INGEN junction for denne lane. Auto-sat naar branch-navnet starter med
#   `chore/deps` eller `dependabot/`, saa adfaerden er valgt og synlig uden at
#   nogen skal huske flaget (naer-haendelse 11/9, se docs/WORKTREE_WORKFLOW.md).
#
# Resultat: C:\dev\CyclingZone-worktrees\<branch-slug>\
# Åbn ny Claude Code-session i den path.

param(
  [Parameter(Mandatory)] [string] $Branch,
  [string] $FromBranch = "origin/main",
  [string] $RepoRoot = "C:\dev\CyclingZone",
  [string] $WorktreesRoot = "C:\dev\CyclingZone-worktrees",
  [switch] $OwnNodeModules,
  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Branch-slug: erstat / med - for path-safety
$slug = $Branch -replace '/','-'
$wt = Join-Path $WorktreesRoot $slug

# #5143: dependency-baner faar egen node_modules automatisk, uanset om flaget
# blev givet eksplicit - branch-navnet ER signalet en orkestrator/bruger allerede
# satte da branchen blev navngivet.
$isDepsBranch = $Branch -match '^(chore/deps|dependabot/)'
$effectiveOwnNodeModules = [bool]($OwnNodeModules.IsPresent -or $isDepsBranch)

if (Test-Path $wt) {
  Write-Host "[stop] Worktree-path findes allerede: $wt" -ForegroundColor Red
  Write-Host "       Kør 'git worktree remove $wt' først hvis du vil genskabe." -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path $WorktreesRoot)) {
  if ($DryRun) {
    Write-Host "[would-mkdir] $WorktreesRoot" -ForegroundColor Cyan
  } else {
    New-Item -ItemType Directory $WorktreesRoot -Force | Out-Null
  }
}

Write-Host "=== git worktree add ===" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "[would-run] git -C $RepoRoot worktree add -b $Branch $wt $FromBranch" -ForegroundColor Cyan
} else {
  & git -C $RepoRoot worktree add -b $Branch $wt $FromBranch
  if ($LASTEXITCODE -ne 0) { throw "git worktree add fejlede" }
}

Write-Host ""
Write-Host "=== node_modules-strategi ===" -ForegroundColor Cyan
if ($effectiveOwnNodeModules) {
  $why = if ($OwnNodeModules.IsPresent) { "-OwnNodeModules" } else { "branch '$Branch' matcher chore/deps* eller dependabot/*" }
  Write-Host "  Egen node_modules ($why): npm ci pr. package.json-mappe, INGEN delt junction." -ForegroundColor Yellow
  Write-Host "  Koer ALDRIG npm install i et worktree med junction-node_modules - denne lane faar sit eget install i stedet." -ForegroundColor Yellow

  # I DryRun findes worktreet ($wt) ikke endnu (git worktree add koeres ikke
  # rigtigt ovenfor) - vi finder derfor package.json-mapperne i kilde-repoet,
  # som har samme filtraestruktur (worktreet grenes derfra).
  $probeRoot = if ($DryRun) { $RepoRoot } else { $wt }
  $candidates = @(
    @{ Name = 'root';      Rel = '' },
    @{ Name = 'backend';   Rel = 'backend' },
    @{ Name = 'frontend';  Rel = 'frontend' },
    @{ Name = 'marketing'; Rel = 'marketing' }
  )
  $targets = @()
  foreach ($c in $candidates) {
    $probeDir = if ($c.Rel) { Join-Path $probeRoot $c.Rel } else { $probeRoot }
    if (Test-Path (Join-Path $probeDir 'package.json')) {
      $targets += $c
    }
  }

  if ($targets.Count -eq 0) {
    Write-Host "  [warn] ingen package.json-mapper fundet under $probeRoot" -ForegroundColor Yellow
  }

  foreach ($t in $targets) {
    $runDir = if ($t.Rel) { Join-Path $wt $t.Rel } else { $wt }
    if ($DryRun) {
      Write-Host "  [would-npm-ci] $runDir" -ForegroundColor Cyan
      continue
    }
    # npm ci er en TUNG koersel (jf. scripts/make-wave-brief.mjs's semafor-blok) -
    # wrappes i verify-lock.ps1 ligesom enhver anden tung install, saa flere
    # samtidige -OwnNodeModules-worktrees ikke overbelaster maskinen (#5142).
    Write-Host "  [npm ci, verify-lock] $runDir" -ForegroundColor Yellow
    $verifyLockScript = Join-Path $RepoRoot "scripts\verify-lock.ps1"
    Push-Location $runDir
    try {
      & pwsh -NoProfile -File $verifyLockScript -Max 2 -Timeout 1800 -- npm ci --no-audit --no-fund
      $ciExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($ciExit -eq 75) {
      throw "npm ci i $runDir kunne ikke faa et verify-lock-slot inden for tidsfristen (exit 75 - koe-timeout, ikke en npm-fejl). Proev igen."
    }
    if ($ciExit -ne 0) {
      throw "npm ci fejlede i $runDir (exit $ciExit) - worktreet er oprettet i $wt, men mangler $($t.Name)-node_modules."
    }
  }

  if (-not $DryRun) {
    Write-Host "  [ok] egen node_modules installeret - ingen delt cache-junction for denne lane." -ForegroundColor Green
  }
} else {
  Write-Host "  Delt junction til lockfile-hashet cache (standard) - se setup-worktree.ps1 nedenfor." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== .env-hardlinks + evt. resterende node_modules-junctions (setup-worktree.ps1) ===" -ForegroundColor Cyan
# Genbrug den idempotente setup-logik (junctions + OneDrive-.env-hardlinks).
# Samme script kaldes af SessionStart-hooken for harness-oprettede worktrees (#994).
# Har vi netop koert -OwnNodeModules ovenfor, opdager setup-worktree.ps1 et
# allerede sundt, IKKE-junction node_modules og roerer det ikke (se dens egen
# "eget install, sundt (roeres ikke)"-gren) - den laver stadig .env-hardlinks.
$setupScript = Join-Path $RepoRoot "scripts\setup-worktree.ps1"
$setupArgs = @('-NoProfile', '-File', $setupScript, '-WorktreeRoot', $wt, '-MainRepoRoot', $RepoRoot)
if ($DryRun) { $setupArgs += '-DryRun' }
& pwsh @setupArgs
# #3367: et halvt setup er vaerre end ingen — agenten opdager det foerst som
# ERR_MODULE_NOT_FOUND eller "supabaseUrl is required" midt i en test-koersel.
# Stop her i stedet, med worktreet intakt saa problemet kan loeses og setup gentages.
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "[stop] setup-worktree.ps1 kunne ikke goere worktreet klar (exit $LASTEXITCODE)." -ForegroundColor Red
  Write-Host "       Worktreet er oprettet i $wt, men mangler node_modules og/eller .env." -ForegroundColor Yellow
  Write-Host "       Loes problemet ovenfor og koer: pwsh -File scripts/setup-worktree.ps1 -WorktreeRoot $wt -Rebuild" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "=== Memory + codex-junctions for worktree ===" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [would-run] link-onedrive-context.ps1 -RepoRoot $wt" -ForegroundColor Cyan
} else {
  & pwsh -File (Join-Path $RepoRoot "scripts\link-onedrive-context.ps1") -RepoRoot $wt
}

Write-Host ""
Write-Host "Færdig. Worktree klar i: $wt" -ForegroundColor Green
Write-Host ""
Write-Host "Næste skridt:" -ForegroundColor Cyan
Write-Host "  1. Åbn ny Claude Code-session i: $wt"
Write-Host "  2. Arbejd som normalt — branch er '$Branch'"
Write-Host "  3. Ved cleanup: pwsh -File scripts\remove-worktree.ps1 -Branch $Branch"
