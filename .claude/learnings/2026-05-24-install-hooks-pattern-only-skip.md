# Postmortem: install-user-hooks pattern-only skip + audit cleanup-rod

**Date:** 2026-05-24
**Issue:** [#522](https://github.com/NicolaiDolmer/CyclingZone/issues/522)
**PR:** [#604](https://github.com/NicolaiDolmer/CyclingZone/pull/604)
**Bugs fixed:** 1 (install-user-hooks) + 1 forward-guard (audit -AutoFix)

## Hvad skete der

To koblede problemer der gentog sig hver session siden cross-PC setup blev rullet ud:

1. **`.codex.local/` cleanup-rod:** Agents skrev issue/PR-bodies + commit-messages til `.codex.local/` for at undgå PowerShell heredoc-problemer, men slettede ikke filerne efter `gh create` / `git commit -F`. Hver session-start fandt audit-script flere "local-only-content" findings. Manuel cleanup blev gentaget igen og igen.

2. **`install-user-hooks.ps1` pattern-only skip:** Funktionen `Add-Hook` brugte `$h.command -like $MatchPattern` (fx `*protect-claude-process*`) som idempotency-check. Det matchede gladeligt `bash /c/Users/ndmh3/.claude/scripts/protect-claude-process.sh` (PC1's hardcoded path efterladt på PC2) og skippede installation med "findes allerede". Resultat: PC2-pickup havde defekte hooks indtil bruger manuelt rettede `~/.claude/settings.json`.

## Root cause

**For (1) cleanup-rod:** ingen automatisk delete-after-publish for `.codex.local/`-buffers. Agenter glemte det; manuel disciplin er ikke holdbar i et multi-agent system.

**For (2) install-hooks bug:** idempotency-check brugte pattern-match i stedet for exact-match. Pattern var korrekt designet til at fange "samme script-fil", men antog at filename = identity. Når path-prefix kunne variere (cross-PC), brød antagelsen sammen uden detection.

## Forward-guard

**`cross-pc-forensic-audit.ps1 -AutoFix` (ny):**
- Auto-sletter `stale-ephemeral` (>1h gamle commit-msg/pr-body buffers) ubetinget — de var aldrig ment til at overleve `git commit -F`.
- Auto-sletter `local-only-content` hvor filename indeholder issue/PR-nummer som findes på GitHub (verificeret via `gh issue view N` / `gh pr view N`). Filer uden parsbart nummer eller uden match beholdes som ERROR — agent skal manuelt verificere før sletning.
- Filename-patterns: `issue-N`, `pr-N`, `pr-body-N(-M)`, `comment-N`, `N-*` (any).

**`install-user-hooks.ps1` Add-Hook (fixet):**
- Eksakt-match (`$h.command -eq $Command`) → skip (korrekt allerede installeret)
- Pattern-match + `/c/Users/<andet>/` in command → REPLACE + bevar timeout (wrong-user path fra cross-PC pickup)
- Pattern-match + ingen hardcoded path → warn+skip (user customization, ikke vores at overskrive)
- Idempotent: re-run på korrigeret settings producerer ingen ændring (verificeret)

## Backwards-check

Grep'ede alle `*.ps1` i `scripts/`:
- `-like`-brug: kun `install-user-hooks.ps1:89` (fixet). Andre `-like`-brug i `verify-deploy.ps1` + `agent-doctor.ps1` er filter/discovery, ikke skip-decisions mod existing-state.
- "findes allerede"-skip: andre forekomster (`new-worktree.ps1`, `setup-new-pc.ps1`) bruger `Test-Path` (exact file/dir existence), ikke pattern-match mod indhold. Ikke sårbare for samme bug.
- `/c/Users/` hardcoded: kun i `cross-pc-forensic-audit.ps1` (detection-pattern, korrekt) og `install-user-hooks.ps1` (detection + replace, korrekt). Ingen andre scripts har unguarded `/c/Users/` references.

Konklusion: bug-pattern var unikt for `install-user-hooks.ps1`. Cleanup-rod var systemisk men nu auto-håndteret via `-AutoFix`.

## Lesson

**Pattern-match idempotency-checks må aldrig sammenligne mod existing state der kan variere i prefix/path.** Hvis du tjekker "er X allerede her", brug exact-match som primær gate. Pattern-match er kun korrekt hvis du har en grund til at acceptere ALLE variationer som "samme" — og hvis du har den grund, så dokumentér den eksplicit.

**Cleanup-disciplin skal være maskinel, ikke menneskelig.** Hvis du finder dig selv at gentage manuel cleanup i flere sessions, så er root-causen ikke "agent glemte det" men "der mangler automation". Byg forward-guarden ved 2. gentagelse, ikke ved 5.

## Cluster-link

Del af cross-PC-cluster: [#383](https://github.com/NicolaiDolmer/CyclingZone/issues/383) (hardcoded path-detection), [#522](https://github.com/NicolaiDolmer/CyclingZone/issues/522) (denne), [#603](https://github.com/NicolaiDolmer/CyclingZone/issues/603) (PC2 pickup symptom). Forward-guard her lukker den repeating del — engang-imellem-PC-specifikke residuals kan stadig opstå, men auto-cleanup tager dem ved session-start.
