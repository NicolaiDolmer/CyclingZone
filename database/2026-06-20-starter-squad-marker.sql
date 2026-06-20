-- #1563: marker-kolonne der gør nye-hold start-trup-allokeringen robust mod
-- delvis/transient fejl UDEN at åbne en gratis-trup-exploit.
--
-- Problem (#1560-restrisiko): allocateStarterSquadForTeam's idempotens-guard var
-- "≥1 rytter → no-op", og allokeringen kaldes kun synkront ved created===true.
--   (1) Fuld fejl: 0 ryttere men holdet er committet → login re-bootstrapper ikke
--       (SetupWizard trigger kun på manglende manager_name, som er sat) → holdet
--       sidder permanent tomt.
--   (2) Delvis fejl: holdet nåede fx 5 ryttere → "≥1 → no-op" blokerer top-up
--       → permanent <8 (< MIN_RIDERS_FOR_RACE, kan ikke stille op til løb).
-- Et naivt "fyld op til 8 når <8" er en EXPLOIT: et legitimt hold KAN sælge sig
-- under 8 (ingen sælg-guard på MIN_RIDERS_FOR_RACE=8) → ville få gratis ryttere.
--
-- Løsning: en permanent markør pr. hold = "fik dette hold nogensinde sin start-trup?".
-- Allokeringen + en self-heal-sweep gør KUN noget når markøren er NULL → et hold
-- der selv har solgt ned (markør sat) får aldrig gratis ryttere. Markøren er
-- sandheden, ikke rytter-antallet.
--
-- Backfill: ALLE eksisterende hold markeres som allokeret (de har passeret
-- bootstrap via relaunch/signup; også 0-rytter test-hold, som vi IKKE vil have
-- sweep'en til pludselig at give trupper). Kun hold oprettet EFTER denne migration
-- kan have NULL → og heales hvis deres bootstrap fejlede.
--
-- Service-role-only: kolonnen læses/skrives udelukkende server-side (api.js +
-- cron, SUPABASE_SERVICE_KEY) og er ikke player-facing → ingen klient-GRANT
-- nødvendig (modsat #1309 kolonne-privilege-fælden).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill kun hvor NULL.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS starter_squad_allocated_at timestamptz;

UPDATE public.teams
   SET starter_squad_allocated_at = COALESCE(created_at, now())
 WHERE starter_squad_allocated_at IS NULL;
