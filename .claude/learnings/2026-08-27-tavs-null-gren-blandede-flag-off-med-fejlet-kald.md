# Tavs null-gren: "flaget er slukket" og "kaldet fejlede" delte render-gren

**Dato:** 27/8 2026 · **Issue:** #4165 · **PR:** fix/4165-silent-null-planning

## Symptom

ez4prebren i Discord 23/8 kl. 21:05 CEST: *"Er jeg den eneste, der ikke kan komme
ind i planlægningen pt?"* Fra mobilen. bobby2106 foreslog en genindlæsning, og
svaret var det afgørende spor: *"Kommer bare frem med det samme."* Genindlæsning
hjalp ikke. Fem minutter senere: *"Det er kun planlægning, alt andet virker."*

Issuet stod fire dage senere stadig med "Skal undersøges: hvad fejler konkret?".

## Rodårsag

Ikke mobil-specifik. Fire af fem hypoteser blev afkræftet med målt evidens: der
er ingen JS-breakpoint i planlægnings-træet (mobil/desktop-skiftet er ren CSS),
der findes ingen service worker, HTML'en serveres med `max-age=0,
must-revalidate`, og backenden var oppe og rask i netop det minut.

Den rigtige rodårsag stod i koden hele tiden:

```js
// RaceHubBoard.jsx, før fixet
if (!headers) { setLoading(false); return; }   // ingen token: tavs
try {
  const res = await fetch(url, { headers });
  if (res.ok) setData(await res.json());        // ikke-2xx: tavs
} catch { /* netværk - board forbliver i forrige tilstand */ }
...
if (!data?.enabled) return null;                // og så tegnes der INTET
```

Den sidste linje er hele bugget. Den blander to helt forskellige tilstande
sammen: *feature-flag off* (legitim, boardet skal være skjult) og *kaldet
lykkedes ikke* (fejl, manageren skal vide det). Uden fejl-state falder begge ned
i samme gren. Resultatet er en flade uden spinner, uden besked og uden retry.

Derfor hjalp genindlæsning ikke: den kørte det samme fejlende kald igen og tegnede
det samme intet. En genindlæsning kan ikke reparere en tilstand hvor fejlen
allerede er kastet væk.

Samme mønster fandtes i `StrategyPage.jsx` og `DivisionStartLists.jsx`, så tre af
hubbens fire indgange kunne blanke samtidig. Kontrasten beviser det: Formplan-
fanen fik en rigtig fejl-gren i #2849 bølge 6 (`usePlanner.js` setError
http/network → ErrorState + retry) og ville have vist manageren hvad der var galt.

## Hvorfor det ikke blev opdaget

Tre lag svigtede samtidig.

1. **Ingen test dækkede fejl-halvdelen.** Der fandtes hverken unit- eller e2e-
   dækning for `!res.ok` eller netværksfejl i nogen af de tre flader. Preview-
   mocken svarer altid 200 på `/api/races/distribution`, så halvdelen af
   kontrakten var utestet by design.
2. **Backenden loggede ikke sine egne afvisninger.** 401 fra `requireAuth` og
   400 "No team found" havde hverken log eller Sentry. Kun 500-grenen
   rapporterede.
3. **Klienten kastede svaret væk.** Ingen status, ingen krop, ingen telemetri.

Konsekvensen: den udløsende fejl kan IKKE bestemmes bagudrettet. Railway-HTTP-
logs for 23/8 findes ikke længere, og Discord-screenshottet er udløbet. Fixet
gør fejlklassen synlig fremadrettet; det genskaber ikke evidensen for hændelsen.

Gælden var i øvrigt allerede kendt og skrevet ned: `docs/PLANNING_CENTER_RULES.md`
§7 fund 5, *"Fem flader returnerer tavst null ved slukket flag ELLER fejlet
kald"*, efterprøvet mod koden 25/8. #4165 er den første spiller-rapport der
beviser at gælden koster i produktion. Et dokumenteret fund er ikke en løsning.

## Fix

Alle tre flader fik den fejl-kontrakt Formplanen allerede havde: `loadError` for
de tre grene (auth/http/network), `setLoading(false)` i `finally`, og en kanonisk
ErrorState med secondary retry. Fejl-grenen ligger FØR flag-grenen, og
`!data?.enabled → null` er bevaret uændret som den legitime flag-off-tilstand.

Instrumentering, så næste rapport kan diagnosticeres:

- `reportLoadFailure()` sender en fejlet hentning til Sentry som exception med
  lav-kardinale tags (flade/kind/status). En fejlet HENTNING er ikke en
  afvisning: spilleren ramte ingen regel, fladen er nede for netop ham.
- Backenden logger nu 401 "Invalid token" (metode, sti uden query, fejlkode,
  aldrig token'et) og 400 "No team found" (user_id).

## Læring

**En render-gren der kan nås af to årsager med modsat betydning er en bug, også
når den ser ud som en tom tilstand.** "Vis intet" er et legitimt svar på "feature
er slukket" og aldrig et legitimt svar på "jeg ved det ikke". Når de deler linje,
er den tavse variant den der rammer spilleren.

**En tom `catch` er et løfte om at fejlen ikke betyder noget.** Kommentaren i
RaceHubBoard sagde *"netværk - board forbliver i forrige tilstand"*. Ved den
allerførste hentning FINDES der ingen forrige tilstand, så løftet var forkert
præcis når det gjaldt.

**Fejl-grenen skal instrumenteres samtidig med at den bliver synlig.** Havde 401
og 400 været logget i forvejen, havde denne session taget minutter i stedet for
en hel kortlægning. Det billigste tidspunkt at gøre en fejl observerbar er før
nogen leder efter den.

**"Genindlæsning hjælper ikke" er diagnostisk information.** Det udelukker stale
chunks og cache, og peger direkte på en deterministisk fejl i selve kaldet. Den
replik var i tråden fra dag ét.
