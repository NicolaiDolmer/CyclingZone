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
# noget haenger. Et slot er her en lille JSON-fil med PID + starttid +
# tidsstempel, saa `ls .claude/run/verify-slots` svarer paa "hvem holder
# slottene lige nu" uden vaerktoej, og en doed proces' slot kan ryddes af den
# naeste der kommer forbi.
#
# Slot-filer: navnet er slot-<utc-stamp>-<pid>-<guid8>.json og raekkefoelgen er
# sortering paa navn. Indholdet er pid, startedAt (processens starttid i UTC,
# round-trip-format), acquiredAt og label. Aeldre versioner af scriptet deler
# samme mappe under og efter en opdatering, saa navneformat, sortering og
# felterne pid/acquiredAt/label er bevidst uaendrede; en fil uden startedAt
# (skrevet af en aeldre version) vurderes paa PID alene.
#
# Oprydning (#5566, boelge B 23/9): en wrapper der tabte rangeringen proevede
# at slette sin kandidat EEN gang. Laeste en anden proces filen i samme
# oejeblik (Get-Content deler ikke FileShare.Delete), blev filen liggende med
# wrapperens LEVENDE PID og talte som optaget slot, ogsaa mod wrapperen selv,
# indtil processen doede. Derfor nu:
#   - al laesning af slot-filer aabner med FileShare ReadWrite+Delete, saa en
#     laeser aldrig blokerer en sletning;
#   - een slet-helper med retry og kort eksponentiel backoff; lykkes den ikke,
#     huskes filen og proeves igen i hver venterunde, foer kommandoen og i
#     finally, der rydder ALLE egne slot-filer;
#   - egne efterladte filer (egen PID i navnet) taeller aldrig mod en selv;
#   - et slot hvis PID lever men hvis starttid ikke matcher er PID-genbrug og
#     dermed doedt. Tolerancen er hele sekunder: en starttid afledt af uret kan
#     drive lidt mellem to maalinger (laeringen fra #5533), og drift maa aldrig
#     goere et levende slot doedt;
#   - en ulaeselig slot-fil der er under $UnreadableGraceSec gammel er
#     sandsynligvis en kandidat under skrivning og taeller som levende i stedet
#     for at blive slettet under skriveren.
#   - scriptet kraever PowerShell 7+ (diff-tjek 24/9, #5566): Read-SlotInfo
#     bruger System.Text.Json, som ikke findes i Windows PowerShell 5.1. Uden
#     dette ville ETHVER kald under 5.1 ramme catch-all'en i Get-LiveSlots og
#     behandle en levende, velformet slot-fil som ulaeselig - og slette den
#     naar den er aeldre end $UnreadableGraceSec. Alle nuvaerende kaldere
#     bruger allerede pwsh 7; dette er et haerdnings-gitter, ikke en
#     adfaerdsaendring.
#
# Brug:
#   pwsh -File scripts/verify-lock.ps1 -Max 2 -Timeout 1800 -- node --test scripts/foo.test.mjs
#   pwsh -File scripts/verify-lock.ps1 -- npm run build
#   pwsh -File scripts/verify-lock.ps1 -Status          # hvem holder slottene
#
# Exit-kode = kommandoens exit-kode. Timeout uden ledigt slot -> exit 75
# (EX_TEMPFAIL: "proev igen", saa en caller kan skelne koe-timeout fra testfejl).
#
# KENDT HUL:
#   1. Slottet er bundet til WRAPPERENS PID, ikke til hele proces-traeet.
#      Draebes wrapperen udefra mens den underliggende kommando koerer videre,
#      vil oprydningen frigive slottet selvom verifikationen stadig belaster
#      maskinen. Bevidst valg: alternativet (Windows job objects /
#      traeafslutning) koster betydelig kompleksitet for et scenarie der kraever
#      at nogen draeber netop wrapper-processen. Det normale ophoer - kommandoen
#      slutter, finally-blokken rydder - er daekket.
#   2. En egen fil der slet ikke kan slettes (en aeldre version eller et andet
#      program holder den aaben uden FileShare.Delete i laengere tid) taeller
#      som optaget for ANDRE indtil et senere forsoeg lykkes. Efter processens
#      doed ryddes den af den naeste der kommer forbi.
#   3. En aeldre version af scriptet laeser stadig uden FileShare.Delete og
#      sletter kun een gang, saa den kan selv laekke sin kandidat indtil alle
#      worktrees er opdateret. Den nye version rydder ikke en fil hvis ejer
#      lever; det ville bryde semaforen.
#   4. Paa Linux beregner .NET starttiden ud fra uret; et urspring stoerre end
#      tolerancen kan faa et levende slot til at ligne PID-genbrug og slippe een
#      ekstra koersel ind. Paa Windows er starttiden fast.
#
# Selvtest: node --test scripts/verify-lock.test.mjs
#
# Refs #5142, #4918, #5566.

