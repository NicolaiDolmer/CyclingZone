# 2026-09-22: PR med base på en anden PR's branch lukkes af GitHub når basen merges

**Symptom:** #5470 (patch note v7.293) og draft #5476 (kalender-varianter) blev lukket automatisk 22/9 uden at nogen rørte dem. #5470 var baseret på #5477's branch, #5476 på #5469's branch. `merge-queue.ps1` merger med `--delete-branch`; når base-branchen forsvinder, lukker GitHub alle PR'er der har den som base, og de kan ikke genåbnes (`gh pr reopen` → "Could not open the pull request") før base-branchen findes igen.

**Hvad det kostede:** #5470 måtte genoprettes som #5478 (samme commits, ny PR, ny CI-kørsel). Forsøg på at genskabe base-branchen via `gh api -X POST git/refs` blev blokeret af tilladelseslaget. #5476 står lukket med branchen intakt; ny PR åbnes når ejeren har besluttet sig.

**Regel:** Stablede PR'er (base = en anden PR's branch) retargetes til `main` FØR basen merges: `gh pr edit N --base main`. Merge-køen kunne tjekke `gh pr list --base <branch>` før `--delete-branch` og retargete automatisk; det er ikke bygget (issue oprettes hvis mønstret bider igen).

**Refs:** #5470 → #5478, #5476, #5405.
