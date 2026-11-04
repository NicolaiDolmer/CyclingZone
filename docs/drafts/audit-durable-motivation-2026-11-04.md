# Del B: spillerforløb, beviser og overlap

4. november 2026 · Refs #7495. Læsende analyse på main `002ba2348`, med GitHub og SELECT-data hentet samme dag. Ingen browsergennemspilning eller nye spillerinterviews. Ejerens skærmadgang er lukket.

## Spillerens tilbagevendende forløb

| Område | I en session | Gennem ugen | Over flere sæsoner | Eksisterende grundlag |
|---|---|---|---|---|
| Sæson og klubretning | Se placering, mandat, aktuelle frister og kommende løb. | Prioritér mellem konkurrencer og vurder fremgang. | Oprykning/nedrykning, sæsonafslutning, nyt mandat og fortsat klubidentitet. | `SeasonEndPage.jsx`, `boardMandate.js`, `seasonTransition.js`; CALENDAR_RULES, BOARD_RULES. |
| Økonomi | Vurder likviditet, tilbud og kontraktforpligtelser. | Afvej løbsdeltagelse, træning og rekruttering med de eksisterende prognoser. | Finansier næste trup og investeringer uden at forveksle markedsværdi, produktionsværdi og frossen kontraktløn. | Økonomiprognose, `financeForecast.ts`, `contractSeed.js`; ECONOMY_RULES og SPONSOR_RULES. |
| Træning og udvikling | Læs faktisk aktivitet/kvittering, evneændringer og aktuel tilstand. | Brug hold-/rytterugeplan, programmer, grupper og træthedsregler; revurdér kun når relevant. | Udvikling, aldring, potentialeskøn og valg af fremtidige nøgleryttere. | `TrainingPage.jsx`, `useTraining.js`, `trainingReport.js`, `TrainingHistory.jsx`; TRAINING_RULES, PROGRESSION_RULES. |
| Løb | Vælg udtagelse/roller/taktik; følg det dokumenterede resultat. | Fordel ryttere mellem overlappende løb og restitution. | Sæsonmål, rivaler, palmarès og udvikling af en ny generation. | `RaceTeamTab.jsx`, `RaceStoryCard.tsx`, `myTeamLatestResult.js`; RACE_ENGINE_RULES, PLANNING_CENTER_RULES. |
| Transfer og kontrakter | Vurder køb, salg og tilbud efter gældende frister. | Brug alternative kandidater; afvej en handel mod det kommende program. | Erstat afgange eller sælg udviklede ryttere; kontrakt- og likviditetskonsekvenser følger klubben. | `transferExecution.js`, `auctionFinalization.js`, offentlig handelshistorik i `RiderHistoryTab.jsx`; TRANSFER_MARKET_RULES. |
| Akademi og ungdom | Vurdér tilbud og trupplads; se udvikling. | Vælg programmer og løb, følg intake og relevante varsler. | Graduering, generationsskifte, salg og tilknytning til tidligere ryttere. Ungdom er ikke et tvunget klubmål. | `academyGraduation.js`, intake og træningssystemet; YOUTH_RULES, SOCIAL_RULES. |

En typisk tilbagevenden kan derfor beskrives som: se aktuelle konsekvenser og frister, forstå eget holds forløb, genovervej relevante planer, forbered næste periode og forlad spillet med noget meningsfuldt at følge. Tabellen er en kildebaseret kortlægning af valg, ikke en måling af en bestemt managers brug.

## Beviskæden for de tre hypoteser

