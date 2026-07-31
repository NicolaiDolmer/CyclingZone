# "REQUIRED"-kommentar i workflow ≠ håndhævet i branch protection

**Dato:** 2026-07-31
**Kontekst:** Alle 4 Dependabot-PR'er (#3160-#3163) røde på `error-code-coverage`.

## Symptom
Dependabot-PR'erne fejlede på et check de ikke selv havde rørt. Rod-årsag: #3159
(Pro-abonnement) tilføjede 3 backend-errorCodes (`terms_not_accepted`,
`terms_version_mismatch`, `no_subscription`) uden en+da-nøgler i `errors.json`
— og blev merget 30/7 kl. 15:41 **med rød `error-code-coverage`** (fejlet 15:23).
Main var derfor latent rød; første efterfølgende PR'er arvede fejlen.

## Rod-årsag
`error-code-coverage`-jobbet har kommentaren "REQUIRED (Refs #2848)" i
`i18n-check.yml`, men checket var aldrig tilføjet til branch protections
`required_status_checks`. En kommentar håndhæver ingenting — GitHub tillod
merge med rødt check. Samme gap fandtes for `terrain-coverage` (#2896).

## Fix
1. #3165: de 3 manglende nøgler tilføjet (en+da) → main grøn igen.
2. Forward-guard: `error-code-coverage` + `terrain-coverage` tilføjet til
   required checks via `gh api .../protection/required_status_checks/contexts`.

## Læring
- Når en workflow-kommentar siger REQUIRED: verificér mod
  `gh api repos/{repo}/branches/main/protection/required_status_checks --jq '.contexts'`
  — kommentaren er dokumentation, ikke enforcement.
- Nye guard-jobs skal tilføjes BÅDE i workflow OG i branch protection i samme PR/close-out.
- Diagnostik-genvej: fejler flere uafhængige PR'er på samme check med samme
  fejltekst, er main selv rød — reproducer guarden lokalt på main før du rører PR'erne.
