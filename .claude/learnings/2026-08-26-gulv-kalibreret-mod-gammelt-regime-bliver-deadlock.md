# Et gulv kalibreret mod et gammelt regime bliver en deadlock når regimet ændres

**Dato:** 2026-08-26 · **Issues:** #4272, #4273, #3469 · **Branch:** `fix/4236-loebsdag-baand-pr-kalenderdato`

## Hvad skete der

#4272 vendte bevidst bjergetapernes finaler: `mountain` gik fra at slutte **nedad 60 %** af tiden til at slutte **opad** i flertallet, efter ejerens bånd (nedad 20-35 %, samlet nedad højst 10 %).

Alle nye bånd blev grønne. Backend-testene var grønne. Scorecardet gav exit 0.

Og alligevel var systemet blevet **målbart mere skrøbeligt**: en søgning over 400 sæsoner viste at **20 af dem (5 %) udtømte alle 12 gen-træk** i realisme-re-drawet, hvor baseline var **0**. S3's eget træk gik fra `attempt 0` til `attempt 9 af 12` i D2 — tre forsøg fra at blokere sæsonstarten.

## Rod-årsagen

`TIER_TARGETS.descent_finale_min` er et **gulv** under antallet af nedkørsels-finaler, sat 8/8 (#3469). Det blev kalibreret mod en generator hvor `mountain` sluttede nedad 60 % af tiden — dengang var D2's gulv på 10 rigelig margin.

Efter #4272 er det ikke stramt. Det er **umuligt**:

```
D2 har 23 mountain + 7 high_mountain.
Bånd-LOFTET: 23 × 0,35 + 7 × 0,15 = 9,1 nedkørsels-finaler.
Gulvet kræver 10.
```

To ejer-godkendte regler, sat seks dage fra hinanden, kunne ikke opfyldes samtidig. Re-drawet brugte derfor alle 12 forsøg på at lede efter en fordeling **båndet forbød**.

## Hvorfor det ikke blev opdaget af gaten

Fordi gaten målte båndene, og båndene var grønne. Re-drawets *omkostning* blev ikke målt af noget. Et træk der lykkes på attempt 9 ser ud præcis som et der lykkes på attempt 0 — helt til det er attempt 13.

Det er samme mønster som prompten til sessionen advarede om: **grøn verifikation beviser kun det verifikationen måler.**

## Læringen

> **Når du ændrer en fordeling, så find alle GULVE og LOFTER der er udledt af den gamle fordeling — også dem i andre filer, sat af andre issues.** Et gulv er ikke en uafhængig regel; det er et *afledt* tal, og det arver forudsætningerne fra den generator det blev målt mod.

Konkret tjekliste når en fordelings-konstant ændres:

1. `grep` efter metrikken (her: `descent`) i **alle** gate-filer, ikke kun den du arbejder i.
2. Regn **bånd-loftet** ud: kan gulvet overhovedet nås inden for den nye fordeling? Det er aritmetik, ikke skøn.
3. Mål **omkostningen**, ikke kun resultatet — her: re-draw-forsøg og udtømnings-rate over mange seeds, ikke bare "består S3?".
4. Lås relationen i en test, så den ikke kan gen-introduceres.

Punkt 4 er gjort: `raceRouteRealismMetrics.test.js` har nu *"descent_finale_min er opnåeligt inden for finale-båndene i alle divisioner"*.

## Bi-fund: #4273 var samme blindhed en etage nede

#3347-testen kunne ikke længere fremprovokere reparations-stien, og tre forsøg var forkastet. Symptomet blev læst som "trækket består nu". Det gjorde det ikke — **hvert** træk brød båndene, men de brød på `fritstående ITT 0 < 1`, som re-drawet pr. konstruktion **ikke kan reparere** (det varierer parcours for et allerede fastlåst løbsudvalg, aldrig selve udvalget). Trækket udtømte derfor forsøgene, og `attempt` faldt tilbage til 0 — hvilket lignede "bestod i første forsøg".

Diagnosen tog fem minutter da `draw.firstDrawFailures` blev **printet** i stedet for gættet. De tre forkastede forsøg havde alle gættet på symptomet.

> **Et `attempt: 0` betyder ikke "bestod". Læs `exhausted` sammen med det.**

## Ændret

- `raceRouteRealismMetrics.js` — `descent_finale_min` re-deriveret (D2 10→5, D4 4→3) med udledningen i docstringen.
- `raceRouteRealismMetrics.test.js` — ny test låser gulv ≤ bånd-loft.
- `tierCalendarMaterializer.test.js` — #4273-fixturens ITT-forsyning hævet (3→8), diagnosen skrevet ind.
- `docs/CALENDAR_RULES.md` §7b — reglen skrevet ned: *et gulv må aldrig kræve mere end båndet tillader*.
