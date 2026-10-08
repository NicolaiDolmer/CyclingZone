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
# Boelge-gaten (#5562): en koerende boelge blokerer kun PR'er hvis filer
# overlapper boelgens aktive ownership (`wave-policy.mjs assert-merge-allowed
# --pr N`, gentaget under state-laasen i guarded-merge, der merger med
# --match-head-commit). En legacy/ulaeselig markoer blokerer stadig alt.
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
  # Ejer 8/10: en raekke af PR'er der ikke roerer backend/ merges efter
  # hinanden, og CI (main) ventes kun EEN gang paa den sidste merge-SHA (den
  # indeholder hele raekken). -NoBatch giver den gamle en-ad-gangen-adfaerd.
  [switch] $NoBatch,
  # Review #6357: hoejst saa mange PR'er i en raekke (faerre Railway-deploys i
  # traek og fejlen kan stadig peges ud til en lille gruppe).
  [int] $MaxBatch = 3,
  [string] $Repo = "NicolaiDolmer/CyclingZone",
  [int] $DeployVerifyTimeoutMinutes = 60,
  [int] $CiTimeoutMinutes = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\gh-retry.ps1')
. (Join-Path $PSScriptRoot 'lib\league-check.ps1')

$PrNumbers = @($Pr -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
if ($PrNumbers.Count -eq 0) { Write-Error "Ingen gyldige PR-numre i -Pr '$Pr'."; exit 1 }

# #5562: en koerende boelge blokerer ikke laengere alle merges - kun PR'er hvis
# filer overlapper boelgens aktive ownership (se assert-merge-allowed i
# wave-policy.mjs). En legacy/ulaeselig markoer eller en uden ownership
# blokerer stadig her, foer noget GitHub-kald.
& node (Join-Path $PSScriptRoot 'wave-policy.mjs') assert-merge-allowed --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Aktiv boelgemarkoer: merge-koeen er blokeret.' }

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
  # Review #6357: Railway bygger paa ALT undtagen backend/railway.json's
  # watchPatterns-undtagelser (docs/, pr-screens/, superpowers/, .claude/, rod-*.md).
  # "Roerer ikke backend/" er altsaa ikke det samme som "deployer ikke Railway".
  $touchesRailway = $false
  $filesKnown = $false
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
        if ($f.path -match '^backend/') { $touchesBackend = $true }
        if ($f.path -notmatch '^(docs|pr-screens|superpowers|\.claude)/' -and $f.path -notmatch '^[^/]+\.md$') { $touchesRailway = $true }
      }
      $filesKnown = $true
    } catch {}
  }
  # Ukendt filliste maa aldrig batches stille uden deploy-verifikation.
  if (-not $filesKnown) { $touchesBackend = $true; $touchesRailway = $true }

  [pscustomobject]@{
    number         = $number
    title          = $title
    checksExit     = $checksExit
    checksSummary  = $checksSummary
    touchesBackend = $touchesBackend
    touchesRailway = $touchesRailway
    mergeable      = $mergeable
    isDraft        = $isDraft
  }
}

function Get-PrMergeCategory([int]$number) {
  # #5508: read-only, sikkert i -DryRun. Kalder den rene Node-klassifikator, som
  # selv laeser PR'en via gh (labels + filer + body). Returnerer altid en streng;
  # en fejl bliver til "ukendt (...)" og stopper ALDRIG koeen - klassifikationen
  # er information, ikke en gate (hard rule 35 siger "logge kategorien").
  try {
    $line = & node (Join-Path $PSScriptRoot 'merge-queue-classify.mjs') --pr "$number" --repo $Repo 2>&1
    if ($LASTEXITCODE -ne 0 -or -not $line) { return "ukendt (klassifikator exit $LASTEXITCODE)" }
    return (($line | ForEach-Object { "$_" }) -join ' ').Trim()
  } catch {
    return "ukendt (klassifikator fejlede: $($_.Exception.Message))"
  }
}

