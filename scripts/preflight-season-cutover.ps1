# preflight-season-cutover.ps1
#
# GO/NO-GO-gate for et saesonskifte (default S2 -> S3, 23/8/2026). Moenster laant fra
# scripts/preflight-night-wave.ps1: [ok]/[warn]/[NO-GO] pr. check + samlet GO/NO-GO,
# JSON-state til .codex.local/. FORSKELLEN: dette script kan IKKE spoerge prod-DB'en
# selv (READ-ONLY-mandat, ingen service-role-secrets i scriptet) -- prod-tilstand
# verificeres i stedet ved at scriptet UDSKRIVER de praecise SELECT-statements en
# operatoer koerer via Supabase MCP (execute_sql) lige foer cutover. Det scriptet KAN
# verificere maskinelt: kode-tilstedevaerelse, migrationer, unit-tests for hele
# saesonskifte-kaeden, og live GitHub-issue-state for kendte aabne risici.
#
# Kaeden der daekkes (kilder verificeret i backend/lib/ 3-4/8/2026):
#   - fatigue-reset            backend/lib/seasonFatigueReset.js       (#2910)
#   - form-reset / decay       backend/lib/seasonFormReset.js          (#3232)
#   - MANAGER_SETUP_REGISTRY   backend/lib/seasonCarryOver.js          (#2916)
#   - honours-tildeling        backend/scripts/backfillSeasonAchievements.js (#2917/#2863)
#   - wage-mode                backend/lib/wageDeductionConfig.js      (#2840)
#   - pension (afsluttet-sæsons alder) backend/lib/riderProgression.js + riderSeasonAge.js
#   - op/nedrykning + #1688-gate       backend/lib/economyEngine.js processDivisionEnd (LAESES, ROERES IKKE)
#   - S3-kalender               backend/lib/tierCalendarMaterializer.js + autoCalendarFlag.js
#
# GO her betyder: "koden + tests + tooling er klar til at KOERE cutoveren" -- IKKE
# "prod-data er verificeret grøn". Sektionen "MANUELLE PROD-TJEK" SKAL koeres via MCP
# og eyeballes af operatoeren FOER "Afslut sæson" klikkes, ligesom compressPyramid.js'
# dry-run skulle eyeballes ved S1->S2 (docs/SEASON_TRANSITION_CHECKLIST.md).
#
# Brug:
#   pwsh -File scripts/preflight-season-cutover.ps1                      # default S2->S3
#   pwsh -File scripts/preflight-season-cutover.ps1 -FromSeasonNumber 3 -ToSeasonNumber 4
#   pwsh -File scripts/preflight-season-cutover.ps1 -SkipTests           # spring node --test over (hurtigere iteration)
#   pwsh -File scripts/preflight-season-cutover.ps1 -SkipGh              # spring GitHub-issue-tjek over (offline)

param(
  [int] $FromSeasonNumber = 2,
  [int] $ToSeasonNumber = 3,
  [switch] $SkipTests,
  [switch] $SkipGh
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

. (Join-Path $PSScriptRoot 'lib\gh-retry.ps1')

$ok = @()
$warn = @()
$fail = @()
$manual = @()   # kraever live prod-SELECT via MCP -- tæller IKKE mod GO/NO-GO

function Write-Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

# --- Repo root (script koeres fra en worktree paa cutover-natten) ---
$repoRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
  Write-Host "[NO-GO] Ikke i et git-repo." -ForegroundColor Red
  exit 1
}
$repoRoot = $repoRoot.Trim() -replace "/", "\"
$backendRoot = Join-Path $repoRoot "backend"

# Sæson-UUIDs foelger computeSeasonUuid(n) i seasonTransition.js: hex(n).padStart(12,'0').
function Get-SeasonUuid([int] $n) {
  $hex = [Convert]::ToString($n, 16).PadLeft(12, '0')
  return "00000000-0000-0000-0000-$hex"
}
$fromSeasonId = Get-SeasonUuid $FromSeasonNumber
$toSeasonId = Get-SeasonUuid $ToSeasonNumber
# ageForSeason(bd, N) = LAUNCH_REFERENCE_YEAR(2026) + (N-1) - fødselsår (riderSeasonAge.js).
$launchRefYear = 2026
$fromSeasonRefYear = $launchRefYear + ($FromSeasonNumber - 1)
$toSeasonRefYear = $launchRefYear + ($ToSeasonNumber - 1)

