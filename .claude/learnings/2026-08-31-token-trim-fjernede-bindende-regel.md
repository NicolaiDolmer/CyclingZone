# Token-trim af CLAUDE.md fjernede en bindende regel, ikke bare en begrundelse

Dato: 2026-08-31 (Europe/Copenhagen) · Issue: #2682 · PR: #4461

## Symptom

Et trim af CLAUDE.md (1.999 -> 1.460 tok) blev committet med beskeden "detaljerne er flyttet,
ikke reglerne" og en PR-body der påstod "ingen regel er fjernet". En adversarisk review fandt
det modsatte: TIER FULL-kravet (backend, delte lib-hooks, i18n, config eller >6 filer kræver
fuld lokal testsuite før push) var forsvundet ud af den auto-loadede fil og overlevede kun i
`docs/AI_OPS_REFERENCE.md`, som kun læses on-demand. Samme gjaldt "kør ALLE 3 playwright-projekter
ved snapshot-refresh" (#536) og de bindende page-template-værdier.

Konsekvensen var ikke teoretisk: nyt trin 4 nævnte kun `frontend/`, så en agent med en ren
backend-PR kunne læse hele CLAUDE.md og finde nul lokal test-forpligtelse der gjaldt ham.

## Rod-årsag

To ting, ikke én.

1. **Ingen skelnen mellem regel og begrundelse under trimmet.** Alt der stod efter et krav blev
   behandlet som "detalje der kan flyttes". Men "TIER FULL kræver fuld lokal suite" ER kravet;
   "fordi Vite tilgiver extensionless imports og Node's ESM-loader ikke gør" er begrundelsen.
   Kun det sidste må flytte til en WARM-doc.
2. **Ingen guard der kunne opdage det.** Token-gaten målte kun størrelse. En trim kunne købe
   tokens ved at slette et krav, og gaten blev grønnere af det. Guarden belønnede altså præcis
   den fejl den skulle forhindre.

Sideløbende fandt reviewet at gaten heller ikke var deterministisk: `Get-ApproxTokens` delte
råtegn med 4, og med `core.autocrlf=true` tæller hvert CR med. Samme `docs/NOW.md` målte 1193 tok
(WARN) i et LF-checkout og 1203 tok (FAIL) i et CRLF-worktree uden at indholdet var ændret. To
agenter kunne dermed rapportere modsatrettet gate-status for identisk indhold, og en agent der
"løste" et FAIL ville trimme indhold væk uden reel overskridelse.

## Fix

- TIER FULL-kravet og playwright-3-projekter skrevet tilbage i CLAUDE.md trin 4.
- Page-templates bindende værdier (T1/T2/T3-bredder, én gold primary, hairlines, 5px radius,
  tabular figures, stroke-ikoner aldrig emoji) og artboard-stien skrevet tilbage.
- "Bruger lukker selv" genindsat i close-out trin 1, så CLAUDE.md, `GITHUB_WORKFLOW.md` og
  canary #6 igen siger det samme.
- Artboard-stien tilføjet til `docs/design/PAGE_TEMPLATES.md`, så pointeren ikke kun bor ét sted.
- `Get-ApproxTokens` normaliserer CRLF -> LF før divisionen.
- Fail-tærskel 2000 -> 1750 (ikke 1700): reglerne skulle tilbage, så det reelle gulv er ~1.566.

## Forward-guard

Ny vagt `claude-md-required-rules` i `scripts/check-agent-token-hygiene.ps1`: en liste af korte
ankre for de bindende regler i CLAUDE.md. Mangler ét af dem, `exit 1`'er scriptet - og det
script er obligatorisk ved close-out. Ankrene er bevidst korte nøgleord (`TIER FULL`,
`guard-commit-branch`, `PAGE_TEMPLATES.md`, ...) og ikke hele sætninger, så en omskrivning må
passere, mens en sletning fejler.

Verificeret ved at fjerne `TIER FULL` fra filen: `1 fail`, exit 1. Gendannet: `0 fail`, exit 0.

## Læring

Når du trimmer en auto-loadet fil, så klassificér HVER fjernet sætning eksplicit som REGEL eller
BEGRUNDELSE, før du sletter den. En regel må kun flytte til en on-demand-doc hvis den fil er
obligatorisk læsning for netop den situation reglen gælder - ellers har du fjernet den.

Og: en størrelses-gate uden en indholds-gate presser i den forkerte retning. Den gør det billigt
at slette et krav og dyrt at beholde det.
