# #6046: Hvorfor brostensevnen løfter så lidt i v4, og rettelsen

Dato: 2026-10-02. Refs #6046 (opfølgning på #5957). Rapporten er kvalitativ (repoet er offentligt); de præcise tal ligger privat i `balance-internals/6046/`.

## Kort svar

På brosten- og grusetaper i v4 afgøres placeringen mest af rytterens generelle niveau (tempo, udholdenhed), ikke af brostensevnen. To steder i motoren smider brostensevnen væk:

1. **Sektoren.** En brostenssektor deler en gruppe i to: dem der kan følge den bedste brostensrytter, og resten. Alle i "resten" fik samme tidstab, inden for et smalt bånd. En rytter lige under fronten og en rytter langt under tabte det samme, så evnen talte kun som "med eller ikke med". Grupperne samledes desuden igen på flad vej mellem sektorerne, så selv det ene skel blev visket ud.
2. **Finalen.** Placeringen inden for en ankommen gruppe læste kun finale-typens evner (spurt, udbrud, punch). Brostensevnen havde ingen vægt i finalen, heller ikke på en brostensetape.

## Undersøgelsen

Genafspil af de rigtige S4-brosten- og grusetaper fra cachen (`backend/scripts/dev/replay5957.mjs`) gennem v4, plus flere seeds pr. etape for at skille signal fra støj:

- **Hvilken evne forklarer placeringen?** I v4 forklarede tempo og udholdenhed placeringen bedre end brostensevnen på brostensetaper. I v3 er brostensevnen klart den tungeste.
- **Gennem etapen:** lige efter en hård sektor er feltet ordnet tydeligt efter brostensevne, men kun når sektoren deler i flere lag. Med ét skel steg ordenen kun lidt, og den faldt tilbage på den efterfølgende flade vej.
- **Afprøvet og forkastet** (målt, ingen sikker effekt): et brostensled i rytterens tærskel (sektorerne er en lille del af distancen), ekstra reserveforbrug på sektorerne, og tidstab for hele gruppen efter dens bedste brostensrytter.
- **Udbruddet er ikke årsagen:** uden udbryderne i målingen er billedet det samme.

## Rettelsen (kun `orders_gc_v1`, kun `cobbles`/`gravel`)

- `mechanics/cobbles.ts`: de afhængte ryttere deles i op til fire lag efter deres underskud til gruppens bedste brostensrytter, og hvert lag taber mere tid jo større underskuddet er. Lagene følger den støjfri score, så en stærkere rytter aldrig ender bag en svagere fra samme gruppe på sektoren (fast-check-testet).
- `finale.ts` (få linjer): på brosten/grus blandes brostensevnen ind i finale-vektoren. Vægtsummen er uændret, og alle vægte er ikke-negative, så finale-scoren stadig stiger i hver evne.
- Tuning: fire linjer i `COBBLES_EXTRA_TUNING` (profiler, antal lag, tidstab-bånd, finale-andel).

## Målt effekt

- **Brosten og grus under `orders_gc_v1`:** brostensevnen forudsiger placeringen markant bedre, både på udbruds- og spurtfinaler og på grus. Stadig lidt under v3 på brosten.
- **Legacy-revisionen:** uændret (byte-identisk, testet).
- **Flad, klassiker, rullende, kuperet, bjerg, enkeltstart:** byte-identisk output før og efter under begge revisioner. `classic` er bevidst udeladt.
- **Flip-gaten** kører legacy-revisionen og er derfor uændret.

## Gate

`backend/scripts/dev/replay6046.test.mjs` udvider #5957's korrelationsanker med brosten: proxy-etaperne med brostensprofil på prod-lignende divisionsfelter med AI-ordrer, kørt under begge revisioner. Ankeret kræver et gulv under `orders_gc_v1` og en tydelig forbedring over legacy. Det er rødt uden rettelsen og grønt med.

## Klassifikation: balance

Ingen formel regnede noget andet end den var skrevet til: sektoren var designet med ét skel og et smalt bånd, og finalen var designet efter finale-type. Rettelsen ændrer størrelsen af en tilsigtet mekanik og tilføjer et nyt led i finalen. Det er **balance** efter release-princippet i `backend/lib/raceEngineRulesRevision.ts`, og derfor ligger den bag `orders_gc_v1` sammen med #5955's øvrige motorbalance. Den gælder kun løb der starter efter at `orders_gc_v1` er aktiveret (ejer-go). Vurderer ejeren den som en beregningsfejl, er det en ændring på én linje (`cobbledBalanceActive`) at lade den gælde fra næste ikke-kørte etape.

## Hvad dette ikke dækker

- Ingen ny prod-genafspilning efter rettelsen ud over cachen fra 2/10; cachen har få grusetaper, så grus-tallet er usikkert.
- Proxy-etaperne har kun få brostensetaper, så ankeret er lille. Det fanger en regression, ikke en fin kalibrering.
- Brostens-CP-leddet og finale-andelen på `classic` er ikke rørt. `classic` bærer en lille brostensvægt i v3; om den skal have en i v4, er et særskilt spørgsmål.
- `orders_gc_v1` er stadig slukket for nye løb. Effekten når spillerne først når ejeren aktiverer pakken.
