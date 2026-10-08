# refresh-staging.ps1 - scriptet prod-kopi til staging-branchen (generalproeve-miljoe)
#
# Formaal: FOER enhver destruktiv prod-operation (saesonskifte, vaerdi-/loen-korrektion,
# masse-apply) skal kaeden vaere koert mod en frisk kopi af prod. Dette script laver
# kopien med een kommando, saa generalproeven aldrig springes over fordi "staging er gammel".
#
# Credentials: prod-DB-URL fra Infisical (env=prod, SUPABASE_DB_URL); staging-branchens
# credentials hentes ved koersel fra Supabase CLI (scripts/lib/Staging-Env.ps1). Intet
# printes, intet gemmes i filer.
#
# Brug (koeres fra repo-roden):
#   pwsh -File scripts/refresh-staging.ps1                       # dump + restore + verify
#   pwsh -File scripts/refresh-staging.ps1 -VerifyOnly           # kun raekketaellinger prod vs staging
#   pwsh -File scripts/refresh-staging.ps1 -SkipDump             # genbrug seneste dump i scratch
#   pwsh -File scripts/refresh-staging.ps1 -BranchName <navn>    # anden branch end staging-cutover
#
# Sikkerhed:
#   - Naegter at restore hvis branchens ref er prod-projektets ref.
#   - Kun schema public + auth.users (teams.user_id-FK'er kraever rigtige user-ids).
#   - Dumpet ligger i %TEMP% (ikke i repoet); -Clean sletter det.

param(
  [string] $BranchName = "staging-cutover",
  [switch] $Full,          # default er LEAN: tunge log-/resultat-tabeller dumpes uden data (branch-disk er lille)
  [switch] $VerifyOnly,
  [switch] $SkipDump,
  [switch] $Clean,
  [string] $DumpDir = (Join-Path $env:TEMP "cz-staging-refresh")
)

$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo
. (Join-Path $repo "scripts/lib/Staging-Env.ps1")
. (Join-Path $repo "scripts/lib/Refresh-Staging-Gates.ps1")

foreach ($tool in @("pg_dump", "pg_restore", "psql", "infisical", "supabase")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Mangler vaerktoej: $tool" }
}

Set-StagingEnv -BranchName $BranchName
New-Item -ItemType Directory -Force $DumpDir | Out-Null
$dumpFile = Join-Path $DumpDir "prod-public.dump"
$authFile = Join-Path $DumpDir "prod-auth-users.dump"
$verifySql = Join-Path $DumpDir "verify.sql"
@"
select 'riders' t, count(*) n from riders union all
select 'teams', count(*) from teams union all
select 'races', count(*) from races union all
select 'race_results', count(*) from race_results union all
select 'board_profiles', count(*) from board_profiles union all
select 'app_config', count(*) from app_config union all
select 'auth_users', count(*) from auth.users
order by 1;
"@ | Set-Content $verifySql -Encoding UTF8

# Prod-secrets injiceres kun i child-processen; STAGING_* arver fra denne proces.
# Output fanges og returneres; fejl kaster med PII-sikker tekst (kun ERROR/FATAL, maskeret).
function Invoke-WithProd([string] $cmd) {
  Invoke-RefreshNative { & infisical run --env=prod --silent -- pwsh -NoProfile -Command $cmd } ("prod: " + $cmd.Substring(0, [Math]::Min(40, $cmd.Length)))
}
function Invoke-Staging([string] $cmd) {
  Invoke-RefreshNative { & pwsh -NoProfile -Command $cmd } ("staging: " + $cmd.Substring(0, [Math]::Min(40, $cmd.Length)))
}

# Fail-closed dump-bevis: counts + marker skrives kun naar BEGGE dumps er faerdige. -SkipDump kraever dem.
$countsBeforeFile = Join-Path $DumpDir "prod-counts-before.txt"
$countsAfterFile = Join-Path $DumpDir "prod-counts-after.txt"
$markerFile = Join-Path $DumpDir "dump-complete.marker"
$leanTables = @("race_results", "race_simulation_rider_scores", "race_simulation_runs", "player_events",
  "board_satisfaction_events", "rider_derived_ability_history", "training_day_runs", "notifications",
  "race_stage_moments", "rider_profile_views", "traffic_events")
