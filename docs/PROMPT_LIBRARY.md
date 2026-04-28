# PROMPT LIBRARY — Cycling Zone

## Effektiv session

Brug denne ved ny Codex/Claude-session for at holde kontekst og tokenforbrug nede:

```text
Fortsæt fra docs/NOW.md. Arbejd kun på [SLICE/DELOPGAVE].
Følg AGENTS.md og docs/GUARDRAILS.md.
Læs kun ekstra docs/filer når de er nødvendige for den konkrete runtime-path.
Implementér, kør målrettede tests, opdater kun relevante docs, og afslut med root cause, invariant, filer og tests.
```

Principper:
- Én session = én tydelig slice eller delopgave.
- Brug `docs/PRODUCT_BACKLOG.md` som samlet sandhed for ideer og plan, ikke chat-historik.
- Hold `docs/NOW.md` kort: aktiv slice, næste slice, blockers og vigtigste invariant.
- Start bred review kun ved risikable runtime-paths; simple bugs kan gå direkte til målrettet fix.
- Gruppér kun tæt relaterede fixes, fx transfer/window_pending samlet eller auction-regler samlet.
- Docs-only ændringer kræver normalt ikke testkørsel; backend runtime-fix kræver målrettet backend-test; frontend route/UI-fix kræver mindst build.

## Slice Prompt

```text
Fortsæt fra docs/NOW.md. Arbejd kun på [SLICE].
Mål: [kort mål].
In scope: [konkrete filer/runtime-paths].
Out of scope: [hvad der ikke må røres].
Forventet test: [målrettet test/build].
```

## Standard Task

Docs:
- docs/GUARDRAILS_CORE.md (altid)
- docs/NOW.md (altid)
- docs/GUARDRAILS.md (ved arkitekturvalg, datakontrakter, afklaringsgates)
- docs/DOMAIN_REFERENCE.md, ARCHITECTURE.md, FEATURE_STATUS.md, CONVENTIONS.md (ved behov)

Task Type:
Goal:
In Scope:
Out of Scope:
Task Lane: direkte implementerbar | investigation | kræver askuserquestion

Deliver:
1. Root cause
2. Fix
3. Files changed
4. Risks
5. Test cases
6. Docs to update

## Feature Brief

Mål:
Manager-værdi:
Berørt runtime-path:
Åbne beslutninger:
Anbefaling:
Task Lane: direkte implementerbar | investigation | kræver askuserquestion

## Slice Review

Lukket:
Blokerer stadig:
Nærliggende quick wins:
Næste sparringssession der bør låses:
