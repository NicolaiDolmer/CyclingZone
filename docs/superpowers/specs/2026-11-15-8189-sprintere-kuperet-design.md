# Designoplæg: sprintere vinder for mange kuperede og bølgede etaper (#8189)

> Ejer-go 15/11 til et **designoplæg**, ikke en motorændring. Intet i motor eller generator er ændret i denne PR.
> Hard rule 17: alle målte andele, vægte og prototype-værdier står privat i
> `balance-internals/8189/2026-11-15-maaling.md` (og rådata `bench-*.json` samme sted). Her står kun retning og størrelsesorden i ord.
> Relateret: #4596 (rolling grupperet på flad- vs. bakke-siden), #4914 (v4-kalibrering), S5-specen `2026-10-12-s5-etapeprofiler-design.md`.

## 1. Problemet

En spiller skrev 14/11, at sprintere vinder de fleste kuperede etaper. Målingen på prod 15/11 (issue-kommentaren) bekræfter det for sæson 5:

- **Kuperet (`hilly`):** sprinter-typer vinder mange gange oftere end i sæson 4. Før var det sjældent; nu er det et almindeligt udfald.
- **Bølget (`rolling`):** sprinter-typer gik fra en lille minoritet til et klart flertal af sejrene.
- **Punchere og udbrud er næsten væk** på begge profiler. Udbruddet holder praktisk talt aldrig på bølget.
- Begge sæsoner kørte på v4. Springet følger de nye S5-etapeprofiler, ikke en motorændring.
- Forbehold fra målingen: ryttertypen er sat ud fra evnerne i dag, ikke på løbsdagen.

Det strider mod to ejer-godkendte mål i `docs/RACE_ENGINE_RULES.md` ("Udbrudsmål"): udbruddet skal vinde en mærkbar del af de rullende etaper og en betydelig del af de kuperede. Begge ligger i dag under båndet, også i den offline bench (afsnit 4).

## 2. Rodårsagen, efterprøvet i koden

Der er tre led. De forstærker hinanden; ingen af dem er alene hele forklaringen.

### 2a. Generatoren vælger flad spurt på de fleste kuperede og næsten alle bølgede etaper

`backend/lib/raceStageProfileGenerator.js:1436-1449` (`S5_FINISH_WEIGHTS`): afslutningen trækkes pr. terræn med vægte talt op fra benchmarken af Grand Tour-etaper 2021-2025 (`backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json`). På bølget er flad spurt næsten eneste mulighed; på kuperet er den den hyppigste enkeltafslutning. Bekræftet: de genererede S5-ruter i benchen har netop den fordeling.

To ting i benchmarken gør vægten for høj, set med spillets definitioner:

1. **Etaper med kun kat. 4 er talt som kuperede.** S5-reglen (spec §2, kort 5) siger "kat. 4 tæller aldrig mod kuperet". Benchmarken blev klassificeret før den regel, og omkring en femtedel af dens kuperede etaper har kun kat. 4-stigninger (flere er noteret som "rule artefact" i fixturen). Over halvdelen af dem endte i flad spurt. De trækker flad spurt-vægten op på kuperet.
2. **"Flad spurt" i benchmarken dækker tre forskellige løb.** Klassifikationen ser kun på, hvordan etapen sluttede, ikke hvem der spurtede. Blandt benchmarkens kuperede flade spurter (efter punkt 1) har knap halvdelen et stort tidsgab til nr. 10, dvs. et udbrud eller et splittet felt spurtede om sejren, ikke et samlet felt. Specen bestemte at "flad spurt afløser massespurt + reduceret spurt (feltets størrelse er motorens udfald)" og at udbrud er motoradfærd, ikke en afslutning. Det forudsætter, at motoren selv laver de udbrud og reducerede spurter. Det gør den ikke (2b).

