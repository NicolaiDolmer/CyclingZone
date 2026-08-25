# En callback-kontrakt fire kaldsteder holdt implicit, og det femte glemte

**Dato:** 25/8 2026, 14:43-15:30 · **Issues:** #4244 (fejlen), #4238 (kilden), #4010 (kontrakten) · **PR:** #4247 · **Sentry:** CYCLINGZONE-4X

## Hvad der skete

Forum-pulsen (#4238) blev merged og deployet 25/8. Kort efter begyndte Sentry at
samle `TypeError: Cannot read properties of undefined (reading 'subscribe')` fra
cyclingzone.org/dashboard. **8 spillere ramt på 12 minutter**, `handled: no`,
substatus `escalating`.

`subscribeAuthedChannel(navn, configure)` kræver at `configure` returnerer
kanalen. Kontrakten står i JSDoc'en på `realtimeChannelCore.js:45` og er ikke
til at misforstå: *"Påfør `.on()`-handlers, returnér kanalen."*

De fem kaldsteder i appen:

| Kaldsted | Stil | Returnerer? |
|---|---|---|
| `Layout.jsx:599` (notifikationer) | arrow-expression | implicit |
| `useRealtimeRefetch.js:42` | arrow-expression | implicit |
| `AuctionsPage.jsx:1213` | arrow-expression | implicit |
| `NotificationsPage.jsx:285/295` | arrow-expression | implicit |
| **`Layout.jsx:615` (forum-ulæst, #4238)** | **blok-body** | **nej** |

Det nye kaldsted havde brug for en lokal `refetch`-funktion før `.on()`-kaldene,
og blok-body er den naturlige måde at skrive det på. I samme bevægelse forsvandt
det implicitte return, som de fire andre fik gratis af arrow-syntaksen.

## Rod-årsagen

**Kontrakten var kun håndhævet af kaldstil, ikke af koden.** Fire kaldsteder
overholdt den uden at nogen tænkte over det, fordi `channel.on(...).on(...)`
tilfældigvis er det sidste udtryk i en arrow-expression. Den femte skrev samme
kæde inde i en blok, og kontrakten brød uden en eneste advarsel: ingen type
fangede det, eslint fangede det ikke, og fejlen viste sig først i en async
`arm()` uden catch, altså som en unhandled rejection i produktion.

Det er den samme klasse som "en gate der kun måler sin egen regel": **en
konvention der kun holder fordi alle hidtidige tilfælde tilfældigvis så ens
ud, er ikke håndhævet - den er heldig.**

## Hvorfor ingen test fangede det

`realtimeChannelCore.test.js` havde 10 tests og god dækning af det #4010
handlede om (token-gaten, race-guards, SIGNED_OUT, cleanup). **Alle ti kaldte
`configure` som `(ch) => ch`** - den ene kaldstil der ikke kan fejle. Testene
dækkede kernens adfærd grundigt og kontraktens brudflade slet ikke.

## Hvad der blev gjort

1. `return channel` i `Layout.jsx:615`.
2. Forward-guard i kernen: `configure(fresh) ?? fresh`. Kontrakten er stadig
   "returnér kanalen", men en glemt return koster nu læsbarhed i stedet for et
   brud. `.on()` returnerer selv kanalen, så begge kaldstile ender med samme
   objekt.
3. Regressionstest der kalder med præcis blok-body-stilen fra Layout.
   Verificeret til at fejle mod den gamle kerne med **samme fil og linje som
   Sentry-eventen** (`realtimeChannelCore.js:63`), og bestå med fixet.

## Læringen

Når en ren lib eksporterer en callback-kontrakt, så test den kaldstil der kan
bryde den, ikke kun den der ikke kan. Og hvis kontrakten kan holdes af et
`?? fallback` på tre tegn, så gør den det - en konvention der afhænger af at
hver fremtidig udvikler husker et `return`, bliver brudt før eller siden.

Sekundært: fejlen var usynlig for spilleren (siden gik ikke ned, forum-prikken
faldt bare tilbage på 60s-heartbeatet). Uden Sentry ville den have levet videre
som "prikken er lidt langsom". `handled: no` + stigende brugertal er signalet
der gjorde den til en hastesag i stedet for en note.
