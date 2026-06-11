# Board-satisfaction-scorecard — dry-run af løbende bestyrelses-tilfredshed (#1187-B)

> Genereret 2026-06-11 af `node backend/scripts/boardSatisfactionHarness.js --seed 1187 --weekends 5` · Refs #1187, #805, #1147 · simulér-før-ship (ejer-accepteret 7/6)
> Population: 22 aktive human-hold · 66 aktive planer (1yr/3yr/5yr) · fixture hentet 2026-06-11T05:13:41.788Z (READ-ONLY, sæson 2)
> Mekanik: `lib/boardWeekendUpdate.js` — target-tracking mod `evaluateBoardSeason` (genbrug 1:1), clamp ±5/weekend, modifier live via `satisfactionToModifier`, hårde lag kun ved checkpoints (mid + slut).

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
| Spredning (IQR, 1yr-slutsatisfaction) | ≥ 15 point | 27,8 point (p25 25,8 → p75 53,5) | ✅ PASS |
| Konsekvens-rate (hårde lag ved checkpoints) | ≤ ~10 % af hold | 50,0 % (11/22 hold) | ❌ FAIL |
| Ingen dødsspiral (tilbage over 50) | ≤ 3 gode weekender | 3 gode weekender (bund 35, slut 50) | ✅ PASS |
| Økonomisk bånd (sponsor vs 1,0-baseline) | ejer fastsætter grænse | p10 -6,0 % · p50 -1,7 % · p90 +5,9 % | 🟡 TIL-EJER |
| Determinisme (samme seed → samme rapport) | identisk output | to fulde kørsler byte-identiske | ✅ PASS |

Slut-satisfaction-fordeling (1yr-planer): min 25,0 · p10 25,0 · p25 25,8 · p50 42,5 · p75 53,5 · p90 62,0 · max 72,0. Alle planer (1+3+5yr): IQR 32,3, median 45,0.

**Vigtig kontekst til konsekvens-gaten:** dagens mekanik (ét uclamped sæson-slut-spring, ingen weekend-opdatering) giver på SAMME sæsonforløb en konsekvens-rate på 50,0 % (11/22 hold) med 1yr-slutspænd 16–72. Raten over 10 % skyldes altså den eksisterende sæson-evaluering mod populationens faktiske mål (typisk min_riders 22-24 mod reelle trupper på 8-17 + sponsor_growth uden vækst i sæsonen) — ikke weekend-mekanikken, som tværtimod blødgør landingen (gulv ved 50 − 5·5 = 25 efter en hel katastrofesæson, og INGEN hold når under 40 ved mid-checkpointet fra en 50-start).

Checkpoint-fordeling af hårde hits (clamp ±5): mid-season 0 hold · sæson-slut 11 hold.

## 2. Clamp-følsomhed (±3 / ±5 / ±10 — samme sæsonforløb)

| Clamp | IQR (1yr) | Spænd (min–max) | Konsekvens-rate | Hits mid/slut | Recovery (gode weekender) | Økonomi p10/p50/p90 |
|---|---|---|---|---|---|---|
| ±3 | 18,0 | 35–65 | 50,0 % | 0/11 | 3 | -4,0 % / -0,7 % / +2,7 % |
| ±5 **(valgt)** | 27,8 | 25–72 | 50,0 % | 0/11 | 3 | -6,0 % / -1,7 % / +5,9 % |
| ±10 | 33,0 | 16–72 | 68,2 % | 15/11 | 3 | -11,6 % / -4,0 % / +7,8 % |
| Dagens mekanik (uclamped sæson-slut) | 36,8 | 16–72 | 50,0 % | 0/11 | n/a (ingen mellem-trin) | 0 % (modifier låst hele sæsonen) |

Recovery-trajektorier (3 katastrofe- + 3 top-weekender, start 50):
- ±3: 50 → 47 → 44 → 41 → 44 → 47 → 50
- ±5: 50 → 45 → 40 → 35 → 40 → 45 → 50
- ±10: 50 → 40 → 30 → 20 → 30 → 40 → 50

## 3. Økonomisk afvigelse pr. hold (clamp ±5)

Sponsor-flow over sæsonen vs. fast 1,0-baseline. Negativt = bestyrelsen holder penge tilbage; positivt = bonus-territorie.

