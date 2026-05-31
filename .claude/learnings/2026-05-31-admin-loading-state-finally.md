# Postmortem · 2026-05-31 · Admin loading states need finally guards

## Hvad skete der?
Admin-only handlinger kunne efterlade knapper i loading-state, hvis et API-kald fejlede på netværk/CORS eller serveren returnerede et non-JSON svar. Player-facing flowet var allerede rettet i #860, men de interne admin-tabs havde samme mønster.

## Root cause
Flere handlers satte `setLoad(..., true)` eller `setLoading(true)` før `await fetch`, læste derefter `await res.json()` direkte og nulstillede kun loading på happy-path. En fetch-rejection eller JSON-parse-fejl sprang derfor over `setLoad(..., false)`.

## Fix
Admin-tabs bruger nu `try/catch/finally`, `readAdminJson(res)` og `adminErrorMessage(...)` i `useAdminAuth.js`, så non-JSON og network-fejl bliver vist som tydelige admin-fejl og loading altid resettes.

## Forhindret-fremover
Ved nye admin-handlers: brug samme helper-mønster som i `frontend/src/components/admin/shared/useAdminAuth.js`, og sæt loading reset i `finally`. Undgå direkte `await res.json()` efter muterende admin-kald.

## Læring
Admin-only er stadig runtime, ikke et fristed for happy-path-kode. Hvis et flow har en spinner eller disabled-knap, skal failure-pathen være lige så bevidst som success-pathen.
