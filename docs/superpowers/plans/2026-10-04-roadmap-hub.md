# Roadmap-hub Implementation Plan

> **For agentic workers:** Planen udføres som ÉN bølge via `.claude/workflows/wave.js` (orkestrator-standard, CLAUDE.md). Hvert spor herunder er ét issue og én lane; bølge-args ligger i `2026-10-04-roadmap-hub-wave.json` ved siden af. Du ser kun dit eget spor: læs "Global Constraints", "Fælles kontrakt" og dit spor. Steps bruger checkbox-syntaks (`- [ ]`).

**Goal:** `/roadmap` bliver en hub med fem faner (Plan, Beta, Vote, Known issues, Done), Beta-fanen og patch notes følger kontakterne automatisk, og ejeren får analyse og vedligehold i en ny fane under `/admin/growth`.

**Architecture:** Én additiv migration udvider `roadmap_items`/`roadmap_votes` og tilføjer tre tabeller til kendte fejl. Spillersiden og admin-fanen læser og skriver direkte mod Supabase bag RLS (samme mønster som i dag). Al afledt logik (opdeling, tælling, filter) ligger i rene `.ts`-moduler med `node --test`.

**Tech Stack:** Postgres/Supabase (RLS, `security_invoker`-views), React + Vite, react-i18next, `node --test`, PGlite-integrationstests (`backend/lib/testdb`), Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-04-roadmap-hub-design.md`](../specs/2026-10-04-roadmap-hub-design.md) · **Billede:** `pr-screens/roadmap-4-10/roadmap-foer-efter.png` (kilde-HTML samme sted: brug den som visuel reference for markup og tekster)

## Global Constraints

- Migrationen er additiv og idempotent. Ingen `DELETE`, ingen ændring af eksisterende stemmer. Den applies EFTER merge af `auto-migrate.yml` (#2642), aldrig af en worker via MCP.
- `roadmap_items.status = 'active'` beholder betydningen "idé åben for afstemning". Nye værdier: `planned`, `in_progress`.
- Styringsscoren ændres ikke: `(Ø importance · 0.6 + Ø idea · 0.4) · sqrt(antal stemmer)`.
- Spillere ser kun egne stemmer og egne "Affects me too"-tryk. Samlede tal findes kun bag `public.is_admin()`.
- Ingen datoer eller sæsonnavne på Plan-fanen.
- Spillervendt tekst: EN først, DA under, `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi; ingen em-dash). Teksterne i mockuppen er udkast; ejeren godkender de endelige i PR'ens go-kort.
- UI: `docs/design/PAGE_TEMPLATES.md` (T1 for `/roadmap`, T2 for admin) og `docs/design/TASTE.md`. Kun primitiverne i `frontend/src/components/ui`: `PageHeader`, `Tabs`/`TabList`/`Tab`/`TabPanel`, `Section`/`SectionHeader`, `Segmented`, `StatusBadge`, `Button` (secondary sm i rækker), `Checkbox`, `CollapsibleSection`, `EmptyState` (kræver `action`), `Skeleton`. Én gold primary pr. view, hairlines, 5px radius, tabulære tal, stroke-ikoner.
- Nye frontend-filer: logik i `.ts`. Komponenter følger hard rule 31 i `AGENTS.md` og ts-core-ratchet (se præcedens `frontend/src/components/squad/SquadEmptyStates.tsx`; kan typecheck ikke bære en `.tsx`-komponent, er `.jsx` tilladt med begrundelse i filhovedet, som i `ui/Segmented.jsx`).
- Workers rører aldrig `docs/NOW.md`, skriver ingen patch note (samles ved close-out) og committer kun bag `scripts/guard-commit-branch.sh <branch> <worktree-dir>`.
- Hver UI-PR: ét annoteret før/efter-billede, ejer-go på preview før merge.

## Fælles kontrakt (alle spor koder mod dette)

**Merge-rækkefølge (hård gate):** Spor 1 merges og applies FØRST. Spor 2 og 3 selecter nye kolonner og tabeller og må ikke merges, før post-verify af spor 1 er grøn. Spor 3 merges før spor 2, så ejeren kan vedligeholde indholdet, når spillersiden går live.

**Kolonner efter spor 1:**

| Tabel | Kolonner |
|---|---|
| `roadmap_items` | `id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, flag_key, beta_since, beta_soon, live_soon, created_at, updated_at, shipped_at` |
| `roadmap_votes` | `id, item_id, user_id, idea_score (nullable), importance_score, created_at, updated_at` |
| `known_issues` | `id, area, status, title_en, title_da, published, sort_order, issue_ref, created_at, updated_at, closed_at` |
| `known_issue_updates` | `id, issue_id, body_en, body_da, created_at` |
| `known_issue_reports` | `issue_id, user_id, created_at` (PK `issue_id, user_id`) |
| view `roadmap_item_scores` | `item_id, engine, title_en, approved, status, votes, avg_idea, avg_importance, steering_score, title_da, sort_order, horizon, issue_ref, idea_votes, sd_importance` |
| view `known_issue_scores` | `issue_id, area, status, title_en, title_da, published, sort_order, issue_ref, created_at, closed_at, reports, days_open` |
| rpc `roadmap_admin_stats()` | én række: `voters, voters_14d, votes_total, voted_all, managed_teams` (nul rækker for ikke-admin) |
| rpc `roadmap_split_item(p_source uuid, p_title_en text, p_title_da text, p_status text, p_horizon text, p_issue_ref int)` | returnerer det nye punkts `id`; kun admin; nyt punkt er `approved = false` med kopi af kildens stemmer |

**Beta-kobling (spec §5.6):** `flag_key` er en nøgle i `app_config`. Triggere holder `status`, `beta_since` og `shipped_at` i takt med kontakten. "I beta nu" = `status = 'in_progress' AND beta_since IS NOT NULL`. "Coming to beta" = `beta_soon AND beta_since IS NULL`. "For everyone soon" = i beta nu + `live_soon`.

**Værdier:** `status` ∈ `active | planned | in_progress | shipped | archived` · `horizon` ∈ `next | later` · `area` ∈ `races | training | youth | market | club | other` · issue-`status` ∈ `checking | confirmed | fixing | fixed | dismissed` (`checking` = meldt ind, ikke bekræftet; `dismissed` = tjekket, intet problem fundet). `closed_at` sættes ved `fixed` og `dismissed`.

**Delt frontend-modul (ejes af spor 2, importeres af spor 3):** `frontend/src/lib/roadmapModel.ts` med de typer og funktioner, der står i spor 2, Task 2.1. Spor 3 må importere typerne `RoadmapStatus`, `RoadmapHorizon`, `IssueStatus`, `IssueArea`; alt andet admin-specifikt bor i spor 3's egen `roadmapAdminModel.ts`.

---

## Spor 1 · Migration og RLS (#6149)

**Files:**
- Create: `database/2026-10-05-5387-roadmap-hub.sql`
- Create: `backend/lib/testdb/roadmapHub.integration.test.js`
- Modify (kun hvis RLS-audit kræver det): `backend/scripts/audit-rls-coverage.test.js` og dens kildeliste
- Efter apply (orkestrator): `database/schema-snapshot.json`, `frontend/src/types/database.types.ts`

**Interfaces:**
- Consumes: `public.is_admin()`, `roadmap_items`, `roadmap_votes`, `teams.user_id`, `auth.users`.
- Produces: alt i "Fælles kontrakt".

### Task 1.1: Pre-check (read-only, ingen kode)

- [ ] **Step 1:** Læs `database/2026-06-11-roadmap-items-votes.sql`, `2026-06-20-roadmap-shipped-history.sql`, `2026-09-07-3457-roadmap-anon-read.sql`, `2026-09-07-4943-in-app-survey.sql` (grant-mønster for nye tabeller) og `2026-09-11-5153-security-advisors-hardening.sql` (hvad der blev revoket på `roadmap_item_scores` og `is_admin()`).
- [ ] **Step 2:** Find navnet på status-CHECK'en i `database/schema-snapshot.json` (forventet `roadmap_items_status_check`). Afviger det, bruges det fundne navn i Task 1.2.
- [ ] **Step 3:** Notér i PR-beskrivelsen hvilke GRANTs survey-migrationen giver nye tabeller, og spejl dem.

### Task 1.2: Integrationstest først

- [ ] **Step 1: Skriv den fejlende test** `backend/lib/testdb/roadmapHub.integration.test.js` efter mønstret i `forumCategoryPostRole.integration.test.js` (PGlite + ægte DDL). Indlæs `schema.sql`, de tre eksisterende roadmap-migrationer og den nye fil. Testen skal dække disse cases (ét `test()` pr. linje):

