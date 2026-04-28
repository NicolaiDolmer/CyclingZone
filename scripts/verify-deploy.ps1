param(
  [string]$Sha = "",
  [int]$TimeoutMinutes = 10,
  [string]$BackendUrl = "https://cyclingzone-production.up.railway.app",
  [string]$FrontendAlias = "https://cycling-zone-git-main-nicolai-dolmers-projects.vercel.app"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-GitPath {
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCommand) {
    return $gitCommand.Source
  }

  $desktopRoots = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "GitHubDesktop") -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

  foreach ($root in $desktopRoots) {
    $candidate = Join-Path $root.FullName "resources\app\git\cmd\git.exe"
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Git blev ikke fundet. Installer Git eller GitHub Desktop, eller tilfoej git til PATH."
}

function Invoke-Git {
  param([string[]]$Arguments)
  $output = & $script:GitPath -C $script:RepoRoot @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') fejlede."
  }
  return ($output -join "`n").Trim()
}

function Get-GitHubRepo {
  $remote = Invoke-Git @("remote", "get-url", "origin")
  if ($remote -match "github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(\.git)?$") {
    return @{
      Owner = $Matches.owner
      Repo = $Matches.repo
      FullName = "$($Matches.owner)/$($Matches.repo)"
    }
  }

  throw "Kunne ikke udlede GitHub repo fra origin remote: $remote"
}

