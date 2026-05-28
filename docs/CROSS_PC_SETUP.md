# Cross-PC setup — runbook

Dette er køreplanen for at have CyclingZone-repo'et på flere PC'er **uden** at OneDrive eller anden filsync rører ved `.git/`.

GitHub er synkroniseringsmekanismen — intet andet.

---

## TL;DR

- **Kanonisk repo-placering på alle PC'er:** `C:\dev\CyclingZone`
- **Aldrig** under `OneDrive/`, `Dropbox/`, `iCloud/` eller lignende
- **Sync-mekanisme:** `git fetch && git pull` ved session-start, `git push` efter commit
- **Delt agent-context:** varig state ligger i GitHub (`docs/NOW.md`, issues, slice-docs) eller OneDrive-context. Lokale agent-filer er caches/pointers.
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

### Trin 0 — Toolchain (installer alle programmer)

En frisk Windows 11 har kun Windows PowerShell 5.1. Installer pwsh 7 i en **almindelig PowerShell eller cmd**:

```powershell
winget install --id Microsoft.PowerShell --source winget
```

Åbn derefter en **ny "PowerShell 7"-terminal** og kør bootstrap-scriptet (henter sig selv fra GitHub):

```powershell
$u = "https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/scripts/bootstrap-pc.ps1"
Invoke-RestMethod $u | Out-File "$env:TEMP\bootstrap-pc.ps1"
pwsh -File "$env:TEMP\bootstrap-pc.ps1"          # tilføj -WithDocker hvis du vil køre Supabase lokalt
```

`bootstrap-pc.ps1` installerer: Git, GitHub CLI, PowerShell 7, Windows Terminal, VS Code (+ extensions), Node.js LTS (≥22), Python, Infisical CLI (via Scoop — winget-pakken er pt. død), Bitwarden, Chrome, samt npm-globale CLI'er (Vercel, Railway, Codex) og Claude Code. Det sætter desuden ExecutionPolicy `CurrentUser=RemoteSigned` tidligt og tilføjer `~/.local/bin` til User-PATH (så `claude` resolver i nye terminaler). Det rører **aldrig** secrets. Idempotent — kan køres igen.

> **Node-version:** `backend/package.json` kræver Node **≥ 22**. `OpenJS.NodeJS.LTS` (som bootstrap installerer) giver den nyeste LTS = 22.x.

### Trin 1 — Log ind på dine konti

Genstart pwsh efter Trin 0. Log derefter ind — **Bitwarden og OneDrive først:**

| Konto | Kommando / handling | Hvorfor |
|---|---|---|
| Bitwarden | Lås din vault op | Alle andre logins + 2FA ligger her |
| OneDrive | Log ind, vent på `CyclingZone-context`-sync | Claude-memory + AI-context kommer derfra (kritisk) |
| GitHub | `gh auth login` | Clone + push |
| Infisical | `infisical login` | Secrets (browser-OAuth) |
| Vercel | `vercel login` | Frontend-deploy |
| Railway | `railway login` | Backend-deploy + Discord-MCP-token |
| Claude | `claude` (OAuth ved første kørsel) | AI-dev |
| Codex | `codex` (login ved første kørsel) | AI-dev |

### Trin 2 — Clone + repo-opsætning

Hent setup-scriptet direkte fra GitHub (det cloner selv til `C:\dev\CyclingZone`):

```powershell
$url = "https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/scripts/setup-new-pc.ps1"
Invoke-RestMethod $url | Out-File "$env:TEMP\setup-new-pc.ps1"
pwsh -File "$env:TEMP\setup-new-pc.ps1"
```

Scriptet cloner, kører npm install (backend + frontend), verificerer build, installerer Playwright-browsers, og sætter Codex-trust + user-hooks + OneDrive-links + Discord-MCP.

> **Bemærk:** `setup-new-pc.ps1` afviser et target der allerede findes og ikke er tomt — clone derfor **ikke** manuelt først. Lad scriptet gøre det.

### Trin 3 — Gør repoet commit-klart

```powershell
cd C:\dev\CyclingZone
pwsh -File scripts/setup-local.ps1
```

Installerer root-deps (lint-staged) og aktiverer git pre-commit/pre-push hooks (`core.hooksPath .githooks`).

### Trin 4 — Produktionssecrets via Infisical (manuelt)

