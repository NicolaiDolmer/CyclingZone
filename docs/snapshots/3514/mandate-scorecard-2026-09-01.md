# Mandat-scorecard (#3514)

**Genereret:** 2026-09-01T12:21:01.283Z
**Database:** ghwvkxzhsbbltzfnuhhz (prod, READ-ONLY via Supabase MCP)
**Aktiv sæson:** S3
**Hold i populationen:** 237
**READ-ONLY:** dette dokument er genereret af mandateScorecard3514.mjs, som kun læser (`.select()`) — ingen mutation er sket.

## 1. Confidence-fordeling: gammel model (3 tal) vs. ny model (ét confidence)

| Bånd | Før (plan-rækker) | Efter (hold) |
|---|---|---|
| 0-9 | 18 (2.7%) | 0 (0.0%) |
| 10-14 | 5 (0.7%) | 1 (0.4%) |
| 15-29 | 26 (3.9%) | 6 (2.5%) |
| 30-39 | 25 (3.7%) | 12 (5.1%) |
| 40-59 | 128 (19.1%) | 53 (22.4%) |
| 60-74 | 103 (15.4%) | 43 (18.1%) |
| 75-89 | 109 (16.2%) | 42 (17.7%) |
| 90-100 | 257 (38.3%) | 80 (33.8%) |

## 2. Hold pr. konsekvens-lag: gammel vs. ny model

| Lag | Konsekvens | Gammel (værste af 3) | Ny (ét confidence) |
|---|---|---|---|
| 2 | Lønloft | 44 | 19 |
| 3 | Signerings-restriktion | 28 | 7 |
| 4 | Tvangslistning | 14 | 1 |
| 5 | Sponsor-pullout | 12 | 0 |
| 6 | Bonustilbud (>75) | 150 | 121 |

✅ **0 hold krydser en NY konsekvens-tærskel uforskyldt.** (Matematisk garanteret af det vægtede snit — se selvtesten i mandateMigration3514.mjs/mandateShadowRebuild3514.mjs.)

## 3. Visions-milepæle pr. mål-sæson (grandfathered fra planernes egne slut-sæsoner)

| Sæson | Milepæle | Heraf headline |
|---|---|---|
| S3 | 685 | 411 |
| S4 | 230 | 138 |
| S5 | 1017 | 649 |
| S6 | 281 | 183 |
| S7 | 107 | 71 |

## 4. Top-10 største confidence-skift

| Hold | Gamle tal | Nyt confidence | Delta | Årsag |
|---|---|---|---|---|
| CSM Unirea | {"1yr":62,"3yr":15,"5yr":15} | 39 | +8 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Team BRND | {"1yr":56,"3yr":6,"5yr":6} | 31 | +8 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Universal Cycling | {"1yr":69,"3yr":19,"5yr":21} | 44 | +8 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Squid Sycling | {"1yr":70,"3yr":29,"5yr":25} | 49 | +8 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Silveracers | {"1yr":73,"3yr":26,"5yr":28} | 50 | +8 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Pattex Cycling Team | {"1yr":91,"3yr":45,"5yr":48} | 69 | +8 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Festina Nissa | {"1yr":51,"3yr":18,"5yr":5} | 32 | +7 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Tuft cycling | {"1yr":56,"3yr":15,"5yr":15} | 36 | +7 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Hatestone Cycling Club | {"1yr":65,"3yr":23,"5yr":26} | 45 | +7 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |
| Pfeiffer Dev | {"1yr":46,"3yr":0,"5yr":2} | 23 | +7 | Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere |

## 5. Advarsler

- **unsigned_long_plan_excluded:** 13
