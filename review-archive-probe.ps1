$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/scripts/lib/archive-worktree-unversioned.ps1"
$probeRoot = Join-Path $PSScriptRoot ('.review-evidence-' + [guid]::NewGuid().ToString('N'))
$fixture = Join-Path $probeRoot 'fixture'
New-Item -ItemType Directory -Path $fixture | Out-Null
& git -C $fixture init --quiet
[IO.File]::WriteAllText((Join-Path $fixture 'draft.txt'), "base`n")
& git -C $fixture add draft.txt
& git -C $fixture -c user.name=ReviewFixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=NUL commit --quiet -m fixture
[IO.File]::WriteAllText((Join-Path $fixture 'draft.txt'), "only-staged-work`n")
& git -C $fixture add draft.txt
[IO.File]::WriteAllText((Join-Path $fixture 'draft.txt'), "base`n")
$env:CZ_WORKTREE_ARCHIVE_ROOT = Join-Path $probeRoot 'archives'
$result = Save-WorktreeUnversioned -WorktreePath $fixture -BaseRef HEAD
$manifest = Get-Content (Join-Path $result.Dir 'manifest.json') -Raw | ConvertFrom-Json
[pscustomobject]@{ Scenario='index differs from HEAD and working tree'; Ok=$result.Ok; TrackedChanges=$manifest.trackedChanges; PatchExists=(Test-Path (Join-Path $result.Dir 'tracked-changes.patch')); StagedDiff=((& git -C $fixture --no-pager diff --cached --stat) -join ' ') } | ConvertTo-Json -Compress
Start-Sleep -Seconds 1
[IO.File]::WriteAllText((Join-Path $fixture 'draft.txt'), "working-change`n")
$result = Save-WorktreeUnversioned -WorktreePath $fixture -BaseRef 'refs/remotes/origin/does-not-exist'
$manifest = Get-Content (Join-Path $result.Dir 'manifest.json') -Raw | ConvertFrom-Json
[pscustomobject]@{ Scenario='base ref missing'; Ok=$result.Ok; Ahead=$manifest.aheadOfBase; BundleExists=(Test-Path (Join-Path $result.Dir 'commits.bundle')) } | ConvertTo-Json -Compress
Write-Output "Fixture retained at $probeRoot; no removal function called"