```js
// Roller simuleres som i de øvrige integrationstests i mappen (læs createTestDb.js
// for helperen der sætter rolle + request.jwt.claims før en query).
test("status-CHECK accepterer planned og in_progress og afviser ukendt værdi");
test("horizon er 'next' som default og afviser andet end next/later");
test("anon læser godkendte active/planned/in_progress/shipped, ikke archived og ikke ikke-godkendte");
test("spiller kan stemme på et planned-punkt med kun importance_score (idea_score NULL)");
test("spiller kan IKKE stemme på et active-punkt uden idea_score");
test("spiller kan IKKE stemme på in_progress, shipped eller archived");
test("upsert med kun importance_score bevarer en eksisterende idea_score");
test("spiller læser kun egne stemmer; admin læser alle");
test("roadmap_item_scores: steering_score er uændret for et punkt med to fulde stemmer");
test("roadmap_item_scores: sd_importance og idea_votes regnes rigtigt når idea_score er NULL");
test("anon læser publicerede known_issues og deres updates, ikke upublicerede");
test("kun admin kan insert/update known_issues og known_issue_updates");
test("spiller kan oprette og slette EGET report på en publiceret, ikke-rettet fejl");
test("spiller kan ikke oprette report på en rettet, lukket (dismissed) eller upubliceret fejl, og ikke for en anden bruger");
test("known_issues.status er checking som default og afviser ukendte værdier");
test("kobling: et punkt der får flag_key til en kontakt på beta, bliver in_progress med beta_since");
test("flip: app_config beta -> on sætter koblede punkter til shipped med shipped_at; ukoblede punkter er uændrede");
test("flip: en kontakt uden koblede punkter kan flippes uden fejl, og et flip til off nulstiller beta_since");
test("spiller ser kun egne reports; known_issue_scores.reports er fuldt tal for admin");
test("roadmap_admin_stats() giver én række til admin og nul rækker til spiller");
test("roadmap_split_item: admin får nyt skjult punkt med samme område og en kopi af alle kildens stemmer; kilden er uændret");
test("roadmap_split_item: en spiller afvises (42501), og intet punkt oprettes");
```

Forventet værdi i score-testen: to stemmer (idea 6, importance 4) og (idea 4, importance 6) giver `avg_idea = 5.00`, `avg_importance = 5.00`, `steering_score = round((5*0.6 + 5*0.4) * sqrt(2), 2) = 7.07`.

- [ ] **Step 2: Kør og se den fejle**

Run: `node --test backend/lib/testdb/roadmapHub.integration.test.js`
Expected: FAIL (migrationsfilen findes ikke).

### Task 1.3: Migrationen

- [ ] **Step 1: Skriv** `database/2026-10-05-5387-roadmap-hub.sql`:

```sql
-- Roadmap-hub (#5387, #5388): plan/idé-opdeling, kendte fejl, admin-tal.
-- Spec: docs/superpowers/specs/2026-10-04-roadmap-hub-design.md §5.
-- Additiv + idempotent. Ingen data flyttes eller slettes. 'active' beholder sin
-- betydning (idé åben for afstemning), så den nuværende klient virker uændret.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642).
-- Rollback: se bunden af filen.

-- 1. roadmap_items ---------------------------------------------------------
ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_status_check;
ALTER TABLE roadmap_items ADD CONSTRAINT roadmap_items_status_check
  CHECK (status IN ('active', 'planned', 'in_progress', 'shipped', 'archived'));

ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS horizon TEXT NOT NULL DEFAULT 'next';
ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
ALTER TABLE roadmap_items ADD CONSTRAINT roadmap_items_horizon_check
  CHECK (horizon IN ('next', 'later'));

ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS issue_ref INTEGER;

DROP POLICY IF EXISTS "Authenticated can read approved roadmap items" ON roadmap_items;
CREATE POLICY "Authenticated can read approved roadmap items"
  ON roadmap_items FOR SELECT TO authenticated
  USING ((approved AND status IN ('active', 'planned', 'in_progress', 'shipped')) OR public.is_admin());

DROP POLICY IF EXISTS "Anon can read approved roadmap items" ON roadmap_items;
CREATE POLICY "Anon can read approved roadmap items"
  ON roadmap_items FOR SELECT TO anon
  USING (approved AND status IN ('active', 'planned', 'in_progress', 'shipped'));

-- 2. roadmap_votes ---------------------------------------------------------
-- Planlagte punkter har kun vigtighed. Idéer (active) kræver fortsat begge tal.
ALTER TABLE roadmap_votes ALTER COLUMN idea_score DROP NOT NULL;

DROP POLICY IF EXISTS "Users can insert own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can insert own roadmap votes"
  ON roadmap_votes FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND (i.status = 'planned' OR (i.status = 'active' AND roadmap_votes.idea_score IS NOT NULL))
    )
  );

DROP POLICY IF EXISTS "Users can update own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can update own roadmap votes"
  ON roadmap_votes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND (i.status = 'planned' OR (i.status = 'active' AND roadmap_votes.idea_score IS NOT NULL))
    )
  );

-- 3. roadmap_item_scores: formlen er uændret, nye kolonner tilføjes SIDST
--    (CREATE OR REPLACE VIEW må kun tilføje kolonner i enden).
CREATE OR REPLACE VIEW roadmap_item_scores
  WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  i.engine,
  i.title_en,
  i.approved,
  i.status,
  COUNT(v.id) AS votes,
  ROUND(AVG(v.idea_score)::numeric, 2) AS avg_idea,
  ROUND(AVG(v.importance_score)::numeric, 2) AS avg_importance,
  ROUND(((AVG(v.importance_score) * 0.6 + AVG(v.idea_score) * 0.4) * sqrt(COUNT(v.id)))::numeric, 2) AS steering_score,
  i.title_da,
  i.sort_order,
  i.horizon,
  i.issue_ref,
  COUNT(v.idea_score) AS idea_votes,
  ROUND(STDDEV_SAMP(v.importance_score)::numeric, 2) AS sd_importance
FROM roadmap_items i
LEFT JOIN roadmap_votes v ON v.item_id = i.id
GROUP BY i.id, i.engine, i.title_en, i.approved, i.status, i.title_da, i.sort_order, i.horizon, i.issue_ref;

-- 4. Kendte fejl -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS known_issues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area        TEXT NOT NULL CHECK (area IN ('races', 'training', 'youth', 'market', 'club', 'other')),
  status      TEXT NOT NULL DEFAULT 'checking' CHECK (status IN ('checking', 'confirmed', 'fixing', 'fixed', 'dismissed')),
  title_en    TEXT NOT NULL,
  title_da    TEXT NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  issue_ref   INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS known_issue_updates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    UUID NOT NULL REFERENCES known_issues(id) ON DELETE CASCADE,
  body_en     TEXT NOT NULL,
  body_da     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS known_issue_updates_issue_idx
  ON known_issue_updates (issue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS known_issue_reports (
  issue_id    UUID NOT NULL REFERENCES known_issues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX IF NOT EXISTS known_issue_reports_user_idx ON known_issue_reports (user_id);

ALTER TABLE known_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_issue_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_issue_reports ENABLE ROW LEVEL SECURITY;

-- To policies pr. tabel, som roadmap_items: anon har ikke EXECUTE på
-- is_admin() (#5153), så anon-policyen må ikke kalde den.
DROP POLICY IF EXISTS "Anon can read published known issues" ON known_issues;
CREATE POLICY "Anon can read published known issues"
  ON known_issues FOR SELECT TO anon
  USING (published);

DROP POLICY IF EXISTS "Authenticated can read published known issues" ON known_issues;
CREATE POLICY "Authenticated can read published known issues"
  ON known_issues FOR SELECT TO authenticated
  USING (published OR public.is_admin());

DROP POLICY IF EXISTS "Admins can insert known issues" ON known_issues;
CREATE POLICY "Admins can insert known issues"
  ON known_issues FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update known issues" ON known_issues;
CREATE POLICY "Admins can update known issues"
  ON known_issues FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Anon can read updates on published known issues" ON known_issue_updates;
CREATE POLICY "Anon can read updates on published known issues"
  ON known_issue_updates FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM known_issues k WHERE k.id = known_issue_updates.issue_id AND k.published));

DROP POLICY IF EXISTS "Authenticated can read updates on published known issues" ON known_issue_updates;
CREATE POLICY "Authenticated can read updates on published known issues"
  ON known_issue_updates FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM known_issues k WHERE k.id = known_issue_updates.issue_id AND k.published)
  );

DROP POLICY IF EXISTS "Admins can insert known issue updates" ON known_issue_updates;
CREATE POLICY "Admins can insert known issue updates"
  ON known_issue_updates FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update known issue updates" ON known_issue_updates;
CREATE POLICY "Admins can update known issue updates"
  ON known_issue_updates FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can read own known issue reports" ON known_issue_reports;
CREATE POLICY "Users can read own known issue reports"
  ON known_issue_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own known issue reports" ON known_issue_reports;
CREATE POLICY "Users can insert own known issue reports"
  ON known_issue_reports FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM known_issues k
      WHERE k.id = known_issue_reports.issue_id AND k.published AND k.status NOT IN ('fixed', 'dismissed')
    )
  );

DROP POLICY IF EXISTS "Users can delete own known issue reports" ON known_issue_reports;
CREATE POLICY "Users can delete own known issue reports"
  ON known_issue_reports FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE VIEW known_issue_scores
  WITH (security_invoker = true) AS
SELECT
  k.id AS issue_id,
  k.area,
  k.status,
  k.title_en,
  k.title_da,
  k.published,
  k.sort_order,
  k.issue_ref,
  k.created_at,
  k.closed_at,
  COUNT(r.user_id) AS reports,
  GREATEST(0, EXTRACT(DAY FROM (COALESCE(k.closed_at, NOW()) - k.created_at)))::int AS days_open
FROM known_issues k
LEFT JOIN known_issue_reports r ON r.issue_id = k.id
GROUP BY k.id;

-- 5. Admin-nøgletal i ét kald ---------------------------------------------
CREATE OR REPLACE FUNCTION public.roadmap_admin_stats()
RETURNS TABLE (voters integer, voters_14d integer, votes_total integer, voted_all integer, managed_teams integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH votable AS (
    SELECT id FROM roadmap_items WHERE approved AND status IN ('active', 'planned')
  ), per_user AS (
    SELECT v.user_id, COUNT(*) AS n
    FROM roadmap_votes v JOIN votable a ON a.id = v.item_id
    GROUP BY v.user_id
  )
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM roadmap_votes)::int,
    (SELECT COUNT(DISTINCT user_id) FROM roadmap_votes WHERE updated_at > NOW() - INTERVAL '14 days')::int,
    (SELECT COUNT(*) FROM roadmap_votes)::int,
    (SELECT COUNT(*) FROM per_user WHERE n = (SELECT COUNT(*) FROM votable))::int,
    (SELECT COUNT(*) FROM teams WHERE user_id IS NOT NULL)::int
  WHERE public.is_admin();
$$;
REVOKE ALL ON FUNCTION public.roadmap_admin_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roadmap_admin_stats() TO authenticated;

-- 6. Del punkt (ejer 4/10): resten af et delvist leveret punkt bliver et nyt
--    punkt, og stemmerne kopieres, så de står på begge. Det nye punkt er skjult
--    (approved = false), til ejeren har godkendt teksten. Kilden røres ikke.
CREATE OR REPLACE FUNCTION public.roadmap_split_item(
  p_source UUID, p_title_en TEXT, p_title_da TEXT,
  p_status TEXT DEFAULT 'planned', p_horizon TEXT DEFAULT 'next', p_issue_ref INTEGER DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_src roadmap_items%ROWTYPE;
  v_new UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_title_en, '')) = '' OR btrim(coalesce(p_title_da, '')) = '' THEN
    RAISE EXCEPTION 'both titles are required';
  END IF;
  SELECT * INTO v_src FROM roadmap_items WHERE id = p_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source item not found';
  END IF;
  INSERT INTO roadmap_items (engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  VALUES (v_src.engine, v_src.sort_order, btrim(p_title_en), btrim(p_title_da), FALSE, p_status, p_horizon, p_issue_ref)
  RETURNING id INTO v_new;
  INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
  SELECT v_new, user_id, idea_score, importance_score, created_at, updated_at
  FROM roadmap_votes WHERE item_id = p_source;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_split_item(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roadmap_split_item(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- 7. Beta-kobling (ejer 4/10): Beta-fanen følger kontakterne automatisk.
--    SIKKERHEDSKRAV: et flag-flip må ALDRIG kunne fejle pga. roadmappet.
--    Triggeren på app_config fanger derfor alt i sin egen blok og skriver kun
--    i roadmap_items. Tjek app_config.value's type i Task 1.1 (forventet TEXT).
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS flag_key TEXT;
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS beta_since TIMESTAMPTZ;
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS beta_soon BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS live_soon BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS roadmap_items_flag_key_idx ON roadmap_items (flag_key) WHERE flag_key IS NOT NULL;

-- Når et punkt kobles (eller oprettes koblet): læs kontaktens stadie nu.
CREATE OR REPLACE FUNCTION public.roadmap_items_sync_flag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $
DECLARE
  v_stage TEXT;
BEGIN
  IF NEW.flag_key IS NULL OR NEW.status IN ('shipped', 'archived') THEN
    RETURN NEW;
  END IF;
  SELECT value INTO v_stage FROM app_config WHERE key = NEW.flag_key;
  IF v_stage = 'beta' THEN
    NEW.status := 'in_progress';
    NEW.beta_since := COALESCE(NEW.beta_since, NOW());
    NEW.beta_soon := FALSE;
  ELSIF v_stage IN ('on', 'true') THEN
    NEW.status := 'shipped';
    NEW.shipped_at := COALESCE(NEW.shipped_at, NOW());
    NEW.beta_soon := FALSE;
    NEW.live_soon := FALSE;
  END IF;
  RETURN NEW;
END;
$;
DROP TRIGGER IF EXISTS roadmap_items_sync_flag ON roadmap_items;
CREATE TRIGGER roadmap_items_sync_flag
  BEFORE INSERT OR UPDATE OF flag_key ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.roadmap_items_sync_flag();

-- Når en kontakt flippes: flyt de koblede punkter. Fejl her må aldrig vælte flippet.
CREATE OR REPLACE FUNCTION public.app_config_sync_roadmap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $
BEGIN
  BEGIN
    IF NEW.value = 'beta' THEN
      UPDATE roadmap_items
        SET status = 'in_progress', beta_since = COALESCE(beta_since, NOW()), beta_soon = FALSE, updated_at = NOW()
        WHERE flag_key = NEW.key AND status NOT IN ('shipped', 'archived');
    ELSIF NEW.value IN ('on', 'true') THEN
      UPDATE roadmap_items
        SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()), beta_soon = FALSE, live_soon = FALSE, updated_at = NOW()
        WHERE flag_key = NEW.key AND status NOT IN ('shipped', 'archived');
    ELSIF NEW.value = 'off' THEN
      UPDATE roadmap_items
        SET beta_since = NULL, live_soon = FALSE, updated_at = NOW()
        WHERE flag_key = NEW.key AND status = 'in_progress' AND beta_since IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'roadmap sync failed for flag %: %', NEW.key, SQLERRM;
  END;
  RETURN NEW;
END;
$;
DROP TRIGGER IF EXISTS app_config_sync_roadmap ON app_config;
CREATE TRIGGER app_config_sync_roadmap
  AFTER INSERT OR UPDATE OF value ON app_config
  FOR EACH ROW EXECUTE FUNCTION public.app_config_sync_roadmap();

COMMENT ON TABLE known_issues IS
  'Kendte fejl på /roadmap (#5387). EN+DA i samme række; published gater visning (ejeren godkender teksten). status: checking (meldt ind, ikke bekræftet) -> confirmed -> fixing -> fixed, eller checking -> dismissed (tjekket, intet problem). issue_ref = GitHub-issue, bruges af scripts/roadmap-flip.mjs.';
COMMENT ON TABLE known_issue_reports IS
  '"Affects me too": én række pr. (fejl, bruger). Spillere ser kun egne; admin ser alle via known_issue_scores.';

-- Post-verify (read-only, køres efter apply):
--   1. SELECT conname FROM pg_constraint WHERE conrelid = 'roadmap_items'::regclass AND contype = 'c';  -- status + horizon
--   2. SELECT status, count(*) FROM roadmap_items GROUP BY 1;   -- uændret ift. før apply
--   3. SELECT count(*) FROM roadmap_votes;                      -- uændret ift. før apply
--   4. SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'known_issue%';  -- 3 rækker, alle true
--   5. SELECT * FROM roadmap_item_scores LIMIT 1;               -- 15 kolonner
--   6. SELECT tgname FROM pg_trigger WHERE tgname IN ('app_config_sync_roadmap', 'roadmap_items_sync_flag');  -- 2 rækker
--   7. Flip-prøve på en kontakt UDEN koblede punkter er ikke nødvendig: triggeren er dækket af integrationstesten.
--      Rør ALDRIG en rigtig kontakt i prod for at teste (ejer-only).
--
-- Rollback (kun hvis ingen rækker bruger de nye værdier):
--   DROP FUNCTION public.roadmap_admin_stats(); DROP VIEW known_issue_scores;
--   DROP TABLE known_issue_reports, known_issue_updates, known_issues;
--   (roadmap_items/roadmap_votes-ændringerne er bagudkompatible og kan blive stående.)
```

- [ ] **Step 2: Kør testen til grøn**

Run: `node --test backend/lib/testdb/roadmapHub.integration.test.js`
Expected: PASS, 22 tests.

- [ ] **Step 3: Kør RLS-audit og nabotests**

Run: `node --test backend/scripts/audit-rls-coverage.test.js backend/lib/testdb/`
Expected: PASS. Fejler audit'en på de tre nye tabeller, tilføjes de til dens dækningsliste i samme commit.

- [ ] **Step 4: Commit + draft-PR.** PR-body efter skabelonen (`scripts/preflight-pr.ps1` beskriver kravene), med pre-check-noterne fra Task 1.1 og post-verify-listen. `Refs #5387`.

### Task 1.4: Efter merge (orkestratoren, ikke workeren)

- [ ] Post-verify punkt 1-5 mod prod, straks efter `auto-migrate.yml`.
- [ ] Regenerér `database/schema-snapshot.json` og `frontend/src/types/database.types.ts` med repoets eksisterende generator, commit på main.
- [ ] Giv spor 2 og 3 besked: gaten er åben.

