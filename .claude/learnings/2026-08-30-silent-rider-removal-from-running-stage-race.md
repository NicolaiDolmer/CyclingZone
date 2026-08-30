# En korrekt udtagelse uden spor ser ud som en fejl — og skjulte en rigtig fejl

**Dato:** 2026-08-30 · **Issue:** [#4418](https://github.com/NicolaiDolmer/CyclingZone/issues/4418) · **Fundet af:** daglig Sentry/Railway-triage

## Hvad skete der

Tre igangvaerende etapeloeb mistede tilsammen 5 start-felt-ryttere mellem etape 2 og 4.
Alle paa menneskehold. Motoren logede det som `start-felt-rytter(e) forsvundet
(#1844/#1847)` — men kun til stdout, uden Sentry-capture. Klassen var usynlig og blev
kun fundet fordi triagen laeste Railway-loggen linje for linje.

## To aarsager, ét symptom

1. **Skade opstaaet uden for loebet** (2 ryttere, `injury_cause = training_overload`).
   Skadefilteret (#3896) tager dem korrekt ud af feltet.
2. **Akademikontrakt skrevet midt i loebet** (3 ryttere). `isEligibleRider` afviser
   akademiryttere, saa de falder ud paa naeste etape.

## Laeringen

**Aarsag 1 var ikke en fejl.** Ejer-beslutning 30/8: *"hvis man er skadet skal man ikke
kunne koere loeb, det er fint at rytterne tages ud af loebet."* Min foerste analyse
foreslog at gate skadefilteret paa `allowAutofill` — altsaa lade den skadede rytter
koere videre. Det var stik imod den oenskede regel.

Den egentlige defekt var, at en **korrekt** udtagelse ikke efterlod noget spor:

- Spilleren saa rytteren forsvinde uden forklaring.
- Advarslen gentog sig paa hver resterende etape, saa den tilsigtede udtagelse
  producerede stoej der var umulig at skelne fra aarsag 2 — det ægte brud.

Det er pointen: **en tilsigtet handling der ikke registreres, forurener signalet for de
utilsigtede.** Vi havde allerede mekanikken (`race_incidents` + `loadAbandonedRiderIds`,
som netop findes for at en aegte DNF ikke rapporteres som "forsvundet") — den blev bare
ikke brugt paa denne sti.

## Fejl jeg selv lavede undervejs

1. **Skrev "skadet midt i loebet" uden at pege paa kilden.** Ejeren spurgte
   "er det traeningsskader?" og havde ret. `rider_condition.injury_cause` sagde det
   direkte — jeg havde ikke laest kolonnen. *Maal aarsagen, gæt den ikke.*
2. **Foreslog en rettelse foer regelen var afklaret.** Jeg antog at udtagelsen var
   fejlen. Naar en observation kan laeses som "systemet gjorde noget forkert" ELLER
   "systemet gjorde det rigtige, men tavst", skal spilreglen afklares foerst.
3. **Naer-fejl: `persistIncidents` upserter `injury_cause='race_crash'` for hver
   abandon.** Havde jeg genbrugt den til at skrive udgaaelsen, ville en traeningsskade
   vaere blevet omskrevet til et styrt — data-korruption i den kolonne der lige havde
   afsloret rod-aarsagen. Derfor en egen skriver der ikke roerer `rider_condition`.
   *Laes hvad en "genbrugelig" funktion ogsaa goer ved siden af.*

## Forward-guard

- `partitionMissingByInjury` skiller de to aarsager, saa aarsag 2 bliver ved med at larme
  — nu med Sentry-capture (`start-field-rider-vanished`) i stedet for kun stdout.
- `backend/lib/injuryWithdrawal.test.js` asserter at skriverens delete er scopet til
  `kind='injury'`, saa den aldrig kan slette simuleringens crash/mechanical-raekker.
- Migrationen dokumenterer i en `COMMENT ON COLUMN` at `injury` ejes af
  `rider_condition` og aldrig maa overskrive `injury_cause`.

## Aabent efter denne aendring

Aarsag 2 er **ikke** loest her. En akademikontrakt skrevet midt i et igangvaerende loeb
boer udskydes, som `stageRaceTransferDefer` goer ved almindelige handler (#1995).
Staar i #4418.