function Invoke-GitHubApi {
  param([string]$Path)
  $headers = @{
    "User-Agent" = "CyclingZone-deploy-verify"
    "Accept" = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  $uri = "https://api.github.com/repos/$($script:GitHub.FullName)$Path"
  try {
    return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 30
  } catch {
    throw "GitHub API-kald fejlede: $uri. $($_.Exception.Message)"
  }
}

function Wait-Until {
  param(
    [string]$Label,
    [scriptblock]$Probe,
    [int]$TimeoutMinutes
  )

  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  while ((Get-Date) -lt $deadline) {
    $result = & $Probe
    if ($result.Done) {
      if (-not $result.Ok) {
        throw "$Label fejlede: $($result.Message)"
      }
      Write-Host "[ok] $Label - $($result.Message)"
      return $result
    }

    Write-Host "[wait] $Label - $($result.Message)"
    Start-Sleep -Seconds 10
  }

  throw "$Label timeout efter $TimeoutMinutes minutter."
}

function Test-CiStatus {
  $runs = Invoke-GitHubApi "/actions/runs?branch=main&per_page=20"
  $matching = @($runs.workflow_runs | Where-Object { $_.head_sha -eq $script:Sha })
  if ($matching.Count -eq 0) {
    return @{ Done = $false; Ok = $false; Message = "venter paa GitHub Actions for $($script:Sha.Substring(0, 7))" }
  }

  $unfinished = @($matching | Where-Object { $_.status -ne "completed" })
  if ($unfinished.Count -gt 0) {
    return @{ Done = $false; Ok = $false; Message = "$($unfinished.Count) workflow(s) koerer stadig" }
  }

  $failed = @($matching | Where-Object { $_.conclusion -ne "success" })
  if ($failed.Count -gt 0) {
    $names = ($failed | ForEach-Object { "$($_.name):$($_.conclusion)" }) -join ", "
    return @{ Done = $true; Ok = $false; Message = $names }
  }

  $names = ($matching | ForEach-Object { $_.name } | Sort-Object -Unique) -join ", "
  return @{ Done = $true; Ok = $true; Message = $names }
}

function Test-DeploymentStatus {
  $deployments = @(Invoke-GitHubApi "/deployments?sha=$($script:Sha)&per_page=20" | ForEach-Object { $_ })
  if ($deployments.Count -eq 0) {
    return @{ Done = $false; Ok = $false; Message = "venter paa Vercel/Railway deployments" }
  }

  $needed = @{
    Vercel = "vercel"
    Railway = "railway"
  }

  $messages = @()
  $allOk = $true
  $anyPending = $false

  foreach ($name in $needed.Keys) {
    $needle = $needed[$name]
    $deployment = $deployments | Where-Object { $_.creator.login -like "$needle*" } | Select-Object -First 1
    if (-not $deployment) {
      $anyPending = $true
      $messages += "$name mangler"
      continue
    }

    $statuses = @(Invoke-GitHubApi "/deployments/$($deployment.id)/statuses" | ForEach-Object { $_ })
    $latest = $statuses | Select-Object -First 1
    if (-not $latest) {
      $anyPending = $true
      $messages += "$name status mangler"
      continue
    }

    if ($latest.state -eq "success") {
      $messages += "$name=$($latest.state)"
    } elseif ($latest.state -in @("pending", "in_progress", "queued")) {
      $anyPending = $true
      $messages += "$name=$($latest.state)"
    } else {
      $allOk = $false
      $messages += "$name=$($latest.state)"
    }
  }

  if ($anyPending) {
    return @{ Done = $false; Ok = $false; Message = ($messages -join ", ") }
  }

  return @{ Done = $true; Ok = $allOk; Message = ($messages -join ", ") }
}

function Test-LiveSmoke {
  $health = Invoke-WebRequest -Uri "$BackendUrl/health" -UseBasicParsing -TimeoutSec 30
  if ($health.StatusCode -ne 200) {
    throw "Backend health returnerede $($health.StatusCode)."
  }

  $auctions = Invoke-WebRequest -Uri "$BackendUrl/api/auctions" -UseBasicParsing -TimeoutSec 30 -SkipHttpErrorCheck
  if ($auctions.StatusCode -ne 401) {
    throw "Backend auth smoke forventede 401 fra /api/auctions, fik $($auctions.StatusCode)."
  }

  $frontend = Invoke-WebRequest -Uri $FrontendAlias -UseBasicParsing -TimeoutSec 30 -SkipHttpErrorCheck
  if ($frontend.StatusCode -notin @(200, 401, 403)) {
    throw "Frontend alias returnerede uventet status $($frontend.StatusCode)."
  }

  Write-Host "[ok] Backend /health = 200"
  Write-Host "[ok] Backend /api/auctions uden token = 401"
  Write-Host "[ok] Frontend alias svarer = $($frontend.StatusCode)"
}

$script:RepoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$script:GitPath = Resolve-GitPath
$resolvedRoot = Invoke-Git @("rev-parse", "--show-toplevel")
$normalizedResolvedRoot = [System.IO.Path]::GetFullPath(($resolvedRoot -replace "/", "\"))

if ($normalizedResolvedRoot -ne $script:RepoRoot) {
  throw "Scriptet koeres ikke fra den forventede repo-root. Forventet: $script:RepoRoot. Git siger: $resolvedRoot."
}

$script:GitHub = Get-GitHubRepo
if (-not $Sha) {
  $Sha = Invoke-Git @("rev-parse", "HEAD")
}
$script:Sha = (Invoke-Git @("rev-parse", $Sha)).Trim()

$originMain = (Invoke-Git @("ls-remote", "origin", "refs/heads/main")).Split("`t")[0]
if ($originMain -ne $script:Sha) {
  throw "HEAD/Sha $($script:Sha.Substring(0, 7)) er ikke origin/main ($($originMain.Substring(0, 7))). Push foerst, eller angiv den sha der faktisk er deployet fra main."
}

Write-Host "Verificerer deploy for $($script:GitHub.FullName)@$($script:Sha.Substring(0, 7))"
Wait-Until -Label "GitHub Actions" -Probe { Test-CiStatus } -TimeoutMinutes $TimeoutMinutes | Out-Null
Wait-Until -Label "GitHub deployments" -Probe { Test-DeploymentStatus } -TimeoutMinutes $TimeoutMinutes | Out-Null
Test-LiveSmoke
Write-Host "[done] Deploy verificeret for $($script:Sha.Substring(0, 7))"
