# Koordinering mellem auktion, sæsonskifte og taktik

Dato: 28/10/2026. Refs #7322, #7298, #7317, #6924, #4619.

**Status: audit og løsningsforslag, ikke godkendt til build.** Ejeren har valgt retning B for auktion/graduering og bestilt gennemgangen før byg. Der er ikke ændret produktkode, spillertekst, database, flag eller drift. Dokumentet er teknisk beslutningsgrundlag; spillertekst og visuel udformning udarbejdes med Claude efter særskilt design-go.

## Konklusion og afgrænsning

De vigtigste fund er forskellige former for manglende koordinering: separate skriveveje for rytterens tilstand, sæsondata der kun indlæses én gang, lokale lister over taktikroller og en gemmehandling der består af to uafhængige writes. En fælles besked om at noget har ændret sig løser kun visningernes friskhed. Den erstatter ikke transaktioner, versionskontrol eller fælles regler.

Anbefaling: afgrænsede leverancer med fælles kontrakter og tests af hele forløb. Genbrug eksisterende hjælpekode og serverens tilladte valg. Ingen samlet omskrivning eller indførelse af en global event-platform som første skridt.

Undersøgt baseline: `19dbab68d05d957b67302a67e6caea0ce3346630` på origin/main. To uafhængige læsende explorers undersøgte backend-sæsonskifte og taktik. Hovedsessionen kontrollerede fundene og udførte lokale, isolerede reproduktioner. Ingen nye forekomster af frontendfundene er målt i produktion.

## Bevisniveau

- **Prod + kode:** den oprindelige auktionskonflikt er observeret i Sentry, aktivitetslog og læsende databaseopslag i denne samtale.
- **Lokal reproduktion:** den uændrede funktionskode er kørt med in-memory-doubles. Disse viser de konkrete kontrolforløb; de er ikke browser- eller PostgreSQL-integrationstests.
- **Kodefund:** dataflow og begrænsninger er verificeret i kildekoden, men ikke fremprovokeret i produktion.
- **Afklaringspunkt:** et muligt problem eller en kontraktforskel, hvor ønsket adfærd eller live-årsag ikke er fastslået. Det tælles ikke som en bekræftet prodfejl.

## 1. Auktion og graduering

### A1. To salgsveje koordinerer ikke

**Bevis:** CYCLINGZONE-AS, https://cycling-zone.sentry.io/issues/156859697/. Den 28/10 blev en almindelig auktion oprettet kl. 14.46 dansk tid. Cirka 29 minutter senere forsøgte gradueringens salgsvej at oprette endnu en. Databaseindekset afviste den. Der var ét match mellem holdets afventende gradueringer og auktioner på fejltidspunktet. Sentry-anmodningens body er fjernet, så rytteridentifikationen bygger på denne kobling, ikke et bevaret request-id. Ingen navne eller brugeridentifikatorer gengives her.

**Kilder:** `backend/routes/api.js:7411` kontrollerer eksisterende auktion i almindelig salg; `:7637` skriver auction_started. `backend/lib/academyGraduation.js:504` kalder den særskilte oprettelse; `:1020` indsætter uden opslag eller håndtering af den specifikke konflikt. `backend/routes/api.js:18914` bygger gradueringslisten ud fra pending alene. `frontend/src/lib/useAcademy.js:169` sender gradueringsvalget.

Den almindelige auktion afslutter ikke gradueringen ved oprettelse. Det er i sig selv nødvendigt at skelne et salgsforsøg fra et gennemført salg. Fejlen er, at visning og handlinger ikke tager højde for den igangværende auktion.

### A2. Auktion spærrer ikke alle gradueringshandlinger

**Lokal reproduktion:** kald af `resolveGraduation(action='promote')` med en aktiv auktion i fixture viste `outcome=promoted`, `auctionLookupPerformed=false` og writes til riders og academy_graduation. Produktionsdata blev ikke berørt. Det er ikke bevist, at nogen spiller har udløst netop dette forløb.

**Kilder:** `backend/lib/academyGraduation.js:451-535` har ikke auktionskontrol før promote/release. `backend/lib/academyTransfer.js` har derimod hasActiveAuction-gaten i moveRider. UI-blokering alene vil derfor efterlade en serversti uden samme regler.

### Foreslået B-kontrakt