# BEVIDST intet param()-blok: PowerShells parameter-binder afviser et bart "--"
# ("parameter name '' is ambiguous"), ogsaa med ValueFromRemainingArguments. Da
# hele pointen er at kunne skrive `-- <vilkaarlig kommando>` parser vi $args i
# haanden. Fanget af scripts/verify-lock.test.mjs foerste gang scriptet koerte.
#Requires -Version 7
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
# Absolut sti, saa egne filer genkendes ens uanset hvordan stien blev skrevet.
$SlotDir = (Resolve-Path -LiteralPath $SlotDir).ProviderPath

# Starttider der afviger mindre end dette (hele sekunder) er samme proces.
$StartTimeToleranceSec = 2
# En ulaeselig slot-fil yngre end dette taeller som levende (kandidat under skrivning).
$UnreadableGraceSec = 10

# Testsoem (#5566): de foerste N sletninger i denne proces fejler med vilje, saa
# retry og udskudt sletning kan testes hvor en aaben fil aldrig blokerer en
# sletning (Linux). Kun til scripts/verify-lock.test.mjs.
$script:injectedDeleteFailures = 0
if ($env:CZ_VERIFY_LOCK_TEST_FAIL_DELETES) { $script:injectedDeleteFailures = [int]$env:CZ_VERIFY_LOCK_TEST_FAIL_DELETES }

# PID-delen af slot-<stamp>-<pid>-<guid8>.json; 0 hvis navnet ikke passer.
function Get-SlotNamePid([string]$name) {
  if ($name -match '^slot-[^-]+-(\d+)-[^-]+\.json$') { return [int]$Matches[1] }
  return 0
}

function ConvertTo-UtcInstant([string]$text) {
  $parsed = [DateTimeOffset]::MinValue
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal
  if ([DateTimeOffset]::TryParse($text, $culture, $styles, [ref]$parsed)) { return $parsed.UtcDateTime }
  return $null
}

# Lever slottets ejer? PID skal leve, og har filen en starttid, skal den matche
# processens (ellers er PID'et genbrugt). Kan starttiden ikke afgoeres, er
# svaret forsigtigt "levende" som foer #5566.
function Test-SlotOwnerAlive([int]$processId, [string]$startedAt) {
  if ($processId -le 0) { return $false }
  $proc = $null
  try { $proc = Get-Process -Id $processId -ErrorAction Stop } catch { return $false }
  if (-not $startedAt) { return $true }
  $recorded = ConvertTo-UtcInstant $startedAt
  if ($null -eq $recorded) { return $true }
  $actual = $null
  try { $actual = $proc.StartTime.ToUniversalTime() } catch { return $true }
  return ([math]::Abs(($actual - $recorded).TotalSeconds) -lt $StartTimeToleranceSec)
}

# Laeser en slot-fil uden nogensinde at blokere at ejeren sletter den (#5566).
# Kaster ved manglende, ulaeselig eller ugyldig fil.
function Read-SlotInfo([string]$path) {
  $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  $text = $null
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
  try {
    $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $true)
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $fs.Dispose() }

  # JsonDocument i stedet for ConvertFrom-Json: den omdanner ikke datoer til
  # lokal tid bag vores ryg, saa startedAt kommer ud som den blev skrevet.
  $doc = [System.Text.Json.JsonDocument]::Parse($text)
  try {
    $info = [ordered]@{ pid = 0; startedAt = ""; acquiredAt = ""; label = "" }
    foreach ($prop in $doc.RootElement.EnumerateObject()) {
      $v = $prop.Value
      switch ($prop.Name) {
        "pid" { $info.pid = $v.GetInt32() }
        default {
          if ($info.Contains($prop.Name) -and $v.ValueKind -eq [System.Text.Json.JsonValueKind]::String) {
            $info[$prop.Name] = $v.GetString()
          }
        }
      }
    }
    return $info
  } finally { $doc.Dispose() }
}

function Invoke-SlotDelete([string]$path) {
  if ($script:injectedDeleteFailures -gt 0) {
    $script:injectedDeleteFailures--
    throw [System.IO.IOException]::new("verify-lock testsoem: injiceret slettefejl")
  }
  [System.IO.File]::Delete($path)
}

