# Staff-rigdom bølge A4 (#2216 / #1441 Fase 3) — harness-bevis (ability-drevet effekt)

> 2026-07-05 · merge-gate-supplement for FACILITIES_ENABLED (flip = separat ejer-beslutning).
> Harness: `backend/scripts/facilityInvestmentScorecard.js` (nu 5 gates) + `inflationScorecard.js`.
> Spec: `docs/superpowers/specs/2026-07-05-staff-richness-design.md` §2/§7.
> Bygger på A2-kalibreringen (`docs/audits/2026-07-05-facility-investment-calibration.md`) —
> facilitets-PRISER/BASE-EFFEKTER/UPKEEP fra A2 er UÆNDREDE (ejer-reviewede). A4 rørte KUN
> de NYE staff-konstanter (effekt-faktor-kurve + specialiserings-vægte).

## Hvad A4 ændrede i modellen (før balance)

A3 gav staff som **tier → udnyttelses-skalar** (`staffUtilization(tier)` = 0,5 + 0,1·tier,
range 0,5–1,0). A4 flyttede prod-modellen til en **ability-drevet** model (spec §2):

- **Effekt:** `staffEffectFactor(staff) = FLOOR + SLOPE·(overall/99)` — drevet af staffens
  overall (1–99), ikke tier. Tier bliver et afledt kvalitets-bånd (`TIER_OVERALL_BAND`),
  hvis midtpunkt er den repræsentative overall for en besat facilitet.
- **Løn:** `staffSalaryFor(overall)` (konveks rating-kurve) erstatter den flade tier-tabel —
  løn bider proportionalt med staffens faktiske kvalitet (Q1).
- **Specialisering:** `specializationMatch(staff, {dimension, level})` — per-rytter multiplikator
  (dimension×niveau), wired ind i trænings-motoren (Task 7).

Harnesset (`facilityInvestmentModel.js`) er rewiret co-SSOT: det mapper sit integer-staff-tier
→ repræsentativt overall (midtpunkt af `TIER_OVERALL_BAND[tier]`) → staff-objekt og kalder
**prod'ens** `staffEffectFactor`/`staffSalaryFor`/`specializationMatch` direkte. Drift-guard-testen
asserterer `computeBonus == prod-effectiveBonus(track, fac, staffObj)` på netop den staff-objekt-sti
alle prod-call-sites nu bruger.

## Resultat (efter kalibrering)

Scorecardet kørt UDEN `--config` mod prod-filen `backend/lib/facilityConstants.js`:

```
HEADLINE: facility-gates ✅ PASS — A2/A4-merge-gate opfyldt
  tid-som-valuta ✅ · kommerciel payback ✅ · anti-optimal-path ✅ · form-gates ✅ · specialiserings-balance ✅

HEADLINE: inflations-gate ✅ PASS (syntetisk primær; §2.1-mål-kurve).
```

**Ærlig margin-status:**

| Gate | Margin | Vurdering |
|---|---|---|
| Anti-optimal-path (værste celle: D3/×0,5-leverage) | 3.-bedste = **90,1%** af max (krav ≥ 90%) | **RAZOR-TYND (0,1pp).** Se owner-flag #1. Alle andre 8 celler ≥ 92,5% |
| Specialiserings-balance (generalist vs. matchet specialist) | specialist **+8,6%** over generalist (ratio 0,921 ∈ [0,90, 1,10]) | TYND (1,4pp fra ±10%-loftet). Bevidst: specialisten SKAL være bedre på match, men ikke dominere |
| Specialiserings-symmetri | svageste/stærkeste dim-specialist = **1,000** | Rigelig — de tre dimensioner er præcis symmetriske (samme vægte) |
| Specialist mod mismatch-behov | **0,957** af generalist (krav ≥ 0,80) | Rigelig — en fejl-matchet specialist er stadig ~96% af en generalist (spilbar, ikke en fælde) |
| Staff-relevans (løn/marginal-værdi, D2) | **0,246–0,334** (bånd [0,05, 0,40]) | Grøn med luft (før A4-rewire toppede t4 på 0,401 — se nedenfor) |
| Tid-som-valuta / kommerciel payback / form-form-gates | uændret fra A2 (rører ikke staff-effekt-kurven) | Uændret grønne |

