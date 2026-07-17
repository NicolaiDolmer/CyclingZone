# Postmortem · 2026-07-16 · Onboarding-progress-kortet spammede etablerede spillere (#2439)

## Hvad skete der?
Ejer + 1 spiller rapporterede at "Kom i gang"-onboarding-modulet på Dashboardet
(bygget i #2288/#2296) blev ved med at dukke op, selv efter gentagne
afvisninger — "spammer mig komplet".

## Root cause
`OnboardingProgressCard`s dismiss blev bevidst gemt i `sessionStorage`
(#1569 — for at et fejlklik ved 0/4 trin ikke skulle dræbe den eneste
onboarding-guide permanent). Men de 4 trin i `GET /api/me/onboarding-progress`
(`first_bid_placed`/`first_training_run`/`first_squad_selected`/
`board_plan_set`) er ægte spillerhandlinger en veteran sagtens kan gå hele
sæsoner uden at ramme (fx altid squad-auto-fill, aldrig en manuel
board-forhandling) — `completed_count` når derfor aldrig `total_count`.
Kombinationen "aldrig 4/4" + "dismiss nulstiller sig selv ved hver ny
fane/browser-genstart/enhed" gav et kort der reelt var permanent for en
etableret spiller, uanset hvor mange gange de klikkede ×.

## Fix
- `database/2026-07-16-onboarding-progress-dismiss-persist.sql`: ny kolonne
  `teams.onboarding_progress_dismissed_at` (committes, anvendes af ejer
  post-merge — aldrig auto-apply).
- `backend/routes/api.js`: `GET /me/onboarding-progress` returnerer nu
  `dismissed` (fra kolonnen) og `established` (fra en ny
  `isEstablishedTeam()`-heuristik: hold ældre end 14 dage, uafhængigt af
  step-completion). Ny `POST /me/onboarding-progress/dismiss` persisterer
  dismiss server-side, med graceful degradation (42703) hvis migrationen
  ikke er anvendt endnu — samme mønster som
  `riders.peak_suggestions_dismissed_season_id` (#2455).
- `frontend/src/pages/DashboardPage.jsx`: `dismissOnboarding()` kalder nu det
  nye endpoint (sessionStorage beholdes kun som optimistisk øjeblikkelig
  UI-state før server-svaret er hentet). Progress-fetch'en sætter
  `onboardingDismissed=true` hvis serveren siger `dismissed` eller
  `established`, uden krav om et nyt klik.

## Forhindret-fremover
- `backend/lib/dashboardUxPakke.routes.test.js`: kildekode-scan-tests på
  `dismissed`/`established`-feltet, `isEstablishedTeam()`, og
  42703-graceful-degradation i dismiss-endpointet.
- `frontend/src/pages/DashboardPage.onboardingServerPersist.test.js`: guard på
  at dismiss rent faktisk kalder server-endpointet, og at
  `prog.dismissed || prog.established` overstyrer lokal state.

## Læring
En "session-scoped dismiss for at beskytte mod fejlklik"-beslutning
(#1569) var korrekt isoleret set, men blev en spam-bug i kombination med en
completion-betingelse (4 specifikke handlinger) der reelt ALDRIG bliver sand
for en betydelig del af den etablerede spillerbase. Når en UI-tilstand er
"dismiss indtil X er sandt", skal man enten garantere at X til sidst bliver
sandt for enhver bruger, eller give dismiss en permanent (server-persisteret)
vej ud — ellers akkumuleres irritationen for netop de brugere man mindst vil
genere (veteraner).
