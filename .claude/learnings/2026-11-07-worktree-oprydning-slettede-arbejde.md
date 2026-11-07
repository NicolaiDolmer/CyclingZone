# 2026-11-07 · Worktree-oprydningen på PC1 slettede arbejde (#7837)

Tredje gang samme fejlklasse: 15/10 (#6687, node_modules), 1/11 (#7446, OneDrive repo-local), 7/11.
Reglen fra 1/11 fandtes som tekst og blev brudt alligevel. Derfor er den nu mekanisk.

## Hvad skete
Ejeren bad PC1 rydde egne branches og worktrees efter reglen i GITHUB_WORKFLOW (#7834): bundle
først, fjern kun det, der er dækket. Claude lavede en verificeret bundle af alle commits og gemte
`git status`-ændringer fra 3 worktrees. Derefter fjernede et ad hoc-script (`remove.mjs` i
scratchpad) 178 worktrees med rå `git worktree remove --force --force` og en `rmSync`-fallback,
uden om `scripts/remove-worktree.ps1`.

## Skade
- `git worktree remove --force` fulgte junctions. Tømt: hovedcheckoutets `node_modules` (rod,
  backend, frontend) og 30 af 36 delte caches i `%LOCALAPPDATA%\CyclingZone\node-modules-cache`.
  Geninstalleret med `npm run sync-deps`. Ingen data.
- Gennem `balance-internals`-junctionen i et worktree: OneDrive `balance-internals/1857/` mistede
  `args_9d85337b_s5.json`, `args_9d85337b_s7.json` og hele `evidence-2026-11-04/` (bevislog og
  brief til #1857). Sletningen gik alfabetisk og stoppede ved replay-filerne. Konklusionen stod på
  #1857 og er merget (#7609). Filerne gendannes fra OneDrives papirkurv (ejeren). Indholdet af
  log og brief er desuden udtrukket fra transcripts til `private-recovery/pc1-worktrees-2026-11-07/`.
- Ignorerede og ikke-versionerede filer i worktrees var ikke arkiveret. `git status --porcelain`
  viser ikke ignorerede filer, og bundlen dækker kun commits. Kortlagt ud fra 6.048 transcripts:
  83 filer skrevet med Write/Edit, som aldrig blev committet (mest PR-tekster, men også
  `docs/audits/2026-10-15-6186-help-vs-v4.md`, `docs/investigations/7707/findings.md`,
  `balance-internals/7635/SUMMARY.md` og et billede-script til #7729). Alle 83 er genskabt fra
  transcripts. Filer, der kun blev lavet af kommandoer (fx `balance-internals/7258/base-stage/
  testport.md`, PR-billeder i `test-results/`), kan ikke genskabes fra transcripts.

## Rod-årsag
1. Claude gik uden om repoets sikre scripts. Reglen var kun tekst (læring 1/11), ingen vagt.
2. "Dækket af bundlen" blev tolket som "commits er gemt". Ikke-versionerede og ignorerede filer er
   også arbejde, og ingen procedure arkiverede dem.
3. De sikre scripts arkiverede heller ikke ignorerede filer og slettede worktreets transcripts,
   så selv den rigtige vej kunne miste arbejde.
4. `cycling-manager-cleanup.sh` og lane-briefen (`make-wave-brief.mjs`) brugte også rå
   `git worktree remove`.

## Forebyggelse (PR til #7837)
- `Remove-WorktreeSafely` (`scripts/lib/archive-worktree-unversioned.ps1`): links ud → arkiv af
  ALT ikke-versioneret inkl. ignorerede filer, ucommittede ændringer og commits uden for
  origin/main til OneDrive `private-recovery/worktree-archive/` → verificér → først da fjern.
  Fejler et trin, bliver worktreet stående. Bruges af remove-worktree, prune-merged-worktrees,
  cycling-manager-cleanup og lane-briefen.
- Transcripts slettes aldrig længere (kun memory-linket fjernes).
- Hook `block-unsafe-delete.sh` (Claude Bash+PowerShell, Codex Bash): blokerer rå
  `git worktree remove` og rekursiv sletning mod worktrees, OneDrive og caches, også inde i et
  ad hoc-script, som kommandoen kører. Testet mod det præcise script fra 7/11.
- CI-test: kun allowlistede scripts må indeholde `worktree remove`.
- AGENTS hard rule 38 + CLAUDE.md + GITHUB_WORKFLOW.

## Regel
Intet arbejde må slettes, før det er færdigt og live, eller arkiveret og verificeret. Ved
oprydning: kun `scripts/remove-worktree.ps1` / `prune-merged-worktrees.ps1`. Er der tvivl om,
hvad en sletning rammer, så stop og spørg ejeren.
