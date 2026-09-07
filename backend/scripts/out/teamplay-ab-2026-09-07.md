# Holdspil: hvor meget skal det betyde? A/B-måling 7/9 (#4914 punkt 3)

**Beslutningen er din.** Det her er kun målingen. Ingen tuning-konstant er ændret på `main` — motoren blev skruet lokalt, målt, og skruet tilbage.

## Hvad valget står imellem

- **A — som det er i dag.** En hjælper der har kørt for sin kaptajn hele dagen ender i praksis på den placering hans evner alene siger. Beskyttelsen er ikke synlig i resultatlisterne.
- **B — samme niveau som den nuværende motor (v3).** Hjælperen betaler mærkbart for arbejdet, og kaptajnen står bedre for det. Det er nøjagtig den forskel spillerne oplever i dag.

## Læsning

**1. v4 har reelt intet holdspil i dag.** Målt på tværs af 141 etaper og 5 seeds står den beskyttede rytter **0,5 plads dårligere** end sin hjælper når man har trukket rytternes egne evner fra. Den nuværende motor giver **7,1 pladser**. Rollerne i holdudtagelsen er altså med i v4, men de flytter ikke resultatet.

**2. B rammer paritet næsten præcist.** 6,9 pladser mod v3's 7,1 — og med samme spredning mellem seeds (3,7-9,9 mod 3,7-10,0). Det er ikke "tæt på", det er den samme størrelse.

**3. B koster ingen ankre.** Ikke én af de 13 ankre skifter dom mellem A og B. De fire der er røde (feltsammenhæng på fladt, favoritternes vinderrate, bjergspredning, højbjergshalen) var røde i forvejen og ligger uden for det her valg.

**4. Én margin bliver tyndere.** Nedkørsels-mod-bjergtop-forholdet flytter sig fra 0,35 til 0,46 med loft på 0,50. Middelværdien er stadig grøn, men på de dårligste enkelt-seeds går den til 0,71 mod 0,53 i dag. Det er den eneste pris i tallene.

**5. Tallet "19,4 pladser" fra reglerne er forældet.** Det blev målt mod juli-populationen. Mod den rigtige, re-eksporterede population (7/9) er den nuværende motors eget tal 7,1. B er sat efter det målte tal, ikke efter det gamle.

## Anbefaling

**Vælg B.** Holdspillet er en af de ting spilleren selv sætter op før løbet, og i dag kan han ikke se at det virker — B køber den fulde effekt spillerne allerede kender fra i dag, uden at en eneste anker-dom skifter, og den eneste omkostning er en tyndere margin på ét nedkørsels-tal.

## Hvad målingen ikke dækker

- **Halegaten kan ikke skelne A fra B.** Den harness kører uden hold-id og uden roller, så holdspillet er slukket der. Den røde højbjergshale i tabellen er en tilstand på `main` — den er hverken forårsaget eller løst af det her valg.
- **Ankertallene kan ikke sammenlignes 1:1 med ankertabellen i `RACE_ENGINE_RULES.md` §7b.** Holdspil kræver roller, så målingen kører med AI-taktik slået til; §7b kører uden. A mod B er sammenligningen, ikke A mod §7b.
- **Ingen fuld sæson.** Målingen er etape-for-etape på proxy-kalenderen, så samlet GC-effekt over et helt etapeløb er ikke målt.
- **Kun to niveauer.** Der er ikke ledt efter et mellemtrin; ved et lokalt gæt halvvejs (pris ×2) lå gabet omkring 1 plads, altså stadig næsten usynligt.

## Sådan genskabes målingen

```
# A (uændret main):
node backend/scripts/teamPlayAbMeasure.mjs --label=A --out=backend/scripts/out/teamplay-ab-2026-09-07-A.json

# B: sæt de fem tal fra tabellen "Tuning-værdierne bag hver variant" i
# backend/lib/engine/v4/tuning.ts (teamPlayExtra), kør, og revertér bagefter:
node backend/scripts/teamPlayAbMeasure.mjs --label=B --out=backend/scripts/out/teamplay-ab-2026-09-07-B.json

node backend/scripts/teamPlayAbMeasure.mjs --render \
  --a=backend/scripts/out/teamplay-ab-2026-09-07-A.json \
  --b=backend/scripts/out/teamplay-ab-2026-09-07-B.json \
  --out=backend/scripts/out/teamplay-ab-2026-09-07.md
```

---

<!-- teamplay-ab:start -->

> Alt mellem markoererne er GENERERET af `backend/scripts/teamPlayAbMeasure.mjs --render`. Ret ikke tallene i haanden.

Maalt 2026-09-07T10:13:43.720Z (A) og 2026-09-07T10:19:46.088Z (B).

Samme motor, samme pinnede population (`backend/scripts/baselines/population-snapshot-2026-09-07.json`), samme pinnede proxy-etaper (`backend/scripts/baselines/v4-proxy-stages-2026-09-06.json`), 5 seeds (s1, s2, s3, s4, s5), felt 180, `--orders=ai`. Kun holdspils-tuningen (M16) er forskellig mellem A og B.

