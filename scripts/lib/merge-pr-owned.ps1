# Invoked only under wave-policy.mjs's state lock (guarded-merge), including all retries.
# -HeadSha (#5562): during a running wave the merge is pinned to the head that
# passed the ownership-overlap check, so a later push cannot slip new files in.
param([Parameter(Mandatory)] [int] $Pr, [Parameter(Mandatory)] [string] $Repo, [string] $HeadSha = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gh-retry.ps1')
$mergeArgs = @('pr', 'merge', "$Pr", '--repo', $Repo, '--squash', '--delete-branch', '--admin')
if ($HeadSha) {
  if ($HeadSha -notmatch '^[0-9a-fA-F]{40}$') { throw "Invalid -HeadSha '$HeadSha'" }
  $mergeArgs += @('--match-head-commit', $HeadSha)
}
Invoke-GhWithRetry $mergeArgs | Out-Null
