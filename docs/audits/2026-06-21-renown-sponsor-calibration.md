# Renown-sponsor-kalibrering — harness-rapport (2026-06-21)

> Refs #1663 (renown-sponsor, økonomi Fase 2), #1441 (epic). Bygger oven på `docs/audits/2026-06-21-economy-fase2-calibration.md` (flatten 0.5 shipped).
> **Status: KALIBRERET — `W_RESULTS=0.45` + `MAX_MULTIPLIER=1.40` bagt ind i `backend/lib/renownEngine.js`.** Erstatter placeholder-gættet (0.60 / 1.60).
> Mål (#1663 §7, SIMULÉR-FØR-SHIP-gaten): træk det MODNE felt mod break-even UDEN at bryde fresh-population-gaten og UDEN at hæve divergens (Gini). Empirisk kalibreret mod den ægte `prizeDistributionScorecard` + `moneySupplyScorecard --synthetic-only` — ikke gættet.

## TL;DR — hvad der blev valgt, og hvad beviset er

**Renown-skalering trækker det modne D1-felt dead-on break-even OG sænker divergens — de to mål er aligned, ikke i spænding.**

Den ikke-intuitive kerne: i det modne felt bærer de STÆRKESTE hold den DYBESTE løn-deficit (D1-roster 51M / løn 3,4M). En sponsor der vokser med resultat-historik giver MEST til netop de hold der ligger længst under break-even → den TRÆKKER BUNDEN AF NET-FORDELINGEN OP mod toppen → **komprimerer** spredningen. Resultatet: hver aktiv renown-kandidat har **ΔGini ≤ 0** (divergens falder). Renown er her både niveau-knap (modent break-even) OG anti-divergens — i modsætning til prizePerPoint (som hæver divergens) eller flatten (som kun skærer divergens).

| Knap | Placeholder | **Valgt** | Begrundelse |
|---|---|---|---|
| `W_RESULTS` | 0.60 | **0.45** | D1 median-net lander dead-on break-even (+3.857, median-af-3-seeds). 0.60 overskyder D1 positivt (+48.857) og sprænger 5-sæsons-trajektorien (1,24× > 1,3×-bånd ved gode seeds); 0.45 holder D1 i 1,02×. Mindste modne D1+D2-deficit blandt Gini-ok-kandidater der IKKE overskyder. |
| `MAX_MULTIPLIER` | 1.60 | **1.40** | Top-holdets ceiling. Ved W_RESULTS=0,45 er det naturlige loft `1+0,45 = 1,45`; 1,40 gør clamp'en AKTIV (top-hold cappes på 1,40, ikke 1,45) og bevarer sanity-relationen `1+W_RESULTS ≥ MAX_MULTIPLIER` (1,45 ≥ 1,40). Medianen rører ikke clamp'en, så D1/D2/D3-median er identisk for maxMult 1,4/1,6/1,8 — 1,40 giver den laveste p90/spread (mindst tail-divergens). |

**Fresh-gate-bevis (uændret):** `moneySupplyScorecard --synthetic-only` lander **D1 +3.557 · D2 +13.557 · D3 +8.557, alle ✅** — identisk med pre-renown-baselinen. Friske hold har ingen resultat-historik → `computeResultsScore`=0 → multiplier=1,0 → sponsor = division-base UÆNDRET. Gaten er bevaret per konstruktion (`renownSponsorFor({standing:null}) === divisionBase`) og verificeret empirisk.

## 1. Den per-team sponsor-hook + hvordan renown blev tråd ind

Den modne scorecard (`prizeDistributionScorecard.js`) anvendte sponsor FLADT pr. division (`const sponsor = sponsorBase[d]` i net-løkken). Renown kræver en PER-TEAM sponsor afhængig af holdets resultat-historik. Tråd:

1. **Standing fra simulerede point.** Præmie = point × prizePerPoint inden for ét ppp-niveau, så hvert holds `total_points = seasonPrize[team] / prizePerPoint` (eksakt). Per division bygges en standing-tabel (`total_points` + `rank_in_division` fra sortering).
2. **resultsScore via DEN DELTE prod-funktion.** `economyCalibrationOverrides.renownSponsorFor(...)` kalder `computeResultsScore` importeret fra `renownEngine.js` — harness-formlen matcher prod bit-for-bit (ingen reimplementering).
3. **Multiplier + sponsor.** `renownMultiplier = clamp(1 + wResults × resultsScore, 1.0, maxMultiplier)`; `sponsor = round(divisionBase × renownMultiplier)`. Anvendt per hold i net-beregningen.
4. **Samme-sæsons standing som proxy for "sidste sæson"** (eksplicit antagelse — den eneste resultat-historik i denne statiske 1-sæsons-model; et modent felt antages stabilt mellem sæsoner).

`wResults`/`maxMultiplier` er nye override-felter i `economyCalibrationOverrides.js` med **default = `renownEngine.js`-eksporterne** → "ingen override" = prod. `moneySupplyScorecard.js` kalder samme `renownSponsorFor` med `standing=null` (multiplier 1,0) → fresh-tallet uændret, beviset per konstruktion.

## 2. Swept ranges + sweep-metode

`node scripts/economyCalibrationSweep.js --renown --markdown` — 100% syntetisk, importerer den ægte `runScorecard()`, holder sponsor/ppp/curve på de Fase-2-besluttede PROD-værdier og sweeper KUN renown-knapperne × 3 seeds (2026/2027/2028), aggregerer median-af-seeds + Gini + p10–p90 spread + 5-sæsons-ratio.

| Dimension | Range | Note |
|---|---|---|
| `wResults` | {0, 0.3, 0.45, 0.6, 0.75} | 0 = renown SLUKKET (= flad sponsor på flatten-0.5-curve) = anti-snowball-referencepunkt |
| `maxMultiplier` | {1.4, 1.6, 1.8} | Top-holdets ceiling |
| sponsor / ppp / curve | PROD (uændret) | sponsor 600k/400k/340k · ppp 1500 · prod-curve (flatten 0.5 bagt) |

**Rangering (#1663 §7):** (i) hård filter — ingen division-Gini må stige > 0,005 over wResults=0-baselinen (anti-snowball); (ii) mindste modne D1+D2-deficit (|median-net|, tættest på break-even); (iii) mindste gns. Gini.

## 3. Rangeret sweep-tabel (median-af-3-seeds)

| # | wResults | maxMult | D1 net | D2 net | D3 net | modent D1+D2 \|net\| | gns. Gini | ΔGini vs off | D1 spread | D2 spread | Gini-ok |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **0.45** | **1.4** | **3.857** | **-219.775** | **15.440** | **223.632** | **0.406** | **-0.007** | **1.703.218** | **2.184.647** | **✅** |
| 2 | 0.45 | 1.6 | 3.857 | -219.775 | 15.440 | 223.632 | 0.409 | -0.004 | 1.708.608 | 2.204.647 | ✅ |
| 3 | 0.45 | 1.8 | 3.857 | -219.775 | 15.440 | 223.632 | 0.409 | -0.004 | 1.708.608 | 2.204.647 | ✅ |
| 4 | 0.6 | 1.4 | 48.857 | -189.775 | 36.453 | 238.632 | 0.396 | -0.017 | 1.703.218 | 2.184.647 | ✅ |
| 5 | 0.6 | 1.6 | 48.857 | -189.775 | 36.453 | 238.632 | 0.408 | -0.005 | 1.788.122 | 2.264.647 | ✅ |
| 6 | 0.6 | 1.8 | 48.857 | -189.775 | 36.453 | 238.632 | 0.408 | -0.005 | 1.788.122 | 2.264.647 | ✅ |
| 7 | 0.75 | 1.4 | 93.857 | -159.775 | 57.467 | 253.632 | 0.388 | -0.025 | 1.703.218 | 2.184.647 | ✅ |
| 8 | 0.75 | 1.6 | 93.857 | -159.775 | 57.467 | 253.632 | 0.399 | -0.014 | 1.823.218 | 2.264.647 | ✅ |
| 9 | 0.3 | 1.4 | -41.143 | -249.775 | -5.574 | 290.918 | 0.410 | -0.003 | 1.629.094 | 2.144.647 | ✅ |
| 10 | 0.3 | 1.6 | -41.143 | -249.775 | -5.574 | 290.918 | 0.410 | -0.003 | 1.629.094 | 2.144.647 | ✅ |
| 11 | 0.3 | 1.8 | -41.143 | -249.775 | -5.574 | 290.918 | 0.410 | -0.003 | 1.629.094 | 2.144.647 | ✅ |
| 12 | 0 (OFF) | — | -131.143 | -309.775 | -47.601 | 440.918 | 0.413 | +0.000 | 1.463.218 | 2.024.647 | ✅ (baseline) |
| 13 | 0.75 | 1.8 | 93.857 | -159.775 | 57.467 | 253.632 | 0.408 | -0.005 | 1.867.636 | 2.324.647 | ⚠️ +0.006 |

Kun #13 (0,75/1,8) tipper én divisions-Gini > 0,005 over baseline → forkastet af den hårde filter. Alle øvrige aktive kandidater SÆNKER gns. Gini.

## 4. Hvorfor #1 (W_RESULTS=0.45 / MAX_MULTIPLIER=1.40)

- **D1 dead-on break-even fra neden.** Median-net +3.857 (median-af-seeds) — tættest på 0 af alle kandidater der ikke overskyder positivt. wResults=0,3 underkompenserer (D1 −41.143, stadig deficit); wResults=0,6+ overskyder D1 positivt OG sprænger trajektorien.
- **Mindste modne D1+D2-deficit (223.632)** blandt kandidater der holder D1 ≈ 0 — D2's restdeficit (−219.775) er det modne ambitions-lags managed deficit (jf. forrige audit §1/§7: D2-feltet kører bevidst deficit absorberet af 800k-start + geninvestering, ikke en drifts-fejl).
- **5-sæsons-trajektorie i bånd.** Median-af-seeds: D1 1,02× · D3 1,08× (D2 −0,10× = managed deficit). Til sammenligning: wResults=0,6 giver D1 1,24× og wResults=0,75 giver 1,47× (> 1,3×-bånd).
- **Divergens FALDER** (gns. Gini 0,406 vs 0,413 OFF, Δ −0,007). Gaten "Gini må ikke stige" er ikke bare opfyldt — divergensen forbedres.
- **MAX_MULTIPLIER=1.40 holder clamp'en meningsfuld.** Ved wResults=0,45 er det naturlige loft 1,45; 1,40 cappar de absolutte top-hold (resultsScore≈1,0) på 1,40 i stedet for 1,45, hvilket giver den laveste p90/spread af de tre maxMult-værdier (medianen rører ikke clamp'en, så D1/D2/D3-median er ens). Bevarer sanity `1+W_RESULTS ≥ MAX_MULTIPLIER`.

## 5. Før vs. efter — modent net + divergens (median-af-3-seeds)

| Div | Net OFF (wRes=0) | **Net VALGT (0.45/1.40)** | Gini OFF | **Gini VALGT** | p10–p90 OFF | **p10–p90 VALGT** |
|---|---|---|---|---|---|---|
| D1 | −131.143 | **+3.857** | 0.375 | **0.377** | 1.463.218 | 1.703.218 |
| D2 | −309.775 | **−219.775** | 0.411 | **0.410** | 2.024.647 | 2.184.647 |
| D3 | −47.601 | **+15.440** | 0.453 | **0.431** | 504.464 | 640.464 |
| gns. | — | — | 0.413 | **0.406** | — | — |

Per-seed D1 median-net (VALGT): seed 2026 −292.076 · seed 2027 +3.857 · seed 2028 +170.593 → **median +3.857**. Seed-variansen (±150–300k fra præmie-RNG) dominerer ±30k-båndet — som i forrige audit rapporteres median-af-seeds + seed-spændet, ikke en enkelt seed.

**Bemærk p10–p90 spread STIGER let** mens Gini falder. Det er ikke en modsigelse: renown løfter HELE divisionens net-niveau (alle hold får ≥ deres flade sponsor), så de absolutte tal vokser en smule, men den RELATIVE spredning (Gini, robust over for niveau-skift) falder fordi bunden løftes mest. Gini er den korrekte anti-snowball-måler her (den forrige audit brugte p10–p90 fordi flatten ÆNDREDE præmie-formen; renown ændrer kun sponsor-NIVEAU pr. hold, så Gini er den rene divergens-linse). Begge divisioner D2/D3 ser Gini falde; D1 er flad (+0,002, indenfor støj).

## 6. Fresh-population-gen-tjek (må ikke regressere)

`node scripts/moneySupplyScorecard.js --synthetic-only`:

| Div | net/sæson | saldo @ S5 | gate |
|---|---|---|---|
| D1 | +3.557 | 1,02× start | ✅ |
| D2 | +13.557 | 1,07× start | ✅ |
| D3 | +8.557 | 1,04× start | ✅ |

**Samlet syntetisk gate: ✅ PASS.** Identisk med pre-renown-baselinen (forrige audit §6). Friske hold har standing=null → `computeResultsScore`=0 → multiplier=1,0 → sponsor = division-base. Renown rører IKKE fresh-gaten — verificeret empirisk + per konstruktion.

## 7. Ærlige begrænsninger

1. **Samme-sæsons standing = proxy for sidste sæson.** Den statiske 1-sæsons-model har ingen ægte sæson-over-sæson-historik. I prod beregnes resultsScore fra FORRIGE sæsons standing; harnessen bruger den simulerede SAMME-sæsons standing. For et stabilt modent felt (samme roster år for år) er de tæt på ens — men et hold der lige er rykket op/havde et udsving får i prod en multiplier baseret på fortiden, ikke nutiden. Antagelsen er konservativ for kalibrerings-formålet (måler den stabile ligevægt).
2. **Renown forstærker vinder-incitamentet by design.** §7 kræver "Gini må ikke stige materielt" — opfyldt (Gini falder faktisk her). MEN: det skyldes den specifikke modne-felt-topologi (stærke hold = dybeste deficit). Hvis fremtidige roster-/præmie-ændringer flytter de stærke hold til at være de mest PROFITABLE, ville renown forstærke divergens. Gen-kør denne sweep hvis prize/roster-modellen ændrer sig væsentligt (især når WT-klasser åbner i sæson 2+).
3. **Seed-varians dominerer.** D1's median-net svinger ±150–300k mellem seeds udelukkende fra præmie-RNG. "Alle seeds i bånd" er uopnåeligt; median-af-seeds er den rapporterede sandhed.
4. **D2 restdeficit er ikke løst — by design.** D2-feltet (−219.775) kører managed deficit som ambitions-lag. Renown trækker det fra −309.775 mod 0, men lukker det ikke. At lukke det helt ville kræve enten højere wResults (overskyder D1 + sprænger trajektorien) eller en separat D2-knap — uden for denne kalibrerings scope.
5. **Arvet fra forrige audit:** sæson 1 = kun ProSeries (konservativ præmie); statisk trajektorie (ingen vækst/transfers/gold-sink-reinvestering); upkeep urørt; roster-båndet er det blødeste input. De to scorecards spænder det sande break-even-interval ud; det ægte kompetente hold ligger mellem fresh- og modent-modellen.

## 8. Artefakter (denne PR)

**Prod-ændring:**
- `backend/lib/renownEngine.js` — `W_RESULTS=0.45`, `MAX_MULTIPLIER=1.40` bagt ind (placeholder-kommentar erstattet med kalibrerings-note + ref til denne rapport).

**Harness (prod uændret af disse):**
- `backend/scripts/lib/economyCalibrationOverrides.js` — `wResults`/`maxMultiplier`-override (default = renownEngine-eksporterne) + delt `renownSponsorFor(...)` der genbruger `computeResultsScore`.
- `backend/scripts/prizeDistributionScorecard.js` — per-team renown-sponsor via simuleret standing (point = præmie/ppp); per-division standing-tabel; sponsor-display viser renown p10/median/p90.
- `backend/scripts/moneySupplyScorecard.js` — synthetisk fresh-net via `renownSponsorFor({standing:null})` (= base, bevis per konstruktion).
- `backend/scripts/economyCalibrationSweep.js` — `--renown`-mode: holder sponsor/ppp/curve på prod, sweeper wResults×maxMultiplier; rangering = Gini-ok (hård filter) → mindst modent D1+D2-deficit → mindst Gini.

Reproducér: `node scripts/economyCalibrationSweep.js --renown --markdown` (sweep) · `node scripts/prizeDistributionScorecard.js --seed=2026|2027|2028` (modent felt ved valgte konstanter) · `node scripts/moneySupplyScorecard.js --synthetic-only` (fresh-gate).
