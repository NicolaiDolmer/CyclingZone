# Race Hub — Fase 1: Lag 1 (trup-fordeling) + delt kontekstbånd (design)

> **Status:** udkast til review · **Dato:** 2026-06-24 · **Parent-SSOT:** [`2026-06-23-race-hub-redesign-design.md`](2026-06-23-race-hub-redesign-design.md) §4–§5, §9
> Bygger på Fase 0 (mekanik-backend), der er **live i sæson 1** (overlap peak=2 i alle 7 puljer, 12-rytters trupper, `auto_entry_generator_enabled=ON`).

## 1. Formål

Fase 0 byggede mekanikken (overlap-binding, 6/7/8, afmeld-tabel, proaktiv generator). Fase 1 gør den **synlig og styrbar**: spilleren åbner `/races`, ser sine tidsoverlappende løb side om side, og fordeler sin 12-rytters trup på tværs af dem — med binding og knaphed eksplicit, assistentens forslag som startpunkt.

Dette er **Lag 1 + det delte kontekstbånd** fra parent-spec §4. Lag 0/2/3 og sidegrenen (andre divisioner) er senere faser.

## 2. Hvad Fase 0 efterlod (verificeret mod koden 2026-06-24)

| Byggeklods | Tilstand | Konsekvens |
|---|---|---|
| `GET/PUT /api/races/:raceId/selection` (`raceSelection.js`, `api.js:1425/1448`) | Live, **ét løb ad gangen**. 6/7/8 + roller. Guards: `409 selection_wrong_pool` (pulje), `409 selection_rider_bound` + `bound_rider_ids` (overlap), skadede, akademi ekskluderet. | Gemme-sti genbruges uændret. |
| `raceBinding.js` (`raceTimeWindow`, `windowsOverlap`, `findRiderBindingConflicts`, `teamInRacePool`) | Pure + testet. | Server beregner kolonne-sæt + binding-map herfra. |
| `assignTeamAcrossRaces({ riders, races, lockedWindows })` (`raceEntryGenerator.js:23`) | Pure, binding-bevidst per-hold-tildeler. | Genbruges direkte til "auto-udfyld igen". |
| `race_withdrawals` (afmeld) | Tabel + RLS-læsning live. **Intet skrive-endpoint.** | Fase 1 tilføjer afmeld/deltag-endpoint. |
| `runRaceEntryGenerator` | **Kun admin-route.** | Fase 1 tilføjer spiller-scoped "auto-udfyld igen". |
| `RacesPage.jsx` / `RaceSelectionPanel.jsx` | Kalender-faner + single-race-panel i `/races/:id`. | Board bliver ny default-flade på `/races`; panel-logik genbruges. |

## 3. Låste beslutninger (denne brainstorm, 2026-06-24)

1. **Data-arkitektur:** nyt **aggregat-endpoint** for læse-stien (`GET /api/races/distribution`); server ejer kolonne-sæt/vindue/binding-logik (pure, testbar). Saves går via det **eksisterende `PUT /selection` pr. løb** → alle guards bevares gratis, og #1802's "ét løbs udtagelse overskriver ikke et andets" er automatisk (hvert løb er sit eget `race_entries`-row-sæt, PK `(race_id, rider_id)`).
2. **Scope:** **fuld Lag 1** — board + binding-grayout + gem pr. løb + afmeld/deltag + "auto-udfyld igen". Fladen er komplet og præsentérbar i én PR (søjle-kvalitet > MVP).
3. **Interaktion:** **klik-baseret** (popover "tilføj til løb" fra puljen; tap-fjern i kolonne; bundne ryttere deaktiveret). Drag-and-drop er **senere progressive-enhancement-polish**, ikke i denne PR.
4. **Layout:** delt bånd (scope-pills + sæson-tidslinje) → dagens overlap-løb som kolonner (roller, friskhed, status-chip, "+ tilføj", afmeld) → "ledige ryttere"-pulje nederst med lås-grayout + "auto-udfyld igen". (Mockup godkendt i brainstorm.)
5. **Bug-folding:** #1802 (multi-løb-udtagelse) **leveres af selve board'et**. #1800 (fyrede ryttere hænger / 6-8-tælling) og #1801 (resultatfane forkerte løb) holdes **separate** (#1800 bor i transfer/fyrings-oprydning; #1801 verificeres efter pulje-re-run).

