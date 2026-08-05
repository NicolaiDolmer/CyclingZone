# Postmortem · 2026-08-04 · Byd-knappen forblev aktiv efter auktionens countdown ramte 0

## Hvad skete der?
Sentry CYCLINGZONE-3Y: 4 hold på 19 timer forsøgte at byde efter en
auktions nedtælling havde ramt 0. Byd-/autobud-knappen var stadig klikbar,
og opførslen ved klik var uklar for spilleren (#3110).

## Root cause
To uafhængige huller, begge i samme feature:

1. **Frontend:** `canBid` (AuctionsPage.jsx) og bid-blokken i
   `useAuctionBidding.js` tjekkede kun `auction.status !== "completed"`.
   Status flippes af en finalize-cron EFTER `calculated_end` er passeret —
   der er et reelt vindue (sekunder til minutter afhængig af cron-interval)
   hvor status stadig er `"active"`/`"extended"`, men uret reelt er i nul.
   Ingen client-side tidscheck fandtes.
2. **Backend:** POST `/auctions/:id/bid` og PATCH `/auctions/:id/proxy` HAR
   et tidligt `isAuctionExpired()`-tjek der korrekt afviser sent-kald med
   400 — men det manglede `errorCode: "auction_expired"`. Den lokaliserede
   `errors:api.auction_expired`-nøgle fandtes allerede og bruges af en
   ANDEN gren i samme handlere (DB-trigger-afvisningen), så inkonsistensen
   var ren kopiering-forglemmelse, ikke manglende infrastruktur.

## Fix
- `frontend/src/lib/auctionLogic.js`: ny `isAuctionTimeExpired(calculatedEnd, now)`
  — client-spejl af backendens `isAuctionExpired` (auctionEngine.js), samme
  `>=`-grænse.
- `frontend/src/lib/useAuctionBidding.js`: tikker hvert sekund og blokerer
  Byd/Gem via det eksisterende `useBlockedAction`-mønster (aria-disabled +
  synlig `BlockedNote`, IKKE bare `disabled` — se #2718/#2719) når tiden er
  udløbet. Hooket er delt af `AuctionRow`, `AuctionCard` og
  `RiderStatsPage`s bud-panel, så én ændring retter alle tre flader.
- `backend/routes/api.js`: tilføjet `errorCode: "auction_expired"` til de
  to tidlige `isAuctionExpired()`-returns (linje ~5142 og ~5485).

## Forhindret-fremover
- `frontend/src/lib/auctionLogic.test.js`: grænsetest for
  `isAuctionTimeExpired` (1ms før / præcis på / efter deadline, manglende
  `calculated_end`).
- `backend/lib/auctionExpiredErrorCode.routes.test.js`: source-guard (samme
  teknik som `auctionEntryGate.routes.test.js`) der låser at BEGGE
  endpoints returnerer `errorCode: "auction_expired"` på det tidlige tjek.

## Læring
Når et time-gated action (byd, indløs, deadline) håndhæves via en periodisk
cron der flipper en status-kolonne, er der ALTID et vindue mellem det
faktiske deadline og cronens næste kørsel hvor status endnu ikke afspejler
virkeligheden. UI der kun gater på status, ikke på selve uret, er sårbart i
det vindue — client skal selv holde et ur der matcher backendens
grænsesemantik (`>=`), ikke kun stole på en asynkront opdateret status.
Sekundært: når en handler har TO grene der afviser samme tilstand (her: et
tidligt guard-tjek og en DB-trigger-fanget afvisning), skal begge grene
sættes op med samme `errorCode` fra dag ét — de driver ellers fra hinanden
usynligt, fordi begge "virker" (returnerer 400), bare med forskellig
oversættelses-kvalitet.