| Percentil | Afvigelse |
|---|--:|
| p10 | -6,0 % |
| p25 | -6,0 % |
| p50 | -1,7 % |
| p75 | +0,5 % |
| p90 | +5,9 % |

Teoretisk maks-bånd pr. modifier-trin: 0,80–1,20 → ±20 % hvis et hold lå i yderbåndet HELE sæsonen. Clampen gør yderbåndet uopnåeligt tidligt i sæsonen — derfor er de målte afvigelser smallere.

## 4. Per-hold-resultater (clamp ±5, 1yr-planen)

| Hold | Div | Arketype | Slutrank | Satisfaction-forløb (start 50) | Target | Modifier | Økonomi | Hårde lag ved checkpoints |
|---|--:|---|--:|---|--:|--:|--:|---|
| Hopplà Team | 1 | stærk | 2 | 50 → 55 → 60 → 65 → 70 → 72 | 72 | 1,10 | +7,3 % | — |
| Camp Cycling Team | 1 | middel | 11 | 50 → 47 → 52 → 57 → 62 → 63 | 63 | 1,10 | +6,0 % | — |
| Red Bull - BORA-Hansgrohe | 1 | middel | 10 | 50 → 45 → 49 → 54 → 59 → 62 | 62 | 1,10 | +2,0 % | — |
| Ardennaise Pro Cycling Team | 2 | stærk | 1 | 50 → 55 → 60 → 62 → 62 → 62 | 62 | 1,10 | +8,0 % | — |
| Kemphanen Cycling Team | 2 | svag | 2 | 50 → 45 → 50 → 55 → 56 → 61 | 61 | 1,10 | +5,3 % | — |
| Soudal Quick-Step | 1 | middel | 14 | 50 → 45 → 50 → 55 → 55 → 55 | 55 | 1,00 | -0,7 % | slut: lag 2 (5yr, sat 38) |
| Above & Beyond Cancer Cycling | 1 | stærk | 4 | 50 → 45 → 40 → 39 → 44 → 49 | 67 | 1,00 | -1,3 % | — |
| Vega - Vitalcare - Dynatek | 1 | stærk | 1 | 50 → 45 → 43 → 43 → 43 → 48 | 70 | 1,00 | +0,0 % | — |
| Solution Tech NIPPO Rali | 1 | svag | 24 | 50 → 45 → 40 → 45 → 47 → 47 | 47 | 1,00 | +0,0 % | — |
| TestHoldet | 1 | svag | 25 | 50 → 45 → 40 → 35 → 40 → 45 | 53 | 1,00 | -2,0 % | — |
| Team Visma \| Lease a Bike | 1 | stærk | 3 | 50 → 45 → 40 → 44 → 44 → 43 | 43 | 1,00 | +0,0 % | — |
| Team UKYO | 1 | stærk | 5 | 50 → 45 → 43 → 42 → 42 → 42 | 42 | 1,00 | +0,7 % | — |
| Chris Machines | 1 | middel | 18 | 50 → 45 → 40 → 35 → 34 → 34 | 34 | 0,90 | -6,0 % | slut: lag 2 (5yr, sat 36); slut: lag 2 (1yr, sat 34); slut: lag 2 (3yr, sat 36) |
| Decathlon CMA CGM Team | 1 | middel | 19 | 50 → 45 → 40 → 35 → 33 → 33 | 33 | 0,90 | -6,0 % | slut: lag 2 (5yr, sat 35); slut: lag 2 (3yr, sat 34); slut: lag 2 (1yr, sat 33) |
| Team WolkerWessels | 1 | middel | 9 | 50 → 45 → 40 → 35 → 30 → 29 | 29 | 0,90 | -6,0 % | slut: lag 2 (3yr, sat 31); slut: lag 2+3 (1yr, sat 29); slut: lag 2 (5yr, sat 34) |
| Krapouchi Cycling Team | 1 | middel | 13 | 50 → 45 → 40 → 35 → 30 → 28 | 28 | 0,90 | -6,0 % | slut: lag 2 (5yr, sat 30); slut: lag 2 (3yr, sat 30); slut: lag 2+3 (1yr, sat 28) |
| Trululu La Guacamaya | 1 | svag | 26 | 50 → 45 → 40 → 35 → 30 → 25 | 16 | 0,90 | -6,0 % | slut: lag 2+3 (1yr, sat 25); slut: lag 2+3 (5yr, sat 25); slut: lag 2+3 (3yr, sat 25) |
| Bahrain Victorious | 1 | middel | 7 | 50 → 45 → 40 → 35 → 30 → 25 | 18 | 0,90 | -6,0 % | slut: lag 2+3 (5yr, sat 25); slut: lag 2+3 (1yr, sat 25); slut: lag 2+3 (3yr, sat 25) |
| Equipo Kern Pharma | 1 | middel | 16 | 50 → 45 → 40 → 35 → 30 → 25 | 16 | 0,90 | -6,0 % | slut: lag 2+3 (5yr, sat 25); slut: lag 2+3 (3yr, sat 25); slut: lag 2+3 (1yr, sat 25) |
| Swatt Team | 1 | middel | 17 | 50 → 45 → 40 → 35 → 30 → 25 | 24 | 0,90 | -6,0 % | slut: lag 2+3 (3yr, sat 25); slut: lag 2+3 (5yr, sat 25); slut: lag 2+3 (1yr, sat 25) |
| Modern Adventure Pro Cycling | 1 | middel | 6 | 50 → 45 → 40 → 35 → 30 → 25 | 20 | 0,90 | -6,0 % | slut: lag 2+3 (3yr, sat 25); slut: lag 2+3 (5yr, sat 25); slut: lag 2+3 (1yr, sat 25) |
| Groupama-FDJ United | 1 | middel | 21 | 50 → 45 → 40 → 35 → 30 → 25 | 17 | 0,90 | -2,7 % | slut: lag 2+3 (1yr, sat 25); slut: lag 2+3 (3yr, sat 25) |

