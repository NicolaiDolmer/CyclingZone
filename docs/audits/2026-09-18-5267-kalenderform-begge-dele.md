# #5267 runde 2: findes der en kalenderform hvor BAADE lige mange loebsdage OG hyppigt overlap holder?

> READ-ONLY undersoegelsesspor (#5220). Intet skrevet til prod, ingen `--apply`, intet
> committet, ingen PR. PR #5169's branch (`feat/4845-calendar-packs-equal-race-days`,
> commit `ef5d36843`) checket ud READ-ONLY i undersoegelses-worktreet; PR'en er ikke roert.
> Alle tal er maalt med `materializeTierCalendars({ dryRun: true })` mod prod-kataloget for
> S4 (28 loebsdatoer, foerste loebsdag 29/9), samme kald som `buildSeasonCalendar.js` bruger.

## 0. Kort svar

**Ja — der findes en vej med begge dele, og modsaetningen er ikke matematisk.**

Den afgoerende nye maaling: **naar pakkeren faar lov at pakke naturligt (intet loebsdags-maal),
holder mindste-overlap-gulvet i ALLE FIRE divisioner med god margin.**

| Division | Loebsdage (naturligt) | Overlap-andel | Gulv | Holder? |
|---|--:|--:|--:|---|
| D1 | 80 | 56,3 % | 45 % | ✅ |
| D2 | 56 | 78,6 % | 55 % | ✅ |
| D3 | 56 | 50,0 % | 40 % | ✅ |
| D4 | 56 | 50,0 % | 40 % | ✅ |

D2's 78,6 % og D3/D4's 50,0 % er **ikke maalt foer nu**. 15/9-undersoegelsen noterede
"D2 43,1 %, D3 21,7 %, D4 23,5 %" — men de tal er maalt ved **maal 80**, ikke naturligt.
Overlappet kollapser altsaa ikke fordi aksen bliver laengere; det kollapser fordi
**R12 re-soeger HELE placeringen saa snart der er sat et maal**. Samme 32 loeb / 140 etaper
i D1 bliver spredt fra 80 til 106 loebsdage MED loeb — det er dét der tager valget fra
manageren, ikke traeningsdagene.

Dermed er de fire aftaler ikke i konflikt i sig selv. Prisen ligger et helt andet sted:
**hvor i saesonen traeningsdagene kan ligge.**

## 1. Den egentlige binding: hvor maa en traeningsdag ligge?

En tom loebsdag maa kun ligge dér hvor INTET loeb er i gang (ejer-regel 3, 18/9). Maalt paa
den naturlige pakning — antal positioner paa loebsdags-aksen hvor intet loeb spaender henover:

| Division | Frie positioner | Paa antal datoer | Stoerste hul mellem to datoer med en fri position |
|---|--:|--:|--:|
| D1 | 4 | 4 | 17 datoer |
| D2 | 5 | 5 | 12 datoer |
| D3 | 5 | 4 | 24 datoer |
| D4 | 8 | 8 | 14 datoer |

Der er INGEN oevre graense for hvor mange tomme loebsdage der kan stables paa én fri
position (en kalenderdato har ingen loft paa antal loebsdage — kun paa antal ETAPER).
Aksen kan altsaa naa 112 i alle fire divisioner **uden at roere en eneste loebsplacering**.
Men saa lander D3's 56 traeningsdage i 4 klumper med op til 24 kalenderdage imellem.

Aarsagen ses direkte i D4's naturlige kalender: etapeloebene ligger i en **kaede** — loeb A's
sidste etape og loeb B's foerste etape deler loebsdag. Kaeden har derfor ingen huller.

## 2. Kandidaterne, maalt

| | Hvad den goer | Lige mange loebsdage (1) | Loeb/etaper uroert (2) | Ingen traening inde i et etapeloeb (3) | Overlap almindeligt (4) | Traeningsrytme |
|---|---|---|---|---|---|---|
| **Dagens #5169 (maal 112)** | R12 re-soeger hele placeringen | ✅ 112 overalt | ✅ | ✅ | ❌ 26/21/14/14 % mod 45/55/40/40 | Klumper 2-3 pr. dato, op til 9 paa 3 dage |
| **K1 naturlig pakning + blokke** | Behold den naturlige pakning, stabl tomme loebsdage paa de frie positioner | ✅ | ✅ (placeringen er den naturlige) | ✅ | ✅ 56/79/50/50 % | ❌ 4-8 blokke pr. saeson, op til 24 datoer uden traening |
| **K2 synkroniserede etapeloebs-blokke** | Samtidige etapeloeb starter og slutter paa samme loebsdage; huller imellem | ✅ | ✅ (samme loeb og etaper, ny placering) | ✅ | ✅ (et synkront par giver 2 loeb paa HVER loebsdag i blokken) | ✅ ca. 8-10 vinduer, 30-40 frie positioner |
| **K3 faelles maal = D1's naturlige 80** | Samme mekanik, lavere tal | ✅ | ✅ | ✅ | ❌ maalt 43/22/24 % ved 80 — samme re-soegning | Samme klumpning |

