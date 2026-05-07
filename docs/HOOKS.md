# Hooks — Cycling Zone

Dette repo har to lag af Claude Code hooks:

- **Project-level** (committet, gælder for alle der arbejder på repoet): `.claude/settings.json`
- **User-level** (per-PC, ikke committet, sat op via `scripts/install-user-hooks.ps1`): `~/.claude/settings.json`

> Hooks i Claude Code: se [docs.claude.com/.../hooks](https://docs.claude.com/en/docs/claude-code/hooks). Hook-events der bruges her: `SessionStart`, `Stop`, `PreToolUse`.

---

## Project-level hooks (`.claude/settings.json`)

### `SessionStart` → `bash scripts/session-prefetch-issue.sh`

**Hvad:** Læser `docs/NOW.md`, finder første `#N`-reference (med Discord-tag-filter), henter issue + seneste 3 comments via `gh`, og skriver et struktureret resumé til `.codex.local/SESSION_CONTEXT.md`.

**Hvorfor:** Sparer 300-500 tokens pr. session start. CLAUDE.md step `0b` auto-loader filen — uden hook skulle Claude/Codex selv kalde `gh issue view` i samtalen, hvilket koster turn-roundtrip.

**Fail-safe:** Exit altid 0. Filen overskrives KUN hvis et gyldigt issue blev hentet — fejl-tilfælde bevarer evt. eksisterende `SESSION_CONTEXT.md`.

**Edge cases håndteret:**
- `gh` ikke installeret eller ikke autentificeret → exit 0, ingen ændring
- `docs/NOW.md` mangler → exit 0
- `#N` ikke fundet i NOW.md → exit 0
- Issue 404 / network error → exit 0
- Discord-tag som `Cycling Zone#8784` → ignoreres (regex kræver non-alphanum før `#`)
- Encoding: `PYTHONIOENCODING=utf-8` så æøå overlever Windows-python

**Strategi for issue-valg:**
1. Først 25 linjer af NOW.md (typisk "Aktiv slice" + status-sektion)
2. Fallback: hele filen
3. Brugeren styrer ved at placere det aktive `#N` højt i NOW.md

**Verifikation:**
```bash
bash scripts/session-prefetch-issue.sh
cat .codex.local/SESSION_CONTEXT.md
```

### `Stop` → `bash scripts/check-now-md.sh`

**Hvad:** Advarer hvis `docs/NOW.md` er over 40 linjer (mål er max 30).

**Hvorfor:** Token-disciplin per CLAUDE.md.

---

## User-level hooks (per-PC, ikke committet)

Installeret via `pwsh -File scripts/install-user-hooks.ps1`. Idempotent — bevarer eksisterende settings.

### `SessionStart` → `git fetch --prune origin 2>&1; git status -sb`

**Hvad:** Henter remote-state ved session-start så cross-PC-arbejde er synligt.

### `SessionStart` → `pwsh -File scripts/link-onedrive-context.ps1 ... | Where-Object { ... }`

**Hvad:** Genskaber memory-junction + secret-hardlinks fra OneDrive-context hvis de mangler eller peger forkert. Idempotent — første hardlink-tjek afslutter med [skip] når alt er på plads.

**Output-filtrering:** Pipen `| Where-Object { $_ -match 'STOP|err|Exception' }` undertrykker [ok]/[skip]-spam og lader kun konflikter + exceptions slippe igennem til hook-output.

**Edge cases:**
- `env:OneDrive` ikke sat → exit 0 stille (ny PC uden OneDrive blokerer ikke session-start)
- `OneDrive\CyclingZone-context` ikke synket endnu → exit 0 stille
- `memory/` eller `secrets/` mappe mangler → exit 0 stille
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

### `PreToolUse` (Bash|PowerShell) → `bash ~/.claude/scripts/protect-claude-process.sh`

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
