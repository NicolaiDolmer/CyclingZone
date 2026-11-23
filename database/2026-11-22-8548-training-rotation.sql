-- #8548 (PR 1 af 3): rotation, programmet som pas 1..N der venter ved hvile og løb.
-- Design: docs/audits/undersoegelse-docs-8548-rotation-design.md (PR #8557), ejer-svar 21/11 på #8548.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende række ændres, intet slettes, ingen backfill.
-- Køres post-merge af auto-migrate (#2642). Tænding af flaget er ejer-only.
--
-- 1. rotation jsonb NULL på training_week_plans (rytterens/holdets plan) og training_groups
--    (gruppens plan, kopieres ind i hver følgende rytters række som felterne). Formen
--    valideres i backend/lib/trainingRotation.js (v1). NULL = ingen rotation.
-- 2. plan_kind text NULL ('week' | 'rotation'): den ENE markør for hvilken regel planen kører
--    (ejer-afstemning med #8549: rotation.active udgår). NULL = dagens felt-plan, præcis som før.
--    #8549 skal bruge samme kolonne (ADD COLUMN IF NOT EXISTS), så den af de to migrationer der
--    lander sidst, er en no-op for kolonnen. Også på training_groups, så en gruppe kan skifte
--    mellem Week blocks og Rotation uden at miste sine pas.
-- 3. Stadie-flaget training_rotation (off|beta|on) seedes "off" (ON CONFLICT DO NOTHING):
--    off = motoren læser aldrig kolonnerne, og API'et afviser skrivning (409 feature_disabled).
--
-- RLS: ingen ny tabel. De eksisterende policies på training_week_plans og training_groups
-- (eget hold) dækker de nye kolonner for EJERSKAB; backend skriver med service-role som i dag.
-- De dækker IKKE flaget eller valideringen: authenticated har skriveret på training_week_plans,
-- så motoren (PR 2) skal selv tjekke kontakten og isValidRotation og aldrig stole på kolonnen
-- (dommer 22/11 fund 3).

-- Lock-sikkerhed (#6342): en nullable kolonne uden default er en ren katalog-ændring, men ALTER
-- skal stadig have tabellens lås. Venter den, giver den op i stedet for at blokere læsninger;
-- auto-migrate kan køres igen.
SET lock_timeout = '3s';

ALTER TABLE public.training_week_plans ADD COLUMN IF NOT EXISTS rotation jsonb NULL;
ALTER TABLE public.training_groups ADD COLUMN IF NOT EXISTS rotation jsonb NULL;

ALTER TABLE public.training_week_plans
  ADD COLUMN IF NOT EXISTS plan_kind text NULL
  CONSTRAINT training_week_plans_plan_kind_check CHECK (plan_kind IN ('week', 'rotation'));
ALTER TABLE public.training_groups
  ADD COLUMN IF NOT EXISTS plan_kind text NULL
  CONSTRAINT training_groups_plan_kind_check CHECK (plan_kind IN ('week', 'rotation'));

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_rotation',
  '"off"'::jsonb,
  'Stage flag (off|beta|on, #8548): rotation plans, a fixed list of sessions that waits on rest and race slots and continues where it stopped. off = the API rejects rotation writes and the engine never reads the column. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
