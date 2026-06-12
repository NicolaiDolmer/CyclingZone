# Hooks — Cycling Zone

Dette repo har **tre lag** af Claude Code settings/hooks (per [#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385)):

| Lag | Fil | Indhold | Committed |
|---|---|---|---|
| **Project** | `.claude/settings.json` | project-hooks + `enabledPlugins` + `permissions.allow` (delt mellem alle der arbejder på repoet) | Ja |
| **User** | `~/.claude/settings.json` | PC-uafhængig user-config: `theme`, `autoUpdatesChannel`, `env.TZ`, `permissions.deny`, user-niveau hooks (kun referencer til `scripts/hooks/*.sh` — ingen hardcoded paths) | Nej (per-bruger via `scripts/install-user-hooks.ps1`) |
| **PC-local** | `.claude/settings.local.json` | per-PC overrides (fx PC-specifikke permissions). Gitignored. | Nej (per-PC) |

**Vigtigt — matcher-syntax (#385):** Claude Code's PreToolUse/PostToolUse matcher-parser håndterer IKKE regex-alternation (`"Edit|Write|NotebookEdit"`). Hooks fyrede ikke. Splittes derfor i separate entries pr. tool — én `"matcher": "Edit"`, én `"matcher": "Write"`, etc. Samme `hooks`-array kopieres til hver entry.

**Forward-guard:** `scripts/cross-pc-forensic-audit.ps1` scanner alle 3 settings-filer + `scripts/hooks/*.sh` + `.claude/hooks/*.sh` for hardcoded `C:\Users\<name>\` paths (både Windows-native og Git-Bash form). Fail-fast hvis fundet — kør auditen før commit.

**OneDrive-status:** `~/OneDrive/CyclingZone-context/claude-settings/` (med subfolder `skills/github-housekeeping/SKILL.md`) er en historisk leftover fra før 3-lag-modellen. Skills bor nu i `.claude/skills/` i repoet (committed). Mappen er IKKE længere kilden til settings/skills; brugeren kan slette efter manuel verifikation.

> Hooks i Claude Code: se [docs.claude.com/.../hooks](https://docs.claude.com/en/docs/claude-code/hooks). Hook-events der bruges her: `SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`.

---

## Project-level hooks (`.claude/settings.json`)

### `SessionStart` → `bash scripts/session-prefetch-issue.sh`

**Hvad:** Læser `docs/NOW.md`, finder det aktive issue (`#N` i "🎯 Next action"-linjen, med Discord-tag-filter), henter issue + comments via `gh`, og skriver et bounded struktureret resumé til `.codex.local/SESSION_CONTEXT.md`.

**Hvorfor:** Sparer en manuel `gh issue view` round-trip uden at lække hele issue-historikken ind i hver ny session. `CLAUDE.md` auto-loader filen, så outputtet skal være kort.

**Source of truth:** Filen er en lokal, regenererbar cache af GitHub-data — ikke handoff og ikke projekt-sandhed. Varig context skal ligge i GitHub (`docs/NOW.md`, issues, slice-docs) eller OneDrive-context. Codex må ikke skrive unikke session-noter her ved close-out.

**Bounds:** Default `SESSION_CONTEXT_BODY_LIMIT=900`, `SESSION_CONTEXT_COMMENT_LIMIT=450`, `SESSION_CONTEXT_MAX_COMMENTS=1`. Kan overrides i shell-env ved manuel debug.

**Fail-safe:** Exit altid 0. Filen overskrives KUN hvis et gyldigt issue blev hentet — fejl-tilfælde bevarer evt. eksisterende `SESSION_CONTEXT.md`, men den må stadig ikke behandles som canonical state.

**Edge cases håndteret:**
- `gh` ikke installeret eller ikke autentificeret → exit 0, ingen ændring
- `docs/NOW.md` mangler → exit 0
- `#N` ikke fundet i NOW.md → exit 0
- Issue 404 / network error → exit 0
- Discord-tag som `Cycling Zone#8784` → ignoreres (regex kræver non-alphanum før `#`)
- Encoding: `PYTHONIOENCODING=utf-8` så æøå overlever Windows-python

**Strategi for issue-valg (#1097-fix):**
1. Første `#N` i "🎯 Next action"-linjen (`## Aktiv styring`) — det kanoniske pointer til aktivt arbejde per CLAUDE.md Start trin 1
2. Fallback: første `#N` i de første 25 linjer af NOW.md
3. Fallback: hele filen
4. Brugeren styrer ved at opdatere Next action-linjen (den gamle første-`#N`-heuristik blev brudt af permanente top-referencer som Produktkompas-linjen → prefetchede konsekvent forkert issue)

**Verifikation:**
```bash
bash scripts/session-prefetch-issue.sh
cat .codex.local/SESSION_CONTEXT.md
```

### `Stop` → `bash scripts/check-now-md.sh`

**Hvad:** Close-out-reminder ved session-stop. Funktioner:

1. **NOW.md budget-warning** hvis >~1.200 tok (primær gate, jf. #1275) eller >30 linjer — reminder om at trimme gamle close-out-blokke direkte. Auto-archive til `docs/archive/NOW-*.md` er FJERNET per #750 (ejer-beslutning: historik bevares i git-log + issue-tråde; mappen er #684-deny-beskyttet). Hooken muterer aldrig NOW.md.
2. **CLAUDE.md / MEMORY.md budget**-warning hvis over linje-target.
3. **Close-out-detektion** hvis `origin/main` har commits nyere end `docs/NOW.md` indenfor 30 min.
4. **Refs #N reminder** (issue [#75](https://github.com/NicolaiDolmer/CyclingZone/issues/75)) — hvis seneste main-commit har `Refs #N` men det refererede issue ikke har en kommentar med commit-SHA, mind brugeren om manuel close-out.

**Hvorfor:** Token-disciplin + sikrer at session-historik bevares som issue-comments (cross-tool tilgængelig).

**Verifikation:** `bash scripts/hooks/__tests__/test-stop-hook.sh` (selv-cleaner; bevarer NOW.md uændret efter test).

### `PreToolUse` → `bash scripts/hooks/lint-gh-issue.sh` (matcher: `Bash`) — [#73](https://github.com/NicolaiDolmer/CyclingZone/issues/73)

**Hvad:** Scanner `gh issue ...` Bash-kommandoer for token-spildende mønstre. **Warning-only** (exit 0 + `systemMessage`).

Flagger:
- `gh issue view N` uden `--json` → foreslår `--json title,body,labels,state`
- `gh issue list` uden `--label` eller `--limit` → kan hente hele backloggen
- `gh issue view N --comments` uden `--jq` → foreslår `--jq ".comments[-3:]"`

**Opgradering til block-mode:** mulig efter 1-2 ugers brug — skift exit 0 til exit 2 og rute besked til stderr.

### `PreToolUse` → `bash scripts/hooks/check-now-md-edit.sh` (matcher: `Edit`, `Write`, `NotebookEdit` — split per #385) — [#76](https://github.com/NicolaiDolmer/CyclingZone/issues/76)

**Hvad:** Hard-blokerer `Edit`/`Write` på `docs/NOW.md` hvis resulterende linjeantal >30.

**Hvordan:** Læser tool-input via stdin-JSON, beregner delta (`new_string.count('\n') - old_string.count('\n')` for Edit; `content.count('\n')` for Write) og sammenligner med nuværende `wc -l`. Block-mode: exit 2 + stderr.

**Fail-safe:** Hvis `python3` ikke er tilgængeligt eller JSON er korrupt → exit 0 (ingen blokering).

### `PreToolUse` → `bash scripts/hooks/block-archived-edit.sh` (matcher: `Edit`, `Write`, `NotebookEdit` — split per #385) — [#77](https://github.com/NicolaiDolmer/CyclingZone/issues/77)

**Hvad:** Hard-blokerer skriv til paths matchende glob-mønstre i `scripts/hooks/archived-paths.txt`. Default-liste: `docs/archive/**`.

**Tilføj path:** redigér `scripts/hooks/archived-paths.txt` (én glob per linje, `#` for kommentar). Understøtter `*` (path-segment) og `**` (recursive). Absolutte Windows-paths normaliseres til repo-relativ form før match.

**Verifikation:** `bash scripts/hooks/__tests__/test-hooks.sh` dækker alle 3 PreToolUse-hooks + ensure-scheduled-tasks (16 cases).

### `SessionStart` → `bash scripts/hooks/ensure-scheduled-tasks.sh`

**Hvad:** Sikrer at scheduled-tasks defineret i `scripts/scheduled-tasks/*.json` er registreret på den aktuelle PC. Hvis en SKILL.md mangler under `~/.claude/scheduled-tasks/<taskId>/`, emit'er hook'en en `systemMessage` med præcise MCP-parametre — Claude registrerer dem så via `mcp__scheduled-tasks__create_scheduled_task` i sessionen.

**Hvorfor:** scheduled-tasks MCP er user-scoped (per-PC); MCP-serveren har egen state der ikke kan synces via filsystemet alene. Derfor det indirekte mønster: canonical config i repo + hook der nudge'r Claude til at registrere via MCP-tool-call. Idempotent — stille når alt er på plads.

---

## Memory audit (scheduled-tasks, ikke project-hook)

### `node scripts/audit-memory-dir.mjs` — [#380](https://github.com/NicolaiDolmer/CyclingZone/issues/380)

**Hvad:** Scanner `~/.claude/projects/C--dev-CyclingZone/memory/*.md` for:
- Stale entries (>=30 dage uændret)
- Duplikater (frontmatter `description` Levenshtein ≥0.82)
- Frontmatter-rot (manglende felter, ukendt `type`)

**Output:** Markdown-rapport til stdout. JSON-form: `--json`. Rolling baseline: `--baseline-out docs/metrics/memory-baseline.json` (gemmer previous-snapshot til growth-diff).

**Growth-WARN:** `scripts/check-agent-token-hygiene.ps1` indlæser `memory-baseline.json` og advarer hvis week-over-week growth >10%.

**Scheduling — auto-install cross-PC:** scheduled-tasks MCP er user-scoped (per-PC), og MCP-serveren har egen state for cron-firing. For at gøre nye PCs plug-and-play:

- Canonical task-config bor i `scripts/scheduled-tasks/<taskId>.json` + `scripts/scheduled-tasks/<taskId>-prompt.md`.
- SessionStart-hook'en `scripts/hooks/ensure-scheduled-tasks.sh` (registreret i `.claude/settings.json`) tjekker hver session om `~/.claude/scheduled-tasks/<taskId>/SKILL.md` eksisterer. Hvis nogen mangler, emit'er den en systemMessage med præcise MCP-parametre, så Claude registrerer dem via `mcp__scheduled-tasks__create_scheduled_task`.
- Idempotent: når task'en er live på PC'en, er hook'en stille.
- Tilføj ny task: drop en `.json`-fil + tilhørende prompt-fil i `scripts/scheduled-tasks/`, commit, push. På næste session-start på enhver PC bliver Claude bedt om at registrere den.

Se [`scripts/scheduled-tasks/README.md`](../scripts/scheduled-tasks/README.md) for schema.

---

## Git hooks (`.githooks/`)

Aktiveres lokalt med:

```bash
git config core.hooksPath .githooks
```

`scripts/setup-local.ps1` gør dette automatisk på ny PC.

### `pre-commit` → `npx lint-staged`

Kører kun lint for staged frontend/backend JS/JSX-filer.

### `pre-push` → `.githooks/pre-push`

Kører før push og blokerer:
- frontend/backend lint-fejl i de pushede commits
- secret-lignende filer eller diff-linjer
- PatchNotes version-duplicates eller PR-version ≤ `origin/main`

Advarer, men blokerer ikke, hvis `docs/NOW.md` er over 60 linjer.

Kører også `scripts/check-agent-token-hygiene.ps1` som warning-only. Den måler standard start-context, `MEMORY.md`, bounded issue-prefetch og seneste Claude transcript, så token-drift bliver synlig før push uden at blokere en vigtig release.

Manuel verifikation:

```bash
node scripts/check-patch-notes-version.js
pwsh -File scripts/agent-doctor.ps1
pwsh -File scripts/check-agent-token-hygiene.ps1
```

---

## User-level hooks (per-PC, ikke committet)

Installeret via `pwsh -File scripts/install-user-hooks.ps1`. Idempotent — bevarer eksisterende settings.

### `SessionStart` → `git fetch --prune origin 2>&1; git status -sb`

**Hvad:** Henter remote-state ved session-start så cross-PC-arbejde er synligt.

### `SessionStart` → `pwsh -File scripts/link-onedrive-context.ps1 ... | Where-Object { ... }`

**Hvad:** Genskaber memory-junction + codex-local AI-context hardlinks fra OneDrive-context hvis de mangler eller peger forkert. Idempotent — første hardlink-tjek afslutter med [skip] når alt er på plads.

**Scope (#327):** Dette script håndterer **kun** memory og AI-context (codex-local). Produktionskritiske secrets (backend/.env, frontend/.env, .mcp.json) administreres via Infisical — se `docs/decisions/secret-management-adr.md`.

**Output-filtrering:** Pipen `| Where-Object { $_ -match 'STOP|err|Exception' }` undertrykker [ok]/[skip]-spam og lader kun konflikter + exceptions slippe igennem til hook-output.

**Edge cases:**
- `env:OneDrive` ikke sat → exit 0 stille (ny PC uden OneDrive blokerer ikke session-start)
- `OneDrive\CyclingZone-context` ikke synket endnu → exit 0 stille
- `memory/` mappe mangler → exit 0 stille
- Lokal fil afviger fra OneDrive (hash mismatch) → throw STOP — Where-Object slipper det igennem som synlig advarsel
- Fil endnu placeholder (cloud-only) → [skip] (ikke fanget af filteret)

**Manuel debug:** `pwsh -File scripts/link-onedrive-context.ps1 -DryRun` rapporterer hvad scriptet ville gøre uden at mutere noget; samler alle konflikter i en samlet rapport ved bunden og exit'er 1 hvis nogen.

### `SessionStart` → `bash scripts/check-stale-branches.sh`

**Hvad:** Lister lokale branches der har "gone" upstream (origin-branchen er slettet, fx efter PR-merge). Output én linje per stale branch med foreslået `git branch -D <name>` cleanup-kommando. **Sletter aldrig automatisk** — kun rapport.

**Edge cases:**
- Ikke et git-repo (cwd udenfor worktree) → exit 0 tomt
- Ingen stale branches → exit 0 tomt (ingen output)
- Branch checked out i anden worktree (`+` prefix i `git branch -vv`) → strippes via sed; vises som almindelig stale branch

### `Stop` → `bash scripts/cross-pc-stop-check.sh`

**Hvad:** Advarer (ikke-blokerende) hvis der er uncommitted/unpushed work eller stash-entries ved session-end.

### `SessionStart` (separat hook) → `bash ~/.claude/scripts/cycling-manager-cleanup.sh`

**Hvad:** Generisk worktree-oprydning for `.claude/worktrees/`.

### `PreToolUse` (matcher: `Bash`, `PowerShell` — split per #385) → `bash scripts/hooks/protect-claude-process.sh`

**Hvad:** Blokerer kommandoer der ville dræbe Claude's eget process-træ (lært 2026-05-04 efter incident).

---

## Tilføj nyt project-level hook

1. Skriv scriptet i `scripts/`
2. `chmod +x scripts/<navn>.sh`
3. Opdatér `.claude/settings.json` (følg eksisterende mønster)
4. Test ved at køre scriptet manuelt
5. Dokumentér her i `docs/HOOKS.md`
6. Commit + push

**Vigtigt:** Hold hooks fail-safe (`exit 0` selv ved fejl). Et hook der fejler hardt kan blokere Claude session-start.
