# Partiel game_day-migration: bræt-binding vs save-guard divergerede

**Dato:** 2026-07-05 · **Issues:** #1984, #2195 · **PR:** #2205 (merged 4b12f552)

## Symptom
Spillere (friisisch, thelamba, zootne) så to løb på samme rigtige eftermiddag hvor de samme ryttere måtte bruges begge steder, kunne ikke skelne intended overlap fra bug, og oplevede at brættet viste en rytter som låst/overlappende selv om gem tillod genbrug.

## Rod-årsag
Kalender-rebuilden (2026-06-27) flyttede rytter-binding fra CET-kalenderdag til **in-game `game_day`**. Save-guarden (`loadTeamBindingContext`, PUT `/selection`) blev migreret korrekt — men **tre read/preview-stier blev ikke migreret med:**
- `GET /races/distribution` (display-bræt)
- `POST /races/distribution/regenerate` (autofill)
- `POST /races/strategy/preview`

Alle tre loadede schedule via `fetchAllScheduleRows` (kun `scheduled_at`, **uden `game_day`**), så `raceBindingWindow` faldt til `useGameDay=false` → CET-kalenderdag-ordinaler. To løb på samme CET-dato men forskellige `game_day` blev derfor regnet som overlappende → falsk-positiv lås på brættet og over-begrænset autofill, i modstrid med save-guarden. En **delvis migration** hvor mutations-stien og read-stierne endte i to forskellige nøgle-rum.

## Fix
Alle tre stier loader nu `fetchAllScheduleRowsWithGameDay` → binding i samme `game_day`-rum som save-guarden. Plus display-felter (`game_day`/`game_day_end`) + frontend-læsbarhed (løbsdag-mærke, dag-gruppering, kompatibilitets-note, læringsnote).

## Læring / forward-guard
- **Når en binding-/nøgle-regel migreres, migrér ALLE stier der beregner den — ikke kun mutations-stien.** Read-, autofill- og preview-stier deler domæne-reglen og skal dele nøgle-rummet.
- Symptomet lignede "manglende etikette" (kosmetik), men rod-årsagen var en logik-divergens. **Backwards-check afslørede 3 forekomster, ikke 1** — hold fast i "find alle forekomster" før du kalder et UX-issue kosmetisk.
- To funktioner (`fetchAllScheduleRows` vs `fetchAllScheduleRowsWithGameDay`) hvor den "lette" variant udelader det binding-kritiske felt er en fælde: den lette blev valgt som default i nye handlers. Overvej at gøre `game_day` til standard i schedule-loaderen, så binding aldrig kan komme til at køre på forkert nøgle-rum ved et uheld (fremtidig oprydning).
- `raceBindingWindow` vælger nøgle-rum pr. løb (`useGameDay = every row has game_day`) — robust mod delvist-backfillede løb, men det maskerede at hele stier kørte i CET-rum. Divergensen var usynlig indtil to løb lå på samme CET-dato med forskellige game_days.
