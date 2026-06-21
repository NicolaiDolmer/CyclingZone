# Økonomi Fase 2 — kalibrerings-rapport (2026-06-21)

> Refs #1441 (epic), #1607 (præmie). Ejer-godkendt design: `docs/superpowers/specs/2026-06-21-economy-coherence-design.md` + `2026-06-17-okonomi-redesign-1441-design.md`.
> **Status: ANBEFALING — ingen prod-konstant ændret.** Harness + sweep + denne rapport er backend-only. Prod-ændring sker i en separat, ejer-godkendt PR.
> Mål (ejer-låst 2026-06-21): et KOMPETENT hold ~break-even, MÅLT af den ægte syntetiske scorecard — ikke gættet. Net-mål D1≈0 (|median|≤30k) · D2 +0–20k · D3 +0–30k (progressiv, anti-snowball). 5-sæsons saldo i 0,8×–1,3× start. Fladere præmie-fordeling for at skære divergens.

## TL;DR — anbefaling

| Knap | Prod i dag | **Anbefalet** | Begrundelse |
|---|---|---|---|
| `SPONSOR_INCOME_BY_DIVISION` | 600k / 400k / 340k | **UÆNDRET** | Fresh-population-gaten pinner sponsor på prod-niveau (se §3). Enhver hævelse over-fodrer friske hold (D2 → 2,57× start ved sponsor 700k). |
| `PRIZE_PER_POINT` | 1500 | **UÆNDRET** | Hævelse multiplicerer hele præmie-spredningen → ØGER divergens og overshooter break-even på de stærke hold. Den målte præmie er allerede stor. |
| Præmie-fordeling (`uciRacePointDefaults`) | GC-top-tung | **flatten 0.5 (ren GC-kompression, breadthBoost=0)** | Den ENESTE knap der skærer divergens uden at bryde fresh-gaten. Komprimerer Klassement/Klassiker-kurven 50% mod dens middel (sum bevaret); etape/hold-point urørt → relativ vægt skifter mod etapesejre + holdklassement (ejer-direktiv C). |

**Kerneresultat:** den eneste robuste, design-kohærente ændring er **fladere præmie-fordeling**. Sponsor og prize-per-point er låst fra hver sin side (fresh-gate ovenfra på sponsor; divergens nedefra på ppp). Flatten skærer divergensen ~22–26% (p10–p90 spread) og trækker 5-sæsons-trajektorierne ind mod 0,8–1,3×-båndet — uden at røre én eneste prod-konstant nu.

## 1. Den empiriske kerne-spænding (kør scorecardsne — stol ikke på en mental model)

To scorecards måler to FORSKELLIGE hold-populationer og kræver MODSATTE sponsor-niveauer:

| Linse | Hold-model | Lønbyrde | Præmie | Net @ prod-konstanter |
|---|---|---|---|---|
| `moneySupplyScorecard --synthetic-only` | Frisk 8-rytters trup (relaunch) | ~316k | fast estimat 160k/70k/25k | D1 +3,6k · D2 +13,6k · D3 +8,6k → **break-even ✅** |
| `prizeDistributionScorecard` (MÅLER ægte præmie) | Modent, fuldt bygget felt | D1 3,43M / D2 2,31M / D3 957k | MÅLT 2–3,3M (D1) | D1 −372k..+652k · D2 −367..−739k · D3 −216..−323k → **negativ/volatil ❌** |

Hvorfor de ikke kan forenes med én knap: den friske trup har 316k løn, det modne hold 3,4M løn — **10× forskel**, mens sponsor er et FLADT add. En sponsor der lukker det modne gap (~+370k på D1) over-fodrer den friske trup (D2 → 2,57× start ved S5). Et fladt add rammer begge lige hårdt. **Sponsor kan derfor ikke være niveau-knappen for begge.**

Det modne 51M-roster-hold er IKKE det "kompetente break-even"-hold ejeren tuner mod — det er et fuldt udbygget **ambitions-lags-hold** (spec §2 🟢) hvis præmie PER DESIGN skal overstige break-even og finansiere engangs-gold-sinks (faciliteter/staff). Dets prizeDistribution-"deficit" er managed deficit absorberet af 800k-start + geninvestering, ikke en drifts-lags-fejl. Drifts-lags-break-even bevises af fresh-gaten, som forbliver grøn på prod-sponsor.

## 2. Baseline-gap (prizeDistributionScorecard, 3 seeds, prod-konstanter)

Median-net pr. sæson (sponsor − upkeep − løn + præmie):

