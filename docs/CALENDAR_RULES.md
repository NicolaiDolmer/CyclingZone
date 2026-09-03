# Løbskalenderens regler — SSOT

> **Læs denne FØR enhver opgave der rører kalenderen.** Ejer-direktiv 24/8 2026 ([#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176)):
> *"Vi skal gennemgå alle reglerne angående løbskalenderen, for at tjekke at de alle er optimale. Og vi skal sørge for at de alle gennemføres fremadrettet, sådan at jeg ikke skal lære dig dem forfra hver gang vi laver en ny kalender."*

Reglerne lå før spredt over seks filer med hver sin dato og issue-reference. Denne fil er nu kilden. Ændrer du en værdi, ændrer du den i den fil tabellen peger på — og opdaterer denne.

> **Alle tal er verificeret mod koden og mod prod 30/8 2026.** Hver konstant er læst i den fil tabellen peger på; hvert live-tal er målt med read-only SELECT mod prod. Metoden står i §13. Hvor et tal i denne fil er blevet målt forkert tidligere, står den gamle værdi og hvorfor den var forkert — ellers gentager fejlen sig næste gang nogen læser dokumentet skråt.
>
> **Tre ting skal læses før du bygger en kalender:** §11 (hvad der IKKE er fastlagt — gæt aldrig et af dem på plads), §5b (katalog-lofter — mål der ikke kan nås uanset kalibrering) og §2c (én regenerering pr. sæson).

---

## 0. De to akser (den hyppigste fejlkilde)

| Begreb | Hvad det er | Hvor det står |
|---|---|---|
| **Kalenderdag** (`scheduled_at`) | Den virkelige dato etapen afvikles | `race_stage_schedule.scheduled_at` |
| **Løbsdag** (`game_day`) | Den IN-GAME dag der binder rytteren | `race_stage_schedule.game_day` |

**De er ikke det samme, og `game_day` kan ALDRIG udledes af `scheduled_at`.**

Pakkeren lægger flere hele løbsdage inden i hver kalenderdag — det er præcis dét der lader Division 1 afvikle 5 etaper på én dag uden at nogen løbsdag har mere end 3 samtidige løb. Målt på pakkerens eget D1-output: **75-103 løbsdage over 27-28 kalenderdage**. Kun Division 4 har én løbsdag pr. kalenderdag.

Fejlklassen har kostet to hændelser: [#4155](https://github.com/NicolaiDolmer/CyclingZone/issues/4155) skrev `game_day = dato − startdato − 1` og brød overlap-cap'en i alle fire divisioner på én gang ([#4161](https://github.com/NicolaiDolmer/CyclingZone/issues/4161)). [#4159](https://github.com/NicolaiDolmer/CyclingZone/issues/4159) foreslog at cementere den samme formel som DB-trigger.

### 0b. Løbsdage vises 1-baseret, databasen er 0-baseret

**Ejer-besluttet 27/8 ([#4296](https://github.com/NicolaiDolmer/CyclingZone/issues/4296)): "1-baseret, prisen er accepteret".**

`race_stage_schedule.game_day` starter på **0**. Alle spiller-vendte flader viser **`game_day + 1`** via `RACE_DAY_DISPLAY_OFFSET` i `frontend/src/lib/raceHubLogic.js`.

Det betyder at **UI'ets tal altid er databasens plus én**. Slår du et løb op i SQL, i et admin-værktøj eller i en logline, står der ét mindre end det spilleren ser. En spiller der skriver "mine ryttere er bundet på løbsdag 7" mener `game_day = 6`.

Regn ALDRIG i display-tal. Konvertér ved kanten, med `toDisplayRaceDay`, og aldrig i den anden retning uden at det står eksplicit i koden.

Bemærk at sæson-oversigten viser et ANDET tal under samme ord: `seasonDayOrdinal` er kalender-ordinalen, ikke `game_day`. Den konflikt er åben i [#4318](https://github.com/NicolaiDolmer/CyclingZone/issues/4318) og er ikke løst af offsettet.

---

## 1. Form og tæthed

| Regel | Konstant | D1 | D2 | D3 | D4 | Låst | Fil |
|---|---|---|---|---|---|---|---|
| Etaper pr. kalenderdag | `TIER_DENSITY` | 5 | 4 | 3 | **3** | ejer-låst, D4 hævet **3/9** | `calendarTierCaps.js` |
| Samtidige løb pr. **løbsdag** (loft) | `TIER_OVERLAP_CAP` | 3 | 3 | 2 | 2 | 28/6, bekræftet 24/8 | `calendarTierCaps.js` |
| Samtidige løb pr. **løbsdag** (bund) | `TIER_OVERLAP_MIN` | 1 | 1 | 1 | 1 | ejer 3/9 ([#3329](https://github.com/NicolaiDolmer/CyclingZone/issues/3329)) | `calendarTierCaps.js` |
| Andel løbsdage med **≥ 2 løb** | `TIER_MULTI_RACE_DAY_MIN_SHARE` | 45 % | 55 % | 40 % | 40 % | ejer 3/9 (#3329) | `calendarTierCaps.js` |
| Tids-slots pr. dag | `TIER_STAGE_SLOTS` | 5 | 4 | 3 | **3** | ejer-låst, D4 hævet 3/9 | `tierCalendarMaterializer.js` |
| Etaper i alt (kvote), S4 | density × løbsdatoer | 140 | 112 | 84 | **84** | afledt af §2 | `buildSeasonCalendar.js` |

Antal slots = density, så en dag aldrig har flere etaper end slots. Slottene er konkrete klokkeslæt: D1 11/13/15/17/19 · D2 12/14/16/18 · D3 12/15/18 · **D4 12/15/18** (samme som D3 fra S4).

**Ejer-beslutning 3/9 ([#4270](https://github.com/NicolaiDolmer/CyclingZone/issues/4270)): Division 4 kører 3 etaper om dagen fra sæson 4.** 56 etaper over 28 dage var spillets tyndeste program, og D4 er den division med flest hold. Overlap-cap'en er **uændret** på 2 — den er binding-tryk, ikke pacing.

> ⚠ **Følgevirkningen er §0's egen regel.** `minGameDaysPerRealDay(4)` går fra 1 til 2, så D4's løbsdags-akse og kalenderakse må **ikke længere falde sammen**. Sætningen "kun Division 4 har én løbsdag pr. kalenderdag" (§0) gælder til og med sæson 3 og er falsk fra sæson 4. Målt på S4-planen: D4 har 56 løbsdage over 28 kalenderdage. Kode der antog 1:1 for D4 skal måle, ikke antage; `checkCalendarOverlapInvariants` dømmer det nu selv via `axisLooksCollapsed`.

**Mindste-overlap, præcist (ejer 3/9, #3329).** To tal, fordi ét ikke kan bære reglen. Ejerens eksempel ("D1 ≥ 2 løb pr. løbsdag") er **strukturelt uopnåeligt**, ikke bare stramt: pakkeren lægger flere hele løbsdage inden i hver kalenderdag, og et ulige antal samtidige etaper efterlader altid en løbsdag med ét løb. Målt på S4-planen 3/9:

| | Løbsdage | 1 løb | 2 løb | 3 løb | Andel med ≥ 2 |
|---|--:|--:|--:|--:|--:|
| D1 | 79 | 36 | 25 | 18 | 54,4 % |
| D2 | 58 | 18 | 26 | 14 | 69,0 % |
| D3 | 56 | 28 | 28 | — | 50,0 % |
| D4 | 56 | 28 | 28 | — | 50,0 % |

Alle fire divisioner har `min = 1`. Et absolut gulv på 2 ville gå rødt på en **korrekt** kalender — samme fælde som #3469 allerede har betalt for én gang. Det er derfor **andelen** af løbsdage med mindst 2 løb der bærer ejerens intention ("der skal være noget at vælge imellem"), og gulvene er sat et godt stykke under det målte: de er regressionsvagter, ikke kvalitetsmål.

**Ejer-bekræftelse 24/8** (#staff-chat, efter at have set før/efter-visningen): *"Ændre fra 4 overlappende løb til 3 nu. Og så i de mindre divisioner fra 3 overlap til 2 overlap igen."*

### 1b. Kvoten findes i tre indbyrdes uenige udgaver — brug density × løbsdatoer

Kvoten er ikke ét tal noget sted. Den er tre, og de kender ikke hinanden:

| Kilde | Værdi | Svarer til | Fil |
|---|---|---|---|
| `TIER_GAME_DAY_QUOTA` (default-konstant) | 140 / 112 / 84 / 56 | density × **28** | `backend/lib/tierRaceSelection.js:30` |
| Denne fils §1 indtil 30/8 | 135 / 108 / 81 / 54 | density × **27** | dette dokument, nu rettet |
| `regenSeason3Calendar.mjs` (det der faktisk kørte) | **155 / 124 / 93 / 62** | density × **31** | `regenSeason3Calendar.mjs:86-87` |

**Den gyldige er den tredje**, fordi den er afledt af §2's løbsdatoer i stedet for at være hardcodet. `regenSeason3Calendar.mjs` regner den selv (`TIER_DENSITY[tier] × REAL_DAYS`). `TIER_GAME_DAY_QUOTA` er en default fra dengang sæsonen var 28 dage; den er ikke opdateret og skal ikke bruges som facit uden at blive efterregnet mod §2.

> **Kvoten skal rammes EKSAKT (ejer-beslutning 3/9, #4270 — lukker det tidligere §11 punkt 4).** Hverken 99 eller 101 procent: kvoten ER det antal løbsdage divisionens tidsplan har. Leverer en division færre, står der tomme slots; leverer den flere, er tætheden brudt.
>
> Gaten er `detectQuotaViolations` i `backend/lib/calendarPlacementGates.js`. Den er et **hårdt krav uden override** og stopper `--apply`; dry-runnet kører videre, så afstanden kan måles (§5b's katalog-lofter lukkes ikke af en gate).
>
> Historik: målt i prod 30/8 leverede **D3 85 af 93 (91,4 %)** uden at nogen gate sagde fra. Målt på S4's 28-dages plan 3/9 rammer **alle fire divisioner 100 %** — gulvet koster altså ingenting i dag og fanger næste gang en division sulter.

### 1c. Målt form af live sæson 3 (30/8)

Én repræsentativ pulje pr. division. Alle puljer i samme division er identiske (#2276 verificeret).

| | Løb | Etaper | Kalenderdage | Løbsdage | `game_day` |
|---|--:|--:|--:|--:|---|
| D1 (1 pulje) | 37 | 155 | 31 | 86 | 0-85 |
| D2 (2 puljer) | 46 | 124 | 31 | 64 | 0-63 |
| D3 (4 puljer) | 40 | 85 | 31 | 54 | 0-53 |
| D4 (8 puljer) | 30 | 62 | 31 | 31 | 0-30 |

Alle fire divisioner har løb på alle 31 kalenderdage, så §2's ejer-regel om ingen løbsfrie dage holder. D4 kører præcis 1 løbsdag pr. kalenderdag, som `minGameDaysPerRealDay(4) = 1` foreskriver. Målt 0 brud på `TIER_OVERLAP_CAP` i alle fire divisioner.

---

## 2. Sæsonens rammer

| Regel | Værdi | Låst | Kilde |
|---|---|---|---|
| **Løbsdatoer, sæson 4** | **28** (man 28/9 → søn 25/10) | **3/9** | [#4270](https://github.com/NicolaiDolmer/CyclingZone/issues/4270), `SEASON_RACE_DAYS_DEFAULT` i `calendarStartDate.js` |
| Løbsdatoer pr. sæson (S3) | 31 (28/8-27/9) | 25/8 | [#4218](https://github.com/NicolaiDolmer/CyclingZone/issues/4215) |
| **Løb hver kalenderdag** | **ingen løbsfri dage inde i sæsonen — i ALLE divisioner** | 25/8 | [#4218](https://github.com/NicolaiDolmer/CyclingZone/issues/4215) |
| Sæsonen slutter | altid en søndag | 23/8 | [#4131](https://github.com/NicolaiDolmer/CyclingZone/issues/4131) |
| Bufferdag efter cutover | 1 dag uden løb | 18/8 | [#3467](https://github.com/NicolaiDolmer/CyclingZone/issues/3467) |
| Puljer i samme division | deler identisk kalender-form | — | [#2276](https://github.com/NicolaiDolmer/CyclingZone/issues/2276) |
| Inaktiv manager | 30 dage uden login (`users.last_seen`, `backend/lib/managerActivity.js`) — parkeres uden for divisionerne ved sæsonskifte (S4, 28/9), frigør plads i puljen. Parkeringen (del 2) er IKKE bygget endnu, kun definitionen + rapportering | 2/9 | [#4592](https://github.com/NicolaiDolmer/CyclingZone/issues/4592), [#4307](https://github.com/NicolaiDolmer/CyclingZone/issues/4307) |

**Løb hver dag, ordret (ejer 25/8):** *"Jeg vil ikke have dage uden løb. I den nye sæson skal der være løb hver dag."*

Det er en regel om KALENDERDAGE, ikke løbsdage, og den gælder pr. division. En spiller i Division 4 skal have noget at se på hver eneste dag — ikke kun spillet som helhed. Det binder `realDays` sammen med kvoterne: **hver division skal have mindst lige så mange løbsdage som der er kalenderdage.** D4 havde 29 løbsdage over 27 kalenderdage (1,07/dag); over 31 dage ville den have 2 tomme dage, så kvoten skal hæves før generering, ikke bagefter.

**S4-vinduet, præcist (ejer 3/9).** Første løbsdag er **mandag 28/9** (S3 slutter søndag 27/9), og en mandags-start kan kun have længder der er hele uger: 21, 28, 35 eller 42. **31 findes ikke som mulighed** — mandag + 30 dage er en onsdag. 35 blev målt umulig: D3 leverede 50 af 105 løbsdage og fik 18 kalenderdage uden løb, altså §2's ejer-regel brudt i en hel division. 28 er den eneste lovlige længde der er målt grøn på dækning i alle fire divisioner. Tallet står som data i `SEASON_RACE_DAYS_DEFAULT`, så `buildSeasonCalendar.js` ikke kræver `--race-days` for S4; alle andre sæsoner får fortsat et udledt forslag ejeren skal bekræfte.

> ⚠ **Længden er ikke længere 27.** Værdien stod låst på 27 fra 23/8 og blev ændret til 31 den 25/8, da sæsonstarten blev udskudt fra tirsdag 25/8 til fredag 28/8 med uændret slutdato søndag 27/9. Ændrer du startdatoen igen, skal `realDays` efterregnes: **antal løbsdatoer = slutdato − startdato + 1**, og slutdatoen skal ramme en søndag.

---

## 2b. Rytterbinding

| Regel | Værdi | Låst | Fil |
|---|---|---|---|
| Én rytter, ét løb | pr. **løbsdag** (`game_day`), ikke pr. kalenderdag | 25/8 | `no_rider_double_booking_day` |
| Flere løb pr. IRL-dag | tilladt | 25/8 | — |
| Etapeløb binder | **hele spændet, første til sidste etape** | 25/8 | `raceBinding.js` |

**Ordret (ejer 25/8):** *"På en IRL dag, må en rytter gerne køre mere end et løb. På en løbsdag må en rytter ikke køre mere end et løb."* og *"de skal altså ikke kunne deltage i noget andet undervejs."*

**Spænd, ikke mængde.** [#4173](https://github.com/NicolaiDolmer/CyclingZone/issues/4173) gjorde 24/8 bindingen til mængden af de løbsdage et løb faktisk kører. Det lod en rytter forlade et etapeløb midt i og køre et andet løb i springet — målt 25/8: 5.074 udtagelses-par på 1.694 ryttere, fx Julien Faure i Giro della Penisola (løbsdag 10-29) OG Milano-Riviera på løbsdag 14. Rettet i [#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4214).

> ⚠ **Springene i et løbs løbsdage er IKKE hviledage.** En løbsdag er et halvdags-slot, og slot-tælleren løber videre for de øvrige løb i puljen imens. La Corsa dei Due Mari kører 7 etaper på løbsdag 10, 13, 17, 20, 23, 27, 28 — over 6 kalenderdage. De spring kan ikke lukkes i kalenderen (løbet ville køre 7 etaper på to dage); de skal bindes. Kun 9 af 199 flerdagsløb har et ægte kalenderdags-hul, og de 9 er GT-hviledagene — som spænd-bindingen dækker af sig selv ([#4209](https://github.com/NicolaiDolmer/CyclingZone/issues/4209)).

---

## 2c. Én regenerering pr. sæsonkalender. Punktum.

**Ejer-beslutning 30/8: "To regenereringer er forbudt."**

En sæsons kalender må regenereres **højst én gang**, og kun mens sæsonen har status `upcoming`. Er den regenereret én gang, er formen låst for den sæson. Findes der bagefter et problem med kompositionen, en katalog-mangel eller en skæv fordeling, så **står det til næste sæson**. Det rettes ikke med en ny regenerering.

**Hvorfor reglen findes.** En regenerering trækker et nyt løbssæt fra kataloget, og alt hvad spillerne har bygget oven på det gamle sæt bliver forkert: udtagelser, planer i Planning Center, formkurver, bestyrelsesmål der peger på bestemte løb. Første regenerering er prisen for at rette en kalender der er decideret i stykker. Den anden er en pris uden en fejl at betale den for.

**Hvad der stadig er tilladt:** punkt-reparationer der ikke rører løbssættet (fx `calendarGameDayRepair`), og #2276's rest-af-sæson-rekonciliering når en ny pulje aktiveres. Det er ikke regenereringer.

> ⚠ **Reglen kan i dag brydes, men ikke fanges.** `regenSeason3Calendar.mjs:128` afviser at køre mod en `active` sæson. Der findes **ingen** guard mod den ANDEN kørsel mod en `upcoming` sæson, og ingen kolonne, tabel eller log der siger hvor mange gange en sæsons kalender er blevet regenereret. Den mindste ændring der gør reglen håndhævbar: `seasons` får et tællefelt (fx `calendar_generation_count`), regenereringsscriptet inkrementerer det og nægter at køre hvis det allerede er ≥ 1. Så bliver reglen en guard i selve indgrebet i stedet for noget en agent skal huske. Se §12.

---

## 2d. Sådan bygges sæson 4 (og enhver sæson efter den)

**Ét script, én kommando, én regenerering.** `backend/scripts/buildSeasonCalendar.js` er
vejen. `regenSeason3Calendar.mjs` var S3-specifik og skal ikke kopieres - dens hardkodede
`REAL_DAYS = 31` og `OWNER_FIRST_RACE_DAY` gælder kun S3.

```
# 1) tørkørsel - skriver ALDRIG, uanset flag
node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28

# 2) samme, med §6b's pr.-division-tilt slået til (#4103)
node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt

# 3) skrivning - kun efter ejer-go, og kun med en EKSPLICIT længde
node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --apply
```

### Længden udledes af §2 - den arves ikke

`resolveSeasonWindow` (`backend/lib/calendarStartDate.js`) håndhæver §2's to regler:
slutdatoen skal være en **søndag**, og løbsdatoer = slutdato − startdato + 1. **S3's 31 er
ikke en konstant** - det er dét reglerne gav for en fredags-start. En mandags-start kan
kun have længder der er hele uger. Uden `--race-days`/`--last-day` FORESLÅR scriptet den
lovlige længde tættest på 31 og markerer den som udledt; `--apply` nægter at køre på et
forslag, netop fordi §2c kun giver én chance.

Kvoten er **density × løbsdatoer** (§1b's gyldige af de tre kvote-tal) og beregnes af
scriptet. `TIER_GAME_DAY_QUOTA`s 140/112/84/56 bruges ikke af denne vej.

### Gatene, og hvilke der kan overrides

| Gate | Kilde | Override |
|---|---|---|
| Kalender-invarianter (§3 GT, whitelist, dedup, #2276-signatur) | `gatePlan` | **ingen** |
| Dækningsgarantier (§4 endagsløb, §5 terræn-gulve) | `gatePlan` | **ingen** |
| Etaperækkefølge (§7) | `gatePlan` | **ingen** |
| Realisme-bånd (#3347/#3469) | `gatePlan` | **ingen** |
| Løb hver kalenderdag (§2) | scorecardet | **ingen** - ejer-regel |
| Kvote-hul > 3 løbsdage | `gatePlan` | **ingen** |
| K-B-komposition, sæson (§6) | `gatePlan` | `--allow-composition-drift` |
| K-B-komposition, pr. division (§6) | `gatePlan` | `--allow-tier-composition-drift` |
| Finale-bånd (§7b) | scorecardet | `--allow-finale-drift` |
| Uniforme mål (§6b) | scorecardet | `--allow-uniform-target-drift` |

Scorecardet er den SAMME kode CI kører (`lib/calendarScorecardReport.js`, delt med
`scripts/dev/calendarScorecard4218.mjs`) - så tørkørslen og CI ikke kan dømme forskelligt.

### Hvad ejeren skal vælge før en sæson bygges

1. **Længden** (`--race-days`), blandt de søndags-afsluttede muligheder scriptet printer.
2. **Om §6b-tilten skal være tændt** (`--uniform-tilt`). Den er kalibreret mod en
   TIDLIGERE sæsons måling og skal efterprøves mod den sæson der bygges - for S4 gjorde
   den planen målt ringere, se `docs/audits/season4-calendar-dryrun-2026-09-03.md`.
3. **Hvad der gøres ved hvert blokerende fund** - de peger typisk på kataloget (§5b),
   ikke på generatoren.

Beslutningerne til S4 står samlet, med målte tal og A/B-anbefaling pr. punkt, i
`docs/audits/season4-calendar-dryrun-2026-09-03.md`.

### Sæson-rækken

Scriptet opretter `seasons`-rækken med status `'upcoming'` - **kun i `--apply`-stien**.
Det er ikke kosmetik: årsmødet (`proposeNextMandate`) slår næste sæson op på `number` uden
at filtrere på status, og springer ALLE hold over indtil rækken findes. Opslaget bor i
`backend/lib/seasonLookup.js` (`findNextSeason`), og tørkørslen rapporterer tilstanden.
`seasonTransition.js`s `insertSeasonIfMissing` promoverer selv `'upcoming'` → `'active'`,
så en pre-oprettet række kolliderer ikke med cutoveren.

---

## 3. Grand Tours

| Regel | Konstant | Værdi | Låst | Fil |
|---|---|---|---|---|
| Hvad er en GT | `GRAND_TOUR_MIN_STAGES` | ≥ 15 etaper | uændret, bekræftet 3/9 | `grandTourRestDays.js` |
| GT-rammen (etaper) | katalog | **Giro 17 · Vuelta 17 · Tour 18** | **ejer 3/9** ([#4288](https://github.com/NicolaiDolmer/CyclingZone/issues/4288)) | `race_pool` |
| Samlet snit, inkl. enkeltstart | `GRAND_TOUR_DISTANCE_RULES` | 155-170 km/etape | ejer 3/9 (#4288) | `raceRouteRealismMetrics.js` |
| Landevejsetapernes snit | `GRAND_TOUR_DISTANCE_RULES` | 165-185 km | ejer 3/9 (#4288) | `raceRouteRealismMetrics.js` |
| Prolog, minimum | `GRAND_TOUR_DISTANCE_RULES` | 8 km | ejer 3/9 (#4288) | `raceRouteRealismMetrics.js` |
| Enkeltstart, minimum | `GRAND_TOUR_DISTANCE_RULES` | 25 km | ejer 3/9 (#4288) | `raceRouteRealismMetrics.js` |
| Stigninger (kategoriserede + HC) | `GRAND_TOUR_CLIMB_ANCHOR` | skaleres pr. etape | ejer 3/9 (#4288) | `raceRouteRealismMetrics.js` |
| GT-etaper pr. kalenderdag | `MAX_GT_STAGES_PER_DAY` | 4 | 22/8 m. @thelamba | `raceCalendarLanePacker.js` |
| GT-spænd i kalenderdage | `MAX_GT_SPAN_DAYS` | 6 | 22/8 m. @thelamba | `raceCalendarLanePacker.js` |
| Hviledage pr. GT | `GRAND_TOUR_REST_DAYS` | **præcis 2** | 26/8 ([#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236)) | `grandTourRestDays.js` |
| GT'er kun i | tier 1 | — | [#2251](https://github.com/NicolaiDolmer/CyclingZone/issues/2251) | `tierCalendarMaterializer.js` |
| To GT'er må ikke dele kalenderdag | real-day-separation | ≥ 1 dags mellemrum | 6/8 | [#3472](https://github.com/NicolaiDolmer/CyclingZone/issues/3472) |

Ejer-ordlyd 22/8 (aftalt med @thelamba i #feedback-and-ideas): *"Agree on no days with 5 gt stages"* + *"6 sounds like a decent max"*.

**Hviledage, præcist (ejer 26/8, #4236).** Antallet er **2 for enhver GT** — en spilregel, ikke en egenskab udledt af det virkelige løbs datoer. Før blev det regnet som `clamp(spanDays - stages, 0, 3)` fra `date_text`, hvilket gav 0-3 afhængigt af kataloget, og 0 når feltet manglede. To GT'er i samme sæson kunne dermed have forskelligt antal uden at nogen havde besluttet det.

**En hviledag ER en løbsdag** som GT'en optager uden at køre på. Spændet er derfor `etaper + 2` sammenhængende løbsdage, og rytteren er bundet henover — som i virkeligheden, hvor man ikke forlader Giroen på hviledagen for at køre et andet løb. Det er allerede hvad spænd-bindingen (#4217) gør, så det ændrer intet for spilleren. Positionerne er efter etape 9 og 15 (`GT_REST_DAY_PATTERN[2]`).

### Hvor meget slæk er der faktisk? Ikke det du tror

Dette dokument regnede indtil 30/8 slækket på **21 etaper**. Det etapetal findes ikke i kalenderen.

**Målt i prod 30/8, Division 1, sæson 3 — sæsonens eneste tre Grand Tours:**

| Løb | Klasse | Etaper | `game_day`-spænd | Kalenderdage |
|---|---|--:|--:|--:|
| Giro della Penisola | GiroVuelta | 18 | 0 til 19 (20) | 6 |
| Tour de l'Hexagone | TourFrance | 17 | 28 til 46 (19) | 6 |
| Vuelta Ibérica | GiroVuelta | 17 | 53 til 71 (19) | 6 |

Spændet er i alle tre tilfælde præcis `etaper + 2`, hvilket bekræfter `GRAND_TOUR_REST_DAYS = 2` live. Alle tre ligger på præcis 6 kalenderdage, som `MAX_GT_SPAN_DAYS` foreskriver.

> ⚠ **Slækket er 4 pladser, ikke 1.** 6 dage × 4 etaper = 24 pladser. En GT på **18** etaper + 2 hviledage bruger 20, altså **4 pladser til overs**. Den gamle formulering (*"21 + 2 = 23, én plads til overs, enhver placering der ikke er næsten perfekt er umulig"*) var korrekt matematik på et etapetal der ikke er i kataloget, og den får en kalender-bygger til at tro der er mindre plads end der er. **Reglerne selv er uændrede** — kun begrundelsen var forkert. Skal én af de fire knapper (density, span, stages/day, rest days) ændres, skal de tre andre stadig efterregnes, men nu mod 17-18 etaper.
>
### Realisme-båndet skaleres pr. etape (ejer 3/9, #4288 — lukker det tidligere §11 punkt 7)

**Rammen er Giro 17 · Vuelta 17 · Tour 18 (ejer 3/9).** De udvides ikke til 21: 21 etaper + 2 hviledage = 23 løbsdage, og tre af dem skal kunne ligge i den samme 28-dages sæson uden at overlappe.

> ⚠ **Kataloget matcher ikke rammen endnu.** Målt read-only 3/9 har `race_pool` **Giro della Penisola 18 · Vuelta Ibérica 17 · Tour de l'Hexagone 17** — samme sum (52), men den ekstra etape sidder på Giroen i stedet for på Touren. Ejeren valgte 3/9 at **kataloget rettes** (valg A), ikke reglen. Datamigrationen ligger i katalog-sporet; regel-siden her forventer 17/17/18, og realisme-målingen er etape-baseret, så den måler både 17 og 18 uden ændring.

Konsekvensen for gaten var alvorligere end et forkert tal. `raceRouteRealismMetrics.js` havde sin **egen** `GRAND_TOUR_MIN_STAGES = 21` — et andet tal end spillets 15 — og sprang derfor alle tre GT'er over. **Spillets tre største løb blev ikke målt: hverken GO eller NO-GO, bare tavshed.** Det er samme fejlklasse som §9b's nat-vagt der gik grøn på sit eget fejlsvar.

Tærsklen er nu spillets egen (15, importeret fra `grandTourRestDays.js`), og km-siden er **forankret i virkeligheden i stedet for i et gammelt totaltal** (ejer 3/9, valg A). Spec §6's 3.200-3.500 km var skrevet for et 21-etapers løb; et km/etape-gulv afledt af det var stadig bare det gamle tal divideret med 21. De fire nye grænser kan hver for sig genkendes fra en rigtig grand tour-rute:

| Grænse | Hvorfor den findes |
|---|---|
| **Samlet snit, enkeltstarter inkluderet** | En GT er hverken en samling maratonetaper eller en uge-tur. Det er dét tal en rutepræsentation åbner med. |
| **Landevejsetapernes snit** | Enkeltstarterne trækker det samlede snit ned. Uden denne grænse kunne et løb ramme den første med lutter korte etaper plus et par lange tempoer. Landevejsetaperne **er** løbet. |
| **Prologens minimum** | En prolog er kort med vilje, men under gulvet er den en opvisning, ikke en etape der afgør noget. |
| **Enkeltstartens minimum** | En rigtig GT-tempoetape skal kunne skabe tidsforskelle. |

**Klassifikationen er den eneste ikke-trivielle del:** en tempoetape (`itt`/`itt_hilly`/`ttt`) tæller som **prolog** hvis den er løbets **første** etape **og** kortere end enkeltstarts-gulvet. Alle andre tempoetaper skal opfylde enkeltstarts-gulvet. Reglen er bevidst stram i den ene ende: en kort tempoetape midt i løbet er ikke en prolog, den er en for kort enkeltstart.

Stigningerne skaleres fortsat pr. etape fra spec §6's anker (`GRAND_TOUR_CLIMB_ANCHOR`) — kun km-siden er erstattet.

> **Målt mod prod 3/9, efter omlægningen: alle tre GT'er er grønne** — Giro della Penisola 164,1 km samlet snit / 172,1 landevej · Tour de l'Hexagone 157,6 / 176,3 · Vuelta Ibérica 155,8 / 173,3. **Men det kostede D1 syv gen-træk af tolv** (`realisme-gen-træk 7`). Båndet er altså opnåeligt og stramt på samme tid: et tidligere træk gav Vuelta 151,4 km/etape, og det er dét tal båndet nu fanger. Bliver gen-trækkene ved med at ligge over 8, er forsyningen — ikke båndet — det der skal se på.

---

## 4. Etapeløb og endagsløb

| Regel | Konstant | D1 | D2 | D3 | D4 | Låst | Fil |
|---|---|---|---|---|---|---|---|
| Andel endagsløb (mål) | `TIER_ONE_DAY_SHARE_TARGET` | 0,55 | 0,55 | 0,58 | 0,55 | 7/8 | `tierCalendarGuarantees.js` |
| Andel endagsløb (minimum) | `TIER_ONE_DAY_SHARE_MIN` | 0,45 | 0,45 | 0,48 | 0,45 | = mål − 0,10 | `tierCalendarGuarantees.js` |
| Etapeløb uden bjergetape | `TIER_MOUNTAIN_FREE_STAGE_RACE_MIN` | 0 | 2 | 1 | 2 | 7/8 | `tierCalendarGuarantees.js` |
| Etapeløbs-spænd (ikke-GT) | hård grænse | etaper + 3 kalenderdage | | | | 17/8 | [#3546 H](https://github.com/NicolaiDolmer/CyclingZone/issues/3546) |
| Monumenter | **ingen eksklusiv løbsdag** — deler som ethvert andet løb | | | | | 26/8 | [#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236) |

> **Etapeløbs-spændet har ingen konstant og ingen check i pakkeren — det er tilsigtet.** Reglen blev før håndhævet af `spanMoveOk` inde i `layoutStream`. Kontiguiteten giver den nu gratis: et løbs etaper ligger på løbsdage i træk, så spændet i datoer er bundet af hvor mange løbsdage en dato bærer. Men "gratis" er ikke "garanteret", så den **måles mod hele kataloget** i `raceCalendarLanePackerInvariants.test.js:141` og rapporteres af `scripts/s3CalendarPackageScorecard.js:195`. Leder du efter en `MAX_STAGE_RACE_SPAN`-konstant i `raceCalendarLanePacker.js`, finder du ingen — det betyder ikke at reglen er væk. Den mangler derimod på niveau 2 og 3 (§9).

**Monument-reglen, præcist (ejer 26/8, [#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236)).** Et monument har **ikke** længere sin egen eksklusive løbsdag. Reglen kom 21/8 for at sikre fulde felter i sæsonens fem største endagsløb, men holdt op med at levere da [#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4217) gjorde bindingen spænd-baseret 24 timer før: rytteren er bundet hele etapeløbets spænd, også hen over monumentets løbsdag. Målt mod prod 26/8: **0 delte ryttere i alle 9 monument/etapeløb-kombinationer** — gevinsten var væk. Prisen blev betalt alligevel, for det eksklusive indskud rev hul i løbsdagene hos fem D1-etapeløb og var eneste årsag til at kronologi-reglen var brudt. Det der stadig gælder er at monumenterne ligger **spredt over sæsonen**; det måles i `raceCalendarLanePackerInvariants.test.js:125` med to konkrete tal: mindst **2 kalenderdage** mellem to nabomonumenter og mindst **14 kalenderdages** samlet spredning fra første til sidste.

### Et monument må ikke ligge inde i et Grand Tours løbsdags-spænd (ejer 3/9, #4203)

En Grand Tour binder rytteren **hele sit spænd**, hviledagene med (§2b's spænd-binding). Ligger et monument inde i det spænd, kan ingen af de hold der kører GT'en stille deres bedste rytter op i sæsonens største endagsløb — monumentet bliver et B-løb uden at nogen har besluttet det. Målt i S3 lå **4 af 5 monumenter** inde i et GT-vindue.

Gaten er `detectMonumentsInsideGrandTours` i `backend/lib/calendarPlacementGates.js`. Den måler på **`game_day`**, ikke på datoen: en D1-kalenderdag bærer 3-5 løbsdage, så to løb kan dele dato uden at dele løbsdag. Den er rød i scorecardet og stopper `--apply`, uden override.

> **Målt på S4's plan 3/9: 3 brud i D1** — Milano–Riviera (løbsdag 11) i Giro della Penisola (0-19), De Vlaamse Ronde (37) i Tour de l'Hexagone (28-46), La Classica d'Autunno (59) i Vuelta Ibérica (53-71). Gaten fanger dem før kalenderen skrives; **at flytte dem er pakkerens arbejde og ligger i #4203's eget spor.**

**Spredningen måles fortsat i KALENDERDAGE** (ejer 3/9, §11 punkt 5 = valg B). De to må ikke blandes sammen.

> **Det ene spørgsmål ejeren skal svare på:** hvad er minimumsafstanden mellem to monumenter **på løbsdags-aksen (`game_day`)**, og skal den håndhæves mod prod? Testen ovenfor måler i KALENDERDAGE mod en fixture (`>= 2` mellem naboer, `>= 14` i samlet spredning) — der findes ingen tilsvarende gate mod prod og intet låst tal på løbsdags-aksen. Målt mod prod 30/8 ligger D1's fem monumenter på game_day 11, 24, 44, 55 og 69, altså med 13, 20, 11 og 14 løbsdages mellemrum; et krav på ≤ 11 løbsdage ville den nuværende kalender holde. Indtil tallet er låst, gættes det ikke på plads, og der kommer ingen `verify-invariants`-gate på spredningen ([#4465](https://github.com/NicolaiDolmer/CyclingZone/issues/4465)).

> **Andelen måles på ANTAL LØB, ikke på løbsdage.** Det er et bevidst valg (#3327) og står i kodens overskrift. Målt på løbsdage ville D1 være 14 % — målt på løb er den 61 %.

**Hvorfor tallene er som de er.** Ejer-beslutning 7/8, ordret: *"Der mangler nogle endagsløb i 1. division. Der er for mange i 3. division. 2. division kan godt holde til et par stykker mere. Mere ensartet balance."* → D1 0,48 → 0,55 · D2 0,50 → 0,55 · D3 0,76 → 0,58 · D4 uændret niveau, nu samme tal som de øvrige.

**Hvad reglen findes for at undgå** (#3327, 4/8): *"Division 2's kalender var 33 % endagsløb og brostens-specialister havde reelt 2 etaper/pulje/sæson at bruge — ubalanceret dækning pr. terræn-familie og for lidt mix."* Altså: **specialister uden noget at køre.**

### Klasse ↔ etapeantal

`CLASS_STAGE_LENGTH_BAND` i `tierCalendarGuarantees.js:42-47`.

| Klasse | Etaper | Låst |
|---|---|---|
| ProSeries | 3-5 | 4/8 ([#3328](https://github.com/NicolaiDolmer/CyclingZone/issues/3328)) |
| OtherWorldTour A / B / C | 6-8 | 4/8 |
| **Class1 / Class2** | **3-6** | **3/9** ([#4270](https://github.com/NicolaiDolmer/CyclingZone/issues/4270)) |
| GrandTour / TourFrance / GiroVuelta / Monuments | **intet bånd** | bevidst — se §3 |

**Class1/Class2 fik båndet 3-6 den 3/9 (ejer-beslutning, lukker det tidligere §11 punkt 2).** Før stod de uden bånd — ikke fordi nogen havde besluttet det, men fordi #3328 kun tog stilling til ProSeries og WorldTour. Målt 30/8 kørte D4 **Class2-etapeløb med 2 etaper**; et etapeløb på to dage er ikke et etapeløb, det er to endagsløb med fælles klassement. Loftet 6 holder Class1/Class2 under WorldTour-båndets 6-8, så klasse-hierarkiet stadig betyder noget i længde.

**Prisen, målt og ikke gættet:** to løb falder ud af D4's vindue — `Tour du Périgord` og `Giro delle Marche`, begge `hilly_tour` med 2 etaper. D4's klasse-vindue går fra 19 til **17 brugbare etapeløb**, og `hilly_tour` fra 7 til 5. Katalog-loftet holder alligevel: 35 endagsløb + 61 etapeløbs-etaper = **96 etaper mod en kvote på 84**. Målt på S4's plan rammer D4 84 af 84.

> Kodekommentaren ved `CLASS_STAGE_LENGTH_BAND` skrev indtil 3/9 at *"GT'ens 21 etaper er ejer-bekræftet"*. **Ingen GT har 21 etaper** — de har 18, 17 og 17 (§3). Sætningen var en rest fra før kataloget blev det det er i dag, og den er nu fjernet.

---

## 5. Terræn-dækning

### Etapetype → terræn-familie

`TERRAIN_FAMILY_BY_PROFILE_TYPE` i `tierCalendarGuarantees.js:100-108`. **Seks familier er defineret**, ikke fem.

| `profile_type` | Familie | Klatrevægt | Punch |
|---|---|---|---|
| `flat` | flat_sprint | — | — |
| `rolling` | **rolling** (egen familie siden 24/8) | 0,04 | 0,12 |
| `hilly` | hilly | 0,06 | 0,44 |
| `classic` | **hilly** (ejer 3/9) | 0,12 | 0,16 |
| `cobbles` | cobbles | — | 0,06 (brosten 0,66) |
| `gravel` | **cobbles** (ejer 3/9) | — | brosten 0,58 |
| `itt`, `itt_hilly`, `ttt` | itt | 0,18 (kun `itt_hilly`) | — |
| `mountain`, `high_mountain` | mountain | 0,50 | 0,04 |

**`rolling` er baroudeurens terræn og fik sin egen familie 24/8** ([#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176)). Afgjort empirisk på overrepræsentation blandt etapevindere i S1+S2 — rolling: baroudeur 1,85 · klatrer 1,38 · sprinter 1,14 · puncheur 0,91 — ikke efter navn. Et gulv fyldt med rolling-etaper ville hverken garantere sprinteren eller puncheuren det det blev lavet til, så `rolling` hører hverken til flat_sprint eller hilly. Kompositionen (§6) er uændret: `rolling` tæller fortsat som "kuperet" dér, jf. ejerens egen gruppering i #3295.

### Begge huller er lukket 3/9 (ejer-beslutning, tidligere §11 punkt 6)

**`rolling` har nu både gulv og loft** — den eneste familie med et loft. Se `TIER_TERRAIN_FAMILY_MIN` / `TIER_TERRAIN_FAMILY_MAX` i `tierCalendarGuarantees.js`:

| | D1 | D2 | D3 | D4 |
|---|---|---|---|---|
| **rolling** | 16-30 | 6-14 | 4-12 | 3-10 |

Hvorfor også et loft, og kun på rolling: rolling er den eneste familie uden en dominerende evne (største vægte er udholdenhed 0,18 og tilfældighed 0,20, de højeste af alle ti profiltyper). Et gulv alene ville lade den vokse frit på bekostning af de familier der ER nogens speciale. De øvrige fem har en profiltype med et ejer-mål i §6/§6b og er dermed allerede loftet ovenfra.

Tallene er målt tre steder: live S3 (30/8), S4's plan uden katalog-udvidelsen, og S4's plan **med** den ([#4708](https://github.com/NicolaiDolmer/CyclingZone/issues/4270)) — det katalog sæsonen faktisk bygges på.

| | S3 live | S4 uden #4708 | S4 med #4708 |
|---|--:|--:|--:|
| D1 | 22/155 | 19/140 | 24/140 |
| D2 | 9/124 | 10/112 | 9/112 |
| D3 | 4/85 | 7/84 | 8/84 |
| D4 | **0/62** | 1/84 | **6/84** |

D4 er dét gulvet blev lavet for: S3 leverede **nul** rolling-etaper, altså ikke én dag til baroudeuren i hele divisionen, og ingen gate sagde fra. Først med katalog-udvidelsen kan D4 levere 6.

**`classic` ligger nu i hilly-familien.** 9 af S3's 426 etaper (D2 2, D3 3, D4 4) talte før ikke mod noget gulv overhovedet. `hilly_classic` er dokumenteret som samme karakter som puncheuren, og kompositionen (`PROFILE_TO_CATEGORY`) har hele tiden talt den som kuperet — de to grupperinger modsagde hinanden uden begrundelse, præcis som `itt_hilly` gjorde indtil 24/8. `classicStages` rapporteres stadig som egen kolonne.

**`gravel` hører til cobbles-familien** (ejer 3/9, [#4105](https://github.com/NicolaiDolmer/CyclingZone/issues/4105)): grusløb tæller med i brostensklassikerne. Etapetypen kommer fra grus-sporet; regel-siden er klar til den, så den første grus-etape ikke falder ud af tællingen i stilhed. Det gælder tre steder: `TERRAIN_FAMILY_BY_PROFILE_TYPE`, `cobbles_in_stagerace` i `raceRouteRealismMetrics.js` (ellers ville en konvertering fra brosten til grus se ud som et **fald** i brosten-dækning) og WT-distancebåndet.

**Grus har sit EGET §7b-finale-bånd** (ejer 3/9, valg A — se §7b's tabel). Første udkast gav grus brostens-bånd, men det holdt ikke ved måling: generatorens grus-vægte er ikke brostens-vægte. Grus afgøres langt oftere i **udbrud** end en brostensklassiker — underlaget slider feltet ned over lange, åbne sektorer i stedet for at samle det til en reduceret spurt — og den forskel er hele pointen med at grus er sin egen etapetype. Båndet er derfor afledt af `FINALE_WEIGHTS_BY_PROFILE.gravel` med samme spillerum som de øvrige rækker. Ændres vægtene, skal båndet med; `stageFinaleMetrics.test.js` fælder dem hvis de driver fra hinanden.
>
> `classic` produceres kun af arketypen `hilly_classic`. Brostensklassikere bruger `cobbles` (brosten-vægt 0,66) og tælles korrekt. **Skulle en brosten-variant nogensinde få `profile_type='classic'`, ryger den ud af tællingen i stilhed** — derfor bør klassifikationen på sigt bygge på `terrain_archetype`, ikke på `profile_type`.
>
> Historik: `rolling`, `classic` og `itt_hilly` hørte indtil 24/8 til INGEN familie og var usynlige for alle dækningsgarantier — 21 af Division 1's 140 etaper (15 %). `itt_hilly` var en enkeltstart der ikke talte som enkeltstart; den er rettet. `rolling` og `classic` er det ikke.

### 5a. `rolling` grupperes ni steder — familien ovenfor er kun det ene

Familie-tabellen ovenfor siger at `rolling` er baroudeurens terræn. **Det er én af ni grupperinger i `backend/lib/`, og seks af de andre placerer den sammen med `flat`.** Ejer-beslutningen 24/8 er altså gennemført præcis dér hvor den blev truffet, og ingen andre steder. Kortlagt 2/9 ([#4596](https://github.com/NicolaiDolmer/CyclingZone/issues/4596)), efter ejer-flag i Discord 1/9: *"jeg forventer langsigtet, at 'rolling' etaper, skal være i bakke [...] Det er faktisk ikke sikkert, at der er lavet om i raceengine, måske er det kun generatoren."*

Formodningen var korrekt — og undervurderede omfanget: der er heller ikke lavet om i generatorens finale-logik.

**Bakke-/udbruds-siden (3)**

| Konstant | Fil | Gruppering | Hvad den styrer |
|---|---|---|---|
| `TERRAIN_FAMILY_BY_PROFILE_TYPE` | `tierCalendarGuarantees.js:100` | egen familie `"rolling"` | Terræn-gulve (§5) |
| `PROFILE_TO_CATEGORY` | `calendarCompositionTargets.js:71` | `rolling → "hilly"` | Komposition (§6) |
| `GC_RELEVANT_PROFILES` | `raceRoles.js:208` | med `hilly`/`mountain`/`classic` | Helper-arbejde koster GC-sats, ikke leadout-sats |

**Flad-siden (6)**

| Konstant | Fil | Gruppering | Hvad den styrer |
|---|---|---|---|
| `PROFILE_TO_BUCKET` | `raceTerrain.js:8` | `rolling → "flat"` | **Kaptajn-prioriteternes terræn-bucket — spiller-vendt** |
| `FLAT_FAMILY` | `raceStageProfileGenerator.js:716` | `{flat, rolling}` | **GT'ens afsluttende etape** (l. 633) + `sprint_finale`-arketypen (l. 721) |
| `SPRINTER_DENSITY_PROFILES` | `raceSimulator.js:437` | `{flat, rolling}` | Sprinter-tæthed i `routeBreakawayFactor` |
| `FLAT_INCIDENT_PROFILES` | `raceTimeline.js:68` | `{flat, rolling}` | Styrt/uheld vægtes mod sidste kvartal (positionskamp) |
| `WIND_EXPOSED_FAMILY` | `routeSegments.js:233` | `{flat, rolling, cobbles}` | +0,1 vind-eksponering i vejret |
| `FLAT_FAMILY` | `stageOrderMetrics.js:16` | `{flat, rolling}` | Målings-siden af #3326's etaperækkefølge |

> ⚠ **De to tungeste er `raceTerrain.js` og GT-finalen.**
>
> `raceTerrain.js`s docstring kalder de fem buckets *"strategi-buckets som kaptajn-prioriteter er rangordnet pr."* Det er ikke intern bogholderi — det er den kasse **spillerens taktik-valg tolkes i**. Sætter en spiller kaptajnen op til en rolling-etape, behandles den som en flad dag. Filen noterer selv at den *"genbruges senere i S4/S5 (terræn-DNA, rolle-hints)"*, så placeringen forplanter sig til systemer der endnu ikke er bygget. Det gør den billigere at afgøre nu end senere.
>
> `toGrandTourFinale` (`raceStageProfileGenerator.js:633`) vælger GT'ens sidste etape som *"flad/enkeltstart → sidst (aldrig bjerg)"* — og `FLAT_FAMILY` gør `rolling` til en gyldig kandidat. **En Grand Tour kan altså slutte på en etape der ender i udbrud 65 % af gangene** (finale-fordelingen for `rolling`: breakaway 65 / reduced_sprint 20 / bunch_sprint 15, `raceStageProfileGenerator.js:140`). Samme spænding i korte etapeløb via `sprint_finale`.

**Tre af flad-placeringerne er formentlig rigtige som de er** og bør bekræftes frem for flyttes: sprinter-tæthed (mange sprinterhold jager et udbrud ned — også på en rullende dag), vind-eksponering (rullende terræn er åbent) og hændelses-vægtning. De står her for at være dokumenterede undtagelser i stedet for udokumenterede afvigelser.

**Uenighed inden for samme fil:** `raceTimeline.js` har både `FLAT_PROFILES = {flat}` (l. 66) og `FLAT_INCIDENT_PROFILES = {flat, rolling}` (l. 68) — to klassifikationer af samme etape, til hvert sit formål, tre linjer fra hinanden.

**Spejlinger i tests og scripts** er ikke selvstændige beslutninger, men skal følge med hvis noget flyttes: `raceStageProfileGenerator.test.js:41` (`SPRINT_FRIENDLY`), `stageOrderReorder3371.js:18` (`BREAKER_TYPES`, `PREFERRED_OPENERS`), `simulateSeasonDryRun.js:647`.

> **Ændr én gruppering ad gangen, med måling imellem.** De ni rammer generator, motor, tidslinje, vejr, roller og taktik-UI. En samlet "flyt rolling til bakke" ville flytte for mange variable til at nogen bagefter kan se hvad der virkede.

Evnevægtene selv (`raceStageProfileGenerator.js:107`) hører hverken til flad eller kuperet: udholdenhed 0,18 · flad 0,12 · punch 0,12 · **tilfældighed 0,20** — den højeste randomness af alle ti profiltyper. Det er dét der gør den til en udbrudsdag, og det er målt, ikke navngivet.

### Gulve (minimum antal ETAPER pr. pulje pr. sæson)

| Familie | D1 | D2 | D3 | D4 |
|---|---|---|---|---|
| cobbles | 3 | 6 | 5 | 1 |
| flat_sprint | 20 | 15 | 12 | 8 |
| itt | 5 | 4 | 3 | 1 |
| hilly | 10 | 8 | 8 | 6 |
| mountain | 28 | 20 | 12 | 13 |
| **rolling** | **16** | **6** | **4** | **3** |
| **rolling (loft)** | **30** | **14** | **12** | **10** |

`TIER_TERRAIN_FAMILY_MIN` + `TIER_TERRAIN_FAMILY_MAX` i `tierCalendarGuarantees.js`. **Seks gulve, seks familier** siden 3/9.

> Rolling-båndet dømmes af `detectTerrainBandViolations`, ikke af `detectCoverageViolations`. Det er rødt/grønt i scorecardet og stopper `--apply`, men det ændrer ikke #4215's eksisterende CI-dom — samme afgrænsning som §6b's uniforme mål og §6's strenge tolerance allerede har. Ellers ville en ejer-beslutning om S4's kalender vælte en grøn gate for alt andet arbejde i repoet.

> ⚠ **Gulvene er regressionsværn, ikke kvalitetsmål.** De blev sat *"et godt stykke under nuværende observerede niveau (prod, sæson 2, 4/8)"* — altså efter hvad kalenderen tilfældigvis leverede, ikke efter hvad der er godt spil. Undtagelser: D2 cobbles hævet 2 → 6 (ejer-ask 4/8) og mountain-gulvene empirisk kalibreret mod katalogets loft (#3469, 7/8).
>
> **Det er mekanismen bag at de samme problemer gentager sig:** kalenderen har gulve der forhindrer den i at blive værre, men ingen mål der gør den bedre. Ejer-beslutning 24/8: kompositionsmålene (§6) skal gælde pr. division med stram tolerance — det er dét der skal løfte niveauet, ikke gulvene.

### Arketype-reservationer

Gulvene *måler* efter selection. Reservationerne *sikrer* før: antal løb af hver arketype der tages FØR prestige-walket. `TIER_ARCHETYPE_RESERVATIONS` i `tierCalendarGuarantees.js:192-220`, #3295.

| Arketype | D1 | D2 | D3 | D4 | Hvad den er eneste kilde til |
|---|--:|--:|--:|--:|---|
| `itt_classic` | 1 | 1 | 1 | **2** | fritstående enkeltstart |
| `cobbled_classic` | **6** | 5 | 4 | 0 | brostens-endagsløb |
| `cobbled_tour` | 0 | 1 | 1 | 1 | brosten i etapeløb |
| `summit_tour` | 0 | 2 | 3 | 2 | summit-finaler, holder nedkørsels-andelen nede |
| `hilly_tour` | 0 | 2 | 1 | 2 | etapeløb uden bjergetape |
| `balanced_week` | 0 | 0 | 0 | **2** | eneste arketype med ITT i sine garantier |

D1's `cobbled_tour` står bevidst på 0 (#4075): kataloget har kun 2, og D1's reservation støvsugede det ene D2 og D3 kunne nå.

**Ændret 26/8 ([#4272](https://github.com/NicolaiDolmer/CyclingZone/issues/4272)), begge ejer-asks:**

- **D1 `cobbled_classic` 4 → 6.** Ejeren 26/8: *"Det er ikke okay, at division 1 kun har 3 brostensetaper."* D1 går fra 4 til 6 brosten-etaper (2,6 % → 3,9 %). **Ikke helt i mål**, og tallet er valgt på en MÅLT afvejning, ikke på hvad der maksimerer D1:

  | `cobbled_classic` | D1 brosten | D3 etaper | D3 dage uden afgørelse |
  |---|--:|--:|--:|
  | 4 (før) | 4 (2,6 %) | 86 | 7 |
  | **6** | **6 (3,9 %)** | 84 | **7** |
  | 7 | 7 (4,5 %) | 82 | **11** |
  | 8 | — | — | D3 under sit brostens-gulv (4 < 5) |

  Brostens-klassikere er ENDAGSLØB, og endagsløb er det der skaber afgørelses-dage. Flyttes de syvende og ottende til D1, mister D3 fire dage hvor noget afgøres — en dårlig handel for én ekstra brosten-etape. Ved 8 bryder D3's ejer-låste gulv helt (samme forsynings-konflikt som [#4075](https://github.com/NicolaiDolmer/CyclingZone/issues/4075)). K-B-målet på 6 % (≈ 9 etaper) kræver flere brostens-løb i kataloget.

  > **Bemærk:** `daysWithoutDecisionCount` MÅLES af pakkeren, men er ikke gated. Denne afvejning ville derfor ikke være fanget af et grønt scorecard — den blev fundet ved at diffe før/efter.
- **D4 `balanced_week` 0 → 2, `itt_classic` 1 → 2.** D4 lå på 5 % enkeltstart mod målet 10 %. Årsagen var målt: D4's klasse-vindue (Class1/Class2) rummer kun 3 fritstående ITT-løb, og dets etapeløbs-arketyper (`summit_tour`, `hilly_tour`) er så korte at garantierne opbruger alle etape-pladser — `balanced_week` er den eneste arketype i vinduet der **garanterer** en ITT. Resultat: 3 → 5 ITT-etaper (4,8 % → 8,1 % på det daværende plan; **målt live 30/8 er den 9,7 %**).

---

## 5b. Katalog-lofterne — en forsyningsgrænse, ikke en generator-fejl

Tre mål kan i dag **ikke nås uanset hvordan generatoren kalibreres**, fordi kataloget ikke indeholder de løb der skal til. Det er ikke en fejl i pakkeren, og det skal ikke fejlsøges som en. Det er samme fejlklasse som `.claude/learnings/2026-08-06-garanti-uden-forsyning-blokerede-s3-kalenderen.md`: en garanti uden forsyning er en blokering, ikke en garanti.

**Opdateret 3/9.** De tre lofter nedenfor stod fra 30/8 og er alle tre flyttet — af to ejer-beslutninger samme dag: D4's tæthed 2 → 3 (§1) og katalog-udvidelsen med 46 nye løb (8 OtherWorldTourA · 5 OtherWorldTourB/C · 10 ProSeries · 8 Class1 · 15 Class2).

| Loft | Mål | S3 live (30/8) | S4-plan, nyt katalog (3/9) | Status |
|---|--:|--:|--:|---|
| D1 brosten | 5 % | 3,9 % | **5,0 %** | **lukket** — af nye brostens-løb, ikke af en slækket regel |
| D4 enkeltstart | 10 % | 9,7 % | **8,3 %** | inden for ±2 pp. Class2-løbene gav D4 flere fritstående ITT; margin er stadig tynd |
| D4 højbjerg | 12 % | **16,1 %** | **13,1 %** | inden for ±2 pp. **Halvdelen kom fra tætheden alene**: ved density 3 skal D4 finde 84 etaper i stedet for 56 og må længere ned i sit vindue, så `summit_tour`-blokken fortyndes af sig selv (16,1 → 11,9 % før de nye løb) |
| D4 etapeløb i vinduet | — | 19 | **17 brugbare** | Class1/Class2-båndet [3-6] tager to 2-etapers `hilly_tour` ud (§4). Katalog-loftet er 96 etaper mod en kvote på 84 |

> **Tre af rapportens fire blokerende fund er lukket af kataloget, ikke af regler.** D1's brosten-i-etapeløb (0 < 1), D1's nedkørsels-finaler (6 < 8) og D2's komposition (kuperet +5,4 / bjerg −7,5) er alle grønne efter udvidelsen. Det er §5b's egen pointe, dokumenteret: **et katalog-loft lukkes ved at tilføje løb, ikke ved at slække et mål.**

> ⚠ **De tal der stod i `docs/NOW.md` var forældede.** NOW.md skrev D1 brosten 4,5 % og D4 ITT 8,1 %. Målt live 30/8 er de **3,9 %** og **9,7 %**. 4,5 % var scenariet med `cobbled_classic` = 7, som blev fravalgt (se afvejningstabellen i §5), og 8,1 % var plan-tallet, ikke det materialiserede. Brug de målte tal.
>
> NOW.md noterede desuden **41,9 % opad-finaler i D4** som følge af summit_tour-overskuddet. Det tal stammer fra #4272-arbejdet 26/8 og er **ikke genmålt 30/8** — behandl det som en indikation, ikke som en måling.

**Reglen:** et katalog-loft må aldrig lukkes ved at slække et mål eller ved at regenerere (§2c). Det lukkes ved at tilføje løb til `race_pool` før næste sæson bygges, eller ved at ejeren beslutter at målet ikke gælder for den division.

---

## 5c. Det uafgjorte: arketype-loft eller flere katalog-løb

**Ejer-beslutningen mangler stadig.** [#4272](https://github.com/NicolaiDolmer/CyclingZone/issues/4272) lukkede to reservations-justeringer, men efterlod ét spørgsmål åbent, og det er et **spildesign-valg**, ikke en teknisk afvejning. Det står som §11 punkt 3. Gæt det ikke på plads.

---

## 6. Komposition (terræn-fordeling)

| Kategori | Mål |
|---|---|
| flad | 24 % |
| kuperet | 33 % |
| bjerg | 28 % |
| enkeltstart | 10 % |
| brosten | 5 % |
| TTT | 0 % (motoren scorer den ikke endnu) |

`ACTIVE_TARGET` i `calendarCompositionTargets.js`, ejer-beslutning 6/8 ([#3295](https://github.com/NicolaiDolmer/CyclingZone/issues/3295)). **Brosten rettet 6 % → 5 % og kuperet 32 % → 33 % (ejer-beslutning 31/8, [#4103](https://github.com/NicolaiDolmer/CyclingZone/issues/4103))** — lukker det tidligere §11-punkt "5 % eller 6 %?": 5 % vandt, for BEGGE de tidligere konkurrerende mål (se §6b). Tabellen nedenfor (målt 30/8) er FØR denne rettelse og er ikke genmålt — den viser stadig retningen af de øvrige brud.

**Ejer-beslutning 24/8:** målene skal rammes **pr. division**, ikke kun på sæson-aggregatet, og med den **strenge** tolerance: **±2 pp**, skaleret så en division aldrig kræves at ramme finere end ±2 løbsdage. Det er tolerancen. Der er ikke andre.

> ⚠ **`TIER_COMPOSITION_TOLERANCE_PP` (7/5/8/10 pp) er afløst og skal slettes.** Den står stadig i `calendarCompositionTargets.js:138`. Den blev sat 8/8 til den største afvigelse der fandtes på daværende plan plus en buffer — altså kalibreret mod virkeligheden i stedet for mod målet. Så længe begge tal lever i filen, har den samme kalender **to domme**: `seasonCalendarGate.gatePlan` bruger de løse tal, dette dokument lover de stramme. Det er §10's modsigelse 2, og den er ikke lukket.

**Målt på live sæson 3, 30/8, mod det stramme ±2 pp** (én repræsentativ pulje pr. division; nævneren er divisionens egne etaper):

| Kategori | Mål | D1 | D2 | D3 | D4 | Sæson |
|---|--:|--:|--:|--:|--:|--:|
| flad | 24 % | 25,2 | 25,0 | **28,2** | **30,6** | **26,5** |
| kuperet | 32 % | 32,3 | 31,5 | 30,6 | **24,2** | 30,5 |
| bjerg | 28 % | 29,0 | **24,2** | 28,2 | 30,6 | 27,7 |
| enkeltstart | 10 % | 9,7 | **14,5** | **5,9** | 9,7 | 10,3 |
| brosten | 6 % | **3,9** | 4,8 | 7,1 | 4,8 | 4,9 |
| TTT | 0 % | 0 | 0 | 0 | 0 | 0 |

Fed = uden for ±2 pp. **7 brud pr. division** (D1 1 · D2 2 · D3 2 · D4 2), og **sæson-aggregatet er selv brudt på flad** (26,5 % mod loftet 26,0).

> Dokumentet skrev indtil 30/8 *"sæsonen grøn på alle seks akser, men 11 brud fordelt på alle fire divisioner"*. **Ingen af de to led er sande længere** — det er 7 brud, og sæsonen er ikke grøn. Tallet 11 stammede fra en plan-måling, ikke fra live data.

`ARCHETYPE_PROFILES`' filler-vægte er i dag kalibreret mod **sæson-aggregatet** — én global vægttabel for alle fire divisioner. Kalibrering **pr. division** er forudsætningen for at de stramme tal kan nås; se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176). **Undtagelsen er §6b's tre kategorier** (itt/brosten/high_mountain), som fik en pr.-tier-kalibrering 31/8 — se §6b nedenfor. De resterende tre K-B-kategorier (flad/kuperet/almindelig bjerg) er stadig KUN globalt kalibreret; det er #4176's åbne rest.

---

## 6b. De tre kategorier der skal ramme samme tal i ALLE divisioner

Ejer-beslutning 23/8 ([#4103](https://github.com/NicolaiDolmer/CyclingZone/issues/4103)). Ud over K-B-profilen i §6 har **tre** kategorier et mål der er **det samme i alle fire divisioner**, med samme lave tolerance. Baggrunden var målt: ITT svingede fra 1,8 % i D4 til 15,5 % i D3, og den spredning skal ikke længere accepteres som katalog-loft.

| Kategori | Mål (andel af divisionens egne løbsdage) | Tolerance | Konstant |
|---|--:|--:|---|
| enkeltstart (`itt` + `itt_hilly`) | 10 % | ±2 pp | `TIER_UNIFORM_TARGET_FRACTIONS.itt` |
| brosten (`cobbles`) | 5 % | ±2 pp | `TIER_UNIFORM_TARGET_FRACTIONS.cobbles` |
| højbjerg (`high_mountain`) | 12 % | ±2 pp | `TIER_UNIFORM_TARGET_FRACTIONS.high_mountain` |

`calendarCompositionTargets.js:279-287`, tolerancen i `TIER_UNIFORM_TOLERANCE_PP`. Nævneren er alle divisionens etaper, samme nævner som §6.

**Én ting adskiller dem stadig fra §6's profil:** de holder `high_mountain` ADSKILT fra almindelig `mountain`, hvor K-B lægger de to sammen — #4103 handler specifikt om summit-tætheden. Brosten-modsigelsen (5 % her mod K-B's tidligere 6 %) er LUKKET 31/8: ejeren valgte 5 %, og K-B's egen brosten-mål i §6 er rettet til at matche (det spørgsmål er dermed afgjort og fjernet fra §11).

**Målt på live sæson 3, 30/8:**

| | D1 (155) | D2 (124) | D3 (85) | D4 (62) |
|---|--:|--:|--:|--:|
| enkeltstart | 9,7 % | **14,5 %** | **5,9 %** | 9,7 % |
| brosten | 3,9 % | 4,8 % | **7,1 %** | 4,8 % |
| højbjerg | **7,7 %** | **5,6 %** | 10,6 % | **16,1 %** |

Fed = uden for ±2 pp. **6 brud.** Højbjerg er brudt i **tre** af fire divisioner (D1, D2, D4), og D4 er brudt i den MODSATTE retning af D1 og D2. #4103 bærer i dag et done-flag; det er ikke sandt for hverken generatoren eller live-data.

> ⚠ **Ejer-beslutning 3/9: S4 bygges UDEN `--uniform-tilt`.** Tilten er kalibreret proportionalt mod S3's live-måling, og kørt mod S4's faktiske løbsudvalg gør den planen **målt dårligere**: 5 §6b-brud i stedet for 4, og én ekstra blokerende gate. D1's højbjerg går 12,9 → 14,3 % (fra grøn til rød) og D3's ITT 13,1 → 15,5 %. Årsagen er dokumenteret i `tierUniformFillerTilt.js`s egen docstring: den er en **proportional førstetilnærmelse afledt af en ANDEN sæsons løbsudvalg**, ikke en søgning mod S4's.
>
> **Genkalibreringen pr. division er en S5-opgave.** Den er en søgning (samme metode som `scripts/calibrateCalendarComposition.js` bruger for K-B), ikke en regnestykke-rettelse, og den kan ikke nå at blive verificeret før 28/9. Det er også den opgave der skal løfte D4's `rolling`-gulv (§5) og lukke §6's resterende ±2 pp-afvigelser — de er alle sammen filler-vægte, og de kan ikke lukkes af kataloget.

> ⚠ **Tallene ovenfor er MÅLT FØR generator-koblingen** (30/8, mod den kalender S3 allerede havde). **Ejer-beslutning 31/8 (#4103, "valg A"):** S3 røres ikke — den kørende kalender står som den er, med de 6 brud ovenfor uændret. I stedet er §6b's tre mål koblet ind i `ARCHETYPE_PROFILES`' filler-vægte som en OPT-IN pr.-tier-tilt (`backend/lib/tierUniformFillerTilt.js`, `materializeTierCalendars({ useUniformTierTilt: true })`), klar til S4-genereringen. Kalibreringen er en PROPORTIONAL førstetilnærmelse afledt af tabellen ovenfor (mål ÷ målt pr. tier), ikke en fuld pipeline-søgning mod S4's (endnu ikke valgte) løbsudvalg — den bør efterprøves mod S4's faktiske katalog, samme metode som `scripts/calibrateCalendarComposition.js` bruger for K-B.

---

## 7. Etaperækkefølge i etapeløb

`stageOrderMetrics.js`, [#3326](https://github.com/NicolaiDolmer/CyclingZone/issues/3326) / [#3371](https://github.com/NicolaiDolmer/CyclingZone/issues/3371).

| Regel | Grænse |
|---|---|
| Andel etapeløb der slutter i bjerg | maks 60 % |
| Andel med bjergetape i første halvdel | min 10 % |
| Mest delte etape-sekvens | maks 8 løb |
| Distinkte sekvenser | måles pr. division |
| Åbningsetape-fordeling | måles (flad / bjerg / ITT) |

---

## 7b. Hvordan etaperne slutter (finale-bånd)

`stageFinaleMetrics.js` + `FINALE_WEIGHTS_BY_PROFILE` i `raceStageProfileGenerator.js`, [#4272](https://github.com/NicolaiDolmer/CyclingZone/issues/4272) (ejer-beslutning 26/8) / [#3426](https://github.com/NicolaiDolmer/CyclingZone/issues/3426).

Før #4272 målte kalenderen kun "slutter det for tit nedad?" — den håndhævede intet. Udfaldet var derfor drevet af generatorens vægte frem for af en regel, og `mountain` sluttede **nedad 59-70 %** i D1-D3 mod **opad 6-13 %**. Det er omvendt af virkeligheden.

"Opad" = `long_climb` + `punch` · "fladt" = `bunch_sprint` + `reduced_sprint` · "nedad" = `descent` · "udbrud" = `breakaway`.

### Bånd pr. terræntype — samme i alle fire divisioner

| Terræntype | Opad | Fladt | Nedad | Udbrud |
|---|---|---|---|---|
| `high_mountain` | 80-100 % | — | maks 15 % | — |
| `mountain` | 45-65 % | — | 20-35 % | 10-25 % |
| `hilly` | 40-60 % | 15-30 % | — | 15-30 % |
| `cobbles` | — | 30-50 % | — | 40-60 % |
| `gravel` | 15-35 % | 10-30 % | — | 45-65 % |
| `rolling` | — | 25-45 % | — | 55-75 % |
| `flat` | — | 90-100 % | — | — |
| `itt` / `itt_hilly` / `ttt` | — | — | — | 100 % `solo_tt` |

`gravel` kom til 3/9 (ejer-beslutning, #4105). Båndet er **ikke** brostens: grus afgøres oftere i udbrud og har en opad-andel brosten ikke har. Det er afledt af generatorens egne grus-vægte, ikke af en analogi.

En "—" er **ikke** "uspecificeret": klassen har vægt 0 i generatoren og gates mod 0. En bunch-sprint i højbjerget er et brud, ikke en tolereret sjældenhed. `classic` (monument-arketypen) står bevidst uden for tabellen — den rapporteres, men bånd-gates ikke.

### Samlet bånd på tværs af alle etaper

opad 25-32 % · fladt 32-40 % · nedad højst 10 % · udbrud 12-20 %.

### To gate-lag — og hvorfor

Et løbs parcours er seedet på løbets **virkelige identitet** (`external_id`), så det samme løb har det samme parcours i alle fire divisioner. En divisions finale-fordeling kan derfor ikke styres direkte: divisionen er en **stikprøve** af katalogets løb, og andelen svinger binomialt omkring generatorens vægt. Med n = 10-40 etaper pr. terræntype pr. division er standardfejlen 8-16 pp, så et råt ±0 pp-bånd ville være rødt på en *korrekt* generator omtrent hver tredje gang — samme fælde som #3469 allerede har betalt for én gang.

| Lag | Mod hvad | Tolerance |
|---|---|---|
| **Sæson-aggregatet** (alle fire divisioner) | det rå bånd | ingen |
| **Pr. division** | båndet + 2 standardfejl, kun ved n ≥ 12 | stikprøve-afhængig |

Scorecardet markerer med `✗` når en andel ligger uden for det **rå** bånd, også når stikprøve-tillægget bærer den igennem — en strukturel skævhed er dermed synlig, ikke skjult bag et grønt flueben.

### Afledt konsekvens: `descent_finale_min`

`TIER_TARGETS.descent_finale_min` (`raceRouteRealismMetrics.js`) er et **gulv** under nedkørsels-finaler og blev kalibreret 8/8 mod en generator hvor `mountain` sluttede nedad 60 % af tiden. Båndene ovenfor gør D2's gamle gulv på 10 matematisk uopnåeligt (23 `mountain` × 0,35 + 7 `high_mountain` × 0,15 = 9,1 < 10). Målt konsekvens af at lade det stå: 20 af 400 sæsoner udtømte alle 12 gen-træk. Gulvene er derfor re-deriveret til D1 8 · **D2 5** · D3 4 · **D4 3**.

> **Regel:** et gulv må aldrig kræve mere end båndet tillader. `raceRouteRealismMetrics.test.js` låser den relation.

---

## 8. Rytterbinding og trupkrav

| Regel | Værdi | Kilde |
|---|---|---|
| En rytter kan køre | 1 løb pr. **løbsdag** | [#3420](https://github.com/NicolaiDolmer/CyclingZone/issues/3420) |
| Håndhæves af | `no_rider_double_booking` (EXCLUDE, DEFERRABLE) | [#3934](https://github.com/NicolaiDolmer/CyclingZone/issues/3934) / [#4163](https://github.com/NicolaiDolmer/CyclingZone/issues/4163) |
| Startfelt pr. klasse | ProSeries/Class1/Class2 6 · WorldTour + Monumenter 7 · GT 8 | `raceAutopick.js` |
| Default-fallback | `{min:6, max:8}`, uopnåelig for ægte sæsonløb, `race_class`-CHECK'en tillader kun de 9 navngivne klasser | `raceAutopick.js` / `2026-05-09-race-pool.sql` |
| **Startgulv (deltagelse)** | **6 udtagne ryttere** — fladt, uafhængigt af feltstørrelsen | `raceAutopick.js` (`MIN_RACE_ENTRIES`) |
| Trup-loft | 30 (32 i åbent vindue) | `marketUtils.js` |

> ⚠ **Gulvet og loftet er to forskellige tal, og de sidder to forskellige steder.**
>
> **Loftet (feltstørrelsen, 6/7/8)** sidder på **Gem**. `validateSelection` afviser `riderIds.length > sizeRule.max` og manglende kaptajn — intet andet. Antal blokerer ALDRIG et gem nedad: du kan gemme 1 rytter til en Grand Tour. Ejer-beslutning 28/6 (`docs/superpowers/specs/2026-06-28-racehub-save-ux-redesign-design.md`, låst beslutning 3: "Gem accepterer delvis trup"), shippet i [#1961](https://github.com/NicolaiDolmer/CyclingZone/pull/1961). Klienten fortsatte med at håndhæve det gamle gulv fra [#1906](https://github.com/NicolaiDolmer/CyclingZone/issues/1906) ("hård fuld opstilling") en måned efter backenden havde droppet det; spillerne meldte det i [#4175](https://github.com/NicolaiDolmer/CyclingZone/issues/4175), og [#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295) fjernede det, så klienten nu spejler backendens regel præcist.
>
> **Gulvet (6) sidder på DELTAGELSEN**, ikke på Gem. Ejer-beslutning 27/8 ([#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295)): *et hold skal have mindst 6 udtagne ryttere for at stille op i et løb.* Fladt, ingen undtagelse. For ProSeries/Class1/Class2 falder gulv og feltstørrelse sammen (6); for WorldTour + Monumenter (7) og Grand Tours (8) ligger gulvet lavere, så 6 til en Grand Tour er lovligt og starter. Ejeren fik forelagt at 21 menneskehold (14 i D3, 7 i D4) har færre end 6 raske ryttere i alt og dermed ikke kan starte et eneste løb, og valgte det flade gulv alligevel.
>
> Håndhævelsen ligger i `raceRunner.loadEntrantsForRace`: et hold under gulvet ryger HELT ud af feltet — samme tilstand som et afmeldt eller ryddet hold, altså "ingen ryttere på startlisten", ikke et hold der kører med fire. Den måles KUN ved løbets start, så et igangværende etapeløb ikke mister et hold midtvejs fordi en rytter bliver skadet.
>
> **Sen redning:** ligger et hold under gulvet ved race-tid, fylder `raceRunner.fillMissingTeamEntries` op til 6 fra holdets frie ryttere (managerens egne picks og roller står; de tilføjede er hjælpere). Uden det ville det være bedre at gemme nul end at gemme tre. Redningen springer afmeldte og ryddede hold over ([#4200](https://github.com/NicolaiDolmer/CyclingZone/issues/4200)/[#4285](https://github.com/NicolaiDolmer/CyclingZone/pull/4285)) og skriver intet hvis gulvet alligevel ikke kan nås. Et løb der allerede er i gang top-fyldes aldrig (`stages_completed > 0` fryses, [#1825](https://github.com/NicolaiDolmer/CyclingZone/issues/1825)).

> ✅ **`binding_span` er et INTERVAL `[min(game_day), max(game_day)]`, og det er TILSIGTET.** Ejer-direktiv 25/8 ([#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4217)): *"På en IRL dag, må en rytter gerne køre mere end et løb. På en løbsdag må en rytter ikke køre mere end et løb"* og *"de skal altså ikke kunne deltage i noget andet undervejs"*. Er du udtaget til et etapeløb, er du bundet indtil det er slut, også på pausedage. [#4173](https://github.com/NicolaiDolmer/CyclingZone/issues/4173) gjorde 24/8 bindingen til mængden af faktiske etape-dage; det åbnede en større fejl, hvor en rytter kunne forlade et etapeløb midt i og køre et andet løb i springet. Se `backend/lib/raceBinding.js:50-52`.
>
> ⚠ **Overlap-cap × startfelt er aldrig koblet til trupstørrelserne.** Kalenderen kræver i dag op til 29 ryttere på én dag i D1; kun 21 % af alle hold kan levere det. Se [#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174).

---

## 9. Hvad der håndhæver hvad

En regel der kun findes som en konstant er ikke håndhævet. Målet er at hver regel i denne fil har en gate på **alle tre** niveauer:

| Niveau | Hvad det fanger | Hvor |
|---|---|---|
| **CI mod pakkerens output** | regressioner i generatoren | `raceCalendarLanePacker.test.js`, `calendarOverlapInvariant.test.js` |
| **Sæsonskifte-preflight** | en skæv generering før den går live | `seasonCalendarGate.js`, [#4123](https://github.com/NicolaiDolmer/CyclingZone/issues/4123) |
| **`verify-invariants` mod prod** | reparations-scripts og ad-hoc-SQL | `scripts/verify-invariants.js` |

Finale-båndene (§7b) har de to første: `stageFinaleMetrics.test.js` i CI og `calendarScorecard4218.mjs` i preflighten. Det tredje niveau (prod-invariant) mangler — se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176).

Det tredje niveau er dét der manglede da #4155 brød overlap-cap'en. Tre invarianter er på plads ([PR #4169](https://github.com/NicolaiDolmer/CyclingZone/pull/4169)):

- `calendar_overlap_within_tier_cap`
- `calendar_one_stage_per_race_per_game_day`
- `calendar_game_day_axis_not_collapsed`

> ⚠ **En invariant mod prod skal måle den kalender der står der, mod den tæthed den er BYGGET med.** `calendar_game_day_axis_not_collapsed` udledte indtil 3/9 sit K af `TIER_DENSITY` **som konstanten ser ud lige nu**. Da D4 gik fra 2 til 3 etaper om dagen for sæson 4, meldte nat-vagten derfor sæson 3's allerede skrevne og fuldstændig korrekte D4-kalender (2 etaper/dag, cap 2 → K = 1) som kollapset akse i **alle 8 puljer**. Ingen havde rørt den kalender. K udledes nu af data (etaper ÷ kalenderdage ÷ cap); konstanten er kun fallback når rækkerne ingen `scheduled_at` har. Det er samme fejlklasse som `.claude/learnings/2026-08-28-now-md-laest-som-sandhedskilde-gav-tre-forkerte-konklusioner.md`: et tal blev læst som sandhed om noget det ikke længere beskrev.

Overlap-cap'en (§8) er tættest på: niveau 1 (`calendarOverlapInvariant.test.js`, `raceCalendarLanePacker.test.js`) og niveau 3 (`calendar_overlap_within_tier_cap`) er på plads. Niveau 2 er IKKE verificeret: `detectCalendarViolations` tjekker GT-rygrad og klasse-whitelist, ikke cap'en — pakkeren får cap'en med som input, men preflighten måler den ikke bagefter. Ingen regel i denne fil er derfor bekræftet på alle tre niveauer. Se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176).

**Fjernet 31/8 ([#4465](https://github.com/NicolaiDolmer/CyclingZone/issues/4465)): `calendar_monument_exclusive_game_day`.** Den håndhævede #4075's eksklusive monument-løbsdag, som ejeren ophævede 26/8 ([#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236), se §4). Reglen forsvandt fra tabellen i §4, men gaten fulgte ikke med, og nat-vagten stod derfor rød 27/8, 28/8 og 29/8 på noget der er tilladt. Læringen er led (c) i hard rule 30: ophæver du en regel, skal SSOT, generator og gate ændres i SAMME PR — ellers vogter gaten en regel der ikke findes.

### 9a. CI-fixturens kendte tilstand

`calendar-scorecard-gate.yml` måler pakkerens output mod **et frosset prod-snapshot fra S3-æraen** (`racePoolCatalog.prod.json`). Når ejeren ændrer en regel, måler gaten den nye regel mod det gamle katalog — og resultatet er brud der er **korrekte at rapportere**, men som ikke kan lukkes af den PR der indførte reglen. Alternativet, at gøre gaten grøn ved at slække reglen, er præcis det §5b forbyder.

Fixture-gaten dømmer derfor mod en **enumereret kendt tilstand** (`KENDTE_FIXTURE_BRUD` i `calendarScorecard4218.mjs`): hvert kendt brud står navngivet med sin begrundelse og det spor der lukker det. Gaten er rød både når der kommer **ét nyt** og når et **kendt forsvinder** uden at listen følger med — en stale post er en løgn om hvad vi ved.

> **Det er kun fixture-gaten.** `buildSeasonCalendar.js --apply` er uændret hård uden override: en kalender med et af disse brud kan ikke skrives til prod. Og tabellen bliver ved med at sige at der ER brud — forskellen på "kalenderen er i orden" og "der er ikke kommet noget nyt" må aldrig skjules bag ét grønt flueben (§9b).

Og vagten kører af sig selv: `.github/workflows/calendar-invariant-audit.yml` måler kalender-invarianterne + den kritiske constraint-form (`scripts/constraint-form-audit.sql`, [#4163](https://github.com/NicolaiDolmer/CyclingZone/issues/4163)) mod prod hver nat 03:50 UTC og åbner et tracking-issue ved brud. Før det kørte `verify-invariants` kun når nogen huskede det i hånden — og begge hændelser (#4155, #4161) opstod i DATA, ikke i kode. Vagten fejler nu hårdt hvis `invariants.json` er tom eller ugyldig ([#4463](https://github.com/NicolaiDolmer/CyclingZone/issues/4463)): forskellen på "intet brud" og "intet målt" skal være synlig.

### 9b. Nat-vagten kan gå grøn uden at have målt noget

Verificeret i kørsel 33304153305 (30/8 kl. 11:28, 09:28 UTC). Kæden:

1. `verify-invariants.js` døde undervejs: `[fatal] rpc verify_race_result_duplicates: HTTP 500 - canceling statement due to statement timeout`.
2. Linjen ender på `|| true` (workflow linje 83), så bash gik videre med en **tom** `invariants.json`.
3. Parser-blokken faldt over det: `SyntaxError: Unexpected end of JSON input`.
4. Blokken er skrevet som `node ... | tee invariants.txt` (linje 86). Under `bash -e` er det **tee's** exit-kode der tæller, og tee returnerer 0. **Steppet rapporterede success.**
5. `kalender_brud` og `oevrige_brud` blev derfor aldrig skrevet til `GITHUB_OUTPUT`, så både "Open or update tracking issue" og "Fail if calendar or constraint findings" blev **skipped**.
6. Hele jobbet: **success**.

Verificeret på step-niveau for de seks seneste planlagte kørsler: 25/8 og 26/8 grønne med gaten aktiv, 27/8, 28/8 og 29/8 røde (monument-invarianten, §4), 30/8 grøn med gaten **sprunget over**.

Fixene, i rækkefølge:

| # | Fix | Hvorfor |
|---|---|---|
| 1 | `set -o pipefail` i steppet, eller skriv til fil og `cat` bagefter i stedet for at pipe til `tee` | Uden den kan intet i den blok nogensinde vælte jobbet |
| 2 | Vælt jobbet hvis `invariants.json` er tom eller mangler `checks` | En tom fil må aldrig kunne læses som "ingen brud". Samme princip som `computeCompositionStats`' `unknown`-optælling: manglende evidens må ikke ligne grønt |
| 3 | Skær `verify_race_result_duplicates` ud af nat-vagtens kørsel, eller giv den sin egen timeout | Den er allerede kendt som langsom ([#4204](https://github.com/NicolaiDolmer/CyclingZone/issues/4204): 20 minutter). En kalender-vagt må ikke kunne dø af en dublet-kontrol i et andet domæne |

> **Det er tredje gang på tre måneder at skaden kom i DATA og vagten ikke fangede den:** fraværende (#4155, 24/8), uden tilstandstjek (`2026-08-09-invariant-vagt-taerskel-uden-tilstandstjek.md`), og nu grøn på sit eget fejlsvar. **En vagt der ikke kan bevise at den har målt noget, er ikke en vagt.**

### 9c. Hvad der kan gates, og hvor det mangler

| Regel | CI mod pakkeren | Preflight | Prod-invariant |
|---|---|---|---|
| `TIER_OVERLAP_CAP` | findes | findes | findes |
| 1 etape pr. løb pr. `game_day` | findes | findes | findes |
| `game_day`-aksen ikke kollapset | findes | findes | findes |
| Rytterbinding pr. løbsdag | findes | findes | findes (DB-constraint) |
| Terræn-familie-gulve | findes (`detectCoverageViolations`) | findes | findes (`calendarScorecard4218.mjs --from-db`, ADVISORY — #4573) |
| `TIER_ONE_DAY_SHARE_MIN` | findes | findes | findes (`calendarScorecard4218.mjs --from-db`, ADVISORY — #4573) |
| Klasse-etapebånd | findes | findes | findes (`calendarScorecard4218.mjs --from-db`, ADVISORY — #4573) |
| `MAX_GT_SPAN_DAYS` = 6 | findes (R8) | mangler | **kan bygges** |
| `MAX_GT_STAGES_PER_DAY` = 4 | findes (R7) | mangler | **kan bygges** |
| To GT'er deler ikke kalenderdag | findes | mangler | **kan bygges** |
| Etapeløbs-spænd ≤ etaper + 3 | findes (`raceCalendarLanePackerInvariants.test.js:141`) | mangler | **kan bygges** |
| `TIER_DENSITY` som etaper pr. kalenderdag | mangler | mangler | **kan bygges**, group by dato |
| Løb hver kalenderdag i alle divisioner | findes (`calendarScorecard4218.mjs`, del af `grønt`/exit-koden) | findes (samme script, sæsonskifte-preflighten #4572) | findes (`--from-db`, ADVISORY — #4573) |
| Sæsonen slutter søndag | mangler | findes (`regenSeason3Calendar.mjs:197`) | **kan bygges**, `extract(dow)` |
| `GRAND_TOUR_REST_DAYS` = 2 | mangler | mangler | **kan bygges**: spænd skal være `etaper + 2`, verificeret sand for alle 3 GT'er |
| Kvote-opfyldelse, EKSAKT (§1b) | **findes** (`calendarInvariantsCiGate4123.test.js`) | **findes** (`calendarPlacementGates.detectQuotaViolations`, stopper `--apply`) | **kan bygges** |
| Monument uden for GT-spænd (§4/#4203) | **findes** (`calendarPlacementGates.test.js`) | **findes** (stopper `--apply`) | **kan bygges** — `game_day`-akse, group by løb |
| Mindste-overlap pr. division (§1/#3329) | **findes** | **findes** (stopper `--apply`) | **kan bygges** |
| Rolling-bånd, gulv + loft (§5) | **findes** | **findes** (stopper `--apply`) | **kan bygges** |
| Class1/Class2's etapebånd (§4) | findes (`computeTierCoverageStats`) | findes | **kan bygges** |
| GT-realisme skaleret pr. etape (§3) | **findes** (`raceRouteRealismMetrics.test.js`) | findes (`seasonCalendarGate`) | **kan bygges** |
| Monument-spredning i kalenderdage | delvist (`raceCalendarLanePackerInvariants.test.js:125`) | mangler | **først når løbsdags-tallet er sat** (§11's tidligere punkt 5, ejer valgte B) |
| K-B-komposition pr. division ±2 pp | findes med de LØSE tal | findes med de LØSE tal | **først når §6's modsigelse er ryddet** — vil være rød på 7 akser i dag |
| §6b's uniforme mål | mangler | mangler | **kan bygges** — vil være rød på 6 akser i dag |
| Startfelt pr. klasse, startgulv 6 | findes (ved gem/afvikling) | ikke relevant | ikke relevant |

**#4573 (2/9): `calendarScorecard4218.mjs` fik en `--from-db --season <n>`-tilstand** der læser
`races` + `race_stage_profiles` + `race_stage_schedule` for den skrevne kalender (READ-ONLY,
aldrig writes) i stedet for at måle pakkerens fixture-output. Datakilden er dét eneste der
skifter: begge tilstande pakkes til samme form og scores af `lib/calendarScorecardReport.js`
(#4270), så fixture-gaten, sæsonskifte-preflighten og nat-vagten ikke kan drifte fra
hinanden. Den kører nu hver nat i
`.github/workflows/calendar-invariant-audit.yml` (samme workflow som `verify-invariants`)
og dækker fire af ovenstående "kan bygges"-celler. Den er BEVIDST **ADVISORY**
(rapporteres i det daglige tracking-issue, vælter ikke jobbet) — samme princip som denne
fils egen §9b allerede fastslår for "øvrige invarianter": komposition/finale-målene har et
kendt kalibreringsefterslæb (§10, modsigelse 1+2 — kompositionsmålene er kalibreret mod
sæson-AGGREGATET men gates PR. DIVISION), og at vælte en daglig prod-vagt på et
kendt-usikkert mål ville gøre den rød uden at det betyder noget. Plan-interne invarianter
(GT-rygrad/whitelist/dedup/overlap-cap) måles IKKE af `--from-db` — de har allerede deres
eget prod-niveau (`calendarOverlapInvariant.js` via `verify-invariants.js`) og duplikeres
bevidst ikke af to regelsæt der kan drifte fra hinanden.

### 9d. Regler en test IKKE kan afgøre

Vær ærlig om dem. Et grønt scorecard der ikke dækker dem, lyver om hvad det har set.

| Regel | Hvorfor en test ikke kan afgøre den |
|---|---|
| **"Reglerne skal være optimale"** (#4176's eget punkt 4) | Der findes ikke et maskinlæsbart kriterium for om `TIER_OVERLAP_CAP = 3` er et godt tal. Det kan kun MÅLES mod noget andet, fx trupstørrelser ([#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174)), og så er det stadig ejeren der afgør hvad der skal give efter |
| **Dage uden afgørelse** | `daysWithoutDecisionCount` MÅLES af pakkeren, men der findes intet loft. Ved `cobbled_classic` = 7 gik D3 fra 7 til 11 sådanne dage, og det blev fundet ved at diffe før og efter, ikke af en gate. Et loft kræver en ejer-beslutning om hvor mange kedelige dage en division må have |
| **Katalog-loft vs. generator-fejl** | En rød komposition betyder enten at generatoren er skæv, eller at kataloget ikke rummer de løb der skal til (§5b). En test kan ikke skelne. Den kan derimod rapportere begge tal, og det bør den: *"D1 brosten 3,9 %, katalogets loft ved nuværende reservationer er X %"* |
| **"To regenereringer er forbudt"** (§2c) | En test kan tælle regenereringer, men kun hvis de bliver skrevet ned. Det gør de ikke i dag — se §12 |
| **Om et parcours er godt spil** | Finale-båndene (§7b) og etaperækkefølgen (§7) er gatede på fordelinger. At en konkret bjergetape er kedelig, kan ikke måles |
| **Stikprøve-støj mod ægte skævhed** | §7b's to-lags-model (rå bånd på sæsonen, bånd + 2 standardfejl pr. division ved n ≥ 12) er den rigtige form. Den kan ikke skærpes uden at blive rød på en korrekt generator, og det er ikke en mangel |

Resten af tabellerne i denne fil har endnu ikke alle tre niveauer. Se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176).

---

## 10. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | Kompositionsmålene er kalibreret mod sæson-aggregatet, men skal gælde pr. division | [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176) |
| 2 | To tolerance-systemer (±2 pp vs `TIER_COMPOSITION_TOLERANCE_PP` 7/5/8/10) — samme kalender, to domme | [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176) |
| 3 | Tre kvote-tal (140/112/84/56 vs 135/108/81/54 vs 155/124/93/62) | denne fil §1b |
| 4 | Terræn-gulvene er observerede værdier, ikke kvalitetsmål | denne fil §5 |
| 5 | Overlap-cap × startfelt overstiger 79 % af holdenes trupper | [#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174) |
| 6 | **Ni** klassifikationssystemer over samme etaper, ikke tre — `rolling` er "flad" i seks af dem og "bakke/egen familie" i tre | denne fil §5a, [#4596](https://github.com/NicolaiDolmer/CyclingZone/issues/4596) |
| 8 | Prod-invarianten håndhæver monument-eksklusivitet som ejeren ophævede 26/8 | [#4465](https://github.com/NicolaiDolmer/CyclingZone/issues/4465) |
| 9 | Seks terræn-familier, fem gulve — `rolling` har intet, `classic` hører til ingen familie | denne fil §5 |

> Modsigelse 3 er den gamle "GT-reglerne har nul slæk (6 × 4 = 21 + 3)". Den er **lukket**: slækket er 4 pladser, ikke 1, fordi ingen GT har 21 etaper (§3).
>
> Modsigelse 7 ("To brosten-mål, K-B 6 % vs #4103's 5 %") er **lukket 31/8**: ejeren valgte 5 % for begge (§6, §6b). Nummeret er ikke genbrugt til noget nyt.

---

## 11. IKKE FASTLAGT — kræver ejer-beslutning

**Gæt ALDRIG et af disse på plads.** Hver post er ÉN ting der skal afgøres, med de målte tal indlejret så beslutningen kan træffes uden at måle forfra. Bliver et af dem afgjort, flyttes det op i den paragraf det hører til, og slettes her.

**Afgjort 3/9 og flyttet op i deres paragraffer** (denne paragrafs egen regel): punkt 2 (Class1/Class2's etapebånd → §4) · punkt 3 (D4's højbjergs-overskud → §5b, lukket af tæthed + katalog) · punkt 4 (gulvet for kvote-opfyldelse → §1b, eksakt 100 %) · punkt 5 (monument-spredning → §4, forbliver kalenderdage; ny gate på løbsdags-aksen mod GT-spænd) · punkt 6 (`rolling`-gulv og `classic`s familie → §5) · punkt 7 (GT-rammen → §3: 17/17/18, og km-båndet forankret i virkeligheden i stedet for i et 21-etapers totaltal).

De to der står tilbage:

**1. Skal reglen "et etapeløb må højst spænde over etaper + 3 kalenderdage" (#3546 H) have preflight og prod-invariant?** Reglen ER gatet i CI (`raceCalendarLanePackerInvariants.test.js:141`, målt mod hele kataloget) og rapporteres af `s3CalendarPackageScorecard.js`. Men den håndhæves ikke længere af kode i pakkeren — den kommer "gratis" af kontiguiteten, og gratis er ikke garanteret på niveau 2 og 3. **Skal den bygges videre, eller er CI nok?**

**Ejer 3/9: CI er nok for S4.** Ingen nye gates nu; de to manglende niveauer står som forward-guard-opgave i §12.

**8. Skal `rolling` flyttes til bakke-siden i kaptajn-bucket'en og i GT-finalen?** De to er §5a's tungeste flad-placeringer. `raceTerrain.js:8` lader spillerens kaptajn-prioriteter læse en rolling-etape som en flad dag, og `raceStageProfileGenerator.js:633` kan lade en Grand Tour slutte på en etape der ender i udbrud 65 % af gangene. Begge modsiger familie-beslutningen 24/8. **Men et flyt er ikke gratis:** fjernes `rolling` fra `FLAT_FAMILY`, bliver `sprint_finale` infeasible i etapeløb hvis eneste flade forsyning er rolling, og GT-finalen falder tilbage på `arr.pop()` — mål det før, ikke efter. Ejerens langsigtede ønske om *"mellemrummet mellem bakke etaper og medium mountain"* er en **femte profiltype**, ikke en omkategorisering, og hører til race engine v4 sammen med durability-trækket han selv henlagde dertil. Se [#4596](https://github.com/NicolaiDolmer/CyclingZone/issues/4596).

> Det tidligere punkt 9 ("grus' finale-bånd mod grus' finale-vægte") er **afgjort 3/9**: grus fik sit eget bånd afledt af vægtene, ikke brostens (§5, §7b). Slettet herfra per denne paragrafs egen regel.

> Det gamle punkt 6 ("brosten 5 % eller 6 %?") er **afgjort 31/8**: 5 % vandt (§6, §6b). Slettet herfra per denne paragrafs egen regel.

---

## 12. Forward-guards der mangler

Hver linje er en guard der kan bygges i dag, uden en ejer-beslutning først. De står her så de ikke skal genopfindes.

| Guard | Hvor | Hvad den forhindrer |
|---|---|---|
| `set -o pipefail` + tom-JSON-check i nat-vagten | `.github/workflows/calendar-invariant-audit.yml` | At en vagt kan gå grøn på sit eget fejlsvar (§9b) |
| `calendar_generation_count` på `seasons` + guard i regen-scriptet | `seasons` + `regenSeason3Calendar.mjs` | At §2c's regel kan brydes uden at nogen kan se det |
| Prod-invariant: `count(distinct dato) = race_days_total` pr. pulje | `verify-invariants.js` | Løbsfrie dage i en division (§2) |
| Prod-invariant: GT-spænd = `etaper + GRAND_TOUR_REST_DAYS` | `verify-invariants.js` | At hviledags-reglen driver i data (§3) |
| Doc-test: hver konstant nævnt i denne fil findes med den værdi i den fil der står i tabellen | ny test i `backend/lib/` | At dette dokument igen kan blive forældet uden at nogen opdager det |
| Doc-test: hvert `Set`/`Object.freeze` i `backend/lib/` der nævner en `profile_type` står i §5a's tabel | ny test i `backend/lib/` | At en tiende `rolling`-gruppering kan opstå uden at nogen ser den (§5a) |

> **Den sidste er den vigtigste.** Årsagen til at seks tal i dette dokument var forkerte 30/8 er ikke at nogen skrev dem forkert — det er at intet fangede at koden flyttede sig bagefter. Se `.claude/learnings/2026-08-28-now-md-laest-som-sandhedskilde-gav-tre-forkerte-konklusioner.md`.

---

## 13. Sådan er tallene målt

Alle live-tal i denne fil er målt 30/8 2026 med **read-only SELECT** mod prod. Kolonnenavne slået op i `database/schema-snapshot.json` før SQL blev skrevet.

- **Kalender-form pr. division og pulje (§1c).** `races` join `seasons` (number = 3) join `league_divisions` join `race_stage_schedule`, group by tier og pulje: tæller løb, etaper, distinkte `(scheduled_at at time zone 'Europe/Copenhagen')::date` og distinkte `game_day`. Min og max pr. tier er identiske, hvilket verificerer #2276. Samme join med `having count(distinct id) > cap` pr. `game_day` gav **0 rækker**, hvilket verificerer `TIER_OVERLAP_CAP`.
- **Komposition og klasser (§6, §6b).** Én repræsentativ pulje pr. tier (`min(league_division_id)`), join `race_stage_profiles`, group by `profile_type`. **Sæson-filteret skal stå på BEGGE `races`-join**, ellers tæller man tre sæsoner.
- **Grand Tours og monumenter (§3, §4).** Samme pulje-udvalg, filtreret på `stages >= 15 or race_class = 'Monuments'`, med `max(game_day) - min(game_day) + 1` som spænd. Monument-delingen er en self-join på `game_day` inden for samme pulje.
- **Gate-tilstand (§9b).** `gh run list --workflow calendar-invariant-audit.yml --event schedule` plus `gh run view <id> --json jobs` for step-konklusioner, og `--log` for de faktiske `[FEJL]`-linjer.

---

## 14. De fejl kalenderen historisk har lavet

Fra `.claude/learnings/`. De står her fordi mønstret gentager sig, og fordi hver ny kalender møder dem igen.

| Dato | Fil | Lærdom |
|---|---|---|
| 27/6 | `2026-06-27-calendar-rebuild-recovery.md` | genopbygningen efter D3-blitzen |
| 28/6 | `2026-06-28-calendar-gameday-vs-realday-chronology.md` | `game_day` og kalenderdato blev blandet sammen første gang |
| 4/7 | `2026-07-04-race-autofill-binding-gameday-drift.md` | bindingen driftede fra den akse den skulle måle på |
| 10/7 | `2026-07-10-overlap-greying-two-truth-surfaces.md` | to flader viste hver sin sandhed om overlap |
| 20/7 | `2026-07-20-calendar-generation-path-diverged-from-render-contract.md` | generatoren og renderen holdt op med at være enige |
| 6/8 | `2026-08-06-garanti-uden-forsyning-blokerede-s3-kalenderen.md` | **en garanti uden forsyning er en blokering, ikke en garanti** — præcis §5b's fejlklasse |
| 9/8 | `2026-08-09-invariant-vagt-taerskel-uden-tilstandstjek.md` | **en vagt uden tilstandstjek måler ingenting** — samme fejlklasse som §9b, tre uger tidligere |
| 21/8 | `2026-08-21-seed-uden-prune-forgiftede-kalenderen.md` | seed uden prune efterlod løb der ikke skulle være der |
| 23/8 | `2026-08-23-invariant-vagt-alarmerede-paa-egen-finaliseringshale.md` | vagten alarmerede på sit eget arbejde |
| 24/8 | `2026-08-24-gameday-akse-dobbeltbookinger-s3.md` | #4155's `game_day = dato − startdato − 1` brød overlap-cap'en i alle fire divisioner |
| 25/8 | `2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md` | **en spillers egen prototype fandt to brudte invarianter før vores egne gates gjorde** |
| 27/8 | `2026-08-27-s3-regen-classifier-og-invariant-timing.md` | invariant-timing mod en regenerering |
| 30/8 | `2026-08-31-kalender-ssot-tre-kvotetal-og-en-vagt-der-gik-groen.md` | tre kvote-tal, en familie uden gulv, og en vagt der gik grøn på sit eget fejlsvar |

**Det gennemgående mønster, tre gange på tre måneder:** skaden kom i **data**, ikke i kode, og gaten der skulle fange den var enten fraværende (#4155), uden tilstandstjek (9/8), eller grøn på sit eget fejlsvar (30/8, §9b).