**A** (nuvaerende, paa main): nuvaerende niveau paa main (TEAM_PLAY_EXTRA_TUNING uaendret)

**B**: v3-paritet: hjaelperens pris og kaptajnens loft x2,7, CP-gulvet 0,70 -> 0,58 (fundet ved soegning, saa v4's beskyttelses-gab rammer v3's under identiske betingelser)

## Beskyttelses-gab (noegletallet)

Pladser den beskyttede rytter staar bedre end sin hjaelper, ud over hvad rytternes egen evne-rang forklarer. 0 = motoren har intet holdspil.

| | v3 (uaendret referencemotor) | v4 A | v4 B |
|---|---|---|---|
| Beskyttelses-gab, middel (spaend over seeds) | 7.10 (3.67-9.99) | -0.50 (-4.11-1.38) | 6.90 (3.74-9.98) |
| Leder over/under forventet | -1.58 | 4.31 | 4.74 |
| Hjaelper over/under forventet | -6.80 | 0.09 | -7.07 |

## Ankre: A mod B

Middel over seeds, spaend i parentes. Kun v4-kolonnerne; v3 er den samme motor i begge koersler.

| Anker | Baand | v4 A | v4 B | Skift |
|---|---|---|---|---|
| Felt-sammenhaeng, flade etaper | 80.0%-95.0% | 30.3 % (29.3 %-31.4 %) FAIL | 30.3 % (29.3 %-31.4 %) FAIL |  |
| Nedkoersels-gaps vs. summit-gaps (ratio) | <= 0.5 | 0.35 (0.26-0.53) PASS | 0.46 (0.27-0.71) PASS |  |
| Descent attack-gevinst (10-20s-loft, aldrig omvendt fortegn i gruppen) | 10-20s | 20s (20s-20s) PASS | 20s (20s-20s) PASS |  |
| Punch-korrelation (punch-evne vs. placering paa punch-etaper) | spearman > 0.2 | 0.82 (0.82-0.83) PASS | 0.82 (0.82-0.83) PASS |  |
| Brostensevnens loeft paa brosten/grus (spearman-forskel vs. flad) | loeft >= 0.03 (FORSLAG, ikke ejer-godkendt) | 0.047 (0.019-0.112) PASS | 0.043 (0.012-0.112) PASS |  |
| Felt-favoritters win-rate | 25.0%-40.0% | 56.6 % (53.2 %-60.3 %) FAIL | 56.2 % (52.5 %-58.2 %) FAIL |  |
| Samme-hold-top-10 (andel etaper med 4+ fra ét hold) | < 3.0% | 0.0 % (0.0 %-0.0 %) PASS | 0.0 % (0.0 %-0.0 %) PASS |  |
| Udbruds-rater pr. terraen (descent-dominans 54% skal ned) | race:gate-baand (ingen fast tal her — se gate-konfig) | n/a | n/a |  |
| Sprinter-vinderrate paa flat (top-20%-sprint-evne vinder) | >= 90.0% | 96.0 % (91.4 %-100.0 %) PASS | 96.0 % (91.4 %-100.0 %) PASS |  |
| ITT-korrelation (time_trial-evne vs. placering, synlig) | spearman > 0.3 | 0.83 (0.81-0.85) PASS | 0.83 (0.81-0.85) PASS |  |
| Bonussekunder GC-effekt bounded (maks ~10s/etape) | <= 10s/etape pr. rytter | 10s (10s-10s) PASS | 10s (10s-10s) PASS |  |
| Bjergetape top-10-spredning, topankomster (#2415) | 180-240s (~3-4 min) | 130s (100s-150s) FAIL | 126s (99s-143s) FAIL |  |
| GT-vindermargin (#2415) | 60-480s (1-8 min) | n/a | n/a |  |

## Hale-gate (§9 raekke 13, ejer-laast 7/9)

Koert med `v4TailSpread.js --gate`, s1, s2, s3, felt 180.

| Etapetype | Baand | A: ren p90 | A | B: ren p90 | B |
|---|---|---|---|---|---|
| flat | 0-2 % | 0.20 % | PASS | 0.20 % | PASS |
| high_mountain | 6-12 % | 5.24 % | FAIL | 5.24 % | FAIL |
| mountain | 6-12 % | 6.60 % | PASS | 6.60 % | PASS |

Samlet gate-dom: A FAIL · B FAIL.

## Tuning-vaerdierne bag hver variant

| Knap | A | B |
|---|---|---|
| `helperCostFractionGc` | 0.15 | 0.405 |
| `helperCostFractionFlat` | 0.133 | 0.3591 |
| `helperCostFractionOther` | 0.075 | 0.2025 |
| `hunterCostFraction` | 0.05 | 0.135 |
| `captainMaxBonusFraction` | 0.08 | 0.216 |
| `transferEfficiency` | 0.6 | 0.6 |
| `minCpFactor` | 0.7 | 0.58 |
| `supportSaturationWorkers` | 4 | 4 |
| `minWorkersForProtection` | 1 | 1 |

<!-- teamplay-ab:end -->
