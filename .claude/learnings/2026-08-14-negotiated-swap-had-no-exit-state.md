# Et forhandlet bytte havde ingen udgang (#3669)

Dato: 2026-08-14
Issue: [#3669](https://github.com/NicolaiDolmer/CyclingZone/issues/3669)
Klasse: manglende tilstands-overgang i en to-parts-forhandling

## Symptom

En spiller sendte et byttetilbud med en kontant-komponent. Modparten bød tilbage.
Da spilleren derefter trykkede "Afvis" i `/transfers?tab=sent`, svarede backend
"Ugyldig handling". Tilbuddet kunne hverken gennemføres eller droppes.

## Rod-årsag

`PATCH /api/transfers/swaps/:id` gatede sin withdraw-gren på én enkelt tilstand:

```js
if (action === "withdraw" && isProposing && swap.status === "pending") {
```

Et forhandlet bytte står i `countered`, ikke `pending`, så grenen blev sprunget
over og requesten faldt igennem til handlerens generiske
`invalid_action`-svar i bunden.

Frontend var uskyldig og korrekt: `SwapCard` viser en "Afvis"-knap på
`countered + isProposing` og sender `withdraw`. Knappen var altså død for
præcis den tilstand hvor forhandlingen var kommet længst.

Søsterfladen havde hele tiden ret. Transfer-offers-routen, 380 linjer længere
oppe i samme fil, gatede allerede på begge levende forhandlings-tilstande:

```js
if (action === "withdraw" && isBuyer && ["pending", "countered"].includes(offer.status)) {
```

Byttehandel-routen blev bygget som en kopi af pengehandel-routen, men kopien tog
kun den ene tilstand med. Ingen test dækkede forskellen, fordi begge routes kun
havde kilde-scannings-tests, ikke tilstands-tests.

## Hvorfor det ikke blev fanget

`OPEN_SWAP_STATUSES = ["pending", "countered", "awaiting_confirmation"]` fandtes
allerede i `auctionRules.js` som domænets definition af "åben byttehandel", men
ingen test krydsede den liste mod routens handlinger. Hver handling blev
gennemgået for sig, aldrig som en matrix af tilstand gange part.

Prod-data bekræfter mønstret: 0 byttehandler er nogensinde gået direkte fra
`countered` til `withdrawn`. De 5 withdrawn-rækker der har `counter_cash` sat,
kom ud via omvejen accept_counter til awaiting_confirmation til cancel. Spillere
har altså skullet ACCEPTERE modbuddet for derefter at annullere det.

## Fix

Fra-tilstandene flyttet ud af routen og ind i en testbar guard i
`backend/lib/transferExecution.js`:

```js
export const SWAP_WITHDRAWABLE_STATUSES = Object.freeze(["pending", "countered"]);
export function getSwapWithdrawIssue(swap, { teamId } = {}) { ... }
```

`awaiting_confirmation` bliver bevidst udenfor: den tilstand ejes af
cancel-grenen, hvor `getSwapCancelIssue` afgør om en accept stadig må rulles
tilbage. Withdraw må ikke være en bagdør rundt om den lås.

Modparten notificeres nu ved withdraw (`buildSwapPulledOutNotification`, samme
paritet som transfer-offers-routen). Uden den ville modbuddet bare forsvinde fra
modtagerens skærm, fordi `GET /transfers/swaps` filtrerer `withdrawn` fra.

## Forward-guard

`transferExecution.test.js` har nu en test der krydser `OPEN_SWAP_STATUSES` mod
udvejene: hver åben tilstand skal enten kunne trækkes af forslagsstilleren eller
være ejet af cancel. Tilføjes en ny åben tilstand uden udvej, fejler testen i
stedet for at ramme en spiller.

`swapWithdrawNegotiated.routes.test.js` binder wiringen: routen skal spørge
guarden, og må ikke hardcode `swap.status === "pending"` igen.

## Læring, generelt

Når en flade bliver klonet (pengehandel til byttehandel, tilbud til lejeaftale),
er det tilstands-LISTERNE der falder af, ikke handlingerne. Handlingerne er
synlige i UI og bliver testet. Listerne står inde i en if-betingelse og har ingen
skærm.

Test derfor forhandlings-flader som en matrix: tilstand gange part gange
handling. En liste over tilstande hvor der findes en systemkonstant
(`OPEN_SWAP_STATUSES`) bør altid krydses mod den konstant i en test, ikke
skrives af i hånden.
