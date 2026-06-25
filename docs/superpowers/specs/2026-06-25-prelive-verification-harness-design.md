# Pre-live verifikations-harness (design)

> **Status:** frosset til review · **Dato:** 2026-06-25 · **Ejer-godkendt scope:** 2026-06-25
> **Relation:** muliggør race-hub-programmet (`2026-06-25-race-hub-program-design.md`). Foundation-slice der bygges FØR S5/S7, så de kan verificeres visuelt (preview) + kontrakt-testes (CI) før merge.
> **Anledning:** ejeren kunne ikke selv klikke S4 igennem før det gik live (`feedback_owner_must_be_able_to_test_on_preview`); og #1840 (tom strategi-flade, samme dag) var en backend-kontrakt-bug en mock ikke ville have fanget (`feedback_test_real_endpoint_not_just_mocked`).

## 1. Formål

Færre fejl når live ved at gøre to ting muligt FØR merge, som ikke kan i dag:

1. **Self-serve visuel test** — ejeren åbner en preview-URL, "logger ind" og klikker race-hub-flader (`/races`, `/races/:id`, board, strategi, og senere taktik/akademi) igennem mod realistiske seed-data. Prod uberørt.
2. **Automatisk backend-kontrakt-test** — race-hub-endpoints' faktiske queries køres mod et ægte (ephemeral) skema i CI, så forsvundne/omdøbte kolonner, brudt FK/CHECK og manglende `{data,error}`-håndtering (#1840-klassen) fanges automatisk for evigt.

De to lag er komplementære: Lag 1 fanger UI/UX/layout/copy/tom-state *visuelt* (menneske-i-loop); Lag 2 fanger backend-kontrakt *automatisk* (ingen-menneske-i-loop). Ingen af dem alene er nok — derfor begge.

## 2. Låste beslutninger (ejer 2026-06-25)

| # | Beslutning |
|---|------------|
| L1 | **Leveringsmekanisme:** mock-lag i den kørende app (ikke staging-DB, ikke namespaced prod-seed). 0 prod-risiko. |
| L2 | **Aktivering:** flag ON i **Vercel preview-deploys** (production-scope uden flag = uberørt). Hver race-hub-PR's auto-preview-URL er klikbar. |
| L3 | **Dækningsambition:** PSH (Lag 1) NU + automatiske backend-kontrakt-tests mod ægte ephemeral DB (Lag 2) — ikke fuldt staging-miljø. Højest fejl-fangst pr. indsats uden et miljø at vedligeholde. |
| L4 | **Mock-mekanisme:** letvægts `window.fetch`-interceptor der genbruger de eksisterende rene matchers fra Playwright-fixtures (ikke MSW). MSW er dokumenteret fallback hvis interceptoren ikke fanger en request-type. |
| L5 | **Ephemeral DB:** PGlite (`@electric-sql/pglite`) — allerede devDependency, allerede 3 fungerende integrationstests. 0 ny CI-infra (kører in-process i `backend-tests`-jobbet). |
| L6 | **Proces-ændring:** UI-PR'er bærer fremover **ægte renderede** screenshots (ikke Playwright-maskerede) i PR-body. PSH leverer dem. |

## 3. Lag 1 — Preview seed-harness (PSH)

### 3.1 Arkitektur (4 komponenter)

1. **Delt seed-modul** — `frontend/src/preview/seedData.js` (framework-neutralt: importerer IKKE `@playwright/test`). Eneste kilde til seed-data. Indeholder testhold + 12-rytters trup + en realistisk pulje-kalender + board/strategi/akademi-payloads (se §3.2). Begge konsumenter (Playwright-fixtures + runtime-mock) importerer herfra → ingen drift.
2. **Delte matchers** — flyttes fra `frontend/tests/e2e/fixtures.js` til `frontend/src/preview/mockHandlers.js`: de rene funktioner `restRows(table, url)`, `restObject(table, url)`, `apiResponse(pathname)` (i dag inline i fixtures.js). De tager request-koordinater og returnerer plain data — ingen framework-binding. `fixtures.js` beholder kun Playwright-wrappingen (`route.fulfill` + CORS) og kalder de delte matchers.
3. **Runtime-interceptor** — `frontend/src/preview/installPreviewMock.js`. Patcher `window.fetch` ved app-bootstrap: matcher Supabase REST (`**/rest/v1/<table>`), Supabase Auth (`**/auth/v1/**`) og Express (`**/api/**`) og serverer `new Response(JSON.stringify(...))` via de delte matchers. Mutationer (POST/PUT/PATCH/DELETE) → optimistisk `{ok:true}`/tom liste (samme som fixtures.js i dag).
4. **Bootstrap-gate** — i `frontend/src/main.jsx`, FØR React mountes:
   ```js
   if (import.meta.env.VITE_PREVIEW_MOCK) {
     const { installPreviewMock } = await import("./preview/installPreviewMock.js");
     installPreviewMock();
   }
   ```
   Dynamisk import bag en build-time env-guard ⇒ prod-bundlen (uden flaget) tree-shaker hele preview-mappen væk. 0 bytes i production-bundlen.

