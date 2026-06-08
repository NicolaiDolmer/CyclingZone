**Brief til #1102: Light egen race-afvikling + PCM-fallback (launch-motor)**

**Mål:** Færdiggør, kalibrer og runtime-wire den eksisterende lightweight race-motor, så den kan afvikle løb uden afhængighed af PCM, med PCM-import som nød-fallback. Motoren er allerede deterministisk, seeded og evne-baseret.

**Runtime-evidens:**
*   `backend/lib/raceRunner.js`: Dette er den primære runtime-anker for race-motoren. Den viser den nuværende light-motor kontrakt, afhængigheden af populerede `race_entries`/abilities, og at motoren allerede er designet til at bevare den gamle `applyRaceResults` downstream-adfærd. `buildRaceResults` håndterer GC via kumulativ syntetisk tid med countback tiebreaks, point/KOM/youth/team klassifikationer, og bruger delte `buildRacePointsLookup`/`PRIZE_PER_POINT` [8].
*   `backend/lib/raceEngineFlag.js`: Definerer `RACE_ENGINE_V2_FLAG_KEY` og `isRaceEngineV2Enabled(supabase)`. Flag-off/default betyder, at PCM-import-stien forbliver den eneste aktive race-resultatkilde [9].
*   `backend/lib/raceSimulator.js`: Ren funktion `{ entrants, stageProfile, seed } → ranked`. Vægtet score på `rider_derived_abilities` mod stage-type + kontrolleret tilfældighed (genbrug `makeRng`/Box-Muller fra `fictionalRiderGenerator.js`).
*   `docs/research/genre-benchmark-june-2026.md`: Indeholder kalibreringsdata og anbefalinger for at skærpe demand-vægtene og sænke støjen i motoren, samt at verificere bjerg-fordelingen [10].

**Invarianters der beskyttes:**
*   `applyRaceResults` (standings/præmie-kontrakter) forbliver intakt.
*   Flag-off bevarer dagens PCM-import præcist (verificeret fallback).
*   Golden-seed-tests sikrer deterministisk og forudsigelig adfærd.

**Minimal change:**
*   Bevar `raceSimulator.js`, `raceRunner.js`, `applyRaceResults` og `raceResultsEngine` kontrakterne.
*   Promovér `backend/scripts/simulateSeasonDryRun.js` fra cockpit til launch-gate med eksplicitte thresholds og non-zero exit ved brud.
*   Tune `DEMAND_VECTORS` og `NOISE_SD_SCALE`/`randomness` baseret på genre-benchmark for at opnå de ønskede vinderrater.
*   Tilføj den manglende runtime-entrypoint bag feature-flag; flip ikke flaget før relaunch-harnesset er grønt.

**Verification path:**
*   Afvikl en hel sæson på fiktive ryttere uden PCM.
*   Verificer, at gyldige `race_results` skrives gennem `applyRaceResults`.
*   Udfør distributions-tjek: stjerner vinder oftere end domestiques, men ikke 100%; roller matcher terræn.
*   Bekræft, at flag-off bevarer den eksisterende PCM-import-funktionalitet.
*   Verificer bjerg-fordelingen i cockpit: sikr, at baroudeurer reelt vinder en del af bjergetaperne.
*   Golden seeds og distributions-thresholds skal begge være grønne: determinisme alene beviser ikke god game balance.
