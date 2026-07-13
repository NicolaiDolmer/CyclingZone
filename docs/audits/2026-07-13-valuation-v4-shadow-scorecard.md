# Værdimodel v4 — shadow-scorecard + fund (slice 1, #2428)

- **Dato:** 2026-07-13
- **Status:** SHADOW leveret — ejer-review FØR cutover (slice 2). Ingen økonomi-ændring, ingen migration.
- **Spec:** [superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md](../superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md)
- **Regenerér:** `cd backend && node scripts/simulateSeasonProduction.js --k=30 && node scripts/fitRiderValuationV4.js && node scripts/valuationV4Scorecard.js --out=<sti>` (alt READ-ONLY mod prod).
- **Model:** `backend/lib/riderValuationModelV4.json` (committed) · sim_run_id `ac8d39c6` · K=30 · discount=0,80 · alpha=0,50 (grid-valgt).

## Gates (6/7 grønne)

| # | Gate | Type | Status | Detalje |
|--:|---|:--:|:--:|---|
| 1 | Type-økonomi-tabel | rapport | ✅ | 8 typer med sim-data (se §2) |
| 2 | Skala-kontinuitet (median-drift ≤±15%) | hård | ✅ | median v3=6.658 → v4=5.915 · drift −11,2% |
| 3 | Udvikl-og-sælg P&L | hård | ✅ | net-positiv=true (prospect 1,42M→2,43M, cost 0,75M, profit +0,26M/4 sæsoner) · ikke-dominant=true (top-ung 2,43M < peak-stjerne-loft 2,93M) |
| 4 | Symmetri (trajectories) | rapport | ✅ | 3 arketyper (se §3) |
| 5 | **Ingen runaway (total ≤×2)** | **hård** | **❌** | **total v3=79,1M → v4=214,2M = ×2,71** |
| 6 | Anker-sanity (top ≥15M) | rapport | ✅ | ingen afvigelse fra ejer-anchor-rækkefølge |
| 7 | Determinisme (sim_run_id) | hård | ✅ | `ac8d39c6` — reproducerbart |

**Den ene røde gate (runaway) er IKKE en bug — det er scorecardets korrekte signal:** v4 ville inflatere populations-totalen ~2,7-3,2× ved et direkte cutover. Medianen er stabil (−11%), så inflationen sidder i toppen (v4 spreder værdi stejlere mod de stærke ryttere: p90 v3=22.420 → v4=52.014).

