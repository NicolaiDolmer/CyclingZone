# Postmortem · 2026-06-01 · React.lazy stale-chunk-fejl ikke genkendt → ingen auto-reload

## Hvad skete der?
Den klart dominerende prod-fejl i Sentry (~200+ events; **7 ud af 7 aktive issues i sidste 24t**, fx CYCLINGZONE-C/D) var stale-chunk-fejl efter deploy. Trods eksisterende mitigation (`vite:preloadError`-reload + error-boundary) fyrede de stadig — brugere så den generiske "Siden kunne ikke vises" i stedet for "Ny version klar", og hver fejl forurenede Sentry. Forstærket massivt af 24t-bølgen på 39 deploys.

## Root cause
Når en bruger med gammel `index.html` lazy-loader et chunk hvis hash er roteret væk, fejler `import()`. React.lazy efterlades med `_result === undefined` og kaster under render den **opake** `Cannot read properties of undefined (reading 'default')` / `e._result is undefined`. Den streng matchede ingen af `CHUNK_ERROR_PATTERNS` i `chunkErrors.js` → `isChunkLoadError()` = false → boundary klassificerede den som `render_error` → `shouldAttemptChunkReload` kørte ikke → ingen auto-reload, og eventet blev sendt til Sentry. Mitigationen dækkede import-fejlens *rod* (via `vite:preloadError`) men ikke React.lazy's *downstream-symptom*.

## Fix
PR #883:
- **`frontend/src/lib/lazyWithRetry.js`** — wrapper om `React.lazy`: ét retry (transient), og ved vedvarende chunk-fejl kastes en *genkendelig* `ChunkLoadError` i stedet for at efterlade React.lazy i `_result`-undefined-tilstand.
- **`App.jsx`** — `import { lazyWithRetry as lazy }` → alle ~48 lazy-routes dækkes via én import-alias, uden at røre de enkelte kald.
- **`chunkErrors.js`** — `_result`-signaturer tilføjet som sikkerhedsnet.
- **`sentry.jsx` `beforeSend`** — dropper recoverable `chunk_load_error` (appen auto-recover'er; deploy-sundhed overvåges via Vercel).

## Forhindret-fremover
Fang fejl **ved kilden** (wrap factory'en) frem for at pattern-matche minificerede, browser-varierende fejlbeskeder downstream (Chrome "reading 'default'" vs. Firefox "_result is undefined" — samme bug, forskellig streng). Pattern-matching er kun et sikkerhedsnet. Recoverable transient-fejl der auto-recover'er bør droppes fra error-monitoring (`beforeSend`), ikke samle sig som uresolvede issues. Verificeret: frontend `node --test` + build + playwright core-smoke (15 passed, 3 projekter).

## Læring
Et error-monitoring-dashboard fuld af recoverable støj skjuler de ægte fejl. Skeln mellem "fejl brugeren kommer sig fra automatisk" (drop/sample) og "fejl der kræver handling" (alert). Og: når en fejl manifesterer sig forskelligt på tværs af browsere, er message-matching skrøbeligt — fang den deterministisk hvor den opstår.
