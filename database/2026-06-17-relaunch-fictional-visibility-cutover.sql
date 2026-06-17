-- #1447 / #1105 relaunch-cutover — fjern #669-synligheds-gaten for fiktive ryttere.
--
-- Kontekst: #669 skjulte fiktive ryttere (pcm_id IS NULL) fra ikke-admins mens de
-- var admin-only test-data. SELECT-policyen "Public read riders" blev ændret fra
-- USING (true) → USING (pcm_id IS NOT NULL OR is_admin()) i
-- database/2026-05-31-fictional-riders-admin-rls.sql.
--
-- Ved relaunch (#1103) bliver HELE den aktive bestand pcm_id NULL (legacy
-- pensioneres). Gaten ville derfor gøre marked + eget hold + auktioner + alle 16
-- direkte-supabase rytter-flader TOMME for enhver ikke-admin. Fiktive ryttere ER
-- nu spillet → revert til den oprindelige åbne læse-policy.
--
-- Sikkert at ship FØR relaunch: 0 aktive fiktive i prod nu (kun 25 retiret, som
-- app-laget allerede filtrerer via is_retired=false), så dette er reelt et no-op
-- indtil relaunch-orchestratoren kører. Auth-laget (roller/RLS-TO) er uændret;
-- kun fiktiv-skjulet fjernes — riders var world-readable før #669.
--
-- ALTER (ikke DROP+CREATE) → atomisk, intet deny-all-vindue.

ALTER POLICY "Public read riders" ON public.riders
  USING (true);
