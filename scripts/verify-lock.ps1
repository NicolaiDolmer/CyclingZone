# verify-lock.ps1
#
# Fil-baseret semafor for TUNGE verifikationer paa tvaers af worktrees (#5142).
#
# Maalt 11/9 paa DOLMERPC (8 kerner, 32 GB): 9 samtidige workers uden semafor =
# 100 % CPU i timevis (ejeren maatte spoerge to gange hvad der foregik); 6 = 83 %.
# Ejer-beslutningen 11/9 er derfor eet uniformt loft hele doegnet: 4 laner, og
# maks 2 tunge koersler ad gangen (frontend build, backend-suite, Playwright,
# tsc over hele repoet, npm ci) paa tvaers af ALLE worktrees.
#
# Hvorfor en fil-semafor og ikke en mutex: lanerne er separate processer i
# separate worktrees startet af separate agenter, ofte med hver sin pwsh. En
# navngivet mutex ville virke, men efterlader intet spor man kan inspicere naar
# noget haenger. Et slot er her en lille JSON-fil med PID + tidsstempel, saa
# `ls .claude/run/verify-slots` svarer paa "hvem holder slottene lige nu" uden
# vaerktoej, og en doed proces' slot kan ryddes af den naeste der kommer forbi.
#
# Brug:
#   pwsh -File scripts/verify-lock.ps1 -Max 2 -Timeout 1800 -- node --test scripts/foo.test.mjs
#   pwsh -File scripts/verify-lock.ps1 -- npm run build
#   pwsh -File scripts/verify-lock.ps1 -Status          # hvem holder slottene
#
# Exit-kode = kommandoens exit-kode. Timeout uden ledigt slot -> exit 75
# (EX_TEMPFAIL: "proev igen", saa en caller kan skelne koe-timeout fra testfejl).
#
# KENDT HUL: slottet er bundet til WRAPPERENS PID, ikke til hele proces-traeet.
# Draebes wrapperen udefra mens den underliggende kommando koerer videre, vil
# Clear-DeadSlots frigive slottet selvom verifikationen stadig belaster maskinen.
# Bevidst valg: alternativet (Windows job objects / traeafslutning) koster
# betydelig kompleksitet for et scenarie der kraever at nogen draeber netop
# wrapper-processen. Det normale ophoer - kommandoen slutter, finally-blokken
# rydder - er daekket.
#
# Selvtest: node --test scripts/verify-lock.test.mjs
#
# Refs #5142, #4918.

# BEVIDST intet param()-blok: PowerShells parameter-binder afviser et bart "--"
# ("parameter name '' is ambiguous"), ogsaa med ValueFromRemainingArguments. Da
# hele pointen er at kunne skrive `-- <vilkaarlig kommando>` parser vi $args i
# haanden. Fanget af scripts/verify-lock.test.mjs foerste gang scriptet koerte.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Max = 2
$Timeout = 1800
$SlotDir = ""
$Label = ""
$Status = $false
$cmd = @()

$argv = @($args)
$i = 0
while ($i -lt $argv.Count) {
  $a = [string]$argv[$i]
  if ($a -eq '--') {
    $i++
    while ($i -lt $argv.Count) { $cmd += [string]$argv[$i]; $i++ }
    break
  }
  if ($a -ieq '-Max' -and ($i + 1) -lt $argv.Count) { $Max = [int]$argv[$i + 1]; $i += 2; continue }
  if ($a -ieq '-Timeout' -and ($i + 1) -lt $argv.Count) { $Timeout = [int]$argv[$i + 1]; $i += 2; continue }
  if ($a -ieq '-SlotDir' -and ($i + 1) -lt $argv.Count) { $SlotDir = [string]$argv[$i + 1]; $i += 2; continue }
  if ($a -ieq '-Label' -and ($i + 1) -lt $argv.Count) { $Label = [string]$argv[$i + 1]; $i += 2; continue }
  if ($a -ieq '-Status') { $Status = $true; $i++; continue }
  # Alt andet = starten paa kommandoen (saa "-- " kan udelades).
  while ($i -lt $argv.Count) { $cmd += [string]$argv[$i]; $i++ }
  break
}

function Write-Fail([string]$msg) {
  # Write-Error er terminerende under ErrorActionPreference=Stop og ville
  # give exit 1 i stedet for den exit-kode vi vil signalere.
  [Console]::Error.WriteLine($msg)
}

