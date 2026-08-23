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

  $t1 = Get-Date
  Write-Host "[..] restore -> staging $($env:STAGING_REF): auth.users (truncate+copy), derefter public (clean+if-exists)"
  Invoke-Staging "psql `$env:STAGING_DB_URL -v ON_ERROR_STOP=1 -q -c 'truncate auth.users cascade;'"
  Invoke-Staging "pg_restore -d `$env:STAGING_DB_URL --data-only --no-owner --no-acl '$authFile' 2>&1 | Select-String -Pattern 'error' | Select-Object -First 10; exit 0"
  # pg_restore returnerer 1 ved harmloese advarsler (extensions/policies der allerede findes);
  # de foerste 40 ikke-trivielle linjer vises, verify-trinnet afgoer GO/NO-GO.
  Invoke-Staging "pg_restore -d `$env:STAGING_DB_URL --clean --if-exists --no-owner --no-acl --schema=public '$dumpFile' 2>&1 | Select-String -Pattern 'error' | Where-Object { `$_ -notmatch 'DROP |does not exist' } | Select-Object -First 40; exit 0"
  Write-Host ("[ok] restore paa {0:N0} s" -f ((Get-Date) - $t1).TotalSeconds)
}

Write-Host "[..] verify: raekketaellinger prod vs staging"
Invoke-WithProd "Write-Host '--- prod'; psql `$env:SUPABASE_DB_URL -q -f '$verifySql'"
Invoke-Staging "Write-Host '--- staging'; psql `$env:STAGING_DB_URL -q -f '$verifySql'"

if ($Clean) { Remove-Item -Force $dumpFile, $authFile -ErrorAction SilentlyContinue; Write-Host "[ok] dump slettet" }
Write-Host "[GO] staging '$BranchName' er en frisk prod-kopi. Koer cutover-scripts via scripts/with-staging.ps1."
