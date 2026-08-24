# Løbskalenderens regler — SSOT

> **Læs denne FØR enhver opgave der rører kalenderen.** Ejer-direktiv 24/8 2026 ([#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176)):
> *"Vi skal gennemgå alle reglerne angående løbskalenderen, for at tjekke at de alle er optimale. Og vi skal sørge for at de alle gennemføres fremadrettet, sådan at jeg ikke skal lære dig dem forfra hver gang vi laver en ny kalender."*

Reglerne lå før spredt over seks filer med hver sin dato og issue-reference. Denne fil er nu kilden. Ændrer du en værdi, ændrer du den i den fil tabellen peger på — og opdaterer denne.

---

## 0. De to akser (den hyppigste fejlkilde)

| Begreb | Hvad det er | Hvor det står |
|---|---|---|
| **Kalenderdag** (`scheduled_at`) | Den virkelige dato etapen afvikles | `race_stage_schedule.scheduled_at` |
| **Løbsdag** (`game_day`) | Den IN-GAME dag der binder rytteren | `race_stage_schedule.game_day` |

**De er ikke det samme, og `game_day` kan ALDRIG udledes af `scheduled_at`.**

Pakkeren lægger flere hele løbsdage inden i hver kalenderdag — det er præcis dét der lader Division 1 afvikle 5 etaper på én dag uden at nogen løbsdag har mere end 3 samtidige løb. Målt på pakkerens eget D1-output: **75-103 løbsdage over 27-28 kalenderdage**. Kun Division 4 har én løbsdag pr. kalenderdag.

Fejlklassen har kostet to hændelser: [#4155](https://github.com/NicolaiDolmer/CyclingZone/issues/4155) skrev `game_day = dato − startdato − 1` og brød overlap-cap'en i alle fire divisioner på én gang ([#4161](https://github.com/NicolaiDolmer/CyclingZone/issues/4161)). [#4159](https://github.com/NicolaiDolmer/CyclingZone/issues/4159) foreslog at cementere den samme formel som DB-trigger.

---

## 1. Form og tæthed

| Regel | Konstant | D1 | D2 | D3 | D4 | Låst | Fil |
|---|---|---|---|---|---|---|---|
| Etaper pr. kalenderdag | `TIER_DENSITY` | 5 | 4 | 3 | 2 | ejer-låst | `calendarTierCaps.js` |
| Samtidige løb pr. **løbsdag** | `TIER_OVERLAP_CAP` | 3 | 3 | 2 | 2 | 28/6, bekræftet 24/8 | `calendarTierCaps.js` |
| Tids-slots pr. dag | `TIER_STAGE_SLOTS` | 5 | 4 | 3 | 2 | ejer-låst | `tierCalendarMaterializer.js` |
| Løbsdage i alt (kvote) | density × løbsdage | 135 | 108 | 81 | 54 | afledt | `regenSeason3Calendar.mjs` |

Antal slots = density, så en dag aldrig har flere etaper end slots.

**Ejer-bekræftelse 24/8** (#staff-chat, efter at have set før/efter-visningen): *"Ændre fra 4 overlappende løb til 3 nu. Og så i de mindre divisioner fra 3 overlap til 2 overlap igen."*

---

## 2. Sæsonens rammer

| Regel | Værdi | Låst | Kilde |
|---|---|---|---|
| Løbsdatoer pr. sæson | 27 | 23/8 | [#4131](https://github.com/NicolaiDolmer/CyclingZone/issues/4131) |
| Sæsonen slutter | altid en søndag | 23/8 | [#4131](https://github.com/NicolaiDolmer/CyclingZone/issues/4131) |
| Bufferdag efter cutover | 1 dag uden løb | 18/8 | [#3467](https://github.com/NicolaiDolmer/CyclingZone/issues/3467) |
| Puljer i samme division | deler identisk kalender-form | — | [#2276](https://github.com/NicolaiDolmer/CyclingZone/issues/2276) |

---

## 3. Grand Tours

| Regel | Konstant | Værdi | Låst | Fil |
|---|---|---|---|---|
| Hvad er en GT | `GRAND_TOUR_MIN_STAGES` | ≥ 15 etaper | — | `grandTourRestDays.js` |
| GT-etaper pr. kalenderdag | `MAX_GT_STAGES_PER_DAY` | 4 | 22/8 m. @thelamba | `raceCalendarLanePacker.js` |
| GT-spænd i kalenderdage | `MAX_GT_SPAN_DAYS` | 6 | 22/8 m. @thelamba | `raceCalendarLanePacker.js` |
| Hviledage pr. GT | `GRAND_TOUR_MAX_REST_DAYS` | 3 | 6/8 | `grandTourRestDays.js` |
| GT'er kun i | tier 1 | — | [#2251](https://github.com/NicolaiDolmer/CyclingZone/issues/2251) | `tierCalendarMaterializer.js` |
| To GT'er må ikke dele kalenderdag | real-day-separation | ≥ 1 dags mellemrum | 6/8 | [#3472](https://github.com/NicolaiDolmer/CyclingZone/issues/3472) |

Ejer-ordlyd 22/8 (aftalt med @thelamba i #feedback-and-ideas): *"Agree on no days with 5 gt stages"* + *"6 sounds like a decent max"*.

> ⚠ **Nul slæk.** 6 dage × 4 etaper = 24 pladser. En GT på 21 etaper + 3 hviledage = 24. Præcis fyldt. Enhver placering der ikke er perfekt er umulig. Skal én af de fire knapper ændres, skal de tre andre efterregnes.

---

## 4. Etapeløb og endagsløb

| Regel | Konstant | D1 | D2 | D3 | D4 | Låst | Fil |
|---|---|---|---|---|---|---|---|
| Andel endagsløb (mål) | `TIER_ONE_DAY_SHARE_TARGET` | 0,55 | 0,55 | 0,58 | 0,55 | 7/8 | `tierCalendarGuarantees.js` |
| Andel endagsløb (minimum) | `TIER_ONE_DAY_SHARE_MIN` | 0,45 | 0,45 | 0,48 | 0,45 | = mål − 0,10 | `tierCalendarGuarantees.js` |
| Etapeløb uden bjergetape | `TIER_MOUNTAIN_FREE_STAGE_RACE_MIN` | 0 | 2 | 1 | 2 | 7/8 | `tierCalendarGuarantees.js` |
| Etapeløbs-spænd | hård grænse | etaper + 3 kalenderdage | | | | 17/8 | [#3546 H](https://github.com/NicolaiDolmer/CyclingZone/issues/3546) |
| Monumenter | egen eksklusiv **løbsdag** (kalenderdatoen må deles) | | | | | 21/8 | [#4075](https://github.com/NicolaiDolmer/CyclingZone/issues/4075) |

**Monument-reglen, præcist.** Et monument har sin egen `game_day`: ingen modløb i puljen den løbsdag, så hver eneste rytter kan stille op. Den deler derimod gerne `scheduled_at`-DATO med andre løb — de ligger blot i datoens øvrige tidsslots. Pakkeren har bygget reglen ind siden 21/8 (`raceCalendarLanePacker.js`, B2). Den blev alligevel brudt i live S3: [#4161](https://github.com/NicolaiDolmer/CyclingZone/issues/4161)-akse-reparationen udledte `game_day` af datoerne alene, kendte ikke reglen, og klappede alle fem D1-monumenter sammen med deres naboløb. Derfor er reglen nu håndhævet på alle tre niveauer (§9), ikke kun i generatoren.

> **Andelen måles på ANTAL LØB, ikke på løbsdage.** Det er et bevidst valg (#3327) og står i kodens overskrift. Målt på løbsdage ville D1 være 14 % — målt på løb er den 61 %.

**Hvorfor tallene er som de er.** Ejer-beslutning 7/8, ordret: *"Der mangler nogle endagsløb i 1. division. Der er for mange i 3. division. 2. division kan godt holde til et par stykker mere. Mere ensartet balance."* → D1 0,48 → 0,55 · D2 0,50 → 0,55 · D3 0,76 → 0,58 · D4 uændret niveau, nu samme tal som de øvrige.

**Hvad reglen findes for at undgå** (#3327, 4/8): *"Division 2's kalender var 33 % endagsløb og brostens-specialister havde reelt 2 etaper/pulje/sæson at bruge — ubalanceret dækning pr. terræn-familie og for lidt mix."* Altså: **specialister uden noget at køre.**

### Klasse ↔ etapeantal

| Klasse | Etaper | Låst |
|---|---|---|
| ProSeries | 3-5 | 4/8 ([#3328](https://github.com/NicolaiDolmer/CyclingZone/issues/3328)) |
| OtherWorldTour A / B / C | 6-8 | 4/8 |
| GrandTour / TourFrance / GiroVuelta / Monuments / Class1 / Class2 | upåvirkede | GT'ens 21 er ejer-bekræftet |

---

## 5. Terræn-dækning

### Etapetype → terræn-familie

| `profile_type` | Familie | Klatrevægt | Punch |
|---|---|---|---|
| `flat` | flat_sprint | — | — |
| `rolling` | flat_sprint | 0,04 | 0,12 |
| `hilly` | hilly | 0,06 | 0,44 |
| `classic` | hilly | 0,12 | 0,16 |
| `cobbles` | cobbles | — | 0,06 (brosten 0,66) |
| `itt`, `ttt` | itt | — | — |
| `itt_hilly` | itt | 0,18 | — |
| `mountain`, `high_mountain` | mountain | 0,50 | 0,04 |

> ⚠ **`rolling`, `classic` og `itt_hilly` hørte indtil 24/8 til INGEN familie** og var dermed usynlige for alle dækningsgarantier — 21 af Division 1's 140 etaper (15 %). `itt_hilly` er en enkeltstart der ikke talte som enkeltstart. Mappingen ovenfor er den korrigerede; se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176).
>
> `classic` produceres kun af arketypen `hilly_classic`. Brostensklassikere bruger `cobbles` (brosten-vægt 0,66) og tælles korrekt. **Skulle en brosten-variant nogensinde få `profile_type='classic'`, ryger den ud af tællingen i stilhed** — derfor bør klassifikationen på sigt bygge på `terrain_archetype`, ikke på `profile_type`.

### Gulve (minimum antal ETAPER pr. pulje pr. sæson)

| Familie | D1 | D2 | D3 | D4 |
|---|---|---|---|---|
| cobbles | 3 | 6 | 5 | 1 |
| flat_sprint | 20 | 15 | 12 | 8 |
| itt | 5 | 4 | 3 | 1 |
| hilly | 10 | 8 | 8 | 6 |
| mountain | 28 | 20 | 12 | 13 |

`TIER_TERRAIN_FAMILY_MIN` i `tierCalendarGuarantees.js`.

> ⚠ **Gulvene er regressionsværn, ikke kvalitetsmål.** De blev sat *"et godt stykke under nuværende observerede niveau (prod, sæson 2, 4/8)"* — altså efter hvad kalenderen tilfældigvis leverede, ikke efter hvad der er godt spil. Undtagelser: D2 cobbles hævet 2 → 6 (ejer-ask 4/8) og mountain-gulvene empirisk kalibreret mod katalogets loft (#3469, 7/8).
>
> **Det er mekanismen bag at de samme problemer gentager sig:** kalenderen har gulve der forhindrer den i at blive værre, men ingen mål der gør den bedre. Ejer-beslutning 24/8: kompositionsmålene (§6) skal gælde pr. division med stram tolerance — det er dét der skal løfte niveauet, ikke gulvene.

### Arketype-reservationer

Gulvene *måler* efter selection. Reservationerne *sikrer* før: `summit_tour` (summit-finaler), `cobbled_tour` (brosten i etapeløb), `itt_classic` (fritstående enkeltstart), `hilly_tour` (etapeløb uden bjerg). `TIER_ARCHETYPE_RESERVATIONS`, #3295.

---

## 6. Komposition (terræn-fordeling)

| Kategori | Mål |
|---|---|
| flad | 24 % |
| kuperet | 32 % |
| bjerg | 28 % |
| enkeltstart | 10 % |
| brosten | 6 % |
| TTT | 0 % (motoren scorer den ikke endnu) |

`ACTIVE_TARGET` i `calendarCompositionTargets.js`, ejer-beslutning 6/8 ([#3295](https://github.com/NicolaiDolmer/CyclingZone/issues/3295)).

**Ejer-beslutning 24/8:** målene skal rammes **pr. division**, ikke kun på sæson-aggregatet, og med den **strenge** tolerance (±2 pp, skaleret så en division aldrig kræves at ramme finere end ±2 løbsdage).

> Det er en ændring af hvordan systemet er bygget. `ARCHETYPE_PROFILES`' filler-vægte er i dag kalibreret mod **sæson-aggregatet** — én global vægttabel for alle divisioner. Derfor rammer sæsonen i alt alle mål, mens hver enkelt division afviger. Målt på live sæson 3: sæsonen grøn på alle seks akser, men **11 brud fordelt på alle fire divisioner**. Kalibrering pr. division er forudsætningen; se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176).
>
> `TIER_COMPOSITION_TOLERANCE_PP` (7/5/8/10) var det løse sikkerhedsnet fra 8/8, sat så daværende plan bestod uden flag. Den er **afløst** af beslutningen 24/8 og skal fjernes, så der kun er ét tolerance-tal.

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

## 8. Rytterbinding og trupkrav

| Regel | Værdi | Kilde |
|---|---|---|
| En rytter kan køre | 1 løb pr. **løbsdag** | [#3420](https://github.com/NicolaiDolmer/CyclingZone/issues/3420) |
| Håndhæves af | `no_rider_double_booking` (EXCLUDE, DEFERRABLE) | [#3934](https://github.com/NicolaiDolmer/CyclingZone/issues/3934) / [#4163](https://github.com/NicolaiDolmer/CyclingZone/issues/4163) |
| Startfelt pr. klasse | ProSeries/Class1/Class2 6 · WorldTour + Monumenter 7 · GT 8 | `raceAutopick.js` |
| Trup-loft | 30 (32 i åbent vindue) | `marketUtils.js` |

> ⚠ **`binding_span` er et INTERVAL `[min(game_day), max(game_day)]`, ikke en mængde.** Et etapeløb med en pause binder rytteren på pausedagene. Tour des Émirats (7 etaper over 6 løbsdage) låser 7 andre løb. Se [#4173](https://github.com/NicolaiDolmer/CyclingZone/issues/4173).
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

Det tredje niveau er dét der manglede da #4155 brød overlap-cap'en. Tre invarianter er på plads ([PR #4169](https://github.com/NicolaiDolmer/CyclingZone/pull/4169)):

- `calendar_overlap_within_tier_cap`
- `calendar_one_stage_per_race_per_game_day`
- `calendar_game_day_axis_not_collapsed`
- `calendar_monument_exclusive_game_day` ([#4075](https://github.com/NicolaiDolmer/CyclingZone/issues/4075), tilføjet 24/8)

Monument-reglen er den første der har alle tre niveauer samtidigt:

| Niveau | Hvor |
|---|---|
| CI mod pakkerens output | `calendarGameDayRepair.test.js`, `calendarOverlapInvariant.test.js`, `tierCalendarMaterializer.test.js` |
| Sæsonskifte-preflight | `detectCalendarViolations` (invariant 6) → `seasonCalendarGate.gatePlan` |
| `verify-invariants` mod prod | `calendar_monument_exclusive_game_day` |

Og vagten kører nu af sig selv: `.github/workflows/calendar-invariant-audit.yml` måler kalender-invarianterne + den kritiske constraint-form (`scripts/constraint-form-audit.sql`, [#4163](https://github.com/NicolaiDolmer/CyclingZone/issues/4163)) mod prod hver nat 03:50 UTC og åbner et tracking-issue ved brud. Før det kørte `verify-invariants` kun når nogen huskede det i hånden — og begge hændelser (#4155, #4161) opstod i DATA, ikke i kode.

Resten af tabellerne i denne fil har endnu ikke alle tre. Se [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176).

---

## 10. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | Kompositionsmålene er kalibreret mod sæson-aggregatet, men skal gælde pr. division | [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176) |
| 2 | To tolerance-systemer (±2 pp vs 7/5/8/10) — samme kalender, to domme | [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176) |
| 3 | GT-reglerne har nul slæk (6 × 4 = 21 + 3) | denne fil §3 |
| 4 | Terræn-gulvene er observerede værdier, ikke kvalitetsmål | denne fil §5 |
| 5 | Overlap-cap × startfelt overstiger 79 % af holdenes trupper | [#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174) |
| 6 | `binding_span` binder på interval frem for på faktiske løbsdage | [#4173](https://github.com/NicolaiDolmer/CyclingZone/issues/4173) |
| 7 | Tre klassifikationssystemer over samme etaper (`profile_type`, terræn-familie, kompositions-kategori) | denne fil §5 |
