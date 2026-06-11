# Relaunch Control Tower Plan - TdF Launch (2026-06-20)

**Forfatter:** Manus AI
**Dato:** 8. juni 2026
**Codex review:** 8. juni 2026 - planen er brugbar som launch-indeks, men canonical status forbliver GitHub issues, `docs/NOW.md` og slice-docs. Harness-programmet der gør planen eksekverbar ligger i [`docs/HARNESS_ENGINEERING_STRATEGY.md`](HARNESS_ENGINEERING_STRATEGY.md).

## 1. Overordnet Mål

At sikre en succesfuld og stabil relaunch af Cycling Zone inden den hårde deadline den 20. juni 2026, med fokus på en frisk, uafhængig sæson 1, et robust og uafhængigt værdisystem, en funktionel race-motor, en solid progressionsmotor og en pålidelig Discord DM-funktionalitet.

Planen er et **control tower-indeks**, ikke en ny backlog. Hvert spor skal styres i GitHub-issuet, og hvert højrisiko-spor skal have et konkret harness: input, runner, oracle, rapport og feedback-loop.

## 2. Nøgle-issues og deres status

Følgende issues er identificeret som kritiske for TdF Launch og vil blive styret via denne plan:

| Issue Nr. | Titel | Status | Prioritet | Type | Ansvarlig AI (foreslået) |
|:----------|:-----------------------------------------------------------------|:-------|:----------|:---------|:-------------------------|
| #1115     | [bug] Discord DM-regression — overbuds-DMs virker ikke igen     | OPEN   | High      | Bug      | Claude                   |
| #1103     | Relaunch-orchestrator + founder-badge (frisk sæson 1)          | OPEN   | High      | Feature  | Claude                   |
| #1101     | Eget dynamisk værdisystem (base_value, ikke uci_points)        | OPEN   | High      | Feature  | Claude                   |
| #1102     | Light egen race-afvikling + PCM-fallback (launch-motor)        | OPEN   | High      | Feature  | Claude                   |
| #1136     | [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom | OPEN   | High      | Feature  | Claude                   |
| #679      | Discord-struktur + welcome-flow (TdF-ready)                    | OPEN   | High      | Feature  | Nicolai (med Claude assist.) |

| Harness-spor | Launch-gate |
|:-------------|:------------|
| #1102 Race engine | Deterministisk season dry-run med vinderfordeling pr. terræn/type og flag-off fallback |
| #1136/#1137 Progression | Multi-season preview med ability-delta, value-delta og retirement-histogram |
| #1103 Relaunch | Dry-run-default orchestrator med summary: reset -> population -> abilities -> value -> season 1 |
| #1101 Value cutover | Audit der beviser `base_value` driver market/salary og `uci_points` ikke er player-facing |
| #1115 Discord DM | Token + delivery canary med alarm før brugerne mærker regression |

### Kort Opsummering af Nøgle-issues:

*   **#1115 Discord DM-regression:** Dette er en kritisk bug, hvor Discord-botten ikke kan sende private beskeder (DM's), hvilket påvirker notifikationer om overbud og auktioner. Problemet er en regression af et tidligere fix, og der kræves en permanent rodårsags-fix med forward-guards [3].

*   **#1103 Relaunch-orchestrator:** Dette issue omhandler den komplette nulstilling og genopbygning af spillets tilstand til en frisk sæson 1. Det inkluderer population af fiktive ryttere, backfill af deres evner og tildeling af founder-badges til beta-testere. Målet er en deterministisk og verificerbar proces, der sikrer en ren start for alle spillere [1].

*   **#1101 Eget dynamisk værdisystem:** Dette issue er afgørende for at etablere et uafhængigt og dynamisk værdisystem for ryttere, der ikke er bundet til UCI-point. Det involverer en ny `base_value` kolonne, omlægning af `market_value`/`salary` og en ny `riderOverall` funktion. Slice 1 (shadow-model v2) er allerede implementeret, men cutover til at bruge `base_value` aktivt afventer ejer-verifikation [14].

