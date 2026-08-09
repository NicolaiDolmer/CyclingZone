# #3564 trin 1 — kvantil-remap 1-6 → 1-99 (DRY-RUN, ingen writes)

Snapshot målt 2026-08-09 12:50:47 UTC · script `backend/scripts/dev/remapDryRun3564.mjs` (kør med `SNAP_DIR=<dateret snapshot fra snapshot-3564-progression-chain.mjs>`; `REMAP_VARIANT=a|b`, default b). **Ejer-beslutning A afgjort 9/8 aften: variant B (hale-korrigeret) er migrations-målet** — variant A (bogstavelig §6, resten af dette dokument) er bevaret som sammenligningsgrundlag/begrundelse for valget.

## VARIANT B (VALGT) — hale-korrigeret remap, dry-run-resultat

**Algoritme:** tiers 1,0-4,0 beholder deres tier-centre (form-bevarende intra-tier-spredning ±4,9 via rang — 1-99-granularitet uden tier-skift); kun ≥4,5-klassen (961 ryttere, "pot 5-6"-overskuddet fra spec §3) kvantil-presses mod planens HALE-ankre pr. aldersbånd: antal ≥74,5 ("5,0+") / ≥84,3 ("5,5+") / ≥94,1 ("6,0") = planens masser (0,70 % / 0,32 % / 0,11 % af båndet). **Fredningsgulve (ejer-justeringer 9/8 aften efter første diff): gammel 6,0'er aldrig under 80 · gammel 5,5'er aldrig under 74,5** — blob-placerede løftes rang-sikkert (faldende pot-orden; løfte-loft under laveste beholdte same-pot og enhver højere pot). Rang bevares fuldt (0 brud verificeret efter begge løft). Ned/op-klassifikation: tier-ækvivalent-skift >0,28 (kvart trin + afrundingskorn; intra-tier-spredning tæller ikke).

