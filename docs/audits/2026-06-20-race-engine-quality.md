# Race-engine korrektheds-audit — 2026-06-20

> Natbølge-audit: 5 parallelle korrektheds-scannere (determinisme, evner-afgør-resultat, klassementer, edge-cases, fatigue/idempotens) + adversariel verifikation af alle påståede bugs + synthesis. FOKUS = korrekthed, ikke balance. Verificeret mod faktisk kode (de 3 mest kritiske kodestykker genlæst direkte). Filer: `backend/lib/raceRunner.js`, `raceSimulator.js`, `raceStageProfileGenerator.js`, `raceResultsEngine.js`, `raceFatigue.js`, `copenhagenTime.js`.

## Bundlinje

**Race-engine er solid. 0 bekræftede korrektheds-bugs.** To audits forsøgte eksplicit at finde fejl; begge påståede bugs faldt ved direkte verifikation. De tre egenskaber en race-engine SKAL have for at være troværdig — **determinisme, idempotens, evne-drevne resultater** — er alle verificeret korrekte. Intet launch-blokerende.

**Vigtigt:** Alle fund nedenfor rører den reset-følsomme, ejer-prioriterede motor. De er IKKE fixet autonomt i natbølgen — selv en "sikker" seed-refactor kan subtilt ændre determinisme (= ændrede resultater). Ejer-beslutning + simulér-før-ship (jf. `feedback_simulate_before_ship_balance`).

## Afviste bug-påstande (verificeret IKKE bugs)

- **"Skadede ryttere i 5-min vindue"** — AFVIST. `raceRunner.js:322` `.gte("injured_until", todayStr)` sammenligner mod `copenhagenDateString()` som returnerer ren `YYYY-MM-DD` (`en-CA`, intet klokkeslæt). Skade er dags-granulær; intet sub-dags-vindue. Fejllæst datatype.
- **"stableSeed 32-bit hash-kollision"** — AFVIST som bug. Kollision ville give to etaper samme støj-sekvens, men ALDRIG ikke-deterministisk/forkert resultat (samme input → samme seed). Teoretisk kvalitets-note.

## Edge-cases (ikke aktive bugs — ejer prioriterer)

| # | Tilstand | Fil:linje | Anbefaling | Spiller-synlig? |
|---|----------|-----------|------------|-----------------|
| E1 | Bjerg-klassement emitteres ved 0 bjerg-etaper (fladt løb → tom bjerg-trøje, 0 point, alfabetisk) | `raceRunner.js:248,251` | Spring `mountain`-emission over hvis ingen etape er klatreprofil. **ÆNDRER output** → simulér/ejer-go. | **JA** (eneste) |
| E2 | `demandVectorFor()` → `{}` for ukendt `profile_type` (scorer alle på terræn 0) | `raceStageProfileGenerator.js:123-125` | Fallback til `DEMAND_VECTORS.flat`. Kræver korrupt DB. | Nej |
| E3 | Ukendt `race_type` behandles stille som endagsløb | `raceRunner.js:115` | Fail-loud guard. **Verificér prod race_type-værdier først** (en guard kunne bryde et eksisterende løb med uventet type). | Nej |
| E4 | Ukendt `race_role` valideres ikke (typo = neutral) | `raceRunner.js:386-429` | `VALID_ROLES`-set + `console.warn`. | Nej |

## Forbedringer (korrekt, men kunne være renere)

- **Dual `stableSeed`-kopier** (`raceStageProfileGenerator.js:100-107` + `raceSimulator.js:276-284`) — funktionelt identiske, men profile-generatorens mangler `String()`-wrap. **Konsolidering er delikat** (en subtil forskel i String-håndtering ville ændre seed-output → resultater). Hvis konsolideret: bevar EKSAKT adfærd + verificér determinisme-test grøn.
- **`selectInChunks` usorteret** (`raceRunner.js:272-282`) — ikke et determinisme-problem (aggregeringer er Map-keyed, entrants sorteres før RNG), men et `.order()` ville gøre determinismen eksplicit/fremtidssikret.
- **`race_points` duplikat-lookup (sidste vinder)** (`raceResultsEngine.js:42-53`) — robustgør med DB `UNIQUE`-constraint frem for kode.
- **Stille fatigue-upsert-fejl** (`raceRunner.js:547-554`) — sluges by design; en alert ved gentagne fejl ville hjælpe ops.
- **`input_checksum` uden kanonisk serialisering** (`raceRunner.js:204-209`) — ren observability i dag; normalisér nøgle-rækkefølge hvis nogensinde brugt til regressions-detektion.

## Verificeret korrekt (ros)

Determinisme (seed + stabil rider_id-sortering før RNG; dedikeret determinisme-test `raceRunner.test.js:136`); idempotens (delete-then-insert pr. (race_id, stage_number), bit-identisk gen-afvikling); fatigue-akkumulering (entering-fatigue før load); klassementer (GC kumulativ tid + countback + localeCompare-tiebreaker; points top-15 aftagende; KOM kun på klatre-profiler; U25 rent filtreret; hold = top-3 kumulative); evne-scoring (demand_vector-vægtet, normaliseret sum=1.0, elite-specialist slår modsat); form/fatigue-neutralitet (0-stubs scorer neutralt, ikke biased); `prize_paid_at`-gate (betalte løb fryses mod re-derive).

## Anbefalet rækkefølge (når ejer prioriterer race-engine-polish)

1. **E1** — eneste spiller-synlige (tom bjerg-trøje på fladt løb). Simulér output-ændring først.
2. **Dual stableSeed** — billig oprydning, men verificér determinisme bevares.
3. **E3** — fail-loud guard, efter prod-race_type-verifikation.
