# 2026-08-06 · Commit landede på en parallel sessions branch i hoved-checkoutet (4. bid af delt-checkout-klassen)

## Hvad skete

Under verdensklasse-bølge 1 (epic #3395) skulle orkestratoren committe patch notes v7.98 på `main`. En **parallel session** havde i mellemtiden skiftet hoved-checkoutet (`C:\Dev\CyclingZone`) til sin egen branch `fix/3416-entrant-uid-stable-key` med uncommitted arbejde — på trods af at dens prompt eksplicit forbød at røre hoved-checkoutet.

1. Første commit-kæde havde branch-guarden `[ "$(git branch --show-current)" = "main" ] && …` → den fejlede **tavst** (exit 1, ingen output).
2. Orkestratoren tolkede den tavse fejl som et flaky-kald og **gentog kommandoen UDEN guard** → committen landede på den fremmede branch.

## Recovery (virkede, genbrugelig opskrift)

1. `git show <sha> > patch.fil` (bevar arbejdet) → verificér `HEAD == <sha>` → `git reset --mixed HEAD~1` → `git checkout -- <mine filer>` (fremmed tree restaureret, deres uncommitted filer urørt).
2. `git worktree add <tmp> main` (main var netop IKKE checked out nogen steder) → `git cherry-pick <sha>` (objektet overlever reset — worktrees deler object store) → `git push origin main` → `git worktree remove <tmp>`.

## Læringer (det nye i 4. forekomst)

- **En tavs guard-fejl ER signalet.** Når branch-guarden exiter 1 uden output, er svaret "checkoutet står forkert" — ALDRIG "prøv igen uden guard". Gentagelsen skal beholde guarden og i stedet undersøge `git branch --show-current`.
- **Multi-session-perioder = commit til main KUN via midlertidigt worktree.** Hoved-checkoutets branch er ikke din; ejerskabet kan skifte mellem to af dine egne tool-kald. `git worktree add <tmp> main` koster ~30 s og eliminerer klassen.
- **Agent-prompt-forbud skal dække destinationen, ikke handlingen:** "rør ikke hoved-checkoutet" blev brudt af en anden sessions agent alligevel. Forsvar dig i EGEN kæde; stol aldrig på andres compliance.
- Samme bølge viste også instruks-bogstav-problemet: "rør ikke PatchNotesPage.jssx" stoppede ikke agenter i at redigere `patchNotes.js` (data-SSOT). Forbud skal nævne alle konkrete filer.

Refs: `feedback_verify_branch_before_commit_shared_checkout` (bid 1-3: 11/6, 12/6, 13/6) · natbølge-artifact `docs/audits/night-wave-2026-08-06.md`.