**Resultat (samme daterede snapshot, begge fredningsgulve — ENDELIGT migrations-mål, ejer-godkendt 9/8 aften):**
- **Kun top-klassen rammes:** 470 nedjusterede (237/248 pot-5,0 · 169/176 pot-5,5 · 64/72 pot-6,0) — tiers 1,0-4,5: **0**. Mod variant A's 7.243.
- **Landing = kontinuert gradient uden huller:** 4,5+5,0 → 65-74,5 (713 i blobben; 5,0'erne øverst ~71-74) · 5,5 → 74,5-80 ("5,0-klassen") · 6,0 → 80-99 (17 i 84,3-94,1 · 9 i topsegmentet 94,1-99). Hårdeste tier-fald: 6,0 → 80 (−0,97) og 5,5 → 74,5-75 (−0,72).
- **Hale-gate:** ≥84,3 (26) og ≥94,1 (9) på plan i alle bånd; stock-gate 16 ≥90 mod forventet 16,4. **≥74,5 = 248 mod plan 57 — accepteret frednings-undtagelse** (præcis de 248 gamle 5,5+6,0'ere; stock-legacy der eroderer ved aldring, alle FREMTIDIGE træk følger geometrien).
- **Værdi-effekt (v4, offline):** 607,1 → 566,2 mio. = **−40,9 mio. (−6,7 %)** mod A's −27,0 %. Største enkelt-tab: Carlos Lozano (fri agent, kendt 22/6-legacy) −3,2 mio.; største human-ejede: Thomas Ward (6,0 → 81) −1,3 mio., Hui Deng (5,5 → 75) −1,0 mio.
- **Manager-diff:** 289 human-ejede nedjusterede fordelt på 110 af 192 human-hold; hårdest ramte hold mister 9 ryttere i tier-status (mod 37 i A). Top-5: Top Pro Cycling/rivka583 (9 ned, −0,8 mio.) · LEGO-Vestas/dolamba (9, −0,9 mio.) · FOSS-Trackman/andrecl1 (8, −0,5 mio.) · Team Hansen/CyberSimon (7, −1,1 mio.) · Équipe Lorraine Acier/Friisørens Salon (6, −0,2 mio.). Fuld tabel: `remap-dryrun-result-b.json` → `manager_diff`.
- **Gate-konsekvens:** fuld-form-gaten T1-N3 (±2pp mod plan-CDF) gælder KUN variant A; for variant B er migrations-målet hale-ankrene ≥84,3/≥94,1 (`tail_gate`) + form-bevarelse i tiers ≤4,0 + dokumenteret frednings-undtagelse på ≥74,5 (248). Gate-biblioteket skal have denne variant-B-målsætning med før PR-2.

---

## VARIANT A (AFVIST som migrations-mål — bevaret som sammenligning)

## VERDICT: IKKE klar til PR-plan uden ejer-afklaring

Den bogstavelige implementering af den aftalte algoritme (samme mål-fordeling — det enkelte kulds draw-geometri — anvendt pr. aldersbånd på HELE bestanden) korrigerer ikke kun "potentiale-overskuddet" (de ~961 pot 5-6-ryttere spec §6 nævner). Den presser **89 % af hele den levende bestand ned** (7.243 af 8.153), fordi bestanden i ALLE tiers over tier 1 er langt tættere befolket end et friskt kulds fordeling tilsiger. Se "Struktur-fund" nedenfor — dette er den vigtigste konsekvens at få et eksplicit ejer-ja/nej på, FØR trin 1 bliver en PR.

## 1. De 3 største konsekvenser

1. **Nedjusteringen er ikke afgrænset til overskuddet — den rammer 89 % af hele bestanden.** 100 % af alle ryttere i gamle tier 2-6 (7.176 stk.) og 98,3 % af tier 5.5 (176 stk.) bliver nedjusteret mod deres gamle tiers "center" på 1-99-skalaen; kun tier 1 (980 stk., den laveste mulige) er urørt. Samlet base_value (v4, offline-simuleret) falder fra 607,1 mio. til 443,5 mio. — **-27,0 %** — fordi v4 er potentiale-monoton. Dette er markant bredere end den ~11,7 %-vs-1,4 %-excess spec §6 beskriver som formålet.
2. **Manager-vendt: næsten alle akademi-hold rammes bredt, ikke kun de med overskud.** De 10 hårdest ramte hold (fx "24/7 Aspire-Light Velo Team" v/Robsteren: 37/37 ryttere ned, "Team Hansen Pro Cycling" v/CyberSimon: 37/38 ned) har typisk 30-38 ungdomsryttere, og STORT SET ALLE nedjusteres — ikke kun deres pot 5-6-stjerner. Se `remap-dryrun-result.json` → `manager_diff` for alle 368 hold.
3. **Rang-bevarelse holder (0 brud verificeret pr. aldersbånd), og fordelings-gaten består for 5 af 6 aldersbånd** — men 16-17-båndet fejler ±2pp-gaten på 11-20-båndet (19,91 % faktisk vs. 17,79 % mål, +2,11pp). Stock-gaten (andel pot≥90) lander på 0,22 % mod forventet 0,20 % (geometri) — tæt på target, IKKE tæt på opgavens forhåndsestimat "~0,32 %" (se afvigelse nedenfor). Så mekanikken virker teknisk korrekt — problemet er at MÅLET selv (samme fordeling for enhver alder/bestand) er for aggressivt når det anvendes på akkumuleret stock.

## 2. Struktur-fund: hvorfor rammer det så bredt?

Algoritmen (§6) bruger ÉN fælles mål-CDF (det enkelte friske kulds draw-geometri, decay 0,55 — 44 % af massen ligger i tier 1 alene) og kvantil-mapper HVERT aldersbånds fulde bestand mod DEN samme fordeling. Men bestanden (også 16-17-årige, pga. managere der beholder toptalenter og lader svage udløbe — spec §3) er langt tættere befolket i tier 2-6 end et friskt kuld: fx har 26-30-årige kun 10,3 % i tier 1 mod målets ~44 %. Resultatet: kvantil-mapningen tvinger næsten al masse over tier 1 ned mod bunden af 1-99-skalaen, uanset hvor langt fra "toppen" rytteren faktisk sad.

| Gammel tier | n | Andel nedjusteret |
|---|---|---|
| 1,0 | 980 | 0 % |
| 1,5 | 985 | 100 % |
| 2,0 | 1.078 | 100 % |
| 2,5 | 1.156 | 100 % |
| 3,0 | 1.181 | 100 % |
| 3,5 | 1.112 | 100 % |
| 4,0 | 700 | 100 % |
| 4,5 | 465 | 100 % |
| 5,0 | 248 | 100 % |
| 5,5 | 176 | 98,3 % |
| 6,0 | 72 | 100 % |

| Aldersbånd | n | Andel nedjusteret | Gnst. delta (99-skala) |
|---|---|---|---|
| 16-17 | 643 | 76,8 % | -21,2 |
| 18-19 | 953 | 80,4 % | -21,7 |
| 20-21 | 749 | 88,4 % | -23,8 |
| 22-25 | 1.814 | 94,8 % | -25,0 |
| 26-30 | 2.722 | 89,7 % | -20,8 |
| 31+ | 1.272 | 85,4 % | -16,3 |

**Anbefaling til ejer-beslutning:** hvis hensigten kun var at korrigere overskuddet i toppen (pot 5-6, spec §6's "11,7 % vs. planens ~1,4 %"), skal målet enten (a) forankres i bestandens EGEN nuværende fordeling med et blødere loft-skub kun i halen, eller (b) accepteres som en bevidst, meget bredere "nulstilling" af hele potentiale-skalaen. Dette script implementerer §6 bogstaveligt — hvis (a) er hensigten, kræver det en revideret algoritme (ikke en tuning af denne, jf. designprincip 5 "tun aldrig for at bestå en gate").

## 3. Fordelingsgate (T1-N3, ±2pp) pr. aldersbånd

Alle bånd består undtagen ét enkelt 10-punkts-bånd i 16-17-gruppen.

| Aldersbånd | Alle 10pkt-bånd inden for ±2pp? | Værste afvigelse |
|---|---|---|
| 16-17 | **NEJ** | bånd 11-20: 19,91 % faktisk vs 17,79 % mål (+2,11pp) |
| 18-19 | Ja | bånd 11-20: +1,94pp |
| 20-21 | Ja | bånd 11-20: +1,97pp |
| 22-25 | Ja | bånd 11-20: +1,94pp |
| 26-30 | Ja | bånd 11-20: +1,97pp |
| 31+ | Ja | bånd 11-20: +1,94pp |

≥90-andel (nyt) vs. mål (samme geometri):

| Aldersbånd | Faktisk ≥90 | Mål ≥90 | Faktisk ≥74 | Mål ≥74 |
|---|---|---|---|---|
| 16-17 | 0,16 % | 0,20 % | 0,78 % | 0,76 % |
| 18-19 | 0,21 % | 0,20 % | 0,84 % | 0,76 % |
| 20-21 | 0,27 % | 0,20 % | 0,80 % | 0,76 % |
| 22-25 | 0,22 % | 0,20 % | 0,77 % | 0,76 % |
| 26-30 | 0,22 % | 0,20 % | 0,81 % | 0,76 % |
| 31+ | 0,24 % | 0,20 % | 0,79 % | 0,76 % |

## 4. Stock-gate (antal pot ≥ 90 på ny 1-99-skala)

- Gammel bestand: 72 ryttere på præcis potentiale 6.0 (0,88 % af 8.153) — NB: dette er IKKE samme definition som spec's "248 pot-6" (som bruger `Math.ceil(potentiale)`, dvs. inkl. 5.5). Rå-6.0-tallet bruges her fordi det er den entydige "top af skalaen"-analogi til ny ≥90.
- Ny bestand: 18 ryttere ≥90 (0,22 %).
- Forventet fra geometrien (denne mål-CDF, beregnet i scriptet): 0,20 % (16,0 forventet).
- Opgavens forhåndsestimat var "~0,32 %" — vores egen numeriske integration af den PRÆCIS specificerede mål-CDF giver 0,20 %, ikke 0,32 %. Afvigelsen er ikke rettet til at matche forhåndsestimatet (designprincip: tun aldrig for at bestå); det rapporteres som en uoverensstemmelse mellem opgavens forhåndsestimat og en direkte numerisk beregning af den specificerede formel — bør afklares, men ændrer ikke konklusionen (begge tal er i samme størrelsesorden, ≈0,2-0,3 %, og selve MÅLET er langt under gammel tier-6-andel).

## 5. Manager-diff — top 10 hårdest ramte hold (ejede ryttere)

| Hold | Manager | Div | n ungdom/akademi | Ned | Op | Størst enkelt-fald | Værdi-delta (v4, estimeret) |
|---|---|---|---|---|---|---|---|
| 24/7 Aspire-Light Velo Team | Robsteren | 3 | 37 | 37 | 0 | Kai H. Lin (17): pot5,0→ny 27 (-52,4) | -2.056.791 |
| Team Hansen Pro Cycling | CyberSimon | 2 | 38 | 37 | 0 | Rafael Branco (18): pot5,0→ny 31 (-48,4) | -2.924.810 |
| RMF Pro Athletic | mewager | 2 | 36 | 36 | 0 | Diego Sánchez (17): pot5,0→ny 32 (-47,4) | -1.205.654 |
| FOSS-Trackman Pro Cycling | andrecl1 | 2 | 34 | 34 | 0 | Bin L. Wang (17): pot5,0→ny 27 (-52,4) | -1.591.196 |
| TR Cycling | trnondisclosure | 2 | 35 | 34 | 1 | Wout Vandeput (17): pot5,0→ny 31 (-48,4) | -1.260.010 |
| Lidl–Leffe Pro Drinking | Ottendahl | 2 | 35 | 33 | 0 | Sven Segers (16): pot5,0→ny 30 (-49,4) | -845.097 |
| Équipe Lorraine Acier | Friisørens Salon | 2 | 35 | 32 | 1 | Sergio Lozano (17): pot5,0→ny 28 (-51,4) | -1.885.774 |
| L'Échappée du Soleil | Above & Beyond | 2 | 31 | 31 | 0 | Adrián López (16): pot4,5→ny 23 (-46,6) | -1.911.069 |
| LEGO-Vestas Cycling Team | dolamba | 2 | 35 | 30 | 4 | Tijl Brughmans (17): pot5,5→ny 34 (-55,2) | -2.290.647 |
| Chuchiet | Chuchiet | 2 | 34 | 30 | 2 | Cooper Hayes (19): pot5,5→ny 41 (-48,2) | -1.818.507 |

Fuld tabel (368 hold) i `remap-dryrun-result.json` → `manager_diff`.

## 6. Top-20 største tabere på tværs (rang-baseret delta)

Alle 20 er 16-17-årige med gammel potentiale 5,0-5,5, ejet af mennesker. Eksempel-udsnit (fuld liste i JSON → `top20_losers_rank`):

| Navn | Alder | Hold/manager | Gammel pot | Ny pot (1-99) | Delta |
|---|---|---|---|---|---|
| Mario S. Iglesias | 16 | Bacon Fræsers / Egomadsen | 5,5 | 33 | -56,2 |
| Cooper Reid | 16 | EvoPro / jcarey983 | 5,5 | 33 | -56,2 |
| Hui Deng | 16 | Scallabis Cycling Team / Costinha | 5,5 | 33 | -56,2 |
| Tijl Brughmans | 17 | LEGO-Vestas Cycling Team / dolamba | 5,5 | 34 | -55,2 |
| Nicolò Sartori | 17 | NewE Pro Cycling / lykkesmail | 5,5 | 34 | -55,2 |

## 7. Værdi-effekt (v4, offline-simuleret)

Metode: samme mønster som `academyOverflowPotentialeConversionDryRun.js` — nuværende evner FASTHOLDT, kun potentiale-feltet varieret (gammelt 1-6-tal vs. ny 1-99-tals tier-ækvivalent tilbageregnet via den eksakte invers af centerformlen). **Begrænsning:** snapshottets abilities mangler 5 skjulte nøgler (tactics/positioning/cobblestone/descending/aggression) — absolutte tal er tilnærmede, men deltaet er robust da samme abilities bruges old/new.

- Sum base_value (simuleret, 8.153 ryttere): 607.123.727 → 443.519.559 (**-163.604.168, -27,0 %**)
- Alle 8.153 ryttere kunne beregnes (0 sprunget over — abilities fandtes for alle i snapshottet).
- Pr.-manager-delta findes i `manager_diff[].valueDeltaSum`.

## 8. Fiktiv-preview FØR/EFTER — IKKE udført (begrundelse)

`backend/scripts/previewFictionalPopulation.js` genererer en helt anden, AFKOBLET population (`fictionalRiderGenerator.js`'s LAUNCH_POPULATION-tiers til markedsførings-/launch-formål). Den kalder aldrig `drawPotentiale`/`academyGenerator.js` og læser ikke `riders.potentiale` — der findes intet "nuværende træk vs. 1-99-træk" at sammenligne der uden at bygge en helt ny bro mellem de to generator-stier, hvilket er ude af scope for denne dry-run. Desuden bekræfter spec §3 selv at admin-preview-fladen kører v3-modellen, ikke live-v4, så selv en sådan bro ville give et misvisende sammenligningsgrundlag. Rapporteret som fund, ikke fabrikeret som tal.

## Filer

- `remap-dryrun-result.json` — fuld maskinlæsbar diff (fordeling, manager_diff for alle 368 hold, top-20-lister, værdi-effekt, struktur-fund).
- `remapDryRun.mjs` — scriptet (deterministisk, FNV-1a-tiebreak via `riderProgression.seededUnit`, ingen `Math.random`).