*   **#1102 Light egen race-afvikling:** Dette issue fokuserer på at implementere en lightweight, men robust race-motor, der kan afvikle løb uden afhængighed af PCM. Den skal være deterministisk, seeded og evne-baseret, med PCM-import som nød-fallback. Målet er at sikre, at løb kan afvikles stabilt og forudsigeligt til launch [2].

*   **#1136 [Epic] Progression & livscyklus:** Denne epic er spillets kerne-fantasi og omhandler rytterudvikling, træning og ungdom. L0 (passiv udviklings-motor) er launch-minimum og vil gøre spillet "levende" med mindst arbejde. Dette er et launch-kritisk område, og ejer har besluttet, at kvalitet går forud for dato [15].

*   **#679 Discord-struktur + welcome-flow:** Dette issue handler om at etablere en klar og funktionel Discord-kanalstruktur, welcome-flow og roller, der er klar til ekstern push. Dette er vigtigt for community-management og onboarding af nye spillere [16].

## 3. Prioriteret Eksekveringsrækkefølge

Baseret på afhængigheder, risiko og forretningsværdi foreslås følgende prioriterede rækkefølge for implementering:

1.  **#1115 Discord DM-regression (Akut Bugfix):** Dette issue har højeste prioritet, da det direkte påvirker brugeroplevelsen og kritiske spilmekanikker (auktioner). En hurtig og permanent løsning er essentiel for at genoprette tilliden og sikre, at spillere modtager vigtige notifikationer. Dette kan potentielt paralleliseres med de andre opgaver, men skal løses først.

2.  **#1103 Relaunch-orchestrator (Fundament):** Dette issue er fundamentet for den nye sæson 1. Det skal være på plads, før race-motoren og progressionsmotoren kan testes fuldt ud med den nye population. Nulstilling, population og tildeling af founder-badges er kritiske skridt for en ren launch.

3.  **#1101 Eget dynamisk værdisystem (Kernefunktionalitet - Shadow Cutover):** Slice 1 er allerede implementeret, men cutover til at bruge `base_value` aktivt afventer ejer-verifikation. Dette er kritisk for spillets økonomi og skal være på plads, før markedet åbner i sæson 1.

4.  **#1102 Light egen race-afvikling (Kernefunktionalitet):** Når relaunch-orchestratoren er på plads, kan race-motoren tunes og verificeres med den nye fiktive population. Fokus er på at sikre, at motoren leverer realistiske og forudsigelige resultater baseret på rytternes evner og etapeprofiler.

5.  **#1136 [Epic] Progression & livscyklus:** L0 passiv udviklings-motor er allerede merged på `main` (`cdeab9ce`). Næste launch-relevante arbejde er kalibrering, synlighed i Udvikling-fanen (#918) og L1/L2-scope - ikke en ny L0-implementering.

6.  **#679 Discord-struktur + welcome-flow (Community & Onboarding):** En velfungerende Discord-server er afgørende for community-engagement og onboarding af nye spillere. Dette kan køre parallelt med de tekniske opgaver, men skal være klar til launch.

## 4. Detaljerede Briefs og Kommentarer til GitHub Issues

### Issue #1115: [bug] Discord DM-regression — overbuds-DMs virker ikke igen (permanent rod-årsags-fix)

**Til Claude/Codex:**

