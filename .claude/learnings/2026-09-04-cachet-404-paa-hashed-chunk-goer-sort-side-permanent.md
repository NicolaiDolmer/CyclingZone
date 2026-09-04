# Postmortem · 2026-09-04 · En cachet 404 på et hashed chunk gør den sorte side permanent

## Hvad skete der?
Spillere fik en helt sort side efter et deploy: `#root` var tom, der stod INTET i konsollen,
og tilstanden forsvandt ikke af sig selv — heller ikke ved almindelig genindlæsning eller
ved at navigere rundt. Kun en hård genindlæsning hjalp. Samme klasse som Sentry
CYCLINGZONE-56 (15 spillere / 29 events på 14 timer), hvor fejlteksten var
"resolved to an invalid module without a default export".

## Root cause
`frontend/vercel.json` sætter `Cache-Control: public, max-age=31536000, immutable` på
`/assets/(.*)`. Vercels header-regler matcher på **sti, ikke på status**, og der findes
ingen dokumenteret måde at betinge dem på statuskode
(vercel.com/docs/headers/cache-control-headers). Under et deploy svarer edgen kortvarigt
404 på et nyt chunk — og den 404 bliver stemplet immutable i et år.

Målt 4/9 i en spillers browser:

    performance.getEntriesByType('resource')
    -> { name: '.../react-dom-<hash>.js', responseStatus: 404,
         deliveryType: 'cache', transferSize: 0 }

Det afgørende: **`location.reload()` revaliderer ikke en immutable-cachet respons.** Alle
tre eksisterende recovery-stier (`vite:preloadError`, `unhandledrejection`,
error-boundary'en) ender i et reload — og reloadet hentede den samme 404 fra disken.
Recovery kunne per konstruktion ikke virke. Dertil: når det er ENTRY-modulet der fejler,
kører intet af app-grafen, så ingen af de tre stier bliver overhovedet installeret.

## Fix
To lag, PR fix/4595-chunk-404-selfheal:
1. `frontend/public/chunk-selfheal.js` (classic script, indlæst øverst i
   `frontend/index.html`): lytter i capture-fasen på window efter `error` fra
   `script[type=module]` og `link[rel=modulepreload]`, refetcher alle modul-URL'er med
   `fetch(url, { cache: 'reload' })` og laver ÉT `location.reload()` bag en
   sessionStorage-vagt (`cz_chunk_selfheal_at`, maks 1 pr. 60 s, fail-closed).
2. `frontend/src/lib/lazyWithRetry.js`: `purgeStaleChunkFromCache()` kaldes før den
   vedvarende chunk-fejl kastes videre til reload-stien.

`cache: 'reload'` er hele nøglen: den springer cachen over på vej UD og **overskriver**
cache-posten med det nye svar. Målt i browser mod en Vercel-simulerende server: plain
`fetch` gav 404 (fra cache) mens serveren svarede 200; `fetch(url, {cache:'reload'})` gav
200 og efterfølgende plain fetch gav også 200.

## Forhindret-fremover
- `frontend/src/lib/chunkSelfHeal.test.js` kører den shippede classic script i `node:vm`
  med et falsk window og beviser refetch-med-`cache:'reload'` + maks ét reload.
- `frontend/vercel.rewrites.test.js`: boot-vagten må aldrig selv få en lang cache-header —
  over den findes der ikke noget lag der kan reparere.
- `scripts/check-asset-miss-behaviour.mjs --require-fresh-miss` er stadig den rigtige
  prod-probe, men kan først slås til når #2423 (Skew Protection) fjerner selve racet.

## Læring
**En cache-header gælder også fejlsvar.** Enhver `immutable`-regel der matcher på sti skal
tænkes igennem for 404/500, ikke kun for 200. Og: når recovery-stien er "reload", så
verificér at et reload faktisk kan hente noget nyt — et reload mod en immutable-cachet
fejl er en no-op der ligner en fix.

Refs #4595 #2423 #4545 #4546 #906 #881
