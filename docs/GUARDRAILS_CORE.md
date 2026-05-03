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

## Kompleks feature-redesign → AskUserQuestion-session
Før kodning på systemer der kræver kravafklaring (flow-redesign, ny automatisering, IA-valg): planlæg en dedikeret session med brugeren. Skriv det ind i backloggen som en separat slice med "Næste skridt: AskUserQuestion".

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
- **Doc-drift sweep:** før close-out, grep for nye env vars, deploy-targets, route-navne og tabel-navne mod `ARCHITECTURE.md` og `PRODUCT_BACKLOG.md`. Drift fundet → ret i samme commit.

## Cadence-regler (efter høj-velocity sessioner)

### Soak-gate
**Trigger:** Forrige session shippede ≥3 user-facing slices (ikke patches, ikke docs).  
**Krav:** Næste session starter med 60-min e2e manual smoke gennem nye flows i alle relevante temaer/modes FØR ny kode-slice startes. Smoke-fund noteres i `NOW.md` "Senest leveret".  
**Hvorfor:** Regression-risiko er højest når velocity er højest, lavest når koden er friskest i hovedet.  
**Håndhævelse:** `NOW.md` får "Soak-gate aktiv: ja/nej". Hvis ja, ny slice må ikke startes før gate er kvitteret.

### Runtime-anchored feature-brief
**Trigger:** Alle ikke-trivielle slices (>1 fil eller >30 linjer ny kode).  
**Krav:** 5-linjers brief i chatten FØR kode:  
1. Mål (én sætning, manager-værdi)  
2. Runtime-evidens (fil:linje for nuværende state)  
3. Invariant der beskyttes  
4. Minimal change  
5. Verification path  
**Hvorfor:** Gør den implicitte "mandatory contract check" eksplicit i <50 tokens og fanger doc/runtime-drift før kode skrives.

## Fuld version
Se `docs/GUARDRAILS.md` ved: nye datakontrakter · IA/naming-valg · shared runtime-refactors · features med flere plausible produktmodeller.
