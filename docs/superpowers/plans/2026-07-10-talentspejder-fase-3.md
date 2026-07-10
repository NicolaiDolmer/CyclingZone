# Talentspejder Fase 3 Implementation Plan (#2244)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 15-slots-per-season scouting model with a real talent scout: a staff person whose rating drives report precision, a job model (`scout_assignments`) with targeted jobs and missions that cost ingame travel money and mature over daily ticks, and a Scouting-central frontend page.

**Architecture:** The scout IS the existing `scouting` staff role from the #2216 staff engine (no new role enum). Every team has an implicit **default scout** (baseline overall 40) so the system ships live for everyone even though staff hiring is admin-gated until the facilities flip; a hired scout improves precision and capacity. New `scout_assignments` table is the job ledger; maturation runs as a daily sweep mirroring `trainingSweep.js`. Precision plugs into the already-parametrized `CEIL_HALF_WIDTH_BY_LEVEL` / `SCOUT_DISPLAY_CONFIG` seams. All potential output stays server-side and remains guarded by `potentialeHiding.routes.test.js` + `scoutingInversionHarness.js`.

**Tech Stack:** Node/Express backend, Supabase Postgres (RLS, service_role writes), React/Vite frontend, `node --test`.

**Ejer-låst spec:** `docs/superpowers/specs/2026-07-07-talentspejder-design.md` — decisions 1–6 are binding.

**PR-slicing (hver slice = egen PR, migration-PR = ejer-merge):**
- **Slice A** — datamodel + scout-engine + rating→præcision (backend only, ingen player-facing ændring endnu)
- **Slice B** — daily sweep + mission-shortlist + routes (backend, flag-gated cutover fra slots)
- **Slice C** — Scouting-central + RiderScoutingTab-tilstande + patch notes + help.json (frontend, cutover live)
- **Slice D** — kørte gates: inversion-harness m. spejder-dimension + travel-cost-scorecard + ejer-scorecard-review (skal være grøn FØR Slice C merges)

---

## Fastlagte parametre (v1-defaults — kalibreres i Slice D-harness, ejer-review før ship)

| Parameter | Default | Note |
|---|---|---|
| Default-spejder overall | 40 | teams uden hyret scouting-staff |
| Kapacitet | 1 samtidig opgave (2 ved overall ≥ 80) | spec beslutning 2 |
| Målrettet opgave: varighed | 3 dage pr. niveau-step | modnes via sweep |
| Målrettet opgave: rejseomkostning | ~~15.000~~ **1.000** × niveau-step (rekalibreret 10/7 efter scorecard-FAIL, se audit) | finance type `scout_travel` |
| Mission: varighed | 14 dage | spec: "N uger" → 2 uger v1 |
| Mission: rejseomkostning | ~~60.000~~ **6.000** (rekalibreret 10/7) | flat v1 |
| Mission-output | shortlist 3–5 + 1 gratis L1-rapport på topfund | spec beslutning 6 |
| Half-width-gulv pr. spejder-overall | lineær interp: overall 40 → gulv 5.0, overall 99 → gulv 3.0 (rating-point, jf. `CEIL_HALF_WIDTH_BY_LEVEL[3]=3`) | ingen når 0 — residual `anchorBias` bevares |
| Egne ryttere | bånd = spejderens minimums-bånd × 0.8 (aldrig eksakt) | spec beslutning 4, patch-note-pligtig |
| Præcisions-loft | middelmådig spejder (overall < 60) når aldrig under gulv 4.5 | spec beslutning 3 |

## Slice A — datamodel + engine + præcision

### Task A1: Migration `scout_assignments` + finance type (twin-guard)

**Files:**
- Create: `database/2026-07-10-scout-assignments.sql`

- [ ] Skriv migration:

```sql
-- Talentspejder Fase 3 (#2244): job-model. Afløser slots-modellen (scout_actions bevares som rapport-ledger).
CREATE TABLE IF NOT EXISTS scout_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES team_staff(id) ON DELETE SET NULL, -- NULL = default-spejder
  kind TEXT NOT NULL CHECK (kind IN ('target','mission')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  -- target-jobs
  rider_id UUID REFERENCES riders(id) ON DELETE CASCADE,
  target_level SMALLINT CHECK (target_level BETWEEN 1 AND 3),
  -- missions
  mission_criteria JSONB, -- {scope:'division'|'country'|'u23'|'nm', value:...}
  -- fælles
  travel_cost BIGINT NOT NULL DEFAULT 0,
  started_on DATE NOT NULL,
  ready_on DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  result JSONB, -- mission: {shortlist:[rider_id,...], top_rider_id}; target: {level}
  season_id UUID REFERENCES seasons(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scout_assignments_target_shape CHECK (
    (kind = 'target' AND rider_id IS NOT NULL AND target_level IS NOT NULL)
    OR (kind = 'mission' AND mission_criteria IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_scout_assignments_team_active
  ON scout_assignments (team_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_scout_assignments_ready
  ON scout_assignments (ready_on) WHERE status = 'active';

ALTER TABLE scout_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_assignments_owner_select ON scout_assignments
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
-- Alle writes = service_role (ingen insert/update-policy for authenticated).

-- Twin-guard: ny finance-type i SAMME migration som koden der bruger den.
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  -- <<eksisterende typer kopieres uændret fra 2026-07-05-facilities-staff-foundation.sql>>
  'scout_travel'
));

-- Sweep-dedup (mirror af training_day_runs)
CREATE TABLE IF NOT EXISTS scout_sweep_runs (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tick_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, tick_date)
);
ALTER TABLE scout_sweep_runs ENABLE ROW LEVEL SECURITY;
```

**OBS:** Udføreren SKAL kopiere den eksisterende type-liste fra den nyeste CHECK-constraint (find i `database/2026-07-05-facilities-staff-foundation.sql` eller senere migration) og tilføje `scout_travel` — aldrig gætte listen. Migration committes, appliles ALDRIG via MCP — ejer merger PR'en.

- [ ] Kør `node --test backend/lib/potentialeHiding.routes.test.js` — skal stadig være grøn (ingen nye potentiale-reads).
- [ ] Commit: `feat(scouting): scout_assignments datamodel + scout_travel finance type (#2244)`

### Task A2: Scout-engine (pure lib)

**Files:**
- Create: `backend/lib/scoutEngine.js`
- Test: `backend/lib/scoutEngine.test.js`

Pure functions, ingen I/O (mønster: `facilityEngine.js`):

```js
// backend/lib/scoutEngine.js
const DEFAULT_SCOUT = Object.freeze({ overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true });

const SCOUT_JOB_CONFIG = Object.freeze({
  target: { daysPerLevel: 3, costPerLevel: 15000 },
  mission: { days: 14, cost: 60000, shortlistMin: 3, shortlistMax: 5 },
  capacity: (scout) => (scout.overall >= 80 ? 2 : 1),
});

// Half-width-gulv i rating-point: lineær 40→5.0, 99→3.0; loft for middelmådig spejder.
function minHalfWidthByScoutRating(overall) { ... }

// Effektiv half-width pr. niveau: max(CEIL_HALF_WIDTH_BY_LEVEL[level] skaleret, gulv)
function scoutHalfWidth(level, scout) { ... }

function travelCostFor(kind, { fromLevel, toLevel } = {}) { ... }
function readyDateFor(kind, startedOn, { fromLevel, toLevel } = {}) { ... }
function canStartAssignment({ activeCount, scout, balance, cost }) { ... } // {ok, reason}
```

- [ ] TDD: test-cases — gulv-interpolation (40→5.0, 99→3.0, monotonisk faldende), loft (overall 55 → aldrig < 4.5), kapacitet (79→1, 80→2), cost/varighed pr. kind, `canStartAssignment` afvisninger (`capacity`, `insufficient_funds`).
- [ ] Kør `node --test backend/lib/scoutEngine.test.js` — grøn.
- [ ] Commit: `feat(scouting): scoutEngine — rating→præcision, kapacitet, costs (#2244)`

### Task A3: Præcision wired ind i scouting.js / scoutingReport.js

**Files:**
- Modify: `backend/lib/scouting.js` (`buildScoutEstimate`, `estimatePotentialRange`, `SCOUT_DISPLAY_CONFIG`)
- Modify: `backend/lib/scoutingReport.js` (`buildTypeCeilingBands` — scout-rating-parameter)
- Test: udvid `backend/lib/scouting.test.js` + `backend/lib/scoutingReport.test.js`

