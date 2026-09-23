# v4 flip-klar-rapport (baseline paa main, 23/9) — #5515

> WIP: maalingen koeres. Prosa og tjekliste foelger.

<!-- v4-flip-readiness:start -->

> **Genereret af `backend/scripts/v4FlipReadiness.mjs`, ikke haandskrevet.** Tallene bag dommene (middel, spaend, rater) staar i den private fil (hard rule 17), ikke her. Ret ikke i blokken; koer scriptet igen.
>
> Koert 2026-09-23T00:44:11.463Z paa motor-sha `86d14b239` · population `backend/scripts/baselines/population-snapshot-2026-09-07.json` · etaper `backend/scripts/baselines/v4-proxy-stages-2026-09-06.json` (141 etaper) · felt 180 · orders=none.

### 1. Ankre, v3 mod v4 (5 seeds: s1, s2, s3, s4, s5)

Dommen er paa seed-middel (RULES §7 raekke 8). "Seeds" = antal enkelt-seeds der bestaar for sig; baandene staar i RULES §7b.

| Anker | v3 | v3 seeds | v4 | v4 seeds |
|---|---|---|---|---|
| Felt-sammenhaeng, flade etaper | **FAIL** | 0/5 | PASS | 5/5 |
| Nedkoersels-gaps vs. summit-gaps (ratio) | **FAIL** | 1/5 | PASS | 4/5 |
| Descent attack-gevinst (10-20s-loft, aldrig omvendt fortegn i gruppen) | ikke maalt | - | PASS | 5/5 |
| Punch-korrelation (punch-evne vs. placering paa punch-etaper) | PASS | 5/5 | PASS | 5/5 |
| Brostensevnens loeft paa brosten/grus (spearman-forskel vs. flad) | PASS | 5/5 | PASS | 4/5 |
| Felt-favoritters win-rate | PASS | 3/5 | **FAIL** | 0/5 |
| Samme-hold-top-10 (andel etaper med 4+ fra ét hold) | PASS | 5/5 | PASS | 5/5 |
| Udbruds-rater pr. terraen (descent-dominans 54% skal ned) | PASS | 5/5 | ikke maalt | - |
| Sprinter-vinderrate paa flat (top-20%-sprint-evne vinder) | **FAIL** | 2/5 | PASS | 5/5 |
| ITT-korrelation (time_trial-evne vs. placering, synlig) | PASS | 5/5 | PASS | 5/5 |
| Bonussekunder GC-effekt bounded (maks ~10s/etape) | **FAIL** | 0/5 | PASS | 5/5 |
| Bjergetape top-10-spredning, topankomster (#2415) | **FAIL** | 0/5 | PASS | 4/5 |
| GT-vindermargin (#2415) | ikke maalt | - | ikke maalt | - |

**v4 samlet:** 10 PASS · 1 FAIL · 2 ikke maalt. Flip-gatens krav "alle ankre groenne": **IKKE OPFYLDT**.

### 2. Hale-gaten (ejer-laast, 3 seeds: s1, s2, s3)

| Etapetype | Dom |
|---|---|
| flat | PASS |
| high_mountain | PASS |
| mountain | PASS |

**Samlet hale-gate:** PASS. Ikke-laaste etapetyper rapporteres kun i den private fil.

### 3. Uheld og tidsgraense (v4, 5 seeds x 141 etaper)

- **Uheldsrate samlet mod ejer-maalet** (RULES §2c / §9 raekke 4): PASS.
- **OTL forekommer:** ja (etapetyper: classic, cobbles, flat, high_mountain, hilly, mountain, rolling).
- **Grupetto-redning udloeses:** ja (etapetyper: hilly, mountain, rolling).
- **Mekanisk uheld (og intet andet) ender som OTL, dvs. ude af loebet:** **ja** (etapetyper: classic, cobbles, flat, high_mountain, hilly, mountain, rolling). RULES §9 raekke 4: et mekanisk uheld maa aldrig koste udgaaelse.
- **Haardt styrt ender som OTL:** **ja**. Trappen lover at han kommer i maal og koerer videre.
- **OTL kun efter et uheld** (aldrig rent fysiologisk) paa: classic, cobbles, flat, high_mountain.
- Rater pr. etapetype (uheld, alvorlige styrt, udgaaede, OTL og dens aarsager, redninger) staar i den private fil.

### 4. Ydelse (gate: under 60 s pr. etape)

| Felt | Etaper | Middel | p95 | Maks (etapetype) | Dom |
|---|---|---|---|---|---|
| 180 | 141 | 9 ms | 19 ms | 43 ms (mountain) | PASS |
| 192 | 141 | 10 ms | 20 ms | 39 ms (mountain) | PASS |

Maalt paa DOLMERPC (v24.16.0), rute-adapter + motor + oversaettelse til v3's ranked-form, uden DB. Railway-containerens CPU er ikke maalt her.

### 5. Flip-infrastruktur og kill-switch (eksisterende tests, koert nu)

| Testfil | Resultat | Heraf kill-switch-tests |
|---|---|---|
| `backend/lib/raceRunnerEngineV4.test.js` | groen (13/13) | 4/4 groenne |
| `backend/lib/raceEngineV4Bridge.test.js` | groen (18/18) | 2/2 groenne |
| `backend/lib/raceRunnerEngineV4Parity.test.js` | groen (15/15) | - |
| `backend/lib/raceEngineV4Bridge.teamTimeTrial.test.js` | groen (7/7) | - |

**Kill-switch samlet:** groen (6/6). Testene er lokale enhedstests med stub-DB, ikke en prod-oevelse.

<!-- v4-flip-readiness:end -->
