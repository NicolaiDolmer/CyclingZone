# Rider Valuation Model — data-drevet `base_value`

> Beslutnings-doc for [#1101](https://github.com/NicolaiDolmer/CyclingZone/issues/1101) (del af relaunch-epic [#1105](https://github.com/NicolaiDolmer/CyclingZone/issues/1105)).
> v1 locked via ejer-Q&A 6. juni; **v2 (CURRENT) locked via ejer-kalibrerings-session 7. juni 2026.** Denne fil er **kilden** til designvalgene — ikke lokal-only.

## v2 (anchor-kalibreret, 7/6-2026) — CURRENT

**Pivot væk fra v1's salgs-regression.** v1 (ridge på 141 kontesterede uci-ankrede
auktionssalg) virkede ikke til relaunch: (a) træningssættets udbudspriser var
uci-afledte → den uci-cirkularitet vi vil væk fra, og (b) den var trænet på den
gamle population — efter evne-system-v2 (#1122) re-derivede alle ryttere blev
modellens means/stds stale (og v1 brugte `tactics`/`positioning` som v2 fjernede).

**Ny model:**
```
ln(base_value) = a + b·output + offset[primary_type]
```
- **`output` (0-99):** vægtet snit af de POSITIVE type-vægte (`riderTypes.js`) på de
  rå abilities → "hvor god er rytteren til sit speciale". Fanger specialisering uden
  at være afhængig af percentil/population.
- **`offset[type]`:** type-fixed-effect = forventet præmie/omdømme pr. type
  (ejer-Q3: "jo mere du kan tjene i præmiepenge/omdømme, jo mere værdi"). Fittet, ikke håndsat.
- **Ingen bund** (ejer-direktiv 7/6): dårligste ryttere ≈ 1.000 (spredt under/over).

**Kalibrering:** 22 ejer-vurderede anchors (`backend/lib/riderValuationAnchors.json`),
indsamlet via copy-paste-skema med output + top-evner. Fit: OLS af ln(mål) på output
(a, b), derefter type-offset = gennemsnitlig residual pr. type. Manuel re-fit,
ejer-godkendt — ingen auto-læring.

**Resultat (fit 7/6):** a=6,140 · b=0,1263 · R²(log)=0,845 (n=22).
Type-hierarki udledt af dataen: brostensrytter ×1,55 · gc ×1,37 · sprinter ×1,0 ·
rouleur ×0,60 · tt ×0,59 · puncheur ×0,48 (tt/puncheur usikre — få punkter).
Prod-fordeling (8994 ryttere): p10 ~3.900 · median ~46k · p90 ~620k · max ~124M; 0 NULL.

**Bevidst svaghed (ejer-beslutning B, 7/6):** den glatte model underpriser de
absolutte superstjerner (Pogačar fit 48M vs ejer-mål 100M) fordi gc rummer både den
dyreste OG mange billige ryttere. Ejer valgte at lade **spil-resultater** løfte de
ægte stjerner over tid frem for at påtvinge ekstra top-konveksitet nu.

**Follow-ups (data-drevet fase):** ungdoms-/potentiale-præmie (ejer Q4/Q5 — "ung >
gammel", "algoritmen regner det selv ud fra data"), versatilitets-præmie (Q6),
popularitet/fans (Q9 — bygges ind når omdømme-motoren findes), dynamisk glidning mod
faktisk handelspris ved auktions-/transfer-afslutning. Cutover (slice 2) uændret nedenfor.

**Artefakter:** `riderValuation.js` (`outputScore`, `predictBaseValue`, `riderOverall`,
`riderSpecialty`) · `riderValuationModel.json` (a/b/offset) ·
`riderValuationAnchors.json` (ejer-anchors) · `fitRiderValuationModel.js` ·
`backfillRiderBaseValue.js`.

---

## v1 (historik, 6/6) — afløst af v2 ovenfor

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

## v3 (10/6-2026): alsidigheds-blend + krumning + guards

Ejer-finding (9/6): v2 satte MvdP (107M) over Pogačar (67M) trods anchors 95M/125M — rent
speciale-output er blind for alsidighed (Pogačars snit over ALLE 14 evner: 84,6 vs MvdP 76,6).

**Formel:** `ln(v) = a + b·O + c·O² + offset[type]`, `O = 0,5·speciale + 0,5·snit(alle evner)`.

**Anchors:** 26 (top-8 hævet af ejer 9/6: Pogačar 125M, MvdP 95M, Philipsen 65M, Milan 45M,
Ganna 50M, Merlier 30M, Magnier 25M, Matthews 13M; + 4 bund-anchors 10/6 der pinner
slice-1-skalaen: Uriarte 900k / Seye 200k / Kimpe 60k / Sanders 30k). Bund-anchorne kom af
et ægte fund: uden dem ekstrapolerede fittet under output ~57 og kollapsede det fiktive felt
(median 34 CZ$). Lærdom: anchors skal DÆKKE hele output-skalaen, ikke kun eliten.

**Resultat (R²log 0,972):** Pogačar 163,5M #1 blandt virkelige · MvdP 110,3M · skala bevaret
(median 46k→45k, p10 4k→9k) · 3 af 4 fiktive prod-outliers fikset af blendet selv (Bergström
141M, under Pogačar). Kendt rest: Harry Ward (fiktiv test-rytter, slettes ved relaunch-swap)
ligger over anchor-rækkevidden → 1,13 mia.; accepteret interim (ejer 10/6), løses af #1194.

**Guards i fit-scriptet (permanente):** (1) ordens-guard — anchors med mål ≥15M og >30%
målafstand SKAL forudsiges i ejerens rækkefølge, ellers exit 1 (bløde brud <15M rapporteres);
(2) monotoni-guard — ln-kurven skal være voksende på hele [0,99]. Fit-kerne: `riderValuationFit.js`.

**Følgevirkning:** fiktiv launch-pyramide bund-tung under v3 → interim-bånd i
`fictionalLaunchPopulation.test.js` (ejer-re-godkendt 10/6); generator re-tunes i #1194 før 20/6.

**Cutover udført 10/6-2026 (slice 2, ejer-go):** `market_value`/`salary` er GENERATED fra
`base_value` (`COALESCE(base_value, 1000) + bonus`; salary 10%), `price` droppet (død kolonne),
`uci_points` afkoblet og fjernet fra al player-facing UI (rytterdatabase, holdsider,
auktionshistorik, manager-profil, udvikling-fane, Discord-notifikation). Al runtime læser
DB-kolonnen direkte (DB-først) — migrationen flippede økonomien atomisk.
Audit: `backend/scripts/auditValuationCutover.js`. Dynamisk glidning mod handelspris = fase 3.

## Datadrevet roadmap (besluttet 9-10/6-2026)

1. **Fase 1 (nu, launch 20/6):** Perception-model v3; anchors = træningsdata; manuel re-fit
   med guards. Shadow indtil cutover (slice 2, ejer-gated).
2. **Fase 2 (efter egen race-motor #1102/#676):** Værdi = forventet sæsonproduktion — simulér
   sæsonkalenderen N gange, fit mod forventede point/præmier pr. rytter. Anchors degraderes
   til VALIDERING. Modellen funderes i spillets egen fysik i stedet for håndsatte mål.
3. **Fase 3 (live drift, #1101-scope):** Dynamisk glidning af base_value mod faktiske
   auktions-/handelspriser ved finalization (triviel v1: vægtet glid) + periodisk re-fit.
   Markedet bliver sandheden; outliers korrigeres af spillerne selv.