---

## Spor 2 · Spillersiden `/roadmap` (#6150)

**Files:**
- Create: `frontend/src/lib/roadmapModel.ts`, `frontend/src/lib/roadmapModel.test.ts`
- Create: `frontend/src/components/roadmap/PlanTab`, `VoteTab`, `KnownIssuesTab`, `DoneTab`, `ScoreScale` (filendelse jf. Global Constraints)
- Create: `frontend/tests/e2e/roadmap-hub.spec.js`
- Modify: `frontend/src/pages/RoadmapPage.jsx` (skrives om til tynd skal), `frontend/src/pages/RoadmapPage.test.js`
- Modify: `frontend/src/lib/roadmapVoting.js` + `.test.js`, `frontend/src/lib/roadmapUnread.ts` + `.test.ts`
- Modify: `frontend/public/locales/{en,da}/roadmap.json`
- Modify: `frontend/tests/e2e/roadmap-voting.spec.js` (tilpas til faner), `frontend/src/preview/mockHandlers.js`, `frontend/src/preview/seedData.js`
- Delete: `frontend/src/components/RoadmapAdminCreateForm.jsx`
- Touch (få linjer): `frontend/src/pages/HelpPage.jsx`, `frontend/src/components/RaceControlBanner.jsx`, `frontend/src/components/Layout.jsx`, `frontend/public/locales/{en,da}/help.json`

**Interfaces:**
- Consumes: kolonnerne i "Fælles kontrakt".
- Produces: `roadmapModel.ts` (nedenfor), URL-kontrakten `/roadmap?tab=plan|vote|issues|done`.

### Task 2.1: Ren model (TDD)

- [ ] **Step 1: Skriv den fejlende test** `frontend/src/lib/roadmapModel.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTab, partitionItems, isRated, countUnrated, filterUnrated,
  engineCounts, splitIssues, buildDoneList,
} from "./roadmapModel.ts";

const item = (over = {}) => ({
  id: "i1", engine: "races", sort_order: 10, title_en: "A", title_da: "A",
  approved: true, status: "active", horizon: "next",
  beta_since: null, beta_soon: false, live_soon: false,
  created_at: "2026-09-24T00:00:00Z", shipped_at: null, ...over,
});

test("parseTab falder tilbage til plan ved ukendt eller manglende værdi", () => {
  assert.equal(parseTab("vote"), "vote");
  assert.equal(parseTab("issues"), "issues");
  assert.equal(parseTab("beta"), "beta");
  assert.equal(parseTab("nope"), "plan");
  assert.equal(parseTab(null), "plan");
});

test("partitionItems deler efter status og horizon og sorterer på sort_order", () => {
  const p = partitionItems([
    item({ id: "a", status: "planned", horizon: "later", sort_order: 5 }),
    item({ id: "b", status: "planned", sort_order: 20 }),
    item({ id: "c", status: "planned", sort_order: 10 }),
    item({ id: "d", status: "in_progress" }),
    item({ id: "e", status: "active" }),
    item({ id: "f", status: "shipped", shipped_at: "2026-09-21T00:00:00Z" }),
    item({ id: "g", status: "archived" }),
    item({ id: "h", status: "in_progress", beta_since: "2026-10-01T00:00:00Z" }),
    item({ id: "k", status: "in_progress", beta_since: "2026-09-27T00:00:00Z", live_soon: true, sort_order: 90 }),
    item({ id: "j", status: "planned", beta_soon: true, sort_order: 30 }),
  ]);
  // I beta står kun på Beta-fanen; "snart for alle" først.
  assert.deepEqual(p.inBeta.map((i) => i.id), ["k", "h"]);
  assert.deepEqual(p.comingToBeta.map((i) => i.id), ["j"]);
  assert.deepEqual(p.plannedNext.map((i) => i.id), ["c", "b", "j"]);
  assert.deepEqual(p.plannedLater.map((i) => i.id), ["a"]);
  assert.deepEqual(p.inProgress.map((i) => i.id), ["d"]);
  assert.deepEqual(p.ideas.map((i) => i.id), ["e"]);
  assert.deepEqual(p.shipped.map((i) => i.id), ["f"]);
});

test("isRated: planlagt kræver kun vigtighed, idé kræver begge", () => {
  const planned = item({ status: "planned" });
  const idea = item({ status: "active" });
  assert.equal(isRated(planned, { item_id: "i1", idea_score: null, importance_score: 4 }), true);
  assert.equal(isRated(planned, undefined), false);
  assert.equal(isRated(idea, { item_id: "i1", idea_score: null, importance_score: 4 }), false);
  assert.equal(isRated(idea, { item_id: "i1", idea_score: 5, importance_score: 4 }), true);
});

test("countUnrated tæller pr. fane og samlet", () => {
  const items = [
    item({ id: "p1", status: "planned" }), item({ id: "p2", status: "planned" }),
    item({ id: "v1" }), item({ id: "v2" }), item({ id: "d", status: "in_progress" }),
  ];
  const votes = new Map([
    ["p1", { item_id: "p1", idea_score: null, importance_score: 3 }],
    ["v1", { item_id: "v1", idea_score: 6, importance_score: 2 }],
  ]);
  assert.deepEqual(countUnrated(items, votes), { plan: 1, vote: 1, total: 4, rated: 2 });
});

test("filterUnrated returnerer alt når filteret er slået fra", () => {
  const items = [item({ id: "v1" }), item({ id: "v2" })];
  const votes = new Map([["v1", { item_id: "v1", idea_score: 6, importance_score: 2 }]]);
  assert.deepEqual(filterUnrated(items, votes, false).map((i) => i.id), ["v1", "v2"]);
  assert.deepEqual(filterUnrated(items, votes, true).map((i) => i.id), ["v2"]);
});

test("engineCounts giver kun områder med punkter, i fast rækkefølge", () => {
  const counts = engineCounts([item({ engine: "club" }), item({ engine: "races" }), item({ engine: "club" })]);
  assert.deepEqual(counts, [{ key: "races", count: 1 }, { key: "club", count: 2 }]);
});

test("splitIssues: bekræftede og indmeldte hver for sig, lukkede kun de seneste 14 dage", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const iss = (over) => ({ id: "k", area: "races", status: "checking", title_en: "t", title_da: "t",
    sort_order: 0, created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z", closed_at: null, ...over });
  const s = splitIssues([
    iss({ id: "a", sort_order: 2 }), iss({ id: "b", sort_order: 1, status: "fixing" }),
    iss({ id: "e", sort_order: 3, status: "confirmed" }), iss({ id: "f", sort_order: 1 }),
    iss({ id: "c", status: "fixed", closed_at: "2026-10-01T00:00:00Z" }),
    iss({ id: "d", status: "fixed", closed_at: "2026-09-20T00:00:00Z" }),
    iss({ id: "g", status: "dismissed", closed_at: "2026-10-05T00:00:00Z" }),
  ], now);
  assert.deepEqual(s.confirmed.map((i) => i.id), ["b", "e"]);
  assert.deepEqual(s.checking.map((i) => i.id), ["f", "a"]);
  assert.deepEqual(s.recentlyFixed.map((i) => i.id), ["c"]);
  assert.deepEqual(s.recentlyDismissed.map((i) => i.id), ["g"]);
});

test("buildDoneList fletter features og fixes, nyeste først, med loft", () => {
  const done = buildDoneList(
    [item({ id: "f1", status: "shipped", shipped_at: "2026-09-21T00:00:00Z" }),
     item({ id: "f0", status: "shipped", shipped_at: null })],
    [{ id: "k1", area: "races", status: "fixed", title_en: "Fix", title_da: "Rettelse", sort_order: 0,
       created_at: "2026-09-29T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: "2026-10-01T00:00:00Z" }],
    30,
  );
  assert.deepEqual(done.map((d) => [d.id, d.kind]), [["k1", "fix"], ["f1", "feature"], ["f0", "feature"]]);
});
```

- [ ] **Step 2: Kør og se den fejle**

Run: `node --test frontend/src/lib/roadmapModel.test.ts` (fra repo-roden; følg samme kørselsmåde som `roadmapUnread.test.ts`)
Expected: FAIL, modulet findes ikke.

- [ ] **Step 3: Implementér** `frontend/src/lib/roadmapModel.ts`:

