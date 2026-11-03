-- [#4211] 'paused' bliver en gyldig vaerdi i transfer_listings.status.
--
-- Ejer-regel 3/11: saettes en rytter paa auktion, fjernes den automatisk fra
-- transferlisten imens; ender auktionen uden salg, er rytteren tilbage paa
-- transferlisten. Backend (backend/lib/auctionTransferListPause.ts) saetter
-- rytterens open/negotiating-listing til 'paused' ved auktionsstart og afgoer
-- den ved auktionsslut ('open' igen, eller 'withdrawn' hvis rytteren er solgt).
--
-- Alle markedslaesninger filtrerer paa open/negotiating, saa en pauset listing
-- er usynlig paa markedet. uniq_transfer_listings_one_active_per_rider
-- (WHERE status IN ('open','negotiating')) er uaendret.
--
-- Migrationen goer kun vaerdien LOVLIG og aendrer ingen raekke. Additiv og
-- idempotent: CHECK-constrainten erstattes med en bredere udgave i samme
-- transaktion. Alle eksisterende vaerdier (open, negotiating, sold, withdrawn)
-- er fortsat gyldige. Indtil migrationen er applied, fejler pausen paa CHECK;
-- koden fanger det (Sentry) og auktionen oprettes som foer.
--
-- Constraint-navnet er Postgres' standardnavn for den inline CHECK i
-- schema.sql. DO-blokken fjerner desuden en status-enum-CHECK under et andet
-- navn (samme vaerdiliste), saa en afvigende navngivning i prod ikke efterlader
-- den smalle regel.
--
-- Post-verify (read-only):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.transfer_listings'::regclass AND contype = 'c';
--   SELECT status, count(*) FROM public.transfer_listings GROUP BY 1;
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_transfer_listings_paused';

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.transfer_listings'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
       AND pg_get_constraintdef(oid) ILIKE '%negotiating%'
       AND pg_get_constraintdef(oid) ILIKE '%withdrawn%'
       AND conname <> 'transfer_listings_status_check'
  LOOP
    EXECUTE format('ALTER TABLE public.transfer_listings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.transfer_listings
  DROP CONSTRAINT IF EXISTS transfer_listings_status_check;

ALTER TABLE public.transfer_listings
  ADD CONSTRAINT transfer_listings_status_check
  CHECK (status IN ('open', 'negotiating', 'sold', 'withdrawn', 'paused'));

COMMENT ON COLUMN public.transfer_listings.status IS
  '#4211: open | negotiating | sold | withdrawn | paused. paused = rytteren er paa aktiv auktion; listingen kommer tilbage (open) hvis auktionen ender uden salg. Kontrakt: backend/lib/auctionTransferListPause.ts';

COMMIT;

-- Auktions-cronen leder hvert minut efter forladte pauser (status = 'paused' uden
-- aktiv auktion, reconcileOrphanPausedListings). Partial index: kun de faa
-- pausede raekker, saa opslaget aldrig scanner hele tabellen. CONCURRENTLY kan
-- ikke staa i en transaktion og ligger derfor efter COMMIT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfer_listings_paused
  ON public.transfer_listings (rider_id)
  WHERE status = 'paused';
