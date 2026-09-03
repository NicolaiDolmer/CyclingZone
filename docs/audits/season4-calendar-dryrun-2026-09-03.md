# Sæson 4 - kalender-tørkørsel og ejerens beslutningsliste (3/9 2026)

> **Intet er skrevet.** Alle tal nedenfor kommer fra en 100 % read-only tørkørsel mod prod.
> Sæson 4 findes stadig ikke i `seasons`, og der er ikke oprettet ét eneste løb.
> Refs [#4270](https://github.com/NicolaiDolmer/CyclingZone/issues/4270),
> [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176),
> [#4215](https://github.com/NicolaiDolmer/CyclingZone/issues/4215),
> [#4557](https://github.com/NicolaiDolmer/CyclingZone/issues/4557).

## Hvad der blev kørt

```
node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt
node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 35 --uniform-tilt
node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28
```

Ingen af dem har `--apply`. Scriptet læser `race_pool`, `league_divisions`, `teams` og
`seasons`, planlægger kalenderen i hukommelsen og scorer den mod `docs/CALENDAR_RULES.md`.

**Udgangspunktet, målt 3/9:** `seasons` har number 0-3. S3 er `active` 28/8 → 27/9 med
`race_days_total = 31`. Der findes **ingen række for sæson 4**, og derfor springer
årsmødets mandat-generering (`proposeNextMandate` → `target_season_not_found`) i dag
**alle hold over**. `race_pool` har 175 rækker, hvoraf **168 er aktive** (7 er `retired_at`-pensioneret).

---

## 1. Sæsonvinduet (§2) - 31 dage er ikke muligt for S4

§2 er to låste regler, ikke ét tal: **sæsonen slutter altid en søndag** (ejer-låst 23/8,
[#4131](https://github.com/NicolaiDolmer/CyclingZone/issues/4131)) og **antal løbsdatoer =
slutdato − startdato + 1**. S3's 31 dage er dét de to regler gav for en FREDAGS-start
(28/8 → søn 27/9). Første S4-løbsdag er **mandag 28/9** (S3 slutter søndag 27/9), og en
mandags-start kan kun have længder der er hele uger:

| Længde | Sidste løbsdag | Kan kalenderen fyldes? |
|--:|---|---|
| 21 | søn 18/10 | ikke målt (kortere end nogen tidligere sæson) |
| **28** | **søn 25/10** | **ja - alle fire divisioner har løb hver dag** |
| 35 | søn 1/11 | **nej** - D3 mangler 55 løbsdage af kvoten og har 18 kalenderdage uden løb |
| 42 | søn 8/11 | nej (værre end 35) |

**31 er umuligt.** Mandag + 30 dage = onsdag 28/10. Scriptet afviser det nu med en fejl i
stedet for at afrunde: `resolveSeasonWindow` kaster og printer de lovlige længder.

**Målt på 35 dage** (kommandoen ovenfor): D3 leverer 50 af 105 løbsdage og har 18 tomme
kalenderdage - det er §2's ejer-regel "jeg vil ikke have dage uden løb" brudt i en hel
division. Årsagen er den samme forsyningsgrænse som §5b beskriver: kaskaden sulter nedad,
og kataloget rummer ikke nok Class1/ProSeries-løb til at fylde 35 dage i alle fire divisioner.

> **Anbefaling: 28 dage (28/9 → søn 25/10).** Det er den eneste af de fire lovlige længder
> der er målt grøn på dækning, og den ligger tættest på S3's 31. Prisen er tre løbsdatoer
> mindre end S3 og dermed ~13 % færre etaper pr. division.

---

## 2. Scorecard pr. division (28 dage, `--uniform-tilt`)

Kvoten er density × løbsdatoer (§1b's gyldige af de tre kvote-tal): **D1 140 · D2 112 ·
D3 84 · D4 56**. Alle fire divisioner rammer den præcist.

| | Løb | Etaper | Løbsdage | Kalenderdage | Kvote |
|---|--:|--:|--:|--:|---|
| D1 | 33 | 140 | 79 | 28/28 | 140/140 |
| D2 | 42 | 112 | 58 | 28/28 | 112/112 |
| D3 | 34 | 84 | 56 | 28/28 | 84/84 |
| D4 | 27 | 56 | 28 | 28/28 | 56/56 |

### Regel for regel

| Regel | D1 | D2 | D3 | D4 |
|---|---|---|---|---|
| §1 overlap-cap (3/3/2/2) | 🟢 maks 3 | 🟢 maks 3 | 🟢 maks 2 | 🟢 maks 2 |
| §1b kvote-opfyldelse | 🟢 100 % | 🟢 100 % | 🟢 100 % | 🟢 100 % |
| §2 løb hver kalenderdag | 🟢 28/28 | 🟢 28/28 | 🟢 28/28 | 🟢 28/28 |
| §3 GT + plan-invarianter | 🟢 0 brud | 🟢 0 brud | 🟢 0 brud | 🟢 0 brud |
| §4 endagsløbs-andel | 🟢 60,6 % (min 45) | 🟢 59,5 % (min 45) | 🟢 58,8 % (min 48) | 🟢 63,0 % (min 45) |
| §5 terræn-gulve | 🟢 alle | 🟢 alle (cobbles præcis 6/6) | 🟢 alle | 🟢 alle |
| §6 K-B, gated tolerance | 🟢 | 🔴 kuperet +5,4 · bjerg −7,5 | 🟢 | 🟢 |
| §6 K-B, §6's **strenge** ±2 pp | 🔴 flad −3,3 · bjerg +5,6 | 🔴 kuperet +5,4 · bjerg −7,5 | 🔴 kuperet −5,6 · bjerg −3,0 · ITT +5,5 | 🔴 kuperet −6,2 · bjerg +4,1 |
| §6b uniforme mål (±2 pp) | 🔴 højbjerg 14,3 (mål 12) | 🔴 højbjerg 6,3 | 🔴 ITT 15,5 · brosten 7,1 | 🔴 højbjerg 16,1 |
| §7 etapeløb der slutter på bjerg (maks 60 %) | 🟢 38,5 % | 🟢 17,6 % | 🟢 50,0 % | 🟢 10,0 % |
| §7b finale-bånd pr. division | 🟢 (5 rå-bånds-afvigelser bæres af stikprøve-tillægget) | 🟢 (4) | 🟢 (6) | 🟢 (11) |

**Sæson-aggregatet, komposition:** flad 24,0 · kuperet 31,9 · bjerg 27,8 · ITT 11,0 ·
brosten 5,4 · TTT 0 - alle inden for tolerancen mod K-B (§6).

**Sæson-aggregatet, finale-bånd:** 🔴 ét brud - `hilly` slutter fladt 30,1 % mod båndet
15-30 % (n=83). Det er et grænsetilfælde på 0,1 pp.

### Fire blokerende fund (28 dage, med tilt)

Scriptet nægter at gå videre på dem. De skal lukkes før S4 kan bygges:

1. **D2 kuperet 38,4 % mod mål 33 %** (tolerance ±5) - for meget kuperet.
2. **D2 bjerg 20,5 % mod mål 28 %** (tolerance ±5) - for lidt bjerg.
3. **D1 brosten-i-etapeløb 0 < 1** (realisme-båndet, #3469). D1 vælger ingen `cobbled_tour`;
   kataloget har 7, men D1's reservation står bevidst på 0 (§5, #4075).
4. **D1 nedkørsels-finale-etapedage 6 < 8** (realisme-gulvet, #3469).

---

## 3. Tilten (#4103) gør det MÅLT ringere for S4

`--uniform-tilt` er §6b's pr.-division filler-tilt, kalibreret proportionalt mod den
**live S3-måling fra 30/8**. Kørt mod S4's faktiske løbsudvalg gør den planen **dårligere**:

| | Med `--uniform-tilt` | Uden |
|---|--:|--:|
| §6b-brud i alt | **5** | **4** |
| Blokerende gates | **4** | **3** |
| D1 højbjerg | 14,3 % 🔴 | 12,9 % 🟢 |
| D2 højbjerg | 6,3 % 🔴 | 3,6 % 🔴 |
| D3 ITT | 15,5 % 🔴 | 13,1 % 🔴 |
| D4 højbjerg | 16,1 % 🔴 | 16,1 % 🔴 |

Tilten hjælper D2 (3,6 → 6,3 %) og skader D1 (12,9 → 14,3 %) og D3 (13,1 → 15,5 % ITT).
Det er præcis den risiko `tierUniformFillerTilt.js` selv beskriver i sin docstring: den er
en **proportional førstetilnærmelse afledt af en ANDEN sæsons løbsudvalg**, ikke en søgning
mod S4's. S4's udvalg ligner ikke S3's - fx havde D3 5,9 % ITT i S3, men planen for S4
starter på 13,1 % uden tilt, så en opjustering på 10/5,9 skyder forbi.

> **Dette er den vigtigste enkeltmåling i rapporten:** at slå tilten til uden at
> genkalibrere den mod S4 er ikke neutralt - det koster ét ekstra brud og én ekstra
> blokerende gate.

---

## 4. Katalog-lofterne (§5b) - hvad kalibrering ALDRIG kan lukke

Målt read-only mod `race_pool` 3/9 (168 aktive rækker):

| | Antal | Konsekvens for S4 |
|---|--:|---|
| Grand Tour-kandidater (≥15 etaper) | **3** (17, 18, 17 etaper) | Ingen GT har 21 etaper. GT-realisme-båndet kræver 21 og måler dem derfor **slet ikke** (#4288) |
| Brosten-løb i alt | 24 (17 `cobbled_classic` + 7 `cobbled_tour`) | D1's brosten-andel er 4,3 % mod §6b's 5 % |
| `cobbled_tour` D1 kan vælge | 7 i kataloget, D1's reservation = 0 | Blokerende realisme-brud "brosten-i-etapeløb 0 < 1" |
| D4's klasse-vindue (Class1+Class2) | 54 løb, heraf **19 etapeløb** | `hilly_tour` 7 · `summit_tour` 6 · `cobbled_tour` 2 · `balanced_week` 2 · `sprinters_week` 1 · `mountain_tour` 1 |
| D4 højbjerg | 16,1 % mod målet 12 % | D4 skal bruge ~10-12 af de 19 etapeløb og kan ikke undgå `summit_tour`-blokken (#4278) |

§5b's regel er uændret: **et katalog-loft må aldrig lukkes ved at slække et mål eller ved
at regenerere** (§2c: én regenerering pr. sæson). Det lukkes ved at tilføje løb til
`race_pool` FØR sæsonen bygges, eller ved at ejeren beslutter at målet ikke gælder den division.

---

## 5. Beslutningsliste

Hver post: hvad det betyder for S4 i klar tekst · anbefaling · hvad der sker hvis du
ikke vælger. **Ingen af dem er gættet på plads.**

### A. Sæsonens længde (§2, nyt punkt fra denne tørkørsel)

- **Hvad det betyder:** S4 kan være 21, 28, 35 eller 42 dage. 35 og 42 er målt umulige
  (D3 får 18 tomme dage). 31 findes ikke som mulighed for en mandags-start.
- **A: 28 dage (28/9 → søn 25/10).** **B: 35 dage og udvid kataloget først.**
- **Anbefaling: A.** B kræver nye Class1/ProSeries-løb i kataloget før den kan måles grøn,
  og der er 25 dage til start.
- **Vælger du ikke:** scriptet nægter at køre `--apply` uden et eksplicit `--race-days`.
  Ingen kalender bliver bygget.

### B. Skal §6b-tilten være tændt? (#4103)

- **Hvad det betyder:** tilten er kalibreret mod S3 og gør S4's plan målt dårligere (afsnit 3).
- **A: byg S4 UDEN tilten** og lad §6b's mål stå som måling til S5.
  **B: genkalibrér tilten mod S4's eget udvalg først** (samme metode som `calibrateCalendarComposition.js`).
- **Anbefaling: A nu, B som opgave til S5.** Genkalibrering er en søgning, ikke en
  regnestykke-rettelse, og den kan ikke nå at blive verificeret før 28/9.
- **Vælger du ikke:** `--uniform-tilt` er FRA som default, så S4 bygges uden. Det er også
  det målt bedste af de to - men det er stadig et valg der bør træffes bevidst.

### C. §11 punkt 1 - skal "etapeløb højst etaper + 3 kalenderdage" have preflight + prod-invariant?

- **Hvad det betyder:** reglen er gatet i CI, men ikke ved selve genereringen eller mod prod.
  Den kommer i dag "gratis" af at et løbs etaper ligger på løbsdage i træk.
- **A: byg de to manglende gates.** **B: CI er nok.**
- **Anbefaling: B for S4, A som forward-guard bagefter.** Ingen af S4-tørkørslens fire
  divisioner bryder den, så den blokerer ikke sæsonen.
- **Vælger du ikke:** ingenting sker; reglen forbliver ugated på to af tre niveauer.

### D. §11 punkt 2 - skal `Class1`/`Class2` have et etapebånd?

- **Hvad det betyder:** D4 kører etapeløb helt ned til 2 etaper. Ingen ved om det er en
  tilsigtet format-variation eller et hul.
- **A: sæt et bånd (fx 3-6).** **B: lad det stå - korte etapeløb er D4's identitet.**
- **Anbefaling: B for S4.** Et bånd nu ville skære i D4's i forvejen tynde vindue på 19
  etapeløb og gøre §5b's forsyningsproblem værre, ikke bedre.
- **Vælger du ikke:** D4 bygges som i dag, med 2-etapers etapeløb.

### E. §11 punkt 3 / #4278 - D4's højbjergs-overskud: arketype-LOFT eller flere katalog-løb?

- **Hvad det betyder:** D4 har 16,1 % højbjerg mod målet 12 %, fordi D4 trækker 5-6 af
  katalogets 6 `summit_tour`. Den laveste division er den mest bjergrige.
- **A: `TIER_ARCHETYPE_MAX` (nyt loft) for D4.** **B: flere flade/kuperede Class1/Class2-etapeløb i kataloget.**
- **Anbefaling: B.** Reservationerne er gulve, og en sænkning er målt virkningsløs (26/8):
  det grådige walk vælger stadig de 5, fordi der ikke er andet i vinduet. B løser samtidig
  D4's ITT-andel og #3864's ønske om flere klassikere.
- **Vælger du ikke:** D4 bygges 4 pp for bjergrig igen, og §6b's højbjerg-mål er rødt i
  tre divisioner i S4 som i S3.

### F. §11 punkt 4 - hvad er gulvet for kvote-opfyldelse?

- **Hvad det betyder:** kvoten (density × dage) er en øvre ramme uden gulv. I S3 leverede
  D3 91,4 %. I S4's 28-dages-plan leverer **alle fire divisioner 100 %**.
- **A: sæt gulvet til 95 %.** **B: lad kvoten være et loft uden gulv.**
- **Anbefaling: A.** Tørkørslen viser at 100 % er opnåeligt ved 28 dage, så et gulv på 95 %
  koster ingenting nu og fanger næste gang en division sulter (35-dages-kørslen ramte 48 %).
- **Vælger du ikke:** en division kan igen levere 91 % uden at nogen gate siger fra.

### G. §11 punkt 5 - monument-spredning målt i løbsdage?

- **Hvad det betyder:** CI måler spredning i KALENDERDAGE mod en fixture. Der findes intet
  ejer-sat tal på løbsdags-aksen.
- **A: lås en minimumsafstand i løbsdage (fx 10).** **B: bliv ved kalenderdage.**
- **Anbefaling: B for S4.** Spørgsmålet afgør hvad #4465 skal vende invarianten til, men
  det blokerer ikke S4.
- **Vælger du ikke:** #4465 står stille, og monument-spredningen gates fortsat kun i CI.

### H. §11 punkt 6 - skal `rolling` have et gulv, og skal `classic` høre til en familie?

- **Hvad det betyder:** baroudeurens terræn har ingen garanti. Målt i S4-planen: D1 19
  rolling-etaper, D2 10, D3 4, **D4 1**. `classic` tælles ikke mod noget gulv.
- **A: giv `rolling` et gulv pr. division og læg `classic` i `hilly`.** **B: lad begge stå.**
- **Anbefaling: A for `classic` (ren oprydning), B for `rolling`-gulvet indtil S5.**
  Et rolling-gulv i D4 ville skulle tages fra et andet terræn i en division der allerede
  er for bjergrig.
- **Vælger du ikke:** D4 har én enkelt rolling-etape hele sæsonen, og `classic`-etaperne
  er fortsat usynlige for alle dækningsgarantier (antallet i S4 er ikke målt - `classic`
  hører til ingen familie og tælles derfor ikke af scorecardet).

### I. §11 punkt 7 / #4288 - er 17-18 etaper den nye GT-ramme?

- **Hvad det betyder:** kataloget har tre GT'er på 17, 18 og 17 etaper. Realisme-båndet
  kræver 21 og springer dem derfor over: **spillets tre største løb måles slet ikke.**
- **A: skalér båndet med etapeantallet** (km-pr-etape i stedet for km i alt).
  **B: udvid GT'erne i kataloget til 21 etaper.**
- **Anbefaling: A.** B kan ikke lade sig gøre i en 28-dages sæson: 21 etaper + 2 hviledage
  = 23 løbsdage, og tre af dem skal være i samme sæson uden at overlappe.
- **Vælger du ikke:** S4's Grand Tours bygges uden at nogen gate har set på dem -
  hverken GO eller NO-GO. Det er "en vagt der er stille fordi systemet er ændret".

### J. §11 punkt 8 - skal `rolling` flyttes til bakke-siden i kaptajn-bucket og GT-finale?

- **Hvad det betyder:** en spiller der sætter kaptajnen op til en rolling-etape får den
  behandlet som en flad dag, og en Grand Tour kan slutte på en etape der ender i udbrud
  65 % af gangene.
- **A: flyt begge.** **B: mål effekten først, flyt én ad gangen efter S4.**
- **Anbefaling: B.** Fjernes `rolling` fra `FLAT_FAMILY` bliver `sprint_finale` infeasible
  i etapeløb hvis eneste flade forsyning er rolling - det skal måles før, ikke efter.
- **Vælger du ikke:** uændret adfærd i S4.

### K. #4203 - monumenterne skal ud af GT-vinduerne

- **Hvad det betyder:** i S3 lå 4 af 5 monumenter inde i et GT-vindue, og GT'erne fyldte
  70 % af D1's sæson. S4's plan er ikke målt på dette punkt - der findes ingen gate for det.
- **A: byg gaten (monument må ikke ligge i et GT's løbsdags-spænd) FØR S4 materialiseres.**
  **B: mål S4's plan i hånden og flyt bagefter.**
- **Anbefaling: A.** §2c tillader kun én regenerering, så "flyt bagefter" bruger den ene
  chance på noget der kunne være fanget før.
- **Vælger du ikke:** S4 kan gentage S3's tilstand, og reparationen koster sæsonens ene regenerering.

### L. #4209 - GT-hviledage skal binde rytteren

- **Hvad det betyder:** på en GT's hviledag er rytteren i dag fri til at køre et andet løb.
  Ejer-direktivet 24/8 siger det modsatte.
- **A: byg det (kræver #4191 først).** **B: udskyd.**
- **Anbefaling: A, men det er ikke en kalender-opgave** - det er `race_entry_days_rebuild()`
  og hører i sit eget spor. Det blokerer ikke S4's kalender.
- **Vælger du ikke:** GT-ryttere kan fortsat forlade en Grand Tour på hviledagen i S4.

### M. #4105 - Terre di Toscana skal være grus, ikke brosten

- **Hvad det betyder:** løbet er ét af katalogets 17 `cobbled_classic`. Ændres det, falder
  brostens-forsyningen med ét løb, og D1's brosten-andel (4,3 % mod 5 %) bliver lavere.
- **A: lav ændringen FØR S4 bygges, og tilføj et brostens-løb som erstatning.**
  **B: vent til efter S4** (§2c: kataloget må ikke ændres midt i en bygget sæson).
- **Anbefaling: B, medmindre erstatningsløbet kommer med.** Grus findes ikke som
  etapetype i motoren i dag, så ændringen er ikke en ren dataændring.
- **Vælger du ikke:** løbet er brosten i endnu en sæson.

### N. #3864 - belgisk åbningsuge + brosten-sektorer med reel vægt

- **Hvad det betyder:** spillerønske til S4: sæsonens første uge skal føles som
  forårsklassikere, og brosten skal veje 15-20 % på udvalgte punch-etaper.
- **A: kurater åbningsugen i S4** (selection/fase-arbejde oven på det eksisterende).
  **B: udskyd til S5.**
- **Anbefaling: B for sektor-vægtene** (balance-følsomt, kræver simulering), **A for
  åbningsugen** hvis der er tid - den er ren placering og rører ikke motoren.
- **Vælger du ikke:** S4's åbning bliver som S3's.

### O. #3329 - D1's løbsdage uden overlap

- **Hvad det betyder:** i S2 havde D1 6 af 28 løbsdage med kun ét løb. Der findes stadig
  intet MINDSTE-overlap som krav - kun et loft. S4's plan rammer loftet (maks 3 i D1),
  men bunden er umålt.
- **A: definér et mindste-overlap pr. division som data og fejl ved generering.**
  **B: lad det stå som et loft.**
- **Anbefaling: A.** Det er en enkelt måling på den plan der allerede findes, og det er
  §9's mønster: en regel der kun er en konstant er ikke håndhævet.
- **Vælger du ikke:** D1 kan igen få dage hvor der ikke er noget at vælge imellem.

---

## 6. Hvad der skal ske før `--apply`

I rækkefølge. Ingen af dem er kørt.

1. **Ejeren vælger A (længde) og B (tilt).** Uden en eksplicit `--race-days` nægter
   scriptet at apply'e.
2. **De fire blokerende gates lukkes** (D2's komposition, D1's brosten-i-etapeløb,
   D1's nedkørsels-finaler). To af dem peger på kataloget, ikke på generatoren.
3. **Sæson-rækken oprettes** (`--apply` gør det selv, status `upcoming`) - først dér
   holder årsmødet op med at springe alle hold over.
4. **Én regenerering, punktum** (§2c). Er kalenderen skrevet, er formen låst for S4.

---

# Efter ejerens beslutninger 3/9

> **Stadig 100 % read-only.** Kommandoen er
> `node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28` — `--race-days`
> behøves ikke længere: 28 er nu S4's **ejer-valgte** vindue i `SEASON_RACE_DAYS_DEFAULT`.
> Kørt mod **prods nuværende katalog**, altså UDEN katalog-sporets 46 nye løb ([#4708](https://github.com/NicolaiDolmer/CyclingZone/issues/4270)).
> Det er med vilje: det viser hvad reglerne alene kan, og hvad kataloget skal levere.

## 7. Hvad der blev besluttet, og hvor det står nu

| # | Beslutning | Hvor reglen bor |
|---|---|---|
| 1 | Sæson 4 = 28 løbsdatoer, man 28/9 → søn 25/10 | `SEASON_RACE_DAYS_DEFAULT`, CALENDAR_RULES §2 |
| 2 | Ingen `--uniform-tilt` i S4; genkalibrering er en S5-opgave | CALENDAR_RULES §6b |
| 3 | Kvoten rammes **eksakt** 100 % pr. division | `detectQuotaViolations`, §1b |
| 4 | D4 kører 3 etaper om dagen (density + slots + kvote 84) | `calendarTierCaps.js`, §1 |
| 5 | Class1/Class2 får etapebåndet 3-6 | `CLASS_STAGE_LENGTH_BAND`, §4 |
| 6 | `rolling` får gulv **og** loft; `classic` lægges i hilly | `TIER_TERRAIN_FAMILY_MIN`/`MAX`, §5 |
| 7 | GT-realismen skaleres pr. etape; tærsklen falder 21 → 15 | `raceRouteRealismMetrics.js`, §3 |
| 8 | Monument må ikke ligge i et GT's løbsdags-spænd | `detectMonumentsInsideGrandTours`, §4 |
| 9 | Mindste-overlap pr. division som data | `TIER_OVERLAP_MIN` + `TIER_MULTI_RACE_DAY_MIN_SHARE`, §1 |
| 10 | §11 pkt. 1: CI er nok for S4 · pkt. 8: mål efter S4 | §11 + §12 |
| 11 | `gravel` tæller som brosten i familie, realisme og scorecard | §5 |
| 12 | D1's `cobbled_tour`-reservation 0 → 1 (kl. 09:28) | `TIER_ARCHETYPE_RESERVATIONS`, §5 |

## 8. Scorecard pr. division mod ALLE gates, inkl. de nye

| | Løb | Etaper | Løbsdage | Kalenderdage | Kvote |
|---|--:|--:|--:|--:|---|
| D1 | 32 | 140 | 81 | 28/28 | **140/140** |
| D2 | 40 | 112 | 56 | 28/28 | **112/112** |
| D3 | 36 | 84 | 56 | 28/28 | **84/84** |
| D4 | 42 | 84 | 56 | 28/28 | **84/84** |

D4's tal er nye: 84 etaper i stedet for 56, og 56 løbsdage over 28 kalenderdage.
**D4 er ikke længere den division hvor løbsdag og kalenderdag falder sammen** — den
sætning i §0 gælder til og med sæson 3.

| Regel | D1 | D2 | D3 | D4 |
|---|---|---|---|---|
| §1 overlap-cap (loft) | 🟢 maks 3 | 🟢 maks 3 | 🟢 maks 2 | 🟢 maks 2 |
| §1 mindste-overlap **(ny)** | 🟢 50,6 % ≥ 45 | 🟢 80,4 % ≥ 55 | 🟢 50,0 % ≥ 40 | 🟢 50,0 % ≥ 40 |
| §1b kvote, **eksakt** 100 % **(ny)** | 🟢 | 🟢 | 🟢 | 🟢 |
| §2 løb hver kalenderdag | 🟢 28/28 | 🟢 28/28 | 🟢 28/28 | 🟢 28/28 |
| §3 GT + plan-invarianter | 🟢 0 brud | 🟢 | 🟢 | 🟢 |
| §4 endagsløbs-andel | 🟢 56,3 % | 🟢 55,0 % | 🟢 63,9 % | 🟢 61,9 % |
| §4 monument uden for GT-spænd **(ny)** | 🔴 **2 brud** | 🟢 | 🟢 | 🟢 |
| §5 terræn-gulve | 🟢 alle | 🟢 alle | 🟢 alle | 🟢 alle |
| §5 rolling-bånd **(ny)** | 🟢 18 i [16,30] | 🟢 11 i [6,14] | 🟢 5 i [4,12] | 🔴 **1, gulv 3** |
| §3 GT-realisme, etape-forankret **(ny)** | 🟢 alle tre GT'er (7 gen-træk) | — | — | — |
| §6 K-B, gated tolerance | 🟢 | 🔴 bjerg −7,5 | 🟢 | 🟢 |
| §6b uniforme mål (±2 pp) | 🟢 alle tre | 🔴 højbjerg 3,6 | 🔴 brosten 7,1 · højbjerg 8,3 | 🔴 ITT 6,0 · brosten 2,4 |
| §7 etapeløb der slutter på bjerg | 🟢 7,1 % | 🟢 27,8 % | 🟢 53,8 % | 🟢 18,8 % |
| §7b finale-bånd pr. division | 🟢 | 🟢 | 🟢 | 🔴 |

**Sæson-aggregatet:** flad 27,0 · kuperet 32,5 · bjerg 25,7 · ITT 9,5 · brosten 4,3 — inden
for tolerancen mod K-B. Finale-båndene på sæson-niveau er grønne.

## 9. Hvad der stadig er rødt, og hvad der skal til

**Fire ting. To lukkes af kataloget, én af pakkeren, én af en kalibrering.**

| Fund | Klasse | Hvad der skal til |
|---|---|---|
| **D1: 2 monumenter inde i et GT-spænd** | **pakkeren** | Milano–Riviera (løbsdag 9) i Giro della Penisola (0-19) og De Vlaamse Ronde (32) i Tour de l'Hexagone (28-46). Gaten fanger dem nu; at FLYTTE dem er `raceCalendarLanePacker.js`s arbejde og ligger i #4203's eget spor. Stopper `--apply`. |
| **D4: 1 rolling-etape, gulv 3** | **katalog** | Katalog-sporets måling: de nye Class2-løb tager D4 fra 1 til **6** rolling-etaper. Koden er i main, men migrationen er ikke anvendt mod prod endnu — derfor stadig rødt her. |
| **D2: bjerg 20,5 % mod 28 %** | **katalog** | Samme måling: de nye OtherWorldTourB/C-bjergløb tager D2 til 31,3 %. Eneste tilbageværende BLOKERENDE gate. |
| **D1: ét monument-nabopar under 2 kalenderdage** | **pakkeren** | §4's spredningsregel er MÅLT, aldrig håndhævet i pakkeren. Den holdt ved 31 dage og holder ikke ved 28. Samme reparation som monument-i-GT: hvor et monument lander, #4203's spor. |
| **§6b: 5 uniform-brud** | **kalibrering** | Kataloget lukker tre af dem (D1 alle tre grønne, D4 brosten 2,4 → 6,0, D2 højbjerg 3,6 → 9,8). De sidste to — D3's brosten og højbjerg — er filler-vægte og hører til S5's genkalibrering. |

### D4's kvote ved density 3 mod det NUVÆRENDE katalog

Opgaven forventede rødt her. **Det er grønt: D4 rammer 84 af 84.** Målt read-only mod
`race_pool` 3/9, D4's klasse-vindue (Class1 + Class2) efter etapebåndet [3-6]:

| | Antal | Etaper |
|---|--:|--:|
| Endagsløb | 35 | 35 |
| Etapeløb i båndet [3-6] | 17 | 61 |
| **Katalog-loft i alt** | **52** | **96** |
| Kvote | | **84** |

**Marginen er 12 etaper.** Etapebåndet koster to løb — `Tour du Périgord` og
`Giro delle Marche`, begge `hilly_tour` med 2 etaper — så `hilly_tour` går fra 7 til 5
brugbare. Pr. arketype, etaper i båndet: `summit_tour` 23 · `hilly_tour` 17 ·
`balanced_week` 8 · `cobbled_tour` 6 · `mountain_tour` 4 · `sprinters_week` 3.

> **D4 mangler ikke etaper — den mangler VARIATION.** De 84 etaper findes, men 27 af dem
> er flade (32,1 % mod målet 24) og kun 1 er rolling. Det der mangler i kataloget er
> Class2-løb der producerer `rolling` og `itt`, ikke flere løb i sig selv.

> ⚠ **93 går ikke.** Ved 31 løbsdatoer ville D4's kvote være 93 mod loftet 96, og planen
> kunne ikke fyldes: målt 80 af 93 med tomme kalenderdage. **D4's tæthed 3 fungerer kun
> fordi sæsonen er 28 dage.** Bliver en fremtidig sæson længere, skal D4's klasse-vindue
> udvides FØRST — eller tætheden ned igen.

## 10. Grand Tours: målt for første gang, mod et bånd forankret i virkeligheden

Realisme-båndet krævede 21 etaper og sprang derfor alle tre GT'er over. To ejer-beslutninger
3/9 rettede begge halvdele: tærsklen er nu spillets egen (15), og km-siden er erstattet af
fire grænser der kan genkendes fra en rigtig grand tour-rute — samlet snit inkl.
enkeltstart, landevejsetapernes snit, prologens minimum og enkeltstartens minimum (§3).

**Målt mod prod 3/9 efter omlægningen — alle tre grønne:**

| Løb | Etaper | I alt | Samlet snit | Landevejssnit | Prolog | Rigtige ITT'er | Dom |
|---|--:|--:|--:|--:|--:|--:|---|
| Giro della Penisola | 18 | 2.954 km | 164,1 | 172,1 (17 etaper) | ingen | 1 | 🟢 |
| Tour de l'Hexagone | 17 | 2.679 km | 157,6 | 176,3 (15 etaper) | 8 km | 1 | 🟢 |
| Vuelta Ibérica | 17 | 2.649 km | 155,8 | 173,3 (15 etaper) | 23 km | 1 | 🟢 |

> ⚠ **Grønt, men dyrt: D1 brugte 7 gen-træk af 12** (`realisme-gen-træk 7`). Båndet er
> opnåeligt og stramt på samme tid. Et tidligere træk gav Vuelta Ibérica 151,4 km i samlet
> snit og Tour de l'Hexagone 153,0 — begge under gulvet — og det er præcis de tal båndet nu
> fanger, i stedet for at lade dem passere usynligt. **Bliver gen-trækkene ved med at ligge
> over 8, er det forsyningen der skal ses på, ikke båndet.** Den nuværende plan er ikke en
> tilfældighed, men den har ikke meget luft.

**Etapeantallene rettes i kataloget, ikke i reglen** (ejer 3/9, valg A). Rammen er
**Giro 17 · Vuelta 17 · Tour 18**; `race_pool` har i dag Giro 18 · Vuelta 17 · Tour 17.
Samme sum, men den ekstra etape sidder på Giroen. Datamigrationen ligger i katalog-sporet.
Regel-siden her forventer 17/17/18, og fordi målingen er etape-baseret, måler den både 17
og 18 uden ændring — rettelsen kan derfor lande i sit eget tempo uden at gøre gaten tavs.

## 10b. Grus fik sit eget finale-bånd, ikke brostens

Første udkast gav `gravel` brostens-bånd ("næsten samme type"). **Det holdt ikke ved
måling.** Generatorens grus-vægte er ikke brostens-vægte: grus afgøres langt oftere i
udbrud end en brostensklassiker, og har en opad-andel brosten slet ikke har. Et
brostens-bånd ville have været en garanti generatorens egne vægte ikke kunne nå — altså en
blokering frem for en vagt, samme fejlklasse som
`.claude/learnings/2026-08-06-garanti-uden-forsyning-blokerede-s3-kalenderen.md`.

Ejeren valgte 3/9 at grus får sit **eget** bånd, afledt af vægtene (§7b). Det lukker
CALENDAR_RULES §11 punkt 9, og `stageFinaleMetrics.test.js` fælder vægte og bånd hvis de
driver fra hinanden.

## 11. Hvad der skal ske før `--apply` (opdateret)

1. **Katalog-sporets migration anvendt mod prod.** Koden er i main, men de 46 nye løb er
   endnu ikke i `race_pool` — dry-runnet ovenfor kører derfor stadig mod det gamle katalog.
   Det lukker D2's blokerende komposition og D4's rolling-gulv.
2. **GT-etapeantallene rettet til 17/17/18** i kataloget (ejer-valg A, eget spor).
3. **#4203's pakker-ændring**, eller ejerens accept af at 2 monumenter ligger i et
   GT-vindue. Gaten stopper `--apply` uden override.
4. Sæson-rækken oprettes af `--apply` selv, status `upcoming`.
5. **Én regenerering, punktum** (§2c).