```ts
// Roadmap-hub (#5387): ren logik for de fire faner på /roadmap. Ingen React,
// ingen Supabase, så alt her kan testes med node --test.
import { ENGINE_ORDER, isValidScore } from "./roadmapVoting.js";

export type RoadmapStatus = "active" | "planned" | "in_progress" | "shipped" | "archived";
export type RoadmapHorizon = "next" | "later";
export type IssueStatus = "checking" | "confirmed" | "fixing" | "fixed" | "dismissed";
export type IssueArea = "races" | "training" | "youth" | "market" | "club" | "other";
export type RoadmapTab = "plan" | "beta" | "vote" | "issues" | "done";

export const ROADMAP_TABS: RoadmapTab[] = ["plan", "beta", "vote", "issues", "done"];
export const RECENTLY_FIXED_DAYS = 14;
export const DONE_PAGE_SIZE = 30;

export interface RoadmapItem {
  id: string; engine: string; sort_order: number; title_en: string; title_da: string;
  approved: boolean; status: RoadmapStatus; horizon: RoadmapHorizon;
  beta_since: string | null; beta_soon: boolean; live_soon: boolean;
  created_at: string; shipped_at: string | null;
}
export interface RoadmapVote { item_id: string; idea_score: number | null; importance_score: number | null; }
export interface KnownIssue {
  id: string; area: IssueArea; status: IssueStatus; title_en: string; title_da: string;
  sort_order: number; created_at: string; updated_at: string; closed_at: string | null;
}
export interface DoneEntry { id: string; kind: "feature" | "fix"; title_en: string; title_da: string; date: string | null; }

export function parseTab(param: string | null | undefined): RoadmapTab {
  return ROADMAP_TABS.includes(param as RoadmapTab) ? (param as RoadmapTab) : "plan";
}

const byOrder = (a: RoadmapItem, b: RoadmapItem) =>
  a.sort_order - b.sort_order || a.title_en.localeCompare(b.title_en);

export function partitionItems(items: RoadmapItem[] | null | undefined) {
  const list = items ?? [];
  const pick = (fn: (i: RoadmapItem) => boolean) => list.filter(fn).sort(byOrder);
  const inBetaNow = (i: RoadmapItem) => i.status === "in_progress" && !!i.beta_since;
  return {
    // I gang, men ikke i beta: det, der er i beta, står kun på Beta-fanen.
    inProgress: pick((i) => i.status === "in_progress" && !i.beta_since),
    inBeta: list.filter(inBetaNow).sort((a, b) => Number(b.live_soon) - Number(a.live_soon) || byOrder(a, b)),
    comingToBeta: pick((i) => i.beta_soon && !i.beta_since && (i.status === "planned" || i.status === "in_progress")),
    plannedNext: pick((i) => i.status === "planned" && i.horizon !== "later"),
    plannedLater: pick((i) => i.status === "planned" && i.horizon === "later"),
    ideas: pick((i) => i.status === "active"),
    shipped: list.filter((i) => i.status === "shipped"),
  };
}

export function isRated(item: RoadmapItem, vote: RoadmapVote | undefined): boolean {
  if (!vote || !isValidScore(vote.importance_score)) return false;
  return item.status === "planned" ? true : isValidScore(vote.idea_score);
}

export function countUnrated(items: RoadmapItem[], votes: Map<string, RoadmapVote>) {
  let plan = 0, vote = 0, total = 0;
  for (const item of items) {
    if (item.status !== "planned" && item.status !== "active") continue;
    total += 1;
    if (isRated(item, votes.get(item.id))) continue;
    if (item.status === "planned") plan += 1; else vote += 1;
  }
  return { plan, vote, total, rated: total - plan - vote };
}

export function filterUnrated(items: RoadmapItem[], votes: Map<string, RoadmapVote>, onlyUnrated: boolean) {
  return onlyUnrated ? items.filter((i) => !isRated(i, votes.get(i.id))) : items;
}

export function engineCounts(items: Array<{ engine: string }>) {
  return (ENGINE_ORDER as string[])
    .map((key) => ({ key, count: items.filter((i) => i.engine === key).length }))
    .filter((e) => e.count > 0);
}

export function splitIssues(issues: KnownIssue[] | null | undefined, now: Date = new Date()) {
  const list = issues ?? [];
  const cutoff = now.getTime() - RECENTLY_FIXED_DAYS * 86_400_000;
  const bySort = (a: KnownIssue, b: KnownIssue) => a.sort_order - b.sort_order;
  const recent = (status: IssueStatus) => list
    .filter((i) => i.status === status && i.closed_at && new Date(i.closed_at).getTime() >= cutoff)
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
  return {
    // Bekræftet af ejeren (spec §3.3): "Confirmed"-kortet.
    confirmed: list.filter((i) => i.status === "confirmed" || i.status === "fixing").sort(bySort),
    // Meldt ind af spillere, ikke bekræftet: "Reported, being checked"-kortet.
    checking: list.filter((i) => i.status === "checking").sort(bySort),
    recentlyFixed: recent("fixed"),
    recentlyDismissed: recent("dismissed"),
  };
}

export function buildDoneList(shipped: RoadmapItem[], issues: KnownIssue[], limit = DONE_PAGE_SIZE): DoneEntry[] {
  const entries: DoneEntry[] = [
    ...shipped.map((i) => ({ id: i.id, kind: "feature" as const, title_en: i.title_en, title_da: i.title_da, date: i.shipped_at })),
    ...issues.filter((k) => k.status === "fixed")
      .map((k) => ({ id: k.id, kind: "fix" as const, title_en: k.title_en, title_da: k.title_da, date: k.closed_at })),
  ];
  // Punkter uden dato (tre gamle shipped-rækker) lægges sidst.
  entries.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return entries.slice(0, limit);
}
```

- [ ] **Step 4: Udvid `roadmapVoting.js`.** Tilføj `horizon` til `ROADMAP_ITEM_COLUMNS` og en payload for én skala. Test først i `roadmapVoting.test.js`:

```js
test("buildImportancePayload sender kun importance_score (idea_score røres ikke)", () => {
  const p = buildImportancePayload({ itemId: "i1", userId: "u1", importanceScore: 4 });
  assert.equal(p.importance_score, 4);
  assert.equal("idea_score" in p, false);
  assert.throws(() => buildImportancePayload({ itemId: "i1", userId: "u1", importanceScore: 7 }));
});
```

```js
export const ROADMAP_ITEM_COLUMNS = "id, engine, sort_order, title_en, title_da, approved, status, horizon, beta_since, beta_soon, live_soon, created_at, shipped_at";

export function buildImportancePayload({ itemId, userId, importanceScore }) {
  if (!itemId || !userId) throw new Error("itemId and userId are required");
  if (!isValidScore(importanceScore)) throw new Error(`score must be an integer ${SCORE_MIN}-${SCORE_MAX}`);
  return { item_id: itemId, user_id: userId, importance_score: importanceScore, updated_at: new Date().toISOString() };
}
```

- [ ] **Step 5: Kør til grøn og commit**

Run: `node --test frontend/src/lib/roadmapModel.test.ts frontend/src/lib/roadmapVoting.test.js`
Expected: PASS.

### Task 2.2: Sideskal, faner og filter

- [ ] **Step 1:** Opdatér `RoadmapPage.test.js` først. Den skal nu kræve: `.in("status", ["active", "planned", "in_progress", "shipped"])` · privacy-linjerne (`.eq("user_id", uid)` + `votesByItemId(voteData, uid)`) står stadig · siden importerer ikke `RoadmapAdminCreateForm` og kalder ikke `rpc("is_admin")` · `known_issue_reports` hentes med `.eq("user_id", uid)`. Kør: FAIL.
- [ ] **Step 2:** Skriv `RoadmapPage.jsx` om. Skallen ejer hentning og tilstand; fanerne er rene visningskomponenter.

```jsx
// Hentning (uændret privacy-mønster, #1599). Fejl på known_issues behandles som
// tom liste, så en manglende tabel aldrig vælter Plan/Vote.
const [{ data: itemData }, { data: issueData }, { data: updateData }, { data: auth }] = await Promise.all([
  supabase.from("roadmap_items").select(ROADMAP_ITEM_COLUMNS)
    .eq("approved", true).in("status", ["active", "planned", "in_progress", "shipped"]).order("sort_order"),
  supabase.from("known_issues")
    .select("id, area, status, title_en, title_da, sort_order, created_at, updated_at, closed_at")
    .eq("published", true).order("sort_order"),
  supabase.from("known_issue_updates")
    .select("id, issue_id, body_en, body_da, created_at").order("created_at", { ascending: false }),
  supabase.auth.getUser(),
]);
// Kun indlogget: egne stemmer og egne reports.
supabase.from("roadmap_votes").select("item_id, idea_score, importance_score, user_id").eq("user_id", uid);
supabase.from("known_issue_reports").select("issue_id, user_id").eq("user_id", uid);
```

Tilstand: `tab` fra `useSearchParams` via `parseTab` (skift med `setSearchParams({ tab }, { replace: true })`, samme mønster som `AdminGrowthPage.jsx`) · `onlyUnrated` (default `true` når indlogget; læses/skrives i `localStorage` under `cz_roadmap_only_unrated` med try/catch) · `votes: Map` · `reports: Set<issue_id>`.

Stem-handlere:

```jsx
async function rateImportance(item, value) {           // Plan-fanen
  setVotes((prev) => new Map(prev).set(item.id, { ...(prev.get(item.id) ?? { item_id: item.id, idea_score: null }), importance_score: value }));
  const { error } = await supabase.from("roadmap_votes")
    .upsert(buildImportancePayload({ itemId: item.id, userId, importanceScore: value }), { onConflict: "user_id,item_id" });
  setSaveState((prev) => ({ ...prev, [item.id]: error ? "error" : "saved" }));
}
// Vote-fanen: eksisterende handleScore (gem når begge akser er valgt, buildVotePayload) flyttes uændret.

async function toggleReport(issue) {                   // Known issues
  const has = reports.has(issue.id);
  setReports((prev) => { const next = new Set(prev); has ? next.delete(issue.id) : next.add(issue.id); return next; });
  const q = supabase.from("known_issue_reports");
  const { error } = has
    ? await q.delete().eq("issue_id", issue.id).eq("user_id", userId)
    : await q.insert({ issue_id: issue.id, user_id: userId });
  if (error) setReports((prev) => { const next = new Set(prev); has ? next.add(issue.id) : next.delete(issue.id); return next; });
}
```

Layout: `PageHeader` (titel, undertekst; i handlingsklyngen `Checkbox` "Only what I have not rated" + tælleren fra `countUnrated`, begge kun for indloggede) → `Tabs`/`TabList` med fem `Tab` i rækkefølgen Plan, Beta, Vote, Known issues, Done (tal fra `countUnrated().plan`, `partitionItems().inBeta.length`, `countUnrated().vote` og `splitIssues().confirmed.length`) → fem `TabPanel`. `useDocumentHead` og `writeLastSeenRoadmap` bevares.

- [ ] **Step 3:** Kør `node --test frontend/src/pages/RoadmapPage.test.js`: PASS. Commit.

### Task 2.3: De fem faner

Markup og tekster følger `pr-screens/roadmap-4-10/roadmap-foer-efter.html` felt for felt (Beta-fanen og skalaen i to trin: `beta-overblik.html`; Known issues: `known-issues-to-grupper.html`). Hver fane er en ren komponent uden egen hentning.

