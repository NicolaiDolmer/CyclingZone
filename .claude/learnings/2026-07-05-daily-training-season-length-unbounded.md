# Postmortem · 2026-07-05 · Trænings-kalibreringsgate + ingen fast sæsonlængde

## Hvad skete der?
Trænings-kalibreringsgaten (godkendt 12/6) validerede ikke det system der rent
faktisk kører i prod — 3 huller (manglende `potentiale`-param, 28 sim-dage vs.
~60 reelle, intet akademi-kohorte-segment). Da gaten blev fixet (#2082), viste
det korrekte scorecard at akademi-ryttere lukker deres ungdomsloft-gap 5-7×
for hurtigt (78% efter sæson 1 mod ejerens mål ~50% efter 5-7 sæsoner) — samme
problem som en uafhængig Discord-bug-rapport (#1938, +4 i klatring på én
session).

## Root cause
To lag af årsager:
1. **Harness-bug**: `previewDailyTraining.js` kaldte `applyDailyTick` uden
   `potentiale` og brugte `daysPerSeason` (28, en race-kalender-batch-konstant)
   som antal simulerede dage — begge dele underkørte den simulerede vækst.
2. **Strukturel prod-bug**: `dailyTrainingEngine.js` brugte livstids-loftet
   (`ability_caps`) direkte som daglig tick-grænse med en dage-baseret rate.
   Sæsonlængde er IKKE en fast konstant nogen steder i kodebasen — transfer-
   vinduet lukkes administrativt (`closes_at` + readiness-gates), ikke efter
   et fast dagtal. Sæson 1 var stadig åben efter 57+ dage. Enhver dage-baseret
   rate-konstant ville derfor blive forkert igen næste gang en sæson kørte
   længe — "bare ret tallet til 60" var IKKE en robust fix.

Undervejs fandt jeg også en tredje, selvstændig metrik-bug i mit eget
scorecard: aggregate-niveau clamp (`max(0, sum(caps)-sum(abilities))`) skjulte
negative bidrag fra off-type-evner der allerede lå over deres lave ungdomsloft
ved baseline, hvilket overdrev gap-lukket% og droppede ryttere via et
`initialGap<=0`-filter.

## Fix
- Harness: `backend/scripts/previewDailyTraining.js` (PR #2200, #2201).
- Prod-motor: sæson-budget-loft (mætter ved sæsonens andel af gappet, afkoblet
  fra sæsonlængde) + dedikeret aftagende akademi-rate (0.16→0.11→0.08 v/alder,
  i stedet for den almindelige voksen-rate 0.35) + hård dags-cap (+1/evne/dag).
  `backend/lib/{academyFlag,dailyTraining,dailyTrainingEngine}.js` + migration
  `database/2026-07-05-daily-training-season-budget-cap.sql` (PR #2202).

## Forhindret-fremover
- Ny test i `dailyTrainingEngine.test.js`: "væksten mætter ved sæson-loftet —
  rammer ALDRIG livstids-loftet selv efter mange dage" (90 simulerede dage) —
  forward-guard mod at nogen fjerner sæson-budget-cap'et igen uden at
  opdage det via en fejlende test.
- Sim-harness (`previewDailyTraining.js`) har nu et dedikeret akademi-scorecard
  der bruger REEL potentiale + reel (parametriserbar) sæsonlængde — enhver
  fremtidig trænings-rekalibrering bør køre den før ship.

## Læring
Antag ALDRIG at en "sæsonlængde" eller lignende tidsbestemt spilbegreb er en
fast konstant, bare fordi koden har en konstant der HEDDER noget lignende
(`daysPerSeason`) — verificér mod den faktiske kalender-/transition-logik.
Her viste `daysPerSeason=28` sig at være en race-kalender-batch-størrelse,
genbrugt som rate-divisor et andet sted i kodebasen, med et helt andet formål
end navnet antydede. Når en spil-mekanik er admin-/livs-styret og uden fast
varighed (sæsonlængde, auktions-vinduer, etc.), skal balance-systemer der
afhænger af "hvor lang tid er der gået" designes til at MÆTTE ved en andel af
et mål i stedet for at løbe med en fast dage-baseret rate — ellers akkumuleres
fejlen ubegrænset jo længere den reelle periode varer.