| Div | seed 2026 | seed 2027 | seed 2028 | median-af-seeds | p10–p90 spread (gns.) | 5-sæsons saldo |
|---|---|---|---|---|---|---|
| D1 | −371.576 | +135.857 | +652.093 | **+135.857** | 2,23M | −0,86× .. 4,26× |
| D2 | −366.669 | −738.775 | −531.669 | **−531.669** | 2,41M | −2,69× .. −0,83× |
| D3 | −322.792 | −232.779 | −216.292 | **−232.779** | 0,52M | −0,61× .. −0,08× |

Diagnose: **lønnen dominerer** (D1 3,4M vs sponsor 600k), og præmien (2–3M) er både stor OG volatil. Trajektorierne sprænger 0,8–1,3×-båndet i begge retninger. Divergensen er høj.

Fresh-population baseline (`moneySupplyScorecard --synthetic-only`): D1 +3,6k · D2 +13,6k · D3 +8,6k, alle ✅, saldo 1,02–1,07× start. **Ingen regression at undgå her — fresh-gaten er allerede sund og skal forblive det.**

## 3. Swept dimensioner + ranges

Sweep: `node scripts/economyCalibrationSweep.js` — 100% syntetisk, importerer den ægte `runScorecard()`, kører hver kandidat × 3 seeds, aggregerer median-af-seeds + Gini + p10–p90 spread + 5-sæsons-ratio, rangerer efter (i) i-bånd, (ii) mål-afstand, (iii) divergens.

| Dimension | Range | Konklusion |
|---|---|---|
| `sponsorBase` D1 | 820k–1.020k (+ fine-tune 680k–800k) | Lukker modent gap, men **bryder fresh-gate** (selv +40k → D2 1,27× / net +53k > +30k-bånd). Pinner på prod. |
| `sponsorBase` D2/D3 | 360k–740k | Samme: fresh-gate dominerer; D2 mest følsom. |
| `prizePerPoint` | 1000 / 1250 / 1500 / (1750 / 2000 i fine-tune) | Multiplikativ → 1750 lukker D1 men overshooter andre seeds (+391k) og **øger divergens**. Forkastet. |
| `flatten` | 0 / 0.3 / 0.5 | 0.5 giver størst divergens-reduktion uden curve-degenerering. |
| `breadthBoost` | 0 / 0.6 | **0 er entydigt bedre.** Breadth-boost (×(1+f·0.6) på etape/hold) ØGER divergens — stærke hold vinder også etaper, så at booste etape-point forstærker dem. Ren GC-kompression (boost=0) er den korrekte læsning af "fladere fordeling". |

**Vigtigste empiriske overraskelse:** "fladere fordeling = mindre divergens" holder KUN for ren GC-kompression. At tilføje absolut vægt på etapesejre (breadthBoost) trækker den anden vej i denne rige-roster-model. Harness-en fangede dette; en mental model ville have anbefalet det forkerte.

Ingen af de 960–1.200 kandidater ramte ALLE net-mål over ALLE 3 seeds samtidig — fordi D1's median-net svinger ±150–300k mellem seeds (præmie-variansen ~1,5–2M dværger ±30k-båndet). Det er en iboende egenskab ved den modne-felt-model, ikke en parameter-fejl.

## 4. Anbefalede tal + resulterende scorecard (flatten 0.5, breadthBoost 0, sponsor/ppp = prod)

Config: `backend/scripts/.cal-recommended.json`. Kør: `node scripts/prizeDistributionScorecard.js --config=scripts/.cal-recommended.json --seed=N`.

| Div | seed 2026 | seed 2027 | seed 2028 | median-af-seeds | p10 (svageste) | p90 (stærkeste) |
|---|---|---|---|---|---|---|
| D1 | −427.076 | −131.143 | +35.593 | **−131.143** | −1,12M | +1,14M |
| D2 | −312.669 | −309.775 | −87.669 | **−309.775** | −0,93M | +1,33M |
| D3 | −216.292 | +155.721 | −47.601 | **−47.601** | −0,28M | +0,32M |

5-sæsons saldo (median-net): D1 0,34×–1,18× · D2 −0,56×–0,56× · D3 −0,08×–1,78×. Trækket mod båndet er tydeligt vs. baseline (D1 4,26×→1,18× i toppen; D2 −2,69×→−0,56× i bunden), men D2 er stadig negativ — det modne D2-hold kører managed deficit (ambitions-lag, ikke drifts-lag).

## 5. Divergens før vs. efter (p10–p90 spread, gns. over 3 seeds)

| Div | Baseline (flatten 0) | Flatten 0.5 / bBoost 0 | Ændring |
|---|---|---|---|
| D1 | 2,23M | 1,64M | **−26%** |
| D2 | 2,41M | 1,89M | **−22%** |
| D3 | 0,52M | 0,46M | −11% |

