# Smoke-fejl tilskrevet forkert PR — bisect til parent FØR du fixer

**Dato:** 2026-06-23
**Kontekst:** 6 frontend-smoke-tests fejlede (desktop + mobile chromium), observeret på PR #1809. Opgaven kom med en konkret hypotese: #1792 (getUser()-null-guard på 15 sider) brød auth-fixturen → siderne redirecter til login → blanke/empty/forkert-fane.

## Hvad der faktisk var galt
Hypotesen var **forkert**. Siderne renderede med data (fixturen mocker `/auth/v1/user`, så `getUser()` returnerer aldrig null i smoke). Tre *uafhængige, præeksisterende* årsager — ingen relateret til #1792:

1. `academy.spec.js:46` — #1744 ændrede free-agent-knappen til pris-label (`signFreeAgentBtnPriced`); testen ledte efter den gamle "Signér til akademi".
2. `transfers-market-shortcut.spec.js:24` — #1569 auto-defaulter en tom-handels-spiller til markeds-fanen; testen påstod default=received.
3. `core-smoke.spec.js` `patch-notes.png` — patch notes tilføjet siden sidste snapshot-refresh (6.01→6.03+) → benign layout-vækst.

## Rod-årsags-beviset
Checkede #1792's parent-commit (`ced96437`) ud og kørte de 3 specs: **de fejler allerede der.** Det udelukkede #1792 på under 1 minut og forhindrede at "fixe" en uskyldig guard.

## Lektion (forward-guard)
- **En advisory-test der fejler "på" en PR er ikke nødvendigvis brudt AF den PR'en.** frontend-smoke er advisory → stale tests/snapshots driver med uset i flere PR'er, og dukker først op når nogen kigger.
- **Attribuér før du fixer:** kør den fejlende test på `git checkout <PR>^` (parent). Fejler den der → årsagen er ældre. Billigt, afgørende, og forhindrer symptom-patch på forkert sted. Cluster med [[feedback_runtime_verify_first]] + [[feedback_reproduce_locally_before_push]].
- **Læs den faktiske render-output** (received-string / error-context / diff-PNG) før du tror på en foreslået mekanisme. Her viste outputtet "lander på markeds-fanen" og "knap mangler" — ikke "redirect til login", hvilket straks modsagde hypotesen.

**PR:** #1811.
