# Staff-rigdom bølge A4 (#2216 / #1441 Fase 3) — harness-bevis (ability-drevet effekt)

> 2026-07-05 · merge-gate-supplement for FACILITIES_ENABLED (flip = separat ejer-beslutning).
> Harness: `backend/scripts/facilityInvestmentScorecard.js` (nu 5 gates) + `inflationScorecard.js`.
> Spec: `docs/superpowers/specs/2026-07-05-staff-richness-design.md` §2/§7.
> Bygger på A2-kalibreringen (`docs/audits/2026-07-05-facility-investment-calibration.md`) —
> facilitets-PRISER/BASE-EFFEKTER/UPKEEP fra A2 er UÆNDREDE (ejer-reviewede). A4 rørte KUN
> de NYE staff-konstanter (effekt-faktor-kurve + specialiserings-vægte + løn-kurve-base).
>
> **EJER-VALG 2026-07-05:** anti-optimal-path-gaten løsnet fra ±10% til **±15%** (competitive-
> tærskel 0,90 → 0,85) for den staff-inkluderende model — så staff-specialisering kan være en
> REEL strategisk løftestang OG marginerne bliver robuste. Denne rapport dækker BÅDE første
> kalibrering (Task 8, ±10%, tynde marginer) OG rekalibreringen efter ejer-valget (±15%, komfortabel).

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

## Resultat (efter rekalibrering — ±15%-gate)

Scorecardet kørt UDEN `--config` mod prod-filen `backend/lib/facilityConstants.js`:

```
HEADLINE: facility-gates ✅ PASS — A2/A4-merge-gate opfyldt
  tid-som-valuta ✅ · kommerciel payback ✅ · anti-optimal-path ✅ · form-gates ✅ · specialiserings-balance ✅

HEADLINE: inflations-gate ✅ PASS (syntetisk primær; §2.1-mål-kurve).
```

**Ærlig margin-status (nu KOMFORTABEL):**

| Gate | Margin | Vurdering |
|---|---|---|
| Anti-optimal-path (værste celle: D3/×0,5-leverage) | 3.-bedste = **87,1%** af max (krav ≥ 85%) | **KOMFORTABEL (2,1pp)** — før ±15%-løsningen var den razor-thin 90,1%/0,90 |
| Specialiserings-balance (generalist vs. matchet specialist) | specialist **+14,0%** over generalist (ratio 0,877 ∈ [0,85, 1,15]) | 1,0pp fra ±15%-loftet — BEVIDST tæt: ejeren ville UDNYTTE headroom'et så specialisering føles konsekvensfuld |
| Specialiserings-symmetri | svageste/stærkeste dim-specialist = **1,000** | Rigelig — de tre dimensioner er præcis symmetriske (samme vægte) |
| Specialist mod mismatch-behov | **0,930** af generalist (krav ≥ 0,70) | Rigelig — en fejl-matchet specialist er stadig ~93% af en generalist (spilbar, ikke en fælde) |
| Staff-relevans (løn/marginal-værdi, D2) | **0,282–0,371** (bånd [0,05, 0,40]) | Grøn med ~3pp luft (t4 topper på 0,371) |
| Tid-som-valuta / kommerciel payback / form-form-gates | uændret fra A2 (rører ikke staff-effekt-kurven) | Uændret grønne |

## Forløb: A4-rewire → Task-8-kalibrering (±10%, tynd) → ejer-valg (±15%) → rekalibrering (komfortabel)

### 1. Rå A4-model-rewire fejlede 3 af 5 gates

Da harnesset blev rewiret til den ability-drevne model MED de oprindelige Task-6-start-konstanter
(FLOOR 0,5 · SLOPE 0,5 · weightDimension 0,25 · weightLevel 0,15), fejlede **3 af 5 gates**:

1. **anti-optimal-path D3 = 1/5** (krav ≥3). Årsag: den ability-drevne faktor er FLADERE mellem
   tiers end den gamle skalar. Gammel `staffUtilization`: null=0,5 · t1=0,6 · … · t5=1,0 (jævne
   0,1-trin). Ny ved tier-midtpunkter (FLOOR 0,5/SLOPE 0,5): null=0,5 · t1=0,682 · … · t5=0,909.
   Det store spring er fra "ingen chef" (0,5) til "enhver chef" (0,68+), trinene MELLEM tiers er små.
   Det gjorde gulvet på 0,5 for stærkt relativt til at ANSÆTTE: dybde-strategier kunne ikke indhente
   "balanced" i D3's stramme budget ved lav leverage → balanced dominerede.
2. **specialiserings-balance: generalist/specialist = 0,877** (specialist +14% — over ±10%).
3. **staff-relevans t4 = 0,401** (marginalt over 0,40-loftet).

