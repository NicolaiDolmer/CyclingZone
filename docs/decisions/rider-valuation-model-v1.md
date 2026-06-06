# Rider Valuation Model v1 — data-drevet `base_value`

> Beslutnings-doc for [#1101](https://github.com/NicolaiDolmer/CyclingZone/issues/1101) (del af relaunch-epic [#1105](https://github.com/NicolaiDolmer/CyclingZone/issues/1105)).
> Locked via ejer-Q&A 6. juni 2026. Denne fil er **kilden** til designvalgene — ikke lokal-only.

## Hvorfor

Rytter-værdi er i dag 100% bundet til `uci_points` via tre GENERATED-kolonner på
`riders` (`price`, `market_value`, `salary`; `database/schema.sql` L57-64), duplikeret i
`backend/lib/marketUtils.js` + `frontend/src/lib/marketValues.js`. Det binder spillets
økonomi til IRL UCI-point — en juridisk + designmæssig afhængighed vi forlader ved
relaunch. Vi vil i stedet have et **eget, data-drevet værdisystem**.

## Kerne-beslutning: lær værdien af faktiske handler

`base_value` beregnes ikke fra en håndplukket formel, men fra en **model trænet på
hvad managers faktisk har betalt** i auktioner. Koefficienterne *fortæller* os hvilke
evner (+ alder mv.) managers værdsætter højest — det er designkravet ("brug ægte live
data; de evner managers betaler mest for vægtes højest").

### Model
- **Target:** `log(slutpris)` (auktionens `current_price`). Log-rummet håndterer den
  kraftigt højreskæve fordeling (p10 20k / median 55k / p90 380k / max 3,2M) og giver
  en **multiplikativ, konveks** kurve — top-navne markant dyrere end midterfeltet.
- **Metode:** regulariseret lineær regression (**ridge**) på standardiserede features.
  Ridge er nødvendig fordi (a) evnerne er indbyrdes korrelerede (collinearitet) og
  (b) træningssættet er lille.
- **Konveksitet:** følg data; hvis den lærte kurve bliver fladere end ønsket, hæves en
  mild post-fit `convexity_exponent` (≥1.0) så top-navne føles dyre — forankret i data,
  ikke påtvunget.
- **Gulv:** intet eksplicit gulv (log-rum → altid positivt).

### Træningssæt (verificeret i prod 6/6-2026)
- Kun **kontesterede menneske-salg**: auktioner med `status='completed'`,
  `current_price > 1`, vinder-hold `is_ai=false AND is_test_account=false AND NOT
  is_bank`, og **≥2 distinkte budgivere**. → **141 handler**.
- Ukontesterede salg ekskluderes: deres pris = udbudspris (uci-afledt) → cirkularitet.
- Rene AI-/garanti-salg ekskluderes af samme grund.
- **Ærlig caveat:** 141 rækker er lille. v1 fanger grove præferencer med bred
  usikkerhed. Re-fit efter relaunch på et renere/større (ikke-uci) sæt er forventet.

### Features
| Feature | Kilde | Note |
|---------|-------|------|
| 10 abilities | `rider_derived_abilities` | climbing, time_trial, sprint, punch, endurance, cobble_classics, acceleration, recovery, tactics, positioning (0-99) |
| `age` + `age²` | `riders.birthdate` | lader modellen lære en peak-alder-kurve |
| `potentiale` | `riders.potentiale` | 1.0–6.0; talent/investeringsværdi |
| `popularity` | `riders.popularity` | sparsom i dag (98/243 >0) — vægtes nok lavt; kobles rigtigt når omdømme-motor #1099 findes |
| `is_u25` | `riders.is_u25` | simpel ungdoms-markør |
| ~~nationalitet~~ | — | **droppet i v1** — 141 rækker kan ikke bære 50 landes koefficienter uden overfit |

## Spilleregler

- **Shadow mode (denne slice, #1101 slice 1):** `base_value` beregnes, lagres og **vises**
  (admin-sammenligningstabel + beta-chip på rytterprofiler), men styrer **intet** i
  økonomien. De uci-afledte GENERATED-kolonner kører uændret videre. Ingen handel
  påvirkes før ejer godkender fordelingen.
- **Manuel re-fit:** modellen fittes offline af `scripts/fitRiderValuationModel.js` →
  koefficienter committes som `backend/lib/riderValuationModel.json`. Ingen tavs
  auto-læring (undgår selvforstærkende feedback-spiral når base_value senere styrer
  priser). "Godkend" = se preview + merge.
- **Cutover (#1101 slice 2, efter godkendelse):** flip GENERATED-kolonner til at bygge
  på `base_value`; afkobl `uci_points`; dynamisk værdiglidning mod handelspris i
  `auctionFinalization.js`/`transferExecution.js`; skjul uci player-facing.

## Artefakter
- `backend/lib/linalg.js` — minimal matrix-algebra (transpose/matmul/solve).
- `backend/lib/riderValuation.js` — `featurizeRider`, `predictBaseValue`, `riderOverall`,
  `riderSpecialty`. Single source (afløser de tre formel-kopier ved cutover).
- `backend/lib/riderValuationModel.json` — committede koefficienter + metadata
  (n, dato, feature-means/stds, R², λ, convexity_exponent).
- `backend/scripts/fitRiderValuationModel.js` — træner modellen.
- `backend/scripts/backfillRiderBaseValue.js` — idempotent backfill af hele populationen.
- `database/2026-06-06-rider-base-value.sql` — `riders.base_value` (nullable).
- `GET /api/admin/rider-valuation-preview` + admin-UI + rytter-beta-chip.
