# Omdømme-kalibrering — afspilning af S1-S3 (2026-09-04)

> Genereret af `backend/scripts/reputation-calibration.js` (READ-ONLY) mod prod.
> Spec: `docs/superpowers/specs/2026-09-04-reputation-system-design.md` §9. Refs #1099.

## Grundlag

- Afsluttede løb afspillet: **1000**, heraf **900** med mindst én hændelse.
- Hændelser udledt: **24664**.
- Aktiv sæson: **S3** (halveringen regnes herfra).
- Population i fordelingen: **7441** aktive ryttere (62 pensionerede holdt udenfor).

## Datadækning (læs FØR tallene nedenfor)

Resultatrækker der KUNNE give en hændelse (top-10 i gc/stage/trøje, plus førertrøje-dage), og hvor mange af dem der har `rider_id = NULL` og derfor pr. definition ikke kan give omdømme til nogen:

| Sæson | Relevante rækker | Uden `rider_id` | Andel |
|---|---|---|---|
| (løb ikke afsluttet) | 572 | 0 | 0.00 % |
| S1 | 17835 | 9908 | 55.55 % |
| S2 | 19689 | 7337 | 37.26 % |
| S3 | 4390 | 5 | 0.11 % |

## Mål (spec §9)

| Mål (spec §9) | Krav | SEED_FLOOR_WEIGHT 1,0 | SEED_FLOOR_WEIGHT 0,5 |
|---|---|---|---|
| Median (p50) | ≤ 10 | 4.0 (JA) | 2.5 (JA) |
| p75 | — | 16.0 | 8.2 |
| p95 | — | 54.0 | 30.0 |
| Andel ≥ 70 (Stjerne) | 1-2 % | 0.77 % = 57 (NEJ) | 0.38 % = 28 (NEJ) |
| Andel ≥ 90 (Legende) | ≤ 0,3 % | 0.39 % = 29 (NEJ) | 0.19 % = 14 (JA) |
| Top-20 vindere alle ≥ 70 | ja | NEJ (2 under) | NEJ (5 under) |
| Stjerner UDEN hændelser (kun seed) | lavt | 0 | 0 |

## Fordeling — SEED_FLOOR_WEIGHT 1

| Bånd | Antal | Andel |
|---|---|---|
| Unknown/Ukendt (0+) | 6124 | 82.30 % |
| Known/Kendt (20+) | 716 | 9.62 % |
| Profile/Profil (45+) | 544 | 7.31 % |
| Star/Stjerne (70+) | 28 | 0.38 % |
| Legend/Legende (90+) | 29 | 0.39 % |

Gennemsnit 11.8 · p50 4.0 · p75 16.0 · p95 54.0.

## Fordeling — SEED_FLOOR_WEIGHT 0,5

| Bånd | Antal | Andel |
|---|---|---|
| Unknown/Ukendt (0+) | 6623 | 89.01 % |
| Known/Kendt (20+) | 748 | 10.05 % |
| Profile/Profil (45+) | 42 | 0.56 % |
| Star/Stjerne (70+) | 14 | 0.19 % |
| Legend/Legende (90+) | 14 | 0.19 % |

Gennemsnit 6.6 · p50 2.5 · p75 8.2 · p95 30.0.

## Top 50 (SEED_FLOOR_WEIGHT 1)