K3 er maalt og **falder af samme grund som 112**: det er ikke tallets stoerrelse der braekker
overlappet, det er re-soegningen. Et lavere maal hjaelper ikke.

### K2's loft, regnet paa prod-kataloget

Et etapeloeb med L etaper blokerer L−1 positioner paa aksen. Naar to etapeloeb ligger
FORSKUDT, blokerer de hver sit stykke; naar de ligger SYNKRONT, blokerer de det samme
stykke. Synkronisering frigoer derfor positioner uden at fjerne et eneste loeb:

| Division | Etapeloeb | Positioner i alt | Blokeret i dag | Blokeret ved synkrone par/trioer | Frie positioner |
|---|--:|--:|--:|--:|--:|
| D1 | 13 (heraf 3 Grand Tours) | 81 | 114 (med overlap) | 41-62 | ca. 19-40 |
| D2 | 16 | 57 | 75 | 27-39 | ca. 18-30 |
| D3 | 14 | 57 | 52 | 19-27 | ca. 30-38 |
| D4 | 15 | 57 | 50 | 17-26 | ca. 31-40 |

D1's tal er det mest usikre: tre Grand Tours maa aldrig dele kalenderdato (R6), saa de kan
ikke synkroniseres med hinanden. D1's realistiske loft er derfor naermere 20-30 frie
positioner — stadig rigeligt til de 32 traeningsdage det kraever at naa 112.

## 3. Sammenligningsalternativet: lige meget TRAENING uden lige mange loebsdage

Deleren i `trainingRaceDayTick.js` er i dag ét tal for alle divisioner. Kalibreres den pr.
division (D_tier ∝ divisionens naturlige antal loebsdage), bliver saesonens samlede
udvikling ens uden at kalenderen roeres overhovedet.

- **Pr. traeningsdag:** en D4-rytter faar mere ud af hver traeningsdag end en D1-rytter, i
  forholdet mellem de to divisioners antal loebsdage (80 mod 56).
