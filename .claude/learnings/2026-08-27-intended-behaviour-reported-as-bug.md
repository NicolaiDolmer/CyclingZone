# Tilsigtet adfærd rapporteret som fejl, to dage efter beslutningen blev truffet

**Dato:** 2026-08-27
**Issue:** #4310 (lukket som invalid). Berører #4217, #4173, #4209.

## Hvad skete der

Jeg målte at præcis 3 af 529 løb i S3 har spring i deres løbsdage, og at det er de tre Grand Tours med 2 spring hver. Jeg fandt at `raceBindingWindow` fylder `days[]` tæt fra start til slut, så springene binder rytterne, og at hver af de 6 springdage har præcis ét andet D1-løb kørende. Jeg oprettede et priority:high-issue, kaldte det en rod-årsag, og anbefalede ejeren at `days[]` skulle bygges af de faktiske etape-rækker i stedet.

Ejeren sagde ja.

Fixet er nøjagtigt den ændring han selv rullede tilbage 25/8. #4173 gjorde præcis det 24/8, og det åbnede en større fejl: 5.074 udtagelses-par på 1.694 ryttere kunne forlade et etapeløb midt i og køre noget andet i springet. #4217 vendte det tilbage på hans direktiv: *"de skal altså ikke kunne deltage i noget andet undervejs."*

## Hvor evidensen lå

To steder, begge inden for rækkevidde af det jeg allerede havde åbent:

1. **Kommentarblokken direkte over funktionen**, `backend/lib/raceBinding.js:57-74`. Femten linjer der navngiver #4217, citerer ejeren, forklarer at springene ikke er hviledage men slot-fremskrivning, og angiver prod-tallet fra rollbacken. Jeg læste `sed -n '1,130p'` af filen **efter** jeg havde oprettet issuet og anbefalet fixet.
2. **#4217 selv**, som endda adresserer netop GT'erne: *"Kun 9 af 199 flerdagsløb har et ÆGTE kalenderdags-hul, og de 9 er GT-hviledagene."*

Jeg havde læst `raceBindingWindow`s krop tidligt for at forstå `days[]`. Jeg greppede efter implementeringen og læste de 12 linjer kode. Kommentaren stod lige over det udsnit jeg hentede.

## Rod-årsag

Målingen var korrekt og overbevisende, og det gjorde mig hurtigere frem for mere forsigtig. Seks navngivne løb, et rent tal på 3 af 529, en kodelinje der åbenlyst kunne skrives anderledes. Jeg behandlede "jeg kan se hvordan koden ville se pænere ud" som bevis for at den var forkert.

Den eksisterende regel i MEMORY siger det ordret: **"Er afvigelsen tilsigtet? Tjek git-log + merged PR'er før du kalder noget regression."** Jeg sprang det over, fordi det ikke føltes som en regression. Det føltes som et fund. Reglen gælder begge dele.

Det andet fund i samme issue, `game_day_start`-aksen, fejlede på samme måde: jeg konstaterede en dataafvigelse på 272 af 529 løb og tilskrev den en brugerrapport uden at tjekke om nogen flade overhovedet læser kolonnen. Det gør ingen. Ét grep havde afgjort det.

## Konsekvens

Ingen kode ændret, intet postet til spillere. Men jeg nåede at skrive et roadbook-udkast der lovede spillerne et fix på den ønskede regel, og ejeren godkendte et stykke arbejde på et forkert grundlag. Havde han ikke spurgt ind, var #4173 blevet genindført dagen før sæsonstart.

## Regel fremad

**Før et fund bliver til et issue med en anbefalet kodeændring: læs kommentarerne omkring den linje du vil ændre, og søg issue-trackeren på funktionsnavnet.** Ikke bagefter, som verifikation. Før.

Konkret for denne kodebase: en funktion med en lang dansk kommentarblok over sig er et signal om at adfærden er omstridt og allerede afgjort. `raceBindingWindow`, `raceGameDaySpan` og `isRiderDayInvariantViolation` har alle sådan en blok. De er ikke dokumentation, de er beslutningsreferat.

Og: en dataafvigelse er først en defekt når en flade viser den. `grep` efter kolonnenavnet i `frontend/src` koster ingenting.

## Beslægtet

- [[2026-05-17-symptom-patching-loop-vs-root-cause]] — samme familie: handling før forståelse.
- Ejer-reglen om ikke at genåbne låste beslutninger (bidt 12/8 på #3503, hvor beslutningen stod ordret i issuet og i spec §6). Her stod den i koden.
