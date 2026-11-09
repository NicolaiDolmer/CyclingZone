-- #7943 Strammer adgangen til salgsannoncer. Laesning er uaendret.
--
-- Idempotent: gentaget koersel aendrer intet. Ingen raekker roeres.
-- Applies post-merge af auto-migrate.yml (#2642).

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.transfer_listings
  FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
