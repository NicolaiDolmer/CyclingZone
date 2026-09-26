# v4 flip-klar-rapport — genkørt på main 26/9 (#5515)

> **Ejerens flip-grundlag, genkørt efter at kalibreringspakken (#4914), TTT-følgesagerne (#4915), enkeltstarten (#5576), indsatstrappen (#5580), jagten og juryen (#5582), sejrstypen (#5577) og grupetto-tempoet (#5581) er merget.** Baseline-rapporten fra 23/9 ligger urørt i [`2026-09-23-v4-flip-klar-rapport.md`](2026-09-23-v4-flip-klar-rapport.md).
>
> Rapporten flipper intet. `race_engine_v4` står på `"off"` i prod (læst read-only 26/9), og flippet er ejerens alene (RULES §5 F6).
>
> **Offentligt repo (hard rule 17):** her står ankrenes navne, PASS/FAIL, antal seeds og ydelse i ms. Middel, spænd og rater står i den private, gitignorerede fil `balance-internals/5515-v4-flip-klar/2026-09-26-v4-flip-klar-tal.md` (samme kommando skriver den). GT-vindermarginens tal står i `balance-internals/5515-v4-flip-klar/2026-09-26-gt-vindermargin.txt`.

## Flip-kort

**Kort svar: flip-gaten er ikke opfyldt.** To ankre er røde, og begge kræver et valg fra dig, ikke mere kode. Tre mindre ting kan rettes nu uden dig; én af dem er en forkert linje i løbsfilmen, som spillerne vil se efter flip. Resten er grønt eller kan først måles, når S4 kører.

### 🟢 Grønt

- **12 af 15 ankre består** på 5 seeds, også de to nye enkeltstarts-ankre. Enkeltstarten køres nu som en rigtig individuel start (#5576).
- **GT-vindermarginen består** for v4, målt på de tre pinnede grand tours × 5 seeds med `v4GcMargin.mjs` (#5578). Flip-harnessens egen tabel viser den stadig som "ikke målt", fordi den måles af et andet script.
- **Hale-gaten består** (bjerg, højbjerg, fladt).
- **Uheldsraten** ligger inden for dit mål.
- **Et uheld koster aldrig længere løbet.** Hverken en punktering eller et hårdt styrt sender en rytter hjem via tidsgrænsen. To huller blev fundet og rettet i denne PR, se [rettet i denne PR](#rettet-i-denne-pr).
- **Grupettoen regner på tidsgrænsen** (#5581): ingen OTL på flade etaper, klassikere, brosten eller højbjerg.
- **Sejrstypen** kommer nu fra finalen (#5577). Løbsfilmene viser spurtsejr, tæt sejr og solosejr, hvor alt før var samme stempel.
- **Ydelse:** den langsomste etape tager under et kvart sekund ved 180 og 192 ryttere. Gaten er 60 sekunder.
- **Kill-switch og flip-infrastruktur:** alle eksisterende tests er grønne.
- **Hjælp-sektionen om løbsdag** følger nu flaget (#4948, lukket via PR #5563).

### 🔴 Rødt, kræver dit valg (ikke kode)

1. **Favoritterne vinder for tit** (RULES §7 række 10). Rød på alle 5 seeds, som 23/9. Rettes aldrig ved at straffe styrke (ejer 4/8). #5583 har målt en ikke-cirkulær favorit-definition og en ny population med taktik og positionering (#5572); **begge gate-skift venter på dit go**. Rigtige S4-felter med AI-taktik vil også flytte tallet.
2. **Udbrud pr. terræn er rød mod et bånd, der ikke er dit.** Båndene er v3's kandidatbånd (#1021), ikke ejer-godkendt (#5578). Mønstret i v4: på fladt og brosten vinder udbruddet aldrig i målingen, på kuperede etaper og bjergetaper for sjældent, og på rullende etaper og højbjerg for tit. v3 er også rød mod de samme bånd. **Dit valg:** sæt båndene ud fra virkelige udbrudsrater (research med kilder), derefter kalibreres udbrudsmekanikken med tal foran dig (RULES §4, "simulér før ship").

### 🔴 Rødt, kan rettes nu (uden for denne PR)

Ingen af dem kræver S4-data eller et ejer-valg. De ligger uden for denne PR's filer.

- **Løbsfilmen kan skrive "udbruddet holdt", når det blev hentet i finalen.** Spillervendt efter flip. Se [fund i løbsfilmene](#fund-i-løbsfilmene-ikke-rettet-her).
- **Ankertabellen i RULES §7b** skal regenereres mod main-motoren (én kommando). Den er fra 23/9.
- **RULES §2d og §2h** skal have juryens nye tilfælde fra denne PR, og §2h skal rydde TTT-valg, der blev afgjort 23/9.

### 🟡 Kan først måles efter S4's første løbsdage

- **Andel S4-ruter med ægte segmentdata.** S4 er ikke genereret endnu (0 løb i sæson 4, læst 26/9). S3 har segmenter på alle etaper.
- **Enkeltstarters højdemeter og brostensfinaler live.** Begge er rettet i rutegeneratoren (#5587, #4891), men S3's ruter er genereret før rettelserne. Første S4-kalender viser det.
- **OTL uden uheld på rullende og kuperede etaper.** Harnessens felt er en tilfældig stikprøve af hele populationen, inklusive meget svage ryttere. Om niveauet er rimeligt, kan først vurderes på rigtige S4-felter pr. division. Samme forbehold for andelen der gennemfører en grand tour, som er lavere i v4 end i v3.
- **AI-taktik og holdmøde-ordrer.** Alle målinger kører `orders=none`, som gaten er defineret.
- **Railway-containerens CPU.** Ydelsen er målt lokalt.

## Rettet i denne PR

Begge rettelser ligger i `backend/lib/engine/v4` bag `race_engine_v4 = "off"`. Intet ændrer sig for spillerne, før du flipper. Golden fixtures er uændrede.

1. **Enkeltstarten havde ingen jury.** Enkeltstarten kører gennem holdtidskørslens kerne, som kun havde holdgrænsen. En punktering kunne derfor skubbe en enkeltstarter ud af løbet. Nu dømmer juryen ham på sin tid minus uheldets tid, som på vejetapen (#5582). Holdtidskørslen er uændret (se åbne punkter).
2. **Et uheld i grupettoen kunne koste løbet.** Juryen sammenlignede kun med grænsen. En rytter i en grupetto, der selv var over grænsen men blev reddet, og som punkterede og kom ind uden for grupettoens ankomstvindue, var ude. Nu genindsættes han også, når hans tid minus uheldet lander i den reddede grupetto. Uden uheld genindsættes ingen, og redningen af selve grupettoen er uændret.
3. **Harnessen talte forkert.** Den kaldte enhver OTL-rytter med et uheld for "uheldet kostede løbet", også når han var over grænsen uden uheldets tid. Nu tæller den kun OTL, hvor uheldet var årsagen (samme regnemåde som juryen). Den rå optælling står fortsat i den private fil.

Før rettelserne viste genkørslen "ja" til både "mekanisk uheld ender som OTL" og "hårdt styrt ender som OTL". Efter er begge "nej" (måling 3).

## Blokkerne #4914, #4915 og #4948

| Issue | Punkt | Status 26/9 |
|---|---|---|
| #4914 | Ejer-go på holdspils-niveau | ✅ Valgt 7/9 (variant B, RULES §9 række 14) |
| #4914 | M7 + M12 + M16 kalibreret sammen | ✅ Merget (PR #5521 og indsatstrappen model 3, PR #5708) |
| #4914 | Scorecard grøn på 5 seeds | ❌ De to røde ankre ovenfor. Resten er grønt |
| #4914 | Grupetto-tempo besluttet | ✅ Ejer-valgt 23/9, merget (#5581, PR #5779) |
| #4915 | Uheld, tidsgrænse, point og anker på TTT | ✅ Merget (PR #5524) |
| #4915 | TTT i S4-kalenderen | ✅ Besluttet 23/9: nej, TTT flyttes til S5 (#3463) |
| #4915 | Juryen gælder også TTT (ejer 23/9) | 🟡 Ikke bygget. Inert i S4, fordi kalenderen ikke har TTT. Hører til S5-arbejdet |
| #4915 | Ejer-valgene noteret i RULES §2g/§2h | 🟡 §2h står stadig med "stadig ejer-valg" om punkter, der blev afgjort 23/9 |
| #4948 | Hjælp-sektionen om løbsdag følger flaget | ✅ Lukket 24/9 via PR #5563 |

## Genkørsel

Fra repo-roden:

```
node backend/scripts/v4FlipReadiness.mjs --write-report=docs/audits/2026-09-26-v4-flip-klar-rapport.md --private-out=balance-internals/5515-v4-flip-klar/2026-09-26-v4-flip-klar-tal.md
node backend/scripts/v4GcMargin.mjs --seeds=s1,s2,s3,s4,s5
node backend/scripts/headToHeadV4.js --population=backend/scripts/baselines/population-snapshot-2026-09-07.json --stages=backend/scripts/baselines/v4-proxy-stages-2026-09-06.json --seeds=s1,s2,s3,s4,s5 --field-size=180 --films=<mappe>
```

Den første kommando erstatter kun blokken under [Målingerne](#målingerne) og skriver den private tal-fil. Den anden giver GT-vindermarginen. Den tredje giver udbruddenes fordeling pr. terræn og de fem løbsfilm (golden fixtures). Metoden er uændret fra [23/9-rapporten](2026-09-23-v4-flip-klar-rapport.md#metode). Prod-data er kun læst (S4-status og flag), aldrig skrevet.

## Målingerne

Afsnit 1-5 herunder er genereret; de omtales som "måling 1-5" i resten af rapporten.

<!-- v4-flip-readiness:start -->

> **Genereret af `backend/scripts/v4FlipReadiness.mjs`, ikke haandskrevet.** Tallene bag dommene (middel, spaend, rater) staar i den private fil (hard rule 17), ikke her. Ret ikke i blokken; koer scriptet igen.
>
> Koert 2026-09-26T16:41:34.705Z paa motor-sha `979f56b32` · population `backend/scripts/baselines/population-snapshot-2026-09-07.json` · etaper `backend/scripts/baselines/v4-proxy-stages-2026-09-06.json` (141 etaper) · felt 180 · orders=none.

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
- **Et mekanisk uheld (og intet andet) koster loebet via tidsgraensen:** nej. RULES §9 raekke 4: et mekanisk uheld maa aldrig koste udgaaelse. "Koster" = uden uheldets tid havde han klaret graensen eller var reddet med grupettoen (juryens regnemaade, #5582).
- **Et haardt styrt koster loebet via tidsgraensen:** nej. Trappen lover at han kommer i maal og koerer videre.
- **OTL efter et uheld, men uheldet var ikke aarsagen** (over graensen ogsaa uden uheldets tid): ja (etapetyper: hilly, mountain, rolling).
- Rater pr. etapetype (uheld, alvorlige styrt, udgaaede, OTL og dens aarsager, redninger) staar i den private fil.

### 4. Ydelse (gate: under 60 s pr. etape)

| Felt | Etaper | Middel | p95 | Maks (etapetype) | Dom |
|---|---|---|---|---|---|
| 180 | 141 | 15 ms | 39 ms | 96 ms (classic) | PASS |
| 192 | 141 | 16 ms | 34 ms | 111 ms (mountain) | PASS |

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
| 1a | **v3-paritet:** styrt, bonussekunder, indsatsvalg, holdspil med hold-id, vejr, brosten/grus, distance-slid koblet ind | ✅ | Koblet ind 6/9. Kalibreringen i #4914 er merget (PR #5521), og indsatstrappen model 3 er merget (#5580) |
| 1b | **#2789** rute-huller | 🟡 | Se række 6 |
| 1c | **#2944** uheldstrappen | ✅ | Se række 4 |
| 1d | **#2582** tidsgrænsen | ✅ | Se række 5 |
| 1e | **Flag, kaldssted, output → `race_results`, kill-switch til v3** | ✅ | PR #4879. Testene er grønne i dag (måling 5). Flaget står `"off"` i prod |
| 1f | **Ankre grønne før "klar"** | ❌ | To ankre FAIL, begge afhænger af et ejer-valg (flip-kortet) |
| 2 | **Intention pr. rytter pr. etape** | 🟡 | Bygget (PR #4913). `race_day_intention_enabled` findes ikke i `app_config` og er dermed off (læst 26/9). At tænde intentionen er et særskilt ejer-go |
| 3 | **Intentionens pris = Model C** | 🟡 | all_out koster nu på fladt (#4914), og model 3 er merget (#5580). Træningsudbyttet kræver `race_day_development_enabled`, som er `"off"` |
| 4 | **Uheldstrappen (M10)** | ✅ | Raten ligger inden for målet (måling 3). Et mekanisk uheld eller et hårdt styrt koster ikke længere løbet via tidsgrænsen, heller ikke i enkeltstarten eller i grupettoen (denne PR) |
| 5 | **Tidsgrænse = UCI-reglen** | ✅ | OTL fyrer, grupettoen reddes, grupettoen regner på grænsen (#5581), og juryen genindsætter uheldsofre (#5582). Hale-gaten består (måling 2). Holdtidskørslens jury er ikke bygget (ingen TTT i S4) |
| 6 | **Alle seks rute-huller lukkes før flip** | 🟡 | Enkeltstarters højdemeter er rettet (#5587). Brostensfinaler er rettet (#4891). Ingen af dem er set på rigtige ruter endnu, fordi S4 ikke er genereret |

## Kendte røde og åbne punkter

1. **Felt-favoritternes vinderrate** (flip-kortet, rødt 1).
2. **Udbrud pr. terræn mod kandidatbånd** (flip-kortet, rødt 2).
3. **Seed-følsomme ankre:** nedkørsels-/summit-ratio, brostensløftet og bjerg-top-10 består på middel, men kun på 4 af 5 seeds hver. Uændret fra 23/9.
4. **Ankertabellen i RULES §7b er ældre end main-motoren.** Den er genereret 23/9 og mangler de nye ankre (enkeltstart, udbrud pr. terræn for v4). Den skal regenereres (`buildV4AnchorBaseline.mjs && renderV4AnchorTable.mjs --write`). Et skift til den nye population (#5572) venter på dit go.
5. **RULES §2d og §2h er bagud:** §2d nævner ikke juryen i enkeltstarten og grupetto-tilfældet fra denne PR, og §2h lister stadig TTT-valg, der blev afgjort 23/9.
6. **GT-vindermarginen er ikke en del af flip-harnessens tabel.** Den måles af `v4GcMargin.mjs` og består. At samle den i harnessen er en lille opgave.
7. **Ikke dækket af denne måling:** AI-ordrer og taktik (`orders=none`), dag-til-dag-slid i etapeløb, grus og holdtidskørsel (0 i de pinnede etaper) og Railway-containerens CPU.

## Fund i løbsfilmene (ikke rettet her)

- **Løbsfilmen kan skrive at udbruddet holdt, når det blev hentet i finalen.** I motoren betyder `breakaway_survived` kun at udbruddet stadig er sin egen gruppe på sidste segment; finalen afgør bagefter om det holder (`mechanics/breakaway.ts`). Bjerg-filmen (golden fixture) viser det: eventet kommer, og udbryderen bliver nummer fem. Løbsfortællingen er korrekt, fordi den bruger motorens egen udbrudsdom (#5577). Men `stageTimelineFilm.js` oversætter det rå event til linjen "The breakaway holds off the bunch all the way to the line." Efter flip vil spilleren kunne se den linje på en etape, udbruddet ikke vandt. Bør rettes før flip (motoren eller filmen skal bruge udbrudsdommen).

Refs #5515 · #4914 · #4915 · #4948 · #5582 · #5578 · #5583 · #5572