# --- Slot-mappe --------------------------------------------------------------
if (-not $SlotDir) {
  if ($env:CZ_VERIFY_SLOT_DIR) {
    $SlotDir = $env:CZ_VERIFY_SLOT_DIR
  } else {
    $root = (& git rev-parse --show-toplevel 2>$null)
    if (-not $root) { Write-Fail "verify-lock: ikke i et git-repo, og ingen -SlotDir/CZ_VERIFY_SLOT_DIR angivet."; exit 2 }
    $root = $root.Trim().Replace('/', '\')
    # git-common-dir loeser op til HOVED-repoet, saa alle worktrees deler samme
    # slot-mappe. Uden dette ville hvert worktree faa sin egen semafor og loftet
    # ville vaere 2 PR. WORKTREE i stedet for 2 pr. maskine - altsaa ingen semafor.
    $common = (& git -C $root rev-parse --git-common-dir 2>$null)
    if ($common) {
      $common = $common.Trim().Replace('/', '\')
      if (-not [System.IO.Path]::IsPathRooted($common)) {
        $common = [System.IO.Path]::GetFullPath((Join-Path $root $common))
      }
      $mainRepo = Split-Path -Parent $common
      if ($mainRepo -and (Test-Path $mainRepo)) { $root = $mainRepo }
    }
    $SlotDir = Join-Path $root ".claude\run\verify-slots"
  }
}
if (-not (Test-Path $SlotDir)) { New-Item -ItemType Directory -Path $SlotDir -Force | Out-Null }

function Test-PidAlive([int]$processId) {
  if ($processId -le 0) { return $false }
  try { $null = Get-Process -Id $processId -ErrorAction Stop; return $true } catch { return $false }
}

# Rydder slots hvis ejer-proces er doed. En worker der bliver draebt midt i en
# verifikation maa ALDRIG kunne laase semaforen permanent - det ville stoppe
# boelgen i stilhed, praecis den fejlklasse #5142 handler om.
function Clear-DeadSlots {
  foreach ($f in @(Get-ChildItem -Path $SlotDir -Filter "slot-*.json" -File -ErrorAction SilentlyContinue)) {
    $alive = $false
    try {
      $obj = Get-Content -Raw -Path $f.FullName -ErrorAction Stop | ConvertFrom-Json
      $alive = Test-PidAlive ([int]$obj.pid)
    } catch {
      # Ulaeselig eller halvskrevet slot-fil: behandl som doed.
      $alive = $false
    }
    if (-not $alive) {
      try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch {}
    }
  }
}

function Get-LiveSlots {
  Clear-DeadSlots
  return @(Get-ChildItem -Path $SlotDir -Filter "slot-*.json" -File -ErrorAction SilentlyContinue |
    Sort-Object -Property Name)
}

if ($Status) {
  $slots = Get-LiveSlots
  Write-Host "=== verify-lock status ($($slots.Count)/$Max slots i brug) ===" -ForegroundColor Cyan
  Write-Host "Slot-mappe: $SlotDir"
  foreach ($s in $slots) {
    try {
      $o = Get-Content -Raw -Path $s.FullName | ConvertFrom-Json
      Write-Host ("  pid={0} siden={1} label={2}" -f $o.pid, $o.acquiredAt, $o.label)
    } catch { Write-Host "  (ulaeselig: $($s.Name))" }
  }
  exit 0
}

# --- Kommando ----------------------------------------------------------------
$cmd = @($cmd | Where-Object { $_ -ne "" })
if ($cmd.Count -eq 0) {
  Write-Fail "verify-lock: ingen kommando. Brug: pwsh -File scripts/verify-lock.ps1 -Max 2 -Timeout 1800 -- <kommando>"
  exit 2
}

# --- Tag et slot -------------------------------------------------------------
# Optimistisk: skriv egen slot-fil, taeller derefter. Er vi ikke blandt de
# Max foerste (sorteret paa navn, som starter med et sorterbart tidsstempel),
# fjerner vi vores egen igen og venter. Det er en "ticket lock": to processer
# der skriver samtidig faar forskellige filnavne (tid + PID + guid), saa de kan
# ikke begge tro at de vandt.
$myPid = $PID
$deadline = (Get-Date).AddSeconds($Timeout)
$slotFile = $null
$waited = 0

while ($true) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfff")
  $name = "slot-$stamp-$myPid-$([guid]::NewGuid().ToString('N').Substring(0,8)).json"
  $candidate = Join-Path $SlotDir $name
  $payload = [pscustomobject]@{
    pid        = $myPid
    acquiredAt = (Get-Date).ToString("o")
    label      = if ($Label) { $Label } else { ($cmd -join " ") }
  }
  ($payload | ConvertTo-Json -Compress) | Out-File -FilePath $candidate -Encoding utf8 -NoNewline

  $live = Get-LiveSlots
  $rank = [array]::IndexOf(@($live | ForEach-Object { $_.Name }), $name)
  if ($rank -ge 0 -and $rank -lt $Max) {
    $slotFile = $candidate
    break
  }

  try { Remove-Item -LiteralPath $candidate -Force -ErrorAction Stop } catch {}

  if ((Get-Date) -ge $deadline) {
    Write-Fail "verify-lock: ingen ledig slot inden for $Timeout s (Max=$Max, i brug=$($live.Count)). Koer 'pwsh -File scripts/verify-lock.ps1 -Status' for at se hvem der holder dem."
    exit 75
  }
  if ($waited -eq 0) {
    Write-Host "[verify-lock] venter paa slot ($($live.Count)/$Max i brug)..." -ForegroundColor DarkGray
  }
  $waited++
  # Jitter paa ventetiden, saa to processer der taber samtidig ikke proever igen i takt.
  Start-Sleep -Milliseconds (1500 + (Get-Random -Minimum 0 -Maximum 700))
}

# --- Koer kommandoen ---------------------------------------------------------
$exit = 1
try {
  $exe = $cmd[0]
  $rest = @()
  if ($cmd.Count -gt 1) { $rest = $cmd[1..($cmd.Count - 1)] }
  # En fejlende verifikation er et NORMALT udfald for denne wrapper - den skal
  # give exit-koden videre, ikke kaste. PS 7.4 goer ellers native non-zero exit
  # til en terminerende fejl naar ErrorActionPreference er Stop.
  $ErrorActionPreference = "Continue"
  $PSNativeCommandUseErrorActionPreference = $false
  & $exe @rest
  $exit = $LASTEXITCODE
  if ($null -eq $exit) { $exit = 0 }
} catch {
  [Console]::Error.WriteLine("verify-lock: kommandoen fejlede: $($_.Exception.Message)")
  $exit = 1
} finally {
  if ($slotFile) { try { Remove-Item -LiteralPath $slotFile -Force -ErrorAction SilentlyContinue } catch {} }
}

exit $exit
