-- =============================================================================
-- 2026-06-29 — Perf-advisor: multiple_permissive_policies (#1973 del 3)
-- =============================================================================
-- KILDE: Supabase performance-advisor 29/6 (projekt ghwvkxzhsbbltzfnuhhz).
-- 20 multiple_permissive_policies-WARN: hver ramt tabel havde en bred admin-
-- `FOR ALL`-policy DER OGSAA daekker SELECT, plus en separat laese-policy. For
-- SELECT betoed det 2 permissive policies pr. (rolle, action) -> Postgres maa
-- evaluere begge pr. row. (TO public-tabellerne race_classes/race_points talte
-- 6 hver, én pr. DB-rolle der arver fra public -> 7*1 + 2*6 + users = 20.)
--
-- LOESNING (semantisk no-op): admin-`FOR ALL` daekkede SELECT redundant, fordi
-- der allerede fandtes en bredere laese-policy (qual=true / "Anyone can read").
-- Vi splitter admin-`FOR ALL` i separate FOR INSERT/UPDATE/DELETE (samme qual)
-- saa admin-grenen ikke laengere optraeder paa SELECT. Writes uaendret; SELECT
-- daekkes fortsat af laese-policyen (admins kunne allerede laese via den, fordi
-- `is_admin() OR true` = `true`).
--
-- users (specialtilfaelde): 2 SELECT-policies ("Admins can read all users" TO
-- authenticated USING is_admin()  +  "Users can read own profile" TO public
-- USING auth.uid()=id) konsolideres til ÉN. Den SKAL vaere TO authenticated:
-- is_admin() har KUN EXECUTE for `authenticated` (verificeret 29/6), saa en
-- TO public-variant ville fejle for anon ("permission denied for function
-- is_admin"). anon faar 0 rows uanset (auth.uid() er null), saa adgangen er
-- identisk. is_admin() bruges (ikke en inline EXISTS) fordi en users-policy der
-- selv laeser users ville rekursere; is_admin() er SECURITY DEFINER og bypasser.
-- UPDATE-policyen "Users can update own profile" roeres IKKE.
--
-- Quals verificeret 1:1 mod live (pg_policies 29/6). De 7 authenticated-
-- tabeller har is_admin() (USING+WITH CHECK); race_classes/race_points har en
-- inline EXISTS-admincheck med with_check=NULL paa ALL-policyen (defaulter til
-- USING for INSERT/UPDATE) — bevaret eksplicit i hver gren.
--
-- VERIFIKATION (FOER push, BEGIN..ROLLBACK-dry-run mod live 29/6):
--   * Rolle-baseret SELECT-count anon/authenticated(normal)/authenticated(admin)
--     FOER/EFTER paa alle 10 tabeller = identisk (nul access-drift). users:
--     anon 0->0, normal 1->1, admin 46->46.
--   * Effektivt write-predikat pr. (tabel, INSERT/UPDATE/DELETE) FOER/EFTER =
--     byte-identisk (0 diffs).
--   * SELECT-predikat-aendringer er den tilsigtede konsolidering, algebraisk
--     ækvivalent (`is_admin() OR true` = `true`; users-OR kommutativ).
-- Perf-advisor (multiple_permissive: 20 -> 0) re-verificeres efter ejer-merge.
--
-- IDEMPOTENT: DROP POLICY IF EXISTS (baade gamle OG nye navne) + CREATE POLICY.
-- Re-run dropper foerst -> ingen "already exists". Refs #1973.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- DEL A — 9 tabeller med admin-`FOR ALL` + bredere SELECT-laese-policy.
-- Split admin-`FOR ALL` -> FOR INSERT / FOR UPDATE / FOR DELETE (samme qual).
-- ---------------------------------------------------------------------------

-- A1. app_config (is_admin(), TO authenticated)
DROP POLICY IF EXISTS app_config_admin_write  ON public.app_config;
DROP POLICY IF EXISTS app_config_admin_insert ON public.app_config;
DROP POLICY IF EXISTS app_config_admin_update ON public.app_config;
DROP POLICY IF EXISTS app_config_admin_delete ON public.app_config;
CREATE POLICY app_config_admin_insert ON public.app_config
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY app_config_admin_update ON public.app_config
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY app_config_admin_delete ON public.app_config
  FOR DELETE TO authenticated USING (is_admin());

-- A2. countries
DROP POLICY IF EXISTS countries_admin_write  ON public.countries;
DROP POLICY IF EXISTS countries_admin_insert ON public.countries;
DROP POLICY IF EXISTS countries_admin_update ON public.countries;
DROP POLICY IF EXISTS countries_admin_delete ON public.countries;
CREATE POLICY countries_admin_insert ON public.countries
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY countries_admin_update ON public.countries
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY countries_admin_delete ON public.countries
  FOR DELETE TO authenticated USING (is_admin());

-- A3. race_entries
DROP POLICY IF EXISTS race_entries_admin_write  ON public.race_entries;
DROP POLICY IF EXISTS race_entries_admin_insert ON public.race_entries;
DROP POLICY IF EXISTS race_entries_admin_update ON public.race_entries;
DROP POLICY IF EXISTS race_entries_admin_delete ON public.race_entries;
CREATE POLICY race_entries_admin_insert ON public.race_entries
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY race_entries_admin_update ON public.race_entries
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY race_entries_admin_delete ON public.race_entries
  FOR DELETE TO authenticated USING (is_admin());

-- A4. race_stage_profiles
DROP POLICY IF EXISTS race_stage_profiles_admin_write  ON public.race_stage_profiles;
DROP POLICY IF EXISTS race_stage_profiles_admin_insert ON public.race_stage_profiles;
DROP POLICY IF EXISTS race_stage_profiles_admin_update ON public.race_stage_profiles;
DROP POLICY IF EXISTS race_stage_profiles_admin_delete ON public.race_stage_profiles;
CREATE POLICY race_stage_profiles_admin_insert ON public.race_stage_profiles
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY race_stage_profiles_admin_update ON public.race_stage_profiles
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY race_stage_profiles_admin_delete ON public.race_stage_profiles
  FOR DELETE TO authenticated USING (is_admin());

-- A5. race_stage_schedule
DROP POLICY IF EXISTS race_stage_schedule_admin_write  ON public.race_stage_schedule;
DROP POLICY IF EXISTS race_stage_schedule_admin_insert ON public.race_stage_schedule;
DROP POLICY IF EXISTS race_stage_schedule_admin_update ON public.race_stage_schedule;
DROP POLICY IF EXISTS race_stage_schedule_admin_delete ON public.race_stage_schedule;
CREATE POLICY race_stage_schedule_admin_insert ON public.race_stage_schedule
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY race_stage_schedule_admin_update ON public.race_stage_schedule
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY race_stage_schedule_admin_delete ON public.race_stage_schedule
  FOR DELETE TO authenticated USING (is_admin());

-- A6. rider_derived_abilities
DROP POLICY IF EXISTS rider_derived_abilities_admin_write  ON public.rider_derived_abilities;
DROP POLICY IF EXISTS rider_derived_abilities_admin_insert ON public.rider_derived_abilities;
DROP POLICY IF EXISTS rider_derived_abilities_admin_update ON public.rider_derived_abilities;
DROP POLICY IF EXISTS rider_derived_abilities_admin_delete ON public.rider_derived_abilities;
CREATE POLICY rider_derived_abilities_admin_insert ON public.rider_derived_abilities
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY rider_derived_abilities_admin_update ON public.rider_derived_abilities
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY rider_derived_abilities_admin_delete ON public.rider_derived_abilities
  FOR DELETE TO authenticated USING (is_admin());

-- A7. rider_physiology_profiles (NB: write-policy hed rider_physiology_admin_write)
DROP POLICY IF EXISTS rider_physiology_admin_write           ON public.rider_physiology_profiles;
DROP POLICY IF EXISTS rider_physiology_admin_insert          ON public.rider_physiology_profiles;
DROP POLICY IF EXISTS rider_physiology_admin_update          ON public.rider_physiology_profiles;
DROP POLICY IF EXISTS rider_physiology_admin_delete          ON public.rider_physiology_profiles;
CREATE POLICY rider_physiology_admin_insert ON public.rider_physiology_profiles
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY rider_physiology_admin_update ON public.rider_physiology_profiles
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY rider_physiology_admin_delete ON public.rider_physiology_profiles
  FOR DELETE TO authenticated USING (is_admin());

-- A8. race_classes (TO public, inline EXISTS-admincheck, with_check var NULL)
DROP POLICY IF EXISTS "Admins can manage race_classes" ON public.race_classes;
DROP POLICY IF EXISTS "Admins can insert race_classes" ON public.race_classes;
DROP POLICY IF EXISTS "Admins can update race_classes" ON public.race_classes;
DROP POLICY IF EXISTS "Admins can delete race_classes" ON public.race_classes;
CREATE POLICY "Admins can insert race_classes" ON public.race_classes
  FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.users
                      WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'));
CREATE POLICY "Admins can update race_classes" ON public.race_classes
  FOR UPDATE TO public
  USING (EXISTS (SELECT 1 FROM public.users
                 WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users
                      WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'));
CREATE POLICY "Admins can delete race_classes" ON public.race_classes
  FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM public.users
                 WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'));

-- A9. race_points (TO public, inline EXISTS-admincheck, with_check var NULL)
DROP POLICY IF EXISTS "Admins can manage race_points" ON public.race_points;
DROP POLICY IF EXISTS "Admins can insert race_points" ON public.race_points;
DROP POLICY IF EXISTS "Admins can update race_points" ON public.race_points;
DROP POLICY IF EXISTS "Admins can delete race_points" ON public.race_points;
CREATE POLICY "Admins can insert race_points" ON public.race_points
  FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.users
                      WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'));
CREATE POLICY "Admins can update race_points" ON public.race_points
  FOR UPDATE TO public
  USING (EXISTS (SELECT 1 FROM public.users
                 WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users
                      WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'));
CREATE POLICY "Admins can delete race_points" ON public.race_points
  FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM public.users
                 WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'));

-- ---------------------------------------------------------------------------
-- DEL B — users: konsolidér 2 SELECT-policies til ÉN (TO authenticated).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users read own profile or admin reads all" ON public.users;
CREATE POLICY "Users read own profile or admin reads all" ON public.users
  FOR SELECT TO authenticated
  USING ((id = (SELECT auth.uid())) OR is_admin());
