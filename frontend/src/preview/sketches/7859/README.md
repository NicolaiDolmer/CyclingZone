# #7859 Spoiler-skjold: skitser

Selvstændig skitseside med tre varianter og et overblik med sammenligning og en anbefaling. Siden er ren HTML: den importerer intet fra appen, bygges ikke af Vite og bruger kun syntetiske data (opdigtet løb, ryttere og hold).

- Åbn `index.html` direkte i en browser. `?v=overblik` (standard), `?v=A`, `?v=B`, `?v=C`.
- Billeder ved 1440 og 390 px: `pr-screens/7859/7859-<visning>-<bredde>.png`. Navn og én sætning står brændt ind øverst på hvert billede.

## Varianter

| | Idé | Til/fra |
|---|---|---|
| A Forseglet etape | Hver kørt etape er forseglet overalt, til du åbner den. Filmen er én af to veje ind. | Indstilling + pr. løb |
| B Film først (anbefalet) | Etapen åbner i Historie. Vinderen kommer frem, når filmen når mål, eller ved "Spring til resultatet". | Indstilling + pr. løb + spørg én gang |
| C Sløret resultat | Alt står på sin vante plads, men navne og tal er sløret, til du trykker. | Øje-knap i topbjælken |

B er den eneste, der følger alle fire aftaler fra 7/11 (Q3, Q5, S1, S3 i `docs/superpowers/specs/2026-11-07-race-page-redesign-discord.md`).

## Hvor et resultat afsløres i dag (fil:linje, main 16/11)

Forside
- `frontend/src/components/TodayStagesStrip.jsx:107-110`: vindernavn på dagens etape-chip.
- `frontend/src/components/MyLatestResultCard.jsx:147, 337-338, 359`: "vandt"-tilstand og placeringer på kortet Seneste resultat (monteret i `pages/DashboardPage.jsx:704, 723`).

Løbsside
- `frontend/src/pages/RaceDetailPage.jsx:1510`: v6-heroen med etapebjælken (vindere pr. kørt etape i `components/race/v6/V6StageStrip.tsx:143-147`, data fra `components/race/v6/racePageV6Model.ts:277`).
- `frontend/src/pages/RaceDetailPage.jsx:1716`: overskriften i løbsreferatet ("X tager spurten").
- `frontend/src/pages/RaceDetailPage.jsx:2123, 2222`: trøjer efter etapen.
- `frontend/src/pages/RaceDetailPage.jsx:2149, 2186, 1986, 2006, 1310`: resultatlister (etape, klassementer, hold med vindermarkør `:2322-2333`).
- `frontend/src/pages/RaceDetailPage.jsx:1315, 2195`: Historien om etapen.
- `frontend/src/pages/RaceDetailPage.jsx:2207` og `components/race/FinalKilometrePlayback.jsx:102-108`: sidste kilometer med målrækkefølge.
- `frontend/src/components/race/v6/RacePageV6.tsx:244` og `V6YourDay.tsx:31`: Din dag med placeringer.
- `frontend/src/components/race/stagePageV2/StageStripV2.tsx:72`: din bedste placering i etapebjælken (v2).
- `frontend/src/components/race/stagePageV2/YourDayCard.tsx:91-105`: vinder og afstand i Din dag (v2).
- `frontend/src/components/race/stagePageV2/raceStoryModel.ts:778-785`: vinderlinje i referatet.
- `frontend/src/components/race/stagePageV2/FinaleView.tsx:293-297`: målrækkefølge i finalen.
- `frontend/src/pages/RaceCentrePage.jsx:282` og `components/race/RaceCentreCard.jsx:165-168`: podium på løbscentrets kort.
- `frontend/src/pages/ResultaterPage.jsx:514, 695`: podium pr. løb på Resultater.

Notifikationer (backend)
- `backend/lib/notificationService.js:799-811`: etaperesultat i indbakken (titel = referat-overskrift, besked med placering).
- `backend/lib/notificationService.js:469-490`: løbsresultat i indbakken.
- `backend/lib/pushService.js:76`: push-digest af de samme typer.
- `backend/lib/discordRaceDigestSweep.js:209, 224`: Discord-DM med dine placeringer.
- `backend/lib/emailRaceDigestSweep.js:225-238`: mail med bedste placering pr. løb.
- `frontend/src/pages/NotificationsPage.jsx:116-117`: viser og linker rækkerne.

Ranglister og historik
- `frontend/src/pages/StandingsPage.jsx:259`: sæsonstilling (point fra nye etaper).
- `frontend/src/pages/RiderRankingsPage.jsx:120`: rytterrangliste.
- `frontend/src/components/TeamResultsTab.jsx:78, 217`: holdets resultatfane.
- `frontend/src/pages/RiderStatsPage.jsx:92`: rytterens resultatfane.
- `frontend/src/components/ui/RiderHoverCard.tsx:172`: seneste resultater i hover-kortet.
- `frontend/src/pages/RaceHistoryPage.jsx:84-86`, `components/race/RaceHistoryLibrary.tsx:135`, `components/race/CompletedRacesExplorer.jsx:123, 288`: vindere i løbshistorik og arkiv.

Ikke gennemgået linje for linje: præstationer/bestyrelsesmål der udløses af en etapesejr, holdprofil og managerprofil. De skal med i byggeplanen.
