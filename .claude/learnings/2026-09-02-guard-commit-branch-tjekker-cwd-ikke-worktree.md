# Postmortem · 2026-09-02 · guard-commit-branch tjekkede shell-cwd, ikke det worktree der blev committet i

## Hvad skete der?
En rebase-worker i natbølgen (PR #4608) arbejdede i et dedikeret worktree via `git -C <worktree>` og kaldte `bash <worktree>/scripts/guard-commit-branch.sh <branch>` foran sin commit. Guarden svarede "BLOKERET: checkoutet staar paa main", selvom worktree'et stod korrekt på branchen (verificeret direkte med `git -C <dir> branch --show-current`). En blokerende guard gav altså en falsk dom, og workeren måtte verificere udenom den.

## Root cause
Guarden kaldte `git branch --show-current` uden `-C`, dvs. mod processens shell-cwd. Agent-shells nulstiller cwd mellem Bash-kald, så cwd var hoved-checkoutet (på `main`), ikke worktree'et. At scriptet blev kaldt fra worktree'ets egen kopi sagde intet om hvilket træ det tjekkede.

Den farligere spejling: kaldt med et worktree på FORKERT branch ville guarden stille have passeret, fordi cwd (`main`) matchede det forventede `main`. Testen `worktree paa forkert branch + <dir>` gav exit 0 før fixet.

## Fix
`scripts/guard-commit-branch.sh` (PR for #4658):
- Valgfrit 2. argument `<dir>` → `git -C "<dir>" branch --show-current`. `<dir>` valideres som git-arbejdstræ; ellers exit 2 (aldrig et stille pass).
- Uden `<dir>`: er scriptets repo-rod en anden end cwd's repo-rod, eller er cwd slet ikke et repo, exiter guarden 2 med en "to traeer i spil"-besked der viser den rigtige kommando. Den gætter ikke.
- Beskederne nævner nu hvilket træ der blev tjekket.
- Ny test `scripts/test-guard-commit-branch.sh`: throwaway-repo + linked worktree, 19 cases inkl. den præcise 2/9-form.

## Forhindret-fremover
- Testen dækker scenario A (delt checkout på forkert branch → stadig blokeret) og B (worktree på korrekt branch, kaldt fra anden cwd med `<dir>` → ikke blokeret).
- Hard rule 18 (`AGENTS.md`), `CLAUDE.md`-linjen og worker-templaten i `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` siger nu: giv guarden SAMME mappe som din `git -C`.
- Guarden selv underviser ved fejlkaldet: exit 2-beskeden indeholder den korrekte kommando.

## Læring
En vagt der læser implicit tilstand (cwd) er kun korrekt, når kalder og vagt er enige om hvad "her" betyder. Bruger kalderen `-C`, skal vagten også have `-C`. Generelt: en guard skal tage sit mål som eksplicit argument, når den kaldes fra shells hvis cwd ikke er stabil, og den skal hellere nægte at dømme (exit 2 + hint) end gætte.

Refs: #4658 · #4016 · forrige bid af klassen: `2026-08-06-shared-checkout-cross-session-commit.md`.
