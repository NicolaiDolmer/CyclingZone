# Natbølge 2026-07-19 (aftenbølge, quick-win-scope fra backlog-audit)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ~22:15 → ~23:20 |
| Agenter launched / fuldført / døde | 9 / 9 / 0 (2 Workflow-chunks à 4 + 1 efterfølgende #228-agent) |
| PR'er åbnet / merged | 9 / 0 (merge-protokol næste morgen, ejer-go pr. PR) |
| Issues → claude:done | afventer merge — flip PR-for-PR i merge-løkken: #2401+#2208 (PR 2708) · #2183 (2709) · #2695 (2707) · #2657 (2706, SQL) · #2674 (2703) · #2673 (2702) · #2668 (2705) · #2590 (2704, SQL) · #228 (2710) |
| gh-401-retries | 0 markante (probe grøn 1. forsøg) |
| Recoveries (type) | 0 |
| Preflight | GO (~22:10, .codex.local/night-wave-preflight.json; S0-maskine → keep-awake kørt under hele bølgen) |

## Merge-rækkefølge (anbefalet)
1. Chores/backend lav-konflikt: #2702 (docs) → #2703 (drift-RPC) → #2705 (autoport).
2. SQL-PR'er — **review migration FØR merge** (auto-applies): #2704 (DROP COLUMN, destruktiv klasse = ejer-gate) · #2706 (staff-navne-backfill, idempotent PGlite-verificeret).
3. UI: #2707 (træner-speciale) → #2708 (besked-dedup) → #2709 (holdside-auktioner) → #2710 (#228-rework, bredest) sidst.

## Afvigelser/læringer
- Ejer-scope-runde FØR launch fjernede 3 opgaver (#2654 udløb afvist+lukket, #450 minimumspris, #1941 grace parkeret) og tilføjede #228 efter mockup-godkendelse (stats-toggle bevares). Mockup-før-byg-flowet (show_widget med rødt=ud/grønt=ind) virkede — genbrug formatet.
- #2695: agent verificerede prod-data FØR fix (ren display-bug, ikke data-regression) — evidence-before-fix fulgt.
- mobile-webkit teardown-flakes (2 stk. i chunk 1) klassificeret korrekt som miljø-støj per runbook.
- Patch note: konsolideret entry laves i merge-runden (agenter rørte ikke PatchNotesPage per regel).
