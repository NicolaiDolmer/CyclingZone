# 2026-08-21 — Natbølge: 3 agent-dødsfald + tuning.ts-konflikttog

**Kontekst:** F3-natbølgen (11 workers, 2 workflow-chunks) 21/8 aften. Alle 11 spor leveret og merged samme aften, men 3 agenter døde undervejs, og merge-fasen krævede 5 serielle konflikt-fletninger.

## De tre dødsfald

1. **M6+M9 døde ved spawn** — "Stage 2 classifier error" (transient harness-fejl). Sporet stod usynligt i kø: journal viste 5/6 startede, intet worktree blev oprettet. **Detektion:** tæl `started`-entries i journal.jsonl mod forventet antal STRAKS efter launch.
2. **Orders-API frøs i `lint-migration-idempotency.mjs`-kald** (Bash-kald vendte aldrig tilbage; transcript frossen 17+ min med pending tool_use). Arbejdet (2 SQL-filer) lå ukommitteret i worktree'et.
3. **h2h-scorecard frøs i et heredoc** (`cat > fil <<'EOF'` i commit-kæden) — PRÆCIS fejlklassen fra `feedback_bash_no_powershell_heredoc` (nu bidt 5x). **Rod-årsag: orkestratorens spawn-prompter arvede IKKE heredoc-forbuddet fra memory.**

## Recovery-læringer

- **Subagents arver orkestratorens worktree-pin.** En recovery-agent spawnet fra en worktree-isoleret session kan IKKE operere i et andet worktree (EnterWorktree accepterer nominelt, men alle Bash-kald afvises). Recovery af et fremmed worktree kræver enten (a) orkestratoren skifter selv via EnterWorktree{path}, eller (b) frisk agent med isolation:worktree der kopierer filer fra det døde worktree og bygger på den pushede branch.
- **Stall-watch giver falske positive på færdige agenter** (transcript fryser naturligt ved completion) og **"0 ahead + rent arbejdstræ" er falsk-alarm ved push-kadence** (pushet = 0 ahead). Krydstjek journal-results før recovery.
- **Workflow-barrieren hænger evigt på en død agent** — harvest resultater fra journal.jsonl og TaskStop workflowprocessen når alle skæbner er kendt (17/7-læringen bekræftet igen; per-agent-timeout i workflow-scripts er stadig et hul).

## Merge-toget

5 af 8 engine-PR'er kolliderede i `tuning.ts` (alle appendede deres `*_EXTRA_TUNING`-blok samme sted). Løst serielt: flet én, vent på landing, flet næste mod frisk main (parallelle fix spilder CI-runder, da hver landing re-konflikter resten). Ren append-append: strip markers = behold begge sider + tsc-verify. ~25 min pr. runde.

**Forebyggelse næste bølge:** (a) spawn-prompter angiver en UNIK sektion pr. worker i delte filer, eller en fil pr. mekanik (`tuning.<mekanik>.ts` re-eksporteret); (b) heredoc-forbud + linter-timeout-instruks SKAL med i alle spawn-prompt-skabeloner — læg dem i NIGHT_WAVE_RUNBOOK §Agent-regler.

## Runbook-opdateringer (gjort/todo)

- TODO: NIGHT_WAVE_RUNBOOK §Agent-regler: tilføj heredoc-forbud (Write→`git commit -F`) + "linter-/scriptkald med timeout, skip ved hang" + journal-started-count som launch-bevis-tjek.
- TODO: overvej per-mekanik tuning-filer før næste engine-bølge.
