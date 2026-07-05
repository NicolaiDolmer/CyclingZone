# Facility-kalibrering bølge A2 (#1441 Fase 3) — harness-bevis (rekalibreret)

> 2026-07-05 · merge-gate for FACILITIES_ENABLED (flip = separat ejer-beslutning).
> Harness: `backend/scripts/facilityInvestmentScorecard.js` + `backend/scripts/inflationScorecard.js`.
> Spec: `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2.1/§2.3/§2.4/§5.
> **Historik:** første kalibrering (commit 8235bc46) fik alle daværende gates grønne, men blev
> underkendt i verificerende review — gate-designet var over-constrained og pressede
> konstanterne ud i degenererede former. Dette dokument fortæller hele forløbet.

## Resultat (efter rekalibrering)

Begge scorecards kørt UDEN `--config` mod prod-filen `backend/lib/facilityConstants.js`:

```
HEADLINE: facility-gates ✅ PASS — A2-merge-gate opfyldt
  tid-som-valuta ✅ · kommerciel payback ✅ · anti-optimal-path ✅ · form-gates ✅

HEADLINE: inflations-gate ✅ PASS (syntetisk primær; §2.1-mål-kurve).
```

**Ærlig margin-status:**

| Gate | Margin | Vurdering |
|---|---|---|
| Anti-optimal-path (værste celle: ×1,5/D1) | 3.-bedste = **94,5%** af max (krav ≥ 90%) | Solid — alle 9 celler ≥ 94,5% (før: 92,4%) |
| Inflations-floor M_fac(5)/M(0), 60%-adoption | **0,52** (krav ≥ 0,5) | TYND (~223k CZ$ over floor ved s=5) — men gaten er nu et realistisk scenarie, ikke worst-case; all-in-referencen viser stress-billedet separat |
| Tid-som-valuta | T1/D3 = **0,48** · T3-kum/D2 = **1,26** · T5-kum/D1 = **2,67** | Nær spec-ankrene (0,5 / ≈1 / 2+), IKKE bånd-bunde (før: 0,28 / 0,51 / 2,12) |
| Kommerciel payback | **∞** i alle tier/staff/divisions-kombinationer | Rigelig — kommerciel er et rent, loftet sink (se note nedenfor) |
| Form-gates | pris-steps 1,92-2,40 (bånd [1,5, 4]) · upkeep-andel 0,35-0,63 (< 1) · effekt-min-step 0,25-1,00 (≥ 0,2) · staff-løn-andel 0,28-0,36 (bånd [0,05, 0,40]) | Grøn med luft; staff-løn-andelen ligger i toppen af båndet (bevidst: staff skal koste noget) |
| Inflations-baseline | 1,02-1,09× (bånd [0,8, 1,3]) | Rigelig |

## Forløbet: startkandidater → første kalibrering → review → gate-korrektion → rekalibrering

### 1. Startkandidater (A1) fejlede 3 af 6 daværende gates

- Tid-som-valuta: T3-kum/D2 = 3,21 ❌ · T5-kum/D1 = 7,03 ❌ (priser 25/60/140/300/600k for dyre)
- Anti-optimal-path: 1/5 ❌ i alle divisioner — "balanced" dominerede D1/D2, "academy-first"
  dominerede D3 (academy-slot-leverage 5k/slot overvurderet)
- Inflations-floor: 0,37 ❌ ved s=5 (capex-chok ~2,25M/sæson mod fresh-net ~188k/sæson)

### 2. Første kalibrering (8235bc46) — alle gates grønne, men degenereret

Kalibreringen jagtede samtidigt (a) inflations-floor-gaten i dens DAVÆRENDE form — ALLE
22 hold bruger HELE præmie-budgettet på faciliteter, floor ≥ 0,5 — og (b) §2.4-prisbåndene.
(a) tvang totalomkostningerne ekstremt langt ned; (b) satte en bund under priserne. Det
eneste løsningsrum var degenererede former:

- **Pris-trappe 7k/10,5k/18k/19k/285k** — T3→T4 = +1k (de-facto-dublet), T4→T5 = ×15 (anomali).
- **Upkeep-inversion mod spec §2.1** ("engangs-pris + MINDRE løbende upkeep"): 5 sæsoners
  upkeep var 1,5-3,1× den kumulative pris på T1-T4 — upkeep var blevet HOVEDomkostningen.
- **Staff-lønninger 1,5k-12k uden relation til staff-værdi**: målt mod staffens marginale
  værdi-tilførsel var de 1,5-6,5× værdien — staff var en fælde (aldrig rentabel at ansætte),
  ikke en beslutning.
- **Effekt-tabeller med de-facto-dublet-tiers** (training t2 0,0455 → t3 0,0465 = +2%).

### 3. Review-fund: gate-fejlen, ikke kalibrerings-fejlen

Reviewet konkluderede at inflations-gaten var en **dobbelt-urealistisk worst-case**: 100%
adoption × 100% af budgettet. Faciliteter er FRIVILLIGT gold-sink-forbrug — spec §2.1 kalder
dem "det store gold-sink", hvis FORMÅL er at absorbere overskud. At kræve at pengemængden
holder sig over 0,5× når alle spillere frivilligt brænder hele overskuddet af, straffer
sinket for at virke. Gaten pressede konstanterne; niveau-gatene (§2.4-bånd) fangede ikke
form-degenerationen fordi de kun ser på tre punkter.

### 4. Gate-korrektion (dette commit)

1. **Inflations-gate → realistisk adoption:** gate-scenariet er nu `ADOPTION_BUDGET_SHARE
   = 0.6` (hold bruger 60% af præmie-budgettet på faciliteter; implementeret som
   `budgetShare`-parameter i `simulateStrategy` så modellen forbliver SSOT). Floor ≥ 0,5
   gælder dette scenarie. All-in (100%) rapporteres som stress-REFERENCE uden gate.
2. **Form-gates (nye, i HEADLINE):** maskinel håndhævelse af §2.1-intent så en fremtidig
   kalibrering ikke kan degenerere igen:
   - Pris-trappe: `price[t+1]/price[t] ∈ [1,5, 4]` (ingen dubletter, ingen ×15-hop).
   - Upkeep-andel: 5 sæsoners upkeep ved tier T < kumulativ pris til T (upkeep = det mindre sink).
   - Effekt-monotoni: strengt stigende; hvert step ≥ 20% af track'ets gennemsnitsstep.
   - Staff-relevans: løn[t] ∈ [5%, 40%] af staffens marginale værdi-tilførsel i D2 ved
     matched tier (gennemsnit over tracks; beregnet via `strengthValuePerSeason` med/uden staff).

### 5. Rekalibrering

Empirisk søgning (random-søgning + hill-climbing over per-track effekt-form/tops +
pris/upkeep-trapper, ~30k evaluerede kandidater i scratch — ikke committet) fulgt af
manuel afrunding til rene tal + mikro-justering (t3-effekt op, t5-effekt ned — bærende
for at BÅDE D3-specialister OG D1/D2-balanced ligger inden for ±10%).

## Konstanter: 8235bc46 (underkendt) → rekalibreret

| Konstant | 8235bc46 | Rekalibreret | Hvorfor |
|---|---|---|---|
| FACILITY_TIER_PRICE | 7k / 10,5k / 18k / 19k / 285k | **12k / 26k / 50k / 100k / 240k** | Monoton trappe ×1,9-2,4 (form-gate); ankre flyttet fra bånd-bunde til nær spec-mål: T1/D3 0,28→0,48 · T3-kum/D2 0,51→1,26 · T5-kum/D1 2,12→2,67. Engangs-prisen er nu HOVEDomkostningen (spec §2.1) |
| FACILITY_TIER_UPKEEP | 2,7k / 11k / 11k / 27k / 40k | **1,5k / 3,5k / 8k / 15k / 30k** | Upkeep-inversionen rettet: 5 sæsoners upkeep er nu 35-63% af kumulativ pris (før 155-314% på T1-T4). Monoton uden flade hop |
| STAFF_SALARY_BY_TIER | 1,5k / 2k / 3k / 8k / 12k | **100 / 250 / 600 / 1,3k / 2,6k** | Forankret i staffens marginale værdi (form-gate): løn = 28-36% af værdi-tilførslen i D2. De gamle lønninger var 1,5-6,5× værdien — staff var aldrig rentabel. Se ærlig note nedenfor |
| FACILITY_BASE_EFFECT training | 0,017/0,0455/0,0465/0,076/0,12 | **0,03/0,045/0,074/0,11/0,165** | Konveks, strengt stigende (min-step 46% af gennemsnit; før 4%) |
| FACILITY_BASE_EFFECT medical | 0,031/0,083/0,086/0,152/0,187 | **0,06/0,09/0,148/0,22/0,33** | Samme form; top ×2 af training (kompenserer leverage 1,5 vs 3,0) |
| FACILITY_BASE_EFFECT scouting | 0,14/0,39/0,40/0,64/1,0 | **0,015/0,032/0,07/0,145/0,30** | Konveks; top 0,30 (max facilitet afslører ~30% info-synlighed — der er bevidst loft: scouting-leverage ×0,3 gør høj synlighed for billig i styrke-værdi) |
| FACILITY_BASE_EFFECT commercial | 0,002/0,0025/0,0034/0,008/0,022 | **0,0006/0,0013/0,0027/0,0057/0,012** | Konveks uden dublet-steps. Loftet lavt: kommerciel er leverage-uafhængig og må ikke dominere D3 ved leverage ×0,5 |
| FACILITY_BASE_EFFECT academy | 1…5 slots | uændret (1…5 slots) | Heltalssemantik |
| STAFF_SEVERANCE_FACTOR | 0,5 | uændret | Ingen gate berører den |
| COMMERCIAL_MIN_PAYBACK_SEASONS | 4 | uændret (gate-tærskel) | Resultat nu: payback ∞ overalt (før: 66,7 sæsoner) |

**Leverage-antagelser (`DEFAULT_LEVERAGE` i modellen — antagelser, IKKE prod-konstanter):
uændrede fra 8235bc46** (training 3,0 · medical 1,5 · scouting 0,3 · academy-slot 900).
Begrundelserne fra første kalibrering står stadig: scouting 0,8→0,3 (ren info-fordel
konverterer ikke 1:1 til resultater) og academy-slot 5k→900 (et slot er en lotteriseddel
med års modning, ikke nær-startklar værdi) — begge blev re-verificeret her: anti-optimal-
path-gaten holder over ±50%-leverage-sweepen på ALLE værdier samtidig.

## Gate-detaljer (faktisk harness-output)

### Tid-som-valuta (§2.4)

| tier | pris | kumulativ | D1-sæsoner | D2-sæsoner | D3-sæsoner |
|---|---|---|---|---|---|
| 1 | 12.000 | 12.000 | 0,1 | 0,2 | 0,5 |
| 2 | 26.000 | 38.000 | 0,2 | 0,5 | 1,5 |
| 3 | 50.000 | 88.000 | 0,6 | 1,3 | 3,5 |
| 4 | 100.000 | 188.000 | 1,2 | 2,7 | 7,5 |
| 5 | 240.000 | 428.000 | 2,7 | 6,1 | 17,1 |

Gates: tier1_d3 = 0,48 ∈ [0,25, 1] ✅ · tier3cum_d2 = 1,26 ∈ [0,5, 2] ✅ · tier5cum_d1 = 2,67 ∈ [2, 6] ✅ — alle nær spec-ankrene (0,5 / ≈1 / 2-3).

### Form-gates (§2.1-intent)

```
  [pris-trappe]      t1→t2 2,167 · t2→t3 1,923 · t3→t4 2,000 · t4→t5 2,400  (bånd [1,5, 4]) ✅
  [upkeep-andel]     5×upkeep/cumPris: 0,625 / 0,461 / 0,455 / 0,399 / 0,350 (< 1) ✅
  [effekt-monotoni]  min-step/mean-step: training 0,455 · scouting 0,250 · medical 0,455 · academy 1,000 · commercial 0,250 (≥ 0,2) ✅
  [staff-relevans]   løn/staff-værdi (D2): t1 0,356 · t2 0,285 · t3 0,275 · t4 0,295 · t5 0,306 (bånd [0,05, 0,40]) ✅
