# BOARD_RULES sagde eet checkpoint, koden har to (#4382)

**Dato:** 31/8 2026 · **Issue:** #4382 · **Klasse:** doc-drift + forkert udledning i triage

## Symptom

Tre erfarne spillere kunne 28/8 ikke svare hinanden paa hvornaar bonustilbuddet kommer.
En af dem: "I foerste saeson kom de foerst helt til sidst. I anden saeson fik jeg det allerede
cirka midtvejs." Det lyder som tilfaeldighed. Det er det ikke.

## Rod-aarsag

To dokument-fejl, ikke en kode-fejl.

1. `docs/BOARD_RULES.md` §4 skrev at "lag 2-6 lever i `board_consequences` og evalueres ved
   saeson-slut". Koden evaluerer paa **to** checkpoints: `boardWeekendFinalization.js:471-473`
   kalder `evaluateAndApplyConsequences` naar `race_days_completed` krydser
   `floor(race_days_total / 2)`, og `economyEngine.js` kalder den igen ved saeson-slut.
   Mid-season-checkpointet blev tilfoejet efter at SSOT-saetningen blev skrevet, og saetningen
   blev ikke rettet. Spillerens "tilfaeldige" timing er praecis de to checkpoints.
2. Samme fil havde bulletten "Saeson 1 er observationsaar. Ingen konsekvenser, kun referat" i
   listen over "grundregler der aldrig har aendret sig". `economyEngine.js:1632-1642` baerer
   ejer-beslutning #1721 af 22/6: saeson 1 er IKKE en observations-saeson. Kun
   `is_baseline`-profiler springes over. Reglen blev aendret i koden og overlevede i SSOT'en.

## Den fejl jeg selv naesten gentog

Triage-kommentaren paa issuet konkluderede at `faq.bonusOffer`s saetning "the target is added to
your 1-year plan" kun var sand for 66 af 94 tilbud, fordi 28 tilbud var udloest af en 3- eller
5-aarsplan. Det er en forkert udledning: den blander **hvilken plan der udloeser tilbuddet**
sammen med **hvilken plan maalet lander paa**. `api.js:15125-15145` slaar eksplicit
`plan_type = "1yr"` op naar tilbuddet accepteres, uanset `source_board_id`. Saetningen var altsaa
korrekt, bare ufuldstaendig. Havde jeg rettet efter triagen i stedet for efter koden, havde jeg
skrevet en ny fejl ind i hjaelpen med en maalt tabel som daekning.

Maalte tal er ikke det samme som en maalt konklusion. Tabellen var rigtig; slutningen fra den var forkert.

## Fix

- Nyt samlet afsnit `sections.board.multiYearLifecycle` i `help.json` (EN+DA): loebetid,
  midtvejs-review, udloeb og nulstilling, obligatorisk genforhandling, bonustilbud fra alle tre
  plantyper paa to checkpoints.
- `faq.bonusOffer` praeciseret begge veje: tilbuddet kan komme fra enhver af de tre planer,
  ekstra-maalet lander altid paa 1-aarsplanen.
- `docs/BOARD_RULES.md`: §4's checkpoint-saetning rettet, lag 6's traerskel rettet fra ">= 75"
  til strengt "> 75" (`isBonusOfferEligible` afviser `satisfaction <= 75`), saeson-1-bulletten
  rettet, og en ny §1.1 der beskriver plan-livscyklussen.

## Forward-guard

`backend/lib/boardMultiYearHelpClaims.test.js` (10 tests). Hvert udsagn i hjaelpe-afsnittet er et
udsagn om koden, saa hvert udsagn har nu en vagt: planlaengder mod `PLAN_DURATIONS`,
midtvejs-punktet mod `Math.floor(planDuration / 2)`, udloebs-nulstillingen mod
`economyEngine.js`, pending-planer mod `computeBoardBaseModifier`, 75 %-traersklen mod
`isBonusOfferEligible`, 1yr-attach mod `api.js`, og to-checkpoint-paastanden mod baade
`boardWeekendFinalization.js` og `economyEngine.js`. Samme princip og placering som
`handheldCopyGuards.test.js` (#3681): naar to steder skal vaere ens, testes vaerdierne, ikke formen.

## Laering

En SSOT der beskriver "hvad der koerer i dag" forfalder praecis der hvor koden fik en ny gren.
Baade fejl 1 og 2 er en **tilfoejelse** i koden (et ekstra checkpoint, en ejer-beslutning) som
ingen gik tilbage og trak igennem dokumentet. Derfor er den billigste vagt ikke at laese
dokumentet igennem, men at pinne dets paastande til koden som en test.

## Fund der IKKE er rettet her

`expireSeasonScopedConsequences` (`boardConsequences.js:167`) kaldes ingen steder i
produktionsstien; kun fra sin egen test. Lag 5 udloeber via en separat inline-update i
`economyEngine.js:471`, mens **lag 6 aldrig udloeber**. Maalt 31/8: 37 bonustilbud staar stadig
`active` paa saeson 1 og 2, som begge er `completed`. Et fix fjerner 200.000 CZ$ i mulig
indloesning fra 37 hold og er derfor en ejer-beslutning, ikke en natboelge-aendring. Noteret som
modsigelse 9 i `BOARD_RULES.md` §7 og som opfoelgning paa PR'en.
