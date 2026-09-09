# merge-queue.ps1
#
# Merge-koe-guard: een merge ad gangen, vent paa Railway-deploy + groen
# "Deploy verify" (eller mindst -MinWaitMinutesNoBackend) foer naeste merge,
# og merg aldrig i etape-tick-vinduet HH:57-HH:03 (#4919).
#
# Baggrund: 6/9 kl. 15:46 blev fem backend-PR'er merget i kaede paa eet
# minut (#4890 #4892 #4891 #4893 #4894). Main var groen bagefter (371/371
# v4-tests, tsc), men Railway deployede fem gange i traek, og "Deploy
# verify" blev roed i de sekunder hvor deploys afloeste hinanden (health
# 502). Genkoersel var groen - ingen spillerskade maalt, men moensteret kan
# ramme en etape-tick (hver hele time).
#
# Hvad scriptet goer pr. PR i den angivne raekkefolge:
#   1. Venter til uden for etape-tick-vinduet (HH:57 - HH:03).
#   2. Tjekker at alle PAAKRAEVEDE checks er groenne (`gh pr checks --required`)
#      - ellers STOPPER hele koeen (ingen af de foelgende PR'er merges).
#   3. Merger med `gh pr merge <N> --squash --delete-branch --admin`.
#   4. Venter paa at hovedrepoets CI-workflow (ci.yml) er groent for den nye
#      main-HEAD (den commit merges skabte).
#   5. Roerer PR'en `backend/`: venter derudover paa at "Deploy verify"
#      (.github/workflows/deploy-verify.yml - Vercel/Railway-deploy +
#      smoke-test) er groent for samme SHA. Roerer den IKKE backend/: venter
#      i stedet mindst -MinWaitMinutesNoBackend minutter (default 3).
#   6. Er CI eller Deploy verify roed for den nye HEAD: STOPPER koeen (roed
#      main = stop-alt-fix-foerst, jf. GITHUB_WORKFLOW.md §Hurtige merges)
#      i stedet for at merge videre ovenpaa den.
#
# -DryRun: gennemgaar HELE koeen paa noejagtig samme maade som en rigtig
# koersel (inkl. et frisk checks-genkald pr. PR og etape-tick-ventepunktet),
# og standser paa PRAECIS det punkt en rigtig koersel ville standse - men
# INGEN mutations-kald (merge/gh run watch) udfoeres nogensinde. Brug denne
# til at se hvor koeen ville stoppe FOER en rigtig koersel.
#
# Sikkerhed:
#   - `gh pr checks --required` er read-only og koeres ALTID (ogsaa -DryRun).
#   - Alle mutations-kald (merge) er betinget af IKKE -DryRun.
#   - Alle gh-kald gaar via den delte retry-wrapper (scripts/lib/gh-retry.ps1).
#
# Brug (-Pr er en STRING - se param-blokken for hvorfor; komma- eller
# mellemrums-separeret, quote den fra en Bash-shell):
#   pwsh -File scripts/merge-queue.ps1 -Pr "4890,4892,4891" -DryRun   # gennemgang, intet merges
#   pwsh -File scripts/merge-queue.ps1 -Pr "4890,4892,4891"           # udfoer koeen
#   pwsh -File scripts/merge-queue.ps1 -Pr "4890" -MinWaitMinutesNoBackend 5
#
# Refs #4919, #3855.