## Startpunkt: hvad den rå A4-model-rewire gjorde ved gatene

Da harnesset blev rewiret til den ability-drevne model MED de oprindelige Task-6-start-konstanter
(FLOOR 0,5 · SLOPE 0,5 · weightDimension 0,25 · weightLevel 0,15), fejlede **3 af 5 gates**:

1. **anti-optimal-path D3 = 1/5** (krav ≥3). Årsag: den ability-drevne faktor er FLADERE mellem
   tiers end den gamle skalar. Gammel `staffUtilization`: null=0,5 · t1=0,6 · … · t5=1,0 (jævne
   0,1-trin). Ny ved tier-midtpunkter (FLOOR 0,5/SLOPE 0,5): null=0,5 · t1=0,682 · t2=0,742 ·
   t3=0,803 · t4=0,859 · t5=0,909. Det store spring er fra "ingen chef" (0,5) til "enhver chef"
   (0,68+), og trinene MELLEM tiers er små. Det gjorde et gulv på 0,5 for stærkt relativt til at
   ANSÆTTE: dybde-strategier (der investerer i staff) kunne ikke indhente "balanced" i D3's stramme
   budget ved lav leverage → balanced dominerede.
2. **specialiserings-balance: generalist/specialist = 0,877** (specialist ~14% bedre — over ±10%).
   weightDimension 0,25 + weightLevel 0,15 gav for stærk specialist-fordel ved spread 20 / overall 70.
3. **staff-relevans t4 = 0,401** (marginalt over 0,40-loftet) — konsekvens af den nye tier→overall→
   `staffSalaryFor`-mapping ift. t4's marginale værdi.

## Kalibrering (empirisk søgning i scratch, IKKE committet)

Grid-søgning over de NYE staff-konstanter (FLOOR, SLOPE, weightDimension, weightLevel,
salary-base/exponent), ~1.150 kandidater evalueret mod alle 5 gates + 9 anti-optimal-celler
(3 divisioner × 3 leverage-scenarier), fulgt af afrunding til rene tal.

**Nøgle-fund (ærligt, styrende for valget):**

- **Anti-optimal D3 KAN IKKE blive grøn med FLOOR = 0,5** — ved ethvert SLOPE (testet op til 0,7)
  bliver D3/×0,5-cellen på 0,871–0,896 (< 0,90). Gulvet på 0,5 gør "ingen chef" strukturelt for
  stærkt. Kun et LAVERE gulv (0,4) løser det (staff-ansættelse bliver et større relativt spring).
- Løsningsrummet der passer ALLE gates: FLOOR ∈ {0,4} med SLOPE ∈ {0,55, 0,6} (0,45/0,6 var
  razor-thin/fejlede robusthed). Den robuste, rene løsning: **FLOOR 0,4 · SLOPE 0,6** →
  `factor = 0,4 + 0,6·(overall/99)`, range **[0,4, 1,0]** (en overall-99-chef giver PRÆCIS 1,0).
- Specialiserings-vægte: sænket til weightDimension 0,15 · weightLevel 0,08 → matchet specialist
  +8,6% (inden for ±10%, 1,4pp margin). Højere vægte (0,17/0,10 → +9,9%) var razor-thin.
- **Salary-kurven blev IKKE ændret** (base 2600 · ref 81 · exp 4): staff-relevans-gaten blev grøn
  af sig selv, fordi det lavere effekt-gulv (0,4) hæver staffens MARGINALE værdi (ansættelse løfter
  fra 0,4 i stedet for 0,5 → større delta) → løn/værdi-forholdet falder ind i båndet.

## Konstanter: Task-6-start → kalibreret (KUN nye staff-konstanter)