```markdown
**Brief til #1115: Discord DM-regression (permanent rod-årsags-fix)**

**Mål:** Identificer og implementer en permanent rodårsags-fix for Discord DM-regressionen, der forhindrer botten i at sende private beskeder. Inkluder forward-guards for at forhindre fremtidige regressioner.

**Runtime-evidens:**
*   `backend/lib/discordNotifier.js`: Dette er den primære evidensfil. Den identificerer den præcise fejl-søm, env-navne-kompatibilitetsadfærd (`DISCORD_BOT_TOKEN` vs. `DISCORD_TOKEN`), stdout/test-channel routing-modes og logningsadfærd. Specifikt er `getBotToken()` (linje 102-104) og `sendDM()` (linje 188-204) kritiske punkter. `notifyDiscordDM()` (linje 214-252) håndterer routing og opt-out [11].
*   `backend/lib/discordBotTokenCheck.js`: En daglig sikkerhedsnet, der validerer bot-tokenet og alarmerer ved problemer. Relevant for forward-guard/monitorering [12].
*   `backend/cron.js`: Viser, at `runDiscordBotTokenCheck` kaldes, og at auktionsfinalisering passerer `notifyAuctionWon` til den delte finalizer, hvilket indikerer, at auktions-DMs stammer fra cron-drevet baggrundsarbejde [13].

**Invarianters der beskyttes:**
*   Discord DMs leveres pålideligt til brugere, der har valgt at modtage dem.
*   Token-rotation og env-sync-problemer forårsager ikke tavse fejl.
*   Test-konti spammer ikke rigtige managers med DMs.

**Minimal change:**
*   Først, verificer den faktiske fejl (token? scope? `openDm 401`? rate-limit? bruger har DMs slået fra?).
*   Tjek om #1002-guard-cron'en kører og alarmerer korrekt.
*   Find rodårsagen til regressionen (token-rotation-drift? Railway-env-sync ude af sync?).
*   Implementer en permanent fix, der adresserer rodårsagen, ikke kun symptomet.
*   Tilføj forward-guards (f.eks. forbedret logning, alarmering) der fanger regressionen FØR brugerne mærker den.

**Verification path:**
*   Test, at Discord DMs sendes korrekt for overbuds- og auktionsnotifikationer.
*   Verificer, at `getBotToken()` korrekt henter tokenet under alle omstændigheder.
*   Bekræft, at `discordBotTokenCheck.js` korrekt detekterer og alarmerer ved token-problemer.
*   Udfør en postmortem i `.claude/learnings/` for at dokumentere rodårsagen og den permanente løsning.
```

### Issue #1103: Relaunch-orchestrator + founder-badge (frisk sæson 1)

**Til Claude/Codex:**

```markdown
**Brief til #1103: Relaunch-orchestrator + founder-badge (frisk sæson 1)**

**Mål:** Implementer `backend/scripts/relaunchSeason1.js` som en ny orchestrator, der udfører en komplet nulstilling og genopbygning af spillets tilstand til en frisk sæson 1. Inkluder fiktiv population, backfill af evner og tildeling af founder-badges.

**Runtime-evidens:**
*   `backend/lib/betaResetService.js`: Indeholder eksisterende reset-logik for marked, rosters, balancer, board-profiles, race-kalender, transfer-arkiv, lån, notifikationer, sæsoner og manager-progress. Genbrug disse funktioner [4].
*   `backend/lib/fictionalLaunchPopulation.js`: Definerer `LAUNCH_POPULATION` med `seed: 2026`, `count: 800`, `referenceYear: 2026`. Orchestratoren SKAL importere disse parametre direkte for at sikre reproducerbarhed af sæson-1 populationen [5].
*   `backend/scripts/generateFictionalRiders.js`: Kan bruges som reference for CLI-wrapper og `--dry-run` funktionalitet, men `fictionalLaunchPopulation.js` er den kanoniske kilde for launch-parametre [6].
*   `backend/lib/seasonTransition.js`: Overvej genbrug af eksisterende sæson-transitionslogik for at oprette den nye sæson 1 [7].

**Invarianters der beskyttes:**
*   Brugerkonti bevares (kun game-state nulstilles).
*   Founder-badges tildeles korrekt og overlever fremtidige resets.
*   Ingen rigtige navne er aktive; kun fiktive ryttere i markedet.
*   Data-integritet på tværs af Supabase-tabeller efter reset.

**Minimal change:**
*   Fokus på at orkestrere eksisterende `betaResetService` funktioner og integrere `fictionalLaunchPopulation.js` for at opnå målet. Undgå at genopfinde hjulene.
*   Implementer `founder_badge` som en ny `achievements`-definition og indsæt i `manager_achievements` for beta-testere, der undtages fra `resetBetaAchievements`.

**Verification path:**
*   Kør hele sekvensen på en preview-DB (dry-run → rigtig). Verificer:
    *   Reset → population → backfills → sæson 1 er korrekt udført.
    *   Ingen legacy-ryttere (`pcm_id IS NOT NULL`) er aktive.
    *   Founder-badges er tildelt korrekt og forbliver efter reset.
    *   Rollback-sti er dokumenteret (legacy-ryttere kan re-aktiveres).
```

