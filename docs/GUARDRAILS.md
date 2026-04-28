# GUARDRAILS — Fuld version

Se `docs/GUARDRAILS_CORE.md` for: truth order · task types · contract check · stop conditions · invarianter · domænegrænser · release hygiene.

## Task shaping (start af ny opgave)
Skriv kort feature-brief i chatten: mål · manager-værdi · berørt runtime-path · åbne beslutninger · anbefalet retning

Klassificér: `direkte implementerbar` / `investigation` / `kræver askuserquestion`
Ikke `direkte implementerbar` → sig hvorfor og stop før kodeændringer.

## Roadmap
- `docs/PRODUCT_BACKLOG.md` er kanonisk roadmap og backlog for større slices
- `docs/NOW.md` holdes kort: aktiv slice, næste slice og blockers
- Nye ideer → backlog; springer ikke foran aktiv slice uden runtime- eller produktgrund
- Før en slice startes, tjek om runtime, tests eller patch notes allerede viser den som løst; hvis ja, opdatér docs-status i stedet for at implementere samme opgave igen
- Når en feature/fix lukkes, skal status nedskrives samme dag i `docs/NOW.md`, `docs/PRODUCT_BACKLOG.md` og `docs/FEATURE_STATUS.md`

## Askuserquestion gates
Tag afklaringssession ved: IA/naming-valg · features med flere plausible produktmodeller · nye datakontrakter eller integrationer · balancing med fairness-konsekvens

Tag IKKE afklaringssession ved: afgrænsede bugfixes med tydelig spec · reproductions uden produktvalg

Eskalér alligevel hvis runtime viser drift mellem frontend, API, engine og DB.

## Required deliverables
- root cause · invariant at risk · minimal safe fix · affected files · regression tests
- ved shared runtime-refactors: mindst én direkte caller-smoke/regressionstest (cron, API eller tilsvarende)
- docs to update

## Slice close-out
Rapportér: hvad blev lukket · hvad blokerer stadig · quick wins der dukkede op · næste sparringssession
- Lukket slice må ikke blive stående som aktiv/næste handling; flyt den til afsluttet status eller fjern den fra kendte bugs med kort done proof
