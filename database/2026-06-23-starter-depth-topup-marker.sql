-- Race-hub 0c: markør-kolonne for ENGANGS dybde-top-up (8→12-trup).
--
-- starter_squad_allocated_at markerer "fik dette hold sin oprindelige (8-)trup?".
-- Dybde-top-up'en (8→12) er et SEPARAT engangs-event → egen markør, så de to ikke
-- forveksles. Top-up'en tilføjer KUN svage hale-domestiques op til 12 og giver
-- aldrig gratis kerne-ryttere (samme anti-exploit-filosofi som #1563): markøren er
-- sandheden, ikke rytter-antallet → et hold der har solgt ned får ikke gratis trup
-- ved en gentaget kørsel.
--
-- IKKE backfilled: alle eksisterende hold har markør NULL → de ER målet for den
-- ene top-up-kørsel (topup-starter-depth.mjs --live). Efter kørslen er markøren sat
-- → idempotent (gentagne kørsler = no-op).
--
-- Service-role-only (læses/skrives kun server-side) → ingen klient-GRANT nødvendig.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS starter_depth_topped_up_at timestamptz;
