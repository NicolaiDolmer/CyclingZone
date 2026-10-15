# 2026-10-14: enheden før tallet, og review-runder der ikke slutter

## 1. Forkert enhed i et ejerkort (64 i stedet for 160)
Jeg foreslog ejeren "64 løbsdage pr. division" for S5's §1d-mål, læst direkte af tørkørslens output (D2-D4 = 64). Den låste S4-regel er 140 = 28 løbsdatoer × 5 (Måde B), så S5's rette tal er 160 = 32 × 5. Kalendersporet opdagede det, stoppede og bad om ejer-go. Ejeren fik derfor et tal, der ville have gjort gaten rød.

**Regel:** før et spillervendt tal kommer på et ejerkort, find den låste regel, det afledes af (NOW, CALENDAR_RULES, issue), og regn tallet ud fra den. Et tal fra en tørkørsels output er et måleresultat, ikke et mål.

## 2. Review-runder: hver push giver nye fund
#6632 (raceStory) og #6633 fik nye, reelle Codex/CodeRabbit-fund efter hver rettelsesrunde, i alt 4 runder. Fundene lå i samme fejlklasser (km vs exact_km, snapshot-grænser, abandoned riders, skalering).

**Regel:** et rettelsesspor retter ikke kun de citerede tråde. Det gennemgår også selv hele filen for samme fejlklasse, før det pusher (står nu i scopeText fra runde 4). Det stoppede løkken.

## 3. Lukket bølge-opgave kan genoptages
Ejeren lukkede ved en fejl en kørende Workflow-bølge. `Workflow({ scriptPath, resumeFromRunId, args })` med samme args genoptog den, og pushet arbejde var intakt. Markøren stod som "running" med en død ejerproces; resume håndterede det.