function Get-ProdCounts { (Invoke-WithProd "psql `$env:SUPABASE_DB_URL -X -tA -v ON_ERROR_STOP=1 -f '$verifySql'") -join "`n" }
$countSkip = @(); $countSlack = @{ app_config = 1 }   # cleanup inserts the cz_environment marker

if (-not $VerifyOnly) {
  if (-not $SkipDump) {
    $t0 = Get-Date
    # Et afbrudt/halvt dump-forsoeg maa aldrig kunne genbruges: ryd bevis foer vi starter.
    Remove-Item -Force $dumpFile, $authFile, $countsBeforeFile, $countsAfterFile, $markerFile -ErrorAction SilentlyContinue
    Set-Content -Path $countsBeforeFile -Value (Get-ProdCounts) -Encoding utf8
    # LEAN: schema for alle tabeller, men ingen data i tabeller der kun er logs/resultat-historik.
    # Branch-disken er lille (fuld prod-kopi paa ~1 GB gav "No space left on device" 23/8).
    $leanExclude = $leanTables
    $excl = ""
    if (-not $Full) { $excl = ($leanExclude | ForEach-Object { "--exclude-table-data=public.$_" }) -join " "; $excl += " --exclude-table-data='public.*backup*'" }
    Write-Host ("[..] pg_dump public (prod, read-only, {0}) -> $dumpFile" -f $(if ($Full) { "FULL" } else { "LEAN: " + $leanExclude.Count + " tabeller uden data + backup_*" }))
    $null = Invoke-WithProd "pg_dump `$env:SUPABASE_DB_URL --schema=public --no-owner --no-acl $excl -Fc -f '$dumpFile'"
    Write-Host "[..] pg_dump auth.users (data only) -> $authFile"
    $null = Invoke-WithProd "pg_dump `$env:SUPABASE_DB_URL --table=auth.users --data-only --no-owner --no-acl -Fc -f '$authFile'"
    Set-Content -Path $countsAfterFile -Value (Get-ProdCounts) -Encoding utf8
    Set-Content -Path $markerFile -Value ("complete " + (Get-Date).ToString("o") + " full=" + [bool]$Full) -Encoding utf8
    Write-Host ("[ok] dump {0:N0} MB paa {1:N0} s" -f ((Get-Item $dumpFile).Length / 1MB), ((Get-Date) - $t0).TotalSeconds)
  } else {
    foreach ($f in @($dumpFile, $authFile, $countsBeforeFile, $countsAfterFile, $markerFile)) {
      if (-not (Test-Path -LiteralPath $f)) { throw "-SkipDump kraever et komplet dump-bevis; mangler $(Split-Path -Leaf $f). Koer uden -SkipDump." }
    }
    if ((Get-Content -LiteralPath $markerFile -Raw) -match 'full=True') { $Full = [switch]$true }
  }

  # Keep pg_restore's dependency ordering and complete clean phase intact.
  # Large COPY sections remain separate visible steps in the same transaction.
  $public=Join-Path $DumpDir 'public-restore.sql'; $auth=Join-Path $DumpDir 'auth-data.sql'
  $guard=Join-Path $DumpDir 'restore-guard.sql'; $sanitize=Join-Path $DumpDir 'restore-sanitize.sql'
  Remove-Item -Force $public, $auth, $guard, $sanitize, (Join-Path $DumpDir 'public-progress.sql') -ErrorAction SilentlyContinue
  $null = Invoke-RefreshNative { & pg_restore --clean --if-exists --no-owner --no-acl --schema=public -f $public $dumpFile } 'Public archive extraction'
  $null = Invoke-RefreshNative { & pg_restore --data-only --no-owner --no-acl -f $auth $authFile } 'Auth archive extraction'
  # Stream instead of loading training_day_runs' large COPY payload into RAM.
  $progress=Join-Path $DumpDir 'public-progress.sql'
  $reader=[IO.StreamReader]::new($public,[Text.Encoding]::UTF8)
  $writer=[IO.StreamWriter]::new($progress,$false,[Text.UTF8Encoding]::new($false)); $writer.NewLine="`n"
  try {
    while($null -ne ($line=$reader.ReadLine())) {
      if(Test-RefreshTransactionControl $line){throw 'Transaction control found in public dump; restore would not be atomic'}
      if($line -match '^COPY public\.(training_day_runs|training_rider_ticks) '){$writer.WriteLine('\echo RESTORE_STEP_'+$Matches[1])}
      $writer.WriteLine($line)
    }
  } finally {$reader.Dispose();$writer.Dispose()}
  @'
set statement_timeout=0;
set idle_in_transaction_session_timeout=0;
set transaction_timeout=0;
set session_replication_role=replica;
'@ | Set-Content $guard -Encoding utf8
  $anonSql=New-RefreshSanitizeSql ([IO.File]::ReadAllText((Join-Path $repo 'scripts/staging/anonymize-staging.sql')))
  [IO.File]::WriteAllText($sanitize,$anonSql,[Text.UTF8Encoding]::new($false))
  $authPrefix=[Text.Encoding]::UTF8.GetBytes("truncate auth.users cascade;`n")
  [IO.File]::WriteAllBytes($auth,($authPrefix+[IO.File]::ReadAllBytes($auth)))
  $restoreArgs=Get-RefreshRestoreArguments @($guard,$auth,$progress,$sanitize) -RequireFiles
  $quoted=($restoreArgs|ForEach-Object { "'"+($_.Replace("'","''"))+"'" }) -join ' '
  Write-Host '[..] atomic restore: schema/auth/light data/training_day_runs/training_rider_ticks/indexes/cleanup'
  # Single transaction + ON_ERROR_STOP: fejl eller afbrudt forbindelse ruller ALT tilbage (intet halvt).
  $null = Invoke-Staging "psql `$env:STAGING_DB_URL $quoted"
}