param(
  # STRING, ikke [int[]]: kaldes typisk fra en Bash-shell ("pwsh -File ... -Pr
  # 4890,4892"), og OS-argv giver da PowerShell ÉT token "4890,4892" - uden
  # PowerShell-parserens egen komma-til-array-magi (den findes kun naar man
  # kalder direkte i PowerShell-sproget, ikke via et eksternt process-argv).
  # Et [int[]]-parameter i den situation caster HELE strengen til ét tal og
  # taber kommaet (fanget under verifikation: "-Pr 4736,3512" blev til PR
  # #47363512). Split selv nedenfor i stedet.
  [Parameter(Mandatory)]
  [string] $Pr,
  [switch] $DryRun,
  [int] $MinWaitMinutesNoBackend = 3,
  [string] $Repo = "NicolaiDolmer/CyclingZone",
  [int] $DeployVerifyTimeoutMinutes = 20,
  [int] $CiTimeoutMinutes = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\gh-retry.ps1')
. (Join-Path $PSScriptRoot 'lib\league-check.ps1')

$PrNumbers = @($Pr -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
if ($PrNumbers.Count -eq 0) { Write-Error "Ingen gyldige PR-numre i -Pr '$Pr'."; exit 1 }

function Get-PrPlanEntry([int]$number) {
  # Read-only: PR-metadata + required-checks-status. Sikkert at koere i -DryRun.
  $checksExit = 0
  $checksSummary = "ukendt"
  try {
    & gh pr checks $number --repo $Repo --required *> $null
    $checksExit = $LASTEXITCODE
  } catch {
    $checksExit = 1
  }
  # #4753: the production invariant is mandatory even before GitHub settings
  # are updated. Missing, pending, skipped and failing all stop this queue.
  if ($checksExit -eq 0) {
    $leagueJson = & gh pr checks $number --repo $Repo --json name,bucket
    $leagueExit = $LASTEXITCODE
    try {
      if ($leagueExit -notin @(0, 1, 8)) {
        $checksExit = 1
      } else {
        $checksExit = Get-LeagueCheckExitCode -Checks @(($leagueJson -join "") | ConvertFrom-Json)
      }
    } catch { $checksExit = 1 }
  }
  if ($checksExit -eq 0) { $checksSummary = "GROEN" }
  elseif ($checksExit -eq 8) { $checksSummary = "AFVENTER" }
  else { $checksSummary = "ROED/mangler" }

  $filesJson = Invoke-GhWithRetry @('pr', 'view', "$number", '--repo', $Repo, '--json', 'files,title,mergeable,isDraft') -TolerateFailure
  $touchesBackend = $false
  $title = "(ukendt)"
  $mergeable = "UNKNOWN"
  $isDraft = $false
  if ($filesJson) {
    try {
      $parsed = ($filesJson -join "") | ConvertFrom-Json
      $title = $parsed.title
      $mergeable = $parsed.mergeable
      $isDraft = [bool]$parsed.isDraft
      foreach ($f in $parsed.files) {
        if ($f.path -match '^backend/') { $touchesBackend = $true; break }
      }
    } catch {}
  }

  [pscustomobject]@{
    number         = $number
    title          = $title
    checksExit     = $checksExit
    checksSummary  = $checksSummary
    touchesBackend = $touchesBackend
    mergeable      = $mergeable
    isDraft        = $isDraft
  }
}

function Wait-OutOfMergeTickWindow {
  # Etape-tick hver hele time - merg aldrig i HH:57..HH:03.
  while ($true) {
    $now = Get-Date
    $minute = $now.Minute
    $inWindow = ($minute -ge 57) -or ($minute -le 3)
    if (-not $inWindow) { return }

    if ($minute -ge 57) {
      $target = (Get-Date -Minute 0 -Second 0 -Millisecond 0).AddHours(1).AddMinutes(4)
    } else {
      $target = (Get-Date -Minute 0 -Second 0 -Millisecond 0).AddMinutes(4)
    }
    Write-Host ("  [etape-tick] Inden for HH:57-HH:03 - venter til {0}." -f $target.ToString("HH:mm")) -ForegroundColor Yellow
    if ($DryRun) {
      Write-Host "  [dry-run] ville vente til $($target.ToString('HH:mm')) - simulerer videre uden reel sleep." -ForegroundColor DarkGray
      return
    }
    $sleepSec = [int](($target - (Get-Date)).TotalSeconds)
    if ($sleepSec -gt 0) { Start-Sleep -Seconds $sleepSec }
  }
}

function Wait-ForWorkflowRun {
  param(
    [string] $WorkflowFile,
    [string] $Sha,
    [int] $TimeoutMinutes,
    [string] $Label
  )
  if ($DryRun) {
    Write-Host "  [dry-run] ville vente paa '$Label' ($WorkflowFile) for $Sha (op til $TimeoutMinutes min)." -ForegroundColor DarkGray
    return $true
  }

  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $runId = $null
  while ((Get-Date) -lt $deadline -and -not $runId) {
    $runsJson = Invoke-GhWithRetry @('run', 'list', '--repo', $Repo, '--workflow', $WorkflowFile, '--branch', 'main', '--limit', '10', '--json', 'databaseId,headSha,status,conclusion') -TolerateFailure
    if ($runsJson) {
      try {
        $runs = ($runsJson -join "") | ConvertFrom-Json
        $match = $runs | Where-Object { $_.headSha -eq $Sha } | Select-Object -First 1
        if ($match) { $runId = $match.databaseId }
      } catch {}
    }
    if (-not $runId) {
      Write-Host "  ... venter paa at '$Label'-koerslen for $Sha bliver oprettet ..." -ForegroundColor DarkGray
      Start-Sleep -Seconds 15
    }
  }

  if (-not $runId) {
    Write-Host "  [FEJL] Fandt ingen '$Label'-koersel for $Sha inden for $TimeoutMinutes min." -ForegroundColor Red
    return $false
  }

  Write-Host "  Venter paa '$Label' (run $runId) for $Sha ..."
  & gh run watch $runId --repo $Repo --exit-status *> $null
  $ok = ($LASTEXITCODE -eq 0)
  if ($ok) {
    Write-Host "  [ok] '$Label' groen for $Sha." -ForegroundColor Green
  } else {
    Write-Host "  [FEJL] '$Label' ROED for $Sha (run $runId)." -ForegroundColor Red
  }
  return $ok
}

# --- 1. Indledende oversigt (read-only, ét kald pr. PR) ---------------------
Write-Host "=== merge-queue $(if ($DryRun) { '[DRY-RUN - gennemgaar hele koeen, merger intet]' } else { '[EXECUTE]' }) ===" -ForegroundColor Cyan
Write-Host "Repo: $Repo   Raekkefoelge: $($PrNumbers -join ' -> ')"
Write-Host ""

$plan = @()
foreach ($n in $PrNumbers) { $plan += Get-PrPlanEntry $n }

$plan | ForEach-Object {
  $backendTxt = if ($_.touchesBackend) { "ja (venter paa Railway+Deploy verify)" } else { "nej (venter mindst ${MinWaitMinutesNoBackend}min)" }
  Write-Host ("  PR #{0}: checks={1}  backend/={2}  mergeable={3}  draft={4}" -f $_.number, $_.checksSummary, $backendTxt, $_.mergeable, $_.isDraft)
  Write-Host ("      $($_.title)") -ForegroundColor DarkGray
}
Write-Host ""

# --- 2. Gennemgang/udfoerelse af koeen sekventielt --------------------------
# KOERER I BEGGE TILSTANDE: -DryRun gaar gennem noejagtig samme trin (inkl.
# et FRISKT checks-genkald pr. PR - status fra sektion 1 kan vaere foraeldet
# hvis koeen ventede laenge) og standser paa PRAECIS samme punkt som en rigtig
# koersel ville - den eneste forskel er at intet mutations-kald (merge/wait-
# for-workflow) reelt udfoeres. Det goer -DryRun til en aekte forhaandsvisning
# af hvor koeen ville standse, ikke kun et statisk snapshot fra start.
foreach ($entry in $plan) {
  $n = $entry.number
  Write-Host ""
  Write-Host "=== PR #$n ===" -ForegroundColor Cyan

  Wait-OutOfMergeTickWindow

  $fresh = Get-PrPlanEntry $n
  if ($fresh.checksExit -ne 0) {
    Write-Host "STOP: PR #$n har ikke groenne paakraevede checks ($($fresh.checksSummary)). Ingen flere PR'er merges." -ForegroundColor Red
    exit 1
  }

  if ($DryRun) {
    Write-Host "  [dry-run] ville merge nu: gh pr merge $n --squash --delete-branch --admin" -ForegroundColor DarkGray
    if ($entry.touchesBackend) {
      Write-Host "  [dry-run] ville derefter vente paa CI (main) + 'Deploy verify' (Railway+smoke) for merge-commit'et." -ForegroundColor DarkGray
    } else {
      Write-Host "  [dry-run] ville derefter vente paa CI (main) + mindst $MinWaitMinutesNoBackend min (roerer ikke backend/)." -ForegroundColor DarkGray
    }
    continue
  }

  Write-Host "  Merger: gh pr merge $n --squash --delete-branch --admin"
  Invoke-GhWithRetry @('pr', 'merge', "$n", '--repo', $Repo, '--squash', '--delete-branch', '--admin') | Out-Null

  # Merge-commit-SHA'en er ikke altid straks synlig via API'et - lille retry-loop.
  $sha = $null
  for ($i = 0; $i -lt 10 -and -not $sha; $i++) {
    $viewJson = Invoke-GhWithRetry @('pr', 'view', "$n", '--repo', $Repo, '--json', 'mergeCommit') -TolerateFailure
    if ($viewJson) {
      try {
        $parsed = ($viewJson -join "") | ConvertFrom-Json
        if ($parsed.mergeCommit -and $parsed.mergeCommit.oid) { $sha = $parsed.mergeCommit.oid }
      } catch {}
    }
    if (-not $sha) { Start-Sleep -Seconds 5 }
  }
  if (-not $sha) {
    Write-Host "  [FEJL] Kunne ikke afgoere merge-commit-SHA for PR #$n - STOPPER koeen (kan ikke verificere CI/deploy)." -ForegroundColor Red
    exit 1
  }
  Write-Host "  Merged som $sha"

  $ciOk = Wait-ForWorkflowRun -WorkflowFile "ci.yml" -Sha $sha -TimeoutMinutes $CiTimeoutMinutes -Label "CI (main)"
  if (-not $ciOk) {
    Write-Host "STOP: main-CI er ROED efter PR #$n. Fix main FOER naeste merge i koeen (rod main = stop-alt-fix-foerst)." -ForegroundColor Red
    exit 1
  }

  if ($entry.touchesBackend) {
    $deployOk = Wait-ForWorkflowRun -WorkflowFile "deploy-verify.yml" -Sha $sha -TimeoutMinutes $DeployVerifyTimeoutMinutes -Label "Deploy verify (Railway+smoke)"
    if (-not $deployOk) {
      Write-Host "STOP: 'Deploy verify' er ROED efter PR #$n (roerer backend/). Undersoeg Railway-deploy FOER naeste merge." -ForegroundColor Red
      exit 1
    }
  } else {
    Write-Host "  PR #$n roerer ikke backend/ - venter mindst $MinWaitMinutesNoBackend min foer naeste merge."
    Start-Sleep -Seconds ($MinWaitMinutesNoBackend * 60)
  }

  Write-Host "  [ok] PR #$n faerdig - klar til naeste i koeen." -ForegroundColor Green
}

Write-Host ""
if ($DryRun) {
  Write-Host "[dry-run] Hele koeen ($($PrNumbers.Count) PR'er) blev gennemgaaet uden fejl - alle er klar til en rigtig koersel lige nu." -ForegroundColor Green
} else {
  Write-Host "[OK] Hele merge-koeen ($($PrNumbers.Count) PR'er) er merget og verificeret." -ForegroundColor Green
}
