# test-archive-worktree-unversioned.ps1 - regressioner for Save-WorktreeUnversioned (#7837, Codex-review #7839).
#   pwsh -NoProfile -File scripts/test-archive-worktree-unversioned.ps1
# Bygger et midlertidigt repo, arkiverer til en midlertidig mappe og sletter intet uden for dem.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\archive-worktree-unversioned.ps1')

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("cz-archive-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$repo = Join-Path $tmp 'repo'; $arch = Join-Path $tmp 'archive'
New-Item -ItemType Directory -Force -Path $repo, $arch | Out-Null
$env:CZ_WORKTREE_ARCHIVE_ROOT = $arch
$fails = 0
function Check($cond, $msg) { if ($cond) { Write-Host "ok   $msg" } else { Write-Host "FAIL $msg" -ForegroundColor Red; $script:fails++ } }
function G { & git -C $repo @args 2>&1 | Out-Null }

try {
  G init -q; G config user.email t@t; G config user.name t; G config commit.gpgsign false
  Set-Content -LiteralPath (Join-Path $repo 'draft.txt') -Value 'base' -NoNewline
  G add draft.txt; G commit -q -m base

  # 1. Kun staged arbejde: index har nyt indhold, working tree er tilbage paa base.
  Set-Content -LiteralPath (Join-Path $repo 'draft.txt') -Value 'only-staged-work' -NoNewline
  G add draft.txt
  Set-Content -LiteralPath (Join-Path $repo 'draft.txt') -Value 'base' -NoNewline
  $r = Save-WorktreeUnversioned -WorktreePath $repo -BaseRef 'HEAD'
  Check $r.Ok 'staged: Ok'
  $sp = Join-Path $r.Dir 'staged-changes.patch'
  Check (Test-Path -LiteralPath $sp) 'staged: staged-changes.patch findes'
  Check ((Get-Content -LiteralPath $sp -Raw) -match 'only-staged-work') 'staged: patchen indeholder det staged arbejde'
  Check (Test-Path -LiteralPath (Join-Path $r.Dir 'unstaged-changes.patch')) 'staged: unstaged-changes.patch findes (working tree != index)'
  G reset -q --hard

  # 2. Ukendt base-ref, lokal commit uden remote: commits.bundle skal stadig laves.
  Set-Content -LiteralPath (Join-Path $repo 'more.txt') -Value 'commit' -NoNewline
  G add more.txt; G commit -q -m more
  $r = Save-WorktreeUnversioned -WorktreePath $repo -BaseRef 'refs/heads/findes-ikke'
  Check $r.Ok 'ukendt base: Ok'
  Check (Test-Path -LiteralPath (Join-Path $r.Dir 'commits.bundle')) 'ukendt base: commits.bundle findes'
  $m = Get-Content -LiteralPath (Join-Path $r.Dir 'manifest.json') -Raw | ConvertFrom-Json
  Check ($m.unpushedCommits -ge 2) 'ukendt base: manifest taeller upushede commits'

  # 3. Ignorerede og nye filer kommer med; node_modules og .env ikke.
  Set-Content -LiteralPath (Join-Path $repo '.gitignore') -Value "out/`n.env`nnode_modules/" ; G add .gitignore; G commit -q -m ignore
  New-Item -ItemType Directory -Force -Path (Join-Path $repo 'out'), (Join-Path $repo 'node_modules\x') | Out-Null
  Set-Content -LiteralPath (Join-Path $repo 'out\maaling.md') -Value 'ignoreret arbejde'
  Set-Content -LiteralPath (Join-Path $repo 'ny.md') -Value 'ny fil'
  Set-Content -LiteralPath (Join-Path $repo '.env') -Value 'SECRET=x'
  Set-Content -LiteralPath (Join-Path $repo 'node_modules\x\i.js') -Value 'x'
  $r = Save-WorktreeUnversioned -WorktreePath $repo
  Check $r.Ok 'filer: Ok'
  $list = Get-Content -LiteralPath (Join-Path $r.Dir 'files.txt')
  Check (($list -contains 'out/maaling.md') -and ($list -contains 'ny.md')) 'filer: ignoreret og ny fil arkiveret'
  Check (-not ($list -match '^\.env$|node_modules')) 'filer: .env og node_modules udeladt'

  # 4. Ikke et git-repo: Ok=false (intet antages).
  $notRepo = Join-Path $tmp 'not-a-repo'; New-Item -ItemType Directory -Force -Path $notRepo | Out-Null
  $r = Save-WorktreeUnversioned -WorktreePath $notRepo
  Check (-not $r.Ok) 'ukendt status: Ok=false'
} catch {
  Write-Host "FAIL undtagelse: $($_.Exception.Message) ($($_.InvocationInfo.ScriptLineNumber))" -ForegroundColor Red; $fails++
} finally {
  Remove-Item Env:\CZ_WORKTREE_ARCHIVE_ROOT -ErrorAction SilentlyContinue
  # Kun den midlertidige testmappe (ingen links i den); git-objekter er skrivebeskyttede.
  Get-ChildItem -LiteralPath $tmp -Recurse -Force -File | ForEach-Object { $_.IsReadOnly = $false }
  [IO.Directory]::Delete($tmp, $true)
}
if ($fails -gt 0) { Write-Host "$fails fejl" -ForegroundColor Red; exit 1 }
Write-Host 'alle arkiv-tests groenne'
