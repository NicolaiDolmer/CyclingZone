# 2026-09-03: Dependabot #41/#42 + CodeQL #354/#355 + advisor-WARNs (#4720)

## Rodaarsag pr. del

**A) qs (Dependabot #41/#42).** `backend/package.json` havde allerede en
`overrides.qs` fra en tidligere runde (^6.15.2), men den nyeste sikkerhedsrettelse
(GHSA-x5fp-wj9c-mxmx, array-limit bypass) laa i 6.16.0 — bag den tidligere pin.
Hverken express@4.22.2 eller body-parser@1.20.6 kraever endnu >=6.16, saa
overrides-pinnet skal opdateres manuelt hver gang `qs` patcher, ikke automatisk
via `npm audit fix`.

**B) CodeQL js/incomplete-url-substring-sanitization (#354/#355).** Scanneren
mønster-matcher `.includes(url-lignende-streng)` uanset kontekst — den skelner
ikke test-fixtures der verificerer EGEN template-output fra en sikkerhedstjek
paa ubetroet input. `backend/lib/emailTemplates.test.js:34-35` var en fixture-
assert, ikke en sanitization-kontrol, men trippede alligevel moenstret.

**C) Supabase advisor WARNs.** `guard_academy_offer_ownership` (#4213,
2026-08-29) fik aldrig `search_path` sat — samme klasse som phase-a/phase-b
(#927/#525): en ny funktion mangler default-hærdning ved oprettelse.
`forum_reactions`/`forum_thread_reads` (#3517/#3451, 25/8) og
`market_value_level_correction_rider_receipts` (#3449, 19/8) fik `auth.uid()`
direkte i policy-USING i stedet for `(SELECT auth.uid())` — samme perf-moenster
som allerede rettet andre steder (#2677, 16/6), men ikke fanget paa disse tre
fordi de blev skrevet i separate PR'er uden checklist-reference til moenstret.

## Hvorfor vagterne ikke fangede det

- Ingen CI-gate tjekker at NYE `SECURITY DEFINER`/trigger-funktioner har
  `search_path` sat ved oprettelse — kun et engangs-sweep (`scripts/ops/
  supabase-advisor-sweep.mjs`) opdager det retroaktivt, og kun hvis nogen
  kører det.
- Ingen lint/reviewchecklist tjekker at nye RLS-policies bruger
  `(SELECT auth.uid())` i stedet for bar `auth.uid()` — moenstret er
  dokumenteret i tidligere migrationer, men ikke haandhaevet mekanisk.
- Dependabot-overrides er ikke selv-opdaterende: en override loeser problemet
  ÉN gang, men maskerer fremtidige alerts paa samme pakke indtil nogen
  manuelt bumper versionen igen.

## Forward-guard

- Ingen ny CI-gate tilfoejet i denne PR (scope-begraensning: sikkerheds-
  boelgen daekker de konkrete alerts, ikke ny tooling). Foreslaaet naeste
  skridt: udvid `scripts/ops/supabase-advisor-sweep.mjs` til at faile CI paa
  NYE `function_search_path_mutable`/`auth_rls_initplan`-fund (ikke kun
  rapportere), saa fremtidige migrationer fanges foer merge i stedet for i
  naeste advisor-sweep.
- `overrides.qs` boer tjekkes ved hver Dependabot-alert paa `qs`, ikke antages
  loest fordi en tidligere override findes.