Write-Host "Saesonskifte-preflight: S$FromSeasonNumber -> S$ToSeasonNumber" -ForegroundColor White
Write-Host "  fromSeasonId = $fromSeasonId   toSeasonId = $toSeasonId"
Write-Host "  Pension maales paa AFSLUTTET saesons alder -> referenceaar $fromSeasonRefYear (S$FromSeasonNumber)"

# --- 1. Toolchain ---
Write-Section "Toolchain"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $ok += "node $((& $nodeCmd.Source --version).Trim())"
  Write-Host "  [ok] node $((& $nodeCmd.Source --version).Trim())"
} else {
  $fail += "node ikke fundet paa PATH."
  Write-Host "  [NO-GO] node ikke fundet" -ForegroundColor Red
}
$backendNodeModules = Join-Path $backendRoot "node_modules"
if ((Test-Path $backendNodeModules) -and (@(Get-ChildItem $backendNodeModules -Directory -ErrorAction SilentlyContinue).Count -gt 0)) {
  $ok += "backend/node_modules findes"
} else {
  $warn += "backend/node_modules mangler/tom -- koer 'npm run sync-deps' foer unit-test-sektionen."
  Write-Host "  [warn] backend/node_modules mangler eller tom" -ForegroundColor Yellow
}

# --- 2. Unit-test-gate: hele saesonskifte-kaedens moduler (read-only, ingen DB) ---
Write-Section "Unit-tests -- saesonskifte-kaeden (node --test, ingen DB)"

$cutoverTestFiles = @(
  "lib/seasonFatigueReset.test.js",       # #2910 fatigue-reset
  "lib/seasonFormReset.test.js",          # #3232 form-reset/decay
  "lib/seasonCarryOver.test.js",          # #2916 MANAGER_SETUP_REGISTRY-handlers
  "lib/seasonCarryOverRegistry.test.js",  # #2916 -- scanner database/*.sql for uregistrerede season+team/rider-tabeller
  "lib/seasonStartHooks.test.js",         # samlepunkt: fatigue+form+akademi
  "lib/seasonTransitionReadiness.test.js",# readiness-gaten (#1346/#2361)
  "lib/riderSeasonAge.test.js",           # ageForSeason SSOT (pension)
  "lib/riderProgression.test.js",         # retirementDecision(age-1, ...) -- afsluttet-saesons-alder-reglen
  "lib/seasonAchievements.test.js",       # #2863/#2917 honours-kriterier
  "lib/tierCalendarMaterializer.test.js", # S-kalender-materialisering
  "lib/divisionCalendarGenerator.test.js",
  "lib/autoCalendarFlag.test.js",         # auto_calendar_enabled-gaten
  "lib/seasonTransition.test.js"          # selve orkestratoren (LAESES, roeres ikke)
)

