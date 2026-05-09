-- Slice 09 · Race-pool katalog
-- Issue: #242
--
-- Indfører race_pool som "katalog" af alle tilgængelige løb i verdens-
-- kalenderen. Adskilt fra eksisterende races-tabel som nu bliver "sæson-
-- instans" af et pool-løb (FK pool_race_id).
--
-- Pool er DELT på tværs af sæsoner (fx Tour de France er ét pool-løb,
-- men kan instantieres som race-row i sæson 1, 2, 3 osv. med separate
-- race_results). Det matcher virkelighedens manager-spil hvor de samme
-- løb køres år efter år med nye resultater.
--
-- race_class bruger frontend's 9-klasse-taksonomi (TourFrance, GiroVuelta,
-- Monuments, OtherWorldTourA/B/C, ProSeries, Class1, Class2) jvf
-- frontend/src/lib/uciRaceClasses.js — ikke DB's race_classes-tabel som er
-- en parallel struktur til UCI-point-tildeling.
--
-- Idempotent seed: external_id er UNIQUE og dannes deterministisk fra
-- (name + date_text) så re-import af samme CSV er no-op.

CREATE TABLE IF NOT EXISTS race_pool (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  race_class TEXT NOT NULL CHECK (race_class IN (
    'TourFrance','GiroVuelta','Monuments',
    'OtherWorldTourA','OtherWorldTourB','OtherWorldTourC',
    'ProSeries','Class1','Class2'
  )),
  race_type TEXT NOT NULL CHECK (race_type IN ('single','stage_race')),
  stages INTEGER NOT NULL CHECK (stages > 0),
  date_text TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_pool_class ON race_pool(race_class);
CREATE INDEX IF NOT EXISTS idx_race_pool_type ON race_pool(race_type);

-- Bind eksisterende races til pool-løb (kan være NULL for legacy/ad-hoc races)
ALTER TABLE races ADD COLUMN IF NOT EXISTS pool_race_id UUID REFERENCES race_pool(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_races_pool_race_id ON races(pool_race_id);

-- RLS: pool er public-readable (alle kan se verdens-kalenderen).
-- Mutation kun via service_role (admin-endpoints går igennem service-key).
-- DROP+CREATE pattern fordi CREATE POLICY ikke understøtter IF NOT EXISTS i Postgres
-- — vigtigt for idempotency i auto-migrate workflow.
ALTER TABLE race_pool ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS race_pool_public_read ON race_pool;
CREATE POLICY race_pool_public_read ON race_pool FOR SELECT USING (true);
