# Board-satisfaction-scorecard — dry-run af løbende bestyrelses-tilfredshed (#1187-B)

> Genereret 2026-06-14 af `node backend/scripts/boardSatisfactionHarness.js --seed 1187 --weekends 5` · Refs #1187, #805, #1147 · simulér-før-ship (ejer-accepteret 7/6)
> Population: 22 aktive human-hold · 66 aktive planer (1yr/3yr/5yr) · fixture hentet 2026-06-11T05:13:41.788Z (READ-ONLY, sæson 2)
> Mekanik: `lib/boardWeekendUpdate.js` — target-tracking mod `evaluateBoardSeason` (genbrug 1:1), clamp ±5/weekend, modifier live via `satisfactionToModifier`, hårde lag kun ved checkpoints (mid + slut).
> **#1267 · `--regen-goals`:** mål er REGENERERET fra `generateBoardGoals` (relaunch-mål-kalibrering), IKKE de gemte prod-mål. Gate'r de mål relaunch faktisk ville sætte mod den realistiske trup-population (standing=null = friske hold).

## 0. Metode + antagelser

- **Sæson:** 5 løbsweekender. Pr. weekend pr. division: 6 etapesejre, 1 GC-sejr, 2 trøjer, 1 klassiker-podium (3 pladser); én monument-weekend midt i sæsonen.
- **Performance-fordeling:** arketyper svag 25 % / middel 50 % / stærk 25 % + gaussisk støj pr. weekend (seedet RNG, mulberry32). AI-fyld op til divisionens faktiske holdantal så `rank_in_division` er realistisk.
- **Samme timeline for alle clamp-varianter:** performance-trækkene genereres én gang pr. seed; ±3/±5/±10 evalueres på identiske sæsonforløb.
- **Plan-mål:** holdenes FAKTISKE `current_goals` fra prod (inkl. DNA-traditionsmål og forhandlede mål). Lån-status fra prod. Transfer-balance + U25-udviklings-baseline simuleres ikke → de mål får `awaiting_data` (score 0,6), præcis som live når data mangler.
- **Sponsor-bånd:** pro-rata udbetaling pr. weekend (sponsor_income/5) × den LIVE modifier efter weekendens opdatering, vs. dagens faste 1,0-baseline. Wiring-detaljen (om udbetaling reelt flyttes ind i sæsonen) afgøres ved live-wiring — båndet her viser den økonomiske effekt af beslutning 4.
- **Checkpoints:** hårde lag (2=salary cap <40, 3=signing-restriktion <30, 4=tvangssalg <15, 5=pullout <10) aflæses KUN ved mid-season (weekend 2) og sæson-slut (weekend 5). Blød genforhandlings-trigger (<50) uændret.
- **board_test_mode:** neutraliseres via `resolveWeekendEconomyModifier` (testet i unit-tests); prod-scenariet her kører med test-mode slået fra.

## 1. Scorecard (clamp ±5 — den låste beslutning)

| Gate | Mål | Målt | Status |
|---|---|---|:--:|
| Spredning (IQR, 1yr-slutsatisfaction) | ≥ 15 point | 18,3 point (p25 43,5 → p75 61,8) | ✅ PASS |
| Konsekvens-rate (hårde lag ved checkpoints) | ≤ ~10 % af hold | 18,2 % (4/22 hold) | ❌ FAIL |
| Ingen dødsspiral (tilbage over 50) | ≤ 3 gode weekender | 3 gode weekender (bund 35, slut 50) | ✅ PASS |
| Økonomisk bånd (sponsor vs 1,0-baseline) | ejer fastsætter grænse | p10 -4,0 % · p50 +0,0 % · p90 +8,0 % | 🟡 TIL-EJER |
| Determinisme (samme seed → samme rapport) | identisk output | to fulde kørsler byte-identiske | ✅ PASS |

Slut-satisfaction-fordeling (1yr-planer): min 25,0 · p10 32,8 · p25 43,5 · p50 52,0 · p75 61,8 · p90 65,9 · max 74,0. Alle planer (1+3+5yr): IQR 19,8, median 53,0.

**Vigtig kontekst til konsekvens-gaten:** dagens mekanik (ét uclamped sæson-slut-spring, ingen weekend-opdatering) giver på SAMME sæsonforløb en konsekvens-rate på 31,8 % (7/22 hold) med 1yr-slutspænd 18–74. Raten over 10 % skyldes altså den eksisterende sæson-evaluering mod populationens faktiske mål (typisk min_riders 22-24 mod reelle trupper på 8-17 + sponsor_growth uden vækst i sæsonen) — ikke weekend-mekanikken, som tværtimod blødgør landingen (gulv ved 50 − 5·5 = 25 efter en hel katastrofesæson, og INGEN hold når under 40 ved mid-checkpointet fra en 50-start).

