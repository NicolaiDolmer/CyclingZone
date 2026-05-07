# Cross-PC setup — runbook

Dette er køreplanen for at have CyclingZone-repo'et på flere PC'er **uden** at OneDrive eller anden filsync rører ved `.git/`.

GitHub er synkroniseringsmekanismen — intet andet.

---

## TL;DR

- **Kanonisk repo-placering på alle PC'er:** `C:\dev\CyclingZone`
- **Aldrig** under `OneDrive/`, `Dropbox/`, `iCloud/` eller lignende
- **Sync-mekanisme:** `git fetch && git pull` ved session-start, `git push` efter commit
- **User-level hooks** advarer hvis du forlader en session med uncommitted/unpushed work

---

## Scenarie 1 — Fra OneDrive/Desktop til ren placering (engangs-migration)

Brug dette når repo'et lige nu ligger et dårligt sted (Desktop, Documents under OneDrive, eller en auto-genereret Codex-mappe).

### Trin 1 — Verificér tilstand med preflight

På den PC du vil migrere:

```powershell
cd <nuværende-repo-sti>
pwsh -File scripts/preflight-check.ps1
```

Scriptet er **read-only**. Det rapporterer:

- Om alt er committed
- Om alle branches er pushet til origin
- Om der ligger stash-entries
- Om repo'et er under OneDrive
- Hvor lokal-only filer ligger (`.env*`, `.mcp.json`, `.codex.local/`)
- Hvor Claude auto-memory ligger
- Om Codex har repo'et som trusted

**Hvis preflight fejler:** løs problemerne og kør den igen. Migration kan ikke ske før preflight er grøn.

### Trin 2 — Kør migrationen i dry-run først

```powershell
pwsh -File scripts/migrate-to-clean-location.ps1
```

Default target er `C:\dev\CyclingZone`. Tilføj `-Target "D:\code\CZ"` for andet sted.

Dry-run viser præcist hvilke handlinger der ville ske, uden at gøre noget. Læs outputtet.

### Trin 3 — Live migration

Når dry-run-output ser rigtigt ud:

```powershell
pwsh -File scripts/migrate-to-clean-location.ps1 -NoDryRun
```

Scriptet:

1. Re-verificerer preflight-state (max 10 min gammelt)
2. Verificerer target er sikker (eksisterer ikke / tom, ikke under OneDrive)
3. Cloner fresh fra origin til target — ny `.git/`, ingen orphan-state
4. Kopierer lokal-only filer fra source til target
5. Kopierer Claude auto-memory til ny encoded path
6. Kører `npm install` i backend og frontend
7. Kører frontend build for at verificere
8. Tilføjer target som trusted i `~/.codex/config.toml`

**Det gamle repo bliver IKKE slettet automatisk.** Verificér først at det nye virker.

### Trin 4 — Verificér det nye virker

```powershell
cd C:\dev\CyclingZone

# Test build
cd frontend; npm run build; cd ..
cd backend; node --test; cd ..

# Test Discord MCP (hvis Railway CLI er klar)
pwsh -File scripts/setup-discord-mcp.ps1

# Åbn én Claude Code session i den nye placering. Verificér:
# - MCP-servere er tilgængelige (Discord, Supabase, GitHub)
# - Auto-memory er bevaret (skal kunne se din økonomi/arkitektur memory)
# - Linje 1 i NOW.md læses korrekt

# Åbn én Codex session i den nye placering. Verificér:
# - AGENTS.md auto-loades
# - Repo er listet som trusted
```

### Trin 5 — Installer user-hooks

```powershell
pwsh -File scripts/install-user-hooks.ps1
```

Tilføjer SessionStart + Stop hooks til `~/.claude/settings.json`. Idempotent — kan køres flere gange uden duplikater.

### Trin 6 — Slet det gamle (kun når du er 100% sikker)

```powershell
# Vis stien én gang for at bekræfte
Get-Content C:\dev\CyclingZone\.codex.local\migration-report.json

# Slet derefter manuelt fra Stifinder eller PowerShell
Remove-Item -Path "<gammel-sti>" -Recurse -Force
```

---

## Scenarie 2 — Helt frisk PC (ingen repo overhovedet)

Brug dette når du får en ny computer eller har slettet alt.

### Forudsætninger

```powershell
# Installer:
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install GitHub.cli
gh auth login
```

### Setup

