# Tone-guard scannede filen prosaen var flyttet FRA, ikke TIL

**Dato:** 2026-08-04 · **PR:** #3296 · **Refs:** #1172, #2108, #2060

## Hvad skete

`tone-check-em-dash.mjs` havde `frontend/src/pages/PatchNotesPage.jsx` i
PROSE_FILES. Refaktoreringen #2108/#2060 flyttede al patch-note-prosa til
`frontend/src/data/patchNotes.js` (siden renderer runtime-JSON), men guarden
fulgte ikke med. Resultat: guarden var groen i maanedsvis mens 79 entries
(100 em-dashes) akkumulerede sig i den fil der faktisk indeholdt prosaen.
Ingen alarm, for guarden scannede stadig "en fil der findes", bare en der
naesten ingen prosa har tilbage.

## Rod-aarsag

En path-baseret guard binder sig til en FIL, ikke til det INDHOLD den skal
beskytte. Naar indholdet flytter, bliver guarden stille-groen: den fejler
ikke, den mister bare sit scope. Refaktorerings-PR'en havde ingen grund til
at roere guard-scriptet, saa gap'et var usynligt i review.

## Laering / forward-guard

1. Ved refaktorering der FLYTTER indhold (prosa, config, data): grep efter
   den gamle sti i `scripts/` og CI-workflows, og flyt guards med i SAMME PR.
   `git grep -l "PatchNotesPage" scripts/` havde fanget dette paa 2 sekunder.
2. En guard der aldrig har fejlet paa en flade er ikke bevist virksom paa den
   flade. Ved onboarding af en ny fil i en guard: verificer foerst at guarden
   FANGER en kendt/syntetisk violation der (denne PR: 79 fund foer sweep =
   bevis paa bid; unit-test med syntetisk em-dash fastholder det).
3. Scanner-mekanisme skal matche filformatet: line-regex-prosascanneren kan
   ikke haandtere escapede anfoerselstegn i JSON-agtige bodies; datamoduler
   scannes som datastruktur (dynamic import + rekursiv walk), ikke som tekst.
