# Natbølge 21/8: to agenter hang 6-7 timer — orkestrator havde ingen uafhængig vækning

## Hvad skete

Chunk 2 (fix-3896) og chunk 3 (feat-4005) frøs kl. hhv. ~01:11 og ~02:12. `parallel()`-barriererne holdt begge workflows åbne, ingen completion-notifikation kom, og orkestratoren sov til ejeren opdagede det ~07:30. 3896-agenten efterlod en FÆRDIG, korrekt diff (151 linjer) ukommitteret; 4005-agenten efterlod intet (nåede aldrig worktree).

## Rod-årsag

Runbookens anti-hang-lag 3 (periodisk `night-wave-stall-watch.ps1`) og lag 4 (per-agent timeout) blev IKKE etableret ved launch. Orkestratoren stolede alene på workflow-completion som vækning — præcis den single point of failure som 17/7-læringen forbød ("heartbeat må ALDRIG være eneste vækning"; her var der end ikke en heartbeat).

## Recovery der virkede (runbook §Recovery)

- Uncommitted arbejde i worktree → diff reviewet af orkestrator, targeted tests kørt (135/135), commit+PR #4057 fra SAMME worktree.
- Intet spor → opgaven lavet forfra af orkestrator (PR #4060), 30 min.
- `TaskStop` på begge workflows FØR overtagelse (journal.jsonl havde de 12 færdige agenters resultater — intet gik tabt).

## Forebyggelse (bindende for næste bølge)

1. **Ved launch-GO:** opret en scheduled task/cron der hvert ~30. min kører `scripts/night-wave-stall-watch.ps1 -Json` og ved flag SKRIVER en fil/notifikation orkestratoren ser — uafhængigt af workflow-barrieren.
2. **Sidste-agent-reglen:** når et chunk er n-1 færdigt (synligt i journal.jsonl), er den sidste agent per definition på watch — tjek dens transcript-mtime FØR man melder "6/7 færdige, kører stadig" til ejeren. 21/8: begge stragglere var allerede frosset da status blev givet kl. ~03.
3. Overvej mindre chunks (4-5) så barriere-tab koster mindre.

Refs #605, runbook §Anti-hang. Memory: feedback_worker_push_kadence_og_tavshedsgraense (2. hårde bid).
