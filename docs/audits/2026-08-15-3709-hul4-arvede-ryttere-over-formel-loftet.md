# Hul 4: arvede ryttere over deres formel-loft

**#3709 · 2026-08-15 · EJER-GODKENDT 15/8 (A + B + C)**

Specens §4 lister dette som blokerende: `buildCapsForRider` returnerer
`max(tapered, current)`, så for en rytter hvis nuværende evne ligger over
formel-loftet er `cap === current`, og forholdet "andel af taget nået" er **1,00
per konstruktion**. Beslutning 6 — *ryttere skal holde op med at nå deres lofter*
— gælder ikke for dem uden en særskilt regel.

Snapshottet har fx en rytter med `tactics: 61` mod et formel-loft på 24.

## Målt

Mod `docs/snapshots/3591/riders_full.json` (13/8, 8.717 ryttere, 130.755
evne-pladser). "Over formel-loftet" = rytterens nuværende evne ligger over det
tapered absolutte loft, altså det tilfælde hvor gulvet vinder.

| | evne-pladser over loftet | ryttere med mindst én | med alle 15 |
|---|---:|---:|---:|
| **Før (origin/main)** | 20.420 (15,6 %) | 7.393 | 115 |
| **Efter (trin 3+4)** | **10.126 (7,7 %)** | **4.843** | **66** |

**Trin 4 halverer hullet af sig selv.** Det er ikke en sideeffekt der skal
forklares — det er en direkte følge af at alle fem tag stiger (1,00→1,30 ·
0,82→1,10 · 0,45→0,95/0,70 · 0,12→0,20). Færre ryttere kan ligge over et højere
loft.

## Hullet er to forskellige ting, og kun den ene er et hul

Fordelt på alder, efter trin 4:

| aldersbånd | ryttere | over-pladser | pr. rytter |
|---|---:|---:|---:|
| 16-21 | 2.515 | 1.472 | **0,59** |
| 22-27 | 2.593 | 1.480 | **0,57** |
| 28-30 | 1.739 | 1.775 | 1,02 |
| **31+** | 1.870 | 5.399 | **2,89** |

**53 % af alle over-pladser sidder hos ryttere over 30.** For dem er `cap ===
current` **designet**, ikke en defekt: `taperedAbsoluteCap` (#2472, ejer-valg B
16/7) aftrapper med vilje det absolutte loft efter peak-alderen, netop så gulvet
vinder, gappet bliver 0, væksten stopper og sæson-declinen dominerer alene. Uden
den taper genåbnede #2472's konsolidering væksten for post-peak-ryttere.

En post-peak rytter *når* ikke sit loft. Han **falder fra** det. Beslutning 6
handler om vækst og siger intet om ham.

Det ægte hul er derfor kun ryttere i **vækstalder (16-27)**: 2.952 evne-pladser
fordelt på 5.108 ryttere — i snit 0,58 evne pr. rytter, altså under én af femten.

## Reglen — anbefaling

**A. Gulvet bevares uændret. Ingen rytter får frataget evne han ejer.**

Gulvet er ikke en bekvemmelighed, det er hele grundlaget for konsolideringen
2026-07-15: uden det ville "en voksen med høj current få et loft under sin
current", og det var netop indvendingen der havde holdt to uforenelige
loft-semantikker i live side om side. At fjerne det for at redde en metrik ville
genåbne #2472 og #3591 og tage evne fra spillere. Prisen — 0,58 evne pr. rytter i
vækstalder — er ikke i nærheden af værd at betale.

**B. Måle-reglen: en evne hvor gulvet vinder tælles ikke med i "andel af taget
nået".** Den har ikke et tag rytteren kan nærme sig; den har et *frosset* tal.
At tælle den som 1,00 gør ikke metrikken forkert på en interessant måde — den
gør den bare mindre skarp. Det er en rettelse i målingen, ikke i modellen.

**C. Sprogligt: sådan en evne er "færdig", ikke "på loftet".** Trin 1's flade
siger allerede *færdig* på låste evner. Det ord er sandt for begge tilfælde og
behøver ikke ændres.

### Hvad reglen IKKE er

Den model der ville "løse" hullet rigtigt er at aftrappe den arvede overskuds-evne
væk over tid, så rytteren konvergerer ned mod sit formel-loft. **Det tager evne
fra spillere** og hører under de indgreb der kræver at ejeren har set live-tilstand
først. Det anbefales ikke, og det er ikke bygget.

## Status: godkendt og implementeret

**Ejeren godkendte A + B + C den 15/8.** Hullet er dermed lukket.

Implementeret:

- **A** — gulvet er urørt. Der er ingen kodeændring, og det er pointen: reglen er
  at vi IKKE rører det.
- **B** — `scripts/rytterudviklingScorecard.js` udelader nu gulv-vundne evner af
  "andel af taget nået". Effekten på tallene: dagens model går fra 0,97 til 0,94,
  kandidaten fra 0,45 til 0,42. Begge bliver altså en anelse LAVERE, fordi de
  udeladte pladser talte som 1,00 og trak medianen op. Gate G3 består stadig.
- **C** — fladen siger allerede *færdig* på låste evner (leveret i trin 1). Ordet
  er sandt for begge tilfælde og er ikke ændret. Hjælpeteksten
  `dailytraining.ceilingReached` er skrevet om, så den forklarer de to tilfælde
  der er tilbage: rytteren er forbi sit højdepunkt, eller evnen ligger allerede
  over hvad hans type og potentiale ville bygge op af sig selv.
