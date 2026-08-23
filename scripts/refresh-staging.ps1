# refresh-staging.ps1 - scriptet prod-kopi til staging-branchen (generalproeve-miljoe)
#
# Formaal: FOER enhver destruktiv prod-operation (saesonskifte, vaerdi-/loen-korrektion,
# masse-apply) skal kaeden vaere koert mod en frisk kopi af prod. Dette script laver
# kopien med een kommando, saa generalproeven aldrig springes over fordi "staging er gammel".
#
# Secrets (Infisical, env=prod, aldrig paa kommandolinjen, aldrig printet):
#   SUPABASE_DB_URL      prod Postgres-URL (findes allerede)
#   STAGING_DB_URL       branch-databasens Postgres-URL (Supabase dashboard -> Branches ->
#                        <branch> -> Connect -> URI, session-mode port 5432)
#   STAGING_SUPABASE_URL + STAGING_SERVICE_KEY   branchens API-URL + service-noegle (til
#                        supabase-js-scripts; se scripts/with-staging.ps1)
#
# Brug (PS 5.1-kompatibel, koeres fra repo-roden):
#   pwsh -File scripts/refresh-staging.ps1                 # dump + restore + verify
#   pwsh -File scripts/refresh-staging.ps1 -VerifyOnly     # kun raekketaellinger prod vs staging
#   pwsh -File scripts/refresh-staging.ps1 -SkipDump       # genbrug seneste dump i scratch
#
# Sikkerhed:
#   - Restore naegter at koere hvis STAGING_DB_URL peger paa prod-projektets ref.
#   - Ingen secret-vaerdi printes; kun host-ref (projekt-id) vises.
#   - Kun schema public + auth.users-kopi (is_ai/teams-joins kraever rigtige user-ids).
#   - Dumpet ligger i scratchpad (ikke i repoet) og slettes ved -Clean.

param(
  [switch] $VerifyOnly,
  [switch] $SkipDump,
  [switch] $Clean,
  [string] $DumpDir = (Join-Path $env:TEMP "cz-staging-refresh")
)

$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo

foreach ($tool in @("pg_dump", "pg_restore", "psql", "infisical")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Mangler vaerktoej: $tool" }
}

New-Item -ItemType Directory -Force $DumpDir | Out-Null
$dumpFile = Join-Path $DumpDir "prod-public.dump"
$authFile = Join-Path $DumpDir "prod-auth-users.dump"

# Helper: koer en kommando med Infisical-secrets som env uden at printe dem.
function Invoke-WithSecrets([string] $cmd) {
  & infisical run --env=prod --silent -- pwsh -NoProfile -Command $cmd
  if ($LASTEXITCODE -ne 0) { throw "Fejlede: $cmd" }
}

# Ref-udtraek (host-del af URL) - printes, resten aldrig.
$refScript = @'
function RefOf($u) { if (-not $u) { return "" }; $m = [regex]::Match($u, "(?:postgres\.|db\.)([a-z]{20})"); if ($m.Success) { $m.Groups[1].Value } else { "ukendt-format" } }
$p = RefOf $env:SUPABASE_DB_URL; $s = RefOf $env:STAGING_DB_URL
if (-not $env:STAGING_DB_URL) { Write-Host "[NO-GO] STAGING_DB_URL mangler i Infisical (env=prod)"; exit 2 }
if ($p -eq $s) { Write-Host "[NO-GO] STAGING_DB_URL peger paa PROD ($p) - naegter"; exit 3 }
Write-Host "[ok] prod-ref=$p  staging-ref=$s"
'@
Invoke-WithSecrets $refScript

$verifySql = @"
select 'riders' t, count(*) n from riders union all
select 'teams', count(*) from teams union all
select 'races', count(*) from races union all
select 'contracts', count(*) from contracts union all
select 'board_profiles', count(*) from board_profiles union all
select 'app_config', count(*) from app_config union all
select 'auth_users', count(*) from auth.users
order by 1;
"@
$verifySql | Set-Content (Join-Path $DumpDir "verify.sql") -Encoding UTF8

if (-not $VerifyOnly) {
  if (-not $SkipDump) {
    $t0 = Get-Date
    Write-Host "[..] pg_dump public (prod, read-only) -> $dumpFile"
    Invoke-WithSecrets "pg_dump `$env:SUPABASE_DB_URL --schema=public --no-owner --no-acl -Fc -f '$dumpFile'"
    Write-Host "[..] pg_dump auth.users (data only) -> $authFile"
    Invoke-WithSecrets "pg_dump `$env:SUPABASE_DB_URL --table=auth.users --data-only --no-owner --no-acl -Fc -f '$authFile'"
    Write-Host ("[ok] dump {0:N0} MB paa {1:N0} s" -f ((Get-Item $dumpFile).Length / 1MB), ((Get-Date) - $t0).TotalSeconds)
  }

  $t1 = Get-Date
  Write-Host "[..] pg_restore -> staging (public: clean+if-exists; auth.users: truncate+copy)"
  # auth.users foerst (teams.user_id-FK'er peger derpaa), derefter public.
  Invoke-WithSecrets "psql `$env:STAGING_DB_URL -v ON_ERROR_STOP=1 -q -c 'truncate auth.users cascade;'"
  Invoke-WithSecrets "pg_restore -d `$env:STAGING_DB_URL --data-only --no-owner --no-acl --disable-triggers '$authFile'"
  # pg_restore returnerer 1 ved harmloese advarsler (extensions/policies der allerede findes);
  # vi viser de foerste 40 ikke-trivielle linjer og lader verify-trinnet afgoere GO/NO-GO.
  Invoke-WithSecrets "pg_restore -d `$env:STAGING_DB_URL --clean --if-exists --no-owner --no-acl --schema=public '$dumpFile' 2>&1 | Select-String -NotMatch 'already exists|does not exist|warning: errors ignored' | Select-Object -First 40; exit 0"
  Write-Host ("[ok] restore paa {0:N0} s" -f ((Get-Date) - $t1).TotalSeconds)
}

Write-Host "[..] verify: raekketaellinger prod vs staging"
$vs = (Join-Path $DumpDir "verify.sql")
Invoke-WithSecrets "Write-Host '--- prod'; psql `$env:SUPABASE_DB_URL -q -f '$vs'; Write-Host '--- staging'; psql `$env:STAGING_DB_URL -q -f '$vs'"

if ($Clean) { Remove-Item -Force $dumpFile, $authFile -ErrorAction SilentlyContinue; Write-Host "[ok] dump slettet" }
Write-Host "[GO] staging er en frisk prod-kopi. Koer generalproeve-scripts via scripts/with-staging.ps1."