**Produktionssecrets via Infisical** (erstatter OneDrive-hardlinks efter #327; runtime-injection efter Phase 5):

1. **Infisical CLI installeret?** Installeres normalt af `bootstrap-pc.ps1` via Scoop. Manuelt (winget-pakken `Infisical.infisical` er pt. død):
   ```powershell
   scoop bucket add infisical https://github.com/Infisical/scoop-infisical.git
   scoop install infisical
   ```
   (Scoop kræver `ExecutionPolicy CurrentUser=RemoteSigned` — sættes af bootstrap.) Restart shell så `infisical` resolver i PATH. Fallback: `npm i -g @infisical/cli`.
2. **Log ind:** `infisical login` (browser-OAuth)
3. **Verificér projekt-link:** `Test-Path .infisical.json` skal være `True` (committet til repo, peger på workspace `681fe0be-...`).
4. **Test runtime-injection:** `infisical run --env=dev -- node -e "console.log('SUPABASE_URL set:', !!process.env.SUPABASE_URL)"` → skal printe `true`.
5. **Start backend lokalt:** `npm run dev:backend` (wrapper omkring `infisical run --env=dev --recursive -- node ...`). Backend behøver IKKE `backend/.env`-fil længere — env vars injiceres ved runtime.
6. **`.mcp.json`** auto-genereres af `setup-discord-mcp.ps1` hvis Railway CLI er logget ind.
7. **`.codex.local/`** mappe — opretter Codex selv ved første session.

> **Nicolai:** Secrets skal være indtastet i Infisical-dashboardet (infisical.com) for at ovenstående fungerer. Phase 1 (#339) er allerede komplet — alle dev/preview/prod miljøer populated via `scripts/seed-infisical.ps1`. Se [secret-management-adr.md](decisions/secret-management-adr.md) for fuld migration-historik.

> **Bemærk:** Hvis du har en eksisterende `backend/.env` med secret-værdier (fra før Phase 5), kan du slette dem — `infisical run` injicerer ved runtime. `dotenv.config()` i kode bevarer Infisical-værdierne (dotenv v17+ overskriver ikke eksisterende env vars).

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

Før du skifter PC, telefon eller agent: sørg for at alle beslutninger, næste skridt og status står i GitHub (`docs/NOW.md`, GitHub issue-kommentarer eller slice-docs) eller i OneDrive-context. `.codex.local/SESSION_CONTEXT.md`, Claude transcripts og Codex memories er lokale caches og tæller ikke som handoff.

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

Hvis det ikke lykkes: kør `pwsh -File scripts/link-onedrive-context.ps1` — memory + AI-context (codex-local) sync'es via OneDrive (`~/OneDrive/CyclingZone-context/`). Secrets bootstrap via Infisical — se "Scenarie 2 — Frisk PC" ovenfor.

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
| `backend/.env`, `frontend/.env*` | Lokal, gitignored (kan være tom efter Phase 5) | **Infisical runtime-injection** → `npm run dev:backend` wrapper bruger `infisical run --env=dev --recursive -- node ...`; ingen secret-værdier på disk (#327 Phase 5) |
| `.mcp.json` | Lokal, gitignored | Auto-genereres af `setup-discord-mcp.ps1` (token fra Railway) |
| `.codex.local/SUPABASE_CONTEXT.md`, `.codex.local/supabase-readonly.env` | Lokal, gitignored | **OneDrive-context hardlink** — `~/OneDrive/CyclingZone-context/codex-local/` (midlertidig hybrid — readonly AI-context) |
| Claude auto-memory | `~/.claude/projects/<encoded>/memory/` | **OneDrive-context junction** — `~/OneDrive/CyclingZone-context/memory/` |
| `.codex.local/SESSION_CONTEXT.md` | Lokal, gitignored | Regenererbar cache fra GitHub issue via hook. Må slettes; må ikke indeholde unikt handoff |
| Codex memories | `~/.codex/memories/` | Per-PC cache/personalisering. Projekt-facts skal flyttes til GitHub/OneDrive |
| Worktrees i `.claude/worktrees/` | Per-PC | Cleanes up per-session |

Re-skab memory + AI-context links efter clone på ny PC (idempotent):

```powershell
pwsh -File scripts/link-onedrive-context.ps1
```

Kaldet automatisk af `scripts/setup-new-pc.ps1`. Bemærk: dette script linker **ikke** produktionssecrets — brug Infisical til det (se "Scenarie 2" ovenfor). Detaljer: [auto-memory `reference_onedrive_context.md`].

## Hvad der KAN synces via OneDrive (separat mappe, ikke i repo)

- Skitser, screenshots, scratch-noter
- Diagrammer, mockups
- Manus / udkast til marketing-tekster

Hold dem i `OneDrive/CyclingZone-noter/` eller lignende — adskilt fra koden.
