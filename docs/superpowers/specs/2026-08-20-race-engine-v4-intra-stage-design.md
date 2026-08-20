# Race Engine v4: intra-etape-motoren + rute-SSOT (design-spec)

**Status:** Udkast til ejer-gate (jf. #3855: spec før byg) · **Dato:** 2026-08-20
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
4. **Ruten er en førsteklasses aktør.** Stigninger med længde/gradient, nedkørsler, brosten-sektorer, vind-eksponering: motoren læser den FAKTISKE rute, og kalenderen genereres fra samme rute-model. Én SSOT deles af motor, kalender, profil-grafik og hjælpetekster.

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
      // climb: category (HC/1/2/3/4), avg_gradient
      // descent: technicality (1-3)
      // cobbles: sector_name, stars (1-5)
    }, ...
  ],
  waypoints: [ ... ]                                // KOM/spurt-punkter, uændret kontrakt
}
```

- **Generatoren** (`raceStageProfileGenerator.js`, arketype-laget fra 28/6-specen) producerer segmentlisten deterministisk fra arketypen. `GENERATOR_VERSION` bumpes; eksisterende kolonner består, så alle nuværende aftagere (profil-grafik, demand-visning) kører uændret.
- **Kalender-symbiosen:** S4-ønskerne fra #3547/#3864 bliver ren indholds-tuning i samme model: monument-distancer (Enfer du Nord 280 km flad m. 5-stjernede sektorer), kuperede enkeltstarter, brosten-sektorer på punch-etaper med reel vægt, belgisk åbningsuge. Kalender-arbejde og motor-arbejde rører aldrig hinandens kode igen; de deler data.
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

- **Tider tildeles pr. gruppe, ikke pr. rytter.** Alle i en gruppe får gruppens tid i mål; kun finale-opgøret (spurt/punch/angreb i sidste segment) skiller placeringer og evt. små gaps inden for gruppen. Det fixer #3917/#2525 strukturelt og gør "samlet felt" til default i stedet for undtagelse.
- **Splits er events med årsag:** selektion på stigning (gradient × klatre-underskud × energi), nedkørsels-angreb (descending-delta × technicality), brosten-kaos (sector-stars × cobblestone), sidevind (senere, #2476-krogen findes i segmentmodellen), udmattelse (distance→energi-dræn, monument-effekten).
- **Monotoni-garanti (nyt hårdt krav):** inden for samme gruppe kan en dårligere rytter aldrig TAGE tid på en bedre i den evne segmentet tester. Støj afgør hvor meget en forskel slår igennem, aldrig fortegnet. Det er det direkte svar på 18/8-evidensen i #3426.

### 3.3 Segment-loop (event-drevet, ikke fast tick)

Pr. segment: (1) opdater energi (gradient, vind i ryggen af gruppen, work-cost fra roller), (2) afgør segment-events (angreb, selektion, styrt m. km-mærke), (3) opdater gruppestruktur og gaps, (4) emitter tidslinje-events. Udbruddets skæbne styres af **jagt-interesse-modellen fra #2416** (foldes ind som v4's udbrudsmekanik, ikke et separat spor): sprinterholds interesse på flade finaler, GC-trussel fra udbryderne, udbruddets samlede motorstyrke, rest-km. "Hentet/holdt hjem" bliver en konsekvens med forklaring, ikke en terning.

### 3.4 Output: tidslinje-kontrakten nativt

v4 emitterer **præcis** `race_stage_timelines`-kontrakten fra #2410-specen (samme taksonomi, bumpet `timeline_version`), plus `race_results`/`race_stage_passages`/moments i uændrede formater. Aftagerne (Race Centre, løbsfilm, recap, Discord, OG-kort) kan ikke se format-forskel, kun ægthed: gap-kurven er nu målt i simulationen, catch-punktet er hvor indhentningen faktisk skete, og "først over toppen" i filmen ER den rytter der førte gruppen over.

### 3.5 Determinisme og fairness (ufravigelige, arvet fra v3)

- Seeded rng-strøm pr. mekanik (`stableSeed(salt:kind:...)`), per-rytter-hash hvor én tilmelding ikke må flytte andres udfald.
- Samme seed + input → samme løb, byte for byte; `ENGINE_VERSION` bumpes; runs stempler version.
- Idempotent persistering (delete-then-insert pr. etape), commit-reveal-salt-mønstret består.
- Fog-gaten (#1791): tidslinjen eksponerer aldrig rå komponenter eller vægte.

## 4. Mekanik-katalog (byggeklodser i prioriteret orden)

| # | Mekanik | Fixer | Kilde |
|---|---|---|---|
| M1 | Gruppedannelse + gruppe-tider + finale-opgør | #3917, #2525, halvdelen af #3426/#3965 | ny |
| M2 | Stignings-selektion (gradient/længde/energi) | "80 vs 90 climbing"-skalaen får fysisk form | #3668-koblingen |
| M3 | Nedkørsel v2: monotoni-garanti + descent attack som aktivt event | #3426 fuldt | ny |
| M4 | Punch-finale: forspring over toppen bæres eksplicit ind i finalen | #3965 | ny |
| M5 | Udbrud v2: jagt-interesse | #2416, #2260-klassen, 54 %-dominansen på descent | #2416-designet |
| M6 | Sprint-tog: leadout-roller flytter position i finale-opgøret | v3 S1-rollerne får sprint-udtryk | v3-spec §6 |
| M7 | Distance→energi (monument-slid) | #3547-ønsket "280 km skal slide" | #2768 Sub-3 |
| M8 | Brosten-sektorer med reel vægt | #3864 (15-20 % på punch-etaper) | segmentmodellen |
| M9 | Bonussekunder + indlagte spurter i simulationen | #2413-scope, nu som ægte events | #2413 |
| M10 | Incidents med km-mærke og gruppe-konsekvens (styrt i felt vs. solo) | filmens troværdighed | v3 S4 |

v3-søjlerne (roller/work-cost, dagsform, jour sans, form-peaks, why-rapport) genbruges som **komponenter i energi- og beslutningsmodellen**, ikke som score-tillæg. Intet af kalibreringsarbejdet smides væk: det bliver mål-ankre (§5).

## 5. Kalibrering: simulér-før-ship med virkeligheds-ankre

Stående doktrin gælder fuldt: intet shippes uden dry-run-harness mod ægte population + scorecard med ejer-go. v4's scorecard ankres i **virkelighedens tal** (primært) med de eksisterende gate-bånd som regressionsvagt (sekundært):

| Anker | Mål | Kilde |
|---|---|---|
| Felt-sammenhæng, flade etaper | 80-95 % af feltet på vinderens tid | #3917-målingen (i dag 0,6-6,7 %) |
| Nedkørsels-gaps vs. summit-gaps | ratio ≤ 0,5 ved p5-p10; 18/32/46/63-niveauet | #3426-målingen (allerede ramt af 7/8-fixet; må ikke regressere) |
| Max descending-drevet differens i samlet gruppe | ≤ 15 s, aldrig omvendt fortegn | #3426 + monotoni-garantien |
| Punch-korrelation | Punch-evne rangkorrelerer målbart med placering på punch-etaper; "først over toppen" vinder eller besejres af en FORKLARET mekanik | #3965-harnesset |
| Felt-favoritters win-rate | 15-40 % (aldrig 80 %+) | v3-spec §2 (Pogačar-outlier som loft) |
| Udbruds-rater pr. terræn | nuværende gate-bånd ± ejer-godkendt justering; descent-dominansen (54 %) SKAL ned | race:gate + #3426-kommentar |
| Samme-hold-top-10 | 4+ fra samme hold i top 10 er sjældent (< 3 %) | v3-spec §2 |
| Type-integritet | sprinter-vinderrate på flat ≥ 90 %, ITT-korrelation synlig | race:gate + #3149 |

Golden fixtures mod den ægte population + determinisme-tests (bit-identitet ved samme seed) fra dag 1. #3917-/#3426-målescripterne genbruges som før/efter-instrument.

## 6. Cutover-strategi: skyggekørsel gennem S3

1. **v4 bygges ved siden af** (`backend/lib/engine/v4/`), rører aldrig `raceSimulator.js`-stien. Flag `race_engine_v4`.
2. **Skygge-mode i S3:** hver afviklet etape simuleres OGSÅ af v4 (samme seed, samme startfelt); v4's resultater + tidslinjer persisteres i skygge-tabeller (admin-only). Hver dag i S3 producerer altså et gratis kalibrerings-datasæt: v4 vs. v3 vs. spiller-forventning, på ægte felter.
3. **Ejer-gate på scorecard + håndplukkede skygge-film** (samme mønster som #2410's prototype-gate: bjergetape, massespurt, udbrudssejr, nedkørselsfinale set med egne øjne).
4. **Cutover ved S4-start** (rent snit: ny sæson, ny motor, patch note-fortælling "løbene beregnes nu undervejs"). Kill-switch tilbage til v3 består én sæson.

Dette er den hurtigste ansvarlige vej til fantastisk: byggetempoet er ubegrænset (intet rører live), og kalibreringen får en HEL sæsons ægte felter i stedet for syntetiske dry-runs alene.

## 7. Milepæle

- **F0 (nu):** Denne spec ejer-godkendes; beslutningspunkter §8 afgøres.
- **F1 Rute-SSOT:** segmentmodel + generator-opgradering + legacy-syntese + profil-grafik læser segmenter. Kalender-teamet (S4-planlægning, #3864) bygger mod samme model med det samme.
- **F2 Motor-kerne:** segment-loop, gruppe-tilstand, M1-M4, tidslinje-emission, golden fixtures + determinisme-tests.
- **F3 Mekanik-bølge:** M5-M10 i parallelle worktrees (hver mekanik = eget flag internt i v4, egen harness-linse).
- **F4 Skygge-mode:** runner-hook, skygge-tabeller, dagligt sammenlignings-scorecard.
- **F5 Kalibrering gennem S3** → ejer-gate → **F6 cutover ved S4-start**.

F1+F2 er designet til at kunne bygges nu (20-21/8) i worktrees uden at røre cutover-kritisk kode; merge af skygge-mode-hooken (F4) venter til efter 23/8-cutoveret.

## 8. Beslutningspunkter til ejer-gaten

1. **Cutover-timing:** A) skyggekørsel gennem S3 + cutover ved S4-start (anbefalet) · B) flag-flip midt i S3 når scorecardet er grønt. A giver en hel sæsons ægte kalibreringsdata og et rent narrativ; B er hurtigere live men skifter fysik midt i et klassement.
2. **Rute-SSOT-rækkefølge:** A) F1 først så kalender og motor deler model fra dag 1 (anbefalet) · B) motor først på syntetiserede segmenter, rute-model senere. A koster 1 fase før motor-koden, men fjerner dobbeltarbejde og leverer S4-kalender-forbedringerne "gratis".
3. **Udbrud v2-placering:** A) foldes ind i v4 som M5 (anbefalet, #2416 lukkes ind i dette spor) · B) bygges separat på v3 først. A undgår at kalibrere samme mekanik to gange.
4. **#3149-transparens (vægte → 100 %):** lille uafhængigt fix på NUVÆRENDE motor nu (anbefalet: ja, det er en visnings-bug og køber tillid billigt) eller vente på v4.

## 9. Koordinering og afgrænsning

- **Rører ikke:** cutover-drejebogen 23/8, merge-toget 20/8, løn/økonomi-sporet (#4011/#4018), træningssporet (#3709). Skygge-mode-merge først efter cutover.
- **Absorberer:** #2416 (M5), #2413-scope (M9), #3864's sektor-del (M8/F1), motor-delene af #3426/#3965/#3917/#2525.
- **Fodrer:** #3856 (løbsfilm-backfill kan efter v4 køres med ÆGTE re-simulering), #2356 (recap v2), #1815 (Discord pr. etape).
- **Kalender-arbejdet** (S4-identitet, #3547-rest, #3864) kører som selvstændigt indholds-spor mod F1's rute-model; ingen motor-afhængighed efter F1.
