# Feltnavnet var rigtigt, kilden var forkert (#4245)

**Dato:** 2026-08-27
**Issue:** [#4245](https://github.com/NicolaiDolmer/CyclingZone/issues/4245)
**Fejlklasse:** latent SSOT-gæld. Et felt hed én ting og indeholdt en anden, og produktionsdata skjulte forskellen.

## Hvad var galt

`/api/races/distribution` returnerede `seasonLoadByRider[rider] = { races, raceDays }`. `raceDays` summerede kolonnen `races.stages`, altså ETAPETAL. Den spiller-vendte copy sagde ordret "løbsdage" / "race days" på begge flader og begge sprog.

Kodekommentaren skrev antagelsen ned i klar tekst:

```
// Løbsdage = løbets etape-antal (1 rytter = 1 løb/dag er ejer-design).
```

Det er forkert ifølge `docs/CALENDAR_RULES.md` §0: kalenderdag (`scheduled_at`) og løbsdag (`game_day`) er to uafhængige akser, og bindingen sker pr. `game_day`. To etaper på samme løbsdag er ÉN løbsdag for rytteren.

## Hvorfor det aldrig blev opdaget

Fordi tallet var rigtigt. Verificeret read-only mod prod: alle 529 løb i den aktive sæson har `stages` == antal distinkte `game_day`, så etapetal og løbsdage gav identiske resultater for hver eneste rytter. Fejlen havde ligget siden feltet blev født (commit 73966b011, #3102 etape 3 PR 2) og ville først bide i det sekund pakkeren lagde to etaper på samme løbsdag.

Det er den farligste form for gæld: den er usynlig i data, usynlig i UI, og den ser rigtig ud i koden, fordi antagelsen står skrevet som om den var en regel.

## Læringen

**1. En kodekommentar der forklarer en antagelse er et sted at lede efter fejl, ikke et bevis på at antagelsen holder.** Kommentaren her var velskrevet og selvsikker. Den var også forkert. Når en kommentar oversætter mellem to begreber ("løbsdage = etape-antal"), er den en påstand der skal krydses mod SSOT, ikke en forklaring man læser forbi.

**2. Når et feltnavn og dets datakilde er uenige, er det som regel kilden der er forkert.** Fristelsen var at omdøbe feltet til "etaper" og kalde det løst. Men copyen på fire i18n-filer, to flader og begge sprog sagde "løbsdage", og `docs/PLANNING_CENTER_RULES.md` §5 listede belastnings-linsens grundlag som `load.raceDays`. Navnet var det eneste i kæden der var rigtigt. Ret kilden, ikke navnet.

**3. Latent betyder ikke harmløst, og "ingen adfærdsændring" gør fixet svært at verificere, ikke let.** Fordi ændringen er et rent no-op mod nuværende prod-data, kunne ejeren ikke SE forskellen nogen steder. Løsningen var at give preview-mocken et løb med to etaper på samme løbsdag (Alpine Classic: 6 etaper, 5 løbsdage). Uden det ville PR'en være umulig at verificere manuelt, og den eneste evidens ville være "stol på mig".

**4. Backwards-check fandt fejlen igen, i en anden kodesti.** `plannerSquadModel.riderSeasonLoad` summerede også `race.stages` klient-side og viste det som "løbsdage" med samme copy. To flader, samme fejl, uafhængige implementeringer. At rette kun den rapporterede forekomst ville have efterladt to skærme der viser forskellige tal for samme rytter. Grep efter FEJLKLASSEN (hvem summerer stages og kalder det dage), ikke efter det rapporterede symptom.

**5. Et spænd er ikke et antal, men det er heller ikke en fejl.** `raceGameDaySpan` i `raceBinding.js` ligner den rigtige helper og er en fælde: den giver `{start, end}`. La Corsa dei Due Mari har 7 etaper på løbsdag 10, 13, 17, 20, 23, 27, 28, og `end - start + 1` giver 19. Til BELASTNING duer kun de distinkte værdier: det er de dage rytteren faktisk kører på. Til BINDING er spændet derimod det rigtige og det tilsigtede, jf. ejer-direktivet 25/8 ([#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4217), `docs/CALENDAR_RULES.md` §2b + §8) - man forlader ikke et etapeløb midtvejs. To tal, to formål.

**6. En kildehenvisning er en påstand, præcis som kommentaren omkring den.** Første udgave af dette fix begrundede distinkt-tællingen med "(#4209)" i både kodekommentaren og en test-assertion. [#4209](https://github.com/NicolaiDolmer/CyclingZone/issues/4209) hedder "GT-hviledage skal binde rytteren" og argumenterer det modsatte: rytteren ER bundet hen over springene. Hjemlen for det rigtige tal lå i `raceBinding.js:50-52` og i `CALENDAR_RULES.md` §2b, og den stod der allerede da PR'en blev skrevet. Læring 1 gælder også issue-numre: åbn issuet, læs titlen, tjek at det siger det du citerer det for. Fundet af en adversarisk verifikator, ikke af mig.

**7. Halvdelen af feltet var forkert på en helt anden måde.** `raceDays` blev rettet til distinkte `game_day`, men `races` og `raceDays` blev begge talt over ALLE holdets entries, uden sæsonfilter, mens chippens copy sagde "tilmeldt denne sæson". Målt i prod 27/8: 69.115 af 94.712 entries var fra tidligere sæsoner, 2.367 af 4.854 ryttere fik et for højt tal, værst 56 løb vist for en rytter med 0 i den aktive sæson. Den rettede halvdel var et no-op mod prod; den urettede halvdel løj højlydt hver dag. Når man retter et felt, så tjek HELE feltet, ikke kun det led issuet peger på.

**8. To flader der skal vise samme tal skal også fejle ens.** Race Hub faldt til 1 løbsdag når et løb manglede `game_day`-rækker; planner-boardet faldt til etapetallet. Latent i dag (0 løb med null `game_day` i prod), men det er præcis den divergens PR'en fandtes for at fjerne, bare flyttet ned i fallback-grenen. Fallbacket bor nu ét sted, i `raceDaysByRace`.

**9. To systemer må ikke låne hinandens ord.** `help.json` definerede "løbsdag" som sponsorernes betalings-enhed ("én etape dit hold stiller til start i"), mens kalenderen definerer den som den in-game-dag der binder rytteren. Samme ord, to tal. Ejer-beslutning 27/8: løbsdag betyder bindings-enheden. Sponsor-økonomien hedder nu ETAPE i al spiller-vendt tekst. Økonomien er uændret, kun ordene.

## Hvad der forhindrer gentagelse

- To rene helpers (`raceDaysByRace`, `seasonLoadByRider`) i `backend/lib/raceDistribution.js`. Løkken lå inline i route-handleren og var derfor utestbar. Det er hele grunden til at der var nul dækning.
- `backend/lib/seasonLoadRaceDays.routes.test.js`: kilde-scan-guard der fejler hvis en inline `raceDays +=` sniger sig tilbage i belastnings-blokken, hvis `seasonRaceIds` forsvinder fra wiringen, eller hvis de to flader holder op med at dele fallback. (`stagesByRaceId` var oprindeligt forbudt af guarden; det er nu det bevidste fælles fallback, så guarden kræver i stedet at det kun bruges som navngivet option til `raceDaysByRace`.)
- Regressionstesten der VILLE have fanget det: to etaper med samme `game_day` skal give 1, og spring i serien må ikke give ekstra dage.
- `plannerSquadModel.test.js` asserterede aktivt den FORKERTE regel ("løbsdage (etaper)"). En test der cementerer fejlen er værre end ingen test: den giver falsk tryghed ved næste refaktorering. Den er rettet.
