# En bevidst ændring rapporteret som regression — fordi SSOT'en var bagud

**Dato:** 2026-08-25 · **Fundet af:** ejeren, midt i en workflow-session · **Refs:** #4176, #4254, #4121

## Hvad skete der

Under diagnosen af de 11 S3-blockers målte jeg at Division 1's tre grand tours har 18, 17 og 17 etaper. `docs/CALENDAR_RULES.md:115` siger *"GT'ens 21 er ejer-bekræftet"*, og sæson 1 og 2 kørte alle tre på 21. Jeg konkluderede at regenereringen 25/8 havde indført en regression, og præsenterede det for ejeren som et fund med et valg om hvordan vi rettede det.

Det var forkert. Komprimeringen var bevidst, besluttet 24/8 under #4176 og udført i PR #4121 (*"Giro 11 → 6 dage"*). `docs/MASTERPLAN.md` beskrev den ordret i punkt 8b: *"Næste: GT-komprimeringen under #4176 (3 GT'er fylder 56 af D1's 80 løbsdage; Giroen 18 etaper på 6 dage)"*.

Ejerens svar: *"Det er meningen at gt'erne er 17-18 etaper lange. Du har nok glemt at læse en eller anden fil/planlægning."*

## Rodårsag

To ting skulle begge gå galt, og gjorde det.

**1. SSOT'en var ikke opdateret sammen med beslutningen.** PR #4121 ændrede GT-længden uden at røre `CALENDAR_RULES.md`. Filen sagde stadig 21. Hard rule 30 (#4221) kræver netop at SSOT'en opdateres i samme PR — den kom først dagen efter, 25/8, så #4121 er ikke i strid med den. Men konsekvensen er den samme.

**2. Jeg krydstjekkede ikke om ændringen var tilsigtet.** Jeg havde to kilder der pegede samme vej — SSOT'en og de historiske data fra S1/S2 — og behandlede det som tilstrækkeligt. Jeg søgte ikke i git-historikken eller i masterplanen efter en nyere beslutning, før jeg kaldte det en regression.

Det andet punkt er det vigtige. Den første fejl vil ske igen; SSOT'er kommer bagud. Værnet skal ligge i hvordan man læser dem.

## Læringen

**En SSOT der er bagud er værre end ingen SSOT, fordi den læses som sandhed.**

Før du rapporterer at noget er gået i stykker, skal du afgøre om ændringen var tilsigtet. Målingen alene beviser kun at tilstanden afviger fra det dokumenterede — ikke at afvigelsen er en fejl.

Tjek i denne rækkefølge, det tager under et minut:

```bash
git log --oneline --since="<14 dage>" -- <den relevante fil>
gh pr list --state merged --search "<emnet>" --limit 10
git log -p --since="<14 dage>" -- docs/MASTERPLAN.md | grep -i "<emnet>"
```

Finder du en bevidst beslutning, er fundet ikke en regression — det er **SSOT-gæld**, og det er et andet issue med en anden hastegrad.

## Hvad det afslørede ud over den ene fejl

En systematisk gennemgang af alle merged PR'er 18/8–25/8 fandt **24 regler** der var ændret bevidst uden at SSOT'en fulgte med: 12 i kalenderen (#4176) og 12 udenfor (#4254). Plus 17 rollbacks — ændringer der blev merged og siden forkastet, hvor forskellen mellem "gældende" og "prøvet og afvist" ikke stod skrevet noget sted.

Fire af dem er løsninger på åbne problemer, som en fremtidig session ellers ville foreslå igen. Den vigtigste: `game_day := dato − startdato` er prøvet i #4155 og igen i #4158, og afvist begge gange.

Gælden er dog **ikke gennemgående**. #4169 og #4185 opdaterede `CALENDAR_RULES.md` i samme PR som koden, præcis som reglen kræver. Det er rytter-generatoren og økonomien der halter, ikke kalenderen.

## Forebyggelse

- **Nu:** #4176 og #4254 lukker de 24 huller.
- **Overvej:** en hook der kræver at en PR, som rører en fil med kendt regel-ejerskab (`calendarTierCaps.js`, `economyConstants.js`, `pyramidCompression.js`), har den tilsvarende SSOT-fil med i diffen. Hard rule 30 kan ikke håndhæves af en regel alene — det er samme svaghed som branch-problemet havde (#4016), hvor en vagt ved commit ikke kunne forhindre selve skiftet.
- **I prompts:** faldgruben er skrevet ind i `docs/sessions/2026-08-26-s3-blockers-naeste-session.md` som det første næste session læser.
