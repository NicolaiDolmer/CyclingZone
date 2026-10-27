# Invoked only under wave-policy.mjs's state lock (guarded-merge), including all retries.
# -HeadSha (#5562): during a running wave the merge is pinned to the head that
# passed the ownership-overlap check, so a later push cannot slip new files in.
param([Parameter(Mandatory)] [int] $Pr, [Parameter(Mandatory)] [string] $Repo, [string] $HeadSha = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gh-retry.ps1')
function Assert-MergeReviewDeadline([string]$Deadline, [datetimeoffset]$Now) {
  if (-not $Deadline) { return }
  if ($Deadline -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$') { throw 'Invalid merge review deadline' }
  $end=[datetimeoffset]::Parse($Deadline,[Globalization.CultureInfo]::InvariantCulture)
  if ($Now -ge $end) { throw 'Merge review deadline expired; no merge attempted' }
}
$mergeArgs = @('pr', 'merge', "$Pr", '--repo', $Repo, '--squash', '--delete-branch', '--admin')
if ($HeadSha) {
  if ($HeadSha -notmatch '^[0-9a-fA-F]{40}$') { throw "Invalid -HeadSha '$HeadSha'" }
  $mergeArgs += @('--match-head-commit', $HeadSha)
}
# Executed inside the state lock, including before every retried merge call.
Invoke-GhWithRetry $mergeArgs -BeforeAttempt {
  Assert-MergeReviewDeadline -Deadline $env:CZ_MERGE_REVIEW_DEADLINE_UTC -Now ([datetimeoffset]::UtcNow)
} | Out-Null
