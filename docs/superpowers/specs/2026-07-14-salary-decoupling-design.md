# Løn-decoupling: løn = nuværende produktion, ikke fremtids-NPV — design

- **Dato:** 2026-07-14
- **Issue:** [#2428](https://github.com/NicolaiDolmer/CyclingZone/issues/2428) (værdimodel v4, opfølgning 1/3 før cutover)
- **Status:** Udkast — mekanik + to flag-valg ejer-godkendt 14/7 (widget-review); afventer spec-review.
- **Type:** Balance-følsom spil-økonomi → **simulér-før-ship** med ejer-godkendt scorecard FØR cutover.
- **Relaterer:** #1309 (frossen-løn-regime), #1441/#1608 (økonomi-kalibrering — granit), #1364 (værdi-genberegnings-mekanik der genbruges), #1720 (kontraktforlængelse).
- **Afhænger af:** v4-værdimodel ([2026-07-13-rider-valuation-v4-production-value-design.md](2026-07-13-rider-valuation-v4-production-value-design.md)) — shipper i SAMME cutover-migration.

## 1. Problem

v4 sætter `market_value` = nutidsværdien af en rytters FORVENTEDE karriere-produktion (fremtids-NPV). Det er
rigtigt for en køb/salg-pris: et ungt talent er meget værd, fordi det kan udvikles og sælges.

Men løn er koblet til værdien: `salary = max(1, round((base_value + prize_earnings_bonus) × SALARY_RATE))`
(0,067), frossen ved signering (#1309). Når v4's fremtids-vægtede værdier bliver signerings-basen, sprænger
unge talenters løn:

> Et talent med v4-værdi 5,56M → løn 373k/sæson (5,56M × 0,067) > sponsor 240k/sæson.
> Holdet betaler mere i løn for én ikke-leverende ungrytter end hele sit sponsorat.

Roden: **værdi og løn er to forskellige spørgsmål, men deler formel.** Værdi = "hvad er han værd at eje?"
(fremtid). Løn = "hvad koster det at have ham på lønningslisten for det han leverer NU?" (nutid). v4 gør
værdi-siden rigtig og afslører at løn-siden aldrig var afkoblet.

## 2. Kerne-idé

> **Værdi tager hele karriere-stakken. Løn tager kun sæson 0.**

Den samme v4-motor producerer begge — de nipper bare forskellige dele af den:

```
market_value            = scale · Σ_{s=0..H} discount^s · S_s · prod_s   (+ elite-præmie)   ← køb/salg-pris
current_production_value = scale · prod_0                                                    ← løn-base
salary                   = max(1, round(SALARY_RATE_PROD × current_production_value))         (frossen v. signering)

prod_s = exp(a + b·O_s + c·O_s² + offset[type])      O_s = blendedOutput(abilities_s, type, alpha)
```

`prod_0` er sæson-0-leddet fra `simulateCareer` ([riderCareerNpv.js:112](../../../backend/lib/riderCareerNpv.js)):
forventet produktion i indeværende sæson ved rytterens NUVÆRENDE evner — ingen diskontering (discount⁰=1),
ingen fremtid, ingen survival (S₀=1), **ingen elite-præmie**. Da modellen har `beta_pt = 0`, er `prod` ren
forventet præmie-produktion i CZ$.

Effekten (jf. widget 14/7): et 19-årigt talent har lav `prod_0` (beskedne nuværende evner) men en stor NPV
(mange fremtidige vækst-sæsoner) → høj værdi, lav løn. En 28-årig etableret rytter har høj `prod_0` (peak nu)
→ høj løn, moderat værdi. Symmetrisk og målt, ikke håndsat.

## 3. Arkitektur

### 3.1 Ny kolonne `riders.current_production_value` (spejler `base_value`)

Skrives af den SAMME #1364-værdi-sweep der allerede skriver `base_value`. Sweepet har rytterens evner indlæst
for at beregne `base_value` (fuld NPV), så sæson-0-leddet koster ~0 ekstra CPU. Ny ren funktion i
`riderCareerNpv.js`:

```js
// scale · prod_0 — kun sæson-0-leddet, ingen elite-præmie. Returnerer null ved ugyldig model/abilities.
export function currentProductionValue(rider, abilities, model) { ... }
```

Kolonnen er en plain skalar (som `base_value`) — IKKE GENERATED (den afhænger af evner via modellen). Løn-
formlerne læser skalaren; ingen model/evne-threading ud på hver signerings-call-site.

### 3.2 Løn-formel

`computeFrozenSalary` ([contractSeed.js:23](../../../backend/lib/contractSeed.js)) skifter input fra
`{ base_value, prize_earnings_bonus }` til `{ current_production_value }`:

```js
export function computeFrozenSalary({ current_production_value } = {}) {
  const base = Number(current_production_value) > 0 ? Number(current_production_value) : FALLBACK;
  return Math.max(1, Math.round(base * SALARY_RATE_PROD));
}
```

Ny konstant `SALARY_RATE_PROD` i `economyConstants.js` (afløser IKKE `SALARY_RATE` — den gamle 0,067 bruges
ikke længere af senior-løn, men bevares indtil alle spor er migreret).

### 3.3 Frossen ved signering (uændret princip, #1309)

Løn sættes én gang ved erhvervelse (auktion-win, transfer-accept, akademi-promote, seed) og genforhandles ved
kontraktforlængelse. [computeContractExtension](../../../backend/lib/contractSeed.js) bruger allerede
"nuværende værdi" som base → skifter til `current_production_value`. Bevarer budget-forudsigeligheden
#1441/#1608-økonomien er granit-kalibreret mod. "Ugeløn for levering" holder, fordi lønnen re-prises hver
1-3 sæsoner mod aktuel produktion.

### 3.4 Sats-kalibrering

Fordi `current_production_value < market_value` (sæson 0 < hele NPV'en), bliver `SALARY_RATE_PROD > 0,067`.
Kalibreres som ÉN parameter, deterministisk, mod målet i §5 (G1). Størrelsesorden: for en midt-karriere-rytter
er `prod_0` ~¼-⅓ af NPV'en, så satsen forventes groft ~0,20-0,25 — men **pinnes empirisk af harnessen mod
ægte population, ikke gættet.** `SALARY_RATE_PROD` er ejer-tunbar ved scorecard-reviewet (samme rolle som v4's
`discount`/`gamma`).

### 3.5 Elite-præmie røres IKKE af løn

`current_production_value = scale · prod_0` er PRE-præmie. En elite-producent får høj løn af sit høje `prod_0`
(han vinder faktisk meget), ikke af "ukøbelig"-markuppen. Værdi = trofæ-pris (82M, ukøbelig); løn = hvad han
leverer (bundet af hvad motoren udbetaler). De store stjerner er alligevel ukøbelige via PRIS, så deres løn
udløses sjældent — men den forbliver sund hvis den gør.

## 4. Ændringsflade (implementering)

| Sti | Ændring |
|---|---|
| `backend/lib/riderCareerNpv.js` | Ny `currentProductionValue()` (sæson-0-led, ingen præmie) |
| `backend/lib/economyConstants.js` | Ny `SALARY_RATE_PROD` |
| `backend/lib/contractSeed.js` | `computeFrozenSalary` + `contractOnAcquirePatch` + `computeContractExtension` + `runContractSeed` → læs `current_production_value` |
| `backend/lib/academyTransfer.js` | `promote` (computeFrozenSalary) + `demoteSalary` → `current_production_value`-base |
| `backend/lib/marketUtils.js` | `resolveRiderSalary` free-agent-estimat → `current_production_value × SALARY_RATE_PROD` |
| værdi-sweep (#1364-mekanik) | Skriv `current_production_value` sammen med `base_value` |
| `database/…` (cutover) | Ny kolonne + skift løn-kilde; **bundlet med v4-værdi-migration, ejer merger** |
| frontend `marketValues.js` | Spejl `getRiderSalary` + `projectYouthSalary` (egen 0,067-konstant → ny) |
| `check_salary_drift`-RPC ([driftMonitor.js](../../../backend/scripts/driftMonitor.js)) | Forventet-løn-tjek: `current_production_value × SALARY_RATE_PROD` |

## 5. Simulér-før-ship — scorecard (ejer godkender FØR cutover)

Harness `backend/scripts/salaryDecouplingScorecard.js` (mønster fra `valuationV4Scorecard.js`), read-only mod
ægte population. Gates:

1. **G1 lønbyrde-kontinuitet (hård):** Σ løn pr. division efter ny formel inden for ±X% af nuværende frosne
   lønbyrder. Dette er kalibreringens definition.
   **RETTELSE (14/7, shadow-kørsel):** de tidligere antagne tal (D1 ~1,15M / D2 ~650k / D3 ~310k) kom fra en
   forældet template (`economyContractSimulation.js`), IKKE live-data. De faktiske lønbyrder (1589 owned-ryttere):
   **D1 0,08M · D2 0,18M · D3 2,20M · D4 0,30M** (~2,76M total, 80% i div 3 fordi managere kommer ind i div 3).
   Median-rytterens `base_value` ~7.000 → median-løn ~470 CZ$. En enkelt global sats fik div 1/2 til at falde
   ~40% (G1 rød), så ejer valgte (14/7) **per-division sats** (`rate_d = Σløn_d/Σcpv_d`) — bevarer hver divisions
   lønbyrde ved konstruktion. Endelige tal: [audits/2026-07-14-salary-decoupling-scorecard.md](../../audits/2026-07-14-salary-decoupling-scorecard.md).
2. **G2 talent-fix (hård):** repræsentative unge talenter → løn < sponsor (240k), OG løn/værdi-forhold falder
   markant vs. den nuværende market_value-kobling. Det oprindelige 373k-tilfælde skal lande langt under.
3. **G3 etableret-stabilitet (rapport):** peak-producenters løn ≈ uændret vs. i dag (basis-skiftet må ikke
   flytte de rigtige producenters løn meget).
4. **G4 ingen runaway (hård):** ingen enkelt løn overstiger en fornuftig andel af holdindtægt (fx ≤ sponsor).
5. **G5 determinisme (hård):** samme seed → samme sats + fordeling.

## 6. Rollout

1. **Slice A (shadow, denne bygges nu):** `currentProductionValue()` + sats-kalibrerings-harness + scorecard.
   READ-ONLY, ingen økonomi-ændring, ingen migration. Producerer den kalibrerede `SALARY_RATE_PROD` +
   fordeling + talent-tal → ejer-review-artefakt (`docs/audits/2026-07-…-salary-decoupling-scorecard.md`).
2. **Slice B (cutover, ejer-gated):** løn-formler → `current_production_value`; ny kolonne + kilde-skift i
   migration **bundlet med v4-værdi-cutover** (én migration, ejer merger). Rør ALDRIG GENERATED /
   `prize_earnings_bonus` før da.

## 7. Non-goals

- Ingen ændring af race-motorens fysik eller præmietabeller (input, ikke scope).
- Ingen ændring af akademi-drift, signing-fee eller andre løn-uafhængige økonomi-sinks.
- Ingen live/løbende løn (forbliver frossen ved signering pr. #1309).
- Ingen ændring af `market_value`/værdi-siden (det er v4-spec'ens scope).

## 8. Åbne ejer-valg (besluttes ved scorecard-review)

- **`SALARY_RATE_PROD`-mål:** default = bevar nuværende lønbyrde (§3.4/G1). Alternativ: sænk det samlede
  lønniveau (giver hold mere luft, men rører den granit-kalibrerede net-økonomi — kræver moneySupply-re-tjek).
- **G1-tolerance X%:** hvor stramt lønbyrden skal matches (foreslået ±10-15%, som v4's skala-kontinuitet).
