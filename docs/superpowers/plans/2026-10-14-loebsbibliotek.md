# Løbsbibliotek: implementeringsplan og testplan

> Ved senere udførelse: brug superpowers:executing-plans og afkryds trinene sekventielt. Ingen parallel delegation uden særskilt mandat.
>
> Status 14/10/2026: ejeren har godkendt skitsens retning og **Kommende løb som startfane**. **Godkendt til build 14/10**, [registreret på #6514](https://github.com/NicolaiDolmer/CyclingZone/issues/6514#issuecomment-6175783481). Merge/release afventer stadig ejerens mandat. Implementeringen ligger i eget worktree og draft #6636.

**Mål:** Ét hurtigt, søgbart løbsbibliotek med kommende løb, historik og sammenhæng mellem udgaver. Spilleren skal kunne finde et løb og forstå den valgte udgave uden at grave i kalenderen.

**Arkitektur:** Selvstændige TypeScript-moduler og komponenter under race-library. Eksisterende arkivindgang monterer oversigten; eksisterende historikrute monterer udgaveopslaget. Et afgrænset læselag bruger eksisterende Supabase-tabeller og fælles helpers. Ingen backend-, motor- eller kalenderændring i grundplanen.

**Teknologi:** React, React Router, eksisterende UI-primitiver og i18next; Supabase SELECT; Node --test og Playwright.

**Designgrundlag:** Ejerens A-valg, mobil-/desktopskitsen vist 14/10 og efterfølgende besked: “Det ser godt ud. Kommende løb som startfane.” Skitsens gennemgang er registreret på [#6514](https://github.com/NicolaiDolmer/CyclingZone/issues/6514#issuecomment-6174896280). Dette dokument fastholder beslutningerne og specificerer den fremtidige udførelse.

## Bindende grænser og kilder

- Arbejd i egen worktree fra frisk origin/main; klargør den med scripts/setup-worktree.ps1 før lokale kodechecks. Før start læses NOW's Working agent; biblioteket overtager aldrig Claudes aktive spor.
- Ingen ændring af /races/:id, RaceDetailPage, components/race/*, /race-centre, S5-kalenderen eller #6367, #6362, #6369, #6570. Ingen fortsættelse af #5833 eller #6601. Ingen ændring af NOW/MASTERPLAN.
- Ingen kalendergenerering, udtagelse, taktik, migration, flag-flip, deploy eller beskeder til spillere. Biblioteket er en læseflade; planlægningsknappen er et link til eksisterende /planning?tab=selection.
- Normative kilder: [PAGE_TEMPLATES](../../design/PAGE_TEMPLATES.md), [TASTE](../../design/TASTE.md), [TONE_OF_VOICE](../../TONE_OF_VOICE.md), [CALENDAR_RULES §0/0b](../../CALENDAR_RULES.md), [PLANNING_CENTER_RULES §0/3](../../PLANNING_CENTER_RULES.md), [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md) og [SOCIAL_RULES](../../SOCIAL_RULES.md). Motorregler bruges kun til at forstå dokumenterede resultater.
- #6514 ejer leverancen. [#3900](https://github.com/NicolaiDolmer/CyclingZone/issues/3900) ejer det allerede godkendte kalenderoverblik; dette bibliotek erstatter eller implementerer ikke dét design. [#1106](https://github.com/NicolaiDolmer/CyclingZone/issues/1106) er reference for 10+ sæsoner. [#1148](https://github.com/NicolaiDolmer/CyclingZone/issues/1148) er icebox og ejer museum/rekorder; ingen kuratering eller nye rekordtal her.
- Schema-snapshot kontrolleres før hvert nyt SELECT. Kun nødvendige offentlige visningsfelter; ingen motorvektorer, private balance-tal eller spilleridentiteter i fixtures, rapporter og screenshots.
- Nye produkt- og testfiler er .ts/.tsx. Eksisterende .jsx-filer bevarer formatet.

## Låst oplevelse og foreslået adfærd

1. Indgangen forbliver /resultater?tab=archive. Det er **bibliotekets** startfane, der bliver Kommende løb; Resultaters eksisterende Seneste-fane ændrer ikke standard.
2. Kommende løb / Historik; søgning, sæson, løbstype og klasse. Arv Resultaters sæson/division/pulje, med egen aktuelle verden som default. Fremtidige sæsoner kan vælges, når de findes; vis kun eksisterende, tilgængelige løbsdata. En oprettet sæson er ikke bevis for et færdigt program.
3. T2-oversigt: navn, dato/periode, distance eller dokumenteret vinder, etapetal og Åbn. Ingen forklaringskort før data. På mobil: navn plus tre synlige kolonner, 44 px åbneknap og Flere filtre. Fuld tabel er en valgfri visning med fast navnekolonne og scroll kun i dataområdet.
4. T3-opslag: den konkrete udgaves navn, status, datoer, distance og etaper; Udgaver forbinder samme løb på tværs af sæsoner. Kalenderdato og løbsdag vises separat. Ruteoplysninger kommer fra faktisk gemte profiler/sektorer; ingen opdigtet højdekurve.
5. Foreslået overgang, som skal accepteres sammen med planen: igangværende løb står tydeligt markeret “I gang” øverst i Kommende. Historik indeholder færdige løb. Igangværende løb får aldrig en endelig “vinder”. Ukendt/annulleret status må ikke lydløst behandles som planlagt.
6. Foreslået URL-kontrakt: behold tab=archive; tilføj library=upcoming|history, q, raceType, raceClass og table=compact|full. Behold eksisterende season/division/pool. Manglende eller ugyldigt library giver upcoming. Browserens tilbage/frem genskaber filtre og valgt visning. En direkte udgave åbnes på eksisterende /race-archive/:raceSlug med raceId samt scope-parametre; ingen ændring af App-ruter.
7. Fjern dobbelt søgning, den konkurrerende katalogblok og den gamle alt-på-én-gang historikberegning fra disse indgange. De beskyttede komponentfiler slettes eller redigeres ikke. Bevar eksisterende historiske statistikker via særskilt, udskudt læsning; ingen ny museumfunktion.

## Evidens og ubekendte

**MÅLT EVIDENS:** Clarity havde én session i arkivkohorten i den undersøgte 30-dagesperiode; kohortens sessionstal beviser ikke sidens aktive tid. SELECT til skitsen viste kommende S4-løb og historiske udgaver af samme løb i S1-S3, alle med edition_year=2026. Skitsen blev kontrolleret ved 390 px samt smallere viewport: ingen ydre vandret overflow, 44 px åbneknapper og fungerende søgning/filternulstilling. Kilder: [audit](../../audits/2026-10-14-svageste-omraader.md) og [Clarity-metode](../../audits/2026-10-14-svageste-omraader-clarity.md).

**Kodeobservation, main 5ac04e1d0:** RaceHistoryPage søger med ilike(name) og henter alle resultattyper for alle fundne udgaver før statistikker vises. ResultaterPage henter også Seneste-data før arkivindholdet kan vises. deriveRaceStatus og toDisplayRaceDay findes allerede. Dette dokumenterer læsestierne, ikke deres målte svartid.

**FORTOLKNING:** Et metadataførst læselag kan reducere arbejde og gøre biblioteket forståeligt. **Ingen evidens** for nuværende p50/p95, præcis årsag til de rapporterede søgefejl, stabil familieidentitet på alle historiske rækker eller forbedret spilleradfærd efter redesign. Første leverance skal måle disse forhold; intet performance-tal er ejer-godkendt mål endnu.

## Filansvar og grænseflader

| Fil, relativt til repo | Ansvar |
|---|---|
| frontend/src/lib/race-library/types.ts | LibraryScope, LibraryQuery, RaceEditionSummary og RaceEditionDetail; nullable metadata og eksplicit status |
| frontend/src/lib/race-library/model.ts + model.test.ts | Søgning, stabil sortering, familie/udgave-identitet og afledning til visning |
| frontend/src/lib/race-library/queries.ts + queries.test.ts | SELECT, paginering, batches, scope og feltprojektion; ingen skriver |
| frontend/src/hooks/useRaceLibrary.ts | Data-livscyklus, cache pr. komplet query, fejl og seneste forespørgsel vinder |
| frontend/src/components/race-library/RaceLibrary.tsx | T2-header, faner, filtre, kompakt/fuld tabel og kanoniske tilstande |
| frontend/src/components/race-library/RaceEdition.tsx | T3-opslag, udgaver og faktiske ruteoplysninger |
| frontend/src/pages/ResultaterPage.jsx | Kun bibliotekets montering og adskillelse af arkivets load fra Seneste |
| frontend/src/pages/RaceHistoryPage.jsx | Tynd kompatibilitetsindgang til RaceEdition |
| frontend/public/locales/{en,da}/{results,races}.json | EN først, DA parallelt; kun bibliotekets tekstnøgler |
| frontend/tests/e2e/race-library.spec.ts + race-library.fixture.ts | Anonymiserede scenarier og screenshots i eksisterende testharness |
| docs/RACE_LIBRARY_RULES.md | Ny SSOT for læsefladen: identitet, scope, status, ruter og manglende data |
| docs/FEATURE_REGISTRY.yml, docs/FEATURE_STATUS.md | Afstem eksisterende results-archive; STATUS genereres |
| frontend/src/pages/PatchNotesPage.jsx | Ved senere spillervendt levering, efter tekst-go |

**Kontrakter:** listRaceLibrary(query, signal) leverer sorterede metadata for én valgt sæson og scope. listRaceEditions(familyKey, scope, signal) leverer sammenlignelige udgaver. getRaceEdition(raceId, scope, signal) leverer én autoriseret udgave og detaljer. Funktionerne må afvise ukendt/inkonsistent scope; aldrig brede forespørgslen som fejl-fallback.

LibraryScope indeholder seasonId, tier, poolId og squad=senior. LibraryQuery tilføjer fane, søgning, type og klasse. Udgave-identitet er race.id; hver udgave bærer seasonId og leagueDivisionId. Familieidentitet foreslås baseret på pool_race_id, **efter kontrol af historiske data**. Årstal og normaliseret navn er aldrig unikke nøgler. Legacy-rækker uden familie-ID kræver entydig opløsning; ved flere matches vises valgmuligheder med sæson/pulje.

Ved “alle puljer” vises separate udgaver med puljelabel; vindere blandes ikke. Sæsonlisten kan vise historisk pensionerede puljer. Nye seniorqueries genbruger seniorScope.ts; ingen direkte frontend-læsning af race_pool. Status genbruger deriveRaceStatus; løbsdag genbruger toDisplayRaceDay. Færdige vindere bruger korrekt resultat-type og sidste gyldige etape, jf. raceResultsPodium.js; manglende finalisering/resultat vises ærligt.

## Leverance 1: bevis og læselag

Afhænger af plan/build-go; producerer kontrakter og tests til leverance 2/3. Én afgrænset PR, ingen synlig montering.

- [ ] Reproducér #6514 med Tour de l'Hexagone, Vuelta Ibérica og Giro della Penisola på eksisterende arkiv. Registrér korrekt scope, fundne udgaver, forespørgsler, payload og tid til første brugbare indhold. Anonymisér beviser; dump ikke netværkshemmeligheder.
- [ ] Kontrollér familie-ID på repræsentative S1-S4-udgaver, samme årstal/flere puljer og manglende IDs. Dokumentér valgt entydig opløsning i ny SSOT.
- [ ] Før første performance-/DB-query-PR: mål read-only query-baseline i **lokal PG17**, jf. AGENTS §36. Anonymiserede fixtures: lille pulje, stor pulje, 12 sæsoner og over 1.000 resultatrækker. Registrér miljø, datasæt, EXPLAIN ANALYZE, payload, requestantal og p50/p95 for gentagne ens læsninger. Prod kun SELECT efter schema-opslag. Ingen migration.
- [ ] Skriv fejlede kontrakttests først: scope, identitet, status, søgenormalisering og paginering. Implementér derefter types/model/queries.
- [ ] Hent metadata fra races, seasons, league_divisions og race_stage_schedule. Profilsammendrag vælger kun visningsfelter. Hent detaljer for valgt udgave; historiske vindere henter kun relevante færdige resultattyper. Udskyd tværsæson-statistik til aktivt historikafsnit.
- [ ] Alle potentielt store læsninger pagineres med stabil orden og ID-tiebreaker; store ID-lister batches inden for eksisterende PostgREST-grænser. Søgning må ikke kun undersøge første side.
- [ ] Sammenlign før/efter på samme datasæt. **Foreslået regressionskrav:** færre overførte resultatdata ved første visning og ingen forringelse i p95. Det er et forslag, ikke et vedtaget verdensklasse-mål. Hvis frontend-læselaget ikke er tilstrækkeligt, fremlægges målingen og et særskilt backendforslag før scope udvides.
- [ ] Kør relevante tests; review kontrakter og publicer dokumenteret baseline på #6514. Intet nyt indeks, RPC eller aggregat sniges ind.

## Leverance 2: bibliotekets oversigt

Forbruger leverance 1; producerer T2-oversigt og kompatible URL-filtre.

- [ ] Skriv e2e-regressioner for de tre rapporterede løb, startfane, URL/back-forward, filterskift og tilstande.
- [ ] Implementér RaceLibrary og hook med kanonisk PageHeader, Tabs, FilterBar, DataTable, Segmented, SkeletonLines, EmptyState og ErrorState. TASTE-farver, hairlines, tabular figures og højst én guldknap pr. view.
- [ ] Monter kun på arkivfanen. Adskil bootstrap af egen sæson/pulje fra Seneste-data, så et arkivbesøg ikke venter på rangliste/podie-queries. Seneste/Point-adfærd bevares og testes.
- [ ] Søgning matcher diakritik, apostrofvarianter og mellemrum uden at ændre identitet. Sæsonskift bevarer gyldige filtre; ugyldig pulje markeres/nulstilles synligt, ikke lydløst erstattet med en anden pulje.
- [ ] Implementér mobilens tre kolonner og frivillig fuld tabel. Bevar query og tilbageposition ved åbning/lukning af udgave; ingen skjulte dobbelte filtre.
- [ ] Vis fejl særskilt fra ingen resultater og fra sæson uden løbsdata. Hurtige skift må aldrig vise et sent svar fra gammel query. Auth-fejl genbruger eksisterende sessionhåndtering.
- [ ] Lever lys/mørk mobil og desktop til ejerreview. Ingen merge før aftalt visuelt bevis og review.

## Leverance 3: udgaveopslag og afslutning

Forbruger metadata/identitet og bibliotekets URL-kontrakt; producerer T3-opslag.

- [ ] Skriv regressioner for samme årstal i flere sæsoner, gamle navne-URL'er, valideret raceId, puljer, manglende vinder og profil.
- [ ] Monter RaceEdition gennem RaceHistoryPage. Bevar gamle links; afkod navne én gang og behandl wildcard-tegn som tekst, ikke ilike-mønstre. Ukendt/ambivalent link får tydelig genfinding.
- [ ] Vis Udgaver med konkret sæson/pulje/status. Skift mellem kommende og afsluttet udgave opdaterer alle tal sammen; ingen historisk vinder på kommende løb.
- [ ] Vis gemte profiler og sektorer fra valgt udgave. Ved manglende elevation_profile vises eksisterende relevante rutedata og forklaring; ingen dekorativ erstatningskurve.
- [ ] Bevar historiske statistikker med afgrænset paginering og eksisterende resultatsemantik. Ingen blanding af puljer og ingen ny rekord-/museumfortælling.
- [ ] Gentag performance-sammenligning, komplet testtier og ejerpreview. Afstem SSOT, results-archive, genereret featurestatus og patch notes i samme leverance. Ejerens release-/merge-mandat indhentes særskilt.

PR'erne køres sekventielt; højst to draft-PR'er åbne/stablede. Hver har eget diff mod frisk main. **Et diff-hit i beskyttede stier eller en nødvendighed for at ændre Claudes kontrakter stopper bibliotekets integration**, ikke Claudes arbejde.

## Testplan og accept

| Niveau | Tilfælde | Krævet resultat |
|---|---|---|
| Rene unit-tests | Diakritik/apostrof/blank søgning; identitetscollision; status scheduled/live/completed/ukendt; manglende metadata; eksplicit now | Samme løb findes, forskellig udgave forbliver forskellig; ingen vægur-afhængighed |
| Query-tests | Senior vs ungdom, season/tier/pool, pensioneret historisk pulje, fejl, over 1.000 rækker, lige sorteringsnøgler | Ingen datalæk, tabte/duplikerede rækker, skjult fejl eller query-widening |
| Hook/e2e | To filterskift med svar i omvendt orden, abort/unmount, auth/netværksfejl og retry | Kun seneste query vises; chrome består; loading bliver terminal |
| Browserflow | Default upcoming, direkte history-link, legacy-navnelink, forkert raceId, 12 sæsoner, lang EN/DA tekst, genfinding/tilbage | Korrekt kontekst; ingen blindgyde eller tab af søgning |
| Visuelt | 1280×900, 390 px og 320 px; lys/mørk; alle tre Playwright-projekter; tom/fejl/loading/manglende program | Ingen ydre overflow/clipping; 44 px mål; fuld tabel scroller kun internt; tydeligt fokus |
| Data/performance | Samme baseline-datasæt før/efter; første liste, detail og historikstatistik | Målinger vedlægges; ukendt effekt beskrives som Ingen evidens |
| Afgrænsning | Diff samt request-log | Ingen beskyttede filændringer; bibliotekets domænekald er SELECT; ingen udtagelse/generering |

**Review Focus:** familie-ID/legacy-tvetydighed (L1/L3), scheduled med kørte etaper (L1/L2), paginering før søgning (L1/L2), puljescope ved udgaver (L1/L3), sent svar efter filterskift (L2). Alle fem har eksplicitte tests ovenfor.

**Tier:** TIER FULL, fordi leverancen omfatter delte læsemoduler, i18n og mere end seks filer. Ved senere byg: målrettet Node --test først; frontend lint/typecheck; scripts/preflight-pr.ps1; scripts/verify-local.ps1; derefter hele frontend npm run test:e2e i desktop-chromium, mobile-chromium og mobile-webkit. Snapshots reviewes i alle tre, ikke blot opdateres.

Tunge checks wrappes i scripts/verify-lock.ps1 med Max 2. Brug offline test-build og eksisterende mock-harness: verify-local bygger med Vite direkte; Playwright i CI-tilstand genbruger bygget statisk output. npm run build indeholder upload-release-assets og må ikke bruges som en skjult releasehandling. Ingen HTTP-inspektion af dev-moduler; kildekode læses fra disk, preview via browser/screenshot.

Ejeren skal på preview finde Vuelta uden præcis accent, vælge ældre L'Enfer-udgave, se kommende udgave uden vinder og skifte tilbage med bevarede filtre, på både mobil og desktop. En kort staging-tester-runde anbefales for denne samlede pakke, efter særskilt stagingmandat.

## Omfang, beslutning og handoff

**M/L**, tre reviewbare leverancer; intet kalender-/motorarbejde. Kritisk afhængighed er korrekt historisk familieidentitet og en tilstrækkeligt hurtig eksisterende læsesti. S5-data er ikke en forudsætning for udvikling: test med anonymiserede S1-S4-lignende fixtures samt syntetisk fremtidig sæson; ændr aldrig S5 for at få biblioteket grønt.

**Udførelse 14/10:** de tre leverancer udføres sekventielt som commits i samme draft-PR #6636. Det holder maksimum to drafts sammen med planens #6634 og undgår en release uden mandat. Tjekbokse ovenfor er den oprindelige acceptliste, ikke en påstand om fuld verifikation; aktuel evidens og resterende gates står i PR og #6514.

**Afvigelser med bevis:** katalog-IDs skifter på S1-S4 for tre GT-familier. Præcist gemt navn + løbstype identificerer derfor kandidater; race.id og scope identificerer altid udgaven. Se [SSOT](../../RACE_LIBRARY_RULES.md) og [PG17-baseline](../../audits/2026-10-14-loebsbibliotek-baseline.md). Ingen evidens for autentificeret produktsvartid eller forbedret spilleradfærd. Tidligere arkivsøgning kunne ikke reproduceres i en autentificeret produktionssession.

**Patch notes:** ændringerne skrives i frontend/src/data/patchNotes.js, som PatchNotesPage render; selve render-siden ændres ikke. Ingen publicering/Discord-opslag udføres her.
