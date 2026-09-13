# Postmortem · 2026-09-13 · Fejl-middlewaren svarede 500 på alle klientfejl (#5144)

## Hvad skete der?
Den terminale fejl-middleware i `backend/server.js` svarede altid `500 Internal server error` og ignorerede `err.status`/`err.statusCode`. Defekt JSON i en request-body (body-parser kaster http-errors med `status: 400`) blev derfor til 500 hos klienten og talt som driftshændelse i Sentry. Præeksisterende fra Express 4; mere synligt efter Express 5 (#5134), fordi afviste async-promises nu automatisk rammer samme handler.

## Root cause
Middlewaren var skrevet som "sidste udvej" uden at læse den status fejlen allerede bar. Ingen test dækkede kontrakten "4xx ind → 4xx ud".

## Fix (PR #5196)
- Middlewaren flyttet til `backend/lib/errorMiddleware.js` (testbar; server.js kalder `app.listen()` ved import).
- `resolveErrorStatus`: 400-499 på `status`/`statusCode`/`status_code`/`output.statusCode` respekteres; alt andet bliver 500 med uændret krop. Kun heltal eller rent numeriske strenge accepteres.
- Kendte body-parser-typer får faste korte beskeder (`Invalid JSON body`, `Payload too large` …); ellers kun `expose: true`-beskeder, første linje, maks 200 tegn. Ingen stack.
- Sentry gated til 5xx via `shouldReportToSentry`, givet eksplicit til Sentrys express-error-handler, så svar og capture bruger samme status-udledning.
- Prod-verificeret 13/9 kl. 23:28: defekt JSON mod `/api/feedback` → 400.

## Forhindret fremover
- `backend/test/errorMiddleware.test.js`: defekt JSON → 400, kastet Error → 500 uden stack, `createError(403)` → 403, Sentry-mock kun ved 500.
- Ingen eksisterende rute skiftede status (gennemgang i PR-body): alle ruter der producerer status-bærende fejl fanger dem selv.

## Læring
En "catch-all" fejl-handler skal læse den kontrakt fejlen allerede bærer, ellers gør den klientfejl til serverfejl og forurener overvågningen. Frontend-fund til opfølgning: der er ingen central `apiFetch`; hvert kaldsted tolker fejl-JSON selv (`resolveApiError`).
