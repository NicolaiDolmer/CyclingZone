# Træning pr. løbsdag og træningsscorens design (6/9 2026)

> **Status: design-spec til ejer-godkendelse. Intet er bygget, intet flag flippes, ingen prod-data røres.**
> SSOT for området er [`docs/TRAINING_RULES.md`](../../TRAINING_RULES.md); reglerne bor der, ikke her. Ejerens låste beslutninger fra samme session står i `TRAINING_RULES.md` §13.
> Kalenderens regler bor i [`docs/CALENDAR_RULES.md`](../../CALENDAR_RULES.md) §0 til §2. Præcise vægte, rater og tærskler står IKKE her (hard rule 17, [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)); hvor et tal hører til, står konstant-navnet og filen med linjenummer.
> Refs: [#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564) · [#4632](https://github.com/NicolaiDolmer/CyclingZone/issues/4632) · [#4629](https://github.com/NicolaiDolmer/CyclingZone/issues/4629) · [#4801](https://github.com/NicolaiDolmer/CyclingZone/issues/4801) · [#3461](https://github.com/NicolaiDolmer/CyclingZone/issues/3461) · [#4192](https://github.com/NicolaiDolmer/CyclingZone/issues/4192) · [#4277](https://github.com/NicolaiDolmer/CyclingZone/issues/4277) · [#4270](https://github.com/NicolaiDolmer/CyclingZone/issues/4270)

---

## 1. Hvad dette dokument beslutter

Spillets trænings-tick flyttes fra den danske kalenderdag til løbsdagen (`game_day`), så en rytter enten kører løb eller træner pr. løbsdag, og træningens udbytte udledes af en synlig træningsscore 1 til 99 der måler passets kvalitet.

---

## 2. Ejerens beslutninger 6/9

Truffet i en design-session med Claude Code, ét spørgsmål ad gangen. Beslutning 1 til 3 står allerede i `TRAINING_RULES.md` §13; 4 til 6 tilføjes samme sted af denne PR.

**Ejerens udgangspunkt, ordret:** *"Jeg vil gerne begynde at designe spillet mod, at man træner på en løbsdag i stedet for hver irl dag. Så er det også nemmere at finde ud, om en rytter kører et løb eller træner den enkelte dag. Jeg vil også gerne have designet vores system til træningsscoren."*

| # | Beslutning | Ejerens ord | Konsekvens |
|---|---|---|---|
| 1 | Tick-enheden er løbsdagen (`game_day`), og alle divisioner får SAMME antal løbsdage pr. sæson | *"Det skal være samme antal dage ind i spillet. Men divisionerne behøves ikke nødvendigvis at køre lige mange løb. Altså det kan sagtens være, at divisionerne der er lidt lavere, de bare får flere muligheder for at træne."* | Løbsdage uden løb er rene træningsdage. En rytter kører enten løb eller træner pr. løbsdag, så §6.2-afvigelsen forsvinder strukturelt. Restitution efter hver løbsdag (#3461). Rater rekalibreres så sæsonens samlede udvikling ikke stiger med antallet af ticks. "+1 pr. evne pr. dag" (#4801) betyder pr. løbsdag |
| 2 | "Træn i dag"-knappen og 25 %-bonussen fjernes | valgt 6/9 (anbefaling: fjern begge) | Programmet kører af sig selv når løbsdagen lukker. Ingen fordel af at logge ind ofte. Spillerens arbejde er program, dagens override og løbsdagens intention |
| 3 | Løbsdagens intention vælges i holdudtagelsen pr. etape sammen med rolle og taktik, standard Normal | valgt 6/9 (anbefaling) | Træningssiden viser den read-only. Én kilde, tre forbrugere: løbsmotor, træthed, udvikling. Lukker #4632 punkt 1 |
| 4 | Træningsscoren måler PASSETS KVALITET på 1 til 99, ikke udbyttet | *"Tættest på 1 - Men det skal også være alt efter hvor hurtigt/godt han udvikler sig. Sådan store talenter har bedre score, end nær så gode talenter. Derudover skal det også stige, hvis man har bedre træner, hvis man har bedre akademi mv. Altså underforstået, fordi man træner bedre."* | Score = f(potentiale, alder, session/intensitet, form/træthed, fokus-match, træner, faciliteter/akademi). Udviklingen udledes AF scoren, hvilket bekræfter #3564 beslutning 5. Udbyttet pr. evne vises fortsat som +point på udviklingsfanen |
| 5 | Scoren ses KUN af rytterens egen manager og er ærlig fra dag ét | valgt 6/9 | RLS som i dag. #3564 beslutning C (11/8, median ≥14 dage før potentiale kan aflæses) FRAFALDER: ingen støj-gate. Accepteret pris: køb-træn-sælg bliver et scouting-loop. Markedsværdi og fremmede ryttere røres ikke |
| 6 | Visning: kolonne på listen, kort på profilen | valgt 6/9 | (a) Kolonne "Score" på træningssidens rytterliste med dagens tal plus de sidste 7 løbsdage som lille monokrom sparkline (TASTE fork 5, `docs/design/TASTE.md:40`), sortérbar. (b) Kort på rytterprofilens træningsfane: dagens tal stort, gennemsnit og bedste over 30 løbsdage, kurve, én linje "hvad trækker op/ned". Kortet ERSTATTER den nuværende 30-dages-boks. Løbsdage viser "løb", ikke et tal; kurven har hul |

### 2.1 Arkitekt-beslutninger (Claude, ikke ejeren, må udfordres)

| # | Beslutning | Begrundelse |
|---|---|---|
| A1 | Ét tal pr. rytter pr. løbsdag, ikke ét pr. evne | Harnessen og #3564 beslutning 5 antager rytter-niveau (`backend/scripts/dev/curveHarness3564.mjs`, metodenote). Fladen i beslutning 6 er en kolonne, ikke en matrix. Spændingen mod #3564 beslutning D står i §5 |
| A2 | Egen tabel rytter × løbsdag (fx `rider_training_scores`), ikke report-JSON | Scoren skal kunne sorteres, aggregeres pr. hold og tegnes som kurve. JSON i `training_day_runs.report` kan ikke indekseres billigt (`backend/lib/dailyTrainingEngine.js:529`, `:604-614`) og arver unikheds-problemet i §3.2 |
| A3 | Støj-seed nøgles på løbsdagen, ikke på datoen | I dag `dtick:${riderId}:${dateStr}` (`backend/lib/dailyTraining.js:200`). Tre løbsdage samme kalenderdag ville ellers give tre identiske scorer |
| A4 | Scoren driver udvikling og er input til assistentens forslag. Den styrer IKKE AI-holdenes træning og IKKE værdi eller løn i første omgang | Værdi-koblingen hører til #3564 trin 4. Alt ud over feedback gør scoren balance-kritisk med egen harness-gate |

---

## 3. Modellen: løbsdagen som tick-enhed

### 3.1 Hvad der ændrer sig pr. komponent

| Komponent | I dag | Efter omlægningen |
|---|---|---|
| Kalenderpakkeren | Antal løbsdage er et søgeresultat pr. division. S4-planen: 79/58/56/56 (`CALENDAR_RULES.md` §1) | Fast, ens antal løbsdage i alle fire divisioner. Lavere divisioner får løbsdage uden løb, altså rene træningsdage |
| Tick-nøgle | `(team_id, tick_date)` med dansk dato (`dailyTrainingEngine.js:129`) | `(team_id, season_id, game_day)`. `game_day` er sæson- OG divisions-relativ, så sæson-filteret er obligatorisk (`backend/lib/raceBinding.js:302-310`) |
| Udløser | Manager-klik plus assistent-sweep fra kl. 22 (`trainingSweep.js:19`, `:26-27`) | Sweep når løbsdagen lukker. Manager-klikket udgår (beslutning 2) |
| Restitution og form | Ét trin pr. kalenderdag, kun i træningsticket (`dailyTrainingEngine.js:433-439`) | Ét trin pr. løbsdag. Konstanterne i `CONDITION_CONFIG` (`riderCondition.js:14-16`) skal rekalibreres mod det nye antal trin |
| Løb eller træning | Kalenderdags-lookup på `race_results.imported_at` (`dailyTrainingEngine.js:52-75`), flere etaper samme dato kollapser i en Map (`:252-254`) | Rytterbindingen pr. løbsdag: `race_entry_days (rider_id, season_id, game_day)` med `no_rider_double_booking_day`. Bemærk at tabellen svarer "bundet", ikke "kører" (spænd-binding, #4217) |
| Løbsdagens intention | Findes ikke | Ny kolonne på `race_entries`, sat i holdudtagelsen, læst af løbsmotor, træthed og udvikling |
| +1-loft (#4801) | Inert. `hardDailyCap` sendes aldrig (`dailyTrainingEngine.js:385`, `dailyTraining.js:216` sætter `dailyCeiling = Infinity`) | Loftet gælder pr. løbsdag. Det er en NY regel der skal bygges, ikke en eksisterende der omtolkes |
| Rater | `daysPerSeason` er deleren i base-formlen (`dailyTraining.js:13`, `:130`) | Rekalibreres mod antal løbsdage, så sæsonens samlede udvikling er uændret |

### 3.2 De konkrete brud fra kortlægningen 6/9

Kortlagt af fire lanes (tick, kalender, score, flader) plus kritiker, alle verificeret mod `main` og mod prod read-only.

**Skema og idempotens**

- `UNIQUE (team_id, tick_date)` er selve mutexen: en INSERT af en `{pending:true}`-række er låsen, og 23505 betyder `alreadyRan` (`dailyTrainingEngine.js:132-147`, constraint i `database/2026-06-12-daily-training.sql:42`). Nøglen kan ikke bære et heltal der nulstilles hver sæson.
- `rider_derived_ability_history` har `UNIQUE (rider_id, snapshot_date, source)` og upsertes med `ignoreDuplicates: true` (`dailyTrainingEngine.js:584`). Løbsdag 2 og 3 samme kalenderdag ville blive tavst kasseret. Præcis den stille fejlklasse `TRAINING_RULES.md` §10 beskriver.
- Læse-siden af samme tabel er større end skrive-siden: `backend/lib/riderValueTrend.js` (7/14-dages vinduer), `backend/lib/proRiderHistory.js`, `backend/lib/marketValueSundaySweep.js:45-51`, `frontend/src/lib/riderRatingTrajectory.js`. Divisionsafhængig takt ville gøre værditrend og rating-kurver systematisk forskellige mellem D1 og D4.
- `race_entries` har INGEN intentions-kolonne. Kolonnerne er `race_id, rider_id, team_id, is_auto_filled, created_at, race_role, binding_span` (schema-snapshot). Beslutning 3 er migration plus API-kontrakt plus holdudtagelses-UI plus e2e, ikke en aflæsning af eksisterende data.

**Determinisme og matematik**

- Seeds er nøglet på kalenderdatoen: `dtick:` (`dailyTraining.js:200`), `rtick:` (`:270`), `injury:` og `injurydays:` (`riderCondition.js:95-97`). Flere ticks samme dato giver identisk støj, identisk `status` (over/under/normal) og identisk skade-udfald.
- Budget-deleren `daysPerSeason` (`dailyTraining.js:13`) er allerede ca. 10 % forkert i dag: S3 kører 31 kalenderdage. Uden rekalibrering ganges sæsonens udvikling med antallet af ticks.
- Skadesvarighed er i hele kalenderdage: `injuryMaxDays` (`riderCondition.js:23`), `injured_until = tickDate + N` (`dailyTrainingEngine.js:455` via `:34-38`), sammenligninger på DATE-strenge (`:334`, `:462`).
- Akademi-ryttere er ikke en særsti længere: `hardDailyCap` og `academyRateMult` er fjernet (#3709 trin 5), og kun `youthMultiplier` dæmper. Ganges antallet af ticks, ganges akademi-væksten med samme faktor uden dæmper.

**Udløser og kapacitet**

- Der findes ingen "løbsdag lukker"-hændelse. Etaper trigges af `scheduled_at <= now()` (`backend/lib/stageScheduler.js:123-133`), og en løbsdag optager et sammenhængende løb af kalenderdagens slots (D1 11/13/15/17/19, D2 12/14/16/18, D3 og D4 12/15/18). Lukketidspunktet er divisions-specifikt.
- `seasons.race_days_total/completed` kan IKKE bruges som fremdriftsmåler: den tæller distinkte `races.game_day_start`, som er kalenderdags-indeks (`backend/lib/seasonRaceDays.js:28`, `tierCalendarMaterializer.js:405-407`).
- Sweepen har ingen overlap-guard: `for (const team of pending)` med await, sekventielt (`trainingSweep.js:114-140`), på et 5-minutters cron-tick (`backend/cron.js:1703-1706`). Målt 6/9: 308 til 318 rækker på 130 til 150 sekunder. Stage-scheduleren fik sin guard efter #2090 (`cron.js:1065-1080`); træningen mangler den.
- Skrivevolumen: ca. 6.540 rytter-writes pr. dag i dag. Tre løbsdage pr. kalenderdag betyder ca. 19.600 plus tredoblede ability-history-upserts (batch på 500, `dailyTrainingEngine.js:581-585`).
- Hold uden løbsdags-akse findes: målt 6/9 er 362 hold berettigede, heraf 4 AI-hold uden `league_division_id`. De skal have et defineret svar, ellers stopper de stille med at udvikle sig.

**Kalenderen selv**

- Der findes ingen tomme løbsdage ved konstruktion: `TIER_OVERLAP_MIN` er 1 i alle divisioner (`backend/lib/calendarTierCaps.js:57`), og pakkeren binder eksakt kvote (`sum(load) = density`, `raceCalendarLanePacker.js:237`). Rene trænings-løbsdage kræver at en af de to bindinger ændres.
- `minGameDaysPerRealDay` er kun en nedre grænse (`calendarTierCaps.js:94`). Fra S4 falder D4's to akser ikke længere sammen (#4270), og `axisLooksCollapsed` dømmer det selv (`calendarOverlapInvariant.js:105-108`).
- Akse-fælden: `game_day` kan ALDRIG udledes af `scheduled_at` (`CALENDAR_RULES.md` §0, fejlklassen kostede #4155 og #4161), og displayet er 1-baseret mens DB er 0-baseret (`RACE_DAY_DISPLAY_OFFSET`, `frontend/src/lib/raceHubLogic.js:390-393`).

**Flader, hjælp og tests**

- Ugeplanen kræver præcis 7 IRL-ugedage i både frontend (`frontend/src/lib/training.js:39-52`) og backend (`backend/lib/training.js:377`, `:383-395`), og ugedagen udledes af `tickDate` (`dailyTrainingEngine.js:269`). En løbsdag har ingen ugedag.
- Peak-planneren skriver ugeplanen som 7 ugedage (`backend/lib/riderPeakPlans.js:139-145`, skrivesti `backend/routes/api.js:4095-4129`), og dens konsistens-signal tæller RÆKKER, ikke datoer (`racePeaks.js:99-102` sammen med `racePeakPlans.js:276`). Flere runs pr. dato mætter signalet til 1,0 og gør peak-bonussen gratis.
- Historik-fladerne grupperer pr. dato: `useTrainingHistory.js:19` og `:92-99`, `TrainingHistory.jsx:105-137`, `RiderTrainingTab.jsx:37` og `:52-68`, `trainingReport.js:88-95` og `:149-168`.
- Beslutning 2 rammer `POST /api/training/run-today` (`api.js:2763-2796`), `bonusMult` (`dailyTraining.js:15`, `:165`), kolonnen `bonus_applied` og CHECK på `executed_by` (`database/2026-06-12-daily-training.sql:38-39`), `GET /api/training/today-status` (`api.js:9469-9489`), dashboardets næste-træk (`DashboardPage.jsx:638`) og onboarding-signalet `first_training_run` (`api.js:9435`).
- Løbsdags-badget kan ikke bære modellen: `racingTodayLookup.js:39-70` selecter kun `race_id` inden for ét dansk døgn, og feltet udelades helt når udviklings-flaget er off (`api.js:2751`).
- Ops-vagten er kalibreret pr. kalenderdag: `deadShareCeiling` og `deadJumpAbsolute` i `backend/lib/trainingSlotHealth.js:33-39`, kørt 24-timers (`cron.js:1871`). Flere ticks pr. dato hæver dag-til-dag-deltaet mekanisk og giver falsk alarm fra dag ét.
- Økonomien forbliver kalenderdags-baseret: løn pr. dansk dato (`wageDeductionSweep.js`, `UNIQUE(team_id, tick_date)`), akademi-intake pr. uge (`academyIntakePull.js:90-127`). Forholdet "udvikling pr. lønkrone" flytter sig hvis kun den ene akse skifter.
- Off-season-hullet er målt: S2 sluttede 23/8, S3 startede 28/8, fire døgn hvor sweepen returnerer `no_active_season` (`trainingSweep.js:105-108`) mens `seasonTransition.js:1433` bærer planerne over.
- Tests der brækker: `backend/lib/dashboardUxPakke.routes.test.js:45-97`, `dailyTrainingEngine.test.js:69-70` (injicerer unique-violation mod den nuværende nøgle), `trainingSweep.test.js`, `useTrainingHistory.test.js`, `trainingMoment.test.js`, `TeamDevelopmentTab.test.js:69`.
- Hjælpen skal skrives om i to sprog: mindst otte afsnit i `help.json` (en og da) siger "once per day", "after 22:00", "Monday to Sunday" og "A race day does not change that day's training", plus tre løbsdags-FAQ'er.

**Det der IKKE går i stykker:** selve matematikken i `dailyTraining.js` er enheds-agnostisk bortset fra seed-strengen og `daysPerSeason`; `rider_condition` har `rider_id` som PK og overskrives; lofterne er alders- og sæsonbaserede; RLS-politikken på `training_day_runs` er team-baseret og upåvirket.

---

## 4. Træningsscoren

### 4.1 Hvad den er, og hvad den ikke er

I dag er `tickResult.score` en KVITTERING: summen af de evne-deltaer motoren allerede har beregnet, i rå evnepoint (`dailyTraining.js:214`, `:233`). Den er cap-afhængig, fordi `gap` er afstanden til loftet (`dailyTraining.js:118-119`, `:125`), så en rytter hvis fokus-evner står på loftet får score 0 efter et perfekt hårdt pas. Målt i prod: 534 ikke-hvile-rytterdage med score præcis 0 på syv dage.

Beslutning 4 vender kausalretningen om. Scoren er et INPUT der måler passets kvalitet, og udviklingen udledes af den.

### 4.2 Formel-skitse (faktorer, ikke konstanter)

```
kvalitet Q = session/intensitet  ×  fokus-match
           ×  konditions-multiplikator (form og træthed)
           ×  træner-specialisering  ×  facilitets-magnitude

talent T   = potentiale-rate  ×  ungdomsfaktor(alder)

score S    = clamp(1, 99, skala × Q × T × dagsstøj)

delta pr. evne = f(S, absolut niveau, afstand til loft)
```

- Sessionens intensitet er en egenskab ved sessionen, ikke et frit valg (`SESSION_INTENSITY`, `backend/lib/trainingDayTypes.js:71-83`).
- Fokus-match kommer fra `abilityMult` og `FOCUS_ABILITY_WEIGHT` (`backend/lib/training.js`).
- Konditions-multiplikatoren er allerede klemt mellem gulv og loft (`riderCondition.js`, `conditionMultiplier`), så hverken perfekt form eller total udmattelse gør en dag ekstrem.
- Træner og facilitet er de to led med bevidst forskellig semantik (`backend/lib/staffTrainingBonus.js`): specialisering pr. rytter og evne, og magnitude for hele truppen. Invarianten "træning straffer aldrig" gælder også i scoren.
- Potentiale-raten er `rateByPotential` (`backend/lib/riderProgression.js:152`), rekalibreret 21/8 af #4063. Potentiale er stadig 1 til 6 internt (#3564 beslutning B1 blev ophævet af ejeren 13/8), så formlen skal bygge på 1-til-6-tabellen, ikke på den 1-til-99-skala #3564 antog 9/8.
- Dagsstøjen seedes på `(rytter, sæson, løbsdag)`. Nuværende namespace og spænd står i `dailyTraining.js:200` og `:16`.
- **Scoren er IKKE cap-afhængig.** Loft-nærheden hører til delta-formlen, ikke til kvalitetsmålet. Det er selve rettelsen af den defekt §4.1 beskriver.
- Delta-formen findes allerede som fit i dev-harnessen `backend/scripts/dev/curveHarness3564.mjs:136-165` og er aldrig kommet i motoren (#2698 er stadig open). Produktionens delta er fortsat rent gap-proportional (`dailyTraining.js:130`).
- Manager-bonussen (`bonusMult`) må IKKE indgå i Q. Beslutning 2 fjerner den.

### 4.3 Datamodel

| | Forslag |
|---|---|
| Tabel | `rider_training_scores`, én række pr. `(rider_id, season_id, game_day)` |
| Felter | score 1 til 99, hvilken session der blev kørt, om dagen var løb (og med hvilken intention), de tre til fire største bidrag til "hvad trækker op/ned", tidsstempel |
| RLS | Samme mønster som `training_day_runs_select`: kun holdets ejer kan SELECTe. Fremmede ryttere er dermed strukturelt lukket |
| Fase A-variant | Indtil tick-enheden skifter, nøgles rækken på `(rider_id, season_id, tick_date)` og migreres til `game_day` i fase B |
| Hvorfor ikke report-JSON | Kan ikke indekseres billigt, kan ikke sorteres på fladen, og arver unikheds-problemet i §3.2 |

### 4.4 Visning (beslutning 6)

- **Træningssidens rytterliste:** kolonne "Score" med dagens tal plus de sidste 7 løbsdage som monokrom sparkline, sortérbar. Sparkline-opskriften er allerede låst i `docs/design/TASTE.md:40` (fork 5, valg A): 2 px streg i `--text-1`, flad fyld, markeret slutpunkt, og kurven skifter ALDRIG farve efter retning.
- **Rytterprofilens træningsfane:** kort med dagens tal stort, gennemsnit og bedste over 30 løbsdage, kurve og én linje "hvad trækker op/ned". Kortet ERSTATTER `TrendCard` (trænede dage, gennembrud, skarpe dage) i `frontend/src/components/rider/profile/RiderTrainingTab.jsx:367-398`.
- **Løbsdage** viser "løb" med intentionen, ikke et tal, og kurven har hul. Se det åbne punkt om race-score i §5.
- Tabular figures på al numerik, stroke-ikoner, ingen emoji (bindende, `docs/design/PAGE_TEMPLATES.md`).
- Spillerne er allerede lovet scoren i live-tekst: `frontend/public/locales/en/rider.json:138` ("A comparable training score is coming") og tilsvarende på dansk. Den løftetekst skal fjernes samme dag scoren lander.

### 4.5 Hvad scoren driver, og hvad der frafalder

| Driver | Ja/nej |
|---|---|
| Evne-udviklingen pr. løbsdag | **Ja.** Det er hele beslutning 4 |
| Assistentens forslag (#4522) | **Ja**, som input til hvilke ryttere der foreslås en anden session |
| AI-holdenes træning | **Nej** i første omgang |
| Værdi og løn | **Nej** i første omgang. Værdi-koblingen hører til #3564 trin 4 |

**#3564 beslutning C frafalder.** Gaten "median ≥14 dage før potentialet kan aflæses pålideligt" bortfalder med ejerens beslutning 5: scoren er ærlig fra dag ét, uden støj-gate. Prisen ejeren accepterer er at potentialet kan aflæses hurtigt af den manager der ejer rytteren, og at køb-træn-sælg dermed bliver et legitimt scouting-loop. Det rører ikke #2798-sidekanalen, fordi markedsværdi og fremmede ryttere er uændrede og RLS holder scoren privat.

---

## 5. Hvad der IKKE er afgjort

**Parkeret af ejeren 6/9** (genåbnes senere, ikke afgjort):

- Programmets rytme når dagen er en løbsdag: en cyklus på 7 løbsdage eller den rigtige uge med 3 slots? Ejer: *"Det virker ikke som om noget af det der det rammer rigtigt for mig."*
- Træningssidens layout: afgøres af spillernes svar på side-om-side-mockupsene i `docs/design/mockups-training-2026-09-06/`.

**Åbne, endnu ikke stillet** (ét spørgsmål pr. linje, stilles i rækkefølge):

- Hvor mange løbsdage skal der være pr. kalenderdag, og på hvilke klokkeslæt lukker de?
- Hvad kan nå sæson 4 (start 28/9), og hvad venter til sæson 5?
- Får en løbsdag med løb også en score på samme skala, eller viser fladen kun intentionen uden tal?
- Hvad sker der i off-season-hullet mellem to sæsoner, hvor der ingen løbsdage er?
- Skal økonomien (løn, akademi-intake) blive på kalenderdagen mens udviklingen flytter til løbsdagen?
- Kan sweepen bære tre gange så mange writes pr. døgn, og skal den have samme overlap-guard som stage-scheduleren?
- Hvordan rekalibreres ops-vagterne der i dag måler dag-til-dag pr. kalenderdag?
- Skadesvarighed i løbsdage eller kalenderdage? De to giver forskellig retfærdighed pr. division.
- Skal træningshistorikken vises pr. løbsdag eller pr. kalenderdag med løbsdagene foldet ind?
- Hvad sker der med en rytter der sælges mellem divisioner midt i sæsonen, når tick'et nøgler på `game_day`?
- Er en Grand Tour-hviledag en løbsdag med træning eller en løbsdag uden noget?
- Hvad sker der med de eksisterende `training_day_runs`, som ingen `game_day` har?
- **Spænding der skal lukkes:** arkitekt-beslutning A1 (ét tal pr. rytter) mod #3564 beslutning D, som kræver at to ryttere af samme type kan udvikle sig forskelligt. Forslag: den medfødte hældning virker UNDER scoren i delta-formlen, mens fladen viser ét tal. Det skal verificeres af D's gab-harness før det låses.

---

## 6. Faseplan

> **Ejerens ramme (6/9, ordret): "Jeg vil gerne have at skiftet til det nye træningssystem senest sker til sæson 4 starten."** Dvs. fase A OG fase B skal være live senest 28/9 2026. Fase B1 (ens antal løbsdage i pakkeren) skal derfor ligge FØR S4-kalenderen genereres. Anbefalingen om S5 nedenfor er dermed overhalet; faseplanen er nu en rækkefølge, ikke et valg.

### Fase A: kan bygges på det nuværende dags-tick

Intet i fase A kræver en ny kalender, og alt af det virker uændret videre når tick-enheden skifter.

| # | Leverance | Afhængigheder |
|---|---|---|
| A1 | Træningsscoren: formel i motoren, egen tabel med RLS, kolonne på listen og kort på profilen | Ingen. Nøgles på `tick_date` i fase A, migreres i B2 |
| A2 | +1-loft pr. evne pr. dag (#4801) | Ingen. Roret findes (`hardDailyCap`), men reglen er ny |
| A3 | Session pr. dag i programmet (#4629), fundamentet under træningsprogrammerne | Ingen. Uafhængig af akse-skiftet |
| A4 | Intentions-kolonne på `race_entries` plus holdudtagelses-UI (#4632) | Migration, API-kontrakt, e2e. Uafhængig af akse-skiftet |

### Fase B: kræver den nye kalender

| # | Leverance | Afhængigheder |
|---|---|---|
| B1 | Ens antal løbsdage i alle divisioner i pakkeren, inkl. løbsdage uden løb | Rører `TIER_OVERLAP_MIN`, den eksakte kvote-binding og kvote-gaten. **Pre-S4-kritisk** |
| B2 | Tick pr. løbsdag: ny nøgle, ny mutex, seeds med løbsdag, historik-snapshot, rater rekalibreret | B1 |
| B3 | "Træn i dag" og bonussen fjernes, inkl. dashboard-signal, onboarding og i18n | B2 |
| B4 | Ny udløser: "løbsdagen lukker" pr. division, sweep-kapacitet, overlap-guard | B2 |
| B5 | Ops-vagter rekalibreret, økonomi-aksen afklaret, peak-plannerens konsistens-signal rettet | B2 |
| B6 | Tests, hjælpetekster (en og da), patch note, roadbook-rettelse til spillerne | B2 til B5 |

**Pre-S4-kritisk, og hvorfor:** kalenderen genereres ÉN gang pr. sæson (`CALENDAR_RULES.md` §2c), og S4 starter mandag 28/9. Skal alle divisioner have samme antal løbsdage i sæson 4, skal B1 være i mål FØR genereringen. Bliver den ikke det, kan resten af fase B tidligst virke i sæson 5, fordi et tick pr. løbsdag på S4-kalenderen ville give D1 ca. 79 ticks mod D4's 56, altså præcis den asymmetri beslutning 1 sætter sig for at fjerne.

**Ejeren har allerede lovet spillerne IRL-ugedage skriftligt** (`docs/discord/2026-09-02-roadbook-traening-en.md:23`), og hans egne wireframes fra 2/9 har Mon til Sun som kolonner. Skifter programmets akse i fase B, skal det løfte genformuleres offentligt.

---

## 7. Gates og målinger før ship

Alle måles i harnessen mod ægte population, ikke mod syntetiske arrays. En gate der ikke spejler produktionsstien er ikke en gate (postmortem 5/7).

| # | Gate | Mål |
|---|---|---|
| G1 | Sæsonens samlede evne-udvikling pr. rytter, før mod efter | uændret inden for ±X %, X sættes af ejeren før kørsel |
| G2 | Antal ticks pr. sæson pr. division | identisk i alle fire divisioner |
| G3 | Score-fordelingen over bestanden | ingen bunkning i enderne, og en hård dag på en frisk rytter med god træner skal ligge tydeligt over en let dag på en træt rytter uden |
| G4 | Score 0 eller 1 på et gennemført pas | 0 rækker. Loft-nærhed må ikke kunne trykke kvalitetsmålet i bund |
| G5 | Trætheds-median pr. kohorte (menneske og AI hver for sig) | inden for det bånd D3 blev kalibreret mod |
| G6 | Sweep-varighed og skrivetryk pr. løbsdags-lukning | under cron-intervallet med margin, og med overlap-guard bevist i test |
| G7 | Ingen managers program muteres af motoren | 100 %, kode-invariant plus test (G5-invarianten fra løbsdags-modellen) |
| G8 | Peak-plannerens konsistens-signal | må ikke mættes af flere runs pr. kalenderdag |
| G9 | Ops-vagten `trainingSlotHealth` | ingen falsk alarm på den nye kadence |

---

## 8. Kilder

**Ejer-beslutninger og retning**
- `docs/TRAINING_RULES.md` §12 (Discord 2/9, de fire principper) og §13 (beslutningerne 6/9)
- `docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md` §8 beslutning 4 og 5, §11.3, §11.5 C og D, §11.6
- `docs/superpowers/specs/2026-08-06-loebsdags-model-design.md` (D1 til D4, kalibreringen 6/8)
- `docs/superpowers/specs/2026-09-03-race-day-intention-decision.md` (#4632, intentionens fem trin)
- `docs/superpowers/specs/2026-09-03-training-programs-design.md` (#4629, session pr. ugedag)

**Regler**
- `docs/CALENDAR_RULES.md` §0 (de to akser), §0b (1-baseret display), §1 (tæthed, slots, kvote), §2 (sæsonens rammer, S4-vinduet)
- `docs/design/TASTE.md` (sparkline, fork 5) og `docs/design/PAGE_TEMPLATES.md`

**Kortlægning 6/9**
- Workflow `wf_4588775c-fe5`, fire lanes (tick, kalender, score, flader) plus kritiker. Alle facts verificeret mod `main` og mod prod read-only.
- Kritikerens rettelser der er indarbejdet: D3 havde allerede tre slots i S3 (kun D4 hæves fra S4); scoren NÅR browseren via `useTrainingHistory` men renderes ikke; "+1 pr. evne pr. dag" er en ny regel, ikke et aktivt loft; `docs/audits/season4-calendar-dryrun-2026-09-03.md` er FØR D4-hævningen og må ikke bruges som facit.

**Kode (verificér altid mod denne, aldrig mod en spec alene)**
- `backend/lib/dailyTrainingEngine.js` · `dailyTraining.js` · `trainingSweep.js` · `training.js` · `riderCondition.js` · `staffTrainingBonus.js` · `trainingDayTypes.js`
- `backend/lib/calendarTierCaps.js` · `raceCalendarLanePacker.js` · `raceCalendarScheduling.js` · `stageScheduler.js` · `raceBinding.js` · `seasonRaceDays.js`
- `backend/scripts/dev/curveHarness3564.mjs` (den eneste skrevne 1-til-99-formel, aldrig i motoren)
- `frontend/src/pages/TrainingPage.jsx` · `components/rider/profile/RiderTrainingTab.jsx` · `lib/useTrainingHistory.js` · `lib/trainingReport.js`
