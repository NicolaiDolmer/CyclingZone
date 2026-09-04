# 2026-09-04 · Tre merges på ét minut genstartede backend midt i en etapeafslutning

## Hvad skete
Kl. 12:00-12:01 mergede orkestratoren tre backend-PR'er (#4763, #4770, #4761) lige efter
hinanden. Railway redeployer ved hvert push til main, så containeren genstartede tre gange
inden for to minutter, netop mens 12:00-slottets 14 etaper var forfaldne. Tour de la Provence
Verte fik sidste etape afbrudt efter result-write, før status-flip. Den nye vagt
(#4147, `runHalfFinalizedRaceWatch`) alarmerede korrekt kl. 12:17 (CYCLINGZONE-5G);
scheduleren genkørte etapen kl. 12:19 (deterministisk seed), og kæden løb færdig 12:21.

## Hvorfor
- Merge-bølgen blev kørt på "CI grøn" alene, uden at tjekke om etaper var forfaldne eller ved
  at afslutte. Scheduleren kører hvert 5. min; etaper starter på hele timer; afslutningskæden
  tager 90-110 s pr. etape.
- Railway-deploy ved push til main gælder også docs- og frontend-only commits (hele repoet
  bygges), så selv "ufarlige" merges genstarter motoren.

## Regel fremover
- **Merge-vindue:** aldrig mellem hh:58 og hh:25 (etape-slot + kæde + 5-min-tick). Tjek
  `race_stage_schedule` for forfaldne etaper og `races` med `stages_completed >= stages` og
  status ≠ completed FØR hver merge; 0 begge steder = klar.
- **Ét push pr. bølge:** saml backend-PR'er, merge dem i ét vindue, vent på at containeren er
  oppe og første scheduler-tick er rent, før næste.
- Med `race_finalize_resumable_enabled = on` (#4147, ejer-go afventer) heler kæden selv; indtil
  da er vinduet den eneste beskyttelse.

Refs #4147 CYCLINGZONE-5G #4753
