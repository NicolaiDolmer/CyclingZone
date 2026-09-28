-- #4629 — traeningsprogrammer pr. loebsdag (7 ugedage x 5 loebsdage) + 22
-- standardprogrammer, BETA (ejer 26/9).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- 1) training_week_plans.program_key (text, null-bar): PROVENIENS, ikke
--    sandhed. Ejer-valg 1 (26/9): et program KOPIERES ind i planen ved
--    tildeling; `days` er stadig den fulde, selvstaendige 7-dages sandhed som
--    motoren laeser. Noeglen peger paa kataloget i
--    backend/lib/trainingPrograms.js (konfiguration, ikke en tabel), og bruges
--    kun til visningen "baseret paa Sprinter". NULL for alle eksisterende
--    raekker (ca. 27 hold har data), som dermed laeses praecis som i dag.
--
--    Cellerne pr. loebsdag bor i `days`-jsonb'en (ingen ny kolonne):
--      { mon: { session, intensity, slots?: [..5] }, ... }
--    `intensity` afledes af sessionen, saa raekken ogsaa er en gyldig
--    gammeldags ugerytme (#1895). Gamle raekker med kun `intensity` er uroerte.
--
-- 2) Stadie-flaget `training_programs` oprettes i stadie 'beta' (moenster:
--    database/2026-09-19-3643-training-mobile-table-flag.sql). Beta-testere
--    ser Program-kataloget og kan tildele; motoren laeser programceller kun for
--    hold hvis ejer er beta-tester (backend/lib/trainingProgramsFlag.js).
--    ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--    Flip til 'on' er ejer-only.

ALTER TABLE public.training_week_plans
  ADD COLUMN IF NOT EXISTS program_key text;

COMMENT ON COLUMN public.training_week_plans.program_key IS
  'Provenance only (#4629): key of the standard training program this plan was copied from (backend/lib/trainingPrograms.js). The days column stays the full source of truth; editing the catalog never changes an assigned plan.';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_programs',
  '"beta"'::jsonb,
  'Stage flag (off|beta|on) for training programs per race day (#4629, owner call 2026-09-26): 22 standard programs, copied into a rider plan on assignment, 7 weekdays x 5 race-day cells. beta = beta testers see and assign programs, and the engine reads program cells only for teams whose owner is a beta tester. off = today''s behaviour, bit for bit.'
)
ON CONFLICT (key) DO NOTHING;
