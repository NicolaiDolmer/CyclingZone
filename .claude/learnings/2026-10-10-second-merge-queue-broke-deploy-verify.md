# 10/10 nat: anden merge-kø mens den første ventede på deploy-verify

## Hvad skete
- 01:20 merge-kø A (#6399, #6402) merger #6402 og venter på deploy-verify for `731604a0`.
- Kø A så ud til at være "færdig" for mig (jeg læste PR-state MERGED, ikke køens slut-linje), så jeg startede kø B (#6405, #6404, #6406). Den stoppede på bølge-gaten for #6405; derefter startede jeg kø C med #6404 alene.
- 01:47 kø C merger #6404, og backend genstarter. Alle cron-check-ins nulstilles til 01:48:53.
- 02:09 deploy-verify for #6402 fejler: fire 30-min-jobs (board-auto-accept, board-mandate-auto-accept, board-mid-season, stall-watchdog) nåede ikke deadline 02:09:40.
- Kø A melder `STOP: deploy-verifikation efter #6402 er failed`.

## Effekt
Ingen spillerskade målt: forsiden 200, `/health/ready` = `{"status":"ok","db":"ok"}` 02:11. Fejlen er bevis-tab (cron-beviset for #6402 blev ugyldigt), ikke en prod-fejl.

## Rod
Samme fejlklasse som 9/10 (`2026-10-09-two-merge-queues-cron-proof.md`) og `2026-10-09-merge-queue-stop-read-as-done.md`: jeg vurderede kø A som færdig ud fra PR-state i stedet for køens egen `[OK] Hele merge-koeen`-linje, og startede en ny kø oven i den.

## Regel (håndhæves af mig, indtil scripts/merge-queue.ps1 har en lås)
- ÉN merge-kø-proces ad gangen. Før en ny kø: tjek at den forrige baggrundsopgave er AFSLUTTET (task-notifikation), ikke kun at PR'en er merged.
- Forslag til #6370-sporet: merge-queue.ps1 skal tage en fil-lås (`.claude/run/merge-queue.lock` med PID) og nægte at starte, mens en anden kø kører.
