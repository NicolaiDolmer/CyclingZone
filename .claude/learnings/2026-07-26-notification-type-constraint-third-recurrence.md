# 2026-07-26 — Notifikationstype uden constraint-migration (3. gentagelse) + dry-run der ikke tester INSERT

## Hvad skete
#2700-varslet (`notifySeasonTransitionRisk.js --live`) fejlede 59/59 med `notifications_type_check`-violation: typen `season_transition_risk` var shippet i kode uden ledsagende migration. Dry-run var grøn — den tæller modtagere og bygger beskeder, men rører aldrig INSERT-stien, så defekten var usynlig indtil --live. #3016 dokumenterede samtidig 2 yderligere manglende typer (`scout_report_ready` fejlende i prod siden 25/7, `contract_expired_release` der fyres INDE i sæsonskiftet).

## Rodårsag
Tredje gentagelse af samme mønster (jf. 2026-06-25 + 2026-07-04-learnings). Forward-guarden fra #1464 blev aldrig bygget, fordi hver enkelt hændelse blev fixet punktuelt uden backwards-check.

## Fix
- PR #3026: varsel-typen → `contract_expiring` (findes i constraint + har frontend-rendering). Varsel re-kørt: 59/59 leveret, DB-post-verify grøn.
- PR #3027: idempotent migration (+2 typer) · kanonisk `NOTIFICATION_TYPES`-liste · `notifyUser` captureException ved ukendt type (tavs afvisning → højlydt) · paritetstest migration↔liste↔kode-konstanter (CI-gated — 4. gentagelse er nu umulig uden rød test).

## Læringer
1. **En dry-run der ikke udøver skrive-stien beviser kun læse-halvdelen.** Balance-/notifikations-scripts med --live-flag skal have mindst én integrationstest der rammer den ægte tabel (eller en negativ-kontrol mod constraint-listen). Jf. [[feedback_test_real_endpoint_not_just_mocked]].
2. **2 gentagelser = byg guarden NU.** Backwards-check + forward-guard-reglen blev citeret i begge tidligere learnings men ikke udført. Guard-issues må ikke lukkes som "beskrevet i #1464" — de skal bygges i samme PR som 2.-gangs-fixet.
3. **Audit-agenter skal søge PR-titler før done→todo:** 3 falske DONE-TO-TODO-verdicts i dag skyldtes at `(#N)`-konventionen i PR-titler ikke blev søgt ved 0 kommentarer.