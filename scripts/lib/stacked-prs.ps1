# #7911: protect open children BEFORE merging/deleting their base branch.
# Caller supplies Invoke-GhWithRetry and handles failure through Exit-Queue.

function Get-StackedPullRequests {
  param([string]$Repo, [string]$HeadBranch)
  $json = Invoke-GhWithRetry @('pr', 'list', '--repo', $Repo, '--state', 'open', '--base', $HeadBranch, '--limit', '1000', '--json', 'number,baseRefName')
  $rows = ($json -join '') | ConvertFrom-Json -NoEnumerate
  if ($rows -isnot [array] -or $rows.Count -ge 1000) {
    throw 'Stacked PR discovery is invalid or may be truncated.'
  }
  $seen = [Collections.Generic.HashSet[int]]::new()
  foreach ($row in $rows) {
    $number = 0
    if (-not [int]::TryParse([string]$row.number, [ref]$number) -or $number -le 0 -or
        $row.baseRefName -cne $HeadBranch -or -not $seen.Add($number)) {
      throw 'Stacked PR discovery contains invalid or conflicting metadata.'
    }
  }
  return $rows
}

function Get-StackedChildState {
  param([int]$Number, [string]$Repo)
  $json = Invoke-GhWithRetry @('pr', 'view', "$Number", '--repo', $Repo, '--json', 'number,baseRefName,state')
  $child = ($json -join '') | ConvertFrom-Json
  if ($child.number -ne $Number -or $child.state -notin @('OPEN', 'CLOSED', 'MERGED') -or
      [string]::IsNullOrWhiteSpace($child.baseRefName)) {
    throw "Invalid state for stacked PR #$Number."
  }
  return $child
}

function Protect-StackedPullRequests {
  param([int]$Number, [string]$Repo, [string]$ExpectedHead, [switch]$Preview, [hashtable]$PreviewBases = @{})
  $json = Invoke-GhWithRetry @('pr', 'view', "$Number", '--repo', $Repo, '--json', 'number,headRefName,headRefOid,baseRefName,isCrossRepository,state')
  $parent = ($json -join '') | ConvertFrom-Json
  # In dry-run only, an earlier parent may have projected this PR's move.
  # Match its original base so a concurrent, unrelated retarget still stops.
  $projectedMain = $Preview -and $PreviewBases.ContainsKey("$Number") -and $PreviewBases["$Number"] -ceq $parent.baseRefName
  if ($parent.number -ne $Number -or $parent.state -ne 'OPEN' -or ($parent.baseRefName -cne 'main' -and -not $projectedMain) -or
      $ExpectedHead -notmatch '^[0-9a-f]{40}$' -or $parent.headRefOid -cne $ExpectedHead -or
      [string]::IsNullOrWhiteSpace($parent.headRefName) -or ($parent.headRefName -ceq 'main' -and -not $parent.isCrossRepository) -or
      $parent.isCrossRepository -isnot [bool]) {
    throw "PR #$Number changed or lacks valid main-target metadata."
  }
  # A fork's head is not a branch in Repo. A local namesake is unrelated.
  if ($parent.isCrossRepository) { return }
  $branch = [string]$parent.headRefName
  $children = @(Get-StackedPullRequests -Repo $Repo -HeadBranch $branch)
  if ($Preview) {
    foreach ($child in $children) {
      Write-Host "  [dry-run] ville flytte PR #$($child.number) fra '$branch' til main foer merge af #$Number."
      $PreviewBases["$($child.number)"] = $branch
    }
    return
  }
  foreach ($child in $children) {
    $current = Get-StackedChildState -Number $child.number -Repo $Repo
    if ($current.state -ne 'OPEN' -or $current.baseRefName -ceq 'main') { continue }
    if ($current.baseRefName -cne $branch) { throw "Base changed for stacked PR #$($child.number); refusing to overwrite it." }
    Invoke-GhWithRetry @('pr', 'edit', "$($child.number)", '--repo', $Repo, '--base', 'main') | Out-Null
    $verified = Get-StackedChildState -Number $child.number -Repo $Repo
    if ($verified.state -ne 'OPEN' -or $verified.baseRefName -cne 'main') {
      throw "Could not verify stacked PR #$($child.number) open on main."
    }
    Write-Host "  PR #$($child.number): base flyttet til main og genlaest; checks/review skal vurderes mod den nye base."
  }
  # Do not silently merge if another child appeared or moved back during edits.
  if (@(Get-StackedPullRequests -Repo $Repo -HeadBranch $branch).Count -gt 0) {
    throw "Open PRs still target '$branch'; rerun the queue before merging #$Number."
  }
}
