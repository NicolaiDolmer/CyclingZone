# 2026-05-16: OneDrive cloud-file reparse-tag blokerer cascade-hardlinks i worktrees

## Symptom
Ved setup af første git worktree med `scripts/new-worktree.ps1` fejlede env-fil-hardlinks:

```
New-Item: Cloudhandlingen kan ikke udføres på en fil med inkompatible hårde links.
```

To filer fejlede (`backend\.env`, `frontend\.env`), to lykkedes (`frontend\.env.production`, `.mcp.json`). Worktreets `node_modules` junctions virkede fint.

## Root cause
Main repo's env-filer (`C:\dev\CyclingZone\backend\.env` osv.) er IKKE almindelige filer — de er hardlinks til `~\OneDrive\CyclingZone-context\secrets\backend.env`, og OneDrive-targeten har reparse-tag `0x9000601a` (Microsoft.SyncEngines.CloudFilesProvider).

NTFS-hardlinking via PowerShell `New-Item -ItemType HardLink` eller `cmd /c mklink /H` tillader IKKE cascade af hardlinks gennem en cloud-files-target. Dvs. når man forsøger at lave `worktree\backend\.env → main\backend\.env`, og main's fil selv er en hardlink til OneDrive, fejler den med "inkompatible hårde links".

`.mcp.json` lykkedes "tilfældigt" fordi Windows valgte at oprette den direkte mod OneDrive-source uden cascade (begge i samme volumen/cluster) — men adfærden er ikke reproducerbar.

## Fix
**Hardlink worktree-env-filer DIREKTE til `OneDrive-context\secrets\<file>` i stedet for via main repo.**

```powershell
# Virker:
cmd /c mklink /H "worktree\backend\.env" "C:\Users\<user>\OneDrive\CyclingZone-context\secrets\backend.env"

# Fejler:
cmd /c mklink /H "worktree\backend\.env" "main-repo\backend\.env"   # cascade
```

`scripts/new-worktree.ps1` (#441) bruger direkte OneDrive-target og undgår problemet.

## Forward-guard
- **Cascade-hardlinks i OneDrive-context-setups: undgå.** Når et OneDrive-cloudfil-target findes, hardlink altid DIREKTE til den oprindelige OneDrive-fil — ikke gennem et mellemled der selv er hardlink.
- Detection: `fsutil hardlink list <file>` viser hele hardlink-kæden. Hvis et af medlemmerne ligger under `OneDrive\`, så hardlink til DEN node, ikke til andre links.
- `cmd /c mklink /H` er marginalt mere tolerant end PowerShell `New-Item -ItemType HardLink` overfor reparse-points, men HVERKEN tillader cascade gennem cloud-file-target.
- Backwards-check: tjekkede `link-onedrive-context.ps1` — den hardlinker også direkte til OneDrive-source (den DEPRECATED secret-blok kommenterer pænt på det). Ingen andre cascade-pattern fundet.

## Cross-PC implikation
Hvis du etablerer worktree-workflow på anden PC: kør altid `new-worktree.ps1` (ikke manuel `git worktree add` + manuel hardlink-kopiering), så direct-to-OneDrive-pattern overholdes. Manuel setup risikerer at gentage fejlen.

## Discovered during
PR #441 (`feat/worktree-workflow`) — første run af `new-worktree.ps1`-prototype mislykkedes for to af fire env-filer. Brugeren spottede ikke fejlen umiddelbart fordi PowerShell-output blandede success-messages og fejl-meddelelser i samme blok.
