# Scorecardet målte generatorens egne gates, men ikke motorens der forbruger den

**Dato:** 2026-08-15 · **Issue:** #3634 · **PR:** #3800 · **Fanget af:** CI, ikke af mig

## Hvad der skete

Jeg ændrede voksen-generatoren så rytterens krop formes efter både primær og sekundær arketype, og byggede et sim-scorecard med 12 gates til at vælge vægten. Sweepet kørte over 40 seeds mod generatorens seks separations-gates og landede på 0,10 som det højeste tal der holdt dem alle positive. Alt var grønt. `node --test` var grøn. Preflight var grøn. E2e var grøn.

`npm run race:gate` var rød på 2 af 3 seeds.

Den er et **separat CI-trin**, ikke en del af `node --test`. Jeg havde aldrig kørt den, så jeg så den først da CI fejlede efter push.

## Rod-årsagen, som ikke er "jeg glemte en kommando"

Mit scorecard målte **generatoren mod generatorens egne gates**. Men generatorens output forbruges af race-motoren, og motoren har sine egne kalibrerings-bånd. Jeg målte artefaktet, ikke kæden.

#3634's egen opgavebeskrivelse bad ordret om `scripts/raceCompetitionScorecard.js` og `simulateSeasonDryRun.js`. Jeg læste issuet, byggede en bedre harness end den bad om på ét område, og sprang det den bad om over på et andet. En selvbygget harness føles som grundighed, men den dækker kun det jeg selv kom i tanke om.

## Det egentlige fund, som er større end min fejl

Da jeg sweepede vægten mod race:gate, fejlede den ved **enhver** vægt over 0:

| vægt | race:gate | |
|---|---|---|
| 0 | 3/3 pass | bit-identisk population |
| 0,02 | 2/3 pass | cobbles: brostensrytter 78 % mod ≥80 % |
| 0,10 | 1/3 pass | + itt_tempo, favoriteWinRate 52,8 % mod [25,40] |

Selv 2 % tripper den. Gatens kalibrerings-bånd er i praksis en **golden-population-fixture**: tunet mod præcis den population generatoren laver i dag. Den kan ikke skelne "populationen blev bevidst ændret" fra "motoren gik i stykker".

Det er samme klasse som balance-baselinen (#3799, målt 131 afvigelser skæv på urørt main) og som guard-premise-decay-noten fra 11/8. Tre gates i samme kodebase har nu samme svaghed: de måler afvigelse fra en frossen tilstand og kalder det korrekthed.

## Hvad jeg gjorde

Satte vægten til 0. Alt det presserende i issuet (anlægget forankres, fordelingen rettes) er uafhængigt af vægten, så ved 0 er populationen bit-identisk med før og balance-delta mod main er 0 afvigelser. Blandingen er bevaret, målt og dokumenteret som én konstant, med prisen skrevet ned. Opfølgning: #3804.

## Regler jeg tager med

1. **Mål kæden, ikke artefaktet.** Ændrer jeg noget der producerer input til en anden motor, skal DEN motors gate køres, ikke kun mit eget artefakts.
2. **Kør de kommandoer issuet nævner ved navn**, også når jeg har bygget noget der føles bedre. Min harness er et supplement, ikke en erstatning.
3. **`node --test` er ikke "alle testene".** `package.json`s scripts og CI-workflowets trin er to forskellige lister. Læs workflow-filen, ikke kun `npm test`.
4. **En gate der fejler på en bevidst ændring er ikke nødvendigvis en gate der virker.** Spørg om den måler korrekthed eller bare afstand til en frossen tilstand, før jeg konkluderer at ændringen er forkert.

## Hvad der gik rigtigt

CI fangede det, jeg kontrolmålte mod ren `origin/main` i et separat worktree før jeg konkluderede noget, og jeg sænkede ikke gaten for at få mit tal til at passe. Det første forsøg på en kontrolmåling var i øvrigt ugyldig (jeg stashede, men arbejdet var committet, så jeg målte min egen branch og troede det var main). Den slags skal verificeres med `git log`, ikke antages.
