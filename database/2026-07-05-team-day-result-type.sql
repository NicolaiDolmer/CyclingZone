-- #2081: løbende hold-klassement pr. mellem-etape (team_day), parallelt med
-- leader/points_day/mountain_day/young_day. Uden denne værdi har Teams-fanen
-- ingen persisterede data for etaper FØR sidste (frontend deriverer i dag fra
-- GC-gaps som fallback for legacy-løb uden team_day-rækker, raceLiveStandings.js).
DO $$ BEGIN
  ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_result_type_check;
  ALTER TABLE public.race_results
    ADD CONSTRAINT race_results_result_type_check
    CHECK (result_type IN (
      'stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader',
      'mountain_day', 'points_day', 'young_day', 'team_day'
    ));
END $$;
