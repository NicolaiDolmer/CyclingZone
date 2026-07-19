# Postmortem · 2026-07-19 · Auktions-salg gav flere/støjende bekræftelses-beskeder

## Hvad skete der?
To issues (#2401, #2208) blev filet fra samme Discord-feedback (jeppek, 1/7) filet to gange af den automatiske sweep. Sælgeren af en rytter på auktion fik én separat "New bid received"-notifikation for HVERT bud (manuelt bud + hver iteration af proxy-cascaden), så en travl auktion kunne generere mange næsten-identiske "nyt bud"-beskeder før den ENDELIGE "solgt for X CZ$"-notifikation. Spillerens feedback: "This should be in one message or none, because i get some information for what he's sold for."

## Root cause
`frontend/src/lib/groupNotifications.js` havde allerede et fungerende aggregerings-/skjulnings-mønster for præcis denne klasse problem — `auction_outbid` (køberens "du er overbudt"-notif) aggregeres mens auktionen er aktiv og SKJULES HELT når auktionen er afgjort (`auction_won`/`auction_lost` findes for samme `related_id`). `bid_received` (sælgerens ækvivalent) var aldrig blevet tilføjet til samme mønster — den blev sendt fra tre steder (`backend/routes/api.js` manuelt bud + proxy-endpoint, `backend/lib/proxyBidding.js` cascade) uden nogen klient-side konsolidering, så hver bud-række forblev synlig som en selvstændig notifikation resten af sin levetid.

## Fix
`frontend/src/lib/groupNotifications.js`: tilføjede `bid_received` til `AGGREGATABLE_TYPES` og `TERMINATING_TYPES` (termineret af `auction_won`/`auction_lost`, samme som `auction_outbid`). Ingen backend-ændring nødvendig — den endelige `auction_won`/`auction_lost`-notifikation (med salgspris) fandtes allerede i `backend/lib/auctionFinalization.js` og delte allerede `related_id = auction.id` med `bid_received`-rækkerne. `NotificationsPage.jsx`'s aggregat-rendering er type-agnostisk, så ingen UI-kode skulle ændres — kun de to Sets i grupperings-logikken.

## Forhindret-fremover
4 nye unit-tests i `groupNotifications.test.js` beviser: (1) flere `bid_received` på samme auktion aggregeres med tæller, (2) skjules helt ved `auction_won`, (3) skjules helt ved `auction_lost`, (4) `bid_received` på en ANDEN, stadig-aktiv auktion påvirkes ikke. Playwright core-smoke dækker `/notifications`-sidens snapshot fortsat.

## Læring
Når et notifikations-/beskeds-flow føles "støjende/dobbelt", tjek FØRST om der allerede findes et konsolideringsmønster i kodebasen for en NÆRLIGGENDE notifikationstype, før man antager at backend skal sende færre/andre beskeder. Her var `auction_outbid` → `bid_received` en næsten identisk sti (samme `related_id`-kontrakt, samme "terminator"-semantik), og fixet blev en 2-linjers udvidelse af eksisterende, allerede-testet logik i stedet for en backend-notifikations-fjernelse (som ville have risikeret at fjerne en features spillere måske stadig ønsker at se live).
