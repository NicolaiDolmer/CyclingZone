# GUARDRAILS — Cycling Zone

## Truth order
1. Runtime code
2. Current docs (NOW, ARCHITECTURE, DOMAIN_REFERENCE, FEATURE_STATUS)
3. Spec docs (BOARD_SYSTEM_*, implementation plans)
4. Backlog / prompt docs

Runtime og current docs er uenige → runtime vinder, doc markeres stale.

## Task types
- `bugfix` — minimal safe fix, stop-after-done
- `small_feature` — afgrænset feature med klar spec
- `refactor_safe` — ingen adfærdsændring
- `investigation` — ingen kodeændringer, kun analyse
- `docs_update_only`

## Task shaping (start af ny opgave)
Skriv kort feature-brief i chatten: mål · manager-værdi · berørt runtime-path · åbne beslutninger · anbefalet retning

Klassificér: `direkte implementerbar` / `investigation` / `kræver askuserquestion`
Ikke `direkte implementerbar` → sig hvorfor og stop før kodeændringer.

## Mandatory contract check (før coding)
Verificér altid:
- frontend callsite
- backend route eksisterer
- shared engine / service
- DB tabel og felter eksisterer
- enum / check constraints tillader skrivningen
- kanonisk execution path er singular

Kan kontrakten ikke verificeres → skift til `investigation`, stop.

## Roadmap
- `docs/PRODUCT_BACKLOG.md` er kanonisk roadmap og backlog for større slices
- `docs/NOW.md` holdes kort: aktiv slice, næste slice og blockers
- Nye ideer → backlog; de springer ikke foran aktiv slice uden runtime- eller produktgrund

## Askuserquestion gates
Tag afklaringssession ved: IA/naming-valg · features med flere plausible produktmodeller · nye datakontrakter eller integrationer · balancing med fairness-konsekvens

Tag IKKE afklaringssession ved: afgrænsede bugfixes med tydelig spec · reproductions uden produktvalg

Eskalér alligevel hvis runtime viser drift mellem frontend, API, engine og DB.

## Domain boundaries
- `loan_agreements` = rider-lån · `loans` + `loan_config` = finance-lån
- Auction finalization: `api.js` og `cron.js` delegerer begge til `auctionFinalization.js`
- Season flow: `server.js`, `api.js`, `economyEngine.js` og transfer window state

## Invariants
- En rytter må ikke ende i konfliktende ejer-state
- Betaling må ikke gå til forkert hold
- Squad limits skal holde efter enhver market action
- Transfer window håndhæves ved create og accept/confirm
- Finance transaction types skal matche DB constraints
- Notification types skal matche DB constraints
- Ændring af ét execution path kræver check af parallelt path

## Stop conditions
Stop og skift til `investigation` hvis:
- frontend kalder manglende endpoint
- samme route-path bruges til forskellige domæner
- schema mangler runtime-brugte felter/tabeller/typer
- cron og API implementerer samme flow forskelligt
- en spec doc behandles som implementeret adfærd

## Before coding
1. Root cause · 2. State transitions · 3. Edge cases · 4. Minimal safe fix

## Release hygiene (obligatorisk)
- `frontend/src/pages/PatchNotesPage.jsx` → opdater ved enhver brugerrettet feature eller adfærdsændring
- `frontend/src/pages/HelpPage.jsx` → opdater hvis ændringen påvirker regler, flow, FAQ, onboarding eller admin-brug
- Opdater ikke → skriv eksplicit hvorfor det ikke er relevant
- `npm run sync-docs` eksisterer ikke — skip det

## Required deliverables
- root cause · invariant at risk · minimal safe fix · affected files · regression tests
- ved shared runtime-refactors: mindst én direkte caller-smoke/regressionstest (cron, API eller tilsvarende)
- docs to update

## Slice close-out
Rapportér: hvad blev lukket · hvad blokerer stadig · quick wins der dukkede op · næste sparringssession
