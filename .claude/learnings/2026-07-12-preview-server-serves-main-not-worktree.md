# Preview-server serverer main-checkout, ikke worktreet

**Dato:** 2026-07-12 · **Kontekst:** v3 S4 (#1176), Worker C skulle UI-verificere i worktree `feat-1176-race-v3-s4-ui`.

## Problem
`preview_start` med launch-config (`frontend-mock` fra `.claude/launch.json`) starter dev-serveren fra **main-repoets** checkout (`C:\Dev\CyclingZone`), ikke fra det worktree sessionen/agenten arbejder i. UI-ændringer der kun findes i worktreet er dermed usynlige i previewet — man verificerer stiltiende den FORKERTE kode.

## Fix/workaround
I worktree-baserede UI-sessioner: start Vite manuelt fra worktreets `frontend/` (`npx vite --port <ledig>` med `VITE_PREVIEW_MOCK` efter behov) og luk den efter verifikation. Brug ikke launch-config-navnet.

## Læring
Verificér ALTID hvilken kodebase en kørende dev-server faktisk serverer (fx ved at ændre en synlig streng i worktreet og se om den slår igennem) før UI-verifikation tæller som bevis. Rod-årsag (launch.json er sti-bundet til main-repoet) kan evt. løses med et worktree-aware launch-script — ikke gjort endnu.
