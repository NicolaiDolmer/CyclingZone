# Postmortem · 2026-08-03 · Kontrakt-loftet var stadig usynligt for et race-vindue (#3186)

## Hvad skete der?
Sentry CYCLINGZONE-45 blev ved med at logge `player action rejected: rider_extend_quote`
EFTER #3169 (31/7, "disable extend-contract button before click when rider is at the
cap") gik i produktion. 10 hændelser fundet i Sentry 30/7-3/8, alle fra
`/riders/:id` (rytterprofilen), alle Mobile Safari/iOS. 5 af de 10 lå EFTER
#3169-mergen (31/7 kl. 11:42 UTC): 31/7 12:46+14:05, 1/8 06:50, 2/8 04:36, 3/8 10:42.

## Root cause
#3169 tilføjede et stille loft-tjek ved mount af `RiderManageActions` (`extend-quote`
hentes automatisk), og satte kun triggerknappen disabled når svaret BEKRÆFTEDE loftet
(`extendCapped === true`). I det vindue hvor det stille tjek stadig var i flight —
`extendCapped` startede som `false` — var knappen ENABLED. En spiller der nåede at
trykke i det vindue (langsomt mobilnet forlænger vinduet; hurtige tryk rammer det
uanset netværk) udløste `openExtend()`s egen fetch mod extend-quote, som ramte det
ægte 409-loft og rapporterede en afvisning til Sentry — præcis den oplevelse #3186
oprindeligt ville fjerne (loftet opdages først når handlingen bliver afvist).

`TeamPage.jsx`'s `RiderActionModal` havde det SAMME race-vindue på "Forlæng"-fanen
(samme mount-tjek, samme `extendCapped`-only disabled-logik) — men rapporterede det
ikke til Sentry (fane-skiftets fetch sætter kun en synlig fejltekst, ikke
`reportActionFailure`), så det var usynligt i telemetrien selvom UX-fejlen var den
samme.

## Fix
1. **Lukket race-vinduet**: triggerknappen (rytterprofil) og "Forlæng"-fanen
   (holdside) er nu disabled BÅDE når loftet er bekræftet nået OG mens det stille
   tjek stadig kører (`extendLoading` / `extendCapChecking`) — ikke kun når svaret er
   landet. Der er nu intet vindue hvor et klik kan nå en dømt-til-afvisning request.
2. **Tælleren er nu altid synlig, ikke kun ved afvisning**: GET
   `/api/riders/:id/extend-quote` (backend/routes/api.js) sender nu et
   `extensionCap` felt ({ maxSeason, maxExtensions, usedExtensions,
   remainingExtensions }) i BÅDE success- og 409-grenen, beregnet af en ny ren
   helper `contractExtensionCapInfo()` (backend/lib/contractSeed.js). Frontend viser
   "Extensions used: X/3" / "Forlængelser brugt: X/3" under Forlæng-knappen
   (rytterprofil) og i forlæng-fanen (holdside) — FØR spilleren rører knappen,
   uanset om loftet er nået.
3. POST `/extend-contract` sender også `extensionCap` med (success + 409-gren), så
   et sjældent race på selve bekræftelsen (en anden fane/session forlængede
   imellemtiden) stadig giver frontend et frisk tal at vise.

## Forhindret-fremover
`backend/lib/contractSeed.test.js` beviser `contractExtensionCapInfo()`s aritmetik
(0/3 på en frisk/udløbet kontrakt, +1 pr. gentagen forlængelse, konvergerer på 3/3,
en flerårig signing kan allerede stå på 2/3 uden et klik, clamp til [0,3]).
`backend/lib/riderActionsRoutes.test.js` beviser (statisk source-check) at BEGGE
grene af extend-quote-routen sender `extensionCap` med.

## Læring
Et "hent stille og disable NÅR svaret bekræfter blokeringen"-mønster har et
indbygget race-vindue: default-state FØR svaret er landet skal være den
KONSERVATIVE tilstand (disabled), aldrig den optimistiske (enabled). Et
loading-flag der allerede eksisterer til ét formål (her: `extendLoading`, brugt af
panelets egen fetch) kan ofte genbruges til at dække det samme mount-check uden at
opfinde en ny variabel — men SKAL sættes for HELE det asynkrone kald, ikke kun for
den del der viser en spinner. Se også #3164/#3143s tidligere runde af samme problem
(backend var den eneste der kendte reglen) — dette er anden runde: selve
tidsvinduet omkring et asynkront "ved vi det endnu?"-tjek er lige så vigtigt som
tjekket selv.