Checkpoint-fordeling af hårde hits (clamp ±5): mid-season 0 hold · sæson-slut 4 hold.

## 2. Clamp-følsomhed (±3 / ±5 / ±10 — samme sæsonforløb)

| Clamp | IQR (1yr) | Spænd (min–max) | Konsekvens-rate | Hits mid/slut | Recovery (gode weekender) | Økonomi p10/p50/p90 |
|---|---|---|---|---|---|---|
| ±3 | 18,0 | 35–65 | 18,2 % | 0/4 | 3 | -2,7 % / +0,0 % / +4,0 % |
| ±5 **(valgt)** | 18,3 | 25–74 | 18,2 % | 0/4 | 3 | -4,0 % / +0,0 % / +8,0 % |
| ±10 | 18,3 | 18–74 | 40,9 % | 9/4 | 3 | -6,0 % / +0,0 % / +10,0 % |
| Dagens mekanik (uclamped sæson-slut) | 23,3 | 18–74 | 31,8 % | 0/7 | n/a (ingen mellem-trin) | 0 % (modifier låst hele sæsonen) |

Recovery-trajektorier (3 katastrofe- + 3 top-weekender, start 50):
- ±3: 50 → 47 → 44 → 41 → 44 → 47 → 50
- ±5: 50 → 45 → 40 → 35 → 40 → 45 → 50
- ±10: 50 → 40 → 30 → 20 → 30 → 40 → 50

## 3. Økonomisk afvigelse pr. hold (clamp ±5)

Sponsor-flow over sæsonen vs. fast 1,0-baseline. Negativt = bestyrelsen holder penge tilbage; positivt = bonus-territorie.

| Percentil | Afvigelse |
|---|--:|
| p10 | -4,0 % |
| p25 | -1,8 % |
| p50 | +0,0 % |
| p75 | +7,3 % |
| p90 | +8,0 % |

Teoretisk maks-bånd pr. modifier-trin: 0,80–1,20 → ±20 % hvis et hold lå i yderbåndet HELE sæsonen. Clampen gør yderbåndet uopnåeligt tidligt i sæsonen — derfor er de målte afvigelser smallere.

## 4. Per-hold-resultater (clamp ±5, 1yr-planen)

| Hold | Div | Arketype | Slutrank | Satisfaction-forløb (start 50) | Target | Modifier | Økonomi | Hårde lag ved checkpoints |
|---|--:|---|--:|---|--:|--:|--:|---|
| Hopplà Team | 1 | stærk | 2 | 50 → 55 → 60 → 65 → 70 → 74 | 74 | 1,10 | +8,0 % | — |
| Vega - Vitalcare - Dynatek | 1 | stærk | 1 | 50 → 55 → 60 → 65 → 70 → 70 | 70 | 1,10 | +8,0 % | — |
| Camp Cycling Team | 1 | middel | 11 | 50 → 51 → 56 → 61 → 66 → 66 | 66 | 1,10 | +7,3 % | — |
| Team UKYO | 1 | stærk | 5 | 50 → 55 → 60 → 65 → 65 → 65 | 65 | 1,10 | +8,0 % | — |
| Above & Beyond Cancer Cycling | 1 | stærk | 4 | 50 → 55 → 54 → 59 → 63 → 63 | 63 | 1,10 | +4,7 % | — |
| Ardennaise Pro Cycling Team | 2 | stærk | 1 | 50 → 55 → 60 → 62 → 62 → 62 | 62 | 1,10 | +8,0 % | — |
| Kemphanen Cycling Team | 2 | svag | 2 | 50 → 55 → 60 → 61 → 61 → 61 | 61 | 1,10 | +7,3 % | — |
| Team Visma \| Lease a Bike | 1 | stærk | 3 | 50 → 55 → 60 → 61 → 61 → 59 | 59 | 1,00 | +7,3 % | — |
| Red Bull - BORA-Hansgrohe | 1 | middel | 10 | 50 → 48 → 48 → 53 → 57 → 56 | 56 | 1,00 | +3,3 % | — |
| Solution Tech NIPPO Rali | 1 | svag | 24 | 50 → 45 → 40 → 45 → 50 → 55 | 55 | 1,00 | +0,0 % | — |
| Soudal Quick-Step | 1 | middel | 14 | 50 → 55 → 59 → 62 → 57 → 53 | 53 | 1,00 | +3,3 % | — |
| Team WolkerWessels | 1 | middel | 9 | 50 → 52 → 56 → 51 → 51 → 51 | 51 | 1,00 | +0,0 % | — |
| Modern Adventure Pro Cycling | 1 | middel | 6 | 50 → 45 → 40 → 44 → 49 → 49 | 49 | 1,00 | -1,3 % | — |
| Chris Machines | 1 | middel | 18 | 50 → 46 → 44 → 46 → 46 → 46 | 46 | 1,00 | +0,0 % | — |
| Bahrain Victorious | 1 | middel | 7 | 50 → 45 → 44 → 43 → 44 → 46 | 46 | 1,00 | -2,7 % | — |
| TestHoldet | 1 | svag | 25 | 50 → 45 → 40 → 35 → 40 → 45 | 53 | 1,00 | -2,0 % | — |
| Krapouchi Cycling Team | 1 | middel | 13 | 50 → 45 → 50 → 45 → 43 → 43 | 43 | 1,00 | +0,0 % | — |
| Decathlon CMA CGM Team | 1 | middel | 19 | 50 → 45 → 40 → 39 → 40 → 40 | 40 | 1,00 | -1,3 % | — |
| Swatt Team | 1 | middel | 17 | 50 → 45 → 40 → 40 → 40 → 40 | 40 | 1,00 | -4,0 % | slut: lag 2 (3yr, sat 36); slut: lag 2 (5yr, sat 37) |
| Equipo Kern Pharma | 1 | middel | 16 | 50 → 45 → 40 → 35 → 32 → 32 | 32 | 0,90 | -6,0 % | slut: lag 2+3 (5yr, sat 29); slut: lag 2+3 (3yr, sat 29); slut: lag 2 (1yr, sat 32) |
| Groupama-FDJ United | 1 | middel | 21 | 50 → 45 → 40 → 35 → 30 → 27 | 27 | 0,90 | -4,0 % | slut: lag 2+3 (1yr, sat 27); slut: lag 2+3 (3yr, sat 25) |
| Trululu La Guacamaya | 1 | svag | 26 | 50 → 45 → 40 → 35 → 30 → 25 | 18 | 0,90 | -6,0 % | slut: lag 2+3 (1yr, sat 25); slut: lag 2+3 (5yr, sat 25); slut: lag 2+3 (3yr, sat 25) |

