# v4 flip-klar-rapport — baseline på main, 23/9 (#5515)

> **Det her er ejerens ene grundlag for at sige "flip" på løbsmotor v4** (lovet på #4916 22/9). Rapporten flipper intet: flippet er ejerens alene (RULES §5 F6), og `race_engine_v4` står på `"off"` i prod (læst read-only 23/9, `race_engine_v3_scoring` = `"on"`).
>
> **BASELINE.** Tallene er målt på main *før* kalibreringspakken (#4914, PR #5521) og TTT-følgesagerne (#4915, PR #5524) er merget. **Rapporten genkøres, når begge er merget** — én kommando, se [Genkørsel](#genkørsel). Ingen motor-, tuning- eller baseline-fil er rørt.
>
> **Offentligt repo (hard rule 17):** her står ankrenes navne, PASS/FAIL, antal seeds og ydelse i ms. Middel, spænd og rater står i den private, gitignorerede fil `balance-internals/5515-v4-flip-klar/2026-09-23-v4-flip-klar-tal.md`, som samme kommando skriver.

## Kort svar

**Nej, v4 er ikke flip-klar efter flip-gatens egen definition** (spec 6/9 §3: *"alle ankre grønne på pinnet population + 5 seeds, uheldsrate og OTL-rate målt, andel S4-ruter med ægte segmentdata målt, én v4-etape med 180 ryttere under 60 sekunder, kill-switch-test grøn"*).

| Gate-krav (spec 6/9 §3) | Status | Hvor |
|---|---|---|
| Alle ankre grønne, 5 seeds | **Ikke opfyldt:** 1 anker FAIL (felt-favoritter), 2 ankre kan ikke måles for v4 | Måling 1 |
| Uheldsrate målt | Målt, **inden for** ejer-målet | Måling 3 |
| OTL-rate målt | Målt; OTL fyrer og grupettoen reddes, **men** se nyt fund om uheld → OTL | Måling 3 |
| Andel S4-ruter med ægte segmentdata | **Kan ikke måles endnu:** S4-kalenderen er ikke genereret (0 løb i sæson 4, læst 23/9). S3: 1.239 af 1.239 etaper har segmenter | — |
| Én etape, 180 ryttere, under 60 s | **Opfyldt** med stor margin, også ved 192 ryttere | Måling 4 |
| Kill-switch-test grøn | **Opfyldt** (lokale tests, stub-DB) | Måling 5 |
| Hale-gaten (RULES §9 række 13) | **PASS** på de ejer-låste 3 seeds | Måling 2 |

De tre ting ejeren skal tage stilling til før flip, i den rækkefølge:

1. **Et mekanisk uheld kan i v4 koste pladsen i løbet.** Tidstabet fra en punktering eller et hårdt styrt kan skubbe rytteren uden for tidsgrænsen, og så er han ude (OTL). Det strider mod RULES §9 række 4 (*"mekanisk uheld = altid kun tid, aldrig udgåelse"*). Nyt fund i denne rapport, se [røde punkter](#kendte-røde-punkter).
2. **Felt-favoritternes vinderrate er rød på alle fem seeds.** Kendt og ejer-gated (RULES §7 række 10); rettes aldrig ved at straffe styrke.
3. **"Alle ankre grønne" kan ikke opfyldes, som gaten står:** udbrudsrater pr. terræn og GT-vindermargin måles ikke for v4. Ejeren vælger: byg målingerne, eller undtag de to ankre eksplicit fra gaten.

## Genkørsel

Fra repo-roden, efter #4914 + #4915 er merget:

```
node backend/scripts/v4FlipReadiness.mjs --write-report=docs/audits/2026-09-23-v4-flip-klar-rapport.md --private-out=balance-internals/5515-v4-flip-klar/2026-09-23-v4-flip-klar-tal.md
```

Kommandoen erstatter kun den genererede blok under [Målingerne](#målingerne) (mellem markørerne) og skriver den private tal-fil. Prosaen, tjeklisten og de røde punkter skal læses igennem af den der genkører. Kørslen tager ca. 20 sekunder.

## Metode

- **Samme pinnede filer som ankertabellen i RULES §7b:** population `population-snapshot-2026-09-07.json` og proxy-etaper `v4-proxy-stages-2026-09-06.json` (141 etaper, ni etapetyper, ingen holdtidskørsel og ingen grus). Feltet er 180 ryttere pr. etape, trukket deterministisk. `orders=none`, som §7b.
- **Ankre:** `runHeadToHead` + `buildScorecard` fra `headToHeadV4.js` pr. seed (s1-s5), aggregeret med `aggregateScorecards`. Dommen er på seed-middel (RULES §7 række 8); kolonnen "seeds" viser hvor mange enkelt-seeds der består for sig.
- **Hale-gaten:** `runTailSpread` + `evaluateTailGate` fra `v4TailSpread.js` på de ejer-låste seeds s1-s3 mod de samme pinnede filer. Det er præcedensen fra `teamPlayAbMeasure.mjs`. CLI'ens default-population er en anden, se [røde punkter](#kendte-røde-punkter).
- **Uheld og OTL:** fra v4-outputtet i de samme 5-seed-kørsler, pr. etapetype. OTL læses fra resultatets `status`, redninger fra tidslinjens grupetto-event. OTL splittes op efter årsag: uden uheld, kun mekanisk uheld, eller efter styrt.
- **Ydelse:** rute-adapter + startliste-adapter + `simulateStageV4` + oversættelse til v3's `ranked`-form, pr. etape, alle 141 etaper ved 180 og 192 ryttere, efter én opvarmningskørsel. 192 er det største felt prod har haft pr. løb (GAME_INVARIANTS.md, #3331). DB-kald er ikke med. Tiderne svinger mellem kørsler med maskinens belastning (andre bølge-spor kørte samtidig), men maks-etapen har ligget langt under gaten i hver kørsel.
- **Kill-switch:** de eksisterende tests køres, de er ikke skrevet om: `raceRunnerEngineV4.test.js` (flag, kaldssted, kill-switch), `raceEngineV4Bridge.test.js` (broen og 180-rytters-ydelsestesten), `raceRunnerEngineV4Parity.test.js` og `raceEngineV4Bridge.teamTimeTrial.test.js`.
- Harnessen er `backend/scripts/v4FlipReadiness.mjs`, testet i `v4FlipReadiness.test.js`. Den test fælder også en offentlig blok der lækker målte værdier.

## Målingerne

Afsnit 1-5 herunder er genereret; de omtales som "måling 1-5" i resten af rapporten.

<!-- v4-flip-readiness:start -->

> **Genereret af `backend/scripts/v4FlipReadiness.mjs`, ikke haandskrevet.** Tallene bag dommene (middel, spaend, rater) staar i den private fil (hard rule 17), ikke her. Ret ikke i blokken; koer scriptet igen.
>
> Koert 2026-09-26T15:57:12.874Z paa motor-sha `35e005f55` · population `backend/scripts/baselines/population-snapshot-2026-09-07.json` · etaper `backend/scripts/baselines/v4-proxy-stages-2026-09-06.json` (141 etaper) · felt 180 · orders=none.

### 1. Ankre, v3 mod v4 (5 seeds: s1, s2, s3, s4, s5)

Dommen er paa seed-middel (RULES §7 raekke 8). "Seeds" = antal enkelt-seeds der bestaar for sig; baandene staar i RULES §7b.

| Anker | v3 | v3 seeds | v4 | v4 seeds |
|---|---|---|---|---|
| Felt-sammenhaeng, flade etaper | **FAIL** | 0/5 | PASS | 5/5 |
| Nedkoersels-gaps vs. summit-gaps (ratio) | **FAIL** | 1/5 | PASS | 4/5 |
| Descent attack-gevinst (10-20s-loft, aldrig omvendt fortegn i gruppen) | ikke maalt | - | PASS | 5/5 |
| Punch-korrelation (punch-evne vs. placering paa punch-etaper) | PASS | 5/5 | PASS | 5/5 |
| Brostensevnens loeft paa brosten/grus (spearman-forskel vs. flad) | PASS | 5/5 | PASS | 4/5 |
| Felt-favoritters win-rate | PASS | 3/5 | **FAIL** | 0/5 |
| Samme-hold-top-10 (andel massestarts-etaper med 4+ fra ét hold) | PASS | 5/5 | PASS | 5/5 |
| Udbruds-rater pr. terraen, vejetaper (vaerdi = samlet rate; dom pr. terraen) | **FAIL** | 0/5 | **FAIL** | 0/5 |
| Sprinter-vinderrate paa flat (top-20%-sprint-evne vinder) | **FAIL** | 2/5 | PASS | 5/5 |
| ITT-korrelation (time_trial-evne vs. placering, synlig) | PASS | 5/5 | PASS | 5/5 |
| Bonussekunder GC-effekt bounded (maks ~10s/etape) | **FAIL** | 0/5 | PASS | 5/5 |
| Bjergetape top-10-spredning, topankomster (#2415) | **FAIL** | 0/5 | PASS | 4/5 |
| GT-vindermargin (#2415) | ikke maalt | - | ikke maalt | - |
| ITT top-10-spredning pr. 40 km (#2415) | PASS | 4/5 | PASS | 5/5 |
| ITT: stoerste andel af feltet paa samme tid, vaerste etape (invariant 7) | PASS | 5/5 | PASS | 5/5 |

**v4 samlet:** 12 PASS · 2 FAIL · 1 ikke maalt. Flip-gatens krav "alle ankre groenne": **IKKE OPFYLDT**.

### 2. Hale-gaten (ejer-laast, 3 seeds: s1, s2, s3)

| Etapetype | Dom |
|---|---|
| flat | PASS |
| high_mountain | PASS |
| mountain | PASS |

**Samlet hale-gate:** PASS. Ikke-laaste etapetyper rapporteres kun i den private fil.

### 3. Uheld og tidsgraense (v4, 5 seeds x 141 etaper)

- **Uheldsrate samlet mod ejer-maalet** (RULES §2c / §9 raekke 4): PASS.
- **OTL forekommer:** ja (etapetyper: hilly, itt_hilly, mountain, rolling).
- **Grupetto-redning udloeses:** ja (etapetyper: hilly, mountain, rolling).
- **Mekanisk uheld (og intet andet) ender som OTL, dvs. ude af loebet:** **ja** (etapetyper: hilly, itt_hilly, rolling). RULES §9 raekke 4: et mekanisk uheld maa aldrig koste udgaaelse.
- **Haardt styrt ender som OTL:** **ja**. Trappen lover at han kommer i maal og koerer videre.
- Rater pr. etapetype (uheld, alvorlige styrt, udgaaede, OTL og dens aarsager, redninger) staar i den private fil.

### 4. Ydelse (gate: under 60 s pr. etape)

| Felt | Etaper | Middel | p95 | Maks (etapetype) | Dom |
|---|---|---|---|---|---|
| 180 | 141 | 20 ms | 42 ms | 122 ms (classic) | PASS |
| 192 | 141 | 31 ms | 67 ms | 198 ms (mountain) | PASS |

Maalt paa DOLMERPC (v24.16.0), rute-adapter + motor + oversaettelse til v3's ranked-form, uden DB. Railway-containerens CPU er ikke maalt her.

### 5. Flip-infrastruktur og kill-switch (eksisterende tests, koert nu)

| Testfil | Resultat | Heraf kill-switch-tests |
|---|---|---|
| `backend/lib/raceRunnerEngineV4.test.js` | groen (14/14) | 4/4 groenne |
| `backend/lib/raceEngineV4Bridge.test.js` | groen (24/24) | 2/2 groenne |
| `backend/lib/raceRunnerEngineV4Parity.test.js` | groen (15/15) | - |
| `backend/lib/raceEngineV4Bridge.teamTimeTrial.test.js` | groen (9/9) | - |

**Kill-switch samlet:** groen (6/6). Testene er lokale enhedstests med stub-DB, ikke en prod-oevelse.

<!-- v4-flip-readiness:end -->

## RULES §9 flip-krav 1-6 som tjekliste

Status: ✅ opfyldt og verificeret · 🟡 bygget, men med åbent punkt · ❌ ikke opfyldt.

| # | Krav (RULES §9) | Status | Bevis og kilde |
|---|---|---|---|
| 1a | **v3-paritet:** styrt, bonussekunder, indsatsvalg, holdspil med hold-id, vejr, brosten/grus, distance-slid koblet ind | 🟡 | Alle koblet ind 6/9 (RULES §2-tabellen M7-M13 + M16, §5 F3-noten). Åbent: kalibreringen i #4914, dvs. at all_out er gratis på fladt og grupettoens tempo. Ligger i PR #5521, ikke merget |
| 1b | **#2789** rute-huller | ❌ | Se række 6 |
| 1c | **#2944** uheldstrappen | 🟡 | Se række 4 |
| 1d | **#2582** tidsgrænsen | 🟡 | Se række 5 |
| 1e | **Flag, kaldssted, output → `race_results`, kill-switch til v3** | ✅ | PR #4879 (RULES §5 F4). Testene er grønne i dag (måling 5). Flaget står `"off"` i prod |
| 1f | **Ankre grønne før "klar"** | ❌ | Et anker FAIL og to ikke målt (måling 1) |
| 2 | **Intention pr. rytter pr. etape** (fem trin i `race_stage_roles.effort`) | 🟡 | Bygget: migrationen `database/2026-09-06-4632-effort-five-steps.sql`, `backend/lib/raceIntentionFlag.js` og taktik-fanen (PR #4913). Flaget `race_day_intention_enabled` findes ikke i `app_config` og er dermed off (læst 23/9). At tænde intentionen er et særskilt ejer-go |
| 3 | **Intentionens pris = Model C** (træthed bagefter, holdarbejdets pris, træningsudbytte) | 🟡 | Multiplikatorerne ligger bag samme flag (`raceIntentionFlag.js`), og v4's M12 er koblet ind (RULES §2). Åbent: all_out er gratis på flade etaper (#4914 punkt 2, PR #5521). Træningsudbyttet kræver også `race_day_development_enabled`, som er `"off"` |
| 4 | **Uheldstrappen (M10)** | 🟡 | Raten ligger inden for ejer-målet (måling 3). "Mekanisk = aldrig DNF, aldrig skade" håndhæves inde i M10 og er property-testet (RULES §2c). **Men via tidsgrænsen ender mekaniske uheld og hårde styrt som OTL, dvs. ude af løbet** (måling 3, nyt fund). En holdtidskørsel får ingen uheld (#4915, PR #5524) |
| 5 | **Tidsgrænse = UCI-reglen** | 🟡 | OTL fyrer, og grupetto-redningen udløses (måling 3). Hale-gaten er PASS (måling 2). Holdtidskørsel er undtaget indtil #4915 (PR #5524). Samspillet med uheld: se række 4 |
| 6 | **Alle seks rute-huller lukkes før flip** (inkl. brostens-finaler og enkeltstarters 80 hm) | ❌ | Kun ét hul er lukket og bevist med test, og 80 hm er ikke rettet. Se tabellen herunder |

### #2789 hul for hul

"Strukturelt væk" betyder at v3-modellen hullet sad i, ikke findes i v4 (ingen træf på modelnavnene i `backend/lib/engine/v4/`). Specen 6/9 kræver derudover at det **efterprøves mod rigtige S3/S4-ruter**. Det er ikke gjort for nogen af hullerne.

| Fund | Status | Bevis |
|---|---|---|
| 1. Teknisk finale uden profil-gate | 🟡 strukturelt væk | v4 har ingen `isTechnicalFinale`. Nedkørsels-angreb gates af segmentets teknik-niveau (`mechanics/descent.ts`), ikke af etapetypen. Ikke efterprøvet på rigtige flade ruter med en sen bakke |
| 2. Spredningsloftet mætter HC-topmål | 🟡 strukturelt væk | v4 har intet spredningsloft. Bjerg-top-10-ankeret (topankomster) er PASS på middel, men består kun på 4 af 5 seeds (måling 1). Dronningeetaperne er ikke målt for sig |
| 3. Udbrudsfaktoren kan kun sænke | 🟡 ikke verificerbar | v3's `routeBreakawayFactor` findes ikke i v4. Men udbrudsrate-ankeret er "ikke målt" for v4 (måling 1), så v4's udbrud pr. terræn er ikke vist |
| 4. Punch-finaler får dal-rabat | 🟡 strukturelt væk | v4's finale læser `finale_type: punch` direkte (`finale.ts`). Punch-korrelationen består på 5 af 5 seeds |
| 5. Brostens-finaler kan ikke opstå | ✅ i koden · live ikke set | Rutegeneratoren lægger nu altid den sidste sektor inden for 10 km af mål på brosten- og grus-etaper (PR #4891, test `raceRouteGenerator.test.js` "#2789: cobbles/gravel får ALTID …"), og v4 læser `sectors` (`adapters/routeAdapter.test.ts`). S3's live-ruter har ingen, fordi de er genereret før rettelsen, og S4 er ikke genereret endnu. `classic` er bevidst uændret (ejer-gated balanceændring) |
| 6. `climbs[]` ignoreres uden for bjergprofiler | 🟡 strukturelt væk | v4's stignings-selektion har ingen gate på etapetype (`mechanics/climbSelection.ts`). Ikke efterprøvet på rigtige klassiker-ruter med topmål |
| Enkeltstarters 80 hm (står i §9 række 6) | ❌ ikke rettet | `BASE_ELEVATION.itt` er stadig konstant, og en flad enkeltstart får ingen stigninger (`backend/lib/raceRouteGenerator.js`). I S3 live har alle enkeltstarter samme højdemeter (læst 23/9). v4 læser ikke `elevation_gain_m`, så løbene påvirkes ikke, men spilleren ser det, og kravet står |

**§9 række 13 og 14:** Hale-båndet (række 13) er målt i måling 2. Holdspillets niveau (række 14) er **ikke** genmålt her: det kræver `--orders=ai`, og §7b og denne rapport kører `orders=none`. Seneste måling er A/B'en 7/9 (PR #4978).

## Kendte røde punkter

1. **NYT: uheld → OTL → ude af løbet (samspillet M10 × M15).** M10 garanterer at et mekanisk uheld aldrig selv sætter "udgået". Men tidstabet tæller med i målet, og M15 dømmer bagefter på tiden alene. Resultatet er at en rytter med en punktering, og intet andet uheld, kan ende uden for tidsgrænsen. Broen skriver ham så som `outcome='abandon'` (`raceEngineV4Bridge.test.js`, #2582-testen), og han er ude af etapeløbet. Det samme sker for en del hårde styrt, selvom trappen lover at han kommer i mål og kører videre. På flade etaper, klassikere, brostensetaper og højbjerg forekommer OTL i målingen **kun** efter et uheld, så dér er det uheldet der sender ham hjem. Der er tale om et mønster, ikke et enkelt tilfælde. Andelene pr. etapetype står i den private fil. Det er et ejer-valg, ikke en fejlrettelse her. Mulige retninger: (a) tidsgrænsen ser bort fra det tidstab uheldet selv gav, ligesom juryens skøn ved uheld i virkeligheden, eller (b) det accepteres og skrives ind i RULES §2c/§2d og i hjælpen.
2. **Felt-favoritternes vinderrate** er FAIL på 5 af 5 seeds (RULES §7 række 10, ejer-gated). Må aldrig rettes ved at straffe styrke (ejer 4/8).
3. **To ankre kan ikke måles for v4:** udbrudsrater pr. terræn er hårdkodet som "ikke målt" for v4 i `headToHeadAnchors.js` (`scoreBreakawayRates`). Begrundelsen i koden, at M5 er F3-scope, er forældet, for M5 har været koblet ind siden 3/9. Ankeret har desuden intet bånd. GT-vindermargin kræver akkumuleret klassement og er ikke bygget til nogen motor.
4. **win_type-placeholder:** alle v4-massestartsetaper rapporterer samme sejrstype (`PLACEHOLDER_WIN_TYPE = "group_finish"`, `backend/lib/engine/v4/index.ts`). Undtagelsen er holdtidskørsel. Står i RULES §7 række 18 som ejer-valg (#3855). De gyldne fixtures fryser fejlen fast.
5. **Seed-følsomme ankre:** nedkørsels-/summit-ratio, brostensløftet og bjerg-top-10 består på middel, men kun på 4 af 5 seeds hver. På det svageste seed viser brostensløftet intet løft. Gaten er middel (ejer 2/9), så de er PASS, men marginen er lille.
6. **Hale-gatens kommando er rød med sine egne defaults.** `node backend/scripts/v4TailSpread.js --gate`, altså kommandoen RULES §2d og §9 række 13 nævner, falder stadig tilbage på **juli-populationen** (`population-snapshot-2026-07-11.json`), som #4936 erklærede forældet. Med den fejler bjerg-båndet på main i dag. Med den pinnede 09-07-population består gaten, både på dens egen proxy-kalender og på de pinnede etaper (måling 2). Filen ejes af #4914-sporet og er ikke rørt her.
7. **§7b-tabellen er ældre end main-motoren.** Den er genereret på motor-sha `7e63a6d06f`, mens main-motoren er `86d14b239` (efter #5505). Dommene er de samme som her, men tallene har flyttet sig lidt. #4914-sporet regenererer den (research-memo 22/9 §6).
8. **Ikke dækket af denne måling:** AI-ordrer og taktik (`orders=none`), dag-til-dag-slid i etapeløb (condition 1), grus og holdtidskørsel (0 i de pinnede etaper), og Railway-containerens CPU.

## Fund uden for scope (ikke rettet her)

- `backend/scripts/*.test.mjs` køres aldrig. `backend/scripts/run-tests.js` samler kun `*.test.js`/`*.test.ts` op, og CI kalder dem heller ikke direkte. Det betyder at `renderV4AnchorTable.test.mjs`, der skal fælde §7b-drift (RULES §7b: *"som backend-suiten samler op"*), og `teamPlayAbMeasure.test.mjs` ikke håndhæves. Denne rapports test er derfor navngivet `.test.js`.

Refs #5515 · #4916 · #4914 · #4915 · #2789 · #2944 · #2582
