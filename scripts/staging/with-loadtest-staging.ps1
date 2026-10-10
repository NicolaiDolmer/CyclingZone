# with-loadtest-staging.ps1 - koer en backend-kommando mod load-test-staging (#5904) i et RENT miljoe.
#
# Forskel fra scripts/with-staging.ps1 (generalproeve-wrapperen): den henter prod-secrets fra
# Infisical og blanker en liste af kendte noegler. Denne wrapper henter INGEN Infisical-secrets:
# child-processen starter med et tomt miljoe + kun OS-basisvariabler + staging-credentials
# (fra Supabase CLI via Set-StagingEnv). En noegle der ikke findes, kan ikke laekke.
#
# Fail-closed, i denne raekkefoelge (en fejl stopper alt, kommandoen koeres aldrig):
#   1) Set-StagingEnv + Assert-LoadtestStagingTarget (ref + origin + ingen prod-ref)
#   2) backend/scripts/staging/assertLoadtestIsolation.mjs i det rene miljoe: ingen
#      sideeffekt-noegler, og staging-DB'en er renset (webhooks, outbox, e-mails, markoer)
#   3) kommandoen
#
# Brug (fra repo-roden):
#   pwsh -File scripts/staging/with-loadtest-staging.ps1 -- node scripts/<script>.js --flag
#   pwsh -File scripts/staging/with-loadtest-staging.ps1 -Cwd . -- node scripts/loadtest/<x>.mjs
[CmdletBinding(PositionalBinding = $false)]
param(
  [string] $BranchName = "staging-cutover",
  [string] $Cwd = "backend",
  [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Command
)
$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
. (Join-Path $repo "scripts/lib/Staging-Env.ps1")
. (Join-Path $repo "scripts/staging/Staging-Guard.ps1")
if ($Command.Count -gt 0 -and $Command[0] -eq "--") { $Command = $Command[1..($Command.Count - 1)] }
if (-not $Command -or $Command.Count -eq 0) { throw "Angiv kommandoen efter --" }

Set-StagingEnv -BranchName $BranchName
Assert-LoadtestStagingTarget

# Rent miljoe: kun OS-basis + staging. Alt andet (inkl. evt. arvede prod-noegler) udelades.
$keep = @("SystemRoot", "windir", "ComSpec", "PATHEXT", "PATH", "Path", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "ProgramFiles", "ProgramData", "NUMBER_OF_PROCESSORS", "OS")
$envMap = @{}
foreach ($k in $keep) { $v = [Environment]::GetEnvironmentVariable($k); if ($v) { $envMap[$k] = $v } }
$envMap["SUPABASE_URL"] = $env:STAGING_SUPABASE_URL
$envMap["SUPABASE_SERVICE_KEY"] = $env:STAGING_SERVICE_KEY
$envMap["SUPABASE_DB_URL"] = $env:STAGING_DB_URL
$envMap["CZ_TARGET_ENV"] = "loadtest-staging"
$envMap["CZ_LOADTEST_WRAPPER"] = "1" # race-day-sim.mjs naegter at koere uden (#5904)
$envMap["NODE_ENV"] = "production"

function Invoke-Clean([string] $file, [string[]] $argv, [string] $dir) {
  $psi = [Diagnostics.ProcessStartInfo]::new($file)
  foreach ($a in $argv) { $psi.ArgumentList.Add($a) }
  $psi.WorkingDirectory = $dir
  $psi.UseShellExecute = $false
  $psi.Environment.Clear()
  foreach ($k in $envMap.Keys) { $psi.Environment[$k] = $envMap[$k] }
  $p = [Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  return $p.ExitCode
}

$node = (Get-Command node).Source
$code = Invoke-Clean $node @((Join-Path $repo "backend/scripts/staging/assertLoadtestIsolation.mjs")) $repo
if ($code -ne 0) { throw "isolationstjek BLOCKED (exit $code) - kommandoen koeres ikke" }
Write-Host "[with-loadtest-staging] isolation ok, target-ref=$($env:STAGING_REF)"

$exe = (Get-Command $Command[0]).Source
$rest = @(); if ($Command.Count -gt 1) { $rest = $Command[1..($Command.Count - 1)] }
exit (Invoke-Clean $exe $rest (Join-Path $repo $Cwd))