**RETTELSE (verificeret via discount-sweep 13/7):** runaway er IKKE tunbart via `discount`. Skala-kalibreringen holder medianen fast, så en lavere d annulleres af re-skaleringen — ratioen plateauer ~×2,6 (d=0,80→×3,21, d=0,50→×2,62). Ratioen er en *form*-egenskab (hale-tyngde), ikke en discount-effekt. **De ægte løftestænger:** (A) bind toppen (blødt loft / mere konkav fit-top, som v3's value_cap) — eller (B) accepter en højere ratio hvis økonomien kan bære ~3× penge-i-stjerner og hæv ×2-tærsklen. **Fix-item:** fit-scriptets skala-kalibrering bruger en bredere population (ikke-pensioneret + har-abilities, inkl. free agents/akademi) end runaway-gaten (holdsat, ikke-akademi) — derfor viser scorecardet ×2,71 mens en teamed-only re-kalibrering giver ×3,21; align de to.

## 1. Fundamentale fund (verificeret mod prod-data 13/7)

1. **β_pt er degenereret i nuværende motor.** `prize_money = points × 75` eksakt (verificeret: `prizePayoutEngine` krediterer `race_results.prize_money`; `prize_tables` bruges ikke i live payout). Derfor **E[præmier] = 75 × E[point]** — point bærer intet selvstændigt signal. β_pt (§8 Q3) er i praksis en ren omskalering, ikke et prestige-signal. **Beslutning Q3:** hvis point skal veje selvstændigt, kræver det en separat ikke-monetær prestige-kilde (findes ikke i motoren i dag).

2. **Elite-halen er ikke i sim'en (free agents).** Sim'en simulerer kun holdsatte ryttere (kun de kører løb). Men **alle 8 ryttere værd ≥15M er free agents (team_id NULL)** — usignerede, formentlig fordi åben beta har få managere til at signere stjerner endnu. Stærkeste holdsatte rytter: overall 57,7; stærkeste free agent: 71,9. Konsekvens: fittet er kalibreret på overall ≤~58, og v4 **ekstrapolerer** for stjernerne (spec fjernede output_max/value_cap). Fitkurven vender først nedad ved O≈90 (c=−0,0011), så realistiske profiler (O≤~70) er stadig monotont voksende — men elite-priserne er uvaliderede. **Anbefaling før cutover:** beslut hvordan elite-halen prissættes (fx inkludér free agents i sim'en ved ability-matchet feltsætning — "hvad ville de producere hvis signeret" — eller behold et top-loft). Dette er en økonomisk ejer-beslutning.

3. **Ability-skalaen er komprimeret.** Holdsatte ryttere: median overall ~10, max 58 (af 99). Ægte data (`formula_version` uniformt 3, ikke en bug). Det meste af 0-99-skalaen bruges ikke i den holdsatte population.

4. **Division-confound → lav R².** Fittets **R²(log)=0,36**: ability forklarer kun ~36% af produktions-variansen. Resten er felt-/division-kontekst (en svag specialist i et svagt div-felt vinder relativt og tjener meget) + løbs-held. Den glatte kurve er stadig en fornuftig central-tendens, men **individ-produktionen er kun svagt forudsigelig fra ability alene** — vigtigt at kende før man stoler på enkelt-rytter-v4-værdier.

## 2. Type-økonomi — målt E[produktion] (sim) vs v3-perception

Den skarpeste "målt vs. antaget"-tabel. v3's type-offsets er ejer-anchor-kalibrerede; sim'en måler hvad typerne FAKTISK tjener i spillets kalender.

| Type | n (sim) | Median E[prize] | p90 E[prize] | v3 offset ×mult |
|---|--:|--:|--:|--:|
| gc | 2 | 84.275 | 84.275 | ×1,68 |
| puncheur | 16 | 62.670 | 192.960 | ×0,37 |
| brostensrytter | 34 | 26.540 | 77.975 | ×1,22 |
| baroudeur | 22 | 23.718 | 152.793 | — |
| rouleur | 71 | 8.468 | 70.813 | ×0,58 |
| climber | 1.661 | 3.530 | 36.735 | ×0,66 |
| sprinter | 1.125 | 2.790 | 16.985 | ×2,34 |
| tt | 2.316 | 833 | 4.403 | ×0,95 |

**Inversioner:** v3 tror sprintere er dyrest (×2,34); sim'en siger de tjener næst-mindst (median 2.790). v3 tror puncheurs er billigst (×0,37); sim'en siger de tjener næst-mest (median 62.670). MEN de høj-tjenende typer har **små n** (gc=2, puncheur=16, brostensrytter=34) — delvist fordi de stærke af de typer er free agents (fund #2). Rangordenen blandt de vel-samplede typer (climber 1.661, sprinter 1.125, tt 2.316) er robust: tt tjener mindst.

## 3. Symmetri — karriere-trajectories (virker som tilsigtet)

**Peak-stjerne (25-29å):** O vokser 46,9→57,6 (vækst-fase), produktion 378k→935k/sæson, falder efter peak, survival dropper fra alder 37 (75%→38%→9%), NPV domineret af peak-årene. Total v4-værdi ~2,93M.

**Veteran (≥33å):** lav O (7,3→1,3), lav produktion, hurtig henfald, survival 100%→9% over alder 35-39.

Alders-/potentiale-/survival-mekanikken (karriere-NPV, §3.3) er korrekt: unge prises for fremtiden, veteraner for resten.

## 4. Anbefaling

Slice 1 er leveret som shadow. **Cutover (slice 2) er IKKE klar** — runaway-gaten kræver tuning. Rækkefølge før cutover-beslutning:

1. **Runaway-beslutning** (rettet — IKKE discount): bind toppen (blødt loft/konkav fit-top) ELLER accepter ~3× og hæv ×2-tærsklen. + align skala-kalibrerings-population med runaway-gaten.
2. **Elite-hale-beslutning** (fund #2): inkludér free agents i sim'en (ability-matchet feltsætning) eller behold et top-loft. Vigtigst — ellers er stjerne-priserne uvaliderede.
3. **Ejer-valg Q1-Q3** (spec §8): β_pt (anbefaling: 0 — degenereret, fund #1) · discount d (styrer alders-symmetri, IKKE total — behold ~0,80) · prize_earnings_bonus (anbefaling: drop).
4. Re-kør fit + scorecard til alle hårde gates er grønne → DEREFTER slice 2 (migration + `predictBaseValue`-swap, ejer merger).

Interaktiv v3-vs-v4-udforskning: **Admin → Økonomi → "Rytter-værdi v4: produktions-model (shadow · #2428)"** (kræver admin-login).
