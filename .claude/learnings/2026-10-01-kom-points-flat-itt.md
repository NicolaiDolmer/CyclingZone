# Postmortem: bjergpoint paa flad enkeltstart (#5956)

## Symptom
En spiller spurgte hvorfor nr. 1 paa en flad seniorenkeltstart fik "bjergpoint", selvom
ruten ingen stigninger havde og ingen rytter havde samlet trojepoint.

## Rod-aarsag (verificeret i prod read-only, ikke antaget)
- Passage-laget var korrekt: enkeltstarten havde ingen kategoriserede stigninger, ingen
  bjergpassager, og alle `stage`-raekker havde `kom_points = 0`. v4's ITT-mekanik og
  `racePassages.js` uddeler ikke bjergpoint paa maalstregen (maalet giver kun groenne point).
- Fejlen sad i troeje-klassementerne: `rankByCompDesc` rangerer HELE feltet, ogsaa naar alle
  har 0 point (tiebreak = rider_id). `raceRunner` skrev derefter `mountain_day` (og slut-
  `mountain`) med `points_earned` fra `race_points`-opslaget paa rank, saa rank 1 fik
  "holder troejen"-praemien uden at have scoret et eneste bjergpoint.
- Samme klasse som #5914 (ingen troejefoerer uden point) — den fix daekkede kun
  motor-inputtet, ikke praemie-udbetalingen.

## Fix
`raceRunner.pushIndiv` faar `awardPrize` (default true). Bjerg-klassementets raekker
(`mountain_day`, `mountain`) kalder med `awardPrize: score > 0`. Raekkerne bevares (fuldt
klassement, #2081), kun praemien kraever at rytteren har bjergpoint. Alle fire kaldesteder
(buildRaceResults + buildStageRowsAccumulated, mellem- og slut-etape).

## Laering
- En klassement uden point har hverken foerer eller praemie. Tjek score > 0 baade ved
  "hvem foerer" og ved "hvem faar praemie".
- Naar en spiller siger "point paa X": find FOERST hvilken kolonne/raekketype tallet staar i
  (her `points_earned` paa en `mountain_day`-raekke, ikke `kom_points`). Det sparede ikke
  tid denne gang: passage-laget blev undersoegt foerst og var uskyldigt.

## Aabent (ikke i denne PR)
Historiske raekker er IKKE omskrevet. Antal ramte afsluttede loeb staar i PR'en; en evt.
datareparation er en separat ejer-beslutning.
