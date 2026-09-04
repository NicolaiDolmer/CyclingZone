# 2026-09-04 · Skew Protection via `?dpl=` på asset-URL'er knækkede hele appen i prod

## Hvad skete
PR #4745 (#2423) satte `experimental.renderBuiltUrl` i `frontend/vite.config.js` til at hænge
`?dpl=<deployment-id>` på alle byggede asset-URL'er når Vercel sætter
`VERCEL_SKEW_PROTECTION_ENABLED=1`. Skew Protection var ALLEREDE slået til i Vercel, så det
første prod-build efter merge (08:16) fik `?dpl=` på entry-HTML'ens `<script>`/`modulepreload`
og på dynamiske imports. Vites statiske chunk-imports (`from "./react-BHP1HVD3.js"`) bærer
ingen query-string. Browseren så derfor to forskellige modul-URL'er for samme fil, loadede
React og consent-modulet to gange, og appen døde med `useConsent must be used within
ConsentProvider` + React #418 på alle sider. Ejeren så fejlskærmen ~10 min efter merge.

## Rettelse
Revert-commit direkte på main (352a63d4b) kl. ~08:30, push, nyt deploy uden `?dpl=`.
#2423 flippet tilbage til `claude:todo` med den rigtige vej: Vercels `__vdpl`-cookie, ingen
URL-omskrivning, plus build-guard mod `?dpl=` i dist/.

## Hvorfor det slap igennem
1. PR'ens egen test verificerede at `dpl=` VAR til stede, ikke at appen kunne køre med det.
2. PR-preview-deployet (samme toggle) blev aldrig åbnet i en browser før merge.
3. Go-kortet til ejeren blev bygget på diffen, men diffen så "inert uden env" ud; ingen
   tjekkede om env'en allerede var sat i prod.

## Regel fremover
- **Enhver ændring i build-output-URL'er (vite.config `base`/`renderBuiltUrl`/`assetsDir`)
  skal åbnes i PR-previewen i en browser med console-tjek FØR merge.** Preview-deploys deler
  prod-toggles, så fejlen er synlig der.
- Antag aldrig at en "inert bag env"-ændring er inert: mål om env'en er sat i prod
  (`vercel env ls`-keys-only, eller spørg ejeren) før go-kortet.
- Skew Protection for Vite-SPA = cookie, ikke query-string.

Refs #2423 #4745 #4595
