# Entry-generatorens selectInChunks trunkerede tavst ved 1000 rækker (#1823 prod-fix)

**Dato:** 2026-06-25 · **Kontekst:** engangs prod-regenerering for at fjerne de 798 samme-dag-dobbeltbookinger

## Hvad skete
Under den LIVE prod-regenerering (`runRaceEntryGenerator(dryRun=false)`) fejlede et insert midt i kørslen:
`duplicate key value violates unique constraint "uq_race_entries_captain"` (unik captain pr. (race_id, team_id)).

## Rod-årsag
`selectInChunks` (raceEntryGenerator.js) chunkede id-listen i 200-id-bidder MEN paginerede ikke RÆKKERNE i hver chunk. PostgREST's default-cap er 1000 rækker. `race_entries` har ~1000+ rækker pr. løb (168 hold × 6-8 ryttere), så et 200-løbs-chunk returnerede langt over 1000 → **tavs trunkering**. Konsekvenser:
- **Manuel-scanningen** missede de fleste manuelle entries → `manualByRaceTeam` ufuldstændig → generatoren forsøgte at regenerere en MANUEL (race,team) → delete (kun is_auto_filled=true) ramte intet → insert af ny captain kolliderede med den eksisterende manuelle captain → constraint-brud.
- **Rytter-fetchet** (by team_id, ~2000 ryttere) blev OGSÅ trunkeret → hold fik kun ~halvdelen af deres trup (generated hoppede 6185→11669 efter fixet).

Samme footgun som [[reference_postgrest_1000_row_cap_in_scripts]] / [2026-05-30-pcm-matcher-1000-row-pagination] — men i generatorens egen helper. Den blev IKKE fanget af unit-tests (mock simulerer ikke 1000-cap) og kun overflade-synlig ved prod-skala.

## Hvad reddede os
1. **Capture-klient pre-flight** (writes = no-op): ville have fanget det FØR live hvis pre-flighten havde tjekket manuel-respekt — den gjorde den ikke i første omgang (lektion: pre-flight skal tjekke ALLE invarianter den live-kørsel kan bryde, ikke kun de forventede).
2. **Per-(race,team) delete+insert + manuelle aldrig i delete-filteret** → INGEN datatab. Den fejlende manuelle lineup var 100% intakt; partial-write efterlod 0 korruption (verificeret: 0 multi-captain, 0 empty pairs). Idempotent re-run efter fixet fuldførte rent.
3. **Verificér-efter mod prod** (SQL-repro): bekræftede 0 rene-auto-dobbeltbookinger; de 43 resterende var alle MANUELLE (managerens egne valg, røres ikke) + 716 i allerede-afviklede løb (frosne).

## Forward-guard
- `selectInChunks` range-paginerer nu hver chunk (PAGE_SIZE=1000); entry-scanningen henter KUN is_auto_filled=false (manuel) + de få startede løb i stedet for alle ~200k rækker.
- Pre-flight-scriptet tjekker nu eksplicit: 0 samme-dag-dobbeltbookinger, 0 staged rows i startede løb, **0 staged rows på manuelle (race,team)**.
- Generel regel: enhver `.in()` over en tabel der kan have >1000 rækker SKAL range-paginere — id-chunking alene er ikke nok.
</content>
