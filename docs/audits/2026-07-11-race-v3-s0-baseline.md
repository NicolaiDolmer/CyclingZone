# Race v3 S0 — dominans/varians-BASELINE mod ægte prod-population (#2224)

**Dato:** 2026-07-11 · **Slice:** S0 (harness + baseline, INGEN motor-ændring) · **Spec:** [2026-07-11-race-engine-depth-credibility-design.md](../superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md) §12-13
**Gate (jf. §13):** "Baseline dokumenteret; ingen motor-ændring" — ✅ opfyldt med dette dokument.

## Hvad blev bygget

| Artefakt | Indhold |
|---|---|
| `backend/lib/raceDominanceMetrics.js` (+ 19 tests) | Ren metrik-lib: favorit-win/podium, samme-hold-top-10, distinkte hold, sæson-win-rates (max/p95/histogram), gini over sejre, hjælper-placeringstab |
| `backend/scripts/exportPopulationSnapshot.js` | Read-only prod-eksport → JSON (ryttere+abilities+hold+condition; test/frosne/bank-hold og akademi/pensionerede ekskluderet; udlånte ryttere flyttet til låner-hold; holdnavne bevidst udeladt) |
| `simulateSeasonDryRun.js` `--population=<fil>` | Pulje-baserede felter fra ægte hold via prod-autopick (`autopickTeamSelection`: lineup 6-7 + roller); `--condition=snapshot`; NY sektion F |
| Sektion F + `--enforce-dominance` | Dominans/varians-scorecard mod de ejer-godkendte v3-bånd; rapport-only i S0, hard gate fra S1 |
| `backend/scripts/baselines/population-snapshot-2026-07-11.json` | Committet snapshot (3 MB) — S1/S2 kalibrerer mod PRÆCIS samme population |

**Determinisme-guard verificeret:** uden `--population` er scriptet byte-identisk (sektion A-E diffet før/efter); `npm run race:gate` grøn på 2026/7/42; fuld backend-suite 3.090/3.090 grøn.

## Population-snapshot (2026-07-11)

368 hold (tier 1: 24 · tier 2: 48 · tier 3: 100 · tier 4: 196; 15 puljer à ≥6 hold), 5.650 ryttere, condition-dækning 99,7 %. Felter i harnesset: hele puljen stiller op, 6 ryttere/hold (tier 1: 7; GT: 8) → felter på ~145-170.

## Baseline-resultater — 3 seeds (2026/7/42) × neutral / condition=snapshot / roles

Spænd over de 9 kørsler (300 løb/terræn × 8 terræner + 1 GT pr. kørsel):

| Metrik | Baseline (S0) | v3-målbånd | Status |
|---|---|---|---|
| Favorit-win-rate pr. løb | **53,0-54,9 %** | 25-40 % | ✗ |
| Sæson-max win-rate (≥5 starter) | **87,2-89,5 %** | ≤45 % | ✗ — reproducerer prod-evidensens 82-88 % (#2224 §2) |
| p95 sæson-win-rate | 1,7-1,8 % | ≤35 % | ✓ (trivielt: 5.650 ryttere → p95 domineres af domestiques; bindende linser er max + favorit-rater) |
| Favorit-podium-rate | **76,3-78,1 %** | 55-75 % | ✗ (favoritten skuffer aldrig) |
| Løb m. ≥4 samme hold i top 10 | 4,5-5,9 % | ≤5 % | ~borderline (én-dags-linsen; se fidelity-gab) |
| Gns. distinkte hold i top 10 | 7,9-8,0 | ≥7,5 | ✓ (i fuld-pulje-felter) |
| ITT favorit-win | **71,0-76,7 %** | 45-65 % | ✗ |
| Hjælper-placeringstab (median, GC-profiler, roles) | **0,0** | 10-30 pladser | ✗ — hjælper-arbejde er 100 % gratis i dag (rod-årsag #2224) |
| Gini over sejre | 0,945-0,952 | (rapport-only) | ekstremt koncentreret |
| Jour-sans / DNF | 0 / 0 | 2-5 % / 0,3-1,5 % | n/a — S2/S4-komponenter findes ikke endnu |

Resultaterne er bemærkelsesværdigt seed-stabile (<2 pp spredning) og næsten ens på tværs af neutral/condition/roles — dvs. dominansen er strukturel (evne-gaps ≫ varians), ikke condition- eller rolle-drevet. Præcis spec'ens §3-diagnose.

## Fund undervejs (vigtige for S1/S2)

1. **Udbruds-bånd eksploderer i population-mode:** flat 42-48 % escapee-sejre (bånd 1-7 % på genereret population), rolling/cobbles ligeledes over. Puljerne er langt mere evne-homogene end den genererede 800-population, så udbruds-bonussen afgør langt flere løb. Rapport-only, men vigtig kontekst for #1021-refit — og for hvorfor favorit-win "kun" er ~54 % i harnesset: udbruddene stjæler en del sejre i én-dags-linsen.
2. **Fidelity-gab på samme-hold-metrikken:** prod-evidensen målte 25 % løb med 4+ samme hold; harnesset måler ~5 %. Hypotese: harnesset stiller ALTID hele puljen (24 hold) — prods værste løb havde tynde felter (få tilmeldte hold → få distinkte hold i top 10) samt GC-akkumulering over etapeløb. Målbåndet ≤5 % er derfor tæt på opfyldt i fuld-pulje-linsen, men bindende metrikker for S1 er **hjælper-placeringstab + kaptajn-delta**; share4Plus skal genmåles på tynde felter/GT-GC hvis S1 ikke flytter prod-observationen.
3. **GT-observation (final-GC):** maxSameTeamTop10=2, distinkte=9, favorit (overall-proxy) vandt ikke — én GT pr. kørsel er anekdotisk; GC-linsen udbygges ved behov i S1.

## Kalibrerings-protokol fremadrettet (jf. spec §12)

Pr. slice: 3 seeds (2026/7/42) × neutral/condition=snapshot/roles × `--population=scripts/baselines/population-snapshot-2026-07-11.json`; alle EKSISTERENDE bånd (race:gate på genereret population) skal forblive grønne samtidig med at v3-båndene rammes. `--enforce-dominance` aktiveres som gate i S1+.

**Reproduktion:**
```
cd backend
node scripts/exportPopulationSnapshot.js                       # frisk snapshot (valgfrit)
node scripts/simulateSeasonDryRun.js --population=scripts/baselines/population-snapshot-2026-07-11.json --no-html --seed=2026 [--roles|--condition=snapshot]
```
