# 2026-07-07 — Permanente test-konti slettet ved fat-finger admin-oprydning (#2245)

## Symptom
test-a/test-b/test-seller@cyclingzone.dev forsvandt periodisk fra prod (senest 2026-07-07, tidligere 2026-06-18). Preview/test-login fejlede; `scripts/setup-test-accounts.mjs` crashede efterfølgende på `teams_name_lower_unique_idx` fordi den orphaned `teams`-række (user_id sat NULL af FK) beholdt navnet.

## Root cause
Ikke en bug/cron — `DELETE /api/admin/users/:userId` blev kaldt manuelt fra `AdminUsersTab.jsx` af admin-kontoen, i samme batch som disposable workflow-exec-junk-konti. Admin-UI'et skelnede ikke visuelt mellem `teams.is_test_account=true` (permanent) og "test"-navngivne exec-konti (disposable) — begge så ens ud i listen, og et bulk-sweep ramte begge.

## Fix (PR #2246, merged 2026-07-07)
1. Backend-guard: `DELETE /admin/users/:userId` afviser sletning af `is_test_account=true`-brugere medmindre `confirm_test_account: true` sendes eksplicit (409 + `errorCode: test_account_delete_needs_confirm`).
2. `AdminUsersTab.jsx`: badge for permanente test-konti + skærpet confirm-dialog (skriv brugernavn).
3. `scripts/setup-test-accounts.mjs`: self-heal — relinker orphaned test-team via navne-match (`findOrphanTeamByName`) i stedet for at crashe på unique-constraint.

## Forebyggelse fremover
- Enhver ny "farlig bulk-admin-handling" (sletning/reset/frys) bør have samme mønster: eksplicit server-side confirm-flag for særligt markerede rækker + visuelt badge i admin-UI, ikke kun navne-lighed.
- Scripts der er afhængige af `user_id`-FK til at genfinde en ressource, bør altid have et sekundært lookup (navn/slug) som fallback, så en enkelt sletning ikke permanent bricker et setup-script.

## Status
Kode-fix var allerede merged, men issue #2245 forblev åbent (glemt done-flip). Ingen prod-mutation udført i denne opfølgning; re-oprettelse af de 3 test-konti mod prod kræver stadig ejer-go før `setup-test-accounts.mjs` køres mod prod.
