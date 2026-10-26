-- #1857 (ejer 26/10, designbord S8): motorens FULDE input pr. afviklet etape,
-- gemt privat, så enhver rigtig etape kan genafspilles bit-identisk før/efter
-- en motorændring (backend/scripts/dev/replayStage1857.mjs).
--
-- Privat: RLS slået til UDEN policies, og kun service_role har grants. Ingen
-- klient (anon/authenticated) kan læse eller skrive. Skrives af raceRunner
-- (backend/lib/engineInputSnapshot1857.js) efter etape-låsen; en fejl her vælter
-- aldrig en afvikling, og en manglende tabel springes over.
--
-- input_gzip_b64: gzip + base64 af {format,engine,formPeaksOff,rulesRevision,
-- stageNumber,seedInput,args} hvor args er motorens argument-objekt (tagget JSON).
-- Idempotent: kan køres igen uden effekt. Apply post-merge (#2642).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- data-api-access: {"table":"public.race_stage_engine_inputs","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Private engine-input snapshots for replay (#1857); written by the race runner with the service role only"}
CREATE TABLE IF NOT EXISTS public.race_stage_engine_inputs (
  race_id uuid NOT NULL,
  stage_number integer NOT NULL,
  engine text NOT NULL,
  engine_version integer,
  rules_revision text NOT NULL DEFAULT 'legacy',
  seed_input text,
  engine_build text,
  format text NOT NULL,
  input_gzip_b64 text NOT NULL,
  input_bytes integer NOT NULL,
  stored_bytes integer NOT NULL,
  input_sha256 text NOT NULL,
  output_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, stage_number)
);

ALTER TABLE public.race_stage_engine_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.race_stage_engine_inputs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.race_stage_engine_inputs TO service_role;

-- Constraints tilføjes NOT VALID (ingen fuld-scan under lås) og valideres bagefter.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_stage_engine_inputs_race_fk') THEN
    ALTER TABLE public.race_stage_engine_inputs
      ADD CONSTRAINT race_stage_engine_inputs_race_fk
      FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_stage_engine_inputs_engine_chk') THEN
    ALTER TABLE public.race_stage_engine_inputs
      ADD CONSTRAINT race_stage_engine_inputs_engine_chk
      CHECK (engine IN ('v3', 'v4')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_stage_engine_inputs_stage_chk') THEN
    ALTER TABLE public.race_stage_engine_inputs
      ADD CONSTRAINT race_stage_engine_inputs_stage_chk
      CHECK (stage_number >= 1 AND input_bytes >= 0 AND stored_bytes >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.race_stage_engine_inputs VALIDATE CONSTRAINT race_stage_engine_inputs_race_fk;
ALTER TABLE public.race_stage_engine_inputs VALIDATE CONSTRAINT race_stage_engine_inputs_engine_chk;
ALTER TABLE public.race_stage_engine_inputs VALIDATE CONSTRAINT race_stage_engine_inputs_stage_chk;

COMMENT ON TABLE public.race_stage_engine_inputs IS
  '#1857: private engine input per completed stage (gzip+base64 tagged JSON) for bit-identical replay. Service role only.';

COMMIT;
