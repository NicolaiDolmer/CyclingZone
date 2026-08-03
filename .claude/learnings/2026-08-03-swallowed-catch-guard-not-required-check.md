# Swallowed-catch-guard var rød på PR'en, men auto-merge ignorerede den

**Dato:** 2026-08-03 · **Refs:** #3203, PR #3238 (regression), PR #3257 (fix)

## Symptom
`swallowed-catch-guard` fejlede på main (push-CI på 11ec7bd9) og på alle
efterfølgende feature-branches (fx PR #3249): `backend/routes/api.js` havde
175 svaltede catches mod baseline 174.

## Root cause (to lag)
1. **Koden:** PR #3238 tilføjede `GET /api/club/staff/:id/scouting-history`
   med en catch (`res.status(500)` uden `captureException`/`throw`/markør).
   Guarden talte den korrekt som net-ny svaltet catch.
2. **Processen (den egentlige læring):** Guarden fejlede FAKTISK på PR #3238's
   egen CI. Men `swallowed-catch-guard` er ikke i main's required status
   checks, og GitHub auto-merge venter kun på required checks. Ejeren slog
   auto-merge til kl. 17:50 lokal tid, og PR'en blev merged to timer senere
   med rød guard. Guarden virkede; gaten var hullet.

## Fix
`captureException(e)` + 500 i catch'en (filens etablerede idiom, fx
`api.js:2518`). Ikke `// best-effort`: catch'en er routens primære fejlsti
(Supabase-query), så fejl skal være synlige i Sentry. PR #3257.

## Læring / forward-guard
- En ratchet-guard der ikke er required status check er kun en anbefaling
  under auto-merge. Alle lint-guards der skal kunne blokere merge, skal stå
  i branch-protection's required checks på main (ejer-beslutning, se
  opfølgnings-issue).
- Ved rød main-CI på en guard: tjek ALTID om den fejlende PR's egen CI også
  var rød. Var den det, er processen (required checks/auto-merge) en del af
  root cause, ikke kun koden.
