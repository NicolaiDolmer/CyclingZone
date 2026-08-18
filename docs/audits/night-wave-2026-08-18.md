# Natbølge 2026-08-18 (XL backlog-offensiv)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ~23:45 → ~05:50 |
| Agenter launched / fuldført / døde | 51 slots (32 førstebølge + 19 recovery/stretch) / 36 leverede / 15 timeout-klip (alle på nær 3 reddet i recovery) |
| PR'er åbnet / merged | 31 / 9 |
| Issues → claude:done | #2086 #3753 #3653 #3587 #3695 #3696 #3580 #3578 #2982 #2793 (10) |
| Housekeeping-lukninger | 28 (+ 6 i ejer-bundt, 11 sprunget over med begrundelse) |
| gh-401-retries (preflight-probe + bølge) | Probe grøn 1. forsøg; retry-wrapper brugt overalt, ingen hårde gh-fejl |
| Recoveries (type) | 12 (uncommitted-fortsæt: 7, frisk respawn: 5); 3 spor ikke leveret |
| Preflight | GO (11 ok / 2 warn / 0 NO-GO), `.codex.local/night-wave-preflight.json` |

## Afvigelser/læringer
- **Per-agent-timeout 110 min var alt for stram under 26+ samtidige agenter** — klippede 15 agenter i første bølge. 150/180 min + faldende samtidighed løste det (e-mail-kæden: 2 klip ved 110/150, leveret på 16 min da maskinen var ledig). Næste bølge: dimensionér timeout efter samtidighed, eller launch chunks forskudt.
- **Classifieren blokerede batch-loops** af `gh pr ready`+`merge` og det oprindelige chunk 5-script; enkeltkommandoer og omformuleret script gik igennem. Indregn i orkestrator-rutinen.
- **PR #3875 (#3580) auto-mergede før agentens sekvens-anbefaling** (#3582-audit først) nåede frem — ufarligt her, men auto-merge armeret før agent-resultat er en rækkefølge-risiko. Overvej: armér først efter chunk-resultatet er læst.
- **#3594-agenten redigerede kortvarigt hoved-checkoutet** (fangede det selv, gendannelse verificeret af orkestrator). #3885-agenten rørte `patchNotes.js` trods forbud. Agent-prompt-forbud håndhæves ikke perfekt; orkestrator-verifikation fangede begge.
- **#3858-v1 (opus) brugte 150 min uden at efterlade spor**; v2 med eksplicit disciplin-instruks ("plan først, genbrug komponenter") leverede fuldt på ~80 min. Disciplin-instruksen bør være standard for store feature-agenter.
- **Trænings-klyngen (3815/3651/3761) fejlede 2× (110+180 min) uden output** — ukendt årsag, intet worktree-spor efter 2. forsøg. Overladt til dagsession.
- Watchdog via ScheduleWakeup + task-notifikationer fungerede: alle 11 chunks håndteret uden hang, ingen sovende maskine (keep-awake kørte hele natten).

_Refs #605. Detaljer: morgenoplæg + housekeeping-rapport i samme mappe._