| Hypotese | Kode og kontrakt | Aktuelle data | Spillerudsagn og begrænsning | Eksisterende issue-ejer |
|---|---|---|---|---|
| En løbsrapport eller historisk rapport hjælper ikke tilstrækkeligt videre til næste gemte opgave | `NextActionsCard.jsx` får opgavestatus, ikke rapportændringer. Men `TrainingPage.jsx` samler allerede kvittering, tilstand, prognose, dagsændring og samme rytters ugeplan i ét rytterkort. A må ikke genopfinde denne integration. | Gemte ugeplaner og ikke-autofyldte udtagelser findes blandt både nye og etablerede aktive managers. Der findes ikke i denne analyse en måling af forståelse eller af et fuldt løbsrapport→kommende opgave-forløb. | #7557/#7625 giver aktuelle, konkrete rapporter om uoverensstemmelse mellem intention, film og information. De kræver korrekthedsarbejde; de beviser ikke behov for A's navigation. #931s krav om plan-genbesøg er en ejerretning, ikke et spillerinterview. | #5101/#7266, #6350/#7643, #931 og #1369. |
| Den samlede uge kræver for meget rekonstruktion | Matrix, ugeplaner, grupper og regler er til stede. PLANNING_CENTER_RULES §0 og det nyere #7535-design afgrænser de resterende arbejdsflader. | Planændringer og manuelle udtagelser kan tælles. Timestamps er ikke brugertid; en planrække er ikke dokumentation for, at spilleren forstår opløsningen af sin plan. | #6952 rummer modsatrettede ønsker om overlap. #7456 giver et nyere konkret eksempel på program/hvile-friktion. Hele ugen efter de seneste ændringer er ikke målt. | #7535 i bero; #6952/#6739, #931/#7456. |
| Klubben mangler tydelige tegn på fremgang på sin valgte langsigtede vej | `SeasonEndPage.jsx` har recap, honours, documentary og board verdict. `RiderPalmaresTab.jsx` læser karriereevents; `RiderHistoryTab.jsx` viser handelshistorik. BOARD_RULES §0.4 og YOUTH_RULES beskriver talentfabrikken som legitim vej. | Mandater, visionsmilepæle, bestyrelsessnapshots og aktuelle karriereevents findes. De observerede karriereevent-typer i det afgrænsede vindue er sportslige. Det er ikke et bevis på, at alle andre historikkilder mangler. | #6950/#6951 beskriver bekymringer om udviklingsvejen og markedet. #5180 er en staff-idé om tilknytning til en rytter, ikke et bredt spillersignal. Ingen måling viser endnu, at et museum eller en ny milepæl løser disse bekymringer. | #7167, #2490/#1148/#1106; #6951. #6950s ejerbeslutning afventes særskilt. |

## De vigtigste konkrete kodefund

- [NextActionsCard](../../frontend/src/components/NextActionsCard.jsx) samler udestående opgaver og ugentlige tidspunkter. Økonomisk risiko og Deadline Day har allerede egne placeringer. Et nyt topkort må ikke duplikere dem.
- [DashboardPage](../../frontend/src/pages/DashboardPage.jsx) viser `MyLatestResultCard` og `NextActionsCard` ved siden af hinanden. [myTeamLatestResult](../../backend/lib/myTeamLatestResult.js), funktionen `buildSeasonHistory`, viser eksisterende resultathistorik inden for sæsonen.
- [TrainingPage](../../frontend/src/pages/TrainingPage.jsx), `renderRiderCard` og `riderCardFooter`, samler allerede kvitteringsrækker, træthed, prognose, dagsændring og direkte adgang til samme rytters ugeplan. Det er sammenligningsgrundlaget for B. [useTraining](../../frontend/src/lib/useTraining.js) sender events ved gemt hold- og rytterugeplan. Disse events alene dokumenterer ikke, at en ændring kom efter forståelse af en rapport; en uændret plan kan være korrekt.
- [TrainingHistory](../../frontend/src/components/training/TrainingHistory.jsx) bruger dagskvitteringer. [PROGRESSION_RULES](../PROGRESSION_RULES.md) og [TRAINING_RULES](../TRAINING_RULES.md) skelner faktisk aktivitet, afregning, historisk grundlag og ukendt tilstand.
- [SeasonEndPage](../../frontend/src/pages/SeasonEndPage.jsx) henter `get_season_recap`, honours, documentary og bestyrelsesdom. En ny sæsonopsamling er ikke et tomt område.
- **Supplerende kontrol efter ejerens mockup-feedback 4/11:** [StagePageV2](../../frontend/src/components/race/stagePageV2/StagePageV2.tsx) har allerede en knap fra [YourDayCard](../../frontend/src/components/race/stagePageV2/YourDayCard.tsx) til næste åbne etapes taktik. Det styrker sammenligningsgrundlaget B og afgrænser en mulig rest til rytterfokus eller en anden gemt opgave. Det er forkert at præsentere adgang til næste etape som en manglende funktion.
- [RiderHistoryTab](../../frontend/src/components/rider/profile/RiderHistoryTab.jsx) er offentlig handelshistorik. [RiderPalmaresTab](../../frontend/src/components/rider/profile/RiderPalmaresTab.jsx) læser særskilt `rider_career_events`. De to kilder må ikke slås sammen til en påstand om en fuld udviklingsbiografi.

## SELECT-grundlag og kildegrænser

Rå SQL, resultater og måletidspunkter ligger privat i `balance-internals/growth/del-b-2026-11-04/select-evidence.json`. Den endelige tværgående opgørelse bruger den dokumenterede aktivitetsunion i ANALYTICS_STACK, menneskehold uden test-/bankmarkering og ét fast observationstidspunkt. Nye og etablerede managers vises særskilt. Et supplerende statusopslag kontrollerer de faktiske statusværdier frem for at antage dem.