### Issue #1101: Eget dynamisk værdisystem (base_value, ikke uci_points)

**Til Claude/Codex:**

```markdown
**Brief til #1101: Eget dynamisk værdisystem (base_value, ikke uci_points)**

**Mål:** Implementer cutover til det nye dynamiske værdisystem, der bruger `base_value` i stedet for `uci_points` til at drive `market_value`/`salary`. Sørg for, at `uci_points` afkobles fra player-facing visning.

**Runtime-evidens:**
*   `backend/lib/riderValuation.js`: Indeholder den nye `ln(base_value) = a + b·output + offset[type]` model, som er blevet kalibreret med ejer-anchors. Denne model skal nu være primær [14].
*   `riderValuationAnchors.json`: Indeholder de 22 ejer-anchors, der blev brugt til kalibrering af `base_value` [14].
*   `fitRiderValuationModel.js`: Scriptet, der fitter modellen fra anchors [14].
*   `backend/scripts/backfillRiderBaseValue.js`: Scriptet til at backfille `riders.base_value` for hele populationen [14].
*   `database/schema.sql` (L57-64): De tre GENERATED STORED kolonner (`price`, `market_value`, `salary`) på `riders` skal omskrives til at bygge på `base_value` i stedet for `uci_points`.
*   `backend/lib/marketUtils.js` og `backend/lib/economyConstants.js`: Indeholder duplikerede formler for `market_value`/`salary` baseret på `uci_points`, som skal afkobles og opdateres til at bruge `base_value`.

**Invarianters der beskyttes:**
*   Marked/auktion/løn bruger `base_value`, ikke `uci_points`.
*   Ingen ryttere med `base_value = 0` efter backfill.
*   Fordeling af `base_value` ligner det godkendte prisspænd (stjerner vs. domestiques).
*   `uci_points` vises ikke længere player-facing.

**Minimal change:**
*   Omskriv de GENERATED STORED kolonner i `schema.sql` til at bruge `base_value`.
*   Opdater `marketUtils.js` og `economyConstants.js` til at referere `base_value`.
*   Sørg for, at `uci_points` ikke længere vises i frontend.
*   Implementer dynamisk glidning af `base_value` mod faktisk handelspris ved auktions-/transfer-afslutning (triviel v1 nok til launch).

**Verification path:**
*   Ejer-verify af shadow-værdier i admin-preview er en BLOKKER og skal være kvitteret før cutover.
*   Testsuite grøn (økonomi/marked-paths).
*   Verificer, at marked/auktion/løn korrekt bruger `base_value`.
*   Kontroller, at `uci_points` ikke er synlige for spillere.
```

### Issue #1102: Light egen race-afvikling + PCM-fallback (launch-motor)

**Til Claude/Codex:**

