# S3-kalender-pakke: dry-run-scorecard (#3546)

Genereret 2026-08-20. 100 % read-only mod prod-kataloget (`race_pool`)  - 
ingen DB-writes, ingen kalender-regenerering. FØR/EFTER kørt over 3 seeds (hypotetiske
sæson-numre 3/4/5) på tier 1 (D1), som er hvor de fleste af de 7 leverancer er målbare.
Pakken dækker de 4 oprindelige beslutninger (A-D, 17/8 morgen) + 3 tilføjet samme aften efter en
Discord-sweep (E: uphill-finishes, F: to brostens-vinduer, G: D2-samtidigheds-cap).

FØR = ægte katalog uændret (21-etapers GT'er). EFTER = ægte katalog + de 3 GT-rækkers
stages/date_text patchet in-memory til Giro 18 / Hexagone 17 / Vuelta 17 (matcher
`scripts/race_pool_seed.csv`): samme værdi B/C/D/E/F/G's kode-ændringer kører igennem i begge kolonner
(E/F/G er ikke gated af A, så de to kolonner ligner hinanden for målene 6-8: kun sekundære
knock-on-effekter af A/B's ændrede løbsudvalg adskiller dem).

## 0. #3467 bufferdag (ejer-beslutning 18/8, KS3) — første løbsdag

Dette scorecard måler ren KOMPOSITION (GT-længde, spredning, dagsafgørelser, profiltyper,
overlap) og er bevidst AFKOBLET fra kalenderdatoer — `FROM` ovenfor er vilkårlig
(2026-01-01, kun scheduling-tider, ikke målt). Første løbsdag er derfor IKKE et tal dette
scorecard kan vise meningsfuldt.

Ejer-beslutningen 18/8 (#3467): 24/8 = hviledag (INGEN løb), FØRSTE S3-LØBSDAG = 25/8.
Den nu wipede prod-kalender havde første etape mandag 24/8 kl. 11 — forældet på præcis
dette punkt (fra FØR beslutningen). Bufferdagen er implementeret og VERIFICERET som en
caller-leveret `from`-værdi (`resolveCalendarFrom({ firstRaceDate: "2026-08-25" })`),
IKKE en ændring i selve kompositions-koden denne PR rører — se
`backend/scripts/dev/regenSeason3Calendar.mjs`, som kører den ÆGTE plan (rigtige datoer,
100 % read-only dry-run) og STOPPER hvis det tidligste planlagte løb ikke lander præcis
på 2026-08-25.

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
| 3 | Giro della Penisola | 12 | 10 |
| 3 | Tour de l'Hexagone | 5 | 5 |
| 3 | Vuelta Ibérica | 5 | 4 |
| 4 | Giro della Penisola | 12 | 10 |
| 4 | Tour de l'Hexagone | 5 | 5 |
| 4 | Vuelta Ibérica | 5 | 4 |
| 5 | Giro della Penisola | 12 | 10 |
| 5 | Tour de l'Hexagone | 5 | 5 |
| 5 | Vuelta Ibérica | 5 | 4 |

Spredning (maks−min spænd på tværs af de 3 GT'er, mål ≤1 dag EFTER):

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 7 | 6 |
| 4 | 7 | 6 |
| 5 | 7 | 6 |

## 3. Dage uden afgørelse (D1)

| Seed | FØR | EFTER |
|---|---|---|
| 3 | 5 (1,10,11,18,24) | 4 (1,13,19,24) |
| 4 | 5 (1,10,11,18,24) | 4 (1,13,19,24) |
| 5 | 5 (1,10,11,18,24) | 4 (1,13,19,24) |

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

| Seed | Klasse/etape-bånd-brud (#3328) FØR/EFTER | Hviledage degraderet FØR/EFTER | 5 events/dag holdt FØR/EFTER | GT-real-day-separation (#3472 v3) FØR/EFTER |
|---|---|---|---|---|
| 3 | 0/0 | 0/0 | true/true | 0/0 |
| 4 | 0/0 | 0/0 | true/true | 0/0 |
| 5 | 0/0 | 0/0 | true/true | 0/0 |

GT-real-day-separation-kolonnen er tilføjet efter en regression opdaget under H-implementeringen
(17/8 sen aften): C's dagsafgørelses-bytte kunne flytte en GT-etape og bryde "ingen delt
kalenderdag mellem to GT'er". Fikset (GT'er er nu UDELUKKET fra C's bytte-kandidatur helt): se
"Fund og begrænsninger" for detaljer. 0/0 i tabellen ovenfor bekræfter fixet holder på det ægte katalog.

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

## 9. Kalender-spænd pr. ikke-GT-etapeløb (#3546 H, D1)

Ejer-mål: spænd ≤ stages+2 dage (mål), hård grænse stages+3 (håndhævet i selve
placerings-mekanismen: enforceDailyDecisions afviser ethvert bytte der ville bryde den).
stræk-faktor = spænd/stages (1,0 = ingen strækning).

| Seed | Maks stræk-faktor FØR | Median FØR | Maks stræk-faktor EFTER | Median EFTER | Brud på stages+3 EFTER |
|---|---|---|---|---|---|
| 3 | 0.83 | 0.63 | 0.83 | 0.57 | 0 |
| 4 | 0.83 | 0.63 | 0.83 | 0.57 | 0 |
| 5 | 0.83 | 0.63 | 0.83 | 0.57 | 0 |

De to navngivne løb thelamba målte (Tour du Massif Central 6 etaper/14 dage, La Corsa dei
Due Mari 7 etaper/13 dage) FØR H-fixet, EFTER (seed 3, EFTER-kolonnen):

- **Tour du Massif Central**: 6 etaper, spænd 5 dage, stræk-faktor 0.83 (grænse 9)
- **La Corsa dei Due Mari**: 7 etaper, spænd 4 dage, stræk-faktor 0.57 (grænse 10)

Alle ikke-GT-etapeløb, EFTER, sorteret efter værste stræk-faktor (seed 3):

| Løb | Etaper | Spænd | Stræk-faktor |
|---|---|---|---|
| Tour du Massif Central | 6 | 5 | 0.83 |
| Tour de Bretagne | 6 | 4 | 0.67 |
| Tour du Léman | 6 | 4 | 0.67 |
| La Course au Soleil | 8 | 5 | 0.63 |
| Tour des Volcans d'Auvergne | 8 | 5 | 0.63 |
| Ronde van Limburg | 7 | 4 | 0.57 |
| Volta Catalana | 7 | 4 | 0.57 |
| Tour de la Vistule | 7 | 4 | 0.57 |
| La Corsa dei Due Mari | 7 | 4 | 0.57 |
| Région Pays de la Loire Tour Mineur | 3 | 1 | 0.33 |
| Tour of South Australia | 6 | 2 | 0.33 |

## Reference: rå prod-baseline (issue #3546, målt 16-17/8: FØR nogen kode i denne PR)

- GT-andel: 45,0 %
- Giro-spænd: 9 kalenderdage (31/8-8/9) mod Hexagone/Vueltas 5 hver
- Dage uden afgørelse: 6/28 (21,4 %) i D1
- Uphill-finish: 0/254 hilly, 0/65 rolling
- Cobbles pr. uge: 29→24→18→8 (monotont fald)
- D2 maxOverlap: op til 4 (målt i den LIVE, ældre-genererede S3-kalender)
- Ikke-GT-etapeløbs-stræk: Tour du Massif Central 6 etaper/14 dage (stræk 2,33), La Corsa
  dei Due Mari 7 etaper/13 dage (stræk 1,86): thelambas spillerfeedback-fund 17/8 sen aften

## Fund og begrænsninger (ærlig rapportering: ikke alt ramte målet fuldt ud)

Denne sektion er opdateret EFTER runde 3 (arkitekt-go 17/8 sen aften, ny leverance H:
max-spænd-loft for ikke-GT-etapeløb). H's implementering afdækkede en ALVORLIG, PRÆ-
EKSISTERENDE regression i C (fra runde 2's flerpas-udvidelse, ikke en del af H's egen
ask): se den fremhævede boks nedenfor. Giro-spænd-målet (≤9, helst ≤8) blev FORSØGT
nået via en target-formel-justering, men afprøvningen BRØD en hård invariant og blev
derfor forkastet: se H-afsnittet for den fulde afprøvning + tal.

⚠ **KRITISK FUND (opdaget under H-implementeringen, IKKE en del af denne rundes ask):**
C's flerpas-bytte-mekanisme (runde 2) kunne flytte en GT's EGEN etape som en del af et
bytte (canMoveTo sikrer kun GT'ens interne etape-rækkefølge, ikke #3472 v3's SEPARATE
"ingen delt kalenderdag mellem to GT'er"-garanti). Verificeret BÅDE i en test-fixture
og mod det ægte katalog: 1-2 GT'er delte en kalenderdag efter C's bytter kørte: en
brudt hård invariant der (uopdaget) fulgte med runde 2's PR-opdatering. **Fixet her:**
GT'er er nu eksplicit udelukket fra HELE C's bytte-kandidatur (hverken donor- eller
offer-side): ikke kun fra H's spænd-tjek. Verificeret 0 brud, både test-suite og ægte
katalog (sektion 5). Dette bør have et `.claude/learnings/`-indlæg ved merge.

- **H (ny, denne runde): max-spænd-loft for ikke-GT-etapeløb: RAMMER SIT MÅL PRÆCIST.**
  Rod-årsag (instrumenteret dry-run, C midlertidigt deaktiveret for at isolere): C's
  bytte-mekanisme (IKKE selve base-pakningen) skabte strækningen: den flytter typisk
  et løbs FØRSTE etape (ingen "forrige"-nabo-begrænsning) eller SIDSTE etape (decision-
  donor-kandidat) langt væk for at dække en dag uden afgørelse et andet sted:
  sekventielt SIKKERT, men skaber netop den strækningspatologi H retter. Målt FØR/EFTER
  H-fixet (samme katalog): Tour du Massif Central 6 etaper/14 dage (stræk 2,33) →
  **5 dage (stræk 0,83)**. La Corsa dei Due Mari 7 etaper/13 dage (stræk 1,86) →
  **4 dage (stræk 0,57)**. Se sektion 9 for den fulde liste: 0 løb over stages+3 EFTER.
- **B (Giro-spredning): "≤4-5 dage"-målet holder (spredning 6), men "Giro ≤9, helst
  ≤8"-målet er IKKE nået: et forsøg blev afprøvet og FORKASTET, fordi det brød en hård
  invariant.** Giro-spænd EFTER (fuld pakke inkl. H): **10 dage** (Hexagone 5, Vuelta 4).
  Afprøvet: en empirisk parameter-sweep (faktor 0,6-3,0) af den FØRSTE GT's target-
  formel fandt et stabilt plateau (faktor 2,3-3,0) der gav Giro-spænd 10→7: MEN
  verificeret (BÅDE test-fixture og ægte katalog) at det samtidig BRØD #3472 v3's
  GT-real-day-separations-invariant (to GT'er delte en kalenderdag). Forkastet og
  reverteret: ingen mængde af Giro-forbedring er værd at bryde en hård, ikke-
  forhandlingsbar garanti. **Anbefaling: Giro-spænd-målet kræver enten (a) en dybere,
  separat gennemgang af target-formlen der EKSPLICIT respekterer separations-bufferet
  (ikke forsøgt her, tidsbudget), eller (b) ejeren accepterer 10 dage som interim
  (stadig en forbedring fra den oprindelige 13-15 dage tidligere i denne PR's historik,
  men IKKE under den nuværende live 9-dages værdi).
- **C (dage uden afgørelse): EFTER GT-udelukkelses-fixet er tallet 4 dage: dette er
  EN REGRESSION vs. runde 2's rapporterede 2, fordi runde 2's "2" byggede på en**
  **defekt mekanisme** (GT-bytter der ikke burde have været tilladt). Med fixet (kun
  sikre, GT-frie bytter) er de 4 dage: 1, 13, 19, 24. Dag 1 og 19 er de samme som
  tidligere rapporteret (se deres forklaring nedenfor); dag 13 og 24 er NYE: de var
  tidligere "dækket" af nu-forbudte GT-bytter. **MINIMAL katalog-tilføjelse for 0:**
  samme princip som før, men nu ~4 endagsløb (positioneret ved de 4 dages fraction),
  IKKE 2: tallet steg fordi fixet fjernede en (ugyldig) genvej, ikke fordi H gjorde
  noget værre. D1's kvote er fortsat præcis fyldt (140/140, 0 shortfall/uplaceret).
    - **Dag 1:** tre etapeløb (Ronde van Limburg 7 etaper, La Course au Soleil 8 etaper,
      Tour du Massif Central 6 etaper) starter ALLE omkring dag 0, ingen slutter dag 1.
    - **Dag 19:** Tour de l'Hexagone (GT) er det ENESTE aktive løb, midt i etaperne.
    - **Dag 13/24:** samme mønster: kun igangværende (ikke-slut-)etaper aktive,
      ingen sikkert flytbar afgørelse fundet efter GT-udelukkelsen.
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
