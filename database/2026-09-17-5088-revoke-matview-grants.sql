-- =============================================================================
-- 2026-09-17 — #5088: fjern de resterende SKRIVE-grants til `authenticated`
-- på de fire rangliste-matviews
-- =============================================================================
-- Trin 3 af matview-lukningen. Applies af auto-migrate.yml ved merge (#2642).
-- Claude post-verificerer grants + advisor efter merge (kommandoer nederst).
--
-- ── HVAD #5176 LUKKEDE, OG HVAD DER BLEV TILBAGE ────────────────────────────
-- `database/2026-09-13-5176-revoke-matview-select.sql` (merged 13/9, applied
-- samme aften) kørte `REVOKE SELECT ... FROM PUBLIC, anon, authenticated`.
-- SELECT er kun ÉN af de syv privilegie-bits. Triagen i #5088 (10/9) målte
-- `pg_class.relacl` og fandt:
--
--   global_rank_mv        = authenticated=arwdxtm/postgres
--   rider_rankings_mv     = authenticated=arwdxtm/postgres
--   team_race_points_mv   = authenticated=arwdxtm/postgres
--   team_standings_ext_mv = authenticated=arwdxtm/postgres
--
-- `arwdxtm` = INSERT + SELECT + UPDATE + DELETE + REFERENCES + TRIGGER +
-- MAINTAIN. Det er aftrykket af et historisk `GRANT ALL ... TO authenticated`,
-- ikke et bevidst valg (de eksplicitte grants i migrationshistorikken er alle
-- `GRANT SELECT`, fx `2026-07-04-ranking-matviews.sql:78`). #5176's
-- `REVOKE SELECT` fjernede `r`. `awdxtm` står tilbage.
--
-- ── RISIKO I DAG: LAV, MEN GRANTET ER STADIG FORKERT ────────────────────────
-- Postgres afviser direkte DML mod en materialized view, og PostgREST
-- eksponerer ikke `REFRESH MATERIALIZED VIEW`, så `m`-bittet er ikke nåbart
-- over Data API'et. Det her er derfor hygiejne, ikke incident-lukning: en ACL
-- der er langt bredere end hensigten er præcis den klasse #2901 handler om, og
-- den overlever et schema-restore hvis den ikke fjernes eksplicit.
--
-- ── INGEN `GRANT SELECT` TILBAGE TIL `authenticated` (bevidst) ──────────────
-- Issuets oprindelige forslag (10/9) gav SELECT tilbage til `authenticated`,
-- fordi ranglisterne er offentlig spil-information. Den forudsætning holder
-- ikke længere: #5176/PR #5183 (merged 13/9) flyttede ALLE ti klient-reads bag
-- `backend/routes/rankings.ts`, som læser matviews med service_role-klienten
-- bag `requireAuth`. Verificeret i denne PR:
--   · 0 direkte PostgREST-reads i frontend: ingen `from("<mv>")` i
--     `frontend/src/**` uden for to negative tests, der netop FORBYDER dem
--     (`SeasonEndPage.honours.test.js:41`).
--   · Alle reads er backend-side: `backend/routes/rankings.ts:52,56,63,70,78,
--     88,97`, `backend/routes/rankingHonours.ts:34` (`admin.from(...)`),
--     `backend/lib/seasonEndedPersonalization.js:106,135`,
--     `backend/scripts/compressPyramidS3.js:292`.
-- Et `GRANT SELECT` tilbage ville derfor gen-åbne 0016-advisoren uden at nogen
-- klient havde brug for den. `service_role` beholder SELECT (re-asserteres
-- nedenfor, defensivt — #5176 gav den allerede).
--
-- ── IDEMPOTENS ─────────────────────────────────────────────────────────────
-- Ren `REVOKE`/`GRANT`. Ingen DDL, ingen rækker, ingen view-definitioner,
-- ingen refresh-RPC'er. En gen-kørsel er et no-op, også hvis grantet allerede
-- er væk (Postgres fejler ikke på REVOKE af et privilegium der ikke findes).
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   GRANT SELECT ON TABLE public.rider_rankings_mv, public.global_rank_mv,
--     public.team_standings_ext_mv, public.team_race_points_mv TO authenticated;
-- (kun SELECT — gen-skab ALDRIG `GRANT ALL`.)

BEGIN;

-- PUBLIC og anon tages med for at forhindre at et arvet grant slår de
-- eksplicitte rolle-revokes ihjel. anon var allerede revoket i #3124 og
-- re-asserteret i #5153 §E; det her er samme defensive mønster.
REVOKE ALL ON TABLE
  public.rider_rankings_mv,
  public.global_rank_mv,
  public.team_standings_ext_mv,
  public.team_race_points_mv
FROM PUBLIC, anon, authenticated;

-- Backend læser matviews med service_role (backend/routes/rankings.ts).
-- REVOKE ovenfor rører ikke service_role, men grantet re-asserteres så et
-- schema-restore ikke efterlader backenden uden læseadgang.
GRANT SELECT ON TABLE
  public.rider_rankings_mv,
  public.global_rank_mv,
  public.team_standings_ext_mv,
  public.team_race_points_mv
TO service_role;

COMMIT;

-- ── Post-merge verifikation (read-only, køres af Claude efter auto-migrate) ──
-- V1. Ingen privilegie-bits tilbage til klientrollerne (forvent 4 tomme
--     aclitem-strenge for anon/authenticated; kun postgres + service_role):
--   SELECT c.relname, array_to_string(c.relacl, '|') AS acl
--   FROM pg_class c
--   WHERE c.relkind = 'm' AND c.relnamespace = 'public'::regnamespace
--   ORDER BY c.relname;
--   -- Forvent INGEN 'authenticated=' og INGEN 'anon=' i acl-strengen.
--
-- V2. Tabel- og kolonneprivilegier (forvent f/f/t hhv. f/f pr. række):
--   SELECT name,
--     has_table_privilege('anon', name, 'SELECT')           AS anon_select,
--     has_table_privilege('authenticated', name, 'SELECT')  AS auth_select,
--     has_table_privilege('service_role', name, 'SELECT')   AS service_select,
--     has_any_column_privilege('authenticated', name, 'SELECT') AS auth_col
--   FROM unnest(ARRAY['public.rider_rankings_mv', 'public.global_rank_mv',
--     'public.team_standings_ext_mv', 'public.team_race_points_mv']) AS name;
--
-- V3. `get_advisors(type: 'security')`: forvent 0016 = 0 (uændret fra #5176)
--     og 3 x 0029 (`founder_public_list`, `is_admin`,
--     `is_offered_intake_rider`). Rapportér ALDRIG "0 WARN" — de tre 0029 er
--     dokumenteret bevidst åbne i docs/SUPABASE_SECURITY_ADVISORS.md.
--
-- V4. Røgtest med en almindelig authenticated manager: /standings (begge faner),
--     rytter-ranglisten, holdstatistik-fanen, dashboard og season-honours skal
--     stadig loade — de går alle gennem /api/rankings, ikke gennem PostgREST.
