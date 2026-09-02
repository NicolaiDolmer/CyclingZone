# Postmortem · 2026-09-02 · Vilkårsaccept talt som betalende kunde + reconcile der aldrig kørte

## Hvad skete der?
Ejeren så 5 kunder, 294 kr LTV og 1,9 % konvertering på /admin/growth "Kunder & LTV" samme dag
checkout blev åbnet (#4597). Alunta sagde 2 betalende kunder. De 3 ekstra havde aldrig betalt.
Samtidig stod den ægte kunde fra juli som udløbet 31/8, selvom Alunta havde fornyet til 1/10.

## Root cause
Tre uafhængige fejl der først blev synlige med rigtig trafik:
1. `billingCheckout.js` upserter en `subscriptions`-række (vilkårsaccept) FØR betalingen. Admin-
   endpointet tog alle rækker som kunder, og LTV-estimatet gav enhver række mindst én periode.
   Samme tælling i `compute_daily_growth_snapshot()`.
2. Alunta sender `plan_interval` som TAL (1/6 måneder); resten af systemet forventer
   `monthly`/`semiannual`. Prod havde `'1'` stående siden 25/7. En halvårs-kunde ville blive
   prissat som månedlig.
3. Reconcile-cronen var kun et 24h-`setInterval` uden boot-run. Intervallet nulstilles ved hvert
   deploy, og backend deployes oftere end dagligt. Den har derfor reelt aldrig kørt siden flaget
   blev tændt 3/8. Fornyelsen 1/9 lå usynkroniseret 2/9.

## Fix
- `hasEverPaid()` + `partitionSubscriptions()` i `backend/lib/growthSnapshot.js`; endpointet
  rapporterer terms-only-rækker som "startede checkout, betalte ikke". SQL-snapshot filtrerer ens
  (`database/2026-09-02-growth-snapshot-paying-only-4636.sql`).
- `backend/lib/subscriptionPlanInterval.js`: én normalisering brugt af webhook, reconcile og LTV.
- Boot-run af reconcilen i `backend/cron.js` (samme mønster som forfalds-vagten #4514).

## Forhindret-fremover
- Tests med prod-billedet fra 2/9 (5 rækker, 2 betalende) og Aluntas ægte svarform (tal-plan).
- Kontrakten er nu ✅ målt i `docs/BILLING_STACK.md`, ikke "uverificeret".

## Læring
- **En række i en tabel er ikke et forretningsbegreb.** "Kunde" skal defineres eksplicit ét sted
  og genbruges; tæl aldrig `count(*)` på en tabel der også bruges som log.
- **Et 24h-setInterval uden boot-run kører aldrig i et miljø der deployer dagligt.** Alle daglige
  crons skal enten have boot-run eller en persistent "sidst kørt"-check. Backwards-check: kun
  reconcilen manglede det blandt de 24h-crons i cron.js (forfalds-vagt og fair play har boot-run).
- **Første rigtige trafik afslører kontrakt-antagelser.** Dry-run-scripts der findes skal køres
  FØR flaget flippes, ikke efter. #4541's aktiveringstjekliste blev sprunget over 3/8.
