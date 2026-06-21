# Økonomi Fase 2 — kalibrerings-rapport (2026-06-21)

> Refs #1441 (epic), #1607 (præmie). Ejer-godkendt design: `docs/superpowers/specs/2026-06-21-economy-coherence-design.md` + `2026-06-17-okonomi-redesign-1441-design.md`.
> **Status: SHIPPED — flatten 0.5 bagt ind i prod-defaulten** (`backend/lib/uciRacePointDefaults.js` via `backend/lib/racePointFlatten.js`, ejer-godkendt). Sponsor + `PRIZE_PER_POINT` står UÆNDREDE per konklusionen nedenfor. Harnessen genbruger samme transform, så scorecardet ved PROD (override flatten 0) matcher den shippede kurve bit-for-bit.
> Mål (ejer-låst 2026-06-21): et KOMPETENT hold ~break-even, MÅLT af den ægte syntetiske scorecard — ikke gættet. Net-mål D1≈0 (|median|≤30k) · D2 +0–20k · D3 +0–30k (progressiv, anti-snowball). 5-sæsons saldo i 0,8×–1,3× start. Fladere præmie-fordeling for at skære divergens.

## TL;DR — hvad der blev shippet, og hvad beviset er

**Drifts-lags-break-even ER bevist — af fresh-population-gaten, ikke af det modne felt.**
`moneySupplyScorecard --synthetic-only` (det friske 8-rytters relaunch-hold, ~316k løn) lander på **D1 +3,6k · D2 +13,6k · D3 +8,6k pr. sæson, alle ✅** ved prod-sponsor/upkeep, og flatten rører den IKKE (fresh-præmien er et fast estimat). Det er drifts-lags-sandheden: et frisk kompetent hold går i nul-til-let-positiv. Saldo 1,02–1,07× start over 5 sæsoner. **Det er den linse der skal forblive grøn — og den gør det.**

**`prizeDistributionScorecard`-net-tabellerne er IKKE en break-even-måling — de er divergens-diagnostik for ambitions-laget.** Det script drafter de stærkeste ikke-superstjerne-rosters (D1 ~51M roster / 3,4M løn) — et fuldt udbygget ambitions-lags-hold hvis præmie PER DESIGN overstiger break-even og finansierer gold-sinks. Dets "deficit/overskud" pr. seed er managed (absorberet af 800k-start + geninvestering), ikke en drifts-fejl. Brug det til at læse **divergensen** (hvor langt fra hinanden stærke og svage hold ender), ikke til at læse break-even.

| Knap | Prod | **Beslutning** | Begrundelse |
|---|---|---|---|
| `SPONSOR_INCOME_BY_DIVISION` | 600k / 400k / 340k | **UÆNDRET** | Fresh-gaten pinner sponsor på prod-niveau (§3). Enhver hævelse over-fodrer friske hold (D2 → 2,57× start ved sponsor 700k). Et fladt sponsor-add kan ikke være niveau-knap for både et 316k- og et 3,4M-løns-hold. |
| `PRIZE_PER_POINT` | 1500 | **UÆNDRET** | Hævelse multiplicerer hele præmie-spredningen → ØGER divergens og overshooter break-even på de stærke hold. |
| Præmie-fordeling (`uciRacePointDefaults`) | ~~GC-top-tung~~ → **flatten 0.5 SHIPPED** | ✅ | Den ENESTE knap der skærer divergens uden at bryde fresh-gaten. Komprimerer Klassement/Klassiker-kurven 50% mod sin egen middel pr. race-class (**sum bevaret → niveau uændret, kun formen flader**); etape/troje/hold-point urørt (breadthBoost=0). |

**Kerneresultat:** den shippede ændring er **fladere præmie-fordeling**. Den skærer p10–p90 net-divergensen **−26% (D1) / −21% (D2) / −11% (D3)** og trækker 5-sæsons-trajektorierne ind mod 0,8–1,3×-båndet — uden at flytte fresh-gate-break-even og uden at fjerne vinder-incitamentet (rank 1 ≫ rank 20 i den serverede kurve). **Store klubbers bæredygtighed løses IKKE her** — den hører til Fase 2's omdømme-skalerede sponsor (en sponsor der vokser med roster-styrke/renown), ikke en flad konstant. Flatten er anti-divergens; renown-motoren er niveau-knappen for det modne lag.

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

## 8. Artefakter (denne PR — prod-flatten + harness)

**Prod-ændring (serveret kurve):**
- `backend/lib/racePointFlatten.js` — **NY.** Delt, sum-bevarende flatten-transform-kerne (`applyFlattenToPointRows` + `compressTowardMean`) + de shippede konstanter `PROD_FLATTEN=0.5`, `PROD_BREADTH_BOOST=0`. Bruges af BÅDE prod-defaulten og harnessen → bit-identitet.
- `backend/lib/uciRacePointDefaults.js` — `buildUciMenRacePointRows()` bager nu flatten 0.5 ind i den serverede kurve (rå baseline eksponeret som `buildRawUciMenRacePointRows()` til tests). Klassement/Klassiker-toppen komprimeret, sum bevaret, etape/troje/hold urørt.

**Harness (prod uændret af disse):**
- `backend/scripts/lib/economyCalibrationOverrides.js` — override-mekanisme (sponsor/upkeep/prizePerPoint/flatten/breadthBoost) via env / `--config=fil.json`; re-eksporterer nu flatten-transformen fra `racePointFlatten.js` (ingen duplikeret matematik). **NB:** prod-kurven ER allerede flad → kør scorecards med override flatten=0 (prod-mode) for at undgå dobbelt-fladning.
- `backend/scripts/prizeDistributionScorecard.js` — `runScorecard(opts)` (genbrugbar, silent-capable, struktureret net/divergens) + præmie fra `points_earned × override.prizePerPoint` + flatten reshaper point-rows in-memory.
- `backend/scripts/economyCalibrationSweep.js` — grid-sweep × seeds, mål-afstand + divergens-rangering, markdown-output.
- `backend/scripts/moneySupplyScorecard.js` — læser sponsor/upkeep-override; fresh-gate gen-tjek.
- `backend/scripts/.cal-recommended.json` — nu PROD-MODE (flatten 0, fordi prod-defaulten allerede er flad).

Reproducér prod-kurven: `node scripts/prizeDistributionScorecard.js --seed=2026|2027|2028` (uden flag = prod-default-kurven; matcher §4-tallene). Fresh-gate: `node scripts/moneySupplyScorecard.js --synthetic-only`. Sweep: `node scripts/economyCalibrationSweep.js --markdown`.
