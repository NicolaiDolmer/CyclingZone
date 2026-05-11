# 2026-05-11 — Signup economy placeholder

## Symptom
Live-hold blev oprettet med placeholder-økonomi (`balance=500` og/eller `sponsor_income=100`) i stedet for den kanoniske startøkonomi `800000/240000`.

## Root cause
Backendens `PUT /api/teams/my` brugte `requireAuth`, som først henter et eventuelt eksisterende `teams`-row. Hvis en live auth/signup-trigger allerede havde oprettet et placeholder-team med testøkonomi, kørte `teamProfileEngine` update-pathen og ændrede kun navn/manager, ikke økonomifelterne.

## Fix
`teamProfileEngine` reparerer nu kun kendte signup-placeholder-værdier (`balance=500`, `sponsor_income=100/500`) til `INITIAL_BALANCE` og `SPONSOR_INCOME_BASE`, og bevarer reelle eksisterende økonomiværdier. Migrationen `2026-05-11-fix-signup-economy-defaults.sql` låser live DB-defaults/signup-trigger og normaliserer balance og sponsor uafhængigt for placeholder-teams uden finance-transaktioner.

## Prevention
Signup/onboarding-tests skal dække både "ingen team findes" og "placeholder team findes allerede" paths. Ved økonomi-default bugs skal live probe altid inkludere `finance_transactions` før balance repair.
