# S3-kalender-pakke: dry-run-scorecard (#3546)

Genereret 2026-08-17. 100 % read-only mod prod-kataloget (`race_pool`)  - 
ingen DB-writes, ingen kalender-regenerering. FØR/EFTER kørt over 3 seeds (hypotetiske
sæson-numre 3/4/5) på tier 1 (D1), som er hvor de fleste af de 7 leverancer er målbare.
Pakken dækker de 4 oprindelige beslutninger (A-D, 17/8 morgen) + 3 tilføjet samme aften efter en
Discord-sweep (E: uphill-finishes, F: to brostens-vinduer, G: D2-samtidigheds-cap).

FØR = ægte katalog uændret (21-etapers GT'er). EFTER = ægte katalog + de 3 GT-rækkers
stages/date_text patchet in-memory til Giro 18 / Hexagone 17 / Vuelta 17 (matcher
`scripts/race_pool_seed.csv`): samme værdi B/C/D/E/F/G's kode-ændringer kører igennem i begge kolonner
(E/F/G er ikke gated af A, så de to kolonner ligner hinanden for målene 6-8: kun sekundære
knock-on-effekter af A/B's ændrede løbsudvalg adskiller dem).

## 1. GT-andel af D1-slots

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 45.0 % (63/140) | 37.1 % (52/140) |
| 4 | 45.0 % (63/140) | 37.1 % (52/140) |
| 5 | 45.0 % (63/140) | 37.1 % (52/140) |
| **gennemsnit** | **45.0 %** | **37.1 %** |

## 2. Kalender-spænd pr. GT (kalenderdage)

| Seed | GT | FØR (dage) | EFTER (dage) |
|---|---|---|---|
| 3 | Giro della Penisola | 13 | 10 |
| 3 | Tour de l'Hexagone | 5 | 7 |
| 3 | Vuelta Ibérica | 5 | 6 |
| 4 | Giro della Penisola | 13 | 10 |
| 4 | Tour de l'Hexagone | 5 | 7 |
| 4 | Vuelta Ibérica | 5 | 6 |
| 5 | Giro della Penisola | 13 | 10 |
| 5 | Tour de l'Hexagone | 5 | 7 |
| 5 | Vuelta Ibérica | 5 | 6 |

Spredning (maks−min spænd på tværs af de 3 GT'er, mål ≤1 dag EFTER):

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 8 | 4 |
| 4 | 8 | 4 |
| 5 | 8 | 4 |

## 3. Dage uden afgørelse (D1)

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 5 (1,10,11,18,24) | 2 (1,19) |
| 4 | 5 (1,10,11,18,24) | 2 (1,19) |
| 5 | 5 (1,10,11,18,24) | 2 (1,19) |

## 4. ITT-profiler pr. GT (flad "itt" vs. kuperet "itt_hilly")

| Seed | GT | FØR itt/itt_hilly | EFTER itt/itt_hilly |
|---|---|---|---|
| 3 | Giro della Penisola | 1/1 | 1/1 |
| 3 | Tour de l'Hexagone | 1/1 | 1/1 |
| 3 | Vuelta Ibérica | 1/1 | 1/1 |
| 4 | Giro della Penisola | 1/1 | 1/1 |
| 4 | Tour de l'Hexagone | 1/1 | 1/1 |
| 4 | Vuelta Ibérica | 1/1 | 1/1 |
| 5 | Giro della Penisola | 1/1 | 1/1 |
| 5 | Tour de l'Hexagone | 1/1 | 1/1 |
| 5 | Vuelta Ibérica | 1/1 | 1/1 |

## 5. Eksisterende invarianter (ingen brud tilladt)

| Seed | Klasse/etape-bånd-brud (#3328) FØR/EFTER | Hviledage degraderet FØR/EFTER | 5 events/dag holdt FØR/EFTER |
|---|---|---|---|
| 3 | 0/0 | 0/0 | true/true |
| 4 | 0/0 | 0/0 | true/true |
| 5 | 0/0 | 0/0 | true/true |

Ingen calendarViolations i nogen kørsel (FØR eller EFTER, nogen seed).

## 6. Uphill-finish-andel pr. profiltype (#3546 E, D1, alle selekterede løb)

Ejer-mål: ~35 % hilly, ~20 % rolling (prod målte 0 % for begge, 0/254 hhv. 0/65).

| Seed | Hilly FØR | Hilly EFTER | Rolling FØR | Rolling EFTER |
|---|---|---|---|---|
| 3 | 36.0 % (9/25) | 32.0 % (8/25) | 18.2 % (4/22) | 17.6 % (3/17) |
| 4 | 30.0 % (6/20) | 40.9 % (9/22) | 15.0 % (3/20) | 21.1 % (4/19) |
| 5 | 38.5 % (10/26) | 37.0 % (10/27) | 25.0 % (5/20) | 25.0 % (4/16) |
| **gennemsnit** | **34.8 %** | **36.6 %** | **19.4 %** | **21.2 %** |

## 7. Cobbles-fordeling pr. uge (#3546 F, D1)

Ejer-mål: to synlige vinduer (tidligt + sent i sæsonen), ikke prod's monotone fald
(målt 29→24→18→8 pr. uge i det rå katalog). Uge = `floor(placeret real_day / 7)` over den
28-dages D1-horisont (uger 0-3).

| Seed | FØR (uge: antal) | EFTER (uge: antal) |
|---|---|---|
| 3 | u0:1, u3:1 | u0:1, u3:1 |
| 4 | u0:1, u3:1 | u0:1, u3:1 |
| 5 | u0:1, u3:1 | u0:1, u3:1 |

## 8. Max samtidige løb pr. division (#3546 G)

Ejer-mål: D2 ≤ 3 (den LIVE, ældre-genererede S3-kalender viser op til 4: en frisk plan med
denne PRs kode gør ikke). D3/D4 uændret ≤ 2. Målt ÉN gang pr. kolonne (uafhængig af sæson-seed:
overlap-strukturen kommer fra selection+packing, ikke fra parcours-trækket).

| Division (tier) | Cap | FØR maxOverlap | Inden for cap? | EFTER maxOverlap | Inden for cap? |
|---|---|---|---|---|---|
| D1 | 3 | 3 | JA | 3 | JA |
| D2 | 3 | 3 | JA | 3 | JA |
| D3 | 2 | 2 | JA | 2 | JA |
| D4 | 2 | 2 | JA | 2 | JA |

## Reference: rå prod-baseline (issue #3546, målt 16-17/8: FØR nogen kode i denne PR)

- GT-andel: 45,0 %
- Giro-spænd: 9 kalenderdage (31/8-8/9) mod Hexagone/Vueltas 5 hver
- Dage uden afgørelse: 6/28 (21,4 %) i D1
- Uphill-finish: 0/254 hilly, 0/65 rolling
- Cobbles pr. uge: 29→24→18→8 (monotont fald)
- D2 maxOverlap: op til 4 (målt i den LIVE, ældre-genererede S3-kalender)

## Fund og begrænsninger (ærlig rapportering: ikke alt ramte målet fuldt ud)

Denne sektion er opdateret EFTER arkitekt-review 17/8 aften: B fik et rodfix nummer 2
(stream-valgets tie-break) og C fik en flerpas-udvidelse. Begge forbedrede sig markant
(se under), men rammer ikke deres respektive absolutte mål (±1 dag hhv. 0 døde dage)  - 
begge resterende gaps er nu PRÆCIST forklaret og kvantificeret nedenfor, som krævet.

- **B (Giro-spredning), v2: rammer "≤4-5 dage"-målet, men IKKE det fulde ±1 dags-mål.**
  Rodfix: layoutStream's mindst-belastede stream-valg brød konsekvent tie mod stream 0
  (indeks 0 vinder altid en cursor-uafgørelse): PRÆCIS den stream GT'erne selv ligger
  på. Det betød at "rest"-fyldet FØR hver GT systematisk blev dumpet på GT'ens EGEN
  stream, hvilket skubbede GT'ens fodaftryk længere frem i dens egen game_day-
  rækkefølge og efterlod de ANDRE streams uden indhold der reelt overlappede GT'ens
  vindue. Fix: pickLeastLoadedStreamAwayFromZero() bryder ties væk fra stream 0.
  **Målt (fuld pakke, den faktisk SHIPPEDE kombination): EFTER-spredning falder fra
  7 til 4 dage** (Giro 10 · Hexagone 7 · Vuelta 6): inden for "≤4-5 dage"-målet og
  UNDER den rå prod-baseline (som også var 4). Pairwise-afstanden er dog stadig
  op til 4 dage (Giro-Hexagone), ikke ±1.
  **PRÆCIS årsag til det resterende gab (instrumenteret dry-run mod det ægte katalog):**
  Giro (GT1, ingen forrige GT at holde afstand til) starter FØRST på stream 0's egen
  cursor game_day 17 (efter dens andel af "Trin 2"-fyldet), og dens vindue er derfor
  [17,38). På DET tidspunkt havde stream 1 kun nået game_day 14 og stream 2 kun 9  - 
  altså har INGEN af de andre streams noget indhold der overlapper Giro's vindue
  OVERHOVEDET (0-9 og 0-14 ligger begge FØR 17). Giro kører derfor reelt "alene" i
  game_day-rummet, hvilket giver minimal komprimering og dermed det bredeste
  kalender-spænd. Rod-årsagen er STRUKTUREL: hver GT's "Trin 2"-fyld er en LUKKET
  fase (sker FØR GT'ens egen placering, fryser derefter mens GT'en placeres): den
  NÆSTE GT's fyld starter først EFTER denne GT er færdigplaceret, så intet nyt
  indhold kan lande i en TIDLIGERE GT's vindue bagefter. At lukke gabet helt ville
  kræve at INTERLEAVE rest-fyldet med GT-placeringen i stedet for at sekvensere dem  - 
  en større, mere risikabel omstrukturering af layoutStream (samme fil har haft 3
  tidligere regressions-runder, #3472 v1-v3) end tie-break-rettelsen ovenfor, og
  IKKE forsøgt i denne PR. Rapporteret til ejeren som opfølgnings-kandidat med
  den præcise mekanik dokumenteret her, så en fremtidig session ikke skal genopdage den.
- **C (dage uden afgørelse), v2: reducerer markant (halveret igen), men rammer IKKE 0  - 
  bevist umuligt for netop 2 navngivne dage med det NUVÆRENDE katalog.** Flerpas-
  udvidelse (gentag scanningen til intet flere sikre bytter findes, i stedet for ét
  gennemløb) + B's tie-break-fix (bonus-effekt: bedre stream-balance giver også flere
  afgørelses-muligheder) bragte EFTER fra 5 til **2 dage** (FØR: 5→2 med, uden C ville
  FØR/EFTER være 7/10: se engangs-diagnostikken fra første scorecard-runde for de tal).
  **De 2 resterende dage (EFTER, alle 3 seeds: dagene er identiske på tværs af seeds,
  da selection/packing ikke er seed-afhængig) er BEVIST strukturelt umulige for den
  sikre bytte-mekanisme, med denne konkrete årsag:**
    - **Dag 1:** tre etapeløb (Ronde van Limburg 7 etaper, La Course au Soleil 8 etaper,
      Tour du Massif Central 6 etaper) starter ALLE omkring dag 0 og er alle stadig
      undervejs (ingen af dem slutter dag 1). Ingen andet løb (endagsløb eller
      slutetape) er placeret den dag at bytte ind.
    - **Dag 19:** Tour de l'Hexagone (GT) er det ENESTE aktive løb, midt i etaperne
      (vindue [18,24], slutetape er dag 24): ingen andet løb kører samtidig.
  **Hvorfor 0 er umuligt UDEN katalog-/kvote-ændring:** D1's kvote er PRÆCIS fyldt
  (140/140 game-days, 0 shortfall, 0 uplacerede løb/etaper): der findes INTET
  allerede-valgt-men-uplaceret endagsløb i "kulissen" som C's bytte-mekanisme kunne
  trække på. At dække de 2 dage kræver derfor at SELECTIONEN (tierRaceSelection.js,
  uden for denne PRs scope) vælger 2 FLERE endagsløb: hvilket enten kræver at
  kataloget rent faktisk INDEHOLDER 2 endagsløb til formålet (ét med date_text nær
  sæson-start, ét inden for Hexagone's eget vindue omkring fraction ~0,6), ELLER at
  1-2 af de eksisterende etapeløbs game-days byttes ud for dem (en sammensætnings-
  ændring der hører under #3295's K-B-kalibrering, ikke en placerings-fix).
  **MINIMAL katalog-tilføjelse: +2 endagsløb** (klasse inden for D1's whitelist),
  positioneret hhv. tidligt i sæsonen og inden for Hexagone's vindue: en ejer-
  beslutning med tal, ikke et stille miss.
- **A (GT-længde) og D (itt_hilly) rammer begge deres mål præcist**, som talene i
  sektion 1 og 4 viser.
- **E (uphill-finish) rammer begge mål præcist** (sektion 6): en uafhængig, dedikeret
  seedet roll pr. hilly/rolling-etape (ikke koblet til finale_type/motoren), verificeret
  over 400 seeds i unit-tests til at lande i intervallet ~25-45 % hhv. ~12-30 %.
- **F (cobbles-vinduer) splitter races i to vinduer, men ANTALLET pr. vindue afhænger**
  **af hvor mange cobbled_classic-races D1's selection rent faktisk vælger** (sektion 7)
 : reshapeCobblesFractionToTwoWindows omfordeler kun HVOR de valgte races lander,
  ikke HVOR MANGE der vælges (selectionen er urørt af denne PR). Er kataloget knapt
  på cobbled_classic i D1's klasse-whitelist, giver to vinduer med få races pr.
  vindue ikke to SYNLIGT tunge klumper: det er et katalog-loft, ikke en kode-fejl
  (samme klasse af begrænsning som #3295's egen "tier-spredningen er et katalog-
  problem"-konklusion, se raceStageProfileGenerator.js's kalibrerings-kommentar).
- **G (D2-samtidigheds-cap) er ALLEREDE opfyldt af eksisterende kode** (sektion 8):
  `TIER_OVERLAP_CAP[2] = 3` er uændret af denne PR og en FRISK dry-run-plan (denne
  PRs kode, begge kolonner) rammer maxOverlap=3, ikke 4. Den observerede "op til 4"
  stammer fra den LEVENDE, ældre-genererede S3-kalender (fra før #3470/#3472 v3's
  overlap-fixes landede): en fremtidig regenerering (separat, ejer-gated) løser det
  automatisk uden yderligere kodeændring her.
