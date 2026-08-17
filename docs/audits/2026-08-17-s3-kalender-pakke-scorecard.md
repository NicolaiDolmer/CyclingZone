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
| 3 | Giro della Penisola | 9 | 13 |
| 3 | Tour de l'Hexagone | 5 | 7 |
| 3 | Vuelta Ibérica | 5 | 6 |
| 4 | Giro della Penisola | 9 | 13 |
| 4 | Tour de l'Hexagone | 5 | 7 |
| 4 | Vuelta Ibérica | 5 | 6 |
| 5 | Giro della Penisola | 9 | 13 |
| 5 | Tour de l'Hexagone | 5 | 7 |
| 5 | Vuelta Ibérica | 5 | 6 |

Spredning (maks−min spænd på tværs af de 3 GT'er, mål ≤1 dag EFTER):

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 4 | 7 |
| 4 | 4 | 7 |
| 5 | 4 | 7 |

## 3. Dage uden afgørelse (D1)

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 4 (1,10,18,24) | 5 (1,10,11,15,19) |
| 4 | 4 (1,10,18,24) | 5 (1,10,11,15,19) |
| 5 | 4 (1,10,18,24) | 5 (1,10,11,15,19) |

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

## Fund og begrænsninger (ærlig rapportering: ikke alt ramte målet)

⚠ **VIGTIGSTE FUND (ejer-review anbefales FØR merge): B's GT-spredning-mål er IKKE nået,
og den FULDE pakke (A+B+...+G sammen) måler et REGRESSIVT resultat på netop dette punkt**
(spredning 4→7 dage, se detaljer nedenfor): se afsnittet "B" for den fulde forklaring
og en anbefaling til næste skridt.

- **B (Giro-spredning): rammer IKKE ±1 dags-målet, og den FULDE pakke måler en**
  **REGRESSION på dette specifikke mål, ikke en forbedring.** Målt spredning (maks−min
  GT-spænd) for den FAKTISK SHIPPEDE kombination: FØR (gammel 21-etapers GT-længde,
  B+C+D+E+F+G aktive) = 4 dage: praktisk talt identisk med rå prod-baseline (også 4).
  EFTER (fuld pakke inkl. A's kortere GT'er) = 7 dage: VÆRRE end både FØR og
  baseline. Isoleret afprøvning under implementeringen viste at B (rebalancerings-
  funktionen) har PRAKTISK TALT INGEN målbar effekt på EFTER-scenariet mod det ægte
  katalog (identiske GT-spænd med og uden B slået til): D1's ikke-GT-etapeløbs-pulje
  ("others") er for lille i det rigtige katalog (typisk 3-4 løb) til at en
  omfordeling flytter noget mærkbart, selvom mekanismen er verificeret korrekt i
  isolerede unit-tests med en større syntetisk pulje. Regressionen (4→7) stammer i
  stedet fra A's kortere GT'er i samspil med layoutStream's target-formel (hver GT's
  EGEN seasonFraction, uændret af denne PR, styrer stadig hvornår dens "Trin 2"-
  fyld-til-target kører): en fuld ±1-dags-garanti ville kræve at ændre selve
  target-formlen (raceCalendarLanePacker.js linje ~365-380), vurderet for risikabelt
  til denne PR (samme algoritme har haft 3 tidligere regressions-runder, #3472 v1-v3).
  **Anbefaling: ejeren bør se dette tal FØR merge og afgøre om A (GT-længde) stadig**
  **ønskes leveret nu, eller om B's rodfix skal udvides FØRST** (opfølgende issue).
- **C (dage uden afgørelse) reducerer problemet markant i BEGGE kolonner, men rammer**
  **ikke 0.** Engangs-diagnostik (C midlertidigt deaktiveret, samme katalog/seed):
  UDEN C ville FØR give 7 dage uden afgørelse og EFTER 10: MED C (de målte tal
  ovenfor) giver FØR 4 og EFTER 5, BEGGE bedre end rå baseline (6). C's placerings-
  prioritet er BEVIDST konservativ (kapitel "Kan positionen ... flyttes" i
  raceCalendarLanePacker.js): den flytter ALDRIG en etapeløbs mellemliggende
  (ikke-slut-)etape, fordi det kan bryde løbets kronologiske rækkefølge: kun
  endagsløb/hviledags-fillere byttes, og kun når et sikkert bytte findes. Nogle dage
  (typisk midt i et GT-vindue hvor ALLE aktive løb er igangværende, ikke-
  afsluttende etaper) har ingen sikker donor og forbliver uden afgørelse: et BEVIDST
  designvalg (aldrig en tvunget/urealistisk fix), ikke en fejl.
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
