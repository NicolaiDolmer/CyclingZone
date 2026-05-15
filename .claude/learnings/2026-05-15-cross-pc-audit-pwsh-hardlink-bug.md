# 2026-05-15: cross-pc-forensic-audit detekterede ikke hardlinks i pwsh 7

## Symptom
`scripts/cross-pc-forensic-audit.ps1` flag'ede `~/.codex/AGENTS.md` som "ikke linket til OneDrive" — selv efter at filen var korrekt hardlinkede til `~/OneDrive/CyclingZone-context/codex-memories/AGENTS.md` (bekraeftet via `fsutil hardlink list`).

## Root cause
PowerShell 7 (`pwsh`) returnerer tom `LinkType` for hardlinks paa Windows. Kun Windows PowerShell 5.1 (`powershell.exe`) udfylder felter korrekt. Junction og SymbolicLink fungerer fint i begge versioner — bug'en gaelder kun hardlinks.

Bekraeftet:
```
=== pwsh (PowerShell 7) ===
LinkType: ''
Target:   ''
=== powershell.exe (5.1) ===
LinkType: 'HardLink'
Target:   'C:\Users\ndmh3\OneDrive\CyclingZone-context\codex-memories\AGENTS.md'
```

`link-onedrive-context.ps1` kender allerede problemet og workaround'er via `fsutil file queryfileid` (linje 47-59 + kommentar "Virker baade i Windows PowerShell 5.1 og PowerShell 7 (i modsaetning til $item.LinkType)"). Audit-scriptet manglede den samme defensive check.

## Fix
Tilfoejede `Test-IsHardlink` helper i audit-scriptet der bruger `fsutil hardlink list` (>1 path => hardlinkede). Erstatter ren `LinkType`-check for hardlinks. SymbolicLink-check beholdt via `LinkType` (fungerer i pwsh 7).

## Forward-guard
- Backwards-check fundet: kun audit-scriptet havde bug. `link-onedrive-context.ps1` linje 187 bruger `LinkType -eq "Junction"` — virker fint (junction-detektion er ikke broken i pwsh 7).
- Forward: hvis ny PowerShell-kode skal detektere hardlinks, brug `fsutil hardlink list` (>1 line) eller `fsutil file queryfileid` (sammenlign IDs). Aldrig `LinkType -eq "HardLink"` i pwsh 7-kontekst.

## Discovered during
Cold-start session 2026-05-15 — efter cleanup af 10 orphan-filer i `.codex.local/` og migration af `~/.codex/AGENTS.md` til OneDrive hardlink, var audit fortsat roed pga. denne bug.