Hent setup-scriptet direkte fra GitHub (uden at have repo'et endnu):

```powershell
$url = "https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/scripts/setup-new-pc.ps1"
Invoke-RestMethod $url | Out-File "$env:TEMP\setup-new-pc.ps1"
pwsh -File "$env:TEMP\setup-new-pc.ps1"
```

Eller — efter du har clone'et selv:

```powershell
git clone https://github.com/NicolaiDolmer/CyclingZone.git C:\dev\CyclingZone
cd C:\dev\CyclingZone
pwsh -File scripts/setup-new-pc.ps1
```

### Manuelle skridt der ikke kan automatiseres

1. **Kopier `.env.local`-filer** fra anden PC eller password manager:
   - `backend/.env` — Supabase keys, Railway tokens
2. **`.mcp.json`** kan auto-genereres af `setup-discord-mcp.ps1` hvis Railway CLI er logget ind
3. **`.codex.local/`** mappe — opretter Codex selv ved første session

---

## Daglig sync-flow

### Session-start på enhver PC

User-level SessionStart hook gør det automatisk:

```
git fetch --prune origin
git status -sb
```

Hvis output viser `[behind N]` → kør `git pull` før du arbejder.

### Session-end på enhver PC

User-level Stop hook advarer hvis:

- Der er uncommitted changes
- Current branch er ahead af upstream
- Der ligger stash-entries

Advarslen er **ikke-blokerende** — den minder dig blot om at den anden PC ikke kan fortsætte uden disse ændringer.

### Auto-push efter commit

Allerede etableret regel (`AGENTS.md` punkt 6 + `feedback_push_after_commit.md`): commit → push uden at spørge.

---

## Troubleshooting

### "preflight-check.ps1 fejler med uncommitted changes"

Commit eller stash ændringerne. Migration må aldrig ske med ucommitted state — det er hele pointen.

### "preflight-check.ps1 fejler med 'X branches er ahead af origin'"

Push de pågældende branches:

```bash
git push origin <branch-navn>
```

Eller hvis branchen ikke skal pushes (lokal kladde): slet den først, eller opret upstream eksplicit til en `wip/`-branch.

### "Migration kører, men frontend build fejler"

Migration STOPPER ved build-fejl. Target-mappen er bevaret så du kan inspicere. Mest sandsynligt mangler `.env.local` med Supabase-keys — kopiér den fra source-mappen og kør `npm run build` manuelt.

### "Auto-memory mangler på ny placering"

Encoded path er case-sensitive på filsystem-niveau. Hvis migration ikke kunne finde den gamle memory-mappe, find den manuelt:

```powershell
ls $env:USERPROFILE\.claude\projects | Where-Object Name -like "*CyclingZone*"
```

Og kopiér `memory/`-undermappen til den nye encoded path:

```powershell
$newEncoded = "C--dev-CyclingZone"
Copy-Item -Path "<gammel-memory-sti>" -Destination "$env:USERPROFILE\.claude\projects\$newEncoded\memory" -Recurse
```

Hvis det ikke lykkes: kør `pwsh -File scripts/link-onedrive-context.ps1` — memory + secrets sync'er nu via OneDrive (`~/OneDrive/CyclingZone-context/`) frem for manuel kopi.

### "Codex åbner stadig i den gamle Codex-mappe"

Codex auto-genererer en ny mappe per session med navnet `Codex/<timestamp>-<prompt>`. For at undgå dette skal du:

1. Åbne Codex inde i `C:\dev\CyclingZone` direkte (ikke fra startmenu/desktop)
2. Eller starte fra en terminal: `cd C:\dev\CyclingZone; codex`

Trust-entryen i `~/.codex/config.toml` betyder Codex ikke spørger om tilladelse for hver fil — men den styrer ikke hvor sessionen starter.

---

## Sync-mekanismer for hver fil-type

| Type | Hvor | Hvordan synces mellem PC'er |
|---|---|---|
| Kode | Git | `git push` / `git pull` |
| Docs i repo (NOW.md, AGENTS.md, etc.) | Git | Same |
| `backend/.env`, `frontend/.env*`, `.mcp.json` | Lokal, gitignored | **OneDrive-context hardlink** — `~/OneDrive/CyclingZone-context/secrets/` |
| `.codex.local/SUPABASE_CONTEXT.md`, `.codex.local/supabase-readonly.env` | Lokal, gitignored | **OneDrive-context hardlink** — `~/OneDrive/CyclingZone-context/codex-local/` |
| Claude auto-memory | `~/.claude/projects/<encoded>/memory/` | **OneDrive-context junction** — `~/OneDrive/CyclingZone-context/memory/` |
| Codex memories | `~/.codex/memories/` | Per-PC, ingen sync |
| Worktrees i `.claude/worktrees/` | Per-PC | Cleanes up per-session |

Re-skab links efter clone på ny PC (idempotent):

```powershell
pwsh -File scripts/link-onedrive-context.ps1
```

Kaldes også automatisk af `scripts/setup-new-pc.ps1`. Detaljer: [auto-memory `reference_onedrive_context.md`].

## Hvad der KAN synces via OneDrive (separat mappe, ikke i repo)

- Skitser, screenshots, scratch-noter
- Diagrammer, mockups
- Manus / udkast til marketing-tekster

Hold dem i `OneDrive/CyclingZone-noter/` eller lignende — adskilt fra koden.