# DEN slet-helper (#5566): retry med eksponentiel backoff (50, 100, 200, 400,
# 800 ms mellem 6 forsoeg = ca. 1,6 s). $true naar filen er vaek, ogsaa hvis den
# allerede var det. $false = en anden proces holder den stadig.
function Remove-SlotFile([string]$path, [int]$attempts = 6) {
  $delayMs = 50
  for ($n = 1; $n -le $attempts; $n++) {
    try {
      Invoke-SlotDelete $path
      return $true
    } catch [System.IO.DirectoryNotFoundException] {
      return $true
    } catch {
      if ($n -lt $attempts) { Start-Sleep -Milliseconds $delayMs; $delayMs *= 2 }
    }
  }
  return $false
}

# Klassificerer slot-filerne sorteret paa navn og returnerer de levende. Doede
# fremmede slots slettes med eet forsoeg (den naeste der kommer forbi proever
# igen). Med -OwnPid laeses filer med den PID i navnet ikke; de markeres Own,
# og kalderen afgoer om de taeller.
function Get-LiveSlots([int]$OwnPid = 0) {
  $live = New-Object System.Collections.Generic.List[object]
  $files = @(Get-ChildItem -LiteralPath $SlotDir -Filter "slot-*.json" -File -ErrorAction SilentlyContinue |
    Sort-Object -Property Name)
  foreach ($f in $files) {
    if ($OwnPid -gt 0 -and (Get-SlotNamePid $f.Name) -eq $OwnPid) {
      $live.Add([pscustomobject]@{ Name = $f.Name; FullName = $f.FullName; Own = $true; Info = $null })
      continue
    }
    $info = $null
    try {
      $info = Read-SlotInfo $f.FullName
    } catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] {
      # Slettet mellem listning og laesning: ikke et slot.
      continue
    } catch {
      # Ulaeselig eller halvskrevet. Ung = sandsynligvis en kandidat under
      # skrivning (eller en fil der er ved at blive slettet): taeller. Gammel = doed.
      $age = ((Get-Date).ToUniversalTime() - $f.LastWriteTimeUtc).TotalSeconds
      if ($age -lt $UnreadableGraceSec) {
        $live.Add([pscustomobject]@{ Name = $f.Name; FullName = $f.FullName; Own = $false; Info = $null })
      } else {
        $null = Remove-SlotFile $f.FullName 1
      }
      continue
    }
    if (Test-SlotOwnerAlive $info.pid $info.startedAt) {
      $live.Add([pscustomobject]@{ Name = $f.Name; FullName = $f.FullName; Own = $false; Info = $info })
    } else {
      $null = Remove-SlotFile $f.FullName 1
    }
  }
  return $live.ToArray()
}

if ($Status) {
  $slots = @(Get-LiveSlots)
  Write-Host "=== verify-lock status ($($slots.Count)/$Max slots i brug) ===" -ForegroundColor Cyan
  Write-Host "Slot-mappe: $SlotDir"
  foreach ($s in $slots) {
    if ($null -ne $s.Info) {
      Write-Host ("  pid={0} siden={1} label={2}" -f $s.Info.pid, $s.Info.acquiredAt, $s.Info.label)
    } else {
      Write-Host "  (ulaeselig: $($s.Name))"
    }
  }
  exit 0
}

# --- Kommando ----------------------------------------------------------------
$cmd = @($cmd | Where-Object { $_ -ne "" })
if ($cmd.Count -eq 0) {
  Write-Fail "verify-lock: ingen kommando. Brug: pwsh -File scripts/verify-lock.ps1 -Max 2 -Timeout 1800 -- <kommando>"
  exit 2
}

# --- Egne filer der venter paa at kunne slettes -------------------------------
$script:pending = New-Object System.Collections.Generic.List[string]

function Add-Pending([string]$path) {
  if (-not $script:pending.Contains($path)) { $script:pending.Add($path) }
}

function Clear-Pending([int]$attempts) {
  foreach ($p in @($script:pending)) {
    if (Remove-SlotFile $p $attempts) { $null = $script:pending.Remove($p) }
  }
}

function Write-SlotFile([string]$path, [string]$json) {
  # CreateNew: navnet er unikt (tid + PID + guid); en kollision skal fejle
  # hoejt i stedet for at overskrive en andens slot.
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  try {
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
    $fs.Write($bytes, 0, $bytes.Length)
  } finally { $fs.Dispose() }
}

