# CLAUDE IMPLEMENTATION PLAN — BOARD SYSTEM V1

_Formål: Gøre implementeringen sikker, trinvis og lav-risiko._

---

## Fase 1 — Datamodel

### Mål
Indfør de nye board-tabeller og udvid eksisterende board-profiler.

### Leverancer
- migration for `board_objectives`
- migration for `board_history`
- nye felter i `board_profiles`:
  - `ambition_level`
  - `risk_level`
  - `identity_focus`
- evt. ekstra felter til specialization og request-state, hvis nødvendigt

### Vigtigt
- genbrug eksisterende tabeller hvor muligt
- bryd ikke eksisterende board-side

---

## Fase 2 — Engine-lag

### Ny fil
- `boardEngine.js`

### Funktioner
- `generateObjectives(teamContext)`
- `evaluateObjectives(teamContext, seasonContext)`
- `calculateBoardScores(evaluationContext)`
- `calculateSatisfaction(scores, history)`
- `buildBoardFeedback(scores, context)`
- `updateBoardAfterSeason(teamId, seasonId)`

### Designprincipper
- gradvis evaluering
- vægtet score
- overperformance bonus
- momentum
- 2–3 sæsoners hukommelse

---

## Fase 3 — Objective generation

### Mål
Erstat hardcoded, focus-baseret mål-logik med dynamisk generation.

### Input
- division
- world ranking
- last season performance
- promotion/relegation state
- board personality
- specialization
- identity profile
- 1-year / 3-year / 5-year plan state

### Output
- 1–2 result objectives
- 1 economy objective
- 1 identity objective
- 1 ranking/progression objective

### Vigtigt
- undgå modstridende målpakker
- brug context multipliers

---

## Fase 4 — API og integration

### Opdater eksisterende board-routes
- `GET /api/board/status`
- `POST /api/board/sign`

### Tilføj nye board-routes hvis nødvendigt
Forslag:
- `POST /api/board/request`
- `GET /api/board/history`
- `GET /api/board/objectives`
- `GET /api/board/midseason-review`

### Vigtigt
- bevar eksisterende flow på board-siden
- feed bare bedre data ind

---

## Fase 5 — Season-end integration

### Kritisk
Integrer board-evaluering i faktisk season-end execution.

### Implementer eller udvid
- `POST /api/admin/execute-season-end`

### Skal gøre
1. finansielle opdateringer
2. board evaluation
3. satisfaction update
4. `board_history` insert
5. generate next season objectives
6. update sponsor/base funding and tolerance

### Relevante filer
- `economyEngine.js`
- `cron.js`
- admin-routes
- season flow utilities

---

## Fase 6 — UI integration

### Behold
- satisfaction bar
- sponsor multiplier
- board page wizard
- dashboard board summary

### Tilføj
- kort feedback-tekst
- tydeligere forklaring per kategori
- nye objective cards hvis nødvendigt

### Undgå
- total redesign af UI

---

## Fase 7 — Board requests

### V1 request types
- lower requirement in one area
- more youth focus
- more result focus now
- slightly adjust identity requirement

### Outcomes
- approved
- partially approved
- rejected
- approved with tradeoff

### Tradeoff-eksempler
- mere resultfokus → højere pres næste sæson
- mindre identitetskrav → strammere økonomimål
- mere ungdomsfokus → lavere kortsigtede resultatkrav

---

## Fase 8 — Docs og oprydning

### Claude skal opdatere
- `NOW.md`
- `FEATURE_STATUS.md`
- `ARCHITECTURE.md`
- evt. `DOMAIN_REFERENCE.md`

### Slutkrav
Kør `npm run sync-docs`

---

## Anbefalet implementeringsrækkefølge

1. datamodel
2. board engine
3. objective generation
4. read-side API (`GET /api/board/status`)
5. season-end integration
6. request system
7. UI wiring
8. docs update

---

## Acceptance criteria

### Minimum
- mål genereres dynamisk
- satisfaction opdateres ved season-end
- sponsor/base funding påvirkes af ny board evaluation
- 2–3 sæsoners history gemmes
- dashboard viser ny feedback
- board page bruger de nye data

### Kvalitet
- ingen brud på eksisterende board flow
- ingen modstridende målpakker
- kode er modulær og læsbar
- docs er opdateret
