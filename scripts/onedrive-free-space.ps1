# Saetter gamle filer i CyclingZone-context til "kun online" (OneDrive Files On-Demand).
# Intet slettes: filerne ligger i skyen og hentes automatisk, naar de aabnes.
# Hardlinkede filer (link-onedrive-context.ps1) springes over.
# Ejer-go 24/11-2026. Koer: pwsh -File scripts/onedrive-free-space.ps1 [-Days 14] [-DryRun]
param([int]$Days = 14, [switch]$DryRun)
$root = Join-Path $env:OneDrive 'CyclingZone-context'
$wholeFolders = @('codex-sessions-DOLMERPC','codex-sessions-NICOLAIPC','claude-transcripts-EMMAPC','private-recovery','dolmerpc-lokale-filer-2026-11-01','dolmerpc-lokale-filer-2026-10-17')
$oldFolders = @('claude-transcripts-DOLMERPC','claude-transcripts-NICOLAIPC','private-handoffs','balance-internals')
$cut = (Get-Date).AddDays(-$Days)
$freed = 0; $skipped = 0
function Set-OnlineOnly($file) {
  if ($file.Attributes -band 0x400000) { return }            # allerede kun online
  $links = (& fsutil hardlink list $file.FullName 2>$null | Measure-Object).Count
  if ($links -gt 1) { $script:skipped++; return }             # hardlink til repo/memory
  if (-not $DryRun) { & attrib.exe +U -P "$($file.FullName)" 2>$null | Out-Null }
  $script:freed += $file.Length
}
foreach ($d in $wholeFolders) {
  $p = Join-Path $root $d; if (-not (Test-Path $p)) { continue }
  Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { Set-OnlineOnly $_ }
}
foreach ($d in $oldFolders) {
  $p = Join-Path $root $d; if (-not (Test-Path $p)) { continue }
  Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cut } | ForEach-Object { Set-OnlineOnly $_ }
}
$mode = if ($DryRun) { 'ville frigoere' } else { 'markeret kun online' }
"{0}: {1} GB ({2} hardlinkede filer sprunget over). OneDrive frigoer pladsen inden for faa minutter." -f $mode, [math]::Round($freed/1GB,1), $skipped
