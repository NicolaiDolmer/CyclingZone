# Postmortem · 2026-09-14 · Forside-proxy brækker CDN-cache-check

## Hvad skete der?
Deploy verify (Railway+smoke) blev rød på main efter PR #5239 (#4067): trinnet
"Verify CDN cache-headers (#2423)" fejlede med "hashed build-assets: fandt ingen
/assets/*.js|css i den serverede HTML". Merge-køen stoppede, fordi intet
backend-merge kan køre forbi en rød Deploy verify (#5251).

## Root cause
`scripts/check-cdn-cache-headers.mjs` hentede '/' UDEN cookie for at finde en
hashet build-asset-URL at teste immutable-cache på. Før #4067 returnerede '/'
altid app'ens egen SPA-HTML uanset besøgende. Efter #4067/#5239 proxy'er
`frontend/middleware.ts` anonyme besøg på '/' videre til marketing-sitet
(cycling-zone-marketing.vercel.app), medmindre klienten sender markør-cookien
`cz_session=1` (sat af `frontend/src/lib/sessionCookie.ts`). Marketing-HTML'en
har ingen `/assets/*.js|css`-referencer, så regexen fandt intet.

## Fix
`scripts/check-cdn-cache-headers.mjs`:
- HTML'en der bruges til at udtrække en hashet asset-sti hentes nu med header
  `cookie: cz_session=1`, så middleware.ts lader requesten passere igennem til
  appens egen index.html/app.html (samme sti en logget-ind spiller får).
- "SPA-entry"-tjekket på '/' sender nu samme cookie, så det rent faktisk måler
  SPA'ens egne cache-headers og ikke marketing-originens.
- Nyt tjek "marketing-entry (anonym /)" — ægte anonymt kald (ingen cookie) —
  kræver at marketing-svaret på '/' også forbliver kortlivet (samme grænse,
  60s), så begge svar-varianter på '/' er dækket.
- `extractHashedAssetPath(html)` udskilt som ren, testbar funktion; ny
  `scripts/check-cdn-cache-headers.test.mjs` dækker både SPA-HTML (finder
  asset) og marketing-HTML (kaster forventet fejl).

Verificeret read-only mod prod: `node scripts/check-cdn-cache-headers.mjs
https://cyclingzone.org` → exit 0, alle 6 regler ✓.

## Forhindret-fremover
Forward-guard: enhver ændring af hvad anonym '/' serverer (routing, middleware,
rewrites) skal køre `node scripts/check-cdn-cache-headers.mjs` lokalt mod et
preview-/prod-domæne FØR merge — ikke kun stole på at CI opdager det efter
merge til main.

## Læring
En "mål de levende headers"-gate (i modsætning til en config-lint) er stærk
mod cache-regressioner, men er selv sårbar over for ændringer i HVAD '/'
rent faktisk serverer for hvem. Når en request-sti forgrener på et signal
(her: en cookie), skal ethvert script der "bare henter '/'" eksplicit vælge
hvilken gren det tester — ellers tester det ubemærket den forkerte, og fejlen
viser sig først som en forvirrende "fandt ingen assets" i stedet for en klar
"du testede marketing-sitet".

## Runde 2 (14/9 sen aften, #5251/#5253)
Fixet i PR #5252 rykkede kun det FØRSTE trin der ramte problemet
("Verify CDN cache-headers"). Da det trin blev grønt, dukkede det NÆSTE op:
"Verify manglende asset fejler rent (#4545)" fejlede med "kunne ikke finde
entry-bundlen i app-shellen — proben kan ikke måle noget" — samme rodårsag
(anonymt GET '/' rammer marketing-HTML), bare i et andet script, der havde
været skjult bag det først-fejlende trin hele tiden.

**Backwards-check af HELE `.github/workflows/deploy-verify.yml`-kæden** (ikke
kun det trin der lige fejlede) fandt:

| Script | Kaldt fra deploy-verify.yml | Rammer anonym '/'? | Handling |
|---|---|---|---|
| `scripts/check-cdn-cache-headers.mjs` | "Verify CDN cache-headers" | Ja (allerede fixet i #5252) | Refaktoreret til delt helper |
| `scripts/check-asset-miss-behaviour.mjs` | "Verify manglende asset fejler rent (#4545)" | Ja — `fetch(base, ...)` for at finde entry-bundlen | **Fixet denne runde** |
| Sentry source-map-tjek, chunk-fejl-rate | samme workflow | Nej — rene Sentry-API-kald (curl) | Ingen ændring |
| Smoke-test (health/auctions/frontend) | samme workflow, inlinet i YAML'en | Nej — måler kun HTTP-status, ikke HTML-indhold | Ingen ændring |
| `scripts/smoke-test-prod.mjs` | Kaldes IKKE af denne workflow | Nej — rammer kun backend `/api/*` | Ingen ændring |

De to asset-probes i `check-asset-miss-behaviour.mjs` (rigtig asset +
manglende asset) rammer konkrete `/assets/*`-stier, som middleware'ens
`matcher: "/"` ALDRIG rammer — de forblev bevidst helt anonyme.

**Fix:** ny delt helper `scripts/lib/fetchAppShell.mjs`
(`fetchAppShell()`/`appShellHeaders()`, cookie `cz_session=1`) — samme mønster
og samme kommentar-forklaring som i #5252. `check-asset-miss-behaviour.mjs`
bruger den nu til at hente `base` (app-shellen). `check-cdn-cache-headers.mjs`
er refaktoreret til at bruge samme helper i stedet for sin egen inline
cookie-header, så der kun findes ÉT sted der definerer "sådan henter du
appens SPA-HTML" — ellers ville en tredje probe med egen inline-cookie være
lige så sandsynlig at glemme opdateringen, hvis cookienavnet nogensinde
ændres.

### Forward-guard (opdateret)
Enhver ændring af hvad anonym '/' returnerer skal ledsages af:
`grep -rn 'fetch(\`\${[A-Za-z_]*}/\`\|fetch(base\b\|fetch(ORIGIN\b' scripts/`
— hvis den rammer et NYT script, skal det scripts hentning af app-shellen gå
via `scripts/lib/fetchAppShell.mjs`, ikke en ny inline cookie-header.
