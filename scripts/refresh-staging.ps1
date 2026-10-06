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
function Invoke-WithProd([string] $cmd) {
  & infisical run --env=prod --silent -- pwsh -NoProfile -Command $cmd
  if ($LASTEXITCODE -ne 0) { throw "Fejlede (exit $LASTEXITCODE): $($cmd.Substring(0, [Math]::Min(60, $cmd.Length)))..." }
}
function Invoke-Staging([string] $cmd) {
  & pwsh -NoProfile -Command $cmd
  if ($LASTEXITCODE -ne 0) { throw "Fejlede (exit $LASTEXITCODE): $($cmd.Substring(0, [Math]::Min(60, $cmd.Length)))..." }
}

if (-not $VerifyOnly) {
  if (-not $SkipDump) {
    $t0 = Get-Date
    # LEAN: schema for alle tabeller, men ingen data i tabeller der kun er logs/resultat-historik.
    # Branch-disken er lille (fuld prod-kopi paa ~1 GB gav "No space left on device" 23/8).
    $leanExclude = @("race_results", "race_simulation_rider_scores", "race_simulation_runs", "player_events",
      "board_satisfaction_events", "rider_derived_ability_history", "training_day_runs", "notifications",
      "race_stage_moments", "rider_profile_views", "traffic_events")
    $excl = ""
    if (-not $Full) { $excl = ($leanExclude | ForEach-Object { "--exclude-table-data=public.$_" }) -join " "; $excl += " --exclude-table-data='public.*backup*'" }
    Write-Host ("[..] pg_dump public (prod, read-only, {0}) -> $dumpFile" -f $(if ($Full) { "FULL" } else { "LEAN: " + $leanExclude.Count + " tabeller uden data + backup_*" }))
    Invoke-WithProd "pg_dump `$env:SUPABASE_DB_URL --schema=public --no-owner --no-acl $excl -Fc -f '$dumpFile'"
    Write-Host "[..] pg_dump auth.users (data only) -> $authFile"
    Invoke-WithProd "pg_dump `$env:SUPABASE_DB_URL --table=auth.users --data-only --no-owner --no-acl -Fc -f '$authFile'"
    Write-Host ("[ok] dump {0:N0} MB paa {1:N0} s" -f ((Get-Item $dumpFile).Length / 1MB), ((Get-Date) - $t0).TotalSeconds)
  }

  # Keep pg_restore's dependency ordering and complete clean phase intact.
  # Large COPY sections remain separate visible steps in the same transaction.
  $public=Join-Path $DumpDir 'public-restore.sql'; $auth=Join-Path $DumpDir 'auth-data.sql'
  $guard=Join-Path $DumpDir 'restore-guard.sql'; $sanitize=Join-Path $DumpDir 'restore-sanitize.sql'
  & pg_restore --clean --if-exists --no-owner --no-acl --schema=public -f $public $dumpFile
  if($LASTEXITCODE -ne 0){throw 'Public archive extraction failed'}
  & pg_restore --data-only --no-owner --no-acl -f $auth $authFile
  if($LASTEXITCODE -ne 0){throw 'Auth archive extraction failed'}
  # Stream instead of loading training_day_runs' large COPY payload into RAM.
  $progress=Join-Path $DumpDir 'public-progress.sql'
  $reader=[IO.StreamReader]::new($public,[Text.Encoding]::UTF8)
  $writer=[IO.StreamWriter]::new($progress,$false,[Text.UTF8Encoding]::new($false)); $writer.NewLine="`n"
  try {
    while($null -ne ($line=$reader.ReadLine())) {
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
  $anon=[IO.File]::ReadAllText((Join-Path $repo 'scripts/staging/anonymize-staging.sql'))
  $anon=[regex]::Replace($anon,'(?im)^\s*(begin|commit);\s*$','')
  $authPrivacy=@'
set session_replication_role=origin;
update auth.users set email='loadtest-' || id::text || '@loadtest.invalid', phone=null,
  encrypted_password='', raw_user_meta_data='{}'::jsonb, raw_app_meta_data='{}'::jsonb;
'@
  [IO.File]::WriteAllText($sanitize,$authPrivacy+"`n"+$anon,[Text.UTF8Encoding]::new($false))
  $authPrefix=[Text.Encoding]::UTF8.GetBytes("truncate auth.users cascade;`n")
  [IO.File]::WriteAllBytes($auth,($authPrefix+[IO.File]::ReadAllBytes($auth)))
  $restoreArgs=Get-RefreshRestoreArguments @($guard,$auth,$progress,$sanitize)
  $quoted=($restoreArgs|ForEach-Object { "'"+($_.Replace("'","''"))+"'" }) -join ' '
  Write-Host '[..] atomic restore: schema/auth/light data/training_day_runs/training_rider_ticks/indexes/cleanup'
  Invoke-Staging "psql `$env:STAGING_DB_URL $quoted"
}

$fingerprint=Join-Path $repo 'scripts/staging/schema-fingerprint-summary.sql'
$prodFingerprint=Invoke-WithProd "psql `$env:SUPABASE_DB_URL -X -tA -v ON_ERROR_STOP=1 -f '$fingerprint'"
$stageFingerprint=Invoke-Staging "psql `$env:STAGING_DB_URL -X -tA -v ON_ERROR_STOP=1 -f '$fingerprint'"
Assert-RefreshFingerprint ($prodFingerprint -join "`n") ($stageFingerprint -join "`n")

# Deliberately the last database operation, including VerifyOnly.
$privacyFile=Join-Path $DumpDir 'privacy-final.sql'
@'
select (select count(*) from public.users where email is null or email not like '%@loadtest.invalid'
  or discord_id is not null or discord_handle is not null)
 + (select count(*) from auth.users where email is null or email not like '%@loadtest.invalid'
  or phone is not null or raw_user_meta_data <> '{}'::jsonb or raw_app_meta_data <> '{}'::jsonb);
'@ | Set-Content $privacyFile -Encoding utf8
$privacy=Invoke-Staging "psql `$env:STAGING_DB_URL -X -tA -v ON_ERROR_STOP=1 -f '$privacyFile'"
Assert-RefreshPrivacy ($privacy -join "`n")
Write-Host '[ok] app-schema fingerprint matches; non-anonymous users=0'

if ($Clean) { Remove-Item -Force $dumpFile, $authFile -ErrorAction SilentlyContinue; Write-Host "[ok] dump slettet" }
Write-Host "[GO] staging '$BranchName' er en frisk prod-kopi. Koer cutover-scripts via scripts/with-staging.ps1."
