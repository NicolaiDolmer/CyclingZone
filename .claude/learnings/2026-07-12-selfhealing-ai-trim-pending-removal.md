Postmortem · 2026-07-12 · Selvhelende AI-trim ved signup (#2187)

## Hvad skete der?
Puljer skulle holdes på PRÆCIS 24 hold (ejer-krav), men Division 4 B og C endte
på 26 hold hver — 2 AI-fyld-hold for meget pr. gruppe. Symptomet var kendt siden
#2187 (11/7): backend-loggen viste "AI-fyld-trim FEJLEDE" ved signup, men trimmet
kom aldrig igennem senere.

## Root cause
`removeAiTeams` (backend/lib/aiTeamGenerator.js) forsøger at slette ét overskuds-
AI-hold når et nyt ægte hold rykker ind i en pulje. Er AI-holdets ryttere i et
IGANGVÆRENDE etapeløb (låst felt, `block_rider_delete_with_inflight_entries`-
guarden fra #2074), kan holdet ikke hard-slettes. #2269 (10/7) gjorde dette
sikkert: blokerede kandidater springes over i stedet for at kaste en exception —
men intet huskede at et trim stod tilbage. Næste chance for at fuldføre trimmet
var et HELT NYT signup i SAMME pulje, hvilket ofte aldrig sker — så puljen blev
hængende over target permanent, uden fejl, uden alarm.

## Fix
1. `database/2026-07-12-ai-team-pending-removal.sql` — ny kolonne
   `teams.pending_removal_at` (nullable timestamptz) + partial index.
2. `backend/lib/aiTeamGenerator.js` — `removeAiTeams` markerer nu blokerede
   kandidater med `pending_removal_at` (IS NULL-guard bevarer det oprindelige
   udskydelses-tidspunkt, idempotent ved gentagne forsøg). Nye eksporterede
   helpers (`teamHasInflightEntries`, `getInflightRaceIds`, `deleteAiTeamById`)
   deles med heal-sweepen.
3. `backend/lib/aiTeamTrimHealSweep.js` (ny) — periodisk sweep (5-min-kadence,
   samme mønster som academyHealSweep/starterSquadHealSweep) der finder alle
   `pending_removal_at NOT NULL`-AI-hold, re-tjekker om det blokerende løb er
   færdigt, og fuldfører sletningen hvis muligt. Persistente udskydelser (>48t)
   rapporteres som "stale" og Sentry-alarmeres i cron-wrapperen
   (`backend/cron.js: runAiTeamTrimHealSweepCron`).
4. Reparation af de 9 eksisterende overskudshold (Division 1, 3A-D, 4B/C) er
   BEVIDST separat (#2377, ejer-go krævet — destruktiv) og genbruger denne
   samme kodesti (`deleteAiTeamById`/heal-sweep), ikke en ad hoc-kørsel.

## Forhindret-fremover
Den periodiske heal-sweep gør invarianten selvhelende: uanset hvor længe et
etapeløb varer, retryer sweepen hver 5. minut indtil løbet er completed. Et
strukturelt problem (fx en race-scheduler der er gået i stå) opdages inden for
48 timer via Sentry, i stedet for at forblive et tavst, permanent afvig. #2377's
kommende natlige invariant-guard (count(teams) pr. pulje ≠ 24 → alert) er et
uafhængigt andet lag, ikke en erstatning for denne selvhelende sti.

## Læring
"Skip blokeret kandidat + log en advarsel" er IKKE selvhelende alene — uden en
persisteret markør + en uafhængig retry-mekanisme (cron, ikke "næste gang nogen
rører puljen") kan et udskudt stykke arbejde blive hængende for evigt uden at
nogen fejl nogensinde kastes. Mønsteret fra #1563/#1584 (marker-kolonne +
alders-gatet heal-sweep) er det rigtige svar hver gang et signup-tidspunkt-
bundet sidesteff kan fejle delvist og ikke selv kan re-triggeres af brugeren.
