# Rating-fundamentet v3 — visnings-skala, opskrifter og evne-registrering

**Status:** Udkast til ejer-godkendelse. Designet i session med ejeren 13/8.
**Ejer-mandat (13/8):** *"Hvis en bakkerytter har 13 i alle stats der bliver vurderet for at være bakkerytter, så skal hans rating være 13. Simpelt as that. Ikke alt det der komplicerede lort."* + *"vi skal lave systemer fra nu af, så de nemmere kan håndtere at der tilføjes en ny evne."*
**Refs:** [#3458](https://github.com/NicolaiDolmer/CyclingZone/issues/3458) (dette er Fase 2's vægt-spor), #3372, #3325, #3570, #2890, #1543, #1162.

Dette er Fase 2-tilføjelsen i [ryttertype-fundament-v2](2026-08-06-ryttertype-fundament-v2-design.md) §Del B: *"selve type-formlernes VÆGTE efterses grundigt … research-drevet, ingen hurtige laps."* Del B's Fase 1-løsning (frossen kalibreringskurve) **erstattes** af modellen herunder — begrundelsen står i §1.2.

---

## 1. Problemet, målt

Alle tal read-only mod prod 13/8, n = 6.837 aktive ryttere med primærtype.

### 1.1 To skalaer kører samtidigt
Kalibreringen anvendes ét eneste sted (`api.js:1806`, scouting-rapporten). Alt andet — OVR-pladen i hero, OVR-kolonnerne på Auktioner/Rytterdatabasen/Holdsiden/Ønskelisten, planner-kortene, Overblik-radaren, Udvikling-fanens graf og dens loft-projektion — bruger den ukalibrerede formel. Samme rytter viser to forskellige tal ét klik fra hinanden. Loft-båndet vises i to skalaer under samme navn: 88-95 på Scouting-fanen er ~60-70 i Udvikling-fanens loft-zone.

### 1.2 Den kalibrerede skala er ubrugelig til nuværende niveau
Kurven blev fittet på befolkningens **lofter** (`buildTypeRatingCalibration.js` bruger `ability_caps`), men anvendes også på nu-tallet.

| | p25 | median | p90 | max |
|---|---:|---:|---:|---:|
| Nuværende rating, i dag (rå) | 11 | **17** | 38 | 95 |
| Nuværende rating, kalibreret | 1 | **1** | 32 | 99 |
| Loft, kalibreret | 51 | 79 | 99 | 99 |

6.362 af 6.837 ryttere ville falde. Halvdelen af hele bestanden ville vise 1. Bar-diagrammet på Scouting-kortet er derfor allerede i dag uaflæseligt for de fleste ryttere: fyldt bar ≈ 0 %, loft-bånd klistret i højre kant. **En udrulning af den skala til hele siden er udelukket.**

### 1.3 Radaren og graf-valget sammenligner tal der ikke må sammenlignes
`RiderTypeRadar` plotter 8 rå type-ratings på 8 akser og udnævner den højeste til bedste rolle. `pickChartTypeKeys` vælger Udvikling-grafens ekstra linjer på samme grundlag, og projektionens fallback-primærlinje ligeså. Præcis den sammenligning er det #3458 Del B blev skrevet for at forbyde.

### 1.4 OVR-kolonnen er type-skæv
`riderOverallRating` = rå rating for rytterens primærtype. Målt via den frosne kalibreringskurve: rå 60 svarer til 89 som sprinter og 59 som klatrer. Sortering på OVR blander derfor ikke-sammenlignelige tal og underkender systematisk sprintere, brostensryttere og rouleurer.

### 1.5 Én vægt-tabel, fire læsere
`RIDER_TYPES[].weights` læses af: klassifikatoren (`computeRiderTypes`), værdimodellen (`outputScore` → `predictBaseValue`), progressionen (`youthRoleFactor`/`signatureFactor` → former `ability_caps` og vækst-hastighed pr. evne) og visningen (via en **håndholdt kopi** i `frontend/src/lib/riderRating.js`). En vægt-ændring for at rette et vist tal flytter samtidig lofter, markedsværdier og potentielt rytter-typer. Frontend-kopien kan drifte uden at noget fejler. **Dette er rod-årsagen til at "en lille rettelse" gentagne gange er blevet til en release med fejl.**

### 1.6 To evner er usynlige i alle ratings
Positionering og taktik indgår i nul af de 8 opskrifter, men påvirker løbene (positionering dæmper uheldssandsynlighed og indgår i den tekniske finale; taktik indgår i udbruds-villighedens fallback). En spiller kan træne dem uden at se effekt i noget tal.

### 1.7 Evnerne er ikke på samme skala indbyrdes
Median-niveau pr. evne i bestanden:

| Evne | Median | | Evne | Median |
|---|---:|---|---|---:|
| taktik | 38 | | punch, durability, restitution | 9 |
| aggression | 17 | | nedkørsel, brosten | 9 |
| acceleration | 14 | | tempo, udholdenhed | 7 |
| flad | 13 | | bjerg | 5 |
| sprint | 12 | | | |
| positionering, enkeltstart | 11 | | | |

Årsagen er dokumenteret i `abilityDerivation.js`: de 10 fysiske evner køres gennem kontrast-forstærkning, de 5 tekniske/mentale holdes bevidst udenfor. **Konsekvens for os:** et vægtet snit arver skævheden. Anvendt på median-rytteren giver de 8 udkast-opskrifter 6,7 (climber) til 14,5 (baroudeur) — samme rytter, dobbelt tal. Se §6, åbent punkt 1.

### 1.8 Hjælpeteksterne lover ting der ikke holder
- `riderRating`-FAQ: *"same model that decides the rider's displayed type and market value, so the three always agree"* — typen kommer siden #3570 fra `archetype_draw`, ikke fra rating-modellen.
- `typeRatingScaleFaq` beskriver kalibreringen som en rettelse af *modellen*; den rører ét kort.
- Scouting-kortets legende: *"the same number means the same level everywhere"* — gælder kun inde i det kort.

---

## 2. Design

### D1 — Rating-modellen (ejer-besluttet 13/8)

```
rating(rytter, rolle) = vægtet snit af rollens evner, afrundet, klampet [0, 99]
potentiel rating      = samme regnestykke på ability_caps
```

Ingen normalisering, ingen kurve, ingen populations-ankre. 13 i alle evner der tæller → rating 13.

**Egenskaber, alle ejer-krav fra 13/8:**
- **Absolut.** Tallet afhænger kun af rytterens egne evner. Ingen kurve at gen-fitte, ingen "hvorfor faldt mit tal da der kom nye ryttere".
- **Samme enhed som evnerne.** Rating og evne-tal lever på én skala. Det fjerner én af spillets fire talskalaer helt.
- **Nu og loft er samme enhed** → de kan tegnes på samme bar uden oversættelse.

**Målt effekt** (udkast-opskrifterne i §3, hele bestanden):

| | p25 | median | p75 | p90 | max |
|---|---:|---:|---:|---:|---:|
| Nuværende rating | 9 | 14 | 22 | 29 | 72 |
| Potentiel rating | 36 | 46 | 57 | 66 | 85 |
| Luft nu → loft | | **30 point** | | | |

Til sammenligning med i dag (median OVR 17): ændringen er få point for langt de fleste ryttere. Dette er en oprydning, ikke et chok.

**Accepteret konsekvens:** den bedste rytter i spillet viser ~72, ikke 99. Toppen af skalaen står tom, fordi ingen har maxet sine evner. Det er sandt, det viser at der er mere at hente, og det er en direkte følge af at vi ikke strækker tallene efter feltet.

### D2 — Evne-registrering (ejer-krav 13/8: nye evner skal kunne tilføjes)

Ét sted definerer hvad en evne **er**. Alt andet læser derfra:

```
abilityRegistry = [
  { key, category, i18nKey, shortLabel, derivation, inContrast, order }, …
]
```

Forbrugere der skal læse fra registret i stedet for egne lister: evne-kolonner og badges, ryttersidens grupperede visning, træningsfokus, radar-akser, farve-skalaen, i18n-nøgle-validering, `VISIBLE_ABILITIES`, og de fire vægt-tabeller i D3.

**At tilføje en evne bliver da:** én registry-post + én DB-kolonne + én derivations-regel + valgfri optræden i opskrifter. Ikke en jagt gennem tredive filer.

**Vagter (CI, fejler bygningen — implementeret i `backend/lib/abilityRegistryGuards.test.js`, som kører i det required `backend-tests`-check):**
1. En evne i registret der optræder i **nul** visnings-opskrifter → fejl. (Dette er den vagt der ville have fanget positionering/taktik i §1.6.)
2. En opskrift der refererer en evne uden registry-post → fejl.
3. **Ingen opskrifts evne-sæt må være delmængde af en andens** → fejl. Tilføjet efter ejer-beslutning 13/8 (#3664 spørgsmål 5): #3592 målte fire uadskillelige typepar, som opskrifterne i §3 bryder — men det var en *sideeffekt* af at hver opskrift blev bredere, ikke et designmål. Vagten gør sideeffekten til en regel. Den fandt straks et femte par (`climber ⊆ gc`), se §3.
4. Frontend-vægttabellen skal være **genereret** fra backend-kilden, ikke håndholdt — en drift-test fejler hvis de divergerer. Målt 13/8 var den allerede drevet: `brostensrytter` havde cobblestone 5 mod backendens 6, `puncheur` havde stadig det climbing:1-krydsled #3325 fjernede, og `rouleur` havde flat 2 mod backendens 4. Intet fejlede — kopien drev bare stille.

### D3 — Fire adskilte vægt-tabeller

Den ene tabel splittes efter formål. Hver får sit navn, sin fil og sin ejer-dokumentation:

| Tabel | Bestemmer | Ændres af |
|---|---|---|
| `displayRecipes` | Rating-tallet spilleren ser | Denne spec |
| `classifierWeights` | Hvilken type en rytter er | #3458 Fase 2 (generator-sporet) |
| `capsShapingWeights` | Hvordan lofter formes og evner vokser | #3564-sporet |
| `valuationWeights` | Markedsværdi | #3448/#3353 |

Ved ikrafttræden er de tre sidste **bit-identiske kopier af dagens tabel** — så intet flytter sig. Kun `displayRecipes` får nyt indhold. Det er den egenskab der gør denne ændring sikker: **ingen rytters type, loft eller markedsværdi bevæger sig.**

### D4 — Visnings-fladerne

Alle skifter til D1-modellen samtidigt. Ingen mellemtilstand med to skalaer.

- **OVR-pladen og OVR-kolonnerne** — rating for rytterens egen rolle.
- **Overblik-radaren** — 8 akser, nu på en skala hvor akserne faktisk må sammenlignes.
- **Udvikling-fanen** — graf-linjer, loft-zone og projektions-bånd i samme enhed som resten.
- **Scouting-kortet** — omlagt per ejer-beslutning 13/8: rytterens **egen rolle stort** (niveau nu + loft-bånd), de øvrige 7 som støttende kontekst nedenunder. Begrundelse: typen er siden #3570 en fast identitet man fødes med; en ligeværdig 8-rolle-liste inviterer til en konvertering spillet ikke understøtter.
- **Farver** — rating-tallet kan nu genbruge evne-ankrene i `statColor` (samme fordeling, samme enhed). Ét visuelt sprog i stedet for to ankersæt. Staff-ankrene røres ikke.

### D5 — Maskering er uændret

Loft-båndets bredde, spejder-præcision, per-manager-bias og "aldrig et eksakt tal" (#1543/#1162) fungerer præcis som i dag. Kun enheden båndet udtrykkes i skifter. Ikke-inverterbarheden er bevaret: `buildTypeCeilingBands` maskerer **før** visnings-opskriften anvendes.

### D6 — Hvad der IKKE røres

- Markedsværdien og dens model.
- Race-motoren (den læser evnerne direkte og har aldrig set en rating).
- Klassifikatoren og `archetype_draw`.
- Eksisterende rytteres evner, lofter, typer og potentiale. **Ingen tredje rystelse** (#3458 Del C).

---

## 3. De 8 visnings-opskrifter (UDKAST — kræver ejer-godkendelse)

Princip: rollens signatur-evne vejer tungest; opskriften er bred nok til at ratingen ikke er ét enkelt tal kopieret; hver af de 15 evner optræder mindst ét sted.

| Rolle | Opskrift |
|---|---|
| Sprinter | sprint 4 · acceleration 3 · positionering 2 · flad 2 · durability 1 |
| Tidskører | enkeltstart 5 · tempo 2 · udholdenhed 1 · durability 1 · positionering 1 |
| Bjergrytter | bjerg 5 · tempo 2 · udholdenhed 2 · restitution 1 · durability 1 · nedkørsel 1 · **punch 1** |
| Punchér | punch 5 · tempo 2 · acceleration 1 · bjerg 1 · positionering 1 · udholdenhed 1 |
| Brostensrytter | brosten 5 · flad 2 · durability 2 · positionering 1 · punch 1 · udholdenhed 1 |
| Rouleur | flad 4 · udholdenhed 2 · tempo 2 · durability 1 · positionering 1 · restitution 1 · sprint 1 |
| Baroudeur | aggression 4 · udholdenhed 2 · nedkørsel 1 · restitution 1 · punch 1 · flad 1 · taktik 1 |
| GC | bjerg 3 · enkeltstart 3 · restitution 2 · udholdenhed 2 · tempo 2 · durability 1 · nedkørsel 1 |

**Ændringer mod i dag:** sprinteren får sprint som tungeste evne (var acceleration) — eksplicit ejer-godkendt 13/8. Tidskøreren får en bred opskrift (var enkeltstart alene). Rouleuren udvides fra to evner til syv, inkl. sprint for leadout-rollen. Positionering kommer ind i fem roller, taktik i baroudeurens. Alle 15 evner tæller nu et sted.

**Rettelse 13/8 efter ejer-godkendelsen (#3665):** bjergrytteren har fået **punch 1** tilbage. Delmængde-vagten (spec §D2 vagt 3, ny efter #3664 spørgsmål 5) fandt på sin allerførste kørsel et **femte** uadskilleligt rollepar som ingen havde målt: `climber ⊆ gc` — bjergrytterens seks evner lå alle inde i GC's syv, altså samme mekanik som #3592's fire kendte par. Punch findes ikke i gc-opskriften og bryder delmængden. Valget er tematisk (en klatrer angriber på stigningen) og trækker tættere på i dag: den gamle formel havde punch 1 hos climber i forvejen. De fire #3592-par er brudt af opskrifterne som de stod.

**Målt pr. type på hele bestanden:**

| Rolle | n | nu: median / p90 | loft: median / p90 |
|---|---:|---:|---:|
| sprinter | 1.310 | 19 / 30 | 44 / 64 |
| tidskører | 567 | 11 / 29 | 50 / 65 |
| bjergrytter | 1.122 | 15 / 31 | 52 / 69 |
| punchér | 806 | 9 / 30 | 42 / 60 |
| brostensrytter | 554 | 9 / 22 | 44 / 62 |
| rouleur | 1.102 | 11 / 25 | 39 / 55 |
| baroudeur | 748 | 13 / 34 | 47 / 67 |
| GC | 628 | 23 / 30 | 62 / 77 |

---

## 4. Gates (måles FØR ship, i harness, bevis i PR-body)

| # | Kriterium | Mål |
|---|---|---|
| R1 | Opskrift-neutralitet: alle 8 opskrifter anvendt på **median-rytteren** | maks 6 points spredning (udkast i dag: 7,8). Grænsen er sat til det opnåelige under ejer-beslutning A, ikke til det ønskelige — se §6 |
| R2 | Ingen eksisterende rytters `ability_caps`, `primary_type`, `secondary_type` eller `potentiale` ændres | 100 % diff mod snapshot |
| R3 | Ingen markedsværdi ændres | 100 % uændret |
| R4 | Hver af de 15 evner optræder i ≥1 visnings-opskrift | 100 % (CI-vagt) |
| R5 | Frontend-vægte identiske med backend-kilden | genereret, drift-test |
| R6 | Luft mellem nu og loft (bar-læsbarhed) | median ≥20 point |
| R7 | Ingen visnings-flade tilbage på gammel skala | grep-gate + e2e på alle 3 projekter |
| R8 | Ikke-inverterbarhed uændret (`scoutingInversionHarness`) | består som i dag |

---

## 5. Faser

1. **Fundament** — evne-registrering (D2) + split af vægt-tabellen (D3), alle fire tabeller bit-identiske med i dag. Ren refaktorering: **nul synlige ændringer**, verificeret af R2/R3. Egen PR.
2. **Skalaen** — D1-modellen + de godkendte opskrifter (§3) + alle visnings-flader (D4) i én samlet PR, så der aldrig findes en mellemtilstand med to skalaer. Bevis: R1/R4/R6/R7/R8.
3. **Kommunikation** — patch notes + `help.json` (en+da): den rettede `riderRating`-FAQ, den erstattede `typeRatingScaleFaq`, og en ny post om hvad et rating-tal *er*. Sendes samlet, jf. #3458 Del C: én forstyrrelse, ét sammenhængende system.

Ingen prod-mutation af eksisterende ryttere i nogen fase.

---

## 6. Åbne punkter til ejeren

**1 — Den skæve evne-skala (§1.7). AFKLARET 13/8: vej A.**

Anvendt på median-rytteren giver udkast-opskrifterne 6,7 (bjergrytter) til 14,5 (baroudeur). Samme rytter, dobbelt tal, alene på grund af hvilke evner rollen består af.

Fravalgt: at rette evne-skalaen ved roden nu (ville ændre eksisterende rytteres evne-tal — taktik fra ~38 mod ~9 — og dermed være den tredje rystelse #3458 Del C forbyder), og en frossen per-evne korrektion inde i opskriften (ville bryde ejer-reglen *"13 i alle evner → rating 13"*, som er hele grundlaget for D1).

**Ejer-beslutning:** tekniske/mentale evner holdes på lav vægt i opskrifterne, og restspredningen accepteres indtil roden er rettet som sin egen sag.

**Ærlig konsekvens, målt:** restspredningen kan ikke komme under ~5-6 point med vej A. Bjergrytterens signatur er bjerg (median 5), baroudeurens er aggression (median 17); selv med taktik helt ude af baroudeur-opskriften lander han på 12,2 mod bjergrytterens 6,7. At presse ham længere ned kræver at aggression vejer så lidt at rollen holder op med at være genkendelig i tallet. Taktik beholdes derfor på vægt 1 hos baroudeuren — dens tematisk rigtige hjem, og R4 kræver at hver evne tæller mindst ét sted. Gaten R1 er sat til ≤6 point af netop den grund. **Den fulde lukning af spredningen afhænger af rod-fixet** (egen sag, se §7).

**2 — Caps-formningen halter efter opskrifterne.** *(uændret status)* `capsShapingWeights` beholder dagens vægte (D3), så positionering fortsat vokser som en neutral evne for alle. Når visnings-opskriften belønner positionering hos sprintere, er der en mismatch mellem hvad der tæller og hvad der vokser. At rette det nu ville flytte lofter = tredje rystelse. Foreslået: noteres som opfølgning i #3564-sporet, hvor loft-formningen alligevel er under arbejde.

---

## 7. Udskudt til egen sag: evne-skalaen selv

De 15 evner er ikke sammenlignelige indbyrdes (§1.7). Det er ikke kun et rating-problem — det er misvisende for spilleren i sig selv: en rytter der viser *"taktik 38, bjerg 5"* ser ud til at være syv gange bedre til taktik, og det passer ikke. De to tal kommer fra to forskellige behandlinger, ikke fra to forskellige niveauer.

Årsagen er dokumenteret i `abilityDerivation.js`: de 10 fysiske evner køres gennem kontrast-forstærkning (`CONTRAST_ABILITIES`), mens descending, cobblestone, positioning, aggression og tactics bevidst holdes udenfor, fordi de er skill-stat-drevne og ikke en del af mætnings-problemet forstærkningen løste.

Ejer-beslutning 13/8: **ikke i denne omgang.** Et rod-fix ændrer eksisterende rytteres viste evne-tal og er dermed den tredje rystelse #3458 Del C forbyder. Det tages op som sin egen sag, med sin egen kommunikation — og det bør ske før der tilføjes nye evner, så en ny evne fødes ind på en skala der holder.
