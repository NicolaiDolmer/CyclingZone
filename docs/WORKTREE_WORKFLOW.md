# Worktree Workflow — parallelle Claude Code-sessioner

> Etableret 2026-05-16 efter at samtidige sessioner i `C:\dev\CyclingZone\` kæmpede om branch + working tree (Refs #382-followup).
>
> For parallel multi-worktree-orchestration (3+ åbne issues kørt samtidig via subagents), se [`PARALLEL_WORKTREE_ORCHESTRATION.md`](PARALLEL_WORKTREE_ORCHESTRATION.md) — 7-step playbook, prompt-template og pitfalls.

## Hvorfor

Én Claude Code-session pr. opgave er normen. Når du kører 2-3 ad gangen i samme repo-folder, vil de skifte branch under hinanden (`git checkout` er global pr. working tree). Git worktrees giver hver session sit eget working dir mens git-history deles.

## Layout

```
C:\dev\CyclingZone\                          # main worktree (cross-PC sync-anker; ofte main-branch)
C:\dev\CyclingZone-worktrees\
  ├── feat-min-feature\                      # parallel session 1
  ├── fix-bug-xyz\                           # parallel session 2
  └── docs-noget\                            # parallel session 3
```

Branch-navne med `/` slug'es til `-` for path-safety (`feat/x` → `feat-x`).

## Setup

### Opret nyt worktree (start ny parallel session)

```powershell
pwsh -File scripts/new-worktree.ps1 -Branch feat/min-feature
# Default base: origin/main. For andet:
pwsh -File scripts/new-worktree.ps1 -Branch fix/abc -FromBranch origin/develop
```

Scriptet:
1. Kører `git worktree add -b <branch> <path> <from>`.
2. Kører `setup-worktree.ps1` (se nedenfor), der junction-linker `node_modules/` fra main + hardlinker `.env`-filer + `.mcp.json` fra OneDrive-context\secrets\.
3. Kører `link-onedrive-context.ps1 -RepoRoot <new-path>` så memory-junction etableres for worktreets Claude-project-folder.

Åbn derefter en ny Claude Code-session med working dir `C:\dev\CyclingZone-worktrees\<slug>\`.

### Harness-oprettede worktrees (auto-setup) — #994

Claude Code-harnessen opretter sine egne worktrees under `.claude/worktrees/<navn>` **uden om** `new-worktree.ps1`. De mangler derfor `node_modules`-junctions + `.env`-filer → backend `node --test` fejler lokalt med `Error: supabaseUrl is required.` og frontend kræver manuel `npm ci`.

To mekanismer lukker hullet:

- **`scripts/setup-worktree.ps1`** — idempotent script der sætter et eksisterende worktree op:
  - `node_modules`-junctions → main-repoets `node_modules` (sparer ~500 MB + install-tid).
  - `.env`-hardlinks (`backend/.env`, `frontend/.env`, `frontend/.env.production`, `.mcp.json`) fra `OneDrive-context\secrets\` via `mklink /H`. **Læser aldrig secret-værdier** — kun filsystem-links (jf. #634). `link-onedrive-context.ps1` håndterer ikke `.env` længere (#327 Infisical), så `.env`-logikken bor her.
  - Auto-detekterer worktree- + main-repo-sti via `git rev-parse` (CWD = worktreet); skip-if-exists på hvert trin → sikkert at køre igen, no-op i selve main-repoet.

  Kør manuelt i en harness-worktree der mangler setup:
  ```powershell
  pwsh -File scripts/setup-worktree.ps1            # auto-detect
  pwsh -File scripts/setup-worktree.ps1 -DryRun    # rapportér uden at skrive
  ```

- **SessionStart-hook** (`scripts/hooks/setup-worktree-if-needed.sh` i `.claude/settings.json`) — kører `setup-worktree.ps1` automatisk ved session-start **hvis** man er i et linked worktree (`.git` er en fil) med manglende `node_modules`/`.env`. Øjeblikkelig no-op i main-repoet og når alt er på plads. Dvs. en frisk harness-worktree er klar til `pwsh -File scripts/verify-local.ps1` uden manuelle trin.

`new-worktree.ps1` genbruger samme `setup-worktree.ps1` (ingen duplikeret junction-/env-logik).

### Cleanup når branchen er merged eller forladt

```powershell
pwsh -File scripts/remove-worktree.ps1 -Branch feat/min-feature
# Skip safety checks (uncommitted/unpushed):
pwsh -File scripts/remove-worktree.ps1 -Branch fix/abc -Force
```

Scriptet checker for uncommitted/unpushed work, fjerner Claude-project-folder (memory-junction-parent), kører `git worktree remove`, og sletter lokal branch hvis merged til `origin/main`.

### Bulk-oprydning (alle merged worktrees på én gang)

`remove-worktree.ps1` rydder **én** branch og antager `CyclingZone-worktrees\<slug>`-layoutet — den ser derfor ikke Claude Codes auto-worktrees under `.claude/worktrees/<random-name>`. Disse hober sig op fordi close-out aldrig fjerner dem (43 stk. observeret 2026-06-03). Brug sweep'et til periodisk oprydning:

```powershell
pwsh -File scripts/prune-merged-worktrees.ps1            # dry-run: rapportér hvad der ville ryge
pwsh -File scripts/prune-merged-worktrees.ps1 -Execute   # udfør
```

Det enumererer **alle** worktrees via `git worktree list` (layout-uafhængigt) og genbruger den delte, squash-bevidste merge-detektion (`scripts/lib/git-merge-detection.ps1`). Sletter kun med **positivt merge-bevis**: en merged PR (via `gh`), eller en ancestry-merge med egne commits — er `gh` ubestemt for en squash-branch, **beholdes** branchen. Et **frisk worktree uden egne commits** (ahead==0, fx et netop oprettet fleet-worktree) beholdes også, selv om `git branch --merged` viser det som ancestor ([#1271](https://github.com/NicolaiDolmer/CyclingZone/issues/1271)); kun `-Force` rydder dem. Springer altid primær checkout, aktiv session, locked worktrees, detached HEAD, branches der lever på origin, og worktrees med uncommitted changes (medmindre `-Force`) over. Default er dry-run; intet slettes uden `-Execute`.

Genvej (dry-run + udfør):

```powershell
npm run cleanup:worktrees        # dry-run: rapportér hvad der ville ryge
npm run cleanup:worktrees:run    # -Execute: udfør oprydningen
```

### Efter-merge-rutine (forebyg ophobning)

Rod-årsagen til at branches + worktrees hober sig op er **at man bliver boende på en feature-branch efter merge** i stedet for at vende hjem til main. Den ene vane der forhindrer det:

```bash
# Lige efter en PR er merged:
git checkout main && git pull && git branch -d <din-branch>
```

To værn fanger det hvis vanen glipper:

1. **`scripts/check-stale-branches.sh`** (SessionStart-hook) advarer nu **også** hvis hovedmappen (primær worktree) ikke står på main — `⚠ Hovedmappen står på '<branch>', ikke main`. Så afsporingen fanges ved næste session-start, før den når at hobe sig op.
2. **`npm run cleanup:worktrees`** gør den periodiske sweep til en 10-sekunders rutine (dry-run først, så `:run`).

## Gotchas

### Playwright-port pr. worktree (false-green-guard)

> Indført 2026-06-10 efter at en agents core-smoke-suite passerede 18/18 mod en **anden** worktrees dev-server — ændringerne var reelt uverificerede. Samme rod-årsag bed også 2026-05-31 (se `.claude/learnings/`).

Alle worktrees delte tidligere hardcodet port 4173, og `webServer.reuseExistingServer` genbrugte stille enhver server på porten — uanset hvilken worktree den servede fra. Nu (logik i `frontend/playwright.ports.js`):

- **Main-checkout** (`C:\Dev\CyclingZone`, `.git` er en mappe) beholder **4173** — CI og snapshots uændret.
- **Linked worktrees** (`.git` er en fil) får en **deterministisk hash-afledt port i 4300-4999** baseret på worktree-stien. Parallelle worktrees kolliderer ikke uden manuel handling.
- **`PW_PORT`** overrider alt: `$env:PW_PORT=4600; npx playwright test`
- **`--strictPort`**: vite fejler højlydt i stedet for at hoppe til en nabo-port som baseURL ikke peger på.
- **Identity-guard**: dev/preview-serveren eksponerer `/__worktree-id` (vite-plugin), og Playwrights `globalSetup` fejler højlydt FØR suiten hvis serveren på porten serverer en anden rod end testens egen worktree — inkl. stale servere fra før dette fix (de har intet id-endpoint og afvises også).

Når guarden fejler: dræb processen på porten (`netstat -ano | findstr :<port>` → `Stop-Process -Id <PID> -Force`) eller kør med eksplicit fri `PW_PORT`.

### Delt node_modules

Worktrees deler `node_modules/` via junction. Det betyder:

- ✅ Sparer disk + install-tid
- ⚠️ Hvis to worktrees samtidig kører `npm install` med forskellige `package.json`-ændringer, kan de overskrive hinandens deps. **I praksis sjældent et problem** — dep-ændringer er typisk én session ad gangen.
- 🔧 Hvis du har dep-konflikter mellem worktrees: lav et separat install i den aktive worktree:
  ```powershell
  cmd /c rmdir /Q backend\node_modules
  npm install --prefix backend
  ```

### Memory deles på tværs af worktrees

Alle worktrees junctioner til samme `~\OneDrive\CyclingZone-context\memory\`. Det er **korrekt** — memory er pr. projekt, ikke pr. branch. Hvis du gemmer en memory i én session, er den synlig fra alle andre sessioner og PC'er.

### Settings.json hardlink er global

`~/.claude/settings.json` er global pr. Windows-user, ikke pr. worktree. Hooks (SessionStart, Stop) kører i hver session.

### Branch-collision

Worktrees kan **ikke** have samme branch checked out i to paths samtidig. Hvis du allerede har `feat/foo` checked out i main repo, kan du ikke samtidig lave en worktree på `feat/foo`. Solution: enten skift main til en anden branch, eller brug en ny branch.

## Når noget går galt

- `git worktree list` → se hvilke worktrees der findes
- `git worktree prune` → ryd op i worktrees hvor folderen er slettet manuelt
- `git worktree remove --force <path>` → fjern et worktree med uncommitted changes

## Hvorfor ikke bare flere clones?

- Worktrees deler `.git/objects` → ingen duplikering af history
- Branch-state er konsistent (alle worktrees ser samme remotes, stashes, etc.)
- `git fetch` i ét worktree er synligt fra alle
