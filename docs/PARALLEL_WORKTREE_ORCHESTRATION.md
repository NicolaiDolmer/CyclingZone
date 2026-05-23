
# Parallel Worktree Orchestration — Playbook

> Etableret 2026-05-23 efter Session K (3 PRs merged i én parallel run, ~30 min wall-clock vs. 2-3h sekventielt).
> Postmortem: [`.claude/learnings/2026-05-23-parallel-orchestration.md`](../.claude/learnings/2026-05-23-parallel-orchestration.md)
> Setup: [`docs/WORKTREE_WORKFLOW.md`](WORKTREE_WORKFLOW.md)

## TL;DR

Master-session spawner 3 parallelle subagents (1 pr. worktree) → 3 PRs merges sekventielt med rebase → én samlet close-out. Token-cost: roughly neutral vs. sekventielt. Wall-clock-besparelse: ~4-6×.

## Hvornår bruge denne workflow

✅ **JA** når der ligger 3+ åbne `claude:todo` issues der opfylder:
- NUL filoverlap mellem touch-areas (vis tabel før spawn)
- Ingen `cat:user-feature` (kræver Chrome MCP UI-verify — ikke parallel-friendly)
- Ingen `shared-refactor` / `needs-contract` labels (kræver GUARDRAILS_CORE)
- Klart scoped (acceptance criteria + ~1-2h estimat pr. issue)
- Backend-only / docs-only / cleanup foretrækkes
- Lav-risk: `risk:low` eller `risk:med`

❌ **NEJ** når:
- Issues rører samme filer (NOW.md, PatchNotesPage.jsx, MEMORY.md er typisk fælles)
- Issues kræver `npm install` med forskellige deps (delte node_modules)
- Issues har høj risiko / `risk:high`
- Du har <3 candidates der opfylder constraints (brug normal sekventiel)
- Subagent permission-status er ukendt (test først med dry-run hvis usikker)

## 7-step protokol



### 1. Candidate-selection

Brug `scripts/find-parallel-candidates.ps1` (auto-rank + greedy bundle-selection, ~5-10 min sparet vs. manuel gennemgang):

```powershell
pwsh -File scripts/find-parallel-candidates.ps1
# Optional: tune
pwsh -File scripts/find-parallel-candidates.ps1 -Limit 30 -BundleSize 3 -NumBundles 5
# Vis ogsaa hard-blocked issues (cat:user-feature etc.)
pwsh -File scripts/find-parallel-candidates.ps1 -IncludeFiltered
```

Scriptet henter aabne `claude:todo` issues via `gh`, scorer hver paa parallel-safety (penalty for `cat:user-feature` / `shared-refactor` / `needs-contract` / `risk:high`; bonus for `docs-only` / `backend-only` / `cleanup` / `risk:low`), foreslaar touch-area pr. issue og genererer top-3 bundles med NUL overlap. Output er markdown - pipe til fil eller laes direkte.

Eller manuelt (fallback hvis scriptet fejler):

```powershell
gh issue list --label "claude:todo" --state open --limit 20 --json number,title,labels,updatedAt
```

Filter paa constraints ovenfor. Vis touch-area-tabel:




| # | Issue | Touch-area | Konflikt-risiko |
|---|---|---|---|
| 1 | #N | `<paths>` | LOW/MED/HIGH |

Få brugeren til at godkende inden spawn.

### 2. Master claim NOW.md

```markdown
> **🤖 Working agent:** Claude · Code (Opus 4.7) · PC1 · YYYY-MM-DD — orchestrating 3 parallelle worktree-sessions: #N1 + #N2 + #N3.
```

