# Postmortem · 2026-11-15 · Bestyrelsens midtsæson-besked kom igen, når den blev slettet

## Hvad skete der?
En spiller fik bestyrelsens midtsæson-besked igen og igen (Discord 15/11). Hver gang beskeden blev slettet i indbakken, kom en ny ved næste kørsel hvert 30. minut, også som Discord-DM.

## Root cause
`processMidSeasonReviewCron` (backend/lib/boardMidSeason.js) brugte eksistensen af selve notifikationsrækken som eneste værn mod gentagelse. Slettet besked = intet værn.

## Fix
PR #8197 (`6e90243c`): kvittering i `board_profiles.mid_season_notified_season`, uafhængig af indbakken. Efterprøvet i prod: 231/231 boards med beskeden har kvitteringen, ingen ny besked efter merge.

## Forhindret-fremover
Opfølgning #8198 gennemgår de andre sweeps med samme mønster (squadBelowMinimumCheck, missedGraduateSweep, notificationService, selectionWarningSweep). Prøven sletter beskeden og kører sweepet igen.

## Læring
En brugers indbakke er ikke en kvittering. Et værn mod gentagelse skal ligge et sted, spilleren ikke kan slette.
