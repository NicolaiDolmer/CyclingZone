# guard-commit-branch.ps1 — PowerShell-indgang til branch-guarden (#5094).
#
# Hvorfor denne findes:
#   Den kanoniske kæde er `bash scripts/guard-commit-branch.sh <branch> <dir> && git -C <dir> commit ...`.
#   Når `bash` ikke kan resolves paa PATH i den kaldende proces (maalt i
#   hook-/PowerShell-kontekst 9/9, .claude/learnings/2026-09-09-codex-hooks-measured-cause-chain.md
#   linje 89-92), er fejlen en command-resolution-fejl. Den opdaterer ikke
#   noedvendigvis $LASTEXITCODE, saa `&&`/`;`-kaeden kan fortsaette forbi guarden
#   uden at den nogensinde koerte. Guarden kan ikke beskytte mod ikke at blive startet.
#
# Denne wrapper goer to ting:
#   1. Finder Git Bash selv (PATH -> git --exec-path -> kendte Git-installationer),
#      saa en mangelfuld PATH ikke i sig selv forhindrer guarden i at koere.
#   2. Fejler HAARDT (exit 1) hvis der ikke findes nogen bash. Aldrig exit 0.
#
# Brug (PS 5.1 og PS 7):
#   pwsh -File scripts/guard-commit-branch.ps1 <branch> [<dir>]
#   if ($LASTEXITCODE -ne 0) { exit 1 }
#   git -C <dir> commit -F <fil>
#
# Exit-koder: samme som scripts/guard-commit-branch.sh (0 ok, 1 blokeret, 2 kald-fejl),
# plus 1 for "bash kunne ikke findes".
#
# Andet lag er markoeren guarden skriver + kontrollen i .githooks/pre-commit:
# et `git commit` der aldrig saa guarden, blokeres af Git selv.
#
# Test: bash scripts/test-guard-commit-branch.sh

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Branch,
  [Parameter(Position = 1)][string]$Dir
)

$ErrorActionPreference = 'Stop'

function Find-GitBash {
  # Test-only: simulér en maskine helt uden bash. Kan KUN gøre resultatet til en
  # hård fejl, aldrig til et stille pass - derfor er det ikke en bypass.
  if ($env:CZ_GUARD_TEST_NO_BASH -eq '1') { return $null }

  # 1. PATH.
  $onPath = Get-Command bash -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath -and (Test-Path -LiteralPath $onPath.Source)) { return $onPath.Source }

  # 2. Git's egen installation, via git --exec-path. Den peger paa
  #    <git-root>/mingw64/libexec/git-core; bash ligger i <git-root>/bin.
  #    Begge Git-layouts (med og uden mingw64-niveau) proeves.
  $execPath = $null
  try { $execPath = (& git --exec-path 2>$null | Select-Object -First 1) } catch { $execPath = $null }
  if ($execPath) {
    $execPath = $execPath.Trim()
    foreach ($up in @('..\..\..', '..\..\..\..')) {
      $candidate = Join-Path (Join-Path $execPath $up) 'bin\bash.exe'
      try { $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path } catch { continue }
      if (Test-Path -LiteralPath $resolved) { return $resolved }
    }
  }

  # 3. Kendte installationsstier. Ingen WSL-bash: den ser et andet filsystem,
  #    og guarden ville tjekke et andet trae end det der committes i.
  foreach ($p in @(
      "$env:ProgramFiles\Git\bin\bash.exe",
      "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
      "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }

  return $null
}

$guard = Join-Path $PSScriptRoot 'guard-commit-branch.sh'
if (-not (Test-Path -LiteralPath $guard)) {
  Write-Error "guard-commit-branch: selve guarden mangler: $guard"
  exit 1
}

$bash = Find-GitBash
if (-not $bash) {
  Write-Host ''
  Write-Host 'BLOKERET: bash kunne ikke findes - branch-guarden kunne ikke koere.' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Dette er praecis fejlen fra #5094: uden bash koerer guarden ikke, og en'
  Write-Host 'kommandokaede kan fortsaette til git commit uden at guarden nogensinde saa'
  Write-Host 'branchen. Derfor stopper vi haardt her i stedet.'
  Write-Host ''
  Write-Host 'Ret det:'
  Write-Host '  1. Installer Git for Windows, eller'
  Write-Host '  2. laeg <git-root>\bin paa PATH (der hvor bash.exe ligger).'
  Write-Host ''
  Write-Host 'Commit IKKE udenom. .githooks/pre-commit afviser alligevel et commit'
  Write-Host 'uden guard-markoer.'
  exit 1
}

$guardArgs = @($guard, $Branch)
if ($Dir) { $guardArgs += $Dir }

& $bash @guardArgs
exit $LASTEXITCODE
