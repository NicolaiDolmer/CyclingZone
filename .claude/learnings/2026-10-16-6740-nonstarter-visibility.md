# 2026-10-16 · Hold der ikke stillede op stod som deltagere (#6740)

**Symptom (Discord 16/10):** Friis' hold manglede i Tour du Léman etape 1, men løbet stod som
"Lineup locked" med taktik. knud så ryttere "i Tour du Danube" på Daily training, som ikke kørte.

**Rod-årsag:** motoren gjorde det rigtige (gulvet på 6, #4295; afmelding, #4306), men
`race_entries` bliver liggende for hold der ikke starter, og læse-fladerne brugte dem som
deltagelse. `teamWillStart` svarede altid "stiller op" efter start; `racingTodayLookup`
ignorerede afmeldinger; startudsigten talte Train now-låste ryttere som frie reserver; en
rytter der kører i mål efter et hårdt styrt fik ingen besked og intet mærke.

**Fix:** én regel i `raceStartOutlook.teamWillStart` (withdrawn / inField / below_min) brugt af
Daily training, Taktik og Race hub; `loadTeamsInStartedField` læser det faktiske felt fra
`race_results`; indbakke-beskeder for skade og "did not start"; advarsel + bekræft før Train now.

**Læring:**
- `rider_condition.updated_at` opdateres ikke af skade-upserten. Brug `race_incidents.created_at`
  som skadestidspunkt (jeg sagde først "styrtede i går" til ejeren på det grundlag; forkert).
- "Entries findes" er aldrig det samme som "holdet kører". Efter start er `race_results` sandheden.
- Railway-loggen `[race …] N hold stiller ikke op (#4295)` er den hurtigste bekræftelse.
