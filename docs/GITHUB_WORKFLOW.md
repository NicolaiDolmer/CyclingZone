# GitHub-workflow — Nicolai ↔ Claude

## Hvordan vi samarbejder via issues

### Du → Claude (du opretter issue)
1. Åbn https://github.com/NicolaiDolmer/CyclingZone/issues/new/choose
2. Vælg template: **Claude task** (fix/feature), **Claude investigation** (kun rapport), eller **Bug report**
3. Udfyld required-felter — issuet får automatisk `claude:todo` + `priority:*`
4. Næste session: bare sig "tjek mine issues" (eller jeg gør det selv ved start)

### Claude → Dig (jeg åbner issue)
- Når jeg opdager noget out-of-scope, opretter jeg et issue med `claude:todo` + en kort beskrivelse i stedet for at sidetracke nuværende arbejde
- Når jeg er blokeret af en beslutning du skal træffe, kommenterer jeg på issuet og sætter `claude:blocked`

## Label-state-maskine
| Label | Hvem sætter | Betydning |
|---|---|---|
| `claude:todo` | Bruger (auto via template) eller Claude | Klar til Claude pick-up |
| `claude:in-progress` | Claude | Aktiv arbejdssession |
| `claude:blocked` | Claude | Venter på input fra bruger (se nyeste comment) |
| `claude:done` | Claude (på PR-merge) | PR merged, afventer brugerens verifikation før close |
| `priority:high\|med\|low` | Bruger | Pick-rækkefølge |
| `type:bug\|feature\|refactor\|docs\|investigation` | Auto via template | Filtrering |

**Brugeren** lukker issuet efter verifikation (`completed` reason). Claude lukker kun sine egne `not_planned`-issues (fx duplikater, scope-ændringer).

## Commit/PR-konvention
- Commit-besked nævner issue: `Fix: gæld vises i Min aktivitet (#42)`
- PR-body har `Closes #42` så GitHub auto-lukker issuet ved merge
- En PR = ét issue (med mindre flere er klart koblede — så `Closes #42, closes #43`)

## Session-start (Claude)
Ved hver session-start tjekker Claude `gh issue list --label "claude:todo" --state open --repo NicolaiDolmer/CyclingZone` og foreslår at tage den top-prioriterede hvis brugeren ikke selv peger på en konkret opgave.

## Cheatsheet
```bash
# Liste åbne todo-issues
gh issue list --label "claude:todo" --state open

# Læs et specifikt issue + comments
gh issue view 42 --comments

# Kommentér
gh issue comment 42 --body "..."

# Luk
gh issue close 42 --reason completed
```
