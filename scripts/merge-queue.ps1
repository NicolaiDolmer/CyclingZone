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
#   2. Tjekker at alle PAAKRAEVEDE checks er groenne (`gh pr checks --required`).
#      23/10 (ejer: "een PR ad gangen"): er de ikke groenne endnu, stilles PR'en
#      bagerst een gang, saa klare PR'er merges foerst. Naar den er forrest igen,
#      ventes op til -WaitPendingMinutes; er den bagud for main OG fejler et
#      paakraevet check, opdateres KUN den PR (gh pr update-branch + @codex review).
#      Stadig ikke groen = SKIP (koeen fortsaetter, exit 2 til sidst). Overlap med
#      en koerende boelge = SKIP. Aldrig masseopdatering af alle PR'er: 23/10 fyldte
#      12 samtidige opdateringer Actions-koeen i over en time. -StopOnRedPr = gammel
#      adfaerd (en ikke-groen PR stopper hele koeen). Roed main stopper altid.
#   3. Merger med `gh pr merge <N> --squash --delete-branch --admin`.
#   4. Venter paa at hovedrepoets CI-workflow (ci.yml) er groent for den nye
#      main-HEAD (den commit merges skabte).
#   5. Roerer PR'en backend-PRODUKTIONSKODE (scripts/merge-queue-files.mjs;
#      tests, dev-scripts og test-data taeller ikke, ejer 10/10): venter
#      derudover paa at "Deploy verify" (.github/workflows/deploy-verify.yml -
#      Vercel/Railway-deploy + smoke-test) er groent for samme SHA. Ellers:
#      mindst -MinWaitMinutesNoBackend minutter (default 3). Ejer 10/10 (valg B):
#      op til -MaxBatch PR'er (ogsaa backend) merges i raekke med EEN
#      verifikation efter raekken; roed = STOP, resten koeres med -NoBatch.
#      #6487/#6859: koeen venter kun til jobbet "Deploy live + smoke" i Deploy
#      verify er groent ('released', laest paa JOB-niveau). Cron-beviset koerer
#      i sit eget job bagefter og alarmerer (PR-kommentar + Discord-ops) men
#      stopper ALDRIG koeen (ejer 18/10). Er jobbet "Release checks" i en
#      overdraget koersel endt roed, stopper koeen foer naeste merge.
#      #6859 merge-tog (standard): op til -MaxBatch PR'er (default 5) merges i
#      raekke med EEN verifikation efter toget. Roed = STOP, og koeen peger selv
#      den skyldige PR ud (scripts/merge-queue-train.mjs). -NoBatch = undtagelse.
#   6. Er CI eller Deploy verify roed for den nye HEAD: STOPPER koeen (roed
#      main = stop-alt-fix-foerst, jf. GITHUB_WORKFLOW.md §Hurtige merges)
#      i stedet for at merge videre ovenpaa den.
#   7. #6859 haenger-alarm: staar et vente-trin (CI main, Deploy verify, Release
#      checks) -StallMinutes (15) uden fremskridt, skrives en STALL-linje med
#      aarsag, Discord-ops alarmeres (DISCORD_OPS_WEBHOOK_URL) og koeen stopper
#      (exit 1) i stedet for at vente til timeout.
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
  # traek og fejlen kan stadig peges ud til en lille gruppe). #6859 (ejer
  # 18/10): merge-tog som standard, 3 -> 5; den skyldige peges ud automatisk.
  [int] $MaxBatch = 5,
  # Codex P2 (#6861): saa laenge venter koeen paa en overdraget koersels Release checks
  # foer naeste merge (og ved koeens slutning). Haenger de laengere, stopper koeen.
  [int] $ReleaseChecksWaitMinutes = 15,
  # #6859 (ejer 18/10): haenger-alarm. Staar et trin (CI main, deploy, release
  # checks) saa mange minutter uden fremskridt, skriver koeen en STALL-linje med
  # aarsag, sender Discord-ops-besked (env DISCORD_OPS_WEBHOOK_URL, ellers kun
  # konsol) og stopper i stedet for at vente til timeout.
  # Codex P2 (#6861): over det laengste gyldige enkelt-trin (deploy-vent op til 40 min),
  # saa et sundt trin aldrig stoppes; stadig langt under timeouts (130 min).
  [int] $StallMinutes = 45,
  [string] $Repo = "NicolaiDolmer/CyclingZone",
  # #6318: over deploy-verify.yml's timeout-minutes (100) + oprettelses-slack.
  [int] $DeployVerifyTimeoutMinutes = 140,
  [int] $CiTimeoutMinutes = 25,
  # 23/10 (ejer: "een PR ad gangen"): en PR hvis checks ikke er groenne endnu, stilles
  # bagerst i koeen een gang (klar-foerst). Naar den igen er forrest, ventes hoejst saa
  # mange minutter. Stadig ikke groen = PR'en springes over (SKIP), koeen fortsaetter.
  [int] $WaitPendingMinutes = 40,
  # 23/10: fejler et paakraevet check og er PR'en bagud for main, opdateres KUN den PR
  # (gh pr update-branch) naar den er forrest, Codex bestilles paa det nye hoved, og
  # koeen venter. Aldrig masseopdatering af alle PR'er (det fyldte Actions-koeen 23/10).
  [switch] $NoUpdateBehind,
  # Den gamle adfaerd: en PR der ikke er groen stopper hele koeen.
  [switch] $StopOnRedPr,
  # Ejer 23/10: op til saa mange deploy-PR'er (backend/Railway/Vercel) i eet tog med EEN
  # deploy-verifikation. Migrationer og race-motoren (merge-queue-files.mjs solo) koerer
  # altid alene. Roedt tog = STOP + skyldig PR (merge-queue-train.mjs). 1 = gammel adfaerd.
  [int] $MaxDeployBatch = 3
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
    $leagueJson = & gh pr checks $number --repo $Repo --json name,bucket,startedAt,event
    $leagueExit = $LASTEXITCODE
    try {
      if ($leagueExit -notin @(0, 1, 8)) {
        $checksExit = 1
      } else {
        $allChecks = @(($leagueJson -join "") | ConvertFrom-Json)
        $leagueCode = Get-LeagueCheckExitCode -Checks $allChecks
        # #6654: review-gate (rule 35) stopper koeen ogsaa foer ejeren goer den
        # required. Rod/mangler = stop, afventer = vent (scripts/lib/league-check.ps1).
        $gateCode = Get-ReviewGateCheckExitCode -Checks $allChecks
        $checksExit = $(if ($leagueCode -eq 1 -or $gateCode -eq 1) { 1 } elseif ($leagueCode -eq 8 -or $gateCode -eq 8) { 8 } else { 0 })
        if (@($allChecks | Where-Object { Test-TrustedReviewGateCheck $_ }).Count -eq 0) {
          Write-Host "      (PR #${number}: intet review-gate-check fra pull_request_target - push et commit eller skift en label for at starte det, #6654)" -ForegroundColor DarkYellow
        }
      }
    } catch { $checksExit = 1 }
  }
  if ($checksExit -eq 0) { $checksSummary = "GROEN" }
  elseif ($checksExit -eq 8) { $checksSummary = "AFVENTER" }
  else { $checksSummary = "ROED/mangler" }

  $filesJson = Invoke-GhWithRetry @('pr', 'view', "$number", '--repo', $Repo, '--json', 'files,changedFiles,title,mergeable,isDraft,headRefOid,mergeStateStatus') -TolerateFailure
  $touchesBackend = $false
  # Review #6357: Railway bygger paa ALT undtagen backend/railway.json's
  # watchPatterns-undtagelser (docs/, pr-screens/, superpowers/, .claude/, rod-*.md).
  # "Roerer ikke backend/" er altsaa ikke det samme som "deployer ikke Railway".
  $touchesRailway = $false
  # #6859: kun til at pege den skyldige PR i et merge-tog ud.
  $touchesVercel = $true
  $filesKnown = $false
  $title = "(ukendt)"
  $mergeable = "UNKNOWN"
  $isDraft = $false
  $solo = $true
  $headSha = $null
  $mergeState = "UNKNOWN"
  if ($filesJson) {
    try {
      $parsed = ($filesJson -join "") | ConvertFrom-Json
      $title = $parsed.title
      $mergeable = $parsed.mergeable
      $isDraft = [bool]$parsed.isDraft
      if ($parsed.PSObject.Properties['headRefOid']) { $headSha = [string]$parsed.headRefOid }
      if ($parsed.PSObject.Properties['mergeStateStatus']) { $mergeState = [string]$parsed.mergeStateStatus }
      # Ejer 10/10 (valg B): klassifikationen bor i scripts/merge-queue-files.mjs
      # (node --test). Kun produktionskode er "backend"; tests/dev-scripts/
      # test-data venter ikke paa deploy-verifikation alene.
      # Codex P1 (#6861): `gh pr view --json files` er loftet ved 100 filer og har
      # kun destinationen ved omdoebninger. Den paginerede REST-liste giver alle
      # filer + previous_filename, saa `frontend/x` -> `docs/x` stadig tæller som
      # deploy-paavirkende. Er listen ufuldstaendig -> fail closed (afslutter toget).
      $restRows = Invoke-GhWithRetry @('api', "repos/$Repo/pulls/$number/files", '--paginate', '--jq', '.[] | [.filename, (.previous_filename // "")] | @tsv') -TolerateFailure
      $paths = @()
      $fileCount = 0
      foreach ($row in @($restRows)) {
        if (-not $row) { continue }
        $cols = ([string]$row) -split "`t"
        $fileCount++
        $paths += $cols[0]
        if ($cols.Count -gt 1 -and $cols[1]) { $paths += $cols[1] }
      }
      $changed = 0
      if ($parsed.PSObject.Properties['changedFiles']) { $changed = [int]$parsed.changedFiles }
      $listComplete = ($changed -gt 0) -and ($fileCount -ge $changed)
      $pathsJson = ConvertTo-Json -InputObject $paths -Compress
      $classJson = & node (Join-Path $PSScriptRoot 'merge-queue-files.mjs') $pathsJson
      if ($LASTEXITCODE -eq 0 -and $classJson) {
        $cls = ($classJson -join "") | ConvertFrom-Json
        $touchesBackend = [bool]$cls.touchesBackend
        $touchesRailway = [bool]$cls.touchesRailway
        if ($cls.PSObject.Properties['touchesVercel']) { $touchesVercel = [bool]$cls.touchesVercel }
        if ($cls.PSObject.Properties['solo']) { $solo = [bool]$cls.solo }
        $filesKnown = $listComplete
      }
    } catch {}
  }
  # Ukendt filliste maa aldrig batches stille uden deploy-verifikation.
  if (-not $filesKnown) { $touchesBackend = $true; $touchesRailway = $true; $touchesVercel = $true; $solo = $true }

  [pscustomobject]@{
    number         = $number
    title          = $title
    checksExit     = $checksExit
    checksSummary  = $checksSummary
    touchesBackend = $touchesBackend
    touchesRailway = $touchesRailway
    touchesVercel  = $touchesVercel
    mergeable      = $mergeable
    isDraft        = $isDraft
    headSha        = $headSha
    mergeState     = $mergeState
    solo           = $solo
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

# #4919: etape-tick hver hele time - merg aldrig i HH:57..HH:03 (ren funktion,
# testet i scripts/merge-queue-train.test.mjs).
function Test-InMergeTickWindow([int]$Minute) {
  return ($Minute -ge 57) -or ($Minute -le 3)
}

# #6859: merge-tog som standard. Merger PR nr. $Index (0-baseret) videre uden at
# vente, naar der er en naeste PR og toget (inkl. denne) er under -MaxBatch.
# -NoBatch er undtagelsen: hver PR faar sit eget deploy og sin egen verify.
# Codex P1 (#6861): deploy-verify udleder Vercel/Railway/cron-krav af den
# verificerede SHA's EGEN diff. Et tog maa derfor hoejst indeholde een
# deploy-paavirkende PR, og den skal vaere den sidste: efter en sadan PR
# slutter toget altid, saa tip-SHA'ens diff daekker hele togets deploy-krav.
function Test-MergeWithNext([bool]$NoBatch, [int]$Index, [int]$Count, [int]$TrainSize, [int]$MaxBatch, [bool]$EntryDeploys = $false) {
  return (-not $NoBatch) -and (-not $EntryDeploys) -and ($Index + 1 -lt $Count) -and (($TrainSize + 1) -lt $MaxBatch)
}

function Wait-OutOfMergeTickWindow {
  while ($true) {
    $now = Get-Date
    $minute = $now.Minute
    $inWindow = Test-InMergeTickWindow $minute
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
    [string] $Label,
    # #6859: haenger-alarm (0 = slaaet fra). Sat af kalderen til -StallMinutes.
    [double] $StallMinutes = 0,
    [scriptblock] $Now = { Get-Date },
    [scriptblock] $Pause = { param($Seconds) Start-Sleep -Seconds $Seconds }
  )
  if ($DryRun) {
    Write-Host "  [dry-run] ville vente paa '$Label' ($WorkflowFile) for $Sha (op til $TimeoutMinutes min)." -ForegroundColor DarkGray
    return $true
  }

  $script:workflowRunState = 'pending'
  $deadline = (& $Now).AddMinutes($TimeoutMinutes)
  # #6859: fremskridt = en ny observation (koersel oprettet, status eller et
  # job-/trin-skift). Samme observation i -StallMinutes = STALL.
  $stallSince = & $Now
  $runId = $null
  while ((& $Now) -lt $deadline -and -not $runId) {
    $runsJson = Invoke-GhWithRetry @('run', 'list', '--repo', $Repo, '--workflow', $WorkflowFile, '--branch', 'main', '--limit', '10', '--json', 'databaseId,headSha,status,conclusion') -TolerateFailure
    if ($runsJson) {
      try {
        $runs = ($runsJson -join "") | ConvertFrom-Json
        $match = $runs | Where-Object { $_.headSha -eq $Sha } | Select-Object -First 1
        if ($match) { $runId = $match.databaseId }
      } catch {}
    }
    if (-not $runId) {
      if ($StallMinutes -gt 0 -and ((& $Now) - $stallSince).TotalMinutes -ge $StallMinutes) {
        $script:queueStall = "'$Label': ingen koersel oprettet for $Sha"
        return $false
      }
      Write-Host "  ... venter paa at '$Label'-koerslen for $Sha bliver oprettet ..." -ForegroundColor DarkGray
      & $Pause 15
    }
  }

  if (-not $runId) {
    Write-Host "  [FEJL] Fandt ingen '$Label'-koersel for $Sha inden for $TimeoutMinutes min." -ForegroundColor Red
    return $false
  }

  Write-Host "  Venter paa '$Label' (run $runId) for $Sha ..."
  # 13/10: `gh run watch --exit-status` exiter ogsaa != 0 ved GitHub-API-fejl (HTTP 502),
  # og det blev to gange laest som "main roed" mens koerslen stadig stod queued/groen.
  # Derfor afgoeres udfaldet af koerslens EGEN status/conclusion (med retry), og vi
  # venter videre saa laenge den ikke er completed.
  # #6859: polling i stedet for det blokerende `gh run watch`, saa koeen kan se
  # om koerslen rykker sig (haenger-alarm). Udfaldet afgoeres som foer.
  $ok = $false
  $stallSig = $null
  $stallSince = & $Now
  while ((& $Now) -lt $deadline) {
    $viewJson = Invoke-GhWithRetry @('run', 'view', "$runId", '--repo', $Repo, '--json', 'status,conclusion,jobs') -TolerateFailure
    $run = $null
    if ($viewJson) { try { $run = ($viewJson -join "") | ConvertFrom-Json } catch {} }
    if ($run -and $run.status -eq 'completed') {
      $ok = ($run.conclusion -eq 'success')
      $script:workflowRunState = if ($ok) { 'success' } elseif ($run.conclusion -eq 'failure') { 'failure' } else { 'blocked' }
      break
    }
    $sig = "ulaeselig"
    if ($run) {
      $sig = "$($run.status)"
      try {
        foreach ($j in @($run.jobs)) { $sig += "|$($j.name):$($j.status):$($j.conclusion):$(@($j.steps | Where-Object { $_.status -eq 'completed' }).Count)" }
      } catch {}
    }
    if ($sig -ne $stallSig) { $stallSig = $sig; $stallSince = & $Now }
    elseif ($StallMinutes -gt 0 -and ((& $Now) - $stallSince).TotalMinutes -ge $StallMinutes) {
      $script:queueStall = "'$Label' (run $runId): ingen job- eller trin-skift (status: $(($sig -split '\|')[0]))"
      return $false
    }
    Write-Host "  ... '$Label' (run $runId) er ikke faerdig endnu (status: $(($sig -split '\|')[0])); venter videre ..." -ForegroundColor DarkGray
    & $Pause 20
  }
  if ($ok) {
    Write-Host "  [ok] '$Label' groen for $Sha." -ForegroundColor Green
  } elseif ($script:workflowRunState -eq 'failure') {
    Write-Host "  [FEJL] '$Label' ROED for $Sha (run $runId, completed/failure)." -ForegroundColor Red
  } elseif ($script:workflowRunState -eq 'blocked') {
    Write-Host "  [STOP] '$Label' afsluttet uden success for $Sha (run $runId, conclusion: $($run.conclusion))." -ForegroundColor Yellow
  } else {
    Write-Host "  [VENT] '$Label' endnu ikke verificeret for $Sha (run $runId): timeout efter $TimeoutMinutes min." -ForegroundColor Yellow
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
    [string] $ClassifierPath = (Join-Path $PSScriptRoot 'ci/deploy-verification-state.mjs'),
    # #6859: haenger-alarm (0 = slaaet fra); 'stalled' + $script:queueStall.
    [double] $StallMinutes = 0
  )
  if ($DryRun) { return 'pending' }
  $deadline = (& $Now).AddMinutes($TimeoutMinutes)
  $stallSig = $null
  $stallSince = & $Now
  $runId = $null
  $minimumAttempt = 1
  $reruns = 0
  $lastState = 'unknown'
  $settleReads = 0
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
        if (-not $runId) {
          if ($StallMinutes -gt 0 -and ((& $Now) - $stallSince).TotalMinutes -ge $StallMinutes) {
            $script:queueStall = "Deploy verify: ingen koersel oprettet for $Sha"
            return 'stalled'
          }
          & $Pause 15; continue
        }
      }
      $runJson = Invoke-GhWithRetry @('api', "repos/$Repo/actions/runs/$runId") -TolerateFailure
      if (-not $runJson) { return 'unknown' }
      try { $run = ($runJson -join "") | ConvertFrom-Json }
      catch { return 'unknown' }
      if ($run.head_sha -ne $Sha -or -not $run.run_attempt) { return 'unknown' }
      # #6859: ingen genvej paa koerslens samlede conclusion - den er ogsaa roed
      # naar kun det ikke-blokerende cron-bevis fejlede. Release-jobbets egen
      # conclusion afgoer (scripts/ci/deploy-verification-state.mjs).
      $jobsJson = if ($run.run_attempt -ge $minimumAttempt) {
        Invoke-GhWithRetry @('api', "repos/$Repo/actions/runs/$runId/attempts/$($run.run_attempt)/jobs?per_page=100") -TolerateFailure
      } else { '{"jobs":[]}' }
      if (-not $jobsJson) { return 'unknown' }
      [IO.File]::WriteAllText($runFile, ($runJson -join ""))
      [IO.File]::WriteAllText($jobsFile, ($jobsJson -join ""))
      $state = (& node $ClassifierPath $runFile $jobsFile $Sha $minimumAttempt | Out-String).Trim()
      $lastState = $state
      $script:lastDeployEvidence = @(($runJson -join ""), ($jobsJson -join ""))
      if ($state -eq 'released') {
        Write-Host "  Deploy live + smoke groen (run $runId, attempt $($run.run_attempt)). Cron-beviset koerer i sit eget job og alarmerer selv (PR-kommentar + Discord-ops); koeen venter ikke paa det." -ForegroundColor Green
        $script:handedOffRuns = @($script:handedOffRuns) + $runId
        return 'released'
      }
      if ($state -eq 'deferred') {
        Write-Host "  AFVENTER CHECK-IN for lange kadencer (run $runId, attempt $($run.run_attempt)); se job + sidste check-in i workflow-summary. Ingen automatisk genkoersel." -ForegroundColor Yellow
        return 'deferred'
      }
      # GitHub kan melde et job 'completed', før job-trinnene er skrevet færdigt.
      # Et 'unknown' lige efter afslutningen er derfor ofte forbigaaende (8/10:
      # #6353 stoppede koeen, samme data gav 'deferred' sekunder senere). Laes
      # igen hoejst 3 gange, foer 'unknown' faar lov at stoppe koeen. #6859:
      # release-jobbet slutter mens koerslen stadig koerer (cron-bevis), saa
      # det gaelder uanset koerslens status.
      if ($state -eq 'unknown' -and $settleReads -lt 3) {
        $settleReads++
        Write-Host "  Deploy verify: job-data for run $runId er endnu ikke faerdigskrevet; laeser igen om 15 s ($settleReads/3)." -ForegroundColor DarkGray
        & $Pause 15
        continue
      }
      if ($state -eq 'verified' -or $state -eq 'failed' -or $state -eq 'unknown') { return $state }
      # #6859: fremskridt = nyt attempt, ny koersels-status, ny tilstand eller et
      # job-/trin-skift. Samme observation i -StallMinutes = STALL, ikke timeout.
      $sig = "$($run.run_attempt)|$($run.status)|$state"
      try {
        foreach ($j in @((($jobsJson -join "") | ConvertFrom-Json).jobs)) { $sig += "|$($j.name):$($j.status):$($j.conclusion):$(@($j.steps | Where-Object { $_.status -eq 'completed' }).Count)" }
      } catch {}
      if ($sig -ne $stallSig) { $stallSig = $sig; $stallSince = & $Now }
      elseif ($StallMinutes -gt 0 -and ((& $Now) - $stallSince).TotalMinutes -ge $StallMinutes) {
        $script:queueStall = "Deploy verify (run $runId, attempt $($run.run_attempt)): '$state' uden job- eller trin-skift"
        return 'stalled'
      }
      if ($state -eq 'pending') {
        if ($reruns -ge $MaxReruns) { return 'pending' }
        # #6859: release-jobbet er faerdigt, men koerslen (de skippede
        # efterfoelgende jobs) kan stadig vaere i gang; en rerun af en koerende
        # koersel afvises af GitHub. Vent til den er completed.
        if ($run.status -ne 'completed') { & $Pause 15; continue }
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

# #6318: 'deferred' = korte cron-kadencer (<= 30 min) bevist, lange afventer
# check-in. Det vises, men stopper ikke koeen. Alt andet end verified/deferred/
# pending er fail-closed stop.
# #6487: 'released' = deploy + smoke groen, cron-beviset overladt til koerslen.
# #6859 (ejer 18/10): Discord-ops-besked ved STALL. Samme moenster som
# deploy-verify.yml's report-job: DISCORD_OPS_WEBHOOK_URL, ellers kun konsol.
# Webhook-URL'en skrives aldrig ud. En fejlet POST stopper aldrig noget.
function Send-QueueStallAlarm {
  param(
    [string] $Message,
    [scriptblock] $Post = { param($Uri, $Body) Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json' -Body $Body -TimeoutSec 15 | Out-Null }
  )
  $hook = $env:DISCORD_OPS_WEBHOOK_URL
  if (-not $hook) {
    Write-Host "  (DISCORD_OPS_WEBHOOK_URL er ikke sat: STALL er kun meldt her i konsollen.)" -ForegroundColor DarkYellow
    return 'console'
  }
  try {
    & $Post $hook (ConvertTo-Json -InputObject @{ content = $Message } -Compress)
    Write-Host "  Discord-ops er alarmeret om STALL." -ForegroundColor DarkYellow
    return 'sent'
  } catch {
    Write-Host "  (Discord-ops-alarmen kunne ikke sendes; STALL er kun meldt i konsollen.)" -ForegroundColor DarkYellow
    return 'failed'
  }
}

# #6859: STALL-linje + alarm + stop. Kaldes kun fra hovedforloebet, naar en
# vente-funktion har sat $script:queueStall. Exit 1 = stop (som roed main).
function Stop-QueueStall {
  $merged = (@($script:batchMerged) | ForEach-Object { "#$_" }) -join ', '
  Write-Host "STALL: $($script:queueStall). Intet fremskridt i $StallMinutes min - koeen stopper i stedet for at vente til timeout." -ForegroundColor Red
  if ($merged) { Write-Host "  Allerede merget uden faerdig verifikation: $merged. Tjek koerslen foer naeste merge." -ForegroundColor Red }
  $note = if ($merged) { " Merget uden faerdig verifikation: $merged." } else { '' }
  Send-QueueStallAlarm -Message ("Merge-koe STALL: $($script:queueStall). Intet fremskridt i $StallMinutes min; koeen er stoppet.$note") | Out-Null
  exit 1
}

function Get-DeployGateAction([string]$State) {
  if ($State -eq 'verified' -or $State -eq 'deferred' -or $State -eq 'released') { return 'continue' }
  if ($State -eq 'pending') { return 'pending' }
  return 'stop'
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
$script:batchBackend = $false
# Codex P1 (#6861 runde 3): ogsaa Vercel-kravet afgoer deploy-verifikationen (AGENTS regel 20).
$script:batchVercel = $false
$script:lastMergedSha = $null
$script:dryBatchSize = 0
$script:batchShas = @()
$script:handedOffRuns = @()
# #6859: togets PR'er (nummer, merge-SHA, fil-klassifikation) og CI pr. SHA.
$script:trainEntries = @()
$script:ciResults = @{}
$script:lastDeployEvidence = $null
# #6859: aarsagen naar et trin haenger (sat af vente-funktionerne, se Stop-QueueStall).
$script:queueStall = $null
if ($NoBatch) {
  Write-Host "  -NoBatch: hver PR faar sit eget deploy og sin egen verify (undtagelsen; standard er merge-tog, #6859)." -ForegroundColor DarkYellow
}

# #6487/#6859: koersler koeen allerede er frigivet paa. Roede "Release checks"
# stopper koeen foer naeste merge; koerende checks venter vi ikke paa (koerslen
# kommenterer og alarmerer selv). Et roedt cron-bevis stopper ALDRIG koeen (ejer
# 18/10): det alarmerer via report-jobbet. Afgoeres paa JOB-niveau af
# scripts/ci/deploy-verification-state.mjs --handed-off; ulaeselig = stop.
# Returnerer en liste af fejlede run-id'er; tom liste = fortsaet.
function Get-FailedHandedOffRuns {
  param(
    [string] $ClassifierPath = (Join-Path $PSScriptRoot 'ci/deploy-verification-state.mjs'),
    [double] $WaitMinutes = 0,
    [int] $PollSeconds = 20,
    # #6859: haenger-alarm (0 = slaaet fra). Koerende checks uden job-/trin-skift
    # i saa mange minutter = STALL ($script:queueStall), ikke stille ventetid.
    # Default = scriptets -StallMinutes (uden det, fx udtrukket i en test: 0).
    [double] $StallMinutes = $script:StallMinutes
  )
  $failed = @()
  $deadline = (Get-Date).AddMinutes($WaitMinutes)
  foreach ($id in @($script:handedOffRuns)) {
   $stallSig = $null
   $stallSince = Get-Date
   while ($true) {
    $json = Invoke-GhWithRetry @('api', "repos/$Repo/actions/runs/$id") -TolerateFailure
    if (-not $json) { $failed += "$id (ulaeselig)"; break }
    try { $r = ($json -join "") | ConvertFrom-Json } catch { $failed += "$id (ulaeselig)"; break }
    $jobsJson = Invoke-GhWithRetry @('api', "repos/$Repo/actions/runs/$id/attempts/$($r.run_attempt)/jobs?per_page=100") -TolerateFailure
    if (-not $jobsJson) { $failed += "$id (ulaeselig)"; break }
    $runFile = [IO.Path]::GetTempFileName()
    $jobsFile = [IO.Path]::GetTempFileName()
    try {
      [IO.File]::WriteAllText($runFile, ($json -join ""))
      [IO.File]::WriteAllText($jobsFile, ($jobsJson -join ""))
      $verdict = (& node $ClassifierPath --handed-off $runFile $jobsFile | Out-String).Trim()
    } finally {
      Remove-Item -LiteralPath $runFile, $jobsFile -ErrorAction SilentlyContinue
    }
    # Codex P2 (#6861): koerende Release checks er IKKE groenne. Vent paa dem op
    # til -WaitMinutes; haenger de stadig, er det et stop (aldrig stille gennem).
    if ($verdict -eq 'running') {
      if ($WaitMinutes -le 0) { break }
      $sig = "$($r.run_attempt)|$($r.status)"
      try {
        foreach ($j in @((($jobsJson -join "") | ConvertFrom-Json).jobs)) { $sig += "|$($j.name):$($j.status):$($j.conclusion):$(@($j.steps | Where-Object { $_.status -eq 'completed' }).Count)" }
      } catch {}
      if ($sig -ne $stallSig) { $stallSig = $sig; $stallSince = Get-Date }
      elseif ($StallMinutes -gt 0 -and ((Get-Date) - $stallSince).TotalMinutes -ge $StallMinutes) {
        $script:queueStall = "Release checks (run $id): ingen job- eller trin-skift"
        $failed += "$id (STALL: release checks uden fremskridt i $StallMinutes min)"
        break
      }
      if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds $PollSeconds; continue }
      $failed += "$id (release checks ikke faerdige efter $WaitMinutes min)"
      break
    }
    if ($verdict -ne 'ok') { $failed += "$id ($verdict)" }
    break
   }
  }
  return $failed
}

# #6859: peg den skyldige PR i et roedt merge-tog ud (scripts/merge-queue-train.mjs).
# Kun information og et stop - ingen revert eller deploy af mellemtilstande (et
# prod-indgreb kraever ejer-go). Fejler klassifikationen, vises hele toget.
function Get-TrainFailedTarget {
  param([string] $ClassifierPath = (Join-Path $PSScriptRoot 'ci/deploy-verification-state.mjs'))
  if (-not $script:lastDeployEvidence -or @($script:lastDeployEvidence).Count -ne 2) { return 'unknown' }
  $runFile = [IO.Path]::GetTempFileName()
  $jobsFile = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($runFile, $script:lastDeployEvidence[0])
    [IO.File]::WriteAllText($jobsFile, $script:lastDeployEvidence[1])
    $target = (& node $ClassifierPath --failed-target $runFile $jobsFile | Out-String).Trim()
    if ($target -in @('vercel', 'railway', 'smoke')) { return $target }
    return 'unknown'
  } catch { return 'unknown' }
  finally { Remove-Item -LiteralPath $runFile, $jobsFile -ErrorAction SilentlyContinue }
}

function Write-TrainCulprit([string]$Failure) {
  $entries = @($script:trainEntries)
  if ($entries.Count -eq 0) { return }
  $prs = @($entries | ForEach-Object {
    $ok = $null
    if ($script:ciResults.ContainsKey($_.sha)) { $ok = $script:ciResults[$_.sha] }
    [ordered]@{ number = $_.number; ciOk = $ok; touchesBackend = $_.touchesBackend; touchesRailway = $_.touchesRailway; touchesVercel = $_.touchesVercel }
  })
  $inputJson = ConvertTo-Json -InputObject ([ordered]@{ failure = $Failure; prs = $prs }) -Depth 4 -Compress
  $result = $null
  try {
    $out = & node (Join-Path $PSScriptRoot 'merge-queue-train.mjs') culprit $inputJson
    if ($LASTEXITCODE -eq 0 -and $out) { $result = ($out -join "") | ConvertFrom-Json }
  } catch { $result = $null }
  if (-not $result) {
    Write-Host ("  Skyldig PR: kunne ikke afgoeres. Toget: {0}." -f (($entries | ForEach-Object { "#$($_.number)" }) -join ', ')) -ForegroundColor Red
    return
  }
  $suspects = (@($result.suspects) | ForEach-Object { "#$_" }) -join ', '
  if ($null -ne $result.culprit) {
    Write-Host "  Skyldig PR: #$($result.culprit) ($($result.reason)). Fix eller revert den foer naeste merge; resten af koeen merges ikke." -ForegroundColor Red
  } else {
    Write-Host "  Skyldig PR: ikke entydig ($($result.reason)). Mistaenkte i merge-raekkefoelge: $suspects. Ingen automatisk revert (prod-indgreb = ejer-go)." -ForegroundColor Red
  }
}

# Review #6357 opus-fund 1: ci.yml's sti-filtrerede jobs (fx marketing-lint-build)
# koerer paa push kun for det enkelte commits egen diff. Venter vi kun paa den
# SIDSTE merge-SHA, kan en tidligere PR i raekken have roed CI uden at koeen ser
# det. Vent derfor paa ci.yml for HVER merge-SHA i raekken (push-koersler paa
# main annulleres ikke, saa det koster stort set ingen ekstra tid).
function Wait-BatchCi {
  $allOk = $true
  $script:ciUnverified = $false
  foreach ($s in $script:batchShas) {
    $ok = Wait-ForWorkflowRun -WorkflowFile "ci.yml" -Sha $s -TimeoutMinutes $CiTimeoutMinutes -Label "CI (main) $($s.Substring(0, [Math]::Min(8, $s.Length)))" -StallMinutes $StallMinutes
    # #6859: en haengende CI er ikke roed - intet CI-resultat, kalderen stopper (STALL).
    if ($script:queueStall) { return $false }
    # #6859: resultat pr. SHA, saa et roedt tog kan pege den skyldige PR ud.
    if ($script:workflowRunState -in @('success', 'failure')) {
      $script:ciResults[$s] = [bool]$ok
    } else {
      # #6081: timeout/annulleret/ukendt er ingen observeret CI-fejl.
      $script:ciResults[$s] = $null
      $script:ciUnverified = $true
    }
    if (-not $ok) { $allOk = $false }
  }
  return $allOk
}

# Review #6357 M1: stopper koeen midt i en raekke, er de allerede mergede PR'er
# aldrig CI-verificeret. Vent paa CI (main) for alle raekkens merge-SHA'er og
# sig det tydeligt, FOER koeen afsluttes.
function Exit-Queue([int]$Code) {
  if ($script:batchMerged.Count -gt 0 -and $script:lastMergedSha) {
    $label = ($script:batchMerged | ForEach-Object { "#$_" }) -join ", "
    # Codex P1 #7104: med deploy-tog kan et aabent tog indeholde Railway/Vercel-aendringer.
    # Exit lukker det derfor med fuld CI + deploy-verifikation (Close-OpenTrain exit'er selv ved fejl).
    Write-Host "  Koeen stopper midt i et tog: $label er allerede merget. Lukker toget (CI + deploy-verifikation) foer exit." -ForegroundColor Yellow
    Close-OpenTrain
  }
  exit $Code
}

# 23/10: klar-foerst + een opdatering ad gangen (se -WaitPendingMinutes/-NoUpdateBehind).
$script:deferred = @{}
$script:trainDeploys = 0
$script:updated = @{}
$script:skipped = @()

function Test-RequiredCheckFailed([int]$number) {
  # Et AFSLUTTET roedt paakraevet check (ikke afventende eller manglende).
  $json = Invoke-GhWithRetry @('pr', 'checks', "$number", '--repo', $Repo, '--required', '--json', 'name,bucket') -TolerateFailure
  if (-not $json) { return $false }
  try { return [bool](@((($json -join "") | ConvertFrom-Json) | Where-Object { $_.bucket -eq 'fail' }).Count -gt 0) } catch { return $false }
}

function Invoke-PrUpdateBehind([int]$number) {
  # Opdaterer EEN PR med main og bestiller Codex paa det nye hoved. Returnerer $true hvis opdateret.
  Write-Host "  PR #$number fejler et paakraevet check og er bagud for main: opdaterer kun denne PR med main." -ForegroundColor Yellow
  $out = Invoke-GhWithRetry @('pr', 'update-branch', "$number", '--repo', $Repo) -TolerateFailure
  if (-not $out -and $LASTEXITCODE -ne 0) { return $false }
  Invoke-GhWithRetry @('pr', 'comment', "$number", '--repo', $Repo, '--body', '@codex review') -TolerateFailure | Out-Null
  $script:updated["$number"] = $true
  return $true
}

function Wait-PrGreen([int]$number, [int]$Minutes, [scriptblock]$Now = { Get-Date }, [scriptblock]$Pause = { param($s) Start-Sleep -Seconds $s }) {
  # Poller til checks er groenne eller tiden er gaaet. Returnerer den sidste plan-entry.
  # Uret og pausen injiceres (hard rule 16, Codex P1 #7104), saa timeout kan testes.
  $deadline = (& $Now).AddMinutes($Minutes)
  $last = Get-PrPlanEntry $number
  while ($last.checksExit -ne 0 -and (& $Now) -lt $deadline) {
    if (-not $NoUpdateBehind -and -not $script:updated.ContainsKey("$number") -and $last.mergeState -eq 'BEHIND' -and (Test-RequiredCheckFailed $number)) {
      [void](Invoke-PrUpdateBehind $number)
    }
    Write-Host "  venter paa PR #$number ($($last.checksSummary)), hoejst til $($deadline.ToString('HH:mm'))..." -ForegroundColor DarkGray
    & $Pause 60
    $last = Get-PrPlanEntry $number
  }
  return $last
}

# 23/10 (Codex P1 #7104): lukker det aabne tog: CI (main) for togets SHA'er + deploy-
# verifikation hvis toget deployer. Bruges naar toget slutter normalt, foer en solo-PR
# eller en PR der ikke daekker togets deploy-maal merges, og naar koeen slutter med et
# aabent tog (fx fordi sidste kandidat blev sprunget over). Fejl = exit som foer.
function Close-OpenTrain {
  $batchLabel = ($script:batchMerged | ForEach-Object { "#$_" }) -join ", "
  $batchSize = $script:batchMerged.Count
  $sha = $script:lastMergedSha
  $ciOk = Wait-BatchCi
  if (-not $ciOk) {
    if ($script:queueStall) { Stop-QueueStall }
    if ($script:ciUnverified -and -not ($script:ciResults.Values -contains $false)) {
      Write-Host "STOP: main-CI er endnu ikke verificeret groen efter $batchLabel. Kontroller koerslens status foer naeste merge." -ForegroundColor Yellow
      exit 1
    }
    Write-Host "STOP: main-CI er ROED efter $batchLabel. Fix main FOER naeste merge i koeen (rod main = stop-alt-fix-foerst)." -ForegroundColor Red
    Write-TrainCulprit 'ci'
    exit 1
  }
  $script:batchMerged = @()
  $script:batchShas = @()
  $script:trainDeploys = 0

  # Deploy-verifikation: altid naar toget udloeser et deploy (backend, Railway
  # eller Vercel/byggeinput, AGENTS regel 20). Codex P1 (#6861): et
  # deploy-paavirkende PR afslutter toget, saa "raekke paa 2+ med Railway"
  # (review #6357 B1) ville springe enkelt-PR-deploys over.
  if ($script:batchBackend -or $script:batchRailway -or $script:batchVercel) {
    $deployState = Wait-ForDeployVerification -Sha $sha -TimeoutMinutes $DeployVerifyTimeoutMinutes -StallMinutes $StallMinutes
    if ($deployState -eq 'stalled') { Stop-QueueStall }
    $gate = Get-DeployGateAction $deployState
    if ($deployState -eq 'deferred') {
      Write-Host "  AFVENTER CHECK-IN efter ${batchLabel}: jobs med lang kadence (> 30 min) er ikke bevist endnu (se deploy-verify-summary). Korte kadencer er bevist; koeen fortsaetter." -ForegroundColor Yellow
    }
    if ($gate -eq 'pending') {
      Write-Host "AFVENTER: deploy-verifikation efter $batchLabel er ikke faerdig. Ingen naeste merge; Railway er ikke meldt fejlet." -ForegroundColor Yellow
      exit 75
    }
    if ($gate -ne 'continue') {
      Write-Host "STOP: deploy-verifikation efter $batchLabel er $deployState. Ingen naeste merge uden positivt bevis." -ForegroundColor Red
      $failure = if ($deployState -eq 'failed') { Get-TrainFailedTarget } else { 'unknown' }
      Write-TrainCulprit $failure
      exit 1
    }
  } else {
    Write-Host "  $batchLabel roerer ikke backend/ - venter mindst $MinWaitMinutesNoBackend min foer naeste merge."
    Start-Sleep -Seconds ($MinWaitMinutesNoBackend * 60)
  }
  $script:batchRailway = $false
  $script:batchBackend = $false
  $script:batchVercel = $false
  $script:trainEntries = @()

  Write-Host "  [ok] $batchLabel faerdig - klar til naeste i koeen." -ForegroundColor Green
}

for ($idx = 0; $idx -lt $plan.Count; $idx++) {
  $entry = $plan[$idx]
  $n = $entry.number
  # Batch (ejer 8/10, review #6357): naeste PR roerer heller ikke backend/ og
  # raekken er under -MaxBatch -> merge med det samme og vent paa CI (main) +
  # evt. deploy-verifikation EEN gang efter raekken.
  # Ejer 10/10 (valg B): ogsaa backend-PR'er merges i raekker paa op til
  # -MaxBatch med EEN CI- og deploy-verifikation efter raekken. Roed efter en
  # raekke = STOP, og raekken koeres igen med -NoBatch for at finde den skyldige.
  $batchWithNext = Test-MergeWithNext ([bool]$NoBatch) $idx $plan.Count ([Math]::Max($script:batchMerged.Count, $script:dryBatchSize)) $MaxBatch
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
    # 23/10: overlap med en koerende boelge er PR-specifikt. Spring PR'en over i stedet
    # for at stoppe hele koeen (-StopOnRedPr = gammel adfaerd).
    if (-not $StopOnRedPr -and -not $DryRun) {
      Write-Host "SKIP: PR #$n overlapper en koerende boelges ownership. Springes over; koeen fortsaetter." -ForegroundColor Yellow
      $script:skipped += $n
      continue
    }
    Write-Host "STOP: Aktiv boelgemarkoer: PR #$n overlapper boelgens ownership (eller markoeren/fil-listen kunne ikke laeses) - merge-koeen er blokeret." -ForegroundColor Red
    Exit-Queue 1
  }

  $fresh = Get-PrPlanEntry $n
  if ($fresh.checksExit -ne 0 -and -not $StopOnRedPr -and -not $DryRun) {
    # 23/10 klar-foerst: ikke groen endnu -> bagerst i koeen een gang, saa klare PR'er
    # merges imens. Andet besoeg: vent (og opdater kun denne PR hvis den er bagud og roed).
    if (-not $script:deferred.ContainsKey("$n") -and ($idx + 1) -lt $plan.Count) {
      $script:deferred["$n"] = $true
      Write-Host "  PR #$n er ikke groen endnu ($($fresh.checksSummary)): stilles bagerst, klare PR'er foerst." -ForegroundColor DarkYellow
      $plan += $entry
      continue
    }
    $fresh = Wait-PrGreen $n $WaitPendingMinutes
    if ($fresh.checksExit -ne 0) {
      Write-Host "SKIP: PR #$n er ikke groen efter $WaitPendingMinutes min ($($fresh.checksSummary)). Springes over; koeen fortsaetter." -ForegroundColor Red
      $script:skipped += $n
      continue
    }
  }
  if ($fresh.checksExit -ne 0) {
    Write-Host "STOP: PR #$n har ikke groenne paakraevede checks ($($fresh.checksSummary)). Ingen flere PR'er merges." -ForegroundColor Red
    Exit-Queue 1
  }
  # Review #6357 M3: brug den FRISKE fil-klassifikation for selve PR'en.
  $entryBackend = $entry.touchesBackend -or $fresh.touchesBackend
  $entryRailway = $entry.touchesRailway -or $fresh.touchesRailway
  $entryVercel = [bool]($entry.touchesVercel -or $fresh.touchesVercel)
  # Ejer 23/10: deploy-PR'er koerer i tog paa op til -MaxDeployBatch (foer #6861: altid alene).
  # En solo-PR (migration/motor) merges aldrig ind i et aabent tog og afslutter selv toget.
  $entryDeploys = [bool]($entryBackend -or $entryRailway -or $entryVercel)
  $entrySolo = [bool]($entry.solo -or $fresh.solo)
  # Codex P1 #7104: deploy-verify.yml udleder NEED_VERCEL/NEED_RAILWAY af den SIDSTE merge-SHA's
  # diff. Daekker denne PR ikke togets samlede deploy-maal, lukkes toget foerst. En solo-PR
  # (migration/motor) lukker ogsaa et aabent tog foer den merges, saa den altid koerer alene.
  $coversTrain = ((-not $script:batchVercel) -or $entryVercel) -and ((-not ($script:batchRailway -or $script:batchBackend)) -or $entryRailway)
  if (-not $DryRun -and $script:batchMerged.Count -gt 0 -and ($entrySolo -or -not $coversTrain)) {
    Write-Host "  PR #$n $(if ($entrySolo) { 'koerer alene (migration/motor)' } else { 'daekker ikke togets deploy-maal' }): lukker det aabne tog foerst." -ForegroundColor DarkYellow
    Close-OpenTrain
  }
  $nextSolo = (($idx + 1) -lt $plan.Count) -and [bool]$plan[$idx + 1].solo
  if ($entrySolo -or $nextSolo -or ($entryDeploys -and ($script:trainDeploys + 1) -ge $MaxDeployBatch)) { $batchWithNext = $false }
  if ($entryDeploys) { $script:trainDeploys++ }

  if ($DryRun) {
    Write-Host "  [dry-run] ville merge nu: gh pr merge $n --squash --delete-branch --admin" -ForegroundColor DarkGray
    if ($entryRailway) { $script:batchRailway = $true }
    if ($entryBackend) { $script:batchBackend = $true }
    if ($entryVercel) { $script:batchVercel = $true }
    if ($batchWithNext) {
      $script:dryBatchSize++
      Write-Host "  [dry-run] ville merge videre uden at vente; CI (main) og evt. Deploy verify ventes EEN gang efter raekken (maks $MaxBatch)." -ForegroundColor DarkGray
    } elseif ($script:batchBackend -or $script:batchRailway -or $script:batchVercel) {
      Write-Host "  [dry-run] sidste i raekken: ville vente paa CI (main) + 'Deploy verify' for hele raekken." -ForegroundColor DarkGray
      $script:dryBatchSize = 0; $script:trainDeploys = 0; $script:batchRailway = $false; $script:batchBackend = $false; $script:batchVercel = $false
    } else {
      Write-Host "  [dry-run] ville derefter vente paa CI (main) + mindst $MinWaitMinutesNoBackend min (roerer ikke backend/)." -ForegroundColor DarkGray
      $script:dryBatchSize = 0; $script:trainDeploys = 0; $script:batchRailway = $false; $script:batchVercel = $false
    }
    continue
  }

  $failedRuns = @(Get-FailedHandedOffRuns -WaitMinutes $ReleaseChecksWaitMinutes)
  if ($script:queueStall) { Stop-QueueStall }
  if ($failedRuns.Count -gt 0) {
    Write-Host "STOP: en tidligere overdraget Deploy verify-koersel er ikke groen: $($failedRuns -join ', '). Se koerslen og PR-kommentaren foer naeste merge." -ForegroundColor Red
    Exit-Queue 1
  }
  # Codex P2 (#6861 runde 3): ventetiden paa release checks kan flytte merget
  # ind i etape-tick-vinduet. #4919 gaelder lige foer selve merget.
  Wait-OutOfMergeTickWindow
  # Codex P1 (#6861): ventetiderne ovenfor kan vare minutter. Er der pushet et
  # nyt commit imens, beskriver $fresh ikke laengere det hoved der merges (og
  # merget sker med --admin). Genlaes checks og hoved lige foer merget.
  $recheck = Get-PrPlanEntry $n
  if ($recheck.checksExit -ne 0 -or -not $recheck.headSha -or $recheck.headSha -ne $fresh.headSha) {
    Write-Host "STOP: PR #$n har aendret sig under ventetiden (hoved $($fresh.headSha) -> $($recheck.headSha), checks: $($recheck.checksSummary)). Koer koeen igen, naar det nye hoved er groent." -ForegroundColor Red
    Exit-Queue 1
  }
  Write-Host "  Merger: gh pr merge $n --squash --delete-branch --admin"
  & node (Join-Path $PSScriptRoot 'wave-policy.mjs') assert-merge-allowed --pr "$n" --repo $Repo
  if ($LASTEXITCODE -ne 0) {
    Write-Host "STOP: Boelgen har aendret sig siden preflight (overlap med PR #$n): merge er blokeret." -ForegroundColor Red
    Exit-Queue 1
  }
  # #6861 (Codex P1): merge laast til det hoved, der netop er genvalideret.
  & node (Join-Path $PSScriptRoot 'wave-policy.mjs') guarded-merge --pr "$n" --repo $Repo --head $recheck.headSha
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
  $script:batchShas += $sha
  $script:trainEntries += [pscustomobject]@{ number = $n; sha = $sha; touchesBackend = [bool]$entryBackend; touchesRailway = [bool]$entryRailway; touchesVercel = [bool]($entry.touchesVercel -or $fresh.touchesVercel) }
  if ($entryRailway) { $script:batchRailway = $true }
  if ($entryBackend) { $script:batchBackend = $true }
  if ($entryVercel) { $script:batchVercel = $true }

  if ($batchWithNext) {
    Write-Host "  PR #$n merget - merger videre og verificerer EEN gang efter raekken (maks $MaxBatch)." -ForegroundColor DarkGray
    continue
  }

  Close-OpenTrain
}

# 23/10: blev sidste PR i et tog sprunget over, er togets merges endnu ikke verificeret.
# Codex P1 #7104: samme lukning (CI + deploy-verifikation) som et normalt togslut.
if (-not $DryRun -and $script:batchMerged.Count -gt 0) { Close-OpenTrain }

Write-Host ""
if ($script:skipped.Count -gt 0) {
  Write-Host "SPRUNGET OVER (ikke groenne): $(($script:skipped | ForEach-Object { "#$_" }) -join ', '). Koer dem igen naar de er groenne." -ForegroundColor Yellow
}
if ($DryRun) {
  Write-Host "[dry-run] Hele koeen ($($PrNumbers.Count) PR'er) blev gennemgaaet uden fejl - alle er klar til en rigtig koersel lige nu." -ForegroundColor Green
} else {
  $finalFailed = @(Get-FailedHandedOffRuns -WaitMinutes $ReleaseChecksWaitMinutes)
  if ($script:queueStall) { Stop-QueueStall }
  if ($finalFailed.Count -gt 0) {
    Write-Host "STOP: Release checks efter sidste merge er ikke groenne: $($finalFailed -join ', '). Se koerslen foer naeste merge-koe." -ForegroundColor Red
    exit 1
  }
  if ($script:skipped.Count -gt 0) {
    Write-Host "[DELVIS] $($PrNumbers.Count - $script:skipped.Count) af $($PrNumbers.Count) PR'er er merget og verificeret." -ForegroundColor Yellow
    exit 2
  }
  Write-Host "[OK] Hele merge-koeen ($($PrNumbers.Count) PR'er) er merget og verificeret." -ForegroundColor Green
  foreach ($id in @($script:handedOffRuns)) {
    Write-Host "  Cron-bevis koerer videre i https://github.com/$Repo/actions/runs/$id (kommenterer paa PR'en naar det er faerdigt; roedt = Discord-ops-alarm, intet stop)." -ForegroundColor DarkGray
  }
}
