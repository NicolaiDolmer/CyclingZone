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

## Required pre-code check

Læs altid:
1. `docs/RUNTIME_GUARDRAILS.md`
2. `docs/NOW.md`

Verificér før coding:
- frontend callsite
- backend route
- shared engine eller service
- database contract
- canonical execution path

Hvis kontrakten ikke kan verificeres:
- skift task type til `investigation`
- stop før kodeændringer

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
- Kør `npm run sync-docs`
