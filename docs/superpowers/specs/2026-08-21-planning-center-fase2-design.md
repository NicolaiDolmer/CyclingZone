# Planning Center — fase 2 af Race Hub-SSOT'en (design)

> **Status:** ejer-besluttet 2026-08-21 (26 af 27 spørgsmål låst i designsession; ét åbent: [A6 kalenderfanens rolle](#aabne-beslutninger)) · **Parent-SSOT:** [2026-06-23-race-hub-redesign-design.md](2026-06-23-race-hub-redesign-design.md) — denne spec er FASE 2 af den og arver alle dens låste beslutninger (overlap som spil, frivillig deltagelse, pulje-binding, proaktiv assistent). · **Refs:** #1146 (parent-issue) · #3855/#4030 (motor v4) · taktik-ordrer v1 ([2026-08-21-race-tactics-orders-v1-design.md](2026-08-21-race-tactics-orders-v1-design.md)).
> **Faserne hedder P0-P5** — bevidst IKKE "F" — fordi race-engine v4 allerede bruger F-numre (F3-mekanikbølgen launcher 21/8 aften). Navnekollisionen bed i fase-reviewet.

## 1. Hvad denne fase er

Parent-spec'en byggede Løb-hubben: Lag 0 (stående præferencer) → Lag 3 (taktik). Fase 2 giver hubben sin manglende akse — **sæsonen** — og samler AL planlægning ét sted, så spillet kan vokse ved at tilføje, ikke bygge om. Adoption målt 21/8 (212 menneskehold): etape-taktik 25 %, formplan 29 %, stående ordrer 18 %, mål-løb 6 %. Managers planlægger konkret ("denne rytter, dette løb"), ikke abstrakt — strukturen herunder er bygget på det.

**Fem regler (bindende for alt under denne spec):**
1. Én sandhed pr. begreb (i dag: 2 mål-løb-modeller, 3 rolle-ordforråd, 3 assistent-indgange, 6 kalender-gengivelser).
2. Hårdt blokeret = gråt og uklikbart. Uklogt = advarsel. Aldrig fejl bagefter.
3. Enhver automatisk beslutning peger på reglen bag den — inline på cellen/kortet, ikke kun via skinnen.
4. Regler fødes af konkrete valg. Ingen flade åbner som tomt skema.
5. Ingen planlægning uden for centret. Løbssiden bliver løbets historie (A2).
6. *(tilføjet efter dommerpanelets mobil-linse)* Én IA på alle skærmbredder: linserne er filter-mekanik, gitteret er en desktop-projektion af samme mekanik. Kræver en visning en helt anden komponent på mobil, er designet ikke færdigt.

## 2. IA — fire zoom-niveauer, to skinner, fire linser

Ejer-låst IA-model A: sæsonmatrixen bor i `/planning?tab=selection` bag en `Season / Day`-toggle; klik en løbsdag → dagens board; ét sted at gemme en udtagelse.

### Z1 Sæson (ny)
- Rytter × løb-matrix for hele sæsonen. Kolonner = løb (løbsdags-spænd som metadata), datolineal over kolonnerne (A6-delbeslutning, allerede låst).
- **Designgrænse: 40 ryttere × 30 løb** (A5). Tætheden er en påstand indtil målt: mobil-prototype på 375px testes FØR byg.
- **Rytter-række-visningen er den gennemgående komponent** (regel 6): 31-40 rækker med sæson-strip skalerer strukturelt bedre end 558+ celler; gitteret er desktop-projektionen. `&view=`-param styrer.
- **Bulk-redigering er et krav, ikke nice-to-have** (veteran-dommer): markér flere celler → sæt rolle/fjern/flyt. Gitteret løser "find problemet"; bulk løser "ret 40 problemer".
- **Lav-data-tilstand** (ny-spiller-dommer): få/ingen spillede løbsdage → en "Your next race day"-kortstak øverst (auto-udfyldt, Accept/Adjust) FØR matrixen; matrixen vokser frem når sæsonen gør.
- Fire linser (= filtre, regel 6): udtagelser · rute-match (ægte 0-100 `suitability`, kun ved celle-åbning, som bar) · form & peak · belastning. Senere (efter P3): modstander-linse for LÅSTE løb (B4).
- Modstander-trupper på KOMMENDE løb i egen pulje vises på løbs-/dags-niveau ("start list so far") — gensidigt, begge kan ændre til lås (C4-2, ejer 21/8).
- Næste sæson: read-only browsing så snart kalender findes; gem åbner først ved materialiseret/låst kalender (B7). Sæsonvælger-mønstret fra formplanen genbruges. Byg tidslinje-komponenter sæson-agnostiske fra dag 1 (billigt nu, låser #1106 op senere).
- Sortering: rating/potentiale/belastning/rute-match uden forudbestemt rangorden (tester-låst). Grå+uklikbar ved hård binding; celle-inline "why" ved auto-udfyld (regel 3).

### Z2 Løbsdag (eksisterende board)
- Interaktionen består — MED tre rettelser: (1) touch: klik-baseret tilføj/fjern via `AddRiderPopover` er den primære mekanik, drag er desktop-bonus (verificeret: `raceHubDnd.js` er ren HTML5-drag, 0 touch-handlers; løb→løb-flytning har i dag INTET klik-alternativ — det får den); (2) auto-hop til næste løbsdag når dagens løb er kørt (#2030, ejer har nikket i tråden); (3) "Ryd udtagelse" pr. løb + klar konsekvens-tekst på "Ryd dag" (#3428).
- Onboarding-touren bliver her og får et 4. trin der peger på Season-togglen (C5).

### Z3 Løb
- Løbets planlægningsvisning I CENTRET: etaper, ruteprofiler inline (#3955, #2810), trup. Absorberer udtagelsespanelet fra løbssiden.
- **Bygges af de eksisterende komponenter** (`RaceSelectionPanel`, taktik-kort) — genbrug, ikke nybyg (enigt dommerpanel). Løbssiden `/races/:id` beholder ruteprofil/resultater/film + read-only plan med "Set tactics →"-link ind i centret (A2). Løser #2794 strukturelt.

### Z4 Etape
- T1-T4-taktik-kortet (egen spec, ejer-låst): rolle + effort + udbruds-stance + try-break, lås ved etapestart. **Endagsløb får HELE kortet**, bundet til race i stedet for stage (B3, lukker #3049).
- Kommende etaper i et kørende etapeløb ER redigerbare i dag — det gøres synligt og nåbart fra centret (A1). Mid-race-ordrer forbliver FROSSET til live-reveal (T2 står).
- **Koordinering (kritisk):** T1-T4-UI'et bygges af motor-sporets F3-bølge (launcher 21/8 aften, inkl. `race_team_orders`-migrationen). P2 BYGGER IKKE kortet — P2 monterer og forbinder det i centret. Ingen dobbeltbygning.

### Skinne: Rytter-inspektør
- Åbnes fra enhver rytter-reference: form, **træthed** (verificeret hul: endpointet sender `fatigue`, planner-UI'et renderer det aldrig — 0 hits i `frontend/src/components/planner/`), løbsdags-forbrug (i LØBSDAGE — chippen i `AvailableRidersPool` tæller i dag etaper; definitionen rettes), sæson-log (#3529), træthed i taktikvalg (#3455), undlad-udtagelse-flag (#3374), peaks.
- Ingen løbsdags-loft og intet budget-tal som mekanik (B1, ejer): konsekvenserne (træthed, skader, mistet træning) skal bære det naturligt; inspektøren gør dem synlige.
- Mobil: bottom sheet. Desktop: rail.

### Skinne: Stående ordrer
- **Model 1+3 (A4, ejer-låst):** fladen er BÅDE kvitteringen (alle dine regler samlet; hver auto-beslutning linker hertil) OG et sted man kan oprette/redigere regler direkte. Den åbner ALDRIG tom: med 0 regler viser den assistentens faktiske default-adfærd i klartekst. Primærvejen til nye regler er "gør det til en regel" på konkrete valg.
- Fog-grænsen (B6): regler og rangordner må vises ("your A-chain picked him"); tal/scorer/vægte fra motoren aldrig (#1791).
- Auto-fyld: består ved race-tid (beskytter passive hold), men de TRE indgange samles til ÉN med scope-valg (dette løb / denne dag / resten af sæsonen) + synlig kvittering (C1). Fravalg: per-rytter-flag (#3374) OG bevidst "stå over dette løb" pr. løb (C2). Auto-udtagelsens profil-matching skal fikses (#3957) og #3939-underfyldningen diagnosticeres.
- "Ryd alt for sæsonen": primært hjem her; dagsboardet beholder diskret indgang i "…"-menuen til SAMME dialog (C3).

### Uden for centret
- Andre divisioners startlister → fane under Resultater ("hvem deltog"), som i dag bare bedre (C4-1). Scope-fælden i boardet fjernes.
- Indbakke: kun udtagelses-varsel + clash-opdagelse; alt andet i centrets attention-bar (C6). Koordinér med #2223 (handling vs. information). ÉN fælles "mangler udtagelse"-kontrakt på tværs af flader (lærdom fra #4038-fejlklassen).
- Dashboard forbliver landing; får en fast "hvad kræver dig før næste lås"-blok med deep-links (A8; koordinér med #3513/#4070).
- Navn: "Planning" / "Planlægning" består (A9).

## 3. Datamodel-beslutninger

### 3.1 Én mål-løb-model (A3, ejer-låst)
`rider_peak_plans` (rytter-scopet, sæson-scopet, rigtig FK, 61 hold) bliver bærende; `team_race_strategy.target_race_ids` (JSONB, ingen season_id, ingen FK, 13 hold, 44/115 døde referencer efter sæsonskifte) migreres ind og udfases. Hold-mål afledes af rytter-mål. Migrations-kortlægningen (workflow 21/8) fandt: kun `target_race_ids`-feltet flyttes — `a_chain`/`captain_priorities`/`role_rules` er allerede korrekt roster-filtrerede og består. Dead-ref-politik: mål-løb udløber med sæsonen; carry-over-sweepen erstatter tavs tælling med en synlig "set new target races"-nudge. Konsumenter der skal flyttes: `raceStrategy.js:33/61/74`, `raceEntryGenerator.js:60`, `raceAutopick.js:79`, `api.js:5344/5433/5493`, `StrategyPage.jsx`+`TargetRacePicker.jsx`, `seasonCarryOver.js:496-554`. Blokerer #3087 indtil migreret.

### 3.2 Ordrer (låst 21/8, bygges af motor-sporet)
`race_team_orders` er eneste sandhed for rolle + effort pr. etape; `race_stage_roles` migreres og udfases (motor-F3, Worker 9). Konsekvens: #2405 løses af migrationen (ingen lap på den døende tabel), og **#2478's scope-tekst er forældet** (siger `race_stage_roles`-skrivning) — opdateres til `race_team_orders` før den pickes op.

### 3.3 Løbsdags-begreberne (#3990)
Kernefixet er allerede shippet (PR #3991; `race_days_total`=27 verificeret). Tilbage EFTER cutover: (a) 27-vs-28-off-by-one (dagslønnen `wageDeductionSweep.js:166` regner ~3,7 % for højt pr. dag; ejer-kald — flytter penge); (b) tre begreber får tre navne (`calendar_days` / `race_days` / `start_days`) så `games_day_start` (reelt real_day) holder op med at lyve; (c) spiller-copy ensrettes så dashboard (140), kalender (27), FAQ (140), Race Hub (0-125) og bestyrelse (27) fortæller SAMME historie. Fuld forbrugerliste står i #3990's kommentarer 21/8.

### 3.4 Monument-modellen (B2, ejer-låst 21/8 — udføres af DAGENS kalender-session)
100000-sentinelen og `deriveMonumentBindingWindow`-magien fjernes. Monumentet bliver en normal løbsdag i sit eget tidsslot, planlagt uden modløb i det slot, så alle ryttere kan stille op. Andre løb må ligge i datoens øvrige slots (ejer valgte slot-eksklusivitet, IKKE hel-dato-reservation). **Timing: allerede i S3** — "kalenderen skal være ordentlig i dag, langsigtet og ægte" (ejer 21/8). Kalender-sessionen ejer indgrebet; ejeren ser den levende kalender før der skrives (husregel).

### 3.5 Dublet-navne (intet issue — opret ét)
Verificeret 21/8: `race_pool.name` har ingen unik-constraint; `tierRaceSelection.js:101` dedupliker kun på id; navne-settet i `tierCalendarMaterializer.js:263-269/316-317` fyldes først EFTER tierens eget valg — samme tier kan derfor vælge to løb med samme navn. Alle 3 GT'er i D1's live S3-kalender er ramt. Generator-fix + data-fix af den levende kalender = dagens kalender-session; forward-guard (unik-tjek pr. tier-valg) følger i P0.

## 4. Verificerede UI-gæld (alle efterprøvet mod kode 21/8)

| # | Fund | Evidens | Fase |
|---|---|---|---|
| 1 | Strategi-fanen har ingen dirty-state; kladde tabes tavst ved fane-skift (unmount) | `StrategyPage.jsx:68`, `PlanningHubPage.jsx:87-90`; kontrast: boardets `boardDirty`-guard `RaceHubBoard.jsx:90-104` | P1 |
| 2 | Kalender-fanen har nul URL-tilstand (tab/division/pool/måned = ren useState) | `CalendarPage.jsx:49-62` | P1 |
| 3 | Tilbage fra løb åbnet på boardet lander i Resultater: `backTo="/races"` → legacy-redirect → `/resultater` | `RaceColumn.jsx:100`, `RaceDetailPage.jsx:483-485`, `App.jsx:96-103` — glemt ved #3102-flytningen; = #3954 | P1 |
| 4 | Drag er ren HTML5, 0 touch-handlers; løb→løb-flytning har intet klik-alternativ | `raceHubDnd.js:1-3`, `RaceColumn.jsx:176-178` | P1 |
| 5 | 5 flader returnerer tavst `null` ved slukket flag ELLER fejlet kald | `StrategyPage.jsx:61`, `RaceHubBoard.jsx:113`, `DivisionStartLists.jsx:54`, `PoolPicker.jsx:10`, `RaceCentrePage.jsx:218` | P1 |
| 6 | Formplanen viser form men aldrig træthed, selvom API'et sender begge | `api.js:3668-3669` sender; `PlannerSquad.jsx:281`, `MasterCanvas.jsx:228` renderer kun form | P1 |
| 7 | Dublet-navne-hullet (se 3.5) | `tierCalendarMaterializer.js:316-317` m.fl. | i dag |

## 5. Faseplan (P0-P5)

**Rækkefølge (D3/D4, ejer-låst):** dagens kalender-session først (uden for denne spec) · intet P-byg før v4-gaten mandag aften er afgjort · P0 alene som ÉN koordineret omgang · derefter P1+P2 parallelt i natbølger · P3+ afventer P1. Parallelle workers følger e2e-slot-reglerne (orkestrator ejer suiten).

**I DAG (kalender-sessionen, ikke denne specs byg):** dublet-GT-navne i live S3 (data + generator) · monument-modellen (3.4) · GT-etapetype-variation (lovet spillerne) · kalender låses fre/lør. Beslutningerne herfra er input, ikke opgaver, for P0.

**P0 — kalenderen kan stole på sig selv (efter cutover):**
#3990-resten (off-by-one — ejer-kald, + begrebs-omdøbning, 3.3) · forward-guard for navne-dedup · #3329 overlap-invariant (koordineret med dedup — samme filer: `tierCalendarMaterializer.js`, `raceCalendarLanePacker.js`; kvote-matematikken re-måles efter dedup) · #2791 brosten-glyf (uafhængig, kan køre parallelt). **Ud af P0:** #3471 (spor-identitet — design-forslag med needs-decision, flyttes til P3-kandidat); #3547 splittes (kun kalender-integritetspunktet hører her).

**P1 — centret får sin akse:**
Z1 sæsonmatrix (mobil-tæthedstest FØRST, A5) + datolineal + rytter-række-visning + bulk-edit + lav-data-stak · rytter-inspektør (#3529, #3455, #3374, træthed-hullet) · UI-gælds-tabellen (fund 1-6: dirty-state, URL-state, #3954-backlink, touch, tavse null, træthed) · #3428 · #3410 (reproducér FØR fix — uverificeret fund) · #3954 · #2030 · #3425 (mobil-bundbar: A/B på Clarity-tal) · #2445 (KUN sæsonplanlægger-delen — økonomi/bestyrelse/dashboard er uden for scope) · #3955 (Available Riders op + inline etapeprofiler).

**P2 — taktikken flytter ind:**
Montér motor-F3's T1-T4-kort som Z4 i centret (IKKE nybyg) · endagsløbs-binding (#3049) · A1-synlighed for kørende etapeløb · #2794 (løses via A2: løbssiden = historie) · #1884 (genbesøg EFTER T1-T4 — polish af den gamle dropdown kan være spildt) · #2810 · #2405 (lukkes af ordre-migrationen, verificér).

**P3 — assistenten bliver synlig:**
Mål-løb-migrationen (3.1) · #3087 (afblokeres af A3) · #3957 (profil-matching, needs-ai-triage først) · #3088 (egen gate: empirisk tærskel mod ægte population, aldrig opfundet) · #3939 (diagnose) · "gør det til en regel"-mekanikken + Stående ordrer-fladen (A4) — opret issue, findes ikke · C1-kvitteringen + C2-fravalg · modstander-linse (B4) derefter.

**P4 — dybde mod motor v4:**
**Korrigeret af fase-reviewet:** peak-cockpittet ER bygget (PR #2418/#2419/#2426, merged 13/7, beta bag `peak_planner_enabled`) — #2354 omskrives fra "byg cockpit" til "fix beta + GA-beslutning". **#3459 UD af P4** (flipper søndag som del af cutoveret). Tilbage: #2650 (hører til kalibrerings-sessionen efter cutover — koordinér, undgå dublet-spor) · #3763 · udbruds-klyngen #3543+#3413+#2416 afklares SAMLET · #2478 (efter scope-opdatering til `race_team_orders`) · plan-mod-virkelighed: vent på v4's why-rapport og byg ovenpå (B5).

**P5 — senere:**
#3719 · #3987 (+#3147 — manglede i kortlægningen, samme mekanik) · #2492 (U23/Junior-kalender-slices SKAL sekventeres efter denne specs IA-lås) · #1106 (delvist leveret af B7-read-only i P1) · #1110 · #1154. Live-taktik FROSSET indtil live-reveal.

## 6. Scorecard (D2, ejer-låst — tal sat FØR byg)

Baseline 21/8 → mål efter første hele sæson efter P2:

| Måling | Baseline | Mål |
|---|---|---|
| Hold der sætter taktik ≥1 gang pr. sæson | 25 % | **50 %** |
| Udtagelser lavet manuelt (ikke auto-fyldt) | (måles ved P1-start) | **40 %** |
| Hold med ≥1 stående ordre/regel | 18 % | **30 %** |

Plus gate FØR byg: Z1-tæthedstest på 375px (40×30-grænsen) skal bestås af mobil-prototypen.

## 7. Åbne beslutninger

- ~~A6~~ **AFGJORT 21/8 (efter spillerfeedback):** kalender-fanen består UÆNDRET for nu; deadline-radaren er retningen på sigt (flyttet til P5-kandidat). **Z1 v0 bygges STRAKS** (ejer-go 21/8, før v4-gaten — eksplicit undtagelse fra D4): Season/Day-toggle på `?tab=selection`; Season-visning = datolineal + løbs-bænde fra ægte S3-kalender, guld-tint hvor holdet har udtagelse; klik på løbsdag → dags-boardet. Rytter×løb-gitter og linser kommer fortsat i P1 og vokser ind i samme visning. Mockup: artifact "Kalender: foer og efter", nederste artboard.
- **Off-by-one-økonomien (3.3):** flytter penge — ejer-kald ved P0.
- **#3425 mobil-bundbar:** A/B på Clarity-tal, tages i P1.

## 8. Beslutningslog (ejer, 21/8-sessionen)

| # | Spørgsmål | Beslutning |
|---|---|---|
| A1 | "Ændre taktik på løb i gang" | Kommende etaper, gjort synligt i centret; mid-race forbliver frosset (T2) |
| A2 | Løbssiden | Ren historie-side; al planlægning i centret |
| A3 | Mål-løb-model | Én model; `rider_peak_plans` bærende; migration i P3 |
| A4 | Stående ordrer | Kombination 1+3: kontekstuel fødsel + fuld oprettelse på skinnen; aldrig tomt skema |
| A5 | Z1-grænse | 40 ryttere × 30 løb; mobil-test før byg; bulk-edit + rytter-rækker som krav |
| A6 | Kalenderen | Fanen består uændret nu; deadline-radar = senere (P5-kandidat); Z1 v0 (Season-visning m. datolineal) bygges straks |
| A7 | Spec-form | Fase 2 af race-hub-SSOT'en (dette dokument) |
| A8 | Landing | Dashboard består + "før næste lås"-blok |
| A9 | Navn | "Planning"/"Planlægning" består |
| B1 | Løbsdags-loft | Intet loft, intet budget-tal; naturlige konsekvenser (træthed/skader), synlige i inspektøren |
| B2 | Monument | Sentinel fjernes; normal løbsdag i eget slot uden modløb; ALLEREDE i S3 (dagens kalender-session) |
| B3 | Endagsløb | Hele taktik-kortet |
| B4 | Modstandere i Z1 | Ja, efter P3, låste løb; eksisterende indsigt fjernes ikke |
| B5 | Plan mod virkelighed | Vent på v4's why-rapport, byg ovenpå |
| B6 | Fog-grænse | Regler/rangordner ja; tal/vægte nej |
| B7 | Næste sæson | Read-only indtil kalenderen er klar |
| B8 | Ukendt feedback | GH+Discord-sweep kørt; 3 nuancer ind (auto-hop #2030, fælles udtagelses-kontrakt, sæsonoverblik efterspurgt #3547) |
| C1 | Assistent-autonomi | Auto-fyld ved race-tid består; ÉN indgang + scope-valg + kvittering |
| C2 | Passeret løbsdag | Auto-fyld default + per-rytter-flag + "stå over dette løb" |
| C3 | Ryd alt | Primært hjem på Stående ordrer + diskret genvej i boardets menu; samme dialog |
| C4 | Startlister | Andre divisioner → fane under Resultater; modstander-trupper synlige på kommende løb i planlægningen |
| C5 | Onboarding | Bliver i dagsboardet + 4. trin om sæsonvisningen |
| C6 | Indbakke | Kun udtagelses-varsel + clash; koordinér med #2223 |
| D1 | Mobil | Fuld planlægning på mobil; én IA alle bredder; klik frem for drag |
| D2 | Scorecard | 50/40/30 % (se §6) |
| D3 | Rækkefølge | P0 alene (koordineret), så P1+P2 parallelt |
| D4 | Timing | Kalenderen ordnes I DAG; P-byg efter v4-gaten; spec godkendes nu |

## 9. Vagt-punkter

- Rører ikke auktions-/cutover-filer. Kalender-generatoren ejes af dagens kalender-session indtil kalenderen er låst fre/lør.
- Motor-F3-natbølgen (i aften) ejer T1-T4 + `race_team_orders`. P2 monterer, bygger ikke.
- Alt spillervendt EN først, DA under; motorens fem rolleord; PAGE_TEMPLATES.md bindende (T2 wide data til Z1; én guld-primær pr. view).
- Migrationer: Claude applier selv post-merge under #2642-rammer; destruktive klasser ejer-gated. Mål-løb-migrationen (P3) rører spillerdata → dry-run + synlig kvittering.
