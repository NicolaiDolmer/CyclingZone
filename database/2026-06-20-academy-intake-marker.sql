-- #1584: marker-kolonne der hærder akademi-kuld-seedingen for nye hold mod
-- delvis/transient fejl UDEN at åbne en gratis-kuld-exploit. 1:1-spejling af
-- #1563's starter_squad_allocated_at-mønster (database/2026-06-20-starter-squad-marker.sql).
--
-- Problem (#1584-restrisiko): runAcademyIntakeForTeam kaldes kun synkront ved
-- signup (teamProfileEngine, created===true) og en fejl der er BEVIDST ikke-fatal
-- (logges + Sentry, signup fortsætter). Modsat start-truppen (#1563) fandtes der
-- INGEN self-heal-sweep → et hold hvis akademi-seeding fejlede sidder permanent
-- uden sit første kuld, en forever-relaunch-blindgyde for nye signups.
--
-- Et naivt "har holdet 0 academy_intake-rækker → seed" er en EXPLOIT: et legitimt
-- hold KAN underskrive/afvise alle sine 3-5 tilbudte kandidater (intake-rækkerne
-- forbliver med status signed/rejected, men et hold der får sit kuld slettet/
-- afsluttet må aldrig kunne tigge et nyt gratis-kuld). Markøren er sandheden:
-- "fik dette hold nogensinde sit FØRSTE akademi-kuld?".
--
-- Løsning: en permanent markør pr. hold. runAcademyIntakeForTeam + en self-heal-
-- sweep (runAcademyHealSweep) gør KUN noget når markøren er NULL → et hold der
-- har brugt/afvist sine pladser (markør sat) får aldrig et gratis-kuld.
--
-- Backfill: ALLE eksisterende hold markeres som seedet (de har passeret deres
-- akademi-vindue via relaunch/signup; også test-hold, som vi IKKE vil have sweep'en
-- til pludselig at give kuld). Kun hold oprettet EFTER denne migration kan have
-- NULL → og heales hvis deres signup-seeding fejlede.
--
-- Service-role-only: kolonnen læses/skrives udelukkende server-side (academyIntake
-- + cron, SUPABASE_SERVICE_KEY) og er ikke player-facing → ingen klient-GRANT
-- nødvendig (modsat #1309 kolonne-privilege-fælden).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill kun hvor NULL.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS academy_intake_seeded_at timestamptz;

UPDATE public.teams
   SET academy_intake_seeded_at = COALESCE(created_at, now())
 WHERE academy_intake_seeded_at IS NULL;
