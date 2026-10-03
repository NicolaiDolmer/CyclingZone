# Deadline-day-cron loggede "undefined" under Supabase-udfald (CYCLINGZONE-82)

**Dato:** 2026-10-03 (hændelse 2026-10-02 19:26 dansk tid)

## Symptom
Sentry CYCLINGZONE-82: `processDeadlineDayCron: could not load latest transfer_window: undefined` (3 events, sidst under det korte Supabase/Cloudflare 521/522/525-udfald 2/10).

## Rod-årsag
`backend/lib/deadlineDayReport.js` byggede fejlbeskeden af `windowError.message`. Når PostgREST ikke selv svarer (Cloudflare-fejlside eller problem-JSON fra et udfald), er fejlobjektet ikke et PostgREST-fejlobjekt og har ingen `message`-streng. Beskeden blev derfor "undefined", og fejlen kunne ikke skelnes fra en ægte applikationsfejl.

## Fix
Call-sitet bruger nu `toSupabaseError()` (samme normalisering som resten af backend), så beskeden altid er læsbar (`Supabase unavailable (521 …)` eller `Supabase error`), og `code` bevares. Regressionstest for begge fejlformer i `deadlineDayReport.test.js`.

## Læring
Byg aldrig en fejlbesked direkte af `error.message` fra et Supabase-svar. Gå altid via `toSupabaseError()` / `withSupabaseRetry`. Den bredere normalisering af Cloudflare problem-JSON (objekt uden `message`) ligger i #6105.