Kontrakt-ændringer:
1. `buildScoutEstimate(rider, level, viewerTeamId, cfg, currentYear, scout = DEFAULT_SCOUT)` — ny valgfri parameter; half-widths ganges/gulv-begrænses med `scoutHalfWidth(level, scout)`.
2. **Egen-rytter-eksakt-branchen FJERNES:** `isOwn` → `effectiveLevel = maxLevel` bevares, men output er altid `{lo,hi}` med smalleste bånd × 0.8 — feltet `exact` udgår af API-output. Find og opdatér ALLE consumers af `exact` (grep frontend for `.exact` på scout-estimat).
3. `anchorBias`/`residualHalfWidth` bevares uændret (inverterbarheds-anker).
4. `buildTypeCeilingBands({..., scout})` — samme gulv-logik på loft-bånd.

- [ ] TDD på ny kontrakt; kør fuld backend-suite `node --test backend/` (eller `scripts/verify-local.ps1`).
- [ ] Kør `node backend/scripts/scoutingInversionHarness.js` — median reconstruction error < 0.25 SKAL holde for ALLE scout-ratings {40, 60, 80, 99} (udvid harness med rating-loop, jf. gate #1162).
- [ ] Commit: `feat(scouting): spejder-rating → båndbredde-gulv; egne ryttere = smalt bånd, aldrig eksakt (#2244)`

## Slice B — job-service, sweep, missioner, routes

### Task B1: `scoutAssignmentService.js` (I/O)

**Files:**
- Create: `backend/lib/scoutAssignmentService.js`
- Test: `backend/lib/scoutAssignmentService.test.js` (mocked supabase, mønster: `facilityService.test.js`)

```js
// API (alle service_role):
async function getScoutState(teamId)            // {scout (staff-row eller DEFAULT_SCOUT), active:[], completed:[...senest 20], capacity}
async function startTargetAssignment({teamId, riderId, seasonId})   // validér kapacitet+balance → debitTeam(..., 'scout_travel', {idempotent:true, audit:{idempotencyKey:`scout_travel:${teamId}:${assignmentId}`}}) → insert
async function startMission({teamId, criteria, seasonId})           // do.
async function cancelAssignment({teamId, assignmentId})             // ingen refusion v1
```

Scout-opslag: `team_staff WHERE team_id AND role='scouting' AND status='active'` + `staff_derived_abilities`; fallback `DEFAULT_SCOUT`.

- [ ] TDD; grøn; commit `feat(scouting): scout_assignments service — start/cancel + travel-debit (#2244)`

### Task B2: Daily sweep `scoutSweep.js`

**Files:**
- Create: `backend/lib/scoutSweep.js`
- Modify: `backend/cron.js` (`startCron()` — tilføj sweep på eksisterende 5-min interval)
- Test: `backend/lib/scoutSweep.test.js`

Mirror `trainingSweep.js` præcist: `shouldSweepNow` (Copenhagen-hour gate, samme `SWEEP_FROM_HOUR`-mønster), `scout_sweep_runs`-mutex, idempotent. Pr. modnet assignment (`ready_on <= tick_date`, status active):
- **target:** insert `scout_actions`-række(r) op til `target_level` (bevarer eksisterende level=COUNT-derivation!), status→completed, `result={level}`.
- **mission:** kør shortlist-generator (Task B3), gratis L1 = 1 `scout_actions`-række på topfund, status→completed.

- [ ] TDD (idempotens: to kørsler samme dag = én effekt); grøn; commit.

### Task B3: Mission-shortlist-generator (bias-blandet)

**Files:**
- Create: `backend/lib/scoutMission.js`
- Test: `backend/lib/scoutMission.test.js`

Udvælgelse: kandidat-pool fra `mission_criteria` (division/land/U23/NM) → score = ægte potentiale-rang **blandet med spejder-bias** (`seededUnit`-mønster fra `scouting.js`, vægt så rang IKKE kan inverteres fra shortlist-rækkefølge) → top 3–5, **shuffle output-rækkefølgen deterministisk** (aldrig sorteret efter potentiale). Bedre `reach`-skill → større pool-dækning; bedre `evaluation` → mindre bias-vægt.

- [ ] TDD-invariant: over 200 seeds må korrelationen mellem shortlist-position og sand potentiale-rang ikke overstige aftalt loft (< 0.3) — dette ER inversion-gaten for shortlists.
- [ ] Commit.

### Task B4: Routes + cutover-gate

**Files:**
- Modify: `backend/routes/api.js`
- Test: `backend/routes/scoutAssignments.routes.test.js` + udvid `backend/lib/potentialeHiding.routes.test.js`

```
GET  /api/scouting/central        → getScoutState + shortlist-feed (afsluttede missioner)
POST /api/scouting/assignments    → startTarget/startMission (marketWriteLimiter)
POST /api/scouting/assignments/:id/cancel
```

Cutover: ny flag `scout_system_enabled` i `app_config` (kill-switch-semantik som `race_engine_v2_enabled`, IKKE beta-gate — Slice C flipper til 'on' for alle ved ship). Mens 'off': gamle `POST /api/scouting/:riderId` (slots) fungerer; når 'on': slots-endpoint returnerer 410 med henvisning, `GET /api/scouting/me` rapporterer job-model-state. Eksisterende `scout_actions`-niveauer bevares (bånd genberegnes automatisk via default-spejder — ingen datamigration nødvendig).

- [ ] Forward-guard: `potentialeHiding.routes.test.js` — nye endpoints må IKKE tilføje potentiale-reads uden whitelist-bump + kommentar; assert response-shapes indeholder aldrig `potentiale`/`exact`.
- [ ] Commit + PR (Slice A+B kan gå i samme PR hvis reviewbar; migration ⇒ ejer-merge uanset).

## Slice C — frontend

### Task C1: Scouting-central side

**Files:**
- Create: `frontend/src/pages/ScoutingCentralPage.jsx`, `frontend/src/lib/useScoutingCentral.js`
- Modify: `frontend/src/App.jsx` (route `scouting`), `frontend/src/components/ui/Menu.jsx` + nav-visibility-helper (mønster `facilitiesNavVisibility.js`)

Indhold (wireframe godkendt 7/7): spejder-kort (navn/rating/speciale — eller "Default-spejder" m. forklaring), opgavekø (aktive m. "rapport om N dage"), start-mission-form (kriterier fra division/land/U23/NM; #27 gemte filtre kobles i Fase 4), shortlist-feed. Æstetik: editorial, Bebas, `cz-*`-tokens, 0 AI-slop; pixel-reference `docs/design/design_handoff_rider_profile/`.

### Task C2: RiderScoutingTab-tilstande

**Files:**
- Modify: `frontend/src/components/rider/profile/RiderScoutingTab.jsx`, `frontend/src/lib/useScouting.js`, `frontend/src/components/rider/ScoutablePotentiale.jsx`

Scout-knap → "Send spejder (3 dage, 15.000)"-flow; ny "Under"-tilstand ("Spejderen arbejder — rapport om N dage"); egne ryttere viser nu bånd (ikke eksakt) — kræver copy.

### Task C3: Copy + patch notes + help

**Files:**
- Modify: i18n-filer (EN først, DA under), `frontend/src/pages/PatchNotesPage.jsx` (ny version), `help.json` (en+da)

Patch-note SKAL nævne den synlige ændring: egne rytteres potentiale vises nu som bånd. Verdict-copy: tone-session med ejer FØR ship (spec åben detalje).

- [ ] Pre-flight: `npm run lint` + `node --test` i frontend/ + build + `npx playwright test core-smoke.spec.js` (alle 3 projekter).
- [ ] PR med RIGTIGE screenshots (lokal dev-server, ikke Playwright-mock).

## Slice D — gates (grøn FØR Slice C merges)

- [ ] **Inversion:** `scoutingInversionHarness.js` udvidet m. spejder-rating-dimension (A3) + shortlist-korrelationstest (B3) — dokumentér resultater i `docs/audits/2026-07-XX-talentspejder-inversion.md`.
- [ ] **Travel-cost-scorecard:** Create `backend/scripts/scoutTravelScorecard.js` (mønster: `facilityInvestmentScorecard.js`) — mål: scouting-spend for aktiv manager ∈ [2%, 15%] af sæson-indkomst v. defaults; kør mod ægte population.
- [ ] **Ejer-review:** præsentér scorecard + bånd-tabel (rating × alder × niveau) + evt. justerede defaults FØR merge af Slice C.

## Self-review (kørt 10/7)

- Spec-dækning: beslutning 1 (staff-person) → A2/B1 scout-opslag; 2 (penge+kapacitet+tid) → A1/A2/B1/B2; 3 (rating→præcision, ingen 100%) → A2/A3; 4 (egne ryttere bånd) → A3/C2/C3; 5 (én spejder v1, datamodel til flere) → `staff_id` på assignment + partial-unique i staff-engine; 6 (shortlist+gratis L1) → B2/B3. Migrationsplan → B4 (niveauer bevares, ingen datamigration). Gates → D.
- Åben detalje bevidst udeladt: multi-spejder-UI (YAGNI v1).
