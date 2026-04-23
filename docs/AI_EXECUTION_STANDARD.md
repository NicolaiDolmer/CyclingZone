# AI EXECUTION STANDARD — Cycling Zone

_Formål: Give en fast arbejdsform uden at duplikere regler fra `RUNTIME_GUARDRAILS.md`._

## Task types

- bugfix
- small_feature
- refactor_safe
- investigation
- docs_update_only

## Task envelope

Task Type:
Goal:
In Scope:
Out of Scope:

Source of Truth:
- docs/RUNTIME_GUARDRAILS.md
- docs/NOW.md
- docs/DOMAIN_REFERENCE.md (kun hvis relevant)
- docs/ARCHITECTURE.md (kun hvis relevant)
- docs/FEATURE_STATUS.md (kun hvis relevant)
- docs/CONVENTIONS.md (kun hvis relevant)
- docs/TEST_SCENARIOS.md (kun hvis relevant for verifikation)
- docs/DEPLOYMENT.md (kun hvis deployment eller live-verifikation er relevant)

## Roadmap-first samarbejde

- `docs/PRODUCT_BACKLOG.md` er kanonisk roadmap og backlog for større slices
- `docs/NOW.md` holdes kort: aktiv slice, næste slice og aktuelle blockers
- Nye ideer går i backloggen som kandidater; de må ikke springe foran aktiv slice uden en tydelig runtime- eller produktgrund
- Feature-briefs, sparring og afklaringssessioner drives i chatten, mens docs bevarer roadmap og status

## Task shaping før execution

Start hver ny opgave med en kort feature-brief i chatten:
- mål
- manager-værdi
- berørt runtime-path
- åbne beslutninger
- anbefalet retning
- hvad der evt. behøves fra brugeren

Klassificer opgaven før coding:
- `direkte implementerbar`
- `investigation`
- `kræver askuserquestion`

Hvis opgaven ikke er `direkte implementerbar`, sig hvorfor og stop før kodeændringer.

## Required pre-code check

Læs altid:
1. `docs/RUNTIME_GUARDRAILS.md`
2. `docs/NOW.md`

Verificér først workspace:
- git-root/worktree kan bekræftes
- aktiv arbejdsmappe er den tilsigtede repo og ikke en kopi/zip-udpakning/sync-mappe uden `.git`
- hvis dette ikke kan bekræftes, stop og afklar korrekt repo-root før videre analyse eller kode

Verificér før coding:
- frontend callsite
- backend route
- shared engine eller service
- database contract
- canonical execution path

Hvis kontrakten ikke kan verificeres:
- skift task type til `investigation`
- stop før kodeændringer

## Askuserquestion gates

Tag som udgangspunkt en afklaringssession ved:
- informationsarkitektur, naming eller andre IA-valg
- features med flere plausible produktmodeller
- nye datakontrakter, integrationer eller nye offentlige visninger
- balancing-/økonomi-ændringer med fairness-konsekvens

Tag normalt ikke en afklaringssession ved:
- afgrænsede bugfixes med tydelig spec
- reproduktioner og runtime-investigations uden produktvalg

Eskalér alligevel hvis runtimeen viser drift mellem frontend, API, engine/service og DB, eller hvis en lille opgave viser sig at ændre regler eller semantik.

## Discipline

- Brug kun en task type ad gangen
- Hold scope lille og domæneafgrænset
- Stop efter minimal safe fix ved `bugfix`
- Følg `docs/RUNTIME_GUARDRAILS.md` for guardrails, invariants, stop conditions og deliverables

## Before coding

1. Root cause
2. State transitions
3. Edge cases
4. Minimal safe fix

## After

- Opdater relevante current docs hvis runtime-sandheden eller arbejdssituationen er ændret
- Ved enhver brugerrettet feature eller adfærdsændring: opdater `frontend/src/pages/PatchNotesPage.jsx`
- Hvis ændringen påvirker regler, flows, FAQ, onboarding eller noget en manager/admin skal vide for at bruge systemet korrekt: opdater `frontend/src/pages/HelpPage.jsx`
- Hvis `HelpPage.jsx` ikke opdateres ved en feature-ændring, skriv eksplicit hvorfor den ikke er relevant
- Kør `npm run sync-docs`
- Behandl `npm run sync-docs` som en manuel checklist/prompt; scriptet opdaterer ikke docs automatisk

## Slice close-out

Ved slutningen af en slice, rapportér kort:
- hvad blev lukket
- hvad blokerer stadig
- hvilke nærliggende quick wins eller featureforslag dukkede op
- hvilken næste sparringssession der bør låses
