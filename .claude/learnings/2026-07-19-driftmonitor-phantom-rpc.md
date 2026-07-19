# Postmortem · 2026-07-19 · driftMonitor kaldte en RPC der aldrig blev oprettet

## Hvad skete der?
`backend/scripts/driftMonitor.js` kaldte `supabase.rpc('check_salary_drift')` som led i det daglige drift-monitor-loop. RPC'en har aldrig eksisteret i databasen (ingen definition i `database/*.sql`) — kaldet fejlede tavst på hvert run og faldt igennem til en JS-fallback-query, som allerede dækkede begge #2594-invarianter (salary != null for manager-ejede ryttere, ingen løn over 240k-loftet).

## Root cause
RPC'en blev planlagt under #2594-cutoveren men aldrig implementeret som SQL-migration; kaldet til den blev stående i koden som en død, altid-fejlende sti.

## Fix
Fjernede `supabase.rpc('check_salary_drift')`-kaldet og den betingede fallback-gren i `backend/scripts/driftMonitor.js` (#2674). JS-queryen mod `riders`-tabellen er nu den eneste vej — ingen ændring i hvilke invarianter der tjekkes, kun fjernelse af den altid-fejlende RPC-sti først i kæden. Valgt fremfor at oprette RPC'en, jf. issuets egen anbefaling (B: mindst vedligehold, checket er billigt i JS).

## Forhindret-fremover
Ingen ny stående fejl-sti at overvåge — færre bevægelige dele i drift-monitoren. Backend-testsuite (3968 tests) kører uændret grønt.

## Læring
Et RPC-kald uden matchende SQL-definition i `database/*.sql` fejler tavst via `{ data, error }`-kontrakten og maskeres af en fallback — hold øje med "phantom RPC"-mønstre når en feature refaktoreres væk fra en planlagt (men aldrig skrevet) database-funktion.