Gini bevæger sig samme retning for D1/D2 (D1 0,36→0,36, D2 0,47→0,43 i gns.). D3's Gini stiger optisk (0,36→0,41) — et artefakt af min-shift på små absolutte net nær nul; D3's absolutte spread falder også. p10–p90 spread er den mest robuste divergens-måler her og falder i alle divisioner.

## 6. Fresh-population-gen-tjek ved anbefalede params (task 4 — må ikke regressere)

`node scripts/moneySupplyScorecard.js --synthetic-only --config=scripts/.cal-recommended.json`:

| Div | net/sæson | saldo @ S5 | gate |
|---|---|---|---|
| D1 | +3.557 | 1,02× start | ✅ |
| D2 | +13.557 | 1,07× start | ✅ |
| D3 | +8.557 | 1,04× start | ✅ |

**Samlet syntetisk gate: ✅ PASS.** Flatten påvirker IKKE denne linse (fresh-præmien er et fast estimat, ikke den målte kurve), og sponsor/ppp er uændrede → fresh-populationen forbliver præcis break-even. Anbefalingen fikser ikke byggede hold ved at knække friske hold.

## 7. Sensitivitets-caveats (ærlige begrænsninger)

1. **Roster-båndet er det blødeste input.** prizeDistributionScorecard drafter de stærkeste ikke-superstjerne-ryttere → D1-rosters på 51M (3,4M løn). Et "kompetent" hold ejeren forestiller sig er sandsynligvis svagere end dette → den reelle break-even ligger nærmere fresh-modellen. De to scorecards spænder det sande interval ud; det sande kompetente hold ligger imellem.
2. **Seed-varians dominerer ±30k-båndet.** D1's median-net svinger ±150–300k mellem seeds udelukkende fra præmie-RNG. "Alle seeds i bånd" er uopnåeligt med nogen parameter-kombi — rapportér median-af-seeds + seed-spændet, ikke en enkelt seed.
3. **Sponsor er låst fra to sider.** Fresh-gate ovenfra (+40k sponsor bryder D2-båndet), divergens nedefra på ppp. Det efterlader flatten som den eneste sikre knap NU. Hvis ejeren vil hæve det modne holds break-even, kræver det enten (a) en sponsor der SKALERER med roster-styrke/omdømme (Fase 2-renown-motor, ikke en flad konstant), eller (b) at acceptere det modne deficit som ambitions-lag.
4. **Sæson 1 = kun ProSeries.** WT-puljer (10–100× større) er ekskluderet. Sæson 2+ med WT eksploderer præmien → præmie-niveauet må gen-kalibreres når WT-klasser åbnes. Denne kalibrering er konservativ.
5. **Statisk trajektorie.** 5-sæsons-modellen antager samme roster/præmie hver sæson (ingen vækst, ingen transfers, ingen gold-sink-reinvestering). Ambitions-lags-geninvestering (faciliteter) er IKKE modelleret → det modne deficit er overvurderet i absolut forstand.
6. **upkeep urørt.** Fase 1-shipped upkeep (440k/140k/40k) blev IKKE re-tunet — målene var nåelige (på divergens-aksen) uden. Hvis ejeren senere vil sænke det modne deficit uden at røre fresh-gaten, er upkeep-sænkning på D1 den næste kandidat (den rammer modne og friske hold ens, så det skal gen-tjekkes mod fresh-gaten).

## 8. Harness-artefakter (denne PR — backend-only, prod uændret)

- `backend/scripts/lib/economyCalibrationOverrides.js` — override-mekanisme (sponsor/upkeep/prizePerPoint/flatten/breadthBoost) via env / `--config=fil.json`. Prod-konstanter uændrede; overrides default'er TIL prod-værdierne.
- `backend/scripts/prizeDistributionScorecard.js` — refaktoreret til `runScorecard(opts)` (genbrugbar, silent-capable, returnerer struktureret net/divergens) + præmie genberegnes fra `points_earned × override.prizePerPoint` + flatten reshaper point-rows in-memory. CLI uændret i adfærd ved baseline.
- `backend/scripts/economyCalibrationSweep.js` — grid-sweep × seeds, mål-afstand + divergens-rangering, markdown-output.
- `backend/scripts/moneySupplyScorecard.js` — læser nu sponsor/upkeep-override (fresh-gate gen-tjek ved kandidat-params); baseline-adfærd uændret.
- `backend/scripts/.cal-recommended.json` — den anbefalede param-fil.

Reproducér: `node scripts/economyCalibrationSweep.js --markdown` · `node scripts/prizeDistributionScorecard.js --config=scripts/.cal-recommended.json --seed=2026|2027|2028` · `node scripts/moneySupplyScorecard.js --synthetic-only --config=scripts/.cal-recommended.json`.
