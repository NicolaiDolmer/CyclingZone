# Postmortem · 2026-09-01 · Fallbacken lovede et reload den ikke kunne give

## Hvad skete der?

En spiller kunne ikke komme ind på auktionssiden og fik i stedet chunk-load-fallbacken: "Cycling Zone was updated. We are trying to reload the new version automatically." Der skete ikke noget automatisk. Han reloadede, fik en ny fejl med et nyt fejl-id, og kunne blive ved i det uendelige. `Ctrl+Shift+R` hjalp ikke. Samme konto virkede på telefon og i et InPrivate-vindue på samme pc.

Sagen blev fejlsøgt i en Discord-tråd, ikke i et dashboard. Sentry viste nul chunk-fejl i de tre døgn hvor det stod på.

## Root cause

To defekter der hver for sig var til at leve med, og som sammen blev permanente.

**1. En manglende chunk svarede 200 + HTML, cachet immutable i et år.** Catch-all-rewriten i `frontend/vercel.json` (`/(.*)` → `/app.html`) fangede også `/assets/*.js`. Header-reglen for `/assets/(.*)` fra #3484 stemplede derefter det forkerte svar `max-age=31536000, immutable`. Målt i prod før fixet:

```
$ curl -sI https://cyclingzone.org/assets/AuctionsPage-DEADBEEF.js
200 · content-type: text/html · cache-control: public, max-age=31536000, immutable
```

Browseren havde altså en HTML-side liggende på en JS-URL, permanent. Chunk-navne er indholds-hashes, så en uændret chunk beholder sit filnavn i næste build: den forgiftede URL kom igen, og `location.reload()` revaliderer ikke `immutable`-ressourcer. `Ctrl+Shift+R` omgår kun cachen for selve navigationens ressourcer, ikke for en lazy `import()` der først sker når man klikker ind på ruten. Derfor hjalp hårdt genindlæs ikke, mens InPrivate og telefonen virkede: separat cache.

**2. Auto-recovery var opbrugt, men copyen blev ved med at love den.** Loop-guarden tillader ét reload pr. release (`cz:chunk-reload-attempted:<release>`). Var nøglen brændt, skete der intet, men fallbacken viste stadig "vi genindlæser automatisk". Spilleren fik ingen anvisning på hvad han selv kunne gøre.

Rod-årsagen bag defekt 1 var kendt. #906 beskrev mekanismen præcist og foreslog som fix nr. 2: "Sørg for at SPA-fallback for `*.js`-assets returnerer 404 i stedet for index.html". Issuet blev lukket på forslag 1 og 3 (fejl-genkendelse + auto-reload), altså på symptomet. Forslag 2 blev aldrig implementeret, og #3484 gjorde det latente problem permanent otte måneder senere.

## Fix

- `frontend/vercel.json`: SPA-fallbacken undtager nu `assets/`, `fonts/`, `brand/` og `locales/`. En manglende fil giver et ægte 404, `import()` rejecter, og den eksisterende recovery fanger den. Filsystemet vinder over rewrites, så rigtige assets serveres præcis som før.
- `frontend/src/lib/chunkErrors.js`: mønstrene er delt i utvetydige og tvetydige. `isChunkLoadError` er stadig bred og bruges til recovery, hvor en falsk positiv koster ét unødigt reload. Ny `isUnambiguousChunkLoadError` bruges hvor en falsk positiv er dyr.
- `frontend/src/lib/sentry.jsx`: `beforeSend` dropper ikke længere chunk-fejl. De sendes som warning under ét fingerprint, så de bliver én gruppe der kan arkiveres i Sentry, og fejl-id'et i fallbacken kan slås op. Fallback-copyen siger kun "vi genindlæser automatisk" når et reload faktisk er sat i gang; ellers får spilleren det skridt der virker.

## Forhindret-fremover

- `frontend/vercel.rewrites.test.js` afprøver rewrite-mønsteret som regex, ikke som streng. Den fejler hvis SPA-fallbacken igen matcher en statisk mappe, og en forward-guard fanger enhver ny mappe med lang cache-header der ikke er undtaget. Vagten er kørt mod den gamle konfiguration og fejler dér, som den skal.
- `sentry.boundary.test.js` fejler hvis `beforeSend` igen begynder at returnere `null` for chunk-fejl, eller bruger det brede filter til at dæmpe events.
- Åben opfølgning: Vercel Skew Protection (#2423 P1) er dét, der gør fejlklassen uddød. Denne PR fjerner den permanente skade og den blinde vinkel, ikke årsagen til at skew opstår.

## Læring

**Et filter der skjuler en fejlklasse i telemetrien fjerner også din evne til at opdage at fixet ikke virkede.** #881 droppede chunk-fejl som "recoverable støj" med begrundelsen at deploy-sundhed overvåges via Vercel. Det holdt kun så længe fejlen faktisk var recoverable. Da den holdt op med at være det, var der ingen der kunne se det, og fallbacken fortsatte med at vise spilleren et fejl-id for et event der aldrig blev sendt. Dæmp i dashboardet, hvor man kan se hvad man har slået fra, ikke i klienten hvor man ikke kan.

**Og: et lukket issue med et ikke-implementeret fix-forslag er stadig en åben fejl.** #906 havde det rigtige svar skrevet ned. Der gik otte måneder og en ekstra ændring, før den blev dyr nok til at blive fundet igen, denne gang af en spiller.

Relateret: [[2026-08-31-vagten-der-gik-groen-uden-at-maale]] — vagten i denne PR gik selv grøn på et falsk grundlag i første udgave, fordi et `\n`-anker ikke matchede en CRLF-fil og slicen dermed spændte hele filen. Den blev målt mod den gamle konfiguration før den blev troet på.
