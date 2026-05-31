# Postmortem · 2026-05-31 · squash-merge bryder ancestry-baseret merge-detektion

## Hvad skete der?
`scripts/remove-worktree.ps1` efterlod lokale branches efter den helt normale squash-merge PR-workflow. Konkret: `docs/844-countries-system` blev beholdt lokalt efter PR #845 (squash-merged), og brugeren måtte manuelt `git branch -D`. Scriptet rapporterede "Branch ... ikke merged til origin/main — beholdes lokalt".

## Root cause
Detektionen brugte alene `git branch --merged origin/main`. Det er en **ancestry-check**: den lister kun branches hvis tip-commit er en ancestor af `origin/main`. En squash-merge skaber ÉN ny commit på main, der indeholder branchens samlede diff, men **uden ancestry** til branchens egne commits — så branchens tip er ikke ancestor af main, og `--merged` ser den (korrekt, men uhensigtsmæssigt) som "ikke merged". Samme grund til at `git branch -d` (lille d) nægter at slette en squash-merged branch.

## Fix
Ny delt detektion i `scripts/lib/git-merge-detection.ps1`, brugt af `remove-worktree.ps1`:
- Ancestry-sti (`git branch --merged`) → `git branch -d` (almindelige merges, fallback).
- Squash-sti (`gh pr list --state merged --head <branch>`) køres når ancestry fejler → `git branch -D` (force, fordi git ikke ser den som merged).
- `gh` utilgængelig/fejl → ubestemt → branchen beholdes (sletter aldrig uden bekræftelse).
Commit `f93451e` (PR #852).

## Forhindret-fremover
Ny hermetisk test `scripts/test-remove-worktree-merge-detection.ps1` (19/19) bygger et ægte temp-repo og beviser at ancestry fanger en almindelig `--no-ff`-merge men IKKE en squash-merge, og at `-d` nægter squash-branchen mens `-D` virker. Beslutnings-logikken er en ren funktion (`Get-BranchMergeDecision`), så alle fire grene testes uden git/gh/netværk.

## Læring
`git branch --merged` / `git branch -d` er ancestry-baserede og ser **ikke** squash-merges (eller rebase-merges) — den dominerende merge-strategi i dette repo. Vil man vide "er denne branch reelt landet på main", så spørg om patch-equivalens (`git cherry`) eller — mest robust her, hvor alt går gennem `gh` + squash — om der findes en merged PR: `gh pr list --state merged --head <branch>`. Relevant alle steder der auto-rydder branches op (fx SessionStart-stale-branch-hook'en bruger en separat "merged & deleted from origin"-heuristik til samme formål).