| Konstant | Start (Task 6) | Kalibreret | Hvorfor |
|---|---|---|---|
| `STAFF_EFFECT_FACTOR_FLOOR` | 0,5 | **0,4** | Anti-optimal-path D3: gulv 0,5 gjorde "ingen chef" strukturelt for stærkt; 0,4 gør ansættelse til et større relativt spring → dybde-strategier indhenter balanced i D3 |
| `STAFF_EFFECT_FACTOR_SLOPE` | 0,5 | **0,6** | Sammen med FLOOR 0,4 → range [0,4, 1,0]; en overall-99-chef giver nu PRÆCIS 1,0 (før 0,909) |
| `STAFF_SPECIALIZATION.weightDimension` | 0,25 | **0,15** | Specialiserings-balance: matchet specialist var ~14% bedre (over ±10%); nu +8,6% |
| `STAFF_SPECIALIZATION.weightLevel` | 0,15 | **0,08** | Samme — dimension+niveau-bidrag skaleret ned sammen |
| `STAFF_SPECIALIZATION.floor/cap` | 0,85 / 1,4 | uændret | Cap'en er nu IKKE bindende (max-akser giver kun 1,23 < 1,4) — sikkerheds-øvre-grænse |
| `STAFF_SALARY_CURVE` | base 2600 / ref 81 / exp 4 | uændret | Relevans-gaten blev grøn af det lavere effekt-gulv; ingen løn-justering nødvendig |
| **FACILITY_TIER_PRICE / UPKEEP / BASE_EFFECT** | A2-værdier | **UÆNDREDE** | Ejer-reviewede A2-konstanter; A4 rørte dem ikke |

Effekt-faktor-tabel (kalibreret), staff ved tier-midtpunkter:

| tier | overall (bånd-midt) | faktor (0,4+0,6·o/99) | løn (`staffSalaryFor`) |
|---|---|---|---|
| — (ingen chef) | — | 0,400 | — |
| 1 | 36 | 0,618 | 151 |
| 2 | 48 | 0,691 | 371 |
| 3 | 60 | 0,764 | 833 |
| 4 | 71 | 0,830 | 1.585 |
| 5 | 81 | 0,891 | 2.650 |
| (teoretisk 99) | 99 | 1,000 | (cap 6.000) |

## Gate-detaljer (faktisk harness-output)

### Anti-optimal-path (§2.3) — baseline-leverage (×1,0), 10-sæsoners styrke-proxy

| Division | training-first | commercial-first | academy-first | support-first | balanced | konkurrencedygtige |
|---|---|---|---|---|---|---|
| D1 | 756.374 ✓ | 469.587 | 451.829 | 797.626 ✓ | 781.869 ✓ | 3/5 |
| D2 | 208.575 ✓ | 35.162 | 41.962 | 207.490 ✓ | 203.081 ✓ | 3/5 |
| D3 | 35.722 ✓ | 5.644 | 17.476 | 35.722 ✓ | 38.622 ✓ | 3/5 |

3.-bedste strategi som andel af bedste (krav ≥ 90%):

| Leverage | D1 | D2 | D3 |
|---|---|---|---|
| ×1,0 | 94,8% | 97,4% | 92,5% |
| ×0,5 | 94,8% | 98,8% | **90,1%** ← binding |
| ×1,5 | 94,8% | 96,9% | 93,3% |

Den konkurrencedygtige trio er {training-first, support-first, balanced} i alle divisioner (som A2);
hvem der er BEDST skifter med division (D1: support-first · D2: training-first · D3: balanced).

### Specialiserings-balance (#2216 A4, §7)

```
  [generalist-vs-specialist]
    generalist/{physical,mental,technical}-specialist (matchet behov): 0,921 ∈ [0,90, 1,10] ✅
  [ingen-dominant-specialisering]
    svageste/stærkeste dim-specialist (matchet): 1,000 ≥ 0,90 ✅
  [specialist-mismatch-spilbar]
    {dim}-specialist mod {andet}-behov / generalist: 0,957 ≥ 0,80 ✅
```

