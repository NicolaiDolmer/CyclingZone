# Compatibility entrypoint; one canonical tracked installer (#5065).
[CmdletBinding()]
param([switch]$InstallGitleaks, [switch]$SmokeTest, [switch]$Quiet)
& (Join-Path $PSScriptRoot 'install-git-hooks.ps1') @PSBoundParameters
exit $LASTEXITCODE
