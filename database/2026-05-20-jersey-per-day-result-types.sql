-- Add per-day result_types for Bjerg/Point/Ungdoms jerseys
-- Existing 'mountain'/'points'/'young' represent FINAL classification (top 3).
-- New 'mountain_day'/'points_day'/'young_day' represent per-stage jersey holders
-- (parallel to existing 'leader' mechanic for yellow jersey).
-- Sheet-input: "Bjergtrøje per dag" / "Pointtrøje per dag" / "Ungdomstrøje per dag" (rank=1 per stage).

DO $$ BEGIN
  ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_result_type_check;
  ALTER TABLE public.race_results
    ADD CONSTRAINT race_results_result_type_check
    CHECK (result_type IN (
      'stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader',
      'mountain_day', 'points_day', 'young_day'
    ));
END $$;