Konsekvens-lag: 2=Salary cap · 3=Signing restriction · 4=Forced listing · 5=Sponsor pullout.

## 5. Anbefaling

**±5 ser rigtig ud.** Begrundelse mod alternativerne på identisk sæsonforløb:

- **±3** dæmper spredningen til IQR 18,0 (tæt på gate-grænsen 15) og gør tallet trægt — en hel sæson kan maksimalt flytte 15 point.
- **±5** giver sund spredning (IQR 18,3), INGEN hold under salary-cap-tærsklen ved mid-checkpointet fra en 50-start (en enkelt dårlig halvsæson kan ikke udløse hårde lag), recovery på 3 gode weekender og et moderat økonomisk bånd (p50 +0,0 %).
- **±10** genindfører chok-effekten: 9 hold rammer hårde lag allerede ved mid-season, og det økonomiske bånd vokser til p10 -6,0 %.

**Konsekvens-rate-gaten fejler — men det er IKKE weekend-mekanikkens skyld.** Dagens uclamped sæson-slut-mekanik giver præcis samme rate (31,8 %) på samme forløb. Driveren er den eksisterende sæson-evaluering mod populationens faktiske mål: min_riders-mål på 22-24 mod reelle trupper på 8-17 og sponsor_growth der pr. definition er 0 % midt i en sæson. Ingen clamp-værdi kan bringe raten under 10 % — det kræver en separat mål-kalibrerings-beslutning (fx pro-rate sponsor_growth/min_riders i in-season-evaluering, eller re-kalibrér targets ved relaunch-forhandlingerne 20/6).

**Observation til live-wiring:** næsten alle hold dipper de første 2-3 weekender, fordi sejrs-mål ser "behind" ud før resultaterne akkumulerer. Det er narrativt acceptabelt ("vis os noget"), men hvis det føles for hårdt player-facing, kan in-season-evalueringen pro-rate sæson-mål med andelen af afviklede weekender — separat beslutning, ikke en del af denne mekanik.

**Klar til live-wiring?** Mekanikken (modul + clamp ±5 + checkpoints + live modifier + test-mode-frys) er verificeret og deterministisk. Før wiring skal ejeren tage stilling til: (a) økonomisk bånd-grænse X (målt p10/p50/p90: -4,0 % / +0,0 % / +8,0 %), (b) om konsekvens-rate-driveren håndteres via mål-kalibrering nu eller efter relaunch.