# --- Tag et slot -------------------------------------------------------------
# Optimistisk: skriv egen slot-fil, taeller derefter. Er vi ikke blandt de
# Max foerste (sorteret paa navn, som starter med et sorterbart tidsstempel),
# fjerner vi vores egen igen og venter. Det er en "ticket lock": to processer
# der skriver samtidig faar forskellige filnavne (tid + PID + guid), saa de kan
# ikke begge tro at de vandt. Egne efterladte filer springes over i
# rangeringen: de repraesenterer ingen anden proces.
$myPid = $PID
$myStart = ""
try { $myStart = (Get-Process -Id $myPid).StartTime.ToUniversalTime().ToString("o") } catch { $myStart = "" }
$labelText = if ($Label) { $Label } else { ($cmd -join " ") }
$deadline = (Get-Date).AddSeconds($Timeout)
$slotFile = $null
$candidate = $null
$waited = 0
$exit = 1

try {
  while ($true) {
    Clear-Pending 1

    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfff")
    $name = "slot-$stamp-$myPid-$([guid]::NewGuid().ToString('N').Substring(0,8)).json"
    $candidate = Join-Path $SlotDir $name
    $payload = [ordered]@{ pid = $myPid }
    if ($myStart) { $payload.startedAt = $myStart }
    $payload.acquiredAt = (Get-Date).ToString("o")
    $payload.label = $labelText
    Write-SlotFile $candidate ([pscustomobject]$payload | ConvertTo-Json -Compress)

    $live = @(Get-LiveSlots -OwnPid $myPid)
    foreach ($s in $live) { if ($s.Own -and $s.Name -ne $name) { Add-Pending $s.FullName } }
    $ranked = @($live | Where-Object { -not ($_.Own -and $_.Name -ne $name) } | ForEach-Object { $_.Name })
    $rank = [array]::IndexOf($ranked, $name)
    if ($rank -ge 0 -and $rank -lt $Max) {
      $slotFile = $candidate
      $candidate = $null
      break
    }

    if (-not (Remove-SlotFile $candidate)) {
      Add-Pending $candidate
      [Console]::Error.WriteLine("[verify-lock] slot-fil holdes aaben af en anden proces, sletning udskudt: $name")
    }
    $candidate = $null
    $inUse = @($ranked | Where-Object { $_ -ne $name }).Count

    if ((Get-Date) -ge $deadline) {
      Write-Fail "verify-lock: ingen ledig slot inden for $Timeout s (Max=$Max, i brug=$inUse). Koer 'pwsh -File scripts/verify-lock.ps1 -Status' for at se hvem der holder dem."
      $exit = 75
      break
    }
    if ($waited -eq 0) {
      Write-Host "[verify-lock] venter paa slot ($inUse/$Max i brug)..." -ForegroundColor DarkGray
    }
    $waited++
    # Jitter paa ventetiden, saa to processer der taber samtidig ikke proever igen i takt.
    Start-Sleep -Milliseconds (1500 + (Get-Random -Minimum 0 -Maximum 700))
  }

  # --- Koer kommandoen -------------------------------------------------------
  if ($slotFile) {
    # Egne efterladte filer taeller for de andre laner; sidste forsoeg foer en
    # koersel der kan vare laenge.
    if ($script:pending.Count -gt 0) {
      Clear-Pending 6
      if ($script:pending.Count -gt 0) {
        [Console]::Error.WriteLine("[verify-lock] advarsel: $($script:pending.Count) egen efterladt slot-fil kunne ikke slettes endnu; proever igen efter koerslen.")
      }
    }
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
    }
  }
} finally {
  # Ryd ALLE egne slot-filer: det vundne slot, en evt. kandidat (afbrudt midt i
  # en runde), de udskudte og alt i mappen med egen PID i navnet.
  $mine = New-Object System.Collections.Generic.List[string]
  foreach ($p in @(@($slotFile, $candidate) + @($script:pending))) {
    if ($p -and -not $mine.Contains($p)) { $mine.Add($p) }
  }
  foreach ($f in @(Get-ChildItem -LiteralPath $SlotDir -Filter "slot-*.json" -File -ErrorAction SilentlyContinue)) {
    if ((Get-SlotNamePid $f.Name) -eq $myPid -and -not $mine.Contains($f.FullName)) { $mine.Add($f.FullName) }
  }
  foreach ($p in $mine) {
    if (-not (Remove-SlotFile $p)) {
      [Console]::Error.WriteLine("verify-lock: kunne ikke slette egen slot-fil $(Split-Path -Leaf $p); den ryddes af naeste kald naar denne proces er afsluttet.")
    }
  }
}

exit $exit