**Bølget er et særtilfælde.** Under S5 er bølget defineret som "2 × kat. 4" (spec §2). Benchmarkens bølgede etaper er alle flade etaper med to kat. 4, og de genererede bølgede ruter har kun kat. 4 med sidste top langt fra mål. Sådan en etape er i virkeligheden en sprinterdag. I sæson 4 var "rolling" noget andet: en udbrudsdag med høj tilfældighed og udbrud som hyppigste finale (#4596). Spillernes oplevelse af "bølget" stammer fra den gamle betydning. **Det er en definitionsændring, ikke kun en balancefejl**, og den kræver et ejervalg (afsnit 5).

### 2b. Motoren kører flad spurt som en fuld massespurt, uanset hvor hård dagen var

Under `s5_profiles_v1` og senere arver `flat_sprint` massespurtens række overalt, også på kuperet efter flere kat. 2-3-stigninger:

| Sted | Hvad det gør |
|---|---|
| `backend/lib/engine/v4/tuning.ts:149` | Placerings-demand = massespurtens (sprint, acceleration, position, flad). Ingen udholdenhed og ingen punch. |
| `tuning.ts:1080-1099` (`S5_PROFILES_TUNING.finaleBase`, `hybridWeight`) og `s5Profiles.ts:192` (`s5FinaleDemandVector`) | Hybriden der flytter vægt til durability efter antal tidligere stigninger, gælder kun mur, bakke og stigende spurt. Flad spurt får den ikke (spec §4: "uændret: flad spurt"). En spurt efter fire kat. 3 belønner præcis det samme som en spurt efter en flad dag. |
| `tuning.ts:904` og `tuning.ts:1035` | Sprinterholdenes jagtinteresse = massespurtens maksimum (`finaleTypeChaseWeight`, under `official_times_v3` `stageWinFinaleWeight`). |
| `tuning.ts:986`, `:992`, `:1053` | Jagt-gulvet på flad/bølget: feltet kommer sjældent for sent på en flad spurt (samme lave lodtrækning som massespurt). |
| `tuning.ts:935` | Lad-gå-loftet på bølget er lavt, tæt på brostens. |
| `tuning.ts:1125` (`lateAttack.excludedFinales`) | Det sene soloangreb (#6368, motorens erstatning for udbrudsfinalen) er slået fra på flad spurt, også på kuperet og bølget. |
| `s5Profiles.ts:36-40` (`S5_LEGACY_FINALE`) og `:46-56` (`S5_TERRAIN_FINALE`) | Ældre revisioner oversætter flad spurt til `bunch_sprint`. Under S5 bliver en gammel "breakaway"-finale på bølget og kuperet til `punch`, men en flad spurt forbliver flad spurt. |
| `finale.ts:80` og `:134` | Flad spurt er en samlet feltopgør; på bølget tæller feltets antal i finale-jagten (som på flad). |
| `ai/aiTactics.ts:248` og `mechanics/breakaway.ts:1256` | AI-holdene ser dagen som en sprintdag (sprint-kaptajn, angreb på tempo), og dagens vinderkrav er ren sprint. |

Konsekvensen i benchen: en kuperet etape med flad spurt vindes næsten altid af en sprinter, og udbruddet holder næsten aldrig. Det matcher prod.

### 2c. Hvad der ikke er årsagen

- Selve klatre-selektionen er ikke undersøgt i dybden her. Benchen viser, at sprinterne overlever kat. 3-stigninger langt fra mål; om det er realistisk, afhænger af stigningernes placering (sidste top ligger typisk 30-40 km fra mål i de genererede kuperede spurtetaper, hvor sprinterholdene i virkeligheden ofte kan samle feltet igen).
- Stigende spurt vindes også af sprintere, men det er bevidst (`S5_WINNER_EXPECTATIONS` i `backend/scripts/dev/s5MotorBench.mjs`) og realistisk.
- Balance-vagtens bånd-brud 15/11 måler noget andet (favoritsejre, samme hold i top 10).

## 3. Løsninger

Kronologi gælder for alle tre: **kørte etaper ændres aldrig**. Resultater, point og præmier fra allerede kørte etaper står. Spørgsmålet er kun, hvad der sker med etaper der er genereret, men ikke kørt.

### A. Ret afslutningsvægtene for kuperet (og evt. bølget) i generatoren

**Hvad ændres:** `backend/lib/raceStageProfileGenerator.js:1438-1442` (`S5_FINISH_WEIGHTS.rolling` og `.hilly`).
1. Tæl benchmarken op igen med kort 5's regel, så etaper med kun kat. 4 ikke tæller som kuperede (de hører til bølget eller flad).
2. Flyt flad spurt-vægt til bakke, mur og nedkørsel, **ikke** til stigende spurt (den vindes også af sprintere, se afsnit 4).
3. Bølget: kun hvis ejeren vælger, at bølget skal være mere end "flad med to kat. 4" (afsnit 5). Ellers urørt.

**Forventet virkning:** færre kuperede spurtetaper, flere bakke-/mur-afslutninger hvor punchere vinder. Sprinter-andelen på kuperet falder mærkbart, men ikke til sæson 4-niveau, fordi de tilbageværende flade spurter stadig køres som massespurt. Udbrudsandelen ændrer sig næsten ikke.

**Risiko:** lav for motoren (ingen motorkode). Generatoren skal stadig bestå kalender-gaterne (K-B-komposition, §7b-finalebånd, benchmark-gaten i `s5BenchmarkGate.js`, `seasonCalendarGatesOffline.mjs`) og golden-fixturerne for S5-generatoren. Afslutningsvægtene er en kalibrering mod den virkelige benchmark; at afvige fra den kræver en begrundelse (punkt 1 er en ren rettelse, punkt 2 er et skøn).

**Allerede genererede etaper i den aktive sæson:** ingen ændring. Vægtene bruges kun når en rute genereres. Den nuværende sæsons ruter står (de er offentliggjort i kalenderen). Virkningen kommer i næste sæsons kalender, medmindre ejeren beslutter en regenerering af ikke-kørte etaper (et destruktivt prod-indgreb, ejer-gated og med live-gennemsyn først).

**Måling:** `s5MotorBench` (scope all) før/efter: afslutningsfordeling pr. terræn, vindertype og udbrudssejre på kuperet og bølget; plus benchmark-gaten og kalender-gaterne grønne.

### B. Lad motoren køre en flad spurt efter en hård dag som en reduceret spurt

**Hvad ændres** (bag en ny regel-revision, fx `s5_profiles_v4`; ældre revisioner bit-identiske, bevist mod en frossen kopi af merge-base, #7587):
1. `backend/lib/engine/v4/s5Profiles.ts:92-103` (`routeForRulesRevision`): en flad spurt på kuperet (og evt. bølget) efter mindst N tidligere kategoriserede stigninger (`priorCategorizedClimbs`, findes allerede) behandles som reduceret spurt.
2. Demand: giv flad spurt samme hybrid som de korte eksplosive afslutninger (`tuning.ts:1080-1099`, `s5Profiles.ts:192`), så udholdenhed tæller mere jo hårdere dagen var. En flad etape (0-1 stigninger) er uændret.
3. Jagt: sænk sprinterholdenes interesse og jagt-gulvets sikkerhed for den hårde spurt (`tuning.ts:904`, `:992`, `:1035`, `:1053`), og tillad det sene angreb (`tuning.ts:1125`).
4. AI-taktik: en hård spurtdag er ikke en ren sprintdag (`ai/aiTactics.ts:248`), så AI-holdene også prøver udbrud og punch-kaptajner.

**Forventet virkning:** færre rene sprintere i mål efter de hårde dage, flere sejre til sprintere med udholdenhed, punchere og udbrud. Det er tættest på virkeligheden (afsnit 5).

**Risiko:** mellem til høj. Det er en motorændring på kuperet og bølget, som rører jagt, udbrud, AI-taktik og finalen på én gang (#4596 advarer mod at flytte flere variable samtidig). Den kræver Fable-dom før merge (motor), testport-kørsel med prod-startlister, og ejerens "tænd". Prototypen i afsnit 4 viser desuden, at punkt 1 og 3 alene **ikke** bringer udbruddet tilbage; udbrudsdannelsen på spurtdage skal undersøges for sig (afsnit 4, "Hvad benchen ikke dækker").

**Allerede genererede etaper i den aktive sæson:** ruterne ændres ikke. Revisionen følger release-princippet: et løb bundet til `s5_profiles_v3` kører færdig på den; kun løb hvis første etape køres efter tændingen, får den nye adfærd. Kørte etaper røres aldrig.

**Måling:** `s5MotorBench` + `motorTestport.mjs --candidate=<ny revision>` mod de kommende løb: vindertype pr. profil og afslutning, udbrudssejre mod RULES-båndene, og de eksisterende gates (G2, G2F, gcFromBreakaway) uændret grønne.

### C. Begge (A for kuperet nu, B som motor-spor)

**Hvad ændres:** A's rettelse i generatoren (kuperet), plus B bag en ny revision.

**Forventet virkning:** størst samlet effekt på sprinter-andelen; A tager mængden, B tager de tilbageværende hårde spurter. I prototypen gav C den laveste sprinter-andel på begge profiler.

**Risiko:** summen af A og B, men de kan landes hver for sig og måles imellem (A er en generator-PR uden motorkode; B er en motorrevision).

**Allerede genererede etaper:** som A og B: intet ændres for kørte etaper; A virker fra næste kalender, B fra løb startet efter tændingen.

**Måling:** som A og B, med en måling mellem de to trin.

## 4. Måling i den offline bench (kørt 15/11)

Repoet har en offline motor-bench: `backend/scripts/dev/s5MotorBench.mjs`. Den genererer S5-ruter lokalt med generatoren og kører v4 under `s5_profiles_v3` på det anonymiserede Giro-felt (alle hold som AI-hold), uden database og uden netværk. Den måler pr. etape afslutning, terræn, udbrudssejr og vinderens ryttertype.

Kørt for hver løsning som en midlertidig, ikke-committet ændring (alle rullet tilbage), scope `all`, tre sæson-træk og to motor-seeds, kun løb med mindst én kuperet eller bølget etape. Prototyperne: **A** = flad spurt-vægt flyttet til bakke, mur og stigende spurt på kuperet og bølget; **B** = flad spurt på kuperet/bølget kørt som reduceret spurt; **C** = A + B; **B3** = B + mindre jagt på den reducerede spurt. Tallene står privat; her retningen:

| Variant | Sprintere på kuperet | Sprintere på bølget | Punchere | Udbrudssejre |
|---|---|---|---|---|
| I dag | en stor del af etaperne; næsten alle kuperede flade spurter | næsten alle | få | under RULES-båndet på kuperet, nul på bølget |
| A | mærkbart færre | færre, stadig klart flertal | flere (bakke-/mur-etaperne) | uændret |
| B | lidt færre | lidt færre | uændret | uændret |
| C | færrest | færrest, stadig flertal | flere | uændret |
| B3 | som B | som B | uændret | uændret |

Det benchen viser:

1. **Benchen gengiver problemet** (endda skarpere end prod: et rent AI-felt).
2. **Generator-vægtene (A) flytter mest.** Men den del af vægten der flyttes til stigende spurt, går stadig til sprintere. Den endelige A skal flytte til bakke, mur og nedkørsel.
3. **At omdøbe den hårde spurt til reduceret spurt (B) hjælper kun lidt**, og mindre jagt oveni (B3) ændrer næsten intet. Udbruddet kommer ikke tilbage af jagt-knapperne alene.
4. **Udbruddet er nul på bølget i alle varianter.** Årsagen er ikke jagten i finalen, men at udbruddet ikke får et forspring på en spurtdag (dannelse, AI-holdenes udbrudsvilje på sprintdage, lad-gå-loftet på bølget). Det er et selvstændigt spor.

**Hvad benchen ikke dækker:**
- Feltet er ét anonymiseret Giro-felt med kun AI-hold. Menneskeholdenes udbrudsvilje (#6804 P0) er ikke med; prod-felter i lavere divisioner er bredere.
- Ryttertypen er benchens egen z-score mod feltet, ikke prod's klassifikation.
- Prototyperne er grove (én værdi pr. knap, ingen kalibrering) og er ikke forslag til de endelige værdier.
- Ingen af de eksisterende gates (testporten, kalender-gaterne, golden-fixturerne) er kørt mod prototyperne.

**Måling der skal bygges før B kan dømmes:** `motorTestport.mjs` med `--synthetic-field` og `--breakaway-intent=prod` (eller `--intent-rates` fra en tidligere kørsel) og en rapport pr. profil × afslutning med vindertype og udbrudssejre mod RULES-båndene. Benchen bør desuden få en "vindertype pr. profil"-dom for kuperet og bølget med private tærskler, ligesom den har for stigende spurt og bjergtop i dag.

## 5. Sammenligning med virkelig cykelsport (skøn markeret)

- **Bølget = flad med to-tre kat. 4 og sidste top langt fra mål:** i virkeligheden en sprinterdag; sprintere vinder de fleste. Benchmarkens bølgede etaper siger det samme. **Skøn:** dagens sprinter-dominans på S5-bølget er tæt på virkeligheden for netop den rutetype. Udbrud vinder dog af og til (RULES-båndet er ikke nul), og det gør de ikke i spillet.
- **Kuperet med kat. 3/kort kat. 2 og spurt:** i virkeligheden ender en del i en reduceret spurt, hvor de rene sprintere er sat af, og vinderen er en sprinter med udholdenhed eller en puncher; en anden del vindes fra udbruddet. Benchmarken viser, at knap halvdelen af de kuperede "flade spurter" havde et udbrud eller splittet felt foran. **Skøn:** sprintere bør vinde en minoritet af de kuperede etaper, og de rene sprintere sjældnere end de hurtige allroundere.
- **Punchere:** virkelighedens kuperede etaper har en tydelig andel bakke- og mur-afslutninger. **Skøn:** punchere bør vinde langt oftere end i dag på kuperet.

## 6. Anbefaling

**C i to trin, med et ejervalg om bølget først.**

1. **Ejervalg om bølget** (ét spørgsmål): skal "bølget" være (a) S5's definition, en sprinterdag med småbakker, hvor spillet så forklarer det tydeligt (etapekort og Hjælp), eller (b) ejerens retning fra #4596, en udbrudsdag mellem kuperet og mellembjerg? Anbefaling: **(a) nu**, fordi rutetypen faktisk er en sprinterdag, og (b) kræver nye ruter (flere og hårdere stigninger) og en ny terrænregel. Udbruddets nul på bølget skal rettes under begge valg.
2. **Trin 1 (A, generator, lav risiko):** tæl benchmarken op igen med kort 5's regel og flyt kuperet flad spurt-vægt til bakke, mur og nedkørsel. Virker fra næste sæsons kalender; kørte og genererede etaper i den aktive sæson røres ikke.
3. **Trin 2 (B, motorrevision, Fable-dom):** den hårde spurt som reduceret spurt med durability-hybrid, plus et selvstændigt udbruds-spor for spurtdage på kuperet og bølget (dannelse og lad-gå, ikke kun jagt). Måles i testporten med prod-startlister før ejerens "tænd".

Begrundelse: A er en rettelse af en klassifikationsfejl og flytter mest for mindst risiko. B er nødvendig for at ramme udbrudsmålene og virkeligheden, men prototypen viser, at det ikke er nok at ændre finale-typen; udbruddet skal designes for sig. B skal ikke bygges før A er målt.
