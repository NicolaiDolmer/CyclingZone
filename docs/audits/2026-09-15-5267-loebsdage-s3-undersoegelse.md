# #5267: 140 løbsdage vs. S3's virkelighed (undersøgelsesspor, 15/9)

> READ-ONLY. Ingen kode ændret, intet committet, intet skrevet til prod. Alle prod-tal er målt
> med SELECT mod sæson 3 (`00000000-0000-0000-0000-000000000003`) den 15/9 2026.
> Kilde til hvert tal står ved tabellen.

## 0. Kort svar til ejeren

Nej, det virkede ikke i denne sæson. **Division 1 har 86 løbsdage i sæson 3, ikke 140.**
De 140 er et helt andet tal: det er antallet af **etaper** en D1-kalender kører på en
28-dages sæson (5 etaper pr. dato x 28 datoer). I sæson 3, der er 31 dage lang, er det
tilsvarende tal 155 etaper. Det har aldrig været antallet af løbsdage.

Fejlen er sket i oversættelsen fra "5 slots" til "5 løbsdage". **Et slot er et klokkeslæt**
(D1: 11, 13, 15, 17, 19), altså en etape-start. **En løbsdag (`game_day`) er en in-game-dag**,
og flere etaper deler med vilje samme løbsdag, fordi det er dét der giver manageren noget at
vælge imellem. I S3 kører D1 5 etaper hver eneste dato, men de fordeler sig kun på 2,77
løbsdage pr. dato i snit.

---

## 1. S3's faktiske kalender, målt i prod

### 1a. Pr. division (én repræsentativ pulje pr. division, alle puljer i samme division er ens, #2276)

| Division | Løb | Etaper | Kalenderdage | **Løbsdage** | `game_day` |
|---|--:|--:|--:|--:|---|
| D1 | 37 | 155 | 31 | **86** | 0-85 |
| D2 | 46 | 124 | 31 | **64** | 0-63 |
| D3 | 40 | 85 | 31 | **54** | 0-53 |
| D4 | 30 | 62 | 31 | **31** | 0-30 |

Tallene er identiske med `docs/CALENDAR_RULES.md` §1c (målt 30/8), så kalenderen er ikke
drevet siden. Omregnet til en 28-dages sæson svarer D1's 86 til ca. **78**, altså præcis
de "naturlige 80" dry-runnet til S4 finder.

### 1b. Pr. kalenderdato

| Division | Datoer | Etaper pr. dato (min/maks/snit) | **Løbsdage pr. dato (min/maks/snit)** | Løbsdage i alt |
|---|--:|---|---|--:|
| D1 | 31 | 5 / 5 / 5,00 | **2 / 5 / 2,77** | 86 |
| D2 | 31 | 4 / 4 / 4,00 | 2 / 4 / 2,06 | 64 |
| D3 | 31 | 2 / 3 / 2,74 | 1 / 2 / 1,74 | 54 |
| D4 | 31 | 2 / 2 / 2,00 | 1 / 1 / 1,00 | 31 |

Summen af løbsdage pr. dato er lig det samlede antal løbsdage i alle fire divisioner. Det
bekræfter R2 i pakkeren: **en løbsdag hører til præcis én kalenderdato** og krydser aldrig midnat.

D1 rammer kun 5 løbsdage på 5 af 31 datoer (31/8, 2/9, 11/9, 12/9, 21/9). Alle fem er datoer
hvor en Grand Tours **hviledag** falder, se §2.

### 1c. Samtidige løb pr. løbsdag i S3 (overlap, det spillet handler om)

| Division | Løbsdage | 1 løb | 2 løb | 3 løb | Andel med >= 2 | Gulv (`TIER_MULTI_RACE_DAY_MIN_SHARE`) |
|---|--:|--:|--:|--:|--:|--:|
| D1 | 86 | 37 | 29 | 20 | **57,0 %** | 45 % |
| D2 | 64 | 20 | 28 | 16 | **68,8 %** | 55 % |
| D3 | 54 | 23 | 31 | 0 | **57,4 %** | 40 % |
| D4 | 31 | 0 | 31 | 0 | **100,0 %** | 40 % |

S3 ligger komfortabelt over alle fire gulve. Det er vigtigt for §4: enhver forlængelse af
løbsdags-aksen uden flere løb spæder direkte af dette tal.

### 1d. Hvad et hold faktisk oplever (delvist tal)

