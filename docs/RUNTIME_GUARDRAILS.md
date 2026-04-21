# RUNTIME GUARDRAILS — Cycling Zone

## Purpose

Prevent drift between docs, UI, API, cron jobs and database behavior.

## Truth order

1. Runtime code for current behavior
2. CURRENT docs (`NOW`, `ARCHITECTURE`, `DOMAIN_REFERENCE`, `FEATURE_STATUS`)
3. SPEC docs (`BOARD_SYSTEM_*`, implementation plans, design specs)
4. Backlog / prompt docs

If current docs and runtime disagree, runtime wins and docs must be marked stale.

## Mandatory contract check

For any non-trivial task, verify:
- frontend callsite
- backend route exists
- shared engine or service used
- DB table and fields exist
- enum or check constraints allow the write
- canonical execution path is singular

## Domain boundaries

- `loan_agreements` = rider loans between teams
- `loans` + `loan_config` = finance loans
- auction finalization exists in both `backend/routes/api.js` and `backend/cron.js`
- season flow spans `server.js`, `api.js`, `economyEngine.js` and transfer window state

## Invariants

- one rider may not end in conflicting owner states
- no payment may go to the wrong team
- squad limits must hold after every market action
- transfer window must be enforced at create and accept or confirm time
- finance transaction types must match DB constraints
- notification types must match DB constraints
- do not change one execution path without checking the parallel path

## Stop conditions

Stop and switch to investigation if:
- frontend calls a missing endpoint
- the same route path is used for different domains
- schema lacks runtime-used fields, tables or types
- cron and API implement the same flow differently
- a spec doc is being treated as implemented behavior

## Release hygiene

- Hvis en ændring er brugerrettet, skal `frontend/src/pages/PatchNotesPage.jsx` opdateres i samme arbejdsgang
- Hvis en ændring ændrer regler, brugerflow, FAQ, onboarding eller noget spillere/admins skal forstå, skal `frontend/src/pages/HelpPage.jsx` opdateres i samme arbejdsgang
- En feature-opgave er ikke helt færdig, før Patch Notes og Help er vurderet eksplicit
- Hvis en af siderne ikke ændres, skal det være et bevidst valg og kunne forklares kort

## Required deliverables

- root cause
- invariant at risk
- minimal safe fix
- affected files
- regression tests
- docs to update
