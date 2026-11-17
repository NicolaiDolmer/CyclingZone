-- #8244 (Vercel Security Review): en manager maa kun aendre laest-status paa
-- sine egne notifikationer.
--
-- RLS-politikken "Users can update own notifications" begraenser HVILKE raekker
-- en manager maa opdatere (sine egne), men ikke HVILKE kolonner. Dermed kunne en
-- manager omskrive type, related_id, metadata, title, message og user_id paa sine
-- egne notifikationer, og en senere backfill, der stolede paa metadata, kunne
-- foeres bag lyset.
--
-- Rettelse med KOLONNE-PRIVILEGIER (samme moenster som #1162):
--   * REVOKE UPDATE paa hele tabellen fra PUBLIC, anon og authenticated
--     (en table-level REVOKE fjerner ogsaa evt. kolonne-grants).
--   * GRANT UPDATE (is_read) til authenticated - den eneste kolonne frontenden
--     opdaterer ("markér som laest", "markér alle", stille oprydning).
--
-- Uaendret: SELECT og DELETE (sletning i appen virker som foer), alle RLS-
-- politikker, og service_role (backend) der fortsat maa alt.
--
-- FAIL-CLOSED for fremtidige kolonner: en ny kolonne er IKKE klient-opdaterbar,
-- foer en migration eksplicit granter UPDATE paa netop den.
--
-- Idempotent: REVOKE + GRANT kan genkoeres frit. Ingen raekker roeres.
-- Applies post-merge af auto-migrate.yml (#2642).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'is_read'
  ) THEN
    RAISE EXCEPTION '#8244: public.notifications.is_read not found - refusing to revoke';
  END IF;
END $$;

REVOKE UPDATE ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- Efter-tjek: authenticated maa opdatere is_read og intet andet; anon intet.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE') THEN
    RAISE EXCEPTION '#8244: authenticated lost UPDATE on notifications.is_read';
  END IF;

  SELECT string_agg(r.rolname || '.' || c.column_name, ', ')
  INTO bad
  FROM information_schema.columns c
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE c.table_schema = 'public'
    AND c.table_name = 'notifications'
    AND NOT (r.rolname = 'authenticated' AND c.column_name = 'is_read')
    AND has_column_privilege(r.rolname, 'public.notifications', c.column_name, 'UPDATE');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '#8244: client roles can still UPDATE: %', bad;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
