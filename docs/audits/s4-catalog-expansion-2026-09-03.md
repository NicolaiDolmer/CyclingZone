# Sæson 4 — katalog-udvidelse, før og efter (3/9 2026)

> **Intet er skrevet.** Alle tal er fra en 100 % read-only tørkørsel: `select` mod
> `race_pool`/`league_divisions`/`teams`, resten ren funktion. Migrationerne i denne PR er
> **ikke anvendt**. Refs [#4270](https://github.com/NicolaiDolmer/CyclingZone/issues/4270),
> [#4278](https://github.com/NicolaiDolmer/CyclingZone/issues/4278),
> [#4105](https://github.com/NicolaiDolmer/CyclingZone/issues/4105),
> [#3864](https://github.com/NicolaiDolmer/CyclingZone/issues/3864),
> [#3469](https://github.com/NicolaiDolmer/CyclingZone/issues/3469).

## Hvad der blev kørt

```
cd backend && node scripts/dev/s4CatalogDryRun.mjs
```

Scriptet læser prod-kataloget, parser `database/2026-09-03-4270-s4-catalog-expansion.sql`
og kører `buildTierMaterializationPlan` to gange — én gang uden de nye løb og én gang med.
Rammen er ejer-beslutningerne 3/9: **28 løbsdatoer (man 28/9 → søn 25/10), ingen
#4103-tilt, D4 på 3 etaper pr. kalenderdag.**

`density`, `quotas` og `slots` er parametre til `buildTierMaterializationPlan`
(`tierCalendarMaterializer.js:236-244`), så D4's nye tæthed injiceres af scriptet.
Konstanten i `calendarTierCaps.js` er **ikke** rørt — den ejes af regel-sporet.

**Udgangspunktet, målt 3/9:** `race_pool` har 175 rækker, **168 aktive**. Kvoterne ved
28 dage bliver **D1 140 · D2 112 · D3 84 · D4 84** (D4 var 56 ved density 2).

---

## 1. Det første fund: D4's højbjergs-overskud er halvt løst af tætheden alene

Tørkørslen 3/9 målte D4 til **16,1 % højbjerg** mod målet 12. Det tal er målt ved
**density 2**. Ved density 3 skal D4 finde 84 etaper i stedet for 56 og må derfor
længere ned i sit vindue — `summit_tour`-blokken fortyndes af sig selv:

| D4, uden nye løb | density 2 (tørkørslen 3/9) | density 3 (denne måling) |
|---|--:|--:|
| højbjerg | 16,1 % | **11,9 %** |
| kvote-opfyldelse | 100 % (56/56) | 100 % (84/84) |
| `rolling`-etaper | 1 | 1 |
| flad | 30,6 % | 32,1 % |

Tæthedsbeslutningen løser altså #4278's hovedtal på egen hånd. Den løser **ikke**
`rolling` (stadig 1 etape i hele sæsonen) og gør flad-overskuddet værre.

---

## 2. Før → efter, pr. division

46 nye katalog-løb, 0 navnekollisioner, 0 `external_id`-kollisioner (verificeret af
scriptet mod alle 168 aktive navne). Alle fire divisioner rammer kvoten 100 % og har løb
hver eneste kalenderdag i begge udgaver.

### Blokerende realisme-fund (#3469) — alle fire lukket

| Fund | Før | Efter | Gulv |
|---|--:|--:|--:|
| D1 nedkørsels-finale-etapedage | **6** ✗ | **11** ✓ | 8 |
| D1 brosten-i-etapeløb | **0** ✗ | **1** ✓ | 1 |
| D3 nedkørsels-finale-etapedage | **2** ✗ | **5** ✓ | 4 |
| D2/D4 realisme | grøn | grøn | — |

Efter udvidelsen rapporterer scriptet **ingen** realisme-brud i nogen division.

> D3's brud på 2 < 4 stod ikke i tørkørslen 3/9, fordi den kørte D4 ved density 2 og
> derfor et andet løbsudvalg i hele kaskaden. Det er ikke et nyt problem — det er et
> problem der først bliver synligt når man måler den kalender ejeren har besluttet.

### §6 komposition (K-B, mål: flad 24 · kuperet 33 · bjerg 28 · ITT 10 · brosten 5)

| | flad | kuperet | bjerg | ITT | brosten |
|---|--:|--:|--:|--:|--:|
| **D1** før | 21,4 | 32,1 | 31,4 | 10,7 | 4,3 |
| **D1** efter | 20,7 | **33,6** | **30,0** | **10,0** | **5,0** |
| **D2** før | 25,9 | **37,5** ✗ | **20,5** ✗ | 10,7 | 5,4 |
| **D2** efter | **24,1** | 29,5 | 31,3 | 9,8 | 5,4 |
| **D3** før | 27,4 | 29,8 | 23,8 | 11,9 | 7,1 |
| **D3** efter | **25,0** | **34,5** | **25,0** | **8,3** | 7,1 |
| **D4** før | 32,1 | 32,1 | 26,2 | **6,0** | 3,6 |
| **D4** efter | 28,6 | 28,6 | **28,6** | **8,3** | **6,0** |

De to blokerende kompositionsfund fra tørkørslen — **D2 kuperet 38,4 % og D2 bjerg
20,5 %** — er lukket: kuperet falder til 29,5 og bjerg stiger til 31,3.

Alle fire divisioner er inden for den **gatede** tolerance (`TIER_COMPOSITION_TOLERANCE_PP`
7/5/8/10). Mod §6's **strenge** ±2 pp står der stadig afvigelser: D1 flad −3,3 · D2
kuperet −3,5 og bjerg +3,3 · D3 bjerg −3,0 og brosten +2,1 · D4 flad +4,6 og kuperet −4,4.
Det er §10's modsigelse 2 (to tolerance-systemer), ikke et nyt fund — og det er ikke
noget kataloget kan lukke alene, fordi de to sidste pp er et **kalibrerings**-spørgsmål
(#4176's åbne rest: filler-vægtene er kalibreret mod sæson-aggregatet, ikke pr. division).

### §6b's uniforme mål (ITT 10 · brosten 5 · højbjerg 12, ±2 pp)

| | ITT før → efter | brosten før → efter | højbjerg før → efter |
|---|---|---|---|
| D1 | 10,7 → **10,0** ✓ | 4,3 → **5,0** ✓ | 12,9 → **11,4** ✓ |
| D2 | 10,7 → **9,8** ✓ | 5,4 ✓ | **3,6 → 9,8** (−2,2, stadig uden for) |
| D3 | 11,9 → **8,3** ✓ | 7,1 ✗ (+2,1) | 10,7 → 8,3 ✗ (−3,7) |
| D4 | **6,0 → 8,3** ✓ | 3,6 → **6,0** ✓ | 11,9 → **13,1** ✓ |

**§6b går fra 5 brud til 3.** D2's højbjerg er den største enkeltforbedring (3,6 → 9,8 pp,
under mål men nu inden for rækkevidde). D3's højbjerg og brosten er de to der bliver
tilbage; begge er inden for D3's gatede tolerance.

### `rolling` (ejer-beslutning 3: gulv og loft i alle divisioner)

| | før | efter |
|---|--:|--:|
| D1 | 19 (13,6 %) | **24 (17,1 %)** |
| D2 | 10 (8,9 %) | 9 (8,0 %) |
| D3 | 7 (8,3 %) | 8 (9,5 %) |
| D4 | **1 (1,2 %)** | **6 (7,1 %)** |

Kataloget kan nu levere `rolling` i D4 — det var forudsætningen for at regel-sporet
overhovedet kan sætte et gulv. Baroudeuren gik fra én dag hele sæsonen til seks.

---

## 3. Hvorfor løbene ligger i de klasser de gør

`TIER_CLASS_WHITELIST` (`tierRaceSelection.js:39`) afgør hvilken division der kan nå et
løb, og tiers vælger 1→4 med cross-tier-dedup. Det gør klassen til det eneste præcise
styrehåndtag:

| Klasse | Kun disse divisioner | Bruges her til |
|---|---|---|
| OtherWorldTourA | **D1** (D2's whitelist udelader den) | D1's nedkørsels-finaler, D1's brosten-etapeløb, D1's flad |
| OtherWorldTourB/C | D1 + **D2** | D2's bjerg og højbjerg |
| ProSeries | D1 + D2 + **D3** | D3's bjerg — se advarslen nedenfor |
| Class1 | D3 + D4 | D4's bredde |
| Class2 | **kun D4** | D4's `rolling`, ITT og flade etapeløb |

> **Målt, ikke antaget: D3 når ALDRIG ned i Class1.** Et forsøg på at give D3 bjerg
> gennem Class1 (`mountain_tour` + `summit_tour`) ændrede D3's plan med **nul** etaper —
> D3 fylder hele sin kvote på ProSeries, som har højere prestige. D3's bjerg-underskud
> kan derfor kun løses i ProSeries, og først når udbuddet dér er stort nok til at D2
> (som vælger ProSeries FØR D3) ikke absorberer det hele. Det tog otte ProSeries-
> bjergløb: de fire første gik udelukkende til D2 og gjorde D3 **værre** (23,8 → 20,2 %),
> de fire næste tippede D3 til 25,0 %.

Samme mekanik forklarer hvorfor D1's brosten-i-etapeløb er løst **uden** at røre
reservationerne: `cobbled_tour` i OtherWorldTourA plukkes af D1's prestige-walk, mens
D1's `cobbled_tour`-reservation stadig står på 0 (#4075's begrundelse — at D1's
reservation støvsugede det ene løb D2/D3 kunne nå — er uændret gyldig).

---

## 4. Grus (#4105)

`gravel` findes nu som etapetype i motoren. Terre di Toscana flytter fra
`cobbled_classic` til `gravel_classic`, og `Strade Bianche del Nord` (OtherWorldTourA)
tilføjes så typen ikke hænger på ét enkelt løb. Målt: D1 får **1 grus-etape**.

**Brostens-regnskabet går i nul.** Terre di Toscana tager ét `cobbled_classic` med sig ud
af forsyningen; `Kasseienklassieker van Geraardsbergen` (OtherWorldTourB, samme klasse,
samme tid på året) erstatter det. D1's brosten-andel går 4,3 → 5,0 % og D2's står stille
på 5,4 %.

> ⚠ **Ét tal skal regel-sporet lukke.** Scriptet rapporterer
> `profiltyper uden kompositions-kategori: {"gravel": 1}` for D1. `PROFILE_TO_CATEGORY`,
> `computeUniformTierStats` og `TERRAIN_FAMILY_BY_PROFILE_TYPE` ligger alle tre i filer
> regel-sporet ejer, og de kender endnu ikke grus. Indtil de gør, tælles grus-etapen i
> nævneren men i ingen kategori — præcis den `unknown`-optælling
> `computeCompositionStats` blev bygget til at gøre synlig i stedet for at skjule.

---

## 5. Belgisk åbningsuge (#3864, del 1)

Mekanismen er allerede bygget: **`race_pool.date_text`** (#3469). `computeSeasonSpan` +
`seasonFraction` i `tierCalendarMaterializer.js` normaliserer løbets virkelige dato til en
sæson-position, og `packLaneCalendar` fase-ankrer endagsløb efter den. Der er derfor
**ingen grund til et nyt kuraterings-felt** — åbningsugen kurateres ved at give
brostens-blokken de rigtige datoer, sådan som virkeligheden allerede har gjort det.

Målt på kataloget i #3469: **15 af 24 brostensløb (63 %) ligger i marts-april.** De ni nye
belgiske/nordfranske løb i denne PR ligger alle i **7/2 - 5/4**, hvilket fortætter blokken
i stedet for at sprede den:

| Løb | Klasse | Divisioner | `date_text` |
|---|---|---|---|
| Grote Prijs van Aalst | Class1 | D3/D4 | 7/2 |
| Grote Prijs van Kortrijk | Class2 | D4 | 19/2 |
| Omloop van het Pajottenland | Class1 | D3/D4 | 21/2 |
| Gran Premio de Alicante | Class2 | D4 | 26/2 |
| Omloop van de Denderstreek | Class2 | D4 | 28/2 |
| Omloop van Vlaams-Brabant | ProSeries | D1/D2/D3 | 7/3 |
| Kasseienklassieker van Geraardsbergen | OtherWorldTourB | D1/D2 | 14/3 |
| Strade Bianche del Nord (grus) | OtherWorldTourA | D1 | 14/3 |
| Ronde van Antwerpen | Class2 | D4 | 25/3 - 28/3 |
| Ronde van Noord-Frankrijk | OtherWorldTourA | D1 | 31/3 - 5/4 |
| Prijs van de Beneden-Schelde | ProSeries | D1/D2/D3 | 1/4 |

Sammen med katalogets eksisterende forårsblok (De Vlaamse Ronde, Klassieker van
Harelbeke 27/3, Westkust Klassieker 29/3, Ronde van Drenthe Nieuw 15/3) giver det D1 og D2
en åbning der er brosten hele vejen igennem.

**Brosten-SEKTORVÆGTE på punch-etaper (#3864 del 2) er IKKE rørt.** Den er balance-følsom
og kræver simulering før ship — den står som S5-opgave, jf. tørkørslens punkt N.

---

## 6. Det der stadig kræver en ejer-beslutning

1. **D1's `cobbled_tour`-reservation: 1 eller 0?** Kataloget havde 2 `cobbled_tour` da
   reservationen blev sat til 0 (#4075); det har 7 i dag og 9 efter denne PR. Denne PR
   løser gaten uden reservationen (klasse-valget, §3 ovenfor), men reservationen er
   stadig et spørgsmål: **A** sæt D1 til 1 — så er brosten-i-etapeløb garanteret hvert år
   frem for at afhænge af at et OtherWorldTourA-løb bliver plukket; **B** lad den stå på 0
   og lad gaten hvile på forsyningen. **Anbefaling: A.** Grunden til 0 var knaphed, og den
   knaphed findes ikke længere; en reservation på 1 koster D2/D3 ét løb ud af ni.
2. **§6b-båndet for grus.** #4272's finale-bånd blev godkendt tal for tal, og grus fandtes
   ikke dengang. Grus er derfor rapporteret men ikke bånd-gated — samme status som
   `classic`. Skal grus have sit eget bånd, eller skal den arve brostens?
3. **`classic` og brostensevnen.** Ejer-reglen 3/9 er at brostensevnen kun tæller på
   etaper med brosten/grus. Grus opfylder den ved konstruktion (garanterede sektorer).
   `classic` gør det ikke: den bærer en lille brostens-vægt, men trækker 0-3 sektorer og
   får altså ingen i cirka en fjerdedel af tilfældene. Det er en balance-ændring at rette,
   ikke en oprydning, og den er ikke lavet her.