| # | Rytter | Omdømme | Gulv | Form | Seed | Hændelser | Sejre | Bånd |
|---|---|---|---|---|---|---|---|---|
| 1 | George Whitfield (`aa0450c0`) | 100.0 | 56.0 | 131.9 | 18 | 134 | 49 | legend |
| 2 | Jakub Adamczyk (`fb1ab6b8`) | 100.0 | 51.0 | 72.7 | 39 | 140 | 47 | legend |
| 3 | Romain Girard (`225119d2`) | 100.0 | 30.0 | 71.9 | 16 | 78 | 34 | legend |
| 4 | Koen Peeters (`d2ec9035`) | 100.0 | 60.0 | 49.4 | 93 | 64 | 33 | legend |
| 5 | Tomáš Zupan (`92dcf704`) | 100.0 | 51.0 | 71.6 | 42 | 84 | 32 | legend |
| 6 | Gonzalo Herrera (`65be311a`) | 100.0 | 34.0 | 83.5 | 15 | 103 | 31 | legend |
| 7 | Ren Watanabe (`5aa69671`) | 100.0 | 60.0 | 75.2 | 60 | 61 | 29 | legend |
| 8 | Nicolò Bruno (`00c3943a`) | 100.0 | 50.0 | 57.7 | 42 | 93 | 26 | legend |
| 9 | Yassine Benali (`f9609365`) | 100.0 | 60.0 | 69.2 | 50 | 107 | 26 | legend |
| 10 | Kenta Hayashi (`133dbda6`) | 100.0 | 42.0 | 94.0 | 15 | 75 | 25 | legend |
| 11 | Bram Visser (`73df3117`) | 100.0 | 60.0 | 61.8 | 50 | 97 | 24 | legend |
| 12 | Corentin Vidal (`34cf1d6c`) | 100.0 | 40.0 | 69.5 | 18 | 72 | 23 | legend |
| 13 | Daan Visser (`0c168b5b`) | 100.0 | 49.0 | 61.8 | 43 | 118 | 21 | legend |
| 14 | Lei Lin (`e698d171`) | 100.0 | 60.0 | 66.7 | 44 | 53 | 21 | legend |
| 15 | Jack Holland (`f8b9f71d`) | 100.0 | 60.0 | 68.4 | 42 | 75 | 20 | legend |
| 16 | Marcos López (`e68018e3`) | 100.0 | 56.0 | 58.0 | 38 | 96 | 19 | legend |
| 17 | Daan Goossens (`60c65b91`) | 100.0 | 57.0 | 43.7 | 49 | 88 | 14 | legend |
| 18 | Javier Fuentes (`01c69758`) | 100.0 | 60.0 | 50.5 | 65 | 52 | 10 | legend |
| 19 | Tommaso Sorrentino (`b67913f4`) | 98.2 | 38.0 | 60.2 | 26 | 111 | 15 | legend |
| 20 | Kilian Schäfer (`31924b29`) | 97.9 | 52.0 | 45.9 | 44 | 77 | 7 | legend |
| 21 | Long Zhou (`8e75fe9e`) | 97.6 | 46.0 | 51.6 | 32 | 60 | 21 | legend |
| 22 | Rubén Lozano (`72e1a37d`) | 96.4 | 60.0 | 36.4 | 78 | 75 | 23 | legend |
| 23 | Florian Wolf (`3b37ebcf`) | 93.9 | 49.0 | 44.9 | 48 | 95 | 8 | legend |
| 24 | Riccardo Orlando (`e08f99b0`) | 93.7 | 45.0 | 48.7 | 44 | 65 | 30 | legend |
| 25 | Niels Coppens (`6f9e7859`) | 93.3 | 54.0 | 39.3 | 46 | 89 | 11 | legend |
| 26 | Ryan Whitfield (`7cbcb9ce`) | 93.1 | 20.0 | 73.1 | 17 | 121 | 32 | legend |
| 27 | Natnael Mugisha (`0ca8839f`) | 92.5 | 57.0 | 35.5 | 54 | 70 | 9 | legend |
| 28 | Jack Marsh (`4756b432`) | 91.7 | 46.0 | 45.7 | 41 | 90 | 16 | legend |
| 29 | Andrea Tonti (`4b967136`) | 90.7 | 52.0 | 38.7 | 49 | 102 | 21 | legend |
| 30 | Andrea Riva (`80f8890e`) | 88.2 | 34.0 | 54.2 | 32 | 115 | 7 | star |
| 31 | Cristian Marini (`55d493b8`) | 88.2 | 48.0 | 40.2 | 44 | 74 | 25 | star |
| 32 | Leon Richter (`7d2b98a2`) | 87.7 | 27.0 | 60.7 | 18 | 64 | 7 | star |
| 33 | Romain Roussel (`02f282e6`) | 86.7 | 58.0 | 28.6 | 50 | 23 | 10 | star |
| 34 | Sven Janssen (`47b74633`) | 86.0 | 60.0 | 26.0 | 65 | 55 | 9 | star |
| 35 | Carlos Sánchez (`84026a69`) | 85.4 | 21.0 | 64.4 | 16 | 98 | 24 | star |
| 36 | Cody Bennett (`4bb5abb3`) | 85.2 | 60.0 | 25.2 | 49 | 45 | 7 | star |
| 37 | Tommaso Moretti (`dbe05d70`) | 82.3 | 49.0 | 33.3 | 45 | 56 | 7 | star |
| 38 | Daniel Quintero (`5f4fbdcc`) | 81.9 | 39.0 | 42.9 | 29 | 43 | 6 | star |
| 39 | Sander Holm (`4223ed73`) | 80.9 | 60.0 | 20.9 | 72 | 42 | 10 | star |
| 40 | Marcos S. Campos (`068a7fdd`) | 79.9 | 60.0 | 19.9 | 69 | 57 | 7 | star |
| 41 | Karim Toumi (`26289e0c`) | 77.9 | 42.0 | 35.9 | 40 | 45 | 8 | star |
| 42 | Long Liu (`138a59d8`) | 76.8 | 60.0 | 16.8 | 49 | 2 | 1 | star |
| 43 | Tarek Khelifi (`351884b7`) | 76.2 | 60.0 | 16.2 | 85 | 46 | 2 | star |
| 44 | Sebastian Sommer (`16727219`) | 75.4 | 60.0 | 15.4 | 70 | 38 | 6 | star |
| 45 | João Cardoso (`4d1aa153`) | 75.2 | 60.0 | 15.2 | 73 | 23 | 2 | star |
| 46 | Stefano Bruno (`4bf5f043`) | 73.9 | 50.0 | 23.9 | 49 | 98 | 11 | star |
| 47 | Kai Liang (`5a8f81d6`) | 73.7 | 60.0 | 13.7 | 73 | 7 | 1 | star |
| 48 | Sergio Castro (`54f70025`) | 73.6 | 56.0 | 17.6 | 55 | 31 | 8 | star |
| 49 | James Murphy (`2c0a7933`) | 73.4 | 60.0 | 13.4 | 82 | 43 | 3 | star |
| 50 | Loïc Gauthier (`0ad7bb77`) | 73.4 | 60.0 | 13.4 | 63 | 11 | 0 | star |