Commit + push til main. Multi-AI safety per [#559](https://github.com/NicolaiDolmer/CyclingZone/issues/559).

### 3. Worktree-setup (SEKVENTIELT — git race condition)

```powershell
pwsh -File scripts/new-worktree.ps1 -Branch <type>/<N>-<slug>
# Gentag 3x — sekventielt, IKKE parallelt
```

Branch-navne følger projektets convention: `chore/`, `docs/`, `fix/`, `feat/` prefix.

### 4. Spawn subagents (PARALLELT — single message)

Send 3 `Agent`-kald i samme message for ægte parallel-execution.

Brug `run_in_background: true` så master får completion-notifikation.

**⚠️ Kendt issue: subagent Write-restriktion er inkonsistent.** I 2026-05-23-K blev 2 af 3 subagents nægtet Write-tool. Dry-run test viste at `isolation: "worktree"` parameter IKKE fikser problemet (denial sker på harness/permission-laget, ikke worktree-laget). Indtil rod-årsag er fundet ([#591](https://github.com/NicolaiDolmer/CyclingZone/issues/591) subagent permission debug), giv subagents fallback-instruktion:

> "Hvis Write-tool denied: brug `git commit -m "line1" -m "line2"` med multiple flags i stedet for tmp-fil, og `gh pr create --body "..."` med inline body. Returnér PR-nummer + commit-SHA, så master kan re-edit PR-body med proper markdown bagefter."

### 5. Vent på notifikationer

Master må IKKE poll subagent-output. Notifikation kommer automatisk når hver er færdig.

Mens du venter: kan du arbejde på andet, eller bare give brugeren status og slut turn.

### 6. Sekventiel merge (lavest risk først)

Rækkefølge-heuristik:
- Docs-only / metadata først (ingen kode-konflikt potentiale)
- Cleanup / backend-only næst
- Kompleks docs eller mixed sidst

```bash
gh pr merge <N> --squash
# Vent på success, fetch main
# Gentag for næste
```

Squash holder main-historik flad. Hver merge auto-skubber main → næste PR rebases automatisk på GitHub.

### 7. Close-out (én commit)

Kombinér i én commit:
- NOW.md Session-X bullet (kort: hvilke 3 PRs + hovedfund)
- Eventuelt: arkivér gamle session-bullets til `docs/archive/NOW-YYYY-MM-DD.md` hvis NOW.md overstiger token-budget
- Reset `🤖 Working agent` til `_Ingen aktiv session._`

Derefter:
- `gh issue edit <N> --add-label claude:done --remove-label claude:todo` for hver
- Optional: `gh issue comment <N> --body-file ...` hvis scope-korrektion eller out-of-scope-fund
- Worktree cleanup: `pwsh -File scripts/remove-worktree.ps1 -Branch <branch>` x3
- Force-delete local branches (squash-merge artifact): `git branch -D <branch> <branch> <branch>`
- Remote branches auto-slettes typisk af GitHub merge-settings

## Sub-agent prompt template

Hver subagent prompt skal være self-contained (ingen kontekst fra master-samtalen). Brug denne struktur:

```
Du er en autonom subagent uden kontekst fra mor-samtalen. Læs HELE briefen før du starter.

# Mission
Pick op GitHub issue #<N> (repo: NicolaiDolmer/CyclingZone, projekt: CyclingZone manager-spil): "<title>"

# Working directory + branch
ABSOLUT WORKING DIR: C:\dev\CyclingZone-worktrees\<slug>
BRANCH: <branch> (allerede oprettet, tracks origin/main)
START med: `cd "<path>"` ELLER brug `git -C "<path>"`. Arbejd ALDRIG i C:\dev\CyclingZone (main worktree).

# Issue scope
<copy fra issue-body>

# Workflow
1-5. <step-by-step>

# Verify
- <kommandoer der SKAL være grønne før commit>

# Rebase + commit + push + PR
1. `git fetch origin && git rebase origin/main`
2. `git add <specifikke-filer>` (ALDRIG `git add -A` — lint-staged-pitfall sweeper untracked ind)
3. Write commit-msg-fil — ALDRIG PowerShell heredoc (`@'...'@` / `<<EOF`) — kendt bug i Bash-tool på Windows. Filnavn: `.tmp-<N>-commit.txt`. Indhold: <commit-msg-template>
4. `git commit -F .tmp-<N>-commit.txt && rm .tmp-<N>-commit.txt`
5. `git push -u origin <branch>`
6. Write PR-body til `.tmp-<N>-pr.md`. Skal indeholde Brugerverifikation-sektion ELLER tilføj backend-only/docs-only label.
7. `gh pr create --base main --head <branch> --title "..." --body-file .tmp-<N>-pr.md --label <label>`
8. `rm .tmp-<N>-pr.md`

# DU MÅ IKKE
- Rør docs/NOW.md (centralkoordineret af master-session)
- Rør frontend/src/pages/PatchNotesPage.jsx (medmindre cat:user-feature)
- Rør MEMORY.md eller andre memory-filer
- Bruge PowerShell heredoc — ALTID Write→fil + `git commit -F`
- Arbejde i C:\dev\CyclingZone (main worktree)
- Mark issue closed i commit ("Closes #N") — projektets close-protokol er "Refs #N", brugeren lukker selv

# Return-format
- PR-nummer
- Commit-SHA
- Hovedændringer
- Status på tests/build
- Eventuelle out-of-scope-fund (skriv som issue-forslag, opret IKKE selv)
```

## Token-budget per parallel run (baseline 2026-05-23)

| Komponent | Tokens |
|---|---|
| Subagent (let task, fx cleanup) | ~55-75K |
| Subagent (kompleks docs/verify) | ~150-200K |
| Master orchestration | ~25-40K |
| **Total** | **~250-400K** |

Roughly neutral vs. 3 sekventielle sessions med cold-start hver. **Wall-clock-besparelse er den primære gevinst** (~4-6×).

## Common pitfalls

1. **Subagent Write-restriktion (ULØST)** — 2 af 3 subagents kan ramme sandbox Write-denial uventet. `isolation: "worktree"` parameter fikser det IKKE (verified 2026-05-23). Workaround: instruér subagent om `git commit -m ... -m ...` + inline `--body` fallback; master kan re-edit PR-body bagefter for læselighed.
2. **Subagent skriver til docs/NOW.md** — race-condition med master. Instruér eksplicit "rør IKKE NOW.md".
3. **Parallel worktree-setup** — `git worktree add` har race condition. Kør sekventielt.
4. **Skip Brugerverifikation-sektion i PR-body** — `PR user-verification check` fejler. Tilføj sektion ELLER `backend-only`/`docs-only` label.
5. **Subagent bruger PowerShell heredoc** — kendt bug på Bash-tool på Windows. Instruér: Write→fil + `git commit -F`.
6. **Subagent kører `git add -A`** — lint-staged-pitfall, sweeper untracked filer ind. Kun specifikke filer.
7. **Master polluerer subagent-output** — læs IKKE subagent-transcript-filer (overflow context). Vent på completion-notifikation.

## Lessons fra første run (2026-05-23-K)

- HOT-memory "Verificér FØR claim" reddede en scope-fejl (#547 setup.py)
- Sekventiel merge med rebase = ingen konflikter på main
- Same-time NOW.md slankning er gratis side-win
- Sandbox Write-restriktion var største friktion — `isolation: "worktree"` testet 2026-05-23 og fikser det IKKE (denial sker på harness-laget). Workaround via `git commit -m` + inline body fungerer indtil rod-årsag fundet