Model: ved fast overall (70) og spread (20) bygges en generalist (flade akser) og en matchet
specialist (én dimension+niveau løftet, øvrige sænket). Effektiv trænings-værdi = base-effekt ×
`staffEffectFactor(overall)` × `specializationMatch(staff, behov)`. Generalist og matchet specialist
inden for ±10%; de tre dim-specialister symmetriske; en fejl-matchet specialist stadig ~96% af generalist.

### Tid-som-valuta / kommerciel payback / form-gates

Uændret fra A2 (staff-effekt-kurven påvirker ikke priser/tid-som-valuta). Staff-relevans-under-gaten
(del af form-gates) er nu 0,246–0,334 (før A4-rewire toppede den på 0,401 = ❌; det lavere effekt-gulv
løftede den marginale staff-værdi → forholdet faldt ind i båndet). Kommerciel payback ∞ overalt (uændret).

## Antagelser + følsomhed

| Antagelse | Værdi | Kilde/status |
|---|---|---|
| Repræsentativ besat-staff-kvalitet | MIDTPUNKT af `TIER_OVERALL_BAND[tier]` | NY A4-antagelse. Kandidat-derivationen trækker PRNG-varieret i samme bånd → gennemsnits-staffen ≈ midt. Et scorecard bruger midtpunktet (stabilt, ikke draw) |
| Specialiserings-test-profil | overall 70 · spread 20 | Repræsentativ tier-4-besat facilitet med én stærk akse; spread spejler derivationens specialisering+kontrast |
| Alle A2-antagelser | budget-proxy, leverage, RECURRING_CAP, hold-fordeling | Uændrede (A4 rører ikke dem) |

**Følsomhed / advarsler til fremtidige ændringer:**

- **RAZOR-TYND anti-optimal-margin (owner-flag #1):** D3/×0,5-leverage-cellen er 90,1% (0,1pp over
  kravet). Enhver ændring af `TIER_OVERALL_BAND`-midtpunkter, effekt-faktor-kurven, facilitets-priser
  eller leverage-antagelserne KAN vælte denne celle. Kør harness FØR enhver justering. (A2's værste
  celle var 94,5%; A4's ability-model er strukturelt tættere på grænsen i D3, fordi den flade staff-
  kurve favoriserer bredde/balanced i det stramme D3-budget.)
- **Specialiserings-marginen er 1,4pp** (specialist +8,6% mod ±10%-loftet). Hæves weightDimension/
  weightLevel, eller øges spread'et i test-profilen, kan generalist/specialist-checket vælte.
- Den kalibrerede effekt-faktor er FLADERE end den gamle util-skalar (t5-chef 0,891 vs. gammel 1,0).
  Det er en bevidst konsekvens af co-SSOT: overall-modellen kan ikke give en tier-5-chef fuld faktor
  1,0, fordi tier-5-BÅNDET topper ved overall 90, ikke 99. Kun en teoretisk overall-99-chef får 1,0.

## Non-regression

Kørt 2026-07-05 på den kalibrerede HEAD. Alle outputs er faktiske kørsler.

**Fresh-gate (`moneySupplyScorecard --synthetic-only`):**

```
HEADLINE: syntetisk net-gate ✅ PASS (primær). Live er reference only.
```

Per-division net/sæson UÆNDRET: D1 **+3.557** ✅ · D2 **+13.557** ✅ · D3 **+8.557** ✅
(balance-trajektorie S5 1,03× / 1,11× / 1,07× start — identisk med A2).

**Prize-distribution (`prizeDistributionScorecard`, default seed 2026, 22 hold):** exit 0, Gini UÆNDRET:

| Division | Gini | p10–p90 spread |
|---|---|---|
| D1 | 0,357 | 331.790 |
| D2 | 0,377 | 236.760 |
| D3 | 0,387 | 150.512 |

**Strukturelt bevis (grep):** `grep -rE "facilityConstants|staffAbility|STAFF_*|staffSalaryFor|
staffEffectFactor|specializationMatch|facilityInvestmentModel|facilityEngine"
scripts/moneySupplyScorecard.js scripts/prizeDistributionScorecard.js scripts/economyCalibrationSweep.js
scripts/lib/economyCalibrationOverrides.js` → **0 hits**. Fresh-/Gini-harnesserne importerer hverken
staff-konstanterne eller effekt-modellen → A4-kalibreringen KAN ikke påvirke de gates.