```

### Kommerciel payback (§2.1)

Netto-marginalen er **negativ i samtlige kombinationer** (tier × staff × division) —
payback ∞ overalt. Kommerciel er et rent, loftet sink: bonussen (op til 7,2k/sæson i D1
ved t5+fuld staff) dækker aldrig drift (30k upkeep + 2,6k løn). **Bevidst design** —
anti-runaway-invarianten opfyldt maksimalt; sporet kø: Fase 4-merchandise-krogen (#1113).
Vil ejeren have kommerciel marginalt rentabel på høje tiers, er det en fremtidig justering
med ny harness-kørsel.

### Anti-optimal-path (§2.3)

Baseline-leverage (×1,0), 10-sæsoners styrke-proxy:

| Division | training-first | commercial-first | academy-first | support-first | balanced | konkurrencedygtige |
|---|---|---|---|---|---|---|
| D1 | 837.084 ✓ | 519.510 | 499.435 | 883.152 ✓ | 838.183 ✓ | 3/5 |
| D2 | 219.792 ✓ | 41.458 | 48.780 | 217.762 ✓ | 210.578 ✓ | 3/5 |
| D3 | 37.155 ✓ | 5.882 | 18.180 | 37.155 ✓ | 38.202 ✓ | 3/5 |

Leverage-robusthed (3.-bedste strategi som andel af bedste; krav ≥ 90%):

| Leverage | D1 | D2 | D3 |
|---|---|---|---|
| ×1,0 | 94,8% | 95,8% | 97,3% |
| ×0,5 | 94,8% | 97,2% | 94,8% |
| ×1,5 | 94,5% | 95,4% | 98,1% |

Den konkurrencedygtige trio er {training-first, support-first, balanced} i alle divisioner
— og hvem der er BEDST skifter med division (D1: support-first · D2: training-first ·
D3: balanced), hvilket er sundere end én fast vinder. academy-first/commercial-first er
spilbare men ikke optimale (10-66%) — bevidst: academy har flad CZ$-værdi og kommerciel
er sponsor-skaleret, så de kan ikke være divisions-proportionale uden at dominere D3.

### Inflations-kurve (coherence §6) — gate = 60%-adoption, all-in = reference

| sæson | M_baseline | ratio | M_fac (60%) | ratio | sink | M_fac (all-in, ref) | ratio |
|---|---|---|---|---|---|---|---|
| 1 | 11.188.254 | 1,02× | 10.012.782 | 0,91× | 1.175.472 | 9.264.334 | 0,84× |
| 2 | 11.376.508 | 1,03× | 9.099.916 | 0,83× | 1.101.120 | 7.399.308 | 0,67× |
| 3 | 11.564.762 | 1,05× | 7.881.690 | 0,72× | 1.406.480 | 5.747.816 | 0,52× |
| 4 | 11.753.016 | 1,07× | 7.013.864 | 0,64× | 1.056.080 | 3.499.685 | 0,32× |
| 5 | 11.941.270 | 1,09× | 5.723.238 | 0,52× | 1.478.880 | 1.590.253 | 0,14× |

Baseline i mål-kurve ✅ · sinket absorberer overskud ✅ · floor 0,52 ≥ 0,5 (60%-adoption) ✅.
**All-in-referencen falder til 0,14× ved s=5** — dvs. hvis ALLE spillere brændte HELE
præmien af på faciliteter i 5 sæsoner, ville feltet være drænet. Det er præcis derfor
all-in ikke er gaten: frivilligt sink-forbrug er deflation by design, og scenariet er
dobbelt-urealistisk (100% adoption × 100% af budgettet). 0,6-scenariet er den høje-men-
realistiske gate.

## Antagelser + følsomhed

| Antagelse | Værdi | Kilde/status |
|---|---|---|
| Investérbart budget = repræsentativ præmie-indkomst | D1 160k / D2 70k / D3 25k pr. sæson | Samme proxy som moneySupplyScorecard (ejer-reviewet, #1309). BLØDT input |
| Facility-adoption (inflations-gate) | 60% af præmie-budgettet, alle 22 hold | NY antagelse (review-korrektion). BLØDT input — ejer sanity-tjekker. All-in kørt som reference |
| Leverage | training 3,0 · medical 1,5 · scouting 0,3 · academy-slot 900/sæson | Uændret fra 8235bc46; gates holder over ±50% på ALLE værdier samtidig |
| RECURRING_CAP | 0,5 × budget | Uændret model-antagelse |
| TEAMS_BY_DIVISION | 8/8/6 (22 relaunch-hold) | Relaunch-rehearsal-split; guarded mod RELAUNCH_TEAM_COUNT |
| Staff-relevans-reference | D2 (midterdivision), gennemsnit over de 5 tracks | Én løn-tabel deler alle roller → gennemsnittet er den meningsfulde forankring |

**Følsomhed / advarsler til fremtidige ændringer:**
- Inflations-floor-marginen ved 60%-adoption er 0,02 (223k CZ$) ved s=5. Ændres præmie-
  estimater, INITIAL_BALANCE, holdfordeling eller upkeep/løn-niveauer, SKAL
  inflationScorecard genkøres. Bemærk også at kurven fortsat falder efter s=5 i modellen
  (balanced-sim'en bliver ved med at bruge 60% af præmien) — det er konservativt: i
  virkeligheden aftager capex når træet er udbygget.
- Anti-optimal-marginen er 4,5pp i værste celle (94,5% vs. 90%-krav) — langt mere robust
  end 8235bc46's 2,4pp, men t3/t5-effekt-balancen er bærende: t3-niveauet holder
  D3-specialisterne + D2/D1-balanced oppe; sænkes t3 eller hæves t5 isoleret, vælter den.
  Kør harness før enhver justering.
- **Ærlig note om staff-lønningerne (100-2.600 CZ$):** de er ABSOLUT set små. Det er en
  matematisk konsekvens af staff-relevans-gaten + util-modellen: staff løfter udnyttelsen
  fra 50% til max 100%, så staffens marginale værdi er bundet af facilitetens egen værdi
  (~280-8.700 CZ$/sæson i D2). Lønninger over ~3k ville gøre ansættelse til en fælde (det
  VAR de i 8235bc46). Vil ejeren have "prestige-lønninger" (10k+), kræver det en bredere
  util-model (fx 30% → 100%) — en engine-ændring uden for A2-scope, flag til A3/ejer-review.
- De fire gate-familier trækker stadig i hver sin retning, men løsningsrummet er nu ÅBENT
  (ikke razor): søgningen fandt et plateau af kandidater ≥ 93%; den valgte er afrundet
  til rene tal fra plateau-toppen.

## Non-regression

_(udfyldes af Task 7: moneySupplyScorecard --synthetic-only HEADLINE + prizeDistributionScorecard Gini-tal + npm test-resultat — `npm test` i backend er allerede kørt grøn her: 2750/2750)_

## Anbefaling

Harness grøn på ALLE fire gate-familier + inflations-gates → A2-merge-gaten er opfyldt.
FACILITIES_ENABLED-flip afventer ejer-go (+A3-UI). Spillernes oplevelse med de nye tal:
**dyrt at bygge, overkommeligt at drive** (som spec §2.1 foreskriver) — T1 koster en halv
D3-sæsons præmie, det fulde træ ~2,7 D1-sæsoner. UI'et i A3 bør vise både købspris og
drift (upkeep+løn pr. sæson). To punkter til ejer-review: (1) staff-løn-niveauet (se ærlig
note), (2) kommerciel er et rent minus-spor indtil Fase 4-merchandise.
