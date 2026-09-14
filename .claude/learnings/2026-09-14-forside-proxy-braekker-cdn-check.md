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