1. Én fælles vurdering af rytterens aktuelle ejer, trup, graduering, markedsforpligtelser og tilladte handlinger. Alle berørte salgs-, flytte-, frigivelses- og sweep-indgange bruger den.
2. Graduation Day viser en igangværende auktion og navigation til den. Bekræft alle må kunne behandle andre ryttere uden at genoprette auktionen.
3. Gentagne og samtidige salg må ikke oprette to auktioner. Kun samme kompatible forløb kan behandles som allerede udført; en auktion med anden ejer eller anden semantik må ikke ukritisk adopteres.
4. Kontrol og skrivning skal serialiseres på den samme rytter i databasen, inklusive de konkurrerende indgange. Trupkapacitet skal desuden beskyttes på holdniveau: to forskellige ryttere må ikke begge tage den sidste plads. Genbrug den eksisterende konsistente hold-før-rytter-låserækkefølge fra trup-RPCerne og verificér den på alle indgange. Et SELECT før INSERT er ikke tilstrækkeligt. Det eksisterende unikke auktionsindeks bevares som ekstra beskyttelse.
5. Promote/release/sweep skal respektere den aktive auktion. Køberens og sælgerens data skal fortsat være konsistente, hvis handlinger konkurrerer eller genforsøges efter et netværksudfald.
6. Salg med bud afstemmer gradueringen mod faktisk ejerskab. Notifikationer skal kunne genforsøges uden at gentage selve salget.

### Oprindelsen må ikke gå tabt

**Anbefaling:** en almindelig auktion ændrer ikke automatisk karakter til en tvungen gradueringsauktion, blot fordi Graduation Day opdager den.

| Afslutning | Almindelig auktion med åben graduering | Auktion oprettet som gradueringsvalg |
|---|---|---|
| Faktisk salg | Afstem graduering efter bekræftet ejerskifte | Samme bekræftede afslutning |
| Ingen bud | Rytteren bliver på holdet; gradueringsvalget og dets frist består. Efter fristen bruges den eksisterende godkendte default-kæde, når ingen auktion længere spærrer | Følg den eksisterende godkendte no-bid-kæde og promotion-pending-flagets regler |
| Annullering | Genberegn tilgængelige valg uden automatisk salg/oprykning/frigivelse | Kræver eksplicit beskrevet genåbning/genoptagelse, så et sold-stempel ikke efterlader en afsluttet auktion uden videre forløb |

