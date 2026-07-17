# Postmortem · 2026-07-17 · race_days_completed/race_days_total i forskellige enheder — renegotiation-lås permanent aktiv

## Hvad skete der?
`getBoardRenegotiationLock` (`backend/lib/boardRequests.js`) sammenlignede
`seasons.race_days_completed` og `seasons.race_days_total` som samme enhed
for at beregne `raceDaysLeft = total - completed`. I prod (16/7):
`race_days_completed=524` mod `race_days_total=60` → `raceDaysLeft = -464` →
"slutfase"-låsen (WINDOW-lock, ≤5 dage tilbage) permanent aktiv, uanset
faktiske løbsdage tilbage. `POST /board/renew` og `/board/sign` svarede 409
for alle spillere. `boardMidSeason`-midpointet (`floor(total/2)`) blev
tilsvarende krydset kunstigt tidligt (dag 2 i stedet for midt i sæsonen).

## Root cause
Enheds-mismatch mellem de to felter, ikke en fejl i selve lock-logikken.
`race_days_completed` blev skrevet af `recomputeSeasonRaceDays`
(`backend/lib/seasonRaceDays.js`, #804) som `SUM(stages)` over ALLE
completede løb på tværs af ALLE divisioner — med flere divisioner der
afvikler løb parallelt voksede den ~20+/dag. `race_days_total` var derimod
et manuelt admin-tal (default 60) sat FØR sæson-kalenderen eksisterede
(`POST /admin/seasons`). To tal i to forskellige skalaer, aldrig
genforenet, indtil forbrugere begyndte at trække dem fra hinanden.

Beslægtet: `.claude/learnings/2026-07-16-board-auto-accept-unit-mismatch.md`
fixede samme underliggende enheds-bug i `boardAutoAccept.js` (erstattede med
et per-plan kalenderdags-ur) og flaggede eksplicit renegotiation-lock +
boardMidSeason som "kendt følgearbejde, ikke fixet her".

## Fix
Reparerede KILDEN i stedet for hver forbruger (#2512-beslutning): ét race
day = én distinkt `races.game_day_start`-værdi i sæsonens kalender.
`recomputeSeasonRaceDays` (`backend/lib/seasonRaceDays.js`) skriver nu BEGGE
felter fra samme sandhed — `race_days_completed` = distinkte
`game_day_start` blandt completede løb, `race_days_total` = distinkte
`game_day_start` blandt ALLE løb i kalenderen (~27-28 i prod sæson 1, ikke
det gamle 60-gæt). Idempotent, selv-helende ved enhver resultat-import.
`getBoardRenegotiationLock` og `boardMidSeason` er urørte — de fik den
rigtige enhed gratis, fordi begge felter nu er konsistente.

Backfill: `database/2026-07-17-2512-race-days-backfill.sql` (committet,
IKKE anvendt automatisk — ejeren kører den manuelt mod prod efter merge).
Read-only verifikation mod prod (Supabase MCP, 17/7) bekræftede queryen:
nuværende `524/60` → ville blive `18/28` efter backfill (10 kalenderdage
tilbage, 35.7% — hverken WINDOW- eller PROGRESS-lås ville trigge).

## Forhindret-fremover
`backend/lib/seasonRaceDays.test.js` dækker `countDistinctRaceDays` (parallelle
divisioner samme dag tæller som 1) + at `recomputeSeasonRaceDays` skriver begge
felter konsistent. `backend/lib/boardRenegotiationLock.test.js` har en
#2512-regressionstest: realistisk sæson-skala (~27-28 dage) låser IKKE tidligt
med mange dage tilbage, men låser korrekt ved ≤5 reelle dage tilbage — samt en
test der dokumenterer at den GAMLE bug-signatur (524/60) stadig ville låse,
hvis nogen nogensinde fodrer funktionen med den forkerte skala igen (fixet er i
kilden, ikke i guarden selv).

## Læring
Et par tæller/total-felter i samme tabel er kun "samme enhed" hvis SAMME kilde
skriver begge fra samme sandhed. Her drev de to felter fra hinanden fordi
`race_days_completed` blev auto-genberegnet ved hver resultat-import mens
`race_days_total` forblev et engangs-admin-input fra før kalenderen fandtes.
Fix forbrugeren (boardAutoAccept, #2463) løser ÉN symptom; fix kilden
(seasonRaceDays.js, #2512) løser dem alle på én gang og forhindrer at næste
forbruger rammer samme fælde ureflekteret.
