# 2026-11-01 · `git worktree remove --force` slettede filer gennem en OneDrive-junction (#7446)

## Hvad skete
Efter merge af #7447 skulle test-worktreet `C:\dev\CZ-7446` ryddes op. Det havde fire junctions til
`OneDrive/CyclingZone-context/repo-local/` (fra en rigtig test-kørsel af link-scriptet) plus
node_modules-junctions til den delte cache. Mit `cmd //c rmdir "C:\\dev\\..."` fra Git Bash fejlede
("Invalid switch - /"), og den rå `git worktree remove --force` kørte bagefter alligevel. Git fulgte
`.codex.local/shared` og slettede 99 af 174 filer i `repo-local/codex-local`. Derefter stoppede git
på "Permission denied", før den nåede node_modules-cachen.

## Skade
Ingen varig. Kildearkivet `dolmerpc-lokale-filer-2026-11-01/` var urørt, og kopi-scriptet
(idempotent, `cmp` før kopi) gendannede alle 99 filer. Optalt bagefter: 18/853/20/174 = 1.065. Cachen
var intakt (frontend 326, backend 181, root 28 pakker).

## Rod-årsag
1. Jeg brugte rå `git worktree remove --force` i stedet for `scripts/remove-worktree.ps1` /
   `scripts/prune-merged-worktrees.ps1` / `close-out-cleanup-junctions.ps1`. De fjerner allerede links
   før fjernelse, fordi præcis denne fejl er sket før med node_modules.
2. Jeg kædede sletningen efter et junction-fjern-trin uden at stoppe, da trinnet fejlede (`;`/`&&` i
   samme kommando).

## Regel
- Fjern aldrig et worktree med rå `git worktree remove`. Brug repoets scripts.
- Skal et link fjernes manuelt, så brug PowerShell `[System.IO.Directory]::Delete(<link>, $false)`
  (ikke-rekursiv, fjerner kun linket), og verificér med `LinkType` før næste skridt.
- Kør aldrig `git clean -x` i hovedcheckoutet. `docs/drafts/local`, `pr-screens/local`,
  `docs/snapshots/local` og `.codex.local/shared` er gitignorerede junctions til OneDrive, og git
  følger dem.
