# Staging-Guard.ps1 - fail-closed maal-identitet for #5904-staging-scripts.
#
# Dot-source efter Set-StagingEnv (scripts/lib/Staging-Env.ps1):
#   . "$PSScriptRoot/Staging-Guard.ps1"; Assert-LoadtestStagingTarget
#
# Naegter (throw) medmindre ALLE disse holder:
#   - STAGING_REF er praecis den godkendte load-test-branch (#5904, ejer-valg A 4/10)
#   - STAGING_DB_URL og STAGING_SUPABASE_URL peger paa samme ref
#   - ingen af dem naevner prod-projektets ref
#   - SUPABASE_DB_URL/SUPABASE_URL i processen peger IKKE paa prod (ingen prod-creds i spil)
# Printer aldrig en secret-vaerdi; kun ref og ja/nej-resultater.

$script:LoadtestStagingRef = "pywxpnynzmbukdvoiazp"
$script:ProdProjectRef = "ghwvkxzhsbbltzfnuhhz"

function Assert-LoadtestStagingTarget {
  $ref = $env:STAGING_REF
  if ($ref -ne $script:LoadtestStagingRef) { throw "STAGING_REF er ikke den godkendte load-test-branch - naegter" }
  foreach ($name in @("STAGING_DB_URL", "STAGING_SUPABASE_URL", "STAGING_SERVICE_KEY")) {
    if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name mangler - koer Set-StagingEnv foerst" }
  }
  if ($env:STAGING_DB_URL -notmatch [regex]::Escape($script:LoadtestStagingRef)) { throw "STAGING_DB_URL peger ikke paa staging-ref - naegter" }
  if ($env:STAGING_SUPABASE_URL -ne "https://$($script:LoadtestStagingRef).supabase.co") { throw "STAGING_SUPABASE_URL er ikke staging-origin - naegter" }
  foreach ($name in @("STAGING_DB_URL", "STAGING_SUPABASE_URL", "SUPABASE_DB_URL", "SUPABASE_URL", "DATABASE_URL")) {
    $v = (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value
    if ($v -and $v -match [regex]::Escape($script:ProdProjectRef)) { throw "$name naevner prod-projektet - naegter (ingen prod-creds i staging-koersler)" }
  }
  Write-Host "[staging-guard] target=$ref ok (prod-ref fravaerende i alle DB/URL-variabler)"
}
