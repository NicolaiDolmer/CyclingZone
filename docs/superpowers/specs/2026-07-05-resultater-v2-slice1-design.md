# Resultater V2 — slice 1: samlet stilling undervejs (PCS-model)

**Dato:** 2026-07-05
**Issue:** [#2081](https://github.com/NicolaiDolmer/CyclingZone/issues/2081) (del af #959 V2)
**Status:** design godkendt (ejer 5/7) — afventer implementering

## Problem

Man kan ikke se den samlede stilling mens et etapeløb er i gang. Spillerne
regner selv (og fangede en GC-bug den vej). Discord-ønsker (#959/#2081): point/
bjergpoint pr. etape, holdfilter, top-10 + "se alle", nemmere at finde resultater.

## Verificeret nuværende tilstand (kode, 5/7)

- **Backend persisterer ALLEREDE fulde løbende klassementer pr. mellem-etape**
  (`raceRunner.js:244-255`): `leader` (løbende GC, alle ryttere m. gap), `points_day`,
  `mountain_day`, `young_day`. Ved slut-etape: `gc`/`points`/`mountain`/`young`/`team`.
  → Issue-tekstens "kun leader-rank-1 persisteres" er forældet.
- **Backend-gap:** hold-klassement persisteres KUN ved slut-etape (`team`, linje 265).
  Der er INGEN løbende hold-stilling pr. mellem-etape.
- **Frontend-gap** (`RaceDetailPage.jsx`): viser undervejs kun trøjebæreren (rank 1)
  pr. etape (linje 495) — ikke den fulde løbende stilling. Samlet GC-tabel vises
  først når løbet er færdigt (linje 410 falder tilbage til etaperesultater undervejs).

Konklusion: slice 1 er ~80% frontend + én lille backend-tilføjelse (løbende hold).

## Best-practice-reference (verificeret 5/7)

ProCyclingStats (sportens de-facto-standard) og feltet.dk bruger samme model:
en **etape-akse × klassement-akse**. Hver etape-side har faste klassement-tabs
— **Stage · GC · Points · KOM · Youth · Teams** — og samlet stilling er tilgængelig
**efter hver etape**, ikke kun ved slut. Trøjefarver universelle; tid vist som gap.
feltet.dk: `/resultater/samlet` + pr-etape, danske labels ("Hold" = teams).

## Design

### A. RaceDetailPage — resultat-flade (etape × klassement)

Inline på løbssiden (ikke gemt bag en separat top-fane) — brændpunktet er at se
stillingen undervejs, så den skal være synlig.

**Etape-selector (strip øverst):** etape 1..N. Kørte etaper klikbare; kommende
etaper dæmpede/låste (staged reveal). Profil-ikon pr. etape (flad/kuperet/bjerg/ITT).

**Klassement-tabs:** Stage · Overall · Points · Mountain · Youth · Teams. Trøjefarve-
prik på Overall/Points/Mountain/Youth (genbrug `--jersey-leader/points/mountain/young`).

**Kobling:** valgt etape × valgt klassement. "Overall efter etape 3" læses fra
`leader`-rækker for `stage_number=3`; "Stage 3 result" fra `stage`-rækker; slut-etape
bruger `gc`/`points/...`. Kontekst-label viser fx "Overall standings after stage 3".

**Default når løbet er i gang:** seneste kørte etapes `Stage`-resultat (A), med
`Overall` som fremtrædende nabo-tab (ét åbenlyst klik til samlet stilling).

**Discord-ønsker indbygget:**
- Holdfilter (dropdown): alle / mit hold / vælg hold. Egen rytter/hold fremhævet.
- Top-10 default + "Show all N riders"-knap.
- Point/bjergpoint pr. etape: `Pts`-kolonne i Stage-visning + Points/Mountain-tabs.

### B. Backend — løbende hold-klassement (lille tilføjelse)

I `raceRunner.js` mellem-etape-blokken (linje 244-255): tilføj et løbende hold-
klassement pr. mellem-etape, konsistent med de andre `_day`-typer. Ny `result_type`
`team_day` (rank + team_id + stage_number), afledt af `teamClassification(entrants,
cumTime)` — samme funktion som slut-etapens `team`. Uden dette har `Teams`-tabbet
ingen data undervejs. Ingen økonomi-effekt (kun display, points_earned=0).

### C. ResultaterPage — findbarhed (#3, zootnes ønske)

Mindre sidevogn på resultat-oversigten:
- Sortér færdige løb efter **afslutnings-tidspunkt** (nyeste først) i stedet for
  alfabetisk — så "hvad kørte jeg i dag" er øverst.
- Filter til **egen division/gruppe** (matcher #2182's dashboard-linje).

## Data / kontrakt

- Ingen nye tabeller. `team_day` er en ny `result_type`-værdi i `race_results`
  (samme skema som `points_day` m.fl.). Verificér at eventuelle enum-/CHECK-
  constraints på `result_type` tillader den nye værdi (jf. #1464 forward-guard) —
  ellers en lille migration.
- Frontend læser via de brede reads → SKAL bruge `fetchAllRows` (jf. #2206:
  1000-rækkers cap; et fuldt startfelt × etaper kan overstige 1000 rækker).

## Scope-afgrænsning (YAGNI)

**Ude af slice 1** (senere V2-dybde): per-rytter relative gap-klik, bonus-sekund-
visning, sprint/KOM pr. checkpoint, live-ticker, staged reveal-animation.

## Test / verifikation

- Frontend unit-tests for etape×klassement-udvælgelsen (leader vs gc afhængigt af
  om løbet er færdigt) + holdfilter + top-10/vis-alle.
- Backend: `team_day` skrives pr. mellem-etape (simulér-før-ship mod ægte løb).
- Ægte prod-DB-verifikation af rækkeantal (ikke kun mock) + authenticated preview.
