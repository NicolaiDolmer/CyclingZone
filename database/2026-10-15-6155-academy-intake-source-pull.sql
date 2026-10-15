-- #6155: academy_intake.source faar vaerdien 'pull' (kandidater hentet med
-- ugens hent-knap, #3550). Frontend viser kun "Provisional value" paa dem.
-- Idempotent, ikke destruktiv: udvider kun CHECK-constrainten.
ALTER TABLE public.academy_intake DROP CONSTRAINT IF EXISTS academy_intake_source_check;
ALTER TABLE public.academy_intake
  ADD CONSTRAINT academy_intake_source_check CHECK (source IN ('intake', 'board_gift', 'pull'));
COMMENT ON COLUMN public.academy_intake.source IS
  '#5844/#6155: intake (normalt optag) | board_gift (bestyrelsens engangs-kuld: fee 0, 14 dages frist) | pull (hentet med ugens knap, symbolsk startvaerdi)';
