# Postmortem · 2026-09-13 · Nedrykning til akademiet tillod gradueringsalderen (#5145)

## Hvad skete der?
`demote_rider_to_academy` (database/2026-06-25-academy-promote-demote.sql) tillod nedrykning ved sæsonalder <= 22, mens akademiet slutter ved 22 (`ACADEMY.MAX_AGE = 21`, `GRADUATION.GRADUATE_AGE = 22`). En manager kunne midt i sæsonen flytte en 22-årig ned og efterlade rytteren som `is_academy = true` over gradueringsalderen uden gradueringsrække; det løbende sweep (#5135) ville samme nat give "aged out"-notifikation og et 7-dages valg. Fundet ved read-only review af #5135 som hypotese for #5133.

## Root cause
To grænser med samme tal men forskellig semantik: "U23" (22 er inkluderet) og "må være i akademiet" (21 er sidste år). SQL-gaten brugte U23-grænsen og fejlkoden hed `not_u23`, hvilket gjorde fejlen usynlig i review.

## Fix (bygget i PR #5197, IKKE merget)
**Status 14/9:** ejeren parkerede rettelsen til U23-/juniorhold-sporet (ét tilfælde i hele betaen, #5133). PR #5197 er lukket, branchen `fix/5145-demote-age-gate-21` er bevaret, og #5145 står åben. Gaten `<= 22` er derfor stadig live. Punkterne herunder beskriver den færdige, reviewede løsning, klar til genoplivning.

- Ny idempotent migration: `CREATE OR REPLACE` med uændret signatur, kun `v_age > 22` → `v_age > 21`; GRANT/REVOKE-hærdningen gentages.
- Frontend: fælles gate `frontend/src/lib/academyDemoteGate.js` bruges begge steder knappen findes (rytterprofil + holdside); ved 22 vises knappen deaktiveret med forklaring (EN først, DA under). Copy siger ikke længere "U23" om grænsen.
- Tests: PGlite-integrationstest mod de ægte migrationer (21 ok, 22 afvist, regressions-pin på den gamle funktion) + frontend-gate pinnet mod backendens konstanter (læst som tekst, så frontend-testen ikke trækker `@sentry/node`).

## Verifikation af #5133-rytteren (prod, read-only 13/9)
Ingen ownership-events, intet admin_log; gradueringen blev løst 11/9 som `promoted`. Hypotesen kan hverken bekræftes eller afvises for netop den rytter (nedrykning logger ikke i de to tabeller). Resultat skrevet på #5133.

## Læring
Grænser med samme tal skal deles som én navngivet konstant på tværs af SQL, backend og frontend, og fejlkoden skal hedde det den betyder. Tests bør pinne UI-gaten mod backendens konstant i stedet for at skrive tallet af.