### 2. Første kalibrering (Task 8, ±10%-gaten) — grøn men RAZOR-THIN

Under den STRAMME ±10%-gate var det eneste løsningsrum at SÆNKE effekt-gulvet til 0,4 (gjorde
staff-ansættelse til et større relativt spring, så anti-optimal-D3 lige akkurat blev grøn) OG
sænke specialiserings-vægtene til 0,15/0,08 (så specialisten kun var +8,6% bedre, inden for ±10%):

- FLOOR 0,4 · SLOPE 0,6 → anti-optimal-D3/×0,5 = **90,1%** (0,1pp over kravet — razor-thin).
- weightDimension 0,15 · weightLevel 0,08 → specialist **+8,6%** (1,4pp fra ±10% — tynd).

Begge marginer var razor-thin, og specialiserings-fordelen (+8,6%) var så beskeden at valget
"specialist vs. generalist" blev en nuance snarere end en beslutning. Det blev flaget som
owner-flags #1 og #4 i første version af denne audit.

### 3. Ejer-valg 2026-07-05: løsn gaten til ±15%

Ejeren besluttede at løsne anti-optimal-path-tolerancen fra ±10% til **±15%** (competitive-tærskel
0,90 → 0,85) for den staff-inkluderende model. Rationale: **staff-specialisering skal være en reel
strategisk løftestang, ikke en marginal detalje** — og gaten skal have robuste marginer i stedet
for razor-thin. En ±15%-tolerance er stadig en meningsfuld anti-dominans-invariant (én rækkefølge
må ikke være >15% bedre end tredjebedst), men den giver plads til at (a) restaurere det rene
effekt-gulv 0,5 og (b) hæve specialiserings-fordelen til ~+14%.

### 4. Rekalibrering (±15%) — komfortable marginer

- **FLOOR restaureret til 0,5, SLOPE til 0,5** → `factor = 0,5 + 0,5·(overall/99)`, range **[0,5, 1,0]**.
  Ren semantik: "ingen chef = 50%", perfekt overall-99-chef = 1,0. Anti-optimal-D3/×0,5 = **87,1%**
  (2,1pp over 0,85 — komfortabel).
