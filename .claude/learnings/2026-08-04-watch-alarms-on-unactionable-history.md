# En vagt der alarmerer på noget ingen kan handle på, træner os i at ignorere den

**Dato:** 2026-08-04 · **Issue:** #3119-opfølgning (CYCLINGZONE-44) · **Type:** ops/observability

## Symptom

`riderDoubleBookingWatch` (CYCLINGZONE-44) fyrede hver time i en uge med `count=4,
actionable=0`. Efter at ghost-filteret (#3185, 3/8) fjernede de falske par stod der
præcis 4 ægte, historiske brud tilbage: de samme fire ryttere i "Tour des Hauts
Plateaux" + "Tour de Malaisie", begge løb `status='completed'` med 8 kørte etaper.

## Hvorfor det var et problem

Alarmen var teknisk korrekt og praktisk ubrugelig. Ingen af de fire par kunne rettes
med en entry-sletning (resultaterne var kørt), så hvert eneste tick bad om en handling
der ikke fandtes. Den daglige triage brugte tid på at gen-konstatere det samme, og en
vagt man rutinemæssigt afviser holder op med at virke som vagt: næste ÆGTE brud ville
lande i den samme "ah, det er bare de fire" -skuffe.

## Rod-årsag

Vagten skelnede mellem "kan stadig nås" (`actionable`, baseret på
`stages_completed === 0`) og resten, men brugte kun skellet i alarm-TEKSTEN. Selve
alarm-betingelsen var `conflicts.length > 0`, altså uafhængig af om fundet kunne
handles på. Skellet fandtes i data, men var aldrig koblet til beslutningen.

## Fix

`splitLiveConflicts()`: et par er dødt når BEGGE løb har `status === 'completed'`.
Sentry-alarmen kræver mindst ét levende par; historiske par tælles stadig (returneres
som `historical`, logges én gang dagligt af cron'en, og følger med i alarmens
extra-data når der ER noget at alarmere om).

Signalet er bevidst konservativt valgt. Et etapeløb midt i afvikling står som
`status='scheduled'` med `stages_completed > 0` (prod 4/8: 359 scheduled-løb, nogle med
13 kørte etaper), så et nyt brud på et løb der er i gang alarmerer stadig. Kun endeligt
afsluttede løb er tavse. Ukendt løbs-id regnes som levende (fail-open).

## Læring, der generaliserer

**En vagts alarm-betingelse skal være "kan nogen gøre noget ved det?", ikke "findes
fænomenet?".** Har du allerede beregnet et actionability-skel til brug i beskeden, så
brug det til at bestemme OM der skal sendes en besked. Det der ikke kan handles på,
hører til i en tæller eller en log, ikke i en fejl-kanal. Samme fælde som en test der
altid er rød: signalværdien falder til nul, og så er vagten reelt slukket, bare med
støj oveni.

## Verifikation

- 20/20 unit-tests i `riderDoubleBookingWatch.test.js` (5 nye: historik, kun-ét-afviklet,
  blandet tick, plus rene `splitLiveConflicts`-tests). Fuld backend-suite 5082/5082.
- Read-only prod-probe med ægte service-klient FØR merge:
  `{conflicts:4, live:0, historical:4, actionable:0, alerted:false}`, 0 Sentry-captures.