**Hvorfor:** `backend/lib/auctionFinalization.js:1628-1645` skelner allerede mellem almindelig og egentlig gradueringsauktion for at undgå uønsket oprykning/frigivelse ved et frivilligt salg uden bud (#6320). Vi må ikke genindføre det problem ved blot at stemple en eksisterende almindelig auktion sold i gradueringsrækken.

**Åbent kontraktpunkt før byg:** `resolveUnsoldGraduate` og `completeStuckPromotion` i `academyGraduation.js:689-849` bruger senior som mål, mens en graduering også kan være junior til U23. YOUTH_RULES indeholder både den ældre seniorrettede no-bid-regel og de to nyere overgange. Der er ikke målt et konkret forkert juniorforløb. Afklar målet og annulleringsudfaldet særskilt, før B ændrer finalisering. Ingen nye spilregler er vedtaget af denne audit.

**SSOT:** `docs/YOUTH_RULES.md` §2.2, §2.6 og afventer oprykning; `docs/TRANSFER_MARKET_RULES.md` om auktioner, ejerskab og atomiske forpligtelser. De opdateres i samme implementerings-PR, hvis kontrakten ændres.

## 2. Sæsonskifte

### S1. Åbne sider kan beholde sidste sæsons referenceår

**Kilde:** `frontend/src/hooks/useActiveSeasonYear.js:30-50` laver ét opslag i useEffect med tom dependency-liste. Der er ingen abonnement, fokus-genhentning eller fælles sæsonversion i denne hook. Den bruges bl.a. af TeamPage, SquadPage, TrainingPage, AuctionsPage og TransfersPage. TeamPage bruger også hookens resultat til kontraktindikatorer (`TeamPage.jsx:1021-1026`).

**Lokal reproduktion:** den uændrede hookfunktion med en minimal hook-livscyklus-double beholdt referenceåret for sæson 4, efter fixture-data skiftede til sæson 5. Remount gav sæson 5. Dette er ikke en browserreproduktion af alle sider.

**Konsekvens:** en åben side kan bruge tidligere sæsons alder/kontraktreference sammen med nyere data. Andre sider kan skifte hurtigere; Dashboard lytter allerede på seasons og races (`DashboardPage.jsx:110,612`). Det er en konkret forskel mellem fladernes opdateringsmekanik.

**Forslag:** en fælles reaktiv sæsonkontekst med id/nummer, formålsspecifik reference og friskhed. Genhent ved relevant sæsonhændelse, genforbindelse og tilbagevenden til fanen, med deduplikerede kald. Verificér publication og læserettigheder før realtime tages for givet. Bevar manuelle historikvalg og ugemte kladder; undgå tvungen reload som standard.

Alder/kontrakter, resultater og planlægning må fortsat have forskellige sæsonvalg. `seasonReference.js` skelner allerede aldersreference (fremad mellem sæsoner) og resultatreference (bagud); disse godkendte regler skal ikke erstattes af ét ubetinget aktivt season_id.

### S2. Aktiv sæson er ikke bevis på færdigt sæsonskifte

**Kodefund, ikke målt prodhændelse:** `seasonTransition.js:844-871` aktiverer den nye sæson (kaldt fra `:1121-1125`) før senere start-hooks og carryover. `:1566-1591` registrerer fejl i overførsel af manageropsætning og fortsætter. `seasonCarryOver.js:743` afvikler flader sekventielt, så en tidlig fejl springer de efterfølgende over i netop det forsøg. Den eksisterende fejltest bekræfter, at transitionen kan afsluttes med carryover-fejl.

Det er en bevidst best-effort-kontrakt med Sentry/phaselog og genoptagelse, ikke bevis for at sidste live-skifte fejlede. Men en læser, der alene ser active, kan ikke udlede, om netop dens afhængigheder er klar. Det gælder også før en normal kørsel er færdig.

**Forslag:** klassificér eksisterende faser efter afhængighed. Eksponér observeret parathed pr. relevant område og lad afhængige writes vente eller returnere en kontrolleret midlertidig tilstand. Ikke alle features skal nødvendigvis vente på f.eks. en dokumentar/notifikation. Vis fejlede nødvendige faser i driftsoverblikket, og genoptag kun de faser der er dokumenteret retry-sikre. Målet er ingen skrivning på halvfærdige forudsætninger, ikke et langt totalt vedligeholdelsesstop.

En mulighed er at aktivere sæsonen sidst; en anden er separat parathed under forberedelsen. **Anbefaling:** undersøg og klassificér de konkrete læsere før valg af databasekontrakt. Flytning af status alene kan skabe andre huller og må ikke bygges som et hurtigt universelt fix.

### Sager der ikke er bevist som nye fejl

- #7298 om tilbagevendende træningsprogrammer er stadig **ikke runtime-verificeret**. Sletning af en sæsonplan fjerner training_plans-rækken; den kan da ikke kopieres af carryover. Ugeplan og program-proveniens er en anden model i training_week_plans. Fjernelse af en ugeoverride kan vise en arvet/default plan uden at noget er genoprettet. Næste undersøgelse skal identificere spillerens præcise handling og sammenligne begge modeller før/efter et lokalt skifte. Ingen blind datarettelse.
- #6924 om afregning af sidste træningsdato er en eksisterende opgave. Den aktuelle gate spærrer et for tidligt skifte; den nye afregning af netop afsluttet sæson er ikke leveret. Bevar gaten indtil erstatningen er målt.
- #7235 om pensionsvisning blev leveret i #7254 og tælles ikke som nyt fund.
- Previewet har allerede en særskilt readiness-kontrol, og genoptagelse kører hooks/carryover igen. Der er ikke belæg for at påstå det modsatte.
- Motorens mulighed for to aktive sæsonrækker ved fejl mellem to writes er kendt i activeSeasonLookup.js. Den normale readiness-gatede rute kræver den gamle sæson afsluttet først. Det er ikke målt som årsagen til de rapporterede brugerproblemer og foreslås ikke omgået med endnu en tilfældig fallback.

**SSOT:** `CALENDAR_RULES.md` om sæsonvindue og akser, `TRAINING_RULES.md` om sidste dato og afregning, `PROGRESSION_RULES.md` om alder, samt den eksisterende MANAGER_SETUP_REGISTRY i seasonCarryOver.js. Udvid den eksisterende kontrakt, opfind ikke en parallel liste der også skal huskes.

## 3. Taktik

### T1. Nye roller gengives forkert i andre flader

**Kode og lokal reproduktion:** `RaceTeamTab.jsx:61-68` har en lokal liste over fem roller. co_captain og luxury_helper bliver begge til helper i den uændrede roleKey-funktion. `components/stageOrders/StageOrdersRecap.tsx:28,68` udelader samme roller, selv om recap-modellen bevarer den effektive rolle (`stageOrdersRecap.ts:79-104`). RaceTacticsTab og SELECTABLE_ROLES kender dem allerede.

**Forslag:** fælles typet vokabular og fuldstændig rollegengivelse på udtagelse, taktik, holdoversigt og efter-etape-oversigt. Brug compilerens udtømmende mapping, hvor muligt, før en ny tekstscannende CI-guard. Serverens feature-/revisionsgate bestemmer stadig, hvilke roller der må vælges i det konkrete løb. Ukendte værdier må ikke tavst vises som en anden gyldig rolle.

### T2. Vej-løbsordrer accepteres på tidskørsler uden den tilsvarende motorvej

**Kodefund:** RaceTacticsTab.jsx:846-900 viser udbruds-/togkontroller uden profilgate. raceTeamOrdersApi.js:198-221 validerer felter uden tilsvarende profilkontrol. ITT/ITT-hilly- og TTT-grenene i engine/v4/index.ts:239-264 modtager ikke input.orders. Det understøtter den eksisterende #7317, men er ikke en måling af hver mulig taktikværdi på alle motorrevisioner.

**Forslag:** serveren leverer tilgængelige handlinger pr. løb/etape/profil/revision/viewer, og UI samt skrivevalidering følger samme kontrakt. Vej-specifikke valg skjules eller vises utilgængelige på tidskørsler. Indsats bevares, hvor motoren bruger den. Historiske gemte ordrer må ikke masseændres. Visningsvalget skal godkendes visuelt; auditens tekst er ikke spillertekst.

### T3. Én gemmehandling kan gemme halvdelen og derefter konfliktere med sig selv

**Kilde:** RaceTacticsTab.jsx:595-642 gemmer stage-roles først og team-orders bagefter. Ved fejl i anden del er første del allerede persisteret, men lokal baseline og stage_versions opdateres først ved den afsluttende load, som ikke nås.

**Lokal reproduktion af den uændrede save-funktion:** første forsøg gav én stage-write, ét fejlet order-forsøg og nul reloads. Genforsøget sendte gammel base-version, fik stage_roles_conflict og nåede aldrig orders igen. Konfliktstien kalder load og kan kassere den resterende kladde. Backendens konfliktsikring skal bevares; det er frontendens egen baselinetilstand der er bagud.

**Forslag før eventuel større databaseændring:** før kvittering og version frem for hver vellykket del, bevar de endnu ikke gemte valg, og genforsøg kun de uafsluttede dele. Et samlet atomisk endpoint er alternativet, hvis produktkravet er alt-eller-intet. Anbefalingen er den afgrænsede genoptagelige gemning som første leverance; en UI må kun melde fuldt gemt, når begge dele er bekræftet.

### Tilsigtede forskelle og åbne produktvalg

- valid_efforts kommer allerede fra serveren. Kopi til næste etape fjerner bevidst ruteafhængig etapeplan, og assistenten er spillerudløst og udfylder kun manglende planer. Dette tælles ikke som fejl.
- Løbets låste regelrevision skal respekteres. En ny mulighed skal ikke automatisk dukke op i et gammelt eller allerede låst løb.
- Den nye rolle kan i visse pickere kun vælges, hvis holdudtagelsen allerede har den. Holdfanens rollekolonne beskriver basisrollen. Om disse produktvalg skal ændres, er ikke afgjort af auditten.
- Egentlige stående ordrer/genbrugelige brugerpresets er ikke bygget ifølge PLANNING_CENTER_RULES; deres fravær er ikke en ny regression.

**SSOT:** `RACE_ENGINE_RULES.md` om revisioner, roller, intention og tidskørsler; `PLANNING_CENTER_RULES.md` om planlægningsflader, defaults og assistentens mandat.

## 4. Forebyggelse og leverancer

| Leverance | Konkret resultat | Hvorfor afgrænsningen hjælper |
|---|---|---|
| 1. Rytterens salgsforløb | B-kontrakt, kendt auktionsoprindelse, fælles handlingskontrol, beskyttede konkurrerende writes | Fjerner den observerede konflikt og dens promote/release-varianter |
| 2. Sæsonens friskhed og parathed | Reaktiv sæsonreference; navngivne afhængigheder og observerbar status for nødvendige faser | Skelner gammel visning fra manglende dataoverførsel; bevarer historik og kladder |
| 3. Taktikkens fælles kontrakt | Udtømmende rollevisning, profilafhængige valg, genoptagelig gemning | En ny rolle eller mulighed skal være dækket gennem visning, validering og udførelse |

Forslag til obligatorisk ændringsspor pr. feature: registrér hvilke læsere, skrivere, sweeps, historikflader og flag/revisioner der berøres. Kontrolpunkterne skal være bundet til faktiske typer og kørende kontrakttests. En ekstra dokumentliste alene er ikke beskyttelse.

## 5. Testplan og godkendelsesgrundlag

### Målt baseline

- 138/138 eksisterende tests passerede 28/10 bag verify-lock med Max 2: seasonTransition.test.js, seasonCarryOver.test.js, seasonReference.test.js, stageRoleMatrixLogic.test.js, RaceTacticsTab.contract.test.js og stageOrdersRecap.test.ts.
- 18/18 lookup-/reference-tests passerede også i den første afgrænsede kørsel (overlap med sæsonreference ovenfor; ikke et ekstra uafhængigt totaltal).
- Fire lokale scenarier med uændret kildekode/doubles: promote uden auktionsopslag; sæsonalder der kræver remount; nye roller der bliver helper; delvist taktiksave efterfulgt af egen versionskonflikt.
- Ingen fuld e2e, browsergennemgang, build, lokal PG17-samtidighedstest eller produktionsændring er udført. Derfor ingen påstand om endelig fix- eller releaseverifikation.

### Før første implementerings-PR

Database-/samtidighedsdesignet kræver lokal PG17-baseline og fejlindsprøjtning efter regel 36. Fastlæg låserækkefølge og alle konkurrerende indgange, ikke kun den nye helper. Produktionsmåling af kendt auktionskonflikt er allerede til rådighed; øvrige fund kræver deres egen relevante baseline. Alle nye frontend-filer er .ts/.tsx.

| Område | Nødvendige regressioner | Ejerens synlige bevis før merge |
|---|---|---|
| Auktion/graduering | Almindelig auktion før/efter åbnet Graduation Day; dobbeltklik; to faner; sweep samtidig; promote/release samtidig; to forskellige ryttere konkurrerer om holdets sidste trupplads; salg med bud; ingen bud; annullering; genforsøg efter afbrudt svar; junior/U23 og U23/senior; uændret kontrakt; fremmed ejer afvises | Samlet før/efter på mobil og desktop; eksisterende auktion, andre gradueringsvalg og afslutningsforløb på staging |
| Sæson | Siden holdes åben over skift; tilbage fra baggrund; tabt realtime/reconnect; forsinket gammelt svar; historisk sæsonvalg; ugemte planer; fejl i nødvendig fase og sikker genoptagelse; sidste træningsdato | Samme rytter og reference på hold, træning, auktion og planlægning efter skift; kladder overlever; kontrolleret tilstand under nødvendig forberedelse |
| Taktik | Begge nye roller i alle læseflader; gammel/ny revision; flag off/beta/on; vej/ITT/ITT-hilly/TTT; gem og reload; første/anden write fejler; timeout efter faktisk commit; to faner; låst etape; kopiering og assistent | Samme rolle/indsats gennem udtagelse, taktik, hold og kørt etape; tidskørsel viser kun meningsfulde valg; fejlet gemning kan genoptages uden tab |

Backend/delte kontrakter: FULL-tier efter implementering, frontend-lint/typecheck/build og relevant fuld e2e efter repoets regler. Tunge forløb bag verify-semafor; orkestrator ejer e2e-slottet. Ved de større pakker en tester-runde på staging før release. Ingen build-go gives af dette dokument alene.

## 6. Næste ejerbeslutning

Første kort er kun leverance 1: godkend B med bevaret oprindelse og de beskrevne no-bid-forskelle, eller vælg at en almindelig auktion eksplicit skal overtages som gradueringsvalg med en særskilt bekræftelse. Anbefaling: bevar oprindelsen. Juniorens mål ved usolgt gradueringsauktion og annulleringens genoptagelse skal være entydige i den godkendte kontrakt.

Sæson- og taktikleverancerne er konkrete forslag til senere design-go, ikke en samlet ubegrænset byggeordre. Patch notes er ikke ændret, fordi der alene leveres et audit-/designoplæg og ingen brugerrettet ændring. NOW og MASTERPLAN er ikke ændret.