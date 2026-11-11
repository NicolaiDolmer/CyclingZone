# #7884: langt angreb på en navngiven stigning

Dato: 11/11/2026. Status: teknisk design til Claude og ejer, **ikke godkendt til build**.

## Mandat og grundlag

[Ejerens valg A](https://github.com/NicolaiDolmer/CyclingZone/issues/7884#issuecomment-6796069497) er låst: et ægte langt angreb fra rytterens aktuelle gruppe, alene eller med få, med reel energipris, jagt, mulighed for sejr og for at gå død. Alle roller må få ordren. UI viser ejerens ordlyd **“Angrib på” + stigningens navn**, delt med profilen via #7980. Claude ejer øvrig spillertekst.

Dette dokument beskriver en fremtidig ændring. Det ændrer ingen runtime-regel, database, kontakt eller spillertekst. Ingen featurebyg før Claude og ejer har set pakken og særskilt build-go foreligger. Ingen merge eller aktivering er autoriseret.

SSOT: [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md), afsnittene “Etapeplan langs ruten” (#7003), “Sent soloangreb kun for ledere og fri rolle” (#6368), “Sat kun bag en rigtig front” (#7635), “Nedkørselsangreb respekterer opgaven” (#7380), samt fælles gruppeklokke og indhentninger. Ved senere byg opdateres SSOT, FEATURE_REGISTRY og testplan i samme PR. #7980 skal afklares før integration med de navngivne rutepunkter; denne baseline er på main, ikke på #7980-branchen.

## Hvad den nuværende kode faktisk gør

- `stagePlan.ts`: `attack` betyder indsatsen `all_out`. De fem roller kaptajn, delt kaptajn, spurtkaptajn, jæger og fri rolle er tilladt; hjælper er afvist. `from: {at: "kom", kom_index}` bruger toppen, ikke starten af stigningen. Indexet er positionen i rutens rå `climbs`, ikke visningsrækkefølgen eller navnet. Topankomst er ikke et KOM-skift.
- `stagePlanEngine.ts` skifter ved segmentgrænser og udskifter indsats; det skaber ingen selvstændig lang angrebsgruppe. `stage_plan_leg` er bevis for opgaveskift, ikke for et gennemført angreb.
- `mechanics/lateAttack.ts` vælger én sen mulighed fra en tilladt frontgruppe og kan give én rytter et solo-forspring. Det er et andet forløb end det ønskede lange angreb. Det nuværende hook respekterer andre rollebegrænsninger og har ingen egen særskilt energidebitering for sit split.
- Eksisterende selektion, nedkørselsangreb og finale kan stadig flytte rytteren. Derfor kan vi ikke slutte “intet angreb” af manglende lang-angrebsevent eller tilskrive alle senere tidsgevinster til planens angreb.
- `race_team_orders.riders` er allerede JSONB. API-validering, ordre-adapter og motor validerer/projicerer planerne. `loadTeamOrderRows` læser den eksisterende række og falder tilbage til neutrale ordrer ved læsefejl.

## Målt baseline før design-PR

Uændret kode på `6a6b398123f80f87994ae3e7ab5d85d9dce21c10`, native PostgreSQL **17.11**. Fysisk tabel, PK, FK, CHECK, indeks og policies fra `database/2026-08-21-4030-race-team-orders.sql`; lokale minimale teams/races/auth-fixtures og eksplicitte service-grants. Fixture-stubs er ikke en test af produktions-Auth eller hele Supabase-stakken.

Otte rytterordrer blev skrevet som service-role, læst gennem den faktiske `loadTeamOrderRows`-funktion med dens uændrede projektion og ført gennem rolle-/indsats-resolver, produktionsadapter og v4-motor. Kun HTTP-transporten var erstattet af en lokal SQL-adapter. Det er **ikke** en PostgREST-/HTTP-E2E. Det eksisterende anonymiserede Giro-felt er en frossen inputfixture; resultaterne er genmålt nu.

To ruter (kuperet/bjerg), tre faste seeds, kontrol/angrebsplan: **12 kørsler og fire byte-identiske replays**, otte menneskeryttere oven i fixturefeltet. Alle seks kanoniske roller blev valideret; hjælperen blev afvist som forventet. Tidskørsel og ukendt stigningsindex blev afvist. CHECK afviste etape nul. Indeksopslaget blev observeret med EXPLAIN ANALYZE; den lille fixture er ikke en ydelses- eller skaleringsgodkendelse.

Kvalitativt resultat: planen aktiveres ved toppen og øger det målte arbejde, men giver ikke i sig selv et afsæt på den valgte stigning. Ved toppen og næste registrerede grænse forblev den målte kaptajn i samme gruppe i kontrol og angrebsvariant. Senere selektion/finale må ikke tælles som den manglende mekaniks succesrate.

Afgrænsning: ingen ny mekanik, ingen frekvensmåling af en endnu ikke bygget mekanik, ingen samlet kalibrering af alle løbsgrupper, ingen etapevis GT-træthed, ingen produktionsbelastning. Dette er et regressionsgrundlag og dokumentation af semantik, ikke et godkendt balancemål. Interne rådata, hashes, tider og belastningstal ligger privat, jf. regel 17, i det delte appendiks `private-handoffs/codex-plan-11-12-2026/7884/2026-11-11-design/`.

S1 frigav kapaciteten. Bootstrap og måling kørte sekventielt bag `verify-lock -Max 1`. Første sandboxforsøg kunne ikke forbinde lokalt; begge PG-instanser sluttede med positiv `pg_ctl stop=0/status=3`. Den gennemførte måle-wrapper sluttede med exit 0. Ingen polling.

## Anbefalet teknisk løsning

### Kontrakt og identitet

Udvid den eksisterende plan med en typet, feature-gated `from: {at: "climb_start", kom_index}` på `task: "attack"`. Det nye afsæt er den entydige forskel fra gamle `kom`-planer, som beholder deres betydning ved toppen. Alle seks kanoniske roller, inklusive hjælper, tillades for den nye angrebsform. Luksushjælper går gennem den eksisterende helper-normalisering. Gamle rolle-/triggerregler ændres ikke ved slukket kontakt.

Ét fælles resolver-resultat bruges af API, frontend og motor: råt stigningsindex, navn, start, top og entydig segmentrelation. Start udledes af den valgte stignings rutedata og krydstjekkes mod dens climb-segment, aldrig af teksten. Navne er labels, aldrig nøgler. Dubletnavne kan derfor ikke flytte en ordre. Manglende/overlappende geometri eller et forældet index afvises ved gem; ingen tavs erstatning med en anden stigning. Visningsfallback for manglende navne genbruger #7980's kontrakt og Claude-tekst.

Index alene opdager ikke en omordnet rute. Læsesvaret skal derfor bære et serverudledt route-fingerprint over profil-id, distance, profiltype, ordnede climbs inkl. navne/geometri og segmenter; klienten returnerer det som en forventning ved gem, aldrig som autoritet. Den atomiske gemmeoperation låser og sammenligner den autoritative profil med den forventede ruteversion, før nogen ordre skrives. En app-side forhåndsvalidering efterfulgt af ukonditioneret upsert er utilstrækkelig. Et skift giver neutral 409-konflikt og genindlæsning, ingen delvis gemning. Fingerprintets kanonisering skal have én dokumenteret kontrakt på tværs af API og SQL-sammenligning; et låst sammenligneligt route-JSON kan bruges i transaktionen, så forskellige JSON-serialiseringer ikke skaber falske matches. Identitet, resolver-resultat og geometri fryses i løbets replay-input. #7980's gemmesti skal derfor udvides med rute-CAS, hvis den ikke allerede giver denne atomiske garanti.

En stigning fra km nul skal også kunne vælges: den nye kontrakt skal udtrykkeligt tillade det første angrebsled med denne start-trigger, uden at udvide den gamle first-leg-regel. Tidskørsler har ingen lang angrebsordre. Løb uden en entydigt identificerbar stigning har intet gyldigt stigningsvalg.

Planen bliver i samme JSONB-felt; ingen ny tabel eller per-segment databasekald er begrundet. API afviser nye triggerfelter uden kapabilitet, kontrollerer ejerskab/lås/etape/rolle og returnerer neutrale fejlkoder. Serveren udleder kompatibilitetsplanen ved gem; klienten må ikke levere en vilkårlig fallback.

### Motorens tilstand og gruppeklokke

En ny ren mekanik får planlagt afsæt og en eksplicit tilstand pr. rytter/planled: `pending`, `attempting`, `away`, samt afslutning med `failed`, `caught`, `superseded`, `retired` eller `finished`. DNF/OTL følger de eksisterende resultater og juryen. “Gået død” udledes af faktisk reserve-/tempo-/tabshistorik; det er ingen tilfældig straf eller synonym for ethvert tabt angreb.

1. Efter planens skift og før segmentets fysiologi/traversal registreres hensigten. Alle ryttere i samme segment læser samme indgangstilstand. Starten splittes deterministisk i adapteren, hvis en eksisterende segmentgrænse ikke rammer den valgte stignings start. Løsningen skal bevare integreret distance/arbejde og fælles gruppeklokke; ingen nearest-boundary-aktivering efter toppen.
2. Rytteren forsøger fra den gruppe, han faktisk sidder i, også udbrud, forfølgergruppe, bagfelt eller grupetto. En udgået rytter handler ikke. En allerede ensom rytter skifter indsats uden at skabe en dubletgruppe. Ingen flyttes til morgenudbruddet, fronten eller en gruppe længere fremme.
3. Udskilning og gap opstår gennem en særskilt traversal for angriberen og relativ ankomst mod kildegruppen. Ingen gratis startgevinst fra `lateAttack`, ingen ommærkning af et eksisterende forspring og ingen dobbelttælling ved split. Kræfter bruges før udfaldet afgøres gennem samme fysiologi som resten af motoren, også når forsøget mislykkes.
4. En eller flere samtidige angribere kan ende sammen, når fysisk kontakt/traversal begrunder det. Ingen automatisk holdteleport eller global solo-grænse. Stabil sortering af ryttere/planled og separate deterministiske RNG-strømme gør resultatet uafhængigt af rækkefølgen på DB-rækker.
5. Efter afsættet fortsætter motorens almindelige tid, terræn, vind, læ, jagt og indhentningsmekanik. Hvis den eksisterende jagt kun kan følge morgenudbrud, udvides dens måludvælgelse til lang-angrebsproveniens gennem samme jagtmodel; morgenudbruddets tilladelses- og GC-loft genbruges ikke som forbud mod ejerens kaptajnangreb. Klassetruende angreb må få en reel jagtreaktion.
6. At blive hentet betyder fysisk kontakt med kilde-/jagtgruppen via den eksisterende gruppeklokke/merge, ikke blot at gruppe-id skifter. At hente en gruppe foran er et vellykket bridge, ikke “caught”. Senere resultat og klassementsgevinst afgøres af faktisk måltid og normal finalisering. Etapevinder/morgenudbrudsmærkat udledes ikke af angrebsordren.

Angrebsproveniens følger medlemmerne gennem split/merge og er adskilt fra gruppens display-kind/id og morning-break-origin. #7635 skal genkende et langt angreb som angrebsgruppe, så lederens afsæt ikke fejlagtigt gør alle hjælpere “sat”. Absorbering af en rigtig front skal bevare den eksisterende regel for reel selektion.

Det kræver ikke at tænde #7635. Når #7884 er ON og #7635 er OFF, skal en snæver #7884-gated referenceafledning udelukke netop grupper med aktiv lang-angrebsproveniens som bevis for, at en holdkammerat er sat. Den oprindelige ikke-angrebsfront og reel selektion er stadig reference. Når #7635 er ON, bruges dens fælles afledning med samme nye proveniens. Når #7884 er OFF, er begge eksisterende #7635-tilstande uændrede. Alle fire kombinationer testes, inklusive at en angrebsgruppe absorberer en rigtig front og derefter igen kan være reel reference.

### Samspil med øvrige opgaver

Et nyt planled afløser aktiv angrebsintention; allerede optjent afstand og brugte kræfter bevares. Den aktive opgave er eneste indsatskilde. En hentet angriber får derfor ikke automatisk gratis hvile; indsatsen følger resten af planen som hidtil. Efterfølgende “sat”-led, slutindsats, jury og træthedsledger skal læse samme faktiske forløb. Hjælperen yder ikke samtidig støtte til kaptajnen, mens han kører et selvstændigt angreb uden for gruppen.

Det sene soloangreb og nedkørselsangreb må ikke give et ekstra instant-forspring til et igangværende langt angreb i samme segment. Andre ryttere kan reagere med deres eksisterende mekanikker, men ét fysisk split må kun debiteres/emitteres én gang. Nye film-events har rider, planled, stigningsindex, kilde, faktisk km og årsag; renderer viser forsøget, bridge/indhentning og udfald fra samme data, aldrig opgaveskift som bevis for afsæt. Ingen præcise balancetal i offentlig filmtekst eller denne spec.

**Ejer-valg A, låst 11/11:** [beslutning på #7884](https://github.com/NicolaiDolmer/CyclingZone/issues/7884#issuecomment-6806066791). Rytteren får ét forsøg på den valgte stigning. Bliver han hentet, er kræfterne brugt, og resten af planen gælder. Intet automatisk genangreb: et afsluttet forsøg kan ikke genaktiveres af samme ordre, et gruppeskift eller et senere segment på stigningen. Det tidligere [beslutningskort på #7864](https://github.com/NicolaiDolmer/CyclingZone/issues/7864#issuecomment-6805454398) er dermed besvaret. Testplanen skal bevise dette ved mislykket afsæt, indhentning og split/merge. Dette valg er ingen build-godkendelse; særskilt build-go efter designreview kræves stadig.

### Kontakt, frysning og rollback

Egen slukket kontakt, foreslået navn `long_attack_7884`, og løbsbundet snapshot før start. API/UI-kapabilitet og serverens rå skrivetilstand skal skelnes, jf. #7980: OFF vælger aldrig den nye vej. Løbsflag, kompatibilitetsplan og input-checksum persisteres sammen med de eksisterende replay-inputs. En kontaktændring må ikke ændre et allerede beregnet resultat eller gøre samme checksum til forskellig simulering.

Ved OFF/gammel revision har uændrede input byte-identisk adfærd og ingen ekstra RNG-/DB-arbejde. For allerede gemte nye planer skal en serverberegnet `plan_no_long_attack` holde den foregående gyldige opgave over angrebsleddet og bevare senere gyldige led; første angrebsled får en gyldig neutral start. Den skal genvalideres for rollen/ruten og medtages i det låste input. Ingen omfortolkning af afsæt som topangreb. Nødstop påvirker kun endnu ikke afviklede input med særskilt registreret snapshot/checksum; replay bruger altid sit historiske snapshot. API/UI viser tydeligt inaktiv plan med Claude-godkendt tekst.

Fallback skal sammensættes med trøjejagt: den eksisterende ene `fallback_legs` er ikke nok til to uafhængige kontakter. For planer med den nye angrebsform udleder serveren én effektiv plan fra originalen og det løbsbundne kapabilitetssnapshot: fjern/degradér først ugyldig lang angrebsform, anvend derefter jagt-fallback hvis jagt er OFF, fold ens tilstødende led og genvalidér hele kæden/rollen/kronologien. Legacy-felterne afledes af denne effektive plan, ikke af originalen eller en separat gammel fallback. Snapshot/checksum bærer original, relevante kompatibilitetsdata og kapabiliteter; adapteren sender præcis én færdig effektiv kæde til motoren. Alle fire long-attack/jersey-hunt-kombinationer testes med blandede planer, helper og første-led-angreb. Gamle planer uden nye felter beholder deres eksisterende sti. En fallback, som stadig indeholder den anden slukkede opgave, må aldrig blot droppe hele en ellers gyldig plan.

Fravalg: at genbruge `lateAttack` ved et tidligere km giver gratis split og mangler den lange energikæde. At genbruge morgenudbrud giver forkert placering/GC-adgang og er ejerens fravalgte B. Ren ny tekst er ejerens fravalgte C. En parallel database-/simulationsmotor er unødvendig.

## Realisme: forudvalgt vindue og dokumenterede udfald

[Metoden blev lagt på issuet før optællingen](https://github.com/NicolaiDolmer/CyclingZone/issues/7884#issuecomment-6805184995): Tour 2024 etape 14–20, inklusiv flad kontrol. Inkludér dokumenteret offensiv på en navngiven stigning med mindst én kategoriseret stigning senere. En episode er én beskrevet offensiv fase, ikke én deltager, KOM-placering eller hver acceleration. Fælles/ikke adskilte bevægelser i rapporten tælles sammen. Angreb på sidste stigning, på nedkørsel eller blot tilkørsel tælles ikke. Uklar identitet/geografi giver ukendt, aldrig nul.

| Etape | Identificerbare inkluderede episoder og kildegruppe | Observeret udfald |
|---|---|---|
| [14: ASO](https://www.letour.fr/en/news/2024/spectacular-pogacar-impresses-with-saint-lary-soulan-triumph/1322037) | Gaudu/Lazkano fra udbrud på Tourmalet, én fase. KOM-motiv/stagesejrsintention er ikke fastslået. | Tilbage i fælles frontgruppe før sidste stigning; ingen etapesejr fra fasen. |
| [15: ASO](https://www.letour.fr/en/news/2024/its-pogacar-again-on-plateau-de-beille/1322529) | Carapaz lukker fra bag fronten på Col d'Agnes, én fase; præcis kildeundergruppe uoplyst. Peyresourdes mange unavngivne forsøg er ukendt antal. | Bridge til fronten lykkes; senere hentet på Plateau de Beille. Slutangreb dér tælles ikke. |
| [16: ASO](https://www.letour.fr/en/news/2024/stage-16/sprint-masterclass-from-philipsen-in-nimes/1322785) | Ingen kvalificerende geometri: kun én kategoriseret stigning. | Flad negativ kontrol. Gachignards solo indhentes; det tælles ikke i nævneren. |
| [17: ASO](https://www.letour.fr/fr/actus/2024/carapaz-le-collectionneur/1323185) | Fire faser: Madouas/Martin fra bag fronten på Bayard; S. Yates frem mod/forbi fronten på Noyer; Carapaz efter og forbi Yates på Noyer; Pogacar fra GC-gruppen på Noyer. | Bayard-duoen indhenter frontkvartetten, senere passeret; Yates hentes/passeres; Carapaz vinder etapen; GC-trioen samles igen i nedkørslen. Evenepoels sidste-climb-gevinst tælles ikke som Noyer-succes. |
| [18: ASO](https://www.letour.fr/en/news/2024/elation-for-victorious-victor-in-barcelonnette/1323552) | Mange angreb på Saint-Apollinaire, men deltager/forløb er ikke tilstrækkeligt identificeret til diskrete episoder. | Ukendt nævner/udfald for disse angreb. Campenaerts' vindertrio dannes efter sidste kategoriserede stigning; sejren tælles ikke som dokumenteret tidligere-climb-sejr. |
| [19: ASO](https://www.letour.fr/en/news/2024/pogacar-the-king-of-isola-2000/1323956) | Carapaz/S. Yates fra felt til frontgruppe på Vars, én samlet beskrevet fase; rapporten adskiller ikke deres afsæt. | Bridge lykkes, begge senere passeret på Isola 2000. Jorgenson/Pogacars sidste-climb-angreb tælles ikke. |
| [20: ASO](https://www.letour.fr/en/news/2024/stage-20/pogacars-couillole-glory-in-yellow/1324356) | Første GC-bevægelse beskrives ved tilkørsel til Braus; Armirail/Keldermans præcise afsæt er uklart. Nedkørselskontraer tælles ikke. | Ukendt for strengt definerede tidligere-climb-episoder; ikke nul angreb. Sidste-climb-angreb indhentes, men er udenfor definitionen. |

Manuel optælling: **syv identificerbare episoder, én med en deltager som etapesejrer (1/7)**. Det er en beskrivende andel for disse rapporter, ikke et estimat for alle forsøg: dækningen er ufuldstændig, faserne har forskellige formål, fælles bevægelser kan skjule flere forsøg, og bridge/KOM-succes er ikke etapesejr. GC-gevinst fra tidligere angreb kan ikke isoleres kausalt af slutresultaterne. Ingen konfidensinterval eller godkendt intern succesgrænse udledes af prøven.

Som særskilt langdistanceanker, uden for nævneren: [Giro-arrangørens Froome/Finestre 2018-beretning](https://www.giroditalia.it/en/news/memories-from-colle-delle-finestre-2018-chris-froomes-legendary-attack/) beskriver afsæt 80 km fra mål, jagt gennem dal og Sestriere, sejr på Jafferau og førertrøje. Det beviser, at stor sportslig gevinst er mulig, ikke hvor almindelig den er.

Sammenligning med baselinen: de virkelige forløb kræver afsæt før toppen, bevægelse mellem aktuelle grupper, fortsat jagt og adskilte mål for bridge, etape og GC. Den nuværende plan skifter blot indsats ved toppen. Dens senere resultatplaceringer kan derfor ikke sammenlignes som samme eksponering. Efter byg skal et større sammenhængende datasæt med registrerede forsøg og fejlslagne forløb fastlægges før kalibrering; ejeren godkender et navngivet realisme-/balancemål, før et resultat kan kaldes grønt.

## Testplan og gates for et senere build

| Tier | Nødvendigt bevis |
|---|---|
| Kontrakt/typer | Gated trigger; alle seks roller/luksushjælper; km nul; ukendt/flyttet/dubleret navn/index; rute-fingerprint og atomisk konflikt ved omordning mellem læs/gem; manglende geometri; kronologi; TT; låst etape; sammensat serverfallback i alle fire jagt/angreb-kombinationer; ingen klientvalgt fallback. |
| Native PG17 + API/loader | Otte ryttere i production-DDL; faktiske gemme-/læsefunktioner inkl. #7980 atomisk sti når tilladt og legacy når OFF; statusfejl og neutral fejlkode; ACL/RLS, save/load/fallback og input-snapshot. Baselinens SQL-transport erstatter ikke denne senere HTTP-test. |
| Motor | Faste seeds og injiceret klokke. Alle reelle gruppepositioner og oprindelser, singleton, hentet/bridge/merge/split, samtidige angreb, udgået/OTL, ingen gratis afstand/energi, integreret arbejde ved segmentsplit, monotoni under samme eksogene udfald. “Sat” i alle fire #7884/#7635-kombinationer, støtte, sene angreb, nedkørsler, GC-jagt og film/resultat skal være konsistente. |
| Alle løbsgrupper | Endagsløb, korte etapeløb, GT, monumenter og både U23/junior. Reelle forskelle i distance, startfelt, GC-stilling og træthed; en ny label på samme fixture er ikke dækning. Både kuperet, bjerg, lange dale/nedkørsler og negativ flad/TT-kontrol. |
| Regression/realisme | Frossen OFF/ældre-revisions-byteparitet og replay-checksum. Længere GT-sekvens med slidt felt; samme rider-ID'er i parrede forløb, rapportér RNG-forgrening i stedet for at love perfekte fælles tilfældige tal. Fordelinger for afsæt, varighed, indhentning, bridge, sejr, GC-tab/-gevinst og senere energiregning holdes privat. Ingen bestået balance uden ejerens mål. |
| FULL + browser | Fuld backend/frontend/build og fuld E2E bag verify-lock med maskinloftet; desktop/mobil-billeder i PR. Preview viser valget på samme navngivne stigning som profilen, gem/genåbn, roller, OFF/fallback samt filmens faktisk mislykkede, indhentede og overlevende angreb. Claude leverer/godkender hjælpetekst og patch notes. |
| Menneskelig gate | Claude og ejer ser dette design først. Efter særskilt build-go: draft-PR ved første commit, løbende push, uafhængigt review, skeptisk dommer-review og tester-runde på staging før tænd-kort. Merge og aktivering kræver hver sit senere mandat. |

Designfasen kræver ingen patch notes eller feature-statusændring: ingen brugerrettet runtime-adfærd leveres, og issuet forbliver åbent. NOW/MASTERPLAN og status-close-out ejes af Claude. Ingen NOW-arkivfil oprettes.
