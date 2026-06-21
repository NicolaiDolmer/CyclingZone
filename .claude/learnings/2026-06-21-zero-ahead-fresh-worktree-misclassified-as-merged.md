# Postmortem · 2026-06-21 · zero-ahead frisk worktree fejlklassificeret som merged

## Hvad skete der?
`scripts/prune-merged-worktrees.ps1` (bag `npm run cleanup:worktrees`, og den ugentlige
scheduled task fra #1271/#1656) ville i en dry-run markere **4 nyoprettede fleet-worktrees**
(feat/1583, feat/1008, chore/1562, fix/1126) til sletning, klassificeret som
"merged til origin/main (ancestry)". De var oprettet fra origin/main minutter forinden og
havde endnu ingen egne commits. Kun det ene worktree med uncommitted changes blev skånet.
Over tid kunne den automatiserede sweep have slettet aktive/friske arbejdspladser → data-tab.

Samtidig: `Remove-MemoryJunction` ryddede aldrig `~/.claude/projects/<encoded>/`-junctions
for `.claude\worktrees`-stier, så ~80 orphan-mapper hobede sig op.

## Root cause
**BUG 1 (data-tab):** `git branch --merged origin/main` er en ren **ancestry-check** — den
lister enhver branch hvis tip er ancestor af base. En frisk branch (tip == base, eller base
voksede forbi den fordi andre PR'er merged) har også tippet i base's historie, så den
rapporteres som "merged" selv om **intet arbejde nogensinde landede**. Ancestry kan ikke
skelne "merged efter eget arbejde" fra "har aldrig haft eget arbejde": begge er ahead==0.
`Get-BranchMergeDecision` stolede på ancestry alene → `Merged=$true`.

**BUG 2 (orphans):** Encoding af worktree-sti → projects-dir-navn var **kopieret** ind i hvert
script og var drevet fra hinanden. `Remove-MemoryJunction` kodede kun `[:\\]`, men Claude Code
koder OGSÅ `.` (og `/`), så `\.claude` → `--claude` on-disk, mens den buggy gav `-.claude`.
`Test-Path` ramte aldrig den rigtige mappe.

## Fix
- Nyt signal `Get-BranchAheadCount` (`git rev-list --count base..branch`) i den delte lib.
  `Get-BranchMergeDecision` fik en `$AheadCount`-param + en **zero-ahead-guard**: ahead==0
  uden merged-PR-bevis → `Method='fresh'` → BEHOLD. Et **positivt merge-bevis (merged PR)
  vinder over** guarden (en merget PR = worktreet er færdigt, ikke frisk). `gh`-proben køres
  nu ALTID (ikke kun når ancestry fejler), så PR-beviset kan løfte en ancestry/ahead==0-branch
  til sletning. `-Force` kan stadig rydde friske worktrees bevidst.
- Encoding konsolideret til én delt funktion `Get-ClaudeProjectDirName`
  (`scripts/lib/claude-project-paths.ps1`), brugt af prune-merged, prune-stale OG
  remove-worktree (sidstnævnte forward-guard — dens layout har ingen `.` i dag, men reglen
  er nu fælles).
- Tests: `test-remove-worktree-merge-detection.ps1` (+11 cases, inkl. ægte-git frisk-bagud-
  reproduktion) og ny `test-claude-project-paths.ps1` (encoding). 32 + 5 grønne.
- Verificeret in-situ: dry-run mod hoved-checkoutet beholder nu de 4 friske `claude/*`-
  worktrees ("frisk/aktiv - behold") mens ægte merged worktrees stadig ryddes.

## Læring
`git branch --merged` / `git branch -d` er ancestry-baserede og er **dobbelt upålidelige**:
de ser ikke squash-merges (kendt siden 2026-05-31), OG de kan ikke skelne en frisk/uarbejdet
branch fra en merget — begge er ahead==0 ift. base. Vil man auto-slette et worktree, så kræv
**positivt bevis for at arbejde landede** (en merged PR, eller egne commits der er ancestry-
merged), ikke bare "tippet er i base". Et worktree er en arbejdsplads, ikke kun en ref —
default ved tvivl er BEHOLD.

Og: når den samme regel (her: sti-encoding) ligger kopieret i N scripts, *driver de fra
hinanden* og skaber præcis denne slags latente bug. Konsolidér til én delt funktion frem for
at tilføje en N+1'te kopi.

Refs #1271. Relateret: `.claude/learnings/2026-05-31-squash-merge-breaks-ancestry-detection.md`.
