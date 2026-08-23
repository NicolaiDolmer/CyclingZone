# Staging-Env.ps1 - henter staging-branchens credentials fra Supabase CLI ved koersel.
#
# Dot-source: . "$PSScriptRoot/lib/Staging-Env.ps1"; Set-StagingEnv -BranchName staging-cutover
# Kraever: `supabase` CLI logget ind (supabase login) - ingen secrets i Infisical eller filer.
# Saetter i DENNE proces: STAGING_DB_URL, STAGING_SUPABASE_URL, STAGING_SERVICE_KEY, STAGING_REF.
# Printer aldrig vaerdier. Naegter hvis branchen er prod-projektet selv.

$script:ProdRef = "ghwvkxzhsbbltzfnuhhz"

function Get-StagingBranch([string] $BranchName) {
  $json = & supabase branches list --project-ref $script:ProdRef -o json 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw "supabase branches list fejlede - er CLI'en logget ind? (supabase login)" }
  $all = $json | ConvertFrom-Json
  $b = $all | Where-Object { $_.name -eq $BranchName } | Select-Object -First 1
  if (-not $b) { throw "Branch '$BranchName' findes ikke. Findes: " + (($all | ForEach-Object { $_.name }) -join ", ") }
  return $b
}

function Set-StagingEnv([string] $BranchName = "staging-cutover") {
  $b = Get-StagingBranch $BranchName
  if ($b.project_ref -eq $script:ProdRef) { throw "Branch '$BranchName' ER prod - naegter" }
  $lines = & supabase branches get $b.id --project-ref $script:ProdRef -o env 2>$null
  if ($LASTEXITCODE -ne 0) { throw "supabase branches get fejlede for $BranchName" }
  $kv = @{}
  foreach ($l in $lines) { if ($l -match '^([A-Z_][A-Z0-9_]+)=(.*)$') { $kv[$Matches[1]] = $Matches[2].Trim('"') } }
  foreach ($need in @("POSTGRES_URL_NON_POOLING", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) {
    if (-not $kv[$need]) { throw "Branch-config mangler $need" }
  }
  $env:STAGING_DB_URL = $kv["POSTGRES_URL_NON_POOLING"]
  $env:STAGING_SUPABASE_URL = $kv["SUPABASE_URL"]
  $env:STAGING_SERVICE_KEY = $kv["SUPABASE_SERVICE_ROLE_KEY"]
  $env:STAGING_REF = $b.project_ref
  Write-Host "[staging-env] branch=$BranchName ref=$($b.project_ref) status=$($b.status) (credentials sat i proces, ikke printet)"
}
