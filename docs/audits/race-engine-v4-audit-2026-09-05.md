# Løbsmotor v4: audit af hvad der reelt er bygget og grønt (5/9 2026)

> Read-only audit kørt som workflow (7 laner + skeptiker pr. lane + syntese, opus). Grundlag for design-sessionen om v4 og taktik før flip ved S4-start 28/9. Issues: #2789 rute-huller, #2944 styrt/uheld uden DNF, #2582 tidsgrænse, #4632 intention, #4707/#3855 ankre, #4246 rolle/ordre.

## FÆRDIGT og verificeret

**Styrt koster tid i stedet for udgåelse (halvdelen af ejerkrav #2944)** v4's uheldsmodul giver et styrtet ryttere et tidstab og lader ham køre videre, og 3 km-reglen (styrt tæt på mål på flad etape koster placering, ikke tid) er implementeret. Det er den ene grønne byggesten i hele kravet. (`backend/lib/engine/v4/mechanics/incidents.ts:114-193`, tuning `[5, 25]` sekunder, egen kørsel `incidents.test.ts` 19/19 pass inkl. determinisme og en property-test over 200 kørsler. #2944 er ejerens krav fra 4/9 om at styrt skal graduere og mekaniske uheld ikke må tvinge nogen til at udgå.)

**Nedkørsels-ankeret er grønt** Forholdet mellem tidsforskelle på nedkørsler og på bjergtoppe ligger på 0,30 til 0,44 mod kravet på højst 0,5, målt i tre uafhængige kørsler. Nedkørsler skaber altså ikke længere urealistisk store huller. (`headToHeadAnchors.js:36`, skeptikerens egne 5-seed-kørsler. Forbehold: #4614, et åbent issue der bestrider selve definitionen, måler harnessen plads 1 til 10 mens båndet siger plads 5 til 10.)

**Motorens hårde garantier er låst af tests** Samme løb giver samme resultat hver gang, alle i samme gruppe får præcis samme tid, alle der starter kommer i mål, og en ekstra tilmelding flytter aldrig en anden rytters udfald. (Egen kørsel af alle 27 testfiler: `tests 291 / pass 291 / fail 0 / skipped 0 / todo 0`, plus `npx tsc -p tsconfig.engine.json` exit 0 og fire frosne golden fixtures der sammenlignes bit for bit.)

**De fem koblede mekanikker virker** Bjergselektion, nedkørsel, finale, udbrud og sprint-tog er de eneste mekanikker motoren faktisk kalder i dag, og alle fem er testdækket på adfærd, ikke bare på at filen findes. (`index.ts:22-27` plus `finale.ts:33`, tests: climbSelection 11, descent 19, finale 7, breakaway 18, leadout 12, alle grønne.)

**Spillerens to ordre-kanaler i motoren** Flaget "prøv at komme i udbrud" pr. rytter og holdets holdning til udbruddet (jag, neutral, lad køre) påvirker reelt udfaldet og er begge afgrænsede, så de aldrig garanterer en sejr. (`breakaway.ts:118, 262-269, 425`, tests "try_break-flag garanterer ALDRIG medlemskab" og "stanceSignal er ALTID bounded [-1, 1]".)

**AI-holdene kan oversætte rolle til ordre** En stærk leder giver jag-ordre og beskyttelse, et svagt hold sender op til to jægere i udbrud. Logikken findes og er testdækket, men kun harnessen kalder den. (`ai/aiTactics.ts:166-259`, `aiTactics.test.ts` 10/10, eneste forbruger `scripts/lib/headToHeadOrders.js:31`.)

**Rolle-ordene er låst til fem** Kaptajn, sprintkaptajn, hjælper, udbrudsjæger og fri rolle er de eneste tilladte, og en test fælder et sjette ord. Det var ejerens udtrykkelige krav i #4246 (rolle contra ordre). (`raceRoles.test.js:116-127`, 16/16 pass, og v4's adapter bruger den samme liste via `entrantAdapter.ts:14`.)

**Dobbelt udbrudsjæger er lukket i appen** En ny udbrudsjæger erstatter nu den forrige på etapen, både i backend-guarden og i UI'et. (`raceStageRolesApi.js:105-112`, `stageRoleMatrixLogic.js:79`, 36/36 og 33/33 grønne. #4746 er issuet om at man kunne sætte flere udbrudsjægere på samme etape, shipped 5/9 i PR #4803. DB-rækkerne er ikke ryddet op, se nedenfor.)

**Den motor spillerne kører på i dag gør det rigtige med roller og indsats** I v3 er en udbrudsjæger altid udbrudskandidat med dobbelt vægt, fri rolle koster ingenting, hjælper koster, og indsatsvalget protect/normal/save ændrer trætheden. (`raceSimulator.js:381, 491, 503`, `raceRoles.js:41-52, 73-79`, 60/60 grønne tests. Flaget `race_engine_v3_scoring` er dokumenteret som on i prod i `database/2026-08-27-4294-peak-plan-cascade.sql:18`.)

**Kun styrt kan skade en rytter** Mekaniske uheld giver aldrig skadedage, styrt med udgåelse gør altid. Reglen håndhæves begge de to steder den skal. (`raceIncidents.js:108-117`, `raceRunner.js:1431`, 22/22 grønne. #4520 er beslutningen fra 5/9 om at fjerne skade fra mekaniske uheld.)

**Grus som egen etapetype hænger sammen** Rytterprofil, antal og længde af grussektorer, segment-oversættelse og finalefordeling matcher dokumentationen præcist. (`raceStageProfileGenerator.js:129-179`, `raceRouteGenerator.js:388-391`, `routeSegments.js:162-166`, 9/9 grønne. #4105 er grus-slicen fra Terre di Toscana.)

**Kalibrerings-harnessen selv er solid** Scoringen kører helt uden database, felt-størrelsen er låst til 180 ryttere pr. etape, og typegaten kører i CI. (`headToHeadV4.js:439-450`, 57/57 grønne tests, `.github/workflows/ci.yml:41`.)

**To måltal er grønne med god margin** Sammenhængen mellem punch-evne og placering på punch-etaper (0,69 mod krav over 0,2) og mellem enkeltstartsevne og placering (0,85 mod krav over 0,3). (`headToHeadAnchors.js:56`, `scorePunchCorrelation():211`. Bemærk at begge tærskler er valgt af harnessen selv, ikke ejer-godkendt.)

## Bygget men ikke verificeret

**Otte færdige mekanikker som motoren aldrig kalder** Distance-slid, brosten og grus, bonussekunder, uheld, vejr, indsatsvalg, holdtidskørsel og ordre-adapteren har alle grønne tests og nul kaldssteder. Cirka 110 KB kode og 106 af de 291 tests beviser at funktionerne er korrekte, ikke at et løb bruger dem. (Systematisk søgning: de eneste reelle imports i motoren er climbSelection, descent, breakaway og leadout. `index.ts:52-55` erklærer det selv som en faseafgrænsning.)

**Ejerens uheldskrav er kun bygget til det halve** Der er ingen alvorsgrad på styrt, altså ingen gren hvor et alvorligt styrt fører til udgåelse, og uheldsmodulet er som nævnt ikke koblet ind. (`incidents.ts:298-303` siger selv at status "abandoned" bevidst ikke røres, `tuning.ts:301` har kun ét tidsspænd uden alvorsakse. Ejerkravet #2944 siger "udgået kun ved alvorlige styrt".)

**Felt-sammenhængen på flade etaper er fire gange fra målet** Kun cirka 19 procent af feltet får vinderens tid på en flad etape, kravet er 80 til 95 procent. I praksis splittes massefeltet for meget. (`headToHeadAnchors.js:32`, tre uafhængige kørsler: 19,6 / 17,1 / 20,1 procent. Var cirka 1 procent før #4615, som er wiringen af udbruds- og sprint-tog-mekanikken 3/9.)

**Favoritterne vinder for ofte** Feltets favoritter tager 55 til 59 procent af sejrene mod båndet på 25 til 40 procent. Løbene er for forudsigelige. (`scoreDominance():244`, alle kørsler røde. Cellen må ifølge ejer-reglen "straf aldrig styrke" kun forbedres ved at koble flere mekanikker på, aldrig ved handicap.)

**Bjerg-ankeret er ustabilt, ikke grønt** Middelværdien lander på 178 til 190 sekunders spredning i bjerg-top-10, men enkeltkørsler rammer 126 og 254 sekunder, og alene det at slå AI-ordrer fra vipper dommen fra bestået til fejlet. Båndkanten ligger inde i støjen. (`headToHeadAnchors.js:60`, skeptikerens tre kørsler. #4604 er de tre målte motorfejl fra august der satte bjerg-ankeret op.)

**Tuning-tallene er stadig startgæt** Filen siger det selv, og der findes ingen test på den. Kalibreringen er sporet i #4707 (jagt-modellen skal kalibreres så sprinter-ankeret bliver grønt uden at bjerg-ankeret ryger), som er åbent, prioritet høj og har nul kommentarer. (`tuning.ts:5-8`, ingen `tuning.test.ts`.)

**Ruten læses som segmenter, men er aldrig efterprøvet mod ægte data** v4 kører hvert rutesegment igennem uanset etapetype, hvilket strukturelt lukker to af de seks huller i den gamle gap-model. Ingen har kørt den mod de faktiske S2- eller S3-ruter der afdækkede hullerne. (`routeAdapter.ts:137`, `segmentLoop.ts:263-265`. Bemærk at feltet `sectors` deklareres men aldrig læses: `routeAdapter.ts:60`, og at gamle rækker uden gemte segmenter tavst får syntetiske segmenter.)

**Udbrudsjægerrollen virker kun for AI-hold** Rollen bliver oversat til en ordre i AI-grenen, men ingen mekanik i motoren læser `entrant.role`, så et menneskehold der sætter en udbrudsjæger får nul effekt uden en eksplicit ordre. I v3 fordobler rollen udbrudsvægten. (`aiTactics.ts:202` mod nul hits på role i `mechanics/*.ts`.)

**Holdtidskørsel er bygget, men kan ikke kobles ind** Mekanikken har 17 grønne tests, men motorens rytter-type mangler et hold-id, så den kan ikke kaldes uden en kontraktændring. En holdtidskørsel afvikles i dag som en almindelig vejetape hvor ni ryttere får hver deres tid. (`mechanics/teamTimeTrial.ts:418-427`, `types.ts:131-137`. #3463 er det åbne issue om netop det, #2412 blev lukket som dublet af det, ikke som løst.)

**Ordre-kæden fra spiller til motor er brudt i midten** Endpointet er live i prod og skriver rækker, adapteren kan læse dem, men intet led kalder adapteren, og hverken v3 eller v4 læser tabellen. En ordre gemt i dag har nul effekt. (`routes/api.js:190` og ruterne fra `:5548`, `raceTeamOrdersApi.js:145/179`, mod nul kaldere af `buildStageOrders`.)

**Taktik-kortet i frontend er en attrap** Kortet findes med 33 grønne tests, men det er gated til udviklingstilstand og gemmer til en hukommelses-mock uden netværk. Ejeren kan ikke teste den rigtige kæde på preview. (`RaceDetailPage.jsx:258`, `tacticsOrdersAdapter.js:51`, nul hits på "team-orders" i frontend.)

**Ingen ved hvor mange prod-ruter der har ægte segmentdata** Skema og generator er på plads, men andelen af S3- og S4-etaper med rigtige segmenter er umålt, og rute-adapteren erstatter tavst manglende segmenter med opdigtede. Et flip på gamle rækker ville køre etaper på syntetiske ruter uden en eneste fejlmeddelelse. (`routeAdapter.ts:74-77`, ingen prod-forespørgsel kørt i nogen lane.)

**Tidslinje-vagten er bygget og slukket** Der findes et bibliotek der låser formen på tidslinje-begivenheder og en validator der skal fange lækkede skjulte tal, men de levende mekanikker bygger begivenheder råt udenom, og validatoren kaldes aldrig i drift. Målt på de fire golden fixtures lækker der intet i dag, så det er et dækningshul, ikke en aktiv fejl. (`timeline.ts:224-268` uden kaldssteder, end-to-end-testen dækker 6 af 21 forbudte nøgler.)

**To regler er kun testet på komponentniveau** Monotoni-invarianten (lavere evne må aldrig give bedre tid i samme gruppe) er ikke testet på et helt løb, og dagsformen lægges additivt oveni, hvilket i princippet kan vende rækkefølgen mellem to næsten lige ryttere. Samme gælder reglen om at uklassificerede flade og rullende etaper får delt vindertid, som ingen test rammer. (`climbSelection.test.ts:283` springer ulige energi over, `physiology.ts:254`, `finale.ts:82-84`.)

**Bonussekund-ankeret måler ingenting** v3-cellen er hårdkodet til bestået uden at køre noget, og v4-cellen er markeret uanvendelig. Det tæller alligevel med i optællingen af beståede måltal. (`headToHeadAnchors.js:369-388`. #2413 er bonussekund-issuet.)

## Ikke bygget

**Ejerkrav #2789: de seks rutehuller er ikke oversat til v4-krav** Ejeren besluttede 4/9 at de seks fund (hvor den gamle gap-model ignorerer ruten) bliver krav til v4 før flip. Der findes intet spec-afsnit, intet issue og ingen test der oversætter dem til v4's segmentmodel, og ejerens ønske om ét beslutningskort pr. fund er ikke effektueret. (Nul hits på de gamle modelnavne i `backend/lib/engine/v4/`. Kravet er registreret i `docs/NOW.md:23`, men kun som nummer.)

**Ejerkrav #2582: tidsgrænsen findes slet ikke** Ingen kode, ingen tuning-konstant, intet felt, intet doc-afsnit. Det er det mest omfattende af de tre krav, fordi det kræver en helt ny udfaldsklasse ved siden af "i mål" og "udgået", etapetype-afhængige procenter og en beslutning om konsekvensen for klassementet. (Bred søgning på tidsgrænse, cutoff og broom giver nul relevante hits i hele `backend/lib` og i regel-dokumentet. #2582 er ejerens krav om UCI-tidsgrænser på 5 til 20 procent af vindertiden.)

**Ejerkrav #2944: mekaniske uheld findes ikke i v4** Ordene mechanical og puncture optræder ikke ét sted i v4's kode. I v3 er art og udfald to uafhængige lodtrækninger, så en punktering kan i dag tvinge en rytter til at udgå, præcis det ejeren har forbudt fremadrettet. (`raceIncidents.js:96-99` mod nul hits i v4.)

**Ejerkrav #2944: uheldsfrekvensen er aldrig målt mod virkeligheden** Ejeren bad om at hyppigheden måles mod virkelige tal (cirka 1 til 2 procent pr. etape). v4's risiko er sat pr. segment uden noget loft pr. etape, og hverken tests eller harness summerer det til en etaperate. v3 har til sammenligning et hårdt loft på antal uheld pr. etape. (`tuning.ts:290-297`, nul hits på "incident" i `scripts/headToHeadV4.js`.)

**Løbsdagens intention (#4632) er ikke påbegyndt nogen steder** Ejeren besluttede 6/9 at spilleren vælger en intention pr. rytter, men der er ingen kolonne, intet endpoint, ingen UI, ingen motorkobling og ingen træningskobling. (`race_entries` har 7 kolonner uden intention, nul hits i backend-ruter og frontend, `applyRaceDevelopmentTick` tager ingen intentions-parameter, og tabellen `rider_training_scores` som #4850, træning pr. løbsdag, forventer, findes ikke.)

**Der er ingen tænd-og-sluk-knap til v4** Flaget `race_engine_v4` findes kun som et ord i en spec. Flag-modulet har fire nøgler, ingen af dem til v4. Der er intet at flippe 28/9. (`raceEngineFlag.js` læst i fuld længde.)

**Motoren har intet kaldssted i produktion** Løbsafviklingen kalder udelukkende v3, og v4 kører kun i et offline-script. Et flip kræver en ny gren der bygger inputtet, kalder v4 og oversætter outputtet tilbage. (`raceRunner.js:392` og `:2000`, eneste v4-importører er fire harness-filer.)

**Der er ingen vej fra motorens output tilbage til databasen** v4's output indeholder tidslinje, resultater, belastninger og gruppe-øjebliksbilleder. Resultattabellen har 20 kolonner, blandt andet bonussekunder, spurtpoint, bjergpoint og præmiepenge, og ingen af dem produceres. Der er heller ikke besluttet hvilket motor-versionsnummer v4 skal stemple, hvilket betyder at overvågningen af balancedrift holder op med at se noget den dag der flippes. (`types.ts:227`, `balanceDriftWatch.js:36` filtrerer hårdt på version 2.)

**Der er ingen kill-switch tilbage til v3** "v3 er låst fallback" er kun sandt fordi v3 er den eneste sti. En rigtig tilbagerulning midt i en sæson uden at ødelægge klassementer er hverken bygget eller designet, selvom specen lover den to steder. (`raceRunner.js:433` og `:2038` kender kun to versionsværdier.)

**Skyggekørsel mod v3 er ikke startet** Der findes intet script og ingen tabeller. Ejerens godkendte gate er dog allerede erstattet af den offline harness plus håndplukkede løbsfilm, og filmfunktionen findes og er grøn, så gaten kan afholdes uden skyggetilstand. (`headToHeadV4.js --films`, testet.)

**Ingen har målt hvad v4 koster i tid** Etaper afvikles hver hele time, v4 kører en løkke pr. segment pr. rytter mod v3's ét-skuds beregning, og der findes ingen ydelsesmåling på realistisk feltstørrelse. Det er en flip-blokker på niveau med de manglende mekanikker.

**Holdspillet findes ikke i v4** Kaptajnbeskyttelse og hjælperstøtte kræver et hold-id på rytteren, som den frosne kontrakt ikke har. Ved et flip forsvinder både hjælperens pris og kaptajnens fordel. (`types.ts:131-137`, `breakaway.ts:23`, mod v3's `buildTeamContext` i `raceSimulator.js:295-320`.)

**Rollen bliver ikke til en standardordre** Ejeren besluttede 2/9 at rollen er standardordren og taktik-kortet et etape-overlay. Standardordren giver i dag alle ryttere "normal indsats, prøv ikke udbrud" uanset rolle. Fladen der skulle vise "Standard: jæger. I dag: bliv i feltet" findes heller ikke. (`teamOrdersAdapter.ts:48-50`, `teamOrderContract.ts:106-111`, nul i18n-nøgler.)

**Sprint-toget kan ikke sættes af en spiller** Mekanikken er koblet ind, men ordre-tabellen har intet felt til det og frontend har ingen flade. Kun harnessen producerer sprint-tog-ordrer. (`database/2026-08-21-4030-race-team-orders.sql:29-40`.)

**Bjerg- og spurtpassager udsendes ikke af v4** Begivenhedstyperne findes i kontrakten og har byggere, men ingen koblet mekanik udsender dem, og rutens vejpunkter læses ikke. I v3 ligger passagelaget uden for motoren. Ved et flip mangler tidslinjen bjerg- og spurtpassager, og de konkurrencer der hænger på dem skal have et hjem. (`raceRunner.js:401-403`. #2770 er passage-laget.)

**Løbsfortællingen kan ikke bygges på v4** Fortællingen læser komponenttal (terræn, hold, arbejdspris) som v4 slet ikke producerer. Enten skal v4 udsende et komponentlag, eller fortællingen skal skrives om til gruppe- og tidslinjedata. (`raceNarrative.js:141-380` mod `types.ts:195`.)

**Alle enkeltstarter har præcis 80 højdemeter** Uanset distance. Et fund fra #2789 der ikke er rørt siden det blev målt på 54 etaper i juli. Rettelsen hører hjemme i rutegeneratoren, ikke i v4. (`raceRouteGenerator.js:147-153` og `:410-412`.)

**Tre ejer-valgte evner er ikke bygget** Dagsform-stabilitet, vejr-teknik og højde-tolerance blev valgt ind 20/8. Kun vejr-teknik har en midlertidig erstatning, og den ligger i et modul der ikke er koblet ind. (`types.ts:17-32` har 15 evner, ingen af de tre.)

**To måltal måler intet for v4** Udbrudsrater pr. terræn er hårdkodet uanvendelig for v4, selvom motoren allerede udsender de data der skal til, og margin til vinderen af et treugersløb er aldrig implementeret. Det er netop udbrudsraten der driver sprinterproblemet i #4707. (`scoreBreakawayRates():286-310`, `scoreGapRealism():505-511`, `breakaway.ts:400/406` har allerede dataen.)

**Sæsondrejebogen nævner ikke v4** Tjeklisten ved sæsonskifte lister syv flag, ingen af dem til v4, og der står ingen rækkefølge for flip contra kalenderoprettelse og tilmeldingsgenerator. Der er heller ingen patch note eller hjælpetekst forberedt, selvom specen kræver det ved flip. (`docs/SEASON_TRANSITION_CHECKLIST.md:27`, nul hits på v4 i hjælpefilerne.)

**Intet issue sporer selve flip-arbejdet** 25 åbne issues på motor-slicen, og ingen af dem dækker flag, kaldssted, output-lagring, skyggetilstand eller tilbagerulning. Fem af punkterne ovenfor har ingen ejer i issue-sporet. (#3855 er design-epicen, sidst rørt 26/8.)

**De 119 beskidte rolle-rækker i prod er ikke ryddet** Op til seks udbrudsjægere i samme hold-etape-gruppe står urørte, og der er ingen entydighedsbetingelse i databasen. v4's ordre-adapter læser den samme rolleverden. (Oprydning er destruktiv og ejer-gated.)

## Modsigelser mellem doc og kode

**Regeldokumentet beskriver v3's uheldsmodel under v4's mekanik-nummer** Afsnittet hedder "Incidents (M10)", altså v4's mekanik, men beskriver v3's kodestier og en model med to arter og to udfald som v4 slet ikke har. Ved et flip beskriver dokumentet en model spillet ikke længere kører, og der er intet afsnit om ejerens beslutninger fra 4/9 om graduerede styrt eller tidsgrænse. (`docs/RACE_ENGINE_RULES.md:117-124`.)

**Alle tre ankertal i regeldokumentet er forældede, og dokumentet modsiger sig selv** Linje 205 siger sprinter-vinderraten er 99,7 procent og nedkørslen er den sidste røde. Linje 213 i samme afsnit siger sprinteren faldt til 85,0 procent. Nedkørslen har været grøn siden 2/9. En læser får det stik modsatte billede af den faktiske tilstand.

**Sprinter-ankeret er ikke rødt, det afhænger af hvilken population man vælger** Samme kode, samme kalender, samme seeds, kun rytterpopulationen skiftet: 96,8 procent bestået med den committede prod-eksport fra juli mod 83,1 procent fejlet med en usporet fil fra 21/8. Et udsving på 13,7 procentpoint, større end den seed-følsomhed dokumentet allerede advarer om. Hele præmissen for #4707 hviler på et tal ingen kan reproducere. Populations-følsomheden står ikke skrevet ned noget sted.

**Gaten er ikke pinnet nogen steder** Der er ingen kommando der låser population og seeds for v4-harnessen, selvom den tilsvarende gate for formtoppe allerede gør præcis det rigtige i `package.json:25`. Ingen kan efterprøve om et fremtidigt kalibrerings-PR faktisk flytter et anker. Dertil har den ene sti ingen som helst testdækning: fem-seed-aggregeringen, altså selve den gate-form ejeren valgte 2/9.

**Aggregerings-koden modsiger sin egen beskrivelse** Filen siger at domme afgøres på middelværdien mod båndet, men tre af tolv måletal mangler i opslagstabellen og får derfor bare kopieret dommen fra det første seed. CodeRabbit flagede det ordret som en merge-risiko på PR #4679, som blev merget alligevel. (`headToHeadAnchors.js:477-508`.)

**Måltallet for holddominans kan ikke fejle** Kravet er at under 3 procent af etaperne har fire ryttere fra samme hold i top 10. Harnessen trækker feltet tilfældigt uden holdstruktur, så 119 af 147 hold har præcis én rytter med, og kun ét hold har fire. Samme fejl gør sprint-tog og AI-taktik næsten umålbare. Forbeholdet står ingen steder. (`headToHeadStats.js:111-119`.)

**"Wiret" betyder ikke at det virker** Regeldokumentet og #4615 tilskriver forbedringen i felt-sammenhæng til at udbrud og sprint-tog blev koblet ind. Målt isoleret kommer den fra en anden ændring i finalen. Ordrernes eget bidrag er under 1 procentpoint på hvert eneste måltal, blandt andet fordi AI-taktikken vælger "lad køre" i 99,6 procent af tilfældene. Kalibrerer man jagt-modellen nu, kalibrerer man en model hvis input er tomt.

**Hvert v4-løb rapporterer samme sejrstype** Finalen er koblet ind og kender udfaldet, men motoren stempler ubetinget "group_finish" på alle etaper, uanset om det var massespurt, solo eller udbrud. Værre: alle fire golden fixtures fryser fejlen fast, så en rigtig klassificering gør fire tests røde og kræver regenerering. Det er også derfor udbrudsraten ikke kan måles på v4. (`index.ts:75-84`.)

**Kontrakten for holdordrer findes i fire uenige kopier** Spiller-stien sender et rollefelt som AI-kontrakten aktivt afviser. Regeldokumentets indledning siger ordret at AI-hold bruger præcis samme type uden sidekanaler. Det er direkte falsk i dag, bevist ved en kørsel hvor adapterens output afvises af AI-kontrakten. Bemærk desuden at hvis man fryser til den snævre form som foreslået, mister sprint-toget sin eneste ordre-kanal.

**Rollefeltet er stadig sat-bart i ordren** Ejeren besluttede 27/8 at det skulle fjernes fra ordren, fordi rollen aldrig må overskrives af taktik-kortet. Det står stadig i API'et, i adapteren og i databasekommentaren. Af ejerens fire nummererede konsekvenser fra 27/8 er kun den ene (test-låsen på rolleordene) udført. (`raceTeamOrdersApi.js:93` og `:123`.)

**Regeldokumentet kalder rolle contra ordre "løst", mens dets eget afsnit længere oppe kalder det ejer-gated** Beslutningen er truffet, mekanikken er ikke bygget, og issuet er åbent med ejerkommentar 4/9 om at det implementeres i v4-sporet. "Løst" bør stå som "besluttet, ikke implementeret". (#4246 er rolle contra ordre.)

**En kommentar i kontraktfilen påstår en kobling der ikke findes** Den siger at segmentløkken læser indsatsfeltet. Søgning på "effort" i segmentløkken og fysiologien giver nul hits. Til sammenligning beskriver holdtidskørsels-filen ærligt sin manglende kobling som et forslag. (`types.ts:38-39`.)

**Holdtidskørsel mangler helt i det "lukkede" mekanik-katalog** Kataloget springer fra M12 til M14 og siger samtidig at scope er lukket og at en mekanik udenfor listen kræver ejer-go. Koden har både tuning-blok, modul og 17 tests. Enten mangler den i tabellen, eller også er den bygget uden for scope.

**Dokumentet siger grus ikke er båndsat, koden har et ejer-godkendt grusbånd siden 3/9** Og det stale udsagn står to steder: både i regeldokumentet og ordret i en kodekommentar i rutegeneratoren. Retter man kun dokumentet, lyver kommentaren videre. (`stageFinaleMetrics.js:59-70` mod `docs/RACE_ENGINE_RULES.md:100-102` og `raceStageProfileGenerator.js:178-179`.)

**To rækker har nummer 12 i modsigelsestabellen, og tabellen er brækket** Den ene handler om dobbelt udbrudsjæger, den anden om sprinter contra felt-sammenhæng. En tom linje midt i tabellen bryder opsætningen. #4707 henviser selv til "nr. 12 og 13", altså tvetydigt.

**To rækker i samme dokument er uenige om rolle-gaten** Oversigten siger der ikke findes nogen vagt på rolleordene, modsigelsestabellen siger den blev løst 3/9. Koden giver den sidste ret.

**Dokumentet kalder to invarianter "property-testede"** Testfilen importerer slet ikke det bibliotek, den kører en tabel over fem faste evneniveauer. Beskyttelsen er reel, men ikke af den type der loves.

**Tre kilder er uenige om hvornår flippet sker** Regeldokumentet siger flag-flip i S3 på en hviledag, specen siger live fra S3's første løbsdag 25/8, og både ejerens direktiv og statusnotatet siger S4-start. Regeldokumentet er ikke opdateret efter ejer-direktivet.

**De to intentions-specer er uenige om hvor valget bor** Specen fra 3/9 siger udtrykkeligt "ingen ændring til race_entries" og anbefaler at udvide det eksisterende indsatsfelt fra tre til fem trin. Beslutningen 6/9 siger ny kolonne på race_entries. Dertil: den anbefalede bærer-tabel skal ifølge regeldokumentet udfases efter v4-flippet, og en ejer-beslutning fra 21/8 siger at en tredje tabel er eneste sandhed for indsats. Tre tabeller, tre kilder, ingen afgørelse.

**Den ejer-godkendte intentions-beslutning kan ikke migreres som skrevet** Den siger at intentionen vælges pr. etape, men udpeger en tabel hvis nøgle er (løb, rytter) uden etapenummer. Beslutningen er internt inkohærent og skal afklares før nogen skriver migrationen. (`database/2026-06-07-race-engine-slice2.sql:23`.)

**Regeldokumentet siger taktik-kortet ikke er bygget** Kortet findes med tre filer og 33 grønne tests, gated til preview. Dokumentet er stale på netop den flade.

**To evner vejer i finalen, men ingen rytter i spillet har dem** Positionering og taktik står i evnelisten og vejer op til 35 procent af nedkørselsfinalen og 40 procent af en uklassificeret etape, men målingen viser 0 af 5.650 ryttere med en værdi over nul, og den manglende evne bliver til nul uden omfordeling. Det gør alle finale-kalibreringer usikre. Dokumentet nævner desuden 5.938 ryttere, mens baselinen har 5.650.

## Ubesvarede spørgsmål fra auditten

1. **Skal M7 til M13 kobles ind før flippet, eller flippes v4 med kun fem mekanikker?** Flipper man som det står, forsvinder styrt, skader, bonussekunder, vejr, brostensselektion, indsatsvalg og holdtidskørsel ud af løbene på én dag. Det er den enkeltbeslutning der afgør om 28/9 er realistisk.

2. **Hvad er et "alvorligt styrt" i tal?** Ejerkravet siger "udgået kun ved alvorlige styrt" uden en andel eller et kriterium, og der er heller ikke besluttet om v4 skal arve v3's loft over antal uheld pr. etape.

3. **Hvilken tabel ejer løbsdagens intention, hvor mange trin har den, og er den pr. løb eller pr. etape?** Tre tabeller er nævnt i tre kilder, koden kender tre trin, specen foreslår fem, og beslutningen om granularitet er selvmodsigende.

4. **Skal en rytter der overskrider tidsgrænsen ryge ud af hele løbet eller kun af etapen, og rammer det AI-hold lige så hårdt som spillerhold?** Ingen af delene er besluttet, og kravet er ubegyndt.

5. **Er "grøn på middel" nok, når enkeltkørsler ligger langt uden for båndet, og hvilken population og hvilke seeds gælder som gaten?** Ankrene svinger mere på populationsvalg end på seeds, og gaten er ikke pinnet nogen steder.

6. **Hvad sker der med bonussekunder og bjerg- og spurtpoint ved flippet?** I dag lægges de på uden for motoren. Kobler man v4's egen mekanik ind uden at slukke det lag, får ryttere bonus to gange; gør man ingenting, mangler point og trøjer. Beslutningen findes ikke noget sted.
