# Invoked only under wave-policy.mjs's idle state lock, including all retries.
param([Parameter(Mandatory)] [int] $Pr, [Parameter(Mandatory)] [string] $Repo)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gh-retry.ps1')
Invoke-GhWithRetry @('pr', 'merge', "$Pr", '--repo', $Repo, '--squash', '--delete-branch', '--admin') | Out-Null
