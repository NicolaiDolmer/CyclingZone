-- #6710 (plan-PR 1 i #5833, ejer-go 16/10): "Afventer oprykning" i stedet for
-- automatisk salg/frigivelse naar maaltruppen er fuld ved en graduering.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes, ingen
-- backfill. Begge kolonner er nullable: NULL = rytteren afventer ikke oprykning.
--
--   promotion_pending_to     'u23' | 'senior' — trup rytteren venter paa plads i.
--   promotion_pending_since  hvornaar ventetiden startede (beholdes ved et
--                            senere saesons nye vindue, se academyGraduation.js).
--
-- Rytteren beholder klub og kontrakt og staar fortsat i sin GAMLE trup
-- (riders.squad aendres ikke), saa han taeller dér og ikke i maaltruppen.
-- Grad-raekken lukkes med den eksisterende status 'expired' (CHECK-listen fra
-- 2026-06-18-academy-graduation.sql), saa der ikke skal aendres constraints.
--
-- Flaget promotion_pending_enabled oprettes 'off'. Off = dagens adfaerd
-- uaendret (promover -> saelg -> slip). Kun ejeren flipper.
-- Applies post-merge af auto-migrate.yml (#2642); ikke under implementeringen.

BEGIN;

-- riders er en varm tabel: giv hellere op end at staa i koe bag en lang laas
-- (auto-migrate kan koeres igen).
SET lock_timeout = '3s';

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS promotion_pending_to text,
  ADD COLUMN IF NOT EXISTS promotion_pending_since timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders'::regclass AND conname = 'riders_promotion_pending_to_valid') THEN
    ALTER TABLE public.riders ADD CONSTRAINT riders_promotion_pending_to_valid CHECK (
      promotion_pending_to IS NULL OR promotion_pending_to IN ('u23', 'senior')
    );
  END IF;
END $$;

-- riders er kolonne-gatet (#1162/#2241): nye kolonner er ikke klient-laesbare
-- uden egen GRANT.
GRANT SELECT (promotion_pending_to, promotion_pending_since) ON public.riders TO authenticated;

COMMENT ON COLUMN public.riders.promotion_pending_to IS
  'Promotion pending (#6710): target squad (u23|senior) the rider waits for because it was full at graduation. NULL = not pending. Rider keeps team, contract and current squad.';
COMMENT ON COLUMN public.riders.promotion_pending_since IS
  'Promotion pending (#6710): when the wait started. NULL when not pending.';

-- Intet nyt indeks: trupsidens opslag filtrerer paa team_id (et holds ryttere),
-- og et indeks paa riders kraever CONCURRENTLY uden for transaktionen (#6342).

INSERT INTO public.app_config (key, value, description)
VALUES (
  'promotion_pending_enabled',
  '"off"'::jsonb,
  'Stage flag (off|on) for #6710: when a graduating rider''s target squad is full, he waits in his current squad ("Awaiting promotion") instead of being sold or released, and the manager promotes him from the team page once there is room. Off = old chain (promote, sell, release). Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
