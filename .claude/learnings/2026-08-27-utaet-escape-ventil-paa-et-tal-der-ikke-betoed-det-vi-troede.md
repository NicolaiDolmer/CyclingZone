# Utæt escape-ventil bygget på et tal der ikke betød det vi troede (#4295)

**Dato:** 2026-08-27 · **Issue:** [#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295) (efter [#4175](https://github.com/NicolaiDolmer/CyclingZone/issues/4175), [#2637](https://github.com/NicolaiDolmer/CyclingZone/issues/2637), [#1906](https://github.com/NicolaiDolmer/CyclingZone/issues/1906))

## Hvad skete der

Samme spiller rapporterede den samme bug tre dage efter vi lukkede den. Holdudtagelsen kunne stadig ikke gemmes med færre ryttere end feltet rummer.

Fixet i #4175 var korrekt beskrevet og forkert i praksis. Det lempede blokeringen til kun at gælde når holdet **faktisk kunne** fylde feltet:

```js
const kanFyldeTruppen = !Number.isFinite(availableCount) || availableCount >= required;
```

`availableCount` kommer fra backenden og ser ud til at betyde "ryttere du kan bruge". Den betyder noget andet:

```js
// backend/lib/raceSelection.js:223
availableCount: riderRows.filter((r) => !r.injured).length,
```

Det er hele den raske trup. Ryttere der er bundet i et overlappende løb tælles med som ledige, fordi `bound_riders` beregnes et helt andet sted (`api.js:3990-4009`) og aldrig trækkes fra. Et hold med 29 ryttere har derfor **altid** `availableCount >= size.max`. Ventilen udløste aldrig for et rigtigt hold, og blokeringen stod uændret for præcis den tilstand spillerne rammer: en førstegangs-udtagelse efter "Ryd alt" eller en kalender-rebuild.

Fejlteksten gjorde det værre. Ved for FÅ valgte ryttere fik brugeren "Du kan højst udtage 7 ryttere".

## Rodårsag

To lag, og kun det øverste blev fikset i #4175.

1. **Klienten håndhævede en regel serveren ikke har.** Backendens `validateSelection` har afvist kun `riderIds.length > sizeRule.max` siden 28/6. Panelet opfandt et gulv oveni, og gulvet blev lempet tre gange (#1906 → #2637 → #4175) i stedet for fjernet.
2. **Undtagelsen hvilede på et afledt tal ingen havde verificeret betydningen af.** Navnet `availableCount` lovede "ledig til dette løb". Værdien leverede "ikke skadet".

## Læring

**Når en gate lempes med en undtagelse, så verificér at undtagelsen kan udløse mod ægte data.** #4175's diff var læsbar, testet og logisk. Testen satte selv `availableCount: 5` mod et 7-mands felt og beviste dermed kun at koden virker for input der ikke forekommer i produktion. Ingen test sagde hvad `availableCount` faktisk indeholder, så den utætte antagelse var usynlig i grønt CI.

Konkret næste gang:

- **Et felt fra en anden lags API er ikke sit navn.** Slå definitionen op i kilden før du bygger en gren på den. Her lå den fire linjer inde i den samme fil som valideringen.
- **En undtagelse skal have en test der binder den til virkelig datashape**, ikke bare til et konstrueret tal. "Kan denne gren overhovedet blive sand for et rigtigt hold?" er et spørgsmål med et svar i data.
- **Når klienten validerer det samme som serveren, så spejl serveren og lad være med at tilføje.** Enhver ekstra klient-regel er en fremtidig rapport. Hvis der er en nudge at give, så giv den som tekst, ikke som en blokering.
- **En blokeret handling skal forklares med den rigtige fejl.** `selection_wrong_size` blev genbrugt til to modsatte tilfælde, så beskeden løj om halvdelen af dem.
- **Spiller-vendt hjælpetekst driver.** `help.json` sagde "Du kan ikke gemme en delvis trup" i to måneder efter backenden holdt op med at håndhæve det, mens panelets egen undertekst sagde det modsatte. Ingen gate fanger den slags modsigelse.

## Hvad blev gjort

- `validateSelectionClient` spejler nu backenden præcist: kun over feltstørrelsen, manglende kaptajn og rolle-overlap blokerer. `requireFull` og `availableCount` er væk.
- #1906's nudge lever videre som en ikke-blokerende hint-linje bygget på ryttere der er frie til netop dette løb (`!injured && !bound && !selected`), altså det tal `availableCount` blev troet at være.
- `help.json` (en+da) rettet, `selection_insufficient_riders` slettet symmetrisk.
- Tre unit-tests låste den gamle adfærd og er skrevet om til kontrakt-tests mod backendens regel. To e2e dækker nu førstegangs-udtagelsen med delvis trup, hvor der før slet ingen test var.

## Efterskrift: gulvet kom tilbage samme dag, men et andet sted

Ejeren besluttede 27/8 at et hold skal have **mindst 6 udtagne ryttere for at stille op** i et løb. Det ligner en tilbagerulning af denne postmortem, og det er det ikke. Forskellen er hvor reglen sidder:

- Det gulv der blev fjernet lå på **Gem**. Det forhindrede manageren i at skrive sin egen kladde ned, og det havde ingen modsvarighed i backenden. Det er stadig væk, og skal blive det.
- Det gulv der kom til ligger på **deltagelsen**, håndhævet i motoren (`raceRunner.loadEntrantsForRace`) og synligt i UI'et som en konsekvens-sætning. Manageren kan stadig gemme tre ryttere; holdet stiller bare ikke op med tre.

Den skelnen er hele læringen ovenfor sagt forfra: en regel om hvad der er *klogt* hører hjemme som tekst på fladen og som en konsekvens i motoren, ikke som en spærre på en gem-knap.

Hint-linjen fra dette fix blev derfor udvidet i stedet for erstattet. Den siger nu en af tre ting, og hvilken der er sand afhænger stadig af det samme tal — ryttere der er frie til netop dette løb. Fristelsen var at lade den sige "stiller ikke op" hver gang der er under 6 valgte, fordi det er sådan reglen lyder. Det ville have været en ny løgn på samme flade: sen-redningen fylder op til 6 når holdet har frie ryttere, så i det almindelige tilfælde stiller holdet netop op.

## Åbent efter fixet

Dashboard-nudgen (`raceSquadSelectionStatus.js:20`), Race Centre-kortet, board-status-pillen og notifikations-sweepet måler alle "komplet" som antal `== size.max`. Et hold der beviseligt ikke kan fylde feltet står derfor permanent som "Holdudtagelse mangler" med en notifikation der ikke kan handles på. Samme forkerte præmis, ny flade. Ejer-spørgsmål, ikke rettet her.
