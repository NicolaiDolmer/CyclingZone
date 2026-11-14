# #7801: svartid med `fatigue_now_7801` tændt, målt mod prod (14/11)

**Konklusion:** Svartiden holder ikke på Træning. Med kontakten tændt laver Træningssidens trætheds-del 34 til 50 databasekald mod 2 i dag og tager 2,5 til 3,0 s lokalt mod under 0,2 s i dag. Træning ligger allerede tæt på alarmgrænsen i #8101 (53 af 313 kald over 3 s i dag). Udtagelsen, Hold-fanen, Race Hub, rytterkortet og regelpanelet holder. Auto-udfyld til flere løb er langsom (3,2 s lokalt for 3 løb), men er ikke på #8101-listen. **Træning skal rettes før tænding.**

## Metode

- Script kørt lokalt mod prod med `infisical run --env=prod --silent`. Ingen hemmeligheder vist, intet skrevet.
- **Kun læsning:** `fetch` i processen afviste alt andet end GET/HEAD, også fra moduler med deres egen klient. 0 blokerede skrivninger i alle kørsler.
- **Kontakten tvunget tændt kun i processen:** den rigtige forespørgsel på `app_config` for `fatigue_now_7801` blev stadig sendt, så tiden er med, men svaret blev skiftet til `"on"`. Prod har ingen række (slukket), og det blev kontrolleret før hver kørsel: tvunget giver tændt, prod giver slukket. `app_config` er ikke rørt.
- Prod-kontakter ved målingen: `condition_model_v2` on, `training_condition_per_date` on, `training_tick_per_race_day` on, `training_train_now_instant` beta. Altså den fulde 2.0-sti, som tænding rammer.
- Samme funktioner som ruterne kalder, med prod-data: `fatigueOutlookForTeam` (Træning, `GET /api/training/me`), kontakt plus `teamFatigueNowForSurface` (regelpanelet), `riderCardFatigueNow7801` (hele rytterkort-ruten), `fatigueByRiderNow` (formtop-tavlen), `getSelectionContext` (hele konteksten bag udtagelsen og Hold-fanen), `getSelectionContextsForRaces` (Race Hub), `fatigueByRiderForRaces` (auto-udfyld, regenerering og strategi-forhåndsvisning).
- 6 menneskehold: trupper på 1, 3, 7, 21, 43 og 52 ryttere. Tre hold havde ryttere med en etape i dag (6, 12 og 30 ryttere), tre havde ingen. Hold nævnes kun som T1 til T6.
- 20 målte gentagelser pr. flade pr. tilstand efter 2 opvarmninger, slukket og tændt skiftevis. Databasekald = HTTP-kald til Supabase.
- **Tidspunkt (dansk tid):** 19:11 til 19:13 (prøvekørsel), 19:15 til 19:25 og 19:25 til 19:32. Ingen af dem ligger i etape-vinduet HH:57 til HH:03.

## Tal (lokalt, ms; median / værst af 20)

| Flade | Hold (trup, etape i dag) | Slukket | Tændt | Kald slukket → tændt |
|---|---|---|---|---|
| **Træning** (trætheds-delen af `/training/me`) | T1 (7, 6) | 178 / 220 | **2649 / 3096** | 2 → 47 |
| | T2 (21, 12) | 190 / 310 | **2571 / 3356** | 2 → 47 |
| | T3 (52, 30) | 173 / 259 | **2549 / 2796** | 2 → 50 |
| | T4 (1, 0) | 173 / 490 | 387 / 441 | 2 → 11 |
| | T5 (3, 0) | 176 / 210 | 402 / 477 | 2 → 11 |
| | T6 (43, 0) | 348 / 426 | **2950 / 3173** | 2 → 34 |
| Regelpanel | T1 til T6 | 72 til 192 / højst 263 | 264 til 598 / højst 736 | 1 → 9-10 |
| Rytterkort (hele ruten) | T1 til T6 | 70 til 171 / højst 209 | 417 til 881 / højst 1561 | 1 → 11-12 |
| Formtop-tavle | T1 til T6 | 155 til 346 / højst 435 | 248 til 678 / højst 762 | 2 → 9-10 |
| Udtagelse / Hold-fane (hele konteksten) | T1 | 448 / 556 | 649 / 852 | 9 → 17 |
| | T2 | 481 / 736 | 727 / 1104 | 9 → 17 |
| | T3 | 409 / 507 | 634 / 797 | 9 → 18 |
| Race Hub (hele konteksten) | T1, 1 løb | 423 / 553 | 621 / 965 | 9 → 17 |
| | T2, 1 løb | 482 / 734 | 675 / 978 | 9 → 17 |
| | T3, 3 løb | 1614 / 2729 | 1910 / 3632 | 27 → 38 |
| Auto-udfyld, 1 løb (trætheds-delen) | T1 / T2 / T3 | 158 til 210 / højst 257 | 903 til 1197 / højst 1824 | 2 → 12-13 |
| Auto-udfyld, 3 løb (trætheds-delen) | T3 | 201 / 253 | **3183 / 4682** | 2 → 37 |

