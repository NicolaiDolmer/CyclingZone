-- #4075 (opfølgning, samme session) — race_pool.retired_at: pensionering af
-- katalog-rækker der er ude af seed-CSV'en men stadig FK-refereret af historiske
-- sæsoners races (pool_race_id). De kan ikke slettes (reference-tab), men de må
-- ALDRIG kunne vælges til nye kalendere — det var rod-årsagen til dublet-GT'erne
-- i S3 (gammel 21-etapers Giro/Tour/Vuelta valgt SAMMEN med de nye korte).
--
-- Skrives af scripts/seedRacePool.js --prune (retired_at = now() på forældreløse-
-- men-refererede rækker; nulstilles ved upsert hvis rækken genopstår i CSV'en).
-- Læses af alle selektions-loadere (tierCalendarMaterializer.js,
-- s3CalendarPackageScorecard.js, dryRunTierCalendarBalance.js, sim-scripts) som
-- filtrerer retired_at IS NULL. Meta-opslag pr. pool_race_id (backfill/profiler)
-- filtrerer IKKE — historiske løb skal stadig kunne slå deres katalog-meta op.
--
-- Idempotent. Ingen data-mutation her — pensioneringen sker via seed-scriptet.
--
-- Refs #4075.

alter table public.race_pool add column if not exists retired_at timestamptz;

comment on column public.race_pool.retired_at is
  '#4075: sat når rækken er ude af seed-CSV''en men stadig FK-refereret af en
  historisk sæsons races (kan ikke slettes). Pensionerede rækker er USYNLIGE for
  kalender-selektionen (alle selektions-loadere filtrerer retired_at IS NULL).
  Nulstilles af seedRacePool-upserten hvis external_id genopstår i CSV''en.';