## De 20 mest vindende ryttere i S1-S3

| # | Rytter | Sejre | Omdømme | Gulv | Form | Seed | ≥ 70 |
|---|---|---|---|---|---|---|---|
| 1 | George Whitfield | 49 | 100.0 | 56.0 | 131.9 | 18 | ja |
| 2 | Jakub Adamczyk | 47 | 100.0 | 51.0 | 72.7 | 39 | ja |
| 3 | Romain Girard | 34 | 100.0 | 30.0 | 71.9 | 16 | ja |
| 4 | Niels Vermeulen | 33 | 72.2 | 21.0 | 51.2 | 16 | ja |
| 5 | Koen Peeters | 33 | 100.0 | 60.0 | 49.4 | 93 | ja |
| 6 | Ryan Whitfield | 32 | 93.1 | 20.0 | 73.1 | 17 | ja |
| 7 | Tomáš Zupan | 32 | 100.0 | 51.0 | 71.6 | 42 | ja |
| 8 | Gonzalo Herrera | 31 | 100.0 | 34.0 | 83.5 | 15 | ja |
| 9 | Ruben Segers | 31 | 66.6 | 22.0 | 44.6 | 21 | NEJ |
| 10 | Riccardo Orlando | 30 | 93.7 | 45.0 | 48.7 | 44 | ja |
| 11 | Ren Watanabe | 29 | 100.0 | 60.0 | 75.2 | 60 | ja |
| 12 | Yassine Benali | 26 | 100.0 | 60.0 | 69.2 | 50 | ja |
| 13 | Nicolò Bruno | 26 | 100.0 | 50.0 | 57.7 | 42 | ja |
| 14 | Tijl Tielemans | 26 | 57.9 | 13.0 | 44.9 | 10 | NEJ |
| 15 | Kenta Hayashi | 25 | 100.0 | 42.0 | 94.0 | 15 | ja |
| 16 | Cristian Marini | 25 | 88.2 | 48.0 | 40.2 | 44 | ja |
| 17 | Aitor Rubio | 25 | 100.0 | 60.0 | 46.0 | 74 | ja |
| 18 | Carlos Sánchez | 24 | 85.4 | 21.0 | 64.4 | 16 | ja |
| 19 | Bram Visser | 24 | 100.0 | 60.0 | 61.8 | 50 | ja |
| 20 | Rubén Lozano | 23 | 96.4 | 60.0 | 36.4 | 78 | ja |

## Sammenligning mod seed

**Største stigninger vs. seed (`riders.popularity`)**