- [ ] **`ScoreScale`** `{ label, value, disabled, onSelect, size }`: den nuværende `VoteAxis` flyttet ud. `role="radiogroup"`, knapper `w-7 h-7`, på telefon `min-w-[34px] min-h-[34px]`.
- [ ] **`PlanTab`** `{ inProgress, plannedNext, plannedLater, votes, saveState, canVote, language, onRate, lastSeen }`: `Section` "In progress" (rækker uden skala, meta-linje med område) + `Section` "Planned" (nummererede rækker, én `ScoreScale`; `plannedLater` i `CollapsibleSection` "Later · N more"). Tom plan med filter slået til: `EmptyState` med handling der slår filteret fra.
- [ ] **`BetaTab`** `{ inBeta, comingToBeta, betaState, language }`: `Section` "In beta now" med undertekst; række = mærke ("In beta" warning, eller "For everyone soon" success når `live_soon`), titel, meta (område · "in beta since" + dato fra `beta_since`). `Section` "Coming to beta" med mærket "Next in beta". Fanens ene primære knap "Join the beta" står i første korts header og fører til den eksisterende beta-ansøgning (find fladen via `frontend/src/pages/ProfilePage.jsx` og `backend/lib/betaAccess.js`; `betaState` er `member | pending | rejected | none`). Et medlem ser teksten "You are in the beta" i stedet for knappen; `pending` ser "Request sent". Ingen skalaer. Tom fane: `EmptyState` med "Join the beta" som handling.
- [ ] **`VoteTab`** `{ ideas, votes, saveState, canVote, language, onScore }`: `Segmented` fra `engineCounts(ideas)` plus "All"; skalaen i to trin: en række viser kun `ScoreScale` "Good idea?"; når den er valgt (eller der allerede findes en stemme), vises "Important to you?" under den (ingen layout-hop for resten af listen: kun rækken selv vokser); stille handling nederst med link til forummets Roadmap-kategori (se `frontend/src/components/forum/forumCategories.js` for ruten).
- [ ] **`KnownIssuesTab`** `{ confirmed, checking, recentlyFixed, recentlyDismissed, updatesByIssue, reports, canReport, language, onToggleReport }` (visuel reference: `pr-screens/roadmap-4-10/known-issues-to-grupper.html`): ét `Segmented` pr. område over to kort. Kortet "Confirmed" (undertekst "Problems I have seen myself or found the cause of."): `StatusBadge` confirmed → warning, fixing → info; knap "Affects me too". Kortet "Reported, being checked" (undertekst "Players have reported these. I have not confirmed them, and I am not promising a change."): neutralt mærke "Being checked"; knap "I see this too"; nederst `CollapsibleSection` "Checked, no problem found" med `recentlyDismissed` og ejerens forklaring (nyeste opdatering). Fælles for rækkerne: titel, meta, nyeste opdatering synlig og ældre i fold, `Button variant="secondary" size="sm"` der viser "Reported" efter tryk. `recentlyFixed` i egen `CollapsibleSection` nederst. Begge kort tomme: `EmptyState` med handling der fører til feedback-fladen.
- [ ] **`DoneTab`** `{ entries, language }`: dato (data-font, lokal formatering uden årstal), titel, mærke (Feature = neutral, Fix = success). "Show more" efter 30.
- [ ] **Udlogget:** `canVote`/`canReport` er `false`, skalaer og knap vises ikke, og én linje med login-link står over listen.
- [ ] **Loading:** mens data hentes, viser hver fane kortets chrome med et fast antal `Skeleton`-rækker (4) i samme højde som en rigtig række, så siden ikke hopper (CLS-reglen fra #5177). Antallet afhænger ikke længere af locale-filen.
- [ ] **Locale:** `roadmap.json` (en + da) får nøglerne `tabs.*`, `filter.*`, `plan.*`, `vote.*`, `issues.*`, `done.*`, `empty.*`, `loginToVote`. Fjern `admin.*`, `labels.today`, `labels.next`, `engines.*.today`, `engines.*.next`, `shipped.*` (behold `engines.*.title`, som bruges til områdenavne; tilføj `engines.other.title`). `help.json`: fjern `knownIssues.*` hvis ubrugt efter Task 2.4.
- [ ] **Slet** `RoadmapAdminCreateForm.jsx` (spor 3 bygger sin egen).
- [ ] Kør `npm run lint` og `node --test` i `frontend/`. Commit pr. fane.

### Task 2.4: Hjælp, banner, menu-prik, preview

- [ ] `HelpPage.jsx`: fjern fanen og hentningen af `fetchRecentOpsNotices`; `?section=knownIssues` giver `<Navigate to="/roadmap?tab=issues" replace />`. Fjern `fetchRecentOpsNotices` fra `lib/opsNotices.js`, hvis den ikke bruges andre steder.
- [ ] `RaceControlBanner.jsx`: linket peger på `/roadmap?tab=issues`.
- [ ] `roadmapUnread.ts` + `Layout.jsx`: `fetchLatestRoadmapDate` tager det nyeste af `roadmap_items.created_at` og `known_issues.created_at` (publicerede). Test i `roadmapUnread.test.ts`: `latestRoadmapCreatedAt` over en blandet liste.
- [ ] `preview/mockHandlers.js` + `seedData.js`: mock-svar for `known_issues`, `known_issue_updates`, `known_issue_reports` og de nye statusser, så preview-tilstanden viser alle fire faner med indhold.

### Task 2.5: E2E og verifikation

- [ ] `frontend/tests/e2e/roadmap-hub.spec.js` (mønster og mocks som `roadmap-voting.spec.js`): fane-skift opdaterer URL og dyb-link åbner rigtig fane · filteret skjuler et besvaret punkt og tælleren falder · stem på idé (to skalaer) sender begge tal · stem på planlagt sender kun `importance_score` · "Affects me too" slår til og fra · udlogget ser ingen skalaer · `/help?section=knownIssues` lander på `/roadmap?tab=issues` · 375 px: ingen vandret scroll (`document.documentElement.scrollWidth <= 375`).
- [ ] Opdatér `roadmap-voting.spec.js` til Vote-fanen. Snapshots i alle tre Playwright-projekter.
- [ ] TIER FULL: `pwsh -File scripts/verify-lock.ps1 -Max 2 -- pwsh -File scripts/verify-local.ps1`, `npm run lint`, `node --test`, build, hele `npm run test:e2e`, `pwsh -File scripts/preflight-pr.ps1`.
- [ ] Ét annoteret før/efter-billede (desktop + 375 px) i `pr-screens/<issue>/`, draft-PR, `Refs #5387`.

---

## Spor 3 · Admin-fanen (#6151)

**Files:**
- Create: `frontend/src/lib/roadmapAdminModel.ts`, `frontend/src/lib/roadmapAdminModel.test.ts`
- Create: `frontend/src/components/admin/growth/GrowthRoadmapTab` + `RoadmapAdminForms` (filendelse jf. Global Constraints)
- Touch: `frontend/src/pages/AdminGrowthPage.jsx` (ny fane `roadmap` i `GROWTH_TABS`, `Tab` og `TabPanel`)

**Interfaces:**
- Consumes: `roadmap_item_scores`, `known_issue_scores`, `roadmap_admin_stats()`, tabellerne i kontrakten; typerne `RoadmapStatus`, `RoadmapHorizon`, `IssueStatus`, `IssueArea` fra `roadmapModel.ts` (ejes af spor 2: findes filen ikke i dit worktree endnu, deklarér typerne lokalt i `roadmapAdminModel.ts` og notér i PR'en, at de samles ved merge).
- Produces: `/admin/growth?tab=roadmap`.

### Task 3.1: Ren model (TDD)

- [ ] **Step 1: Test** `roadmapAdminModel.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPLIT_SD, rankPlan, rankIdeas, rankIssues, isSplit, nextSortOrder, statusPatch } from "./roadmapAdminModel.ts";

const row = (over = {}) => ({ item_id: "a", status: "planned", title_en: "A", title_da: "A", votes: 10,
  avg_idea: 5, avg_importance: 4, steering_score: 14, sort_order: 10, horizon: "next", sd_importance: 1, ...over });

test("rankPlan: kun planned, højeste vigtighed først, null sidst", () => {
  const r = rankPlan([row({ item_id: "a", avg_importance: 4 }), row({ item_id: "b", avg_importance: 5.1 }),
    row({ item_id: "c", avg_importance: null }), row({ item_id: "d", status: "active" })]);
  assert.deepEqual(r.map((x) => x.item_id), ["b", "a", "c"]);
});
test("rankIdeas: kun active, højeste styringsscore først", () => {
  const r = rankIdeas([row({ item_id: "a", status: "active", steering_score: 9 }),
    row({ item_id: "b", status: "active", steering_score: 21 }), row({ item_id: "c" })]);
  assert.deepEqual(r.map((x) => x.item_id), ["b", "a"]);
});
test("isSplit bruger tærsklen 1,75", () => {
  assert.equal(SPLIT_SD, 1.75);
  assert.equal(isSplit(1.75), true); assert.equal(isSplit(1.74), false); assert.equal(isSplit(null), false);
});
test("rankIssues: bekræftede og indmeldte hver for sig, flest ramte først, lukkede udeladt", () => {
  const r = rankIssues([{ issue_id: "x", status: "fixing", reports: 3 }, { issue_id: "y", status: "confirmed", reports: 11 },
    { issue_id: "c", status: "checking", reports: 7 }, { issue_id: "z", status: "fixed", reports: 40 },
    { issue_id: "d", status: "dismissed", reports: 9 }]);
  assert.deepEqual(r.confirmed.map((x) => x.issue_id), ["y", "x"]);
  assert.deepEqual(r.checking.map((x) => x.issue_id), ["c"]);
});
test("nextSortOrder lægger et punkt sidst i planen med 10 i afstand", () => {
  assert.equal(nextSortOrder([row({ sort_order: 10 }), row({ sort_order: 30 })]), 40);
  assert.equal(nextSortOrder([]), 10);
});
test("statusPatch sætter og nulstiller shipped_at", () => {
  const now = "2026-10-06T10:00:00.000Z";
  assert.deepEqual(statusPatch("shipped", now), { status: "shipped", shipped_at: now });
  assert.deepEqual(statusPatch("planned", now), { status: "planned", shipped_at: null });
});
```

- [ ] **Step 2:** Kør: FAIL. **Step 3:** Implementér `roadmapAdminModel.ts` så testen er grøn (rene sorteringer og de to små helpers; ingen Supabase). **Step 4:** Kør: PASS. Commit.

### Task 3.2: Fanen

- [ ] `GrowthRoadmapTab`: henter `supabase.rpc("roadmap_admin_stats")`, `from("roadmap_item_scores").select("*")`, `from("known_issue_scores").select("*")` og seneste opdatering pr. fejl. Fire blokke som i billedets "Bagved"-felt:
  1. Nøgletal (`HeroStats`-anatomi: label `text-3xs` uppercase, værdi data-font tabular).
  2. "Planen, som spillerne vil have den" (`DataTable`, rækker fra `rankPlan`): punkt, vigtighed, stemmer, din rækkefølge, mærket "Deler spillerne" ved `isSplit`. Handlinger (secondary sm): flyt op/ned (bytter `sort_order` med naboen), status (`Select` → `statusPatch`), Next/Later, ret titel.
  3. "Idéer" (`rankIdeas`): god idé, vigtighed, score, stemmer. Handling "Til planen": `update({ status: "planned", horizon: "next", sort_order: nextSortOrder(plan) })`.
  4. "Kendte fejl" i to tabeller fra `rankIssues` ("Bekræftet" og "Meldt ind, tjekkes"): trin, ramt, åben i dage. Handlinger: "Ny opdatering" (insert i `known_issue_updates` + `updated_at = now` på fejlen), "Trin" (tjekkes, bekræftet, rettes, rettet, lukket uden fund; `fixed` og `dismissed` sætter `closed_at = now`, andre trin nulstiller den). "Lukket uden fund" kræver, at der skrives en opdatering med forklaringen i samme handling.
- [ ] `RoadmapAdminForms`: opret/ret punkt (område, EN, DA, status, horizon, issue_ref, godkendt) og opret/ret fejl (område, EN, DA, trin, issue_ref, publiceret). Validering: begge titler udfyldt. Fejl vises med `ErrorState`-anatomien; "Prøv igen" er secondary.
- [ ] "Del punkt" (færdig-reglen, spec §2 punkt 6): handling på hver række i plan- og idé-tabellen. Formularen beder om restens titel (EN + DA), status og Next/Later og kalder `supabase.rpc("roadmap_split_item", { p_source, p_title_en, p_title_da, p_status, p_horizon, p_issue_ref })`. Det nye punkt vises med mærket "Skjult", til ejeren slår "godkendt" til. Formularen minder om næste skridt: ret det oprindelige punkts titel til det, der er live, og sæt det til færdig.
- [ ] Beta-kobling (spec §4/§5.6): punkt-formularen får `flag_key` som `Select` over stadie-kontakterne (samme kilde som `components/admin/sections/FeatureFlagBoardSection.jsx` bruger) og de to hak "Næste i beta" (`beta_soon`) og "Snart for alle" (`live_soon`). Plan-tabellen viser en kolonne "Kontakt" med nøgle og nuværende stadie. Formularen fortæller, at status derefter følger kontakten.
- [ ] Idé-pulje (spec §4): egen tabel over idéer med `approved = false` (`roadmap_item_scores` hvor `status = 'active'`), med handlingen "Vis på Vote" (sætter `approved = true`) og "Tag af Vote" på synlige idéer. Over tabellen: "Synlige idéer: N (mål ca. 30)".
- [ ] Alle øvrige skrivninger går direkte mod Supabase bag `is_admin()`-policies (samme mønster som den slettede `RoadmapAdminCreateForm.jsx`). Efter en skrivning genhentes de to views.
- [ ] Rækker med `approved = false` / `published = false` vises med mærket "Skjult".
- [ ] Dansk tekst, hardcoded som resten af admin. `npm run lint`, `node --test`, build, `node scripts/verify-affected.mjs`. Før/efter-billede, draft-PR, `Refs #5388`.

---

## Spor 4 · Færdig-rutinen (#6152)

**Files:**
- Create: `scripts/roadmap-flip.mjs`, `scripts/roadmap-flip.test.mjs`
- Touch: `docs/GITHUB_WORKFLOW.md` (close-protokollen)

**Interfaces:**
- Consumes: `roadmap_items.issue_ref`, `known_issues.issue_ref`.
- Produces: `node scripts/roadmap-flip.mjs --issue N [--apply]`.

### Task 4.1: Planlæggeren (TDD)

- [ ] **Step 1: Test** `scripts/roadmap-flip.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { planFlips } from "./roadmap-flip.mjs";

const NOW = "2026-10-06T10:00:00.000Z";

test("planFlips finder punkter og fejl med issue_ref og foreslår færdig-status", () => {
  const plan = planFlips({
    issue: 5435, now: NOW,
    items: [{ id: "a", issue_ref: 5435, status: "in_progress", title_en: "Secondary type" },
            { id: "b", issue_ref: 5435, status: "shipped", title_en: "Already" },
            { id: "c", issue_ref: 1, status: "planned", title_en: "Other" }],
    issues: [{ id: "k", issue_ref: 5435, status: "fixing", title_en: "Bug" }],
  });
  assert.deepEqual(plan, [
    { table: "roadmap_items", id: "a", title: "Secondary type", from: "in_progress", patch: { status: "shipped", shipped_at: NOW } },
    { table: "known_issues", id: "k", title: "Bug", from: "fixing", patch: { status: "fixed", closed_at: NOW, updated_at: NOW } },
  ]);
});

test("planFlips er tom når intet matcher eller alt allerede er færdigt", () => {
  assert.deepEqual(planFlips({ issue: 9, now: NOW, items: [], issues: [] }), []);
});

test("planFlips afviser et issue-nummer der ikke er et positivt heltal", () => {
  assert.throws(() => planFlips({ issue: "abc", now: NOW, items: [], issues: [] }));
});
```

- [ ] **Step 2:** Kør `node --test scripts/roadmap-flip.test.mjs`: FAIL.
- [ ] **Step 3: Implementér.** `planFlips` er ren og eksporteres:

```js
export function planFlips({ issue, now, items, issues }) {
  if (!Number.isSafeInteger(issue) || issue < 1) throw new Error("--issue skal være et positivt heltal");
  return [
    ...items.filter((i) => i.issue_ref === issue && i.status !== "shipped" && i.status !== "archived")
      .map((i) => ({ table: "roadmap_items", id: i.id, title: i.title_en, from: i.status, patch: { status: "shipped", shipped_at: now } })),
    ...issues.filter((k) => k.issue_ref === issue && k.status !== "fixed" && k.status !== "dismissed")
      .map((k) => ({ table: "known_issues", id: k.id, title: k.title_en, from: k.status, patch: { status: "fixed", closed_at: now, updated_at: now } })),
  ];
}
```

CLI-delen (kører kun når filen startes direkte): læs `--issue` og `--apply`; opret Supabase-klient med service-role-nøglen fra miljøet på samme måde som repoets øvrige prod-scripts (find mønstret i et eksisterende `scripts/*.mjs` der bruger `createClient`; kør via `infisical run`, print aldrig nøglen); hent de to tabeller; print planen som tabel; uden `--apply` afsluttes med "dry-run, intet skrevet"; med `--apply` køres hver `patch` som `update().eq("id", id)` og resultatet verificeres med en efterfølgende select.

- [ ] **Step 4:** Kør testen: PASS. Kør `node scripts/roadmap-flip.mjs --issue 1` uden nøgle og bekræft en læsbar fejl (ingen stack trace med hemmeligheder). Commit.

### Task 4.2: Rutinen i docs

- [ ] Tilføj til close-protokollen i `docs/GITHUB_WORKFLOW.md`: ved PR der lukker et issue køres `node scripts/roadmap-flip.mjs --issue N` (dry-run). Et fund skrives i go-kortet som "flytter roadmap-punktet X til Done", så ejerens "merge" dækker flyttet. `--apply` køres efter merge, og først når funktionen er live for alle (ikke beta). Kør `pwsh -File scripts/check-agent-token-hygiene.ps1` bagefter.
- [ ] Draft-PR, `Refs #5387`.

---

## Spor 5 · Patch notes: beta-filter og mærke der følger kontakten (#6154)

**Files:**
- Modify: `frontend/src/lib/patchNotes.js` + `frontend/src/lib/patchNotes.test.js`
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/src/data/patchNotes.js` (kun feltet `flag` på eksisterende beta-noter)
- Modify: `frontend/public/locales/{en,da}/patchnotes.json`
- Touch: `docs/PATCH_NOTES_RULES.md` §2a og den eksisterende patch notes-kontrol i `scripts/` (find den med `grep -rl "rollout" scripts`)

**Interfaces:**
- Consumes: `GET /api/feature-flags` uden Authorization-header (svaret `{ flags: { <nøgle>: boolean } }` er evalueret anonymt: `true` = slået til for alle). Kun nøgler i `PLAYER_VISIBLE_FLAG_KEYS` (`backend/lib/stageFlagCatalog.js`) findes i svaret.
- Produces: `effectiveRollout(change, liveFlags)` og `filterByRollout(changes, mode, liveFlags)`.

### Task 5.1: Ren logik (TDD)

- [ ] **Step 1: Test** i `frontend/src/lib/patchNotes.test.js`:

```js
import { effectiveRollout, filterByRollout } from "./patchNotes.js";

test("effectiveRollout: en beta-note med flag der er on for alle, læses som beta_to_live", () => {
  const change = { rollout: "beta", flag: "training_groups" };
  assert.equal(effectiveRollout(change, { training_groups: true }), "beta_to_live");
  assert.equal(effectiveRollout(change, { training_groups: false }), "beta");
  assert.equal(effectiveRollout(change, {}), "beta");          // ukendt kontakt: som skrevet
  assert.equal(effectiveRollout(change, null), "beta");        // kaldet fejlede: som skrevet
});

test("effectiveRollout: noter uden flag og gamle stage:beta-noter er uændrede", () => {
  assert.equal(effectiveRollout({ rollout: "live" }, { x: true }), "live");
  assert.equal(effectiveRollout({ stage: "beta" }, {}), "beta");
  assert.equal(effectiveRollout({ rollout: "beta_to_live" }, {}), "beta_to_live");
});

test("filterByRollout: all, beta og now_live", () => {
  const changes = [
    { id: 1, rollout: "beta", flag: "a" }, { id: 2, rollout: "beta", flag: "b" },
    { id: 3, rollout: "beta_to_live" }, { id: 4, rollout: "live" },
  ];
  const flags = { a: true, b: false };
  assert.deepEqual(filterByRollout(changes, "all", flags).map((c) => c.id), [1, 2, 3, 4]);
  assert.deepEqual(filterByRollout(changes, "beta", flags).map((c) => c.id), [2]);
  assert.deepEqual(filterByRollout(changes, "now_live", flags).map((c) => c.id), [1, 3]);
});
```

- [ ] **Step 2:** Kør `node --test frontend/src/lib/patchNotes.test.js`: FAIL.
- [ ] **Step 3: Implementér** i `frontend/src/lib/patchNotes.js`:

```js
// Roadmap-hub (#5387): en beta-note følger sin kontakt. Er kontakten slået til
// for alle, læses noten som "beta_to_live" uden at datafilen skal rettes.
export function effectiveRollout(change, liveFlags) {
  const written = change.rollout || (change.stage === "beta" ? "beta" : "live");
  if (written === "beta" && change.flag && liveFlags && liveFlags[change.flag] === true) return "beta_to_live";
  return written;
}

export function filterByRollout(changes, mode, liveFlags) {
  if (mode === "beta") return changes.filter((c) => effectiveRollout(c, liveFlags) === "beta");
  if (mode === "now_live") return changes.filter((c) => effectiveRollout(c, liveFlags) === "beta_to_live");
  return changes;
}
```

- [ ] **Step 4:** Kør testen: PASS. Commit.

### Task 5.2: Siden, data og reglen

- [ ] `PatchNotesPage.jsx`: hent de anonyme flag én gang (genbrug det anonyme kald i `frontend/src/lib/featureStage.ts`; eksportér det derfra frem for at kopiere det). `rolloutOf(change)` bruger `effectiveRollout(change, liveFlags)`. Tilføj et filter med tre valg (All / Beta / Now for everyone) i samme filterrække som kategorierne, med `Segmented`. Filteret kombineres med kategori og søgning. Tom liste: eksisterende `EmptyState`.
- [ ] `frontend/src/data/patchNotes.js`: tilføj `"flag": "<nøgle>"` på de eksisterende `rollout: "beta"`-noter, hvor kontakten er entydig (slå op via notens `refs` og `docs/FEATURE_REGISTRY.yml`). Rør ingen tekst. Noter, hvor kontakten ikke kan afgøres, listes i PR'en.
- [ ] Patch notes-kontrollen: en NY note med `rollout: "beta"` uden `flag` fejler (ratchet: eksisterende noter uden `flag` er undtaget via en eksplicit liste).
- [ ] Locale: nøglerne `filter.rollout.all`, `filter.rollout.beta`, `filter.rollout.nowLive` (en + da). `docs/PATCH_NOTES_RULES.md` §2a: beskriv `flag`-feltet og den automatiske mærke-skift.
- [ ] `npm run lint`, `node --test`, build, `node scripts/verify-affected.mjs`, e2e for patch notes-siden. Før/efter-billede, draft-PR, `Refs #5387`.

---

## Efter bølgen (orkestrator)

1. Merge-kø, én ad gangen (`scripts/merge-queue.ps1`): spor 1 → post-verify → spor 4 → spor 5 → spor 3 → spor 2. Hvert UI-spor kræver ejerens "merge" på preview.
2. Indhold: ejer-godkendt `docs/drafts/2026-10-04-roadmap-indhold.md` skrives til prod i samme session som spor 2 går live (statusser, horizon, issue_ref, nye idéer, kendte fejl + første opdatering). Stemmetallet før og efter skal være ens.
3. Patch note (EN først) + `help.json`, `FEATURE_REGISTRY.yml` + `node scripts/generate-feature-status.mjs`, NOW.md, statusboard, done-flip på issues.
4. Ejeren poster selv i Discord.

## Spec-dækning

| Spec | Spor/Task |
|---|---|
| §3 sidehoved, faner, filter, tæller | 2.1, 2.2 |
| §3.1 Plan · §3.2 Vote (to trin) · §3.3 Known issues (to felter) · §3.4 Done · §3.5 Beta · §3.6 tilstande | 2.1, 2.3, 2.5 |
| §5.6 beta-kobling | 1.2, 1.3, 3.2 |
| §6b patch notes | 5.1, 5.2 |
| §3.3 Hjælp-viderestilling og banner-link | 2.4 |
| §4 admin | 3.1, 3.2 |
| §5 data | 1.2, 1.3 |
| §6 kode, menu-prik | 2.3, 2.4 |
| §7 færdig-rutine | 4.1, 4.2 |
| §8 indhold · §9 rækkefølge | "Efter bølgen" |
| §10 test | 1.2, 2.1, 2.5, 3.1, 4.1 |
