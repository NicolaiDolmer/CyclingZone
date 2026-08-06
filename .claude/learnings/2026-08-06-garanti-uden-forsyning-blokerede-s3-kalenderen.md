# En garanti uden forsyning blokerede hele S3-kalenderen — og ingen vidste det

**Dato:** 2026-08-06 · **Issues:** [#3295](https://github.com/NicolaiDolmer/CyclingZone/issues/3295), [#3327](https://github.com/NicolaiDolmer/CyclingZone/issues/3327), [#3371](https://github.com/NicolaiDolmer/CyclingZone/issues/3371) · **PR:** [#3462](https://github.com/NicolaiDolmer/CyclingZone/pull/3462)

## Hvad skete der

S3-kalenderen kunne ikke materialiseres. `materializeTierCalendars` ville kaste ved apply på tier 2 og tier 3:

```
tier 3: kun 0 etapeløb uden bjerg-etape, under garanteret minimum 1 (#3327)
```

Fundet ved en dry-run som led i kompositions-arbejdet — ikke af nogen der ledte efter det. Uden fundet ville det have ramt cutover-natten 23/8, hvor konsekvensen er en sæson uden kalender: ingen løb, ingen entries.

## Rod-årsag

`TIER_MOUNTAIN_FREE_STAGE_RACE_MIN` (#3327, ejer-ask 4/8: *"ikke alle etapeløb skal have bjerge"*) kræver at hver tier har mindst N etapeløb helt uden bjergetape. Garantien blev sat til det niveau der **blev målt i S2's kalender** — et fornuftigt "floor et godt stykke under nuværende observerede niveau".

Men kun **én** af otte etapeløbs-arketyper kunne faktisk levere et bjergfrit løb: `hilly_tour`. Alle andre — `summit_tour`, `mountain_tour`, `balanced_week`, `sprinters_week`, `cobbled_tour`, `sprinter_tour_summits`, `grand_tour` — har `mountain` blandt deres `guarantees`.

Og `selectTierRaceSet` vælger løbssættet **forfra hver sæson** (prestige-sortering + cross-tier-dedup). S2's udvalg gav tilfældigvis tier 3 en `hilly_tour`; S3's udvalg gjorde ikke. Garantien var med andre ord opfyldt i S2 ved held, ikke ved konstruktion.

## Hvorfor det ikke blev fanget

1. **Garantien blev kalibreret mod ét observeret udfald.** "Floor under det nuværende niveau" er sikkert når forsyningen er stabil — men her afhang forsyningen af et sæson-specifikt udvalg fra et katalog hvor kun én arketype kunne opfylde kravet.
2. **Gaten sidder i apply, ikke i planlægningen.** `dryRun` rapporterer bruddet, men intet kørte en dry-run mod S3 før nu. S2's kalender blev materialiseret ved world-launch, så apply-stien var aldrig blevet kørt mod et frisk løbsudvalg.
3. **Ingen test dækker "kan næste sæson overhovedet bygges".** Testene dækker mekanikken (`tierCalendarMaterializer.test.js`, 39 grønne) med syntetiske fixtures — ikke om det ægte katalog kan opfylde de ægte garantier for den næste sæson.

## Fixet

`sprinters_week`'s `mountain`-garanti erstattet af `hilly`. En sprinter-uge der pr. definition indeholder en bjergetape modsiger sit eget navn — Danmark Rundt, Tour of Guangxi og Tour Down Under afgøres af sprintere og puncheurs. Filleren beholder `mountain` (vægt 10), så nogle sprinter-uger får en bjergdag og andre ikke.

Det gav samtidig præcis den variation @thelamba efterspurgte i #3371 og ejeren i #3327. Alle fire tiers kan nu applies.

## Læringen

**Et floor kalibreret mod ét observeret udfald er ikke et floor — det er et øjebliksbillede.** Når kravet afhænger af en forsyning der genudvælges (her: hvilke løb en sæson får), skal man spørge: *hvor mange kilder kan opfylde kravet, og kan udvælgelsen komme til at vælge dem alle fra?* Her var svaret "én kilde, og ja".

To konkrete vaner der ville have fanget det:

1. **Kør apply-stien som dry-run mod den NÆSTE sæson, ikke kun den nuværende.** Det er nu muligt med `node scripts/calendarCompositionScorecard.js --plan 3`, som kører hele selection+packing-pipelinen uden at skrive. Det bør ind i `preflight-season-cutover.ps1`.
2. **Når du sætter en garanti, tæl kilderne.** Hvis kun én konfiguration kan opfylde den, er garantien reelt et krav om at udvælgelsen altid rammer netop den — og det er ikke en garanti, det er et lotteri.

## Beslægtet mønster i samme session

Samme klasse fejl, mildere form: vægte kalibreret mod S2's løbssæt ramte S2 præcist og gav S3 bjerg +3,0 pp. Igen fordi udvalget genudvælges pr. sæson. Kalibreringen er nu verificeret mod **begge** sæsoner, og `calendarCompositionCalibration.test.js` fejler hvis kompositionen driver uden for ±2 pp.

---

## KORREKTION samme dag: rod-årsagen var dybere end katalog-forsyning

Analysen ovenfor er rigtig så langt den går, men den stopper for tidligt. Jeg konkluderede at garantien manglede *forsyning* — at der var for få `hilly_tour`-løb i kataloget. Det viste sig at være forkert.

**Testen der afgjorde det:** jeg føjede 21 nye kandidat-løb til kataloget (dry-run) og lod en søgning finde det bedste sæt. Den mættedes efter **to** løb. De øvrige 19 flyttede ingenting.

**Den virkelige rod-årsag:** `selectTierRaceSet` rangerer kandidater `prestige → STØRRELSE → knap-arketype`. Arketypen er tredje nøgle og slår kun til når to løb har både samme prestige *og* samme etapeantal — hvilket næsten aldrig sker. `SCARCE_TERRAIN_ARCHETYPES` (#3327) skulle give brosten- og ITT-løb forrang, men blev i praksis aldrig nået: et 6-etapers `mountain_tour` slår altid et 3-etapers `cobbled_tour` på størrelse.

Dertil: divisionens kvote er **fast** (84 game-days for D3). Nye katalog-løb ændrer derfor *hvilke* løb divisionen tager, ikke *hvor mange*. De fortrænger hinanden i stedet for at akkumulere. Det ene løb der faktisk hjalp, udfyldte en **tom** plads i D4 — ikke en fortrængning.

**Fikset:** en reservations-fase (`reserveArchetypes`) der tager de påkrævede arketyper FØR prestige-walket. 4 blokerende brud → 1, og kompositionen blev samtidig bedre (bjerg landede 0,1 pp fra målet).

## Den egentlige læring

**En efterkontrol kan konstatere en mangel, men aldrig fremskaffe det manglende.** Alle dækningsgarantierne i `tierCalendarGuarantees.js` var skrevet som verifikation efter selection. De virkede så længe prestige-rangeringen tilfældigvis leverede dækningen — og fejlede lydløst da den holdt op.

Ironien er at #3327 selv havde fundet præcis denne fejlklasse et lag tidligere, for endagsløb/etapeløb-mixet, og skrevet løsningen ned i sin egen kommentar: *"store etapeløb vinder ALTID over 1-etapes løb ved samme prestige i et sammenlagt størrelses-sorteret walk"* — hvorefter kvoten blev splittet i to budgetter FØR walket. Den indsigt blev bare ikke ført videre til terræn.

**Spørgsmål der ville have fanget det hurtigere:** når en sortering har flere nøgler, hvor ofte bliver den n'te nøgle overhovedet nået? Her: næsten aldrig. En prioritet der ligger efter en nøgle med høj kardinalitet (etapeantal) er ikke en prioritet — den er dekoration.

**Og en metode-læring om mig selv:** jeg foreslog at sænke båndene, da katalog-udvidelsen ikke virkede. Ejeren afviste det ("vi laver ikke quick fixes"), og det var rigtigt — jeg havde diagnosticeret symptomet som årsagen. Når to forsøg på at løse noget begge fejler på samme måde, er det et signal om at modellen af problemet er forkert, ikke om at målet skal sænkes.