Konsekvens-lag: 2=Salary cap · 3=Signing restriction · 4=Forced listing · 5=Sponsor pullout.

## 5. Anbefaling

**±5 ser rigtig ud.** Begrundelse mod alternativerne på identisk sæsonforløb:

- **±3** dæmper spredningen til IQR 18,0 (tæt på gate-grænsen 15) og gør tallet trægt — en hel sæson kan maksimalt flytte 15 point.
- **±5** giver sund spredning (IQR 27,8), INGEN hold under salary-cap-tærsklen ved mid-checkpointet fra en 50-start (en enkelt dårlig halvsæson kan ikke udløse hårde lag), recovery på 3 gode weekender og et moderat økonomisk bånd (p50 -1,7 %).
- **±10** genindfører chok-effekten: 15 hold rammer hårde lag allerede ved mid-season, og det økonomiske bånd vokser til p10 -11,6 %.

**Konsekvens-rate-gaten fejler — men det er IKKE weekend-mekanikkens skyld.** Dagens uclamped sæson-slut-mekanik giver præcis samme rate (50,0 %) på samme forløb. Driveren er den eksisterende sæson-evaluering mod populationens faktiske mål: min_riders-mål på 22-24 mod reelle trupper på 8-17 og sponsor_growth der pr. definition er 0 % midt i en sæson. Ingen clamp-værdi kan bringe raten under 10 % — det kræver en separat mål-kalibrerings-beslutning (fx pro-rate sponsor_growth/min_riders i in-season-evaluering, eller re-kalibrér targets ved relaunch-forhandlingerne 20/6).

**Observation til live-wiring:** næsten alle hold dipper de første 2-3 weekender, fordi sejrs-mål ser "behind" ud før resultaterne akkumulerer. Det er narrativt acceptabelt ("vis os noget"), men hvis det føles for hårdt player-facing, kan in-season-evalueringen pro-rate sæson-mål med andelen af afviklede weekender — separat beslutning, ikke en del af denne mekanik.

**Klar til live-wiring?** Mekanikken (modul + clamp ±5 + checkpoints + live modifier + test-mode-frys) er verificeret og deterministisk. Før wiring skal ejeren tage stilling til: (a) økonomisk bånd-grænse X (målt p10/p50/p90: -6,0 % / -1,7 % / +5,9 %), (b) om konsekvens-rate-driveren håndteres via mål-kalibrering nu eller efter relaunch.

