# Race Engine v4: intra-etape-motoren + rute-SSOT (design-spec)

**Status:** EJER-GODKENDT 2026-08-20 (16 designvalg besluttet i designrunden, se §8) · byg i gang
**Ejer-mandat:** "Vi skal vel bare starte på at lave en motor hurtigst muligt, som beregner etapen undervejs" (17/8) + "Den bedste langsigtede løsning. Ikke lappeløsninger men fantastiske løsninger. Realistisk, minde om cykelsporten fra virkeligheden, skubbe standarderne for managerspil" (20/8).
**Fundament (bygger ovenpå, sletter intet):** #3855 (v4-issuet) · #2410-spec (tidslinje-kontrakten, `docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md`) · v3-depth-specen (`2026-07-11-race-engine-depth-credibility-design.md`) · parcours-arketype-specen (`2026-06-28-realistic-race-parcours-archetype-design.md`) · #2768 (løbsmotor-epic) · #2416 (udbrud v2, jagt-interesse).
**Regel:** design-planer slettes aldrig; denne spec er SSOT for v4 indtil den afløses.

---

## 1. Hvorfor nu: spillerne har fundet motorens arkitektur

De seneste 14 dages feedback (fuld opsamling i sessionen 20/8) peger på ét mønster, ikke tre bugs:

| Symptom | Evidens | Issue |
|---|---|---|
| Nedkørsel: evne korrelerer ikke med udfald ("randomly rolled dice") | Rytter 19 point dårligere i descending slår den bedre; først-over-toppen taber 7 s | #3426 (18/8-evidens) |
| Punch: først over toppen vinder næsten aldrig | 3 etaper i træk, samme mønster, to spillere uafhængigt | #3965 |
| Sprint: feltet mangler sammenhæng | Målt: 0,6-6,7 % af feltet får vinderens tid (virkelighed: 80-95 %); GC-kaptajner taber median 7 s pr. flad etape | #3917 (bekræftet 18/8) · #2525 |
| Vægt-transparens: viste vægte summer til 88 % | Spillerne regner selv efter og finder hullet | #3149 |

Rod-årsagen er fælles og arkitektonisk: motoren er en **single-shot scorer** (én `finalScore` pr. rytter, `raceSimulator.js:599`-flowet), gab afledes pr. rytter som glat funktion af score-underskud (`gapFor`), og alt "undervejs" digtes baglæns (`raceTimeline.js` syntetiserer filmen). Der findes **ingen gruppe-tilstand**: ingen model for "de kom over toppen sammen", "feltet kom samlet ind" eller "forspringet holdt til mål". Jo mere vi viser spillerne (race-film, Final Kilometre, synlige vægte), jo tydeligere bliver modsigelsen mellem film og resultat.

Konklusion: præsentationslaget har overhalet motoren. v4 vender det om, så **løbsforløbet ER beregningen**, og resultatet blot er dets sidste linje.

## 2. Vision og standard

Målet er ikke "PCM i browseren" men noget genren ikke har:

1. **Løbet beregnes forlæns.** Udbrud, forspring, selektioner, angreb, kollaps og indhentninger OPSTÅR i simulationen, segment for segment. Filmen er ikke en renderer af et facit; facit er filmens slutning.
2. **Forklarlig og efterprøvelig.** Hvert event har årsag i klartekst (jagt-interesse, gradient, work-cost, dagsform). Seed + input → samme løb, bit for bit. Provably fair (v3 §10-arven).
3. **Virkeligheden som kalibreringsanker.** Gap-fordelinger, win-rates, udbruds-rater og felt-sammenhæng måles mod virkelige cykelsports-tal, ikke mod interne vaner (ejer-direktiv 6/8: "følg virkeligheden").
4. **Ruten er en førsteklasses aktør.** Stigninger med længde/gradient, nedkørsler, brosten-sektorer, vejr og vind-eksponering: motoren læser den FAKTISKE rute, og kalenderen genereres fra samme rute-model. Én SSOT deles af motor, kalender, profil-grafik og hjælpetekster.
5. **Taktik man kan mærke.** Spillerne skal både KUNNE påvirke løbet og FØLE at de gør det (ejer 20/8), med bounded bidrag så én spillers valg aldrig kan vælte et løb. Taktik-UI/UX er sit eget design-spor med mockups.