if ($VerifyOnly) {
  # Ingen dump i dag: prod-taelling nu er baade foer og efter.
  $countsBefore = Get-ProdCounts; $countsAfter = $countsBefore
} else {
  $countsBefore = Get-Content -LiteralPath $countsBeforeFile -Raw; $countsAfter = Get-Content -LiteralPath $countsAfterFile -Raw
}

$privacyFile=Join-Path $DumpDir 'privacy-final.sql'
@'
select (select count(*) from public.users where email is null or email not like '%@loadtest.invalid'
  or discord_id is not null or discord_handle is not null)
 + (select count(*) from auth.users where email is null or email not like '%@loadtest.invalid'
  or phone is not null or raw_user_meta_data <> '{}'::jsonb or raw_app_meta_data <> '{}'::jsonb);
'@ | Set-Content $privacyFile -Encoding utf8
# LEAN dumper race_results uden data; kun den taelles blandt de verificerede tabeller.
if (-not $Full) { $countSkip = @("race_results") }
$files=@{
  fingerprint=(Join-Path $repo 'scripts/staging/schema-fingerprint-summary.sql')
  counts=$verifySql
  privacy=$privacyFile
}
# Fingerprint -> raekketal -> privacy (sidste database-kald, ogsaa i VerifyOnly). Intet GO uden alle tre.
$gate=Invoke-RefreshGates `
  { param($f) Invoke-WithProd "psql `$env:SUPABASE_DB_URL -X -tA -v ON_ERROR_STOP=1 -f '$f'" } `
  { param($f) Invoke-Staging "psql `$env:STAGING_DB_URL -X -tA -v ON_ERROR_STOP=1 -f '$f'" } `
  $files $countsBefore $countsAfter $countSkip $countSlack
if ($gate -ne 'GO') { throw 'Refresh gates did not return GO' }
Write-Host '[ok] app-schema fingerprint matches; row counts within prod window; non-anonymous users=0'

if ($Clean) { Remove-Item -Force $dumpFile, $authFile -ErrorAction SilentlyContinue; Write-Host "[ok] dump slettet" }
Write-Host "[GO] staging '$BranchName' er en frisk prod-kopi. Koer cutover-scripts via scripts/with-staging.ps1."