- **Pr. saeson:** ens for en rytter der traener paa hver eneste loebsdag.
- **Bagsiden, og den er alvorlig:** en rytter der koerer MANGE loeb rammes haardere i en lav
  division. Hver loebsdag han er bundet i et loeb, koster ham 1/56 af saesonens budget i D4
  mod 1/80 i D1. Alternativet goer altsaa den lave division MERE foelsom over for at koere
  loeb — praecis det modsatte af ejerens begrundelse 6/9 ("de lavere divisioner faar bare
  flere muligheder for at traene").
- Aendringen er lille i kode (ét opslag i stedet for én konstant) og nul i kalenderen.

## 4. Anbefaling

**K2 + K1 kombineret: behold den naturlige taethed, synkronisér de samtidige etapeloeb, og
laeg traeningsdagene i hullerne imellem.** Det holder alle fire aftaler samtidig.

Fix-planen for #5169:

1. **R12 skal ikke laengere vaere et snit paa AKSENS LAENGDE under den frie soegning.**
   Soegningen skal foerst finde den naturlige pakning (den der maalt holder alle fire gulve)
   og derefter kun tilfoeje tomme loebsdage. Det er punkt 1 i 18/9-maalingens fix-retning,
   og det er nu bekraeftet som tilstraekkeligt: de naturlige overlap-tal ER over gulvene.
   Fil: `backend/lib/raceCalendarLanePacker.js` (`solveContiguousStarts`, R12-snittet og
   `proevTom`). Risiko: middel — soegningens raekkefoelge er en foelsom parameter (se filens
   egne noter om #4203).
2. **Ny binding i soegningen: synkronisér samtidige etapeloeb.** To etapeloeb der koerer
   samtidig skal starte og slutte paa samme loebsdag, i stedet for at kaede sig (loeb A's
   sidste etape = loeb B's foerste). Det er dét der aabner hullerne OG hoejner overlappet,
   fordi hver loebsdag i en synkron blok baerer 2 loeb. Samme fil.
   Risiko: hoej — det er en ny placeringsregel, og den skal maales mod alle eksisterende
   gates (komposition, monument-spredning, GT-regler) foer den kan bruges.
3. **Spredningsbaandet skal maale paa BLOKKE, ikke paa datoer.** Kravet er "ingen lang stime
   uden traening", ikke "traeningsdage jaevnt fordelt pr. dato". Maal: laengste stime af
   kalenderdatoer uden en traeningsdag. Fil: samme + `calendarRaceDayTargets.js`
   (`maxEmptyGameDaysPerDate` erstattes af et blok-loft).
4. **Gulvene (`TIER_MULTI_RACE_DAY_MIN_SHARE`) roeres IKKE.** De holder paa den naturlige
   pakning i alle fire divisioner. Forslaget fra 18/9 om at saenke dem er hermed
   overfloedigt — og ville have skjult roden.
5. **Ny gate:** laengste stime uden traeningsdag pr. division, saa klumpningen er maalt og
   ikke en overraskelse.

Bliver punkt 2 for dyrt, er **K1 alene** den sikre nedfaldsplan: alle fire aftaler holder,
men traeningen kommer i 4-8 store blokke med op til 24 datoer imellem. Det er en
spilfoelelse ejeren skal se og sige ja til, ikke en detalje.

## 5. Eksempel-uge (naturlig pakning, prod-kataloget, S4's foerste uge)

Loebsnavne er udeladt (repoet er offentligt); loebene er nummereret A, B, C ... i den
raekkefoelge de optraeder.

### D1, 28/9-4/10 (i dag, naturligt — 20 loebsdage paa 7 datoer)

| Dato | Loebsdag | Indhold |
|---|---|---|
| 28/9 | gd0 | Grand Tour A etape 1 + etapeloeb B etape 1 + endagsloeb |
| 28/9 | gd1 | Grand Tour A etape 2 + etapeloeb B etape 2 |
| 29/9 | gd2-3 | Grand Tour A etape 3-4 + etapeloeb B etape 3-4 + endagsloeb |
| 30/9 | gd4-5 | Grand Tour A etape 5-6 + etapeloeb B etape 5-6 + endagsloeb |
| 1/10 | gd6-10 | Grand Tour A etape 7-9 og 11 · gd9 = endagsloeb alene (GT'ens hviledag) |
| 2/10 | gd11-14 | Grand Tour A etape 12-15 + endagsloeb |
| 3/10 | gd15-19 | Grand Tour A etape 16-20 · gd16 = endagsloeb alene |
| 4/10 | gd20 | **FRI POSITION** — Grand Tour A er slut, naeste blok starter |

Under K2 ville traeningsblokken ligge praecis paa den frie position 4/10, foer den naeste
etapeloebs-blok starter.

### D4, 28/9-4/10 (i dag, naturligt — 14 loebsdage paa 7 datoer, 2 pr. dato)

| Dato | Loebsdag | Indhold |
|---|---|---|
| 28/9 | gd0 | Etapeloeb P etape 1 + endagsloeb |
| 28/9 | gd1 | Etapeloeb P etape 2 |
| 29/9 | gd2 | Etapeloeb P etape 3 + endagsloeb |
| 29/9 | gd3 | Etapeloeb P etape 4 |
| 30/9 | gd4 | Etapeloeb P etape 5 **+ etapeloeb Q etape 1** ← kaeden: P slutter og Q starter samme loebsdag |
| 30/9 | gd5 | Etapeloeb Q etape 2 |
| 1/10 | gd6 | Etapeloeb Q etape 3 + endagsloeb |
| 1/10 | gd7 | Etapeloeb Q etape 4 |
| 2/10 | gd8 | Etapeloeb Q etape 5 **+ etapeloeb R etape 1** ← kaeden fortsaetter |
| … | … | … |

Under K2 ville P og Q koere **samtidig** (begge etape 1-5 paa gd0-gd4, to loeb at vaelge
imellem hver eneste loebsdag), og gd5 ville vaere en **traeningsdag** — et aegte hul i
kaeden, foer R og S starter samlet paa gd6.

## 6. Metode

- `materializeTierCalendars({ dryRun: true, raceDayTarget: null })` mod prod-kataloget for
  S4, en repraesentativ pulje pr. division (alle puljer i en division er ens, #2276).
- Overlap maalt som andelen af loebsdage MED loeb der baerer >= 2 distinkte `pool_race_id`.
- Frie positioner: position p paa loebsdags-aksen er fri naar intet loeb har
  `lo < p <= hi` (samme definition som `proevTom`'s `aktive.length === 0`).
- Kode laest: `raceCalendarLanePacker.js` (R1-R12), `calendarRaceDayTargets.js`,
  `calendarTierCaps.js`, `tierCalendarMaterializer.js`, `trainingRaceDayTick.js`.
- Docs laest: `CALENDAR_RULES.md`, `2026-09-15-5267-loebsdage-s3-undersoegelse.md`,
  `2026-09-18-5267-maaling-112.md`, #5267's kommentarer 15/9 og 18/9.

## 7. Dom

**bekraeftet + fix-plan**
