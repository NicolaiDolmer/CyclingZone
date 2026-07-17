# Postmortem · 2026-07-17 · Watchlist-rytter forsvandt tavst ved sletning

## Hvad skete der?
`rider_watchlist` har ingen FK-cascade til `riders` (bevidst — en managers
ønskeliste er en brugerfacing bekvemmelighed, ikke en spil-invariant). Da
#2456-oprydningen begyndte at slette usolgte ungdomsryttere ved
auktionsfinalisering, forsvandt de tavst fra enhver managers ønskeliste.
Frontend filtrerer orphaned joins væk (`WatchlistPage.jsx` #1918: `.filter(e =>
e.rider)`), så der var ingen fejl, ingen tomt-badge — bare én række mindre.
Spillere opdagede det ved at rytteren var væk og måtte have det forklaret
manuelt på Discord.

## Root cause
Ingen kode-sti der sletter en rytter (`auctionFinalization.deleteUnsoldYouthRider`,
`aiTeamGenerator.deleteAiTeamById`/`removeAiTeams`/`clearAllAiTeams`) ryddede
eller notificerede om tilhørende `rider_watchlist`-rækker. Sletningen var
korrekt isoleret (samme transaktion/guard-mønster som resten af #2456), men
ingen af stierne kendte til watchlist-tabellens eksistens.

## Fix
Ny delt funktion `notifyAndClearWatchlistForRiders` i
`backend/lib/notificationService.js`: slår `rider_watchlist` op for de netop
slettede rytter-id'er, indsætter én `watchlist_departed`-notifikation pr.
watcher ("X has left the game"), og rydder derefter deres watchlist-rækker.
Kaldt fra ALLE fire kendte sletnings-callsites, umiddelbart EFTER en bekræftet
DELETE (aldrig før — ellers notificeres/ryddes der for ryttere en TOCTOU-guard
reelt ikke rørte). Ny notifikationstype tilføjet additivt via
`database/2026-07-17-watchlist-departed-notification-type.sql` +
`database/schema.sql`.

`backend/lib/starterSquadAllocator.js`'s `deleteRiders` (rollback af en delvis
start-trup-allokering) er bevidst UDELADT: de ryttere er friskoprettede i samme
allokerings-transaktion og har aldrig været synlige/liste-bare, så de kan ikke
have watchlist-rækker.

## Forhindret-fremover
Enhver fremtidig rytter-sletnings-sti (fx pension #2218) skal kalde
`notifyAndClearWatchlistForRiders` — det er nu den ENE sted der ved noget om
`rider_watchlist`s manglende cascade, så det ikke kan glemmes igen pr. sti.
Test-dækning i `notificationService.test.js` (no-op/notify/dedup/fejl-isolation)
+ `aiTeamGenerator.test.js` (#2524-tests på `deleteAiTeamById`/`clearAllAiTeams`).

## Læring
En tabel uden FK-cascade til en "kilde"-tabel (bevidst, for at holde en
brugerflade privat/letvægts) er stadig en implicit kontrakt: enhver sti der
sletter kilde-rækken SKAL kende til afhængige tabeller uden cascade, ellers
bliver "ingen cascade" til "stille datakorruption". Når en ny sletnings-årsag
dukker op (#2456 var ikke den første ryttersletnings-sti, bare den første der
ramte usolgte ryttere i volumen), spørg: "hvilke tabeller PEGER på det jeg
sletter, uden at DB'en rydder op for mig?" — og saml svaret i én delt hook,
ikke i hver enkelt callsite.
