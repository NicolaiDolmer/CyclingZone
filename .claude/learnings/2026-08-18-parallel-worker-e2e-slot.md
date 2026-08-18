# Parallelle frontend-workers maa ikke hver koere fuld lokal e2e-suite

**Dato:** 2026-08-18 (KS3) · **Ejer-mandat:** maa ikke gentages

## Hvad skete

KS3 spawnede 9 samtidige workers i worktrees paa een PC. De 7 frontend-workers fulgte
hver isaer CLAUDE.md's TIER FULL-regel og startede den fulde lokale e2e-suite
(513 tests x 3 Playwright-projekter, 20-40 min alene). Samtidigt = de serialiserede
paa CPU'en, saa ALLE workers blev timevis forsinkede. Ejeren maatte spoerge hvorfor
sessionen var langsom, foer orkestratoren omdirigerede.

## Rod-aarsag

TIER FULL-reglen er skrevet for EEN session ad gangen. Ved parallel-orkestrering
multiplicerer den: N workers x fuld suite paa samme maskine er N gange spild, fordi
CI alligevel koerer fuld suite paa hver PR. KS2 havde allerede loesningen (orkestrator
ejer det serielle e2e-slot, jf. PR #3921's Fravalg), men den stod ikke som regel,
saa KS3's spawn-prompter arvede den ikke.

## Forward-guard

- AGENTS.md hard rule 24 (tilfoejet 18/8): orkestratoren tildeler verifikations-
  niveauet i SPAWN-prompten; parallelle frontend-workers koerer unit+lint+i18n+
  verify-affected+build+screenshots, aldrig fuld lokal suite; max 3 samtidige tunge
  frontend-workers; CI baerer fuld suite.
- Auto-memory opdateret saa fremtidige orkestrerings-sessioner skriver slottet ind
  i spawn-prompterne fra start.

## Relateret

Hard rule 21 (per-agent-timeout dimensioneres efter samtidighed) er samme fejlklasse
fra natboelge XL samme dag: ressource-regler skal skaleres med samtidighed.
