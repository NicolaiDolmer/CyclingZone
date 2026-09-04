# 2026-09-04 · Cachet 404 på `/assets/*` giver permanent sort side uden fejl

## Hvad skete
Efter fem prod-deploys på 25 minutter (08:16–08:39) stod ejerens indloggede Chrome med sort
side på ALLE ruter, `#root` tom, ingen console-fejl, ingen Sentry-event (der kørte ingen JS).
`performance.getEntriesByType('resource')` afslørede to chunks med `responseStatus: 404,
deliveryType: "cache", transferSize: 0`. Samme filer svarede 200 fra edge i samme øjeblik.

## Rod-årsag
`frontend/vercel.json` sætter `Cache-Control: public, max-age=31536000, immutable` på
`/assets/(.*)` for alle svar. Vercel returnerer den header også på 404 (`curl -I
/assets/does-not-exist.js` → 404 + immutable). Under et deploy svarer edge kortvarigt 404 på
nye chunks; browseren gemmer 404'en i et år; entry-modulets graf fejler stille for evigt.

`fetch(url, {cache: 'reload'})` på de to filer + ny navigation → siden renderede straks.

## Konsekvens
Det er den skjulte halvdel af #4595/CYCLINGZONE-56: den synlige halvdel er chunks der falder
igennem til app.html-rewriten ("invalid module without a default export", 41 brugere); den
usynlige er cachede 404'er som Sentry ALDRIG ser. Enhver spiller der loader siden i et
deploy-vindue kan sidde fast indtil Ctrl+F5.

## Regel fremover
- **Ingen kæde af prod-deploys** mens spillere er på: hvert push til main = deploy = risikovindue.
  Batch merges, og merge aldrig "bare en docs-commit" midt i et gennemsyn.
- Sort side uden console-fejl → tjek `performance.getEntriesByType('resource')` for
  `responseStatus !== 200` + `deliveryType: "cache"` FØR du leder i koden.
- Fix: selvhelende boot-vagt (refetch `cache:'reload'` + én reload) + Skew Protection via
  cookie (#2423). Cache-headeren må ikke gælde 404 (kan ikke betinges i vercel.json → vagten
  er nettet).

Refs #4595 #2423 CYCLINGZONE-56