Bundne løbsdage pr. hold i S3 indtil nu (18 af 31 dage kørt, så tallet er ikke sæsonens facit):
D1 snit 19,0 (7-39) · D2 10,0 · D3 5,2 · D4 9,7. Kilde: `race_entry_days`. Det er et
udtagelses-tal, ikke aksens længde, og det er ikke det #4845 handler om.

---

## 2. Hvorfor D1 ikke kan nå 140 (og hvorfor S3 ligner en undtagelse)

### 2a. Geometrien

- Hver D1-dato har **præcis 5 etaper** (`TIER_DENSITY[1] = 5`, låst).
- Et løbs etaper ligger **i træk** på løbsdags-aksen (R1 i `raceCalendarLanePacker.js`,
  ejer-regel 25/8). En GT's eneste huller er dens 2 hviledage.
- En dato må bære **højst 4 GT-etaper** (`MAX_GT_STAGES_PER_DAY = 4`).
- 140 løbsdage over 28 datoer kræver **5 løbsdage på hver eneste dato**, altså at ingen to
  etaper nogensinde deler en løbsdag.

Inde i en GT er der derfor 4 løbsdage pr. dato (4 GT-etaper i træk), og den 5. etape på datoen
må dele løbsdag med en af dem. Tre GT'er a 17-18 etaper fylder 18 af de 28 datoer. Selv med det
mest gunstige regnestykke (10 GT-frie datoer a 5, 6 datoer med en hviledag a 5, 12 GT-datoer a 4)
ligger loftet på **ca. 128 løbsdage**, og pakkeren finder i praksis 80. 140 findes ikke for D1.

### 2b. De fem femmere i S3 er hviledage, ikke et modbevis

Målt på Giro della Penisola i S3: 18 etaper, `game_day` 0-19, altså 20 løbsdage med 2 huller.
Hullerne er GT'ens to hviledage (`GRAND_TOUR_REST_DAYS = 2`). Den 31/8 kører Giroen løbsdag
6, 7, 8 og 10 (11:00, 13:00, 15:00, 19:00) mens **løbsdag 9 er hviledagen**, hvor Klassieker
van Harelbeke kører alene kl. 17:00. Datoen får dermed 5 løbsdage med kun 4 GT-etaper.
Samme mønster på 2/9 (Klassieker van Brugge på løbsdag 16).

Det er hele forklaringen på "det virkede da i denne sæson": **det virkede på 5 af 31 datoer,
og kun fordi en hviledag gav en ekstra løbsdag.** De øvrige 26 datoer har 2-4.
Målt: **alle fem femmer-datoer bærer præcis én GT-hviledag** (31/8 Giro gd 9 · 2/9 Giro gd 16 ·
11/9 Tour gd 37 · 12/9 Tour gd 44 · 21/9 Vuelta gd 69). Den sjette hviledag (Vueltaens anden)
landede på en dato der kun nåede 4. Alle tre GT'er har nøjagtig 2 hviledage, så der findes
**højst 6** sådanne datoer pr. sæson.

### 2c. "5 slots i D1" - kilden, ordret

| Sted | Tekst | Hvad der faktisk står bag |
|---|---|---|
| `backend/lib/tierCalendarMaterializer.js:51-56` | `TIER_STAGE_SLOTS = { 1: ["11:00","13:00","15:00","17:00","19:00"], ... }` | **Klokkeslæt**. Et slot er en etape-start, ikke en løbsdag |
| `docs/CALENDAR_RULES.md` §1 | "Tids-slots pr. dag: D1 5" og "Antal slots = density, så en dag aldrig har flere etaper end slots" | Slots = tæthed = **etaper** pr. kalenderdag |
| `docs/TRAINING_RULES.md` §13.3, beslutning 2 (15/9) | "`SEASON_RACE_DAY_TARGET[4] = 140` (= 28 løbsdatoer x D1's 5 slots)" | Her sættes slot = løbsdag. **Det er selve fejlen** |
| #4850, kommentar 15/9 (fakta-arket bag beslutningen) | samme formulering: "140 (= 28 løbsdatoer x D1's 5 slots)" | Samme fejl, ét led tidligere |

