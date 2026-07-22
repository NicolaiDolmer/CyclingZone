# Uniform lodtrækning kan ikke garantere en definerende egenskab

**Dato:** 2026-07-22 · **Issue:** [#2781](https://github.com/NicolaiDolmer/CyclingZone/issues/2781) · **PR:** [#2782](https://github.com/NicolaiDolmer/CyclingZone/pull/2782)

## Hvad gik galt

`raceRouteGenerator.js` gav high_mountain-etaper deres kategorier ved at trække
uniformt fra `["HC","1","2"]` pr. stigning. Det gør HC til et *muligt* udfald, ikke
en *garanteret* egenskab — og en high_mountain-etape uden HC er per definition ikke
høj-bjerg. Med 2-4 stigninger pr. etape er P(0 HC) = (2/3)^n ≈ 20-44%.

Symptomet dukkede først op ét niveau højere oppe: over 21 etaper gav lotteriet en
grand tour 1 HC (bånd 3-8), mens en anden etape fik `[HC,HC,HC,HC]`.

## Rodårsag (klassen, ikke instansen)

En vægtet/uniform fordeling udtrykker "hvor ofte", ikke "mindst én". Når et
domænekrav lyder **"denne ting SKAL have X"**, skal X tildeles deterministisk og
resten trækkes — ikke omvendt. Fordelingen kan ikke bære en invariant.

Det gælder bredere end ruter: enhver generator hvor en arketype har en definerende
egenskab (en akademi-rytter der skal have ét udviklingstalent, et hold der skal have
en kaptajn, et løb der skal have en målspurt).

## Forward guard

Tre tests i `raceRouteGenerator.test.js` over 60+ race-identiteter: HC findes, HC er
klimakset, præcis 1 pr. etape — plus en negativ test på at HC forbliver eksklusiv for
high_mountain.

## Metode der virkede: mål varianterne, gæt ikke

Fix-idéen (ekstra HC på "queen stages") lød rigtig, men målt over 2000 syntetiske
grand tours **forværrede** den toppen af fordelingen: den fixede bundtailen (0-1 HC)
og flyttede fejlmassen op (hale til 16 HC), fordi en GT kan trække op til 10
high_mountain-etaper. Den simplere regel — præcis én HC pr. etape — gav 9,7% bånd-brud
mod 10,8% og 27,8%. Uden harness havde jeg shippet den dårligere variant.

Jf. [[feedback_simulate_before_ship_balance]]: balance-følsomme systemer skal måles
empirisk mod en population, ikke vurderes på ét eksempel.

## Bevaret invariant værd at genbruge

Puljetrækket beholdt sit **antal** rng-kald (pulje 3 → 2 elementer, samme n draws), så
alle efterfølgende træk (længder, gradienter, sprints, sektorer) bevarede deres
strøm-offset. Resultat: distance og antal stigninger blev bit-identiske med før
(3285/40, 3361/36, 3391/35) — hvilket i sig selv var beviset for at ændringen var
isoleret til kategorierne.

## Kendt tilstødende risiko (ikke fixet her)

- `CLIMB_SPEC.mountain` = `["1","2","3"]` kan give en bjergetape udelukkende cat-3.
  Samme klasse, men ingen scorecard-gate og mildere konsekvens.
- De resterende 9,7% bånd-brud er en **pass-1**-egenskab: `grand_tour` garanterer kun
  2 high_mountain-etaper og filleren kan give 10. Ligger i `raceStageProfileGenerator.js`
  og var eksplicit uden for scope ("ingen pass-1-påvirkning").
