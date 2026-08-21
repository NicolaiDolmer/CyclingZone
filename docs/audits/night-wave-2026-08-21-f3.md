# Natbølge 2026-08-21 (F3: motor-mekanikker + taktik)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 19:50 → 21:30 (samme aften — merges inkluderet) |
| Agenter launched / fuldført / døde | 11 workflow + 3 recovery + 1 ekstra fix / 15 / 3 (alle genoprettet) |
| PR'er åbnet / merged | 12 / 11 (+1 draft: #4093 taktik-UI, afventer ejer-visuelt go) |
| Issues → claude:done | #4058 (U23-fix, PR #4095); #4068+#4066 (dag-workflow, PR #4082/#4081) |
| Merged PR'er | #4084 #4085 #4086 #4087 #4088 #4089 #4090 #4091 #4092 #4094 #4095 |
| gh-401-retries | 0 observeret |
| Recoveries (type) | 3 (spawn-død: 1 · frossen Bash: 2, heraf 1 heredoc) |
| Preflight | GO kl. 18:05 (.codex.local/night-wave-preflight.json) |
| Konflikt-fletninger | 5 (tuning.ts append-append, serielt mod frisk main) |

## Afvigelser/læringer
- Bølgen kørte om AFTENEN med ejer til stede (ikke natten) — merges landede samme aften på ejer-bulk-go i stedet for morgen-protokollen.
- 3 agent-dødsfald (classifier-spawn, linter-hang, heredoc-hang) — fuld postmortem: `.claude/learnings/2026-08-21-natboelge-agent-doedsfald.md`.
- `race_team_orders`-migrationen (merged i #4091) er IKKE applied endnu — MCP-apply blev classifier-blokeret; overdraget til ejer/næste session m. permission. Post-verify-blok står i backfill-filen.
- Alle 8 engine-moduler er INERTE til hook-wiring (morgen-sessionens integration); wiring-noter i PR-bodies.
- Patch note: ingen ud over 7.169 (Z1) — bevidst: mekanikkerne er uden spiller-effekt før wiring/flip; noten kommer med v4-flippet.
