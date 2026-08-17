# To agenter, to baselines, "samme" tal — og begge lød autoritative

**Dato:** 2026-08-17 (bølge 2) · **Kontekst:** #3514 mandat-flippets konsekvens-effekt

## Hvad skete

To uafhængige spor målte samme spørgsmål ("hvor mange hold ændrer konsekvens-lag ved mandat-flippet?") og landede på uforenelige svar, begge fremlagt med selvsikre formuleringer:

- Spor 10: "0 hold krydser en NY tærskel (matematisk garanteret), 34 lettelser, 24 mister bonus."
- Spor 1: "30 hold skifter lag, 22 strammere, 8 ind i købsspærre."

Begge var korrekte beregninger — mod **forskellige baselines**. Spor 10 målte mod holdets værste plan-tal, spor 1 mod 1-års-planen alene. Ingen af dem målte mod det spillerne faktisk oplever.

## Afgørelsen

Grundsandheden lå i prod-tabellen `board_consequences` (aktive konsekvenser nu): spor 10's lettelses-tal matchede som delmængder; spor 1's "FØR"-fordeling gjorde ikke. Det præcise spillervendte facit krævede en TREDJE måling (aktive lag-6-tilbud × ny confidence): 3 hold, ikke 24, ikke 8.

## Læring

1. **Når to agenter måler samme størrelse, skal orkestratoren afstemme deres BASELINE-definitioner, ikke kun deres tal.** Et selvsikkert "matematisk garanteret" gælder kun inden for agentens egen baseline.
2. **Den spillervendte baseline er altid den levende tilstand** (hvad står der i konsekvens-/tilbuds-tabellen NU), ikke en genberegning af hvad reglerne "burde" have produceret.
3. **Beslutningsspørgsmål til ejeren må ikke stilles på uafstemte tal.** Ejeren fik først "24 hold", som ville have gjort kompensations-spørgsmålet meget større end virkelighedens 3 hold med grandfather-løsning.

## Forward-guard

Drejebogens komponent 4-verifikation bruger nu `board_consequences`-tabellen som baseline for før/efter-målingen på flip-dagen (rettet i denne session).
