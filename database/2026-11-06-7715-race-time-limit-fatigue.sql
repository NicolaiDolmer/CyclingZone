-- #7715 (ejer 5/11): kontakten for meget traette ryttere gaelder kun loeb der starter efter
-- taending. Valget bindes her ved loebets foerste etape, samme princip som
-- races.engine_rules_revision. NULL = ikke bundet endnu. Additivt og idempotent.

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS time_limit_fatigue_7715 boolean;

COMMENT ON COLUMN public.races.time_limit_fatigue_7715 IS
  '#7715: om loebet koerer med reglen for meget traette ryttere. Bindes ved foerste etape-claim og aendres aldrig siden. NULL = ikke bundet.';