**Fuld lokal verifikation (`scripts/verify-local.ps1`):** exit 0 — backend-tests **2805/2805 pass, 0 fail**.
(Frontend-tests/build sprunget over i worktree: `frontend/node_modules` mangler. A4 er backend-only —
ingen frontend-ændringer i denne slice; profil-UI er A4b. CI's frontend-jobs dækker gaten.)

**Test-audit:** de opdaterede tests ændrede KUN forventnings-TAL til de kalibrerede konstanter
(gulv 0,5→0,4, spec-vægte, cap ikke-bindende) + tilføjede nye asserts (tierToOverall, staffSalary-cache,
specialiserings-balance). Ingen assertions fjernet eller svækket; drift-guarden STRAMMET (fra deprecated
integer-tier-sti til den staff-objekt-sti prod faktisk bruger).

## OWNER-RELEVANTE FLAGS (checkpoint før flip)

1. **Anti-optimal-path D3-margin er razor-thin (90,1%, 0,1pp over kravet).** Den ability-drevne
   staff-model er strukturelt tættere på ±10%-grænsen i D3 end A2's skalar var, fordi den fladere
   staff-effekt-kurve favoriserer "balanced" (bredde) i D3's stramme budget. Gaten er teknisk grøn,
   men enhver fremtidig justering af tier-bånd/effekt-kurve/priser skal genkøre harness. **Beslutning:**
   accepterer ejeren 90,1% som "grøn", eller ønskes en bredere margin (kræver enten en stejlere
   staff-kurve — som gør staff mere pay-to-win — eller en løsere ±-tolerance i gaten)?

2. **En tier-5-chef giver nu maks. effekt-faktor 0,891, ikke 1,0** (fuld 1,0 kræver den teoretiske
   overall-99, som ligger over tier-5-båndets top på 90). Det er en direkte konsekvens af den ability-
   drevne co-SSOT-model (tier er et bånd, ikke et fast punkt). Spiller-oplevelsen: selv den bedste
   ansættelige chef "efterlader lidt på bordet" — der er altid en marginalt bedre chef derude. Det er
   et LIVING-WORLD-design (spec §0), men ejeren bør bekræfte at det er den ønskede følelse (vs. "tier-5
   = perfekt").

3. **Effekt-gulvet sænket 0,5 → 0,4** ("ingen chef" = 40% udnyttelse, ikke 50%). Det gør en tom
   facilitet lidt svagere og en ansættelse lidt mere værdifuld (bevidst — det var det der løste
   anti-optimal-D3). Bekræft at "40% uden chef" matcher intentionen ("facilitet = kapacitet, staff =
   udnyttelse" — en ubemandet facilitet kører nu på 40% snarere end halv).

4. **Specialiserings-fordelen er beskeden (+8,6% for en matchet specialist).** Det er by design
   (spec §7: specialist bedre for matchende trup, generalist bredere; ingen dominans). Men det betyder
   at valget "specialist vs. generalist" er en NUANCE, ikke en kæmpe-beslutning — en +8,6% løft er
   mærkbart men ikke game-changing. Vil ejeren have specialisering til at føles mere konsekvensfuld,
   kræver det højere vægte (og dermed en løsere specialiserings-balance-tolerance end ±10%).

## Anbefaling

Harness grøn på ALLE 5 gate-familier + inflations-gates + non-regression (fresh-net + Gini uændret) →
A4-merge-gaten er opfyldt. FACILITIES_ENABLED-flip afventer ejer-go. To marginer er tynde (anti-optimal
D3 0,1pp, specialisering 1,4pp) og fire owner-flags kræver en bevidst ejer-beslutning FØR flip — især
flag #1 (razor-thin D3-margin) og #2/#3 (den ability-drevne models effekt-semantik: tier-5 ≠ perfekt,
ingen-chef = 40%).
