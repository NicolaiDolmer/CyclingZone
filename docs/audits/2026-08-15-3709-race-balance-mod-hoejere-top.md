# Race-balancen målt om mod en højere top

**#3709 trin 4 · 2026-08-15 · blokerende måling, nu kørt**

Specen kræver den som følge af beslutning 14: spidsen går fra 36 til 44 ved bedste
spil (målt her: 38 → 45), mens race-balancen er kalibreret mod 36. Frygten var at
en højere top ville forværre dominansen.

**Resultatet er det modsatte. Kandidaten forbedrer race-balancen på hvert eneste
dominans-mål, og på alle tre seeds.**

## Først en rettelse af præmissen

Session-prompten skriver: *"Stående balance-punkt #2731 siger allerede at
`maxRiderWinRate` er 0,67-0,75 mod et mål på 0,45."*

**#2731 er lukket som løst 3/8.** Den rå værdi på 0,67-0,75 viste sig at være et
voldsomt oppustet punktestimat af en ægte, men langt mindre effekt (split-half
r = 0,253; Monte Carlo-forventet max 0,321 mod observeret 0,71). Med
Wilson-lower-bound-estimatoren måler den samme dag **0,359 og grøn**. Der blev
bevidst ikke lavet nogen motor-kalibrering. Se
`docs/audits/2026-08-03-race-balance-2731.md`.

Præmissen om at balancen allerede stod og bankede på døren er altså forældet.

## Metoden

To population-snapshots bygget af `scripts/byggRacePopulationer3709.mjs`:

- **Samme friske kuld** (1.200 ryttere gennem produktionens egen intake-sti, seed 2026)
- modnet fra 16 til 30 år gennem `applyDailyTick` — én gang med dagens motor
  (inkl. akademiets `HARD_DAILY_CAP` + `INTERIM_RATE_MULT`), én gang med kandidaten
- **samme hold-inddeling, samme form/fatigue, samme strategi pr. rytter** i begge

Forskellen mellem de to populationer er derfor præcis modellen og intet andet.

**Feltet er blandet med vilje:** 25 % spids · 25 % rotation · 35 % standard ·
15 % forkert. Under dagens model er det næsten ligegyldigt (agens-spænd 1 point),
men under kandidaten spreder feltet sig (spænd 7), og det er netop **spredningen**
der kunne vælte dominans-båndene. Et felt hvor alle spilles optimalt ville måle
den mildeste version af risikoen.

Kørt gennem `scripts/simulateSeasonDryRun.js --population=… --condition=snapshot
--roles`, sektion F (dominans/varians-scorecard, #2224).

## Feltets top

| | median bedste evne | højeste evne i feltet |
|---|---:|---:|
| i dag | 35 | 87 |
| kandidat | 37 | **96** |

Toppen stiger altså med 9 point. Præmissen for bekymringen er bekræftet — det er
konklusionen der ikke holder.

## Resultat (seed 2026)

| metrik | i dag | kandidat | bånd |
|---|---:|---:|---|
| favoriteWinRate | 81,3 % ✗ | **78,5 %** ✗ | [25 %, 40 %] |
| **maxSeasonWinRate** | **50,8 % ✗** | **43,3 % ✓** | [−, 45 %] |
| favoritePodiumRate | 97,3 % ✗ | **95,6 %** ✗ | [55 %, 75 %] |
| ittFavoriteWinRate | 95,0 % ✗ | **77,3 %** ✗ | [45 %, 65 %] |
| avgDistinctTeamsTop10 | 9,5 ✓ | 9,1 ✓ | [7,5, −] |
| share4PlusSameTeamTop10 | 0,0 % ✓ | 0,1 % ✓ | [−, 5 %] |
| **bånd udenfor i alt** | **6** | **5** | |

Grand Tour, final-GC: under dagens model vandt favoritten. Under kandidaten gjorde
han **ikke** — og var heller ikke på podiet.

## Robust på alle tre seeds

| seed | `maxSeasonWinRate` i dag | kandidat | `ittFavoriteWinRate` i dag | kandidat |
|---|---:|---:|---:|---:|
| 2026 | 50,8 % ✗ | **43,3 % ✓** | 95,0 % | **77,3 %** |
| 7 | 51,5 % ✗ | **43,9 % ✓** | 96,0 % | **81,0 %** |
| 42 | 48,4 % ✗ | **41,9 % ✓** | 96,0 % | **74,3 %** |

`maxSeasonWinRate` — nøjagtig det mål #2731 handlede om — går fra **uden for båndet
til inden for båndet på alle tre seeds.** Antal bånd uden for går 6 → 5 hver gang.

## Hvorfor en højere top giver MINDRE dominans

Det virker bagvendt indtil man ser hvad der driver dominansen.

Under dagens model mætter hver evne sit loft inden for karrieren. Rytteren med det
højeste potentiale får derfor de højeste evner **på tværs af hele registret** — han
er bedst overalt, og han vinder overalt. `ittFavoriteWinRate` på 95-96 % er den
kvitteringen: den samme mand vinder også enkeltstarterne.

Under kandidaten når ingen sit loft, og hvor tæt man kommer afhænger af hvilke
evner manageren har valgt at dyrke. Den stærkeste rytter bliver en **specialist**:
meget stærkere på sit terræn (deraf toppen på 96), men mærkbart svagere uden for
det. Han vinder stadig sine egne løb — han vinder bare ikke alle andres.
`ittFavoriteWinRate` falder 15-22 point, fordi enkeltstarten nu tilhører en anden.

Det er nøjagtig den mekanisme ejer-reglen peger på: **styrke straffes ikke, balance
kommer fra struktur.** Den bedste rytter er blevet stærkere, ikke svagere — feltet
er bare holdt op med at bestå af én mand der er bedst til alt.

## Forbehold

- Båndene i sektion F er kalibreret mod den **genererede launch-population**, ikke
  mod dette syntetiske kuld. Derfor fejler begge populationer flere bånd, og de
  **absolutte** tal må ikke læses som en prod-vurdering. Det gyldige signal er
  **forskellen** mellem to populationer der kun adskiller sig ved modellen.
- `--v3` er ikke slået til (jour-sans og DNF er 0 %), samme fravalg som de øvrige
  race-harnesses bruger for at få et rent signal.
- `helperLossMedianGc` er 0,0 i begge — hjælperrolle-tabet måles ikke meningsfuldt
  på et syntetisk felt uden ægte holdtaktik. Uændret mellem de to, altså ikke et
  signal om kandidaten.

## Konklusion

Den blokerende måling er kørt, og den blokerer ikke. En højere top er ikke det
samme som mere dominans, og på det ene mål der havde et ægte problem
(`maxSeasonWinRate`) flytter kandidaten det ind i båndet.
