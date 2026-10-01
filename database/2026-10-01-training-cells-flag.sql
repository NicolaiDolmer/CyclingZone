-- #5932 — de 35 programfelter (7 ugedage x 5 loebsdage) aabnes for alle hold
-- (ejer-beslutning 6, 29/9; spec docs/superpowers/specs/2026-09-29-traen-nu-og-prognose-design.md).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Felterne bor allerede i training_week_plans.days (jsonb, #4629):
--   { mon: { session, intensity, slots?: [..5] }, ... }
-- Der er derfor INGEN ny kolonne og ingen datamigration af training_week_plans.
-- En rytter uden felter faar dem foerst, naar spilleren selv retter et felt:
-- serveren saar saa ugen fra rytterens nuvaerende plan (samme normalisering
-- som dagsvalget, trainingPrograms.js seedProgramWeekDays). Gamle raekker med
-- kun `intensity` (#1895) er uroerte og laeses praecis som i dag.
--
-- Stadie-flaget `training_program_cells` styrer felterne (rette et felt +
-- motorens laesning). Kataloget bliver bag `training_programs`.
-- Oprettes i 'on': ejer-beslutning 6 aabner felterne for alle, og loeftet i
-- roadbooken gaelder i dag. Flaget er kill-switchen: 'beta' = kun beta-testere
-- (adfaerden foer #5932), 'off' = ingen felter ud over training_programs.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_program_cells',
  '"on"'::jsonb,
  'Stage flag (off|beta|on) for the 35 training cells per rider (7 weekdays x 5 race days, #5932, owner call 2026-09-29). on = every team can edit single cells and the engine reads them; beta = beta testers only (today''s behaviour through training_programs). The 22-program catalogue stays behind training_programs.'
)
ON CONFLICT (key) DO NOTHING;