### 3.2 Seed-omfang (realistisk pulje — alle race-hub-flader klikbare)

- **Testhold** i en division/pulje, `is_test_account`, 12-rytters trup med varierede typer (sprintere, klatrere, GC, punchere, domestikker, U23) så fit-bars + roller + strategi er meningsfulde.
- **Kalender:** 2-3 **kørte** løb (fulde `race_results`: stage + gc + points + mountain), 1 **"I gang"** (`0<stages_completed<stages` → `deriveRaceStatus`="Live"), 3-4 **kommende** på tværs af kategorier — alle med `race_stage_profiles` (profile_type + `demand_vector` der summerer ~1.0) + `race_stage_schedule` (scheduled_at).
- **Board-distribution** (`/api/races/distribution`): kolonner med mindst ét tids-overlap (så binding/overlap-UI er synligt), bindingMap, roster.
- **Strategi** (`/api/races/strategy`): a_chain + captain_priorities + role_rules + target_race_ids, så S3-fladen + senere S5 har data.
- **Akademi** (`/api/academy/me`): roster + intake + free agents (S7-fladen).

Seed-modulet er **udvideligt**: S5/S7 tilføjer felter deres egne flader kræver i samme PR.

### 3.3 Data-flow

Browser → `window.fetch` → interceptor → match (Supabase-tabel ELLER `/api/`-path) → seed fra modulet. `/races/:id` rendrer uden backend (læser kun `races`/`race_results`/`race_stage_profiles`/`race_stage_schedule` direkte fra Supabase). Board/strategi/akademi får mockede `/api/`-svar.

### 3.4 Vercel-konfiguration (L2)

- **Preview-scope:** `VITE_PREVIEW_MOCK=1` + en **sentinel** `VITE_SUPABASE_URL` (dummy, fx `https://preview-mock.invalid`). Sentinellen er belt-and-suspenders: hvis en request slipper forbi interceptoren, kan den fysisk ikke ramme prod.
- **Production-scope:** uændret (intet flag, ægte Supabase-URL).
- `VITE_API_URL` i preview kan pege på en uskadelig dummy (alle `/api/`-kald interceptes alligevel).

### 3.5 Ærlige grænser

- **Mutationer persisterer ikke** — UI viser optimistisk succes, men intet round-trip. Fint til *visuel* verifikation af S5/S7-flader; ægte persistens forbliver Lag 2 + Playwright + prod-verify efter merge.
- **Realtime (WebSocket) mockes ikke** — degraderer pænt (samme som Playwright i dag).
- **Mocken kan drifte fra ægte skema** og give falsk-grøn. Mitigeret af: (a) ét delt seed-modul, (b) `node --test` skema-form-test (§3.6), (c) Lag 2 fanger den ægte kontrakt separat.

### 3.6 Test (Lag 1)

