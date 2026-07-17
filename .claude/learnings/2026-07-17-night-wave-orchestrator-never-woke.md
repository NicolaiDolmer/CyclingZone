# Natbølge 17/7: orkestratoren vågnede aldrig — 1 frossen agent holdt hele natten som gidsel

## Hvad skete der

Chunk A (6 agenter) blev launched 23:33 med (a) workflow-completion-notifikation og (b) ScheduleWakeup-fallback-heartbeat (~25 min) som vækningssignaler. A1 (#2512) frøs midt i arbejdet (uncommitted ændringer i worktree, intet resultat i journal). `parallel()`-barrieren ventede evigt på A1 → ingen completion-notifikation. **Heartbeaten fyrede aldrig** (planlagt 00:05; intet fyrede før keep-awake-exit 07:34). Resultat: 5/6 PR'er i mål, men chunks B+C (17 issues) blev aldrig launched, og A1 blev ikke recovered i nat.

Maskinen sov IKKE (keep-awake kørte fuldt 480 min) — det er altså ikke 03/7-hændelsen igen. Det er vækningsmekanismen der svigtede, ikke strømstyringen.

## Rod-årsag(er)

1. **Frossen agent i en `parallel()`-barriere = tavst workflow.** Kendt klasse (natbølge 03/7), chunking begrænsede skaden som designet — men kun hvis orkestratoren har et UAFHÆNGIGT vækningssignal.
2. **ScheduleWakeup-heartbeat er ikke pålidelig som eneste fallback.** Én planlagt wakeup, som aldrig fyrede (mekanisme uklar — muligvis fordi sessionen stod med et kørende workflow/aktiv turn-state). Uanset årsag: den var single point of failure og fejlede tavst.

## Forebyggelse (næste natbølge)

- **Per-agent timeout i selve workflow-scriptet:** wrap hvert `agent()`-kald i et race mod en deadline (fx 90 min), så barrieren ALDRIG kan hænge evigt — chunket completer med `null` for det frosne spor, notifikationen kommer, og orkestratoren recoverer per runbook. Dette er den robuste fix: signalet kommer fra chunket selv, ikke fra en ekstern vækning. (NB: `Date.now()` er blokeret i workflow-scripts — brug en timeout-agent/monitor-mønster eller effort-lav vagt-agent med sleep som race-modpart.)
- **Dobbelt heartbeat:** ScheduleWakeup ALENE er utilstrækkelig. Supplér med en Monitor eller en OS-planlagt opgave/cron der pinger sessionen, eller aftal med ejeren at natbølger uden mellem-chunk-livstegn efter ~1 time er et rødt flag.
- **Launch-rækkefølge-overvejelse:** de issues med størst hæng-risiko (M-scope, brede greps som #2512) bør ligge i et LILLE chunk eller sidst, så et hæng ikke blokerer notifikationen for 5 færdige spor.

## Positivt bifund

`scripts/keep-awake.ps1` som orkestrator-baggrundsproces (run_in_background) virker — maskinen holdt sig vågen hele natten uden separat ejer-vindue. Runbook-kandidat: orkestratoren starter selv keep-awake ved preflight-GO.

Refs: docs/audits/night-wave-2026-07-17.md, docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang, .claude/learnings/2026-07-03 (S0-standby-hændelsen).
