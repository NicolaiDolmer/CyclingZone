-- #4376: backup-tabellen for sponsor_contracts blev oprettet uden PRIMARY KEY (id),
-- men reparationsscriptet upserter med onConflict: "id". Apply stoppede i trin 0
-- (backup) FOER nogen skrivning med "no unique or exclusion constraint matching
-- the ON CONFLICT specification". Rettet direkte i prod 4/9 (tom tabel); denne fil
-- holder repo og prod i sync. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'backup_4376_sponsor_contracts_20260904_pkey'
  ) THEN
    ALTER TABLE public.backup_4376_sponsor_contracts_20260904
      ADD CONSTRAINT backup_4376_sponsor_contracts_20260904_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- POST-VERIFY:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.backup_4376_sponsor_contracts_20260904'::regclass;

-- Andet stop samme dag: backup-tabellen arvede NOT NULL paa alle kolonner (LIKE-DDL),
-- men scriptet gemmer kun de kolonner det roerer. Backup-rader maa vaere delvise.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'backup_4376_sponsor_contracts_20260904'
      AND is_nullable = 'NO' AND column_name <> 'id'
  LOOP
    EXECUTE format('ALTER TABLE public.backup_4376_sponsor_contracts_20260904 ALTER COLUMN %I DROP NOT NULL', r.column_name);
  END LOOP;
END $$;