```markdown
**Brief til #1102: Light egen race-afvikling + PCM-fallback (launch-motor)**

**Mål:** Implementer en lightweight, men robust race-motor, der kan afvikle løb uden afhængighed af PCM, med PCM-import som nød-fallback. Motoren skal være deterministisk, seeded og evne-baseret.

**Runtime-evidens:**
*   `backend/lib/raceRunner.js`: Dette er den primære runtime-anker for race-motoren. Den viser den nuværende light-motor kontrakt, afhængigheden af populerede `race_entries`/abilities, og at motoren allerede er designet til at bevare den gamle `applyRaceResults` downstream-adfærd. `buildRaceResults` håndterer GC via kumulativ syntetisk tid med countback tiebreaks, point/KOM/youth/team klassifikationer, og bruger delte `buildRacePointsLookup`/`PRIZE_PER_POINT` [8].
*   `backend/lib/raceEngineFlag.js`: Definerer `RACE_ENGINE_V2_FLAG_KEY` og `isRaceEngineV2Enabled(supabase)`. Flag-off/default betyder, at PCM-import-stien forbliver den eneste aktive race-resultatkilde [9].
*   `backend/lib/raceSimulator.js`: Ren funktion `{ entrants, stageProfile, seed } → ranked`. Vægtet score på `rider_derived_abilities` mod stage-type + kontrolleret tilfældighed (genbrug `makeRng`/Box-Muller fra `fictionalRiderGenerator.js`).
*   `docs/research/genre-benchmark-june-2026.md`: Indeholder kalibreringsdata og anbefalinger for at skærpe demand-vægtene og sænke støjen i motoren, samt at verificere bjerg-fordelingen [10].

**Invarianters der beskyttes:**
*   `applyRaceResults` (standings/præmie-kontrakter) forbliver intakt.
*   Flag-off bevarer dagens PCM-import præcist (verificeret fallback).
*   Golden-seed-tests sikrer deterministisk og forudsigelig adfærd.

**Minimal change:**
*   Fokus på at implementere `raceSimulator.js` og `raceRunner.js` i henhold til den definerede kontrakt. Genbrug eksisterende `applyRaceResults` og `raceResultsEngine` logik.
*   Tune `DEMAND_VECTORS` og `NOISE_SD_SCALE`/`randomness` baseret på genre-benchmark for at opnå de ønskede vinderrater.

**Verification path:**
*   Afvikl en hel sæson på fiktive ryttere uden PCM.
*   Verificer, at gyldige `race_results` skrives gennem `applyRaceResults`.
*   Udfør distributions-tjek: stjerner vinder oftere end domestiques, men ikke 100%; roller matcher terræn.
*   Bekræft, at flag-off bevarer den eksisterende PCM-import-funktionalitet.
*   Verificer bjerg-fordelingen i cockpit: sikr, at baroudeurer reelt vinder en del af bjergetaperne.
```

### Issue #1136: [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (L0 - Passiv udviklings-motor)

**Til Claude/Codex:**

```markdown
**Brief til #1136: Progression & livscyklus (L0 - Passiv udviklings-motor)**

**Mål:** Implementer L0 (passiv udviklings-motor) som launch-minimum for epicen. Dette inkluderer potentiale-loft per evne, vækst mod loft (alders-vægtet), peak-kurve, stat-fald og semi-auto retirement. Gør spillet "levende" med mindst arbejde.

**Runtime-evidens:**
*   `docs/research/genre-benchmark-june-2026.md`: Bekræfter, at den foreslåede arkitektur (ability_caps + current abilities) er guldstandarden (Football Manager CA/PA-model). Anbefaler tre kalibreringer: peak-alder per type, blød decline og skjult youth-potentiale [15].
*   `backend/lib/riderProgression.js`: Indeholder den nuværende progressionslogik, som skal udvides til at understøtte L0-kravene.
*   `backend/lib/riderProgressionEngine.js`: Den motor, der skal drive progressionslogikken.

**Invarianters der beskyttes:**
*   Ryttere udvikler sig over tid (synligt i Udvikling-fanen).
*   Board-ungdomsmål kan opfyldes via reel stat-stigning.
*   Unge ryttere er meningsfuldt mere værd end deres nuværende stats (potentiale driver værdi).

**Minimal change:**
*   Implementer potentiale-loft per evne og vækst mod loft (alders-vægtet).
*   Implementer peak-kurve og stat-fald.
*   Implementer semi-auto retirement.
*   Inkorporer de tre kalibreringer fra genre-benchmark: juster peak-alder per type (f.eks. GC ~28, sprinter/lead-out ~26), dæmp `declineByYearsPastPeak` (f.eks. 2,6 → ~2,0) og introducer skjult youth-potentiale (skjult bånd, ikke eksakt tal).

**Verification path:**
*   Verificer, at en rytter kan ses udvikle sig over mindst én sæson (synligt i Udvikling-fanen, #918).
*   Kontroller, at Board-ungdomsmål (#813) kan opfyldes.
*   Bekræft, at unge ryttere har en meningsfuld højere værdi baseret på potentiale.
```

### Issue #679: Discord-struktur + welcome-flow (TdF-ready)

**Til Claude/Codex (eller Nicolai):**

