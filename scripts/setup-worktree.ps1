# setup-worktree.ps1
#
# Idempotent setup af et EKSISTERENDE worktree (harness-oprettet eller manuelt).
# Kontrakt: NAAR SCRIPTET ER FAERDIGT MED EXIT 0 ER WORKTREET KLAR — det har
# fungerende node_modules for rod/backend/frontend OG .env-filer. Fejler noget af
# det, exit'er scriptet 1 med en handlingsorienteret besked (aldrig et stille skip).
#
#   1. node_modules-junctions -> et DELT, LOCKFILE-HASHET cache-install
#      (%LOCALAPPDATA%\CyclingZone\node-modules-cache\<pkg>-<hash>\node_modules)
#   2. .env-hardlinks (backend/.env, frontend/.env, frontend/.env.production,
#      .mcp.json) fra OneDrive-context\secrets, med main-checkoutet som fallback
#
# ISOLATION (#3367, afloeser #2967-junction-til-main):
# Tidligere pegede junctionen paa MAIN-checkoutets node_modules. `npm ci` sletter
# node_modules foer den geninstallerer, og sletningen foeres igennem junctionen —
# saa en enkelt `npm ci` i et worktree toemte ejerens hoved-checkout (3 gange paa
# een nat, 4.-5./8). En preinstall-guard kan IKKE fange det: `npm ci` sletter
# node_modules FOER preinstall koerer (verificeret npm 11.13.0).
#
# Derfor peger junctionen nu paa et delt cache-install uden for begge checkouts:
#   - Hoved-checkoutet kan ikke laengere naas fra et worktree. Struktureslt, ikke
#     ved disciplin.
#   - Rammer en agent alligevel cachen med `npm ci`, er skaden selv-helende:
#     naeste setup-koersel opdager en usund cache og genopbygger den.
#   - Cachen er noeglet paa package-lock.json-hash, saa en branch med aendrede
#     dependencies automatisk faar sit eget install (#2967's korrekthedsproblem).
#
# SIKKERHED (jf. #634 + repoets secret-leak-regler): env-linking sker via
# `mklink /H` (hardlink). Scriptet LAESER aldrig secret-vaerdierne og dumper dem
# aldrig — det laver kun filsystem-links.
#
# Brug:
#   pwsh -File scripts/setup-worktree.ps1                 # auto-detect via git (CWD = worktree)
#   pwsh -File scripts/setup-worktree.ps1 -DryRun         # rapportér uden at skrive
#   pwsh -File scripts/setup-worktree.ps1 -Quiet          # kun warnings/fejl (hook-mode)
#   pwsh -File scripts/setup-worktree.ps1 -Rebuild        # tving genopbygning af usunde links/cache
#   pwsh -File scripts/setup-worktree.ps1 -WorktreeRoot <wt> -MainRepoRoot <main>
#
# Refs #994, #2967, #3367.

param(
  [string] $WorktreeRoot,
  [string] $MainRepoRoot,
  [string] $CacheRoot,
  [switch] $DryRun,
  [switch] $Quiet,
  [switch] $Rebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:Problems = @()

function Write-Info($msg, $color = "Gray") {
  if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}
function Write-Warn($msg) {
  Write-Host $msg -ForegroundColor Yellow
}
function Write-Problem($msg) {
  $script:Problems += $msg
  Write-Host $msg -ForegroundColor Red
}
function Write-Section($title) {
  if (-not $Quiet) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
  }
}

