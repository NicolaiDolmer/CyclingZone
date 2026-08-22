# Postmortem · 2026-08-22 · byggede ad-hoc worktree-oprydning oven på et eksisterende, bedre værktøj

## Hvad skete der?

Under den daglige Sentry/Railway-triage opdagede jeg at et repo-grep tog over et minut, fordi der lå **77 git-worktrees**. Jeg byggede derpå min egen oprydnings-audit i bash fra bunden, faldt i to fælder undervejs, og fik til sidst ryddet 48 worktrees.

`scripts/prune-merged-worktrees.ps1` (bag `npm run cleanup:worktrees`) gør præcis det samme — og havde ingen af de to fælder, fordi begge allerede var postmortem'et og fixet i scriptet.

## De to fælder, begge allerede dokumenteret

1. **`git branch --merged` ser ikke squash-merges.** Mit første tal sagde "1 worktree sikker at fjerne". Repoet squash-merger alt, så en merged branch er aldrig ancestor af main. Dækket af `.claude/learnings/2026-05-31-squash-merge-breaks-ancestry-detection.md`, som netop indførte `gh pr list --state merged --head <branch>` som det korrekte signal.
2. **`git status --porcelain -uno` skjuler untrackede filer.** Med `-uno` talte jeg 2 worktrees med indhold. Uden: **15**. Forskellen er ikke kosmetisk — jeg havde selv en time forinden reddet 3 untrackede dry-run-scripts (526 linjer) ud af `dryrun-3448`, som `-uno` ikke ville have vist.

Scriptet håndterer desuden en tredje fælde jeg slet ikke havde tænkt på: zero-ahead-guarden fra `2026-06-21-zero-ahead-fresh-worktree-misclassified-as-merged.md`, som forhindrer at friske worktrees uden egne commits fejlklassificeres som merged.

## Root cause

Jeg gik fra symptom (langsomt grep) til egen løsning uden at spørge om værktøjet fandtes. `ls scripts/ | grep worktree` ville have taget to sekunder. Reglen "læs eksisterende planer / tjek om noget allerede findes før du bygger nyt" findes i memory og har bidt før.

Bidraget hertil: de to fælder er dokumenteret i `.claude/learnings/` (509 filer), men jeg læste dem først i close-out, efter at have gentaget begge fejl. Learnings-mappen er kun værdifuld hvis den konsulteres *før* en opgave af kendt klasse, ikke bagefter.

## Den egentlige systemfejl bagved

Hvorfor var der overhovedet 77 worktrees, når `prune-merged-worktrees.ps1` findes og postmortem'et fra 21/6 omtaler "den ugentlige scheduled task fra #1271/#1656"?

`scripts/scheduled-tasks/worktree-cleanup-weekly-prompt.md` findes som prompt, men **der er ingen registreret scheduled task der kører den** på denne maskine. `~/.claude/scheduled-tasks/` har 17 tasks, ingen af dem worktree-oprydning. Automatiseringen blev skrevet og aldrig wiret op, så bunken voksede uforstyrret.

## Læring

- Ved oprydnings-/audit-opgaver: **søg efter et eksisterende script før du skriver et**. `ls scripts/ | grep <emne>` og `grep <emne> package.json`.
- Ved opgaver af en klasse der lugter af tidligere smerte: **grep `.claude/learnings/` først**, ikke i close-out.
- Et postmortem der refererer til en automatisering er ikke bevis for at automatiseringen kører. Verificér registreringen, ikke kun scriptets eksistens.
- `git status --porcelain` uden `-uno` når spørgsmålet er "kan dette slettes uden tab".