| Rytter | Seed | Omdømme | Δ | Hændelser |
|---|---|---|---|---|
| Kenta Hayashi | 15 | 100.0 | +85.0 | 75 |
| Gonzalo Herrera | 15 | 100.0 | +85.0 | 103 |
| Romain Girard | 16 | 100.0 | +84.0 | 78 |
| Corentin Vidal | 18 | 100.0 | +82.0 | 72 |
| George Whitfield | 18 | 100.0 | +82.0 | 134 |
| Ryan Whitfield | 17 | 93.1 | +76.1 | 121 |
| Tommaso Sorrentino | 26 | 98.2 | +72.2 | 111 |
| Leon Richter | 18 | 87.7 | +69.7 | 64 |
| Carlos Sánchez | 16 | 85.4 | +69.4 | 98 |
| Long Zhou | 32 | 97.6 | +65.6 | 60 |
| Marcos López | 38 | 100.0 | +62.0 | 96 |
| Lachlan Mitchell | 11 | 72.8 | +61.8 | 118 |
| Jakub Adamczyk | 39 | 100.0 | +61.0 | 140 |
| Nicolò Bruno | 42 | 100.0 | +58.0 | 93 |
| Tomáš Zupan | 42 | 100.0 | +58.0 | 84 |

**Største fald vs. seed** (seedede kendisser uden resultater)

| Rytter | Seed | Omdømme | Δ | Hændelser |
|---|---|---|---|---|
| Oliver Newton | 94 | 60.0 | -34.0 | 0 |
| Niels Lenaerts | 94 | 60.0 | -34.0 | 0 |
| Riccardo Ferrari | 94 | 60.0 | -34.0 | 0 |
| Corentin Charpentier | 94 | 60.0 | -34.0 | 0 |
| Marcos Ramírez | 93 | 60.0 | -33.0 | 0 |
| Aitor Iglesias | 91 | 60.0 | -31.0 | 0 |
| Tomáš Kovač | 91 | 60.0 | -31.0 | 0 |
| Javier Vega | 89 | 60.0 | -29.0 | 0 |
| Ayoub Bouazza | 88 | 60.0 | -28.0 | 0 |
| Jack Walker | 89 | 62.0 | -27.0 | 9 |
| Óscar Sierra | 88 | 61.1 | -26.9 | 2 |
| Guo Deng | 85 | 60.0 | -25.0 | 0 |
| Joris Coppens | 85 | 60.0 | -25.0 | 0 |
| Kaito Y. Yamamoto | 85 | 60.1 | -24.9 | 2 |
| Hamza Mansouri | 85 | 60.6 | -24.4 | 3 |

## Hændelser pr. type

| Hændelsestype | Antal |
|---|---|
| `stage_top10` | 6877 |
| `one_day_top10` | 3128 |
| `stage_podium` | 2146 |
| `jersey_points_top10` | 1596 |
| `jersey_mountain_top10` | 1554 |
| `gc_top10` | 1520 |
| `jersey_young_top10` | 1459 |
| `stage_win` | 1075 |
| `one_day_podium` | 952 |
| `leader_day` | 860 |
| `jersey_points_podium` | 515 |
| `one_day_win` | 480 |
| `jersey_young_podium` | 480 |
| `jersey_mountain_podium` | 478 |
| `gc_podium` | 474 |
| `jersey_points_win` | 283 |
| `gc_win` | 268 |
| `jersey_mountain_win` | 267 |
| `jersey_young_win` | 252 |

## Hændelser pr. sæson og løbsklasse

| Sæson | Klasse | Hændelser | Form-point i alt | Gulv-kredit i alt |
|---|---|---|---|---|
| S1 | Class1 | 2201 | 1270.8 | 0.0 |
| S1 | Class2 | 666 | 219.7 | 0.0 |
| S1 | GiroVuelta | 105 | 159.3 | 35.0 |
| S1 | OtherWorldTourA | 34 | 47.2 | 7.0 |
| S1 | OtherWorldTourB | 11 | 10.3 | 0.0 |
| S1 | ProSeries | 4887 | 4072.4 | 180.0 |
| S1 | TourFrance | 23 | 40.6 | 8.0 |
| S2 | Class1 | 2251 | 1228.2 | 0.0 |
| S2 | Class2 | 1377 | 444.0 | 0.0 |
| S2 | OtherWorldTourB | 60 | 150.0 | 36.0 |
| S2 | OtherWorldTourC | 562 | 685.6 | 122.0 |
| S2 | ProSeries | 8102 | 6126.4 | 211.0 |
| S3 | Class1 | 2395 | 1069.8 | 0.0 |
| S3 | GiroVuelta | 237 | 425.2 | 99.0 |
| S3 | Monuments | 10 | 40.0 | 15.0 |
| S3 | OtherWorldTourA | 105 | 160.5 | 12.0 |
| S3 | OtherWorldTourB | 40 | 100.0 | 24.0 |
| S3 | OtherWorldTourC | 490 | 568.0 | 90.0 |
| S3 | ProSeries | 1108 | 969.0 | 48.0 |