T6 var langsommere i begge tilstande (også slukket), fordi nettet var langsommere ved den måling.

**Hvor Træningens kald kommer fra:** Hold uden en etape i morgen får 11 kald (tallet nu plus næste etape). Har en rytter en etape i morgen, kører `fatigueOutlookForTeam` også `loadTeamFatigueForecast` (prognosen for aftenen), og den kører **efter** de andre opslag. Det giver ca. 25 til 39 kald mere, som kører efter hinanden. Samme prognose har allerede sin egen rute (`routes/trainingPrograms.js:354`), så den bliver regnet to gange.

**Auto-udfyld til flere løb** bruger stadig den gamle vej (`liveFatigueMap` → `ridersWithFatigueNow`): ca. 12 kald pr. løb med sin egen startdato og løbsdag, ét løb ad gangen. Rest-bygget samlede kun opslagene for fladerne.

## Sammenligning med alarmgrænsen (#8101)

Grænsen er 3 s pr. kald (`SLOW_MS`). Kvarter-reglen kræver mindst 3 langsomme kald og mindst 10 %, time-reglen over 20 % af kaldene den seneste time med mindst 5 kald. Prod-udgangspunktet er læst fra `action_timing_windows` (kun GET), 14/11 fra kl. 11:14:

| Handling | Kald | Over 3 s | Median af kvarter-p50 | Median af kvarter-p95 | Højeste kvarter-p95 |
|---|---|---|---|---|---|
| Åbn Træning (`training_open`) | 313 | **53 (17 %)** | 1258 ms | **3118 ms** | 4988 ms |
| Åbn løbets udtagelse (`race_selection_open`) | 759 | 0 | 1305 ms | 1640 ms | 1939 ms |

- **Træning:** ruten ligger allerede tæt på time-reglens 20 %. Med kontakten tændt kommer 32 til 48 ekstra kald oveni, de fleste efter hinanden. Lokalt er det ca. 2,4 s ekstra. I prod er ventetiden pr. kald mindre: Railway europe-west til Supabase eu-central-1 er ca. 10 ms (antagelse fra `docs/audits/2026-06-11-load-test.md`, ikke målt i dag) mod ca. 80 ms lokalt. **Skøn (antagelse, ikke målt i prod):** ca. 0,5 til 1 s ekstra på hver åbning af Træning for hold med en etape i morgen. Så kommer andelen over 3 s klart over 20 %, og `training_open` står ikke på listen over kendte brud. Alarmen vil gå.
- **Udtagelse / Hold-fane:** +8 til 9 kald, +0,2 s lokalt. I prod er p95 1,6 s og det værste kald 2,3 s, så der er god plads. Holder.
- **Race Hub, rytterkort, regelpanel, formtop-tavle:** +7 til 11 kald, lokalt højst ca. 0,9 s (en enkelt måling på 1,6 s). Ingen af dem står på #8101-listen som egen handling. Holder.
- **Auto-udfyld:** ikke på listen. Spilleren venter dog 3 til 5 s lokalt ved 3 løb, og ventetiden vokser med antallet af løb.

## Hvad er ikke målt

- Hele ruterne gennem Express med login: kun trætheds-delen for Træning og auto-udfyld; hele konteksten for udtagelse, Race Hub og rytterkort. Prod-udgangspunktet for hele ruterne er derfor taget fra #8101.
- Svartid fra Railway. Alle tal er lokale, så ventetiden pr. kald er højere end i prod. Antallet af kald er det samme.
- Udtagelse og Race Hub for hold uden en etape i dag (de tre hold uden etape havde ingen åbne løb). Race Hub med mere end 3 løb og auto-udfyld til mere end 3 løb.
- Belastning ved mange samtidige spillere, og hvad 34 til 50 kald pr. Træning-åbning betyder for Supabase-forbindelserne.
- Hold med Træn nu-stempler (`training_train_now_instant` er beta).

## Hvad skal rettes først (før tænding)

1. **Træning (`backend/lib/riderFatigueNow.js`, `fatigueOutlookForTeam`):** regn ikke aftenens prognose inde i `/training/me`. Enten (a) skønnet for i morgen tages fra prognose-ruten, som siden allerede henter (`routes/trainingPrograms.js:354`), eller (b) prognosen startes samtidig med de andre opslag og deler deres opslag. Mål: højst ca. 12 kald og samme svartid som hold uden en etape i morgen (ca. 0,4 s lokalt). Risiko: skønnet ved start for i morgen skal stadig være det tal, Fable-dommens prøver forventer. Kør prøvesættene for "samme tal" og "slukket uændret" igen.
2. **Auto-udfyld (`fatigueByRiderForRaces`):** brug den samlede vej (`prepareFatigueNowView`), som `raceFatigueNowForSurface` allerede gør: hent alle løbs starttider på én gang og læs datoens belastninger én gang. Lav risiko, for kernen og tallene er de samme.
3. Kør målingen igen efter 1 og 2 (samme metode, uden for HH:57 til HH:03), før tænd-kortet laves.
