# Postmortem · 2026-11-02 · "Klar" ved én rytter + tabeller uden sortering (#7533)

## Hvad skete der?
Kalendertabellen (beta) viste "Klar", så snart holdet havde én rytter tilmeldt et løb. Samtidig kunne den nye kalendertabel og Løbshistorik ikke sorteres på flere kolonner, selvom en guard skulle sikre sortering. Ejeren fandt begge dele i Discord 2/11.

## Root cause
1. `/api/races/calendar` byggede `entered` som "holdet har mindst én `race_entries`-række", og `racePeek.myRaceStatus` gav `selected` alene på det. Startgulvet (`MIN_RACE_ENTRIES` = 6) indgik ikke.
2. `frontend/src/tableSortIntent.test.js` scannede kun `.jsx`-filer og kun `<table>`/`<Table>`. Begge nye tabeller var `.tsx` og brugte den delte `<DataTable>`, så de slap uden om.

## Fix
PR #7534: backend sender `lineupShort` (entries under `MIN_RACE_ENTRIES`) og `myRaceStatus` giver `missing`. Guarden scanner nu `.tsx` og kræver `onSort` eller `data-sort-exempt="<grund>"` på `<DataTable>`; seks ældre tabeller står på en ratchet-liste (#7537). TASTE.md tjekliste 7a.

## Forhindret-fremover
Unit-tests på `lineupShort` (backend + `racePeek`), guard-test for `<DataTable>` med ratchet, der fejler når listen kan skrumpe.

## Læring
En guard, der kun ser én filtype eller én komponent, giver falsk tryghed. Når kodebasen skifter til `.tsx` og delte primitiver, skal guards følge med i samme bevægelse. Og en status, der lover noget ("Klar"), skal bygges på den regel, der faktisk afgør udfaldet (startgulvet), ikke på "der findes en række".
