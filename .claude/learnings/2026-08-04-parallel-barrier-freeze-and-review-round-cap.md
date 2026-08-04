# To orkestrerings-fejlmønstre fra dagbølgen 4/8

## 1. parallel()-barrieren frøs IGEN på én agent pr. chunk (17/7-mønstret)

Begge dagbølge-chunks (7+7 agenter) endte med præcis én agent frossen (started uden result; transcript-mtime død i ~1 time), hvilket holdt `parallel()`-barrieren åben — ingen completion-notifikation, resten af chunkens FÆRDIGE resultater var usynlige indtil manuel indgriben. Maskinen sov IKKE (keep-awake kørte); agenterne frøs individuelt (sidste transcript-entry hhv. `user` og `assistant` — frys midt i tur, ikke i tool).

**Det der VIRKEDE:** chunking (11/14 spor leverede trods 2 frys), journal.jsonl som ground truth (alle 11 resultater kunne høstes efter TaskStop), worktree-recovery (fortsæt i samme worktree / frisk respawn), målrettet stall-vagt på run-dirs.

**Det der IKKE virkede:** stall-watch-scriptets auto-RunDir-detektion (valgte den forkerte/færdige run-dir 2×); "yngste-skrivning"-heuristikken (sekventiel pipeline har naturligt N-1 tavse transcripts).

**Guards fremadrettet:**
1. **Workflow-scripts skal altid kunne afsluttes uden den sidste agent:** overvej Promise.race med deadline pr. agent() eller accepter-N-af-M-mønster i stedet for ren parallel()-barriere, indtil per-agent-timeout findes i Workflow-værktøjet.
2. **TaskStop + journal-høst er den kanoniske recovery** — resultaterne ligger i journal.jsonl (`{"type":"result",...}` pr. agent); frosne spor identificeres som started-uden-result.
3. Stall-vagt: peg EKSPLICIT på de aktive run-dirs, tærskel ≥20 min, og forvent tavshed under npm ci/testsuiter (lange tool-kald skriver først ved afslutning).

## 2. Review-loop med rundeloft stoppede EFTER sidste fix men FØR re-review

Retention-eksekveringens task 6 blev afvist 3 gange af quality-review; hver runde fandt en ÆGTE fejl som implementeren fixede — men loftet på 3 runder blev nået netop som sidste fix landede, så pipelinen stoppede "ikke godkendt" med et reelt set godkendelses-værdigt arbejde i worktree'et.

**Læring:** et fix-loop må aldrig slutte på et FIX — det skal slutte på et REVIEW. Design: `for (runde) { review; if ok break; fix }` + ét afsluttende review efter sidste fix, ELLER tæl kun reviews, ikke fix-forsøg. Alternativt: eskalér til orkestrator-vurdering i stedet for hård stop (det var de facto-løsningen: orkestrator læste journalen og godkendte på evidensen).

Refs: docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang (opdateringskandidat med pkt. 1-3), .claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md (forgænger).
