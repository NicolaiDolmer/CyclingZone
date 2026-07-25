# Postmortem · 2026-07-26 · i18n-gaten krydstjekkede ikke backend errorCodes mod errors.json

## Hvad skete der?
#2834 (23/7) tilføjede 3 nye backend `errorCode`-literaler (`seller_squad_risk_too_small`,
`cannot_release_squad_risk`, `cannot_auction_squad_risk`) uden matchende nøgle i
`frontend/public/locales/{en,da}/errors.json`. Ingen af de eksisterende i18n-gates
(key-coverage, leak-check, page-untranslated) fangede det. Ved audit for #2848 viste
det sig at yderligere 11 backend errorCode-literaler (bl.a. `username_taken`,
`feedback_message_required`, `no_eligible_room_bid`, `test_account_delete_needs_confirm`)
allerede manglede oversættelse i produktion — danske spillere ville have set den
engelske `error`-faldback-tekst i stedet for dansk.

## Root cause
`i18n-check-keys.mjs` differ kun en-vs-da inden for `errors.json` selv — en nøgle der
mangler SYMMETRISK i begge sprog (fordi backend-koden aldrig fik en matchende
oversættelse tilføjet) er usynlig for den diff. Ingen gate sammenlignede backendens
egen kilde (`errorCode`-literaler i `backend/lib`+`backend/routes`) mod
`errors.json`'s `api.*`-namespace. Samme blind-spot-klasse som #2896 (terrain-coverage).

## Fix
Nyt script `scripts/i18n-check-error-codes.mjs` (+ `.test.mjs`) scanner
`backend/{lib,routes}/**/*.js` (ikke tests) for alle `errorCode`-literal-konstruktioner
(direkte property, ternary, lookup-tabel, assignment, `failure()`-helperens literale
3. argument, og de to issue-getters hvis `.code` forwardes direkte) og fejler hvis en
kode mangler en `errors.json` `api.<code>`-oversættelse i en eller da. Tilføjet til
`check:i18n` (package.json) og som required job i `.github/workflows/i18n-check.yml`.
De 11 reelt manglende oversættelser er tilføjet (EN først, DA under).

## Forhindret-fremover
Gaten kører i CI på enhver PR der rører `backend/lib/**`, `backend/routes/**` eller
`frontend/public/locales/**` — en fremtidig ny `errorCode`-literal uden oversættelse
blokerer nu PR'en i stedet for at slippe i produktion.

## Læring
En i18n-gate der kun sammenligner locale-filer MOD HINANDEN kan aldrig fange en kode
der mangler i BEGGE sprog samtidig — den skal sammenlignes mod kildens egen
sandhed (backend-literalerne selv), akkurat som #2896's terrain-coverage-guard gjorde
for dynamisk-byggede i18n-nøgler. Denne bug-klasse ("symmetrisk hul, usynligt for
en-vs-da-diff") er nu fanget to gange (#2896, #2848) — værd at holde øje med ved
FREMTIDIGE nye i18n-kilder (fx nye enum-baserede t()-kald).
