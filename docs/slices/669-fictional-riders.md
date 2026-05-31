# Slice — Fiktive ryttere ([#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669))

> **Status:** Fase 5 (admin-gated prod-intro til live-test) i gang på branch `feat/fictional-riders-admin-gate`. V1-generator merged til main (#847). RLS-synligheds-gate **anvendt + verificeret i prod**; backend auction-gate bygget. Afventer deploy + fuld test-batch.
> Single source of truth for opgaven. Alt state, beslutninger og næste skridt lever her + i issue #669.
> **Worktree:** `C:\dev\CyclingZone-worktrees\feat-669-fictional-riders-generator` (parallel-session-isolation, #382-mønster).

## Mål (revideret scope — ejer-beslutning 2026-05-31)

Byg kapaciteten til at oprette vores **egne** fiktive ryttere fra bunden — **uden at røre de 8.699 eksisterende PCM-ryttere**.

Den oprindelige #669-framing ("erstat alle 8.699 navne nu") er bevidst forkastet, fordi den ville bryde den kørende beta: løbene køres pt. via PCM-resultat-import, som matcher på **rytternavn** (se Koeksistens-analyse). PCM-rytterne forbliver derfor urørte indtil PCM udfases (kobler til egen race-engine [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676)). Den fulde udskiftning er en **senere** slice.

**V1-leverance:** en verificeret generator + oprettelses-vej der kan producere komplette, spilbare fiktive ryttere, demonstreret via en lokal integrationsverifikation (PGlite — gratis, ingen betalt Supabase-branch). **Intet i prod før eksplicit ejer-go.**

## Fase-plan (gated — ejer godkender hver overgang)

| Fase | Indhold | Gate |
|------|---------|------|
| 0 | Denne doc (SSOT) | ✅ |
| 1 | Discovery, read-only — "anatomi af en rytter" | ✅ |
| 2 | Design-RFC + ejer-beslutninger | ✅ |
| 3 | Generator + oprettelses-vej på branch (deterministisk/seeded) | ✅ |
| 4 | Lokal integrationsverifikation (PGlite, gratis — erstatter betalt preview-branch) | ✅ |
| 5 | Admin-gated prod-intro til live-test (RLS-synlighed + backend auction-gate) | 🔄 **i gang** |

---

## Discovery-rapport (Fase 1 — leverance)

Kilder: live prod-DB (`riders` + information_schema), `database/schema.sql`, `scripts/import_riders.py` (oprindelig seed), `backend/lib/dynCyclistSync.js` (stat-sync), `backend/lib/pcmRiderMatcher.js` (resultat-matching). Read-only; intet ændret.

### 1. Anatomi af en rytter — hvad skal udfyldes for at oprette én komplet rytter

`riders` har ingen CHECK-constraints (al værdivalidering er app-lag). Eneste hårde krav: `firstname`/`lastname` NOT NULL, `prize_earnings_bonus` NOT NULL (default 0), `is_retired` NOT NULL (default false).

**Generatoren sætter:**

| Felt | Type | Noter |
|------|------|-------|
| `firstname` | text NOT NULL | genereret, nationalitets-passende |
| `lastname` | text NOT NULL | genereret; **skal være unik mod alle eksisterende navne** (se §3) |
| `nationality_code` | text | ISO **2-bogstav** (FR, IT, …) — styrer navnevalg |
| `birthdate` | date | driver alder + U25/U23-badges |
| `height` | int (cm) | realistisk |
| `weight` | int (kg) | realistisk |
| `uci_points` | int | **driver `price`/`market_value`/`salary`** (generated); default 1 |
| `popularity` | int | default 0 |
| `stat_fl … stat_ftr` (14 stk.) | int | FL/BJ/KB/BK/TT/PRL/Bro/SP/ACC/NED/UDH/MOD/RES/FTR — bør være rolle-konsistente |
| `potentiale` | numeric(3,1) | 1.0–6.0 i 0.5-trin |
| `is_u25` | bool | afledt af birthdate (statisk flag — sættes ved oprettelse) |

**Sættes IKKE (auto/generated/default):**

| Felt | Hvorfor |
|------|---------|
| `id` | uuid default — ny UUID, kollisionsfri |
| `pcm_id` | **forbliver NULL = diskriminator for "egen rytter"** (se §3) |
| `price`, `market_value`, `salary` | `GENERATED ALWAYS` — writes afvises af DB; afledes af `uci_points` + `prize_earnings_bonus` |
| `created_at`, `updated_at`, `acquired_at` | default `now()` |
| `is_retired` | default false |
| `team_id`, `ai_team_id`, `pending_team_id` | NULL = fri agent (ikke ejet) |

> Bemærk: `full_name` findes i `schema.sql` som GENERATED-kolonne, men **ikke i live-DB** — frontend bygger visningsnavnet fra `firstname`+`lastname`. Ingen handling nødvendig; nye ryttere bruger samme felter.

### 2. Relations-kort — hvad refererer en rytter

13 foreign keys peger på `riders`, **alle på `rider_id`/UUID, ingen på navnet**:
`activity_feed`, `admin_log.target_rider_id`, `auctions`, `loan_agreements`, `pending_race_result_rows`, `race_results`, `rider_stat_history`, `rider_uci_history`, `rider_watchlist`, `swap_offers` (offered+requested), `transfer_listings`, `transfer_offers`.

→ **Konsekvens:** nye ryttere med egne UUIDs kolliderer ikke med noget. Senere kirurgisk fjernelse af PCM-ryttere kan ske via `id` uden at ramme egne ryttere.

### 3. Koeksistens med PCM — den kritiske analyse

**Resultat-import matcher på NAVN, ikke `pcm_id`** (`pcmRiderMatcher.js`): scorende ryttere slås op på `lower(firstname||' '||lastname)` med accent- + nordisk-fold + verificeret alias-fallback. Ægte navnesammenfald flagges `ambiguous` og taber point frem for at gætte.

Tre følger:
1. **Bekræfter rør-ikke-beslutningen:** omdøbning af eksisterende ryttere ville bryde resultat-matching → forkert/manglende point i den kørende sæson.
2. **Egne ryttere er sikre:** PCM sender aldrig resultater for navne den ikke kender, så fiktive ryttere (pcm_id NULL) er usynlige for resultat-import. Ingen konflikt.
3. **⚠️ FÆLDE — navnekollision:** et fiktivt navn der (foldet) er identisk med et eksisterende rytternavn vil gøre **PCM-rytteren** `ambiguous` ved næste import → den taber sine point. **Krav: fiktive navne skal være unikke mod alle 8.699 eksisterende navne (accent/nordisk-foldet) OG mod hinanden.**

`pcm_id IS NULL` er den rene diskriminator: "egen" vs "PCM" — både til drift og til senere udskiftning.

### 4. Tal (live prod, 2026-05-31)

- **8.699** ryttere — **alle** med `pcm_id`; **0 egne** i dag (sporet er helt frit).
- 202 ejet af spiller-hold · 4 retired · 0 med `ai_team_id`.
- **60+ nationaliteter** (ISO2). Top: FR 536, IT 530, BE 499, ES 373, NL 361, CO 296, CN 274, GB 268, US 231, DE 221, DK 219, AU 190, JP 172, NO 150 … lang hale ned til enkelte ryttere pr. land.

### 5. Genbrugbar infrastruktur

- `import_riders.py` → felt-mapping + `REGION_TO_ISO` (komplet ISO2-tabel) + birthdate/U25-logik. Skabelon for generatorens output-form.
- `pcmRiderMatcher.js` → `foldName`/`foldNameNordic` — genbruges til at håndhæve navne-unikhed (§3-fælden).
- Ingen eksisterende vej indsætter nye ryttere fra app'en (`dynCyclistSync` er update-only, `import_riders.py` er et engangs-CLI-seed). Generatoren bliver ny kode.

---

## Risici + mitigering

| Risiko | Mitigering |
|--------|-----------|
| Fiktivt navn kolliderer med PCM-navn → PCM-rytter taber point | Unikheds-check mod foldet indeks af alle eksisterende + genererede navne (§3) |
| Skriv til generated-kolonne fejler hele batch | Generator sætter aldrig price/market_value/salary |
| Utilsigtet ændring af eksisterende ryttere | Kun INSERT, aldrig UPDATE/upsert-on-conflict; pcm_id altid NULL |
| Upassende/pinligt genereret navn | Profanity-filter + ejer spot-check (sample) før prod |
| Ikke-reproducerbar generering | Deterministisk seed → samme seed giver samme ryttere; audit-fil committes |

---

## Design-RFC (Fase 2)

### Besluttede parametre (ejer 2026-05-31)

| Valg | Beslutning |
|------|-----------|
| V1-skala | **~100 ryttere** genereret + indsat (på preview-DB) — bevis vejen end-to-end |
| V1-mål | **Kun preview-bevis** — intet i prod; den kørende beta røres ikke |
| Sportslig profil | **Rolle-arketyper + spredning** — stats OG værdi korreleret, så feltet ligner et ægte cykelfelt |
| Navne-kilde | **Hybrid** — etableret navne-bibliotek + kuraterede pools for nationer biblioteket ikke dækker |
| Review | Spot-check sample før evt. prod (gælder Fase 5) |
| Givet (ikke til afstemning) | Deterministisk seed · committet audit-/mapping-fil · mandlige navne (intet gender-felt) |

### "Spilbar" — verificeret definition

`GET /riders` (`api.js:628`) filtrerer kun `is_retired=false`; `free_agent=true` → `team_id IS NULL`. **Ingen kode-sti filtrerer på `pcm_id`** (kun sync/verify-scripts der bevidst kun vil have PCM-ryttere). En fiktiv rytter med `pcm_id NULL`, `is_retired=false`, `team_id NULL` er derfor automatisk synlig i rytterdatabasen + free-agent-puljen uden videre aktivering. Auktionerbarhed verificeres i Fase 4.

### Arkitektur

**Sprog: Node/JS** (ikke Python som `import_riders.py`). Begrundelse: genbrug af `foldName`/`foldNameNordic` fra `pcmRiderMatcher.js` til unikheds-håndhævelse + kan dække med `node --test` (obligatorisk frontend-/backend-testkrav). Placering: `backend/scripts/generate-fictional-riders.mjs` + ren generator-modul i `backend/lib/` så logikken kan unit-testes uden DB.

1. **Generator (rent modul, deterministisk):**
   - Input: `{ seed, count, nationalityWeights }`. Seeded PRNG (mulberry32-stil — **ikke** `Math.random`), så samme seed → identisk output.
   - **Navne-engine (hybrid):** pools per ISO2-nationalitet. Unikhed håndhæves mod (a) foldet indeks af alle eksisterende DB-navne, (b) allerede genererede — via `foldNameNordic`. Kollision → re-sample. (Beskytter mod §3-fælden.)
   - **Arketype-engine:** vægtet rolle (sprinter / klatrer / TT-specialist / brosten / allrounder / domestique) → korreleret stat-profil (de 14 stats) + uci_points-tier. Tier styrer økonomi via de generated kolonner. Spredning: få stjerner, mange domestikker.
   - **Demografi:** birthdate fra realistisk alders-fordeling (~18–39, peak 24–30) → `is_u25` afledes. `height`/`weight` realistiske, let korreleret med rolle. `potentiale` (1.0–6.0, 0.5-trin) negativt korreleret med alder.
2. **Output:**
   - Insert-payload: kun ikke-generated felter, `pcm_id` altid `NULL`, ingen `team_id`/`ai_team_id`.
   - **Audit-fil** (committes): `seed` + fuld liste med genererede `id`'er og alle felter → reproducerbarhed + præcis reversibilitet.
3. **Oprettelses-vej:** script der **kun INSERT'er** til en target-DB (preview-branch i V1). Aldrig UPDATE/upsert; aldrig rør rækker med `pcm_id NOT NULL`. Pre-flight assert: alle payloads har `pcm_id===null`.
4. **Reversibilitet:** alle egne ryttere = `pcm_id IS NULL` med kendte `id`'er i audit-filen → kirurgisk `DELETE ... WHERE pcm_id IS NULL AND id = ANY(...)`.

### Foreslået default (godkendes med RFC'en)

Nationalitets-fordeling i bevis-batchen: vægtet efter eksisterende felt (FR/IT/BE/ES/NL tungest) **men med garanteret repræsentation af et udvalg ikke-vestlige nationer** (CN, JP, KR, CO, DZ, ER) for bevidst at teste hybrid-pools' svageste punkt.

### Test-strategi (Fase 3, `node --test`)

Determinisme (samme seed → samme output) · navne-unikhed mod mock eksisterende-liste · ingen generated-felt sat · `pcm_id===null` · alle NOT NULL-felter udfyldt · gyldig ISO2-nationalitet · stats i interval · arketype↔stat-konsistens.

### Verifikationsmetode (Fase 4 — gratis, ejer-beslutning 2026-05-31)

Den betalte Supabase preview-branch er **droppet** (ejer vil ikke bruge betalt funktion i V1). Erstattet af en **lokal PGlite-integrationstest** (`@electric-sql/pglite` — in-memory Postgres i Node, ingen Docker, ingen cost), der kører hele insert-vejen mod en `riders`-tabel med de *ægte* generated-column-udtryk fra prod. Kører i CI som en del af `node --test`.

## Fase 3 — leverance (branch `feat/669-fictional-riders-generator`)

Filer (alle nye, ingen eksisterende rørt):
- `backend/lib/fictionalRiderGenerator.js` — seeded PRNG + arketyper/tiers + demografi + hovedgenerator. `pcm_id` altid null; sætter aldrig generated-kolonner.
- `backend/lib/fictionalRiderNames.js` — kuraterede navne-pools i 15 region-clusters + ISO2→cluster (dækker alle prod-nationaliteter).
- `backend/lib/fictionalRiderGenerator.test.js` — 17 tests (`node --test`): determinisme, unikhed, kontrakt (pcm_id null, ingen generated-felter), feltværdier, arketype↔stat-korrelation, garanteret nationalitets-dækning.
- `backend/scripts/generateFictionalRiders.js` — CLI. Default dry-run (ingen DB). `--apply` kræver eksplicit preview-credentials og **nægter prod-ref `ghwvkxzhsbbltzfnuhhz`** + pre-flight `pcm_id===null`-assert + henter eksisterende navne til unikheds-check.

Verifikation: `npx eslint` rent · **822/822 backend-tests grønne** · dry-run (seed 669, 100 ryttere) producerer nationalitets-passende navne, alle ramte dedikeret pool (0 generisk fallback). Ingen DB rørt i Fase 3.

## Fase 4 — leverance (lokal PGlite-integrationsverifikation)

Filer:
- `backend/lib/fictionalRiderGenerator.integration.test.js` — 6 integrationstests mod ægte Postgres (PGlite), delt DB + `TRUNCATE` mellem tests.
- `backend/lib/fictionalRiderGenerator.js` — `toInsertPayload` flyttet hertil + eksporteret (delt af CLI + test → samme insert-vej).
- `backend/package.json` — `@electric-sql/pglite` som **devDependency** (rammer aldrig prod-bundlen).

Bevist (alt grønt):
1. Generatorens payload **INSERT'es mod prod-schemaet uden fejl** (NOT NULL/kolonner/constraints OK).
2. **Generated-kolonner beregnes korrekt af DB:** `price = uci·4000`, `market_value`, `salary` matcher prod-formlerne præcist.
3. Fiktive ryttere er **synlige** (`is_retired=false`) og **frie agenter** (`team_id NULL`), alle med `pcm_id NULL`.
4. En **eksisterende PCM-rytter er fuldstændig urørt** efter fiktiv insert (felter + antal uændret).
5. En fiktiv rytter kan **refereres af en auktion** (FK-integritet — spilbar).
6. Payload indeholder **ingen ukendte kolonner** og rører ingen generated-kolonner.

Samlet: **828/828 backend-tests grønne**, `npx eslint` rent. Hele V1-kapaciteten er bevist lokalt uden at røre prod.

## Åbne punkter (ikke-blokerende — afklares senest ved Fase 5)

- Om/hvornår fiktive ryttere skal i prod, og i hvilket antal (parkeret til efter dry-run-bevis).
- Hvordan fiktive ryttere senere skal *erstatte* PCM-ryttere ved PCM-udfasning (egen slice; uden for V1).

### Kalibrerings-observationer fra spot-check (seed 669, 100 ryttere) — til produktions-generering

- **Star-tier i små batches:** 4% star-rate × 100 ramte 0 stars, så batchen topper ved uci ~793 / ~3,2M (ikke det fulde spektrum op til ~14M). Selv-løser ved produktions-skala; overvej ellers et garanteret star-minimum.
- **Roller mangler eksplicitte svagheder:** primær-stats løftes, men irrelevante stats dæmpes ikke (en sprinter kan tilfældigt få høj bjerg). Overvej rolle-svaghed-dæmpning når det rigtige felt genereres.
- Navne-kvalitet + nationalitets-dækning: god (0 fald til generisk pool på tværs af 14 clusters).

## Fase 5 — Admin-gated prod-intro (live-test)

Mål: lade fiktive ryttere "leve" i prod til en realistisk test, **uden at testere ser eller kan handle dem** (de er endnu ukalibrerede — en tester må ikke kunne auktionere en).

**Arkitektur-fund:** rytter-lister hentes **klient-side via supabase-js (RLS gælder)**, mens auktion-oprettelse går via **backend** (`POST /api/auctions`). Synlighed gates derfor i RLS, økonomisk interaktion i backend.

**To gates:**
- **Synlighed (RLS):** [`database/2026-05-31-fictional-riders-admin-rls.sql`](../../database/2026-05-31-fictional-riders-admin-rls.sql) — `"Public read riders"` ændret fra `USING (true)` → `USING (pcm_id IS NOT NULL OR is_admin())`. Skjuler fiktive (pcm_id NULL) fra ikke-admin overalt i klient-UI'en; admin ser dem i den normale rytterdatabase. **Anvendt + verificeret i prod** (anon + ikke-admin: 0 fiktive; admin: ser dem; alle ser stadig 8.699 PCM). Inkl. `GRANT EXECUTE is_admin() TO anon` (manglede → anon-læsninger fejlede; fanget via impersonation før brugerpåvirkning).
- **Økonomisk interaktion (backend):** `POST /api/auctions` afviser ikke-admin auktion på en fiktiv rytter (403). Defense-in-depth: `GET /api/riders` + `/api/riders/:id` filtrerer også fiktive for ikke-admin. Helper `isViewerAdmin(req)`. (Admin ser fiktive i den normale rytterdatabase via RLS — intet separat endpoint nødvendigt; findbarhed via navne-søgning.)

**Tests:** `fictionalRidersAdminGate.test.js` (PGlite) fastlåser NULL-filter-semantikken. Route-branching verificeret via prod-impersonation (repoet har ingen route-test-infra).

**Reversibelt:** RLS tilbage til `USING (true)` (ét `ALTER`) + slet fiktive (`DELETE WHERE pcm_id IS NULL`). Midlertidigt test-/udrulnings-gate; fjernes når fiktive skal vises for alle (#676).

## Beslutnings-log

- **2026-05-31** — Scope vendt fra "omdøb alle 8.699" → "byg egen-rytter-kapacitet, rør ikke PCM". Begrundelse: resultat-import matcher på navn; den kørende beta må ikke brydes. (ejer)
- **2026-05-31** — Navne-kvalitet: **algoritmisk per nationalitet**. (ejer)
- **2026-05-31** — Review: **spot-check en sample** før prod. (ejer)
- **2026-05-31** — Arbejdsform: **godkend hver gate**. (ejer)
- **2026-05-31 (Fase 2)** — V1-skala **~100**, **kun preview** (intet i prod), profil **rolle-arketyper + spredning**, navne **hybrid**. (ejer)
- **2026-05-31 (Fase 2)** — Generator i **Node/JS** (genbrug af `foldName*` + `node --test`-dækning), kun-INSERT, audit-fil committes. (Claude — godkendes med RFC)
- **2026-05-31 (Fase 4)** — Betalt Supabase preview-branch **droppet**; verifikation via lokal **PGlite**-integrationstest i stedet. (ejer)
- **2026-05-31 (Fase 4)** — Arbejdet flyttet til eget **git worktree** for parallel-session-isolation; hovedmappe frigjort til `main`. (ejer)
