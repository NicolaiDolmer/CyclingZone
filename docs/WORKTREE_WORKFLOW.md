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

## Gotchas

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