## 4. Routing + IA-integration

- `/races` default → **Trup-board** (ny primær sektion; afløser den flade "Kommende løb"-liste som landing). Eksisterende faner (`library`, `world`, `points`) bevares; den gamle kalender-liste foldes ind i board'ets "kommende"-navigation.
- URL-params: `?scope=mine&day=24`. Scope + dag overlever navigation (skift af dag/scope må ikke miste valgt løb).
- Scope-pills: **"Mine løb"** funktionel i Fase 1. **"Min division" / "Andre divisioner"** rendres som **deaktiverede pills** med "kommer senere"-hint (Fase 5) — URL-param er wired, så senere faser slotter ind uden re-route.

## 5. Komponenter (frontend)

Ny mappe `frontend/src/components/racehub/`:

- **`RaceHubBoard.jsx`** — orkestratoren. Henter `GET /distribution`, holder board-state, monteres som default på `/races`.
- **`ContextBand.jsx`** — scope-pills + sæson-tidslinje (dag X/60, navigerbar, terræn-glyffer pr. dag, "du er her"). Skriver `scope`/`day` til URL.
- **`RaceColumn.jsx`** — ét overlap-løb: header (navn/klasse/type/tid/terræn-glyf) + status-chip (valgt vs 6/7/8, "afmeldt"/"underbemandet") + udtagne ryttere (rolle-tag + friskhed) + "+ tilføj fra ledige" + afmeld/deltag.
- **`AvailableRidersPool.jsx`** — 12-truppen som chips med friskhed; bundne ryttere grånet + lås-ikon (titel: hvilket overlap-løb); "auto-udfyld igen"-knap.
- **`AddRiderPopover.jsx`** — klik en ledig rytter → vælg hvilket af dagens ikke-bindende løb han skal i (kun løb hvor han ikke er bundet vises).

Genbrug: `raceSelectionLogic.js` (`toggleRider`, `validateSelectionClient`), `RiderTypeBadge`, `dateTextToDayOfYear`/`raceCalendar`, `ui`-primitiver. `RaceSelectionPanel.jsx` forbliver på `/races/:id` (Lag 2 udvider den senere) — Fase 1 rører den ikke.

## 6. Backend-kontrakter

### 6.1 `GET /api/races/distribution?day=N&scope=mine` (ny)
Gater på race-engine-flaget (som `/selection`). For `req.team`:
- **Season-context:** `{ currentDay, totalDays: 60, days: [{ day, dateText, terrain: 'flat'|'hills'|'mountain'|'cobbles'|'itt'|'mixed', hasMyRace }] }` til tidslinjen.
- **Kolonner** = løb i holdets pulje (`teamInRacePool`) hvis tidsvindue (`raceTimeWindow` fra `race_stage_schedule`) overlapper den valgte dag, status `scheduled`. Pr. løb: `id, name, race_class, race_type, stages, startTime, window, sizeRule {min,max} (selectionSizeForRace), status, withdrawn:boolean, selection {rider_ids, captain_id, sprint_captain_id, hunter_id, is_auto_filled}, counts {selected, target}`.
- **Trup** = holdets 12 ikke-akademi/ikke-retired ryttere (genbrug `getSelectionContext`-rytterprojektion: `id, name, primaryType, secondaryType, form, fatigue, injured` + `suitability` pr. løb).
- **Binding-map:** `{ rider_id → [race_id, …] }` — hvilke af dagens kolonne-løb rytteren allerede er bundet i (via `findRiderBindingConflicts`/`windowsOverlap`). Klienten gråer rytteren i de øvrige overlappende kolonner.
- Ny pure lib `backend/lib/raceDistribution.js` (kolonne-sæt + binding-map + season-day-projektion) → unit-testet. Endpoint = tynd I/O + kald.

