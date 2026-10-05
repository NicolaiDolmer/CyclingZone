# apply-staging-migrations.ps1 - bring load-test-staging (#5904) op paa repoets schema.
#
# Samme mekanik som .github/workflows/auto-migrate.yml (pending = database/2026-*.sql minus
# staging.schema_migrations, manuel-only-markoer stopper), men KUN mod den godkendte
# staging-branch. Raekkefoelge: -OrderFile (en fil pr. linje, typisk prods applied_at-
# raekkefoelge laest read-only) efterfulgt af resterende pending i navne-orden.
#
# Brug (fra repo-roden, PowerShell 7):
#   pwsh -File scripts/staging/apply-staging-migrations.ps1 -DryRun
#   pwsh -File scripts/staging/apply-staging-migrations.ps1 [-OrderFile <sti>] [-ContinueOnError]
#
# Sikkerhed: Set-StagingEnv + Assert-LoadtestStagingTarget (fail-closed paa ref, ingen prod-
# URL i processen). Ingen Infisical/prod-secrets. Printer aldrig credentials.

param(
  [string] $BranchName = "staging-cutover",
  [string] $OrderFile,
  [switch] $DryRun,
  [switch] $ContinueOnError
)
$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo
. (Join-Path $repo "scripts/lib/Staging-Env.ps1")
. (Join-Path $repo "scripts/staging/Staging-Guard.ps1")
Set-StagingEnv -BranchName $BranchName
Assert-LoadtestStagingTarget

$db = $env:STAGING_DB_URL
& psql $db -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
if ($LASTEXITCODE -ne 0) { throw "kunne ikke sikre schema_migrations" }
$applied = @{}
foreach ($l in (& psql $db -tAc "SELECT filename FROM schema_migrations")) {
  if ($l) { $applied[($l.Trim() -replace '^database/', '')] = $true }
}
$local = Get-ChildItem (Join-Path $repo "database") -File -Filter "2026-*.sql" | ForEach-Object { $_.Name } | Sort-Object { $_ } -Culture ([cultureinfo]::InvariantCulture)
$pending = @($local | Where-Object { -not $applied[$_] })
$ordered = @()
if ($OrderFile) {
  $set = @{}; foreach ($p in $pending) { $set[$p] = $true }
  foreach ($l in (Get-Content $OrderFile)) { $n = $l.Trim(); if ($n -and $set[$n]) { $ordered += $n; $set.Remove($n) } }
  $ordered += @($pending | Where-Object { $set[$_] })
} else { $ordered = $pending }

Write-Host "[apply] pending=$($ordered.Count) (staging har $($applied.Count) registrerede)"
if ($DryRun) { $ordered | ForEach-Object { Write-Host "  - $_" }; exit 0 }

$failed = @()
foreach ($f in $ordered) {
  $path = Join-Path $repo "database/$f"
  if (Select-String -Path $path -Pattern 'K(Ø|OE)RES IKKE AUTOMATISK|MANUAL[- ]ONLY' -Quiet) { throw "$f er markeret manuel-only - stopper (samme regel som auto-migrate)" }
  Write-Host "[apply] $f"
  & psql $db -v ON_ERROR_STOP=1 -q -f $path 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -ne 0) {
    $failed += $f
    if (-not $ContinueOnError) { throw "migration fejlede: $f (intet registreret for denne fil)" }
    continue
  }
  & psql $db -v ON_ERROR_STOP=1 -q -c "INSERT INTO schema_migrations (filename) VALUES ('database/$f') ON CONFLICT DO NOTHING;"
}
if ($failed.Count) { Write-Host "[apply] FEJLEDE ($($failed.Count)):"; $failed | ForEach-Object { Write-Host "  - $_" }; exit 1 }
Write-Host "[apply] alle pending migrationer anvendt paa staging"
