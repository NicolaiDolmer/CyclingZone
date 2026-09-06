# Hale-spredning i race engine v4 — mekanisme-fund (#4885)

Målt 7/9 på `origin/main` + PR #4892 (M7-wiring), S3-kalenderen (141 etaper), 3 seeds
(s1/s2/s3), felt 180, `backend/scripts/v4TailSpread.js`. Motoren er flag-OFF i prod.

## 1. Issuets tal er forældet — maks-halen er uheldsdrevet, ikke fysiologisk

Issuet skrev "maks-spredning bjerg 6 %, fladt 1,6 %". Efter M10's uheldstrappe (#4882)
er maks nu 20-27 %. Det er **ikke** et tegn på at halen er kommet: det er ét styrt.

| etapetype | p50 | p90 | p99 | maks | maks UDEN uheldsramte |
|---|---|---|---|---|---|
| flat | 0,19 % | 0,19 % | 0,28 % | 23,88 % | 1,34 % |
| rolling | 0,43 % | 0,46 % | 0,98 % | 26,87 % | 4,04 % |
| hilly | 1,54 % | 1,74 % | 2,89 % | 23,43 % | 5,37 % |
| mountain | 2,62 % | 2,71 % | 3,35 % | 24,78 % | 6,10 % |
| high_mountain | 2,52 % | 2,52 % | 3,32 % | 20,58 % | 6,01 % |
| cobbles | 1,39 % | 1,74 % | 2,69 % | 27,61 % | 3,29 % |

Fjerner man de uheldsramte, kollapser maks fra ~25 % til 3-6 %. **Den fysiologiske hale
er 2,5-2,7 % på bjerg** mod virkelighedens 8-15 %. Issuets diagnose holder; kun tallet
var blevet ulæseligt.

Andel af feltet inden for 10 % af vinderen: **100,0 % på hver eneste etapetype.**

## 2. Tidsgrænsen (M15) er inert fordi halen ikke findes

423 etapekørsler: **0 OTL på 351 vej-etaper med bjerg/kuperet/brosten-profil.** De eneste
3 OTL-tilfælde er flade etaper, og de er uheldsdrevne (den 5 %-grænse skal netop fange en
havareret rytter). Grupetto-redningen er aldrig udløst — der har aldrig været nogen at
redde. Grænsen for `mountain` er 15 %, for `high_mountain` 20 %; feltets p99 er 3,3 %.
Reglen er ikke forkert kalibreret, den har intet at måle på.

## 3. Mekanismen: motorens fart-model har ~4 % dynamisk spænd i styrke — og gruppestørrelse spiser det

### 3a. Loftet
`segmentLoop.computeSegmentSpeedKmh` (backend/lib/engine/v4/segmentLoop.ts:187):

```
multiplier = clamp(1 + terrain.strengthSpeedGain * (collectiveCp - terrain.baseDemand[kind]), 0.7, 1.3)
```

`strengthSpeedGain` er 0,12. Feltets `deriveCp` på climb spænder 0,010-0,374 (målt på det
faktiske 180-rytters felt). Den stærkest og den svagest tænkelige gruppe adskiller sig
derfor med `0,12 x 0,364 = 4,4 %` i fart. **Det er et hårdt loft på halen**, uafhængigt af
selektion, distance-slid og alt andet. Clampen [0,7; 1,3] binder aldrig — det gør
`strengthSpeedGain` gange CP-spændet.

Kontrol: slås gruppe-læ-gevinsten helt fra (`GROUP_DRAFT_EXTRA_TUNING.maxSpeedGain = 0`)
lander bjerg-p90 på 3,95 % og high_mountain på 3,68 % — altså præcis op mod det loft, og
stadig under det halve af virkeligheden.

### 3b. Halen bliver hentet ind igen, fordi den er STOR
`segmentLoop.groupDraftSpeedGain` (samme fil, linje 179) giver op til
`maxSpeedGain x (1 - draftFactor[kind])`: **+5,4 % på flat, +4,8 % på rolling, +3,0 % på
descent** — udelukkende for at være mange. Det er større end hele styrke-spændet.