if ($SkipTests) {
  Write-Host "  [skip] -SkipTests sat -- sprunget over" -ForegroundColor Yellow
  $warn += "Unit-tests sprunget over (-SkipTests) -- koer uden flaget foer den rigtige cutover."
} elseif (-not $nodeCmd) {
  $warn += "Unit-tests sprunget over -- node mangler."
} else {
  $missing = @($cutoverTestFiles | Where-Object { -not (Test-Path (Join-Path $backendRoot $_)) })
  if ($missing.Count -gt 0) {
    $warn += "Test-filer mangler (moduler omdoebt/flyttet?): $($missing -join ', ')"
    Write-Host "  [warn] $($missing.Count) test-fil(er) mangler: $($missing -join ', ')" -ForegroundColor Yellow
  }
  $present = @($cutoverTestFiles | Where-Object { Test-Path (Join-Path $backendRoot $_) })
  if ($present.Count -gt 0) {
    Push-Location $backendRoot
    try {
      $testOut = & $nodeCmd.Source --test @present 2>&1
      $testExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    $summaryLine = @($testOut) | Where-Object { $_ -match '^ℹ (tests|pass|fail) ' }
    $summaryLine | ForEach-Object { Write-Host "  $_" }
    if ($testExit -eq 0) {
      $ok += "Saesonskifte-kaedens unit-tests groenne ($($present.Count) filer)"
      Write-Host "  [ok] $($present.Count) test-filer groenne" -ForegroundColor Green
    } else {
      $failLines = @($testOut) | Where-Object { $_ -match '(?i)^not ok|✖|AssertionError' } | Select-Object -First 6
      $fail += "Saesonskifte-kaedens unit-tests FEJLER. Foerste fejl: $([string]::Join(' | ', @($failLines)))"
      Write-Host "  [NO-GO] unit-tests fejler:" -ForegroundColor Red
      @($testOut) | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    }
  }
}

# --- 3. Statisk kode-tilstedevaerelse (scripts/migrationer kaeden kraever) ---
Write-Section "Kode-/script-tilstedevaerelse"

$requiredFiles = @(
  "backend/lib/seasonTransition.js",
  "backend/lib/seasonTransitionReadiness.js",
  "backend/lib/seasonStartHooks.js",
  "backend/lib/seasonFatigueReset.js",
  "backend/lib/seasonFormReset.js",
  "backend/lib/seasonCarryOver.js",
  "backend/lib/wageDeductionConfig.js",
  "backend/lib/riderSeasonAge.js",
  "backend/lib/riderProgression.js",
  "backend/lib/economyEngine.js",
  "backend/lib/tierCalendarMaterializer.js",
  "backend/lib/autoCalendarFlag.js",
  "backend/scripts/backfillSeasonAchievements.js",
  "backend/scripts/generateSeasonEntries.js",
  "backend/scripts/simulateSeasonTransitionDryRun.js",
  "database/2026-07-26-2863-season-honours.sql"
)
$missingFiles = @()
foreach ($f in $requiredFiles) {
  $full = Join-Path $repoRoot $f
  if (Test-Path $full) {
    Write-Host "  [ok] $f"
  } else {
    $missingFiles += $f
    Write-Host "  [NO-GO] mangler: $f" -ForegroundColor Red
  }
}
if ($missingFiles.Count -eq 0) {
  $ok += "Alle $($requiredFiles.Count) forventede filer/scripts findes"
} else {
  $fail += "Manglende fil(er) i cutover-kaeden: $($missingFiles -join ', ')"
}

# --- 4. Ikke-idempotente faser: claim-guard-check (kode-niveau, selv-opdaterende) ---
Write-Section "Idempotens-risiko: form-reset 'decay'-mode uden claim-guard (#3232)"

# seasonFormReset.js's egen modulkommentar erkender at 'decay' IKKE er idempotent og
# at en claim-tabel (samme moenster som academy_season_intake_runs, #2911) boer
# overvejes FOER 'decay' vaelges live -- men ingen saadan tabel er bygget endnu (grep
# nedenfor er selv-opdaterende: lander en claim-reference i filen senere, forsvinder
# denne advarsel automatisk).
$formResetFile = Join-Path $backendRoot "lib\seasonFormReset.js"
if (Test-Path $formResetFile) {
  $hasClaimGuard = Select-String -Path $formResetFile -Pattern "claim" -Quiet
  if ($hasClaimGuard) {
    $ok += "seasonFormReset.js refererer en claim-guard -- verificer stadig manuelt at den daekker 'decay'."
    Write-Host "  [ok] claim-reference fundet i seasonFormReset.js -- verificer manuelt at den er komplet" -ForegroundColor Green
  } else {
    $warn += "seasonFormReset.js har INGEN claim-guard. Hvis app_config.season_form_reset_mode='decay' ved cutover: en gen-koersel af 'Udfoer saesonskifte' (fx efter en fejlet fase) decayer formen EN GANG TIL (ikke idempotent, jf. filens egen modulkommentar). Verificer LIVE mode i MANUELLE PROD-TJEK nedenfor -- er den 'decay', tag eksplicit stilling (owner-go til at 'transitionen koeres kun ÉN gang' som accepteret drift, ELLER byg claim-guarden foerst, ELLER skift mode til 'off'/'baseline' for denne cutover)."
    Write-Host "  [warn] ingen claim-guard i seasonFormReset.js -- 'decay' er IKKE sikker mod gen-koersel" -ForegroundColor Yellow
  }
} else {
  $warn += "seasonFormReset.js ikke fundet -- claim-guard-check sprunget over."
}

# --- 5. Kendte aabne GitHub-issues der skaerer direkte ind i denne cutover ---
Write-Section "Kendte aabne risici (GitHub-issue-state, live)"

if ($SkipGh) {
  Write-Host "  [skip] -SkipGh sat" -ForegroundColor Yellow
  $manual += "GitHub-issue-state (#2164/#3114/#2840) ikke tjekket (-SkipGh) -- tjek manuelt: gh issue view <N>."
} else {
  $issueChecks = @(
    @{ N = 2164; Desc = "D3->D4-nedrykning: EKSPLICIT regel (ikke kun data-gate). Data 3-4/8 viser ALLE 4 D3-puljer 24/24 aegte -> poolAllReal-gaten fyrer for aegte ved denne cutover, uanset om #2164 er lukket. Destinations-D4-puljer (league_division_id 8-15) havde allerede aegte managere + fulde S2-kalendere maalt 4/8 -- lavere risiko end issuets raa tekst antyder, men acceptkriterierne er stadig utjekkede." }
    @{ N = 3114; Desc = "HISTORISK (#4075, 21/8): monument-sentinelen er fjernet -- monumenter har normal game_day og binder som alle andre loeb. Tjek kun at S3-kalenderen IKKE har game_day >= 100000-raekker." }
    @{ N = 2840; Desc = "Loen pr. dag vs. season_upfront: ejer valgte 'B - vent til foerste payroll observeret' 26/7. wage_deduction_mode='season_upfront' maalt 4/8 (sikker default). Hvis en flip til 'daily' er planlagt TIL netop denne cutover: kraever dry-run + owner-go FOERST, og skiftet maa KUN ske praecis ved saesongraensen (aldrig midt i en sæson, jf. wageDeductionConfig.js's egen advarsel)." }
    @{ N = 3266; Desc = "Claim-guard mod dobbelt decay-koersel i seasonFormReset. season_form_reset_mode='decay' maalt 4/8 (IKKE idempotent ved gen-koersel af transitionen). Er dette issue stadig aabent til cutover-dagen: se sektion 4 ('Idempotens-risiko') ovenfor -- byg guarden, skift mode, eller faa et eksplicit engangs-accept fra ejeren." }
  )
  foreach ($c in $issueChecks) {
    $issueJson = Invoke-GhWithRetry @('issue', 'view', "$($c.N)", '--json', 'state,title') -TolerateFailure
    if (-not $issueJson) {
      $manual += "#$($c.N): kunne ikke slaa op via gh (auth/netvaerk) -- tjek manuelt: gh issue view $($c.N). $($c.Desc)"
      Write-Host "  [warn] #$($c.N) kunne ikke slaas op via gh" -ForegroundColor Yellow
      continue
    }
    try { $issueObj = ($issueJson -join "`n") | ConvertFrom-Json } catch { $issueObj = $null }
    if ($issueObj -and $issueObj.state -eq "CLOSED") {
      $ok += "#$($c.N) ('$($issueObj.title)') er LUKKET -- risikoen er formentlig adresseret, men verificer at fixet daekker denne cutover."
      Write-Host "  [ok] #$($c.N) lukket: $($issueObj.title)" -ForegroundColor Green
    } elseif ($issueObj) {
      $warn += "#$($c.N) ('$($issueObj.title)') er STADIG AABENT. $($c.Desc)"
      Write-Host "  [warn] #$($c.N) aabent: $($issueObj.title)" -ForegroundColor Yellow
    }
  }
}

# --- 6. #1688 / FIRST_PROMOTION_RELEGATION_SEASON hard-gate (kode-check, ROERER intet) ---
Write-Section "Op-/nedrykningsgate (FIRST_PROMOTION_RELEGATION_SEASON, LAESES kun)"

$economyConstantsFile = Join-Path $backendRoot "lib\economyConstants.js"
$gateMatch = Select-String -Path $economyConstantsFile -Pattern "FIRST_PROMOTION_RELEGATION_SEASON\s*=\s*(\d+)" -ErrorAction SilentlyContinue
if ($gateMatch) {
  $gateSeason = [int]$gateMatch.Matches[0].Groups[1].Value
  if ($ToSeasonNumber -ge $gateSeason) {
    $ok += "FIRST_PROMOTION_RELEGATION_SEASON=$gateSeason <= toSeason $ToSeasonNumber -- normal op/nedrykning KOERER (season_end_skip_division_movement skal vaere 'off', tjek MANUELLE PROD-TJEK)."
    Write-Host "  [ok] gate=$gateSeason <= S$ToSeasonNumber -- op/nedrykning forventes at koere normalt (ikke skippet som ved S1->S2's komprimering)" -ForegroundColor Green
  } else {
    $warn += "FIRST_PROMOTION_RELEGATION_SEASON=$gateSeason > toSeason $ToSeasonNumber -- op/nedrykning springes over af koden selv for denne cutover."
  }
} else {
  $warn += "Kunne ikke laese FIRST_PROMOTION_RELEGATION_SEASON fra economyConstants.js -- verificer manuelt."
}

# --- Manuelle PROD-tjek (SELECT-only, koer via Supabase MCP FOER cutover) ---
Write-Section "MANUELLE PROD-TJEK (kopiér til Supabase MCP execute_sql -- scriptet koerer dem IKKE selv)"

$manual += "Flag-tilstand (forvent: engine-flags 'on', season_end_skip_division_movement 'off', auto_calendar_enabled fravaerende/off MEDMINDRE transitionen bevidst skal bygge S$ToSeasonNumber-kalenderen selv):"
$sqlFlags = @"
select key, value from app_config where key in (
  'stage_scheduler_enabled','race_engine_v2_enabled','auto_prize_enabled',
  'auto_entry_generator_enabled','auto_calendar_enabled',
  'season_fatigue_reset_enabled','season_academy_intake_enabled',
  'season_form_reset_mode','season_form_reset_decay_target','season_form_reset_decay_factor',
  'wage_deduction_mode','season_end_skip_division_movement'
) order by key;
"@
Write-Host $sqlFlags

$manual += "Saeson-raekker (forvent: fromSeason $FromSeasonNumber 'active', toSeason $ToSeasonNumber MANGLER helt eller er 'upcoming' -- mangler den, OPRETTER transitionen den fra bunden, ANDERLEDES end S1->S2 hvor S2 laa klar):"
$sqlSeasons = @"
select number, status, start_date, end_date from seasons order by number;
"@
Write-Host $sqlSeasons

$manual += "S$ToSeasonNumber-kalender-status (forvent 4/8: 0 raekker -- kalenderen for S$ToSeasonNumber er IKKE materialiseret endnu):"
$sqlCalendar = @"
select count(*) from races where season_id = '$toSeasonId';
"@
Write-Host $sqlCalendar

$manual += "Udestaaende S$FromSeasonNumber-loeb / pending resultater / ubetalte praemier (alle tre SKAL vaere 0 foer 'Afslut sæson'):"
$sqlOutstanding = @"
select count(*) from races where season_id='$fromSeasonId' and status != 'completed';
select count(*) from pending_race_results p join races r on r.id=p.race_id where r.season_id='$fromSeasonId' and p.status='pending';
select count(*) from races where season_id='$fromSeasonId' and status='completed' and prize_paid_at is null;
"@
Write-Host $sqlOutstanding

$manual += "rider_rankings_mv-afstemning (matview skal matche raa resultater FOER honours-migrationen laeses paa /seasons):"
$sqlMv = @"
select matview_group, refreshed_at, now() - refreshed_at as age
from matview_refresh_heartbeat where matview_group = 'ranking';
select
  (select sum(points) from rider_rankings_mv where season_id='$fromSeasonId') as mv_points,
  (select sum(rr.points_earned) from race_results rr join races r on r.id=rr.race_id
     where r.season_id='$fromSeasonId' and rr.rider_id is not null) as raw_points;
"@
Write-Host $sqlMv

$manual += "Pension-kandidater (maalt paa AFSLUTTET S$FromSeasonNumber-alder = referenceaar $fromSeasonRefYear, jf. riderProgression.js's age-1-regel):"
$sqlPension = @"
select
  count(*) filter (where ($fromSeasonRefYear - extract(year from r.birthdate)::int) between 36 and 39) as window_36_39,
  count(*) filter (where ($fromSeasonRefYear - extract(year from r.birthdate)::int) >= 40) as guaranteed_40plus
from riders r join teams t on t.id = r.team_id
where r.is_retired = false and r.is_academy = false
  and t.is_ai = false and not t.is_bank and not t.is_frozen and not t.is_test_account;
"@
Write-Host $sqlPension

$manual += "Divisions-/pulje-sammensaetning (D1-foerste-oprykning + D3->D4-relegations-omfang -- se #3114/#2164 ovenfor):"
$sqlDivisions = @"
select division, count(*) filter (where is_ai=false and not is_bank and not is_frozen and not is_test_account) as real_teams,
       count(*) filter (where is_ai=true) as ai_teams
from teams group by division order by 1;

select league_division_id, count(*) filter (where is_ai=false and not is_bank and not is_frozen and not is_test_account) as real,
       count(*) filter (where is_ai=true) as ai
from teams where division=3 group by 1 order by 1;
-- puljer med real=24/ai=0 relegerer for AEGTE denne cutover (poolAllReal-gaten, processDivisionEnd)

-- D3-pulje -> dens to D4-boerne (ratio afledt af pool_index, buildPoolTree i economyEngine.js):
select ld3.id as d3_pool, ld3.pool_index,
       ld4a.id as child1, ld4a.pool_index as child1_idx,
       ld4b.id as child2, ld4b.pool_index as child2_idx
from league_divisions ld3
join league_divisions ld4a on ld4a.tier=4 and ld4a.pool_index = ld3.pool_index*2
join league_divisions ld4b on ld4b.tier=4 and ld4b.pool_index = ld3.pool_index*2+1
where ld3.tier=3
order by ld3.pool_index;

-- Har destinations-D4-puljerne allerede en kalender for S$FromSeasonNumber (proxy for 'er puljen live')?
select league_division_id, count(*) from races
where season_id='$fromSeasonId' and division=4
group by 1 order by 1;
"@
Write-Host $sqlDivisions

$manual += "Readiness-gate (API, ikke SQL): GET /api/admin/season-transition/preview -- alle checks groenne undtagen evt. no_active_auctions (kryds-tjek mod pensions-listen ovenfor foer force=true)."

# --- Summary + JSON-state ---
Write-Section "Sammenfatning"
Write-Host "  $($ok.Count) ok / $($warn.Count) advarsler / $($fail.Count) NO-GO / $($manual.Count) manuelle prod-tjek udestaar"

if ($fail.Count -gt 0) {
  Write-Host ""
  Write-Host "NO-GO-aarsager:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
if ($warn.Count -gt 0) {
  Write-Host ""
  Write-Host "Advarsler (ikke blokerende for scriptets GO, men laes dem):" -ForegroundColor Yellow
  $warn | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
Write-Host ""
Write-Host "Manuelle prod-tjek der SKAL koeres via Supabase MCP foer 'Afslut sæson':" -ForegroundColor Cyan
Write-Host "  ($($manual.Count) blokke printet ovenfor i 'MANUELLE PROD-TJEK')"

$stateDir = Join-Path $repoRoot ".codex.local"
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$stateFile = Join-Path $stateDir "season-cutover-preflight.json"
[ordered]@{
  timestamp        = (Get-Date).ToString("o")
  hostname         = $env:COMPUTERNAME
  repoRoot         = $repoRoot
  fromSeasonNumber = $FromSeasonNumber
  toSeasonNumber   = $ToSeasonNumber
  fromSeasonId     = $fromSeasonId
  toSeasonId       = $toSeasonId
  okCount          = $ok.Count
  warnCount        = $warn.Count
  failCount        = $fail.Count
  manualCount      = $manual.Count
  ok               = $ok
  warnings         = $warn
  failures         = $fail
  manualChecks     = $manual
  go               = ($fail.Count -eq 0)
} | ConvertTo-Json -Depth 5 | Out-File -FilePath $stateFile -Encoding utf8
Write-Host ""
Write-Host "  State skrevet: $stateFile"

if ($fail.Count -gt 0) {
  Write-Host ""
  Write-Host "[NO-GO] Loes NO-GO-aarsagerne ovenfor og koer scriptet igen." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[GO] Kode + tests + tooling er klar. Koer 'MANUELLE PROD-TJEK'-blokkene via Supabase MCP og laes advarslerne FOER 'Afslut sæson' klikkes -- dette er IKKE en 'prod-data er groen'-garanti." -ForegroundColor Green
exit 0
