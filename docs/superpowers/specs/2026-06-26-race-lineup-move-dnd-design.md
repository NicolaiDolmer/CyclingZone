# Race-hub: atomisk "flyt rytter mellem løb" + drag-and-drop

> **Status:** Design godkendt (ejer, 2026-06-26). Følger efter holdudtagelses-overhaulen ([#1924](https://github.com/NicolaiDolmer/CyclingZone/pull/1924)). Implementeres som ny fokuseret PR.

## Problem

På trup-fordeling-boardet (`RaceHubBoard`) kan en manager ikke nemt flytte en rytter mellem to overlappende løb (samme dag). Konkret observeret: en rytter (Marcos Sánchez) er auto-udfyldt i Tour d'Anatolie (6/6 i DB). Manageren fjerner ham i kladden (boardet viser 4/6), men:

1. **Popoveren bruger den GEMTE binding, ikke kladden.** `AddRiderPopover` får `data.bindingMap` fra serveren ([`RaceHubBoard.jsx:231`](frontend/src/components/racehub/RaceHubBoard.jsx#L231)), så den binder stadig rytteren til kilde-løbet og udelukker mål-løbet — selvom manageren lige har fjernet ham i kladden.
2. **#1924's fuld-opstillings-regel forværrer det:** fjernelsen gør kilde-løbet underbemandet (4/6), som ikke auto-gemmes (kun fulde trupper gemmes), så server-bindingen opdateres aldrig.
3. **Selv en kladde-bevidst popover er ikke nok:** backend afviser at gemme mål-løbet med rytteren så længe kilde-løbets DB stadig binder ham (#1924's `selection_rider_bound`-409), og kilde-løbet kan ikke gemme underbemandet for at frigive ham. Et "flyt mellem to fulde overlappende løb" kræver derfor en **atomisk move-operation**, ikke to uafhængige per-løb-gem.

Drag-and-drop var planlagt som "senere progressive-enhancement-polish" i Fase 1-specen (`2026-06-24-race-hub-fase-1-trup-fordeling-design.md` §3 + §81). Move-problemet og D&D er det samme problem — D&D er den naturlige gestus for et flyt — så de bygges sammen.

## Mål

- Flyt en rytter mellem to overlappende løb pålideligt og intuitivt, uden 409-fælder.
- Drag-and-drop på desktop (mus) som primær gestus.
- Fuld paritet på mobil + tastatur via det eksisterende (forbedrede) klik/tap-flow.

## Ikke-mål (YAGNI)

- D&D på mobil-touch (ingen touch-bibliotek/dependency — desktop-pointer kun).
- Omrokering *inden i* et løb (rækkefølge har ingen motor-effekt; `race_role` styrer roller).
- Sæt-rolle-via-drag (fungerer via det nye chevron-rolle-klik fra #1919).

## Ejer-beslutninger (2026-06-26)

1. **Move-semantik:** når en rytter flyttes UD af et fuldt løb, bliver kilde-løbet **underbemandet** (vist som fx 4/6). Flytningen virker altid (atomisk). Manageren fylder hullet selv (manuelt eller "Auto-udfyld"). Forudsigeligt, manageren har kontrollen.
2. **D&D-rækkevidde:** desktop-pointer-forbedring; mobil + tastatur bruger det forbedrede klik/tap-flow.

## Design

### A. Backend — atomisk move

Ny endpoint: `POST /api/races/lineup/move` med body `{ riderId, toRaceId }`.

Ren logik udskilles i `backend/lib/raceLineupMove.js` (testbar uden DB), I/O i api.js-handleren:

1. **Find kilden:** rytterens nuværende entry i et løb der **tids-overlapper** `toRaceId` for dette hold (genbrug `raceBindingWindow` + `windowsOverlap` fra `raceBinding.js`). Ingen overlappende kilde → det er en ren *tilføj* (ikke et move).
2. **Validér målet:** `toRaceId` er `scheduled`, `stages_completed=0`, i holdets pulje (`teamInRacePool`), ikke afmeldt, og ville ikke overstige feltstørrelsen (`selectionSizeForRace(race).max`). Rytteren skal være berettiget (`isEligibleRider` — genbrug fra #1924, inkl. loan-aware).
3. **Atomisk mutation** (Postgres-RPC, så delete+insert er én transaktion — undgår #1924's "ingen transaktion i saveSelection"-degrade): slet rytterens entry i kilde-løbet, indsæt i mål-løbet med `race_role='helper'`, `is_auto_filled=false`. Kilde-løbet må gerne ende underbemandet (det er et bevidst move, ikke et dovent partial-save).
4. **Returnér** begge berørte løbs nye selection (så frontend kan re-synke uden fuld board-refetch, eller blot trigger `load(day)` som de øvrige mutationer).

Fejlkoder (snake_case, oversættes på frontend): `move_target_full`, `move_target_locked`, `move_wrong_pool`, `move_rider_not_owned`, `move_rider_ineligible`.

> **Migration:** den atomiske move kræver en lille Postgres-RPC (`database/2026-06-26-race-lineup-move.sql`). PR med `database/*.sql` → **ejer merger** (auto-applies i prod).

### B. Frontend — kladde-bevidst binding

I `RaceHubBoard`: udled `bindingMap` fra `effectiveColumns` (kladden) i stedet for `data.bindingMap`. Da boardets kolonner pr. konstruktion alle overlapper den valgte dag (#1823 dag-granulær binding), er en rytter "bundet væk" fra et løb hvis han er i et ANDET kolonne-løbs kladde-selection. Genbrug `buildBindingMap` (pure, `raceDistribution.js`) fodret med `effectiveColumns` (window + draft-riderIds), så popover + pulje afspejler live-redigeringer.

Move via klik: når manageren tilføjer en rytter til løb B via popoveren, og rytteren allerede er i et overlappende løb A, kalder boardet **move-endpointet** (ikke en ren add). Tilføj-fra-pulje (rytteren i intet løb) → eksisterende `PUT /selection`-add. Frontend afgør hvilken det er ud fra den kladde-bevidste binding.

### C. Drag-and-drop (desktop, native HTML5)

Native HTML5 Drag and Drop API (`draggable`, `onDragStart`/`onDragOver`/`onDrop`) — ingen ny dependency. Pure helpers i `frontend/src/lib/raceHubDnd.js` (drop-validitet, drag-payload) for node-test-dækning.

- **Draggable:** rytter-chips i puljen (`AvailableRidersPool`) + rytter-rækker i en kolonne (`RaceColumn`).
- **Drop-zoner:** løbs-kolonner (tilføj/flyt hertil) + puljen (fjern hertil).
- **Drop-handlinger:** pulje → kolonne = tilføj (eller flyt hvis rytteren er i et overlappende løb); kolonne A → kolonne B = flyt; kolonne → pulje = fjern.
- **Validitet:** drop afvises visuelt (ingen highlight / "not-allowed") hvis mål-løbet er fuldt, frosset (`lineup_locked`/`stages_completed>0`), afmeldt, eller rytteren ikke er berettiget. Genbrug samme prædikater som klik-stien.
- **Visuelt:** aktiv drop-zone highlighter (border/baggrund); chip får `opacity` under drag. Holdt enkelt, on-brand (ingen glow/animation-staffage).

### D. Mobil + tastatur (baseline, fuld paritet)

Det eksisterende klik/tap-flow er baseline og får alle move-fordelene: kladde-bevidst popover + move-endpoint. Ingen drag kræves for at rearrange. `draggable` aktiveres kun for pointer-enheder (desktop); touch falder tilbage til tap (native DnD trigger ikke på touch, så ingen scroll-konflikt).

## Berørte filer

- **Backend:** `backend/lib/raceLineupMove.js` (ny, pure + tests), `backend/routes/api.js` (ny endpoint), `database/2026-06-26-race-lineup-move.sql` (RPC).
- **Frontend:** `RaceHubBoard.jsx` (kladde-bevidst binding + move-dispatch + DnD-orkestrering), `AvailableRidersPool.jsx` (draggable chips + pulje-drop), `RaceColumn.jsx` (draggable rækker + kolonne-drop), `AddRiderPopover.jsx` (uændret logik, fodres nu af kladde-binding), `frontend/src/lib/raceHubDnd.js` (ny, pure + tests), `raceHubLogic.js` (evt. lille binding-helper).
- **i18n:** nye move-fejlkoder + evt. drag-hint (en+da, uden em-dash).
- **Patch note** + `help.json`: "flyt rytter mellem løb / træk-og-slip".

## Test

- `node --test`: `raceLineupMove` (overlap-detektion, validering, fejlkoder), `raceHubDnd` (drop-validitet), kladde-bevidst `buildBindingMap`-fodring.
- Playwright core-smoke: ingen ny snapshot forventet (boardet kræver seed-data); verificér ingen regression. Klik-flow-paritet manuelt på preview.

## Out of scope / opfølgning

- Touch-DnD (kræver bibliotek) — separat, hvis ønsket senere.
- De resterende #1925-edge-cases (re-akkvisition, dobbelt-PUT) — uafhængige.