```markdown
**Brief til #679: Discord-struktur + welcome-flow (TdF-ready)**

**Mål:** Etabler en klar og funktionel Discord-kanalstruktur, welcome-flow og roller, der er klar til ekstern push inden TdF Launch (2026-06-20).

**Runtime-evidens:**
*   Ingen direkte runtime-kode, da dette primært er en konfigurations- og opsætningsopgave på Discord-platformen. Afhænger af manuel opsætning og/eller brug af en bot som Carl-bot.
*   `docs/TONE_OF_VOICE.md`: Skal bruges til copy for welcome-channel [16].
*   `#671 Brand-minimum`: Server-icon + banner skal matche brand-minimum [16].

**Invarianters der beskyttes:**
*   Discord-serveren er indbydende og let at navigere for nye medlemmer.
*   Vigtig information er let tilgængelig.
*   Roller tildeles korrekt og understøtter community-segmentering.

**Minimal change:**
*   Opret de specificerede kanaler (`#general`, `#feedback`, `#race-discussion`, `#suggestions`, `#founder-only`).
*   Konfigurer en welcome-bot (f.eks. Carl-bot) til at hilse nye medlemmer, vise key-links og tildele `tester`-rollen default.
*   Opret de specificerede roller (`tester`, `founder`, `premium`, `dansk`, `english`).
*   Konfigurer reaction-role-flow for `dansk`/`english`.
*   Upload server-icon og banner, der matcher brand-minimum fra #671.
*   Opdater landing page og footer på `cyclingzone.org` med Discord-link.

**Verification path:**
*   Alle 5 kanaler oprettet og dokumenteret i pinned post i `#general`.
*   Welcome-bot live og testet med ny tester.
*   5 roller oprettet og reaction-role-flow for dansk/english virker.
*   Server-icon + banner matcher brand-minimum (#671).
*   Discord-link på landing page + footer er funktionelt.
```

## 5. Referencer

## 6. Codex review - beslutningsnoter

- Retningen giver mening: de seks spor er de rigtige launch-risici.
- Planen skal ikke kopiere issue-state fremover; opdater GitHub-issues og `docs/NOW.md`, og lad denne fil pege videre.
- #1115 bør stadig tages først, fordi det er en aktiv brugerrettet regression.
- #1103 er det vigtigste fundament for at gøre race, value og progression testbare på en frisk sæson-1-state.
- #1101 må ikke cuttes over før ejer-verifikation af shadow-værdier er eksplicit kvitteret.
- #1102 skal behandles som kalibrering + gate-hardening + runtime-wiring; simulatoren og dry-run-harnesset findes allerede.
- #1136 skal behandles som videre kalibrering/synlighed efter L0, ikke som blank implementering.
- Verdensklasse-laget er beskrevet i `docs/HARNESS_ENGINEERING_STRATEGY.md`: alle kritiske spor skal have et eksekverbart harness med oracle og feedback-loop.

[1] GitHub Issue #1103: Relaunch-orchestrator + founder-badge (frisk sæson 1) [https://github.com/NicolaiDolmer/CyclingZone/issues/1103]
[2] GitHub Issue #1102: Light egen race-afvikling + PCM-fallback (launch-motor) [https://github.com/NicolaiDolmer/CyclingZone/issues/1102]
[3] GitHub Issue #1115: [bug] Discord DM-regression — overbuds-DMs virker ikke igen (permanent rod-årsags-fix) [https://github.com/NicolaiDolmer/CyclingZone/issues/1115]
[4] `backend/lib/betaResetService.js`
[5] `backend/lib/fictionalLaunchPopulation.js`
[6] `backend/scripts/generateFictionalRiders.js`
[7] `backend/lib/seasonTransition.js`
[8] `backend/lib/raceRunner.js`
[9] `backend/lib/raceEngineFlag.js`
[10] `docs/research/genre-benchmark-june-2026.md`
[11] `backend/lib/discordNotifier.js`
[12] `backend/lib/discordBotTokenCheck.js`
[13] `backend/cron.js`
[14] GitHub Issue #1101: Eget dynamisk værdisystem (base_value, ikke uci_points) [https://github.com/NicolaiDolmer/CyclingZone/issues/1101]
[15] GitHub Issue #1136: [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom [https://github.com/NicolaiDolmer/CyclingZone/issues/1136]
[16] GitHub Issue #679: Discord-struktur + welcome-flow (TdF-ready) [https://github.com/NicolaiDolmer/CyclingZone/issues/679]
