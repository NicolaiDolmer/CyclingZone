# FK-bruddet var en TOCTOU vi allerede havde løst én gang

**Dato:** 2026-08-17 · **Issue:** [#3482](https://github.com/NicolaiDolmer/CyclingZone/issues/3482) · **PR:** [#3816](https://github.com/NicolaiDolmer/CyclingZone/pull/3816) · **Sentry:** CYCLINGZONE-32

## Hvad skete der

Entry-generator-sweepen fejlede 28 (løb,hold)-enheder 5/8 og 2 enheder 15/7 med
`race_entries_rider_id_fkey`. Alle 28 var det samme slettede hold × 28 løb.

Sweepen læser løb, hold og trupper i trin 1-9 og skriver `race_entries` i trin 10.
Bliver holdets ryttere slettet i mellemtiden (AI-trim/`removeAiTeams`), peger
insert-batchen på `rider_id`'er der ikke findes længere → Postgres afviser hele
enhedens upsert.

## Rod-årsagen var en kendt klasse, ikke en ny bug

Filen havde **allerede** løst præcis denne TOCTOU-klasse for en anden constraint:
#2436 fangede `uq_race_entries_*`, genlæste enhedens tilstand friskt og kørte den om
én gang. Det, der manglede, var ikke en ny idé — det var at genkende at FK-bruddet
hørte til samme familie og fortjente samme behandling.

**Læringen:** når en fejl rammer den samme skrivesti som en tidligere fix, så spørg
først "er det samme klasse med en anden signatur?" før du designer noget nyt. Det
færdige mønster lå 60 linjer væk i samme funktion.

## Det farlige ved den naive fix

Den oplagte løsning — "filtrér `desired` mod en frisk eksistens-check" — kan tømme en
trup. `applyUnitDiff` beregner `toDelete = existing \ desired`, så hvis eksistens-
opslaget fejler eller returnerer tomt, slettes hele truppen.

Fixet filtrerer derfor **kun** insert-siden (`desired \ existing`). Rækker der allerede
står i `race_entries` har pr. definition en levende rytter, fordi rider-FK'en er
`ON DELETE CASCADE` (verificeret i prod: `confdeltype = 'c'`). Hver `existing`-rytter
beholdes i `desired`, så `toDelete` strukturelt ikke kan vokse. Aldrig-tommere-
garantien holder: et fejlramt opslag kan undlade at fylde en trup op, aldrig rive den ned.

**Læringen:** i en diff-baseret skrivesti er "filtrér inputtet" ikke en harmløs
operation. Alt du fjerner fra `desired` bliver til en sletning. Filtrér den side der
kan fejle, ikke den side der bærer garantien.

## Verifikationen der faktisk beviste noget

Tre regressionstests var grønne fra første kørsel. Det beviser intet i sig selv — en
test kan være grøn fordi koden virker, eller fordi den ikke tester noget.
Mutation-check: `isRiderFkViolation` tvunget til `false` → alle tre fejler. Først der
var de bevis.

**Læringen:** en ny test der aldrig har været rød har ikke vist at den kan fange noget.
Slå fixet fra og se testen fejle, før du kalder den en regressionstest.

## Sidegevinst: et fund guarden ikke dækker

Under rod-årsagsarbejdet viste `race_entries_team_id_fkey` sig at være `ON DELETE SET
NULL`, ikke `CASCADE`. Derfor ligger der 36 entries med `team_id = NULL` som sweepen
aldrig kan rydde op — den filtrerer hver skrivning på `.eq("team_id", teamId)`, så en
NULL-række matcher ingen enhed. Alle 36 er på afsluttede løb i sæson 1, så der er
ingen aktiv skade. Eget issue: [#3817](https://github.com/NicolaiDolmer/CyclingZone/issues/3817).

**Læringen:** når du undersøger én FK, så læs `confdeltype` på nabo-FK'erne i samme
tabel. To kolonner der peger på "ejeren" af en række bør sjældent have forskellig
sletnings-semantik — og gør de det, er den ene af dem som regel en fejl.
