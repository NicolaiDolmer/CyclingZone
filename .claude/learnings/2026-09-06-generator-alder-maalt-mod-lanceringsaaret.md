# Postmortem · 2026-09-06 · Generatoren målte alder mod lanceringsåret, ikke mod sæsonen (#4876)

## Hvad skete der?
Fra 5/9 kl. 23:56 fejlede `starterSquadHealSweep` hvert 5. minut i ~10 timer
(~120 kørsler) med `deriveForRiderIds: partielt derive — 1 uden base_value`.
Et ægte, nyt spillerhold havde fået en start-trup-rytter der slet ikke kunne
værdisættes: `base_value` og `salary` NULL, `market_value` 1.000. Heal-sweepen
kunne aldrig lykkes, og `rider-derive-heal` stod dermed permanent "overskredet" i
cron-heartbeat-vagten — den alarm var reelt døv så længe loopet kørte.

## Root cause
Tre led, hvor kun det første er en egentlig fejl:

1. `fictionalRiderGenerator.buildDemographics` klamper alderen til `[18, 39]` mod
   `referenceYear` (`birthYear = referenceYear − age`), og `starterSquadAllocator`
   defaultede `referenceYear` til `LAUNCH_POPULATION.referenceYear` (2026 = sæson
   1). I sæson 3 (referenceår 2028) blev en "39-årig" derfor født i 1987 og fik
   **sæson-alder 41** — to år over generatorens eget loft.
2. `simulateCareer` (`riderCareerNpv.js`) brød karriere-loopet på `age_s > 40`
   FØR sæson 0 blev talt med, så `npv = 0` og `predictBaseValueV4` returnerede
   `null`. Grænsen i sig selv er rigtig: spillet pensionerer garanteret ved
   sæson-alder 40 (`PROGRESSION_CONFIG.retirement.guaranteedAge`).
3. Kilde-guarden i `deriveForRiderIds` (#1673) kaster ved manglende `base_value`.
   Den gjorde præcis sit arbejde — men blev umulig at tilfredsstille, så fejlen
   blev til et uendeligt loop i stedet for en enkelt hændelse.

Afgrænsningen var **kendt og dokumenteret** i koden som "ÆRLIG AFGRÆNSNING"
(`starterSquadAllocator.js`, #3591): "Fra sæson 2 er de to ét år fra hinanden …
den er hverken indført eller lukket her". Den blev korrekt beskrevet, korrekt
afgrænset — og aldrig fulgt op. Så voksede den med ét år pr. sæson, indtil den
i sæson 3 ramte pensionsalderen og eksploderede.

## Fix
- `starterSquadAllocator.js`: begge indgange (`allocateStarterSquadForTeam`,
  `runStarterSquadAllocation`) defaulter nu `referenceYear` til `null` og udleder
  den af den AKTIVE sæson via `seasonReferenceYear(startSeason)`. Et eksplicit
  `referenceYear` (harnesses, launch-replay) vinder stadig. `startSeason` blev
  allerede hentet i begge stier — ingen ekstra rundtur.
- `riderCareerNpv.js`: alders-grænsen gælder nu kun fremskrivningen
  (`s > 0 && age_s > 40`). Sæson 0 tælles altid med, så modellen er TOTAL — en
  gyldig rytter kan ikke længere værdisættes til "ingenting" alene på sin alder.
  Målt værdi-neutral: aldre ≤ 40 giver bit-identiske tal før og efter (verificeret
  mod hovedcheckoutets uændrede kode), og 8.023 af 8.024 aktive ryttere er ≤ 40.

## Forhindret-fremover
Tre nye tests, alle verificeret RØDE mod den gamle kode før merge:
- `#4876 forward-guard` kører den ÆGTE generator gennem signup-stien i sæson 3 og
  afviser enhver start-trup-rytter på/over `guaranteedAge`. Hold-id'erne er målt
  frem som netop dem der fejlede under 2026-aksen — vagten er altså ikke
  sandsynlighedsbaseret.
- `#4876 totalitet`: ingen alder 18-60 må give `null` base_value.
- `#4876 værdi-neutral`: sæson 0 er altid rytterens egen alder for alle ≤ 40.

Måling af den gamle adfærd over 200 simulerede nye hold: 27 af 2.400 ryttere
(1,1 %) lå på/over pensionsalderen — ca. én dud pr. 8 nye hold, hvilket matcher
de 7 ramte menneskehold målt i prod. Efter fixet: 0 af 2.400, højeste
sæson-alder 39.

## Læring
**En "ærlig afgrænsning" i en kodekommentar er en udskudt fejl, ikke en lukket
sag.** Kommentaren beskrev divergensen præcist og valgte bevidst ikke at lukke
den — men afgrænsningen VOKSEDE med tiden (ét år pr. sæson), og ingen holdt øje.
Når en kendt divergens er tids- eller sæson-afhængig, skal den enten lukkes med
det samme eller have en vagt der fælder den når den bliver farlig; en kommentar
alene er kun en note til den der læser filen bagefter.

Sekundært: **en kilde-guard der ikke kan tilfredsstilles bliver til et loop.**
#1673-guarden var rigtig og fangede fejlen — men fordi den sad i et job der
retryer hvert 5. minut, blev signalet til støj der samtidig gjorde
heartbeat-alarmen døv. Guards i retry-loops bør kunne skelne "prøv igen" fra
"dette kan aldrig lykkes".
