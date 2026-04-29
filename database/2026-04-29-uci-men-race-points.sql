-- UCI men race classes and point tables used by Google Sheets result import.
-- Point values are seeded by backend/scripts/seedUciMenRacePoints.js.

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS race_class TEXT;

CREATE TABLE IF NOT EXISTS public.race_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_class TEXT NOT NULL,
  result_type TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_class, result_type, rank)
);

ALTER TABLE public.race_points ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read race_points" ON public.race_points FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_result_type_check;
  ALTER TABLE public.race_results
    ADD CONSTRAINT race_results_result_type_check
    CHECK (result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader'));
END $$;

UPDATE public.races
SET race_class = CASE race_class
  WHEN 'CWTGTFrance' THEN 'TourFrance'
  WHEN 'CWTGTAutres' THEN 'GiroVuelta'
  WHEN 'CWTMajeures' THEN 'Monuments'
  WHEN 'CWTAutresToursA' THEN 'OtherWorldTourA'
  WHEN 'CWTAutresClasA' THEN 'OtherWorldTourA'
  WHEN 'CWTAutresToursB' THEN 'OtherWorldTourB'
  WHEN 'CWTAutresClasB' THEN 'OtherWorldTourB'
  WHEN 'CWTAutresToursC' THEN 'OtherWorldTourC'
  WHEN 'CWTAutresClasC' THEN 'OtherWorldTourC'
  WHEN 'Cont2HC' THEN 'ProSeries'
  WHEN 'Cont1HC' THEN 'ProSeries'
  WHEN 'Cont21' THEN 'Class1'
  WHEN 'Cont11' THEN 'Class1'
  WHEN 'Cont22' THEN 'Class2'
  WHEN 'Cont12' THEN 'Class2'
  ELSE race_class
END
WHERE race_class IN (
  'CWTGTFrance', 'CWTGTAutres', 'CWTMajeures',
  'CWTAutresToursA', 'CWTAutresClasA',
  'CWTAutresToursB', 'CWTAutresClasB',
  'CWTAutresToursC', 'CWTAutresClasC',
  'Cont2HC', 'Cont1HC', 'Cont21', 'Cont11', 'Cont22', 'Cont12'
);

UPDATE public.race_points
SET race_class = CASE race_class
  WHEN 'CWTGTFrance' THEN 'TourFrance'
  WHEN 'CWTGTAutres' THEN 'GiroVuelta'
  WHEN 'CWTMajeures' THEN 'Monuments'
  WHEN 'CWTAutresToursA' THEN 'OtherWorldTourA'
  WHEN 'CWTAutresClasA' THEN 'OtherWorldTourA'
  WHEN 'CWTAutresToursB' THEN 'OtherWorldTourB'
  WHEN 'CWTAutresClasB' THEN 'OtherWorldTourB'
  WHEN 'CWTAutresToursC' THEN 'OtherWorldTourC'
  WHEN 'CWTAutresClasC' THEN 'OtherWorldTourC'
  WHEN 'Cont2HC' THEN 'ProSeries'
  WHEN 'Cont1HC' THEN 'ProSeries'
  WHEN 'Cont21' THEN 'Class1'
  WHEN 'Cont11' THEN 'Class1'
  WHEN 'Cont22' THEN 'Class2'
  WHEN 'Cont12' THEN 'Class2'
  ELSE race_class
END,
result_type = CASE result_type
  WHEN 'Pointtrøje' THEN 'Pointtroje'
  WHEN 'Bjergtrøje' THEN 'Bjergtroje'
  WHEN 'Ungdomstrøje' THEN 'Ungdomstroje'
  WHEN 'EtapeløbHold' THEN 'EtapelobHold'
  ELSE result_type
END
WHERE race_class IN (
  'CWTGTFrance', 'CWTGTAutres', 'CWTMajeures',
  'CWTAutresToursA', 'CWTAutresClasA',
  'CWTAutresToursB', 'CWTAutresClasB',
  'CWTAutresToursC', 'CWTAutresClasC',
  'Cont2HC', 'Cont1HC', 'Cont21', 'Cont11', 'Cont22', 'Cont12'
)
OR result_type IN ('Pointtrøje', 'Bjergtrøje', 'Ungdomstrøje', 'EtapeløbHold');
