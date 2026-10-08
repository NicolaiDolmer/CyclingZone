# 2026-10-09: to merge-køer samtidig gav falsk rødt cron-bevis

**Hvad:** Deploy verify efter #6372 (Train now) fejlede på `stall-watchdog`. Prod var sund.

**Rodårsag:** Jeg startede en ny merge-kø (#6373,#6375,#6376) mens køen for #6372 stadig ventede på deploy-verifikation (jeg læste en mellemliggende log-linje som "færdig"). #6373 genstartede Railway kl. 22:06; `stall-watchdog` kører via `setInterval` 30 min fra boot UDEN immediate-run, så første tick efter #6372-deployet nåede aldrig at komme før deadline (boundary + 30 min). Boot-priming-kohorten 22:06:20 er korrekt ekskluderet af gaten.

**Regel:** Én merge-kø ad gangen gælder til køens proces er AFSLUTTET (task-notifikation), ikke til sidste "Merged som"-linje. Start aldrig en ny kø på en log-tail.

**Opfølgning:** 30-min-jobs med setInterval lander tæt på deadline (boot ligger kun lidt før success-boundary). Overvej margin for setInterval-jobs i `cron-deploy-verification.mjs` (#6318).