- `frontend/src/preview/seedData.test.js` (`node --test`): hvert løb har ≥1 `race_stage_profiles`-række pr. etape + `race_stage_schedule`; hvert `demand_vector` summerer ~1.0 (±tolerance); ingen dangling FK (results' rider_id/team_id findes i seed); kørte løb har `stages_completed===stages`; "I gang"-løbet opfylder `0<stages_completed<stages`.
- Playwright-fixtures fortsætter grønt oven på det delte modul (bevis: ingen core-smoke snapshot-drift — refaktoreringen ændrer ikke data-værdier).
- Manuelt: kør `vite` lokalt m. `VITE_PREVIEW_MOCK=1`, screenshot de ægte renders via preview-værktøjer.

## 4. Lag 2 — Backend-kontrakt-harness

### 4.1 Arkitektur

1. **Contract-harness** — `backend/lib/testdb/createTestDb.js`. Genbruger PGlite-mønstret fra `countriesSeed.integration.test.js` + `fictionalRiderGenerator.integration.test.js`: spinner PGlite, kører role/extension-prelude (`CREATE ROLE authenticated`, `anon`, `is_admin()`-stub), applier de relevante `database/*.sql`-migrationer i rækkefølge, returnerer en ægte klient. Ét sted, så nye contract-tests ikke genopfinder setup.
2. **Delte projektions-konstanter** — for hvert kontrakt-testet endpoint ekstraheres dets `.select()`-projektion til en eksporteret konstant som BÅDE route'en og testen importerer (fx `STRATEGY_ROSTER_COLUMNS = "id, firstname, lastname, primary_type, secondary_type"`). Reducerer drift mellem route og test til nul.
3. **Endpoint-contract-tests** — `backend/routes/<area>.contract.integration.test.js`. Loader skemaet for tabellerne et endpoint rører, kører endpointets faktiske projektion som SQL mod PGlite + asserterer: (a) alle projektions-kolonner findes (fanger #1840), (b) FK/CHECK holder for repræsentative rækker, (c) query med tom roster returnerer `[]` ikke fejl (fanger den tomme-flade-regression).

### 4.2 Første mål (inkrementelt — bevis mønstret på den der bed os)

1. **`/races/strategy`** (api.js:1869-1945) — den utestede flade der fejlede i #1840. Loader `riders`, `rider_derived_abilities`, `team_race_strategy`, `seasons`, `races`, `race_stage_profiles`. Test: projektionen rammer kun ægte kolonner; tom roster → tom (ikke fejl).
2. **`/races/distribution`** + **`/races/:id/selection`** — board + lineup-gem.
3. **`/academy/me`** + akademi-mutationer — feeder S7's contract-tests.

S5/S7 tilføjer contract-tests for deres egne nye/ændrede endpoints i samme PR.

### 4.3 Ærlige grænser

- Tester **SQL/skema-kontrakten**, ikke selve supabase-js/PostgREST-HTTP-laget (sjældent dér bugs sidder). Det er den rigtige 90%-dækning til prisen.
- PGlite ≠ 100% Postgres-paritet — eksotiske extensions/RLS-policies kan kræve en dokumenteret compat-shim eller skip-allowlist i harness'en.

### 4.4 Test (Lag 2)

Contract-testene ER testene. De kører i det eksisterende `backend-tests`-CI-job (`npm test`) uden ny infra. Harness'en selv får en lille `createTestDb`-smoke (loader prelude + én migration, kører en triviel query).

## 5. Proces-ændring — ægte screenshots i PR'er (L6)

Hver race-hub-UI-PR's body inkluderer fremover **ægte renderede** screenshots (PSH lokalt + preview-værktøjer), ikke Playwright-maskerede. Plus den klikbare Vercel-preview-URL. Erstatter "Playwright-mock-screenshots ses kun af Claude"-problemet.

## 6. Sekvens + afhængigheder

1. **PSH (Lag 1)** + **contract-harness (Lag 2, strategi-endpoint først)** bygges først — foundation, lav risiko, ingen migration. Kan være 1-2 PR'er (forslag: PSH = én PR, harness = én PR; eller samlet hvis lille).
2. Derefter **S5 + S7 parallelt** i separate worktrees, der hver: bruger PSH til screenshots + tilføjer contract-tests for egne flader. S7 har `database/*.sql` → **ejer merger**.

**Afhængighed:** S5/S7's visuelle verifikation + contract-dækning afhænger af denne harness → derfor først.

## 7. Åbne punkter (afklares ved implementerings-plan)

- **Lag 2 skema-samling:** hvilke `database/*.sql` loades i PGlite for at få fuld `riders`/`races`-form (kolonner er spredt over mange ADD-COLUMN-migrationer)? Forslag: load den ægte ordnede delmængde der rører tabellerne under test, med compat-prelude; fallback = en CI-tjekket konsolideret test-skema-snapshot. Bevis mønstret på strategi-endpointet før udrulning.
- **PR-opdeling:** PSH + harness som 1 eller 2 PR'er (afgøres af samlet diff-størrelse).
- **Mutations-realisme i PSH:** skal optimistiske svar afspejle den indsendte payload (fx tilføjet rytter dukker op i board'et uden reload), eller er statisk OK nok til visuel verifikation? Default: statisk OK; opgradér kun hvis en flade kræver det.

## 8. Proces (gælder begge lag)

- **Worktree-isoleret** (`feat/prelive-verification-harness` fra `origin/main`).
- **Ingen migration** i denne harness → kan auto-merges efter CI (men ejer-review af spec + PR ønskes).
- **Verificér-før-claim:** kør PSH lokalt + se de ægte renders; kør contract-testene grønt før "done".
- **CI-gate-sæt:** lint + i18n-leak + tone + warning-budget + `node --test` (frontend+backend) + playwright core-smoke (alle 3 projekter hvis visuel ændring) + snapshot-refresh.
- **Patch notes:** denne harness er IKKE brugerrettet (intern test-infra) → skriv "ingen patch note: intern verifikations-infra, ingen brugerrettet ændring" i PR-body. Help/FAQ uændret.
- **Design-smag:** ingen ny player-facing UI i harness'en (seed-data efterligner eksisterende flader). S5/S7's egen UI følger navy/guld/Bebas/editorial, INGEN AI-slop, EN-først copy.
