# Facility-kalibrering bølge A2 (#1441 Fase 3) — harness-bevis

> 2026-07-05 · merge-gate for FACILITIES_ENABLED (flip = separat ejer-beslutning).
> Harness: `backend/scripts/facilityInvestmentScorecard.js` + `backend/scripts/inflationScorecard.js`.
> Spec: `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2.3/§2.4/§5.

## Resultat (efter kalibrering)

Begge scorecards kørt UDEN `--config` mod prod-filen `backend/lib/facilityConstants.js`:

```
HEADLINE: facility-gates ✅ PASS — A2-merge-gate opfyldt
  tid-som-valuta ✅ · kommerciel payback ✅ · anti-optimal-path ✅

HEADLINE: inflations-gate ✅ PASS (syntetisk primær; §2.1-mål-kurve).
```

Kalibreringen tog 12 empiriske iterationer (6 hånd-kandidater + 3 grid-sweeps à 54–486
kombinationer + 3 finjusteringer). "Før"-kørslen på A1-startkandidaterne fejlede 3 af 6
gates (se §Før-baseline nederst).

**Ærlig margin-status** (vigtigt for fremtidige ændringer af økonomien):

| Gate | Margin | Vurdering |
|---|---|---|
| Anti-optimal-path (værste celle: D3, alle leverages) | 3.-bedste = **92,4%** af max (krav ≥ 90%) | OK, men følsom for effekt-ændringer |
| Inflations-floor M_fac(5)/M(0) | **0,503** (krav ≥ 0,5) | RAZOR — kun 35k CZ$ over floor. Enhver forøgelse af upkeep/priser vælter den |
| Tid-som-valuta T3-kum/D2 | **0,507** (bånd [0,5, 2,0]) | RAZOR i bunden — priserne kan ikke sænkes mere |
| Tid-som-valuta T1/D3 · T5/D1 | 0,28 · 2,12 | OK |
| Kommerciel payback | min 66,7 sæsoner (krav ≥ 4) | Rigelig — kommerciel er et loftet sink |
| Inflations-baseline | 1,02–1,09× (bånd [0,8, 1,3]) | Rigelig |

## Konstanter: før (A1-startkandidater) → efter (kalibreret)

| Konstant | Før | Efter | Hvorfor (gate-henvisning) |
|---|---|---|---|
| FACILITY_TIER_PRICE | 25k / 60k / 140k / 300k / 600k | **7k / 10,5k / 18k / 19k / 285k** | Tid-som-valuta (§2.4): T3-kum/D2 var 3,21 (bånd ≤ 2,0), T5-kum/D1 var 7,03 (bånd ≤ 6). Inflations-floor: billig capex er nødvendig for at det aggregerede sink holder sig over 0,5×M(0). t4 er bevidst kun marginalt dyrere end t3 (kalibrerings-bærende); t5 er aspirations-springet |
| FACILITY_TIER_UPKEEP | 2k / 5k / 10k / 20k / 35k | **2,7k / 11k / 11k / 27k / 40k** | Anti-optimal-path: drift (ikke køb) er den reelle omkostning; upkeep-trappen styrer hvor hver divisions recurring-cap trapper porteføljen. t2=t3 (fladt hop) giver D3-hold adgang til tier 3 og lader D1-balanced fylde all-t3 (r=70k) uden t4-capex-eksplosion |
| STAFF_SALARY_BY_TIER | 10k / 22k / 40k / 70k / 120k | **1,5k / 2k / 3k / 8k / 12k** | Anti-optimal-path: dyre staff gjorde staff-på-høje-tiers til en dominans-exploit (mismatch mellem util-model og løn); billige staff ⇒ alle strategier bemander matched ⇒ værdi ∝ drift holder. Inflations-floor: staff-løn var den største recurring-drivkraft |
| FACILITY_BASE_EFFECT training | 0,02…0,10 lineær | **0,017 / 0,0455 / 0,0465 / 0,076 / 0,12** | Effekt-step ∝ drift-step (kerne-designreglen der giver ≥3 konkurrencedygtige rækkefølger). t3-niveauet er finjusteret −5% (D3-max-dæmpning), totalen +20% (træning skal bære training-first i D1/D2) |
| FACILITY_BASE_EFFECT medical | 0,03…0,15 lineær | **0,031 / 0,083 / 0,086 / 0,152 / 0,187** | Samme ∝-drift-form; t4 løftet +4% (support-first-viabilitet i D2) og t5 sænket −12% (support-first-dominans i D1) — de to celler har kun dette differentierende håndtag |
| FACILITY_BASE_EFFECT scouting | 0,20…1,00 lineær | **0,14 / 0,39 / 0,40 / 0,64 / 1,0** | ∝-drift-form. Semantik uændret (synlighedsgrad 0–1) |
| FACILITY_BASE_EFFECT commercial | 0,01…0,05 lineær | **0,002 / 0,0025 / 0,0034 / 0,008 / 0,022** | Payback-gaten (§2.1) + anti-optimal-path ved leverage ×0,5: kommerciel er leverage-uafhængig, så dens styrke-værdi SKAL være lille for at den ikke dominerer D3 når alle andre spor halveres. Bevidst design: kommerciel er et loftet penge-sink, ikke et styrke-spor |
| FACILITY_BASE_EFFECT academy | 1…5 slots | uændret (1…5 slots) | Slots er heltalssemantik; balancen er flyttet til leverage-antagelsen (se nedenfor) |
| STAFF_SEVERANCE_FACTOR | 0,5 | uændret | Ingen gate berører den |
| COMMERCIAL_MIN_PAYBACK_SEASONS | 4 | uændret | Gate-tærskel, ikke kalibrerings-håndtag |

**Leverage-antagelser justeret i `backend/scripts/lib/facilityInvestmentModel.js` (DEFAULT_LEVERAGE — antagelser, IKKE prod-konstanter):**

| Antagelse | Før | Efter | Begrundelse |
|---|---|---|---|
| scouting | 0,8 | **0,3** | 0,8 betød "fuld scouting-synlighed ≈ 80% af en sæsons præmie-indkomst i resultat-værdi" — urimeligt højt for en ren informations-fordel der stadig kræver gode køb for at blive til point. 0,3 er stadig en betydelig fordel |
| academySlotValue | 5.000 | **900** | 5k/slot/sæson antog at hvert akademi-slot producerer nær-startklar værdi hver sæson. Et slot er en lotteriseddel på en prospect med flere års modning og høj varians — forventningsværdien pr. slot pr. sæson er langt lavere. Baseline-diagnosen viste også at 5k gjorde academy-first dominant i D3 (eneste konkurrencedygtige strategi) — et symptom på overvurdering, ikke på god balance |
| training / medical | 3,0 / 1,5 | uændret | Rimelige; gates holder over hele ±50%-intervallet |

## Gate-detaljer

### Tid-som-valuta (§2.4)

| tier | pris | kumulativ | D1-sæsoner | D2-sæsoner | D3-sæsoner |
|---|---|---|---|---|---|
| 1 | 7.000 | 7.000 | 0,0 | 0,1 | 0,3 |
| 2 | 10.500 | 17.500 | 0,1 | 0,3 | 0,7 |
| 3 | 18.000 | 35.500 | 0,2 | 0,5 | 1,4 |
| 4 | 19.000 | 54.500 | 0,3 | 0,8 | 2,2 |
| 5 | 285.000 | 339.500 | 2,1 | 4,8 | 13,6 |

Gates: tier1_d3 = 0,28 ∈ [0,25, 1] ✅ · tier3cum_d2 = 0,51 ∈ [0,5, 2] ✅ · tier5cum_d1 = 2,12 ∈ [2, 6] ✅.
Bemærk designskiftet ift. startkandidaterne: **køb er billige, drift er dyr** — tiden-som-valuta
betales primært løbende (upkeep+løn under recurring-råderummet), ikke som engangs-chok.

### Kommerciel payback (§2.1)

Mest gunstige kombination i hele matricen (tier × staff × division): **tier 3, uden staff, D1 → 66,7 sæsoner** (netto +270/sæson mod pris 18k). Alle andre kombinationer er netto-negative (payback ∞) — kommerciel er et bevidst loftet sink der aldrig bliver en pengemaskine. D2: 100,0 · D3: 117,6 sæsoner.

### Anti-optimal-path (§2.3)

Baseline-leverage (×1,0), 10-sæsoners styrke-proxy:

| Division | training-first | commercial-first | academy-first | support-first | balanced | konkurrencedygtige |
|---|---|---|---|---|---|---|
| D1 | 540.864 ✓ | 260.160 | 188.400 | 547.584 ✓ | 534.618 ✓ | 3/5 |
| D2 | 143.640 ✓ | 28.800 | 32.400 | 143.640 ✓ | 148.990 ✓ | 3/5 |
| D3 | 20.880 ✓ | 6.752 | 15.660 | 19.283 ✓ | 19.763 ✓ | 3/5 |

Leverage-robusthed (3.-bedste strategi som andel af bedste; krav ≥ 90%):

| Leverage | D1 | D2 | D3 |
|---|---|---|---|
| ×1,0 | 97,6% | 96,4% | 92,4% |
| ×0,5 | 98,3% | 93,9% | 92,4% |
| ×1,5 | 96,7% | 97,3% | 92,4% |

De tre konkurrencedygtige rækkefølger er {training-first, support-first, balanced} i alle
divisioner. academy-first og commercial-first er spilbare men ikke optimale (75-88% i D3,
mindre i D1/D2) — det er et bevidst resultat: academy/commercial har flad hhv. sponsor-skaleret
værdi som ikke kan være divisions-proportional, så de kan ikke være top-3 i ALLE divisioner
uden at dominere D3.

### Inflations-kurve (coherence §6)

| sæson | M_baseline | ratio | M_faciliteter | ratio | facility-sink |
|---|---|---|---|---|---|
| 1 | 11.188.254 | 1,02× | 8.458.454 | 0,77× | 2.729.800 |
| 2 | 11.376.508 | 1,03× | 7.619.564 | 0,69× | 1.027.144 |
| 3 | 11.564.762 | 1,05× | 6.924.674 | 0,63× | 883.144 |
| 4 | 11.753.016 | 1,07× | 6.229.784 | 0,57× | 883.144 |
| 5 | 11.941.270 | 1,09× | 5.534.894 | 0,50× | 883.144 |

Baseline i mål-kurve ✅ · sinket absorberer overskud (M_fac < M_base) ✅ · floor 0,503 ≥ 0,5 ✅.
Sink-profilen: capex-front (sæson 1–2, byggefasen) → steady-state ~883k/sæson ren drift.
Steady-state-porteføljer (balanced, worst-case-adoption): D1 alle spor tier 3 fuldt bemandet
(recurring 70k = 87% af cap), D2 tier 1–2 (34,1k), D3 tre spor tier 1 (11,1k).

## Antagelser + følsomhed

| Antagelse | Værdi | Kilde/status |
|---|---|---|
| Investérbart budget = repræsentativ præmie-indkomst | D1 160k / D2 70k / D3 25k pr. sæson | Samme proxy som moneySupplyScorecard (ejer-reviewet, #1309). BLØDT input |
| Leverage | training 3,0 · medical 1,5 · scouting 0,3 · academy-slot 900/sæson | To justeret i A2 (se tabel ovenfor). Anti-optimal-gaten holder over ±50% på ALLE leverage-værdier samtidig |
| RECURRING_CAP | 0,5 × budget | Uændret model-antagelse (worst-case: hold binder halvdelen af det frie cash-flow i drift) |
| TEAMS_BY_DIVISION | 8/8/6 (22 relaunch-hold) | Relaunch-rehearsal-split; guarded mod RELAUNCH_TEAM_COUNT |
| Adoption i inflations-linsen | ALLE 22 hold kører balanced-strategien med hele præmie-budgettet | Bevidst worst-case; floor holder alligevel (0,503) |

**Følsomhed / advarsler til fremtidige ændringer:**
- Floor-marginen er 0,3%. Hvis præmie-estimaterne, INITIAL_BALANCE, holdfordelingen eller
  upkeep/løn-tallene ændres, SKAL inflationScorecard genkøres.
- ±50%-leverage-sweepen er indbygget i scorecardet og grøn i alle 9 celler (min 92,4%).
- Effekt-tabellernes form (∝ drift, med de dokumenterede tilts) er gate-bærende. "Pænere"
  afrunding af enkelt-tal (fx t2/t3-fladheden) vælter anti-optimal-path — kør harness før
  enhver kosmetisk justering.
- De tre gates trækker i hver sin retning (billige priser ↔ tid-som-valuta-bunden;
  effekt-værdi ↔ leverage-×0,5-robusthed; drift-niveau ↔ floor). Løsningsrummet er smalt:
  ~700 grid-sweep-kombinationer blev evalueret undervejs uden at én passerede alle gates —
  den endelige løsning krævede per-track-effekt-tilts (medical t4/t5-omformning) som
  grid'ene ikke udtrykte.

## Før-baseline (A1-startkandidaterne, dokumentation)

- Tid-som-valuta: T1/D3 = 1,00 ✅ (kant) · T3-kum/D2 = **3,21 ❌** · T5-kum/D1 = **7,03 ❌**
- Kommerciel payback: min 25,0 sæsoner ✅
- Anti-optimal-path: **❌ 1/5** i alle divisioner × alle leverages — "balanced" dominerede
  D1/D2 (billige lave tiers gav mest effekt pr. CZ$), "academy-first" dominerede D3
  (academy-slot-antagelsen 5k/slot overvurderet)
- Inflations-floor: **❌ 0,37** ved s=5 (capex-sink ~2,25M/sæson de første sæsoner mod
  fresh-net ~188k/sæson)

## Non-regression (Task 7-output indsættes her)

_(udfyldes af Task 7: moneySupplyScorecard --synthetic-only HEADLINE + prizeDistributionScorecard Gini-tal + npm test-resultat)_

## Anbefaling

Harness grøn → A2-merge-gaten er opfyldt. FACILITIES_ENABLED-flip afventer ejer-go (+A3-UI).
Ved flip: bemærk at spillernes oplevelse bliver "billigt at bygge, dyrt at drive" — UI'et i A3
bør vise drift-omkostningen (upkeep+løn pr. sæson) mindst lige så prominent som købsprisen.
