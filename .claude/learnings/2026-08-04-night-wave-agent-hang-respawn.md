# 2026-08-04: Frossen workflow-agent — journal-diff før hang-konklusion, respawn i samme worktree

**Symptom:** Chunk 3 (8 agenter) blev aldrig færdig; stall-watch viste "1 transcript frossen >12 min", men også flere med gamle mtimes.

**Fælde:** En FÆRDIG agents transcript ser identisk ud med en FROSSEN agents på mtime alene. Diagnosen der virkede: diff journal.jsonl's result-agentIds mod transcript-filerne — agenten med gammel mtime OG intet journal-result er den hængende (her: frossen 00:31 midt i et tool-kald, ~11 min efter start, 90 min gammel ved opdagelse).

**Recovery (virkede friktionsfrit):** (1) TaskStop på hele workflowet (7 cachede resultater lå sikkert i journalen og kunne læses derfra), (2) standalone Agent-respawn med samme opgave + eksplicit handoff: "worktree X FINDES, genbrug den, kør git merge origin/main først, .progress.md viser hvor langt forgængeren nåede". Respawn-agenten leverede fuldt (PR #3292) inkl. selvstændig konflikt-løsning mod en parallel merge.

**Guards:** Chunking (kun eget chunk frøs) + watchdog-heartbeat (opdagelse ~40 min senere, ikke 7 timer som 3/7) virkede. Det 4. lag fra 17/7-læringen (ægte per-agent-timeout) findes stadig ikke i Workflow-værktøjet — chunk-størrelse OG heartbeat er fortsat obligatoriske.

**Bonus-læring samme nat:** Adversarial verifikations-fasen (uafhængige agenter reproducerer alle balance-tal med egne queries) fangede 5 reelle talfejl i ellers grundige rapporter. Mønster: cellerne UDEN vedhæftet kør-selv-SQL var netop dem der var forkerte. Regel-kandidat: intet tal i ejer-beslutningsgrundlag uden reproducerbar query ved siden af.

Refs: docs/audits/night-wave-2026-08-04.md · docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang · .claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md
