-- #7536 (Form og traethed 2.0, epic #6984): flag for at traening paa de frie pladser
-- paa en loebsdato vejer et helt traeningsdoegn (ejer-valg 3/11, loesning A; ejerens
-- regel 29/9). Hvile paa frie pladser, rene traeningsdatoer og etapebelastninger er
-- uaendrede.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: traetheden er en
-- faelles tilstand for alle hold). Virker kun naar condition_model_v2 er on; laeses af
-- backend/lib/conditionModelV2Flag.js (isRaceDateTrainingDayEnabled) i aftenens
-- opgoerelse (dailyTrainingEngine.js) og i ugeprognosen (trainingWeekPlanForecast.js).
-- Tallene ligger IKKE her (hard rule 17). Taendes af ejeren efter at have set
-- harness-tallene.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'condition_v2_race_date_training_day';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'condition_v2_race_date_training_day',
    '"off"'::jsonb,
    'Stage flag (off|on) for #7536 under Form and fatigue 2.0 (condition_model_v2): on a date with stages, training on the free slots weighs a full training day instead of a share of the date. Rest on free slots, pure training dates and stage loads are unchanged. Off = today''s v2 settlement, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
