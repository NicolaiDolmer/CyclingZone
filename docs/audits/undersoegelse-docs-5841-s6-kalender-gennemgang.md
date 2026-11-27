# Undersøgelse #5841: S6-kalenderen, gennemgang til ejerens godkendelse (26/11)

Undersøgelsesspor (kind: investigate, #5220). Intet er skrevet til prod, og ingen kode er ændret. Alle tal er fra en offline tørkørsel mod den committede katalog-fil.

## Kort sagt

Den nuværende generator kan **ikke** lave en S6-kalender, der går gennem kalender-gaten, i det foreløbige vindue (mandag 30/11 til lørdag 26/12, 27 løbsdatoer) med 140 løbsdage. I Division 1 lægger den 4 af 5 monumenter inde i en Grand Tour. Så kan GT-rytterne ikke køre monumenterne. Gaten stopper derfor `--apply`. Fejlen kom igen i 7 af 7 forsøg med forskellige frø. Den skyldes altså strukturen, ikke uheld.

Der er også en tavs fejl: S6 har intet løbsdagsmål i koden. Uden flaget `--race-day-target 140` får divisionerne 80, 54, 54 og 55 løbsdage. Gaten melder ikke fejl, fordi der ikke er sat noget mål.

## Hvad jeg kørte

| Kørsel | Resultat |
|---|---|
| `node scripts/dev/calendarGoldenDiff.mjs` | exit 0. Den er identisk med S3-referencen og har ingen hårde brud. Den måler S3-referencen, ikke S6, så den siger intet om S6-kandidaten. |
| `seasonCalendarGatesOffline.mjs --season 6 --first-day 2026-11-30 --last-day 2026-12-26` (intet mål) | exit 1. Løbsdage: D1 80 · D2 54 · D3 54 · D4 55, men gaten skriver "intet mål sat". 4 hårde brud (monumenter). |
| samme med `--race-day-target 140` | exit 1. Løbsdage 140 i alle fire divisioner. 4 hårde brud (monumenter). S5-benchmark-gaten er grøn. |
| samme med `--race-day-target 135` (27 × 5) | exit 1, med de samme 4 hårde brud. |
| frø 2-7 med mål 140 | Alle røde: 4, 5, 4, 4, 4 og 4 hårde brud. |
| S5-vinduet (28/10 til 28/11, mål 160) | exit 0 med 0 hårde brud. Det er til sammenligning. |
| S6 med 34 datoer (til lørdag 2/1) og mål 170 | 0 hårde brud. Kun én override-bar afvigelse: brosten i D3 er +2,8 pp. |
| S6 med 34 datoer og mål 140 | 3 hårde brud. D1 kan ikke ramme 140, den lander på 144. Træningsrytmen bliver også rød. |

Katalog-filen `racePoolCatalog.prod.json` er sidst ændret 19/10. Prod-kataloget kan være ændret siden. Derfor skal der køres en læsende tørkørsel mod prod (`buildSeasonCalendar.js --season 6`, kun SELECT), før nogen siger "kør". Det har jeg ikke gjort, fordi bølge-reglerne forbyder scripts mod prod i dette spor.

## Overblik pr. division (kandidat: 27 datoer, mål 140, frø 1)

| | D1 | D2 | D3 | D4 |
|---|---|---|---|---|
| Puljer | 1 | 2 | 4 | 4 |
| Løb | 29 | 35 | 32 | 34 |
| Etapeløb / endagsløb | 13 / 16 | 15 / 20 | 13 / 19 | 15 / 19 |
| Etaper | 135 | 108 | 81 | 81 |
| Etaper pr. dato | 5 hver dag | 4 hver dag | 3 hver dag | 3 hver dag |
| Løbsdage i alt (heraf med løb) | 140 (80) | 140 (54) | 140 (54) | 140 (55) |
| Løbsdage med 1 / 2 / 3 løb | 39 / 27 / 14 | 13 / 28 / 13 | 27 / 27 / 0 | 29 / 26 / 0 |
| Løb i gang pr. dato | 2-4 | 2-3 | 2-3 | 1-2 |
| Grand Tours | 3 | 0 | 0 | 0 |
| Monumenter | 5 | 0 | 0 | 0 |
| Dage uden løb | 0 | 0 | 0 | 0 |

Terræn (etaper):

| | Flad | Rullende | Kuperet | Mellembjerg | Bjerg | Højbjerg | Brosten | Enkeltstart | Andet |
|---|---|---|---|---|---|---|---|---|---|
| D1 | 29 | 17 | 25 | 5 | 25 | 14 | 7 | 9 + 3 kuperet | grus 1 |
| D2 | 25 | 13 | 20 | 0 | 17 | 13 | 6 | 11 | grus 1, klassiker 2 |
| D3 | 18 | 8 | 15 | 0 | 14 | 10 | 5 | 8 | klassiker 3 |
| D4 | 22 | 9 | 14 | 0 | 11 | 10 | 5 | 7 | klassiker 3 |

Grand Tours i D1: Giroen kører 4/12-9/12 (17 etaper), Touren 11/12-16/12 (18 etaper) og Vueltaen 22/12-26/12 (17 etaper). De overlapper ikke hinanden. Rækkefølgen er Giro, Tour, Vuelta, som reglen kræver. Hver GT har 2 løbsdage i sit spænd uden egen etape. Det svarer til de 2 hviledage i §3.

HTML-overblikket med alle løb, datoer, terræn og en dag-for-dag-strimmel blev lavet i bølgens scratch-mappe (`S6-kalender-overblik.html`). Hovedsessionen viser det for ejeren. Tabellerne ovenfor har de samme tal.

## Ejerens regler: tjekket én for én

| Regel | Status | Bevis |
|---|---|---|
| 140 løbsdage (låst) | Holder **kun med flaget**. | Med `--race-day-target 140` er der 140 i alle fire divisioner. Uden flaget får divisionerne 80/54/54/55, og gaten melder ikke fejl. `SEASON_RACE_DAY_TARGET` har kun S4 og S5 (`backend/lib/calendarRaceDayTargets.js:81`). |
| Lige mange løbsdage overalt (§1d, #4845/#5707) | Holder med flaget. | Det samme bevis som ovenfor. |
| Én rytter, ét løb pr. løbsdag (25/8) | Holder i kalenderen. **Bryder i praksis i D1.** | Intet løb har to etaper på samme løbsdag. Men 4 monumenter ligger inde i et GT-spænd. GT-rytterne er bundet på hele spændet (§3, #4209), så de kan ikke køre monumentet. |
| Monument uden for GT-spænd (§4, #4203) | **Brudt** (hård gate). | De Vlaamse Ronde (løbsdag 26), L'Enfer du Nord (42) og La Doyenne des Ardennes (45) ligger i Giroens spænd (26-54). La Classica d'Autunno (137) ligger i Vueltaens spænd (116-139). |
| Løb hver kalenderdag (§2) | Holder. | 27 af 27 datoer har løb i alle divisioner. |
| Kvote eksakt 100 % (§1b) | Holder. | 135 / 108 / 81 / 81. |
| Samtidige løb pr. løbsdag, loft og gulv (§1) | Holder. | Højst 3 / 3 / 2 / 2 løb. Andelen af løbsdage med mindst 2 løb er over gulvet i alle divisioner. |
| Træningsrytme (§1e) | Holder. | Den længste stime uden træningsdag er højst 2 datoer. |
| GT-rækkefølge, ingen GT-start dag 1 (§3) | Holder. | Den første GT starter 4/12. |
| Ungdomsløb i seniorkalenderen (#8259) | Ingen fundet. | Jeg søgte på navne (U23, junior, espoir, giovani). Det er et svagt bevis, fordi katalogets ungdomsmærke ikke er tjekket mod prod. |

## Det der ser urealistisk ud

1. **Fire monumenter på seks dage.** Milano-Riviera ligger 3/12, De Vlaamse Ronde 4/12, L'Enfer du Nord 7/12 og La Doyenne 8/12, og tre af dem er inde i Giroen. I virkeligheden ligger de over cirka fem uger og aldrig under en GT.
2. **Jul.** Alle divisioner kører 24.-26/12, og Vueltaen slutter 26/12. Det er tilladt efter reglerne. Det er et spørgsmål om, hvad spillerne har lyst til.
3. **Afslutningerne.** Finale-båndene (§7b) er røde i alle divisioner: 0 % udbrud, og kuperede etaper slutter nedad i 36 % af tilfældene. For S5-modellen er det kun rapport, og benchmark-gaten er grøn. Det passer med spillernes klage 22/11 over etaper, der står som "kuperet" men slutter med en flad spurt (#8259, #6369).
4. **Grand Tours på 5-6 datoer.** De har op til 4 etaper pr. dato. Det er ejer-besluttet 15/10 og står kun her for fuldstændighedens skyld.

## Andre fund

- `SEASON_RACE_DATES` og `SEASON_RACE_DAYS_DEFAULT` i `backend/lib/calendarStartDate.js:92-104` har ingen S6. Kommentaren siger selv "Tilføj S6 samtidig med S6's mål". Skademodulet (`injuryRaceDays`) bruger tallet.
- S6-vinduet står som "foreløbig, ikke låst" i `docs/CALENDAR_RULES.md` (§2, afsnittet om lørdag fra S5).
- 140 går ikke op i 27 datoer (140/27 = 5,19). Nogle datoer får derfor 6 løbsdage. Scorecardet er grønt alligevel, men det er ikke længere "5 pr. dato" som i §1e-b.

## Spørgsmål til ejeren (ét ad gangen, med anbefaling)

1. **Monumenterne i Grand Tours: hvordan retter vi det?** Anbefaling: generatoren skal aldrig lægge et monument inde i et GT-spænd. Så kan vi beholde 27 datoer og 140 løbsdage. Alternativet er at forlænge S6 til lørdag 2/1 (34 datoer). Det er grønt, men kræver 170 løbsdage i stedet for 140.
2. **Skal vinduet 30/11 til 26/12 (27 datoer) låses?** Anbefaling: ja, hvis spørgsmål 1 løses i generatoren.
3. **140 løbsdage på 27 datoer giver 5-6 løbsdage pr. dato. Er det ok, eller vil du have 135 (præcis 5 pr. dato)?** Anbefaling: behold 140, som du har låst, og skriv det ind i koden for S6.
4. **Skal monumenterne spredes, så der ikke er fire på seks dage?** Anbefaling: ja, med mindst 3 datoer imellem.
5. **Skal der køres løb 24.-26/12?** Anbefaling: ja. Det er et onlinespil, og det giver noget at se på i juledagene.
6. **Afslutningerne (0 % udbrud, kuperet med flad spurt): skal det rettes før S6?** Anbefaling: nej, ikke før S6. Tag det i #6369, efter S6 er live.
7. **Læsende tørkørsel mod prod før "kør"?** Anbefaling: ja, altid. Katalog-filen er fra 19/10.

## Fix-plan

1. **Mål og datoer som data** (lav risiko). Tilføj `6: 140` i `SEASON_RACE_DAY_TARGET` (`backend/lib/calendarRaceDayTargets.js`) og `6: 27` i `SEASON_RACE_DATES` (`backend/lib/calendarStartDate.js`). Når vinduet er låst, tilføjes S6 også i `SEASON_RACE_DAYS_DEFAULT`. Test: `injuryRaceDays.test.js` og `calendarRaceDayTargets`-testene.
2. **Monument uden for GT-spænd som placeringsregel** (middel risiko). I dag dømmes reglen kun bagefter, i gaten (`calendarScorecardReport.js` og `monumentRulesHeld` i `tierCalendarMaterializer.js`). Den skal også bindes i placeringen (`raceCalendarLanePacker.js` / `calendarPlacementGates.js`), så et monument kun kan lægges på løbsdage uden for GT-spændene. Spørgsmål 4 kan løses i samme omgang.
3. **Regressionsbevis.** `calendarGoldenDiff.mjs --fail-on-diff` skal fortsat give exit 0 (S3-referencen må ikke ændre sig). Det offline S5-vindue skal forblive grønt. S6 med 27 datoer og mål 140 skal give 0 hårde brud på frø 1-7.
4. **Prod-tørkørsel** (kun læsning): `node scripts/buildSeasonCalendar.js --season 6 --first-day 2026-11-30 --race-day-target 140`. Ejeren ser kalenderen, og `--apply` køres kun på ejerens "kør".

Risiko: ændringen i trin 2 rører pakkeren, som alle sæsoner bruger. Trin 3's golden-diff og S5-kørslen er netop vagten mod, at S3 og S5 ændrer sig.

## Dom

bekraeftet + fix-plan
