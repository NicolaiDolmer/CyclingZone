# Postmortem · 2026-10-11 · Merge-køen ventede 43 min på cron-beviset

## Hvad skete der?
`merge-queue.ps1 -Pr 6484` (tænd-PR, merget 16:30 dansk tid) holdt den lokale proces fast, indtil hele `Deploy verify` (run 38147469574) var færdig kl. 17:13. Trinnet "Verify affected cron check-ins" tog 41 min og endte `deferred`.

## Root cause
Det var ikke en fejl i beviset, men i hvad køen ventede på. Grænsen for "kort kadence" er `<= 30 min`, så fire 30-min-jobs (`board-*`, `stall-watchdog`) skal tikke efter deployet, før trinnet slutter. 1-/5-min-jobs var bevist efter 5 min. #6403 blev merget kl. 16:40 midt i beviset; den nye Railway-boot nulstillede `setInterval`-timerne, så første rigtige 30-min-tick kom først 17:12. Den døde `deadline-day`-række havde ingen effekt (filtreres væk på registry-slugs).

## Fix
#6487: smoke-testen kører før cron-trinnet, og PR'en får en kommentar med det samme. Klassifikatoren melder `released`, når deploy + smoke er grønne og cron-beviset er startet; merge-køen frigiver køen der og stopper før næste merge, hvis en overdraget kørsel senere ender rød. Cron-trinnet fik `timeout-minutes: 50` (drain 2,5 + kadence 30 + margin 15 = 47,5 min).

## Forhindret-fremover
Strukturtest i `cron-deploy-verification.test.mjs` låser rækkefølgen (kun smoke + kommentar mellem deploy og cron-trin) og regner timeouten ud fra registry + drain. Kø-tests dækker `released` og en senere fejlet overdraget kørsel.

## Læring
Et bevis der tager en hel cron-kadence, skal ikke holde en lokal proces. Bevis det der gater næste skridt (deploy + smoke), og lad resten køre videre i kørslen, der allerede rapporterer på PR'en. Pas på rækkefølgen: cron-scriptet kasserer sin første aflæsning, så alt der lægges foran det, skal være kortere end Railways drain.