function Set-PrOwnerGoMarker([int]$number, [string]$classification) {
  # Best-effort: en fejl her stopper aldrig koeen. Klassifikatoren returnerer
  # "klaebende: ..." naar markoeren allerede findes, saa den skrives kun een gang.
  if ($classification -like '*klaebende*') { return }
  $marker = '<!-- merge-queue-category: ejer-go -->'
  try {
    & gh pr comment $number --repo $Repo --body "$marker`nmerge-koe: $classification (klaebende, hard rule 35)" 2>&1 | Out-Null
  } catch {
    Write-Host "      (kunne ikke skrive ejer-go-markoer: $($_.Exception.Message))" -ForegroundColor DarkGray
  }
}

function Get-PrDraftState([int]$number) {
  # Let, dedikeret laesning af draft-status - IKKE et fuldt Get-PrPlanEntry-kald
  # (som ogsaa slaar checks og league-regler op), fordi denne kaldes FOERST i
  # loopet, foer der ventes paa noget som helst.
  #
  # CodeRabbit (denne PR): fejler gh-kaldet eller JSON-parsingen, maa
  # tilstanden ALDRIG stille laeses som "ikke draft" - saa ville koeen glide
  # forbi netop den PR den ikke kunne verificere og vente forgaeves paa
  # etape-tick-vinduet alligevel (samme fejlklasse guarden findes for at
  # forhindre). Returnerer derfor $true/$false/$null (ukendt) - kalderen
  # stopper koeen for BAADE $true og $null.
  $viewJson = Invoke-GhWithRetry @('pr', 'view', "$number", '--repo', $Repo, '--json', 'isDraft') -TolerateFailure
  if (-not $viewJson) { return $null }
  try {
    $parsed = ($viewJson -join "") | ConvertFrom-Json
    return [bool]$parsed.isDraft
  } catch { return $null }
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

function Wait-ForDeployVerification {
  param(
    [string] $Sha,
    [int] $TimeoutMinutes,
    [int] $MaxReruns = 2,
    [scriptblock] $Now = { [DateTime]::UtcNow },
    [scriptblock] $Pause = { param($Seconds) Start-Sleep -Seconds $Seconds },
    [string] $ClassifierPath = (Join-Path $PSScriptRoot 'ci/deploy-verification-state.mjs')
  )
  if ($DryRun) { return 'pending' }
  $deadline = (& $Now).AddMinutes($TimeoutMinutes)
  $runId = $null
  $minimumAttempt = 1
  $reruns = 0
  $lastState = 'unknown'
  $runFile = [IO.Path]::GetTempFileName()
  $jobsFile = [IO.Path]::GetTempFileName()
  try {
    while ((& $Now) -lt $deadline) {
      if (-not $runId) {
        $runsJson = Invoke-GhWithRetry @('run', 'list', '--repo', $Repo, '--workflow', 'deploy-verify.yml', '--branch', 'main', '--limit', '20', '--json', 'databaseId,headSha') -TolerateFailure
        if ($runsJson) {
          try {
            $matches = @(($runsJson -join "") | ConvertFrom-Json | Where-Object { $_.headSha -eq $Sha })
            if ($matches.Count -gt 0) { $runId = $matches[0].databaseId }
          } catch { Write-Host 'Deploy verify: run lookup unavailable; no verification claimed.' -ForegroundColor Yellow }
        }
        if (-not $runId) { & $Pause 15; continue }
      }
      $runJson = Invoke-GhWithRetry @('api', "repos/$Repo/actions/runs/$runId") -TolerateFailure
      if (-not $runJson) { return 'unknown' }
      try { $run = ($runJson -join "") | ConvertFrom-Json }
      catch { return 'unknown' }
      if ($run.head_sha -ne $Sha -or -not $run.run_attempt) { return 'unknown' }
      if ($run.run_attempt -ge $minimumAttempt -and $run.status -eq 'completed' -and $run.conclusion -in @('failure', 'timed_out')) { return 'failed' }
      $jobsJson = if ($run.status -eq 'completed' -and $run.run_attempt -ge $minimumAttempt) {
        Invoke-GhWithRetry @('api', "repos/$Repo/actions/runs/$runId/attempts/$($run.run_attempt)/jobs?per_page=100") -TolerateFailure
      } else { '{"jobs":[]}' }
      if (-not $jobsJson) { return 'unknown' }
      [IO.File]::WriteAllText($runFile, ($runJson -join ""))
      [IO.File]::WriteAllText($jobsFile, ($jobsJson -join ""))
      $state = (& node $ClassifierPath $runFile $jobsFile $Sha $minimumAttempt | Out-String).Trim()
      $lastState = $state
      if ($state -eq 'verified' -or $state -eq 'failed' -or $state -eq 'unknown') { return $state }
      if ($state -eq 'pending') {
        if ($reruns -ge $MaxReruns) { return 'pending' }
        Write-Host "  AFVENTER deploy (run $runId, attempt $($run.run_attempt)); genkoerer samme run, ikke naeste merge." -ForegroundColor Yellow
        Invoke-GhWithRetry @('run', 'rerun', "$runId", '--repo', $Repo) | Out-Null
        $minimumAttempt = [int]$run.run_attempt + 1
        $reruns++
      } elseif ($state -ne 'waiting') { return 'unknown' }
      & $Pause 15
    }
    if ($lastState -eq 'waiting' -or $lastState -eq 'pending') { return 'pending' }
    return 'unknown'
  } finally {
    Remove-Item -LiteralPath $runFile, $jobsFile -ErrorAction SilentlyContinue
  }
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
  # #5508 / AGENTS.md hard rule 35: kategori (a)/(b)/(c) eller "kraever ejer-go".
  # KUN information i oversigten - koeen merger praecis som foer, uanset kategori.
  # Logikken ligger i scripts/merge-queue-classify.mjs (ren Node, node --test);
  # dette script viser kun linjen. Fejler node-kaldet, vises det som ukendt.
  $classification = Get-PrMergeCategory $_.number
  # Ejer 4/10: ejer-go er klaebende. Foerste ejer-go-klassifikation skrives som
  # markoer paa PR'en, saa en senere omformulering af body ikke kan loefte den til
  # (a)-(c). Ogsaa i -DryRun: markoeren er metadata, ikke en merge. Slet den aldrig.
  if ($classification -like 'EJER-GO*') { Set-PrOwnerGoMarker $_.number $classification }
  $classColor = if ($classification -like 'KATEGORI *') { 'Green' } elseif ($classification -like 'EJER-GO*') { 'Yellow' } else { 'DarkGray' }
  Write-Host ("      merge-regel: $classification") -ForegroundColor $classColor
}
Write-Host ""

# --- 2. Gennemgang/udfoerelse af koeen sekventielt --------------------------
# KOERER I BEGGE TILSTANDE: -DryRun gaar gennem noejagtig samme trin (inkl.
# et FRISKT checks-genkald pr. PR - status fra sektion 1 kan vaere foraeldet
# hvis koeen ventede laenge) og standser paa PRAECIS samme punkt som en rigtig
# koersel ville - den eneste forskel er at intet mutations-kald (merge/wait-
# for-workflow) reelt udfoeres. Det goer -DryRun til en aekte forhaandsvisning
# af hvor koeen ville standse, ikke kun et statisk snapshot fra start.
$script:batchMerged = @()
$script:batchRailway = $false
$script:lastMergedSha = $null
$script:dryBatchSize = 0

# Review #6357 M1: stopper koeen midt i en raekke, er de allerede mergede PR'er
# aldrig CI-verificeret. Vent paa CI (main) for den sidste merge-SHA og sig det
# tydeligt, FOER koeen afsluttes.
function Exit-Queue([int]$Code) {
  if ($script:batchMerged.Count -gt 0 -and $script:lastMergedSha) {
    $label = ($script:batchMerged | ForEach-Object { "#$_" }) -join ", "
    Write-Host "  Koeen stopper midt i en raekke: $label er allerede merget. Venter paa CI (main) for $($script:lastMergedSha) foer exit." -ForegroundColor Yellow
    $ok = Wait-ForWorkflowRun -WorkflowFile "ci.yml" -Sha $script:lastMergedSha -TimeoutMinutes $CiTimeoutMinutes -Label "CI (main)"
    if ($ok) {
      Write-Host "  CI (main) groen efter $label. Deploy-verifikation er IKKE ventet - tjek 'Deploy verify' for $($script:lastMergedSha)." -ForegroundColor Yellow
    } else {
      Write-Host "  CI (main) er ROED eller ikke faerdig efter $label - fix main foer naeste merge." -ForegroundColor Red
      if ($Code -eq 0) { $Code = 1 }
    }
  }
  exit $Code
}

for ($idx = 0; $idx -lt $plan.Count; $idx++) {
  $entry = $plan[$idx]
  $n = $entry.number
  # Batch (ejer 8/10, review #6357): naeste PR roerer heller ikke backend/ og
  # raekken er under -MaxBatch -> merge med det samme og vent paa CI (main) +
  # evt. deploy-verifikation EEN gang efter raekken.
  $batchWithNext = (-not $NoBatch) -and (-not $entry.touchesBackend) -and ($idx + 1 -lt $plan.Count) -and (-not $plan[$idx + 1].touchesBackend) -and (([Math]::Max($script:batchMerged.Count, $script:dryBatchSize) + 1) -lt $MaxBatch)
  Write-Host ""
  Write-Host "=== PR #$n ===" -ForegroundColor Cyan

  # Draft-tjek FOERST - foer der ventes paa noget som helst (heller ikke
  # etape-tick-vinduet). #5220: merge-queue.ps1 opdagede foerst at PR #5216
  # var draft ved selve merge-kaldet, EFTER at koeen havde ventet paa
  # etape-tick-vinduet - 10 spildte minutter. Koeres i BEGGE tilstande
  # (ogsaa -DryRun): read-only, samme moenster som checks-tjekket herunder.
  # Ingen automatisk `gh pr ready` - det er orkestratorens valg, ikke koeens.
  $draftState = Get-PrDraftState $n
  if ($null -eq $draftState) {
    Write-Host "STOP: kunne ikke afgoere om PR #$n er draft (gh-kaldet fejlede eller gav ulaeseligt JSON) - tjek manuelt med 'gh pr view $n' foer koeen fortsaetter." -ForegroundColor Red
    Exit-Queue 1
  }
  if ($draftState) {
    Write-Host "STOP: PR #$n er draft: koer gh pr ready $n foerst." -ForegroundColor Red
    Exit-Queue 1
  }

  Wait-OutOfMergeTickWindow

  & node (Join-Path $PSScriptRoot 'wave-policy.mjs') assert-merge-allowed --pr "$n" --repo $Repo
  if ($LASTEXITCODE -ne 0) {
    Write-Host "STOP: Aktiv boelgemarkoer: PR #$n overlapper boelgens ownership (eller markoeren/fil-listen kunne ikke laeses) - merge-koeen er blokeret." -ForegroundColor Red
    Exit-Queue 1
  }

  $fresh = Get-PrPlanEntry $n
  if ($fresh.checksExit -ne 0) {
    Write-Host "STOP: PR #$n har ikke groenne paakraevede checks ($($fresh.checksSummary)). Ingen flere PR'er merges." -ForegroundColor Red
    Exit-Queue 1
  }
  # Review #6357 M3: brug den FRISKE fil-klassifikation for selve PR'en.
  if ($fresh.touchesBackend) { $batchWithNext = $false }
  $entryBackend = $entry.touchesBackend -or $fresh.touchesBackend
  $entryRailway = $entry.touchesRailway -or $fresh.touchesRailway

  if ($DryRun) {
    Write-Host "  [dry-run] ville merge nu: gh pr merge $n --squash --delete-branch --admin" -ForegroundColor DarkGray
    if ($entryRailway) { $script:batchRailway = $true }
    if ($entryBackend) {
      Write-Host "  [dry-run] ville derefter vente paa CI (main) + 'Deploy verify' (Railway+smoke) for merge-commit'et." -ForegroundColor DarkGray
      $script:dryBatchSize = 0; $script:batchRailway = $false
    } elseif ($batchWithNext) {
      $script:dryBatchSize++
      Write-Host "  [dry-run] ville merge videre uden at vente (naeste PR roerer heller ikke backend/); CI (main) og evt. Deploy verify ventes efter raekken (maks $MaxBatch)." -ForegroundColor DarkGray
    } elseif ($script:dryBatchSize -gt 0 -and $script:batchRailway) {
      Write-Host "  [dry-run] sidste i raekken: ville vente paa CI (main) + 'Deploy verify' for hele raekken (den udloeser Railway)." -ForegroundColor DarkGray
      $script:dryBatchSize = 0; $script:batchRailway = $false
    } else {
      Write-Host "  [dry-run] ville derefter vente paa CI (main) + mindst $MinWaitMinutesNoBackend min (roerer ikke backend/)." -ForegroundColor DarkGray
      $script:dryBatchSize = 0; $script:batchRailway = $false
    }
    continue
  }

  Write-Host "  Merger: gh pr merge $n --squash --delete-branch --admin"
  & node (Join-Path $PSScriptRoot 'wave-policy.mjs') assert-merge-allowed --pr "$n" --repo $Repo
  if ($LASTEXITCODE -ne 0) {
    Write-Host "STOP: Boelgen har aendret sig siden preflight (overlap med PR #$n): merge er blokeret." -ForegroundColor Red
    Exit-Queue 1
  }
  & node (Join-Path $PSScriptRoot 'wave-policy.mjs') guarded-merge --pr "$n" --repo $Repo
  if ($LASTEXITCODE -ne 0) {
    Write-Host "STOP: Merge af PR #$n fejlede eller boelgelaasen blev afvist." -ForegroundColor Red
    Exit-Queue 1
  }

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
    Write-Host "  [FEJL] Kunne ikke afgoere merge-commit-SHA for PR #$n - STOPPER koeen. #${n}: SHA ukendt, main-CI og deploy er IKKE verificeret for den - tjek main manuelt." -ForegroundColor Red
    # #$n er IKKE med i Exit-Queue's liste: den venter kun paa CI for den
    # sidste KENDTE merge-SHA (raekkens tidligere PR'er), som ikke indeholder #$n.
    Exit-Queue 1
  }
  Write-Host "  Merged som $sha"
  $script:batchMerged += $n
  $script:lastMergedSha = $sha
  if ($entryRailway) { $script:batchRailway = $true }

  if ($batchWithNext) {
    Write-Host "  PR #$n roerer ikke backend/, og det goer naeste PR heller ikke - merger videre og venter efter raekken." -ForegroundColor DarkGray
    continue
  }

  $batchLabel = ($script:batchMerged | ForEach-Object { "#$_" }) -join ", "
  $batchSize = $script:batchMerged.Count
  $ciOk = Wait-ForWorkflowRun -WorkflowFile "ci.yml" -Sha $sha -TimeoutMinutes $CiTimeoutMinutes -Label "CI (main)"
  if (-not $ciOk) {
    Write-Host "STOP: main-CI er ROED efter $batchLabel. Fix main FOER naeste merge i koeen (rod main = stop-alt-fix-foerst). Ved flere PR'er: en af dem (eller samspillet) er aarsagen." -ForegroundColor Red
    exit 1
  }
  $script:batchMerged = @()

  # Deploy-verifikation: altid for backend; og efter en RAEKKE (2+) der har
  # udloest Railway, saa sluttilstanden er verificeret (review #6357 B1).
  if ($entryBackend -or ($batchSize -gt 1 -and $script:batchRailway)) {
    $deployState = Wait-ForDeployVerification -Sha $sha -TimeoutMinutes $DeployVerifyTimeoutMinutes
    if ($deployState -ne 'verified') {
      if ($deployState -eq 'pending') {
        Write-Host "AFVENTER: deploy-verifikation efter $batchLabel er ikke faerdig. Ingen naeste merge; Railway er ikke meldt fejlet." -ForegroundColor Yellow
        exit 75
      }
      Write-Host "STOP: deploy-verifikation efter $batchLabel er $deployState. Ingen naeste merge uden positivt bevis." -ForegroundColor Red
      exit 1
    }
  } else {
    Write-Host "  PR #$n roerer ikke backend/ - venter mindst $MinWaitMinutesNoBackend min foer naeste merge."
    Start-Sleep -Seconds ($MinWaitMinutesNoBackend * 60)
  }
  $script:batchRailway = $false

  Write-Host "  [ok] $batchLabel faerdig - klar til naeste i koeen." -ForegroundColor Green
}

Write-Host ""
if ($DryRun) {
  Write-Host "[dry-run] Hele koeen ($($PrNumbers.Count) PR'er) blev gennemgaaet uden fejl - alle er klar til en rigtig koersel lige nu." -ForegroundColor Green
} else {
  Write-Host "[OK] Hele merge-koeen ($($PrNumbers.Count) PR'er) er merget og verificeret." -ForegroundColor Green
}