Benchmark-løftet fra v3-specen (§4) står ved magt og skærpes: PCM kan vise et løb men ikke forklare eller genafspille det; FM/OOTP kan forklare men ikke vise. v4 gør begge dele i samme artefakt.

## 3. Arkitektur

### 3.1 Rute-model v2 (input-laget, deles med kalenderen)

`race_stage_profiles` udvides fra profil-type + demand-vektor til en **segmentliste**:

```
route = {
  distance_km, profile_type, finale_type,          // uændret (bagudkompatibelt)
  segments: [                                       // NYT, ordnet, dækker [0, distance_km]
    { kind: 'flat'|'climb'|'descent'|'cobbles'|'rolling',
      from_km, to_km,
      // climb: category (HC/1/2/3/4), avg_gradient, top_elevation_m
      // descent: technicality (1-3)
      // cobbles: sector_name, stars (1-5)
    }, ...
  ],
  weather: { kind: 'sun'|'rain'|'wind'|..., wind_exposure },   // NYT vejr-lag (seeded)
  waypoints: [ ... ]                                // KOM/spurt-punkter, uændret kontrakt
}
```

- **Rute-bibliotek pr. løb (ejer-valg 20/8):** hvert katalog-løb får **2-4 faste, kuraterede rutevarianter** som sæsonerne roterer imellem, i stedet for fri generering pr. sæson. Varianterne genereres arketype-tro én gang, kurateres (monumenter håndslibes: Enfer du Nord ER 280 km med 5-stjernede sektorer) og LÅSES. Genkendelighed hvor det tæller, variation via rotationen.
- **Generatoren** (`raceStageProfileGenerator.js`, arketype-laget fra 28/6-specen) producerer segmentlisterne deterministisk. `GENERATOR_VERSION` bumpes; eksisterende kolonner består, så alle nuværende aftagere kører uændret.
- **Kalender-symbiosen:** S4-sæsonbuen bygges kurateret (ejer-ja 20/8): belgisk åbningsuge med brosten+punch (sektorer med reel vægt 15-20 %, #3864), to brosten-peaks, løbs-identiteter. ITT-pakken udvides (ejer-ja 20/8): kuperet ITT, bjerg-ITT, prolog-arketype + dublet-værn i kalender-genereringen.
- Etaper uden segmentdata (legacy) får en syntetiseret segmentliste afledt af profil-typen (deterministisk), så v4 kan simulere ALT fra dag 1.

### 3.2 Tilstandsrum: grupper som kernebegreb

Simulationens tilstand mellem segmenter:

```
state = {
  groups: [ { id, kind: 'breakaway'|'peloton'|'chase'|'gruppetto'|'solo',
              rider_ids, gap_seconds (til front), cohesion } ],
  riders: { [id]: { group_id, energy, position_in_group, dayform, incidents } },
  km, virtual_gc
}
```

- **Tider tildeles pr. gruppe, rent princip (ejer-valg 20/8):** alle i en gruppe får gruppens tid i mål; finale-opgøret skiller kun placeringer (+bonussekunder). Tidstab KRÆVER et forklaret split. Fixer #3917/#2525 strukturelt.
- **Splits er events med årsag:** selektion på stigning (gradient × klatre-underskud × energi), nedkørsels-angreb, brosten-kaos (sector-stars × cobblestone), sidevind/vejr, udmattelse (distance→energi, monument-effekten).
- **Monotoni-garanti (hårdt krav):** inden for samme gruppe kan en dårligere rytter aldrig TAGE tid på en bedre i den evne segmentet tester. Støj afgør hvor meget en forskel slår igennem, aldrig fortegnet.

### 3.3 Segment-loop (event-drevet)

Pr. segment: (1) opdater energi (gradient, læ i gruppen, work-cost fra roller), (2) afgør segment-events (angreb, selektion, styrt med km-mærke), (3) opdater gruppestruktur og gaps, (4) emitter tidslinje-events. Udbruddets skæbne styres af **jagt-interesse-modellen fra #2416** (foldes ind som v4's udbrudsmekanik): sprinterholds interesse, GC-trussel, udbruddets motorstyrke, rest-km, plus spillerens udbruds-ordre (§4-M5).

### 3.4 Output: tidslinje-kontrakten nativt

v4 emitterer **præcis** `race_stage_timelines`-kontrakten fra #2410-specen (samme taksonomi, bumpet `timeline_version`), plus `race_results`/`race_stage_passages`/moments i uændrede formater. Aftagerne (Race Centre, løbsfilm, recap, Discord, OG-kort) kan ikke se format-forskel, kun ægthed.

### 3.5 Determinisme og fairness (ufravigelige, arvet fra v3)

- Seeded rng-strøm pr. mekanik (`stableSeed(salt:kind:...)`), per-rytter-hash hvor én tilmelding ikke må flytte andres udfald.
- Samme seed + input → samme løb, byte for byte; `ENGINE_VERSION` bumpes; runs stempler version.
- Idempotent persistering (delete-then-insert pr. etape), commit-reveal-salt-mønstret består.
- Fog-gaten (#1791): tidslinjen eksponerer aldrig rå komponenter eller vægte.

## 4. Mekanik-katalog (ejer-godkendt scope, 20/8)

| # | Mekanik | Beslutning |
|---|---|---|
| M1 | Gruppedannelse + gruppe-tider (rent princip) + finale-opgør | ✅ ind |
| M2 | Stignings-selektion (gradient/længde/energi) | ✅ ind |
| M3 | Nedkørsel v2: monotoni-garanti + descent attack, **gevinst-loft 10-20 s** på T2-T3 ved stor evne-forskel, **risiko-koblet** (angreb nedad = let forhøjet styrt-risiko, dæmpes af descending) | ✅ ind |
| M4 | Punch-finale: forspring over toppen bæres eksplicit ind i finalen | ✅ ind |
| M5 | Udbrud v2: jagt-interesse + **spiller-ordre** ("kør udbruddet ind"/"lad det gå", bounded bidrag) | ✅ ind |
| M6 | Sprint-tog: leadout-roller flytter position i finale-opgøret | ✅ ind |
| M7 | Distance-slid: monument-effekt (250 km+ dræner finalen) + dag-til-dag-slid i etapeløb, båret af endurance | ✅ ind, begge |
| M8 | Brosten-sektorer med reel vægt (15-20 % på udvalgte punch-etaper) | ✅ ind |
| M9 | Bonussekunder: 10/6/4 i mål + 3/2/1 ved indlagte spurter, bounded så bjerg stadig dominerer GC | ✅ ind fra start |
| M10 | Incidents med km-mærke + **3 km-reglen** (styrt sidste 3 km på flade etaper = gruppens tid, kun placering ryger; ingen regel på bjergetaper) | ✅ ind |
| M11 | Vejr-lag pr. etape (seeded): regn forstærker T2-T3-/brosten-risiko og descent attack-risikoen; fundament for sidevind/vifter (#2476) | ✅ ind |
| M12 | Effort-styring pr. rytter pr. etape (protect/normal/save) | ✅ ind i v1 (ejer-valg: fuld pakke) |

**Nye stats (ejer-valg 20/8, alle tre ind):** fødes få og skjulte først (ingen tredje typerystelse, jf. #3458):
- **Dagsform-stabilitet:** hvor bredt rytterens dagsform svinger (stabil arbejdshest vs. boom-or-bust). Styrer variansbredden, spiller direkte sammen med dominans-båndet.
- **Vejr-teknik:** regn/kulde-håndtering; kobles til M11.
- **Højde-tolerance:** præstation over ~1800 m; segmenterne kender højden.

**Stående ordre (ejer 20/8):** foreslå løbende nye stats når motor-/rutearbejdet gør dem meningsfulde.

v3-søjlerne (roller/work-cost, dagsform, jour sans, form-peaks, why-rapport) genbruges som komponenter i energi- og beslutningsmodellen. Intet kalibreringsarbejde smides væk: det bliver mål-ankre (§5).

## 5. Kalibrering: simulér-før-ship med virkeligheds-ankre

Stående doktrin gælder fuldt: intet shippes uden dry-run-harness mod ægte population + scorecard med ejer-go. v4's scorecard ankres i **virkelighedens tal** (primært) med de eksisterende gate-bånd som regressionsvagt (sekundært):

| Anker | Mål | Kilde |
|---|---|---|
| Felt-sammenhæng, flade etaper | 80-95 % af feltet på vinderens tid | #3917-målingen (i dag 0,6-6,7 %) |
| Nedkørsels-gaps vs. summit-gaps | ratio ≤ 0,5 ved p5-p10; 18/32/46/63-niveauet | #3426-målingen (må ikke regressere) |
| Descent attack | gevinst ≤ 10-20 s, kun ved stor evne-forskel på T2-T3; aldrig omvendt fortegn i samlet gruppe | ejer-valg 20/8 |
| Punch-korrelation | punch-evne rangkorrelerer målbart med placering på punch-etaper | #3965-harnesset |
| Felt-favoritters win-rate | **25-40 %** (ejer-valg 20/8; i dag 80-88 %) — styrken bevares: flest sejre/podier over sæsonen | v3-spec §2 |
| Udbruds-rater pr. terræn | gate-bånd ± ejer-godkendt justering; descent-dominansen (54 %) ned | race:gate + #3426 |
| Samme-hold-top-10 | 4+ fra samme hold i top 10 sjældent (< 3 %) | v3-spec §2 |
| Type-integritet | sprinter-vinderrate på flat ≥ 90 %; ITT-korrelation synlig | race:gate + #3149 |
| Bonussekunder | GC-effekt bounded (maks ~10 s/etape); bjergafgørelser dominerer stadig GC | #2413-kravet |

Golden fixtures mod ægte population + determinisme-tests (bit-identitet ved samme seed) fra dag 1. #3917-/#3426-målescripterne genbruges som før/efter-instrument.

## 6. Cutover-strategi (ejer-valg 20/8: flip i S3)

1. **v4 bygges ved siden af** (`backend/lib/engine/v4/`), rører aldrig `raceSimulator.js`-stien. Flag `race_engine_v4`.
2. **Skyggekørsel som verifikation:** fra tidligst muligt i S3 simulerer v4 hver afviklet etape parallelt (samme seed/startfelt); resultater + tidslinjer persisteres admin-only. Dagligt sammenlignings-scorecard.
3. **Ejer-gate på scorecard + håndplukkede skygge-film** (bjergetape, massespurt, udbrudssejr, nedkørselsfinale) set med egne øjne.
4. **Flag-flip MIDT i S3** når scorecardet er grønt og ejeren siger go (ejer-valg 20/8; fravalgt: vente til S4-start). Flippet lægges på en hviledag/mellem etapeløbs-blokke så fysikken ikke skifter midt i et igangværende klassement. Kill-switch tilbage til v3 består sæsonen ud. Stor patch note + hjælpetekst-opdatering (en+da) ved flip.

## 7. Milepæle

- **F0 ✅ (20/8):** Spec ejer-godkendt via designrunde (16 valg, §8).
- **F1 Rute-SSOT:** segmentmodel + vejr-lag + generator-opgradering + legacy-syntese + rute-bibliotek-fundament (2-4 varianter pr. løb). Kalender-sporet (S4-sæsonbue, ITT-pakke, #3864) bygger mod samme model.
- **F2 Motor-kerne:** segment-loop, gruppe-tilstand, M1-M4, tidslinje-emission, golden fixtures + determinisme-tests.
- **F3 Mekanik-bølge:** M5-M12 i parallelle worktrees (hver mekanik eget internt flag, egen harness-linse).
- **F4 Skygge-mode:** runner-hook, skygge-tabeller, dagligt sammenlignings-scorecard (merges efter 23/8-cutoveret).
- **F5 Kalibrering i S3** → ejer-gate → **F6 flag-flip i S3** (hviledag) → S4: kurateret sæsonbue på rute-biblioteket.
- **Sideløbende quick-win:** #3149-transparens-fix på NUVÆRENDE motor (vægte summer til 100 %) — ejer-ja 20/8, uafhængig leverance.
- **Taktik-UI/UX:** eget design-spor med mockups (ejer-krav 20/8: spillerne skal kunne påvirke OG føle det; bounded bidrag).

## 8. Beslutningslog (ejer, designrunden 20/8)

| # | Spørgsmål | Beslutning |
|---|---|---|
| 1 | Rute-modellens dybde | Fuld segmentliste, km-dækkende |
| 2 | Løbs-identitet | Rute-bibliotek: 2-4 faste kuraterede varianter pr. løb, sæsonerne roterer |
| 3 | Sæsonbue | Kurateret fra S4 (åbningsuge, brosten-peaks, løbs-identiteter) |
| 4 | Enkeltstarter | Fuld pakke: kuperet ITT + bjerg-ITT + prolog + dublet-værn |
| 5 | Felt-tider | Rent gruppe-princip: samme gruppe = samme tid |
| 6 | Descent attack-loft | 10-20 s, kun T2-T3 + stor evne-forskel; monotoni-garanti |
| 7 | Nedkørsels-risiko | Koblet: angreb nedad = let forhøjet styrt-risiko, dæmpet af descending |
| 8 | 3 km-reglen | Ind (flade etaper; ikke bjerg) |
| 9 | Udbruds-ordre | Ind, + taktik-UI/UX som eget design-spor (kunne påvirke OG føle det; bounded) |
| 10 | Dominans-bånd | Felt-favorit win-rate 25-40 % |
| 11 | Bonussekunder | Fuld pakke fra start (10/6/4 + 3/2/1 indlagt) |
| 12 | Distance-slid | Begge dele (monument + dag-til-dag), båret af endurance; stående ordre: foreslå nye stats løbende |
| 13 | Nye stats | Alle tre: dagsform-stabilitet, vejr-teknik (+vejr-lag), højde-tolerance — fødes skjulte |
| 14 | Taktik v1 | Roller + ordrer + fuld effort-styring (protect/normal/save) |
| 15 | Cutover | Flag-flip midt i S3 ved grønt scorecard + ejer-go (på hviledag); skygge-kørsel som verifikation |
| 16 | #3149-transparens | Fix nu på nuværende motor |

## 8b. Addendum: designrunde 2 (ejer, 20/8 aften) — fundament-beslutninger fra GitHub-plan-sweep

Sweep af alle tidligere race-engine-planer fandt fire modne planer der foldes ind i v4, plus fire fundament-valg:

| # | Spørgsmål | Beslutning |
|---|---|---|
| 17 | Energimodel | **W'/Critical Power-fysiologi fra dag 1** (#2479 foldes ind som v4's energimodel: CP-tærskel + anaerob reserve, tæring/genopladning i segment-loopet; på sigt spiller-synlig reserve — genre-first) |
| 18 | Race↔træning | **Løbsdags-kontrakten (#3459) ind fra F2**: v4 emitterer per-rytter belastning (W'-tæring, tid over tærskel) som trænings-/udviklingssystemet forbruger; racing = dagens arbejde; AI kører samme motor |
| 19 | Live-afvikling | **Byg til live, ship trinvist**: arkitekturen designes til progressiv afvikling (segment-state + afspilnings-API); flippet shipper on-demand-film, live-reveal tændes som opfølgning |
| 20 | Persistering | **Events + kompakte per-segment gruppe-snapshots** (muliggør live-reveal, replay, karriere-stats som "km i udbrud", motor-vs-faktisk #1294) |
| 21 | TTT | **M13: ægte TTT i v1** på gruppe-modellen (#2412/#3463 lukkes ind) |
| 22 | AI-taktik | **M14: adaptiv, forklarlig AI-holdtaktik i v1** (#2478): AI bruger PRÆCIS samme ordre-API som spillere; harness-gate: mere troværdig, ikke stærkere |
| 23 | Kalibrerings-UI | **Admin-dashboard i F4**: gap-realisme-scorecard (#2415, IRL-målbånd m. kilder) + skygge-sammenligning v4/v3/faktisk + seed-preview (#1294); ML-forslag (#2480) senere |
| 24 | Kodefundament | **Fuld TypeScript + ren kerne**: engine-pakken (backend/lib/engine/v4/ el. packages/engine) er 100 % ren og IO-fri — én deterministisk funktion (rute, startliste, ordrer, seed) → (tidslinje, resultater, belastninger); al DB/IO i adaptere udenfor. Strict TS, hver mekanik (M1-M14) eget modul m. typet kontrakt + kontrakt-tests, property-based tests af invarianter (determinisme, monotoni, gruppe-tider), worker-thread-parallelisering forberedt. Valgt på "2-3.000 managers / top professionelt"-kriteriet |

Konsekvens for §5: gap-realisme-båndene fra #2415 (GT-vindermargin 1-8 min, bjerg-top-10 ≤ 3-4 min, ITT 1-3 min/40 km, flad = felt-finish) indgår i scorecardet med kilder. Konsekvens for §7: F2 omfatter engine-pakkens TS-skelet + W'-kernen; F4 omfatter dashboardet.

## 8c. Addendum: cutover revideret (ejer, 21/8)

| # | Spørgsmål | Beslutning |
|---|---|---|
| 25 | Cutover-timing | **v4 sigter mod LIVE fra S3's første løbsdag (tir 25/8)** i stedet for flip midt i S3. Erstatter beslutning 15's timing; gaten består i komprimeret form: head-to-head-harness (v4 vs v3, hele S3-kalenderen offline, samme seeds/startlister, ægte population) scoret mod §5's virkeligheds-ankre + håndplukkede løbsfilm set af ejer. Grønt scorecard + ejer-go mandag aften → flip. **Rødt/gult → v3 kører tirsdag (fallback), v4 flipper første hviledag når grøn.** Kill-switch består. Ejerens rationale: skyggekørsel sammenligner mod v3, men v3 er ikke målestokken — virkeligheden er; motoren skal være bedre end den nuværende, ikke bare matche den. |
| 26 | #3965-dæmpning på v3 | Fravalgt — ingen balance-lapning af udbruds-bonus på nuværende motor; kræfterne går til v4 (jf. 25). |

Byggeplan: F2-kerne 21/8 → F3-mekanikbølge (M5-M14) 22/8 → head-to-head 23-24/8 → ejer-gate 24/8 aften.

## 9. Koordinering og afgrænsning

- **Rører ikke:** cutover-drejebogen 23/8, merge-toget 20/8, løn/økonomi-sporet (#4011/#4018), træningssporet (#3709). Skygge-mode-merge først efter cutover.
- **Absorberer:** #2416 (M5), #2413-scope (M9), #3864's sektor-del (M8/F1), motor-delene af #3426/#3965/#3917/#2525.
- **Fodrer:** #3856 (løbsfilm-backfill kan efter v4 køres med ÆGTE re-simulering), #2356 (recap v2), #1815 (Discord pr. etape).
- **Kalender-arbejdet** (S4-sæsonbue, ITT-pakke, #3547-rest, #3864) kører som selvstændigt indholds-spor mod F1's rute-model; ingen motor-afhængighed efter F1.
