# Postmortem: #1306-condition stripped i buildRaceResults

**Dato:** 2026-06-12
**Issue:** #1306 (form/fatigue-berigelse) + #1307 (race_role-passthrough)

## Hvad skete der

`loadEntrantsForRace` i `raceRunner.js` berigede korrekt entrants med `form` og `fatigue` fra `rider_condition`-tabellen (landede med #1306). Men ét lag dybere i samme fil lå `buildRaceResults`, der byggede `simEntrants` ved at mappe til `{ rider_id, team_id, abilities }` — og droppede alle øvrige felter stille og roligt. Dermed nåede form/fatigue aldrig ind i `simulateStage`, og #1306-berigelsen havde nul effekt i production.

Samme stripping ramte `race_role` fra #1307: rollerne var planlagt til at følge med ind i simulatoren, men flow-kæden var brudt allerede her.

## Hvorfor blev det ikke opdaget

- Race-gate-harnessen (`raceGate.test.js`) kalder `simulateStage` **direkte** — den bypasser `buildRaceResults` helt, og tester aldrig den faktiske produktions-sti.
- GT-pathens condition-mode-entrants passerede gennem `buildRaceResults` men condition-felterne blev stripped stille, uden assertion eller observerbar forskel i output (ingen test tjekke at form ændrer resultatet end-to-end).

## Fix

`simEntrants`-mappingen (linje ~167) udvides med spread-guards:

```javascript
...(e.form != null ? { form: e.form } : {}),
...(e.fatigue != null ? { fatigue: e.fatigue } : {}),
...(e.race_role ? { race_role: e.race_role } : {}),
```

Entrants uden disse felter producerer bitidentisk output (spread af tom).

`input_checksum`-payloaden får `roles`-felt så roller er en del af repro-audit.

## Guard fremover

- `raceRunnerPassthrough.test.js` (ny) — to regression-tests der går **igennem `buildRaceResults`** og verificerer at form/fatigue og race_role faktisk påvirker rangordenen. Rider-id'erne er valgt så favoritten IKKE vinder tiebreak pre-fix (mmm-solo vinder), så testen er garanteret rød.
- Task 9 (gate-harness) vil køre condition-mode entrants gennem `buildRaceResults`-stien eksplicit.
