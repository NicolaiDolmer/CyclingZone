# Mocken delte kodens falske præmis, så preview kunne aldrig vise fejlen

**Dato:** 2026-08-27 · **Issue:** [#4312](https://github.com/NicolaiDolmer/CyclingZone/issues/4312) · **Rapporteret af:** egomadsen, Discord staff-chat 27/8

## Hvad skete der

Planlæggerens dato-mærkat regnede et etapeløbs slutdato som `startdato + (gameDayEnd - gameDayStart)`, altså **løbsdage lagt oven i en kalenderdato**. De to er forskellige akser.

Målt i prod: 98 af 206 flerdagsløb i sæson 3 fik forkert slutdato. Værst de tre Grand Tours med +13 til +14 dage. Vueltaens mærkat sagde **4. oktober**, en uge efter sæsonen slutter 27. september.

Fejlen fandtes også i sæson 1 (157 af 165) og sæson 2 (93 af 189). Præmissen har aldrig holdt.

## Rod-årsag

Kommentaren over funktionen begrundede genvejen selv:

> `game-day-indeks mapper 1:1 til kalenderdage i denne sæson-motor ... så spændet er præcist selv når etaper har en hviledag imellem. Boardet leverer ikke et separat etape-slutdato-felt i dag, og dette er frontend-only arbejde (rør ikke API'et).`

Alle tre led var forkerte eller forældede:

1. **1:1 gælder kun D4.** `docs/CALENDAR_RULES.md:17-21` siger ordret at `game_day` ALDRIG kan udledes af `scheduled_at`, og at pakkeren lægger flere hele løbsdage inden i hver kalenderdag. D1 kører 75 til 103 løbsdage over 27 til 28 datoer.
2. **Boardet kunne godt levere feltet.** `stageDatesByRaceId` med de ægte CET-etapedatoer stod allerede i samme handler, elleve linjer længere oppe, og fodrede allerede `peakWindow`. Nul ekstra DB-kald.
3. **"Rør ikke API'et" var en selvpålagt scope-grænse**, ikke en teknisk. Den gjorde en frontend-beregning nødvendig som ikke burde have eksisteret.

## Hvorfor ingen opdagede det

**Preview-mocken kodede den samme falske præmis.** `frontend/src/preview/plannerMock.js:67` satte `gameDayStart: ord(date)` og `gameDayEnd: ord(date) + (raceDays - 1)`, altså 1:1 mellem løbsdag og kalenderdato. På preview var den gamle formel derfor **altid rigtig**. Fejlen kunne kun ses mod prod-data.

Dertil havde `formatRaceDateLabel` **ingen test overhovedet**. Adfærden var ikke låst af noget, så den kunne heller ikke fejle i CI.

Og fejlen vokser med løbets spænd, så den var usynlig på de korte løb der udgør flertallet, og kun tydelig på de tre GT'er. Det er også derfor rapporten kom fra en Division 1-spiller: alle tre GT'er er hans egne løb.

## Læringen

**En mock der deler produktionskodens antagelse kan ikke falsificere den.** Mocken er skrevet af den samme person, i den samme tankegang, ofte i samme PR. Når begge sider af en test siger "løbsdag = kalenderdag", beviser den grønne test kun at de er enige, ikke at de har ret.

Konkret: **byg fixtures ud fra det der gør virkeligheden svær, ikke ud fra det der gør koden nem.** Mocken skulle have haft et løb hvor game_day-spændet var større end datospændet, fordi det er det normale i D1 til D3. Den nye mock-kommentar siger nu eksplicit at 1:1 gælder her, og hvorfor det gjorde fejlen usynlig.

**Og:** en kommentar der forklarer hvorfor en genvej er forsvarlig, er et sted at kigge efter fejlen. Denne her navngav præcis den antagelse der var forkert, og præcis det felt der manglede. Svaret på "hvorfor gør vi det billige her" var i dette tilfælde "fordi ingen har spurgt om det dyre var nødvendigt".

## Forward-guards

- `formatRaceDateLabel` har nu syv tests, heraf to navngivne forward-guards med de faktiske Tour- og Vuelta-værdier fra prod, der fejler hvis nogen genindfører spænd-formlen.
- `lastStageDate` i `backend/lib/riderPeakPlans.js` deler input med `snapPeakWindow`, så de to tal ikke kan drifte fra hinanden. Fem tests, inklusive at rækkefølgen i DB-svaret ikke betyder noget.
- Mangler `dateEnd` viser mærkatet nu startdatoen alene. Én sand dato er bedre end et opdigtet spænd.

## Beslægtet

- `2026-08-24-afledning-arver-ikke-generatorens-regler.md`: samme familie: en regel der kun findes ét sted bliver brudt af den næste skriver. Her var reglen skrevet ned i `CALENDAR_RULES.md`, men frontenden læste den aldrig.
- `2026-06-07-fictional-rider-stats-outside-pcm-scale.md`: dér kodificerede testen den forkerte skala. Her kodificerede mocken den forkerte akse.
