# Clarity dead-click-symptom ≠ den antagne årsag (#1421 Slice A)

**Dato:** 2026-06-16
**Issue/PR:** [#1421](https://github.com/NicolaiDolmer/CyclingZone/issues/1421) · [PR #1425](https://github.com/NicolaiDolmer/CyclingZone/pull/1425)

## Hvad skete

#1421 blev lavet fra ugentlig Clarity-triage og antog at rytter-navne/avatarer på
board/transfers var dead clicks fordi de **ikke var klikbare**. NOW.md forfinede det
til "mekanisk migration: gør rytter-navn/avatar klikbar". Den antagelse var forkert.

Verifikation mod kode + git-historik viste at **alle de relevante elementer allerede
var klikbare i hele Clarity-måleugen (09→16/6):**

| Flade | Element | Klikbar siden |
|---|---|---|
| riders | hele rytter-rækken → profil | #1029 (5/6) |
| board | bestyrelsesmedlemmer → dialog | #1030 (5/6) |
| transfers | rytter-navn → profil (`RiderLink`) | #177 (7/5) |

Den reelle årsag på transfers var **smalt hit-target**: kun navne-teksten linkede,
mens de store rytter-data-arealer (stats-grid, swap-celle) var døde. board/riders
krævede ingen ændring.

## Lærdom

Et aggregeret analytics-symptom (Clarity dead/rage clicks pr. flade) fortæller dig
**hvor** brugeren klikker forgæves — ikke **hvorfor**. "Dead click på rytter-navn"
≠ "rytter-navn er ikke klikbart". Mulige årsager: smalt hit-target, race/null-id der
falder tilbage til ikke-klikbar `<span>`, eller et helt andet element i nærheden.

## Forebyggelse (forward-guard)

Ved analytics-drevne (Clarity/Sentry-aggregat) issues, FØR scope-lås:
1. Find elementet i koden og afgør om det allerede er interaktivt.
2. `git log -L` / blame på linjen → blev det klikbart **før eller efter** måleugen?
   Hvis før: symptomet har en anden årsag end "mangler handler".
3. Skeln symptom (dead click) fra antaget årsag i selve issue-scopet.

Hører under [[feedback_runtime_verify_first]] (verificér før claim) — her konkret:
verificér element-tilstand + ændringstidspunkt mod måleperioden, ikke kun aggregatet.
