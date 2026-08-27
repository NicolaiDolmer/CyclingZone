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

**5. Et spænd er ikke et antal.** `raceGameDaySpan` i `raceBinding.js` ligner den rigtige helper og er en fælde: den giver `{start, end}`. La Corsa dei Due Mari har 7 etaper på løbsdag 10, 13, 17, 20, 23, 27, 28, og `end - start + 1` giver 19. Springene i serien er ikke løbsdage (#4209). Kun DISTINKTE værdier duer.

## Hvad der forhindrer gentagelse

- To rene helpers (`raceDaysByRace`, `seasonLoadByRider`) i `backend/lib/raceDistribution.js`. Løkken lå inline i route-handleren og var derfor utestbar. Det er hele grunden til at der var nul dækning.
- `backend/lib/seasonLoadRaceDays.routes.test.js`: kilde-scan-guard der fejler hvis `stagesByRaceId` eller en inline `raceDays +=` sniger sig tilbage i belastnings-blokken.
- Regressionstesten der VILLE have fanget det: to etaper med samme `game_day` skal give 1, og spring i serien må ikke give ekstra dage.
- `plannerSquadModel.test.js` asserterede aktivt den FORKERTE regel ("løbsdage (etaper)"). En test der cementerer fejlen er værre end ingen test: den giver falsk tryghed ved næste refaktorering. Den er rettet.
