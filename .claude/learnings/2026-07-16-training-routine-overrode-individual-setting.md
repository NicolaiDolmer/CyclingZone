# Postmortem · 2026-07-16 · Ugentlig træningsrutine overtrumfede individuel rytter-indstilling (#2438)

## Hvad skete der?
@thelamba satte holdets ugentlige træningsrytme til "hard" og satte enkelte egne
ryttere til "light training"/"rest". Alle ryttere trænede alligevel hard. Han
endte med helt at droppe rytme-featuren igen ("Now my entire racing team is
dead"). Ejeren bekræftede at UI'et modsiger sig selv ("train their own focus"
antydede at intensitet også var rytterens eget valg).

## Root cause
`resolveDayIntensity` (backend/lib/training.js, delt med frontend-visningen
i frontend/src/lib/training.js) rangerede laget "holdets ugerytme" over
"rytterens egen sæson-intensitet" (`training_plans.intensity`) ubetinget.
En eksplicit rytter-plan blev derfor altid overskrevet af rytmen, medmindre
manageren VIDSTE at åbne den separate, mindre synlige "Individuel ugeplan"-
flade (#1895 PR 2) og satte en pr-dag-override der. Den almindelige
intensitets-knap på rytterens egen række var reelt kosmetisk, når en rytme var
aktiv.

## Fix
`resolveDayIntensity`/`resolveDayIntensityDisplay` fik en ny parameter
`hasExplicitPlan` (rytteren har selv sat focus+intensity). Ny prioritet:
individuel ugeplan-override > rytterens EGEN eksplicitte plan > holdrytmen
(kun DEFAULT for ryttere UDEN egen override) > sæson-fallback. Ændret i:
- `backend/lib/training.js` (resolveDayIntensity)
- `backend/lib/dailyTrainingEngine.js` (sender hasExplicitPlan pr. rytter)
- `frontend/src/lib/training.js` (resolveDayIntensityDisplay + ny
  resolveDayIntensitySource)
- `frontend/src/pages/TrainingPage.jsx` (viser altid dagens effektive
  intensitet + kilde når en holdrytme er aktiv, for ALLE ryttere, ikke kun
  ved "differs")
- `help.json`/`training.json` (en+da): "own focus"-teksten omskrevet til
  eksplicit at nævne at rytterens EGEN intensitet vinder over rytmen.

## Forhindret-fremover
Regressionstests i `backend/lib/training.test.js` og
`backend/lib/dailyTrainingEngine.test.js` låser den nye kontrakt fast
(rytter med egen plan "rest" holder rest selv når holdrytmen er "hard" på
alle dage). To EKSISTERENDE tests testede tidligere den GAMLE (buggy)
adfærd eksplicit — de er omskrevet til at demonstrere at rytmen kun er
default for ryttere UDEN egen plan.

## Læring
En "lagdelt" precedence-funktion med kommentarer der beskriver rækkefølgen
er ikke nok — når to UI-flader (season-intensitet-knap vs. ugerytme) kan
begge sætte samme underliggende værdi, skal koden selv skelne "rytteren
valgte dette eksplicit" fra "dette er bare en default-fallback". Uden det
skel vinder den forkerte af to lige-gyldige signaler, og spilleren oplever
det som at spillet ignorerer et direkte valg de lige har foretaget.