- **Specialiserings-vægte restaureret til 0,25/0,15** (de oprindelige Task-6-værdier) → matchet
  specialist **+14,0%** bedre end generalist (inden for ±15%, 1,0pp fra loftet — bevidst tæt for at
  UDNYTTE headroom'et).
- **Løn-kurve-base sænket 2600 → 2400.** Med gulv 0,5 (i stedet for 0,4) er en ansættelses MARGINALE
  værdi mindre (chefen løfter fra 0,5, ikke 0,4) → løn/værdi-forholdet stiger. base 2400 holder
  staff-relevans komfortabelt i [0,05, 0,40] (t4 = 0,371 mod tidligere overskridelse 0,401).

Empirisk grid-søgning i scratch (ikke committet) bekræftede at floor=0,5/slope=0,5 med de fulde
spec-vægte og base 2400 passerer ALLE 5 gates + alle 9 anti-optimal-celler med den komfortable margin.

## Konstanter: A2/Task-6-udgangspunkt → Task 8 (±10%) → REKALIBRERET (±15%, ejer-valg)

| Konstant | Udgangspunkt | Task 8 (±10%) | **Rekalibreret (±15%)** | Hvorfor endelig værdi |
|---|---|---|---|---|
| `STAFF_EFFECT_FACTOR_FLOOR` | 0,5 | 0,4 | **0,5** | ±15%-gaten tillader gulv 0,5 med komfortabel D3-margin → ren "ingen chef = 50%"-semantik + faktor 1,0 ved overall 99 |
| `STAFF_EFFECT_FACTOR_SLOPE` | 0,5 | 0,6 | **0,5** | Range [0,5, 1,0]; overall-99-chef = 1,0 |
| `STAFF_SPECIALIZATION.weightDimension` | 0,25 | 0,15 | **0,25** | Restaureret → specialist +14% (reel løftestang; ejer-intent) |
| `STAFF_SPECIALIZATION.weightLevel` | 0,15 | 0,08 | **0,15** | Restaureret sammen med weightDimension |
| `STAFF_SPECIALIZATION.floor/cap` | 0,85 / 1,4 | uændret | **uændret** | Cap 1,4 er nu BINDENDE ved ekstremer (max-akser = 1+0,25+0,15 = 1,4) |
| `STAFF_SALARY_CURVE.base` | 2600 | 2600 | **2400** | Gulv 0,5 → mindre marginal staff-værdi → base 2400 holder relevans i bånd (t4 0,371) |
| `STAFF_SALARY_CURVE` (ref/exp/floor/cap) | 81/4/50/6000 | uændret | **uændret** | Kurve-form bevaret |
| **FACILITY_TIER_PRICE / UPKEEP / BASE_EFFECT** | A2-værdier | uændret | **UÆNDREDE** | Ejer-reviewede A2-konstanter; A4 rørte dem aldrig |

Effekt-faktor-tabel (rekalibreret, floor 0,5/slope 0,5), staff ved tier-midtpunkter:

| tier | overall (bånd-midt) | faktor (0,5+0,5·o/99) | løn (`staffSalaryFor`, base 2400) |
|---|---|---|---|
| — (ingen chef) | — | 0,500 | — |
| 1 | 36 | 0,682 | 144 |
| 2 | 48 | 0,742 | 346 |
| 3 | 60 | 0,803 | 773 |
| 4 | 71 | 0,859 | 1.467 |
| 5 | 81 | 0,909 | 2.450 |
| (teoretisk 99) | 99 | 1,000 | (cap 6.000) |

## Gate-detaljer (faktisk harness-output, ±15%)

### Anti-optimal-path (§2.3, ±15% ejer-valg) — baseline-leverage (×1,0), 10-sæsoners styrke-proxy

| Division | training-first | commercial-first | academy-first | support-first | balanced | konkurrencedygtige |
|---|---|---|---|---|---|---|
| D1 | 776.792 ✓ | 482.282 | 464.230 | 818.968 ✓ | 813.313 ✓ | 3/5 |
| D2 | 215.003 ✓ | 37.580 | 44.118 | 213.806 ✓ | 215.476 ✓ | 3/5 |
| D3 | 37.743 ✓ | 5.956 | 18.464 | 37.743 ✓ | 42.201 ✓ | 3/5 |

3.-bedste strategi som andel af bedste (krav ≥ 85%):

| Leverage | D1 | D2 | D3 |
|---|---|---|---|
| ×1,0 | 94,9% | 99,2% | 89,4% |
| ×0,5 | 94,3% | 97,8% | **87,1%** ← binding (2,1pp over 85%) |
| ×1,5 | 94,8% | 99,4% | 90,2% |

Den konkurrencedygtige trio er {training-first, support-first, balanced} i alle divisioner (som A2);
hvem der er BEDST skifter med division.

### Specialiserings-balance (#2216 A4, §7, ±15%)

```
  [generalist-vs-specialist]
    generalist/{physical,mental,technical}-specialist (matchet behov): 0,877 ∈ [0,85, 1,15] ✅
  [ingen-dominant-specialisering]
    svageste/stærkeste dim-specialist (matchet): 1,000 ≥ 0,85 ✅
  [specialist-mismatch-spilbar]
    {dim}-specialist mod {andet}-behov / generalist: 0,930 ≥ 0,70 ✅
```

Model: ved fast overall (70) og spread (20) bygges en generalist (flade akser) og en matchet
specialist (én dimension+niveau løftet, øvrige sænket). Effektiv trænings-værdi = base-effekt ×
`staffEffectFactor(overall)` × `specializationMatch(staff, behov)`. Ratio generalist/specialist = 0,877
⇒ matchet specialist er **+14,0%** bedre (inden for ±15%); de tre dim-specialister symmetriske; en
fejl-matchet specialist stadig ~93% af generalist.

### Tid-som-valuta / kommerciel payback / form-gates

Uændret fra A2 (staff-effekt-kurven påvirker ikke priser/tid-som-valuta). Staff-relevans-under-gaten
(del af form-gates) er nu 0,282–0,371 (bånd [0,05, 0,40]). Kommerciel payback ∞ overalt (uændret).

## Antagelser + følsomhed

| Antagelse | Værdi | Kilde/status |
|---|---|---|
| Anti-optimal-tolerance | **±15%** (competitive ≥ 0,85 × bedste) | EJER-VALG 2026-07-05. Løsnet fra ±10% så specialisering er en reel løftestang + robuste marginer |
| Repræsentativ besat-staff-kvalitet | MIDTPUNKT af `TIER_OVERALL_BAND[tier]` | NY A4-antagelse. Kandidat-derivationen trækker PRNG-varieret i samme bånd → gennemsnits-staffen ≈ midt |
| Specialiserings-test-profil | overall 70 · spread 20 | Repræsentativ tier-4-besat facilitet med én stærk akse |
| Alle A2-antagelser | budget-proxy, leverage, RECURRING_CAP, hold-fordeling | Uændrede (A4 rører ikke dem) |

**Følsomhed / advarsler til fremtidige ændringer:**

- **Anti-optimal-margin er nu komfortabel (2,1pp):** D3/×0,5-leverage = 87,1% (mod 85%-krav).
  Robust — men den ability-drevne model er stadig strukturelt tættest på grænsen i D3 (den fladere
  staff-kurve favoriserer bredde/balanced i D3's stramme budget). Kør harness FØR ændringer af
  tier-bånd/effekt-kurve/priser/leverage.
- **Specialiserings-marginen er 1,0pp** (specialist +14% mod ±15%-loftet). Det er BEVIDST tæt —
  ejeren ville have specialisering til at "føles konsekvensfuld" og udnytte headroom'et. Hæves
  vægtene yderligere (eller øges spread'et i test-profilen), kan generalist/specialist-checket vælte.
- Effekt-faktoren er stadig FLADERE end den gamle util-skalar (t5-chef 0,909 vs. gammel 1,0). Det er
  en bevidst konsekvens af co-SSOT: overall-modellen kan ikke give en tier-5-chef fuld faktor 1,0,
  fordi tier-5-BÅNDET topper ved overall 90, ikke 99. Kun en teoretisk overall-99-chef får 1,0.

## Non-regression

Kørt 2026-07-05 på den rekalibrerede HEAD. Alle outputs er faktiske kørsler.

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
staff-konstanterne eller effekt-modellen → A4-(re)kalibreringen KAN ikke påvirke de gates.

**Fuld lokal verifikation:** backend-tests **2805/2805 pass, 0 fail** (`cd backend && npm test`).
(Frontend-tests/build sprunget over i worktree: `frontend/node_modules` mangler. A4 er backend-only —
ingen frontend-ændringer i denne slice; profil-UI er A4b. CI's frontend-jobs dækker gaten.)

**Test-audit:** de opdaterede tests ændrede KUN forventnings-TAL til de rekalibrerede konstanter
(gulv 0,5, spec-vægte 0,25/0,15, cap bindende, løn-base 2400) + de nye asserts (tierToOverall,
staffSalary-cache, specialiserings-balance). Ingen assertions fjernet eller svækket; drift-guarden
er den staff-objekt-sti prod faktisk bruger.

## OWNER-RELEVANTE FLAGS (checkpoint før flip)

De to razor-thin-flags fra første version (D3-margin 0,1pp + svag specialisering +8,6%) er LØST af
ejer-valget om ±15%. Tilbageværende flags til ejer-review:

1. **Anti-optimal-D3-margin er nu komfortabel (87,1%, 2,1pp over 85%-tærsklen)** — men D3/×0,5-leverage
   er stadig den binding celle. Den ability-drevne (fladere) staff-model favoriserer strukturelt
   "balanced" i D3's stramme budget. Ingen handling nødvendig; noteres så fremtidige justeringer
   genkører harness.

2. **En tier-5-chef giver maks. effekt-faktor 0,909, ikke 1,0** (fuld 1,0 kræver den teoretiske
   overall-99, over tier-5-båndets top på 90). Direkte konsekvens af den ability-drevne co-SSOT-model
   (tier er et bånd, ikke et fast punkt). Spiller-oplevelsen: selv den bedste ansættelige chef
   "efterlader lidt på bordet" — der er altid en marginalt bedre chef derude (living-world, spec §0).
   Bekræft at det er den ønskede følelse (vs. "tier-5 = perfekt").

3. **Løn-kurve-base sænket 2600 → 2400** (top-tier-løn ~2.450 mod ~2.650). En marginal nedjustering
   nødvendig fordi gulv 0,5 gør staffens marginale værdi lidt lavere → ellers ville løn-relevans-gaten
   overskride 0,40-loftet på t4. Staff er stadig en reel omkostning (Q1), bare en anelse billigere i
   toppen. Bekræft at det er acceptabelt (alternativet var at beholde gulv 0,4 = "ingen chef = 40%").

4. **Specialiserings-fordelen er nu +14,0%** (mod +8,6% i første kalibrering) — en matchet specialist
   er mærkbart bedre for en trup hvis behov matcher. Det er præcis ejer-intentet ("reel strategisk
   løftestang"). Marginen til ±15%-loftet er 1,0pp (bevidst tæt for at udnytte headroom'et).

## Anbefaling

Harness grøn på ALLE 5 gate-familier + inflations-gates + non-regression (fresh-net + Gini uændret)
med KOMFORTABLE marginer (anti-optimal 2,1pp, relevans ~3pp) → A4-merge-gaten er opfyldt.
FACILITIES_ENABLED-flip afventer ejer-go. ±15%-tolerancen er et bevidst ejer-valg der gør
specialisering til en reel løftestang (+14%) uden at nogen enkelt rækkefølge/specialisering dominerer.
Fire flags noteret til ejer-review — ingen er blockers.
