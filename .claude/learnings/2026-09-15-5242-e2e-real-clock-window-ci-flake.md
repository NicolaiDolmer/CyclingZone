# E2E-test med rigtigt ur-vindue på 2 s: CI-runneren overhaler vinduet

**Dato:** 2026-09-15
**Issue:** [#5242](https://github.com/NicolaiDolmer/CyclingZone/issues/5242) — apiFetch Retry-After-kontrakt verificeret i UI-flow
**Symptom:** `frontend/tests/e2e/5242-apifetch-429-backoff.spec.js` fejlede 2x deterministisk (inkl. retry) på PR #5235, `Expected: 1 / Received: 2` på den anden `riderAValueTrendHits`-assertion. Lokalt 5/5 grønne.

## Hvad skete der

Testen mockede rider-1's value-trend-endpoint til at svare 429 med `Retry-After: 2`,
navigerede prev → next → prev i rytter-switcheren og forventede at det andet kald mod
samme url blev stoppet af apiFetch's vindue. Vinduet er et rigtigt `Date.now()`-vindue
(`retryNotBefore`-map i `apiFetch.ts`), ikke et fake ur.

CI-tracen (`playwright-report-mobile-chromium`, `0-trace.network`) viste afstanden
mellem de to rider-1-kald:

| Kørsel | 1. kald → 2. kald | Vindue udløb efter |
|---|---|---|
| CI forsøg 1 | 3,03 s (429-svaret tog 726 ms) | ~2,3 s efter vinduet blev sat |
| CI retry | 2,42 s | ~2,4 s efter vinduet blev sat |
| Lokalt (5x) | 0,6-1,0 s | aldrig |

Vinduet sættes først når 429-svaret er læst, så CI's langsomme svar-tid (mock-routen
tog 500-700 ms på runneren) skubbede ikke vinduet nok. Runneren brugte simpelthen
over 2 s på to profil-navigationer med 4 parallelle workers. Ikke en produkt-bug,
ikke #5124-koden (rørte ingen af filerne), ikke generel CI-overbelastning (PR #5264
kørte grønt i samme minutter) — bare et tidsvindue der lå tæt på runnerens normale
elapsed-time.

## Reproduktion lokalt

`await page.waitForTimeout(2500)` før `ArrowLeft` i en kopi af specen → samme
`Received: 2`. Med vinduet hævet til 60 s → grøn. Begge kørt 5x.

## Fix

Mock-vinduet hævet fra 2 s til 60 s (`RETRY_AFTER_SECONDS` i specen). Testen venter
aldrig på udløb, så længden er gratis; den asserter kun at vinduet FINDES. Backendens
faktiske 2 s er allerede dækket af apiFetch's unit-suite med injiceret ur.

## Lektion

1. **En e2e-test der afhænger af et rigtigt ur-vindue skal bruge et vindue der er
   mindst 10x runnerens normale elapsed-time for scenariet**, eller et injiceret ur.
   "Samme værdi som produktion" er ikke et argument når længden ikke er under test.
2. **Trace-artefaktet svarer på timing-spørgsmål på 5 minutter.** `gh run download
   <run> -n playwright-report-<project>`, unzip `data/*.zip`, læs `0-trace.network`s
   `startedDateTime` pr. request. Ingen gætteri om "CI er langsom".
3. **Reproducér CI-langsomhed lokalt med en eksplicit pause** før du fixer — så er
   fixet bevist, ikke antaget.

Se også: `2026-06-14-ci-only-flake-read-full-log-before-fixing.md`,
`2026-08-07-night-wave-parallel-e2e-contention.md`.