---

## Vurdering og anbefaling (håndskrevet, ikke genereret)

> Vægtene i `reputationConstants.js` er IKKE ændret. Spec §4's tabel er ejer-godkendt;
> nedenstående er hvad tallene siger der bør justeres, til beslutning.

**Status: 3 af 4 mål er ikke nået med de nuværende vægte.**

### 1. Fordelingen er en vægtstang, ikke en pyramide

57 ryttere ligger ≥ 70 — men 29 af dem ligger på præcis 100,0, fordi formen løber langt
over det synlige loft: nr. 1 har form 131,9 oven på et gulv på 56, altså tre gange så
meget som de 44 point der er plads til. Samtidig falder feltet brat: 544 ryttere ligger i
Profil-båndet (45-69) og kun 28 mellem 70 og 89.

Konsekvensen er at Stjerne-båndet er for tyndt (0,77 % mod målet 1-2 %) OG Legende-båndet
for tykt (0,39 % mod loftet 0,3 %) på samme tid. Det kan ikke løses ved at skrue på en
enkelt vægt: hæves formen, vokser Legende-gruppen hurtigere end Stjerne-gruppen.

**Forslag:** erstat den hårde `clamp(floor + form, 0, 100)` med et blødt loft, fx
`reputation = floor + (100 − floor) · (1 − 0,5^(form / K))`. Point-tabellen i §4 kan stå
uændret; der kommer ét nyt kalibreringstal (K). Effekten er at de 29 ryttere der i dag
deler 100,0 spredes ud over 85-100, og at 70-89 fyldes op af feltet lige under.

### 2. De to top-20-vindere der falder igennem, vinder i de lave klasser

| Rytter | Sejre | Omdømme | Gulv | Hvorfor |
|---|---|---|---|---|
| Ruben Segers | 31 | 66,6 | 22,0 | sejrene ligger i ProSeries/Class1-2 |
| Tijl Tielemans | 26 | 57,9 | 13,0 | samme, og lavere seed (10) |

Gulv-kreditten er +1 for en ProSeries-sejr og 0 for Class1/Class2 — men det er dér
størstedelen af kalenderen ligger (ProSeries + Class1/2 = 93 % af alle hændelser: 22.987 af 24.664).
En rytter kan altså vinde 31 løb og stadig have et karriere-gulv på 22.

**Forslag:** hvis "de 20 mest vindende skal alle være ≥ 70" skal holde, skal enten
ProSeries-kreditten op (+1 → +2) eller Class1 have en lille kredit (0 → +0,5). Alternativt
accepteres målet som formuleret for WorldTour-vindere alene — det er en spilbeslutning,
ikke en teknisk.

### 3. SEED_FLOOR_WEIGHT skal blive på 1,0

Spec §9 forudsatte at seed-gulvet ville skabe for mange Stjerner uden resultater.
**Det sker ikke i data: 0 ryttere ligger ≥ 70 uden en eneste hændelse.** At sænke vægten
til 0,5 halverer Stjerne-gruppen (57 → 28) og trækker medianen ned uden at løse noget.
Anbefaling: behold 1,0.

### 4. Historikken er delvist slettet — kalibrér med det in mente

55,6 % af S1's og 37,3 % af S2's relevante resultatrækker har `rider_id = NULL` (ryttere
der er væk siden, typisk sammen med nedlagte AI-hold). De rækker kan pr. definition ikke
give omdømme til nogen. S3 har 0,1 %.

Det betyder to ting: (a) de nuværende tal undervurderer systematisk ryttere med lang
karriere, og (b) andelen ≥ 70 vil stige af sig selv i takt med at sæsoner med fuld dækning
akkumuleres. En vægtjustering der rammer 1-2 % på DENNE historik kan derfor overskyde til
næste sæson. Anbefalingen i punkt 1 (blødt loft) er robust over for det; en ren opskruning
af formpointene er ikke.

### Anbefalet rækkefølge

1. Beslut blødt loft ja/nej (punkt 1) — det er den eneste ændring der kan ramme både
   Stjerne- og Legende-målet på samme tid.
2. Beslut om top-20-målet gælder alle klasser (punkt 2).
3. Kør denne harness igen; først derefter `reputation-backfill.js --apply --owner-go`.

Backfill er IKKE kørt. Intet er skrevet i prod.
