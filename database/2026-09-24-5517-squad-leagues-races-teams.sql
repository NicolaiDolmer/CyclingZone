-- #5517 · Trup-datamodel A2: league_divisions.squad + races.squad + holdenes
--          ungdomspuljer (teams.u23_/junior_league_division_id)
--
-- Spec: docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md
--       §3.2 "Slice 2: pulje og løb", §3.3 (RLS), §10.2 (arkitekt-valg A: ét felt
--       pr. ungdomstrup på teams, ingen team_squad_divisions-tabel).
-- Slice 1 (riders.squad): database/2026-09-15-4619-riders-squad.sql.
--
-- HVAD DEN GØR (alt additivt — ingen række mutteres, ingen kolonne fjernes)
--   1) league_divisions.squad TEXT NOT NULL DEFAULT 'senior' + CHECK
--   2) pulje-nøglen udvides: UNIQUE (squad, tier, pool_index) oprettes, og den gamle
--      UNIQUE (tier, pool_index) droppes. Uden det kan en U23-pulje ikke hedde
--      tier 1 / pulje 0 ved siden af seniorernes Division 1.
--   3) races.squad TEXT NOT NULL DEFAULT 'senior' + CHECK + idx (season_id, squad)
--   4) teams.u23_league_division_id + teams.junior_league_division_id
--      (INTEGER FK → league_divisions, ON DELETE SET NULL) + FK-indekser + kolonne-grant
--   5) NOTIFY pgrst
--
-- HVAD DEN BEVIDST IKKE GØR
--   • SEEDER INGEN UNGDOMSPULJER. U23-/junior-puljerne afhænger af felt-gaten C1
--     (YOUTH_RULES.md §2, spec §4.4/§10.4) og ejer-go, ikke af denne migration.
--     Efter den står ALLE puljer og ALLE løb som 'senior' (kolonnens DEFAULT), og
--     ingen holds ungdoms-FK er sat.
--   • RØRER IKKE season_standings (squad-kolonnen dér er spor B3).
--   • RØRER IKKE CHECK (tier IN (1,2,3,4)). U23 får egne tier 1-N under
--     squad='u23', ikke tier 5-8, fordi MIN_DIVISION/MAX_DIVISION og
--     DIVISION_BONUSES kun kender 1-4 (spec §3.2).
--   • INGEN nye RLS-policies. "Public read races" er USING (true), og
--     league_divisions har en tabel-niveau SELECT-grant (2026-06-21-league-
--     divisions-pyramid.sql) — begge nye squad-kolonner er dermed læsbare som resten
--     af rækken (spec §3.3).
--
-- BIT-IDENTISK I DAG
-- Hver eksisterende pulje og hvert eksisterende løb får squad = 'senior', og den nye
-- pulje-nøgle (squad, tier, pool_index) er præcis lige så streng som den gamle, så
-- længe alle rækker har samme squad. Backend-læserne scoper på squad = 'senior'
-- (backend/lib/squads.js withSeniorSquadScope) og ser derfor de samme rækker som før.
--
-- CHECK ... NOT VALID + VALIDATE
-- Constrainten tilføjes NOT VALID (ingen tabelscan under ACCESS EXCLUSIVE) og
-- valideres bagefter i sit eget skridt (SHARE UPDATE EXCLUSIVE — læsere og
-- skrivere kører videre). Alle rækker har DEFAULT 'senior', så valideringen kan
-- ikke fejle. VALIDATE på en allerede valideret constraint er en no-op, så en
-- genkørsel er ufarlig.
--
-- IDEMPOTENT: IF NOT EXISTS på kolonner/indekser, constraints guardet i DO-blokke
-- mod pg_constraint. Den gamle pulje-nøgle findes på KOLONNERNE, ikke på navnet, så
-- dropningen virker uanset hvad Postgres auto-navngav den. Anden kørsel = no-op.
--
-- APPLIES af auto-migrate.yml ved merge (#2642). Koden i samme PR tåler vinduet før
-- apply: withSeniorSquadScope falder tilbage til en uscopet læsning på 42703
-- (kolonnen findes ikke endnu → ingen ungdomsrækker kan findes).

BEGIN;

-- ── 1) league_divisions.squad ───────────────────────────────────────────────
ALTER TABLE public.league_divisions
  ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';

COMMENT ON COLUMN public.league_divisions.squad IS
  'Trup puljen hører til: senior | u23 | junior (#5517, spec §3.2). Ungdomspuljer '
  'bruger samme tier 1-4 som seniorerne, adskilt af squad. Seniorlæsere scoper via '
  'backend/lib/squads.js withSeniorSquadScope.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.league_divisions'::regclass
      AND conname = 'league_divisions_squad_check'
  ) THEN
    ALTER TABLE public.league_divisions
      ADD CONSTRAINT league_divisions_squad_check
      CHECK (squad IN ('senior', 'u23', 'junior')) NOT VALID;
  END IF;
END $$;

-- ── 2) Pulje-nøglen: (tier, pool_index) → (squad, tier, pool_index) ────────
-- Den nye nøgle oprettes FØR den gamle droppes: fejler oprettelsen, er intet tabt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.league_divisions'::regclass
      AND conname = 'league_divisions_squad_tier_pool_index_key'
  ) THEN
    ALTER TABLE public.league_divisions
      ADD CONSTRAINT league_divisions_squad_tier_pool_index_key
      UNIQUE (squad, tier, pool_index);
  END IF;
END $$;

