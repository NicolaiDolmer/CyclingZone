-- #8196 · Holdbare "sendt"-maerker for to automatiske beskeder, uafhaengigt af indbakken.
--
-- Samme fejl som midtsaeson-beskeden (#8197): det eneste vaern mod gentagelse var,
-- om beskeden stadig laa i notifications. Indbakken sletter raekker fysisk, saa
-- slettede manageren beskeden, blev den sendt igen.
--
-- 1. academy_graduation.notified_at: graduerings-valget venter. Det natlige sweep
--    (missedGraduateSweep.js) eftersendte beskeden hver nat, saa laenge vinduet
--    stod aabent, hvis den var slettet. Maerket bor paa grad-raekken (ejeren).
-- 2. notification_sent_markers: trup under loebs-minimum (squadBelowMinimumCheck.js).
--    En genkoersel af saesonskiftet (bygget til re-run efter delvis fejl) sendte
--    beskeden igen, hvis den var slettet. Der findes ingen ejer-raekke pr.
--    (hold, trup, saeson), saa maerket er en kvittering med den eksisterende
--    dedupe-noegle ("squad_below_minimum:<team>:<squad>:<season>"). Noeglen
--    baerer typen som praefiks, saa tabellen kan genbruges af andre beskeder.
--
-- ADDITIV OG IDEMPOTENT: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- opfyldning kun hvor maerket mangler, ON CONFLICT DO NOTHING. Intet slettes.
-- Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen. Begge steder
-- haandteres det manglende objekt (42703/PGRST204 hhv. 42P01/PGRST205) ved at
-- falde tilbage til det gamle vaern uden at skrive maerker; koerslen vaelter ikke.
--
-- Opfyldning: beskeder, der ligger i indbakken lige nu, giver maerket, saa en
-- sletning efter deploy ikke udloeser en ny. En besked, der allerede er slettet
-- foer migrationen, kan give EN sidste besked; derefter staar maerket.
--
-- RLS og grants: academy_graduation uaendret (kolonnen foelger tabellens adgang;
-- et tidsstempel uden privat indhold). notification_sent_markers: RLS enabled,
-- INGEN policy, kun service_role (samme moenster som selection_warning_receipts).
-- Ingen FK: en kvittering for et slettet hold er harmloes, og en FK ville tage
-- en laas paa teams under apply.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT data_type, is_nullable FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'academy_graduation'
--         AND column_name = 'notified_at';   -- timestamp with time zone, YES
--   2. SELECT count(*) FILTER (WHERE notified_at IS NOT NULL) AS marked, count(*) AS pending
--       FROM public.academy_graduation WHERE status = 'pending';
--   3. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'notification_sent_markers' ORDER BY ordinal_position;
--   4. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'notification_sent_markers';  -- kun service_role (+ postgres)
--   5. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_sent_markers'::regclass;  -- true
--
-- Rollback: ALTER TABLE public.academy_graduation DROP COLUMN IF EXISTS notified_at;
--           DROP TABLE IF EXISTS public.notification_sent_markers;
--
-- Refs #8196
-- data-api-access: {"table":"public.notification_sent_markers","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Server-written notification sent markers; only backend sweeps read and write them"}

BEGIN;

-- #6342: en migration maa aldrig holde spillerlaesninger tilbage; giv op efter 3 s.
SET LOCAL lock_timeout = '3s';

-- ─── 1. Graduerings-beskeden ────────────────────────────────────────────────
ALTER TABLE public.academy_graduation
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN public.academy_graduation.notified_at IS
  '#8196: hvornaar beskeden om graduerings-valget er leveret til holdets manager. Vaern mod gentagelse, uafhaengigt af indbakken.';

-- Opfyldning: pending-raekker, hvis besked ligger hos holdets nuvaerende manager
-- (samme match som sweepet: user_id, type, related_id = rytteren).
UPDATE public.academy_graduation ag
SET notified_at = s.first_sent
FROM (
  SELECT g.id AS graduation_id, min(n.created_at) AS first_sent
  FROM public.academy_graduation g
  JOIN public.teams t
    ON t.id = g.team_id
   AND t.user_id IS NOT NULL
  JOIN public.notifications n
    ON n.type = 'academy_graduation_ready'
   AND n.related_id = g.rider_id
   AND n.user_id = t.user_id
  WHERE g.status = 'pending'
    AND g.notified_at IS NULL
  GROUP BY g.id
) s
WHERE ag.id = s.graduation_id
  AND ag.notified_at IS NULL;

-- ─── 2. Trup under loebs-minimum ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_sent_markers (
  dedupe_key text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_sent_markers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_sent_markers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sent_markers TO service_role;

COMMENT ON TABLE public.notification_sent_markers IS
  '#8196: durable marker that a keyed automatic notification was delivered. '
  'Never deleted when the notification is deleted. service_role only.';

-- Opfyldning: trup-beskeder med dedupe-noegle, der ligger i indbakken nu.
INSERT INTO public.notification_sent_markers (dedupe_key, sent_at)
SELECT metadata->>'dedupeKey', min(created_at)
FROM public.notifications
WHERE type = 'squad_below_minimum'
  AND metadata->>'dedupeKey' IS NOT NULL
GROUP BY metadata->>'dedupeKey'
ON CONFLICT (dedupe_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