Målingen viser, at systemernes byggesten er til stede hos aktive spillere. Den beviser ikke, hvem der skrev en plan, om en rapport blev læst, eller om en bestemt funktion gav fastholdelse. Fravær af en gemt ugeplan er heller ikke fravær af træning: defaults og andre planlag findes.

Markedskontrollen viser nylige auktioner og accepterede direkte tilbud. Et `completed`-flag er ikke i sig selv et realiseret salg; et accepteret tilbud er ikke i sig selv bevis på afsluttet ejerskab/pengeafregning. Udbud, salgstid, genopslag, typer og realiserede handler er ikke afstemt i denne del B. Derfor er #6951 ikke erklæret løst eller udpeget som en målt ny hovedflaskehals.

Del A's målinger fra 4/11 genbruges med deres forbehold: serverens første resultat er ikke menneskelig aktivering; resultat ved snapshot er ikke bevis for, at resultatet var klart før sidste besøg; rolling return er ikke aktivitet præcis på dag N. Forskellig samtykke- og identitetsdækning må ikke blandes til én tragt. De private tal er ikke kopieret hertil.

Live-Discord-læsning mislykkedes, fordi connectoren ikke har et konfigureret login. Den blev ikke omgået med skærmadgang. Spillerudsagn er derfor læst i de navngivne GitHub-issues med daterede Discord-kilder. Ældre triageforslag er ikke behandlet som nutidig runtime eller ejerbeslutninger.

## Åbne og lukkede emner kontrolleret

| Eksisterende emne | Observeret GitHub-status 4/11 | Konsekvens for del B |
|---|---|---|
| #2288, #2886 | Lukkede | Næste-handling-UX og resultathistorik er leverede byggesten, ikke nye idéer. Kode kontrolleret. |
| #2338, #2339 | Lukkede PR'er | Hold-/rytterugeplaner er leveret. Gamle beskrivelser af klikbonus er overhalet af den nuværende træningskontrakt. |
| #2752, #2361 | Lukkede | Sæsonrecap og ritual findes. Kode bekræfter flere af de eksisterende lag. |
| #6570, #6469 | Lukkede ved del A's kildekontrol samme dag | Replay og konkrete forklaringer er eksisterende grundlag. Det betyder ikke, at alle forløb er korrekte; #6350/#7643 og nyere spillerissues består. |
| #931, #7456 | Åbne | Ugeplan og dens videre udvikling har ejere. Rotationsforslaget er ikke vedtaget her. |
| #7535 | Åben, design færdigt og byg i bero | Ingen ny Workbench eller ændret rækkefølge. |
| #5101, #7638, #5950, #6110 | I ejerens aktuelle Claude-mandat | Ingen overtagelse, parallel redesign eller genåbning af de valgte produktretninger. |
| #2490, #1148, #1106, #1147, #5180 | Åbne | Karriere, historie, feed og milepæle har eksisterende scope. Leverede dele skal genbruges før en ny rest vælges. |
| #7167, #6951, #6952 | Åbne | Bestyrelsesgennemgang, likviditet og planlægningsbyrde har eksisterende undersøgelsesopgaver. |
| #6950 | Åben; seneste ejerkommentar læst | Kortet er klar til samtale senere i ugen. Ældre forslag om at tænde catch-up er ikke aktuelle beslutninger. |
| #932 | Lukket som not_planned | Lukningen beviser ikke, at ungdomssystemet blev fjernet; senere ungdomsspor og runtime består. |

Ingen nye emner er oprettet. At et issue står åbent er ikke i sig selv bevis for manglende produktkode; omvendt beviser lukning ikke, at hele det brede behov er opfyldt. Der er ikke udført en ny til-dørs-audit eller flyttet issue-status i denne undersøgelse.

## Hvad vil ændre vurderingen?

Hvis spillere efter Claudes kerneforbedringer allerede forbinder rapport og plan uden besvær, bortfalder A. Hvis en observeret uge viser, at byrden skyldes nødvendige frister eller regler snarere end navigation, hører løsningen under de eksisterende domæneissues. Hvis talentfabrikker allerede oplever deres historie som tydelig og værdifuld, skal der ikke bygges mere historik for at opfylde en antagelse.

Den samlede anbefaling og testplan står i [specifikationen](spec-durable-motivation-2026-11-04.md). Ejeren valgte senere 4/11 sammenhængen mellem rapport og næste gemte opgave til konkretisering. Det ændrer ikke bevisstyrken: aktuelle målinger er bevis for datatilstand; forbedringens effekt er fortsat en hypotese.
