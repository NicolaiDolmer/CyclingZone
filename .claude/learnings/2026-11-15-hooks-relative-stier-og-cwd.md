# 2026-11-15: hooks sprang over, når cwd ikke var repo-roden (#8206, PR #8207)

## Symptom
Ejeren så otte "A hook gave no usable answer" i en side-session, der arbejdede i `frontend/` og i et midlertidigt worktree.

## Rodårsag (målt)
1. Hook-kommandoerne i `.claude/settings.json` brugte relative stier (`bash scripts/hooks/x.sh`). Fra en undermappe, et andet worktree eller scratchpad gav det exit 127. Secret-, slette-, branch- og preflight-vagterne kørte derfor slet ikke.
2. Hook-processens cwd er ikke nødvendigvis kommandoens mappe. I en worktree-session kørte hooks med cwd `C:\Dev\CyclingZone` (hovedmappen), mens Bash stod i worktreet. Det havde tre følger:
   - Branch-vagten blokerede falsk i et worktree og slap igennem fra `frontend/` i hovedmappen.
   - Push-vagterne målte hovedmappens branch.
   - Slette-vagten gav op uden for repoet.
   Den rigtige mappe står i hook-inputtets `cwd`.

## Rettelse
- Alle hooks kaldes nu som `bash "$CLAUDE_PROJECT_DIR/..."`.
- `scripts/hooks/lib/hook-cwd.sh` (`hook_enter_cwd`, `hook_repo_root`) bruger inputtets cwd.
- Repo-filer findes fra roden, eller fra scriptets eget repo som fallback.
- `scripts/hook-paths.test.mjs` i CI.

## Hvad reviewet fangede undervejs
- Vercel Security Review fandt kode-injektion: at gå ind i kommandoens mappe fik worktree-setup til at køre `setup-worktree.ps1` fra et fremmed checkout.
  - Lære: når en hook skifter mappe til et inspiceret træ, må den aldrig køre kode derfra. Kun eget repo (samme git-common-dir), og scriptet hentes fra hookens betroede repo.
- Vercel og et uafhængigt agent-review fandt omgåelser af branch-vagten: `git -C`, `cd`, subshell, `bash -c`, `--work-tree` og `cd "$PWD/..."`.
  - Lære: en uopslåelig mappe er ukendt (fail-closed), aldrig "ikke hovedmappen".

## Forebyggelse
`hook-paths.test.mjs` fejler ved en relativ hook-sti. Den kører alle Pre/PostToolUse-hooks fra `frontend/` og fra en mappe uden for repoet, og den dækker hver omgåelse ovenfor.
