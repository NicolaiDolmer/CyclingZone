# Dry-run by default. Requires Python 3.11+ (tomllib). Never prints user config.
[CmdletBinding()]
param(
    [string]$ConfigPath = $(if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'config.toml' } else { Join-Path $env:USERPROFILE '.codex/config.toml' }),
    [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) { throw 'Python 3.11+ is required for validated TOML updates.' }
& $pythonCommand.Source -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required for validated TOML updates.' }
$setupArgs = @((Join-Path $PSScriptRoot 'codex_setup.py'), '--config', $ConfigPath)
if ($Apply) { $setupArgs += '--apply' }
& $pythonCommand.Source @setupArgs
exit $LASTEXITCODE
