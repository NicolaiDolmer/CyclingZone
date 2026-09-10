# Omdømme, fans og merchandise — hvad findes allerede (research til D-041)

> Læst FØR noget konkret designes, som krævet af ejerens forbehold på D-041 (10/9).
> Kilder: kode (backend/lib), migrationer, docs/superpowers/specs, GitHub-issues, Discord-sweeps.
> Skrevet af research-worker, ikke en designbeslutning.

## 1. Hvad er BYGGET i dag

| Størrelse | Hvor den lever | Hvad ændrer den | Hvad den påvirker | Fil:linje |
|---|---|---|---|---|
| Rytter-omdømme (event-sourced motor, **flag OFF**) | `rider_reputation_events` (bog) + `riders.reputation/_floor/_form/_updated_at` | Løbsresultater ved løbsafslutning: sejr/podium/top10, trøjer, føretrøje-dag. Vægtet af løbsklasse (`W_CLASS` 0,1-1,0). Karriere-gulv falder aldrig, form halveres pr. sæsonskifte. Blødt loft `100·tanh(raw/74)`. | I DAG: intet — flaget `rider_reputation_enabled` står på `off`, ingen skriver, ingen læser (verificeret, seneste status-kommentar 4/9). | `backend/lib/reputationEngine.js`, `reputationConstants.js`, `reputationHook.js` (kaldes fra `raceRunner.js`), `reputationPersist.js`, `reputationFlag.js` |
| `riders.popularity` (den GAMLE, statiske værdi) | `riders`-tabellen | Sættes ÉN gang ved rytter-generering efter tier (superstar 70-100, star 45-85, solid 10-50, domestique 0-18). Ændres ALDRIG af spil. | Bestyrelsens `calculateRiderStarScore` (popularity·0,70 + UCI·0,30, tærskel 68), forced-listing-beskyttelse (popularity ≥ tærskel), rytterprofilens "popularity"-tal (vises som rå tal, ikke omdømme-ordbånd) | `backend/lib/fictionalRiderGenerator.js:141-144,597`, `backend/lib/boardIdentity.js:404-416`, `backend/lib/boardConsequences.js:355-359`, `frontend/src/components/rider/profile/RiderProfileHero.jsx:312-313` |
| `teams.reputation` (kolonne findes, **ufyldt/NULL**) | `teams`-tabellen | Intet endnu. Formel er SKREVET i migrationskommentar og spec §6: `0,7·mean(top-8 rytter-omdømme) + 0,3·resultsScore·100`, men søndags-sweepet der skal fylde den er ikke bygget (PR 4, issue #4957, ikke startet) | Intet i dag | `database/2026-09-05-1099-reputation-system.sql` |
| `countries.reputation` + `reputation_seed` (kolonner findes, seedet manuelt) | `countries`-tabellen (#844, 138 nationer) | Intet — seedet 31/5, ingen kodesti skriver eller læser den (grep-verificeret i backend/lib) | Intet i dag | `database/2026-05-31-countries-table.sql` |
| Klub-"renown" (sponsor-PROXY, ikke ægte omdømme) | `renownEngine.js` | Division + sidste sæsons placering/rank i divisionen (`computeResultsScore`) | Sponsor-basens multiplikator (maks 1,40×) — dette er den mekanik der REELT driver sponsor-indtægt i dag | `backend/lib/renownEngine.js`, `backend/lib/sponsorOffers.js` |
| Manager-achievements (kosmetiske trofæer) | `manager_achievements`-tabellen | Sæson-milepæle (fx grand tour-sejr, top3-stræk) | Kun kosmetisk visning, ingen spilleffekt | `backend/lib/achievementEngine.js` |
| Hall of Fame (tom, skjult) | `hall_of_fame`-tabellen (0 rækker) | Intet — siden er fjernet fra navigation (ejer-beslutning 11/7, #2359), venter på "verdenshistorik" (#1148/#1997) | Intet, redirecter til /standings | `frontend/src/pages/HallOfFamePage.jsx` |
| Løbsklasse/"prestige" i kalenderen | `races.race_class` (9 faste klasser: TourFrance, GiroVuelta, Monuments, OtherWorldTourA/B/C, ProSeries, Class1/2) | INTET dynamisk — klassen er STATISK, sat ved kalendergenerering ("prestige-walk" i `tierCalendarGuarantees.js`), reagerer ikke på hvilke ryttere der rent faktisk stiller op | Fødes ind som fast vægt (`W_CLASS`) i rytter-omdømme-motoren og i præmiepuljer | `docs/CALENDAR_RULES.md:505,905`, `backend/lib/tierCalendarGuarantees.js:192-220` |

**Vigtigt:** rytter-omdømme-motoren er en fuldt færdig, testet, kalibreret motor — men den kører bag et flag der stadig er slukket. Ingenting af det er live for spillerne endnu. `popularity` er det tal spillet reelt bruger i dag, og det er dødt (opdateres aldrig).

## 2. Hvad er BESLUTTET af ejeren

| Beslutning (ordret hvor muligt) | Dato | Kilde |
|---|---|---|
| "Fans initially affect popularity, sponsor interest, and expectations. Later they may affect merchandise and race income through the same popularity model." | 8/6 2026 | `docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md:200` |
| "Manager levels should become subtle cosmetic reputation or career history, not a gameplay progression track." | 8/6 2026 | Samme doktrin-doc:236 |
| Byg ÉT delt reputation-fundament for rytter (#1099) + manager (#1112) + nation (#844), forbrugt af Økonomi 2.0 (lånekapacitet) | 6/6 2026 | Issue #1099-kommentar |
| Lande: tre akser (fødselsrate, talent-loft, dynamisk omdømme+seed), blødt koblet feedback med gulv/loft + mean-reversion, motor bygges READ-ONLY først, feedback aktiveres først senere | 31/5 2026 | Issue #844 |
| Omdømme = "Football-Manager-agtig optjent standing", IKKE XP/streaks/login. Kun sportslig præstation + aktivitet driver det | 21/6 2026 | `2026-06-21-economy-coherence-design.md:17` |
| Rytter-omdømme design låst afsnit for afsnit: hændelsesbog, 0-100 = gulv (loft 60, falder aldrig) + form (halveres pr. sæsonskifte), point = løbsklasse × resultattype, ordbånd Ukendt/Kendt/Profil/Stjerne/Legende, flag off→shadow→on. Klub synlig som ét tal (§6-formel), sponsor uændret i S3. Manager: kun karrierehistorik, ingen effekt | 4/9 2026 (aften) | `docs/superpowers/specs/2026-09-04-reputation-system-design.md` §2 |
| "High profile"-markering (#2261) erstattes af omdømme ≥ 70 uden UCI-blanding, som FØRSTE forbruger af det nye system | 4/9 2026 | Issue #2261 |
| Hall of Fame skjules fra nav (tom tabel + doktrin-brud), venter på "verdenshistorik" | 11/7 2026 | Issue #2359 |
| **D-041 (i dag):** "Vi kan godt prøve 1 [offentlige 'kendt for'-mærker, ikke ét tal] - Men så skal du huske lige at læse de øvrige ting vi har planlagt angående omdømme, fans, merchandise - Men særligt omdømme. Jeg vil gerne have, at der bygges omdømme for hold, lande, managers, personale, ryttere og løb f.eks. Altså skal have omdømme, sådan at ryttere får mere omdømme, af at vinde løb med højt omdømme. Løbs omdømme skal stige efter hvor gode ryttere der kommer med til løbene mv." | 10/9 2026 | `docs/design/gdd/DECISIONS.md` D-041 (dette dokuments opdragsgiver) |

Fans og merchandise er IKKE ejer-besluttet i detaljer endnu — kun retningen "senere, koblet til omdømme" (doktrin 8/6) og "2027-horisont, bevidst ikke i kø endnu" (issue #2222).

## 3. Hvad er FORESLÅET men ikke besluttet

- **#1112** Manager-omdømme: issue-forslag om et delt "reputation-felt" der driver lånekapacitet — men doktrinen (8/6) og reputation-specen §6 siger allerede LÅST at manager kun får kosmetisk karrierehistorik, ingen effekt. Issuet er ikke opdateret til at afspejle den låsning.
- **#1113** Fans som spil-mekanik: fan-base pr. hold der vokser med resultater, feeder merch/sponsor. Kun retning, intet design. `priority:low`.
- **#2222** Merchandise: indtægt skaleret af fans/omdømme, spillervalg om prisniveau/sortiment. Eksplicit "2027-horisont i MASTERPLAN, bevidst ikke i kø endnu". `priority:med`.
- **#4957** PR 4 i rytter-omdømme-rækkefølgen: nation + klub afledt i søndags-sweepet, landeside/klubside. Ikke startet — venter på PR 2 (shadow-drift 7 dage) og PR 3 (synlighed).
- **#3448** Markedsdrevne værdier: rytter-omdømme skal fodre markedsværdi/lønkrav, men "først efter 27/9" (grundregler udskudt).
- **#1148** World history & Club Museum: trofæer, klubrekorder, sæsonhistorier som kosmetiske achievement-items — ikke bygget.
- **#1997** Verdensklasse historik/palmares (rytter+hold): afhænger af et fundament-issue (immutabelt team_name-snapshot pr. resultat) — ikke bygget.
- **#934** Landshold & internationale mesterskaber: afhænger af egen race-engine (#676) — ikke bygget. D-041's "løbs omdømme stiger med feltets kvalitet" overlapper delvist, men landshold specifikt er separat.
- **#2477** Verdensrangliste der fodrer race-engine (kvalifikation/wildcards) — designstadie, kan krydse et fremtidigt løbs-omdømme.
- **PUBLIC_ROADMAP.md** (sidst opdateret 4/5, FØR reputation-specen, ren vision-liste, ikke spec'et): "Omdømme på løb og ryttere — løb-prestige påvirker præmiepuljer", "Lande-størrelse/omdømme — hold med stærk national identitet får sponsor-boost", "Fans-mekanik", "Merchandise", "Press- og narrative-engine", "Manager XP / historie-arcs udvidet".

## 4. Modsigelser og huller mod D-041's netværksmodel

| Entitet | Status | Detalje |
|---|---|---|
| **Rytter** | Bygget + besluttet | Fuld motor, flag off. Ingen konflikt med D-041 — rytteren optjener af egne resultater, klar til at blive løftet af "vandt et løb med højt omdømme" hvis løbs-omdømme bygges senere. |
| **Hold/klub** | **MODSIGELSE.** Skema bygget, formel besluttet (spec §6: ÉT tal, `0,7·mean(top8)+0,3·resultsScore`). D-041's "valgte princip" siger eksplicit klubbens omdømme skal være offentlige "kendt for"-mærker, **ikke som ét tal**. Den låste §6-formel og D-041's princip peger i modsatte retninger — det er den skarpeste konflikt at rydde op i. |
| **Land** | Skema bygget, formel besluttet (spec §6: ÉT tal, `0,7·seed+0,3·mean(top10)`, gulv/loft ±15 fra seed). Samme spænding som klub (ét tal vs. D-041's netværkstanke), men D-041's "ikke ét tal"-princip blev udtrykkeligt sagt om KLUBBEN — uklart om det også skal gælde nation. Åbent spørgsmål, ikke en direkte modsigelse. |
| **Manager** | **MODSIGELSE.** Doktrin (8/6) + spec §6 (4/9) LÅSER manager til "ingen effekt, kun kosmetisk karrierehistorik". D-041 (10/9) kræver eksplicit at manageren er en del af omdømme-NETVÆRKET ("omdømme for hold, lande, managers, personale..."). Enten skal doktrinen genforhandles, eller D-041's opremsning af manager skal tolkes som "kun kosmetisk, men stadig i netværket" — det er uafklaret. |
| **Personale (staff)** | **RENT HUL.** Ingen reputation-kolonne, intet issue, ingen spec nævner staff-omdømme nogen steder i hele researchen. D-041 kræver det eksplicit. |
| **Ryttere → løb (feedback)** | **RENT HUL.** Der findes ingen mekanik hvor et løbs "omdømme" stiger dynamisk med kvaliteten af de ryttere der stiller op. `race_class` er en statisk, håndsat kalender-egenskab (9 klasser) brugt som INPUT til rytter-omdømme — aldrig et OUTPUT der ændrer sig. Dette er kernen i D-041's konkrete eksempel og findes slet ikke i dag. |
| **Fans** | Kun foreslået (#1113). Doktrinen siger fans "affect popularity" — men "popularity" i doktrin-sproget er det GAMLE statiske felt, ikke den nye event-sourced reputation. Skal afklares hvilket begreb fans kobler til. |
| **Merchandise** | Kun foreslået (#2222), bevidst 2027-horisont, afhænger eksplicit af fans (#1113) og omdømme (#1099). |

## 5. Anbefalede næste spørgsmål til ejeren

1. **Klub-omdømme: ét tal eller mærker?** Spec §6 har allerede en låst formel og en DB-kolonne klar. A: behold formlen som et UNDERLIGGENDE tal, og lad "kendt for"-mærker udledes AF tallet + handlingsmønster (hybrid, genbruger det byggede). B: kassér §6-formlen, byg mærker fra bunden uden noget sumtal.
2. **Manager i netværket — doktrin genforhandles?** A: behold doktrinen (manager forbliver kosmetisk, modtager aldrig fra og bidrager aldrig til netværket). B: åbn doktrinen (8/6) for genforhandling, så manager reelt kan give/modtage omdømme som resten af netværket kræver.
3. **Personale — med fra start eller senere lag?** A: inkludér staff i v1 af netværksdesignet (større scope, matcher D-041 ordret). B: hold staff udenfor v1 og eftermontér som separat lag senere (mindre scope, hurtigere landing på resten).
4. **Løbs-omdømme — ny akse eller erstatning?** A: byg et NYT, voksende "prestige-tillæg" ovenpå den eksisterende statiske `race_class`-vægt (løbet beholder sin kalender-klasse, men får et ekstra dynamisk lag). B: lad løbets dynamiske omdømme justere selve `W_CLASS` over tid (højere risiko for cirkulær opblæsning: stærke ryttere løfter løbet, som løfter rytterne endnu mere).
5. **Rækkefølge: færdiggør rytter-rørledningen eller design netværket først?** A: fuldfør PR 2 (shadow 7 dage) → PR 3 (synlighed) → PR 4 (klub/land) som allerede planlagt, og læg netværks-udvidelsen (manager/personale/løb) som en ny PR 5+ ovenpå. B: pause PR 2 nu og redesign hele fundamentet netværks-nativt fra bunden (mere sammenhængende, men taber momentum på det allerede kalibrerede PR 1-arbejde).

## 6. Kildeliste

**Kode:** `backend/lib/reputationEngine.js`, `reputationConstants.js`, `reputationHook.js`, `reputationPersist.js`, `reputationFlag.js`, `reputationReplay.js`, `renownEngine.js`, `boardIdentity.js`, `boardConsequences.js`, `fictionalRiderGenerator.js`, `achievementEngine.js`, `frontend/src/components/rider/profile/RiderProfileHero.jsx`, `frontend/src/pages/HallOfFamePage.jsx`.
**Migrationer:** `database/2026-09-05-1099-reputation-system.sql`, `2026-09-05-1099-reputation-column-grants.sql`, `2026-05-31-countries-table.sql`.
**Skema:** `database/schema-snapshot.json` (`riders`, `teams`, `countries`, `rider_reputation_events`, `hall_of_fame`, `manager_achievements`).
**Docs:** `docs/superpowers/specs/2026-09-04-reputation-system-design.md`, `2026-06-08-living-world-product-doctrine-design.md`, `2026-06-21-economy-coherence-design.md`, `2026-06-21-renown-sponsor-fase2-design.md`, `docs/CALENDAR_RULES.md`, `docs/PUBLIC_ROADMAP.md`, `docs/audits/2026-08-29-sponsor-board-decision-inventory.md`, `docs/audits/reputation-calibration-2026-09-05.md`.
**GitHub-issues:** #1099 (epic, rytter), #1112 (manager), #844 (land), #2261 (high profile-bug), #2723 (renown usynligt), #1113 (fans), #2222 (merchandise), #3448 (markedsvægt), #4957 (PR 4 klub/land), #1148 (world history & club museum), #1997 (palmares), #2359 (Hall of Fame skjult), #934 (landshold), #2477 (verdensrangliste), #1663 (sponsor-renown-proxy).
**Discord:** `scripts/discord/.sweep-daily-2026-09-07.md` — én spiller (anonymiseret) joker om at "det andet må indhentes i merchandise" i en løn-diskussion; ingen ejer-udtalelse om fans/merch fundet i sweep-filerne.
**GDD-samtale:** `docs/design/gdd/DECISIONS.md` Q-045/D-041 (10/9 2026).