# --- Path-detektion (fallback til git når params ikke er givet) ---
function Resolve-FullPath([string]$p) {
  return [System.IO.Path]::GetFullPath(($p -replace '/','\'))
}

if (-not $WorktreeRoot) {
  $top = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $top) {
    Write-Info "[skip] Ikke i et git-repo (git rev-parse fejlede)." "Yellow"
    exit 0
  }
  $WorktreeRoot = Resolve-FullPath ($top.Trim())
}
$WorktreeRoot = Resolve-FullPath $WorktreeRoot

if (-not $MainRepoRoot) {
  $commonDir = (& git -C $WorktreeRoot rev-parse --git-common-dir 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $commonDir) {
    Write-Info "[skip] Kunne ikke finde git-common-dir." "Yellow"
    exit 0
  }
  $commonDir = $commonDir.Trim()
  if (-not [System.IO.Path]::IsPathRooted($commonDir)) {
    $commonDir = Join-Path $WorktreeRoot $commonDir
  }
  $commonDir = Resolve-FullPath $commonDir
  $MainRepoRoot = Split-Path $commonDir -Parent
}
$MainRepoRoot = Resolve-FullPath $MainRepoRoot

if (-not $CacheRoot) {
  $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
  $CacheRoot = Join-Path $localAppData "CyclingZone\node-modules-cache"
}
$CacheRoot = Resolve-FullPath $CacheRoot

$mode = if ($DryRun) { " [DRY-RUN]" } else { "" }
Write-Info "Worktree:  $WorktreeRoot$mode"
Write-Info "Main repo: $MainRepoRoot"
Write-Info "Cache:     $CacheRoot"

if ($WorktreeRoot -eq $MainRepoRoot) {
  # Vi er i selve main-repoet — node_modules + .env er rigtige filer her, ikke links.
  # setup-worktree er kun relevant for et separat worktree. No-op.
  Write-Info "[skip] Kører i main-repoet (ikke et separat worktree) — intet at linke." "Yellow"
  exit 0
}

# --- Hjælpere ---

# En node_modules-mappe er "sund" hvis npm har efterladt sit install-manifest
# OG der faktisk ligger pakker. Ren Test-Path er IKKE nok: en junction til et
# toemt maal, eller en halvfaerdig install, bestaar Test-Path og giver saa
# ERR_MODULE_NOT_FOUND senere (symptomet 4.-5./8).
function Test-NodeModulesHealthy([string]$nm) {
  if (-not (Test-Path $nm)) { return $false }
  if (-not (Test-Path (Join-Path $nm ".package-lock.json"))) { return $false }
  $firstPkg = Get-ChildItem $nm -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  return ($null -ne $firstPkg)
}

function Get-LinkTarget([string]$p) {
  $item = Get-Item $p -Force -ErrorAction SilentlyContinue
  if (-not $item) { return $null }
  foreach ($prop in @('LinkTarget', 'Target')) {
    if ($item.PSObject.Properties.Name -contains $prop) {
      $v = $item.$prop
      if ($v) { return (@($v)[0]) }
    }
  }
  return $null
}

function Test-IsJunction([string]$p) {
  if (-not (Test-Path $p)) { return $false }
  $item = Get-Item $p -Force -ErrorAction SilentlyContinue
  if (-not $item) { return $false }
  return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Remove-JunctionPoint([string]$p) {
  # rmdir fjerner KUN reparse-punktet, ikke maalet. Remove-Item -Recurse ville
  # foelge junctionen og slette maalets indhold — praecis den fejl vi bekaemper.
  & cmd /c rmdir /Q "$p" 2>&1 | Out-Null
  return -not (Test-Path $p)
}

function Get-LockHash([string]$dir) {
  $lock = Join-Path $dir 'package-lock.json'
  if (-not (Test-Path $lock)) { return $null }
  return (Get-FileHash -Path $lock -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
}

# Byg (eller genbrug) et delt cache-install for en given lockfile-hash.
# Cachen ligger uden for BEGGE checkouts, saa en destruktiv npm-operation i et
# worktree aldrig kan naa hoved-checkoutet.
function Get-CachedNodeModules([string]$pkgName, [string]$srcDir, [string]$hash) {
  $cacheDir = Join-Path $CacheRoot "$pkgName-$hash"
  $cacheNm = Join-Path $cacheDir 'node_modules'

  if (Test-NodeModulesHealthy $cacheNm) {
    Write-Info "  [cache-hit] $pkgName-$hash"
    return $cacheNm
  }

  if ($DryRun) {
    Write-Info "  [would-build-cache] npm ci i $cacheDir" "Cyan"
    return $cacheNm
  }

  Write-Info "  [cache-miss] bygger $pkgName-$hash (npm ci, engangs pr. lockfile)..." "Yellow"
  New-Item -ItemType Directory $cacheDir -Force | Out-Null

  # En usund cache genopbygges fra bunden. Cachen ejes af dette script alene —
  # ingen checkout peger paa dens indhold uden om junctionerne, saa det er sikkert.
  if (Test-Path $cacheNm) {
    Remove-Item $cacheNm -Recurse -Force -ErrorAction SilentlyContinue
  }

  foreach ($f in @('package.json', 'package-lock.json', '.npmrc')) {
    $src = Join-Path $srcDir $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $cacheDir $f) -Force }
  }

  $ciExit = 1
  Push-Location $cacheDir
  try {
    & npm ci --no-audit --no-fund 2>&1 | Out-String | Out-Null
    $ciExit = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($ciExit -ne 0 -or -not (Test-NodeModulesHealthy $cacheNm)) {
    Write-Problem "  [FEJL] npm ci fejlede i cachen ($cacheDir, exit $ciExit)."
    Write-Problem "         Koer den manuelt dér, eller giv worktreet sit eget install:"
    Write-Problem "         cd $WorktreeRoot; npm ci --prefix $pkgName"
    return $null
  }
  Write-Info "  [ok] cache bygget: $cacheDir"
  return $cacheNm
}

# --- 1. node_modules (junction til delt, lockfile-hashet cache) ---
function Set-NodeModulesLinks {
  Write-Section "node_modules (delt cache, isoleret fra hoved-checkoutet)"

  $packages = @(
    @{ Name = 'root';     Rel = '' },
    @{ Name = 'backend';  Rel = 'backend' },
    @{ Name = 'frontend'; Rel = 'frontend' }
  )

  foreach ($pkg in $packages) {
    $srcDir = if ($pkg.Rel) { Join-Path $WorktreeRoot $pkg.Rel } else { $WorktreeRoot }
    $label = if ($pkg.Rel) { "$($pkg.Rel)\node_modules" } else { "node_modules" }
    $dst = Join-Path $srcDir 'node_modules'

    if (-not (Test-Path (Join-Path $srcDir 'package.json'))) {
      Write-Info "  [skip] $label — ingen package.json"
      continue
    }

    $hash = Get-LockHash $srcDir
    if (-not $hash) {
      Write-Problem "  [FEJL] $label — package-lock.json mangler i worktreet; kan ikke afgoere pakke-saet."
      continue
    }

    # Allerede sund OG ikke tvunget rebuild? Lad vaere. Men en junction skal
    # ogsaa pege paa den RIGTIGE cache — ellers koerer worktreet mod en anden
    # branchs pakker (#2967's stille korrektheds-fejl).
    $expectedTarget = Join-Path (Join-Path $CacheRoot "$($pkg.Name)-$hash") 'node_modules'
    if ((-not $Rebuild) -and (Test-NodeModulesHealthy $dst)) {
      if (-not (Test-IsJunction $dst)) {
        Write-Info "  [skip] $label — eget install, sundt (roeres ikke)"
        continue
      }
      $current = Get-LinkTarget $dst
      if ($current -and ((Resolve-FullPath $current) -eq $expectedTarget)) {
        Write-Info "  [skip] $label — junction peger allerede rigtigt"
        continue
      }
      Write-Info "  [relink] $label — junction peger paa $current (forventet $expectedTarget)" "Yellow"
    }

    $cacheNm = Get-CachedNodeModules $pkg.Name $srcDir $hash
    if (-not $cacheNm) { continue }

    if (Test-Path $dst) {
      if (Test-IsJunction $dst) {
        if ($DryRun) {
          Write-Info "  [would-rmdir-junction] $label" "Cyan"
        } elseif (-not (Remove-JunctionPoint $dst)) {
          Write-Problem "  [FEJL] $label — kunne ikke fjerne junction-punktet (fil i brug?)."
          continue
        }
      } else {
        # Rigtig mappe, men usund (eller -Rebuild). Reparér i worktreet — det er
        # worktreets egen mappe, saa npm ci her rammer ingen andre.
        if ($DryRun) {
          Write-Info "  [would-npm-ci] eget usundt install i $label" "Cyan"
          continue
        }
        Write-Info "  [repair] $label — eget install er usundt, koerer npm ci lokalt..." "Yellow"
        $exit = 1
        Push-Location $srcDir
        try {
          & npm ci --no-audit --no-fund 2>&1 | Out-String | Out-Null
          $exit = $LASTEXITCODE
        } finally { Pop-Location }
        if ($exit -ne 0 -or -not (Test-NodeModulesHealthy $dst)) {
          Write-Problem "  [FEJL] $label — npm ci fejlede (exit $exit). Koer manuelt i $srcDir."
        } else {
          Write-Info "  [ok] $label repareret lokalt"
        }
        continue
      }
    }

    if ($DryRun) {
      Write-Info "  [would-junction] $dst -> $cacheNm" "Cyan"
      continue
    }

    New-Item -ItemType Junction -Path $dst -Target $cacheNm -ErrorAction SilentlyContinue | Out-Null
    if (Test-NodeModulesHealthy $dst) {
      Write-Info "  [ok] $label -> $cacheNm"
    } else {
      Write-Problem "  [FEJL] $label — junction blev ikke oprettet/sund."
    }
  }
}

# --- 2. .env-hardlinks (OneDrive-secrets, med main-checkoutet som fallback) ---
function Set-EnvHardlinks {
  Write-Section ".env hardlinks"

  # OneDrive-secrets bruger '.' i navnet (backend.env), worktree bruger '\.env'
  $envMap = [ordered]@{
    'backend\.env'             = 'backend.env'
    'frontend\.env'            = 'frontend.env'
    'frontend\.env.production' = 'frontend.env.production'
    '.mcp.json'                = 'mcp.json'
  }
  # Uden disse fejler backend `node --test` med "supabaseUrl is required" — den
  # praecise fejl der ramte ~120 testfiler 5/8. Derfor er de en hard gate.
  $required = @('backend\.env', 'frontend\.env')

  $secretsRoot = $null
  if ($env:OneDrive) {
    $candidate = Join-Path $env:OneDrive "CyclingZone-context\secrets"
    if (Test-Path $candidate) { $secretsRoot = $candidate }
  }
  if (-not $secretsRoot) {
    Write-Warn "  [warn] OneDrive-secrets ikke fundet — falder tilbage til main-checkoutet."
  }

  foreach ($k in $envMap.Keys) {
    $dst = Join-Path $WorktreeRoot $k

    # Idempotent: rør ikke en fil der allerede er på plads (hardlink ELLER rigtig fil).
    # Vi sletter aldrig en eksisterende .env → ingen risiko for at klippe lokalt indhold.
    if (Test-Path $dst) {
      Write-Info "  [skip] $k findes allerede"
      continue
    }

    # Kilde-kaede: OneDrive-secret -> main-checkoutets egen fil. Main-fallbacken er
    # det der goer setup robust naar OneDrive er offline/ikke-hydreret; mains
    # .env er selv et hardlink til samme OneDrive-fil, saa indholdet er identisk.
    $sources = @()
    if ($secretsRoot) { $sources += (Join-Path $secretsRoot $envMap[$k]) }
    $sources += (Join-Path $MainRepoRoot $k)

    $src = $sources | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $src) {
      Write-Warn "  [warn] ingen kilde til $k (proevede: $($sources -join ', '))"
      continue
    }

    $parent = Split-Path $dst -Parent
    if ($parent -and -not (Test-Path $parent)) {
      if ($DryRun) { Write-Info "  [would-mkdir] $parent" "Cyan" }
      else { New-Item -ItemType Directory $parent -Force | Out-Null }
    }
    if ($DryRun) {
      Write-Info "  [would-hardlink] $k -> $src" "Cyan"
      continue
    }
    # cmd /c mklink /H: mere tolerant overfor OneDrive cloud-files end New-Item -HardLink.
    # Læser ALDRIG fil-indholdet — laver kun et filsystem-hardlink.
    $out = & cmd /c mklink /H "$dst" "$src" 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dst)) {
      # Sidste udvej: kopi. Hardlink fejler paa tvaers af volumener og paa
      # dehydrerede OneDrive-filer; en kopi er stadig bedre end intet .env.
      Write-Warn "  [warn] mklink fejlede for $k ($out) — kopierer i stedet"
      Copy-Item $src $dst -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $dst) { Write-Info "  [ok] $k" }
  }

  foreach ($r in $required) {
    if (-not (Test-Path (Join-Path $WorktreeRoot $r))) {
      if ($DryRun) { continue }
      Write-Problem "  [FEJL] $r mangler — backend/frontend-tests vil fejle med 'supabaseUrl is required'."
      Write-Problem "         Fix: infisical export --env=dev > $(Join-Path $WorktreeRoot 'backend\.env')"
    }
  }
}

Set-NodeModulesLinks
Set-EnvHardlinks

Write-Info ""
if ($DryRun) {
  Write-Info "Dry-run færdig. Kør uden -DryRun for at anvende." "Green"
  exit 0
}

if ($script:Problems.Count -gt 0) {
  Write-Host ""
  Write-Host "Worktree-setup UFULDSTAENDIG ($($script:Problems.Count) problem(er)): $WorktreeRoot" -ForegroundColor Red
  Write-Host "Koer 'pwsh -File scripts/setup-worktree.ps1 -Rebuild' efter at have loest ovenstaaende." -ForegroundColor Yellow
  exit 1
}

Write-Info "Worktree-setup færdig: $WorktreeRoot" "Green"
exit 0
