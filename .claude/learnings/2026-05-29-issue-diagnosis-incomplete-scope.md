# Postmortem · 2026-05-29 · Issue-diagnose undervurderede scope (PatchNotes-kronologi)

## Hvad skete der?
#761 (follow-up på PR #531-auto-review) flaggede én inverteret PatchNotes-dato: `v3.75` (vist 2026-05-21) var nyere end `v3.76` (vist 2026-05-20). Acceptance-kriteriet var "ret v3.75 så kronologi er monoton". At rette kun v3.75 ville have efterladt to nye inversioner.

## Root cause
Issue-diagnosen kiggede kun på `v3.76`/`v3.75`-paret. Den fulde nabolags-sekvens havde **tre** forkerte vist-datoer ift. faktiske git-commit-tidsstempler:
- `v3.76` vist 05-20, faktisk committet 05-21 00:03 (re-apply PR #531)
- `v3.75` vist 05-21, faktisk committet 05-20 23:08 (rollback)
- `v3.73` vist 05-21, faktisk committet 05-20
At rette kun v3.75 → 05-20 ville stadig efterlade `v3.73 = 05-21` nyere end versionerne over den.

## Fix
Verificerede vist-datoer mod faktiske commit-tidsstempler (`git log -S` + `git show -s --format=%ci`) i stedet for at stole på issue-scope. Rettede alle tre datoer → monoton: 05-21, 05-21, 05-20, 05-20, 05-20. Commit `01cee63` (PR #762). Også fund 1: null-guard i `AdminDataTab.handleImportResults`.

## Forhindret-fremover
Ved data-/kronologi-fix: verificér mod grundsandhed (her: git commit-tidsstempler), ikke kun de felter issue'et nævner. En enkelt-felt-rettelse til "monoton" skal valideres mod hele den lokale sekvens, ikke kun nabo-paret.

## Læring
Et issue beskriver et **symptom**, ikke nødvendigvis hele defektens omfang. Når et fix kræver en invariant (monotonicitet, unikhed, sortering), så tjek invarianten over hele det berørte vindue — ikke kun det punkt der blev rapporteret. Forstærker [[feedback_backwards_check_forward_guard]] + [[feedback_runtime_verify_first]].