### 6.2 `POST` / `DELETE /api/races/:raceId/withdrawal` (ny)
Afmeld/deltag. `requireAuth` + `marketWriteLimiter`. Guards: race `scheduled`, `teamInRacePool` (kan ikke afmelde fremmed-pulje-løb). `POST` upsert `race_withdrawals (race_id, team_id)` (service_role); `DELETE` fjerner rækken (gen-deltag). Afmeldt løb beholder ingen entries-krav (auto-no-show håndteres allerede af afviklingen/generatoren). Returnerer ny withdrawn-state.

### 6.3 `POST /api/races/distribution/regenerate?day=N` (ny)
"Auto-udfyld igen" for `req.team`, scoped til den synlige dags overlap-løb. Reuse:
1. Hent holdets trup (abilities + fatigue) + dagens kolonne-løb (window/stages/sizeRule/profiler).
2. `lockedWindows` = holdets entries i **andre** løb (alle `race_entries` med `is_auto_filled=false` på tværs af kalenderen → deres vinduer) så manuelle forpligtelser andre dage forbruger rytter-tid og ikke dobbeltbookes.
3. `assignTeamAcrossRaces({ riders, races: visibleDayRaces, lockedWindows })` → skriv picks som `is_auto_filled=true` (delete-then-insert pr. løb, springer afmeldte løb over). Pulje-binding holder per konstruktion (kun egne pulje-løb i input).

## 7. Copy (EN-først, DA-under) + i18n

Nye nøgler i `races`-namespacet (`frontend/public/locales/{en,da}/races.json`), `racehub.*`: scope-pills, tidslinje ("Day {{day}} of {{total}}", "you are here"), kolonne-status ("{{n}} / {{target}} selected", "understaffed", "withdrawn"), pool ("Available riders", "Auto-fill again"), binding-hint ("Already racing in an overlapping race"), afmeld/deltag ("Withdraw" / "Re-enter"), popover ("Add to which race?"). Patch notes ved ship (stor brugerrettet flade). `help.json` (en+da): ny "Squad distribution / overlapping races"-FAQ-post.

## 8. Test + verifikation

- **Backend `node --test`:** `raceDistribution.test.js` (kolonne-sæt: pulje-filter + vindue-overlap; binding-map; season-day-projektion). Regenerate: genbrug-test at `assignTeamAcrossRaces` + lockedWindows ikke dobbeltbooker. Withdrawal-endpoint: pulje-guard.
- **Frontend `node --test`** (obligatorisk — ESM-import-guard) + **`npx playwright test core-smoke`** (alle 3 projekter ved visuel ændring, refresh snapshots).
- **Ny e2e** `race-distribution.spec.js` via `fixtures.js`-mocks (logget-ind board, binding-grayout, popover-add, afmeld). Umasket engangs-screenshot til ejer-review (begge temaer).
- Fuldt CI-gate-sæt før PR (eslint + i18n-leak + tone-em-dash + warning-budget + verify-local).

## 9. Afgrænsning (ud af scope)

- Drag-and-drop (senere polish). Lag 0 (Holdstrategi), Lag 2 (detalje/ruteprofil), Lag 3 (taktik), Fase 5 (andre divisioner funktionel). #1800, #1801 (separate). Fuld fysiologi (#1021). Per-løb "nulstil til assistent" på et manuelt-redigeret løb (board-niveau "auto-udfyld igen" rører kun auto-fyldbare; per-løb-reset er en lille follow-up hvis ønsket).

## 10. Åbne punkter (afklares i plan)

- Terræn-glyf pr. tidslinje-dag: udled fra dagens løbs `race_stage_profiles.profile_type` — én glyf ved blandet dag, eller "mixed"-glyf? (Forslag: dominerende profil, "mixed" ved lige fordeling.)
- Tidslinje-bredde: alle 60 dage som tynde segmenter vs. rullende vindue (fx ±10 dage) med spring-til-i-dag. (Forslag: rullende vindue på mobil, fuld på desktop.)
- Regenerate-bekræftelse: skal "auto-udfyld igen" advare hvis den overskriver manuelle valg på de synlige løb? (Forslag: ja, hvis et synligt løb er `is_auto_filled=false`.)
