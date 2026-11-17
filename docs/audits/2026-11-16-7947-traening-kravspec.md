# Træningssiden: samlet kravspec (#7947)

Dato 16/11 2026. Kun læsning: kode på `origin/main` 2ef8f59ba, prod kun SELECT (Supabase), Discord kun læsning (anonymiseret), GitHub-issues og PR #8248. Ingen kode ændret. Bestemt til `docs/audits/2026-11-16-7947-traening-kravspec.md`.

**Ejerens bindende krav (16/11, #7947):**
- **K1.** Den nye side må aldrig være dårligere end den nuværende eller en tidligere side. Den skal være bedre alle steder.
- **K2.** Den tager højde for, om rytteren er i et program eller ej.
- **K3.** Den bygges sammen med programændringerne.
- **K4.** Tre dybder: quick select (ryttertype + hård/mellem/let), skræddersy (de 5 felter) og programmer. Felterne viser altid, hvad der faktisk trænes, og et manuelt felt vinder over begge de andre.
- **K5.** Pile frem og tilbage mellem dage, mindst 7 dage frem. En ændring på en fremtidig dag gælder kun den dato.
- **K6.** Spillerønsker skal med.

---

## 1. Paritet: alt den nuværende og de tidligere sider kan

Markér hver linje i det nye design. `[N]` betyder, at det er live nu. `[T]` betyder, at det fandtes tidligere og er fjernet eller ændret. Kilden står efter linjen.

### 1a. Ramme og navigation
- [ ] [N] Fire faner: I dag / Program / Udvikling / Rapport, synkroniseret med `?tab=` (`TrainingPage.jsx:134`, :442-443)
- [ ] [N] Program har underfaner: Plan / Programmer (bag `training_programs`, on) / Træthedsgrænse, med `?sub=` (`TrainingPage.jsx:540-542`, :2135-2177)
- [ ] [N] Fanerne Program, Udvikling og Rapport indlæses først, når de åbnes. Skeletvisning, aldrig en spinner (`TrainingPage.jsx:97-121`, #6030)
- [ ] [N] Reload-spærre: et deploy sletter aldrig ugemt arbejde (`TrainingPage.jsx:590-594`, #5159)
- [ ] [N] Onboarding-tour på siden (`TrainingPage.jsx:2468`, #2819)
- [ ] [N] Sidehovedets statuslinje: kørt / ændringer gælder fra i morgen / afventer løb / klar (`TrainingPage.jsx` ca. :2440-2465; patch "Daily training shows when it ran and when your changes take effect")
- [ ] [N] Linket "Sådan virker træning" fører til Hjælp (`t("howTrainingWorksLink")`)

### 1b. Fanen I dag (desktop)
- [ ] [N] Overblik øverst med fire tal: mangler plan i dag / kører løb / træner / trætte. Et tryk på et tal filtrerer tabellen (`TrainingOverview.tsx:1-41`, #5485, #7987 → "Mangler plan i dag" #8031)
- [ ] [N] Træthedsgrænsen vises som én linje under tallene (`TrainingOverview.tsx:41`, `FatigueRuleSummary`)
- [ ] [N] Kortet "Dagens beslutning": 1-3 forslag med en grund, "Brug" på ét eller alle (`DailyDecision.tsx`, bag `training_decision_card`, on)
- [ ] [N] Segmentfilter: Alle / Træning / Løb / Trætte (`decision.seg*`, TrainingPage ca. :2230)
- [ ] [N] Holdtabel B: form, træthed nu og i aften, dage på 70+, dagens dag, assistentens bud med "Brug", træningsscore, skade- og risikomærker, løbsmærke (`TrainingTeamTableB.tsx:1-14`)
- [ ] [N] Én dagsvælger pr. rytter, der gemmer med det samme og viser "Gemt" (`TrainingDaySelect.tsx:1-31`). Listen er grupperet som dagspanelet, så ingen ugyldige kombinationer kan vælges
- [ ] [N] En celle pr. løbsdag (5) viser dagtypen. Etape vises som etape (`TrainingTodayTable.tsx:1-14`)
- [ ] [N] Sæsonens point pr. rytter (`TrainingTodayTable`)
- [ ] [N] Sorterbare kolonner (`useSortState`, `TrainingTodayTable.tsx:18,36-38`)
- [ ] [N] Gruppér efter ryttertype (`TrainingPage.jsx:720`, patch "vis ryttertyper + gruppér", #1480)
- [ ] [N] Masse-dag: markér ryttere, vælg "alle/valgte", sæt dagen og nulstil (`bulkDayScope.ts`, `today.bulk*`, permanent live #6523/#7484)
- [ ] [N] Rytternavnet folder rytterens kort ud lige under rækken, og profil-linket ligger i kortet (`TrainingTodayTable.tsx:9-13`, #5458)
- [ ] [N] "Tilbage til holdets program" står på rækken, kun når der er noget at fjerne, og fjerner begge lag (`ResetToTeamProgram.tsx`, `TrainingPage.jsx:1437`, #6123)
- [ ] [N] Assistentens forslag: åbn panelet, accepter alle / valgte / kun ryttere uden plan, eller programforslag pr. ryttergruppe (`AssistantSuggestionsPanel.jsx`, :1801, #4522/#6411)
- [ ] [N] Fokus-/dagspanel: først dagtype (hvile, aktiv restitution, færdighed, træning), så session. Viser hvad hver session træner og om den passer til ryttertypen (`FocusPanel.jsx:1-14`, `trainingFocus.js`, #3762/#1974/#1908)
- [ ] [N] Træningskatalog v3 (`training_catalog_v3`, on, #5319)
- [ ] [N] Mærker: U23/JR, akademi, kontraktudløb, pensionsrisiko, alder, skade med varighed i løbsdage (`RiderBadges`, :1469, #3761/#3815/#5763/#5462)

### 1c. Fanen I dag (telefon)
- [ ] [N] Telefonrække med ét tryk: Hvile / Restitution / Program. Sætter dagens åbne felter og bevarer etaper (`TodayRowMobile.tsx:1-14`, #5685)
- [ ] [N] Træthed i aften med farve og tekst. Sæsonens evne-fremgang står i rækken (`TodayRowMobile.tsx:5-8`, #5630/#5933)
- [ ] [N] "Hvile for flere": markeringstilstand (`TrainingPage.jsx:681`, #5638)
- [ ] [N] Mobil-sortering (`RosterMobileSortControl`). Overblikket vises som chips i landskab (`TrainingOverview.tsx:9-12`)
- [ ] [N] Rytterkortet folder ud under rytteren, og navnet linker til profilen (`mobile/TrainingMobileRiderCard.tsx`, #3643/#5771)

### 1d. Træn nu
- [ ] [N] Træn nu er sidens eneste guld-knap. Den udfører straks dagens ledige felter, og et løbsfelt afregnes efter løbet (`training_train_now` + `training_train_now_instant`, on, #4847/#7737)
- [ ] [N] Advarsel og bekræftelse ved for få raske ryttere til dagens løb (`trainNowNeedsConfirm`, TRAINING_RULES :1348, #6740)
- [ ] [N] Låsen er synlig: dagens plan og udtagelse låses kun for ryttere i trykket (`training_train_now_locks`, #6139)
- [ ] [N] Note og fejltilstand. Ingen falsk fejl ved timeout (`TrainNowNote.tsx`, patch "no longer shows a false error")
- [ ] [N] Bonuslinje og kvittering bag `training_train_now_bonus` (off, #7741/#8219)

### 1e. Program
- [ ] [N] Én planflade: "Plan for" holdet / en gruppe / en rytter, plus "Træthed i aften" (`TrainingPlanCard.tsx:1-14`, #5932)
- [ ] [N] 7 ugedage × (hele dagen + 5 felter) = 35 celler. Et overstyret felt markeres, og et etapefelt i dag er låst (`TrainingPlanCard.tsx:231-276`, `trainingPrograms.ts:19,46,61`, `training_program_cells` on)
- [ ] [N] Holdets ugerytme: kladde og gem (`TrainingPlanCard.tsx:6-8`, #1895)
- [ ] [N] Rytterens egen uge vinder over holdets. Ryttere med egen plan vises som chips (`TrainingPlanCard.tsx:10`, TRAINING_RULES §4, #2438)
- [ ] [N] Kopiér en dags plan til andre dage (`copyDayPlan.ts`, `MAX_COPY_DAYS`)
- [ ] [N] Programmer: vælg først rytter eller gruppe, så programmet. 22 standardprogrammer, filtreret efter ryttertype. Tildelingen er en kopi ind i Plan (`program/TrainingProgramAssign.tsx:1-11`, #6035/#4629)
- [ ] [N] Træningsgrupper: én plan for flere, "Følg gruppen", gruppens træthedsundtagelser (`TrainingGroupsPlan.tsx`, `groups/*`, `training_groups` on, #6000)
- [ ] [N] Træthedsgrænse: holdregel, dagen efter en etape, undtagelser som chips og de seneste 7 dage. Gemmer med det samme (`FatigueRulePanel.tsx:1-13`, `training_fatigue_rules` on)
- [ ] [N] Træthedsprognose for ugen (`FatigueForecast.tsx`, `GET /api/training-programs/forecast`)

### 1f. Udvikling og Rapport
- [ ] [N] Sæsonoverblik (`SeasonOverview.jsx`, :2589, #6025)
- [ ] [N] Potentiale som tal og ord, akademi-prognose og udviklingsglyf (`PotentialEstimate`, `AcademyPrognosisCell`, :2654-2660, #7686)
- [ ] [N] Kvittering pr. evne: nu, sæson og på vej, og "færdig" ved loft (`AbilityReceiptRow.jsx`, #3717/#3709)
- [ ] [N] Dagskvittering for hele datoen, % af et point pr. pas og løbets andel skraveret (`DailyTrainingReceipt.tsx`, `raceContribution7627/*`, #5539/#7627)
- [ ] [N] Historik for de seneste 30 dage, træningsscore-graf og dagens øjeblik (`TrainingHistory.jsx`, `TrainingScoreSparkline.tsx`, `TrainingMoment.jsx`, :2714-2715)
- [ ] [N] Træningsscore 1-99 i tabel, kort og rapport (`training_score_visible` on, #4851)

### 1g. Tidligere funktioner, der er fjernet eller ændret
- [ ] [T] **Knaprækken Hvile / Aktiv restitution / session i hver række på desktop** blev fjernet 23/9 i #5485 (`TrainingTodayTable.tsx:5-6`). Spillerne bad bagefter om hurtigknapper for hvile og intervaller (#6956, 3 spillere 24-25/9). Det er det tydeligste paritetstab.
- [ ] [T] **Ét valg pr. dag pr. rytter** (før 29/9) blev til 5 felter pr. dato (TRAINING_RULES §13, beslutning 8). Ejeren: "vi havde noget for 1-2 måneder siden, det kunne brugerne meget bedre lide". Det enkle ét-valg skal bevares som quick select, men nu oven på 5 felter.
- [ ] [T] **Fokus + intensitet som to frie akser** (v1, #1339) blev erstattet af dagtype → session 14/8 (#3762). Grunden var, at 13,6 % af planerne stod på fokus + hvile og gav 0 vækst. Quick select (type + hård/mellem/let) må ikke genindføre den fejl: "hvile" er ikke en indsats sammen med en type.
- [ ] [T] **Smart standardfokus efter ryttertype** for ryttere uden plan (#1894, `smartDefaultFocus`). Det lever i dag kun i assistentens forslag. Det er kimen til quick select.
- [ ] [T] **Ugeplan og individuel ugeplan som separate kort** (#1895) blev samlet i ét kort 1/10 (#5932). Indholdet er bevaret.
- [ ] [T] **Sæsonoverblik på I dag** blev flyttet til Udvikling 1/10 (#6025).

---

## 2. Rytter med eller uden program

**Lagene i dag** (`resolveDayIntensity`, TRAINING_RULES §4:761). Højeste vinder:

1. Rytterens egen overstyring pr. ugedag (`training_week_plans` med `rider_id`, cellerne i `days` og eventuelt `program_key`)
2. Rytterens eksplicitte plan (`training_plans.focus/intensity`). Dagens valg skrives som en stående plan via `POST /api/training/:riderId` (`useTraining.js:108-125`), ikke som en dato
3. Holdets ugerytme (`training_week_plans` med `rider_id IS NULL`)
4. Program eller standard (`resolveProgram`)
5. `normal`

Træthedsgrænsen griber ind ved afregning, og etaper optager deres felt.

**Prod 16/11, kun menneskehold:**

| Måling | Antal |
|---|---|
| Hold med ugeplaner | 61 |
| Rytter-ugeplaner | 1.044 |
| … heraf med `program_key` | 766 |
| Holdrytmer | 36 (ingen med program) |
| Grupper | 56 (237 medlemmer) |

Programmer er altså udbredte. Spillerne opdager ofte ikke, at et program vinder (#8026).

| | Uden program (holdets rytme/standard) | Med eget program eller gruppeprogram |
|---|---|---|
| Rækken i dag | Dagsvælgeren viser holdets dag. Ingen nulstil-knap | Viser programmets dag. "Tilbage til holdets program" vises (#6123) |
| Telefon | Hvile/Restitution/Program sætter åbne felter | Samme. "Program" betyder rytterens program |
| Dagens valg | Skrives som stående plan og gælder også i morgen | **Problem (#8026):** programmet kan vinde over dagens valg uden besked. Ejer-valg A 12/11: tryk vinder i dag, kort besked |
| Program-fanen | Viser holdets 35 celler | Chip "egen plan" eller "følger gruppe" |

**Krav til den nye side:**
- **K2.1** Hvert felt viser sin kilde: Etape (låst) / Manuel (dato) / Quick select (dato) / Program (navn) / Gruppe / Holdrytme / Standard / Træthedsregel (auto-hvile). Ingen kilde må være usynlig.
- **K2.2** En rytter i program viser programnavnet i rækken med ét tryk til "fjern" eller "pause i dag".
- **K2.3** Quick select på en dato vinder over programmet for den dato og siger det kort: "Programmet fortsætter i morgen" (opfylder #8026 A).
- **K2.4** Et manuelt felt vinder over quick select og program (K4).
- **K2.5** Træthedsreglen vises som det, den er: en regel der kan erstatte felter i aften. Den er ikke et skjult lag.

---

## 3. Planlagte programændringer, status og sammenkodning

| Kilde | Indhold | Status 16/11 |
|---|---|---|
| #7456 + roadmap "Lås et pas" (aktiv, godkendt) | Rotation dag 1..N, der pauser ved hvile. Lås et pas, så et løb tager dagens mindst vigtige pas | Åben, design-alternativer A/B 1/11, spillersvar 1/11. Intet bygget |
| #6188 | Byg, navngiv og gem din egen uge som program | Åben, idé. Ingen tabel til brugerprogrammer (standardkatalog i `backend/lib/trainingPrograms.js`) |
| #8026 | Program vs. dagens valg: A valgt 12/11 | Åben, skal bygges med #7947 |
| #7987 | "Needs a day" → "Mangler plan i dag" | Tekst merget (#8031), Hjælp mangler |
| #7743 (roadmap aktiv) | Planlæg i morgen lige efter Træn nu | Åben. Dækkes af K5 (dagspile) |
| `training_programs` / `training_program_cells` | **Er kontakter i `app_config`, ikke tabeller** (begge on). Data ligger i `training_week_plans.days` + `program_key` | Live |
| #7298 | Fravalgt program "kommer tilbage" efter sæsonskifte | Uafklaret. Sandsynligvis fallback til holdrytme uden synlig "Auto"-etiket. K2.1 løser visningen |

**Der findes ingen dato-overstyring i datamodellen.** Prod-tabeller: `training_plans` (pr. sæson), `training_week_plans` (pr. ugedag), `training_groups`/`_members`, `training_train_now_locks` (pr. dato, kun låsen). K5 kræver derfor et nyt lag på serveren.

**Foreslået model (kodes sammen, én resolver):**
- **Datalag:** ny tabel `training_date_plans`:
  - `team_id, rider_id, tick_date, slot` (0-4 eller NULL = hele dagen)
  - `session`, `source` ('manual' | 'quick'), `quick_type`, `quick_effort`, `updated_at`
  - Unik på `(rider_id, tick_date, slot)`
  - Brugerprogrammer (#6188): `training_user_programs(team_id, name, cells jsonb, mode 'week'|'rotation', length)`, og en tildeling peger på programmet. Det giver også rotation (#7456): position pr. rytter, der kun rykker frem på dage med træning.
- **Resolver:** én ren funktion `resolveDateFields(rider, date)`, delt af motor, prognose og UI (som `resolveDayIntensity` i dag). Den returnerer 5 felter `{session, source, locked}`. Rækkefølge:
  1. Etape/lås
  2. Manuel dato
  3. Quick select dato
  4. Rytterprogram (uge eller rotation, med "lås et pas")
  5. Gruppe
  6. Holdrytme
  7. Smart standard efter type

  Træthedsreglen anvendes bagefter og markeres. #8026 er netop en uenighed mellem UI og motor, derfor må UI aldrig selv gætte.
- **Quick select:** type + indsats → serveren vælger sessioner fra katalog v3 til de åbne felter (genbrug `catalogForRiderType`/standardprogrammet for typen, filtreret på indsatsniveau). Gemmes som `source='quick'` på datoen. "Let" er den letteste træning. Hvile er sit eget valg (aktiv restitution under Hvile, ejer 16/11).
- **API:**
  - `GET /api/training/days?from&to` (7+ dage, resolvede felter + kilde)
  - `PUT /api/training/date/:riderId` (quick eller felt, kun den dato)
  - `DELETE` samme (fjern overstyring)
  - Program-API'et er uændret, plus brugerprogrammer
- **Overgang:** dagens "stående plan" (`training_plans`) beholder sin betydning for ryttere uden datoplan. Det nye lag gælder kun fremad. Kør skyggelæsning (gammel vs. ny resolver giver samme felter, når der ikke findes datoplaner) før tænding. Alt bag én slukket kontakt.

---

## 4. Spillerønsker, rangeret

Discord 24/9-16/11 (#general beta, #dansk-snak) og GitHub. Anonymiseret. Forums `#feedback-and-ideas`/`#feedback-and-bugs` er kun læst via issues, der citerer trådene; MCP'en kan ikke liste forumtråde.

1. **Færre klik og hurtigknapper for hvile/intervaller.** "Ny oversigt tom og forvirrende" (#6956, 3 spillere). Ejeren: "nemt og hurtigt på den enkelte rytter".
2. **Program skal være synligt og let at fjerne.** "Træningsprogrammer er lidt noget rod" og "jeg kunne ikke fjerne den" (#8026, 3 spillere 11/11). Også #7298.
3. **Justér dagligt pr. rytter, ikke ugeskema.** To spillere 27/9: "I like to adjust my training to the rider, race schedule" og "i adjust my training daily". Det understøtter dagsvisning + skræddersy.
4. **Gode standarder og automatik.** 8/11: fan af "en standard som assistenten kører med. At træningen også sker automatisk". Ejeren foreslog default/skabelon. Det understøtter quick select + programmer.
5. **Rotation i stedet for fast ugeskema** og at løb forskyder rotationen (#7456, 1/11).
6. **Planlæg i morgen / frem i tiden** (#7743, ejer-krav K5).
7. **Sortér/filtrér løb i dag vs. kun træning, og tryk på 7-dages-striben for evnestigninger** (#6176, delvist dækket af overblikstal). Hover skal også virke ved tryk (Android).
8. **Klar tekst:** "Needs a day" (#7987, rettet). Kvitteringen modsiger sig selv (#8025, done).
9. **Vælg selv, hvad rapporten viser** (roadmap #3924, aktiv). Se form stige/falde (#3763).
10. **Kompleksitet skræmmer:** "faldt af PCM da det blev for avanceret" (7/11, taktik, men gælder også træning). Det understøtter quick select som standarddybde.

---

## 5. Planlagt arbejde: skal med nu / klar til / uden for

**Skal med nu:**
- 5 felter pr. rytter pr. dag med kilde pr. felt
- Quick select (type + hård/mellem/let)
- Skræddersy pr. felt
- Dagspile (i dag → +7) med dato-overstyring
- #8026 (tryk vinder, besked, fjern)
- Hurtigknapper (Hvile med aktiv restitution / Program / quick)
- Hele paritetslisten §1
- #7987's Hjælp-tekst
- Træthed nu og i aften i rækken (`fatigue_now_7801`, følger kontakten)
- Træn nu-lås pr. dag

**Klar til (pladsen designes, bygges bag kontakt eller senere):**
- Brugerprogrammer #6188 og rotation + lås et pas #7456 (resolverens trin 4 skal kunne tage dem uden ny UI-model)
- Bonuslinje `training_train_now_bonus`
- XP `development_xp_model`
- Rapportvalg #3924
- 7-dages-striben med evnestigninger #6176
- Løbsudvikling efter rolle #5950

**Uden for:**
- Taktik (#7864/#8013)
- Sekundær ryttertype #3813
- Aftenkørslens ydelse #6490/#8143
- AI-hold træner ikke #7950 (motor)
- Træningslejr #5063
- Omskoling #6189
- Fable/balance (#5884, #6984, #7370)

---

## 6. Retning 1, 2, 3 (PR #8248) mod kravene

| Krav | R1 Én vælger, fem felter | R2 Ét tryk pr. rytter (anbefalet i PR) | R3 Ugen ved rytteren |
|---|---|---|---|
| 5 felter synlige | Holder | Holder | Holder (som streger, kortnavn ved tryk) |
| Quick select type + indsats (K4) | **Bryder:** vælgeren er en session/dagtype, ikke type + indsats | **Bryder:** Program/Hvile/Andet, ingen type + indsats | **Bryder** |
| Skræddersy pr. felt | Delvis (kun via Program) | Delvis: PR-trin 3 skriver **ugedag × felt** ("gælder også næste <ugedag>") | Holder (dato) |
| Manuelt felt vinder (K4) | Uklart | Holder for ugedagen, ikke for datoen | Holder |
| Dagspile, mindst 7 dage, dato-only (K5) | **Bryder** | **Bryder** (kun I dag/I morgen-faner) | Delvis: 7 dage pr. rytter, men ingen dagsnavigation for hele holdet |
| Program-bevidst (K2) | Svag ("Blandet dag") | Holder (programchip, fjern, #8026-besked) | Holder |
| Paritet: hurtigknapper (§1g) | Bryder (2 tryk) | Holder (ét tryk) | Bryder (tungt) |
| Paritet: masse-dag, sortering, gruppering, assistent, Dagens beslutning, overblik | Ikke vist | Delvis ("Hele holdet: alle følger program / trætte hviler") | Ikke vist |
| Byggevægt | Lav | Middel | Høj (ny server-model) |

**Anbefaling: en kombination.**
- Sidens ramme fra K5: dagspile øverst (‹ i går · **i dag** · i morgen … +7 ›) for hele holdet. Kun i dag kan Træn nu.
- Rækken fra R2: navn, form, træthed nu/i aften, 5-felt-strimlen med kildemærke pr. felt, programchip med fjern/pause.
- R2's ét-tryk udvides med **quick select som rækkens hovedvalg**: ryttertype (forvalgt = rytterens type/smart standard) + Let/Mellem/Hård, plus Hvile (Fuld / Aktiv restitution). Et tryk på et felt er skræddersy (dato-overstyring).
- R3's ugestrimmel flyttes til Program-fanen sammen med #6188/#7456.

**Nødvendige ændringer i forhold til #8248:**
1. Erstat "Andet" og R1-vælgeren med type + indsats.
2. Felt-rettelse skrives som dato, ikke ugedag. PR-trin 3's ejerspørgsmål er besvaret af K5.
3. Tilføj dagspile og fremtidige datoer i data/mock.
4. Vis kilde pr. felt (K2.1).
5. Vis masse-dag, sortering, gruppér efter type, Dagens beslutning og assistentens forslag i skitsen (paritet).
6. Byggeplanen får et server-trin først: `training_date_plans` + delt resolver + skyggelæsning, før frontend-trinene.

---

## 7. Ejer-spørgsmål (højst 5, med anbefaling)

1. **Hvad gælder for en fremtidig dato, der ikke er rørt: programmet eller seneste quick select?** Anbefaling: programmet/holdrytmen. Quick select gælder kun den dato, man satte den på (K5).
2. **Skal dagens valg i I dag stadig være "stående" (gælde fremad), som i dag?** Anbefaling: nej. Alle nye valg er dato-valg, og den gamle stående plan bevares kun for eksisterende ryttere uden datoplan, så ingen mister noget ved overgangen.
3. **Quick select "Hård" + type: skal serveren vælge sessionerne ud fra standardprogrammet for typen eller ud fra rytterens svageste relevante evne?** Anbefaling: standardprogrammet for typen, filtreret på indsats. Det er forudsigeligt og genbruger katalog v3.
4. **Hvor mange dage frem: 7 eller hele sæsonens kalender?** Anbefaling: 7 (K5's minimum). Længere frem hører til programmer.
5. **Skal brugerprogrammer (#6188) og rotation (#7456) være samme objekt?** Anbefaling: ja. Ét program med `mode` uge/rotation, så siden kun har én programmodel.

---

## Kritisk gennemlæsning (selvtjek af koden og historikken)

- **Tjekket for oversete funktioner:**
  - Kopiér dag (`copyDayPlan.ts`): med
  - Reload-spærre: med
  - Onboarding-tour: med
  - Masse-dag: med
  - Hvile for flere: med
  - Gruppers træthedsundtagelser: med
  - Træn nu-advarsel om for få ryttere: med
  - Kontrakt/pension/U23-mærker: med
  - Fokus-egnethed pr. type (`trainingFocus.js`): med
  - Sæsonoverblik flyttet: med
  - Smart standard (#1894): med som [T]-kilde til quick select
- **Fundet risiko 1:** `training_programs`/`training_program_cells` i briefen er kontakter, ikke tabeller. Dato-overstyring findes ikke. Retning 2's trin 3 ville have bygget ugedag-semantik, som K5 nu forbyder.
- **Fundet risiko 2:** dagens valg er i dag en stående plan. Uden spørgsmål 2 besvaret kan overgangen ændre betydningen af gemte planer stille. Det strider mod #7947-designkortets krav om, at "eksisterende planer ikke må miste deres betydning".
- **Ikke dækket:**
  - Forumtrådene er kun læst via citerende issues.
  - Udviklingsfanens "dage til næste løb" (roadmap #4342) er arkiveret og ikke krav.
  - Prod-tallene i §2 er ét øjebliksbillede. `program_key` kan være sat af assistentens accept, ikke kun aktivt valg.
