# Postmortem: chunk-fejl-raten over budget (#4595) — 404 på hashede assets baerede stadig `immutable`

**Dato:** 2026-09-03
**Issue:** #4595 (opfoelger #4545/#4546, rodfix #2423 P1)
**Sentry:** CYCLINGZONE-56 — 252 events / 37 unikke brugere paa 2 doegn (3/9 07:00-maaling)

## Rodaarsag

Vercel matcher `headers`-regler i `vercel.json` paa URL-STI, ikke paa svarets status.
`/assets/(.*)` fik derfor `Cache-Control: public, max-age=31536000, immutable` uanset
om filen faktisk fandtes. Efter #4546 (1/9) svarer en manglende chunk korrekt 404 —
men det 404-svar arver den SAMME header som en rigtig fil, fordi Vercel ikke
understoetter en status-betinget header-regel i `vercel.json` (bekraeftet mod
Vercels egen dokumentation: "404 status codes are cacheable on Vercel's Edge
Network" — der findes ingen `has`/`missing`-matcher der kan betinges paa
response-status).

Konsekvens: en spillers laenge-levende fane har en gammel bundle der refererer en
chunk-hash der er roteret vaek af senere deploys. Foerste request paa den hash
fejler (404, korrekt) — men browseren cacher DET SVAR immutable i et aar.
`location.reload()` gaar samme vej. Og i Firefox/Safari undertrykker `immutable`
specifikt revalidate-on-reload-heuristikken, saa selv `Ctrl+Shift+R` ikke hjalp
for spilleren der rapporterede det 1/9.

**Rettet efter ekstern review (ret-runde, 3/9):** `loadWithRetry`s (lazyWithRetry.js)
ENE retry sker SYNKRONT, millisekunder efter foerste fejl — langt inden for baade
det gamle et-aars OG det nye 300s-vindue. Retry'et rammer derfor ALTID samme
cache-entry som foerste forsoeg, uanset denne PR's max-age-aendring. Det er ikke
en del af det denne PR fixer og staar IKKE laengere naevnt som saadan. For en
PERMANENT roteret hash (spillerens faktiske scenarie — hash'en findes aldrig
igen) giver 5-min vs. 1-aars cache ingen forskel i om `loadWithRetry` fejler og
sender en Sentry-event: den fejler stadig, uanset cache-alder. Det der reelt
redder spilleren i DET scenarie er den allerede eksisterende
`chunkErrors.js`-reload (uaendret af denne PR), som henter et FRISK index.html
(kort-cachet, <=60s, `ENTRY_MAX_MAX_AGE` i `check-cdn-cache-headers.mjs`) med
nye, gyldige hash-referencer. Denne PR's reelle gevinst er smallere: et
FORBIGAAENDE miss under selve udrulnings-vinduet (samme hash bliver
tilgaengelig igen kort efter) selvhelbreder nu paa 5 min i stedet for et aar —
ikke den permanente-rotation-historie der dominerer de 252 events/37 brugere.

## Hvorfor blev det ikke fanget foer

`check-cdn-cache-headers.mjs` (#3484) proiber KUN en rigtig, eksisterende asset —
den tester aldrig en miss. `check-asset-miss-behaviour.mjs` (#4545) proiber en
miss, men koerer kun som ADVARSEL i deploy-verify (`--require-fresh-miss` er
bevidst slaaet fra i workflowet, ventende paa netop denne fix). To vagter, hver
med sit blinde punkt — ingen af dem alene kunne have fanget krydsfeltet.

## Fix

Ingen status-betinget header findes i Vercels statiske config. Fuld lukning
(nul afvejning) kraever Skew Protection (#2423 P1: pin asset-requests til
deploymentet klienten koerer paa) — det er en stoerre, separat leverance
(Pro-plan-feature, kraever manuel `?dpl=`-wiring for en ren Vite-SPA uden
framework-understoettelse, dyrere at bygge og teste end en enkelt session).

I stedet: sank `/assets/(.*)`s Cache-Control fra `max-age=31536000, immutable`
til `max-age=300, must-revalidate` (frontend/vercel.json). Det er den samme
graense `missResponseIsSafelyCacheable()` i `check-asset-miss-behaviour.mjs`
allerede definerede som "trygt" (no-store/no-cache eller `max-age <= 300`).
Konsekvens:
- Et forbigaaende miss selvhelbreder inden for 5 minutter i stedet for et aar.
- `check-cdn-cache-headers.mjs`s regel for hashede assets er opdateret til at
  matche den nye, bevidste politik (`minMaxAge: 300, requireImmutable: false`)
  — ellers ville guarden fejle paa hvert fremtidigt deploy.

**Bevidst afvejning, IKKE en regression:** dette giver et mindre stykke af
#3484's oprindelige Edge-Request-besparelse tilbage (assets revalideres nu
efter 5 min i stedet for aldrig inden for et aar). Prisen vurderes lav for et
lille open-beta-spillertal. Chunk-fallbacken (allerede robust implementeret
siden #4545/#4546 — se `frontend/src/lib/chunkErrors.js`) selvhelbredte
ALLEREDE for det dominerende (permanent-rotation) scenarie foer denne PR, fordi
den henter et separat, kort-cachet index.html — det er ikke denne PR's
fortjeneste. Denne PR laegger et snaevrere lag ovenpaa: et forbigaaende miss
under selve udrulnings-vinduet fejler ikke laengere unoedigt i op til et aar.

`--require-fresh-miss` i deploy-verify.yml er BEVIDST ikke slaaet til i denne
PR: proben rammer en fast, deterministisk falsk sti
(`/assets/ProbeMissingChunk-DEADBEEF.js`) som har vaeret ramt paa hvert deploy
siden 1/9 under den GAMLE, immutable regel. Der er en reel risiko for at et
allerede-forgiftet cache-lag for netop den sti overlever et par deploys efter
denne fix, hvilket ville give falske roede deploy-verify-koersler. Anbefaling:
verificér `node scripts/check-asset-miss-behaviour.mjs --base=https://cyclingzone.org --require-fresh-miss`
groent paa 2-3 rigtige deploys foerst, flip saa flaget i en opfoelgende PR.

## Forward-guard

`frontend/vercel.rewrites.test.js` og `scripts/check-asset-miss-behaviour.test.mjs`
bevogter allerede hensigten uden hardcodede vaerdier for selve max-age-tallet —
ingen nye tests kraevet. `check-cdn-cache-headers.mjs` (live-probe, ingen
enhedstest) er opdateret til den nye politik og koerer paa hvert deploy.

## Hvad blev IKKE rørt

- Punkt (2) fra #4595 (robust ChunkLoadError/dynamic-import-recovery: ét
  automatisk reload med sessionStorage-versions-guard) var allerede fuldt
  implementeret — `frontend/src/lib/chunkErrors.js` +
  `installChunkReloadHandlers` wired i `main.jsx`/`sentry.jsx`, med en
  KAUSAL navigations-guard (#3602) der er mere robust end det oprindeligt
  efterspurgte. Ingen kodeaendring.
- Punkt (3), `CHUNK_ERROR_BUDGET` (25/24t) i deploy-verify.yml: #2423 anbefaler
  ikke en aendret taerskel — uaendret.
