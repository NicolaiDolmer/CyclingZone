# Postmortem · 2026-07-17 · Scouting Network "mission lost" was a perception bug, not data loss

## Hvad skete der?
To testere i Discord (#2580) rapporterede at (1) at bygge Scouting Network
niveau 1 + hyre en spejder ikke gav 2 samtidige missioner som forventet, og
(2) at opgradere faciliteten/hyre en spejder mens en mission kørte "slettede"
missionen — én tester mente han mistede 6.000 CZ$.

## Root cause
Ingen kode-fejl. To ting forklarer oplevelsen:
1. Kapacitet 2 kræver ALTID at den hyrede chefspejders `overall` når ~80
   (`backend/lib/scoutEngine.js` `scoutCapacity`, spec beslutning 2 i
   `docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md`). Facilitets-
   tieret bounder kun hvilken kandidat-tier man kan ANSÆTTE
   (`TIER_OVERALL_BAND[1] = {lo:28, hi:44}` i `staffAbilityConstants.js`) —
   tier 1 kan aldrig give en overall≥80-kandidat. Ingen kode gav nogensinde
   facilitets-tier 1 en 2. slot; forventningen kom fra copy der ikke
   eksplicit sagde "kræver overall~80", kun "top tier" i den generelle
   track-blurb.
2. Verificeret via read-only query mod prod-DB (2026-07-17): antal
   `finance_transactions` med `type='scout_travel'` (55) er PRÆCIS lig
   antal `scout_assignments`-rækker (55) — ingen orphaned debits. Nul
   `scout_assignments` med `kind='mission'` og `status='cancelled'`
   eksisterer overhovedet. Krydsreference af hold der byggede/hyrede EFTER
   at have startet en mission viser missionen overlevede uændret
   (status intakt, `travel_cost` intakt). Ingen kode-sti i
   `facilityService.js` eller `scoutAssignmentService.js` rører
   `scout_assignments` ved facilitetskøb/hire. "6.000 i sinken" var en
   oplevet, ikke reel, tab — spilleren så formentlig et tomt/uklart UI og
   antog det værste.

## Fix
- `frontend/src/pages/ScoutingCentralPage.jsx`: `ScoutCard` viser nu et
  eksplicit hint når `capacity < 2` der forklarer overall≥80-kravet.
- `frontend/public/locales/{en,da}/scouting.json`: ny `scoutCard.capacityHintLocked`-
  nøgle + omskrevet `error.capacity` der peger tilbage på den aktive
  opgaveliste i stedet for en vag "fuldt booket"-besked.
- `backend/lib/scoutingFacilityIntegration.test.js`: ny regressionstest
  (#2580) der starter en mission FØR facilitetskøb+hire og assertes at
  assignment-id/status/travel_cost er 100% uændret bagefter, og at kapacitet
  korrekt forbliver 1 for en tier-1-hire.
- `frontend/src/data/patchNotes.js`: v7.13-note (EN+DA).

## Forhindret-fremover
Regressionstesten låser data-durability-garantien permanent (ville fange en
FREMTIDIG regression hvis nogen ved et uheld tilføjede en delete/cancel-sti
ved facilitetskøb eller hire). Copy-fixet reducerer sandsynligheden for at
samme oplevede-tab-forvirring gentager sig for andre spillere.

## Læring
Når en bruger rapporterer "data forsvandt" efter en feature-launch: verificér
FØRST mod ægte prod-data (read-only) før du antager kode-fejl og begynder at
lede efter en sletnings-mekanisme der måske slet ikke findes — matchende
`finance_transactions`-tæller mod domæne-tabellens rækketal er en billig,
konkret måde at udelukke reel data-tab på minutter i stedet for timevis af
kode-spelunking.
