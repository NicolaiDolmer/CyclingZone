# GUARDRAILS CORE — Cycling Zone

## Truth order
Runtime > current docs > spec docs > backlog. Conflict → runtime vinder, doc markeres stale.

## Task types
`bugfix` · `small_feature` · `refactor_safe` · `investigation` · `docs_update_only`

## Før coding
1. Root cause · 2. State transitions · 3. Edge cases · 4. Minimal safe fix

## Mandatory contract check
Verificér: frontend callsite · backend route · shared engine/service · DB tabel+felter · enum/check constraints · singular execution path.
Kan ikke verificeres → `investigation`, stop.

## Stop-betingelser → skift til investigation
- Frontend kalder manglende endpoint
- Samme route-path bruges til forskellige domæner
- Schema mangler runtime-brugte felter/tabeller/typer
- Cron og API implementerer samme flow forskelligt
- Spec doc behandles som implementeret adfærd

## Kritiske invarianter
- Rytter må ikke ende i konfliktende ejer-state
- Betaling går aldrig til forkert hold
- Squad limits holder efter enhver market action
- Transfer window håndhæves ved create og accept/confirm
- Finance transaction types matcher DB constraints
- Notification types matcher DB constraints
- Ændring af ét execution path kræver check af parallelt path

## Domænegrænser
- `loan_agreements` = rider-lån · `loans` + `loan_config` = finance-lån
- Auction finalization: `api.js` og `cron.js` → begge delegerer til `auctionFinalization.js`

## Release hygiene (obligatorisk ved enhver brugerrettet ændring)
- `frontend/src/pages/PatchNotesPage.jsx` — opdatér eller skriv eksplicit hvorfor ikke
- `frontend/src/pages/HelpPage.jsx` — opdatér hvis regler/flow/FAQ/onboarding påvirkes

## Fuld version
Se `docs/GUARDRAILS.md` ved: nye datakontrakter · IA/naming-valg · shared runtime-refactors · features med flere plausible produktmodeller.