Ejerens egne ord 15/9 (#4850) er: *"Jeg vil have at divisionerne får lige så mange løb som de
plejer. Jeg vil ikke have at dette lige nu laver om i løbskalenderen."* Tallet 140 og
regnestykket "28 x 5 slots" kom fra fakta-arket, ikke fra ejeren. Ejeren godkendte et tal han
fik forelagt som "5 pr. dag"; han bad ikke om at slots og løbsdage var det samme.

For god ordens skyld: **kvoten 140 er ægte** og står i `CALENDAR_RULES.md` §1 som
"Etaper i alt (kvote), S4: D1 140". Den er bare etaper, ikke løbsdage. I S3 var den 155.

### 2d. "Ingen dag med 5" betød noget andet end aksens længde

`MAX_GT_STAGES_PER_DAY = 4` kom af en aftale mellem ejeren og en spiller i #feedback-and-ideas
22/8 kl. 20:27, ordret i koden: *"Agree on no days with 5 gt stages"* + *"6 sounds like a decent max, yea"*.
Begrundelsen står samme sted: med 5 GT-etaper på en dato er **hele D1's dagskvote brugt på ét løb,
så ingen anden afgørelse kan nås den dag**. Reglen er altså en **valgfrihedsregel**, ikke en
kalender-teknisk detalje. Det er præcis den valgfrihed mulighed B nedenfor koster.

---

## 3. Den anden binding, som ikke er GT-loftet

Gulvet for samtidige løb (`TIER_MULTI_RACE_DAY_MIN_SHARE`, ejer 3/9, #3329) sætter et
matematisk loft over hvor lang aksen kan blive, uanset pakker og GT-regler. En løbsdag med
mindst 2 løb koster mindst 2 etaper, så:

> maksimal andel med >= 2 løb = (etaper / 2) / antal løbsdage

| Division | Etaper (S4-kvote) | Maks. andel ved 112 løbsdage | Maks. andel ved 140 løbsdage | Gulv |
|---|--:|--:|--:|--:|
| D1 | 140 | 62,5 % | 50,0 % | 45 % |
| D2 | 112 | **50,0 %** | 40,0 % | 55 % |
| D3 | 84 | **37,5 %** | 30,0 % | 40 % |
| D4 | 84 | **37,5 %** | 30,0 % | 40 % |

D2, D3 og D4 kan altså **ikke** overholde deres gulve ved hverken 112 eller 140, uanset hvor
god pakkeren bliver. Det er ren aritmetik på kvoten. Dry-runnene bekræfter det empirisk
(#5169: ved mål 80 målte D2 43,1 %, D3 21,7 %, D4 21,7 % mod gulvene 55/40/40).

**Konsekvens:** uanset hvilken mulighed ejeren vælger i §4, skal gulvene enten sænkes eller
slås fra for S4. Det er ikke et valg mellem A og B; det er en pris alle veje betaler undtagen C.

---

## 4. Mulighederne

Fælles udgangspunkt: målet fra #4845 er **lige mange trænings-ticks pr. sæson i alle divisioner**.
Løbsdags-aksen er indtil nu blevet brugt som tick-akse, og det er dét der presser kalenderen.

### A. 112 løbsdage i alle fire divisioner (= 28 x 4)

| | D1-hold | D3-hold |
|---|---|---|
| Løbsdage pr. sæson | 80 -> **112** (+32, alle nye er rene træningsdage) | 56 -> **112** (+56) |
| Løb og etaper | uændret: 32 løb / 140 etaper | uændret: 32 løb / 84 etaper |
| Samtidige løb pr. løbsdag | tyndere; ikke målt ved 112 (56,3 % ved mål 80) | ikke målt ved 112; 21,7 % ved mål 80 og 10,5 % ved 140, mod gulvet 40 % |

- **Ændring i #5169:** ét tal (`SEASON_RACE_DAY_TARGET[4] = 140` -> `112`) + deleren i
  `trainingRaceDayTick.js` + tre linjer docs. **Lille.**
- **Pris:** gulvene for samtidige løb skal sænkes for D2-D4 (se §3), ellers stopper gaten `--apply`.
  Overlap-tallene ved 112 er **ikke målt endnu**; dry-runnet har kun kørt 80 og 140.
- **Bemærk:** 112 er ikke mere "rigtigt" end 140. Det er 28 x D2's tæthed, altså igen et
  etape-tal brugt som løbsdags-tal. Det virker kun fordi det tilfældigvis ligger inden for
  det pakkeren kan nå.

### B. 140 løbsdage med `MAX_GT_STAGES_PER_DAY = 5`

| | D1-hold | D3-hold |
|---|---|---|
| Løbsdage pr. sæson | 80 -> **140** (113 med løb + 27 træningsdage, målt) | 56 -> **140** |
| Løb og etaper | uændret | uændret |
| Samtidige løb pr. løbsdag | højst 27 af 140 løbsdage kan have 2+ løb = **ca. 19 %** mod gulvet 45 % | ca. 10,5 % mod 40 % |

- **Ændring i #5169:** ét tal. **Lille i kode, stor i regler.**
- **Pris:** bryder aftalen fra 22/8 med ejeren OG en spiller, og genindfører præcis den skade
  aftalen fjernede: datoer hvor D1's eneste løb er en Grand Tour-etape. Oveni falder D1 fra
  57 % til ca. 19 % løbsdage med noget at vælge imellem. To låste regler brydes, ikke én.
- Anbefales ikke.

### C. Lad løbskalenderen være, og giv træningen sin egen akse (28 datoer x 5 = 140 ticks)

Tick-enheden bliver **kalenderdato x 5 træningsslots**, ens for alle divisioner. Løbsdags-aksen
(`game_day`) bevares urørt som dét den er: bindings- og afviklingsaksen.

| | D1-hold | D3-hold |
|---|---|---|
| Trænings-ticks pr. sæson | **140** | **140** |
| Løbsdage / løb / etaper / overlap | **helt uændret** (86-agtig akse, 57 % med 2+ løb) | **helt uændret** |
| Hvad spilleren ser | 5 celler pr. dag; nogle er løb, resten træning | 5 celler pr. dag; typisk 1 løb, 4 træning |

- **Ændring i #5169:** R12, `emptyGameDayBudget`, ulighedsgaten og §1d kan **udgå**. PR'en
  skrumper til rapportering. Arbejdet flytter til #4846: tick'et nøgles på (dato, slot) i
  stedet for `game_day`, og `uniq_training_day_runs_team_season_game_day` får en slot-dimension
  (den skal alligevel ændres pga. U23/junior-truppene, jf. #4845-kommentaren 15/9).
  **Stor i træningssporet, nul i kalenderen.**
- **Passer med ejerens egen beslutning 8 samme dag:** *"7 ugedage x 5 løbsdage = 35 celler"*.
  Det er bogstaveligt 5 træningsslots pr. kalenderdag, uafhængigt af divisionens løbsdage.
- **Åbent designspørgsmål:** hvordan en rytter der er bundet i et etapeløb tæller sine 5 slots
  den dag (alle 5 optaget, eller kun de slots hvor der køres). Det skal afgøres før byg.
  Kortlægningen er mulig, fordi hver løbsdag ligger inden for præcis én kalenderdato (§1b).

### Anbefaling

**C.** Den er den eneste der leverer #4845's faktiske mål (lige mange ticks) uden at røre
løbskalenderen, som ejeren to gange har sagt han ikke vil have lavet om. A og B forlænger en
akse hvis længde ER overlapstrukturen, og betaler derfor begge med det valg mellem samtidige løb
der er selve manager-spillet. C koster arbejde i træningssporet, men nul i kalenderen, og den
matcher ejerens eget billede af 5 celler pr. dag.

Hvis C afvises, er **A** næstbedst, med den tilføjelse at gulvene for samtidige løb skal
kalibreres eksplicit og med ejer-go, ikke slås fra i tavshed.

---

## 5. Hvad der skal rettes i dokumenterne uanset valget

1. `docs/TRAINING_RULES.md` §13.3 beslutning 2 og #4850's kommentar 15/9: formlen
   "28 løbsdatoer x D1's 5 slots" er forkert. Et slot er en etape-start.
2. `docs/CALENDAR_RULES.md` §1: rækken "Etaper i alt (kvote), S4: 140/112/84/84" bør sige
   eksplicit at tallet er **etaper**, og §1b's `TIER_GAME_DAY_QUOTA` (140/112/84/56) bærer
   ordet "GAME_DAY" i et navn der i virkeligheden tæller etaper. Navnet er selve fælden.
3. `backend/lib/calendarRaceDayTargets.js` docstring gentager "= 28 løbsdatoer x D1's 5 slots".

## 6. Metode

- SQL: `race_stage_schedule` join `races` join `league_divisions`, sæson 3, én pulje pr. tier
  (`distinct on (tier) ... order by tier, pool_index`). Datoer konverteret til
  Europe/Copenhagen. Kun SELECT.
- Kolonnenavne slået op i `database/schema-snapshot.json` før hver kørsel.
- Kode læst: `raceCalendarLanePacker.js` (R1-R11, `MAX_GT_STAGES_PER_DAY`, `raceFootprint`),
  `calendarTierCaps.js`, `tierCalendarMaterializer.js`, PR #5169's diff.
- Docs læst: `CALENDAR_RULES.md` §0-§4, `TRAINING_RULES.md` §13, issues #4845, #4850, #4103,
  #4270, #5267.
