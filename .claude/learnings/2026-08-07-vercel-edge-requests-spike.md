# Vercel-alarm "Edge Requests spike" — default-cache-headers gjorde hvert sideload ~9x dyrere

**Dato:** 2026-08-07
**Refs:** #2423 (P2 "Eksplicit Cache-Control" — skrevet 13/7, aldrig shippet)
**Fundet af:** ejeren, i Vercel-dashboardet. **Ikke** af mig.

## Hvad skete der

Vercel-dashboardet viste `Alerts: 1 Active — Edge Requests spike`. Produktet fejlede intet:
`cyclingzone.org` svarede 200, 0 runtime errors i 7 dage, alle prod-deploys grønne.

Rod-årsag: Vercels **default** for statiske filer er `Cache-Control: public, max-age=0,
must-revalidate`. Hverken `frontend/vercel.json` eller Vite-presettet overskrev den. Browseren
revaliderede derfor **hver enkelt fil ved hvert sideload** — inklusive de content-hashede
`/assets/*.js|css`, hvor filnavnet i sig selv garanterer at indholdet aldrig ændrer sig.

Hver revalidering er en billable **Edge Request**, også når svaret er `304 Not Modified`.
`app.html` refererer 27 assets → ét gensyn kostede ~27 edge requests i stedet for ~3.

Målt før fix:

```
/assets/index-Bpjz4lVu.js   Cache-Control: public, max-age=0, must-revalidate
/fonts/dm-sans-...woff2     Cache-Control: public, max-age=0, must-revalidate
/brand/wordmark-ondark.svg  Cache-Control: public, max-age=0, must-revalidate
/favicon.svg                Cache-Control: public, max-age=0, must-revalidate
```

Forstærkende faktor (ikke rod-årsagen): botter. Clarity målte 6/8 **125 bot-sessioner mod 188
menneske-sessioner** — og Clarity ser kun botter der eksekverer JavaScript, så den ægte
bot-andel af edge requests er højere. Kombineret med SPA-rewriten `/(.*)` → `/app.html`, der
svarer **200 på enhver opfundet sti**, har crawlere en ubegrænset crawl-flade. Håndteres separat.

## Fejlklassen: usynlig i produktet, synlig kun på regningen

Det her er ikke en bug man kan se. Siden var hurtig, alt virkede, intet fejlede, ingen bruger
klagede. Den eneste manifestation var et forbrugstal i et dashboard jeg aldrig kigger i.

Alle mine eksisterende gates måler **korrekthed** (tests, lint, i18n, bundle-budget, smoke).
Ingen af dem måler **driftsomkostning**. En regression der kun koster penge passerer dem alle.

## Hvorfor jeg ikke opdagede den selv

Tre selvstændige huller — alle tre skulle lukkes, det var ikke ét uheld:

1. **Ingen rutine kigger på Vercel.** `CLAUDE.md`s start-rutine er `docs/NOW.md` → GitHub-issues.
   Platform-tilstand (Vercel/Railway) indgår ikke. Jeg åbnede Vercel første gang i dag fordi
   jeg blev bedt om det.
2. **Vercel-MCP'en kan ikke se alarmer.** Den eksponerer projekter, deployments, runtime-logs
   og analytics — men *ingen* dashboard-alarmer (usage/spend/anomali). Havde jeg tjekket
   proaktivt via MCP, havde jeg fået "0 runtime errors, alle deploys OK" og konkluderet
   grønt. **Værktøjet ville aktivt have bekræftet den forkerte konklusion.** Statiske requests
   findes heller ikke i runtime-logs, så symptomet var usynligt ad den vej.
3. **Gappet var allerede skrevet ned og lå stille.** #2423 (13/7) beskrev præcis denne fix som
   P2: "hashede assets (`/assets/*`) → `public, max-age=31536000, immutable`". Ordlyden var
   "verificér og sæt eksplicit" — ingen verificerede nogensinde mod de levende headers.
   Et audit-issue uden gate er en note, ikke en beskyttelse.

Hul 3 er det dyreste at gentage: **audit-fund der ender som issue-tekst uden eksekverbar gate
forfalder lydløst.** Når en audit skriver "verificér X", skal den samme PR levere kommandoen
der verificerer X — ellers er fundet kun en påmindelse om noget ingen gør.

## Fix

`frontend/vercel.json` — eksplicitte `headers[]`-regler:

| Sti | Cache-Control | Hvorfor |
|---|---|---|
| `/assets/(.*)` | `max-age=31536000, immutable` | content-hashet, kan aldrig blive stale |
| `/fonts/(.*)` | `max-age=2592000, swr=604800` | ikke hashet → 30 dage, ikke immutable |
| `/brand/(.*)`, favicons, og-billeder | `max-age=604800, swr=2592000` | ikke hashet, skifter sjældent |
| `/` (SPA-entry) | **uændret** `max-age=0, must-revalidate` | nye deploys skal ramme brugerne straks |

`/locales/*` blev bevidst **ikke** ændret: namespaces bundles inline i JS-bundlen, så
HTTP-backenden er kun fallback (lille gevinst), mens stale locale-JSON ville betyde gammel
spiller-vendt tekst (reel risiko). Dårlig byttehandel.

**Fælde undgået undervejs:** `_comment`-nøgler i `vercel.json` er ikke i Vercels schema og får
deployet til at fejle. Forklaringer hører i commit/postmortem, ikke i filen.

## Forward-guard

`scripts/check-cdn-cache-headers.mjs`, kørt af `deploy-verify.yml` efter hvert prod-deploy.

Den måler de **levende headers på prod**, ikke konfigurationen. Det er hele pointen: en regel i
`vercel.json` der ikke matcher (forkert glob, flyttet output-mappe, ændret framework-preset) ser
korrekt ud i review og virker alligevel ikke. Kun svaret fra CDN'en er evidens.

Gaten tjekker begge retninger — assets skal være længe-cachede, og SPA-entry må **ikke** være
det (ellers når nye deploys ikke ud). Verificeret ved at køre den mod prod før fixet: den fejlede
på alle fire regler, hvilket er beviset på at den rent faktisk fanger klassen.

Den tjekker også for `text/html`-svar: SPA-rewriten gør at en forkert sti i `RULES` ville svare
200 med HTML og fejle med en forvirrende cache-besked i stedet for "filen findes ikke".

## Uløst — kræver ejer-beslutning

- **Alarm-synlighed.** Vercels alarmer kan jeg stadig ikke læse programmatisk. Skal løses ved at
  route dem til en kanal jeg *kan* læse (Vercel-notifikation → Discord-webhook), ellers er ejeren
  fortsat eneste detektor.
- **Bot-fladen.** `robots.txt` er `Allow: /` for alle agenter, og catch-all-rewriten svarer 200
  på enhver sti → uendelig crawl-flade. At stramme det rører ved SEO (Ahrefs, `perf-seo-review`),
  så det er ikke mit kald at gøre ensidigt.