-- Drop ENHVER unik constraint der dækker præcis (tier, pool_index) — fundet på
-- kolonnerne, ikke på navnet. Den oprindelige blev erklæret inline i CREATE TABLE
-- (2026-06-21-league-divisions-pyramid.sql) og auto-navngivet af Postgres.
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.league_divisions'::regclass
       AND c.contype = 'u'
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(c.conkey) AS k(attnum)
           JOIN pg_attribute a
             ON a.attrelid = c.conrelid
            AND a.attnum = k.attnum
       ) = ARRAY['pool_index', 'tier']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.league_divisions DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

-- ── 3) races.squad ──────────────────────────────────────────────────────────
-- Bevidst denormaliseret (spec §3.2): raceEntryGenerator og kalender-læserne henter
-- løb uden join til league_divisions og skal kunne scope direkte på løbsrækken.
ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';

COMMENT ON COLUMN public.races.squad IS
  'Trup løbet køres af: senior | u23 | junior (#5517, spec §3.2). Denormaliseret fra '
  'league_divisions.squad, så læsere kan scope uden join. Seniorlæsere scoper via '
  'backend/lib/squads.js withSeniorSquadScope.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.races'::regclass
      AND conname = 'races_squad_check'
  ) THEN
    ALTER TABLE public.races
      ADD CONSTRAINT races_squad_check
      CHECK (squad IN ('senior', 'u23', 'junior')) NOT VALID;
  END IF;
END $$;

-- Sæson-læserne (kalender, planlægger, udtagelse, resultater) filtrerer på
-- (season_id, squad = 'senior').
CREATE INDEX IF NOT EXISTS idx_races_season_squad
  ON public.races (season_id, squad);

-- ── 4) teams: holdets ungdomspuljer (spec §10.2, arkitekt-valg A) ──────────
-- Spejler teams.league_division_id: én kolonne pr. ungdomstrup. NULL = holdet har
-- (endnu) ingen pulje for den trup — og det er tilstanden for ALLE hold efter denne
-- migration. ON DELETE SET NULL: en nedlagt ungdomspulje må aldrig kunne blokere
-- eller slette et hold.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS u23_league_division_id INTEGER
    REFERENCES public.league_divisions(id) ON DELETE SET NULL;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS junior_league_division_id INTEGER
    REFERENCES public.league_divisions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.teams.u23_league_division_id IS
  'Holdets U23-pulje (league_divisions med squad = ''u23''), #5517 / spec §10.2 A. '
  'NULL indtil ungdomspuljerne seedes (C1 + ejer-go).';
COMMENT ON COLUMN public.teams.junior_league_division_id IS
  'Holdets junior-pulje (league_divisions med squad = ''junior''), #5517 / spec §10.2 A. '
  'NULL indtil junior-pyramiden findes (#4621).';

-- #1162-mønsteret: teams.league_division_id fik en eksplicit kolonne-grant i
-- 2026-06-21-league-divisions-pyramid.sql. Ungdoms-puljerne er lige så offentlige
-- (spec §7: "Youth races"-siden viser holdets U23-pulje), så samme grant her.
GRANT SELECT (u23_league_division_id, junior_league_division_id)
  ON public.teams TO anon, authenticated;

-- FK-indekser: ON DELETE SET NULL på en pulje skanner teams uden dem, og Supabase-
-- advisoren melder ellers unindexed_foreign_keys.
CREATE INDEX IF NOT EXISTS idx_teams_u23_league_division
  ON public.teams (u23_league_division_id);
CREATE INDEX IF NOT EXISTS idx_teams_junior_league_division
  ON public.teams (junior_league_division_id);

COMMIT;

-- ── 5) Validér CHECK-constraints (uden for transaktionen, se headeren) ─────
ALTER TABLE public.league_divisions VALIDATE CONSTRAINT league_divisions_squad_check;
ALTER TABLE public.races VALIDATE CONSTRAINT races_squad_check;

NOTIFY pgrst, 'reload schema';

-- ── POST-VERIFY (køres af Claude efter auto-migrate, #2642) ─────────────────
--
--   -- kolonnerne findes med default + not null
--   SELECT table_name, column_name, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN (('league_divisions','squad'), ('races','squad'),
--           ('teams','u23_league_division_id'), ('teams','junior_league_division_id'))
--    ORDER BY 1, 2;
--
--   -- constraints: begge CHECK validerede, ny unik nøgle findes, den gamle er væk
--   SELECT conrelid::regclass AS rel, conname, contype, convalidated,
--          pg_get_constraintdef(oid) AS def
--     FROM pg_constraint
--    WHERE conrelid IN ('public.league_divisions'::regclass, 'public.races'::regclass)
--      AND (conname LIKE '%squad%' OR contype = 'u')
--    ORDER BY 1, 2;
--
--   -- FK'erne på teams (ON DELETE SET NULL = confdeltype 'n')
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'public.teams'::regclass
--      AND conname IN ('teams_u23_league_division_id_fkey', 'teams_junior_league_division_id_fkey');
--
--   -- indekserne
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname IN ('idx_races_season_squad', 'idx_teams_u23_league_division',
--                        'idx_teams_junior_league_division');
--
--   -- bit-identisk: alt er senior, ingen hold har en ungdomspulje
--   SELECT 'league_divisions' AS rel, squad, count(*) FROM public.league_divisions GROUP BY squad
--   UNION ALL
--   SELECT 'races', squad, count(*) FROM public.races GROUP BY squad;
--   SELECT count(*) FILTER (WHERE u23_league_division_id IS NOT NULL) AS u23,
--          count(*) FILTER (WHERE junior_league_division_id IS NOT NULL) AS junior
--     FROM public.teams;
