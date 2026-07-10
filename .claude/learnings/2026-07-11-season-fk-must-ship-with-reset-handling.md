# Ny FK til seasons SKAL shippe med beta-reset-håndtering i samme PR

**Dato:** 2026-07-11 · **Kontekst:** finance-audit-pakken (#2300-#2306)

## Hvad skete

Samme fælde bed to gange på én dag:

1. `scout_assignments.season_id` (scout Fase 3, merged 10/7) landede i prod uden
   håndtering i `resetBetaSeasons` + `BLOCKING_FK_BASELINE` → Reset-FK-audit'en
   (kører mod LIVE prod-skema) gik rød på ALLE database-PR'er (#2314, #2316) og
   en ægte beta-reset ville være crashet midtvejs. Fixet post-hoc i PR #2318.
2. Timer senere: #2304-subagenten tilføjede `loans.last_interest_season_id`
   (NO ACTION FK til seasons) i sin migration — igen uden reset-håndtering.
   Fanget i review FØR apply denne gang (fix pushet til PR #2325 inden merge).

## Rod-årsag

Reset-FK-audit'en er en forward-guard der KUN kører på PR'er der rører
`database/**` m.fl. — men den adjudicerer mod prod-skemaet, så en FK der
allerede ER merged+applied forurener alle EFTERFØLGENDE PR'ers CI, ikke sin
egen. Skaden opdages først én PR for sent.

## Regel fremad

Enhver migration der tilføjer en FK (især til `seasons` eller andre
`RESET_DELETE_TARGETS`) skal i SAMME PR: (1) håndtere den i den relevante
`resetBeta*`-funktion (null-before-delete for nullable, delete-child-first
ellers), (2) tilføje `BLOCKING_FK_BASELINE`-entry, (3) regressionstest med
FK-simulation i `betaResetService.test.js`. Subagent-prompts for migrationer
skal nævne dette eksplicit.

## Bonus-læring (verifikations-probe)

Ved verifikation af om en funktion-redefinition er applied: match på en streng
INDE i funktions-kroppen (`$$...$$`, fx et kolonne-/variabelnavn) — ikke på ord
fra header-kommentaren over `CREATE FUNCTION` (de ryger ikke med i `prosrc`).
En forkert probe gav i denne session en falsk "migration ikke applied"-alarm.