Målt segment for segment på high_mountain-etape 15 (s1), front- mod bagerste gruppe:

| km | terræn | front (n, kollektiv CP) | hale (n, kollektiv CP) | fart-delta |
|---|---|---|---|---|
| 63 | rolling | 8 · 0,198 | 172 · 0,192 | **−2,23 %** (halen er HURTIGST) |
| 68 | climb | 6 · 0,247 | 130 · 0,063 | +1,71 % |
| 71 | descent | 5 · 0,223 | 130 · 0,050 | +0,33 % |
| 144 | rolling | 32 · 0,275 | 1 · 0,008 | +7,11 % |
| 175 | descent | 1 · 0,372 | 1 · 0,008 | +4,33 % |

Gruppe-gabene bekræfter det direkte. Den store bagerste gruppe (115 ryttere) på samme
etape: **km 144 → 164 (20 km stigning): gab 339 s → 593 s. km 164 → 175 (11 km nedkørsel):
593 s → 307 s.** Den henter 286 sekunder tilbage på én nedkørsel. Etapens samlede hale
ender på 2,06 %, selvom stigningerne havde produceret næsten det tredobbelte.

Læ-gevinsten kom ind med #4604 for at stoppe at ethvert solo-udbrud voksede monotont —
den intention er rigtig. Fejlen er kalibreringen: **størrelse slår styrke**, så en
nedslidt grupetto på 130 kører fra en frisk frontgruppe på 8.

### 3c. Der er ingen udmattelse i tærsklen
`segmentLoop.riderCpForSegment` (linje 112-145) er
`deriveCp x distance-slid x team_cp_factor x vejr + dayform`. **W' indgår ikke.** En
rytter med fuldstændig tom anaerob reserve kører på præcis samme bæredygtige tærskel som
en frisk rytter; den tomme reserve koster ham kun retten til at blive hægtet af i M2's
selektion (`climbSelection.energyDeficit01`). Der er derfor ingen mekanisme der gør en
kørt-i-sænk gruppe *langsommere* — kun mindre.

Det er det led issuet gættede på ("W'-model uden udmattelse over etapen"), og det er den
eneste af de tre kandidater der rammer BAGENDEN uden at røre fronten: fronten ligger under
CP i normaltilstanden (jf. tuning.ts's M16-note), så dens reserve er fuld hele vejen, mens
de afhægtede tømmer deres.

### 3d. Hvad der IKKE er mekanismen
- **M7 (distance-slid)** er koblet korrekt (PR #4892) og virker, men den rammer hele feltet
  proportionalt og flytter derfor ikke fronten væk fra halen.
- **Gruppe-tids-princippet** (`groups.applyGroupTimes`) er ikke problemet i sig selv:
  bjergetaper har median 21 målgrupper. Feltet ER splittet — grupperne ligger bare 3 %
  fra hinanden i stedet for 12 %.
- **`finale.ts`/`groups.ts` låser ikke grupperne.** Splittene sker (13 `peloton_splits` på
  prøve-etapen, årsager: 2 wprime_depleted, 9 mixed, 2 climb_deficit).

## 4. Konsekvens for de tre ankre
Feltet mangler samtidigt **samlet felt** (felt-sammenhæng på fladt, #4707) og **lang hale**
(dette issue). De to er ikke i modstrid: på fladt splitter feltet i mange små grupper der
ligger 0,2 % fra hinanden, på bjerg splitter det i 21 grupper der ligger 2,7 % fra
hinanden. Motoren producerer i begge tilfælde *mange, tætte* grupper. Det er samme
rod-årsag: fart-modellen kan ikke skelne en stærk gruppe fra en svag.

## 5. Målekommandoer

```
node backend/scripts/v4TailSpread.js \
  --population=backend/scripts/baselines/population-snapshot-2026-07-11.json \
  --stages=<season-3-stages.json> --seeds=s1,s2,s3 --field-size=180
```

Diagnose-tabellen ("Hale-diagnose pr. etapetype") og M15-tabellen er tilføjet i denne PR;
`--distance-experiment`, `--endurance-experiment` og `--weather-experiment` er uændrede
fra PR #4892.
