-- #7792 · Besked naar et roadmap-punkt, du stemte hoejt paa, er leveret.
--
-- To dele:
--   1. roadmap_items.delivery_notified_at: tidspunktet hvor leveret-beskederne for
--      punktet er behandlet. NULL paa et leveret punkt = sweepet skal kigge paa det.
--   2. roadmap_delivery_receipts: varigt bevis for at en manager HAR faaet beskeden
--      for et punkt. PRIMARY KEY (item_id, user_id) er claim'en: sweepet skriver
--      med ON CONFLICT DO NOTHING foer det sender, saa et gentaget statusskift
--      (leveret, tilbage, leveret igen) eller to samtidige sweeps giver hoejst en
--      besked pr. manager pr. punkt. En kvittering slettes ikke naar beskeden
--      slettes i indbakken.
--
-- Ingen besked for punkter leveret foer denne migration: alle punkter der allerede
-- er leveret faar delivery_notified_at = now() i samme transaktion, saa sweepet
-- aldrig ser dem. Backfill'en koerer kun den ene gang kolonnen oprettes, saa en
-- gentagen kørsel af filen ikke sluger et punkt, der er leveret siden.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen; sweepet springer
-- da en tick over uden Sentry-stoej (42703/42P01/PGRST204/PGRST205).
--
-- RLS: enabled, INGEN policy, kun service_role. Klienten laeser/skriver aldrig
-- tabellen.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT count(*) FROM public.roadmap_items WHERE status = 'shipped' AND delivery_notified_at IS NULL;  -- 0
--   2. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roadmap_delivery_receipts'::regclass;  -- true
--   3. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'roadmap_delivery_receipts';  -- kun service_role (+ postgres)
--
-- Rollback: DROP TABLE IF EXISTS public.roadmap_delivery_receipts;
--           ALTER TABLE public.roadmap_items DROP COLUMN IF EXISTS delivery_notified_at;
--
-- Refs #7792
-- data-api-access: {"table":"public.roadmap_delivery_receipts","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Server-written delivery receipts; only the backend roadmap-delivered sweep reads and writes them"}

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roadmap_items' AND column_name = 'delivery_notified_at'
  ) THEN
    ALTER TABLE public.roadmap_items ADD COLUMN delivery_notified_at timestamptz;
    UPDATE public.roadmap_items SET delivery_notified_at = now() WHERE status = 'shipped';
  END IF;
END
$$;

COMMENT ON COLUMN public.roadmap_items.delivery_notified_at IS
  '#7792: when the delivered-notifications for this item were handled. NULL on a shipped item = the sweep has not looked at it yet.';

CREATE TABLE IF NOT EXISTS public.roadmap_delivery_receipts (
  item_id uuid NOT NULL REFERENCES public.roadmap_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

ALTER TABLE public.roadmap_delivery_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.roadmap_delivery_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.roadmap_delivery_receipts TO service_role;

COMMENT ON TABLE public.roadmap_delivery_receipts IS
  '#7792: durable receipt that a manager got the delivered message for a roadmap item. '
  'Never deleted when the notification is deleted. service_role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
