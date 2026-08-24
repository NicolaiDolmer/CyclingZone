# En afledning arver ingen af generatorens regler

**Dato:** 2026-08-24 · **Issues:** #4075, #4159, #4161, #4176 · **PR:** #4185

## Hvad skete der

`#4161`-reparationen (kørt i prod 24/8 kl. ~16) genskabte `race_stage_schedule.game_day` ved at **udlede** aksen af de datoer og tidsslots der allerede stod i databasen. Det var det rigtige valg: `scheduled_at` var urørt og dermed sandheden, og at ramme den historiske pakker-kørsel bit-for-bit ville være arkæologi.

Afledningen (`calendarGameDayRepair.deriveGameDayAxis`) blev skrevet mod de invarianter der fandtes som kode: højst `cap` løb pr. løbsdag, én etape pr. løb pr. løbsdag, aksen monotont voksende med datoen. Alle tre holdt bagefter.

Men pakkeren havde en fjerde regel som afledningen aldrig fik at vide: **et monument har sin egen, eksklusive løbsdag** (#4075, ejer-låst 21/8). Reglen lå i `raceCalendarLanePacker.js` som konstruktion — `layoutStream` skyder et monument ind i sin egen løbsdag og forskyder resten — og var testet dér. Den fandtes ingen andre steder.

Resultatet: alle fem D1-monumenter blev klappet sammen med deres naboløb. Cap'en var ikke brudt (2-3 løb ≤ cap 3), så ingen af de tre eksisterende invarianter sagde noget. Fundet blev først gjort dagen efter, ved en manuel gennemgang mod prod.

## Rod-årsag

**En regel der kun findes i generatoren er ikke en regel — den er en hensigt.** Generatoren er ikke den eneste der skriver til tabellen. Reparations-scripts, backfills og ad-hoc-SQL skriver samme kolonner, og de kender pr. definition kun de regler der er skrevet ned uden for generatoren.

Det er tredje gang på to dage:

| Hændelse | Regel der kun levede ét sted | Hvem brød den |
|---|---|---|
| #4161 | `TIER_OVERLAP_CAP` (konstant pakkeren sigtede efter) | #4155-reparationen |
| #4163 | `DEFERRABLE` på `no_rider_double_booking` | #4155-reparationen |
| dette | monument = eksklusiv løbsdag (pakker-konstruktion) | #4161-reparationen |

Samme form hver gang: **den næste skriver kender ikke reglen, fordi reglen ikke kan læses uden for det sted der tilfældigvis håndhæver den.**

## Hvad der blev gjort

1. `deriveGameDayAxis` tager nu `monumentRaceIds` og giver hvert monument sin egen sub-dag (kalenderdatoen deles fortsat).
2. Reglen fik en gate på alle tre niveauer: CI mod pakkerens output, sæsonskifte-preflight (`detectCalendarViolations` invariant 6), og `verify-invariants` mod prod (`calendar_monument_exclusive_game_day`).
3. Vagten kører nu af sig selv: `.github/workflows/calendar-invariant-audit.yml`, dagligt mod prod.
4. Data repareret i live S3 med ejer-GO: 107 rækker i D1, monument-brud 5 → 0, cap-brud 0 → 0, ingen etape flyttede dato.

## Læring

**Skriver du en afledning der erstatter en generator, så skriv generatorens KONTRAKT ned først — ikke bare de invarianter der allerede findes som kode.** De invarianter der findes er dem nogen har nået at skrive; de er ikke listen over regler. `docs/CALENDAR_RULES.md` findes nu netop for at være den liste.

**Test for gaten skal være: kan reglen brydes uden at nogen tælling siger fra?** Monument-eksklusiviteten kunne brydes uden at bryde cap'en, netop fordi 2 løb < cap 3. En regel der er en delmængde af en anden regels tælling har brug for sin egen tælling.

## Bonus-fund samme kørsel

`races.game_day_start` er en kopi af løbets første `game_day` — en genvej dashboardet bruger som kronologisk markør. `#4161`-reparationen skrev de 943 `game_day`-rækker uden at resynce kopien, så 334 af 471 S3-løb pegede på den gamle akse. Samme halve-migration-klasse som #4163's tabte `DEFERRABLE`: **ændrer du en kolonne, så find dens afledte kopier i samme kørsel.** Resynket 24/8 efter ejer-GO (334 → 0). SQL-generatoren i `repairGameDayAxis4161.mjs` gør det nu selv.
