# En sentinel-vaerdi der laekker til UI er en backend data-shaping-bug, ikke en frontend-rendering-bug

**Dato:** 2026-08-04 · **Issue:** #3107 · **PR:** fix/3107-race-day-display

## Hvad skete

Racehub-boardet viste "Race day 100000" for Monument-lob (klassikere) i stedet for enten
et rigtigt dagsnummer eller slet intet maerke.

## Rodaarsag

`raceGameDaySpan` (backend/lib/raceBinding.js) afleder DISPLAY-maerket ("Race day N")
direkte fra `race_stage_schedule.game_day`. Monuments faar game_day i 100000-baandet
(MONUMENT_GAMEDAY_BASE, en bevidst lane-packer-sentinel til at holde dem uden for det
normale dags-gitter — IKKE en aegte in-game-dag). Funktionen havde allerede en
"skjul frem for at vise skrald"-guard for delvist-manglende game_day, men intet tjek
for sentinel-baandet, saa 100000 (et perfekt finite tal) sivede lige igennem.

Frontend-koden (RaceColumn.jsx + RaceHubBoard.jsx) er faktisk korrekt: begge steder
gaar allerede `Number.isFinite(gd) ? ... : null` — men et sentinel-TAL ER finite, saa
den defensive kode kunne ikke fange dette. Fixet hoerer derfor 100% hjemme i backend'et,
selvom symptomet er 100% visuelt.

## Laeringer

1. **"UI viser et forkert tal" er ikke automatisk en frontend-bug.** Foelg tallet til
   kilden foer du antager hvilket lag der skal aendres — her var det tempting at patch'e
   frontend'en (endnu et `gd >= 100000 ? null : gd`-tjek dér), men det ville have
   duplikeret domaeneviden (sentinel-baandets betydning) der allerede findes ÉT sted i
   raceBinding.js, og risikere at et andet forbrugssted af samme felt glemmer samme tjek.
2. **En "skjul i stedet for at vise skrald"-guard skal opdateres NAAR domaenet faar en ny
   sentinel-klasse.** raceGameDaySpan's null-for-delvist-manglende-guard var korrekt
   engang, men blev ufuldstaendig da MONUMENT_GAMEDAY_BASE blev indfoert (#3114/#3119,
   3/8) — ingen af de to (relaterede) fixes touchede DENNE funktion.
3. **Til VISNING boer man vaere strengere end til BINDING.** isMonumentBandSchedule
   (bruges af binding-vinduer) kraever at ALLE raekker er i baandet; raceGameDaySpan
   tjekker i stedet om NOGEN raekke er >= MONUMENT_GAMEDAY_BASE, saa et hypotetisk
   blandet/korrupt lob aldrig kan vise et "Race days 3-100000"-vindue. Konsekvensen af
   at skjule for meget er kosmetisk (intet maerke); konsekvensen af at vise for meget er
   synligt skrald i produktion.

## Forward-guards

- 3 nye unit-tests i raceBinding.test.js: rent monument-baand, blandet baand (defensiv),
  eksisterende "en raekke uden game_day"-test uroert.
- Foer/efter-screenshot (preview-mock, DA-locale) viser bagen faktisk forsvinder begge
  steder (gruppe-header i RaceHubBoard.jsx OG per-kort-badge i RaceColumn.jsx) uden
  nogen frontend-aendring — bekraefter at rodaarsagen VAR backend-laget.
